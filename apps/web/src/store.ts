import { create } from 'zustand';
import type { Scene, Working, Issue } from './types';
import { clone, normalize } from './scene';
interface State {
  scene: Scene | null;
  revision: number;
  baseDesignId: string | null;
  projectId: string | null;
  selected: string | null;
  selectedIds: string[];
  multiSelect: boolean;
  roomId: string | null;
  floorId: string | null;
  dirty: boolean;
  past: Scene[];
  future: Scene[];
  issues: Issue[];
  status: string;
  load: (pid: string, w: Working) => void;
  change: (fn: (s: Scene) => void) => void;
  replace: (s: Scene, baseDesignId?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  toggleMulti: () => void;
  selectRoom: (id: string) => void;
  selectFloor: (id: string) => void;
  saved: (w: Working, source: Scene) => void;
  setIssues: (i: Issue[]) => void;
  setStatus: (s: string) => void;
}
export const useScene = create<State>((set, get) => ({
  scene: null,
  revision: 0,
  baseDesignId: null,
  projectId: null,
  selected: null,
  selectedIds: [],
  multiSelect: false,
  roomId: null,
  floorId: null,
  dirty: false,
  past: [],
  future: [],
  issues: [],
  status: '已保存',
  load: (projectId, w) =>
    set({
      projectId,
      scene: w.scene,
      revision: w.revision,
      baseDesignId: w.baseDesignId,
      selected: null,
      selectedIds: [],
      roomId: w.scene.floors[0].rooms[0]?.id,
      floorId: w.scene.floors[0].id,
      dirty: false,
      past: [],
      future: [],
      issues: [],
      status: '已保存',
    }),
  change: (fn) => {
    const state = get();
    if (!state.scene) return;
    const next = clone(state.scene);
    fn(next);
    if (
      JSON.stringify([
        next.floors,
        next.layout.furniture,
        next.layout.catalogSnapshot,
        next.layout.preferences,
      ]) !==
      JSON.stringify([
        state.scene.floors,
        state.scene.layout.furniture,
        state.scene.layout.catalogSnapshot,
        state.scene.layout.preferences,
      ])
    )
      delete next.layout.analysis;
    set({
      scene: normalize(next),
      past: [...state.past, state.scene].slice(-50),
      future: [],
      dirty: true,
      status: '待保存',
      issues: [],
    });
  },
  replace: (scene, baseDesignId) => {
    const st = get();
    set({
      scene: clone(scene),
      baseDesignId: baseDesignId ?? st.baseDesignId,
      past: st.scene ? [...st.past, st.scene].slice(-50) : [],
      future: [],
      dirty: true,
      status: '待保存',
      selected: null,
      selectedIds: [],
      issues: [],
      floorId: scene.floors.some((f) => f.id === st.floorId) ? st.floorId : scene.floors[0].id,
      roomId: scene.floors.flatMap((f) => f.rooms).some((r) => r.id === st.roomId)
        ? st.roomId
        : scene.floors[0].rooms[0].id,
    });
  },
  undo: () => {
    const st = get();
    if (!st.past.length || !st.scene) return;
    set({
      scene: st.past.at(-1),
      past: st.past.slice(0, -1),
      future: [st.scene, ...st.future],
      dirty: true,
      status: '待保存',
      issues: [],
    });
  },
  redo: () => {
    const st = get();
    if (!st.future.length || !st.scene) return;
    set({
      scene: st.future[0],
      future: st.future.slice(1),
      past: [...st.past, st.scene],
      dirty: true,
      status: '待保存',
      issues: [],
    });
  },
  select: (selected, additive = false) =>
    set((st) => {
      const floor =
        st.scene?.floors.find((f) =>
          [...f.rooms, ...f.walls, ...f.openings, ...f.obstacles].some((o) => o.id === selected),
        ) ||
        st.scene?.floors.find((f) =>
          st.scene?.layout.furniture.some((o) => o.id === selected && o.floorId === f.id),
        );
      const isFurniture = st.scene?.layout.furniture.some((f) => f.id === selected);
      const keep = (additive || st.multiSelect) && floor?.id === st.floorId;
      const ids =
        !selected || !isFurniture
          ? []
          : keep
            ? st.selectedIds.includes(selected)
              ? st.selectedIds.filter((i) => i !== selected)
              : [...st.selectedIds, selected]
            : [selected];
      return {
        selected: isFurniture ? ids.at(-1) || null : selected,
        selectedIds: ids,
        ...(floor ? { floorId: floor.id } : {}),
      };
    }),
  selectMany: (selectedIds) => set({ selectedIds, selected: selectedIds.at(-1) || null }),
  toggleMulti: () => set((st) => ({ multiSelect: !st.multiSelect })),
  selectRoom: (roomId) =>
    set((st) => ({
      roomId,
      selected: null,
      selectedIds: [],
      floorId: st.scene?.floors.find((f) => f.rooms.some((r) => r.id === roomId))?.id || st.floorId,
    })),
  selectFloor: (floorId) =>
    set((st) => ({
      floorId,
      selected: null,
      selectedIds: [],
      roomId: st.scene?.floors.find((f) => f.id === floorId)?.rooms[0]?.id || null,
    })),
  saved: (w, source) =>
    set((st) => ({
      revision: w.revision,
      baseDesignId: w.baseDesignId,
      scene: st.scene === source ? w.scene : st.scene,
      dirty: st.scene !== source,
      status: st.scene === source ? '已保存' : '待保存',
    })),
  setIssues: (issues) => set({ issues }),
  setStatus: (status) => set({ status }),
}));
