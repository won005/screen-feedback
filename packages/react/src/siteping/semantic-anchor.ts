/**
 * Adapted from SitePing anchor.ts and resolver.ts, MIT.
 * Copyright (c) 2025 NeosiaNexus.
 * Source: NeosiaNexus/SitePing@fd64185eda976c13c2c5e9a5fa20debf077b9004
 * Changes: explicit semantic keys only, unique matches across open roots, caller-owned
 * document; no CSS serialization, page text, XPath, fingerprinting, or fuzzy scans.
 * Full permission notice is included in THIRD_PARTY_NOTICES.md.
 */
export const ANCHOR_KEY_ATTR = "data-feedback-anchor";

/** SitePing's parent walk through open shadow hosts. */
export function parentElementCrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode?.();
  return root && "host" in root ? (root as ShadowRoot).host : null;
}

/** SitePing's per-tree query strategy, narrowed to explicit host identifiers. */
export function anchorRoots(document: Document): (Document | ShadowRoot)[] {
  const roots: (Document | ShadowRoot)[] = [document];
  const visited = new Set<Document | ShadowRoot>();
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!;
    if (visited.has(root)) continue;
    visited.add(root);
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.hasAttribute?.("data-feedback-overlay")) continue;
      if (element.shadowRoot && !visited.has(element.shadowRoot)) roots.push(element.shadowRoot);
    }
  }
  return [...visited];
}

export function semanticIndex(document: Document): Map<string, Element | null> {
  const index = new Map<string, Element | null>();
  for (const root of anchorRoots(document)) {
    for (const element of Array.from(root.querySelectorAll(`[${ANCHOR_KEY_ATTR}]`))) {
      const key = element.getAttribute(ANCHOR_KEY_ATTR);
      if (key) index.set(key, index.has(key) ? null : element);
    }
  }
  return index;
}

export function resolveSemanticAnchor(document: Document, key: string): Element | null {
  return semanticIndex(document).get(key) ?? null;
}
