/**
 * DesignPro v2 — React binding for the object-graph state machine.
 *
 * Thin wrapper: every mutation goes through the pure functions in
 * objectGraph.ts and pushes the previous state onto a history stack, so undo
 * is a single pop. No image processing happens here or anywhere downstream.
 */
import { useCallback, useRef, useState } from "react";
import {
  type DesignObject,
  type ObjectGraph,
  type PctBox,
  moveObject,
  removeObjectAt,
  removeObjectById,
  restoreObject,
  setObjectVisibility,
} from "./objectGraph";

export function useObjectGraph(initial: ObjectGraph | null) {
  const [graph, setGraph] = useState<ObjectGraph | null>(initial);
  const historyRef = useRef<ObjectGraph[]>([]);

  const apply = useCallback(
    (next: (g: ObjectGraph) => ObjectGraph) => {
      setGraph((g) => {
        if (!g) return g;
        const updated = next(g);
        if (updated !== g) historyRef.current.push(g);
        return updated;
      });
    },
    [],
  );

  const reset = useCallback((g: ObjectGraph | null) => {
    historyRef.current = [];
    setGraph(g);
  }, []);

  const removeById = useCallback((id: string) => apply((g) => removeObjectById(g, id)), [apply]);

  const removeAt = useCallback(
    (xPct: number, yPct: number): DesignObject | null => {
      let removed: DesignObject | null = null;
      setGraph((g) => {
        if (!g) return g;
        const result = removeObjectAt(g, xPct, yPct);
        removed = result.removed;
        if (result.graph !== g) historyRef.current.push(g);
        return result.graph;
      });
      return removed;
    },
    [],
  );

  const restore = useCallback((id: string) => apply((g) => restoreObject(g, id)), [apply]);

  const setVisibility = useCallback(
    (id: string, visible: boolean) => apply((g) => setObjectVisibility(g, id, visible)),
    [apply],
  );

  const move = useCallback((id: string, box: PctBox) => apply((g) => moveObject(g, id, box)), [apply]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev) setGraph(prev);
  }, []);

  return {
    graph,
    reset,
    removeById,
    removeAt,
    restore,
    setVisibility,
    move,
    undo,
    canUndo: historyRef.current.length > 0,
  };
}
