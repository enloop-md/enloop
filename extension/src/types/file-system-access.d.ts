export {};

// lib.dom.d.ts ships the base File System Access API types but is missing
// the async directory iteration methods and the persisted-permission
// methods used throughout src/lib/fs-utils.ts and src/lib/root-handle.ts.
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    keys(): AsyncIterableIterator<string>;
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  interface Window {
    showDirectoryPicker(options?: {
      mode?: "read" | "readwrite";
      id?: string;
      startIn?: FileSystemDirectoryHandle | string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}
