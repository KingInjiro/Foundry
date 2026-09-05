// Export source is secondary Editor functionality. Keep the raw engine tree
// out of the interactive Editor startup chunk and load it only when an archive
// or GitHub export is requested.
export const engineExportSources = import.meta.glob([
    '../engine/audio/**/*.js',
    '../engine/camera/**/*.js',
    '../engine/core/**/*.js',
    '../engine/entity/**/*.js',
    '../engine/graphics/**/*.js',
    '../engine/input/**/*.js',
    '../engine/math/**/*.js',
    '../engine/physics/**/*.js',
    '../engine/renderer/**/*.js',
    '../engine/serialization/**/*.js',
    '../engine/simulation/**/*.js',
    '../engine/simulations/**/*.js',
    '../engine/ui/**/*.js',
    '../engine/world/**/*.js',
    '../engine/Foundry.js',
    '../engine/index.js'
], { query: '?raw', import: 'default', eager: true });
