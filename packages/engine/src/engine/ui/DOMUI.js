export class UIElement {
    constructor(type = 'div', options = {}) {
        this.element = document.createElement(type);
        this.children = [];
        this.parent = null;
        
        this.element.style.position = 'absolute';
        this.element.style.boxSizing = 'border-box';
        
        if (options.id) this.element.id = options.id;
        if (options.className) this.element.className = options.className;
        
        this.setAnchor(options.anchor || 'top-left');
        
        // Flexbox properties for container
        if (options.layout === 'flex') {
            this.element.style.display = 'flex';
            this.element.style.flexDirection = options.flexDirection || 'row';
            this.element.style.justifyContent = options.justifyContent || 'flex-start';
            this.element.style.alignItems = options.alignItems || 'stretch';
            this.element.style.gap = (options.gap || 0) + 'px';
            this.element.style.flexWrap = options.flexWrap || 'nowrap';
        }
        
        if (options.x !== undefined) this.element.style.left = options.x + 'px';
        if (options.y !== undefined) this.element.style.top = options.y + 'px';
        if (options.width !== undefined) this.element.style.width = typeof options.width === 'number' ? options.width + 'px' : options.width;
        if (options.height !== undefined) this.element.style.height = typeof options.height === 'number' ? options.height + 'px' : options.height;
        
        if (options.style) {
            Object.assign(this.element.style, options.style);
        }
    }
    
    setAnchor(anchor) {
        this.element.style.top = 'auto';
        this.element.style.bottom = 'auto';
        this.element.style.left = 'auto';
        this.element.style.right = 'auto';
        this.element.style.transform = 'none';
        
        switch (anchor) {
            case 'center':
                this.element.style.top = '50%';
                this.element.style.left = '50%';
                this.element.style.transform = 'translate(-50%, -50%)';
                break;
            case 'top-center':
                this.element.style.top = '0';
                this.element.style.left = '50%';
                this.element.style.transform = 'translateX(-50%)';
                break;
            case 'bottom-center':
                this.element.style.bottom = '0';
                this.element.style.left = '50%';
                this.element.style.transform = 'translateX(-50%)';
                break;
            case 'left-center':
                this.element.style.top = '50%';
                this.element.style.left = '0';
                this.element.style.transform = 'translateY(-50%)';
                break;
            case 'right-center':
                this.element.style.top = '50%';
                this.element.style.right = '0';
                this.element.style.transform = 'translateY(-50%)';
                break;
            case 'top-right':
                this.element.style.top = '0';
                this.element.style.right = '0';
                break;
            case 'bottom-left':
                this.element.style.bottom = '0';
                this.element.style.left = '0';
                break;
            case 'bottom-right':
                this.element.style.bottom = '0';
                this.element.style.right = '0';
                break;
            case 'fill':
                this.element.style.top = '0';
                this.element.style.left = '0';
                this.element.style.right = '0';
                this.element.style.bottom = '0';
                this.element.style.width = '100%';
                this.element.style.height = '100%';
                break;
            case 'top-left':
            default:
                this.element.style.top = '0';
                this.element.style.left = '0';
                break;
        }
    }
    
    add(child) {
        if (child.parent) {
            child.parent.remove(child);
        }
        
        // If parent is a flex container, child shouldn't be absolute anymore
        if (this.element.style.display === 'flex') {
            child.element.style.position = 'relative';
            child.element.style.transform = 'none';
            child.element.style.top = 'auto';
            child.element.style.left = 'auto';
            child.element.style.right = 'auto';
            child.element.style.bottom = 'auto';
        }
        
        this.children.push(child);
        child.parent = this;
        this.element.appendChild(child.element);
        return this;
    }
    
    remove(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
            this.element.removeChild(child.element);
        }
    }
    
    destroy() {
        if (this.parent) {
            this.parent.remove(this);
        } else if (this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        [...this.children].forEach(c => c.destroy());
    }
    
    on(event, handler) {
        this.element.addEventListener(event, handler);
        return this;
    }
}

