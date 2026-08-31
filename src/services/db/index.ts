export const DB_NAME = 'nostr-filesync';
export const DB_VERSION = 5;

export const STORE_FILES = 'files';
export const STORE_UPLOADS = 'uploads';
export const STORE_FOLDERS = 'folders';
export const STORE_TOMBSTONES = 'tombstones';
export const STORE_SYNC_QUEUE = 'sync_queue';
export const STORE_SYNC_CURSORS = 'sync_cursors';
export const STORE_DEVICES = 'devices';

export const SCHEMA_VERSION_FILES = 2;
export const SCHEMA_VERSION_UPLOADS = 1;
export const SCHEMA_VERSION_FOLDERS = 1;
export const SCHEMA_VERSION_TOMBSTONES = 1;
export const SCHEMA_VERSION_SYNC_QUEUE = 1;
export const SCHEMA_VERSION_SYNC_CURSORS = 1;
export const SCHEMA_VERSION_DEVICES = 1;

export interface FolderRecord {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface FileRecord {
  fileId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  size: number;
  contentHash: string;
  encryptedHash?: string;
  chunks: number;
  headerEventId: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  encrypted: boolean;
  compression?: string;
  path?: string;
  deduplicated?: boolean;
}

export interface TombstoneRecord {
  entityId: string;
  entityType: 'file' | 'folder';
  deletedAt: number;
  version: number;
}

export type SyncOperationType =
  | 'CREATE'
  | 'UPDATE'
  | 'MOVE'
  | 'RENAME'
  | 'DELETE'
  | 'RESTORE'
  | 'UPLOAD'
  | 'DOWNLOAD';

export type SyncOperationStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SyncOperation {
  id: string;
  type: SyncOperationType;
  entityId: string;
  entityType: 'file' | 'folder';
  payload?: unknown;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: SyncOperationStatus;
  lastError?: string;
  updatedAt: number;
}

export interface SyncCursor {
  /** ${pubkey}:${relayUrl} */
  id: string;
  pubkey: string;
  relayUrl: string;
  lastEventId: string;
  lastEventCreatedAt: number;
  updatedAt: number;
}

export type DevicePlatform = 'web' | 'android' | 'ios' | 'desktop' | 'unknown';

export interface Device {
  id: string;
  pubkey: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  lastSeen: number;
  capabilities: string[];
  isLocal: boolean;
  createdAt: number;
}

interface Migration {
  version: number;
  up: (db: IDBDatabase) => void;
}

const migrations: Migration[] = [
  {
    version: 2,
    up: (db: IDBDatabase): void => {
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
        db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'entityId' });
      }
    },
  },
  {
    version: 3,
    up: (db: IDBDatabase): void => {
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const store = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
        store.createIndex('entityId', 'entityId', { unique: false });
      }
    },
  },
  {
    version: 4,
    up: (db: IDBDatabase): void => {
      if (!db.objectStoreNames.contains(STORE_SYNC_CURSORS)) {
        const store = db.createObjectStore(STORE_SYNC_CURSORS, { keyPath: 'id' });
        store.createIndex('pubkey', 'pubkey', { unique: false });
      }
    },
  },
  {
    version: 5,
    up: (db: IDBDatabase): void => {
      if (!db.objectStoreNames.contains(STORE_DEVICES)) {
        const store = db.createObjectStore(STORE_DEVICES, { keyPath: 'id' });
        store.createIndex('pubkey', 'pubkey', { unique: false });
        store.createIndex('lastSeen', 'lastSeen', { unique: false });
      }
    },
  },
];

let dbPromise: Promise<IDBDatabase> | null = null;
let currentName = DB_NAME;

function applyMigrations(db: IDBDatabase, oldVersion: number, newVersion: number): void {
  for (const m of migrations) {
    if (m.version > oldVersion && m.version <= newVersion) {
      m.up(db);
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const name = currentName;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const dbResult = req.result;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion ?? DB_VERSION;

      if (!dbResult.objectStoreNames.contains(STORE_FILES)) {
        dbResult.createObjectStore(STORE_FILES, { keyPath: 'fileId' });
      }
      if (!dbResult.objectStoreNames.contains(STORE_UPLOADS)) {
        dbResult.createObjectStore(STORE_UPLOADS, { keyPath: 'fileId' });
      }

      applyMigrations(dbResult, oldVersion, newVersion);
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB bloqueado por outra aba'));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const s = transaction.objectStore(store);
        let result: T | undefined;
        const out = fn(s);
        if (out instanceof Promise) {
          out.then(
            (r) => {
              result = r;
            },
            reject
          );
        } else {
          out.onsuccess = () => {
            result = out.result as T;
          };
          out.onerror = () => reject(out.error);
        }
        transaction.oncomplete = () => resolve(result as T);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Transação abortada'));
      })
  );
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function put<T>(store: string, value: T): Promise<void> {
  await tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value));
}

export async function putAll<T>(store: string, values: T[]): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const s = transaction.objectStore(store);
    for (const v of values) s.put(v);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Transação abortada'));
  });
}

export async function del(store: string, key: IDBValidKey): Promise<void> {
  await tx<undefined>(store, 'readwrite', (s) => s.delete(key));
}

export async function clear(store: string): Promise<void> {
  await tx<undefined>(store, 'readwrite', (s) => s.clear());
}

export function __useIsolatedDatabaseForTesting(): void {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  currentName = `${DB_NAME}-${Math.random().toString(36).slice(2, 10)}`;
}

export function __resetForTesting(): void {
  dbPromise = null;
}

export { applyMigrations, migrations };
