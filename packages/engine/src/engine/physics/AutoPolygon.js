export class AutoPolygon {
    /**
     * Extracts an outline from an ImageBitmap or HTMLImageElement.
     * @param {ImageBitmap|HTMLImageElement} image 
     * @param {number} threshold Alpha threshold (0-255)
     * @param {number} tolerance Tolerance for point simplification
     * @returns {Array<{x:number, y:number}>}
     */
    static generate(image, threshold = 128, tolerance = 2.0) {
        if (!image || !image.width || !image.height) return [];

        let canvas, ctx;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(image.width, image.height);
            ctx = canvas.getContext('2d', { willReadFrequently: true });
        } else {
            canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            ctx = canvas.getContext('2d', { willReadFrequently: true });
        }

        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const data = imageData.data;
        const width = image.width;
        const height = image.height;

        // Marching Squares implementation
        const points = [];
        
        // Find a starting point (first pixel with alpha >= threshold)
        let startX = -1, startY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (data[(y * width + x) * 4 + 3] >= threshold) {
                    startX = x;
                    startY = y;
                    break;
                }
            }
            if (startX !== -1) break;
        }

        if (startX === -1) return []; // No solid pixels

        // Moore neighborhood tracing
        let currentX = startX;
        let currentY = startY;
        let dir = 7; // 0=E, 1=SE, 2=S, etc.

        // Directions: E, SE, S, SW, W, NW, N, NE
        const dx = [1, 1, 0, -1, -1, -1, 0, 1];
        const dy = [0, 1, 1, 1, 0, -1, -1, -1];

        const isSolid = (x, y) => {
            if (x < 0 || x >= width || y < 0 || y >= height) return false;
            return data[(y * width + x) * 4 + 3] >= threshold;
        };

        do {
            points.push({ x: currentX, y: currentY });
            
            let found = false;
            // Check 8 neighbors, starting from (dir + 5) % 8
            let checkDir = (dir + 5) % 8;
            for (let i = 0; i < 8; i++) {
                const nx = currentX + dx[checkDir];
                const ny = currentY + dy[checkDir];
                if (isSolid(nx, ny)) {
                    currentX = nx;
                    currentY = ny;
                    dir = checkDir;
                    found = true;
                    break;
                }
                checkDir = (checkDir + 1) % 8;
            }
            
            if (!found) break; // Isolated pixel
            
            // Limit to avoid infinite loops in weird cases
            if (points.length > width * height) break;
        } while (currentX !== startX || currentY !== startY);

        // Center the polygon
        const hw = width / 2;
        const hh = height / 2;
        for (let i = 0; i < points.length; i++) {
            points[i].x -= hw;
            points[i].y -= hh;
        }

        // Douglas-Peucker simplification
        return this.simplify(points, tolerance);
    }

    static simplify(points, tolerance) {
        if (points.length <= 2) return points;
        
        let dmax = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const d = this.pointLineDistance(points[i], points[0], points[end]);
            if (d > dmax) {
                index = i;
                dmax = d;
            }
        }

        if (dmax > tolerance) {
            const recResults1 = this.simplify(points.slice(0, index + 1), tolerance);
            const recResults2 = this.simplify(points.slice(index, end + 1), tolerance);
            return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
        } else {
            return [points[0], points[end]];
        }
    }

    static pointLineDistance(p, a, b) {
        const num = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x);
        const den = Math.sqrt(Math.pow(b.y - a.y, 2) + Math.pow(b.x - a.x, 2));
        return den === 0 ? 0 : num / den;
    }
}
