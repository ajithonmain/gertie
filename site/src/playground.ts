import { compileSceneText } from "../../src/compile.ts";

interface Example { name: string; text: string }

const q = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const editor = q<HTMLTextAreaElement>("editor");
const picker = q<HTMLSelectElement>("picker");
const stage = q<HTMLDivElement>("stage");
const diag = q<HTMLUListElement>("diag");
const dlLottie = q<HTMLButtonElement>("dl-lottie");
const dlSvg = q<HTMLButtonElement>("dl-svg");
const examples: Example[] = JSON.parse(q<HTMLScriptElement>("examples").textContent ?? "[]");

let lottieText = "";
let svgText = "";
let url = "";
let timer: ReturnType<typeof setTimeout> | undefined;

function show(items: { severity: string; code: string; message: string; fix?: string }[]): void {
  diag.replaceChildren();
  for (const d of items) {
    const li = document.createElement("li");
    li.className = d.severity;
    const head = document.createElement("strong");
    head.textContent = `${d.code} `;
    li.append(head, document.createTextNode(d.message));
    if (d.fix) {
      const fix = document.createElement("div");
      fix.className = "fix";
      fix.textContent = `Fix: ${d.fix}`;
      li.append(fix);
    }
    diag.append(li);
  }
}

function run(): void {
  const result = compileSceneText(editor.value);
  show(result.diagnostics as { severity: string; code: string; message: string; fix?: string }[]);
  lottieText = result.lottie ? JSON.stringify(result.lottie) : "";
  svgText = result.svg?.svg ?? "";
  dlLottie.disabled = !lottieText;
  dlSvg.disabled = !svgText;
  if (url) URL.revokeObjectURL(url);
  url = "";
  stage.replaceChildren();
  if (svgText) {
    url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = document.createElement("img");
    img.alt = "Compiled animation";
    img.src = url;
    stage.append(img);
  } else {
    const p = document.createElement("p");
    p.className = "mut";
    p.textContent = result.svgSkipped === "lottie" ? "This scene places a Lottie file, which the SVG cannot show." : "Fix the errors below to see the animation.";
    stage.append(p);
  }
}

function save(name: string, text: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

for (const ex of examples) {
  const o = document.createElement("option");
  o.value = ex.name;
  o.textContent = ex.name;
  picker.append(o);
}
picker.addEventListener("change", () => {
  const ex = examples.find((e) => e.name === picker.value);
  if (ex) { editor.value = ex.text; run(); }
});
editor.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 300); });
dlLottie.addEventListener("click", () => save("animation.lottie.json", lottieText, "application/json"));
dlSvg.addEventListener("click", () => save("animation.svg", svgText, "image/svg+xml"));

const first = examples.find((e) => e.name === "spinner-ring") ?? examples[0];
if (first) { picker.value = first.name; editor.value = first.text; }
run();
