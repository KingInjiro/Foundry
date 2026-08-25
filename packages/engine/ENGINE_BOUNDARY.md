# Engine Boundary

The Foundry Engine is a protected subsystem. It acts as the immutable runtime environment for executing games distributed on the Foundry Platform.

## Rules
1. **No Casual Modifications**: The engine source files must not be modified during platform development tasks.
2. **Bug Fixes Only**: Engine modifications are only allowed to fix reproducible bugs that prevent the platform/runtime from functioning.
3. **Explicit Documentation**: Any modification to the engine must be marked as an `ENGINE CHANGE` and documented in `ENGINE_CHANGELOG.md`.
4. **Stable API**: Platform code (Player, Editor, Catalog) must interact with the Engine exclusively through its public API defined in `ENGINE_API.md`. Internal imports (e.g., deeply nested `src/core/...`) are forbidden from platform UI components.

## Directory Structure
- `src/engine/` (Target destination for all core engine code: ECS, rendering, physics, serialization, TaskScheduler, etc.)
- `src/platform/` (Platform UI, Player, Game Registry, Storage API)
- `src/editor/` (Developer IDE and authoring tools)
