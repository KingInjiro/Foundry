import { WorkerPool } from './WorkerPool.js';

export const TaskCategory = {
    CORE: 'core',
    PHYSICS: 'physics',
    GAMEPLAY: 'gameplay',
    ANIMATION: 'animation',
    RENDERING: 'rendering',
    STREAMING: 'streaming',
    BACKGROUND: 'background',
    IO: 'io'
};

export const ExecutionStage = {
    PRE_UPDATE: 'pre_update',
    PHYSICS: 'physics',
    UPDATE: 'update',
    POST_UPDATE: 'post_update',
    LATE_UPDATE: 'late_update',
    PRE_RENDER: 'pre_render',
    POST_RENDER: 'post_render'
};

const CategoryPriority = {
    [TaskCategory.CORE]: 0,
    [TaskCategory.PHYSICS]: 10,
    [TaskCategory.GAMEPLAY]: 20,
    [TaskCategory.ANIMATION]: 30,
    [TaskCategory.RENDERING]: 40,
    [TaskCategory.STREAMING]: 50,
    [TaskCategory.BACKGROUND]: 60,
    [TaskCategory.IO]: 70
};

export class TaskScheduler {
    constructor(workerScriptUrl = null) {
        this.handlers = new Map();
        this.taskQueue = [];
        this.isRecording = false;
        this.isFrozen = false;
        
        // Ensure task id uniqueness
        this._nextTaskId = 0;
        
        this.workerPool = workerScriptUrl ? new WorkerPool(workerScriptUrl) : null;
    }

    /**
     * Freeze the registry to prevent new handlers from being added during gameplay.
     */
    freeze() {
        this.isFrozen = true;
    }

    /**
     * Unfreeze and clear the registry (Useful for Editor Hot Reload).
     */
    resetRegistry() {
        this.handlers.clear();
        this.isFrozen = false;
    }

    /**
     * Register a handler for a specific task type.
     * @param {string} type Task type identifier
     * @param {Function} handler Function to execute when this task runs
     */
    registerHandler(type, handler) {
        if (this.isFrozen) {
            console.warn(`TaskScheduler: Cannot register handler for '${type}' after registry is frozen.`);
            return;
        }
        this.handlers.set(type, handler);
    }

    /**
     * Begin a new batch of tasks. Acts as the start of a synchronization barrier.
     */
    begin() {
        this.isRecording = true;
        this.taskQueue = [];
    }

    _validateStructuredClone(data, path = "root") {
        if (data === null || data === undefined) return;
        
        if (typeof data === 'function') {
            throw new Error(`TaskScheduler: Payload must be serializable. Function detected at ${path}.`);
        }
        
        if (typeof HTMLElement !== 'undefined' && data instanceof HTMLElement) {
            throw new Error(`TaskScheduler: Payload must be serializable. HTMLElement detected at ${path}.`);
        }

        if (data && typeof data === 'object') {
            if (data.constructor && ['Entity', 'PhysicsBody', 'Transform', 'Map', 'Set', 'Canvas'].includes(data.constructor.name)) {
                throw new Error(`TaskScheduler: Payload must be serializable. ${data.constructor.name} detected at ${path}.`);
            }
        }
    }

    /**
     * Dispatch a task with serializable data.
     */
    dispatch({ type, data = null, category = TaskCategory.GAMEPLAY, stage = ExecutionStage.UPDATE, id = null, dependsOn = [] }) {
        this._validateStructuredClone(data);

        const taskId = id || `task_${++this._nextTaskId}`;
        const task = { 
            id: taskId, 
            type, 
            data, 
            category,
            stage,
            dependsOn, 
            priority: CategoryPriority[category] ?? CategoryPriority[TaskCategory.GAMEPLAY] 
        };

        if (this.isRecording) {
            this.taskQueue.push(task);
        } else {
            // Execute immediately if not inside a begin/end block
            this._runTask(task);
        }
        
        return taskId;
    }

    async _runTask(task) {
        const start = performance.now();
        let result;
        
        if (this.workerPool) {
            result = await this.workerPool.execute(task.type, task.data);
        } else {
            const handler = this.handlers.get(task.type);
            if (handler) {
                result = await handler(task.data);
            } else {
                console.warn(`TaskScheduler: No handler registered for task type '${task.type}'`);
            }
        }
        
        const time = performance.now() - start;
        return { time, result };
    }

