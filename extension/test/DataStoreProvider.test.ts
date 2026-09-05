import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_STORAGE_KEY,
  loadDefaultStorageId,
  persistDefaultStorageId,
} from "../src/sidepanel/store/DataStoreProvider.js";

describe("DataStoreProvider - Default storage persistence and migration (#22)", () => {
  let mockLocalStorage: Record<string, string> = {};
  let mockChromeStorage: Record<string, unknown> = {};

  beforeEach(() => {
    mockLocalStorage = {};
    mockChromeStorage = {};

    (globalThis as any).localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockLocalStorage[key] = String(val);
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
    };

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string) => ({
            [key]: mockChromeStorage[key],
          })),
          set: vi.fn().mockImplementation(async (obj: Record<string, unknown>) => {
            Object.assign(mockChromeStorage, obj);
          }),
        },
      },
    };
  });

  it("reads defaultStorageId from chrome.storage.local when present", async () => {
    mockChromeStorage[DEFAULT_STORAGE_KEY] = "store-chrome-123";

    const id = await loadDefaultStorageId();
    expect(id).toBe("store-chrome-123");
    expect(mockLocalStorage[DEFAULT_STORAGE_KEY]).toBeUndefined();
  });

  it("migrates defaultStorageId from localStorage to chrome.storage.local and removes legacy key", async () => {
    mockLocalStorage[DEFAULT_STORAGE_KEY] = "store-legacy-456";

    const id = await loadDefaultStorageId();
    expect(id).toBe("store-legacy-456");
    expect(mockChromeStorage[DEFAULT_STORAGE_KEY]).toBe("store-legacy-456");
    expect(mockLocalStorage[DEFAULT_STORAGE_KEY]).toBeUndefined();
  });

  it("returns null when no defaultStorageId is set in either store", async () => {
    const id = await loadDefaultStorageId();
    expect(id).toBeNull();
  });

  it("persists defaultStorageId directly to chrome.storage.local", async () => {
    await persistDefaultStorageId("store-new-789");
    expect(mockChromeStorage[DEFAULT_STORAGE_KEY]).toBe("store-new-789");
  });

  it("falls back to localStorage when chrome.storage.local is unavailable", async () => {
    (globalThis as any).chrome = undefined;
    mockLocalStorage[DEFAULT_STORAGE_KEY] = "store-fallback-111";

    const id = await loadDefaultStorageId();
    expect(id).toBe("store-fallback-111");

    await persistDefaultStorageId("store-fallback-222");
    expect(mockLocalStorage[DEFAULT_STORAGE_KEY]).toBe("store-fallback-222");
  });
});
