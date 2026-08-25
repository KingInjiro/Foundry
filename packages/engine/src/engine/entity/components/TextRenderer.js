import { Component } from '../Component.js';

export class TextRenderer extends Component {
    constructor(options = {}) {
        super();
        this.text = 'Text';
        this.font = '16px Arial';
        this.color = '#ffffff';
        this.textAlign = 'center';
        this.textBaseline = 'middle';
        
        this.init(options);
    }

    init(options = {}) {
        if (options.text !== undefined) this.text = options.text;
        if (options.font !== undefined) this.font = options.font;
        if (options.color !== undefined) this.color = options.color;
        if (options.textAlign !== undefined) this.textAlign = options.textAlign;
        if (options.textBaseline !== undefined) this.textBaseline = options.textBaseline;
    }

    serialize() {
        return {
            text: this.text,
            font: this.font,
            color: this.color,
            textAlign: this.textAlign,
            textBaseline: this.textBaseline
        };
    }

    deserialize(data) {
        this.init(data);
    }
}
