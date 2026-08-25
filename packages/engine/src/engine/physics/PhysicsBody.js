import Matter from 'matter-js';
import { Component } from '../entity/Component.js';
import { AutoPolygon } from './AutoPolygon.js';

export class PhysicsBody extends Component {
    constructor(options = {}) {
        super();
        this.init(options);
    }
    
    init(options = {}) {
        this.options = options;
        this.body = null;
        this.shape = options.shape || 'rectangle'; 
        this.width = options.width || 50;
        this.height = options.height || 50;
        this.radius = options.radius || 25;
        this.sides = options.sides || 5;
        this.vertices = options.vertices || null;
        this.autoImage = options.autoImage || null;
        this.tolerance = options.tolerance || 2.0;
        
        // Physics properties on the component for serialization/inspector
        this.isStatic = options.isStatic !== undefined ? options.isStatic : false;
        this.isKinematic = options.isKinematic !== undefined ? options.isKinematic : false;
        this.mass = options.mass !== undefined ? options.mass : 1;
        this.restitution = options.restitution !== undefined ? options.restitution : 0;
        this.friction = options.friction !== undefined ? options.friction : 0.1;
        
        // Push them into options for Matter.js
        // Create a clean options object for Matter.js to avoid passing nulls which break it
        this.matterOptions = {
            isStatic: this.isStatic,
            restitution: this.restitution,
            friction: this.friction,
            isSensor: options.isSensor || false
        };
        if (options.mass !== undefined) this.matterOptions.mass = this.mass;
        if (options.label) this.matterOptions.label = options.label;
        if (options.frictionAir !== undefined) this.matterOptions.frictionAir = options.frictionAir;
    }

    serialize() {
        return {
            shape: this.shape,
            width: this.width,
            height: this.height,
            radius: this.radius,
            sides: this.sides,
            vertices: this.vertices,
            autoImage: this.autoImage,
            tolerance: this.tolerance,
            isStatic: this.isStatic,
            isKinematic: this.isKinematic,
            mass: this.mass,
            restitution: this.restitution,
            friction: this.friction
        };
    }

    deserialize(data) {
        this.init(data);
    }

    
    onAwake() {
        this.createBody();
    }
    
    createBody() {
        if (this.body && this.entity.engine && this.entity.engine.world) {
            Matter.Composite.remove(this.entity.engine.world.physicsWorld, this.body);
        }
        
        const x = this.entity.globalX;
        const y = this.entity.globalY;
        
        if (this.shape === 'circle') {
            this.body = Matter.Bodies.circle(x, y, this.radius, this.matterOptions);
        } else if (this.shape === 'polygon') {
            this.body = Matter.Bodies.polygon(x, y, this.sides, this.radius, this.matterOptions);
        } else if (this.shape === 'auto' || this.shape === 'vertices') {
            let verts = this.vertices;
            if (this.shape === 'auto' && this.autoImage && this.entity.engine) {
                const img = this.entity.engine.assets.getImage(this.autoImage);
                if (img && img.width > 1) {
                    verts = AutoPolygon.generate(img, 128, this.tolerance);
                }
            }
            if (verts && verts.length > 0) {
                this.body = Matter.Bodies.fromVertices(x, y, [verts], this.matterOptions, true);
            } else {
                this.body = Matter.Bodies.rectangle(x, y, this.width, this.height, this.matterOptions);
            }
        } else {
            this.body = Matter.Bodies.rectangle(x, y, this.width, this.height, this.matterOptions);
        }
        
        this.body.entity = this.entity;
        // this.entity.body = this.body;
        
        if (this.entity.rotation) {
             Matter.Body.setAngle(this.body, this.entity.rotation);
        }
        
        if (this.entity.engine && this.entity.engine.world) {
            Matter.Composite.add(this.entity.engine.world.physicsWorld, this.body);
        }
    }
    
    
    get position() {
        return this.body ? this.body.position : {x: 0, y: 0};
    }
    
    get angle() {
        return this.body ? this.body.angle : 0;
    }
    
    setPosition(x, y) {
        if (this.body) Matter.Body.setPosition(this.body, {x, y});
    }
    
    get velocity() {
        if (!this.body) return {x: 0, y: 0};
        return { x: this.body.velocity.x * 60, y: this.body.velocity.y * 60 };
    }
    
    set velocity(v) {
        if (this.body) Matter.Body.setVelocity(this.body, {x: v.x / 60, y: v.y / 60});
    }
    
    setVelocity(x, y) {
        if (this.body) Matter.Body.setVelocity(this.body, {x: x / 60, y: y / 60});
    }

    setInertia(inertia) {
        if (this.body) Matter.Body.setInertia(this.body, inertia);
    }
    
    get angularVelocity() {
        return this.body ? this.body.angularVelocity : 0;
    }
    
    set angularVelocity(v) {
        if (this.body) Matter.Body.setAngularVelocity(this.body, v);
    }
    
    setAngularVelocity(v) {
        if (this.body) Matter.Body.setAngularVelocity(this.body, v);
    }
    
    setMass(mass) {
        this.mass = mass;
        if (this.body) Matter.Body.setMass(this.body, mass);
    }
    
    setStatic(isStatic) {
        this.isStatic = isStatic;
        if (this.body) Matter.Body.setStatic(this.body, isStatic);
    }
    
    setSensor(isSensor) {
        this.isSensor = isSensor;
        this.options.isSensor = isSensor;
        if (this.body) this.body.isSensor = isSensor;
    }

    setAngle(angle) {
        if (this.body) Matter.Body.setAngle(this.body, angle);
    }

    applyForce(x, y, position = null) {
        if (!this.body) return;
        if (typeof x === 'object') {
            position = y;
            y = x.y;
            x = x.x;
        }
        Matter.Body.applyForce(this.body, position || this.body.position, {x, y});
    }

    
    get bounds() {
        return this.body ? this.body.bounds : { min: {x: 0, y: 0}, max: {x: 0, y: 0} };
    }
    
    get parts() {
        return this.body ? this.body.parts : [];
    }
    
    onDestroy() {
        if (this.body && this.entity.engine && this.entity.engine.world) {
            Matter.Composite.remove(this.entity.engine.world.physicsWorld, this.body);
        }
        this.body = null;
    }
}
