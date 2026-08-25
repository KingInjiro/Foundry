# Engine Changelog

## [0.1.0] - Initial Platform Lock
- Engine is now considered a locked subsystem.
- Prior fixes included:
  - TaskScheduler dependency tracking fix (failed tasks now correctly fail downstream dependencies instead of falsely unblocking them).
  - Component serialization cyclic reference fixes via `$ref` and `$refComp`.
  - Registered missing `Renderer3DSystem` and `PhysicsSystem3D` to the World system registry.
