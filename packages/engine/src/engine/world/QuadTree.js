export class QuadTree {
    constructor(x = 0, y = 0, width = 4000, height = 4000, maxObjects = 10, maxLevels = 5, level = 0, root = null) {
        this.bounds = { x, y, width, height }; // x,y is center
        this.maxObjects = maxObjects;
        this.maxLevels = maxLevels;
        this.level = level;
        this.objects = [];
        this.nodes = [];
        this.root = root || this;
        this.queryResult = [];
        
        if (level === 0) {
            this._queryId = 0;
        }
    }

    static pool = [];
    static get(x, y, width, height, maxObjects, maxLevels, level, root) {
        if (this.pool.length > 0) {
            const node = this.pool.pop();
            node.bounds.x = x;
            node.bounds.y = y;
            node.bounds.width = width;
            node.bounds.height = height;
            node.maxObjects = maxObjects;
            node.maxLevels = maxLevels;
            node.level = level;
            node.root = root;
            node.objects.length = 0;
            node.nodes.length = 0;
            return node;
        }
        return new QuadTree(x, y, width, height, maxObjects, maxLevels, level, root);
    }

    get queryId() {
        return this.root._queryId;
    }
    
    incrementQueryId() {
        if (this.level === 0) {
            this._queryId++;
        }
    }

    clear() {
        this.objects.length = 0;
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i]) {
                this.nodes[i].clear();
                QuadTree.pool.push(this.nodes[i]);
            }
        }
        this.nodes.length = 0;
    }

    split() {
        const subWidth = this.bounds.width / 2;
        const subHeight = this.bounds.height / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;
        const nextLvl = this.level + 1;
        
        // 0: top right
        this.nodes[0] = QuadTree.get(x + subWidth/2, y - subHeight/2, subWidth, subHeight, this.maxObjects, this.maxLevels, nextLvl, this.root);
        // 1: top left
        this.nodes[1] = QuadTree.get(x - subWidth/2, y - subHeight/2, subWidth, subHeight, this.maxObjects, this.maxLevels, nextLvl, this.root);
        // 2: bottom left
        this.nodes[2] = QuadTree.get(x - subWidth/2, y + subHeight/2, subWidth, subHeight, this.maxObjects, this.maxLevels, nextLvl, this.root);
        // 3: bottom right
        this.nodes[3] = QuadTree.get(x + subWidth/2, y + subHeight/2, subWidth, subHeight, this.maxObjects, this.maxLevels, nextLvl, this.root);
    }

    _getIndex(ex, ey, r) {
        const { x, y } = this.bounds;
        let index = -1;
        
        // Node center axes
        const top = ey + r < y;
        const bottom = ey - r > y;
        const left = ex + r < x;
        const right = ex - r > x;
        
        if (top) {
            if (right) index = 0;
            else if (left) index = 1;
        } else if (bottom) {
            if (left) index = 2;
            else if (right) index = 3;
        }
        
        return index;
    }

    _getEntityR(entity) {
        let r = entity.cullRadius || 0;
        if (entity.hasCollision) {
            let colR = (entity.colliderType === 'box' || entity.colliderType === 'rect') ? Math.max(entity.width || 0, entity.height || 0) / 2 : (entity.radius || 100);
            r = Math.max(r, colR);
        }
        return r;
    }

    insert(entity) {
        let r = this._getEntityR(entity);
        const ex = entity.globalX;
        const ey = entity.globalY;

        if (this.nodes.length > 0) {
            const index = this._getIndex(ex, ey, r);
            if (index !== -1) {
                this.nodes[index].insert(entity);
                return;
            }
        }

        this.objects.push(entity);

        if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
            if (this.nodes.length === 0) {
                this.split();
            }

            let i = 0;
            while (i < this.objects.length) {
                const e = this.objects[i];
                const itemR = this._getEntityR(e);
                const index = this._getIndex(e.globalX, e.globalY, itemR);
                if (index !== -1) {
                    this.nodes[index].insert(e);
                    // Fast array remove
                    this.objects[i] = this.objects[this.objects.length - 1];
                    this.objects.pop();
                } else {
                    i++;
                }
            }
        }
    }
    
    _intersectsAABB(ox, oy, hw, hh, nodeBounds) {
        const nhw = nodeBounds.width / 2;
        const nhh = nodeBounds.height / 2;
        
        if (Math.abs(ox - nodeBounds.x) > hw + nhw) return false;
        if (Math.abs(oy - nodeBounds.y) > hh + nhh) return false;
        
        return true;
    }

    queryAABB(x, y, width, height, outArray) {
        if (!outArray) {
            console.error("queryAABB called with no outArray");
            return;
        }
        outArray.length = 0;
        if (this.level === 0) this.incrementQueryId();
        const hw = width / 2;
        const hh = height / 2;
        this._queryAABBRecursive(x, y, hw, hh, outArray);
    }
    
    _queryAABBRecursive(ox, oy, hw, hh, outArray) {
        const qId = this.queryId;
        
        // Add objects in this node
        for (let i = 0; i < this.objects.length; i++) {
            const e = this.objects[i];
            if (e._gridQueryId !== qId) {
                e._gridQueryId = qId;
                outArray.push(e);
            }
        }
        
        // Recurse into children
        if (this.nodes.length > 0) {
            for (let i = 0; i < 4; i++) {
                if (this._intersectsAABB(ox, oy, hw, hh, this.nodes[i].bounds)) {
                    this.nodes[i]._queryAABBRecursive(ox, oy, hw, hh, outArray);
                }
            }
        }
    }

    queryRange(x, y, radius, outArray) {
        outArray.length = 0;
        if (this.level === 0) this.incrementQueryId();
        this._queryRangeRecursive(x, y, radius, radius * radius, outArray);
    }
    
    _queryRangeRecursive(ox, oy, radius, radSq, outArray) {
        const qId = this.queryId;
        
        // Add objects in this node
        for (let i = 0; i < this.objects.length; i++) {
            const e = this.objects[i];
            if (e._gridQueryId !== qId) {
                e._gridQueryId = qId;
                const dx = e.globalX - ox;
                const dy = e.globalY - oy;
                if (dx * dx + dy * dy <= radSq) {
                    outArray.push(e);
                }
            }
        }
        
        if (this.nodes.length > 0) {
            for (let i = 0; i < 4; i++) {
                if (this._intersectsAABB(ox, oy, radius, radius, this.nodes[i].bounds)) {
                    this.nodes[i]._queryRangeRecursive(ox, oy, radius, radSq, outArray);
                }
            }
        }
    }

    queryArea(x, y, radius) {
        this.queryResult.length = 0;
        this.queryAABB(x, y, radius * 2, radius * 2, this.queryResult);
        return this.queryResult;
    }

    _intersectsLineAABB(x1, y1, x2, y2, nodeBounds) {
        const hw = nodeBounds.width / 2;
        const hh = nodeBounds.height / 2;
        const minX = nodeBounds.x - hw;
        const maxX = nodeBounds.x + hw;
        const minY = nodeBounds.y - hh;
        const maxY = nodeBounds.y + hh;

        if ((x1 < minX && x2 < minX) || (x1 > maxX && x2 > maxX) || 
            (y1 < minY && y2 < minY) || (y1 > maxY && y2 > maxY)) {
            return false;
        }

        // Check if line segment intersects AABB
        const m = (y2 - y1) / (x2 - x1);
        if (m === Infinity || m === -Infinity) return true; // Vertical line
        if (m === 0) return true; // Horizontal line

        // Intersection points with AABB boundaries
        const yAtMinX = y1 + m * (minX - x1);
        const yAtMaxX = y1 + m * (maxX - x1);
        const xAtMinY = x1 + (minY - y1) / m;
        const xAtMaxY = x1 + (maxY - y1) / m;

        if ((yAtMinX >= minY && yAtMinX <= maxY) || 
            (yAtMaxX >= minY && yAtMaxX <= maxY) || 
            (xAtMinY >= minX && xAtMinY <= maxX) || 
            (xAtMaxY >= minX && xAtMaxY <= maxX) || 
            (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY)) {
            return true;
        }
        return false;
    }

    queryRay(x1, y1, x2, y2, outArray) {
        outArray.length = 0;
        if (this.level === 0) this.incrementQueryId();
        this._queryRayRecursive(x1, y1, x2, y2, outArray);
    }

    _queryRayRecursive(x1, y1, x2, y2, outArray) {
        const qId = this.queryId;

        // Add objects in this node
        for (let i = 0; i < this.objects.length; i++) {
            const e = this.objects[i];
            if (e._gridQueryId !== qId) {
                e._gridQueryId = qId;
                outArray.push(e);
            }
        }

        if (this.nodes.length > 0) {
            for (let i = 0; i < 4; i++) {
                if (this._intersectsLineAABB(x1, y1, x2, y2, this.nodes[i].bounds)) {
                    this.nodes[i]._queryRayRecursive(x1, y1, x2, y2, outArray);
                }
            }
        }
    }
}

