export const Easing = {
    Linear: (t) => t,
    QuadraticIn: (t) => t * t,
    QuadraticOut: (t) => t * (2 - t),
    QuadraticInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    CubicIn: (t) => t * t * t,
    CubicOut: (t) => (--t) * t * t + 1,
    CubicInOut: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    SineIn: (t) => 1 - Math.cos(t * Math.PI / 2),
    SineOut: (t) => Math.sin(t * Math.PI / 2),
    SineInOut: (t) => 0.5 * (1 - Math.cos(Math.PI * t)),
    BounceOut: (t) => {
        if (t < (1 / 2.75)) {
            return 7.5625 * t * t;
        } else if (t < (2 / 2.75)) {
            return 7.5625 * (t -= (1.5 / 2.75)) * t + 0.75;
        } else if (t < (2.5 / 2.75)) {
            return 7.5625 * (t -= (2.25 / 2.75)) * t + 0.9375;
        } else {
            return 7.5625 * (t -= (2.625 / 2.75)) * t + 0.984375;
        }
    }
};

export class Tween {
    constructor(target, props, duration = 1.0, config = {}) {
        this.target = target;
        this.props = props;
        this.duration = duration;
        this.easing = config.easing || Easing.Linear;
        this.onUpdate = config.onUpdate || null;
        this.onComplete = config.onComplete || null;
        this.delay = config.delay || 0;
        
        this.elapsed = 0;
        this.isFinished = false;
        
        this.startValues = {};
        this.isInitialized = false;
    }

    _init() {
        for (const key in this.props) {
            this.startValues[key] = this.target[key] || 0;
        }
        this.isInitialized = true;
    }

    update(dt) {
        if (this.isFinished) return true;
        
        if (this.delay > 0) {
            this.delay -= dt;
            return false;
        }
        
        if (!this.isInitialized) {
            this._init();
        }

        this.elapsed += dt;
        let t = this.elapsed / this.duration;
        
        if (t >= 1) {
            t = 1;
            this.isFinished = true;
        }

        const easedT = this.easing(t);

        for (const key in this.props) {
            const start = this.startValues[key];
            const end = this.props[key];
            this.target[key] = start + (end - start) * easedT;
        }

        if (this.onUpdate) this.onUpdate(t);
        if (this.isFinished && this.onComplete) this.onComplete();

        return this.isFinished;
    }
}

export class TweenManager {
    constructor(engine) {
        this.engine = engine;
        this.tweens = [];
        
        this.engine.events.on('update', (dt) => {
            this.update(dt);
        });
    }

    add(target, props, duration, config) {
        const tween = new Tween(target, props, duration, config);
        this.tweens.push(tween);
        return tween;
    }
    
    remove(tween) {
        const index = this.tweens.indexOf(tween);
        if (index > -1) {
            this.tweens.splice(index, 1);
        }
    }

    clear() {
        this.tweens = [];
    }

    update(dt) {
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            if (tween.update(dt)) {
                this.tweens.splice(i, 1);
            }
        }
    }
}
