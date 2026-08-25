const DEFAULT_DB_NAME = 'FoundryPlatformSaves';
const DB_VERSION = 1;
const STORE_NAME = 'game-saves';

export const MAX_GAME_SAVE_BYTES = 5 * 1024 * 1024;

function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}

function requireKeyPart(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${label} is required to identify a game save.`);
    }
    return encodeURIComponent(value.trim());
}

export function createGameSaveKey({ viewerId = 'guest', gameId, versionId }) {
    return [
        'v1',
        requireKeyPart(viewerId, 'viewerId'),
        requireKeyPart(gameId, 'gameId'),
        requireKeyPart(versionId, 'versionId')
    ].join(':');
}

export class GameSaveStorage {
    constructor({
        indexedDBFactory = globalThis.indexedDB,
        dbName = DEFAULT_DB_NAME,
        maxBytes = MAX_GAME_SAVE_BYTES
    } = {}) {
        this.indexedDBFactory = indexedDBFactory;
        this.dbName = dbName;
        this.maxBytes = maxBytes;
        this.dbPromise = null;
        this.writeQueues = new Map();
    }

    async open() {
        if (!this.indexedDBFactory) {
            throw new Error('IndexedDB is unavailable in this browser.');
        }
        if (!this.dbPromise) {
            let blocked = false;
            const openingPromise = new Promise((resolve, reject) => {
                const request = this.indexedDBFactory.open(this.dbName, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    if (blocked) {
                        db.close();
                        return;
                    }
                    db.onversionchange = () => {
                        db.close();
                        if (this.dbPromise === openingPromise) this.dbPromise = null;
                    };
                    resolve(db);
                };
                request.onerror = () => reject(request.error || new Error('Could not open game save storage.'));
                request.onblocked = () => {
                    blocked = true;
                    reject(new Error('Game save storage upgrade is blocked by another tab.'));
                };
            });
            this.dbPromise = openingPromise;
            void openingPromise.catch(() => {
                if (this.dbPromise === openingPromise) this.dbPromise = null;
            });
        }
        return this.dbPromise;
    }

    async load(key) {
        if (typeof key !== 'string' || key === '') throw new TypeError('A game save key is required.');
        const pendingWrite = this.writeQueues.get(key);
        if (pendingWrite) await pendingWrite.catch(() => {});
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const request = transaction.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => {
                const record = request.result;
                if (!record || typeof record.state !== 'string') {
                    resolve(null);
                    return;
                }
                if (byteLength(record.state) > this.maxBytes) {
                    resolve(null);
                    return;
                }
                resolve(record.state);
            };
            request.onerror = () => reject(request.error || new Error('Could not read the game save.'));
        });
    }

    async save(key, state) {
        if (typeof key !== 'string' || key === '') throw new TypeError('A game save key is required.');
        if (typeof state !== 'string') throw new TypeError('Game save state must be a string.');

        const sizeBytes = byteLength(state);
        if (sizeBytes > this.maxBytes) {
            throw new Error(`Game save exceeds the ${this.maxBytes}-byte limit.`);
        }

        const previous = this.writeQueues.get(key) || Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            const db = await this.open();
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                transaction.objectStore(STORE_NAME).put({
                    key,
                    state,
                    sizeBytes,
                    updatedAt: Date.now()
                });
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error || new Error('Could not save game progress.'));
                transaction.onabort = () => reject(transaction.error || new Error('Game save transaction was aborted.'));
            });
            return { key, sizeBytes };
        });

        this.writeQueues.set(key, operation);
        try {
            return await operation;
        } finally {
            if (this.writeQueues.get(key) === operation) this.writeQueues.delete(key);
        }
    }

    async remove(key) {
        if (typeof key !== 'string' || key === '') throw new TypeError('A game save key is required.');
        const pendingWrite = this.writeQueues.get(key);
        if (pendingWrite) await pendingWrite.catch(() => {});
        const db = await this.open();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).delete(key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('Could not remove the game save.'));
            transaction.onabort = () => reject(transaction.error || new Error('Game save removal was aborted.'));
        });
    }

    async close() {
        const dbPromise = this.dbPromise;
        this.dbPromise = null;
        if (!dbPromise) return;
        try {
            const db = await dbPromise;
            db.close();
        } catch {
            // Opening may already have failed; there is nothing left to close.
        }
    }
}

export const gameSaveStorage = new GameSaveStorage();
