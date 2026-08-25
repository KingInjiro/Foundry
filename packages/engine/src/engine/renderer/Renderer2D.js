/**
 * Wraps CanvasRenderingContext2D operations with zero dynamic heap memory allocation 
 * during frame rendering. Implements state safety and drawing primitives.
 */
export class Renderer2D {
    /**
     * @param {import('./Canvas.js').Canvas} canvasManager 
     */
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.ctx = canvasManager.context;
    }

    /**
     * Clears the entire canvas viewport.
     */
    
    save() { this.ctx.save(); }
    restore() { this.ctx.restore(); }
    translate(x, y) { this.ctx.translate(x, y); }
    scale(x, y) { this.ctx.scale(x, y); }
    rotate(angle) { this.ctx.rotate(angle); }

    clear() {
        const win = this.canvasManager.engine.window;
        this.ctx.clearRect(0, 0, win.width, win.height);
    }

    /**
     * Begins a new rendering frame/state.
     */
    setZ(layer, z) {}
    executeQueue() {}

    begin() {
        this.ctx.save();
    }

    /**
     * Ends the current rendering frame/state.
     */
    end() {
        this.ctx.restore();
    }

    /**
     * Sets the fill color.
     * @param {string} color 
     */
    setFillStyle(color) {
        this.ctx.fillStyle = color;
    }

    /**
     * Sets the stroke color.
     * @param {string} color 
     */
    setStrokeStyle(color) {
        this.ctx.strokeStyle = color;
    }

    /**
     * Sets the line width.
     * @param {number} width 
     */
    setLineWidth(width) {
        this.ctx.lineWidth = width;
    }

    /**
     * Sets the global alpha (opacity).
     * @param {number} alpha
     */
    setGlobalAlpha(alpha) {
        this.ctx.globalAlpha = alpha;
    }

    /**
     * Sets the global composite operation (blend mode).
     * @param {string} operation (e.g., 'source-over', 'lighter', 'multiply')
     */
    setGlobalCompositeOperation(operation) {
        this.ctx.globalCompositeOperation = operation;
    }

    /**
     * Draws a filled rectangle.
     * @param {number} x 
     * @param {number} y 
     * @param {number} w 
     * @param {number} h 
     */
    fillRect(x, y, w, h) {
        this.ctx.fillRect(x, y, w, h);
    }

    /**
     * Draws a stroked rectangle.
     * @param {number} x 
     * @param {number} y 
     * @param {number} w 
     * @param {number} h 
     */
    strokeRect(x, y, w, h) {
        this.ctx.strokeRect(x, y, w, h);
    }

    /**
     * Draws a filled circle.
     * @param {number} x 
     * @param {number} y 
     * @param {number} radius 
     */
    fillCircle(x, y, radius) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Draws a stroked circle.
     * @param {number} x 
     * @param {number} y 
     * @param {number} radius 
     */
    strokeCircle(x, y, radius) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.stroke();
    }

    /**
     * Draws a line.
     * @param {number} x1 
     * @param {number} y1 
     * @param {number} x2 
     * @param {number} y2 
     */
    drawLine(x1, y1, x2, y2) {
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }

    /**
     * Draws a polygon from an array of vertices [x1, y1, x2, y2, ...].
     * @param {number} x Offset X
     * @param {number} y Offset Y
     * @param {number} rotation Rotation in radians
     * @param {number[]} vertices Array of relative coordinates
     * @param {boolean} closePath Whether to close the path
     */
    drawPoly(x, y, rotation, vertices, closePath = true) {
        if (vertices.length < 2) return;
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(rotation);
        
        this.ctx.beginPath();
        this.ctx.moveTo(vertices[0], vertices[1]);
        for (let i = 2; i < vertices.length; i += 2) {
            this.ctx.lineTo(vertices[i], vertices[i + 1]);
        }
        
        if (closePath) this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.restore();
    }
    
    fillPoly(x, y, rotation, vertices, closePath = true) {
        if (vertices.length < 2) return;
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(rotation);
        
        this.ctx.beginPath();
        this.ctx.moveTo(vertices[0], vertices[1]);
        for (let i = 2; i < vertices.length; i += 2) {
            this.ctx.lineTo(vertices[i], vertices[i + 1]);
        }
        
        if (closePath) this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }

    /**
     * Renders filled text.
     * @param {string} text 
     * @param {number} x 
     * @param {number} y 
     * @param {string} font 
     */
    fillText(text, x, y, font = '16px sans-serif') {
        this.ctx.font = font;
        this.ctx.fillText(text, x, y);
    }

    /**
     * Draws an image.
     * @param {HTMLImageElement} image 
     * @param {number} x 
     * @param {number} y 
     * @param {number} [w] 
     * @param {number} [h] 
     */
    drawImage(image, x, y, w, h) {
        if (!image || !image.complete) return;
        if (w !== undefined && h !== undefined) {
            this.ctx.drawImage(image, x, y, w, h);
        } else {
            this.ctx.drawImage(image, x, y);
        }
    }

    /**
     * Draws a portion of an image, optionally with rotation and scale.
     * @param {HTMLImageElement} image 
     * @param {number} sx Source x
     * @param {number} sy Source y
     * @param {number} sw Source width
     * @param {number} sh Source height
     * @param {number} dx Destination x
     * @param {number} dy Destination y
     * @param {number} dw Destination width
     * @param {number} dh Destination height
     * @param {number} rotation Rotation in radians
     */
    drawImageEx(image, sx, sy, sw, sh, dx, dy, dw, dh, rotation = 0) {
        if (!image || !image.complete) return;
        if (rotation !== 0) {
            this.ctx.save();
            this.ctx.translate(dx, dy);
            this.ctx.rotate(rotation);
            this.ctx.drawImage(image, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
            this.ctx.restore();
        } else {
            // Drawn centered on dx, dy by default here if using as entity sprite
            this.ctx.drawImage(image, sx, sy, sw, sh, dx - dw / 2, dy - dh / 2, dw, dh);
        }
    }
}
