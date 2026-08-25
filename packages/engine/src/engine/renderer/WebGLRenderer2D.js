const CMD_QUAD = 1;
const CMD_STROKE_RECT = 2;
const CMD_FILL_CIRCLE = 3;
const CMD_STROKE_CIRCLE = 4;
const CMD_DRAW_LINE = 5;
const CMD_DRAW_POLY = 6;
const CMD_FILL_TEXT = 7;
const CMD_INSTANCED = 8;

class RenderCommand {
    constructor() {
        this.type = 0;
        this.layer = 0;
        this.z = 0;
        this.order = 0;
        
        // Quad Data
        this.tx0=0; this.ty0=0; this.u0=0; this.v0=0;
        this.tx1=0; this.ty1=0; this.u1=0; this.v1=0;
        this.tx2=0; this.ty2=0; this.u2=0; this.v2=0;
        this.tx3=0; this.ty3=0; this.u3=0; this.v3=0;
        this.texIdx=0;
        this.r=1; this.g=1; this.b=1; this.a=1;
        
        // Ctx2D Data
        this.m0=1; this.m1=0; this.m3=0; this.m4=1; this.m6=0; this.m7=0;
        this.n0=0; this.n1=0; this.n2=0; this.n3=0;
        this.obj = null;
        this.str = null;
        this.obj2 = null;
        
        // State
        this.fillStyle = null;
        this.strokeStyle = null;
        this.lineWidth = 1;
        this.globalAlpha = 1;
        this.composite = 'source-over';
    }
}
// Custom WebGL 2D Batch Renderer

class DynamicTextureAtlas {
    constructor(gl, width = 2048, height = 2048) {
        this.gl = gl;
        this.width = width;
        this.height = height;
        this.currentX = 0;
        this.currentY = 0;
        this.rowHeight = 0;
        
        // We use an offscreen canvas to store the image data since WebGL needs a source
        this.canvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(width, height) : document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        this.map = new Map();
    }
    
    pack(image) {
        if (this.map.has(image)) return this.map.get(image);
        
        const pad = 2;
        if (this.currentX + image.width + pad > this.width) {
            this.currentY += this.rowHeight + pad;
            this.currentX = 0;
            this.rowHeight = 0;
        }
        
        if (this.currentY + image.height + pad > this.height) {
            return null; // Atlas full
        }
        
        this.ctx.drawImage(image, this.currentX, this.currentY);
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, this.currentX, this.currentY, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
        
        const uv = {
            u0: this.currentX / this.width,
            v0: this.currentY / this.height,
            u1: (this.currentX + image.width) / this.width,
            v1: (this.currentY + image.height) / this.height
        };
        
        this.rowHeight = Math.max(this.rowHeight, image.height);
        this.currentX += image.width + pad;
        
        this.map.set(image, uv);
        return uv;
    }
}

export class WebGLRenderer2D {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.gl = canvasManager.gl;
        this.ctx2d = canvasManager.context2d;
        
        this.width = canvasManager.engine.window.width;
        this.height = canvasManager.engine.window.height;
        
        this.ext = this.gl.vertexAttribDivisor ? { vertexAttribDivisorANGLE: this.gl.vertexAttribDivisor.bind(this.gl), drawElementsInstancedANGLE: this.gl.drawElementsInstanced.bind(this.gl) } : this.gl.getExtension('ANGLE_instanced_arrays');
        this.initWebGL();
        
        // State
        this.currentFillStyle = [1, 1, 1, 1];
        this.currentGlobalAlpha = 1.0;
        
        // Batching
        this.MAX_BATCH = 10000;
        this.vertexData = new Float32Array(this.MAX_BATCH * 4 * 9); // 4 verts per quad, 9 floats per vert (x, y, u, v, r, g, b, a, texIndex)
        this.indexData = new Uint16Array(this.MAX_BATCH * 6); // 6 indices per quad
        for (let i = 0, j = 0; i < this.MAX_BATCH; i++) {
            this.indexData[j++] = i * 4;
            this.indexData[j++] = i * 4 + 1;
            this.indexData[j++] = i * 4 + 2;
            this.indexData[j++] = i * 4;
            this.indexData[j++] = i * 4 + 2;
            this.indexData[j++] = i * 4 + 3;
        }
        this.commandPool = [];
        for(let i=0; i<20000; i++) this.commandPool.push(new RenderCommand());
        this.commandQueue = [];
        this.commandCount = 0;
        this.currentLayer = 0;
        this.currentZ = 0;
        this.vertexCount = 0;
        this.drawCalls = 0;
        
