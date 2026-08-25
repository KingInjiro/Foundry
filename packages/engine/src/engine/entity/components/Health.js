import { Component } from '../Component.js';

export class Health extends Component {
    constructor() {
        super();
        this.maxHealth = 100;
        this.currentHealth = 100;
        this.isDead = false;
        this.destroyOnDeath = true;
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) {
            this.currentHealth = 0;
            this.isDead = true;
        }
    }

    heal(amount) {
        if (this.isDead) return;
        this.currentHealth += amount;
        if (this.currentHealth > this.maxHealth) {
            this.currentHealth = this.maxHealth;
        }
    }

    serialize() {
        return {
            maxHealth: this.maxHealth,
            currentHealth: this.currentHealth,
            isDead: this.isDead,
            destroyOnDeath: this.destroyOnDeath
        };
    }

    deserialize(data) {
        if (data.maxHealth !== undefined) this.maxHealth = data.maxHealth;
        if (data.currentHealth !== undefined) this.currentHealth = data.currentHealth;
        if (data.isDead !== undefined) this.isDead = data.isDead;
        if (data.destroyOnDeath !== undefined) this.destroyOnDeath = data.destroyOnDeath;
    }
}
