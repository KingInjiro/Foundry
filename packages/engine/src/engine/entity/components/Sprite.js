import { Component } from '../Component.js';

export class Sprite extends Component {
    constructor(options = {}) {
        super();
        
        this.texture = null;
        this.imageName = null; // Store the name/id for serialization
        this.color = '#ffffff';
        this.width = 64;
        this.height = 64;
        
        // Optional source rectangle for spritesheets (used by Animator)
        this.sourceX = 0;
        this.sourceY = 0;
        this.sourceWidth = 0;
        this.sourceHeight = 0;
        
        this.alpha = 1;
        this.visible = true;
        this.pivotX = 0.5;
        this.pivotY = 0.5;

        this.init(options);
    }

    init(options = {}) {
        if (options.image !== undefined) this.imageName = options.image;
        if (options.imageName !== undefined) this.imageName = options.imageName;
        if (options.color !== undefined) this.color = options.color;
        if (options.width !== undefined) this.width = options.width;
        if (options.height !== undefined) this.height = options.height;
        if (options.sourceX !== undefined) this.sourceX = options.sourceX;
        if (options.sourceY !== undefined) this.sourceY = options.sourceY;
        if (options.sourceWidth !== undefined) this.sourceWidth = options.sourceWidth;
        if (options.sourceHeight !== undefined) this.sourceHeight = options.sourceHeight;
        if (options.alpha !== undefined) this.alpha = options.alpha;
        if (options.visible !== undefined) this.visible = options.visible;
        if (options.pivotX !== undefined) this.pivotX = options.pivotX;
        if (options.pivotY !== undefined) this.pivotY = options.pivotY;
    }

    onAwake() {
        if (this.imageName && this.entity.engine) {
            this.texture = this.entity.engine.assets.getImage(this.imageName);
        }
    }

    serialize() {
        return {
            imageName: this.imageName,
            color: this.color,
            width: this.width,
            height: this.height,
            sourceX: this.sourceX,
            sourceY: this.sourceY,
            sourceWidth: this.sourceWidth,
            sourceHeight: this.sourceHeight,
            alpha: this.alpha,
            visible: this.visible,
            pivotX: this.pivotX,
            pivotY: this.pivotY
        };
    }

    deserialize(data) {
        this.init(data);
    }
}
