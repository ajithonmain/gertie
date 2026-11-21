import type { ChildProcess } from "node:child_process";

/**
 * Process-wide cleanup. Anything that starts an external process (a headless browser, an
 * ffmpeg encode) registers it here, so that when the CLI finishes, fails or is interrupted
 * nothing is left running in the background and using the machine's CPU and memory.
 */

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();
const children = new Set<ChildProcess>();
let handlersInstalled = false;
let shuttingDown: Promise<void> | undefined;

/** Registers a cleanup that runs on shutdown. Returns a function that unregisters it. */
export function onShutdown(fn: Cleanup): () => void {
  cleanups.add(fn);
  installHandlers();
  return () => cleanups.delete(fn);
}

/** Tracks a spawned child process so it is killed if it is still running at shutdown. */
export function trackChild<T extends ChildProcess>(child: T): T {
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  installHandlers();
  return child;
}

function killChildren(): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
}

/** Runs every registered cleanup and kills tracked children. Safe to call more than once. */
export function shutdown(): Promise<void> {
  shuttingDown ??= (async () => {
    killChildren();
    await Promise.all([...cleanups].map(async (fn) => { try { await fn(); } catch { /* best effort */ } }));
    cleanups.clear();
  })();
  return shuttingDown;
}

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const codes: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  for (const [signal, code] of Object.entries(codes)) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(code));
    });
  }
  // A synchronous last resort: 'exit' handlers cannot await, but they can still kill children.
  process.once("exit", killChildren);
}

/**
 * Time limits for external processes, so a stuck ffmpeg or hyperframes can never hang Gertie
 * (and the agent waiting on it) forever. GERTIE_TIMEOUT_SCALE multiplies every limit, for slow
 * machines or very long clips: GERTIE_TIMEOUT_SCALE=4 allows four times as long.
 */
export type ProcessKind = "quick" | "decode" | "encode" | "render";

const BASE_LIMIT_MS: Record<ProcessKind, number> = {
  /** Version checks, capability lists, ffprobe, one decoded frame. */
  quick: 60_000,
  /** Decoding a clip or a few seconds of one into frames. */
  decode: 5 * 60_000,
  /** One ffmpeg export encode. */
  encode: 30 * 60_000,
  /** A full hyperframes video render. */
  render: 60 * 60_000,
};

export function processLimitMs(kind: ProcessKind): number {
  const scale = Number(process.env["GERTIE_TIMEOUT_SCALE"]);
  return Math.round(BASE_LIMIT_MS[kind] * (Number.isFinite(scale) && scale > 0 ? scale : 1));
}

/** spawnSync options that kill the child outright once its limit has passed. */
export function syncLimit(kind: ProcessKind): { timeout: number; killSignal: "SIGKILL" } {
  return { timeout: processLimitMs(kind), killSignal: "SIGKILL" };
}

/** True when a spawnSync result ended because its time limit passed. */
export function timedOut(r: { error?: Error }): boolean {
  return (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
}

/** An error sentence for a process that was stopped at its limit, with the fix. */
export function timeoutMessage(what: string, kind: ProcessKind): string {
  return `${what} was stopped after ${Math.round(processLimitMs(kind) / 1000)} seconds without finishing. If the input is very long or the machine is slow, raise the limit with GERTIE_TIMEOUT_SCALE=4 and run the command again.`;
}
