const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const platformRoot = __dirname;
const fixtureSource = path.join(platformRoot, 'e2e', 'fixtures', 'streaming-game');
const fixtureZip = path.join(platformRoot, 'e2e', 'fixtures', 'streaming-game.zip');

function addDirectory(zip, directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) addDirectory(zip, sourcePath, archivePath);
    else zip.file(archivePath, fs.readFileSync(sourcePath));
  }
}

async function run() {
  if (!fs.existsSync(fixtureSource)) {
    throw new Error(`Streaming fixture source not found: ${fixtureSource}`);
  }

  const zip = new JSZip();
  addDirectory(zip, fixtureSource);
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  fs.writeFileSync(fixtureZip, content);
  console.log(`Created ${path.relative(platformRoot, fixtureZip)} (${content.length} bytes)`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
