self.onmessage = function(e) {
    const { grid, nextGrid, cols, rows } = e.data;
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const idx = x + y * cols;
            const state = grid[idx];
            
            let sum = 0;
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    if (i === 0 && j === 0) continue;
                    
                    const col = (x + i + cols) % cols;
                    const row = (y + j + rows) % rows;
                    sum += grid[col + row * cols];
                }
            }
            
            if (state === 1 && (sum < 2 || sum > 3)) {
                nextGrid[idx] = 0;
            } else if (state === 0 && sum === 3) {
                nextGrid[idx] = 1;
            } else {
                nextGrid[idx] = state;
            }
        }
    }
    
    // Send back the updated grids
    self.postMessage({ grid: nextGrid, nextGrid: grid }, [nextGrid.buffer, grid.buffer]);
};
