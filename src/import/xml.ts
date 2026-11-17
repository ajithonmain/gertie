/** A parsed XML element. Namespace prefixes are kept as written, so `xlink:href` is the key for that attribute. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Text directly inside the element, for `<style>`. */
  text: string;
}

export class XmlError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = "XmlError";
    this.offset = offset;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

/**
 * A small XML parser, enough for SVG from design tools: elements, attributes, text, comments,
 * CDATA, the XML declaration and a DOCTYPE (skipped). It does not validate and does not expand custom entities.
 */
export function parseXml(src: string): XmlElement {
  let i = 0;
  const n = src.length;
  const root: XmlElement = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];

  const fail = (msg: string): never => {
    throw new XmlError(msg, i);
  };

  const skipUntil = (end: string, what: string): string => {
    const j = src.indexOf(end, i);
    if (j === -1) fail(`${what} is not closed`);
    const body = src.slice(i, j);
    i = j + end.length;
    return body;
  };

  const readName = (): string => {
    const start = i;
    if (!NAME_START.test(src[i] ?? "")) fail(`expected a name at offset ${i}`);
    while (i < n && NAME_CHAR.test(src[i] as string)) i++;
    return src.slice(start, i);
  };

  const skipSpace = (): void => {
    while (i < n && /\s/.test(src[i] as string)) i++;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1] as XmlElement;
    if (lt === -1) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    i = lt;

    if (src.startsWith("<!--", i)) {
      i += 4;
      skipUntil("-->", "a comment");
    } else if (src.startsWith("<![CDATA[", i)) {
      i += 9;
      top.text += skipUntil("]]>", "a CDATA section");
    } else if (src.startsWith("<?", i)) {
      i += 2;
      skipUntil("?>", "a processing instruction");
    } else if (src.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset in brackets.
      let depth = 0;
      i += 2;
      while (i < n) {
        const c = src[i] as string;
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
        i++;
      }
      if (i >= n) fail("a DOCTYPE is not closed");
      i++;
    } else if (src.startsWith("</", i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (src[i] !== ">") fail(`expected '>' after </${name}`);
      i++;
      if (stack.length < 2 || (stack[stack.length - 1] as XmlElement).name !== name) fail(`</${name}> does not match the open element`);
      stack.pop();
    } else {
      i++;
      const el: XmlElement = { name: readName(), attrs: {}, children: [], text: "" };
      for (;;) {
        skipSpace();
        const c = src[i];
        if (c === undefined) fail(`element <${el.name}> is not closed`);
        if (c === ">") {
          i++;
          top.children.push(el);
          stack.push(el);
          break;
        }
        if (c === "/") {
          if (src[i + 1] !== ">") fail(`expected '/>' in <${el.name}>`);
          i += 2;
          top.children.push(el);
          break;
        }
        const key = readName();
        skipSpace();
        if (src[i] !== "=") fail(`attribute '${key}' on <${el.name}> has no value`);
        i++;
        skipSpace();
        const q = src[i];
        if (q !== '"' && q !== "'") fail(`attribute '${key}' on <${el.name}> is not quoted`);
        i++;
        const end = src.indexOf(q as string, i);
        if (end === -1) fail(`attribute '${key}' on <${el.name}> is not closed`);
        el.attrs[key] = decodeEntities(src.slice(i, end));
        i = end + 1;
      }
    }
  }
  if (stack.length > 1) fail(`<${(stack[stack.length - 1] as XmlElement).name}> is not closed`);
  const first = root.children[0];
  if (!first) fail("the file has no root element");
  return first as XmlElement;
}
