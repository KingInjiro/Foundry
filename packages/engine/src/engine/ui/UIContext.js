/**
 * Lightweight, zero-allocation Immediate Mode GUI (IMGUI) system.
 * Renders directly on the Canvas in screen-space and handles input capturing.
 */
export class UIContext {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        
        /** @type {string|number|null} ID of the currently hovered element */
        this.hot = null;
        /** @type {string|number|null} ID of the currently pressed element */
        this.active = null;
        /** @type {boolean} True if the UI is capturing mouse input this frame */
        this.wantsCaptureMouse = false;
    }

    /**
     * Prepares the UI state for the current frame.
     */
    begin() {
        if (this.engine.renderer.setZ) this.engine.renderer.setZ(100000, 0); // UI layer
        this.hot = null;
        this.wantsCaptureMouse = false;
    }

    /**
     * Finalizes UI state and handles global input releases.
     */
    end() {
        const mouse = this.engine.input.mouse;
        
        // Clear active state if mouse is released or not pressed
        if (!mouse.isButtonDown(0)) {
            this.active = null;
        }
    }

    /**
     * Checks if the mouse is currently hovering over the specified bounds.
     * @private
     */
    _hitTest(x, y, w, h) {
        const mouse = this.engine.input.mouse;
        return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
    }

    /**
     * Draws a background panel and captures input if hovered.
     * @param {number} x 
     * @param {number} y 
     * @param {number} w 
     * @param {number} h 
     * @param {string} bgColor 
     */
    panel(x, y, w, h, bgColor = 'rgba(30, 30, 30, 0.8)') {
        const r = this.engine.renderer;
        
        r.setFillStyle(bgColor);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.fill(); } else { r.fillRect(x, y, w, h); }
        
        if (this._hitTest(x, y, w, h)) {
            this.wantsCaptureMouse = true;
        }
    }

    /**
     * Draws screen-space text.
     * @param {string} string 
     * @param {number} x 
     * @param {number} y 
     * @param {string} color 
     * @param {string} font 
     */
    text(string, x, y, color = '#ffffff', font = '14px monospace') {
        const r = this.engine.renderer;
        r.setFillStyle(color);
        r.fillText(string, x, y, font);
    }

    /**
     * Renders an interactive button.
     * @param {string|number} id Unique identifier for the button.
     * @param {string} label Button text.
     * @param {number} x 
     * @param {number} y 
     * @param {number} w 
     * @param {number} h 
     * @returns {boolean} True if the button was clicked this frame.
     */
    button(id, label, x, y, w, h) {
        const r = this.engine.renderer;
        const mouse = this.engine.input.mouse;
        
        let clicked = false;
        
        // Hover Check
        if (this._hitTest(x, y, w, h)) {
            this.hot = id;
            this.wantsCaptureMouse = true;
        }

        // Active Check (Pressed)
        if (this.hot === id && this.active === null && mouse.isButtonPressed(0)) {
            this.active = id;
        }

        // Click Check (Released while still hovered and active)
        if (this.active === id && mouse.isButtonReleased(0)) {
            if (this.hot === id) {
                clicked = true;
            }
            this.active = null;
        }

        // Rendering state
        let bgColor = '#444444';
        if (this.active === id) {
            bgColor = '#222222';
        } else if (this.hot === id) {
            bgColor = '#555555';
        }
        
        r.setFillStyle(bgColor);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.fill(); } else { r.fillRect(x, y, w, h); }
        
        r.setStrokeStyle('#666666');
        r.setLineWidth(1);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.stroke(); } else { r.strokeRect(x, y, w, h); }
        
        r.setFillStyle('#ffffff');
        // Simple label centering approximation
        r.fillText(label, x + 8, y + h / 2 + 5, '14px monospace'); 
        
        return clicked;
    }

    /**
     * Renders an interactive slider.
     * @param {string|number} id Unique identifier.
     * @param {string} label Label text.
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @param {number} min
     * @param {number} max
     * @param {number} value
     * @returns {number} The updated value.
     */
    slider(id, label, x, y, w, h, min, max, value) {
        const r = this.engine.renderer;
        const mouse = this.engine.input.mouse;
        
        // Hover Check
        if (this._hitTest(x, y, w, h)) {
            this.hot = id;
            this.wantsCaptureMouse = true;
        }

        // Active Check (Pressed)
        if (this.hot === id && this.active === null && mouse.isButtonPressed(0)) {
            this.active = id;
        }

        // Update value if active
        let newValue = value;
        if (this.active === id) {
            if (mouse.isButtonDown(0)) {
                let px = mouse.x - x;
                px = Math.max(0, Math.min(px, w));
                const pct = px / w;
                newValue = min + pct * (max - min);
            }
        }

        // Render background
        r.setFillStyle('#333333');
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.fill(); } else { r.fillRect(x, y, w, h); }
        
        // Render fill
        const fillPct = (newValue - min) / (max - min);
        r.setFillStyle(this.active === id ? '#60a5fa' : (this.hot === id ? '#3b82f6' : '#2563eb'));
        r.fillRect(x, y, w * fillPct, h);

        r.setStrokeStyle('#666666');
        r.setLineWidth(1);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.stroke(); } else { r.strokeRect(x, y, w, h); }

        r.setFillStyle('#ffffff');
        r.fillText(`${label}: ${newValue.toFixed(2)}`, x + 8, y + h / 2 + 5, '12px monospace');
        
        return newValue;
    }

    /**
     * Renders a progress bar.
     */
    progressBar(x, y, w, h, value, max = 1.0, color = '#10b981', bgColor = '#333333') {
        const r = this.engine.renderer;
        
        r.setFillStyle(bgColor);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.fill(); } else { r.fillRect(x, y, w, h); }
        
        const pct = Math.max(0, Math.min(value / max, 1.0));
        
        r.setFillStyle(color);
        r.fillRect(x, y, w * pct, h);
        
        r.setStrokeStyle('#666666');
        r.setLineWidth(1);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, w, h, 6); r.stroke(); } else { r.strokeRect(x, y, w, h); }
    }

    /**
     * Renders a checkbox.
     */
    checkbox(id, label, x, y, size, checked) {
        const r = this.engine.renderer;
        const mouse = this.engine.input.mouse;
        
        let toggled = false;
        
        // Hover Check (hit area includes label approx)
        const hitW = size + 8 + (label.length * 8);
        if (this._hitTest(x, y, hitW, size)) {
            this.hot = id;
            this.wantsCaptureMouse = true;
        }

        if (this.hot === id && this.active === null && mouse.isButtonPressed(0)) {
            this.active = id;
        }

        if (this.active === id && mouse.isButtonReleased(0)) {
            if (this.hot === id) {
                toggled = true;
            }
            this.active = null;
        }
        
        let bgColor = '#444444';
        if (this.active === id) {
            bgColor = '#222222';
        } else if (this.hot === id) {
            bgColor = '#555555';
        }

        r.setFillStyle(bgColor);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, size, size, 4); r.fill(); } else { r.fillRect(x, y, size, size); }
        
        r.setStrokeStyle('#666666');
        r.setLineWidth(1);
        if(r.roundRect) { r.beginPath(); r.roundRect(x, y, size, size, 4); r.stroke(); } else { r.strokeRect(x, y, size, size); }
        
        if (checked || (toggled && !checked) || (!toggled && checked)) {
            let state = checked;
            if (toggled) state = !state;
            if (state) {
                r.setFillStyle('#3b82f6');
                if(r.roundRect) { r.beginPath(); r.roundRect(x + 4, y + 4, size - 8, size - 8, 2); r.fill(); } else { r.fillRect(x + 4, y + 4, size - 8, size - 8); }
            }
        }
        
        r.setFillStyle('#ffffff');
        r.fillText(label, x + size + 8, y + size / 2 + 4, '14px monospace');
        
        return toggled ? !checked : checked;
    }

}