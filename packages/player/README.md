# Foundry Player

Browser sandbox/runtime and streaming runtime. Depends on `@foundry/engine`.

This repository is an npm-workspaces monorepo. Install once from the repository root; npm links `@foundry/contracts`, `@foundry/engine`, `@foundry/player`, and `@foundry/platform` as workspaces. No sibling repositories or `file:../...` dependencies are required.

Player owns browser execution, sandboxing, streaming, and cache. It must not import Platform code.

Published Foundry launches use the versioned protocol in `sandboxProtocol.js`: the parent/iframe source and origin are verified, a unique launch ID deduplicates races, and Player reports explicit ready/error/autosave states. Game entries are ES modules adapted by `runtimeGameModule.js`; packages may export `default`, `CustomGame`, or `Game` and may use either the full simulation lifecycle or async `start()` / optional `stop()`.

Runtime capabilities fail closed. Audio is created only when granted, recovery state is accepted only with `storage`, and oversized autosaves disable further writes without stopping gameplay. Persistent save ownership and IndexedDB writes remain Platform responsibilities; Player only serializes, restores and transports the state through the trusted bridge.