export class UIPanel extends UIElement {
    constructor(options = {}) {
        super('div', options);
        this.element.style.backgroundColor = options.backgroundColor || 'rgba(20, 20, 20, 0.85)';
        this.element.style.borderRadius = (options.borderRadius !== undefined ? options.borderRadius : 8) + 'px';
        this.element.style.padding = (options.padding !== undefined ? options.padding : 16) + 'px';
        this.element.style.pointerEvents = 'auto';
        this.element.style.color = 'white';
        this.element.style.fontFamily = 'monospace';
        
        if (options.border) {
            this.element.style.border = options.border;
        } else {
            this.element.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        }
        
        if (options.backdropFilter) {
            this.element.style.backdropFilter = options.backdropFilter;
        }
    }
}

export class UIButton extends UIElement {
    constructor(text, options = {}) {
        super('button', options);
        this.element.innerText = text;
        this.element.style.backgroundColor = options.backgroundColor || '#2563eb';
        this.element.style.color = options.color || '#ffffff';
        this.element.style.border = options.border || 'none';
        this.element.style.borderRadius = (options.borderRadius !== undefined ? options.borderRadius : 6) + 'px';
        this.element.style.padding = options.padding || '8px 16px';
        this.element.style.cursor = 'pointer';
        this.element.style.pointerEvents = 'auto';
        this.element.style.fontFamily = 'monospace';
        this.element.style.fontWeight = 'bold';
        this.element.style.transition = 'background-color 0.1s ease';
        this.element.style.outline = 'none';
        
        const baseColor = this.element.style.backgroundColor;
        const hoverColor = options.hoverColor || '#3b82f6';
        const activeColor = options.activeColor || '#1d4ed8';
        
        this.element.addEventListener('mouseenter', () => {
            this.element.style.backgroundColor = hoverColor;
        });
        this.element.addEventListener('mouseleave', () => {
            this.element.style.backgroundColor = baseColor;
        });
        this.element.addEventListener('mousedown', () => {
            this.element.style.backgroundColor = activeColor;
        });
        this.element.addEventListener('mouseup', () => {
            this.element.style.backgroundColor = hoverColor;
        });
        
        if (options.onClick) {
            this.onClick(options.onClick);
        }
    }
    
    onClick(handler) {
        this.on('click', handler);
        return this;
    }
}

export class UILabel extends UIElement {
    constructor(text, options = {}) {
        super('div', options);
        this.element.innerText = text;
        this.element.style.color = options.color || '#ffffff';
        this.element.style.fontSize = (options.fontSize || 14) + 'px';
        this.element.style.fontFamily = 'monospace';
        this.element.style.pointerEvents = 'none';
        this.element.style.userSelect = 'none';
        this.element.style.whiteSpace = 'nowrap';
    }
    
    setText(text) {
        this.element.innerText = text;
    }
}

export class UISlider extends UIElement {
    constructor(min, max, value, options = {}) {
        super('input', options);
        this.element.type = 'range';
        this.element.min = min;
        this.element.max = max;
        this.element.value = value;
        this.element.step = options.step || 1;
        this.element.style.pointerEvents = 'auto';
        this.element.style.cursor = 'pointer';
        
        if (options.onChange) {
            this.on('input', (e) => options.onChange(parseFloat(e.target.value)));
        }
    }
    
    getValue() {
        return parseFloat(this.element.value);
    }
    
    setValue(val) {
        this.element.value = val;
    }
}

export class UIManager {
    constructor(engine) {
        this.engine = engine;
        this.container = null;
        this.children = [];
        this.enabled = true;
    }
    
    init() {
        if (this.engine.isHeadless) return;
        
        this.container = document.createElement('div');
        this.container.id = 'foundry-ui-root';
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.pointerEvents = 'none'; // Pass through clicks to canvas by default
        this.container.style.overflow = 'hidden';
        this.container.style.zIndex = '1000';
        
        const canvasContainer = this.engine.canvas.element.parentNode;
        if (canvasContainer) {
            canvasContainer.appendChild(this.container);
        }
    }
    
    add(child) {
        this.children.push(child);
        if (this.container) {
            this.container.appendChild(child.element);
        }
        return child;
    }
    
    remove(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            if (this.container && this.container.contains(child.element)) {
                this.container.removeChild(child.element);
            }
        }
    }
    
    clear() {
        this.children.forEach(c => {
            if (this.container && this.container.contains(c.element)) {
                this.container.removeChild(c.element);
            }
        });
        this.children = [];
    }
    
    show() {
        this.enabled = true;
        if (this.container) this.container.style.display = 'block';
    }
    
    hide() {
        this.enabled = false;
        if (this.container) this.container.style.display = 'none';
    }
    
    dispose() {
        this.clear();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
