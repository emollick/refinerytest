import { RefinerySimulation } from "./simulation.js?v=2";
import { UIController } from "./ui.js?v=2";

/* ------------------------- small helpers ------------------------- */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const mix = (a, b, t) => a + (b - a) * t;
const toHex = (int) => `#${int.toString(16).padStart(6, "0")}`;
const lighten = (hex, amt) => blend(hex, "#ffffff", amt);
const darken = (hex, amt) => blend(hex, "#000000", amt);
function blend(a, b, t) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const r = Math.round(mix(ar, br, t)), g = Math.round(mix(ag, bg, t)), bl = Math.round(mix(ab, bb, t));
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

/* ------------------------- DOM refs you already had ------------------------- */
const mapViewport = document.getElementById("map-viewport");
const sceneContainer = document.getElementById("scene-container");
const menuBar = document.getElementById("menu-bar");
const menuToggle = document.getElementById("menu-toggle");
const scenarioMenu = document.getElementById("scenario-menu");
const unitMenu = document.getElementById("unit-menu");
const importInput = document.getElementById("session-import-input");
const unitPulseList = document.getElementById("unit-pulse");
const mapToolbar = document.querySelector(".map-toolbar");
const prototypeNotes = document.getElementById("prototype-notes");
const gridToggleButton = menuBar?.querySelector('[data-action="view-toggle-grid"]');
const flowToggleButton = menuBar?.querySelector('[data-action="view-toggle-flow"]');
const calloutShelf = document.getElementById("alert-callouts");
const mapStatusPanel = document.querySelector(".map-status");

sceneContainer.innerHTML = "";

/* ------------------------- sim + ui ------------------------- */
const simulation = new RefinerySimulation();
const ui = new UIController(simulation);
if (typeof ui.setModeBadge === "function") ui.setModeBadge("AUTO");

/* ------------------------- configs (unchanged) ------------------------- */
const unitConfigs = [
  { id: "distillation", name: "Crude Distillation", tileX: 6,  tileY: 3,  width: 3, height: 4, color: 0xbec9df, accent: 0xf3cf73, accentAlt: 0xe8933d, style: "towers" },
  { id: "reformer",     name: "Naphtha Reformer",   tileX: 3,  tileY: 6,  width: 2, height: 3, color: 0xd6aa80, accent: 0x8c5a31, accentAlt: 0xf2d5a4, style: "rect"   },
  { id: "fcc",          name: "Catalytic Cracker",  tileX: 10, tileY: 6,  width: 3, height: 3, color: 0xe2c568, accent: 0x9a6a24, accentAlt: 0xf6df9a, style: "reactor"},
  { id: "hydrocracker", name: "Hydrocracker",       tileX: 3,  tileY: 2,  width: 2, height: 3, color: 0xb6ded0, accent: 0x419a74, accentAlt: 0xdaf0e8, style: "towers" },
  { id: "alkylation",   name: "Alkylation",         tileX: 11, tileY: 2,  width: 2, height: 3, color: 0xd3b3f2, accent: 0x845ec4, accentAlt: 0xf3e1ff, style: "rect"   },
  { id: "sulfur",       name: "Sulfur Recovery",    tileX: 7,  tileY: 9,  width: 2, height: 2, color: 0xe9edf1, accent: 0x8c96a7, accentAlt: 0xf7f9fb, style: "support"},
];

const pipelineConfigs = [
  { id: "toReformer",      metric: "toReformer",      capacity: 70,  color: 0x6fc2ff, phase: 0,   path: [{x:7,y:4.5},{x:5,y:4.5},{x:5,y:7},{x:3.5,y:7}] },
  { id: "toCracker",       metric: "toCracker",       capacity: 90,  color: 0xf7b25c, phase: 1.3, path: [{x:7,y:4.5},{x:9.5,y:4.5},{x:9.5,y:7},{x:11,y:7}] },
  { id: "toHydrocracker",  metric: "toHydrocracker",  capacity: 70,  color: 0x8ee2c4, phase: 2.2, path: [{x:7,y:4.5},{x:4.5,y:4.5},{x:4.5,y:3.5},{x:3.5,y:3.5}] },
  { id: "toAlkylation",    metric: "toAlkylation",    capacity: 45,  color: 0xc5a1ff, phase: 2.9, path: [{x:11,y:7},{x:12,y:7},{x:12,y:3.5}] },
  { id: "toExport",        metric: "toExport",        capacity: 160, color: 0x9ec8ff, phase: 3.6, path: [{x:7,y:4.5},{x:11,y:4.5},{x:11,y:9.5},{x:13.5,y:9.5}] },
];

/* ------------------------- topology helpers ------------------------- */
const processTopology = simulation.getProcessTopology?.() || {};
function buildUnitConnectionIndex(topology) {
  const map = new Map();
  Object.entries(topology || {}).forEach(([unitId, entry]) => {
    const set = new Set();
    (entry.feeds || []).forEach((i) => i?.pipeline && set.add(i.pipeline));
    (entry.outputs || []).forEach((i) => i?.pipeline && set.add(i.pipeline));
    map.set(unitId, [...set]);
  });
  return map;
}
const unitConnectionIndex = buildUnitConnectionIndex(processTopology);

/* =================================================================== */
/* =========================  CANVAS RENDERER  ======================== */
/* =================================================================== */

class CanvasRenderer {
  constructor(container, simulation, unitDefs, pipelineDefs) {
    this.container = container;
    this.simulation = simulation;
    this.unitDefs = unitDefs;
    this.pipelineDefs = pipelineDefs;
    this.pipelineLookup = new Map(pipelineDefs.map(p => [p.id, p]));

    // map geometry
    this.tileW = 64;
    this.tileH = 32;
    this.cols = 16;
    this.rows = 12;

    // compute world extents (isometric diamond)
    this.worldW = (this.cols + this.rows) * this.tileW / 2;
    this.worldH = (this.cols + this.rows) * this.tileH / 2;
    this.originX = this.worldW / 2 - ((this.cols - this.rows) * this.tileW) / 4;
    this.originY = this.tileH; // slight top padding

    // canvas + dpi
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.style.cursor = "grab";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d", { alpha: true });
    this.container.appendChild(this.canvas);

    // camera in CSS pixels; offsets are applied by ctx transform
    this.camera = {
      zoom: 1,
      min: 0.65,
      max: 2.8,
      ox: 0, oy: 0,            // offsets in device pixels
      homeZoom: 1,
      homeOX: 0, homeOY: 0,
      user: false
    };

    // state
    this.time = 0;
    this.gridVisible = true;
    this.flowVisible = true;
    this.highlighted = new Set();
    this.selectedUnitId = null;
    this.hoverUnitId = null;
    this.pointer = { x: 0, y: 0, active: false };
    this.pan = null;

    // palettes (+ retro)
    this.palettes = [
      {
        pavement: "#c8b79c", water: "#1d3b63", waterHi: "#2e5a87",
        shore: "#365b74", grass: "#7fb368", green:"#6fa793",
        field:"#b0823c", fieldAlt:"#d3a754",
        road:"#3c465c", roadLine:"#f0ddb1",
        walkway:"#c4af8a", outline:"#1c1d20",
        grid:"rgba(32,40,54,0.4)", pipeBase:"#76aee8", pipeGlow:"rgba(240,252,255,0.75)",
        labelBg:"rgba(12,16,22,0.6)"
      },
      {
        pavement:"#b5becb", water:"#16314e", waterHi:"#254a72",
        shore:"#314d6b", grass:"#6b9463", green:"#6fa0a9",
        field:"#9d7134", fieldAlt:"#c48a3d",
        road:"#3a4357", roadLine:"#e7deb4",
        walkway:"#bca27f", outline:"#16171c",
        grid:"rgba(20,32,48,0.42)", pipeBase:"#8ec8ff", pipeGlow:"rgba(226,246,255,0.8)",
        labelBg:"rgba(10,12,18,0.65)"
      },
      // SimRefinery-ish
      {
        pavement:"#b59b6b", water:"#1d4aa6", waterHi:"#2f76d4",
        shore:"#355672", grass:"#78a35a", green:"#6ea294",
        field:"#b28338", fieldAlt:"#d4a44b",
        road:"#5f6265", roadLine:"#e4d29f",
        walkway:"#b9a17a", outline:"#2b2e34",
        grid:"rgba(18,24,34,0.45)", pipeBase:"#6ea0d8", pipeGlow:"rgba(240,252,255,0.70)",
        labelBg:"rgba(10,14,20,0.62)"
      }
    ];
    this.paletteIndex = 2;

    // map tiles + decor
    this.tiles = this._buildTiles();
    this.decor = this._buildDecor();

    // textures
    this._makeDitherTextures();

    // DPI + first layout
    this.deviceScaleX = 1;
    this.deviceScaleY = 1;
    this.resizeToContainer(this.container);
    this._fitCameraToView();

    // visual options
    this.canvas.style.imageRendering = "pixelated";
  }

