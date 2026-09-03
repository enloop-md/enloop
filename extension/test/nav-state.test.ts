import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HOME,
  isScreen,
  withoutDeadDrafts,
  loadNavStack,
  saveNavStack,
  clearNavStack,
  type Screen,
} from "../src/lib/nav-state.js";

describe("nav-state", () => {
  describe("isScreen runtime guard (#16)", () => {
    it("recognizes environments screen with valid storageId", () => {
      const screen = { kind: "environments", storageId: "local-storage-1" };
      expect(isScreen(screen)).toBe(true);
    });

    it("rejects environments screen when storageId is missing or invalid", () => {
      expect(isScreen({ kind: "environments" })).toBe(false);
      expect(isScreen({ kind: "environments", storageId: 123 })).toBe(false);
      expect(isScreen({ kind: "environments", storageId: null })).toBe(false);
    });

    it("recognizes all standard screen kinds", () => {
      expect(isScreen({ kind: "library" })).toBe(true);
      expect(isScreen({ kind: "settings" })).toBe(true);
      expect(isScreen({ kind: "caseDetail", testCaseId: "tc-1" })).toBe(true);
      expect(isScreen({ kind: "editor" })).toBe(true);
      expect(isScreen({ kind: "editor", testCaseId: "tc-1", suiteId: "s-1" })).toBe(true);
      expect(isScreen({ kind: "suiteDetail", suiteId: "s-1" })).toBe(true);
      expect(isScreen({ kind: "suiteEditor" })).toBe(true);
      expect(isScreen({ kind: "suiteEditor", suiteId: "s-1" })).toBe(true);
      expect(isScreen({ kind: "run", testCaseId: "tc-1", runId: "r-1" })).toBe(true);
      expect(isScreen({ kind: "freeRun", freeRunId: "fr-1" })).toBe(true);
      expect(isScreen({ kind: "history" })).toBe(true);
      expect(isScreen({ kind: "history", testCaseId: "tc-1" })).toBe(true);
    });

    it("rejects invalid screens", () => {
      expect(isScreen(null)).toBe(false);
      expect(isScreen(undefined)).toBe(false);
      expect(isScreen("library")).toBe(false);
      expect(isScreen({})).toBe(false);
      expect(isScreen({ kind: "unknownScreen" })).toBe(false);
      expect(isScreen({ kind: "caseDetail" })).toBe(false);
      expect(isScreen({ kind: "run", testCaseId: "tc-1" })).toBe(false);
    });
  });

  describe("withoutDeadDrafts", () => {
    it("preserves stack when top is environments screen", () => {
      const stack: Screen[] = [
        HOME,
        { kind: "settings" },
        { kind: "environments", storageId: "store-abc" },
      ];
      expect(withoutDeadDrafts(stack)).toEqual(stack);
    });

    it("trims trailing editor drafts while retaining non-editor base", () => {
      const stack: Screen[] = [
        HOME,
        { kind: "settings" },
        { kind: "environments", storageId: "store-abc" },
        { kind: "editor" },
      ];
      expect(withoutDeadDrafts(stack)).toEqual([
        HOME,
        { kind: "settings" },
        { kind: "environments", storageId: "store-abc" },
      ]);
    });
  });

  describe("loadNavStack and saveNavStack with environments screen (#16)", () => {
    let mockSessionStorage: Record<string, unknown> = {};

    beforeEach(() => {
      mockSessionStorage = {};
      (globalThis as any).chrome = {
        windows: {
          getCurrent: vi.fn().mockResolvedValue({ id: 42 }),
        },
        storage: {
          session: {
            get: vi.fn().mockImplementation(async (key: string) => ({
              [key]: mockSessionStorage[key],
            })),
            set: vi.fn().mockImplementation(async (obj: Record<string, unknown>) => {
              Object.assign(mockSessionStorage, obj);
            }),
            remove: vi.fn().mockImplementation(async (key: string) => {
              delete mockSessionStorage[key];
            }),
          },
        },
      };
    });

    it("saves and restores navigation stack containing environments screen", async () => {
      const stack: Screen[] = [
        { kind: "run", testCaseId: "tc-1", runId: "r-1" },
        { kind: "settings" },
        { kind: "environments", storageId: "default-storage" },
      ];

      await saveNavStack(stack);
      const restored = await loadNavStack();

      expect(restored).toEqual(stack);
    });

    it("returns null when stack data is missing or corrupted", async () => {
      expect(await loadNavStack()).toBeNull();

      mockSessionStorage["nav:42"] = [{ kind: "invalid-screen-shape" }];
      expect(await loadNavStack()).toBeNull();
    });

    it("clears the session navigation stack", async () => {
      await saveNavStack([HOME, { kind: "settings" }]);
      await clearNavStack();
      expect(await loadNavStack()).toBeNull();
    });
  });
});
