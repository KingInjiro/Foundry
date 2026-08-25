export class Timer {
    constructor(duration, callback, loop = false) {
        this.duration = duration;
        this.callback = callback;
        this.loop = loop;
        this.elapsed = 0;
        this.isFinished = false;
        this.isPaused = false;
    }

    update(dt) {
        if (this.isFinished || this.isPaused) return;

        this.elapsed += dt;

        if (this.elapsed >= this.duration) {
            this.callback();
            if (this.loop) {
                this.elapsed -= this.duration;
            } else {
                this.isFinished = true;
            }
        }
    }

    reset() {
        this.elapsed = 0;
        this.isFinished = false;
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }
}

export class TimerManager {
    constructor(engine) {
        this.engine = engine;
        this.timers = [];

        this.engine.events.on('update', (dt) => {
            this.update(dt);
        });
    }

    add(duration, callback, loop = false) {
        const timer = new Timer(duration, callback, loop);
        this.timers.push(timer);
        return timer;
    }

    remove(timer) {
        const index = this.timers.indexOf(timer);
        if (index > -1) {
            this.timers.splice(index, 1);
        }
    }

    clear() {
        this.timers = [];
    }

    update(dt) {
        for (let i = this.timers.length - 1; i >= 0; i--) {
            const timer = this.timers[i];
            timer.update(dt);
            if (timer.isFinished) {
                this.timers.splice(i, 1);
            }
        }
    }
}
