export class TrailRenderer {
    constructor(data = {}) {
        this.color = data.color || '#ff0000';
        this.length = data.length || 10;
        this.width = data.width || 5;
        this.points = [];
        this.enabled = data.enabled !== undefined ? data.enabled : true;
    }
}
