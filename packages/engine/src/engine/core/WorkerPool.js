export class WorkerPool {
    constructor(scriptUrl, size = navigator.hardwareConcurrency || 4) {
        this.workers = [];
        this.idle = [];
        this.resolvers = new Map();
        this.msgId = 0;
        
        for (let i = 0; i < size; i++) {
            const worker = new Worker(scriptUrl);
            worker.onmessage = (e) => {
                const { id, result, error } = e.data;
                const resolver = this.resolvers.get(id);
                if (resolver) {
                    this.resolvers.delete(id);
                    if (error) resolver.reject(new Error(error));
                    else resolver.resolve(result);
                    
                    this.idle.push(worker);
                    this._process();
                }
            };
            this.workers.push(worker);
            this.idle.push(worker);
        }
        
        this.queue = [];
    }
    
    execute(type, data) {
        return new Promise((resolve, reject) => {
            const id = ++this.msgId;
            this.resolvers.set(id, { resolve, reject });
            this.queue.push({ id, type, data });
            this._process();
        });
    }
    
    _process() {
        while (this.idle.length > 0 && this.queue.length > 0) {
            const worker = this.idle.pop();
            const task = this.queue.shift();
            worker.postMessage(task);
        }
    }
    
    dispose() {
        this.workers.forEach(w => w.terminate());
    }
}
