import type { FeedbackAnchor, FeedbackScreen } from "@won005/feedback-core";
import { rectToPercentages } from "@won005/feedback-core";
import { ANCHOR_KEY_ATTR, parentElementCrossShadow, resolveSemanticAnchor, semanticIndex } from "./siteping/semantic-anchor.ts";

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export function clampPosition(point: Point, viewport: Size, size: Size): Point {
  return {
    x: Math.max(8, Math.min(point.x, viewport.width - size.width - 8)),
    y: Math.max(8, Math.min(point.y, viewport.height - size.height - 8)),
  };
}

export function sameScreen(a: FeedbackScreen, b: FeedbackScreen): boolean {
  return a.id === b.id && a.resourceId === b.resourceId;
}

export function anchorPoint(anchor: Pick<FeedbackAnchor, "x" | "y">, rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: rect.left + anchor.x * rect.width, y: rect.top + anchor.y * rect.height };
}

export function selectAnchor<T>(candidates: readonly { key: string; element: T }[], key: string): T | null {
  const matches = candidates.filter((candidate) => candidate.key === key);
  return matches.length === 1 ? matches[0]!.element : null;
}

function findAnchor(document: Document, descriptor: string, index?: Map<string, Element | null>): Element | null {
  const separator = descriptor.indexOf(":");
  const kind = descriptor.slice(0, separator);
  const key = descriptor.slice(separator + 1);
  return kind === "data" ? index ? index.get(key) ?? null : resolveSemanticAnchor(document, key) : null;
}

/** Only explicit element identifiers are read; text, form values, and URLs are never inspected. */
export function captureAnchor(target: Element | null, point: Point, document: Document): FeedbackAnchor {
  const view = document.defaultView!;
  let descriptor = "page";
  const index = semanticIndex(document);
  let rect = { left: 0, top: 0, width: view.innerWidth, height: view.innerHeight };
  for (let element = target; element; element = parentElementCrossShadow(element)) {
    const explicit = element.getAttribute(ANCHOR_KEY_ATTR);
    const candidate = explicit && explicit.length <= 500 ? `data:${explicit}` : null;
    if (!candidate) continue;
    if (findAnchor(document, candidate, index) !== element) { descriptor = "unanchored"; continue; }
    const measured = element.getBoundingClientRect();
    if (measured.width <= 0 || measured.height <= 0) continue;
    descriptor = candidate;
    rect = measured;
    break;
  }
  const relative = rectToPercentages({ x: point.x, y: point.y, width: 0, height: 0 }, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  return {
    id: descriptor,
    x: Math.max(0, Math.min(1, relative.xPct)),
    y: Math.max(0, Math.min(1, relative.yPct)),
    width: rect.width, height: rect.height,
    viewportWidth: view.innerWidth, viewportHeight: view.innerHeight,
    scrollX: view.scrollX, scrollY: view.scrollY,
  };
}

export function measureAnchor(anchor: FeedbackAnchor, document: Document, index?: Map<string, Element | null>): Point | null {
  if (anchor.id === "page") {
    const view = document.defaultView;
    if (!view || Math.abs(view.innerWidth - anchor.viewportWidth) > 1) return null;
    return { x: anchor.x * anchor.viewportWidth + anchor.scrollX - view.scrollX, y: anchor.y * anchor.viewportHeight + anchor.scrollY - view.scrollY };
  }
  const element = findAnchor(document, anchor.id, index);
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return anchorPoint(anchor, rect);
}

/** One DOM candidate pass per layout update, independent of the number of pins. */
export function measureAnchors(anchors: readonly FeedbackAnchor[], document: Document): (Point | null)[] {
  const index = semanticIndex(document);
  return anchors.map(anchor => measureAnchor(anchor, document, index));
}
