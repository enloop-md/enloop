import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  DataStore,
  EnvironmentsFile,
  FreeRun,
  SuiteSummary,
  TestCaseMeta,
} from "@tcm/shared";
import { describeError } from "../../lib/errors.js";
import { FsaDataStore } from "../../lib/fsa-store.js";
import {
  addFsaStorage,
  getHandle,
  listStorages,
  migrateLegacyStorage,
  permissionOf,
  removeStorage as forgetStorage,
  renameStorage as relabelStorage,
  requestAccess,
  type StorageStatus,
} from "../../lib/storage-registry.js";
import { WorkspaceStore, type DegradedStorage } from "../../lib/workspace-store.js";

/**
 * Mounts every connected storage and hands the screens one store over all of
 * them.
 *
 * The panel no longer gates on permission. A `FileSystemDirectoryHandle`
 * lapses whenever Chrome restarts, and it does so *per handle* — with several
 * connected, "everything is blocked until you re-grant" would mean one stale
 * folder hiding three working ones. So a storage at `prompt` is registered but
 * not mounted: it shows up in the Library with a Reconnect button and
 * contributes no cases until it is granted. The Connect screen is now only for
 * the case of having no storages at all.
 */

type WorkspaceState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready" }
  | { status: "error"; message: string };

interface DataStoreContextValue {
  store: WorkspaceStore | null;
  state: WorkspaceState;
  storages: StorageStatus[];
  degraded: DegradedStorage[];
  defaultStorageId: string | null;
  setDefaultStorageId: (id: string) => void;
  addStorage: () => Promise<void>;
  removeStorage: (id: string) => Promise<void>;
  renameStorage: (id: string, label: string) => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const DataStoreContext = createContext<DataStoreContextValue | null>(null);

export const DEFAULT_STORAGE_KEY = "enloop:default-storage";

export async function loadDefaultStorageId(): Promise<string | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(DEFAULT_STORAGE_KEY);
      const val = stored[DEFAULT_STORAGE_KEY];
      if (typeof val === "string") return val;

      if (typeof localStorage !== "undefined") {
        const legacy = localStorage.getItem(DEFAULT_STORAGE_KEY);
        if (legacy) {
          await chrome.storage.local.set({ [DEFAULT_STORAGE_KEY]: legacy });
          localStorage.removeItem(DEFAULT_STORAGE_KEY);
          return legacy;
        }
      }
      return null;
    }
  } catch {
    // Fall back to localStorage if chrome.storage is unavailable
  }

  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(DEFAULT_STORAGE_KEY);
  }
  return null;
}

export async function persistDefaultStorageId(id: string): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [DEFAULT_STORAGE_KEY]: id });
      return;
    }
  } catch {
    // Fall back to localStorage
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEFAULT_STORAGE_KEY, id);
  }
}

/** How often the open panel marks itself alive in each connected folder's
 * `agent/heartbeat.json`. The serve skill treats 5 minutes of silence as
 * "the extension was closed" — comfortably more than a panel remount, which
 * happens on every click into the page under test. */
