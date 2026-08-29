const DB_NAME = 'nostr-filesync';
const DB_VERSION = 1;
export const STORE_FILES = 'files';
export const STORE_UPLOADS = 'uploads';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'fileId' });
      }
      if (!db.objectStoreNames.contains(STORE_UPLOADS)) {
        db.createObjectStore(STORE_UPLOADS, { keyPath: 'fileId' });
      }
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
          out.then((r) => {
            result = r;
          }, reject);
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
  await new Promise<void>((resolve, reject) => {
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