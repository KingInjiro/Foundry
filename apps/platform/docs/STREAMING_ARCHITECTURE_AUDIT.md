# Streaming Architecture Audit

## 1. Current Architecture
* **Upload**: Developers upload a ZIP file containing the game assets.
* **Validation**: `GamePackageValidator` performs pre-flight checks (size limits, file counts).
* **Extraction**: `GamePackageExtractor` decompresses the ZIP and uploads every file to a CDN prefix (`games/{gameId}/versions/{versionId}/extracted/`).
* **Publishing**: `GameVersionPublishService` updates the version state to `PUBLISHED` upon successful extraction.
* **Playback (Runtime)**: `GamePlayer` dynamically loads adapters (`WebGameRuntimeAdapter` or `FoundryRuntimeAdapter`) and points an iframe to the root `index.html` on the CDN.
* **Assumptions**: The platform inherently assumes monolithic, fully extracted web builds.

## 2. Proposed Architecture
* **Upload**: Extends to support a Streaming Manifest + Chunks in addition to Legacy ZIPs.
* **Validation**: Evaluates the Streaming Manifest for schema validity, hash integrity, and dependency graphs without understanding game semantics (no concept of "levels").
* **Publishing**: Publishes the immutable chunks directly to the CDN.
* **Playback (Runtime)**:
  * **Legacy**: Uses existing iframe + CDN root URL.
  * **Streaming**: Introduces an in-browser `StreamingManager` to intercept requests, download chunks into a persistent browser cache (OPFS/IndexedDB), and supply assets dynamically to the engine.

## 3. Compatibility Strategy
The transition is **additive**.
* **LEGACY Mode**: Standard monolithic ZIPs without a streaming manifest flow through the existing extraction pipeline and play normally.
* **STREAMING Mode**: Uploads containing a valid streaming manifest skip legacy extraction, validate chunk hashes, and launch via a new streaming runtime.

## 4. Third-Party Engine Strategy
Foundry operates as an opaque distribution layer.
* **Tier 1 (Legacy)**: Opaque web builds (monolithic).
* **Tier 2 (Chunk-Aware)**: Unity/Godot projects using their own remote-asset features (e.g., Unity Addressables) can generate a Foundry-compatible manifest via an adapter.
* **Tier 3 (Fully Integrated)**: Foundry Engine implements explicit SDK integration for fine-grained chunk and memory lifecycle control.

## 5. Manifest Proposal
The manifest defines the technical topology, not semantic game logic.
```json
{
  "schemaVersion": 1,
  "runtime": {
    "entry": "boot.chunk"
  },
  "chunks": [
    {
      "id": "hash-or-stable-id",
      "url": "chunks/hash-or-stable-id.bin",
      "size": 1048576,
      "compressedSize": 512000,
      "hash": "sha256-...",
      "dependencies": [],
      "priority": "high",
      "preload": true
    }
  ]
}
```

## 6. Runtime Proposal
A new browser-side architecture orchestrates the assets:
* **StreamingManager**: Orchestrator.
* **ChunkResolver**: Maps assets to specific chunks.
* **DownloadManager**: Handles concurrent downloads, retries, and network states.
* **CacheManager**: Abstracts persistent browser storage (OPFS/IndexedDB/Memory).
* **MemoryBudgetManager**: Estimates working set size and adapts to device constraints.
* **EvictionManager**: Purges stale chunks.

## 7. Backend Responsibilities
The backend must NOT inspect binaries to discover "levels" or infer game semantics. It solely handles:
* Validating the manifest schema and structural constraints.
* Verifying chunk sizes, hashes, and quota limits.
* Publishing immutable versions to the CDN.

## 8. Engine / SDK Responsibilities
The build pipeline (Foundry Engine or third-party adapters) is strictly responsible for:
* Dependency analysis.
* Grouping assets into chunks.
* Generating the `manifest.json`.
* Hinting memory priorities.

## 9. Security Implications
* **Path Traversal**: Manifest URLs must be strictly checked to prevent escaping the version directory.
* **Hash Integrity**: Ensures chunks are not modified in transit or cache.
* **Isolation**: Strict version boundaries to prevent cross-contamination.

## 10. Memory Implications
* **RAM != Persistent Storage**: The runtime must explicitly manage a small active working set in RAM while utilizing larger persistent cache (OPFS/IndexedDB).
* **Adaptive Budgets**: RAM budgets are heuristics (e.g., LOW/MEDIUM/HIGH) based on runtime detection, not hardcoded browser guarantees.

## 11. Cache Implications
* Abstracting cache via a `CacheProvider` is mandatory, allowing fallback architectures if OPFS is unsupported or quota is exceeded.

## 12. Migration Risks
* Modifying the publish flow could break the legacy extraction pipeline.
* Branching logic must cleanly separate `GamePackageExtractor` from streaming publish routines.

## 13. Required Changes
* **Backend**: Update `GameVersionPublishService` to detect manifests and branch appropriately.
* **Frontend**: Build the `StreamingManager` and related modules.

## 14. Components That Can Be Reused
* `QuotaConfig` and existing authorization patterns.
* `GamePlayer` and `SandboxBridge`.
* Storage Providers (R2/Local).
* Database models (with minor metadata additions).

## 15. Components That Must Remain Untouched
* `GamePackageExtractor` (used for legacy mode).
* Firebase Authentication / Identity.
* Core engine mechanics (`src/engine`).

## 16. Open Technical Questions
* **Upload Format**: Does the CLI upload a single ZIP containing the manifest + chunks, or does it utilize chunked multipoint uploads? (Assuming ZIP carrier initially for parity).
* **Dependency Validation**: Should the server mathematically reject cyclic dependencies, or just leave that to the runtime?

---

# Recommended Phase 1 Implementation Plan

**Objective: Manifest Contract**
1. Define the formal TypeScript interfaces/JSDoc structures for the Manifest (`AssetManifest`, `ChunkDescriptor`, `DependencyDescriptor`, `RuntimeDescriptor`).
2. Design the JSON schema for these descriptors.
3. Create a deterministic mock manifest that exemplifies edge cases (dependencies, sizes, priorities).
4. No backend validation or runtime implementation will be built in Phase 1.
