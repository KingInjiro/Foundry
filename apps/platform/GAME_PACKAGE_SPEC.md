# Foundry game package specification

Upload an `application/zip` file with `manifest.json` at the ZIP root. Do not wrap the game in an extra top-level folder.

## Minimal web game

```json
{
  "version": 1,
  "gameId": "your-stable-game-id",
  "gameVersion": "1.0.0",
  "name": "Game title",
  "description": "A short catalog description",
  "format": "web-game",
  "runtime": "web",
  "entry": "index.html",
  "thumbnail": "art/cover.webp",
  "tags": ["Arcade", "Quick Play"],
  "controls": [{ "action": "Move", "key": "Arrow Keys" }],
  "capabilities": []
}
```

The declared `entry` must exist in the ZIP. Optional discovery metadata is normalized and bounded:

- `description`: up to 2,000 characters.
- `thumbnail`: an existing PNG, JPEG, GIF, WebP or AVIF whose bytes match its extension, up to 5 MiB. SVG is intentionally excluded.
- `tags`: up to 10 unique strings, each 1–32 characters.
- `controls`: up to 20 `{ "action", "key" }` pairs; actions are up to 64 characters and keys up to 32.

For a Foundry runtime, use `format: "foundry-game"`, `runtime: "foundry"` and include a non-empty `engineVersion` string.

The declared Foundry entry is an ES module executed in the isolated Player worker. It must export a game class as `default`, `CustomGame`, or `Game`. The class may implement the full Engine simulation lifecycle, or use the simpler `start()` / `stop()` form; Player supplies safe no-op lifecycle methods for the latter. Browser DOM globals such as `document` and `window.parent` are not part of the game-module API.

```js
export default class MyGame {
  constructor(engine) {
    this.engine = engine;
  }

  async start() {
    const level = await this.engine.assets.loadJSON('level', 'assets/level.json');
    // Initialize the game from level.
  }

  stop() {
    // Optional cleanup.
  }
}
```

Player reports the game as ready only after the module imports, its class is registered, and its `start()` / `onStart()` work resolves. A startup failure is surfaced to the player with a retry action instead of leaving a permanent black screen.

Supported optional capabilities are:

- `audio`
- `storage`
- `pointer-lock`
- `fullscreen`
- `downloads`

Unknown capabilities are rejected rather than silently granted.

| Capability | Generic Web | Foundry | Effect |
|---|:---:|:---:|---|
| `audio` | Yes | Yes | Grants the runtime audio/autoplay policy; Foundry audio commands are ignored unless declared. |
| `storage` | No | Yes | Enables Foundry progress autosave/recovery only. Generic Web storage is rejected to preserve opaque-origin isolation. |
| `pointer-lock` | Yes | Yes | Adds the pointer-lock sandbox permission. |
| `fullscreen` | Yes | Yes | Delegates fullscreen permission to the game frame. The Platform fullscreen button remains available. |
| `downloads` | Yes | Yes | Adds the downloads sandbox permission. |

Foundry progress is saved locally in IndexedDB under the signed-in viewer (or local guest), game ID and exact published version ID. Writes are ordered so an older autosave cannot overwrite a newer one, and each save is limited to 5 MiB. Recovery happens after game initialization and before the simulation begins. If recovered state prevents startup, Player offers **Start Fresh** to delete only that version's local save.

## Optional Foundry streaming package

A Foundry package may include one root streaming manifest named `streaming-manifest.json` or `foundry-streaming.json`. When both names exist, select one explicitly in the game manifest:

```json
{
  "streamingManifest": "foundry-streaming.json"
}
```

The selected path is preserved through upload, publication and catalog delivery, so the Player loads exactly the validated file. Streaming manifests are rejected for the generic web runtime. Every referenced chunk must exist inside the same ZIP, use a safe package-relative URL and declare a SHA-256 value in the form `sha256-` followed by 64 hexadecimal characters. Streamable GLB chunks also receive the self-contained GLB safety check during extraction.

After server validation, the version stores the package SHA-256. Publishing refuses to extract if the upload object or its length changed in the meantime. Public HTML/XHTML/SVG responses are also delivered with a document-level CSP sandbox, so opening an extracted document directly does not grant it the Platform origin.

## Default limits

| Limit | Default | Environment variable |
|---|---:|---|
| Uploaded ZIP | 50 MiB | `PLATFORM_MAX_PACKAGE_SIZE_BYTES` |
| Total extracted data | 100 MiB | `PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES` |
| Individual extracted file | 20 MiB | `PLATFORM_MAX_FILE_SIZE_BYTES` |
| Archive / extracted files | 1,000 | `PLATFORM_MAX_FILES_PER_PACKAGE`, `PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE` |
| Thumbnail | 5 MiB | Fixed validation limit |
| Foundry local save | 5 MiB | Fixed Player limit |

The browser performs an early convenience check; server validation and extraction are authoritative. Absolute paths, traversal/encoded traversal, backslashes, null bytes, dot/empty segments, Windows-reserved names, invalid portable filename characters and case/Unicode-normalization collisions are rejected.

A ready-made valid package is available at `e2e/fixtures/generic-valid-game.zip`.
