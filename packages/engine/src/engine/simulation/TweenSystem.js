export const Easing = {
    Linear: (t) => t,
    QuadIn: (t) => t * t,
    QuadOut: (t) => t * (2 - t),
    QuadInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    CubicIn: (t) => t * t * t,
    CubicOut: (t) => (--t) * t * t + 1,
    CubicInOut: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    ElasticOut: (t) => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    BackOut: (t) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    BounceOut: (t) => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) {
            return n1 * t * t;
        } else if (t < 2 / d1) {
            return n1 * (t -= 1.5 / d1) * t + 0.75;
        } else if (t < 2.5 / d1) {
            return n1 * (t -= 2.25 / d1) * t + 0.9375;
        } else {
            return n1 * (t -= 2.625 / d1) * t + 0.984375;
        }
    }
};

export class Tween {
    constructor(target, props, duration, easing, onComplete) {
        this.target = target;
        this.duration = duration;
        this.easing = easing || Easing.Linear;
        this.onComplete = onComplete;
        
        this.time = 0;
        this.startProps = {};
        this.endProps = props;
        
        for (let key in props) {
            this.startProps[key] = target[key] || 0;
        }
        
        this.finished = false;
    }
    
    update(dt) {
        if (this.finished) return;
        
        this.time += dt;
        let t = this.time / this.duration;
        if (t >= 1.0) {
            t = 1.0;
            this.finished = true;
        }
        
        const e = this.easing(t);
        
        for (let key in this.endProps) {
            const start = this.startProps[key];
            const end = this.endProps[key];
            this.target[key] = start + (end - start) * e;
        }
        
        if (this.finished && this.onComplete) {
            this.onComplete();
        }
    }
}

export class TweenManager {
    constructor() {
        this.tweens = [];
    }
    
    to(target, props, duration, easing, onComplete) {
        const tween = new Tween(target, props, duration, easing, onComplete);
        this.tweens.push(tween);
        return tween;
    }
    
    update(dt) {
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            this.tweens[i].update(dt);
            if (this.tweens[i].finished) {
                this.tweens.splice(i, 1);
            }
        }
    }
    
    clear() {
        this.tweens.length = 0;
    }
}