const HEARTBEAT_INTERVAL_MS = 20_000;

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });
  const [storages, setStorages] = useState<StorageStatus[]>([]);
  const [degraded, setDegraded] = useState<DegradedStorage[]>([]);
  const [stores, setStores] = useState<Map<string, DataStore>>(new Map());
  const [defaultStorageId, setDefaultId] = useState<string | null>(null);

  /** Re-reads the registry and rebuilds the mounted children. Called on boot
   * and after anything that changes what is connected. */
  const refresh = useCallback(async () => {
    const entries = await listStorages();
    if (entries.length === 0) {
      setStorages([]);
      setStores(new Map());
      setState({ status: "empty" });
      return;
    }

    const statuses: StorageStatus[] = [];
    const mounted = new Map<string, DataStore>();
    for (const entry of entries) {
      const handle = await getHandle(entry.id);
      const permission = await permissionOf(entry.id);
      statuses.push({ ...entry, permission, folderName: handle?.name ?? "—" });
      if (handle && permission === "granted") mounted.set(entry.id, new FsaDataStore(handle));
    }

    setStorages(statuses);
    setStores(mounted);
    setState({ status: "ready" });
  }, []);

  useEffect(() => {
    (async () => {
      await migrateLegacyStorage();
      const saved = await loadDefaultStorageId();
      if (saved) setDefaultId(saved);
      await refresh();
    })().catch((e) => setState({ status: "error", message: describeError(e) }));
  }, [refresh]);

  const store = useMemo(() => {
    if (stores.size === 0) return null;
    return new WorkspaceStore(stores, setDegraded, defaultStorageId);
  }, [stores, defaultStorageId]);

  // "The panel is open" is a fact only the panel can state, and the agent
  // session watching a data folder kills the scripts it spawned once this
  // goes quiet. Touched at panel level rather than per screen so a server
  // started from a run survives the tester browsing the Library. Only
  // folders that already have an `agent/` dir are touched (the store
  // self-gates), so unused folders see no 20-second write churn.
  useEffect(() => {
    if (!store) return;
    void store.touchHeartbeat();
    const timer = setInterval(() => void store.touchHeartbeat(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [store]);

  const setDefaultStorageId = useCallback((id: string) => {
    void persistDefaultStorageId(id);
    setDefaultId(id);
  }, []);

  const addStorage = useCallback(async () => {
    try {
      const entry = await addFsaStorage();
      setDefaultStorageId(entry.id);
      await refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState({ status: "error", message: describeError(e) });
    }
  }, [refresh, setDefaultStorageId]);

  const removeStorage = useCallback(
    async (id: string) => {
      await forgetStorage(id);
      await refresh();
    },
    [refresh],
  );

  const renameStorage = useCallback(
    async (id: string, label: string) => {
      await relabelStorage(id, label);
      await refresh();
    },
    [refresh],
  );

  const reconnect = useCallback(
    async (id: string) => {
      try {
        await requestAccess(id);
      } finally {
        // Re-read either way: a refused prompt should still update the row.
        await refresh();
      }
    },
    [refresh],
  );

  const contextValue = useMemo<DataStoreContextValue>(
    () => ({
      store,
      state,
      storages,
      degraded,
      defaultStorageId,
      setDefaultStorageId,
      addStorage,
      removeStorage,
      renameStorage,
      reconnect,
      refresh,
    }),
    [
      store,
      state,
      storages,
      degraded,
      defaultStorageId,
      setDefaultStorageId,
      addStorage,
      removeStorage,
      renameStorage,
      reconnect,
      refresh,
    ],
  );

  return (
    <DataStoreContext.Provider value={contextValue}>
      {children}
    </DataStoreContext.Provider>
  );
}

export function useDataStore(): DataStoreContextValue {
  const ctx = useContext(DataStoreContext);
  if (!ctx) throw new Error("useDataStore must be used within DataStoreProvider");
  return ctx;
}

/** For screens only ever rendered once at least one storage is mounted. */
export function useReadyStore(): DataStore {
  const { store } = useDataStore();
  if (!store) throw new Error("useReadyStore called before a storage was connected");
  return store;
}

/**
 * For the handful of screens that must know storages exist: the Library
 * (grouping and filtering), Settings (managing them), and the three creation
 * screens (choosing where a new thing lands). Nothing else should import this.
 */
export interface WorkspaceValue {
  storages: StorageStatus[];
  degraded: DegradedStorage[];
  defaultStorageId: string | null;
  setDefaultStorageId: (id: string) => void;
  addStorage: () => Promise<void>;
  removeStorage: (id: string) => Promise<void>;
  renameStorage: (id: string, label: string) => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  createTestCaseIn: (storageId: string, body: string, suiteId?: string) => Promise<TestCaseMeta>;
  createSuiteIn: (storageId: string, body: string) => Promise<SuiteSummary>;
  createFreeRunIn: (storageId: string, title: string) => Promise<FreeRun>;
  getEnvironmentsIn: (storageId: string) => Promise<EnvironmentsFile>;
  saveEnvironmentsIn: (storageId: string, file: EnvironmentsFile) => Promise<void>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useDataStore();
  const store = ctx.store;

  const createTestCaseIn = useCallback(
    (storageId: string, body: string, suiteId?: string) => {
      if (!store) throw new Error("No storage connected");
      return store.createTestCaseIn(storageId, body, suiteId);
    },
    [store],
  );

  const createSuiteIn = useCallback(
    (storageId: string, body: string) => {
      if (!store) throw new Error("No storage connected");
      return store.createSuiteIn(storageId, body);
    },
    [store],
  );

  const createFreeRunIn = useCallback(
    (storageId: string, title: string) => {
      if (!store) throw new Error("No storage connected");
      return store.createFreeRunIn(storageId, title);
    },
    [store],
  );

  const getEnvironmentsIn = useCallback(
    (storageId: string) => {
      if (!store) throw new Error("No storage connected");
      return store.getEnvironmentsIn(storageId);
    },
    [store],
  );

  const saveEnvironmentsIn = useCallback(
    (storageId: string, file: EnvironmentsFile) => {
      if (!store) throw new Error("No storage connected");
      return store.saveEnvironmentsIn(storageId, file);
    },
    [store],
  );

  return useMemo<WorkspaceValue>(
    () => ({
      storages: ctx.storages,
      degraded: ctx.degraded,
      defaultStorageId: ctx.defaultStorageId,
      setDefaultStorageId: ctx.setDefaultStorageId,
      addStorage: ctx.addStorage,
      removeStorage: ctx.removeStorage,
      renameStorage: ctx.renameStorage,
      reconnect: ctx.reconnect,
      createTestCaseIn,
      createSuiteIn,
      createFreeRunIn,
      getEnvironmentsIn,
      saveEnvironmentsIn,
    }),
    [
      ctx.storages,
      ctx.degraded,
      ctx.defaultStorageId,
      ctx.setDefaultStorageId,
      ctx.addStorage,
      ctx.removeStorage,
      ctx.renameStorage,
      ctx.reconnect,
      createTestCaseIn,
      createSuiteIn,
      createFreeRunIn,
      getEnvironmentsIn,
      saveEnvironmentsIn,
    ],
  );
}
