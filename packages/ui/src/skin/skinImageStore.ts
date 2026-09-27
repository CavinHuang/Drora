const DATABASE_NAME = "drora-skin-assets";
const STORE_NAME = "wallpapers";
const CURRENT_IMAGE_KEY = "current";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open skin image storage"));
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result!: T;
    operation(store, (value) => {
      result = value;
    });
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Skin image storage failed"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Skin image storage was aborted"));
    };
  });
}

export async function saveWallpaper(file: File): Promise<void> {
  await runTransaction<void>("readwrite", (store, done) => {
    store.put(file, CURRENT_IMAGE_KEY);
    done(undefined);
  });
}

export async function loadWallpaper(): Promise<Blob | null> {
  return runTransaction<Blob | null>("readonly", (store, done) => {
    const request = store.get(CURRENT_IMAGE_KEY);
    request.onsuccess = () => done(request.result instanceof Blob ? request.result : null);
  });
}

export async function deleteWallpaper(): Promise<void> {
  await runTransaction<void>("readwrite", (store, done) => {
    store.delete(CURRENT_IMAGE_KEY);
    done(undefined);
  });
}

export async function decodeWallpaper(file: File): Promise<void> {
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(file);
    try {
      if (image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192) {
        throw new Error("Wallpaper dimensions are unsupported");
      }
    } finally {
      image.close();
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      image.width > 0 && image.height > 0 && image.width <= 8192 && image.height <= 8192
        ? resolve()
        : reject(new Error("Wallpaper dimensions are unsupported"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Wallpaper could not be decoded"));
    };
    image.src = url;
  });
}
