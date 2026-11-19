import { rectToPercentages } from "@won005/feedback-core";
import type { FeedbackAnchor } from "@won005/feedback-core";
import type { View } from "react-native";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Area = Point & Size;
export type FeedbackInsets = { top?: number; right?: number; bottom?: number; left?: number };

export const ROOT_SURFACE = "$root";
export const PIN_SIZE = 26;

export function surfaceDescriptor(surfaceId: string): string {
  return JSON.stringify(["native", surfaceId]);
}

export function anchorDescriptor(surfaceId: string, anchorId: string): string {
  return JSON.stringify(["native", surfaceId, anchorId]);
}

export function parseAnchorDescriptor(id: string): { surfaceId: string; anchorId?: string } | undefined {
  try {
    const value: unknown = JSON.parse(id);
    if (!Array.isArray(value) || value[0] !== "native" || typeof value[1] !== "string") return;
    if (value.length === 2) return { surfaceId: value[1] };
    if (value.length === 3 && typeof value[2] === "string") return { surfaceId: value[1], anchorId: value[2] };
  } catch {
    // Other renderers use opaque descriptors of their own.
  }
}

export function contains(area: Area, point: Point): boolean {
  return point.x >= area.x && point.y >= area.y &&
    point.x <= area.x + area.width && point.y <= area.y + area.height;
}

interface TouchTarget { area: Area; depth: number; unique: boolean }

// null is an ambiguous match; undefined allows a viewport-relative pin.
export function findTouchTarget<T extends TouchTarget>(point: Point, targets: T[]): T | null | undefined {
  let match: T | undefined;
  let tied = false;
  for (const target of targets) {
    if (!contains(target.area, point)) continue;
    if (!match || target.depth > match.depth) {
      match = target;
      tied = false;
    } else if (target.depth === match.depth) {
      tied = true;
    }
  }
  return tied || match?.unique === false ? null : match;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function relativePosition(point: Point, area: Area): Point {
  const { xPct, yPct } = rectToPercentages({ ...point, width: 0, height: 0 }, area);
  return {
    x: clamp(xPct, 0, 1),
    y: clamp(yPct, 0, 1),
  };
}

export function toFeedbackAnchor(id: string, point: Point, area: Area, viewport: Area): FeedbackAnchor {
  return {
    id,
    ...relativePosition(point, area),
    width: area.width,
    height: area.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scrollX: 0,
    scrollY: 0,
  };
}

export function usableArea(size: Size, insets: FeedbackInsets, keyboardTop?: number): Area {
  const x = Math.max(insets.left ?? 0, 0);
  const y = Math.max(insets.top ?? 0, 0);
  const right = Math.max(x, size.width - Math.max(insets.right ?? 0, 0));
  const bottom = Math.max(y, Math.min(
    size.height - Math.max(insets.bottom ?? 0, 0),
    keyboardTop ?? size.height,
  ));
  return { x, y, width: right - x, height: bottom - y };
}

export function constrainPosition(point: Point, area: Area, size: Size): Point {
  return {
    x: clamp(point.x, area.x, area.x + area.width - size.width),
    y: clamp(point.y, area.y, area.y + area.height - size.height),
  };
}

export function measureWindow(view: View | null): Promise<Area | undefined> {
  if (!view) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    // A detached native node may never invoke its measurement callback.
    const timeout = setTimeout(() => resolve(undefined), 180);
    view.measureInWindow((x, y, width, height) => {
      clearTimeout(timeout);
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        resolve({ x, y, width, height });
      } else {
        resolve(undefined);
      }
    });
  });
}
