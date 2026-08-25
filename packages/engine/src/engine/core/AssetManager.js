import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export class Asset {
    constructor(id, name, type, url, data = null) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.url = url;
        this.data = data;
        
        this.refCount = 0;
        this.sizeBytes = 0;
        this.lastAccessed = Date.now();
        this.chunkHandle = null;
    }
}

export class AssetManager {
    constructor(engine) {
        this.engine = engine;
        /** @type {Map<string, Asset>} */
        this.assetsById = new Map();
        /** @type {Map<string, Asset>} */
        this.assetsByName = new Map();

        /** @type {Set<Promise<void>>} */
        this.loadingPromises = new Set();
        
        this.totalAssets = 0;
        this.loadedAssets = 0;
        
        this.maxMemoryBytes = 100 * 1024 * 1024; // 100 MB limit
        this.currentMemoryBytes = 0;
    }

    _trackPromise(promise) {
        this.totalAssets++;
        this.loadingPromises.add(promise);
        
        promise.then(() => {
            this.loadedAssets++;
            this.loadingPromises.delete(promise);
        }).catch(() => {
            this.loadedAssets++;
            this.loadingPromises.delete(promise);
        });
    }

    /**
     * @returns {number} Loading progress from 0 to 1
     */
    getProgress() {
        if (this.totalAssets === 0) return 1;
        return this.loadedAssets / this.totalAssets;
    }

    _registerAsset(id, name, type, url, data, chunkHandle = null) {
        const asset = new Asset(id, name, type, url, data);
        asset.chunkHandle = chunkHandle;
        this.assetsById.set(id, asset);
        if (name) {
            this.assetsByName.set(name, asset);
        }
        return asset;
    }
    
    
    async _fetchBinaryOrHandle(url) {
        if (this.engine.streamingBridge && this.engine.streamingBridge.hasUrl(url)) {
            const chunkHandle = await this.engine.streamingBridge.requestChunk(url);
            return { arrayBuffer: chunkHandle.data, chunkHandle };
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        return { arrayBuffer, chunkHandle: null };
    }

    _updateAssetSize(asset) {
        let size = 0;
        if (asset.type === 'image' && asset.data && asset.data.width) {
            size = asset.data.width * asset.data.height * 4;
        } else if (asset.type === 'sound' && asset.data && asset.data.length) {
            size = asset.data.length * (asset.data.numberOfChannels || 1) * 4;
        } else if (asset.type === 'json' && asset.data) {
            size = JSON.stringify(asset.data).length * 2;
        } else if (asset.type === 'text' && asset.data) {
            size = asset.data.length * 2;
        }
        
        if (size > 0) {
            this.currentMemoryBytes += (size - asset.sizeBytes);
            asset.sizeBytes = size;
        }
    }
    
    retain(idOrName) {
        const asset = this.getAsset(idOrName);
        if (asset) {
            asset.refCount++;
            asset.lastAccessed = Date.now();
        }
    }
    
    release(idOrName) {
        const asset = this.getAsset(idOrName);
        if (asset && asset.refCount > 0) {
            asset.refCount--;
        }
    }
    
    unload(idOrName) {
        const asset = this.getAsset(idOrName);
        if (!asset) return false;
        
        this.currentMemoryBytes -= asset.sizeBytes;
        this.assetsById.delete(asset.id);
        if (asset.name) {
            this.assetsByName.delete(asset.name);
        }
        if (asset.chunkHandle) {
            asset.chunkHandle.release();
        }
        // In WebGL, we should also delete textures from VRAM, but for now just drop reference
        return true;
    }
    
    /**
     * Free memory if exceeding limits by unloading oldest unreferenced assets
     */
    streamGarbageCollection() {
        if (this.currentMemoryBytes <= this.maxMemoryBytes) return;
        
        const unreferenced = [];
        for (const asset of this.assetsById.values()) {
            if (asset.refCount === 0) {
                unreferenced.push(asset);
            }
        }
        
        // Sort by oldest accessed
        unreferenced.sort((a, b) => a.lastAccessed - b.lastAccessed);
        
        for (const asset of unreferenced) {
            this.unload(asset.id);
            if (this.currentMemoryBytes <= this.maxMemoryBytes) break;
        }
    }

    /**
     * Loads an image and stores it with the given name.
     */
    loadImage(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }
        
        const assetId = id || (typeof window !== 'undefined' && window.Utils ? window.Utils.generateUUID() : name); // fallback
        const img = typeof Image !== 'undefined' ? new Image() : { width: 0, height: 0, complete: false };
        const asset = this._registerAsset(assetId, name, 'image', url, img);

        if (typeof Image === 'undefined') return img; // Worker fallback

        const promise = new Promise((resolve, reject) => {
            img.onload = () => {
                this._updateAssetSize(asset);
                this.streamGarbageCollection();
                resolve();
            };
            img.onerror = () => {
                console.error(`Failed to load image: ${url}`);
                reject(new Error(`Failed to load image: ${url}`));
            };
            // Cross-origin for external URLs
            if (url.startsWith('http')) {
                img.crossOrigin = 'anonymous';
            }
            img.src = url;
        });
        
        this._trackPromise(promise);
        return img;
    }

