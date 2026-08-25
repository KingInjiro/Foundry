/**
 * High-performance, zero-allocation PubSub event emitter.
 */
export class EventEmitter {
    constructor() {
        /** @type {Map<string, Function[]>} */
        this.events = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event 
     * @param {Function} listener 
     */
    on(event, listener) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(listener);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event 
     * @param {Function} listener 
     */
    off(event, listener) {
        if (!this.events.has(event)) return;
        const listeners = this.events.get(event);
        const index = listeners.indexOf(listener);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * Emit an event. Overloaded up to 3 args for zero allocation.
     * @param {string} event 
     * @param {any} a 
     * @param {any} b 
     * @param {any} c 
     */
    emit(event, a, b, c) {
        if (!this.events.has(event)) return;
        const listeners = this.events.get(event);
        const count = arguments.length;
        
        for (let i = 0; i < listeners.length; i++) {
            switch (count) {
                case 1: listeners[i](); break;
                case 2: listeners[i](a); break;
                case 3: listeners[i](a, b); break;
                case 4: listeners[i](a, b, c); break;
                default: 
                    // Fallback for > 3 args
                    const args = new Array(count - 1);
                    for (let j = 1; j < count; j++) {
                        args[j - 1] = arguments[j];
                    }
                    listeners[i](...args); 
                    break;
            }
        }
    }
}
