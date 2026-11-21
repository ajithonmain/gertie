import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onShutdown, syncLimit } from "../shutdown.ts";

/** The subset of Playwright that Gertie uses. Playwright is loaded at run time, never bundled. */
export interface PwPage {
  goto(url: string): Promise<unknown>;
  evaluate<R, A = unknown>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  screenshot(opts: { omitBackground?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  on(event: string, handler: (arg: never) => void): void;
  close(): Promise<void>;
}
export interface PwBrowser {
  newPage(opts?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number }): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwModule {
  chromium: {
    launch(opts: { channel?: string; executablePath?: string; headless?: boolean }): Promise<PwBrowser>;
    executablePath(): string;
  };
}

export type BrowserSource = "GERTIE_BROWSER" | "chrome" | "playwright-chromium";

export interface BrowserStatus {
  playwright: boolean;
  source?: BrowserSource;
  detail: string;
  /** What the user can run to fix a missing piece. */
  fix?: string;
}

export class RenderUnavailableError extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = "RenderUnavailableError";
  }
}

async function loadPlaywright(): Promise<PwModule> {
  try {
    const name = "playwright";
    return (await import(name)) as PwModule;
  } catch {
    throw new RenderUnavailableError("Playwright is not installed, so frames cannot be rendered.", "Run: npm install playwright (in the skill directory), then: npx playwright install chromium");
  }
}

/** Browsers launched by this process that have not been closed yet. */
const openBrowsers = new Set<PwBrowser>();
let registered = false;
/** How long a graceful close may take before the process stops waiting for it. */
const CLOSE_TIMEOUT_MS = 5000;
/** Marker in the temporary profile path of every browser that Playwright launches. */
const PROFILE_MARKER = "playwright_chromiumdev_profile-";

async function closeWithTimeout(browser: PwBrowser, close: () => Promise<void>): Promise<void> {
  if (!openBrowsers.delete(browser)) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
    timer.unref();
  });
  try {
    await Promise.race([close().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tracks a launched browser so it is always shut down: its close() becomes idempotent and
 * bounded by a timeout, and closeAllBrowsers() (called when the CLI finishes or is
 * interrupted) closes anything a command left open.
 */
function track(browser: PwBrowser): PwBrowser {
  const close = browser.close.bind(browser);
  openBrowsers.add(browser);
  browser.close = () => closeWithTimeout(browser, close);
  if (!registered) {
    registered = true;
    onShutdown(closeAllBrowsers);
  }
  return browser;
}

/** Closes every browser this process launched that is still open. Safe to call more than once. */
export async function closeAllBrowsers(): Promise<void> {
  await Promise.all([...openBrowsers].map((b) => b.close()));
}

/**
 * Kills headless browsers that an earlier Gertie (or other Playwright) run left behind when its
 * Node process was killed before it could close them. Only processes that use a Playwright
 * temporary profile and whose parent has died (re-parented to PID 1) are touched, so a browser
 * that another live process still owns is never killed. POSIX only; returns the killed PIDs.
 * Set GERTIE_KEEP_ORPHANS=1 to disable.
 */
export function reapOrphanBrowsers(): number[] {
  if (process.platform === "win32" || process.env["GERTIE_KEEP_ORPHANS"] === "1") return [];
  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", ...syncLimit("quick") });
  if (ps.status !== 0) return [];
  const killed: number[] = [];
  for (const line of ps.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pidText, ppidText, command] = m as unknown as [string, string, string, string];
    if (ppidText !== "1" || !command.includes(PROFILE_MARKER) || !command.includes("--headless")) continue;
    const pid = Number(pidText);
    try {
      process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch {
      continue;
    }
    const profile = /--user-data-dir=(\S+)/.exec(command)?.[1];
    if (profile?.includes(PROFILE_MARKER)) rmSync(profile, { recursive: true, force: true });
  }
  return killed;
}

/**
 * Launches a headless browser. Order: the GERTIE_BROWSER executable, an installed Google Chrome,
 * then Playwright's own Chromium. Every browser is tracked so it is closed when the CLI exits.
 */
export async function launchBrowser(): Promise<{ browser: PwBrowser; source: BrowserSource }> {
  const { browser, source } = await launchUntracked();
  return { browser: track(browser), source };
}

async function launchUntracked(): Promise<{ browser: PwBrowser; source: BrowserSource }> {
  reapOrphanBrowsers();
  const pw = await loadPlaywright();
  const custom = process.env["GERTIE_BROWSER"];
  if (custom) {
    if (!existsSync(custom)) throw new RenderUnavailableError(`GERTIE_BROWSER points to '${custom}', which does not exist.`, "Unset GERTIE_BROWSER or point it at a Chrome or Chromium executable.");
    return { browser: await pw.chromium.launch({ executablePath: custom, headless: true }), source: "GERTIE_BROWSER" };
  }
  try {
    return { browser: await pw.chromium.launch({ channel: "chrome", headless: true }), source: "chrome" };
  } catch {
    /* fall through to the bundled Chromium */
  }
  try {
    return { browser: await pw.chromium.launch({ headless: true }), source: "playwright-chromium" };
  } catch {
    throw new RenderUnavailableError("No browser found. Gertie needs Google Chrome or Playwright's Chromium to render frames.", "Run: npx playwright install chromium");
  }
}

/** Reports which browser would be used, without keeping it open. */
export async function browserStatus(): Promise<BrowserStatus> {
  try {
    const { browser, source } = await launchBrowser();
    await browser.close();
    const detail = source === "GERTIE_BROWSER" ? `using ${process.env["GERTIE_BROWSER"]}` : source === "chrome" ? "using installed Google Chrome" : "using Playwright's Chromium";
    return { playwright: true, source, detail };
  } catch (e) {
    if (e instanceof RenderUnavailableError) return { playwright: !e.message.startsWith("Playwright is not installed"), detail: e.message, fix: e.fix };
    throw e;
  }
}

/** Finds the skill's assets directory, both when bundled (scripts/ beside assets/) and when run from source. */
export function assetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "assets"), join(here, "..", "..", "skills", "gertie", "assets"), join(here, "..", "..", "..", "skills", "gertie", "assets")];
  for (const c of candidates) if (existsSync(join(c, "render.html"))) return c;
  throw new RenderUnavailableError("The skill assets directory (render.html) was not found.", "Reinstall the skill so that assets/ sits beside scripts/.");
}
