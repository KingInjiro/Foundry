/**
 * Zero-allocation real-time micro-profiler.
 * Uses Exponential Moving Average (EMA) to track performance metrics
 * without generating garbage collection overhead (no arrays needed).
 */
export class Profiler {
    constructor() {
        /** @type {Map<string, { start: number, value: number }>} */
        this.metrics = new Map();
        // Smoothing factor for EMA (0.0 to 1.0). Lower = smoother, less responsive.
        this.smoothing = 0.1; 
        
        // General stats
        this.memoryUsed = 0;
        this.memoryTotal = 0;
    }

    /**
     * Marks the start time for a specific metric.
     * @param {string} label 
     */
    begin(label) {
        if (!this.metrics.has(label)) {
            this.metrics.set(label, { start: 0, value: 0 });
        }
        this.metrics.get(label).start = performance.now();
    }

    /**
     * Marks the end time, calculates delta, and updates the EMA.
     * @param {string} label 
     */
    end(label) {
        const metric = this.metrics.get(label);
        if (metric) {
            const delta = performance.now() - metric.start;
            // Exponential Moving Average
            metric.value = (metric.value * (1.0 - this.smoothing)) + (delta * this.smoothing);
        }
    }

    /**
     * Sets a raw value for a metric directly (useful for non-time metrics).
     * @param {string} label 
     * @param {number} value 
     */
    set(label, value) {
        if (!this.metrics.has(label)) {
            this.metrics.set(label, { start: 0, value: 0 });
        }
        const metric = this.metrics.get(label);
        metric.value = (metric.value * (1.0 - this.smoothing)) + (value * this.smoothing);
    }

    /**
     * Ingest metrics from a TaskScheduler TaskResult
     * @param {Object} taskResult
     */
    ingestTaskMetrics(taskResult) {
        if (!taskResult || !taskResult.metrics) return;
        
        const m = taskResult.metrics;
        this.set('tasks_count', m.taskCount);
        this.set('tasks_wall_time', m.wallTime);
        this.set('tasks_queue_depth', m.maxQueueDepth);
        this.set('tasks_slowest_time', m.slowestTaskTime);
        this.set('tasks_failed', m.failedTasks);
        
        if (m.slowestTaskId) {
            this.slowestTaskId = m.slowestTaskId;
        }
    }

    /**
     * Updates internal tracking (e.g., memory)
     */
    update() {
        if (performance && performance.memory) {
            this.memoryUsed = performance.memory.usedJSHeapSize;
            this.memoryTotal = performance.memory.totalJSHeapSize;
        }
    }

    /**
     * Gets the current smoothed value of a metric in milliseconds.
     * @param {string} label 
     * @returns {number}
     */
    get(label) {
        const metric = this.metrics.get(label);
        return metric ? metric.value : 0;
    }
}
