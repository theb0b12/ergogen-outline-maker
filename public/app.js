/**
 * Ergogen Outline Tool - public/app.js
 */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const inputYAML = document.getElementById('yaml-input');
const outputYAML = document.getElementById('yaml-output');
const errorLog = document.getElementById('error-log');
const filletSlider = document.getElementById('fillet-slider');
const filletDisplay = document.getElementById('fillet-val');

let keys = [];
let outlinePoints = [];
let units = { px: 21, py: 21, kx: 19, ky: 19 }; // Defaults
let hoverData = null;

// Interaction State
let hoveredPointIndex = null;
let draggedPointIndex = null;
let isDraggingCanvas = false;
let hasDraggedCanvas = false;
let startMouseX = 0, startMouseY = 0;

// Viewport Transform
let SCALE = 3.5;
let originX = 0, originY = 0;

// --- UTILITY: Math & Formatting ---
// Force values to the nearest 0.05 (Standard Ergogen unit increment)
function standardize(val) {
    return Math.round(val * 20) / 20;
}

// Compute exact world coordinates of an outline point for rendering
function getPoint(p) {
    const rad = (p.key.angle * Math.PI) / 180;
    const isMirrored = p.key.id.startsWith('mirror_');
    const lx = (isMirrored ? -p.shiftX : p.shiftX) * units.px;
    const ly = p.shiftY * units.py;
    return {
        x: p.key.x + (lx * Math.cos(rad) - ly * Math.sin(rad)),
        y: p.key.y + (lx * Math.sin(rad) + ly * Math.cos(rad))
    };
}

// --- API & LAYOUT ---
async function processLayout() {
    errorLog.innerText = "Processing...";
    try {
        const response = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: inputYAML.value })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (data.units) {
            units.kx = data.units.kx || 19; units.ky = data.units.ky || 19;
            units.px = data.units.px || units.kx + 2; units.py = data.units.py || units.ky + 2;
        }

        keys = Object.entries(data.points).map(([id, pt]) => ({
            id: id, x: pt.x, y: pt.y, angle: pt.r 
        }));

        outlinePoints = [];
        updateYAMLOutput();
        centerCamera();
        errorLog.innerText = "";
    } catch (e) {
        errorLog.innerText = e.message;
    }
}

// --- UI UPDATES ---
function updateYAMLOutput(autoScroll = true) {
    if (outlinePoints.length === 0) {
        outputYAML.value = "";
        return;
    }
    
    let yaml = `  _outline:
    - what: polygon
      operation: stack
      fillet: ${filletSlider.value}
      points:\n`;
      
    outlinePoints.forEach(p => {
        // Standardize values on output
        const sX = standardize(p.shiftX);
        const sY = standardize(p.shiftY);
        yaml += `        - ref: ${p.key.id}\n          shift: [${sX}px, ${sY}py]\n`;
    });
    
    outputYAML.value = yaml;
    if (autoScroll) outputYAML.scrollTop = outputYAML.scrollHeight;
}

// --- MOUSE & CURSOR ---
function updateMouseState(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left - originX) / SCALE;
    const worldY = -((clientY - rect.top - originY) / SCALE); 

    // 1. Check if hovering over an existing point
    hoveredPointIndex = null;
    if (!isDraggingCanvas && draggedPointIndex === null) {
        let closestPtDist = Infinity;
        outlinePoints.forEach((p, idx) => {
            const pt = getPoint(p);
            const dist = Math.hypot(worldX - pt.x, worldY - pt.y);
            if (dist < 10 / SCALE && dist < closestPtDist) {
                closestPtDist = dist;
                hoveredPointIndex = idx;
            }
        });
    }

    // 2. Find nearest Ergogen anchor
    let closestDist = Infinity;
    hoverData = null;
    keys.forEach(key => {
        const dist = Math.hypot(worldX - key.x, worldY - key.y);
        if (dist < 30) {
            closestDist = dist;
            const dx = worldX - key.x;
            const dy = worldY - key.y;
            const rad = (-key.angle * Math.PI) / 180;
            const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
            const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

            const isMirrored = key.id.startsWith('mirror_');
            let shiftX = standardize(((isMirrored ? -localX : localX) / units.px));
            let shiftY = standardize((localY / units.py));

            hoverData = { key: key, shiftX: shiftX, shiftY: shiftY };
        }
    });

    // 3. Update Cursors
    if (draggedPointIndex !== null) canvas.style.cursor = 'grabbing';
    else if (isDraggingCanvas) canvas.style.cursor = 'grabbing';
    else if (hoveredPointIndex !== null) canvas.style.cursor = 'move';
    else canvas.style.cursor = 'crosshair';
}

