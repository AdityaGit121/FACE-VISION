import { IdentityProfile, FaceSighting } from '../types';

const DB_NAME = 'ai-face-intelligence';
const DB_VERSION = 1;
const IDENTITIES_STORE = 'identities';
const SIGHTINGS_STORE = 'sightings';
const SETTINGS_STORE = 'settings';

class IdentityDatabase {
  private db: IDBDatabase | null = null;
  private isAvailable: boolean = true;

  constructor() {
    this.init().catch((err) => {
      console.warn('IndexedDB unavailable, using LocalStorage fallback:', err);
      this.isAvailable = false;
    });
  }

  private init(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (typeof window === 'undefined' || !window.indexedDB) {
      this.isAvailable = false;
      return Promise.reject(new Error('IndexedDB not supported'));
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(IDENTITIES_STORE)) {
          const idStore = db.createObjectStore(IDENTITIES_STORE, { keyPath: 'id' });
          idStore.createIndex('name', 'name', { unique: false });
        }

        if (!db.objectStoreNames.contains(SIGHTINGS_STORE)) {
          const sStore = db.createObjectStore(SIGHTINGS_STORE, { keyPath: 'id' });
          sStore.createIndex('personId', 'personId', { unique: false });
          sStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        this.isAvailable = false;
        reject(request.error);
      };
    });
  }

  async getAllIdentities(): Promise<IdentityProfile[]> {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDENTITIES_STORE, 'readonly');
        const store = tx.objectStore(IDENTITIES_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      // LocalStorage fallback
      try {
        const raw = localStorage.getItem('ai_face_identities');
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    }
  }

  async saveIdentity(identity: IdentityProfile): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDENTITIES_STORE, 'readwrite');
        const store = tx.objectStore(IDENTITIES_STORE);
        const req = store.put(identity);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // LocalStorage fallback
      const list = await this.getAllIdentities();
      const idx = list.findIndex((i) => i.id === identity.id);
      if (idx >= 0) {
        list[idx] = identity;
      } else {
        list.push(identity);
      }
      localStorage.setItem('ai_face_identities', JSON.stringify(list));
    }
  }

  async updateIdentity(id: string, updates: Partial<IdentityProfile>): Promise<IdentityProfile | null> {
    const list = await this.getAllIdentities();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    const updated: IdentityProfile = {
      ...list[idx],
      ...updates,
      updatedAt: Date.now(),
    };
    await this.saveIdentity(updated);
    return updated;
  }

  async deleteSighting(id: string): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SIGHTINGS_STORE, 'readwrite');
        const store = tx.objectStore(SIGHTINGS_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      const list = (await this.getSightings(500)).filter((s) => s.id !== id);
      localStorage.setItem('ai_face_sightings', JSON.stringify(list));
    }
  }

  async deleteIdentity(id: string): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDENTITIES_STORE, 'readwrite');
        const store = tx.objectStore(IDENTITIES_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      const list = (await this.getAllIdentities()).filter((i) => i.id !== id);
      localStorage.setItem('ai_face_identities', JSON.stringify(list));
    }
  }

  async clearAllIdentities(): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDENTITIES_STORE, 'readwrite');
        const store = tx.objectStore(IDENTITIES_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      localStorage.removeItem('ai_face_identities');
    }
  }

  async addSighting(sighting: FaceSighting): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SIGHTINGS_STORE, 'readwrite');
        const store = tx.objectStore(SIGHTINGS_STORE);
        const req = store.put(sighting);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const raw = localStorage.getItem('ai_face_sightings');
        const list: FaceSighting[] = raw ? JSON.parse(raw) : [];
        list.push(sighting);
        // keep max 200 sightings in localstorage
        if (list.length > 200) list.shift();
        localStorage.setItem('ai_face_sightings', JSON.stringify(list));
      } catch (err) {
        console.warn('Failed to save sighting:', err);
      }
    }
  }

  async getSightings(limit: number = 100): Promise<FaceSighting[]> {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SIGHTINGS_STORE, 'readonly');
        const store = tx.objectStore(SIGHTINGS_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const list: FaceSighting[] = req.result || [];
          list.sort((a, b) => b.timestamp - a.timestamp);
          resolve(list.slice(0, limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const raw = localStorage.getItem('ai_face_sightings');
        const list: FaceSighting[] = raw ? JSON.parse(raw) : [];
        list.sort((a, b) => b.timestamp - a.timestamp);
        return list.slice(0, limit);
      } catch {
        return [];
      }
    }
  }

  async clearSightings(): Promise<void> {
    try {
      const db = await this.init();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SIGHTINGS_STORE, 'readwrite');
        const store = tx.objectStore(SIGHTINGS_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      localStorage.removeItem('ai_face_sightings');
    }
  }

  async exportAllData(): Promise<string> {
    const identities = await this.getAllIdentities();
    const sightings = await this.getSightings(500);
    return JSON.stringify(
      {
        version: '2.0.0',
        exportedAt: Date.now(),
        identities,
        sightings,
      },
      null,
      2
    );
  }

  async importData(jsonString: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(jsonString);
      if (Array.isArray(parsed.identities)) {
        for (const identity of parsed.identities) {
          if (identity.id && identity.name && Array.isArray(identity.embeddings)) {
            await this.saveIdentity(identity);
          }
        }
      }
      if (Array.isArray(parsed.sightings)) {
        for (const sighting of parsed.sightings) {
          if (sighting.id && sighting.personId) {
            await this.addSighting(sighting);
          }
        }
      }
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  }
}

export const idb = new IdentityDatabase();
