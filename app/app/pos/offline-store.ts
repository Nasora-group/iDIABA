export type OfflineProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sale_price: string | number;
  tax_rate: string | number;
};

export type OfflineSnapshot = {
  key: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  locationId: string;
  locationName: string;
  sessionId: string;
  products: OfflineProduct[];
  savedAt: number;
};

export type OfflineSale = {
  id: string;
  userId: string;
  tenantId: string;
  locationId: string;
  sessionId: string;
  items: { product_id: string; quantity: string }[];
  payments: { method: string; amount: string }[];
  createdAt: number;
};

const DB_NAME = "idiaba-offline";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const QUEUE = "sales";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Le stockage hors connexion n'est pas disponible sur ce navigateur."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Impossible d'ouvrir le stockage local."));
  });
}

function transact<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    run(transaction.objectStore(storeName), resolve, reject);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Opération locale annulée.")); };
  }));
}

export function saveOfflineSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  return transact<void>(SNAPSHOTS, "readwrite", (store, resolve, reject) => {
    const request = store.put(snapshot);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function loadOfflineSnapshots(userId: string): Promise<OfflineSnapshot[]> {
  return transact<OfflineSnapshot[]>(SNAPSHOTS, "readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as OfflineSnapshot[]).filter((item) => item.userId === userId));
    request.onerror = () => reject(request.error);
  });
}

export function enqueueOfflineSale(sale: OfflineSale): Promise<void> {
  return transact<void>(QUEUE, "readwrite", (store, resolve, reject) => {
    const request = store.add(sale);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function loadOfflineSales(userId: string): Promise<OfflineSale[]> {
  return transact<OfflineSale[]>(QUEUE, "readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as OfflineSale[])
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

export function removeOfflineSale(id: string): Promise<void> {
  return transact<void>(QUEUE, "readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