        // Instancing state
        this.MAX_INSTANCES = 20000;
        this.instanceData = new Float32Array(this.MAX_INSTANCES * 14); // 9 for mat3, 4 for color, 1 for texIdx = 14
        this.instanceCount = 0;
        this.instanceBaseQuad = new Float32Array([
             0.5,  0.0, 1, 0.5, // 10, 0 -> normalized 0.5, 0
            -0.3,  0.5, 0, 1,   // -6, 10 -> normalized -0.3, 0.5
            -0.3, -0.5, 0, 0,   // -6, -10 -> normalized -0.3, -0.5
            -0.3, -0.5, 0, 0    // degenerate triangle to match 6 indices
        ]);
        this.instanceQuadBuffer = this.gl.createBuffer();
        
        this.initWebGL();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceQuadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceBaseQuad, this.gl.STATIC_DRAW);
        
        this.instanceBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
        
        this.indexCount = 0;
        
        for (let i = 0, j = 0; i < this.MAX_BATCH * 6; i += 6, j += 4) {
            this.indexData[i + 0] = j + 0;
            this.indexData[i + 1] = j + 1;
            this.indexData[i + 2] = j + 2;
            this.indexData[i + 3] = j + 0;
            this.indexData[i + 4] = j + 2;
            this.indexData[i + 5] = j + 3;
        }
        
        this.vbo = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertexData.byteLength, this.gl.DYNAMIC_DRAW);
        
        this.ibo = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.indexData, this.gl.STATIC_DRAW);
        
        // Textures
        this.textures = [];
        this.maxTextures = Math.min(8, this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS));
        this.textureCache = new Map();
        this.textureInfoCache = new Map();
        this.atlas = new DynamicTextureAtlas(this.gl, 2048, 2048);
        
        this.setupAttributes();
        
        // White texture for untextured rendering
        this.whiteTex = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.whiteTex);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    
    setZ(layer, z) {
        this.currentLayer = layer || 0;
        this.currentZ = z || 0;
    }
    
    _getCommand() {
        if (this.commandCount >= this.commandPool.length) {
            this.commandPool.push(new RenderCommand());
        }
        const cmd = this.commandPool[this.commandCount++];
        cmd.layer = this.currentLayer;
        cmd.z = this.currentZ;
        cmd.order = this.commandCount;
        return cmd;
    }
    
    _captureCtx2DState(cmd) {
        const m = this.currentMatrix;
        cmd.m0 = m[0]; cmd.m1 = m[1]; cmd.m3 = m[3]; cmd.m4 = m[4]; cmd.m6 = m[6]; cmd.m7 = m[7];
        cmd.strokeStyle = this.ctx2d.strokeStyle;
        cmd.fillStyle = this.ctx2d.fillStyle;
        cmd.lineWidth = this.ctx2d.lineWidth;
        cmd.globalAlpha = this.currentGlobalAlpha;
        cmd.composite = this.ctx2d.globalCompositeOperation;
    }
    
    _applyCtx2DState(cmd) {
        this.flush();
        const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
        this.ctx2d.setTransform(cmd.m0 * dpr, cmd.m1 * dpr, cmd.m3 * dpr, cmd.m4 * dpr, cmd.m6 * dpr, cmd.m7 * dpr);
        this.ctx2d.strokeStyle = cmd.strokeStyle;
        this.ctx2d.fillStyle = cmd.fillStyle;
        this.ctx2d.lineWidth = cmd.lineWidth;
        this.ctx2d.globalAlpha = cmd.globalAlpha;
        this.ctx2d.globalCompositeOperation = cmd.composite;
    }
    
    executeQueue() {
        this.commandQueue.length = this.commandCount;
        this.commandQueue.sort((a, b) => {
            if (a.layer !== b.layer) return (a.layer || 0) - (b.layer || 0);
            if (a.z !== b.z) return (a.z || 0) - (b.z || 0);
            return a.order - b.order;
        });
        
        for (let i = 0; i < this.commandCount; i++) {
            const cmd = this.commandQueue[i];
            if (cmd.type === CMD_QUAD) {
                this._internalPushQuad(cmd);
            } else if (cmd.type === CMD_INSTANCED) {
                this._internalDrawInstanced(cmd.obj, cmd.n0, cmd.obj2, cmd.n1, cmd.n2, cmd);
            } else {
                this._applyCtx2DState(cmd);
                if (cmd.type === CMD_STROKE_RECT) {
                    this.ctx2d.strokeRect(cmd.n0, cmd.n1, cmd.n2, cmd.n3);
                } else if (cmd.type === CMD_FILL_CIRCLE) {
                    this.ctx2d.beginPath();
                    this.ctx2d.arc(cmd.n0, cmd.n1, cmd.n2, 0, Math.PI * 2);
                    this.ctx2d.fill();
                } else if (cmd.type === CMD_STROKE_CIRCLE) {
                    this.ctx2d.beginPath();
                    this.ctx2d.arc(cmd.n0, cmd.n1, cmd.n2, 0, Math.PI * 2);
                    this.ctx2d.stroke();
                } else if (cmd.type === CMD_DRAW_LINE) {
                    this.ctx2d.beginPath();
                    this.ctx2d.moveTo(cmd.n0, cmd.n1);
                    this.ctx2d.lineTo(cmd.n2, cmd.n3);
                    this.ctx2d.stroke();
                } else if (cmd.type === CMD_DRAW_POLY) {
                    this.ctx2d.beginPath();
                    const vertices = cmd.obj;
                    this.ctx2d.moveTo(vertices[0], vertices[1]);
                    for (let j = 2; j < vertices.length; j += 2) {
                        this.ctx2d.lineTo(vertices[j], vertices[j + 1]);
                    }
                    if (cmd.n0) this.ctx2d.closePath(); // closePath boolean
                    this.ctx2d.stroke();
                } else if (cmd.type === CMD_FILL_TEXT) {
                    this.ctx2d.font = cmd.str;
                    this.ctx2d.fillText(cmd.obj, cmd.n0, cmd.n1); // obj is text string
                }
            }
        }
        
        this.commandCount = 0;
        this.commandQueue.length = 0;
        this.flush();
    }

    initWebGL() {
        const gl = this.gl;
        const vsSource = `
            attribute vec2 aPos;
            attribute vec2 aUV;
            attribute vec4 aColor;
            attribute float aTexIdx;
            
            uniform vec2 uResolution;
            
            varying vec2 vUV;
            varying vec4 vColor;
            varying float vTexIdx;
            
            void main() {
                vec2 clipSpace = (aPos / uResolution) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
                vUV = aUV;
                vColor = aColor;
                vTexIdx = aTexIdx;
            }
        `;
        
        const fsSource = `
            precision mediump float;
            varying vec2 vUV;
            varying vec4 vColor;
            varying float vTexIdx;
            
            uniform sampler2D uTextures[8]; // Max 8 for wide compatibility
            
            void main() {
                vec4 texColor = vec4(1.0);
                
                // Need standard if-else since array indexing with non-constant is limited in WebGL 1
                int idx = int(vTexIdx);
                if (idx == 0) texColor = texture2D(uTextures[0], vUV);
                else if (idx == 1) texColor = texture2D(uTextures[1], vUV);
                else if (idx == 2) texColor = texture2D(uTextures[2], vUV);
                else if (idx == 3) texColor = texture2D(uTextures[3], vUV);
                else if (idx == 4) texColor = texture2D(uTextures[4], vUV);
                else if (idx == 5) texColor = texture2D(uTextures[5], vUV);
                else if (idx == 6) texColor = texture2D(uTextures[6], vUV);
                else if (idx == 7) texColor = texture2D(uTextures[7], vUV);
                
                gl_FragColor = texColor * vColor;
            }
        `;
        
        this.shader = this.createProgram(vsSource, fsSource);
        gl.useProgram(this.shader);
        
        this.uResolution = gl.getUniformLocation(this.shader, "uResolution");
        this.uTransform = gl.getUniformLocation(this.shader, "uTransform");
        
        const samplers = [];
        for (let i = 0; i < 8; i++) samplers.push(i);
        gl.uniform1iv(gl.getUniformLocation(this.shader, "uTextures"), samplers);

        const instVsSource = `
            attribute vec2 aPos;
            attribute vec2 aUV;
            
            attribute vec3 aMatRow0;
            attribute vec3 aMatRow1;
            attribute vec3 aMatRow2;
            attribute vec4 aInstanceColor;
            attribute float aInstanceTexIdx;
            
            uniform vec2 uResolution;
            uniform mat3 uTransform;
            
            varying vec2 vUV;
            varying vec4 vColor;
            varying float vTexIdx;
            
            void main() {
                mat3 instanceMat = mat3(
                    aMatRow0.x, aMatRow0.y, aMatRow0.z,
                    aMatRow1.x, aMatRow1.y, aMatRow1.z,
                    aMatRow2.x, aMatRow2.y, aMatRow2.z
                );
                
                vec3 worldPos = instanceMat * vec3(aPos, 1.0);
                vec3 pos = uTransform * worldPos;
                vec2 clipSpace = (pos.xy / uResolution) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
                vUV = aUV;
                vColor = aInstanceColor;
                vTexIdx = aInstanceTexIdx;
            }
        `;
        
        this.instShader = this.createProgram(instVsSource, fsSource);
        gl.useProgram(this.instShader);
        gl.uniform1iv(gl.getUniformLocation(this.instShader, "uTextures"), samplers);
        
        gl.useProgram(this.shader);

        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // Matrix stack for 2D transform mirroring ctx.save/restore
        this.matrixStack = [];
        this.matrixPool = [];
        this.currentMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    
    createProgram(vsSource, fsSource) {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }
    
    setupAttributes() {
        const gl = this.gl;
        const stride = 9 * 4;
        const aPos = gl.getAttribLocation(this.shader, "aPos");
        const aUV = gl.getAttribLocation(this.shader, "aUV");
        const aColor = gl.getAttribLocation(this.shader, "aColor");
        const aTexIdx = gl.getAttribLocation(this.shader, "aTexIdx");
        
        gl.enableVertexAttribArray(aPos);
        gl.enableVertexAttribArray(aUV);
        gl.enableVertexAttribArray(aColor);
        gl.enableVertexAttribArray(aTexIdx);
        
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 8);
        gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 16);
        gl.vertexAttribPointer(aTexIdx, 1, gl.FLOAT, false, stride, 32);
    }
    
    getTexture(img) {
        if (!img) return this.whiteTex;
        if (this.textureCache.has(img)) return this.textureCache.get(img);
        
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        this.textureCache.set(img, tex);
        return tex;
    }
    
    getTextureInfo(image) {
        if (this.textureInfoCache.has(image)) return this.textureInfoCache.get(image);
        
        if (image.width <= 512 && image.height <= 512) {
            const uv = this.atlas.pack(image);
            if (uv) {
                const info = { isAtlas: true, uv, tex: this.atlas.texture };
                this.textureInfoCache.set(image, info);
                return info;
            }
        }
        
        const tex = this.getTexture(image);
        const info = { isAtlas: false, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, tex };
        this.textureInfoCache.set(image, info);
        return info;
    }

    getTextureIndex(tex) {
        let idx = this.textures.indexOf(tex);
        if (idx !== -1) return idx;
        
        if (this.textures.length >= 8) {
            this.flush();
        }
        
        this.textures.push(tex);
        return this.textures.length - 1;
    }
    
    
    begin() {
        this.drawCalls = 0;
        const win = this.canvasManager.engine.window;
        this.width = win.width;
        this.height = win.height;
        if (this.ctx2d) {
            this.ctx2d.clearRect(0, 0, win.width, win.height);
        }
        this.save();
    }
    end() { 
        this.executeQueue();
        this.restore();
    }
    clear() {
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        if (this.ctx2d) {
            const win = this.canvasManager.engine.window;
            this.ctx2d.clearRect(0, 0, win.width, win.height);
        }
    }
    flush() {
        if (this.vertexCount === 0) return;
        
        const gl = this.gl;
        gl.useProgram(this.shader);
        
        for (let i = 0; i < this.textures.length; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
        }
        
        gl.uniform2f(this.uResolution, this.width, this.height);
        // gl.uniformMatrix3fv(this.uTransform, false, this.currentMatrix); removed for CPU batching
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.vertexCount * 9));
        
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
        this.drawCalls++;
        
        this.vertexCount = 0;
        this.indexCount = 0;
        this.textures.length = 0;
    }
    
    _internalPushQuad(cmd) {
        if (this.vertexCount >= this.MAX_BATCH * 4) {
            this.flush();
        }
        
        const vd = this.vertexData;
        let offset = this.vertexCount * 9;
        
        // V0
        vd[offset++] = cmd.tx0; vd[offset++] = cmd.ty0; vd[offset++] = cmd.u0; vd[offset++] = cmd.v0;
        vd[offset++] = cmd.r; vd[offset++] = cmd.g; vd[offset++] = cmd.b; vd[offset++] = cmd.a; vd[offset++] = cmd.texIdx;
        // V1
        vd[offset++] = cmd.tx1; vd[offset++] = cmd.ty1; vd[offset++] = cmd.u1; vd[offset++] = cmd.v1;
        vd[offset++] = cmd.r; vd[offset++] = cmd.g; vd[offset++] = cmd.b; vd[offset++] = cmd.a; vd[offset++] = cmd.texIdx;
        // V2
        vd[offset++] = cmd.tx2; vd[offset++] = cmd.ty2; vd[offset++] = cmd.u2; vd[offset++] = cmd.v2;
        vd[offset++] = cmd.r; vd[offset++] = cmd.g; vd[offset++] = cmd.b; vd[offset++] = cmd.a; vd[offset++] = cmd.texIdx;
        // V3
        vd[offset++] = cmd.tx3; vd[offset++] = cmd.ty3; vd[offset++] = cmd.u3; vd[offset++] = cmd.v3;
        vd[offset++] = cmd.r; vd[offset++] = cmd.g; vd[offset++] = cmd.b; vd[offset++] = cmd.a; vd[offset++] = cmd.texIdx;
        
        this.indexCount += 6;
        
        this.vertexCount += 4;
    }
    
    pushQuad(x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2, x3, y3, u3, v3, texIdx, r, g, b, a) {
        const cmd = this._getCommand();
        cmd.type = CMD_QUAD;
        
        const m = this.currentMatrix;
        const m00 = m[0], m01 = m[1], m10 = m[3], m11 = m[4], m20 = m[6], m21 = m[7];
        
        cmd.tx0 = x0 * m00 + y0 * m10 + m20;
        cmd.ty0 = x0 * m01 + y0 * m11 + m21;
        cmd.tx1 = x1 * m00 + y1 * m10 + m20;
        cmd.ty1 = x1 * m01 + y1 * m11 + m21;
        cmd.tx2 = x2 * m00 + y2 * m10 + m20;
        cmd.ty2 = x2 * m01 + y2 * m11 + m21;
        cmd.tx3 = x3 * m00 + y3 * m10 + m20;
        cmd.ty3 = x3 * m01 + y3 * m11 + m21;
        
        cmd.u0 = u0; cmd.v0 = v0; cmd.u1 = u1; cmd.v1 = v1; cmd.u2 = u2; cmd.v2 = v2; cmd.u3 = u3; cmd.v3 = v3;
        cmd.texIdx = texIdx;
        cmd.r = r; cmd.g = g; cmd.b = b; cmd.a = a;
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    parseColor(colorStr) {
        this.ctx2d.fillStyle = colorStr;
        // Hack: read back from context to get standard format or just do simple regex
        // Context read is slow, so simple regex:
        let r = 1, g = 1, b = 1, a = this.currentGlobalAlpha;
        
        if (colorStr.startsWith('#')) {
            let hex = colorStr.substring(1);
            if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
            r = parseInt(hex.substring(0,2), 16) / 255;
            g = parseInt(hex.substring(2,4), 16) / 255;
            b = parseInt(hex.substring(4,6), 16) / 255;
            if (hex.length === 8) {
                a *= parseInt(hex.substring(6,8), 16) / 255;
            }
        } else if (colorStr.startsWith('rgba')) {
            const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (m) {
                r = parseInt(m[1]) / 255;
                g = parseInt(m[2]) / 255;
                b = parseInt(m[3]) / 255;
                if (m[4] !== undefined) a *= parseFloat(m[4]);
            }
        }
        
        return [r, g, b, a];
    }

    setFillStyle(color) {
        this.currentFillStyle = this.parseColor(color);
        this.ctx2d.fillStyle = color;
    }

    
    setStrokeStyle(color) {
        this.ctx2d.strokeStyle = color;
    }
    
    setLineWidth(width) {
        this.ctx2d.lineWidth = width;
    }
    
    setGlobalAlpha(alpha) {
        this.currentGlobalAlpha = alpha;
        this.ctx2d.globalAlpha = alpha;
    }
    
    setGlobalCompositeOperation(operation) {
        this.flush();
        this.ctx2d.globalCompositeOperation = operation;
        // Note: WebGL blend modes could be set here
    }
    
    roundRect(x, y, w, h, radii) {
        this.flush();
        this.ctx2d.beginPath();
        this.ctx2d.roundRect(x, y, w, h, radii);
    }
    fillRect(x, y, w, h) {
        const texIdx = this.getTextureIndex(this.whiteTex);
        const a = this.currentGlobalAlpha;
        this.pushQuad(
            x, y, 0, 0,
            x + w, y, 1, 0,
            x + w, y + h, 1, 1,
            x, y + h, 0, 1,
            texIdx, this.currentFillStyle[0], this.currentFillStyle[1], this.currentFillStyle[2], this.currentFillStyle[3]
        );
    }
    
    strokeRect(x, y, w, h) {
        const cmd = this._getCommand();
        cmd.type = CMD_STROKE_RECT;
        cmd.n0 = x; cmd.n1 = y; cmd.n2 = w; cmd.n3 = h;
        this._captureCtx2DState(cmd);
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    fillCircle(x, y, radius) {
        const cmd = this._getCommand();
        cmd.type = CMD_FILL_CIRCLE;
        cmd.n0 = x; cmd.n1 = y; cmd.n2 = radius;
        this._captureCtx2DState(cmd);
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    strokeCircle(x, y, radius) {
        const cmd = this._getCommand();
        cmd.type = CMD_STROKE_CIRCLE;
        cmd.n0 = x; cmd.n1 = y; cmd.n2 = radius;
        this._captureCtx2DState(cmd);
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    drawLine(x1, y1, x2, y2) {
        const cmd = this._getCommand();
        cmd.type = CMD_DRAW_LINE;
        cmd.n0 = x1; cmd.n1 = y1; cmd.n2 = x2; cmd.n3 = y2;
        this._captureCtx2DState(cmd);
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    drawPoly(x, y, rotation, vertices, closePath = true) {
        this.flush();
        this.syncTransform2D();
        if (vertices.length < 2) return;
        this.ctx2d.save();
        this.ctx2d.translate(x, y);
        this.ctx2d.rotate(rotation);
        
        this.ctx2d.beginPath();
        this.ctx2d.moveTo(vertices[0], vertices[1]);
        for (let i = 2; i < vertices.length; i += 2) {
            this.ctx2d.lineTo(vertices[i], vertices[i + 1]);
        }
        
        if (closePath) this.ctx2d.closePath();
        this.ctx2d.stroke();
        this.ctx2d.restore();
    }
    
    fillPoly(x, y, rotation, vertices, closePath = true) {
        this.flush();
        this.syncTransform2D();
        if (vertices.length < 2) return;
        this.ctx2d.save();
        this.ctx2d.translate(x, y);
        this.ctx2d.rotate(rotation);
        
        this.ctx2d.beginPath();
        this.ctx2d.moveTo(vertices[0], vertices[1]);
        for (let i = 2; i < vertices.length; i += 2) {
            this.ctx2d.lineTo(vertices[i], vertices[i + 1]);
        }
        
        if (closePath) this.ctx2d.closePath();
        this.ctx2d.fill();
        this.ctx2d.restore();
    }
    
    fillText(text, x, y, font = '16px sans-serif') {
        const cmd = this._getCommand();
        cmd.type = CMD_FILL_TEXT;
        cmd.str = font;
        cmd.obj = text;
        cmd.n0 = x; cmd.n1 = y;
        this._captureCtx2DState(cmd);
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    
    drawImage(image, x, y, w, h) {
        if (!image || !image.complete) return;
        
        const info = this.getTextureInfo(image);
        const texIdx = this.getTextureIndex(info.tex);
        const a = this.currentGlobalAlpha;
        
        const wid = w !== undefined ? w : image.width;
        const hei = h !== undefined ? h : image.height;
        
        this.pushQuad(
            x, y, info.uv.u0, info.uv.v0,
            x + wid, y, info.uv.u1, info.uv.v0,
            x + wid, y + hei, info.uv.u1, info.uv.v1,
            x, y + hei, info.uv.u0, info.uv.v1,
            texIdx, 1, 1, 1, a
        );
    }
    
    drawImageEx(image, sx, sy, sw, sh, dx, dy, dw, dh, rotation = 0) {
        if (!image || !image.complete) return;
        
        const info = this.getTextureInfo(image);
        const texIdx = this.getTextureIndex(info.tex);
        const a = this.currentGlobalAlpha;
        
        // local UVs
        const localU0 = sx / image.width;
        const localV0 = sy / image.height;
        const localU1 = (sx + sw) / image.width;
        const localV1 = (sy + sh) / image.height;
        
        // mapped to atlas
        const uRange = info.uv.u1 - info.uv.u0;
        const vRange = info.uv.v1 - info.uv.v0;
        
        const u0 = info.uv.u0 + localU0 * uRange;
        const v0 = info.uv.v0 + localV0 * vRange;
        const u1 = info.uv.u0 + localU1 * uRange;
        const v1 = info.uv.v0 + localV1 * vRange;
        
        // Rotation & position math
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        
        // Centers origin at dx, dy natively for sprites if requested
        const hx = dw / 2;
        const hy = dh / 2;
        
        const cx = rotation !== 0 ? 0 : dx - hx;
        const cy = rotation !== 0 ? 0 : dy - hy;
        
        // Vertices
        let x0 = -hx, y0 = -hy;
        let x1 = hx, y1 = -hy;
        let x2 = hx, y2 = hy;
        let x3 = -hx, y3 = hy;
        
        if (rotation !== 0) {
            // Apply rotation and translation
            const rx0 = x0 * cos - y0 * sin + dx;
            const ry0 = x0 * sin + y0 * cos + dy;
            
            const rx1 = x1 * cos - y1 * sin + dx;
            const ry1 = x1 * sin + y1 * cos + dy;
            
            const rx2 = x2 * cos - y2 * sin + dx;
            const ry2 = x2 * sin + y2 * cos + dy;
            
            const rx3 = x3 * cos - y3 * sin + dx;
            const ry3 = x3 * sin + y3 * cos + dy;
            
            this.pushQuad(
                rx0, ry0, u0, v0,
                rx1, ry1, u1, v0,
                rx2, ry2, u1, v1,
                rx3, ry3, u0, v1,
                texIdx, 1, 1, 1, a
            );
        } else {
            this.pushQuad(
                cx, cy, u0, v0,
                cx + dw, cy, u1, v0,
                cx + dw, cy + dh, u1, v1,
                cx, cy + dh, u0, v1,
                texIdx, 1, 1, 1, a
            );
        }
    }
    

    drawInstanced(image, count, transformData, w, h) {
        const cmd = this._getCommand();
        cmd.type = CMD_INSTANCED;
        cmd.obj = image;
        cmd.n0 = count;
        cmd.obj2 = transformData; // warning: user might mutate it, but usually not in same frame
        cmd.n1 = w;
        cmd.n2 = h;
        const m = this.currentMatrix;
        cmd.m0 = m[0]; cmd.m1 = m[1]; cmd.m3 = m[3]; cmd.m4 = m[4]; cmd.m6 = m[6]; cmd.m7 = m[7];
        this.commandQueue[this.commandCount - 1] = cmd;
    }
    _internalDrawInstanced(image, count, transformData, w, h, cmdMatrix) {
        if (!this.ext || count === 0) return;
        this.flush(); // Flush normal batch
        
        const gl = this.gl;
        const ext = this.ext;
        
        gl.useProgram(this.instShader);
        
        // Bind textures
        let texIdx = 0;
        if (image) {
            const info = this.getTextureInfo(image);
            texIdx = this.getTextureIndex(info.tex);
            for (let i = 0; i < this.textures.length; i++) {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
            }
        } else {
            texIdx = this.getTextureIndex(this.whiteTex);
            gl.activeTexture(gl.TEXTURE0 + texIdx);
            gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
        }
        
        gl.uniform2f(gl.getUniformLocation(this.instShader, "uResolution"), this.width, this.height);
        // Use captured matrix
        const mat = new Float32Array([cmdMatrix.m0, cmdMatrix.m1, 0, cmdMatrix.m3, cmdMatrix.m4, 0, cmdMatrix.m6, cmdMatrix.m7, 1]);
        gl.uniformMatrix3fv(gl.getUniformLocation(this.instShader, "uTransform"), false, mat);
        
        // Setup base quad attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceQuadBuffer);
        
        const aPos = gl.getAttribLocation(this.instShader, "aPos");
        const aUV = gl.getAttribLocation(this.instShader, "aUV");
        gl.enableVertexAttribArray(aPos);
        gl.enableVertexAttribArray(aUV);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
        
        // Setup instance attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, transformData.subarray(0, count * 14));
        
        const stride = 14 * 4;
        const aMatRow0 = gl.getAttribLocation(this.instShader, "aMatRow0");
        const aMatRow1 = gl.getAttribLocation(this.instShader, "aMatRow1");
        const aMatRow2 = gl.getAttribLocation(this.instShader, "aMatRow2");
        const aInstanceColor = gl.getAttribLocation(this.instShader, "aInstanceColor");
        const aInstanceTexIdx = gl.getAttribLocation(this.instShader, "aInstanceTexIdx");
        
        gl.enableVertexAttribArray(aMatRow0);
        gl.enableVertexAttribArray(aMatRow1);
        gl.enableVertexAttribArray(aMatRow2);
        gl.enableVertexAttribArray(aInstanceColor);
        gl.enableVertexAttribArray(aInstanceTexIdx);
        
        gl.vertexAttribPointer(aMatRow0, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(aMatRow1, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribPointer(aMatRow2, 3, gl.FLOAT, false, stride, 24);
        gl.vertexAttribPointer(aInstanceColor, 4, gl.FLOAT, false, stride, 36);
        gl.vertexAttribPointer(aInstanceTexIdx, 1, gl.FLOAT, false, stride, 52);
        
        // Setup divisor
        ext.vertexAttribDivisorANGLE(aMatRow0, 1);
        ext.vertexAttribDivisorANGLE(aMatRow1, 1);
        ext.vertexAttribDivisorANGLE(aMatRow2, 1);
        ext.vertexAttribDivisorANGLE(aInstanceColor, 1);
        ext.vertexAttribDivisorANGLE(aInstanceTexIdx, 1);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        ext.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);
        this.drawCalls++;
        
        // Cleanup divisor
        ext.vertexAttribDivisorANGLE(aMatRow0, 0);
        ext.vertexAttribDivisorANGLE(aMatRow1, 0);
        ext.vertexAttribDivisorANGLE(aMatRow2, 0);
        ext.vertexAttribDivisorANGLE(aInstanceColor, 0);
        ext.vertexAttribDivisorANGLE(aInstanceTexIdx, 0);
        
        // Restore standard setup
        gl.useProgram(this.shader);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        this.setupAttributes();
    }

    // Matrix emulation for Camera
    
    save() {
        let cached;
        if (this.matrixPool.length > 0) {
            cached = this.matrixPool.pop();
        } else {
            cached = new Float32Array(9);
        }
        cached.set(this.currentMatrix);
        this.matrixStack.push(this.currentMatrix);
        this.currentMatrix = cached;
        this.ctx2d.save();
    }

    restore() {
        if (this.matrixStack.length > 0) {
            const oldMatrix = this.currentMatrix;
            this.currentMatrix = this.matrixStack.pop();
            this.matrixPool.push(oldMatrix);
        }
        this.ctx2d.restore();
    }

    translate(x, y) {
        this.currentMatrix[6] += this.currentMatrix[0] * x + this.currentMatrix[3] * y;
        this.currentMatrix[7] += this.currentMatrix[1] * x + this.currentMatrix[4] * y;
        this.ctx2d.translate(x, y);
    }
    
    scale(x, y) {
        this.currentMatrix[0] *= x;
        this.currentMatrix[1] *= x;
        this.currentMatrix[3] *= y;
        this.currentMatrix[4] *= y;
        this.ctx2d.scale(x, y);
    }
    
    rotate(angle) {
        const s = Math.sin(angle);
        const c = Math.cos(angle);
        const m00 = this.currentMatrix[0];
        const m01 = this.currentMatrix[1];
        const m10 = this.currentMatrix[3];
        const m11 = this.currentMatrix[4];
        
        this.currentMatrix[0] = m00 * c + m10 * s;
        this.currentMatrix[1] = m01 * c + m11 * s;
        this.currentMatrix[3] = m00 * -s + m10 * c;
        this.currentMatrix[4] = m01 * -s + m11 * c;
        this.ctx2d.rotate(angle);
    }
    
    syncTransform2D() {
        // The 2D context is synced natively using translate/scale/rotate calls
    }
}