    /**
     * Loads a sound and stores it with the given name.
     */
    loadSound(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }
        
        const assetId = id || name;
        
        const promise = this._fetchBinaryOrHandle(url)
            .then(({ arrayBuffer, chunkHandle }) => {
                if (this.engine.config.isWorker) {
                    this._registerAsset(assetId, name, 'sound', url, true, chunkHandle);
                    return true;
                }
                if (!this.engine.audio || !this.engine.audio.context) {
                    console.warn("AudioContext not initialized, can't decode audio");
                    if (chunkHandle) chunkHandle.release();
                    return null;
                }
                return this.engine.audio.context.decodeAudioData(arrayBuffer)
                    .then(audioBuffer => ({ audioBuffer, chunkHandle }))
                    .catch(err => {
                        if (chunkHandle) chunkHandle.release();
                        throw err;
                    });
            })
            .then(result => {
                if (result && result.audioBuffer) {
                    const asset = this._registerAsset(assetId, name, 'sound', url, result.audioBuffer, null);
                    if (result.chunkHandle) result.chunkHandle.release();
                    this._updateAssetSize(asset);
                    this.streamGarbageCollection();
                    return result.audioBuffer;
                }
                return result;
            })
            .catch(err => {
                console.error(`Failed to load sound: ${url}`, err);
            });
            
