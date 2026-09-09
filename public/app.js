/**
 * Ergogen Outline Tool
 * TODO: Clean up raycasting logic if performance drops on complex boards - ngl idk how to fix it if it does
 * yes it was/ is AI vibecoded slop because YAML + JS = i dont like it
 */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const inputYAML = document.getElementById('inputYAML');
const outputYAML = document.getElementById('outputYAML');
const errorLog = document.getElementById('errorLog');
const filletSlider = document.getElementById('filletSlider');
const filletDisplay = document.getElementById('filletValDisplay');

let keys = [];
let outlinePoints = [];
let historyStack = []; 
let units = { px: 21, py: 21, kx: 19, ky: 19 };
let hoverData = null;

let hoveredPointIndex = null;
let draggedPointIndex = null;
let isDraggingCanvas = false;
let hasDraggedCanvas = false;
let startMouseX = 0, startMouseY = 0;

let SCALE = 3.5;
let originX = 0, originY = 0;

// --- STATE MANAGEMENT ---
function saveState() {
    // keeping max 50 states
    historyStack.push(JSON.parse(JSON.stringify(outlinePoints)));
    if (historyStack.length > 50) historyStack.shift();
}

function undo() {
    if (historyStack.length > 0) {
        outlinePoints = historyStack.pop();
        updateUI(true, false);
    }
}

function clearPoints() {
    saveState();
    outlinePoints = [];
    updateUI(true, false);
}

// --- CLIPBOARD HELPER ---
async function copyYAML() {
    const output = outputYAML.value;
    if (!output) return;
    
    try {
        await navigator.clipboard.writeText(output);
        const copyBtn = document.getElementById('btnCopy');
        const oldText = copyBtn.innerText;
        copyBtn.innerText = "COPIED";
        setTimeout(() => { copyBtn.innerText = oldText; }, 1500);
    } catch (err) {
        console.warn('Clipboard write failed', err);
        errorLog.innerText = "ERR: COPY FAILED";
    }
}

// --- MATH / COORDS ---
function roundVal(val) {
    return Math.round(val * 100) / 100;
}

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

// --- YAML COMPILER ---
function generateYAMLText() {
    if (outlinePoints.length === 0) return "";
    
    const filletVal = filletSlider ? filletSlider.value : 0;
    let yaml = `outlines:\n  _outline:\n    - what: path\n      operation: stack\n      fillet: ${filletVal}\n      segments:\n`;
    
    let i = 0;

    function isSamePoint(p1, p2) {
        if (!p1 || !p2) return false;
        return p1.key.id === p2.key.id && 
               roundVal(p1.shiftX) === roundVal(p2.shiftX) && 
               roundVal(p1.shiftY) === roundVal(p2.shiftY);
    }

    while (i < outlinePoints.length) {
        const isArcBlock = outlinePoints[i].isArc;
        
        if (!isArcBlock) {
            let linePts = [];
            while (i < outlinePoints.length && !outlinePoints[i].isArc) {
                const pt = outlinePoints[i];
                const last = linePts[linePts.length - 1];
                if (!last || !isSamePoint(pt, last)) {
                    linePts.push(pt);
                }
                i++;
            }
            yaml += `        - type: line\n          points:\n`;
            linePts.forEach(p => {
                yaml += `            - ref: ${p.key.id}\n              shift: [${roundVal(p.shiftX)}px, ${roundVal(p.shiftY)}py]\n`;
            });
        } else {
            let arcPts = [];
            while (i < outlinePoints.length && outlinePoints[i].isArc) {
                arcPts.push(outlinePoints[i]);
                i++;
            }
            
            let a = 0;
            while (a < arcPts.length) {
                let p1 = arcPts[a];
                let p2 = (a + 1 < arcPts.length) ? arcPts[a + 1] : arcPts[a];

                if (isSamePoint(p1, p2)) {
                    a += 2;
                    continue;
                }
                yaml += `        - type: arc\n          points:\n`;
                yaml += `            - ref: ${p1.key.id}\n              shift: [${roundVal(p1.shiftX)}px, ${roundVal(p1.shiftY)}py]\n`;
                yaml += `            - ref: ${p2.key.id}\n              shift: [${roundVal(p2.shiftX)}px, ${roundVal(p2.shiftY)}py]\n`;
                a += 2;
            }
        }
    }
    return yaml;
}

