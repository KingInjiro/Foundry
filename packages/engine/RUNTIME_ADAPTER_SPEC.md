# Runtime Adapter Specification

## 1. Concept
The platform does not assume every game uses the Foundry Engine. The `GameRuntimeAdapter` abstracts how a game is loaded into the sandbox.

## 2. Interface
```typescript
interface IGameRuntimeAdapter {
    /** Prepares the configuration for the sandbox frame. */
    prepareLaunchConfig(manifest: GameManifest, storageRef: StorageReference): Promise<LaunchConfig>;
    
    /** Handles platform-to-game communication */
    postMessage(message: PlatformMessage): void;
    
    /** Lifecycle hooks */
    mount(container: HTMLElement): void;
    start(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    destroy(): void;
}
```

## 3. Implementations
- **FoundryRuntimeAdapter**: Loads the Foundry Engine runtime and initializes it with the game's entry script.
- **WebRuntimeAdapter**: Loads a generic web game by setting the iframe's `src` to the package's `index.html`.
