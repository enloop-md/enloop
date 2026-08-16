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

const DEFAULT_STORAGE_KEY = "enloop:default-storage";

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
      const saved = localStorage.getItem(DEFAULT_STORAGE_KEY);
      if (saved) setDefaultId(saved);
      await refresh();
    })().catch((e) => setState({ status: "error", message: describeError(e) }));
  }, [refresh]);

  const store = useMemo(() => {
    if (stores.size === 0) return null;
    return new WorkspaceStore(stores, setDegraded, defaultStorageId);
  }, [stores, defaultStorageId]);

  const setDefaultStorageId = useCallback((id: string) => {
    localStorage.setItem(DEFAULT_STORAGE_KEY, id);
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

  return (
    <DataStoreContext.Provider
      value={{
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
      }}
    >
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
  return {
    storages: ctx.storages,
    degraded: ctx.degraded,
    defaultStorageId: ctx.defaultStorageId,
    setDefaultStorageId: ctx.setDefaultStorageId,
    addStorage: ctx.addStorage,
    removeStorage: ctx.removeStorage,
    renameStorage: ctx.renameStorage,
    reconnect: ctx.reconnect,
    createTestCaseIn: (storageId, body, suiteId) => {
      if (!store) throw new Error("No storage connected");
      return store.createTestCaseIn(storageId, body, suiteId);
    },
    createSuiteIn: (storageId, body) => {
      if (!store) throw new Error("No storage connected");
      return store.createSuiteIn(storageId, body);
    },
    createFreeRunIn: (storageId, title) => {
      if (!store) throw new Error("No storage connected");
      return store.createFreeRunIn(storageId, title);
    },
    getEnvironmentsIn: (storageId) => {
      if (!store) throw new Error("No storage connected");
      return store.getEnvironmentsIn(storageId);
    },
    saveEnvironmentsIn: (storageId, file) => {
      if (!store) throw new Error("No storage connected");
      return store.saveEnvironmentsIn(storageId, file);
    },
  };
}
