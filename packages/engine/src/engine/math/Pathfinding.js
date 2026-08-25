export class Pathfinding {
    static heuristic(a, b) {
        return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    }

    static getNeighbors(node, columns, rows, isWalkableFunc, diagonal = false) {
        const neighbors = [];
        const { col, row } = node;

        const dirs = [
            { c: 0, r: -1 }, // up
            { c: 1, r: 0 },  // right
            { c: 0, r: 1 },  // down
            { c: -1, r: 0 }  // left
        ];

        if (diagonal) {
            dirs.push({ c: 1, r: -1 }, { c: 1, r: 1 }, { c: -1, r: 1 }, { c: -1, r: -1 });
        }

        for (const dir of dirs) {
            const nCol = col + dir.c;
            const nRow = row + dir.r;

            if (nCol >= 0 && nCol < columns && nRow >= 0 && nRow < rows) {
                if (isWalkableFunc(nCol, nRow)) {
                    neighbors.push({ col: nCol, row: nRow });
                }
            }
        }

        return neighbors;
    }

    static findPath(startCol, startRow, endCol, endRow, columns, rows, isWalkableFunc, diagonal = false) {
        const startNode = { col: startCol, row: startRow };
        const endNode = { col: endCol, row: endRow };

        const openSet = [startNode];
        const cameFrom = new Map();
        
        const gScore = new Map();
        const fScore = new Map();
        
        const nodeKey = (col, row) => `${col},${row}`;
        
        gScore.set(nodeKey(startCol, startRow), 0);
        fScore.set(nodeKey(startCol, startRow), this.heuristic(startNode, endNode));

        while (openSet.length > 0) {
            // Get node with lowest fScore
            let current = openSet[0];
            let lowestF = fScore.get(nodeKey(current.col, current.row)) || Infinity;
            let currentIndex = 0;
            
            for (let i = 1; i < openSet.length; i++) {
                const node = openSet[i];
                const f = fScore.get(nodeKey(node.col, node.row)) || Infinity;
                if (f < lowestF) {
                    lowestF = f;
                    current = node;
                    currentIndex = i;
                }
            }

            if (current.col === endCol && current.row === endRow) {
                // Reconstruct path
                const path = [];
                let currKey = nodeKey(current.col, current.row);
                path.push(current);
                
                while (cameFrom.has(currKey)) {
                    current = cameFrom.get(currKey);
                    currKey = nodeKey(current.col, current.row);
                    path.unshift(current);
                }
                
                return path;
            }

            openSet.splice(currentIndex, 1);

            const neighbors = this.getNeighbors(current, columns, rows, isWalkableFunc, diagonal);

            for (const neighbor of neighbors) {
                const neighborKey = nodeKey(neighbor.col, neighbor.row);
                const tentativeG = (gScore.get(nodeKey(current.col, current.row)) || 0) + 1; // 1 cost per move
                
                if (tentativeG < (gScore.get(neighborKey) || Infinity)) {
                    cameFrom.set(neighborKey, current);
                    gScore.set(neighborKey, tentativeG);
                    fScore.set(neighborKey, tentativeG + this.heuristic(neighbor, endNode));
                    
                    if (!openSet.some(n => n.col === neighbor.col && n.row === neighbor.row)) {
                        openSet.push(neighbor);
                    }
                }
            }
        }

        return null; // No path found
    }
}
