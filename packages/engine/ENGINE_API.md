# Engine API

This document defines the stable public interface of the Foundry Engine that the Platform and Game Packages are allowed to consume.

## Core Initialization
- `Engine`: The main class responsible for the game loop, systems management, and canvas attachment.

## Serialization / Loading
- `SceneSerializer.deserialize(data, world)`: Hydrates a game package scene into an active world.
- `SceneSerializer.serialize(world)`: Serializes the current world state.

## Runtime Control
- `engine.start()`
- `engine.stop()`
- `engine.pause()`
- `engine.resume()`

*(This document will be expanded as the Engine's public interface is formalized for the Game Player.)*