    _finalizeResult(startTime, results, timings, totalTime, slowestTaskTime, slowestTaskId, maxQueueDepth, failedTasks, taskCount) {
        const wallTime = performance.now() - startTime;
        return Object.freeze({
            events: Object.freeze(results),
            metrics: Object.freeze({
                taskCount: taskCount,
                totalExecutionTime: totalTime,
                wallTime: wallTime,
                averageTime: taskCount > 0 ? (totalTime / taskCount) : 0,
                slowestTaskTime: slowestTaskTime,
                slowestTaskId: slowestTaskId,
                maxQueueDepth: maxQueueDepth,
                failedTasks: failedTasks,
                cancelledTasks: 0,
                workerUtilization: this.workerPool ? 1.0 : 0.0
            }),
            timings: Object.freeze(timings)
        });
    }

    /**
     * End the current batch and wait for all tasks in the batch to complete.
     * Evaluates the DAG in parallel resolving dependencies.
     * @returns {Promise<Readonly<Object>>} An immutable TaskResult object
     */
    async end() {
        this.isRecording = false;
        const startTime = performance.now();
        
        const tasks = [...this.taskQueue];
        this.taskQueue = [];
        const totalTasks = tasks.length;
        
        const results = [];
        const timings = {};
        let slowestTaskTime = 0;
        let slowestTaskId = null;
        let totalTime = 0;
        let failedTasks = 0;
        const maxQueueDepth = totalTasks;
        
        if (totalTasks === 0) {
            return this._finalizeResult(startTime, results, timings, 0, 0, null, 0, 0, 0);
        }
        
        const taskMap = new Map();
        const inDegree = new Map();
        const adjList = new Map();
        
        tasks.forEach(task => {
            taskMap.set(task.id, task);
            inDegree.set(task.id, 0);
            adjList.set(task.id, []);
        });
        
        tasks.forEach(task => {
            task.dependsOn.forEach(depId => {
                if (adjList.has(depId)) {
                    adjList.get(depId).push(task.id);
                    inDegree.set(task.id, inDegree.get(task.id) + 1);
                } else {
                    console.warn(`TaskScheduler: Unknown dependency '${depId}' for task '${task.id}'`);
                }
            });
        });

        return new Promise((resolve) => {
            const readyQueue = [];
            let activeCount = 0;
            let completedCount = 0;
            
            taskMap.forEach((task, id) => {
                if (inDegree.get(id) === 0) readyQueue.push(task);
            });
            
            const checkNext = () => {
                // Tie-break by priority when popping from readyQueue
                readyQueue.sort((a, b) => a.priority - b.priority);
                
                while (readyQueue.length > 0) {
                    const task = readyQueue.shift();
                    activeCount++;
                    
                    this._runTask(task).then(({ time, result }) => {
                        activeCount--;
                        completedCount++;
                        
                        timings[task.id] = time;
                        totalTime += time;
                        if (time > slowestTaskTime) {
                            slowestTaskTime = time;
                            slowestTaskId = task.id;
                        }
                        if (result !== undefined) results.push(result);
                        
                        adjList.get(task.id).forEach(neighborId => {
                            const newDegree = inDegree.get(neighborId) - 1;
                            inDegree.set(neighborId, newDegree);
                            if (newDegree === 0) {
                                readyQueue.push(taskMap.get(neighborId));
                            }
                        });
                        
                        if (completedCount === totalTasks) {
                            resolve(this._finalizeResult(startTime, results, timings, totalTime, slowestTaskTime, slowestTaskId, maxQueueDepth, failedTasks, totalTasks));
                        } else {
                            checkNext();
                        }
                    }).catch(error => {
                        console.error(`TaskScheduler: Task '${task.id}' of type '${task.type}' failed:`, error);
                        failedTasks++;
                        activeCount--;
                        completedCount++;
                        
                        // Fail downstream dependencies too
                        const failDownstream = (taskId) => {
                            adjList.get(taskId).forEach(neighborId => {
                                if (inDegree.get(neighborId) > -1) {
                                    inDegree.set(neighborId, -1); // Mark as failed dependency
                                    failedTasks++;
                                    completedCount++;
                                    failDownstream(neighborId);
                                }
                            });
                        };
                        failDownstream(task.id);
                        
                        if (completedCount === totalTasks) {
                            resolve(this._finalizeResult(startTime, results, timings, totalTime, slowestTaskTime, slowestTaskId, maxQueueDepth, failedTasks, totalTasks));
                        } else {
                            checkNext();
                        }
                    });
                }
                
                // Deadlock detection
                if (activeCount === 0 && completedCount < totalTasks) {
                    console.error("TaskScheduler: Circular dependency or deadlock detected.");
                    failedTasks += (totalTasks - completedCount);
                    resolve(this._finalizeResult(startTime, results, timings, totalTime, slowestTaskTime, slowestTaskId, maxQueueDepth, failedTasks, totalTasks));
                }
            };
            
            checkNext();
        });
    }
}
