// Agent evaluation harness. Runs an agent on each prompt in a fresh folder with the skill installed,
// then checks the result with `gertie qa`. See docs/19-agent-evaluation.md.
//
//   node tests/eval/run.mjs --model haiku --out tests/eval/results/haiku
//   node tests/eval/run.mjs --model opus --limit 5 --concurrency 2
//
// Metrics per prompt:
//   firstPass  the first `qa` the agent ran had zero errors
//   within3    some `qa` in its first three runs had zero errors
//   final      the scene left in the folder passes `qa` when the harness runs it
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
const model = args.model ?? "haiku";
const concurrency = Number(args.concurrency ?? 3);
const limit = Number(args.limit ?? 1000);
const timeoutMs = Number(args.timeout ?? 600) * 1000;
const out = resolve(args.out ?? join(root, "tests", "eval", "results", model));
const prompts = JSON.parse(readFileSync(join(root, "tests", "eval", "prompts.json"), "utf8")).slice(0, limit);
mkdirSync(out, { recursive: true });
// --resume keeps finished rows from an earlier run and reruns only prompts that errored or never ran.
const kept = [];
if (args.resume && existsSync(join(out, "results.json"))) {
  for (const r of JSON.parse(readFileSync(join(out, "results.json"), "utf8")).rows) if (!r.error) kept.push(r);
}
const todo = prompts.filter((p) => !kept.some((r) => r.id === p.id));

function runAgent(dir, prompt) {
  return new Promise((done) => {
    const p = spawn("claude", ["-p", `${prompt}\n\nSave the scene file in the current folder.`, "--model", model, "--output-format", "stream-json", "--verbose", "--allowedTools", "Bash Read Write Edit", "--permission-mode", "acceptEdits", "--setting-sources", "project"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", () => { clearTimeout(timer); done(buf); });
  });
}

// An API failure (usage limit, overload) says nothing about the skill, so such runs are excluded from the rates.
function apiError(stream) {
  for (const line of stream.split("\n")) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "result" && ev.is_error) return String(ev.api_error ?? ev.result ?? "error");
  }
  return stream.includes('"type":"result"') ? undefined : "no result (timeout or crash)";
}

// Reads the stream and returns the exit status of each qa run the agent made, in order.
function qaRuns(stream) {
  const calls = new Map();
  const runs = [];
  for (const line of stream.split("\n")) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    for (const c of ev.message?.content ?? []) {
      if (c.type === "tool_use" && c.name === "Bash" && /gertie\.mjs\s+qa\b/.test(c.input?.command ?? "")) calls.set(c.id, true);
      if (c.type === "tool_result" && calls.has(c.tool_use_id)) {
        const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("");
        const m = text.match(/"errors"\s*:\s*(\d+)/);
        runs.push(m ? Number(m[1]) === 0 : false);
      }
    }
  }
  return runs;
}

function findScene(dir) {
  const hits = readdirSync(dir).filter((f) => f.endsWith(".gertie.json"));
  return hits.length ? join(dir, hits[0]) : undefined;
}

async function one(item) {
  const dir = mkdtempSync(join(tmpdir(), `gertie-eval-${item.id}-`));
  const skill = join(dir, ".claude", "skills", "gertie");
  mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
  cpSync(join(root, "skills", "gertie"), skill, { recursive: true });
  // The renderer is provisioned so the score measures the skill, not an npm install.
  symlinkSync(join(root, "node_modules"), join(skill, "node_modules"));
  const t0 = Date.now();
  const stream = await runAgent(dir, item.prompt);
  const runs = qaRuns(stream);
  const error = apiError(stream);
  const scene = findScene(dir);
  let final = false;
  let sheet;
  if (scene) {
    const r = spawnSync("node", [join(skill, "scripts", "gertie.mjs"), "qa", scene, "--json"], { cwd: dir, encoding: "utf8", timeout: 180000 });
    try { const j = JSON.parse(r.stdout); final = j.ok === true && j.errors === 0; sheet = j.outputs?.sheet; } catch { /* final stays false */ }
  }
  const art = join(out, item.id);
  mkdirSync(art, { recursive: true });
  if (scene) cpSync(scene, join(art, "scene.gertie.json"));
  if (sheet && existsSync(sheet)) cpSync(sheet, join(art, "sheet.png"));
  writeFileSync(join(art, "stream.jsonl"), stream);
  rmSync(dir, { recursive: true, force: true });
  if (error) {
    const row = { id: item.id, category: item.category, error, seconds: Math.round((Date.now() - t0) / 1000) };
    console.log(JSON.stringify(row));
    return row;
  }
  const firstIdx = runs.indexOf(true);
  const row = { id: item.id, category: item.category, qaRuns: runs.length, firstPass: runs[0] === true, within3: firstIdx >= 0 && firstIdx < 3, final, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(JSON.stringify(row));
  return row;
}

const rows = [...kept];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < todo.length) rows.push(await one(todo[next++]));
}));
rows.sort((a, b) => a.id.localeCompare(b.id));
const valid = rows.filter((r) => !r.error);
const pct = (k) => (valid.length ? Math.round((100 * valid.filter((r) => r[k]).length) / valid.length) : 0);
const summary = { model, date: new Date().toISOString().slice(0, 10), prompts: valid.length, errored: rows.length - valid.length, firstPassPct: pct("firstPass"), within3Pct: pct("within3"), finalPct: pct("final"), rows };
writeFileSync(join(out, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n${model}: first-pass ${summary.firstPassPct}%, within-three ${summary.within3Pct}%, final ${summary.finalPct}% over ${valid.length} prompts (${rows.length - valid.length} errored)`);
