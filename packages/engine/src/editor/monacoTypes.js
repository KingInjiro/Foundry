export const foundryTypes = `
declare namespace window {
    export const Foundry: {
        Component: typeof Component;
        Simulation: typeof Simulation;
        Entity: typeof Entity;
    };
}

/** 
 * Base class for all entities in the game world.
 */


/**
 * Base class for all Components attached to Entities.
 */
declare class MeshRenderer extends Component {
    constructor(options?: any);
}

declare class Light3D extends Component {
    constructor(options?: any);
}

declare class Component {
    entity: Entity;
    enabled: boolean;
    
    constructor();
    onAwake(): void;
    onStart(): void;
    onUpdate(dt: number): void;
    onFixedUpdate(fixedDelta: number): void;
    onRender(renderer: Renderer2D, camera: Camera2D): void;
    onDestroy(): void;
}

declare class AutoPolygon {
    static generate(image: HTMLImageElement | ImageBitmap, threshold?: number, tolerance?: number): {x: number, y: number}[];
}

declare class SoftBody extends Component {
    constructor(options?: any);
    columns: number;
    rows: number;
    color: string;
}
declare class PhysicsConstraint extends Component {
    constraint: any;
    targetEntity: Entity | null;
    pointA: {x: number, y: number};
    pointB: {x: number, y: number};
    stiffness: number;
    damping: number;
    length?: number;
    constructor(options?: any);
}

declare class PhysicsBody extends Component {
    body: any;
    shape: 'rectangle' | 'circle' | 'polygon' | 'auto' | 'vertices';
    constructor(options?: any);
}

declare class Entity {
    id: number;
    tag: string;
    layer: number;
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    vx: number;
    vy: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    z: number;
    vz: number;
    scaleZ: number;
    parent: Entity | null;
    children: Entity[];
    globalX: number;
    globalY: number;
    globalZ: number;
    globalRotation: number;
    globalScaleX: number;
    globalScaleY: number;
    addChild(child: Entity): void;
    removeChild(child: Entity): void;
    startCoroutine(routine: Generator): void;
    depth: number;
    _gridQueryId: number;
    cullRadius: number;
    
    // Physics properties
    isStatic: boolean;
    isKinematic: boolean;
    mass: number;
    drag: number;
    angularVelocity: number;
    angularDrag: number;
    restitution: number;
    hasCollision: boolean;
    radius: number;
    colliderType: 'circle' | 'box';
    width: number;
    height: number;
    
    active: boolean;
    visible: boolean;
    isDestroyed: boolean;
    
    world: World;
    engine: Engine;
    
    constructor();
    
    /** Marks the entity for garbage-free pooling/removal. */
    
    components: Component[];
    addComponent<T extends Component>(component: T): T;
    getComponent<T extends Component>(componentClass: { new(...args: any[]): T }): T | null;

    /**
     * Casts a ray into the world from this entity's position or a custom origin.
     * @param angle The angle in radians
     * @param maxDistance Maximum ray distance
     * @param originX Starting X (defaults to this.globalX)
     * @param originY Starting Y (defaults to this.globalY)
     */
    raycast(angle: number, maxDistance: number, originX?: number, originY?: number): {hit: boolean, distance: number, point: {x: number, y: number}, entity: any, isMatterBody: boolean};

    destroy(): void;
    
    /** Called when the entity is added to the World. */
    onSpawn(world: World): void;
    
    /** Called on fixed physics step. */
    onFixedUpdate(fixedDelta: number): void;
    
    /** Called every frame for logic updates. */
    onUpdate(dt: number): void;
    
    /** Called during rendering if within camera bounds. */
    onRender(renderer: Renderer2D, camera: Camera2D): void;
    
    /** Called when the entity is removed from the World. */
    onDestroy(): void;
}

/**
 * Abstract base class for custom simulations on the Foundry Engine platform.
 */
declare class Simulation {
    engine: Engine;
    clearColor: string;
    clearAlpha: number;
    
    constructor(engine: Engine);
    
    /**
     * Casts a ray into the world to find intersections with entities or physics bodies.
     * @param originX Starting X coordinate
     * @param originY Starting Y coordinate
     * @param angle The angle in radians
     * @param maxDistance Maximum distance for the ray
     * @returns Object containing hit information
     */
    raycast(originX: number, originY: number, angle: number, maxDistance: number): {hit: boolean, distance: number, point: {x: number, y: number}, entity: any, isMatterBody: boolean};
    
    /** Called once when the simulation is registered or first loaded. */
    onInitialize(): void;
    
    /** Called every time the simulation becomes the active simulation. */
    onStart(): void;
    
    /** Called on fixed physics steps. */
    onFixedUpdate(fixedDelta: number): void;
    
    /** Called every frame for logic updates. */
    onUpdate(dt: number): void;
    
    /** Called during the world rendering phase, within camera transformations. */
    onRender(renderer: Renderer2D, camera: Camera2D): void;
    
    /** Called during the screen-space rendering phase for IMGUI. */
    onUI(ui: UIContext): void;
    
    /** Called when the simulation is swapped out or stopped. */
    onStop(): void;
    
    /** Called when the simulation is being destroyed or removed completely. */
    onTeardown(): void;
}

/**
 * Central hub holding systems (events, time, loop, window).
 */
declare class Engine {
    world: World;
    camera: Camera2D;
    assets: AssetManager;
    input: InputManager;
    canvas: any;
    renderer: Renderer2D;
    ui: UIContext;
    time: Time;
}

declare class Time {
    deltaTime: number;
    unscaledDeltaTime: number;
    timeScale: number;
    fps: number;
    now: number;
}

/**
 * Manages loading and retrieving images and sounds.
 */
declare class AssetManager {
    loadImage(name: string, url: string): HTMLImageElement;
    loadSound(name: string, url: string): HTMLAudioElement;
    loadJSON(name: string, url: string): Promise<any>;
    loadText(name: string, url: string): Promise<string>;
    loadFont(name: string, url: string): Promise<void>;
    getImage(name: string): HTMLImageElement | undefined;
    getJSON(name: string): any;
    getText(name: string): string | undefined;
    playSound(name: string, volume?: number): void;
    getProgress(): number;
    waitForAll(): Promise<void>;
}

declare class KeyboardState {
    isDown(code: string): boolean;
    isPressed(code: string): boolean;
    isKeyDown(code: string): boolean; // Alias for isDown
}

declare class MouseState {
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    wheelY: number;
    leftDown: boolean;
    rightDown: boolean;
}

declare class GamepadState {
    getAxis(index: number, axisIndex: number): number;
    getButton(index: number, buttonIndex: number): boolean;
    getButtonDown(index: number, buttonIndex: number): boolean;
}

declare class InputManager {
    keyboard: KeyboardState;
    mouse: MouseState;
    gamepad: GamepadState;
}

declare class Renderer2D {
    ctx: CanvasRenderingContext2D;
    setFillStyle(color: string): void;
    setStrokeStyle(color: string): void;
    setLineWidth(width: number): void;
    setGlobalAlpha(alpha: number): void;
    setGlobalCompositeOperation(operation: string): void;
    
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    drawLine(x1: number, y1: number, x2: number, y2: number): void;
    drawCircle(x: number, y: number, radius: number): void;
    fillText(text: string, x: number, y: number): void;
}

declare class Camera2D {
    x: number;
    y: number;
    zoom: number;
    targetX: number;
    targetY: number;
    targetZoom: number;
    lerpSpeed: number;
    zoomLerpSpeed: number;
    
    follow(x: number, y: number): void;
    zoomTo(zoom: number): void;
    set(x: number, y: number, zoom?: number): void;
    screenToWorld(screenX: number, screenY: number, out: {x: number, y: number}): {x: number, y: number};
    worldToScreen(worldX: number, worldY: number, out: {x: number, y: number}): {x: number, y: number};
    getBounds(): {xMin: number, yMin: number, xMax: number, yMax: number};
}

declare class EntityManager {
    entities: Entity[];
    add(entity: Entity): Entity;
    getByTag(tag: string): Entity[];
    getByComponent(componentName: string): Entity[];
    get count(): number;
}

declare class World {
    isInfinite: boolean;
    width: number;
    height: number;
    gravityX: number;
    gravityY: number;
    entities: EntityManager;
    raycast(x1: number, y1: number, x2: number, y2: number, radius?: number): Entity | null;
}

/**
 * IMGUI context for debugging/menus.
 */
declare class UIContext {
    text(text: string, x: number, y: number, color?: string, font?: string): void;
    button(id: string, label: string, x: number, y: number, w: number, h: number): boolean;
    slider(id: string, label: string, x: number, y: number, w: number, h: number, min: number, max: number, value: number): number;
    checkbox(id: string, label: string, x: number, y: number, size: number, value: boolean): boolean;
    panel(x: number, y: number, w: number, h: number, title?: string): void;
}

    declare class ObjectPool {
        constructor(factory: () => any, initialSize?: number);
        get(): any;
        release(obj: any): void;
    }
    declare class Mathf {
        static clamp(value: number, min: number, max: number): number;
        static clamp01(value: number): number;
        static lerp(a: number, b: number, t: number): number;
        static lerpUnclamped(a: number, b: number, t: number): number;
        static moveTowards(current: number, target: number, maxDelta: number): number;
        static pingPong(t: number, length: number): number;
        static smoothStep(from: number, to: number, t: number): number;
        static deg2Rad(deg: number): number;
        static rad2Deg(rad: number): number;
    }

    declare class Animator extends Component {
        constructor();
        add(name: string, frames: number[], fps?: number, loop?: boolean): void;
        play(name: string): void;
        stop(): void;
    }
    
    declare class TextRenderer extends Component {
        constructor();
        text: string;
        font: string;
        color: string;
        textAlign: string;
        textBaseline: string;
    }
    declare class ShapeRenderer extends Component {
        constructor();
        shape: string;
        width: number;
        height: number;
        radius: number;
        fillStyle: string;
        strokeStyle: string;
        lineWidth: number;
        endX: number;
        endY: number;
        vertices: {x: number, y: number}[];
    }
    declare class SpriteAnimator {
        constructor(image: HTMLImageElement, frameWidth: number, frameHeight: number);
        image: HTMLImageElement;
        frameWidth: number;
        frameHeight: number;
        currentAnimation: string | null;
        isPlaying: boolean;
        
        add(name: string, frames: number[], fps?: number, loop?: boolean): void;
        play(name: string): void;
        stop(): void;
        update(dt: number): void;
        render(renderer: Renderer2D, x: number, y: number, width?: number, height?: number, rotation?: number): void;
    }

    declare class Tilemap extends Entity {
        constructor(tileSize: number, columns: number, rows: number, tilesetImage?: HTMLImageElement | null);
        tileSize: number;
        columns: number;
        rows: number;
        tilesetImage: HTMLImageElement | null;
        
        setTileset(image: HTMLImageElement): void;
        setTile(col: number, row: number, tileIndex: number): void;
        getTile(col: number, row: number): number;
        fill(col: number, row: number, width: number, height: number, tileIndex: number): void;
        worldToGrid(worldX: number, worldY: number): { col: number, row: number };
    }

    declare class PhysicsConstraint extends Component {
    constraint: any;
    targetEntity: Entity | null;
    pointA: {x: number, y: number};
    pointB: {x: number, y: number};
    stiffness: number;
    damping: number;
    length?: number;
    constructor(options?: any);
}

declare class PhysicsBody extends Component {
        constructor(options?: any);
        body: any;
        shape: string;
        applyForce(force: {x: number, y: number}, position?: {x: number, y: number}): void;
        setVelocity(velocity: {x: number, y: number}): void;
    }
    

    declare class ParticleEmitter extends Entity {
        constructor(config?: any);
        emit(count: number): void;
        isEmitting: boolean;
        color: string;
        blendMode: string;
        gravityX: number;
        gravityY: number;
    }
`;

export class SpriteAnimator {
    constructor(image, frameWidth, frameHeight) {}
    add(name, frames, fps, loop) {}
    play(name) {}
    stop() {}
    update(dt) {}
    render(renderer, x, y, width, height, rotation) {}
}

export class Tilemap {
    constructor(tileSize, columns, rows, tilesetImage) {}
    setTileset(image) {}
    setTile(col, row, tileIndex) {}
    getTile(col, row) {}
    fill(col, row, width, height, tileIndex) {}
    worldToGrid(worldX, worldY) {}
}

export class PhysicsBody {
    constructor(options) {}
    applyForce(force, position) {}
    setVelocity(velocity) {}
}

export class ParticleEmitter {
    constructor(config) {}
    emit(count) {}
}

