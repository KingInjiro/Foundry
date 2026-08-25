export class AudioManager {
    constructor(engine) {
        this.engine = engine;
        this.globalVolume = 1.0;
        this.musicVolume = 1.0;
        this.sfxVolume = 1.0;
        
        this.isWorker = this.engine.config.isWorker;
        
        this.currentMusicSource = null;
        this.currentMusicGain = null;
        this.currentMusicName = null;
        this.musicLayers = new Map(); // id -> { source, gain, name }
        
        this.activeSounds = new Set();
        this._nextSoundId = 1;
        
        this.effects = {
            master: [],
            music: [],
            sfx: []
        };
        
        if (this.isWorker || typeof window === 'undefined') {
            return;
        }

        // Initialize WebAudio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.context = new AudioContext();
        
        // Setup main buses
        this.masterBus = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus = this.context.createGain();
        
        this.masterBus.connect(this.context.destination);
        this.musicBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        
        // Volume nodes
        this.masterGain = this.masterBus; // For backwards compatibility
        this.musicGain = this.musicBus;
        this.sfxGain = this.sfxBus;
        
        this.masterGain.gain.value = this.globalVolume;
        this.musicGain.gain.value = this.musicVolume;
        this.sfxGain.gain.value = this.sfxVolume;
        
        this._setupInteractionResume();
    }
    
    _setupInteractionResume() {
        const resumeAudio = () => {
            if (this.context.state === 'suspended') {
                this.context.resume();
            }
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('click', resumeAudio, { once: true });
            window.addEventListener('keydown', resumeAudio, { once: true });
            window.addEventListener('touchstart', resumeAudio, { once: true });
        }
    }
    
    setGlobalVolume(volume) {
        this.globalVolume = Math.max(0, Math.min(1, volume));
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'setGlobalVolume', volume: this.globalVolume });
            return;
        }
        if (this.masterGain) {
            this.masterGain.gain.value = this.globalVolume;
        }
    }
    
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'setMusicVolume', volume: this.musicVolume });
            return;
        }
        if (this.musicGain) {
            this.musicGain.gain.value = this.musicVolume;
        }
    }
    
    setSfxVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'setSfxVolume', volume: this.sfxVolume });
            return;
        }
        if (this.sfxGain) {
            this.sfxGain.gain.value = this.sfxVolume;
        }
    }
    
    playMusic(name, loop = true, fadeDuration = 0) {
        if (this.currentMusicName === name) return;
        
        if (this.isWorker) {
            this.currentMusicName = name;
            self.postMessage({ type: 'audio_command', cmd: 'playMusic', name, loop, fadeDuration });
            return;
        }
        
        if (fadeDuration > 0 && this.currentMusicSource) {
            this.crossfadeMusic(name, fadeDuration, loop);
            return;
        }

        this.stopMusic();
        
        const audioBuffer = this.engine.assets.sounds.get(name);
        if (audioBuffer) {
            this.currentMusicName = name;
            
            this.currentMusicGain = this.context.createGain();
            this.currentMusicGain.gain.value = fadeDuration > 0 ? 0 : 1;
            this.currentMusicGain.connect(this.musicBus);
            
            const source = this.context.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = loop;
            source.connect(this.currentMusicGain);
            
            source.start(0);
            this.currentMusicSource = source;
            
            if (fadeDuration > 0) {
                const currTime = this.context.currentTime;
                this.currentMusicGain.gain.setValueAtTime(0, currTime);
                this.currentMusicGain.gain.linearRampToValueAtTime(1, currTime + fadeDuration);
            }
        } else {
            console.warn(`Music not found: ${name}`);
        }
    }
    
    crossfadeMusic(name, duration = 1.0, loop = true) {
        if (this.currentMusicName === name) return;
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'crossfadeMusic', name, duration, loop });
            return;
        }
        
        const audioBuffer = this.engine.assets.sounds.get(name);
        if (!audioBuffer) {
            console.warn(`Music not found: ${name}`);
            return;
        }
        
        const oldSource = this.currentMusicSource;
        const oldGain = this.currentMusicGain;
        
        const newGain = this.context.createGain();
        newGain.gain.value = 0;
        newGain.connect(this.musicBus);
        
        const newSource = this.context.createBufferSource();
        newSource.buffer = audioBuffer;
        newSource.loop = loop;
        newSource.connect(newGain);
        newSource.start(0);
        
        const currTime = this.context.currentTime;
        newGain.gain.setValueAtTime(0, currTime);
        newGain.gain.linearRampToValueAtTime(1, currTime + duration);
        
        if (oldSource && oldGain) {
            oldGain.gain.setValueAtTime(oldGain.gain.value, currTime);
            oldGain.gain.linearRampToValueAtTime(0, currTime + duration);
            setTimeout(() => {
                try { oldSource.stop(); } catch (e) {}
                oldSource.disconnect();
                oldGain.disconnect();
            }, duration * 1000 + 100);
        } else if (oldSource) {
            try { oldSource.stop(); } catch (e) {}
            oldSource.disconnect();
        }
        
        this.currentMusicSource = newSource;
        this.currentMusicGain = newGain;
        this.currentMusicName = name;
    }
    
    playMusicLayer(name, layerId, loop = true, initialVolume = 0) {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'playMusicLayer', name, layerId, loop, initialVolume });
            return;
        }
        
        const audioBuffer = this.engine.assets.sounds.get(name);
        if (!audioBuffer) {
            console.warn(`Music not found: ${name}`);
            return;
        }
        
        if (this.musicLayers.has(layerId)) {
            const layer = this.musicLayers.get(layerId);
            try { layer.source.stop(); } catch(e) {}
            layer.source.disconnect();
            layer.gain.disconnect();
        }
        
        const gain = this.context.createGain();
        gain.gain.value = initialVolume;
        gain.connect(this.musicBus);
        
        const source = this.context.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = loop;
        source.connect(gain);
        source.start(0);
        
        this.musicLayers.set(layerId, { source, gain, name });
    }
    
    setLayerVolume(layerId, volume, fadeDuration = 0) {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'setLayerVolume', layerId, volume, fadeDuration });
            return;
        }
        
        const layer = this.musicLayers.get(layerId);
        if (layer) {
            const currTime = this.context.currentTime;
            if (fadeDuration > 0) {
                layer.gain.gain.setValueAtTime(layer.gain.gain.value, currTime);
                layer.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)), currTime + fadeDuration);
            } else {
                layer.gain.gain.value = Math.max(0, Math.min(1, volume));
            }
        }
    }
    
    stopLayer(layerId) {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'stopLayer', layerId });
            return;
        }
        
        const layer = this.musicLayers.get(layerId);
        if (layer) {
            try { layer.source.stop(); } catch(e) {}
            layer.source.disconnect();
            layer.gain.disconnect();
            this.musicLayers.delete(layerId);
        }
    }

    stopMusic() {
        if (this.isWorker) {
            if (this.currentMusicName) {
                self.postMessage({ type: 'audio_command', cmd: 'stopMusic' });
                this.currentMusicName = null;
            }
            return;
        }
        
        if (this.currentMusicSource) {
            try { this.currentMusicSource.stop(); } catch (e) {}
            this.currentMusicSource.disconnect();
            this.currentMusicSource = null;
            this.currentMusicName = null;
        }
        if (this.currentMusicGain) {
            this.currentMusicGain.disconnect();
            this.currentMusicGain = null;
        }
    }
    
    updateListener(x, y, z) {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'updateListener', x, y, z });
            return;
        }
        if (this.context && this.context.listener) {
            if (this.context.listener.positionX) {
                this.context.listener.positionX.value = x;
                this.context.listener.positionY.value = y;
                this.context.listener.positionZ.value = z;
            } else {
                this.context.listener.setPosition(x, y, z);
            }
        }
    }

    playSound(name, volume = 1.0, options = {}) {
        if (this.isWorker) {
            const soundId = this._nextSoundId++;
            self.postMessage({ type: 'audio_command', cmd: 'playSound', name, volume, soundId, spatial: options.spatial, maxDistance: options.maxDistance, x: options.x, y: options.y, z: options.z });
            const mockSource = {
                stop: () => { self.postMessage({ type: 'audio_command', cmd: 'stopSound', soundId }); },
                setVolume: (v) => { self.postMessage({ type: 'audio_command', cmd: 'setSoundVolume', soundId, volume: v }); },
                setPosition: (x, y, z) => { self.postMessage({ type: 'audio_command', cmd: 'setSoundPosition', soundId, x, y, z }); },
                disconnect: () => {}
            };
            this.activeSounds.add(mockSource);
            return mockSource;
        }

        const audioBuffer = this.engine.assets.sounds.get(name);
        if (audioBuffer) {
            const source = this.context.createBufferSource();
            source.buffer = audioBuffer;

            const gainNode = this.context.createGain();
            gainNode.gain.value = volume;

            let pannerNode = null;
            if (options.spatial) {
                pannerNode = this.context.createPanner();
                pannerNode.panningModel = 'HRTF';
                pannerNode.distanceModel = 'linear';
                pannerNode.refDistance = 1;
                pannerNode.maxDistance = options.maxDistance || 1000;
                pannerNode.rolloffFactor = 1;
                pannerNode.coneInnerAngle = 360;
                pannerNode.coneOuterAngle = 0;
                pannerNode.coneOuterGain = 0;

                const x = options.x || 0;
                const y = options.y || 0;
                const z = options.z || 0;
                if (pannerNode.positionX) {
                    pannerNode.positionX.value = x;
                    pannerNode.positionY.value = y;
                    pannerNode.positionZ.value = z;
                } else {
                    pannerNode.setPosition(x, y, z);
                }

                source.connect(pannerNode);
                pannerNode.connect(gainNode);
            } else {
                source.connect(gainNode);
            }

            gainNode.connect(this.sfxGain);

            const soundInstance = {
                source,
                gainNode,
                pannerNode,
                setVolume: (v) => { gainNode.gain.value = v; },
                setPosition: (x, y, z) => {
                    if (pannerNode) {
                        if (pannerNode.positionX) {
                            pannerNode.positionX.value = x;
                            pannerNode.positionY.value = y;
                            pannerNode.positionZ.value = z;
                        } else {
                            pannerNode.setPosition(x, y, z);
                        }
                    }
                },
                stop: () => {
                    try { source.stop(); } catch (e) {}
                },
                disconnect: () => {
                    source.disconnect();
                    if (pannerNode) pannerNode.disconnect();
                    gainNode.disconnect();
                }
            };

            source.onended = () => {
                soundInstance.disconnect();
                this.activeSounds.delete(soundInstance);
            };

            source.start(0);
            this.activeSounds.add(soundInstance);
            return soundInstance;
        } else {
            console.warn(`Sound not found: ${name}`);
            return null;
        }
    }
    
    playTone(frequency, type = 'sine', duration = 0.5, volume = 0.5) {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'playTone', frequency, oscillatorType: type, duration, volume });
            return;
        }
        
        if (this.context.state === 'suspended') this.context.resume();
        
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, this.context.currentTime);
        
        // Envelope
        gain.gain.setValueAtTime(0, this.context.currentTime);
        gain.gain.linearRampToValueAtTime(volume, this.context.currentTime + 0.05); // Attack
        gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration); // Decay/Release
        
        osc.connect(gain);
        gain.connect(this.sfxGain);
        
        osc.start(this.context.currentTime);
        osc.stop(this.context.currentTime + duration);
    }

    stopAllSounds() {
        if (this.isWorker) {
            self.postMessage({ type: 'audio_command', cmd: 'stopAllSounds' });
            this.activeSounds.clear();
            return;
        }
        
        for (const source of this.activeSounds) {
            try {
                source.stop();
            } catch (e) {
                // Ignore if already stopped
            }
            source.disconnect();
        }
        this.activeSounds.clear();
    }
    

    // Audio Effects
    createBiquadFilter(type, frequency = 1000, Q = 1) {
        if (this.isWorker || !this.context) return null;
        const filter = this.context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = Q;
        return filter;
    }
    
    async createReverb(impulseResponseUrl) {
        if (this.isWorker || !this.context) return null;
        const convolver = this.context.createConvolver();
        try {
            const response = await fetch(impulseResponseUrl);
            const arrayBuffer = await response.arrayBuffer();
            convolver.buffer = await this.context.decodeAudioData(arrayBuffer);
            return convolver;
        } catch (e) {
            console.error('Failed to create reverb:', e);
            return null;
        }
    }

    addGlobalEffect(effectNode) {
        if (this.isWorker || !this.context || !effectNode) return;
        this.effects.master.push(effectNode);
        this._rebuildRouting();
    }
    
    addMusicEffect(effectNode) {
        if (this.isWorker || !this.context || !effectNode) return;
        this.effects.music.push(effectNode);
        this._rebuildRouting();
    }
    
    addSfxEffect(effectNode) {
        if (this.isWorker || !this.context || !effectNode) return;
        this.effects.sfx.push(effectNode);
        this._rebuildRouting();
    }

    clearGlobalEffects() {
        if (this.isWorker) return;
        this.effects.master = [];
        this._rebuildRouting();
    }
    
    clearMusicEffects() {
        if (this.isWorker) return;
        this.effects.music = [];
        this._rebuildRouting();
    }

    clearSfxEffects() {
        if (this.isWorker) return;
        this.effects.sfx = [];
        this._rebuildRouting();
    }
    
    _rebuildRouting() {
        if (!this.context) return;
        
        // Disconnect all
        this.masterBus.disconnect();
        this.musicBus.disconnect();
        this.sfxBus.disconnect();
        
        for (const effects of [this.effects.master, this.effects.music, this.effects.sfx]) {
            for (const effect of effects) {
                effect.disconnect();
            }
        }
        
        let currentMusic = this.musicBus;
        for (const effect of this.effects.music) {
            currentMusic.connect(effect);
            currentMusic = effect;
        }
        currentMusic.connect(this.masterBus);
        
        let currentSfx = this.sfxBus;
        for (const effect of this.effects.sfx) {
            currentSfx.connect(effect);
            currentSfx = effect;
        }
        currentSfx.connect(this.masterBus);
        
        let currentMaster = this.masterBus;
        for (const effect of this.effects.master) {
            currentMaster.connect(effect);
            currentMaster = effect;
        }
        currentMaster.connect(this.context.destination);
    }

    stopAll() {

        this.stopMusic();
        this.stopAllSounds();
    }
}
