import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Launches a headless browser. Order: the GERTIE_BROWSER executable, an installed Google Chrome,
 * then Playwright's own Chromium.
 */
export async function launchBrowser(): Promise<{ browser: PwBrowser; source: BrowserSource }> {
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
