/**
 * DesignPro v2 — Object-Tracking Architecture (isolated experimental module).
 *
 * This is a deterministic state machine, NOT an image editor. Every design
 * element (background panel, stripe section, logo overlay, text) is a
 * registered object with a unique ID and a geometric bounding box in percent
 * coordinates. "Remove" is a pure array operation — the object is popped from
 * the active state and the composition re-renders crisply from the background
 * layer up. No inpainting, no pixel erasing, no blur, ever.
 *
 * PARALLEL MODULE PATTERN: nothing in here is imported by the existing
 * DesignPro / RevisionStudio code paths. The only consumer is the admin test
 * route /admin/designpro-v2-test. Production flows are untouched.
 *
 * All functions are pure (graph in → new graph out) so the engine is
 * unit-testable and undo is a free history stack.
 */

export type DesignObjectType = "background" | "section" | "overlay" | "text";

/** Top-left-origin bounding box, fractions of the artboard (0–1). */
export interface PctBox {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface DesignObject {
  /** Stable unique id, e.g. obj_lk3f9a_x7q2 */
  id: string;
  type: DesignObjectType;
  name: string;
  /** Background: full-frame image URL. Foreground: transparent PNG URL. */
  sourceUrl: string;
  box: PctBox;
  /** Stacking order — background is always lowest, rendered in ascending z. */
  z: number;
  visible: boolean;
  rotationDeg?: number;
}

export interface ObjectGraph {
  /** Which render view this graph composes (side, front, roof, ...) */
  viewKey: string;
  /** Active layers, any order — render sorts by z. Exactly one background. */
  objects: DesignObject[];
  /** Removed-objects bin so any deletion is instantly restorable. */
  removed: DesignObject[];
}

export function makeObjectId(prefix = "obj"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createGraph(viewKey: string, backgroundUrl: string): ObjectGraph {
  return {
    viewKey,
    objects: [
      {
        id: makeObjectId("bg"),
        type: "background",
        name: "Background Panel",
        sourceUrl: backgroundUrl,
        box: { xPct: 0, yPct: 0, wPct: 1, hPct: 1 },
        z: 0,
        visible: true,
      },
    ],
    removed: [],
  };
}

export function getBackground(graph: ObjectGraph): DesignObject | undefined {
  return graph.objects.find((o) => o.type === "background");
}

/** Foreground objects in render order (ascending z). */
export function getForegroundObjects(graph: ObjectGraph): DesignObject[] {
  return graph.objects
    .filter((o) => o.type !== "background")
    .sort((a, b) => a.z - b.z);
}

export function addObject(
  graph: ObjectGraph,
  obj: Omit<DesignObject, "id" | "z" | "visible"> & Partial<Pick<DesignObject, "id" | "z" | "visible">>,
): ObjectGraph {
  const maxZ = graph.objects.reduce((m, o) => Math.max(m, o.z), 0);
  const full: DesignObject = {
    id: obj.id ?? makeObjectId(),
    z: obj.z ?? maxZ + 1,
    visible: obj.visible ?? true,
    ...{ type: obj.type, name: obj.name, sourceUrl: obj.sourceUrl, box: obj.box, rotationDeg: obj.rotationDeg },
  };
  return { ...graph, objects: [...graph.objects, full] };
}

/**
 * Instant deletion: purge the object ID from the active array and park it in
 * the removed bin. The background panel cannot be removed — it is the floor
 * everything re-renders from.
 */
export function removeObjectById(graph: ObjectGraph, id: string): ObjectGraph {
  const target = graph.objects.find((o) => o.id === id);
  if (!target || target.type === "background") return graph;
  return {
    ...graph,
    objects: graph.objects.filter((o) => o.id !== id),
    removed: [...graph.removed, target],
  };
}

/** Point-in-box hit test, topmost (highest z) foreground object wins. */
export function hitTest(graph: ObjectGraph, xPct: number, yPct: number): DesignObject | null {
  const candidates = getForegroundObjects(graph)
    .filter((o) => o.visible)
    .filter(
      (o) =>
        xPct >= o.box.xPct &&
        xPct <= o.box.xPct + o.box.wPct &&
        yPct >= o.box.yPct &&
        yPct <= o.box.yPct + o.box.hPct,
    );
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

/**
 * Coordinate-driven removal: map the click/selection point to the object ID
 * occupying those coordinates and purge it. Returns the same graph when the
 * point hits only background (nothing to delete — and no pixel guessing).
 */
export function removeObjectAt(graph: ObjectGraph, xPct: number, yPct: number): { graph: ObjectGraph; removed: DesignObject | null } {
  const hit = hitTest(graph, xPct, yPct);
  if (!hit) return { graph, removed: null };
  return { graph: removeObjectById(graph, hit.id), removed: hit };
}

/** Restore a previously removed object back into the active array. */
export function restoreObject(graph: ObjectGraph, id: string): ObjectGraph {
  const target = graph.removed.find((o) => o.id === id);
  if (!target) return graph;
  const maxZ = graph.objects.reduce((m, o) => Math.max(m, o.z), 0);
  return {
    ...graph,
    objects: [...graph.objects, { ...target, z: maxZ + 1 }],
    removed: graph.removed.filter((o) => o.id !== id),
  };
}

export function setObjectVisibility(graph: ObjectGraph, id: string, visible: boolean): ObjectGraph {
  return {
    ...graph,
    objects: graph.objects.map((o) => (o.id === id ? { ...o, visible } : o)),
  };
}

export function moveObject(graph: ObjectGraph, id: string, box: PctBox): ObjectGraph {
  return {
    ...graph,
    objects: graph.objects.map((o) =>
      o.id === id && o.type !== "background" ? { ...o, box } : o,
    ),
  };
}

/** JSON-safe snapshot (persistable to admin_notes or a table later). */
export function serializeGraph(graph: ObjectGraph): string {
  return JSON.stringify(graph);
}

export function deserializeGraph(json: string): ObjectGraph | null {
  try {
    const g = JSON.parse(json);
    if (!g || !Array.isArray(g.objects)) return null;
    return { viewKey: g.viewKey || "side", objects: g.objects, removed: g.removed || [] };
  } catch {
    return null;
  }
}
