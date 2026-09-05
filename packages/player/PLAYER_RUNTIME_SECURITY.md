# Player Worker execution policy

## Verdict

The previous literal `eval(data.code)` path in `src/worker.js` has been removed. Published typed Player launches cannot enable or forward editor console commands. Editor console compatibility remains available only to the reusable Engine editor's legacy sandbox protocol and executes through a temporary Blob ES module with dynamic `import()`.

This change does not claim that game code is trusted. Running developer game code is the purpose of the Player. The security boundary is isolation and capability restriction, not code inspection.

## Actual execution paths

### Published Foundry game

`RUN_GAME` is normalized by `sandboxProtocol.js` as typed mode. It resolves game URLs only under the same-origin `/api/cdn/games/{gameId}/versions/{versionId}/extracted/...` path, validates capabilities, and sets `allowEditorCommands: false`. `sandbox.jsx` does not forward legacy `eval` messages in typed mode.

The Worker imports the published game module through a Blob/module URL or same-origin module URL. The Worker context has the Foundry API, transferred canvases, constrained mock DOM/storage surfaces, same-origin streaming fetches, and explicitly granted runtime capabilities. The Foundry sandbox CSP permits self/blob scripts and workers but does not permit `unsafe-eval` or arbitrary external `connect-src`.

### Engine editor preview

The reusable editor uses the legacy `run` protocol. That mode sets `allowEditorCommands: true` so its console can evaluate developer-entered commands against `engine`, `Foundry`, and editor assets. `createEditorCommandModuleSource()` wraps the command as an ES module; the Worker imports a temporary Blob URL and revokes it. Expression syntax is attempted first, then statement syntax after a syntax error.

This remains arbitrary code execution inside the editor sandbox Worker by design. It is not reachable through the typed published protocol and receives no Firebase bearer token, R2 secret, GitHub token, or server credential.

### Generic Web game

Generic packages do not use the Foundry Worker command path. They run inside the controlled generic loader's nested opaque-origin iframe. Compatibility requires `unsafe-inline`/`unsafe-eval` only on `generic-sandbox.html`; those exceptions are not present on the Platform SPA or Foundry sandbox CSP.

## Enforced invariants

- `packages/player/src/worker.js` contains no literal `eval(` call.
- Typed `RUN_GAME` normalization sets `allowEditorCommands: false`.
- Legacy editor normalization sets `allowEditorCommands: true`.
- `sandbox.jsx` forwards editor command messages only when `parentProtocol === 'legacy'`.
- Published URLs are same-origin and constrained to the extracted runtime path.
- Foundry sandbox CSP has no `unsafe-eval`.

Regression coverage lives in `packages/player/tests/workerSecurity.test.js`, `sandboxProtocol.test.js`, and `runtimeGameModule.test.js`.

## Residual risk

Blob module import is CSP-compatible with the current `script-src/worker-src blob:` policy but is still a dynamic code execution mechanism. Browser/CSP behavior must remain covered by Chromium E2E. Removing editor command execution entirely would break the current editor console and is not required to secure the published typed runtime.

`packages/engine/src/editor/lib/exportProject.js` has a separate generated-export compatibility use of `new Function`. It is not the Player Worker path addressed here and was not changed during release hardening; it should be evaluated separately if export CSP requirements change.
