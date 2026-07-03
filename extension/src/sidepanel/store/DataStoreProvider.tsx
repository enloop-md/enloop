import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { DataStore } from "@tcm/shared";
import { FsaDataStore } from "../../lib/fsa-store.js";
import {
  checkPermission,
  connectFolder,
  forgetFolder,
  getPersistedHandle,
  requestPermission,
} from "../../lib/root-handle.js";

type ConnectionState =
  | { status: "checking" }
  | { status: "disconnected" }
  | { status: "needs-permission"; folderName: string }
  | { status: "connected"; folderName: string }
  | { status: "error"; message: string };

interface DataStoreContextValue {
  store: DataStore | null;
  connection: ConnectionState;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const DataStoreContext = createContext<DataStoreContextValue | null>(null);

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<DataStore | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ status: "checking" });

  const activate = useCallback((handle: FileSystemDirectoryHandle) => {
    setStore(new FsaDataStore(handle));
    setConnection({ status: "connected", folderName: handle.name });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await getPersistedHandle();
      if (cancelled) return;
      if (!handle) {
        setConnection({ status: "disconnected" });
        return;
      }
      const perm = await checkPermission(handle);
      if (cancelled) return;
      if (perm === "granted") activate(handle);
      else setConnection({ status: "needs-permission", folderName: handle.name });
    })().catch((e) => {
      if (!cancelled) setConnection({ status: "error", message: String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [activate]);

  const connect = useCallback(async () => {
    try {
      const handle = await connectFolder();
      activate(handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setConnection({ status: "error", message: String(e) });
    }
  }, [activate]);

  const reconnect = useCallback(async () => {
    const handle = await getPersistedHandle();
    if (!handle) {
      await connect();
      return;
    }
    try {
      const granted = await requestPermission(handle);
      if (granted) activate(handle);
      else setConnection({ status: "needs-permission", folderName: handle.name });
    } catch (e) {
      setConnection({ status: "error", message: String(e) });
    }
  }, [activate, connect]);

  const disconnect = useCallback(async () => {
    await forgetFolder();
    setStore(null);
    setConnection({ status: "disconnected" });
  }, []);

  return (
    <DataStoreContext.Provider value={{ store, connection, connect, reconnect, disconnect }}>
      {children}
    </DataStoreContext.Provider>
  );
}

export function useDataStore(): DataStoreContextValue {
  const ctx = useContext(DataStoreContext);
  if (!ctx) throw new Error("useDataStore must be used within DataStoreProvider");
  return ctx;
}

/** For screens only ever rendered once connection.status === "connected". */
export function useReadyStore(): DataStore {
  const { store } = useDataStore();
  if (!store) throw new Error("useReadyStore called before a data folder was connected");
  return store;
}