async function validateYAML(yamlStr) {
    if (!yamlStr) return;
    try {
        const fullYAML = inputYAML.value + "\n" + yamlStr;
        const res = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: fullYAML })
        });
        const data = await res.json();
        
        if (data.error) {
            errorLog.innerText = `ERR: ${data.error}`;
        } else {
            errorLog.innerText = "READY";
        }
    } catch (err) {
        errorLog.innerText = `ERR: ${err.message}`;
    }
}

function updateUI(autoScroll = true, skipVal = false) {
    const yaml = generateYAMLText();
    outputYAML.value = yaml;
    if (autoScroll) outputYAML.scrollTop = outputYAML.scrollHeight;
    if (!skipVal) validateYAML(yaml);
}

// --- SERVER COMMS ---
async function processLayout() {
    errorLog.innerText = "PARSING...";
    try {
        const res = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: inputYAML.value })
        });
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.units) {
            units.kx = data.units.kx || 19; 
            units.ky = data.units.ky || 19;
            units.px = data.units.px || units.kx + 2; 
            units.py = data.units.py || units.ky + 2;
        }

        keys = Object.entries(data.points).map(([id, pt]) => ({
            id: id, x: pt.x, y: pt.y, angle: pt.r 
        }));

        outlinePoints = [];
        updateUI(true, false);
        centerCamera();
        errorLog.innerText = "READY";
    } catch (e) {
        errorLog.innerText = `ERR: ${e.message}`;
    }
}

// --- MOUSE HOVER MATH ---
function handleMouseMoveCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - originX) / SCALE;
    const wy = -((clientY - rect.top - originY) / SCALE); 

    hoveredPointIndex = null;
    if (!isDraggingCanvas && draggedPointIndex === null) {
        let minDist = Infinity;
        outlinePoints.forEach((p, idx) => {
            const pt = getPoint(p);
            const d = Math.hypot(wx - pt.x, wy - pt.y);
            if (d < 12 / SCALE && d < minDist) {
                minDist = d;
                hoveredPointIndex = idx;
            }
        });
    }

    let nearestKey = null;
    let shortestDist = Infinity;

    keys.forEach(k => {
        const d = Math.hypot(wx - k.x, wy - k.y);
        if (d < shortestDist) {
            shortestDist = d;
            nearestKey = k;
        }
    });

    if (nearestKey) {
        const dx = wx - nearestKey.x;
        const dy = wy - nearestKey.y;
        const rad = (-nearestKey.angle * Math.PI) / 180;
        
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

        const isMirrored = nearestKey.id.startsWith('mirror_');
        const sx = roundVal((isMirrored ? -lx : lx) / units.px);
        const sy = roundVal(ly / units.py);

        hoverData = { key: nearestKey, shiftX: sx, shiftY: sy };
    }
}

// --- EVENT HOOKS ---
window.addEventListener('keydown', (e) => {
    if (document.activeElement === inputYAML || document.activeElement === outputYAML) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
    }

    if (e.key.toLowerCase() === 'a' && hoveredPointIndex !== null) {
        saveState();
        outlinePoints[hoveredPointIndex].isArc = !outlinePoints[hoveredPointIndex].isArc;
        updateUI(false, false);
    }
});

if (filletSlider) {
    filletSlider.addEventListener('input', (e) => {
        if (filletDisplay) filletDisplay.innerText = e.target.value;
        updateUI(false, false);
    });
}

