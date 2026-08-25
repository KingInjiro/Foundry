/**
 * Delta time, time scale, FPS metrics.
 */
export class Time {
    constructor() {
        this.deltaTime = 0;
        this.unscaledDeltaTime = 0;
        this.timeScale = 1;
        this.fps = 0;
        
        const perf = typeof performance !== 'undefined' ? performance : Date;
        this.now = perf.now();
        this.lastTime = this.now;
        
        this.frameCount = 0;
        this.fpsTimer = 0;
    }

    /**
     * Update time metrics.
     * @param {number} timestamp 
     */
    update(timestamp) {
        this.now = timestamp;
        this.unscaledDeltaTime = (this.now - this.lastTime) * 0.001;
        this.deltaTime = this.unscaledDeltaTime * this.timeScale;
        this.lastTime = this.now;

        this.frameCount++;
        this.fpsTimer += this.unscaledDeltaTime;
        
        if (this.fpsTimer >= 1) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsTimer -= 1;
        }
    }
}
