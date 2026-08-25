# Changelog

## [0.5.0] - 2026-08-24
### Added
- One-active-release enforcement, unpublish, retained-runtime rollback, inactive-version deletion and whole-project deletion.
- Idempotent lifecycle cleanup jobs with immediate `DELETING` access revocation.
- SQL-backed catalog search, exact tag filtering, stable cursor pagination, popular-tag aggregation and ETag cache revalidation.
- Web Worker package validation plus upload byte progress and cancellation.
- Database-backed rate limiting, unique active jobs, worker leases/recovery/heartbeats and schema version tracking.
- Request IDs, newline-delimited JSON request logs, liveness/readiness probes and production dependency fail-fast.
- Optional publication-gated signed R2 redirects for non-document assets and batched prefix deletion.
- Reusable compiled-server HTTP acceptance smoke and production operations guide.

### Changed
- Publishing a new version atomically archives the prior active release instead of leaving multiple public versions.
- Executable HTML/SVG continues through the CSP proxy even when direct R2 delivery is enabled.
- The PostgreSQL target schema now reflects the complete current metadata/job/discovery contract.

## [0.4.0] - 2026-08-24
### Added
- Non-repeating, tab-scoped Play Something Now / Next Game cycles with automatic reset after catalog exhaustion.
- URL-persisted catalog search, tag filters and stable sorting controls.
- Direct removal, history dismissal and unfollow actions in Library.
- Owner-only project title/description editing.
- Retryable upload transfers and idempotent completed-upload responses.
- Reduced-motion behavior, skip-to-content navigation and current-page navigation semantics.

### Changed
- Trending and recommendations now treat skips and runtime failures as negative quality signals and use publication freshness.
- Continue Playing dismissals retain aggregate telemetry and automatically clear after a new launch.
- Validated READY metadata and completed upload-session state are committed atomically.
- Duplicate Keep requests no longer inflate Library-add analytics.

## [0.3.0] - 2026-08-24
### Added
- Typed Player sandbox handshake, launch readiness/failure states and worker health timeouts.
- Persisted capability policy plus Foundry IndexedDB autosave/recovery and fresh-start recovery.
- Catalog thumbnails, searchable tags and control hints from validated package metadata.
- CDN range/conditional delivery, document CSP sandbox, security headers and explicit API CORS.
- Validated-package SHA-256 binding, ZIP-bomb preflight and completed-upload retention/expiry lifecycle.

### Fixed
- Published Foundry entries launching with missing code/assets defaults or silently falling back from failed streaming setup.
- Capabilities disappearing between validation and playback.
- Generic HTML modules/fetches lacking public-asset CORS from an opaque sandbox.
- Failed and expired uploads permanently consuming developer version quota.
- Newer-created versions incorrectly outranking a version published more recently.

## [0.2.1] - 2026-08-24
### Added
- End-to-end persistence and catalog delivery for the validated streaming-manifest filename.
- Browser/server/extraction/runtime checks for streamed chunk size and SHA-256 integrity.
- Drag-and-drop ZIP selection plus truthful streaming metadata in developer and player views.

### Fixed
- Alternative `foundry-streaming.json` packages losing streaming at playback time.
- Speculative streaming-manifest 404s for non-streaming Foundry games.
- Decoder slots leaking when memory acquisition fails or handles are released more than once.
- Relative and absolute asset URL forms failing to resolve to the same streamed chunk.
- Streaming controller/bridge resources surviving worker reinitialization failures.

## [0.2.0] - 2026-08-24
### Added
- Credential-free local mode with loopback-only auth, SQLite, local storage and inline publishing.
- Real extracted-asset delivery, publish-pipeline and local/R2 cleanup tests.
- Discovery retention features: Library, ratings, follows, recommendations and funnel analytics.
- Loading, empty, retry and inline feedback states across the player and developer flows.

### Changed
- Split editor, dashboard, player and Firebase code from the initial route.
- Made upload and publish separate, explicit operations.
- Replaced POSIX-only cleanup/start commands with cross-platform Node scripts.

### Removed
- Nonfunctional external-storage and fake-CDN UI paths.

## [0.1.2] - 2026-08-06
### Added
- **Skeletal Animation**: Support for importing and playing skinned meshes with skeletal animations (GLTF) via `ModelRenderer`.
- **Animation Blending**: Blending trees and cross-fading between animation states (e.g., Idle -> Run) in `ModelRenderer`.
- **Inverse Kinematics (IK)**: Basic IK for foot placement or aiming using `CCDIKSolver`.
- **Vehicle Physics**: Raycast vehicle controller for driving simulations using Cannon-ES (`Vehicle3D` component).
- **Ragdolls & Soft Bodies**: Advanced constraint setups (`PhysicsConstraint3D`) and soft body physics for 3D (`SoftBody3D`).
- **Terrain System**: Heightmap-based terrain generation with LODs, physics, and material splatting (`Terrain3D`).
- **Foliage & Instancing**: High-performance instanced rendering (`InstancedMesh3D`) for placing thousands of trees/grass.
- **Dynamic Sky & Weather**: Procedural skybox (`Sky3D`), dynamic time-of-day cycle with moving sun and adjusted lighting.

## [0.1.1] - 2026-08-06
### Added
- **WebSockets API**: Networking system for realtime multiplayer communication.
- **State Synchronization**: Entity interpolation and delta state sync for multiplayer.
- **UI Component System**: In-game UI system using DOM overlay (Buttons, Sliders, Text).
- **UI Canvas Anchor System**: Responsive UI layout engine (anchors, pivots, flex-like).
- **Spatial Audio (3D)**: Web Audio API spatialization (PannerNode) for 3D positional sounds.
- **Audio Mixer & Effects**: Audio routing, volume groups (Master, SFX, Music), and filters.
- **Visual Logic Graph**: Node-based visual programming using React Flow.