canvas.addEventListener('mousedown', (e) => {
    saveState();
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
        handleMouseMoveCoords(e.clientX, e.clientY);
        if (hoverData) {
            outlinePoints[draggedPointIndex] = hoverData;
            updateUI(false, true); // skip validation during quick drag
        }
    } else if (isDraggingCanvas) {
        if (Math.hypot(e.clientX - startMouseX, e.clientY - startMouseY) > 2) hasDraggedCanvas = true;
        originX += e.movementX;
        originY += e.movementY;
    } else {
        handleMouseMoveCoords(e.clientX, e.clientY);
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (draggedPointIndex !== null) {
        draggedPointIndex = null;
        updateUI(true, false);
    } else if (isDraggingCanvas) {
        isDraggingCanvas = false;
        if (!hasDraggedCanvas && hoverData) {
            outlinePoints.push({ ...hoverData, isArc: e.shiftKey });
            updateUI(true, false);
        }
    }
    handleMouseMoveCoords(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = Math.exp((e.deltaY < 0 ? 1 : -1) * 0.1);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    originX = mx - (mx - originX) * zoomFactor;
    originY = my - (my - originY) * zoomFactor;
    SCALE *= zoomFactor;
});

// Button bindings
const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
};

bind('btnRenderBase', processLayout);
bind('btnUndo', undo);
bind('btnClear', clearPoints);
bind('btnCopy', copyYAML);

// --- CANVAS RENDER LOOP ---
function centerCamera() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    if (keys.length === 0) return;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    keys.forEach(k => {
        if (k.x < minX) minX = k.x; if (k.x > maxX) maxX = k.x;
        if (k.y < minY) minY = k.y; if (k.y > maxY) maxY = k.y;
    });
    
    SCALE = 3.5;
    originX = (canvas.width / 2) - (((minX + maxX) / 2) * SCALE);
    originY = (canvas.height / 2) + (((minY + maxY) / 2) * SCALE); 
}

window.addEventListener('resize', centerCamera);

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(SCALE, -SCALE); 

    // 1. Draw Keyboard Switches (Technical Grid Style)
    keys.forEach(k => {
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate((k.angle * Math.PI) / 180);
        
        // Clean solid dark/black line for switch footprints on the cyan workspace
        ctx.strokeStyle = '#002b36'; 
        ctx.fillStyle = '#073642';
        ctx.lineWidth = 1 / SCALE;
        ctx.setLineDash([]);
        
        ctx.fillRect(-units.kx / 2, -units.ky / 2, units.kx, units.ky);
        ctx.strokeRect(-units.kx / 2, -units.ky / 2, units.kx, units.ky);
        
        ctx.restore();
    });

    // 2. Draw Outline Path (Technical vector line style)
    if (outlinePoints.length > 0) {
        ctx.beginPath();
        const first = getPoint(outlinePoints[0]);
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < outlinePoints.length; i++) {
            const pt = getPoint(outlinePoints[i]);
            if (outlinePoints[i].isArc) {
                ctx.setLineDash([3 / SCALE, 3 / SCALE]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.lineTo(pt.x, pt.y);
        }
        
        ctx.strokeStyle = '#ffffff'; // High-contrast white path line
        ctx.lineWidth = 1.5 / SCALE; 
        ctx.stroke();

        // 3. Draw Vertices (Solid square blocks)
        outlinePoints.forEach((p, idx) => {
            const pt = getPoint(p);
            const isHovered = (idx === hoveredPointIndex || idx === draggedPointIndex);
            const size = (isHovered ? 6 : 4) / SCALE;

            ctx.beginPath();
            ctx.rect(pt.x - size / 2, pt.y - size / 2, size, size);
            
            // Plain yellow/white highlight instead of neon glow
            ctx.fillStyle = isHovered ? '#ffff00' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1 / SCALE;
            ctx.stroke();
        });
    }

    // 4. Hover Snap Indicator (Sharp target box)
    if (hoverData && draggedPointIndex === null && !hasDraggedCanvas) {
        const snap = getPoint(hoverData);
        const s = 5 / SCALE;
        ctx.beginPath();
        ctx.strokeStyle = '#ffff00'; // Simple yellow inspector box
        ctx.lineWidth = 1 / SCALE;
        ctx.setLineDash([]);
        ctx.strokeRect(snap.x - s, snap.y - s, s * 2, s * 2);
    }

    ctx.restore();
    requestAnimationFrame(draw);
}

// kick off
processLayout();
draw();