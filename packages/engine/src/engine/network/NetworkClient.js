export class NetworkClient {
    constructor(engine) {
        this.engine = engine;
        this.socket = null;
        this.connected = false;
        this.clientId = null;
        this.peers = {};
        this.latency = 0;
        this.onConnect = null;
        this.onDisconnect = null;
        this.onMessage = null;
        this.onPeerConnect = null;
        this.onPeerDisconnect = null;
    }
    
    connect(url = 'ws://localhost:8080') {
        if (typeof WebSocket !== 'undefined') {
            try {
                this.socket = new window.WebSocket(url);
                this.socket.onopen = () => {
                    this.connected = true;
                    if (this.onConnect) this.onConnect();
                };
                this.socket.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                };
                this.socket.onclose = () => {
                    this.connected = false;
                    if (this.onDisconnect) this.onDisconnect();
                };
            } catch (e) {
                console.warn("WebSocket not available or failed to connect", e);
            }
        } else {
            console.warn("WebSocket not supported in this environment");
        }
    }
    
    handleMessage(data) {
        if (data.type === 'init') {
            this.clientId = data.id;
        } else if (data.type === 'peer_connect') {
            this.peers[data.id] = data;
            if (this.onPeerConnect) this.onPeerConnect(data.id);
        } else if (data.type === 'peer_disconnect') {
            delete this.peers[data.id];
            if (this.onPeerDisconnect) this.onPeerDisconnect(data.id);
        } else if (data.type === 'sync' || data.type === 'client_sync') {
            if (this.engine && this.engine.world) {
                const system = this.engine.world.getSystem('NetworkSyncSystem');
                if (system) system.onStateUpdate(data.state);
            }
        }
        
        if (this.onMessage) this.onMessage(data);
    }
    
    send(data) {
        if (this.connected && this.socket && this.socket.readyState === 1) {
            this.socket.send(JSON.stringify(data));
        }
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
    }
}
