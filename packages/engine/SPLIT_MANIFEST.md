# Foundry 3-repository split

## Ownership
- `foundry-engine`: engine runtime + engine-side editor tooling.
- `foundry-player`: browser sandbox, worker and runtime streaming.
- `foundry-platform`: application shell, backend, developer UI, catalog/player UI and E2E.

## Dependency direction
`Platform -> Player -> Engine`

The Engine does not import Player or Platform. Player does not import Platform.

## Intentional boundary adapters
- Platform `src/sandbox.jsx` imports `@foundry/player/sandbox` so the platform can serve `/sandbox.html` without copying the Player runtime.
- Platform Player UI imports streaming loaders from `@foundry/player/streaming/*`.
- Platform backend owns package-validation validators (`StreamingManifestValidator`, `StreamableGlbValidator`).
- Engine exports Editor as `@foundry/engine/editor` because the editor introspects engine source files and is therefore engine tooling, not a platform backend concern.