  /* ------------ public surface (used by your UI code) ------------ */
  getSurface() { return this.canvas; }
  setGridVisible(v){ this.gridVisible = v; }
  setFlowVisible(v){ this.flowVisible = v; }
  cyclePalette(){ this.paletteIndex = (this.paletteIndex + 1) % this.palettes.length; this._makeDitherTextures(); }
  setHighlightedPipelines(ids){ this.highlighted = new Set(ids); }
  setSelectedUnit(id){ this.selectedUnitId = id; }
  setHoverUnit(id){ this.hoverUnitId = id; }
  setPointer(x,y,a){ this.pointer = { x, y, active:a }; }

resizeToContainer(container) {
  const rect = container.getBoundingClientRect();
  const w = Math.max(720, Math.floor(rect.width || 0));
  const h = Math.max(480, Math.floor(rect.height || 0));

  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // Set the device pixel buffer size
  this.canvas.width  = Math.floor(w * dpr);
  this.canvas.height = Math.floor(h * dpr);

  // 🔧 KEY FIX: also set CSS pixel size so the canvas is visible even if the
  // container has no explicit height
  this.canvas.style.width  = `${w}px`;
  this.canvas.style.height = `${h}px`;

  this.displayW = w;
  this.displayH = h;

  // pointer and wheel math use device pixels
  this.dpr = dpr;
  this.deviceScaleX = dpr;
  this.deviceScaleY = dpr;

  // Keep centered until the user moves the camera
  if (!this.camera.user) {
    const { ox, oy, zoom } = this._centeredAt(this.camera.zoom);
    this.camera.ox = ox;
    this.camera.oy = oy;
    this.camera.homeOX = ox;
    this.camera.homeOY = oy;
    this.camera.homeZoom = zoom;
  }
}


  resetView(){
    this.camera.user = false;
    const { ox, oy, zoom } = this._centeredAt(this.camera.homeZoom);
    this.camera.zoom = zoom;
    this.camera.ox = ox;
    this.camera.oy = oy;
    this._clampCamera();
  }

  screenToIso(sx, sy){
    // sx/sy are in canvas *pixel* coordinates (caller multiplies by dpr)
    const wx = (sx - this.camera.ox) / this.camera.zoom;
    const wy = (sy - this.camera.oy) / this.camera.zoom;
    const x = (wx - this.originX) / (this.tileW / 2);
    const y = (wy - this.originY) / (this.tileH / 2);
    return { x: (x + y)/2, y: (y - x)/2 };
  }

  getUnitAt(wx, wy){
    for (const u of this.unitDefs) {
      const withinX = wx >= u.tileX - 0.25 && wx <= u.tileX + u.width  - 0.1;
      const withinY = wy >= u.tileY - 0.25 && wy <= u.tileY + u.height - 0.1;
      if (withinX && withinY) return u;
    }
    return null;
  }

  beginPan(sx, sy){
    this.canvas.style.cursor = "grabbing";
    this.pan = { sx, sy, ox: this.camera.ox, oy: this.camera.oy };
    this.camera.user = true;
  }
  panTo(sx, sy){
    if (!this.pan) return;
    this.camera.ox = this.pan.ox + (sx - this.pan.sx);
    this.camera.oy = this.pan.oy + (sy - this.pan.sy);
    this._clampCamera();
  }
  endPan(){ this.pan = null; this.canvas.style.cursor = "grab"; }
  isPanning(){ return !!this.pan; }

  nudgeCamera(dx, dy){
    this.camera.ox += dx;
    this.camera.oy += dy;
    this.camera.user = true;
    this._clampCamera();
  }

  zoomAt(sx, sy, deltaY){
    const factor = Math.exp(-deltaY * 0.0012);
    const next = clamp(this.camera.zoom * factor, this.camera.min, this.camera.max);
    if (Math.abs(next - this.camera.zoom) < 0.0001) return;

    // zoom around pointer
    const wx = (sx - this.camera.ox) / this.camera.zoom;
    const wy = (sy - this.camera.oy) / this.camera.zoom;
    this.camera.zoom = next;
    this.camera.ox = sx - wx * next;
    this.camera.oy = sy - wy * next;
    this.camera.user = true;
    this._clampCamera();
  }

  focusOnUnit(id, { onlyIfVisible = true } = {}){
    const unit = this.unitDefs.find(u => u.id === id);
    if (!unit) return;
    const c = this._tileToScreen(unit.tileX + unit.width/2, unit.tileY + unit.height/2);
    const sx = c.x * this.camera.zoom + this.camera.ox;
    const sy = c.y * this.camera.zoom + this.camera.oy;
    const margin = 120 * this.dpr;
    if (onlyIfVisible && sx>=margin && sx<=this.canvas.width-margin && sy>=margin && sy<=this.canvas.height-margin) return;
    this._moveCameraTo(c.x, c.y);
    this.camera.user = true;
  }

  /* ----------------------------- render ---------------------------- */
  render(dt, { flows, logistics }){
    this.time += dt;

    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.ox, this.camera.oy);

    const pal = this.palettes[this.paletteIndex];

    // base tiles
    this._drawTiles(ctx, pal);

    // grid
    if (this.gridVisible) this._drawGrid(ctx, pal);

    // pipelines
    this._drawPipelines(ctx, pal, flows);

    // units + labels + gauges
    this._drawUnits(ctx, pal);

    // pointer
    if (this.pointer.active) this._drawPointer(ctx, pal);

