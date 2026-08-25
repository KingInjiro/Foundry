import { Matrix4 } from './Matrix4.js';
import { GlobalTransforms } from './TransformManager.js';

export class Transform {
    constructor() {
        this.id = GlobalTransforms.allocate();
        
        this.localMatrix = new Matrix4(GlobalTransforms.getLocalMatrixView(this.id));
        this.worldMatrix = new Matrix4(GlobalTransforms.getWorldMatrixView(this.id));
        
        this.isDirty = true;
        this.positionDirty = false;
        this.rotationDirty = false;
    }
    
    get rotation() { return GlobalTransforms.localRotationZ[this.id]; }
    set rotation(v) { if(GlobalTransforms.localRotationZ[this.id] !== v) { GlobalTransforms.localRotationZ[this.id] = v; this.isDirty = true; this.rotationDirty = true; } }
    
    get rotationX() { return GlobalTransforms.localRotationX[this.id]; }
    set rotationX(v) { if(GlobalTransforms.localRotationX[this.id] !== v) { GlobalTransforms.localRotationX[this.id] = v; this.isDirty = true; this.rotationDirty = true; } }
    
    get rotationY() { return GlobalTransforms.localRotationY[this.id]; }
    set rotationY(v) { if(GlobalTransforms.localRotationY[this.id] !== v) { GlobalTransforms.localRotationY[this.id] = v; this.isDirty = true; this.rotationDirty = true; } }
    
    get rotationZ() { return GlobalTransforms.localRotationZ[this.id]; }
    set rotationZ(v) { if(GlobalTransforms.localRotationZ[this.id] !== v) { GlobalTransforms.localRotationZ[this.id] = v; this.isDirty = true; this.rotationDirty = true; }
        this.scaleDirty = false;
    }
    
    destroy() {
        GlobalTransforms.free(this.id);
    }
    
    get x() { return GlobalTransforms.localX[this.id]; }
    set x(v) { if(GlobalTransforms.localX[this.id] !== v) { GlobalTransforms.localX[this.id] = v; this.isDirty = true; this.positionDirty = true; } }
    
    get y() { return GlobalTransforms.localY[this.id]; }
    set y(v) { if(GlobalTransforms.localY[this.id] !== v) { GlobalTransforms.localY[this.id] = v; this.isDirty = true; this.positionDirty = true; } }
    
    get z() { return GlobalTransforms.localZ[this.id]; }
    set z(v) { if(GlobalTransforms.localZ[this.id] !== v) { GlobalTransforms.localZ[this.id] = v; this.isDirty = true; this.positionDirty = true; } }
    
    
    
    get scaleX() { return GlobalTransforms.localScaleX[this.id]; }
    set scaleX(v) { if(GlobalTransforms.localScaleX[this.id] !== v) { GlobalTransforms.localScaleX[this.id] = v; this.isDirty = true; this.scaleDirty = true; } }
    
    get scaleY() { return GlobalTransforms.localScaleY[this.id]; }
    set scaleY(v) { if(GlobalTransforms.localScaleY[this.id] !== v) { GlobalTransforms.localScaleY[this.id] = v; this.isDirty = true; this.scaleDirty = true; } }
    
    get scaleZ() { return GlobalTransforms.localScaleZ[this.id]; }
    set scaleZ(v) { if(GlobalTransforms.localScaleZ[this.id] !== v) { GlobalTransforms.localScaleZ[this.id] = v; this.isDirty = true; this.scaleDirty = true; } }
    
    setFromPhysics(x, y, rotation) {
        if (GlobalTransforms.localX[this.id] !== x || GlobalTransforms.localY[this.id] !== y || GlobalTransforms.localRotationZ[this.id] !== rotation) {
            GlobalTransforms.localX[this.id] = x;
            GlobalTransforms.localY[this.id] = y;
            GlobalTransforms.localRotationZ[this.id] = rotation;
            this.isDirty = true;
        }
    }
    
    updateLocalMatrix() {
        if (this.isDirty) {
            this.localMatrix.compose(
                GlobalTransforms.localX[this.id], 
                GlobalTransforms.localY[this.id], 
                GlobalTransforms.localZ[this.id], 
                GlobalTransforms.localRotationX[this.id],
                GlobalTransforms.localRotationY[this.id],
                GlobalTransforms.localRotationZ[this.id], 
                GlobalTransforms.localScaleX[this.id], 
                GlobalTransforms.localScaleY[this.id], 
                GlobalTransforms.localScaleZ[this.id]
            );
            this.isDirty = false;
            return true;
        }
        return false;
    }
    
    updateWorldMatrix(parentWorldMatrix, parentDirty) {
        const localDirty = this.updateLocalMatrix();
        const worldDirty = localDirty || parentDirty;
        
        if (worldDirty) {
            if (parentWorldMatrix) {
                this.worldMatrix.multiplyMatrices(parentWorldMatrix, this.localMatrix);
            } else {
                this.worldMatrix.copy(this.localMatrix);
            }
        }
        
        return worldDirty;
    }
    
    get globalX() { return this.worldMatrix.data[12]; }
    get globalY() { return this.worldMatrix.data[13]; }
    get globalZ() { return this.worldMatrix.data[14]; }
    
    get globalRotation() { 
        return Math.atan2(this.worldMatrix.data[1], this.worldMatrix.data[0]);
    }
    get globalScaleX() {
        const d = this.worldMatrix.data;
        return Math.sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]);
    }
    get globalScaleY() {
        const d = this.worldMatrix.data;
        return Math.sqrt(d[4]*d[4] + d[5]*d[5] + d[6]*d[6]);
    }
}
