// Offline Manager - IndexedDB caching, draft saving, render queueing
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface RestyleProDB extends DBSchema {
  cache: {
    key: string;
    value: any;
  };
  drafts: {
    key: string;
    value: {
      id: string;
      tool: string;
      data: any;
      updatedAt: number;
    };
  };
  renderQueue: {
    key: number;
    value: {
      id: number;
      payload: any;
      queuedAt: number;
    };
    autoIncrement: true;
  };
}

let dbInstance: IDBPDatabase<RestyleProDB> | null = null;

async function getDB(): Promise<IDBPDatabase<RestyleProDB>> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB<RestyleProDB>('restylepro-offline', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts');
      }
      if (!db.objectStoreNames.contains('renderQueue')) {
        db.createObjectStore('renderQueue', { 
          autoIncrement: true 
        });
      }
    },
  });
  
  return dbInstance;
}

// ============= OFFLINE STATUS =============
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

// ============= CACHE OPERATIONS =============
export async function cacheSet(key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    await db.put('cache', value, key);
  } catch (e) {
    console.warn('Cache set failed:', e);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    const result = await db.get('cache', key);
    return (result as T) ?? null;
  } catch (e) {
    console.warn('Cache get failed:', e);
    return null;
  }
}

export async function cacheClear(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear('cache');
  } catch (e) {
    console.warn('Cache clear failed:', e);
  }
}

// ============= DRAFT OPERATIONS =============
export async function saveDraft(
  draftId: string, 
  tool: string, 
  data: any
): Promise<void> {
  try {
    const db = await getDB();
    await db.put('drafts', {
      id: draftId,
      tool,
      data,
      updatedAt: Date.now(),
    }, draftId);
  } catch (e) {
    console.warn('Draft save failed:', e);
  }
}

export async function loadDraft(draftId: string): Promise<any | null> {
  try {
    const db = await getDB();
    const draft = await db.get('drafts', draftId);
    return draft?.data ?? null;
  } catch (e) {
    console.warn('Draft load failed:', e);
    return null;
  }
}

export async function getAllDrafts(): Promise<any[]> {
  try {
    const db = await getDB();
    return await db.getAll('drafts');
  } catch (e) {
    console.warn('Get all drafts failed:', e);
    return [];
  }
}

export async function deleteDraft(draftId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('drafts', draftId);
  } catch (e) {
    console.warn('Draft delete failed:', e);
  }
}

// ============= RENDER QUEUE =============
export async function queueRender(payload: any): Promise<void> {
  try {
    const db = await getDB();
    await db.add('renderQueue', {
      id: Date.now(),
      payload,
      queuedAt: Date.now(),
    });
  } catch (e) {
    console.warn('Queue render failed:', e);
  }
}

export async function getQueuedRenders(): Promise<any[]> {
  try {
    const db = await getDB();
    return await db.getAll('renderQueue');
  } catch (e) {
    console.warn('Get queued renders failed:', e);
    return [];
  }
}

export async function flushRenderQueue(
  triggerRender: (payload: any) => Promise<void>
): Promise<number> {
  try {
    const db = await getDB();
    const tx = db.transaction('renderQueue', 'readwrite');
    const store = tx.objectStore('renderQueue');
    
    const all = await store.getAll();
    let processed = 0;
    
    for (const item of all) {
      try {
        await triggerRender(item.payload);
        processed++;
      } catch (e) {
        console.warn('Failed to process queued render:', e);
      }
    }
    
    await store.clear();
    await tx.done;
    
    return processed;
  } catch (e) {
    console.warn('Flush render queue failed:', e);
    return 0;
  }
}

export async function clearRenderQueue(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear('renderQueue');
  } catch (e) {
    console.warn('Clear render queue failed:', e);
  }
}