    ctx.restore();
  }

  /* --------------------------- draw parts -------------------------- */
  _drawTiles(ctx, pal){
    const base = (tx, ty) => this._tileToScreen(tx, ty);
    for (let y=0; y<this.rows; y++){
      for (let x=0; x<this.cols; x++){
        const t = this.tiles[y][x]; const [type, orient] = t.split("-");
        const p = this._tileDiamond(x, y);
        // fill (dither) + outline
        ctx.fillStyle = this._textureFor(type, pal);
        ctx.beginPath(); pathPolygon(ctx, p); ctx.fill();

        // soft highlight/shadow to add depth
        const hi = lighten(this._colorFor(type, pal), type==="water" ? 0.35 : 0.22);
        const sh = darken (this._colorFor(type, pal), type==="water" ? 0.25 : 0.30);
        // highlight cap
        ctx.fillStyle = hexWithAlpha(hi, type==="water" ? 0.55 : 0.42);
        pathPolygon(ctx, this._highlightPoly(p)); ctx.fill();
        // shadow wedge
        ctx.fillStyle = hexWithAlpha(sh, type==="water" ? 0.4 : 0.55);
        pathPolygon(ctx, this._shadowPoly(p)); ctx.fill();

        // roads/walkways after ground
        if (type === "road"){
          const poly = this._roadPoly(x, y, orient || "ew");
          ctx.fillStyle = pal.road;
          pathPolygon(ctx, poly); ctx.fill();

          // dashed center line
          const [s, e] = this._roadCenterLine(x, y, orient || "ew");
          ctx.save(); ctx.lineWidth = 1.6; ctx.setLineDash([6,6]); ctx.lineCap = "round";
          ctx.strokeStyle = pal.roadLine; ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); ctx.restore();
        }
        if (type === "walkway"){
          const poly = this._walkwayPoly(x,y);
          ctx.fillStyle = pal.walkway; pathPolygon(ctx, poly); ctx.fill();
        }
        if (type === "shore"){
          // a little foam line
          ctx.strokeStyle = hexWithAlpha(lighten(pal.waterHi || pal.water, .25), .7);
          ctx.lineWidth = 1; ctx.beginPath();
          const c = base(x,y), r = base(x+1,y), b = base(x,y+1), l = base(x-1,y);
          ctx.moveTo(mix(l.x, c.x, .78), mix(l.y, c.y, .78));
          ctx.lineTo(mix(c.x, r.x, .62), mix(c.y, r.y, .62));
          ctx.lineTo(mix(r.x, b.x, .72), mix(r.y, b.y, .72));
          ctx.stroke();
        }
      }
    }
  }

  _drawGrid(ctx, pal){
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    for (let y=0; y<this.rows; y++)
      for (let x=0; x<this.cols; x++)
        { ctx.beginPath(); pathPolygon(ctx, this._tileDiamond(x,y)); ctx.stroke(); }
  }

  _drawPipelines(ctx, pal, flows){
    const t = this.time;
    for (const pipe of this.pipelineDefs){
      // base stroke
      const baseColor = toHex(pipe.color ?? 0x6ea0d8);
      ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = baseColor;
      ctx.beginPath();
      pipe.path.forEach((pt,i) => {
        const p = this._tileToScreen(pt.x, pt.y);
        if (i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      // glow/dash shows flow
      const v = flows?.[pipe.metric] ?? 0;
      const ratio = pipe.capacity ? clamp(v / pipe.capacity, 0, 1.5) : 0;
      const highlighted = this.highlighted.has(pipe.id);
      const intensity = highlighted ? 1 : clamp(ratio, 0.2, 0.9);
      if (this.flowVisible) {
        ctx.save();
        ctx.strokeStyle = pal.pipeGlow;
        ctx.lineWidth = highlighted ? 10 : 7;
        ctx.globalAlpha = 0.12 + intensity * 0.6;
        ctx.setLineDash([18,22]);
        ctx.lineDashOffset = -((t * 60 + (pipe.phase||0) * 40) % 180);
        ctx.beginPath();
        pipe.path.forEach((pt,i) => {
          const p = this._tileToScreen(pt.x, pt.y);
          if (i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawUnits(ctx, pal){
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

    for (const u of this.unitDefs){
      const c = this._tileToScreen(u.tileX + u.width/2, u.tileY + u.height/2);

      // base shape (diamond-ish body + roof + shadow)
      const bodyW = this.tileW * Math.max(0.55, u.width * 0.45);
      const bodyH = this.tileH * Math.max(0.60, u.height * 0.50);

      const body = diamond(c.x, c.y, bodyW, bodyH);
      const shadow = body.map(([x,y]) => [x + this.tileW*0.08, y + this.tileH*0.14]);
      const roof   = body.map(([x,y]) => [c.x + (x-c.x)*0.72, c.y + (y-c.y)*0.72]);

      ctx.fillStyle = hexWithAlpha(darken(toHex(u.color), .55), .45);
      pathPolygon(ctx, shadow); ctx.fill();

      ctx.fillStyle = toHex(u.color);
      ctx.strokeStyle = darken(toHex(u.color), .4);
      ctx.lineWidth = 1.5; pathPolygon(ctx, body); ctx.fill(); ctx.stroke();

      ctx.fillStyle = lighten(toHex(u.accent), .25);
      ctx.strokeStyle = darken(toHex(u.accent), .38);
      pathPolygon(ctx, roof); ctx.fill(); ctx.stroke();

      // selection / hover ring (pulsing)
      const isSel = this.selectedUnitId === u.id;
      const isHover = !isSel && this.hoverUnitId === u.id;
      if (isSel || isHover) {
        ctx.save();
        const pulse = isSel ? (0.45 + Math.sin(this.time*3)*0.35) : 0.35;
        ctx.strokeStyle = hexWithAlpha(lighten(toHex(u.color), .45), pulse);
        ctx.lineWidth = 3;
        pathPolygon(ctx, diamond(c.x, c.y + this.tileH*0.2, this.tileW*1.2, this.tileH*0.5));
        ctx.stroke();
        ctx.restore();
      }

      // gauges
      const unit = this.simulation.getUnits().find(v => v.id === u.id);
      const utilization = clamp(unit?.utilization ?? 0, 0, 1.3);
      const integrity   = clamp(unit?.integrity ?? 0, 0, 1);
      const barW = 52, barH = 10, gx = c.x - barW/2, gy = c.y + this.tileH*0.5;
      // bg
      ctx.fillStyle = pal.labelBg; roundRect(ctx, gx, gy, barW, barH, 3); ctx.fill();
      // load
      ctx.fillStyle = "#6ed16f"; roundRect(ctx, gx, gy, barW*clamp(utilization,0,1), 4, 2); ctx.fill();
      // integrity
      ctx.fillStyle = "#66b0ff"; roundRect(ctx, gx, gy+6, barW*integrity, 4, 2); ctx.fill();

      // label
      ctx.fillStyle = "#f1f5ff";
      ctx.fillText(u.name, c.x, c.y + this.tileH*0.85);
    }
  }

  _drawPointer(ctx, pal){
    const p = this._diamondAt(this.pointer.x, this.pointer.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); pathPolygon(ctx, p); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* -------------------------- math & helpers ----------------------- */
  _tileToScreen(wx, wy){
    return {
      x: this.originX + (wx - wy) * (this.tileW/2),
      y: this.originY + (wx + wy) * (this.tileH/2)
    };
  }

  _tileDiamond(tx, ty){
    const p = this._tileToScreen(tx, ty);
    return [
      [p.x, p.y],
      [p.x + this.tileW/2, p.y + this.tileH/2],
      [p.x, p.y + this.tileH],
      [p.x - this.tileW/2, p.y + this.tileH/2],
    ];
  }

  _diamondAt(wx, wy){
    const p = this._tileToScreen(wx, wy);
    return [
      [p.x, p.y],
      [p.x + this.tileW/2, p.y + this.tileH/2],
      [p.x, p.y + this.tileH],
      [p.x - this.tileW/2, p.y + this.tileH/2],
    ];
  }

  _highlightPoly(points){
    const [top, right, bottom, left] = points;
    const center = [(top[0]+right[0]+bottom[0]+left[0])/4,(top[1]+right[1]+bottom[1]+left[1])/4];
    const L = (a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    return [top, L(top,right,.45), center, L(top,left,.45)];
  }
  _shadowPoly(points){
    const [, right, bottom, left] = points;
    const L = (a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    return [right, L(right,bottom,.55), bottom, L(bottom,left,.4), L(right,points[0],.25)];
  }

  _roadPoly(tx, ty, dir){
    const p = this._tileDiamond(tx,ty);
    const L=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    if (dir==="ns") return [ L(p[0],p[1],.4), L(p[0],p[3],.4), L(p[2],p[3],.4), L(p[2],p[1],.4) ];
    if (dir==="ew") return [ L(p[3],p[0],.4), L(p[1],p[0],.4), L(p[1],p[2],.4), L(p[3],p[2],.4) ];
    // cross = combine
    const a = [ L(p[3],p[0],.4), L(p[1],p[0],.4), L(p[1],p[2],.4), L(p[3],p[2],.4) ];
    const b = [ L(p[0],p[1],.4), L(p[0],p[3],.4), L(p[2],p[3],.4), L(p[2],p[1],.4) ];
    return a.concat(b);
  }
  _roadCenterLine(tx, ty, dir){
    const p = this._tileDiamond(tx,ty);
    const L=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    if (dir==="ns") return [ L(p[0],p[2],.12), L(p[0],p[2],.88) ];
    return [ L(p[3],p[1],.12), L(p[3],p[1],.88) ];
  }
  _walkwayPoly(tx,ty){
    const c = this._tileDiamond(tx,ty);
    const L=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    return [ L(c[0],c[1],.6), L(c[0],c[3],.6), L(c[2],c[3],.6), L(c[2],c[1],.6) ];
  }

  _centeredAt(zoom){
    const bounds = this._mapBounds();
    const cx = (bounds.minX+bounds.maxX)/2;
    const cy = (bounds.minY+bounds.maxY)/2;
    const ox = this.canvas.width/2 - cx * zoom;
    const oy = this.canvas.height/2 - cy * zoom;
    return { ox, oy, zoom };
  }

  _moveCameraTo(wx, wy){
    this.camera.ox = this.canvas.width/2 - wx * this.camera.zoom;
    this.camera.oy = this.canvas.height/2 - wy * this.camera.zoom;
    this._clampCamera();
  }

  _fitCameraToView(){
    const b = this._mapBounds();
    const padX = 160 * this.dpr, padY = 140 * this.dpr;
    const availW = this.canvas.width - padX;
    const availH = this.canvas.height - padY;
    const scaleX = availW / Math.max(1, b.width);
    const scaleY = availH / Math.max(1, b.height);
    const target = clamp(Math.min(scaleX, scaleY), this.camera.min, this.camera.max);
    const { ox, oy } = this._centeredAt(target);
    this.camera.homeZoom = target; this.camera.zoom = target;
    this.camera.homeOX = ox; this.camera.homeOY = oy;
    this.camera.ox = ox; this.camera.oy = oy;
  }

  _clampCamera(){
    const b = this._mapBounds();
    const z = this.camera.zoom;
    const mapW = b.width * z, mapH = b.height * z;
    const margin = 48 * this.dpr;
    // allow breathing room if map smaller than viewport
    const extraX = Math.max((this.canvas.width  - mapW)/2, 0);
    const extraY = Math.max((this.canvas.height - mapH)/2, 0);
    const effX = Math.min(margin, extraX);
    const effY = Math.min(margin, extraY);

    const minOX =  effX - b.minX * z;
    const maxOX =  this.canvas.width - effX - b.maxX * z;
    const loX = Math.min(minOX, maxOX), hiX = Math.max(minOX, maxOX);

    const minOY =  effY - b.minY * z;
    const maxOY =  this.canvas.height - effY - b.maxY * z;
    const loY = Math.min(minOY, maxOY), hiY = Math.max(minOY, maxOY);

    this.camera.ox = clamp(this.camera.ox, loX, hiX);
    this.camera.oy = clamp(this.camera.oy, loY, hiY);
  }

  _mapBounds(){
    const corners = [
      this._tileToScreen(0,0),
      this._tileToScreen(this.cols,0),
      this._tileToScreen(0,this.rows),
      this._tileToScreen(this.cols,this.rows),
    ];
    const xs = corners.map(p=>p.x), ys = corners.map(p=>p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX-minX, height: maxY-minY };
  }

  /* --------------------- tiles, decor, textures -------------------- */
  _buildTiles(){
    const T = Array.from({length:this.rows},()=>Array.from({length:this.cols},()=> "pavement"));
    for (let y=0;y<this.rows;y++){
      for (let x=0;x<this.cols;x++){
        if (x<2 && y<6) T[y][x]="water";
        else if (x<2 && y<8) T[y][x]="shore";
        else if (y>=this.rows-3 && x<4) T[y][x]="field";
        else if (y>=this.rows-4 && x<5) T[y][x]="field";
        else if (y<3 && x>=this.cols-3) T[y][x]="water";
        else if (x===2 && y>=6 && y<this.rows-1) T[y][x]="grass";
        else if (y===this.rows-1 && x>=4) T[y][x]="grass";
        else if (y>=3 && y<=4 && x>=3 && x<=5) T[y][x]="green";

        const cur = T[y][x];
        if (y===5 && x>=2 && x<=this.cols-2 && cur!=="water" && cur!=="shore")
          T[y][x] = cur.startsWith("road")? "road-cross" : "road-ew";
        if (x===7 && y>=2 && y<=this.rows-2 && cur!=="water" && cur!=="shore")
          T[y][x] = T[y][x].startsWith("road")? "road-cross" : "road-ns";
        if ((x===6||x===8||(y===6&&(x===5||x===9))) && !["water","shore"].includes(T[y][x]) && !T[y][x].startsWith("road"))
          T[y][x] = "walkway";
      }
    }
    return T;
  }
  _buildDecor(){
    return [
      { type:"parking",  x:12.5, y:1.8, width:2.5, height:1.8 },
      { type:"booth",    x:5.2,  y:10.4 },
      { type:"flare",    x:9.5,  y:2.1 },
      { type:"dock",     x:14.2, y:9.6 },
      { type:"barn",     x:1.8,  y:10.2 },
      { type:"recording",x:6.8,  y:0.6 },
    ];
  }

  _makeDitherTextures(){
    // create 2x2 patterns per surface in the current palette
    const pal = this.palettes[this.paletteIndex];
    const mk = (base, dot) => {
      const c = document.createElement("canvas"); c.width=2; c.height=2;
      const g = c.getContext("2d");
      g.fillStyle = base; g.fillRect(0,0,2,2);
      g.fillStyle = dot; g.fillRect(0,0,1,1); g.fillRect(1,1,1,1);
      return this.ctx.createPattern(c,"repeat");
    };
    this.tex = {
      pavement: mk(pal.pavement, darken(pal.pavement, .22)),
      grass:    mk(pal.grass,    darken(pal.grass,    .25)),
      field:    mk(pal.field,    lighten(pal.field,   .18)),
      water:    mk(pal.water,    darken(pal.water,    .25)),
      green:    mk(pal.green,    darken(pal.green,    .2))
    };
  }
  _textureFor(type, pal){
    if (type==="pavement") return this.tex.pavement;
    if (type==="grass")    return this.tex.grass;
    if (type==="field")    return this.tex.field;
    if (type==="water")    return this.tex.water;
    if (type==="green")    return this.tex.green;
    if (type==="shore")    return this.tex.pavement;
    if (type.startsWith("road") || type==="walkway") return pal.pavement;
    return pal.pavement;
  }
  _colorFor(type, pal){
    if (type==="pavement") return pal.pavement;
    if (type==="grass") return pal.grass;
    if (type==="field") return pal.field;
    if (type==="water") return pal.water;
    if (type==="green") return pal.green;
    if (type==="shore") return pal.shore;
    if (type.startsWith("road")) return pal.road;
    if (type==="walkway") return pal.walkway;
    return pal.pavement;
  }
}

/* ----------------------- canvas geometry helpers ------------------- */
function pathPolygon(ctx, pts){ ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function diamond(cx, cy, w, h){
  const hw=w/2, hh=h/2;
  return [[cx,cy-hh],[cx+hw,cy],[cx,cy+hh],[cx-hw,cy]];
}
function roundRect(ctx, x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function hexWithAlpha(hex, alpha){
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* =================================================================== */
/* ===========================  APP WIRING  ========================== */
/* =================================================================== */

const renderer = new CanvasRenderer(mapViewport, simulation, unitConfigs, pipelineConfigs);
const surface = renderer.getSurface();

/* ------------------------------ UI state --------------------------- */
const unitPulseEntries = new Map();
const unitModeLabels = new Map();
let selectedUnitId = null;
let activePreset = "auto";
let lastPulseRefresh = 0;
let gridVisible = true;
let flowOverlayVisible = true;
let activeMenu = null;
let panPointerId = null;

/* ------------------------- presets & menus (unchanged) ------------- */
const PRESETS = {
  auto:    { label:"AUTO",   crude:120, focus:0.5,  maintenance:0.65, safety:0.45, environment:0.35, log:"Operator returned controls to automatic balancing." },
  manual:  { label:"MANUAL", crude:180, focus:0.68, maintenance:0.45, safety:0.36, environment:0.22, log:"Manual push: throughput prioritized for gasoline blending." },
  shutdown:{ label:"SHUTDN", crude:0,   focus:0.5,  maintenance:0.82, safety:0.72, environment:0.55, log:"Emergency shutdown drill initiated." },
};
const SESSION_PRESETS = {
  legacy: { scenario:"maintenanceCrunch", params:{ crude:112, focus:0.46, maintenance:0.38, safety:0.34, environment:0.28 },
            storageLevels:{ gasoline:212, diesel:158, jet:122 },
            shipments:[ {product:"gasoline", volume:88, window:4.2, dueIn:0.9},{product:"diesel", volume:74, window:3.8, dueIn:0.6} ],
            shipmentStats:{ total:4, onTime:2, missed:2 }, nextShipmentIn:0.8,
            units:[ {id:"distillation", integrity:0.58},{id:"reformer", integrity:0.4},{id:"fcc", integrity:0.45},{id:"hydrocracker", integrity:0.42, downtime:95},{id:"alkylation", integrity:0.5},{id:"sulfur", integrity:0.56} ],
            marketStress:0.44, timeMinutes:60*9, log:"Recovered training save loaded — tanks brimmed and maintenance overdue." },
  modern: { scenario:"exportPush", params:{ crude:168, focus:0.64, maintenance:0.55, safety:0.48, environment:0.32 },
            storageLevels:{ gasoline:126, diesel:104, jet:68 },
            shipments:[ {product:"jet", volume:82, window:5.5, dueIn:1.6},{product:"gasoline", volume:64, window:4.8, dueIn:2.1} ],
            shipmentStats:{ total:3, onTime:1, missed:0 }, nextShipmentIn:1.4,
            units:[ {id:"reformer", integrity:0.72},{id:"hydrocracker", integrity:0.68},{id:"alkylation", integrity:0.74} ],
            unitOverrides:{ hydrocracker:{throttle:1.08}, sulfur:{throttle:1.05} },
            marketStress:0.3, timeMinutes:60*3, log:"Modernization drill loaded — chase export contracts without breaking reliability." }
};

/* ----------------------------- toolbar wiring (unchanged) ---------- */
const toolbarPresetButtons = document.querySelectorAll("[data-preset]");
const toolbarUnitButtons   = document.querySelectorAll("[data-unit-target]");
const toolbarScenarioButtons = document.querySelectorAll("[data-scenario]");
toolbarPresetButtons.forEach(b => b.addEventListener("click", () => applyPreset(b.dataset.preset)));
toolbarUnitButtons.forEach(b => b.addEventListener("click", () => { const t=b.dataset.unitTarget||null; setSelectedUnit(t); ui.selectUnit(t); }));
toolbarScenarioButtons.forEach(b => b.addEventListener("click", () => { const s=b.dataset.scenario; if (!s) return; simulation.applyScenario(s); ui.setScenario(s); updateScenarioButtons(s); }));

const sliderInputs = document.querySelectorAll('#hud input[type="range"]');
sliderInputs.forEach(input => input.addEventListener("input", () => {
  updatePresetButtons(null); activePreset=null; if (typeof ui.setModeBadge === "function") ui.setModeBadge("CUSTOM");
}));

if (ui.elements?.scenario) ui.elements.scenario.addEventListener("change", e => updateScenarioButtons(e.target.value));

ui.onRunningChange = (running) => updateMenuToggle(running);
ui.onReset = () => performSimulationReset();

applyPreset("auto", { silent: true });
updatePresetButtons("auto");
updateScenarioButtons(simulation.activeScenarioKey);
updateUnitButtons(null);
ui.refreshControls();
initializeMenus();
updateMenuToggle(simulation.running);
setGridVisibility(gridVisible);
setFlowVisibility(flowOverlayVisible);
populateScenarioMenu();
populateUnitMenu();
buildProcessLegend();
initializeUnitPulseList();
renderPrototypeNotes();

/* ------------------------------ resizing --------------------------- */
if ("ResizeObserver" in window) {
  let lastW=0, lastH=0, raf=0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = mapViewport.getBoundingClientRect();
      const w = Math.floor(r.width), h = Math.floor(r.height);
      if (w===lastW && h===lastH) return;
      lastW=w; lastH=h; renderer.resizeToContainer(mapViewport);
    });
  });
  const r = mapViewport.getBoundingClientRect();
  lastW=Math.floor(r.width); lastH=Math.floor(r.height);
  ro.observe(mapViewport);
}

/* ------------------------------- input ----------------------------- */
// pointer hover (only when not panning)
surface.addEventListener("mousemove", (e) => {
  if (renderer.isPanning?.()) return;
  const rect = surface.getBoundingClientRect();
  const px = (e.clientX - rect.left) * renderer.deviceScaleX;
  const py = (e.clientY - rect.top)  * renderer.deviceScaleY;
  const iso = renderer.screenToIso(px, py);
  renderer.setPointer(iso.x, iso.y, true);
  const unit = renderer.getUnitAt(iso.x, iso.y);
  const id = unit?.id || null;
  if (id !== renderer.hoverUnitId) {
    renderer.setHoverUnit(id);
    highlightPipelinesForUnit(id || selectedUnitId);
  }
});
surface.addEventListener("mouseleave", () => {
  renderer.setPointer(0,0,false);
  renderer.setHoverUnit(null);
  if (selectedUnitId) highlightPipelinesForUnit(selectedUnitId); else clearPipelineHighlight();
});

// drag to pan
let panMoved = false, panStart = {x:0,y:0};
surface.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const rect = surface.getBoundingClientRect();
  const px = (e.clientX - rect.left) * renderer.deviceScaleX;
  const py = (e.clientY - rect.top)  * renderer.deviceScaleY;
  panStart = { x:px, y:py }; panMoved=false;
  surface.setPointerCapture(e.pointerId);
  renderer.beginPan(px, py);
});
surface.addEventListener("pointermove", (e) => {
  if (!renderer.isPanning?.()) return;
  const rect = surface.getBoundingClientRect();
  const px = (e.clientX - rect.left) * renderer.deviceScaleX;
  const py = (e.clientY - rect.top)  * renderer.deviceScaleY;
  renderer.panTo(px, py);
  panMoved = true;
});
const endPan = (e) => { if (renderer.isPanning?.()) renderer.endPan(); surface.releasePointerCapture(e.pointerId); };
surface.addEventListener("pointerup", endPan);
surface.addEventListener("pointercancel", endPan);

// wheel: PAN by default; hold Ctrl/Cmd/Alt (or pinch) to zoom
surface.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = surface.getBoundingClientRect();
  const px = (e.clientX - rect.left) * renderer.deviceScaleX;
  const py = (e.clientY - rect.top)  * renderer.deviceScaleY;

  const zoomIntent = e.ctrlKey || e.metaKey || e.altKey;
  if (zoomIntent) { renderer.zoomAt(px, py, e.deltaY); return; }

  let dx=e.deltaX, dy=e.deltaY;
  const DOM_DELTA_LINE = typeof WheelEvent!=="undefined" ? WheelEvent.DOM_DELTA_LINE : 1;
  const DOM_DELTA_PAGE = typeof WheelEvent!=="undefined" ? WheelEvent.DOM_DELTA_PAGE : 2;
  if (e.deltaMode===DOM_DELTA_LINE){ dx*=32; dy*=32; }
  else if (e.deltaMode===DOM_DELTA_PAGE){ dx*=surface.clientWidth||1; dy*=surface.clientHeight||1; }
  renderer.nudgeCamera(-dx * renderer.deviceScaleX, -dy * renderer.deviceScaleY);
},{ passive:false });

surface.addEventListener("dblclick", (e) => { e.preventDefault(); renderer.resetView(); });

surface.addEventListener("click", (e) => {
  if (e.detail>1) return;
  if (panMoved){ panMoved=false; return; }
  const rect = surface.getBoundingClientRect();
  const px = (e.clientX - rect.left) * renderer.deviceScaleX;
  const py = (e.clientY - rect.top)  * renderer.deviceScaleY;
  const iso = renderer.screenToIso(px, py);
  const unit = renderer.getUnitAt(iso.x, iso.y);
  const id = unit?.id || null;
  setSelectedUnit(id);
  ui.selectUnit(id);
});

/* ------------------------------- loop ------------------------------ */
const clock = { last: performance.now() };
function animate(now){
  const dt = (now - clock.last) / 1000; clock.last = now;
  simulation.update(dt);
  const logistics = simulation.getLogisticsState();
  const flows = simulation.getFlows();
  renderer.render(dt, { flows, logistics });
  ui.update(logistics, flows);
  refreshUnitPulse(now/1000);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/* --------------------------- app helpers (unchanged logic) --------- */
function applyPreset(name, options = {}){
  const p = PRESETS[name]; if (!p) return;
  simulation.setParam("crudeIntake", p.crude);
  simulation.setParam("productFocus", p.focus);
  simulation.setParam("maintenance", p.maintenance);
  simulation.setParam("safety", p.safety);
  simulation.setParam("environment", p.environment);
  if (name==="shutdown") simulation.triggerEmergencyShutdown(); else simulation.releaseEmergencyShutdown();
  ui.refreshControls(); updatePresetButtons(name); activePreset = name;
  if (typeof ui.setModeBadge === "function") ui.setModeBadge(p.label);
  if (!options.silent) simulation.pushLog("info", p.log);
}
function updatePresetButtons(name){ document.querySelectorAll("[data-preset]").forEach(b => b.classList.toggle("active", !!name && b.dataset.preset===name)); }
function updateUnitButtons(id){ document.querySelectorAll("[data-unit-target]").forEach(b => b.classList.toggle("active", b.dataset.unitTarget===id)); updateUnitMenuActive(id); }
function updateScenarioButtons(k){ document.querySelectorAll("[data-scenario]").forEach(b => b.classList.toggle("active", b.dataset.scenario===k)); updateScenarioMenuActive(k); }

/* menus */
function initializeMenus(){
  if (!menuBar) return;
  const menuButtons = menuBar.querySelectorAll(".menu > .menu-item:not(.menu-action)");
  menuButtons.forEach(btn => btn.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); toggleMenu(e.currentTarget.closest(".menu")); }));
  menuBar.addEventListener("click", (e) => {
    const entry = e.target.closest(".menu-entry");
    if (!entry || !menuBar.contains(entry)) return;
    e.preventDefault();
    const action = entry.dataset.action, scenario = entry.dataset.scenario, unitId = entry.dataset.unit;
    if (action) handleMenuAction(action, entry);
    else if (scenario) { simulation.applyScenario(scenario); ui.setScenario(scenario); updateScenarioButtons(scenario); }
    else if (unitId) { setSelectedUnit(unitId); ui.selectUnit(unitId); }
    closeMenus();
  });
  document.addEventListener("click", (e)=>{ if (activeMenu && menuBar && !menuBar.contains(e.target)) closeMenus(); });
  document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") closeMenus(); });
  if (menuToggle) menuToggle.addEventListener("click", ()=>{ const r=simulation.toggleRunning(); ui.setRunning(r); });
  if (importInput) importInput.addEventListener("change", handleSnapshotImport);
}
function toggleMenu(menu){
  if (!menu) return;
  const btn = menu.querySelector(".menu-item");
  const open = menu.classList.contains("open");
  if (open){ menu.classList.remove("open"); btn?.setAttribute("aria-expanded","false"); activeMenu=null; }
  else { closeMenus(); menu.classList.add("open"); btn?.setAttribute("aria-expanded","true"); activeMenu=menu; }
}
function closeMenus(){
  if (!menuBar) return;
  menuBar.querySelectorAll(".menu.open").forEach(m=>{ m.classList.remove("open"); m.querySelector(".menu-item")?.setAttribute("aria-expanded","false"); });
  activeMenu=null;
}
function handleMenuAction(action){
  switch(action){
    case "session-reset": performSimulationReset(); break;
    case "session-export": exportSnapshot(); break;
    case "session-import": importInput?.click(); break;
    case "session-speed-slower": { const m=simulation.adjustSpeedMultiplier(-0.25); simulation.pushLog("info", `Time scale set to ${m.toFixed(2)}× baseline.`); break; }
    case "session-speed-normal": { const m=simulation.setSpeedMultiplier(1); simulation.pushLog("info", `Time scale reset to ${m.toFixed(2)}× baseline.`); break; }
    case "session-speed-faster": { const m=simulation.adjustSpeedMultiplier(0.25); simulation.pushLog("info", `Time scale increased to ${m.toFixed(2)}× baseline.`); break; }
    case "session-load-old":  loadSessionPreset("legacy"); break;
    case "session-load-new":  loadSessionPreset("modern"); break;
    case "view-center": renderer.resetView(); simulation.pushLog("info","Viewport recentered over refinery layout."); break;
    case "view-toggle-grid": { const n=!gridVisible; setGridVisibility(n); simulation.pushLog("info", n?"Grid overlay enabled.":"Grid overlay hidden."); break; }
    case "view-toggle-flow": { const n=!flowOverlayVisible; setFlowVisibility(n); simulation.pushLog("info", n?"Process flow glow enabled.":"Process flow glow hidden."); break; }
    case "view-cycle-light":  renderer.cyclePalette(); simulation.pushLog("info","Palette cycled — channeling SimFarm and SimCity swatches."); break;
    default: break;
  }
}
function setGridVisibility(v){ gridVisible=v; renderer.setGridVisible(v); updateToggleButton(gridToggleButton,v,"Hide Grid Overlay","Show Grid Overlay"); }
function setFlowVisibility(v){ flowOverlayVisible=v; renderer.setFlowVisible(v); updateToggleButton(flowToggleButton,v,"Hide Flow Glow","Show Flow Glow"); }
function updateToggleButton(btn, vis, hideLabel, showLabel){ if (!btn) return; btn.dataset.state = vis?"on":"off"; btn.textContent = vis?hideLabel:showLabel; }

function performSimulationReset(){
  simulation.reset();
  applyPreset("auto",{silent:true}); activePreset="auto";
  updatePresetButtons("auto"); updateScenarioButtons(simulation.activeScenarioKey);
  ui.refreshControls(); ui.setScenario(simulation.activeScenarioKey);
  if (typeof ui.setModeBadge==="function") ui.setModeBadge("AUTO");
  setSelectedUnit(null); ui.selectUnit(null); updateUnitButtons(null);
  populateUnitMenu(); ui.setRunning(true);
}

function loadSessionPreset(key){
  const p = SESSION_PRESETS[key]; if (!p){ simulation.pushLog("info","Preset scenario not available yet."); return; }
  simulation.reset();
  if (p.scenario) { simulation.applyScenario(p.scenario); }
  if (p.params){
    if (typeof p.params.crude === "number") simulation.setParam("crudeIntake", p.params.crude);
    if (typeof p.params.focus === "number") simulation.setParam("productFocus", p.params.focus);
    if (typeof p.params.maintenance === "number") simulation.setParam("maintenance", p.params.maintenance);
    if (typeof p.params.safety === "number") simulation.setParam("safety", p.params.safety);
    if (typeof p.params.environment === "number") simulation.setParam("environment", p.params.environment);
  }
  if (typeof p.timeMinutes === "number") simulation.timeMinutes = p.timeMinutes;
  if (typeof p.marketStress === "number") simulation.marketStress = clamp(p.marketStress, 0, 0.85);
  if (p.storageLevels && simulation.storage?.levels){
    Object.entries(p.storageLevels).forEach(([prod, lvl])=>{
      if (simulation.storage.levels[prod] !== undefined){
        const cap = simulation.storage.capacity[prod] || lvl;
        simulation.storage.levels[prod] = clamp(lvl, 0, cap);
      }
    });
  }
  simulation.shipments = [];
  if (Array.isArray(p.shipments)){
    const now = simulation.timeMinutes || 0;
    simulation.shipments = p.shipments.map(s => ({
      id: s.id || `preset-${s.product}-${Math.random().toString(16).slice(2,6)}`,
      product: s.product, volume: s.volume, window: s.window, dueIn: s.dueIn ?? s.window,
      status: s.status || "pending", createdAt: now, cooldown: s.cooldown || 0
    }));
  }
  if (p.shipmentStats) simulation.shipmentStats = { total:p.shipmentStats.total??0, onTime:p.shipmentStats.onTime??0, missed:p.shipmentStats.missed??0 };
  if (typeof p.nextShipmentIn === "number") simulation.nextShipmentIn = p.nextShipmentIn;

  if (Array.isArray(p.units)) p.units.forEach(entry=>{
    const u = simulation.unitMap?.[entry.id]; if (!u) return;
    if (typeof entry.integrity==="number") u.integrity = clamp(entry.integrity,0,1);
    if (typeof entry.downtime === "number" && entry.downtime>0){ u.downtime = entry.downtime; u.status="offline"; }
    if (entry.status) u.status = entry.status;
  });

  simulation.unitOverrides = {};
  if (p.unitOverrides){
    Object.entries(p.unitOverrides).forEach(([id,ov])=>{
      if (typeof ov.throttle==="number") simulation.setUnitThrottle(id, ov.throttle, {quiet:true});
      if (ov.offline) simulation.setUnitOffline(id,true,{quiet:true});
    });
  }

  simulation.pendingOperationalCost = 0;
  simulation.logisticsRushCooldown = 0;
  simulation.performanceHistory = [];
  simulation.update(1);

  activePreset=null; updatePresetButtons(null); ui.refreshControls();
  ui.setScenario(simulation.activeScenarioKey); updateScenarioButtons(simulation.activeScenarioKey);
  setSelectedUnit(null); ui.selectUnit(null); updateUnitButtons(null); populateUnitMenu();
  ui.setRunning(simulation.running); if (typeof ui.setModeBadge==="function") ui.setModeBadge("CUSTOM");
  updateMenuToggle(simulation.running);
  renderer.resetView?.();
  simulation.pushLog("info", p.log || "Session preset loaded.");
}

function exportSnapshot(){
  const snapshot = simulation.createSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `simrefinery-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  simulation.pushLog("info","Snapshot exported for download.");
}
function handleSnapshotImport(e){
  const [file] = e.target.files || []; if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try{
      const snap = JSON.parse(reader.result);
      simulation.loadSnapshot(snap);
      activePreset = null; updatePresetButtons(null); ui.refreshControls();
      ui.setScenario(simulation.activeScenarioKey); updateScenarioButtons(simulation.activeScenarioKey);
      setSelectedUnit(null); ui.selectUnit(null); updateUnitButtons(null); populateUnitMenu();
      ui.setRunning(simulation.running); if (typeof ui.setModeBadge==="function") ui.setModeBadge("CUSTOM");
      updateMenuToggle(simulation.running);
      simulation.pushLog("info","Snapshot imported and applied.");
    }catch(err){ console.error("Snapshot import failed", err); simulation.pushLog("warning","Snapshot import failed. Verify the file format."); }
  });
  reader.readAsText(file); e.target.value="";
}

/* scenario + unit menus */
function populateScenarioMenu(){
  if (!scenarioMenu) return;
  scenarioMenu.innerHTML = "";
  simulation.getScenarioList().forEach(s => {
    const b = document.createElement("button");
    b.type="button"; b.className="menu-entry"; b.dataset.scenario=s.key; b.textContent=s.name; b.title=s.description; scenarioMenu.appendChild(b);
  });
  updateScenarioMenuActive(simulation.activeScenarioKey);
}
function updateScenarioMenuActive(key){
  if (!scenarioMenu) return;
  scenarioMenu.querySelectorAll(".menu-entry").forEach(e => e.classList.toggle("active", e.dataset.scenario===key));
}
function populateUnitMenu(){
  if (!unitMenu) return;
  unitMenu.innerHTML = "";
  simulation.getUnits().forEach(u=>{
    const b = document.createElement("button");
    b.type="button"; b.className="menu-entry"; b.dataset.unit=u.id; b.textContent=u.name;
    unitMenu.appendChild(b);
  });
  updateUnitMenuActive(selectedUnitId);
}
function updateUnitMenuActive(id){ if (!unitMenu) return; unitMenu.querySelectorAll(".menu-entry").forEach(e => e.classList.toggle("active", e.dataset.unit===id)); }

function buildUnitModeLookup(){
  unitModeLabels.clear();
  const defs = simulation.getUnitModeDefinitions?.(); if (!Array.isArray(defs)) return;
  defs.forEach(d => { if (d?.key && d?.label) unitModeLabels.set(d.key, d.label); });
}
function initializeUnitPulseList(){
  if (!unitPulseList){ unitPulseEntries.clear(); return; }
  buildUnitModeLookup();
  unitPulseList.innerHTML = ""; unitPulseEntries.clear();
  simulation.getUnits().forEach(u=>{
    const item = document.createElement("li"); item.className="pulse-entry"; item.dataset.unit=u.id;
    const top = document.createElement("div"); top.className="pulse-top";
    const name = document.createElement("span"); name.className="pulse-name"; name.textContent=u.name; top.appendChild(name);
    const mode = document.createElement("span"); mode.className="pulse-mode"; mode.dataset.mode=u.mode; mode.textContent=formatModeLabel(u.mode); top.appendChild(mode);
    item.appendChild(top);
    const loadMeter = createPulseMeter("Load","load"); const integMeter = createPulseMeter("Integrity","integrity");
    item.appendChild(loadMeter.wrapper); item.appendChild(integMeter.wrapper);
    const footer = document.createElement("div"); footer.className="pulse-footer";
    const status = document.createElement("span"); status.className="pulse-status"; footer.appendChild(status);
    const incidents = document.createElement("span"); incidents.className="pulse-incidents"; footer.appendChild(incidents);
    item.appendChild(footer);
    item.addEventListener("click", ()=>{ setSelectedUnit(u.id); ui.selectUnit(u.id); });
    unitPulseList.appendChild(item);
    unitPulseEntries.set(u.id, {
      item, mode, status, incidents,
      loadFill: loadMeter.fill, loadValue: loadMeter.value,
      integrityFill: integMeter.fill, integrityValue: integMeter.value
    });
  });
  refreshUnitPulse(0,true);
}
function createPulseMeter(label,type){
  const wrapper = document.createElement("div"); wrapper.className="pulse-meter"; wrapper.dataset.type=type;
  const labelEl = document.createElement("span"); labelEl.className="pulse-meter-label"; labelEl.textContent=label;
  const track = document.createElement("span"); track.className="pulse-meter-track";
  const fill  = document.createElement("span"); fill.className="pulse-meter-fill"; track.appendChild(fill);
  const value = document.createElement("span"); value.className="pulse-meter-value";
  wrapper.append(labelEl, track, value); return { wrapper, fill, value };
}
function refreshUnitPulse(time, force=false){
  if (!unitPulseList || unitPulseEntries.size===0) return;
  if (!force && time - lastPulseRefresh < 0.45) return;
  lastPulseRefresh = time;
  simulation.getUnits().forEach(u=>{
    const e = unitPulseEntries.get(u.id); if (!e) return;
    const util = clamp(u.utilization ?? 0, 0, 1.4); const n = Math.min(util,1);
    e.loadFill.style.width = `${(n*100).toFixed(1)}%`;
    e.loadValue.textContent = `${Math.round(util*100)}%`;
    const integ = clamp(u.integrity ?? 0, 0, 1);
    e.integrityFill.style.width = `${(integ*100).toFixed(1)}%`;
    e.integrityValue.textContent = `${Math.round(integ*100)}%`;
    e.mode.textContent = formatModeLabel(u.mode); e.mode.dataset.mode = u.mode || "balanced";
    e.status.textContent = formatUnitStatus(u);
    e.incidents.textContent = formatIncidentCount(u.incidents||0);
    e.item.classList.toggle("offline", u.status==="offline");
    e.item.classList.toggle("standby", u.status==="standby");
    e.item.classList.toggle("overload", util>1);
    e.item.classList.toggle("selected", selectedUnitId===u.id);
    e.item.classList.toggle("alerting", !!u.alert);
  });
  renderAlertCallouts();
}

/* alerts + legend (unchanged) */
function renderAlertCallouts(){
  if (!calloutShelf) return;
  const alerts = collectActiveAlerts();
  const sig = [selectedUnitId || "none"].concat(alerts.map(a => `${a.type||"unit"}:${a.unitId||a.product||a.label||""}:${a.severity||""}:${a.summary||""}:${a.detail||""}:${a.guidance||""}`)).join("|");
  if (calloutShelf.dataset.signature === sig) return;
  calloutShelf.dataset.signature = sig; calloutShelf.innerHTML = "";
  if (alerts.length===0){
    calloutShelf.dataset.state="clear";
    const p=document.createElement("p"); p.className="alert-empty"; p.textContent="All systems nominal."; calloutShelf.appendChild(p); return;
  }
  calloutShelf.dataset.state="active";
  const rank = { danger:0, warning:1, info:2 };
  alerts.slice().sort((a,b)=> (rank[a.severity]??3)-(rank[b.severity]??3) || (b.recordedAt||"").localeCompare(a.recordedAt||"")).forEach(alert=>{
    calloutShelf.appendChild(createAlertCallout(alert));
  });
}
function collectActiveAlerts(){
  if (typeof simulation.getActiveAlerts==="function"){
    const arr = simulation.getActiveAlerts();
    if (Array.isArray(arr)) return arr.map(a=>({ type:a.type||"unit", unitId:a.unitId||null, product:a.product, label:a.label||a.name||null, name:a.name||a.label||null, severity:a.severity||"warning", summary:a.summary||a.title||"", detail:a.detail||a.cause||"", guidance:a.guidance||"", recordedAt:a.recordedAt||a.time||"", percent: typeof a.percent==="number" ? a.percent : (typeof a.utilization==="number"?a.utilization:undefined) }));
  }
  return simulation.getUnits().filter(u=>!!u.alert).map(u=>{
    const d=u.alertDetail||u.lastIncident||{};
    return { type:"unit", unitId:u.id, label:u.name, name:u.name, severity:d.severity||u.alert||"warning", summary:d.summary||buildUnitAlertSummary(u), detail:d.cause||buildUnitAlertDescription(u), guidance:d.guidance||"", recordedAt:d.recordedAt||"" };
  });
}
function createAlertCallout(alert){
  const card=document.createElement("article"); card.className="alert-callout"; card.dataset.severity=alert.severity||"warning";
  const header=document.createElement("header"); const h=document.createElement("h4"); h.textContent=alert.label||alert.name||"Alert"; header.appendChild(h);
  if (alert.severity){ const b=document.createElement("span"); b.className="alert-badge"; b.textContent=alert.severity.toUpperCase(); header.appendChild(b); }
  card.appendChild(header);
  if (alert.summary){ const p=document.createElement("p"); p.className="alert-summary"; p.textContent=alert.summary; card.appendChild(p); }
  if (alert.detail){ const p=document.createElement("p"); p.className="alert-detail"; p.textContent=alert.detail; card.appendChild(p); }
  if (alert.guidance){ const p=document.createElement("p"); p.className="alert-guidance"; p.textContent=alert.guidance; card.appendChild(p); }
  const footer=document.createElement("footer"); const ts=document.createElement("span"); ts.textContent = alert.recordedAt?`Since ${alert.recordedAt}`:"Live update"; footer.appendChild(ts);
  if (alert.unitId){
    const btn=document.createElement("button"); btn.type="button"; btn.className="alert-focus-button"; btn.textContent="Focus";
    const focusUnit=()=>{ setSelectedUnit(alert.unitId); ui.selectUnit(alert.unitId); };
    btn.addEventListener("click",focusUnit);
    btn.addEventListener("focus",()=>highlightPipelinesForUnit(alert.unitId));
    btn.addEventListener("blur",()=>{ if (selectedUnitId) highlightPipelinesForUnit(selectedUnitId); else clearPipelineHighlight(); });
    footer.appendChild(btn);
    const highlight=()=>highlightPipelinesForUnit(alert.unitId);
    const reset=()=>{ if (selectedUnitId) highlightPipelinesForUnit(selectedUnitId); else clearPipelineHighlight(); };
    card.addEventListener("mouseenter",highlight); card.addEventListener("focus",highlight);
    card.addEventListener("mouseleave",reset);     card.addEventListener("blur",reset);
    card.addEventListener("keydown",(e)=>{ if (e.key==="Enter"||e.key===" "){ e.preventDefault(); focusUnit(); }});
  } else if (alert.type==="storage"){
    const s=document.createElement("span"); s.textContent = typeof alert.percent==="number" ? `${Math.round(alert.percent)}% full` : "Storage alert"; footer.appendChild(s);
  }
  card.appendChild(footer);
  if (alert.unitId && selectedUnitId===alert.unitId) card.classList.add("selected");
  return card;
}

/* legend */
function buildProcessLegend(){
  if (!mapStatusPanel || !processTopology) return;
  if (mapStatusPanel.querySelector("#process-legend")) return;
  const legend = document.createElement("div"); legend.id="process-legend";
  const h = document.createElement("h4"); h.textContent = "Process Flow"; legend.appendChild(h);
  const list = document.createElement("ol");
  const sequence = ["distillation","reformer","fcc","hydrocracker","alkylation","sulfur"];
  sequence.forEach(id => {
    const entry = processTopology[id]; if (!entry) return;
    const item = document.createElement("li"); item.dataset.unit=id; item.setAttribute("role","button"); item.tabIndex=0;
    const name=document.createElement("span"); name.textContent = entry.name || id; item.appendChild(name);
    const summary=document.createElement("small"); summary.textContent = entry.summary || ""; item.appendChild(summary);
    item.addEventListener("mouseenter",()=>highlightPipelinesForUnit(id));
    item.addEventListener("focus",()=>highlightPipelinesForUnit(id));
    const reset=()=>{ if (selectedUnitId) highlightPipelinesForUnit(selectedUnitId); else clearPipelineHighlight(); };
    item.addEventListener("mouseleave",reset); item.addEventListener("blur",reset);
    item.addEventListener("click",()=>{ setSelectedUnit(id); ui.selectUnit(id); });
    item.addEventListener("keydown",(e)=>{ if (e.key==="Enter"||e.key===" "){ e.preventDefault(); setSelectedUnit(id); ui.selectUnit(id); }});
    list.appendChild(item);
  });
  legend.appendChild(list);
  mapStatusPanel.appendChild(legend);
}

/* highlighting / selection */
function highlightPipelinesForUnit(id){
  if (!id){ clearPipelineHighlight(); return; }
  const list = unitConnectionIndex.get(id) || [];
  renderer.setHighlightedPipelines(list);
}
function clearPipelineHighlight(){ renderer.setHighlightedPipelines([]); }
function setSelectedUnit(id){
  selectedUnitId = id || null;
  renderer.setSelectedUnit(selectedUnitId);
  updateUnitButtons(selectedUnitId);
  if (selectedUnitId) highlightPipelinesForUnit(selectedUnitId); else clearPipelineHighlight();
}

/* prototype notes (unchanged text) */
function renderPrototypeNotes(){
  if (!prototypeNotes) return;
  prototypeNotes.innerHTML = "";
  const history = document.createElement("p");
  history.textContent = "Recovered Richmond interface now wires convoy drills, pipeline bypasses, and scenario loads directly into the edit console.";
  const ul = document.createElement("ul"); ul.className="prototype-list";
  [
    "Session → Load Old/New drop you into curated Chevron training scenarios with different bottlenecks to solve.",
    "ROAD dispatches a truck convoy to bleed down whichever product tanks are overflowing the most.",
    "PIPE stages a temporary bypass for the selected unit’s feed, while BULLDOZE schedules a turnaround to restore integrity.",
    "Drag the refinery map to pan and use the mouse wheel to zoom in on the SimCity-style detail work."
  ].forEach(s=>{ const li=document.createElement("li"); li.textContent=s; ul.appendChild(li); });
  prototypeNotes.append(history, ul);
}

/* little formatters (unchanged) */
function buildUnitAlertSummary(u){
  const d=u.alertDetail||u.lastIncident;
  if (d?.summary) return d.summary;
  if (u.status==="offline"){
    if (u.emergencyOffline) return "Emergency shutdown";
    if (u.manualOffline) return "Manual standby";
    return "Offline for repairs";
  }
  if (typeof u.integrity==="number" && u.integrity<0.5) return `Integrity ${Math.round(u.integrity*100)}%`;
  if (u.alert==="danger") return "Critical fault";
  if (u.alert==="warning") return "Process warning";
  return "Stable";
}
function buildUnitAlertDescription(u){
  const d=u.alertDetail||u.lastIncident;
  if (d?.cause && d?.guidance) return `${d.cause}. ${d.guidance}`;
  if (d?.cause) return d.cause;
  if (d?.guidance) return d.guidance;
  if (u.alert==="danger") return "Immediate intervention required.";
  if (u.alert==="warning"){
    if (typeof u.integrity==="number") return `Integrity at ${Math.round(u.integrity*100)}%. Adjust maintenance or throughput.`;
    return "Monitor unit conditions closely.";
  }
  return "Online";
}
function formatUnitStatus(u){
  if (u.status==="offline") return formatOfflineStatus(u);
  if (u.alert) return buildUnitAlertSummary(u);
  if (typeof u.utilization==="number") return `Online • ${Math.round(u.utilization*100)}% load`;
  return "Online";
}
function formatOfflineStatus(u){
  const m = Math.max(1, Math.ceil(u.downtime||0));
  if (u.alert) return `${buildUnitAlertSummary(u)} (${m}m)`;
  return `Offline (${m}m)`;
}
function formatIncidentCount(n){ return n===1 ? "1 incident" : `${n} incidents`; }
function formatModeLabel(k){
  if (!k) return "Balanced";
  if (unitModeLabels.has(k)) return unitModeLabels.get(k);
  return k.split(/\s|_/).map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(" ");
}
function updateMenuToggle(running){ if (!menuToggle) return; menuToggle.textContent = running ? "Pause" : "Resume"; menuToggle.setAttribute("aria-pressed", running ? "false":"true"); }
