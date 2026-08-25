# Foundry monorepo audit

## Editor
The React/Monaco Editor remains in `@foundry/engine` because its current implementation uses `import.meta.glob` over Engine source files. Moving it to Platform would require a larger source-provider refactor. The runtime boundary violation was removed by moving `EditorManager.js` into `src/engine/editor/`; Engine runtime no longer imports the React editor UI tree.

## Streaming
Browser streaming/cache/worker execution is owned by `@foundry/player`. Server-side upload/extraction validators remain Platform-owned. The shared streaming manifest data contract is now owned by `@foundry/contracts` and both sides consume its canonical version/priority constants.

## E2E
All supplied ZIP fixtures were corrupted in the input archive. They were rebuilt from their source fixtures. Streaming fixture naming/hash/schema were aligned with the current runtime contract. ESM tests that used an undefined `__dirname` were corrected. The cross-context persistent-cache test now captures/restores IndexedDB with Playwright storageState.

## Contracts
Only a genuinely shared contract was extracted: the streaming asset manifest. Business logic, database models, UI state and Engine implementation were deliberately not moved into Contracts.

## Dependency order
Contracts -> Engine (independent today)
Contracts -> Player -> Engine
Contracts -> Platform -> Player -> Engine

Engine must never depend on Player or Platform. Player must never depend on Platform.

## Streaming validation boundary
`GamePackageValidator.js` now invokes the Platform-owned `StreamingManifestValidator` when a streaming manifest is present, so upload-time validation and Player runtime share the same manifest version/priority contract.
