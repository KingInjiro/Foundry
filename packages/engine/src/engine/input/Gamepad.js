export class GamepadManager {
    constructor() {
        this.gamepads = {};
        this.state = {};
        this.previousState = {};
        
        this._onGamepadConnected = this._onGamepadConnected.bind(this);
        this._onGamepadDisconnected = this._onGamepadDisconnected.bind(this);
        
        if (typeof window !== 'undefined') {
            window.addEventListener("gamepadconnected", this._onGamepadConnected);
            window.addEventListener("gamepaddisconnected", this._onGamepadDisconnected);
        }
    }
    
    _onGamepadConnected(e) {
        this.gamepads[e.gamepad.index] = e.gamepad;
    }
    
    _onGamepadDisconnected(e) {
        delete this.gamepads[e.gamepad.index];
    }
    
    update() {
        if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
        
        // Copy current to previous
        for (const index in this.state) {
            this.previousState[index] = {
                buttons: [...this.state[index].buttons],
                axes: [...this.state[index].axes]
            };
        }
        
        const gps = navigator.getGamepads();
        for (let i = 0; i < gps.length; i++) {
            const gp = gps[i];
            if (gp) {
                this.gamepads[gp.index] = gp;
                
                if (!this.state[gp.index]) {
                    this.state[gp.index] = { buttons: [], axes: [] };
                    this.previousState[gp.index] = { buttons: [], axes: [] };
                }
                
                for (let b = 0; b < gp.buttons.length; b++) {
                    this.state[gp.index].buttons[b] = gp.buttons[b].pressed;
                }
                
                for (let a = 0; a < gp.axes.length; a++) {
                    this.state[gp.index].axes[a] = gp.axes[a];
                }
            }
        }
    }
    
    getAxis(index, axisIndex) {
        if (this.state[index] && this.state[index].axes.length > axisIndex) {
            return this.state[index].axes[axisIndex];
        }
        return 0;
    }
    
    getButton(index, buttonIndex) {
        if (this.state[index] && this.state[index].buttons.length > buttonIndex) {
            return this.state[index].buttons[buttonIndex];
        }
        return false;
    }
    
    getButtonDown(index, buttonIndex) {
        const curr = this.getButton(index, buttonIndex);
        const prev = this.previousState[index] && this.previousState[index].buttons.length > buttonIndex ? this.previousState[index].buttons[buttonIndex] : false;
        return curr && !prev;
    }
    
    dispose() {
        if (typeof window !== 'undefined') {
            window.removeEventListener("gamepadconnected", this._onGamepadConnected);
            window.removeEventListener("gamepaddisconnected", this._onGamepadDisconnected);
        }
    }
}
