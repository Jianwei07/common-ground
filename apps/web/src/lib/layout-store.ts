"use client";

import { create } from "zustand";

export type FocusPane = "canvas" | "editor" | null;

type LayoutState = {
  focus: FocusPane;
  outputOpen: boolean;
  split: number;
  treeOpen: boolean;
  setFocus: (focus: FocusPane) => void;
  setOutputOpen: (open: boolean) => void;
  setSplit: (split: number) => void;
  setTreeOpen: (open: boolean) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
  focus: null,
  outputOpen: true,
  split: 52,
  treeOpen: true,
  setFocus: (focus) => set({ focus }),
  setOutputOpen: (outputOpen) => set({ outputOpen }),
  setSplit: (split) => set({ split: Math.min(75, Math.max(25, split)) }),
  setTreeOpen: (treeOpen) => set({ treeOpen }),
}));
