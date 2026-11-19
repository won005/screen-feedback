/**
 * Adapted from SitePing packages/widget/src/dom/anchor.ts, MIT.
 * Copyright (c) 2025 NeosiaNexus.
 * Source: fd64185eda976c13c2c5e9a5fa20debf077b9004.
 * Change: structural rectangle types allow web and native callers without DOM globals.
 * Full permission notice is included in THIRD_PARTY_NOTICES.md.
 */
export interface FeedbackRect { x: number; y: number; width: number; height: number }
export interface RelativeRect { xPct: number; yPct: number; wPct: number; hPct: number }

export function rectToPercentages(rect: FeedbackRect, anchorBounds: FeedbackRect): RelativeRect {
  if (anchorBounds.width <= 0 || anchorBounds.height <= 0) {
    return { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };
  }
  return {
    xPct: (rect.x - anchorBounds.x) / anchorBounds.width,
    yPct: (rect.y - anchorBounds.y) / anchorBounds.height,
    wPct: rect.width / anchorBounds.width,
    hPct: rect.height / anchorBounds.height,
  };
}
