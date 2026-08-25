export class NetworkServer {
    constructor(engine, port = 8080) {
        this.engine = engine;
        this.port = port;
        this.wss = null;
        this.clients = new Map(); // ws -> id
        this.clientData = new Map(); // id -> data
        this._idCounter = 1;
        
        this.onClientConnect = null;
        this.onClientDisconnect = null;
        this.onMessage = null;
    }
    
    async start() {
        if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
            console.error("NetworkServer requires a Node.js environment.");
            return;
        }
        
        try {
            // Dynamic import to avoid browser bundler errors
            const { WebSocketServer } = await import('ws');
            this.wss = new WebSocketServer({ port: this.port });
            
            this.wss.on('connection', (ws) => {
                const id = 'client_' + (this._idCounter++);
                this.clients.set(ws, id);
                this.clientData.set(id, { id });
                
                // Send init to client
                ws.send(JSON.stringify({ type: 'init', id }));
                
                // Notify others
                this.broadcast({ type: 'peer_connect', id }, ws);
                
                // Send existing peers to new client
                this.clientData.forEach((data, peerId) => {
                    if (peerId !== id) {
                        ws.send(JSON.stringify({ type: 'peer_connect', id: peerId }));
                    }
                });
                
                if (this.onClientConnect) this.onClientConnect(id);
                
                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        this.handleMessage(id, data);
                    } catch(e) {
                        console.error("Failed to parse message from client", id, e);
                    }
                });
                
                ws.on('close', () => {
                    this.clients.delete(ws);
                    this.clientData.delete(id);
                    this.broadcast({ type: 'peer_disconnect', id });
                    if (this.onClientDisconnect) this.onClientDisconnect(id);
                });
            });
            
            console.log(`[NetworkServer] Started on port ${this.port}`);
            
        } catch(e) {
            console.error("Failed to start NetworkServer", e);
        }
    }
    
    handleMessage(clientId, data) {
        if (data.type === 'client_sync') {
            // Re-broadcast client sync to others, or apply to server state
            if (this.engine && this.engine.world) {
                const system = this.engine.world.getSystem('NetworkSyncSystem');
                if (system) system.onStateUpdate(data.state);
            }
            // For now, relay client state to all other clients directly
            data.type = 'sync'; // convert to normal sync message
            const ws = this.getSocketById(clientId);
            this.broadcast(data, ws);
        }
        
        if (this.onMessage) this.onMessage(clientId, data);
    }
    
    getSocketById(id) {
        for (let [ws, clientId] of this.clients.entries()) {
            if (clientId === id) return ws;
        }
        return null;
    }
    
    broadcast(data, excludeWs = null) {
        const msg = JSON.stringify(data);
        for (let ws of this.clients.keys()) {
            if (ws !== excludeWs && ws.readyState === 1) { // OPEN
                ws.send(msg);
            }
        }
    }
    
    send(clientId, data) {
        const ws = this.getSocketById(clientId);
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(data));
        }
    }
    
    stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }
}
