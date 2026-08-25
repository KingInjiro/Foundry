const fs = require('fs');

if (process.argv.length < 4) {
    console.error("Usage: node scene-diff.js <file1.json> <file2.json>");
    process.exit(1);
}

const file1 = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const file2 = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));

function compareEntities(entities1, entities2) {
    const e1Map = new Map(entities1.map(e => [e.id, e]));
    const e2Map = new Map(entities2.map(e => [e.id, e]));
    
    let added = 0;
    let removed = 0;
    let modified = 0;
    
    for (const [id, e2] of e2Map.entries()) {
        if (!e1Map.has(id)) {
            console.log(`+ Added Entity: ${e2.name || id}`);
            added++;
        } else {
            const e1 = e1Map.get(id);
            if (JSON.stringify(e1) !== JSON.stringify(e2)) {
                console.log(`~ Modified Entity: ${e2.name || id}`);
                modified++;
            }
        }
    }
    
    for (const [id, e1] of e1Map.entries()) {
        if (!e2Map.has(id)) {
            console.log(`- Removed Entity: ${e1.name || id}`);
            removed++;
        }
    }
    
    return { added, removed, modified };
}

console.log("=== Scene Diff ===");
const diff = compareEntities(file1.entities || [], file2.entities || []);
console.log(`\nSummary: +${diff.added} ~${diff.modified} -${diff.removed}`);