// --- EVENTS ---
window.addEventListener('keydown', (e) => {
    // Context-Aware Undo: Only triggers if not typing in inputs
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const active = document.activeElement;
        if (active === inputYAML || active === outputYAML) return;
        e.preventDefault();
        if (outlinePoints.length > 0) {
            outlinePoints.pop();
            updateYAMLOutput();
        }
    }
});

filletSlider.addEventListener('input', () => {
    filletDisplay.innerText = filletSlider.value;
    updateYAMLOutput(false);
});

canvas.addEventListener('mousedown', (e) => {
    if (hoveredPointIndex !== null) {
        draggedPointIndex = hoveredPointIndex;
    } else {
        isDraggingCanvas = true;
        hasDraggedCanvas = false;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (draggedPointIndex !== null) {
        updateMouseState(e.clientX, e.clientY);
        if (hoverData) {
            outlinePoints[draggedPointIndex] = hoverData;
            updateYAMLOutput(false);
        }
    } else if (isDraggingCanvas) {
        if (Math.hypot(e.clientX - startMouseX, e.clientY - startMouseY) > 3) hasDraggedCanvas = true;
        originX += e.movementX;
        originY += e.movementY;
    } else {
        updateMouseState(e.clientX, e.clientY);
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (draggedPointIndex !== null) {
        draggedPointIndex = null;
        updateYAMLOutput(true);
    } else if (isDraggingCanvas) {
        isDraggingCanvas = false;
        if (!hasDraggedCanvas && hoverData) {
            outlinePoints.push(hoverData);
            updateYAMLOutput(true);
        }
    }
    updateMouseState(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp((e.deltaY < 0 ? 1 : -1) * 0.1);
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    originX = mouseX - (mouseX - originX) * factor;
    originY = mouseY - (mouseY - originY) * factor;
    SCALE *= factor;
});

// --- RENDER ---
function centerCamera() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    if (keys.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    keys.forEach(k => {
        if(k.x < minX) minX = k.x; if(k.x > maxX) maxX = k.x;
        if(k.y < minY) minY = k.y; if(k.y > maxY) maxY = k.y;
    });
    SCALE = 3.5;
    originX = (canvas.width / 2) - (((minX + maxX) / 2) * SCALE);
    originY = (canvas.height / 2) + (((minY + maxY) / 2) * SCALE); 
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(SCALE, -SCALE); 

    keys.forEach(k => {
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate((k.angle * Math.PI) / 180);
        ctx.strokeStyle = '#444'; ctx.lineWidth = 1/SCALE;
        ctx.strokeRect(-units.kx/2, -units.ky/2, units.kx, units.ky);
        ctx.strokeStyle = '#2a2a2a'; ctx.setLineDash([2/SCALE, 2/SCALE]);
        ctx.strokeRect(-units.px/2, -units.py/2, units.px, units.py);
        ctx.restore();
    });

    if (outlinePoints.length > 0) {
        ctx.beginPath();
        const first = getPoint(outlinePoints[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < outlinePoints.length; i++) {
            const pt = getPoint(outlinePoints[i]);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2/SCALE; ctx.setLineDash([]); ctx.stroke();
        
        outlinePoints.forEach((p, idx) => {
            const pt = getPoint(p);
            ctx.beginPath(); 
            const isHovered = (idx === hoveredPointIndex || idx === draggedPointIndex);
            ctx.arc(pt.x, pt.y, isHovered ? 5/SCALE : 3/SCALE, 0, Math.PI*2);
            ctx.fillStyle = isHovered ? '#ffcc00' : '#00ff88'; 
            ctx.fill();
        });
    }

    if (hoverData && draggedPointIndex === null && !hasDraggedCanvas) {
        const snap = getPoint(hoverData);
        ctx.beginPath(); ctx.arc(snap.x, snap.y, 4/SCALE, 0, Math.PI*2);
        ctx.fillStyle = '#ff3366'; ctx.fill();
    }

    ctx.restore();
    requestAnimationFrame(draw);
}

window.addEventListener('resize', centerCamera);
document.getElementById('btn-render').addEventListener('click', processLayout);
document.getElementById('btn-undo').addEventListener('click', () => { outlinePoints.pop(); updateYAMLOutput(); });
document.getElementById('btn-clear').addEventListener('click', () => { outlinePoints = []; updateYAMLOutput(); });

// Default initialization
inputYAML.value = "units:\n  kx: 19\n  ky: 19\n  px: kx + 2\n  py: ky + 2\n\npoints:\n  zones:\n    matrix:\n      columns:\n        pinky: { key: { splay: -7 } }\n        ring: { key: { stagger: 15, splay: -7, spread: kx+4 } }\n      rows:\n        bottom:\n        top:\n  mirror:\n    ref: matrix_ring_top\n    distance: 60";
processLayout();
draw();