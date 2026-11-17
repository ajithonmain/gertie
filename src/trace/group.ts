type Obj = Record<string, unknown>;

export interface GroupSpec {
  /** New group id mapped to the ids of the nodes it should hold. */
  [group: string]: string[];
}

export interface Grouped {
  nodes: Obj[];
  errors: string[];
}

function walkIds(nodes: Obj[], out: Set<string>): void {
  for (const n of nodes) {
    if (typeof n["id"] === "string") out.add(n["id"]);
    if (Array.isArray(n["children"])) walkIds(n["children"] as Obj[], out);
  }
}

/**
 * Wraps listed top-level nodes in new groups. A group goes where its first (lowest) member was, and keeps its members in their
 * original order, so a member that sat between two others in the stack can move relative to nodes in between. Pure.
 * The grouping file maps a group id to the ids of top-level nodes: `{ "head": ["region-12", "region-13"] }`.
 */
export function groupNodes(nodes: readonly Obj[], spec: GroupSpec): Grouped {
  const errors: string[] = [];
  const all = new Set<string>();
  walkIds([...nodes], all);
  const top = new Map<string, number>();
  nodes.forEach((n, i) => typeof n["id"] === "string" && top.set(n["id"], i));
  const owner = new Map<string, string>();
  for (const [g, members] of Object.entries(spec)) {
    if (!/^[a-z][a-z0-9-]*$/.test(g)) errors.push(`group id '${g}' is not valid: use lowercase letters, digits and hyphens, starting with a letter`);
    else if (all.has(g)) errors.push(`group id '${g}' is already the id of a node in the fragment`);
    if (!Array.isArray(members) || members.length === 0) {
      errors.push(`group '${g}' needs a list of node ids`);
      continue;
    }
    for (const id of members) {
      if (!top.has(id)) {
        errors.push(all.has(id) ? `'${id}' in group '${g}' is not a top-level node (it is inside another group), so it cannot be regrouped` : `'${id}' in group '${g}' is not a node of the fragment`);
        continue;
      }
      const prev = owner.get(id);
      if (prev !== undefined) errors.push(`'${id}' is in both '${prev}' and '${g}'`);
      else owner.set(id, g);
    }
  }
  if (errors.length > 0) return { nodes: [...nodes], errors };
  const placed = new Set<string>();
  const out: Obj[] = [];
  nodes.forEach((n) => {
    const id = n["id"] as string;
    const g = owner.get(id);
    if (g === undefined) {
      out.push(n);
      return;
    }
    if (placed.has(g)) return;
    placed.add(g);
    const members = (spec[g] as string[]).map((m) => nodes[top.get(m) as number] as Obj).sort((a, b) => (top.get(a["id"] as string) as number) - (top.get(b["id"] as string) as number));
    out.push({ id: g, type: "group", children: members });
  });
  return { nodes: out, errors };
}
