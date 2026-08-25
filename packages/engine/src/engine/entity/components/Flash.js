import { Component } from '../Component.js';

export class Flash extends Component {
    constructor() {
        super();
        this.timer = 0;
        this.duration = 0;
        this.color = '#ffffff';
        this.originalColor = null;
        this.isFlashing = false;
    }

    flash(duration = 0.1, color = '#ffffff') {
        this.duration = duration;
        this.timer = duration;
        this.color = color;
        
        if (!this.isFlashing) {
            const sprite = this.entity.getComponent('Sprite');
            if (sprite) {
                this.originalColor = sprite.color;
                sprite.color = this.color;
                this.isFlashing = true;
            }
        }
    }

    update(dt) {
        if (this.isFlashing) {
            this.timer -= dt;
            if (this.timer <= 0) {
                this.isFlashing = false;
                const sprite = this.entity.getComponent('Sprite');
                if (sprite && this.originalColor) {
                    sprite.color = this.originalColor;
                }
            } else {
                // Optionally lerp color back
            }
        }
    }
}
