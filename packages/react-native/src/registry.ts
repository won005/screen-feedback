import type { View } from "react-native";

export type AnchorEntry = { id: string; depth: number; measure: () => View | null };

export function createAnchorRegistry() {
  const listeners = new Set<() => void>();
  const anchors = new Set<AnchorEntry>();
  const counts = new Map<string, number>();
  let revision = 0;

  const update = (id: string, delta: number) => {
    const next = (counts.get(id) ?? 0) + delta;
    if (next === 0) counts.delete(id);
    else counts.set(id, next);
    revision++;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => revision,
    getEntries: () => Array.from(anchors),
    has: (entry: AnchorEntry) => anchors.has(entry),
    isUnique: (id: string) => counts.get(id) === 1,
    register(entry: AnchorEntry) {
      anchors.add(entry);
      update(entry.id, 1);
      return () => {
        anchors.delete(entry);
        update(entry.id, -1);
      };
    },
  };
}

type SurfaceEntry = { id: string; depth: number };

export function createSurfaceRegistry() {
  const listeners = new Set<() => void>();
  const surfaces = new Set<SurfaceEntry>();
  let snapshot: { active: SurfaceEntry | undefined; unique: boolean } = { active: undefined, unique: true };

  const update = () => {
    let active: SurfaceEntry | undefined;
    for (const surface of surfaces) {
      if (!active || surface.depth >= active.depth) active = surface;
    }
    const unique = !active || Array.from(surfaces).filter((surface) => surface.id === active?.id).length === 1;
    snapshot = { active, unique };
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    register(entry: SurfaceEntry) {
      surfaces.add(entry);
      update();
      return () => {
        surfaces.delete(entry);
        update();
      };
    },
  };
}
