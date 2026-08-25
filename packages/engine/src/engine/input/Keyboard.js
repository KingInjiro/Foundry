/**
 * Tracks keyboard states and events with zero allocations on the main loop.
 */
export class Keyboard {
    constructor() {
        /** @type {Map<string, boolean>} */
        this.keys = new Map();
        /** @type {Map<string, boolean>} */
        this.keysPressed = new Map();
        /** @type {Map<string, boolean>} */
        this.keysReleased = new Map();

        /** @type {string[]} */
        this.activePressed = [];
        /** @type {string[]} */
        this.activeReleased = [];

        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);

        
        const target = self;  
         
        
    }

    /**
     * @param {KeyboardEvent} e 
     */
    onKeyDown(e) {
        const key = e.code;
        if (!this.keys.get(key)) {
            this.keysPressed.set(key, true);
            this.activePressed.push(key);
        }
        this.keys.set(key, true);
    }

    /**
     * @param {KeyboardEvent} e 
     */
    onKeyUp(e) {
        const key = e.code;
        this.keys.set(key, false);
        this.keysReleased.set(key, true);
        this.activeReleased.push(key);
    }

    /**
     * Returns true if the key is currently held down.
     * @param {string} key e.g. "KeyW", "Space"
     * @returns {boolean}
     */
    isDown(key) {
        return this.isKeyDown(key);
    }

    /**
     * Returns true if the key is currently held down.
     * @param {string} key e.g. "KeyW", "Space"
     * @returns {boolean}
     */
    isKeyDown(key) {
        return !!this.keys.get(key);
    }

    /**
     * Returns true if the key was pressed this frame.
     * @param {string} key 
     * @returns {boolean}
     */
    isPressed(key) {
        return this.isKeyPressed(key);
    }

    /**
     * Returns true if the key was pressed this frame.
     * @param {string} key 
     * @returns {boolean}
     */
    isKeyPressed(key) {
        if (key === 'Space') {
            const isDown = this.isDown(key);
            const isPressed = !!this.keysPressed.get(key);
            if (isDown) console.log('Space isDown:', isDown, 'isPressed:', isPressed, 'dashTimer', this.dashTimer);
        }
        return !!this.keysPressed.get(key);
    }

    /**
     * Returns true if the key was released this frame.
     * @param {string} key 
     * @returns {boolean}
     */
    isReleased(key) {
        return this.isKeyReleased(key);
    }

    /**
     * Returns true if the key was released this frame.
     * @param {string} key 
     * @returns {boolean}
     */
    isKeyReleased(key) {
        return !!this.keysReleased.get(key);
    }

    /**
     * Clears single-frame states.
     * Must be called at the end of the engine loop.
     */
    reset() {
        for (let i = 0; i < this.activePressed.length; i++) {
            this.keysPressed.set(this.activePressed[i], false);
        }
        this.activePressed.length = 0;

        for (let i = 0; i < this.activeReleased.length; i++) {
            this.keysReleased.set(this.activeReleased[i], false);
        }
        this.activeReleased.length = 0;
    }

    /**
     * Cleans up event listeners.
     */
    dispose() {
        const target = self;
        target.removeEventListener('keydown', this.onKeyDown);
        target.removeEventListener('keyup', this.onKeyUp);
    }
}
