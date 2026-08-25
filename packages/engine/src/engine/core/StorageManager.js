export class StorageManager {
    constructor(engine) {
        this.engine = engine;
        this.prefix = 'foundry_save_';
    }

    setPrefix(prefix) {
        this.prefix = prefix;
    }

    save(key, data) {
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('Storage save failed:', e);
            return false;
        }
    }

    load(key, defaultValue = null) {
        try {
            const val = localStorage.getItem(this.prefix + key);
            if (val === null) return defaultValue;
            return JSON.parse(val);
        } catch (e) {
            console.warn('Storage load failed:', e);
            return defaultValue;
        }
    }

    delete(key) {
        localStorage.removeItem(this.prefix + key);
    }

    has(key) {
        return localStorage.getItem(this.prefix + key) !== null;
    }

    clear() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(this.prefix)) {
                keys.push(k);
            }
        }
        for (const k of keys) {
            localStorage.removeItem(k);
        }
    }
}
