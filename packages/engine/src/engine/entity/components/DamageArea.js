import { Component } from '../Component.js';

export class DamageArea extends Component {
    constructor() {
        super();
        this.damage = 10;
        this.radius = 50; // for simple distance checks if physics is not used
        this.continuous = false;
        this.damageInterval = 1.0;
        this.destroyOnDamage = true; // For projectiles
        
        /** @private */
        this._timer = 0;
    }

    serialize() {
        return {
            damage: this.damage,
            radius: this.radius,
            continuous: this.continuous,
            damageInterval: this.damageInterval,
            destroyOnDamage: this.destroyOnDamage
        };
    }

    deserialize(data) {
        if (data.damage !== undefined) this.damage = data.damage;
        if (data.radius !== undefined) this.radius = data.radius;
        if (data.continuous !== undefined) this.continuous = data.continuous;
        if (data.damageInterval !== undefined) this.damageInterval = data.damageInterval;
        if (data.destroyOnDamage !== undefined) this.destroyOnDamage = data.destroyOnDamage;
    }
}
