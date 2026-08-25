export class VirtualControls {
    constructor(engine) {
        this.engine = engine;
        this.container = null;
        this.joystick = { active: false, x: 0, y: 0, originX: 0, originY: 0, touchId: null, base: null, knob: null };
        this.buttons = {};
        this.enabled = false;
        
        this._onTouchStart = this.onTouchStart.bind(this);
        this._onTouchMove = this.onTouchMove.bind(this);
        this._onTouchEnd = this.onTouchEnd.bind(this);
        
        // Expose virtual inputs to Input manager
        this.virtualAxes = { Horizontal: 0, Vertical: 0 };
        this.virtualButtonsDown = {};
        this.virtualButtonsPressed = {};
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        this.container = document.createElement('div');
        this.container.id = 'foundry-virtual-controls';
        Object.assign(this.container.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', 
            pointerEvents: 'none', zIndex: '9999', touchAction: 'none'
        });
        
        const canvasContainer = this.engine.canvas.element.parentNode;
        if (canvasContainer) {
            canvasContainer.appendChild(this.container);
            canvasContainer.addEventListener('touchstart', this._onTouchStart, { passive: false });
            canvasContainer.addEventListener('touchmove', this._onTouchMove, { passive: false });
            canvasContainer.addEventListener('touchend', this._onTouchEnd, { passive: false });
            canvasContainer.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
        }
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        const canvasContainer = this.engine.canvas.element.parentNode;
        if (canvasContainer) {
            canvasContainer.removeEventListener('touchstart', this._onTouchStart);
            canvasContainer.removeEventListener('touchmove', this._onTouchMove);
            canvasContainer.removeEventListener('touchend', this._onTouchEnd);
            canvasContainer.removeEventListener('touchcancel', this._onTouchEnd);
        }
    }
    
    addJoystick() {
        if (!this.enabled) this.enable();
        if (this.joystick.base) return;
        
        this.joystick.base = document.createElement('div');
        Object.assign(this.joystick.base.style, {
            position: 'absolute', bottom: '40px', left: '40px', width: '120px', height: '120px',
            backgroundColor: 'rgba(255, 255, 255, 0.2)', border: '2px solid rgba(255, 255, 255, 0.4)',
            borderRadius: '50%', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center'
        });
        
        this.joystick.knob = document.createElement('div');
        Object.assign(this.joystick.knob.style, {
            width: '50px', height: '50px', backgroundColor: 'rgba(255, 255, 255, 0.6)',
            borderRadius: '50%', pointerEvents: 'none', transition: 'transform 0.05s ease-out',
            transform: 'translate(0px, 0px)'
        });
        
        this.joystick.base.appendChild(this.joystick.knob);
        this.container.appendChild(this.joystick.base);
    }
    
    addButton(name, label = '', style = {}) {
        if (!this.enabled) this.enable();
        
        const btn = document.createElement('div');
        Object.assign(btn.style, {
            position: 'absolute', bottom: '40px', right: '40px', width: '70px', height: '70px',
            backgroundColor: 'rgba(255, 255, 255, 0.2)', border: '2px solid rgba(255, 255, 255, 0.4)',
            borderRadius: '50%', pointerEvents: 'auto', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', userSelect: 'none',
            ...style
        });
        btn.innerText = label || name;
        btn.dataset.action = name;
        
        this.buttons[name] = { element: btn, touchId: null, isDown: false };
        this.container.appendChild(btn);
    }
    
    onTouchStart(e) {
        e.preventDefault();
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // Check buttons
            let hitButton = false;
            for (const name in this.buttons) {
                const btn = this.buttons[name];
                const rect = btn.element.getBoundingClientRect();
                
                // Expanding hit area a bit
                if (touch.clientX >= rect.left - 20 && touch.clientX <= rect.right + 20 &&
                    touch.clientY >= rect.top - 20 && touch.clientY <= rect.bottom + 20) {
                    
                    btn.touchId = touch.identifier;
                    btn.isDown = true;
                    btn.element.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
                    
                    if (!this.virtualButtonsDown[name]) {
                        this.virtualButtonsPressed[name] = true;
                    }
                    this.virtualButtonsDown[name] = true;
                    hitButton = true;
                }
            }
            
            if (hitButton) continue;
            
            // Check joystick (left side of screen)
            if (this.joystick.base && !this.joystick.active && touch.clientX < window.innerWidth / 2) {
                this.joystick.active = true;
                this.joystick.touchId = touch.identifier;
                
                const rect = this.joystick.base.getBoundingClientRect();
                this.joystick.originX = rect.left + rect.width / 2;
                this.joystick.originY = rect.top + rect.height / 2;
                
                this.updateJoystick(touch.clientX, touch.clientY);
            }
        }
    }
    
    onTouchMove(e) {
        e.preventDefault();
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (this.joystick.active && this.joystick.touchId === touch.identifier) {
                this.updateJoystick(touch.clientX, touch.clientY);
            }
        }
    }
    
    onTouchEnd(e) {
        e.preventDefault();
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (this.joystick.active && this.joystick.touchId === touch.identifier) {
                this.joystick.active = false;
                this.joystick.touchId = null;
                this.joystick.x = 0;
                this.joystick.y = 0;
                this.virtualAxes.Horizontal = 0;
                this.virtualAxes.Vertical = 0;
                if (this.joystick.knob) {
                    this.joystick.knob.style.transform = `translate(0px, 0px)`;
                }
            }
            
            for (const name in this.buttons) {
                const btn = this.buttons[name];
                if (btn.touchId === touch.identifier) {
                    btn.touchId = null;
                    btn.isDown = false;
                    btn.element.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                    this.virtualButtonsDown[name] = false;
                }
            }
        }
    }
    
    updateJoystick(tx, ty) {
        const dx = tx - this.joystick.originX;
        const dy = ty - this.joystick.originY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const maxDist = 60;
        
        let nx = dx;
        let ny = dy;
        
        if (dist > maxDist) {
            nx = (dx / dist) * maxDist;
            ny = (dy / dist) * maxDist;
        }
        
        this.joystick.x = nx / maxDist;
        this.joystick.y = ny / maxDist;
        
        this.virtualAxes.Horizontal = this.joystick.x;
        this.virtualAxes.Vertical = this.joystick.y;
        
        if (this.joystick.knob) {
            this.joystick.knob.style.transform = `translate(${nx}px, ${ny}px)`;
        }
    }
    
    reset() {
        this.virtualButtonsPressed = {};
    }
}
