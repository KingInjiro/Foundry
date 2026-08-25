export class SandboxBridge {
    constructor(iframe, expectedOrigin, targetOrigin = expectedOrigin) {
        this.iframe = iframe;
        this.expectedOrigin = expectedOrigin || '*';
        this.targetOrigin = targetOrigin || '*';
        this.listeners = new Map();
        this.destroyed = false;
        
        this.handleMessage = this.handleMessage.bind(this);
        window.addEventListener('message', this.handleMessage);
    }

    handleMessage(event) {
        if (this.expectedOrigin !== '*' && event.origin !== this.expectedOrigin) {
            console.warn(`[SandboxBridge] Rejected message from origin ${event.origin}, expected ${this.expectedOrigin}`);
            return;
        }

        if (event.source !== this.iframe.contentWindow) {
            return;
        }

        const data = event.data;
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

        const handlers = this.listeners.get(data.type);
        if (handlers) {
            [...handlers].forEach(handler => {
                try {
                    handler(data.payload);
                } catch (error) {
                    console.error(`[SandboxBridge] Handler for ${data.type} failed`, error);
                }
            });
        }
    }

    on(type, handler) {
        if (this.destroyed) throw new Error('SandboxBridge has been destroyed.');
        if (typeof type !== 'string' || typeof handler !== 'function') {
            throw new TypeError('SandboxBridge.on requires a message type and handler.');
        }
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(handler);
        return () => this.off(type, handler);
    }

    off(type, handler) {
        const handlers = this.listeners.get(type);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) this.listeners.delete(type);
        }
    }

    send(type, payload) {
        if (this.destroyed || !this.iframe || !this.iframe.contentWindow) return false;
        this.iframe.contentWindow.postMessage({ type, payload }, this.targetOrigin);
        return true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        window.removeEventListener('message', this.handleMessage);
        this.listeners.clear();
        this.iframe = null;
    }
}
