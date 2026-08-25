/**
 * Tracks mouse states, position, and wheel events.
 */
export class Mouse {
    /**
     * @param {HTMLCanvasElement} canvasElement 
     */
    constructor(canvasElement, engine) {
        this.engine = engine;
        this.canvas = canvasElement;
        
        this.x = 0;
        this.y = 0;
        this.wheelX = 0;
        this.wheelY = 0;
        
        /** @type {Map<number, boolean>} */
        this.buttons = new Map();
        /** @type {Map<number, boolean>} */
        this.buttonsPressed = new Map();
        /** @type {Map<number, boolean>} */
        this.buttonsReleased = new Map();

        /** @type {number[]} */
        this.activePressed = [];
        /** @type {number[]} */
        this.activeReleased = [];

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);

        
        const target = self;
        
        
        
        
        
    }

    /**
     * @param {MouseEvent} e 
     */
    updatePosition(e) {
        if (e.clientX !== undefined) {
            this.x = e.clientX;
            this.y = e.clientY;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        // Since canvas CSS width is 100% and scale happens via context.scale(dpr),
        // bounding client rect corresponds directly to renderer coordinates.
        this.x = e.clientX - rect.left;
        this.y = e.clientY - rect.top;
    }

    /**
     * @param {MouseEvent} e 
     */
    onMouseMove(e) {
        this.updatePosition(e);
    }

    /**
     * @param {MouseEvent} e 
     */
    onMouseDown(e) {
        console.log("Worker mousedown:", e.button, e.clientX, e.clientY);
        this.updatePosition(e);
        const button = e.button;
        if (!this.buttons.get(button)) {
            this.buttonsPressed.set(button, true);
            this.activePressed.push(button);
        }
        this.buttons.set(button, true);
    }

    /**
     * @param {MouseEvent} e 
     */
    onMouseUp(e) {
        console.log("Worker mouseup:", e.button);
        this.updatePosition(e);
        const button = e.button;
        this.buttons.set(button, false);
        
        this.buttonsReleased.set(button, true);
        this.activeReleased.push(button);
    }

    /**
     * @param {WheelEvent} e 
     */
    onWheel(e) {
        this.wheelX = e.deltaX;
        this.wheelY = e.deltaY;
    }

    /**
     * @param {MouseEvent} e 
     */
    onContextMenu(e) {
        e.preventDefault();
    }

    /**
     * Returns true if the mouse button is currently held down.
     * @param {number} button 0: Left, 1: Middle, 2: Right
     * @returns {boolean}
     */

    get leftDown() { return this.isButtonDown(0) && (!this.engine || !this.engine.ui || !this.engine.ui.wantsCaptureMouse); }
    get rightDown() { return this.isButtonDown(2) && (!this.engine || !this.engine.ui || !this.engine.ui.wantsCaptureMouse); }

    isButtonDown(button) {
        return !!this.buttons.get(button);
    }

    /**
     * Returns true if the mouse button was pressed this frame.
     * @param {number} button 
     * @returns {boolean}
     */
    isButtonPressed(button) {
        return !!this.buttonsPressed.get(button);
    }

    /**
     * Returns true if the mouse button was released this frame.
     * @param {number} button 
     * @returns {boolean}
     */
    isButtonReleased(button) {
        return !!this.buttonsReleased.get(button);
    }

    /**
     * Clears single-frame states.
     */
    reset() {
        for (let i = 0; i < this.activePressed.length; i++) {
            this.buttonsPressed.set(this.activePressed[i], false);
        }
        this.activePressed.length = 0;

        for (let i = 0; i < this.activeReleased.length; i++) {
            this.buttonsReleased.set(this.activeReleased[i], false);
        }
        this.activeReleased.length = 0;

        this.wheelX = 0;
        this.wheelY = 0;
    }

    /**
     * Cleans up event listeners.
     */
        dispose() {
        const target = self;
        target.removeEventListener('mousemove', this.onMouseMove);
        target.removeEventListener('mousedown', this.onMouseDown);
        target.removeEventListener('mouseup', this.onMouseUp);
        target.removeEventListener('wheel', this.onWheel);
        target.removeEventListener('contextmenu', this.onContextMenu);
    }
}