        this._trackPromise(promise);
        return promise;
    }

    /**
     * Loads JSON data
     */
    loadJSON(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }
        
        const assetId = id || name;
        
        const promise = this._fetchBinaryOrHandle(url)
            .then(({ arrayBuffer, chunkHandle }) => {
                const text = new TextDecoder().decode(arrayBuffer);
                const data = JSON.parse(text);
                const asset = this._registerAsset(assetId, name, 'json', url, data, null);
                if (chunkHandle) chunkHandle.release();
                this._updateAssetSize(asset);
                this.streamGarbageCollection();
                return data;
            })
            .catch(err => {
                console.error(`Failed to load JSON: ${url}`, err);
                throw err;
            });
            
        this._trackPromise(promise);
        return promise;
    }

    /**
     * Loads Text data
     */
    loadText(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }
        
        const assetId = id || name;
        
        const promise = this._fetchBinaryOrHandle(url)
            .then(({ arrayBuffer, chunkHandle }) => {
                const data = new TextDecoder().decode(arrayBuffer);
                const asset = this._registerAsset(assetId, name, 'text', url, data, null);
                if (chunkHandle) chunkHandle.release();
                this._updateAssetSize(asset);
                this.streamGarbageCollection();
                return data;
            })
            .catch(err => {
                console.error(`Failed to load Text: ${url}`, err);
                throw err;
            });
            
        this._trackPromise(promise);
        return promise;
    }

    /**
     * Loads a custom font
     */
    loadFont(name, url, id = null) {
        const assetId = id || name;
        this._registerAsset(assetId, name, 'font', url, true);
        
        if (typeof document !== 'undefined' && document.fonts) {
            const font = new FontFace(name, `url(${url})`);
            const promise = font.load().then(loadedFont => {
                document.fonts.add(loadedFont);
            }).catch(err => {
                console.error(`Failed to load Font: ${url}`, err);
            });
            this._trackPromise(promise);
            return promise;
        }
        return Promise.resolve();
    }

    getAsset(idOrName) {
        const asset = this.assetsById.get(idOrName) || this.assetsByName.get(idOrName);
        if (asset) asset.lastAccessed = Date.now();
        return asset;
    }


    loadGLTF(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }

        const assetId = id || name;
        if (typeof window === 'undefined') {
            this._registerAsset(assetId, name, 'gltf', url, true);
            return Promise.resolve(true);
        }

        const promise = new Promise((resolve, reject) => {
            if (this.engine.streamingBridge && this.engine.streamingBridge.hasUrl(url)) {
                this.engine.streamingBridge.requestChunk(url).then(chunkHandle => {
                    const loader = new GLTFLoader();
                    const path = url.substring(0, url.lastIndexOf('/') + 1);
                    const decodeStartTime = performance.now();
                    if (this.engine.streamingBridge && this.engine.streamingBridge.emitObservabilityEvent) {
                        this.engine.streamingBridge.emitObservabilityEvent('ASSET_DECODE_START', { url, type: 'gltf' });
                    }
                    try {
                        loader.parse(chunkHandle.data, path, (gltf) => {
                            const decodeDuration = performance.now() - decodeStartTime;
                            if (this.engine.streamingBridge && this.engine.streamingBridge.emitObservabilityEvent) {
                                this.engine.streamingBridge.emitObservabilityEvent('ASSET_DECODE_SUCCESS', { url, type: 'gltf', durationMs: decodeDuration });
                            }
                            chunkHandle.release();
                            const asset = this._registerAsset(assetId, name, 'gltf', url, gltf, null);
                            this._updateAssetSize(asset);
                            this.streamGarbageCollection();
                            resolve(gltf);
                        }, (error) => {
                            const decodeDuration = performance.now() - decodeStartTime;
                            if (this.engine.streamingBridge && this.engine.streamingBridge.emitObservabilityEvent) {
                                this.engine.streamingBridge.emitObservabilityEvent('ASSET_DECODE_FAILURE', { url, type: 'gltf', durationMs: decodeDuration, error: String(error) });
                            }
                            chunkHandle.release();
                            console.error(`Failed to parse GLTF: ${url}`, error);
                            reject(error);
                        });
                    } catch (error) {
                        const decodeDuration = performance.now() - decodeStartTime;
                        if (this.engine.streamingBridge && this.engine.streamingBridge.emitObservabilityEvent) {
                            this.engine.streamingBridge.emitObservabilityEvent('ASSET_DECODE_FAILURE', { url, type: 'gltf', durationMs: decodeDuration, error: String(error) });
                        }
                        chunkHandle.release();
                        console.error(`Failed to parse GLTF (sync error): ${url}`, error);
                        reject(error);
                    }
                }).catch(reject);
            } else {
                const loader = new GLTFLoader();
                loader.load(url, (gltf) => {
                    const asset = this._registerAsset(assetId, name, 'gltf', url, gltf);
                    this._updateAssetSize(asset);
                    this.streamGarbageCollection();
                    resolve(gltf);
                }, undefined, (error) => {
                    console.error(`Failed to load GLTF: ${url}`, error);
                    reject(error);
                });
            }
        });

        this._trackPromise(promise);
        return promise;
    }

    loadTexture(name, url, id = null) {
        if (this.assetsByName.has(name)) {
            const asset = this.assetsByName.get(name);
            asset.lastAccessed = Date.now();
            return asset.data;
        }

        const assetId = id || name;
        if (typeof window === 'undefined') {
            this._registerAsset(assetId, name, 'texture', url, true);
            return Promise.resolve(true);
        }

        const promise = new Promise((resolve, reject) => {
            if (this.engine.streamingBridge && this.engine.streamingBridge.hasUrl(url)) {
                this.engine.streamingBridge.requestChunk(url).then(chunkHandle => {
                    const blob = new Blob([chunkHandle.data]);
                    const blobUrl = URL.createObjectURL(blob);
                    
                    const loader = new THREE.TextureLoader();
                    loader.load(blobUrl, (texture) => {
                        URL.revokeObjectURL(blobUrl);
                        const asset = this._registerAsset(assetId, name, 'texture', url, texture, chunkHandle);
                        this._updateAssetSize(asset);
                        this.streamGarbageCollection();
                        resolve(texture);
                    }, undefined, (error) => {
                        URL.revokeObjectURL(blobUrl);
                        chunkHandle.release();
                        console.error(`Failed to parse Texture: ${url}`, error);
                        reject(error);
                    });
                }).catch(reject);
            } else {
                const loader = new THREE.TextureLoader();
                loader.load(url, (texture) => {
                    const asset = this._registerAsset(assetId, name, 'texture', url, texture);
                    this._updateAssetSize(asset);
                    this.streamGarbageCollection();
                    resolve(texture);
                }, undefined, (error) => {
                    console.error(`Failed to load Texture: ${url}`, error);
                    reject(error);
                });
            }
        });

        this._trackPromise(promise);
        return promise;
    }
    
    getGLTF(name) {
        const a = this.getAsset(name);
        return (a && a.type === 'gltf') ? a.data : undefined;
    }
    
    getTexture(name) {
        const a = this.getAsset(name);
        return (a && a.type === 'texture') ? a.data : undefined;
    }

    getImage(name) { 
        const a = this.getAsset(name); 
        return (a && a.type === 'image') ? a.data : undefined; 
    }
    getJSON(name) { 
        const a = this.getAsset(name); 
        return (a && a.type === 'json') ? a.data : undefined; 
    }
    getText(name) { 
        const a = this.getAsset(name); 
        return (a && a.type === 'text') ? a.data : undefined; 
    }
    
    playSound(name, volume = 1.0) {
        if (this.engine.audio) {
            this.engine.audio.playSound(name, volume);
        }
    }

    async waitForAll() {
        await Promise.all(this.loadingPromises);
        // Reset tracking after load completes
        this.totalAssets = 0;
        this.loadedAssets = 0;
    }
}
