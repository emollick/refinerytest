import { RefinerySimulation } from "./simulation.js";
import { UIController } from "./ui.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

const canvas = document.createElement("canvas");
canvas.className = "tile-canvas";
sceneContainer.innerHTML = "";
sceneContainer.appendChild(canvas);
const context = canvas.getContext("2d");
context.imageSmoothingEnabled = false;

const simulation = new RefinerySimulation();
const ui = new UIController(simulation);
if (typeof ui.setModeBadge === "function") {
  ui.setModeBadge("AUTO");
}

const processTopology = simulation.getProcessTopology?.() || {};
const unitConnectionIndex = buildUnitConnectionIndex(processTopology);

const unitConfigs = [
  {
    id: "distillation",
    name: "Crude Distillation",
    tileX: 6,
    tileY: 3,
    width: 3,
    height: 4,
    color: 0xbec9df,
    accent: 0xf3cf73,
    accentAlt: 0xe8933d,
    style: "towers",
  },
  {
    id: "reformer",
    name: "Naphtha Reformer",
    tileX: 3,
    tileY: 6,
    width: 2,
    height: 3,
    color: 0xd6aa80,
    accent: 0x8c5a31,
    accentAlt: 0xf2d5a4,
    style: "rect",
  },
  {
    id: "fcc",
    name: "Catalytic Cracker",
    tileX: 10,
    tileY: 6,
    width: 3,
    height: 3,
    color: 0xe2c568,
    accent: 0x9a6a24,
    accentAlt: 0xf6df9a,
    style: "reactor",
  },
  {
    id: "hydrocracker",
    name: "Hydrocracker",
    tileX: 3,
    tileY: 2,
    width: 2,
    height: 3,
    color: 0xb6ded0,
    accent: 0x419a74,
    accentAlt: 0xdaf0e8,
    style: "towers",
  },
  {
    id: "alkylation",
    name: "Alkylation",
    tileX: 11,
    tileY: 2,
    width: 2,
    height: 3,
    color: 0xd3b3f2,
    accent: 0x845ec4,
    accentAlt: 0xf3e1ff,
    style: "rect",
  },
  {
    id: "sulfur",
    name: "Sulfur Recovery",
    tileX: 7,
    tileY: 9,
    width: 2,
    height: 2,
    color: 0xe9edf1,
    accent: 0x8c96a7,
    accentAlt: 0xf7f9fb,
    style: "support",
  },
];

const pipelineConfigs = [
  {
    id: "toReformer",
    metric: "toReformer",
    capacity: 70,
    color: 0x6fc2ff,
    phase: 0,
    path: [
      { x: 7, y: 4.5 },
      { x: 5, y: 4.5 },
      { x: 5, y: 7 },
      { x: 3.5, y: 7 },
    ],
  },
  {
    id: "toCracker",
    metric: "toCracker",
    capacity: 90,
    color: 0xf7b25c,
    phase: 1.3,
    path: [
      { x: 7, y: 4.5 },
      { x: 9.5, y: 4.5 },
      { x: 9.5, y: 7 },
      { x: 11, y: 7 },
    ],
  },
  {
    id: "toHydrocracker",
    metric: "toHydrocracker",
    capacity: 70,
    color: 0x8ee2c4,
    phase: 2.2,
    path: [
      { x: 7, y: 4.5 },
      { x: 4.5, y: 4.5 },
      { x: 4.5, y: 3.5 },
      { x: 3.5, y: 3.5 },
    ],
  },
  {
    id: "toAlkylation",
    metric: "toAlkylation",
    capacity: 45,
    color: 0xc5a1ff,
    phase: 2.9,
    path: [
      { x: 11, y: 7 },
      { x: 12, y: 7 },
      { x: 12, y: 3.5 },
    ],
  },
  {
    id: "toExport",
    metric: "toExport",
    capacity: 160,
    color: 0x9ec8ff,
    phase: 3.6,
    path: [
      { x: 7, y: 4.5 },
      { x: 11, y: 4.5 },
      { x: 11, y: 9.5 },
      { x: 13.5, y: 9.5 },
    ],
  },
];

class TileRenderer {
  constructor(canvasEl, ctx, simulationInstance, unitDefs, pipelineDefs) {
    this.canvas = canvasEl;
    this.context = ctx;
    this.simulation = simulationInstance;
    this.unitDefs = unitDefs;
    this.pipelineDefs = pipelineDefs;
    this.pipelineLookup = new Map(pipelineDefs.map((entry) => [entry.id, entry]));
    this.tileWidth = 64;
    this.tileHeight = 32;
    this.mapCols = 16;
    this.mapRows = 12;
    this.originX = 0;
    this.originY = 0;
    this.time = 0;
    this.gridVisible = true;
    this.flowVisible = true;
    this.highlightedPipelines = new Set();
    this.selectedUnitId = null;
    this.hoverUnitId = null;
    this.paletteIndex = 0;
    this.tiles = this._buildBaseTiles();
    this.decor = this._buildDecor();
    this.selectionFlash = 0;
    this.pointer = { x: 0, y: 0, active: false };
    this.deviceScaleX = 1;
    this.deviceScaleY = 1;

    this.palettes = [
      {
        pavement: "#bdb7a6",
        pavementShadow: "#918b7d",
        water: "#1f3a64",
        waterHighlight: "#2e4f82",
        shore: "#3a586f",
        grass: "#7fa56f",
        green: "#7ba97b",
        field: "#a87b3f",
        fieldAlt: "#c99c50",
        grid: "rgba(28, 26, 21, 0.35)",
        shadow: "rgba(20, 22, 28, 0.25)",
        outline: "#1c1d20",
        pipeGlow: "rgba(255,255,255,0.65)",
      },
      {
        pavement: "#b3b9c4",
        pavementShadow: "#8a8f9e",
        water: "#162f47",
        waterHighlight: "#214568",
        shore: "#384c64",
        grass: "#6e8c67",
        green: "#78a3a3",
        field: "#986c32",
        fieldAlt: "#c28c3e",
        grid: "rgba(12, 20, 32, 0.4)",
        shadow: "rgba(5, 10, 20, 0.35)",
        outline: "#14161c",
        pipeGlow: "rgba(240,252,255,0.7)",
      },
    ];
  }

  resizeToContainer(container) {
    const rect = container.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(720, Math.floor(rect.width));
    const height = Math.max(440, Math.floor(rect.height));
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.deviceScaleX = this.canvas.width / Math.max(1, width);
    this.deviceScaleY = this.canvas.height / Math.max(1, height);
  }

  setGridVisible(visible) {
    this.gridVisible = visible;
  }

  setFlowVisible(visible) {
    this.flowVisible = visible;
  }

  cyclePalette() {
    this.paletteIndex = (this.paletteIndex + 1) % this.palettes.length;
  }

  setHighlightedPipelines(pipelines) {
    this.highlightedPipelines = new Set(pipelines);
  }

  setSelectedUnit(unitId) {
    this.selectedUnitId = unitId;
  }

  setHoverUnit(unitId) {
    this.hoverUnitId = unitId;
  }

  setPointer(x, y, active) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  render(deltaSeconds, { flows, logistics }) {
    this.time += deltaSeconds;
    if (deltaSeconds > 0) {
      this.selectionFlash += deltaSeconds;
    }
    const ctx = this.context;
    const palette = this.palettes[this.paletteIndex] || this.palettes[0];
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.originX = this.canvas.width / 2;
    this.originY = 64 * this.deviceScaleY;

    ctx.fillStyle = palette.waterHighlight;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawTiles(palette);
    this._drawDecor(palette);
    this._drawPipelines(palette, flows || {});
    this._drawUnits(palette);
    this._drawLogistics(palette, logistics || {});
    this._drawPointer();

    ctx.restore();
  }

  screenToIso(clientX, clientY) {
    const x = (clientX - this.originX) / (this.tileWidth / 2);
    const y = (clientY - this.originY) / (this.tileHeight / 2);
    const isoX = (x + y) / 2;
    const isoY = (y - x) / 2;
    return { x: isoX, y: isoY };
  }

  getUnitAt(worldX, worldY) {
    for (const unit of this.unitDefs) {
      const withinX = worldX >= unit.tileX - 0.25 && worldX <= unit.tileX + unit.width - 0.1;
      const withinY = worldY >= unit.tileY - 0.25 && worldY <= unit.tileY + unit.height - 0.1;
      if (withinX && withinY) {
        return unit;
      }
    }
    return null;
  }

  resetView() {
    this.pointer.active = false;
  }

  _buildBaseTiles() {
    const tiles = Array.from({ length: this.mapRows }, () =>
      Array.from({ length: this.mapCols }, () => "pavement")
    );

    for (let y = 0; y < this.mapRows; y += 1) {
      for (let x = 0; x < this.mapCols; x += 1) {
        if (x < 2 && y < 6) {
          tiles[y][x] = "water";
        } else if (x < 2 && y < 8) {
          tiles[y][x] = "shore";
        } else if (y >= this.mapRows - 3 && x < 4) {
          tiles[y][x] = "field";
        } else if (y >= this.mapRows - 4 && x < 5) {
          tiles[y][x] = "field";
        } else if (y < 3 && x >= this.mapCols - 3) {
          tiles[y][x] = "water";
        } else if (x === 2 && y >= 6 && y < this.mapRows - 1) {
          tiles[y][x] = "grass";
        } else if (y === this.mapRows - 1 && x >= 4) {
          tiles[y][x] = "grass";
        } else if (y >= 3 && y <= 4 && x >= 3 && x <= 5) {
          tiles[y][x] = "green";
        }
      }
    }
    return tiles;
  }

  _buildDecor() {
    return [
      { type: "parking", x: 12.5, y: 1.8, width: 2.5, height: 1.8 },
      { type: "booth", x: 5.2, y: 10.4 },
      { type: "flare", x: 9.5, y: 2.1 },
      { type: "dock", x: 14.2, y: 9.6 },
      { type: "barn", x: 1.8, y: 10.2 },
      { type: "recording", x: 6.8, y: 0.6 },
    ];
  }

  _drawTiles(palette) {
    const ctx = this.context;
    for (let y = 0; y < this.mapRows; y += 1) {
      for (let x = 0; x < this.mapCols; x += 1) {
        const tileType = this.tiles[y][x];
        this._drawTileDiamond(x, y, tileType, palette);
      }
    }
  }

  _drawTileDiamond(tileX, tileY, type, palette) {
    const ctx = this.context;
    const { x, y } = this._tileToScreen(tileX, tileY);
    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + halfW, y + halfH);
    ctx.lineTo(x, y + this.tileHeight);
    ctx.lineTo(x - halfW, y + halfH);
    ctx.closePath();

    switch (type) {
      case "water":
        ctx.fillStyle = palette.water;
        ctx.fill();
        ctx.fillStyle = palette.waterHighlight;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x - halfW, y + halfH - 2 * this.deviceScaleY, this.tileWidth, 4 * this.deviceScaleY);
        ctx.globalAlpha = 1;
        break;
      case "shore":
        ctx.fillStyle = palette.shore;
        ctx.fill();
        break;
      case "grass":
        ctx.fillStyle = palette.grass;
        ctx.fill();
        break;
      case "green":
        ctx.fillStyle = palette.green;
        ctx.fill();
        break;
      case "field":
        ctx.fillStyle = palette.field;
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = palette.fieldAlt;
        ctx.lineWidth = 2 * this.deviceScaleY;
        const stripes = 4;
        for (let i = -stripes; i < stripes * 2; i += 1) {
          ctx.beginPath();
          const startX = x - halfW + (i * this.tileWidth) / stripes;
          ctx.moveTo(startX, y + this.tileHeight);
          ctx.lineTo(startX + this.tileWidth / 2, y + halfH);
          ctx.stroke();
        }
        ctx.restore();
        break;
      default:
        ctx.fillStyle = palette.pavement;
        ctx.fill();
        break;
    }

    if (type !== "water" && type !== "shore") {
      ctx.fillStyle = palette.shadow;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x + 1 * this.deviceScaleX, y + halfH + 4 * this.deviceScaleY);
      ctx.lineTo(x + halfW - 2 * this.deviceScaleX, y + halfH + 10 * this.deviceScaleY);
      ctx.lineTo(x - 2 * this.deviceScaleX, y + this.tileHeight - 2 * this.deviceScaleY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.gridVisible) {
      ctx.lineWidth = 1 * this.deviceScaleX;
      ctx.strokeStyle = palette.grid;
      ctx.stroke();
    }
  }

  _drawDecor(palette) {
    const ctx = this.context;
    this.decor.forEach((item) => {
      if (item.type === "parking") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const width = this.tileWidth * item.width * 0.5;
        const height = this.tileHeight * item.height;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = palette.pavementShadow;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(width, height * 0.5);
        ctx.lineTo(0, height);
        ctx.lineTo(-width, height * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 2 * this.deviceScaleX;
        ctx.beginPath();
        ctx.moveTo(-width * 0.5, height * 0.6);
        ctx.lineTo(width * 0.5, height * 0.2);
        ctx.stroke();
        ctx.restore();
      } else if (item.type === "booth") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        ctx.save();
        ctx.translate(x, y + this.tileHeight * 0.2);
        ctx.fillStyle = "#d0d6df";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(14 * this.deviceScaleX, 7 * this.deviceScaleY);
        ctx.lineTo(0, 14 * this.deviceScaleY);
        ctx.lineTo(-14 * this.deviceScaleX, 7 * this.deviceScaleY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#8c9aa9";
        ctx.fillRect(-6 * this.deviceScaleX, 7 * this.deviceScaleY, 12 * this.deviceScaleX, 6 * this.deviceScaleY);
        ctx.restore();
      } else if (item.type === "flare") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const flameHeight = 20 * this.deviceScaleY + Math.sin(this.time * 4) * 6 * this.deviceScaleY;
        ctx.save();
        ctx.translate(x, y - flameHeight / 2);
        ctx.fillStyle = "#f7ab3d";
        ctx.beginPath();
        ctx.ellipse(0, 0, 6 * this.deviceScaleX, flameHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "#ffdf7a";
        ctx.beginPath();
        ctx.ellipse(0, -4 * this.deviceScaleY, 4 * this.deviceScaleX, flameHeight * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (item.type === "dock") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = palette.pavementShadow;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(18 * this.deviceScaleX, 12 * this.deviceScaleY);
        ctx.lineTo(-4 * this.deviceScaleX, 26 * this.deviceScaleY);
        ctx.lineTo(-18 * this.deviceScaleX, 12 * this.deviceScaleY);
        ctx.closePath();
        ctx.fill();
        const pulse = 0.35 + Math.abs(Math.sin(this.time * 5)) * 0.4;
        ctx.fillStyle = `rgba(165, 214, 255, ${pulse.toFixed(2)})`;
        ctx.fillRect(-4 * this.deviceScaleX, 6 * this.deviceScaleY, 8 * this.deviceScaleX, 12 * this.deviceScaleY);
        ctx.restore();
      } else if (item.type === "barn") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        ctx.save();
        ctx.translate(x, y + this.tileHeight * 0.35);
        ctx.fillStyle = "#784421";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(20 * this.deviceScaleX, 14 * this.deviceScaleY);
        ctx.lineTo(0, 28 * this.deviceScaleY);
        ctx.lineTo(-20 * this.deviceScaleX, 14 * this.deviceScaleY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#bc8f45";
        ctx.beginPath();
        ctx.moveTo(0, -10 * this.deviceScaleY);
        ctx.lineTo(14 * this.deviceScaleX, 6 * this.deviceScaleY);
        ctx.lineTo(-14 * this.deviceScaleX, 6 * this.deviceScaleY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (item.type === "recording") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        ctx.fillRect(-22 * this.deviceScaleX, -4 * this.deviceScaleY, 44 * this.deviceScaleX, 16 * this.deviceScaleY);
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.fillRect(-18 * this.deviceScaleX, -2 * this.deviceScaleY, 36 * this.deviceScaleX, 4 * this.deviceScaleY);
        ctx.restore();
      }
    });
  }

  _drawPipelines(palette, flows) {
    const ctx = this.context;
    this.pipelineDefs.forEach((pipeline) => {
      const ratio = pipeline.capacity ? clamp((flows[pipeline.metric] || 0) / pipeline.capacity, 0, 1.5) : 0;
      const intensity = this.highlightedPipelines.has(pipeline.id) ? 1 : clamp(ratio, 0.15, 0.8);
      const color = toHex(pipeline.color);
      ctx.save();
      ctx.lineWidth = (this.highlightedPipelines.has(pipeline.id) ? 8 : 6) * this.deviceScaleX;
      ctx.lineCap = "round";
      ctx.strokeStyle = applyAlpha(color, 0.55 + intensity * 0.35);
      ctx.beginPath();
      pipeline.path.forEach((point, index) => {
        const { x, y } = this._tileToScreen(point.x, point.y);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      if (this.flowVisible) {
        const pulse = Math.sin(this.time * 4 + pipeline.phase) * 0.5 + 0.5;
        ctx.lineWidth = (this.highlightedPipelines.has(pipeline.id) ? 4 : 3) * this.deviceScaleX;
        ctx.strokeStyle = palette.pipeGlow;
        ctx.globalAlpha = 0.35 + pulse * clamp(ratio, 0.1, 0.9);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  _drawUnits(palette) {
    const ctx = this.context;
    const selected = this.selectedUnitId;
    const hover = this.hoverUnitId && this.hoverUnitId !== selected ? this.hoverUnitId : null;
    const metrics = new Map(this.simulation.getUnits().map((unit) => [unit.id, unit]));

    this.unitDefs.forEach((unit) => {
      const footprint = this._collectFootprint(unit);
      const { x, y } = this._tileToScreen(unit.tileX + unit.width / 2, unit.tileY + unit.height / 2);
      const color = toHex(unit.color);
      const accent = toHex(unit.accent);
      const accentAlt = toHex(unit.accentAlt);
      ctx.save();
      footprint.forEach((tile) => {
        this._drawTileDiamond(tile.x, tile.y, "pavement", palette);
      });

      ctx.translate(x, y + this.tileHeight * 0.25);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(this.tileWidth * 0.6, this.tileHeight * 0.3);
      ctx.lineTo(0, this.tileHeight * 0.6);
      ctx.lineTo(-this.tileWidth * 0.6, this.tileHeight * 0.3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -this.tileHeight * 0.2);
      ctx.lineTo(this.tileWidth * 0.3, this.tileHeight * 0.05);
      ctx.lineTo(-this.tileWidth * 0.3, this.tileHeight * 0.05);
      ctx.closePath();
      ctx.fill();

      switch (unit.style) {
        case "towers":
          this._drawTower(ctx, 0, -this.tileHeight * 0.28, accent, accentAlt);
          this._drawTower(ctx, this.tileWidth * 0.18, -this.tileHeight * 0.24, accent, accentAlt);
          break;
        case "reactor":
          this._drawReactor(ctx, accent, accentAlt);
          break;
        case "support":
          this._drawSupport(ctx, accent, accentAlt);
          break;
        default:
          this._drawBox(ctx, accent, accentAlt);
          break;
      }

      const data = metrics.get(unit.id);
      if (data) {
        const utilization = clamp(data.utilization ?? 0, 0, 1.3);
        const integrity = clamp(data.integrity ?? 0, 0, 1);
        const width = this.tileWidth * 0.75;
        const height = 4 * this.deviceScaleY;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-width / 2, this.tileHeight * 0.38, width, height);
        ctx.fillStyle = `hsl(${Math.max(0, 120 - utilization * 90)}, 68%, 55%)`;
        ctx.fillRect(-width / 2, this.tileHeight * 0.38, width * clamp(utilization, 0, 1), height);
        ctx.fillStyle = `hsl(${Math.max(10, 80 + integrity * 40)}, 68%, 50%)`;
        ctx.fillRect(-width / 2, this.tileHeight * 0.38 + height + 2 * this.deviceScaleY, width * integrity, height);
      }

      ctx.restore();

      const label = metrics.get(unit.id)?.name || unit.name;
      const { x: labelX, y: labelY } = this._tileToScreen(unit.tileX + unit.width / 2, unit.tileY + unit.height);
      ctx.save();
      ctx.fillStyle = "rgba(12, 16, 22, 0.66)";
      ctx.fillRect(
        labelX - this.tileWidth * 0.35,
        labelY + this.tileHeight * 0.05,
        this.tileWidth * 0.7,
        18 * this.deviceScaleY
      );
      ctx.fillStyle = "#f3f4f5";
      ctx.font = `${12 * this.deviceScaleY}px 'Inconsolata', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, labelX, labelY + this.tileHeight * 0.18);
      ctx.restore();

      if (unit.id === selected) {
        this._drawHighlight(footprint, true);
      } else if (unit.id === hover) {
        this._drawHighlight(footprint, false);
      }
    });
  }
  _drawTower(ctx, offsetX, offsetY, accent, accentAlt) {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(14 * this.deviceScaleX, 8 * this.deviceScaleY);
    ctx.lineTo(0, 16 * this.deviceScaleY);
    ctx.lineTo(-14 * this.deviceScaleX, 8 * this.deviceScaleY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accentAlt;
    ctx.beginPath();
    ctx.moveTo(0, -10 * this.deviceScaleY);
    ctx.lineTo(9 * this.deviceScaleX, 0);
    ctx.lineTo(-9 * this.deviceScaleX, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawReactor(ctx, accent, accentAlt) {
    ctx.save();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(0, -10 * this.deviceScaleY, 16 * this.deviceScaleX, 12 * this.deviceScaleY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accentAlt;
    ctx.beginPath();
    ctx.ellipse(0, -22 * this.deviceScaleY, 10 * this.deviceScaleX, 16 * this.deviceScaleY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawSupport(ctx, accent, accentAlt) {
    ctx.save();
    ctx.fillStyle = accent;
    ctx.fillRect(-16 * this.deviceScaleX, -8 * this.deviceScaleY, 32 * this.deviceScaleX, 18 * this.deviceScaleY);
    ctx.fillStyle = accentAlt;
    ctx.fillRect(-12 * this.deviceScaleX, -18 * this.deviceScaleY, 24 * this.deviceScaleX, 8 * this.deviceScaleY);
    ctx.restore();
  }

  _drawBox(ctx, accent, accentAlt) {
    ctx.save();
    ctx.fillStyle = accent;
    ctx.fillRect(-18 * this.deviceScaleX, -12 * this.deviceScaleY, 36 * this.deviceScaleX, 20 * this.deviceScaleY);
    ctx.fillStyle = accentAlt;
    ctx.fillRect(-12 * this.deviceScaleX, -20 * this.deviceScaleY, 24 * this.deviceScaleX, 10 * this.deviceScaleY);
    ctx.restore();
  }

  _drawHighlight(footprint, solid) {
    const ctx = this.context;
    ctx.save();
    ctx.lineWidth = solid ? 4 * this.deviceScaleX : 2 * this.deviceScaleX;
    ctx.strokeStyle = solid
      ? `rgba(255, 244, 180, ${0.6 + Math.sin(this.selectionFlash * 2) * 0.2})`
      : "rgba(255, 255, 255, 0.4)";
    footprint.forEach((tile) => {
      const { x, y } = this._tileToScreen(tile.x, tile.y);
      const halfW = this.tileWidth / 2;
      const halfH = this.tileHeight / 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + halfW, y + halfH);
      ctx.lineTo(x, y + this.tileHeight);
      ctx.lineTo(x - halfW, y + halfH);
      ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();
  }

  _collectFootprint(unit) {
    const tiles = [];
    for (let dy = 0; dy < unit.height; dy += 1) {
      for (let dx = 0; dx < unit.width; dx += 1) {
        tiles.push({ x: unit.tileX + dx, y: unit.tileY + dy });
      }
    }
    return tiles;
  }

  _drawLogistics(palette, logistics) {
    const ctx = this.context;
    const storage = logistics.storage || {};
    const levels = storage.levels || {};
    const capacity = storage.capacity || {};
    const tankPositions = [
      { product: "gasoline", x: 13.6, y: 5.6 },
      { product: "diesel", x: 13.2, y: 6.6 },
      { product: "jet", x: 14.0, y: 6.2 },
    ];
    tankPositions.forEach((tank) => {
      const { x, y } = this._tileToScreen(tank.x, tank.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = palette.pavementShadow;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(16 * this.deviceScaleX, 10 * this.deviceScaleY);
      ctx.lineTo(0, 20 * this.deviceScaleY);
      ctx.lineTo(-16 * this.deviceScaleX, 10 * this.deviceScaleY);
      ctx.closePath();
      ctx.fill();
      const level = levels[tank.product] || 0;
      const cap = capacity[tank.product] || 1;
      const ratio = clamp(cap ? level / cap : 0, 0, 1);
      ctx.fillStyle = `rgba(120, 200, 255, ${0.3 + ratio * 0.6})`;
      ctx.fillRect(
        -10 * this.deviceScaleX,
        4 * this.deviceScaleY + (1 - ratio) * 12 * this.deviceScaleY,
        20 * this.deviceScaleX,
        ratio * 12 * this.deviceScaleY
      );
      ctx.restore();
    });
  }

  _drawPointer() {
    if (!this.pointer.active) {
      return;
    }
    const ctx = this.context;
    const { x, y } = this._tileToScreen(this.pointer.x, this.pointer.y);
    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;
    ctx.save();
    ctx.lineWidth = 2 * this.deviceScaleX;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + halfW, y + halfH);
    ctx.lineTo(x, y + this.tileHeight);
    ctx.lineTo(x - halfW, y + halfH);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  _tileToScreen(tileX, tileY) {
    const screenX = this.originX + (tileX - tileY) * (this.tileWidth / 2);
    const screenY = this.originY + (tileX + tileY) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }
}

function toHex(colorInt) {
  const hex = colorInt.toString(16).padStart(6, "0");
  return `#${hex}`;
}

function applyAlpha(hexColor, alpha) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const renderer = new TileRenderer(canvas, context, simulation, unitConfigs, pipelineConfigs);

const unitPulseEntries = new Map();
const unitModeLabels = new Map();
let selectedUnitId = null;
let activePreset = "auto";
let lastPulseRefresh = 0;
let gridVisible = true;
let flowOverlayVisible = true;
let activeMenu = null;
const PRESETS = {
  auto: {
    label: "AUTO",
    crude: 120,
    focus: 0.5,
    maintenance: 0.65,
    safety: 0.45,
    environment: 0.35,
    log: "Operator returned controls to automatic balancing.",
  },
  manual: {
    label: "MANUAL",
    crude: 180,
    focus: 0.68,
    maintenance: 0.45,
    safety: 0.36,
    environment: 0.22,
    log: "Manual push: throughput prioritized for gasoline blending.",
  },
  shutdown: {
    label: "SHUTDN",
    crude: 0,
    focus: 0.5,
    maintenance: 0.82,
    safety: 0.72,
    environment: 0.55,
    log: "Emergency shutdown drill initiated.",
  },
};

const SESSION_PRESETS = {
  legacy: {
    scenario: "maintenanceCrunch",
    params: {
      crude: 112,
      focus: 0.46,
      maintenance: 0.38,
      safety: 0.34,
      environment: 0.28,
    },
    storageLevels: { gasoline: 212, diesel: 158, jet: 122 },
    shipments: [
      { product: "gasoline", volume: 88, window: 4.2, dueIn: 0.9 },
      { product: "diesel", volume: 74, window: 3.8, dueIn: 0.6 },
    ],
    shipmentStats: { total: 4, onTime: 2, missed: 2 },
    nextShipmentIn: 0.8,
    units: [
      { id: "distillation", integrity: 0.58 },
      { id: "reformer", integrity: 0.4 },
      { id: "fcc", integrity: 0.45 },
      { id: "hydrocracker", integrity: 0.42, downtime: 95 },
      { id: "alkylation", integrity: 0.5 },
      { id: "sulfur", integrity: 0.56 },
    ],
    marketStress: 0.44,
    timeMinutes: 60 * 9,
    log: "Recovered training save loaded — tanks brimmed and maintenance overdue.",
  },
  modern: {
    scenario: "exportPush",
    params: {
      crude: 168,
      focus: 0.64,
      maintenance: 0.55,
      safety: 0.48,
      environment: 0.32,
    },
    storageLevels: { gasoline: 126, diesel: 104, jet: 68 },
    shipments: [
      { product: "jet", volume: 82, window: 5.5, dueIn: 1.6 },
      { product: "gasoline", volume: 64, window: 4.8, dueIn: 2.1 },
    ],
    shipmentStats: { total: 3, onTime: 1, missed: 0 },
    nextShipmentIn: 1.4,
    units: [
      { id: "reformer", integrity: 0.72 },
      { id: "hydrocracker", integrity: 0.68 },
      { id: "alkylation", integrity: 0.74 },
    ],
    unitOverrides: {
      hydrocracker: { throttle: 1.08 },
      sulfur: { throttle: 1.05 },
    },
    marketStress: 0.3,
    timeMinutes: 60 * 3,
    log: "Modernization drill loaded — chase export contracts without breaking reliability.",
  },
};

const toolbarPresetButtons = document.querySelectorAll("[data-preset]");
const toolbarUnitButtons = document.querySelectorAll("[data-unit-target]");
const toolbarScenarioButtons = document.querySelectorAll("[data-scenario]");

toolbarPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    applyPreset(preset);
  });
});

toolbarUnitButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.unitTarget || null;
    setSelectedUnit(target);
    ui.selectUnit(target);
  });
});

toolbarScenarioButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const scenario = button.dataset.scenario;
    if (!scenario) return;
    simulation.applyScenario(scenario);
    ui.setScenario(scenario);
    updateScenarioButtons(scenario);
  });
});

const sliderInputs = document.querySelectorAll('#hud input[type="range"]');
sliderInputs.forEach((input) => {
  input.addEventListener("input", () => {
    updatePresetButtons(null);
    activePreset = null;
    if (typeof ui.setModeBadge === "function") {
      ui.setModeBadge("CUSTOM");
    }
  });
});

if (ui.elements?.scenario) {
  ui.elements.scenario.addEventListener("change", (event) => {
    updateScenarioButtons(event.target.value);
  });
}

ui.onRunningChange = (running) => {
  updateMenuToggle(running);
};

ui.onReset = () => {
  performSimulationReset();
};

applyPreset("auto", { silent: true });
updatePresetButtons("auto");
updateScenarioButtons(simulation.activeScenarioKey);
updateUnitButtons(null);
ui.refreshControls();
initializeMenus();
updateMenuToggle(simulation.running);
updateToggleButton(gridToggleButton, gridVisible, "Hide Grid Overlay", "Show Grid Overlay");
updateToggleButton(flowToggleButton, flowOverlayVisible, "Hide Flow Glow", "Show Flow Glow");

populateScenarioMenu();
populateUnitMenu();
buildProcessLegend();
initializeUnitPulseList();
renderPrototypeNotes();

if (mapToolbar) {
  mapToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-command]");
    if (!button) return;
    const command = button.dataset.command;
    handleToolbarCommand(command);
  });
}

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(() => renderer.resizeToContainer(mapViewport));
  resizeObserver.observe(mapViewport);
}
window.addEventListener("resize", () => renderer.resizeToContainer(mapViewport));
renderer.resizeToContainer(mapViewport);

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const pointerX = (event.clientX - rect.left) * renderer.deviceScaleX;
  const pointerY = (event.clientY - rect.top) * renderer.deviceScaleY;
  const iso = renderer.screenToIso(pointerX, pointerY);
  renderer.setPointer(iso.x, iso.y, true);
  const unit = renderer.getUnitAt(iso.x, iso.y);
  const unitId = unit?.id || null;
  if (unitId !== renderer.hoverUnitId) {
    renderer.setHoverUnit(unitId);
    highlightPipelinesForUnit(unitId || selectedUnitId);
  }
});

canvas.addEventListener("mouseleave", () => {
  renderer.setPointer(0, 0, false);
  renderer.setHoverUnit(null);
  if (selectedUnitId) {
    highlightPipelinesForUnit(selectedUnitId);
  } else {
    clearPipelineHighlight();
  }
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const pointerX = (event.clientX - rect.left) * renderer.deviceScaleX;
  const pointerY = (event.clientY - rect.top) * renderer.deviceScaleY;
  const iso = renderer.screenToIso(pointerX, pointerY);
  const unit = renderer.getUnitAt(iso.x, iso.y);
  const unitId = unit?.id || null;
  setSelectedUnit(unitId);
  ui.selectUnit(unitId);
});

const clock = { last: performance.now() };
function animate(now) {
  const delta = (now - clock.last) / 1000;
  clock.last = now;
  simulation.update(delta);
  const logisticsState = simulation.getLogisticsState();
  const flows = simulation.getFlows();
  renderer.render(delta, { flows, logistics: logisticsState });
  ui.update(logisticsState, flows);
  refreshUnitPulse(now / 1000);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
function applyPreset(name, options = {}) {
  const preset = PRESETS[name];
  if (!preset) {
    return;
  }
  simulation.setParam("crudeIntake", preset.crude);
  simulation.setParam("productFocus", preset.focus);
  simulation.setParam("maintenance", preset.maintenance);
  simulation.setParam("safety", preset.safety);
  simulation.setParam("environment", preset.environment);

  if (name === "shutdown") {
    simulation.triggerEmergencyShutdown();
  } else {
    simulation.releaseEmergencyShutdown();
  }

  ui.refreshControls();
  updatePresetButtons(name);
  activePreset = name;
  if (typeof ui.setModeBadge === "function") {
    ui.setModeBadge(preset.label);
  }
  if (!options.silent) {
    simulation.pushLog("info", preset.log);
  }
}

function updatePresetButtons(name) {
  toolbarPresetButtons.forEach((button) => {
    const isActive = button.dataset.preset === name;
    button.classList.toggle("active", Boolean(name) && isActive);
  });
}

function updateUnitButtons(unitId) {
  toolbarUnitButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.unitTarget === unitId);
  });
  updateUnitMenuActive(unitId);
}

function updateScenarioButtons(key) {
  toolbarScenarioButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === key);
  });
  updateScenarioMenuActive(key);
}

function initializeMenus() {
  if (!menuBar) {
    return;
  }
  const menuButtons = menuBar.querySelectorAll(".menu > .menu-item:not(.menu-action)");
  menuButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = event.currentTarget.closest(".menu");
      toggleMenu(menu);
    });
  });

  menuBar.addEventListener("click", (event) => {
    const entry = event.target.closest(".menu-entry");
    if (!entry || !menuBar.contains(entry)) {
      return;
    }
    event.preventDefault();
    const action = entry.dataset.action;
    const scenario = entry.dataset.scenario;
    const unitId = entry.dataset.unit;
    if (action) {
      handleMenuAction(action, entry);
    } else if (scenario) {
      simulation.applyScenario(scenario);
      ui.setScenario(scenario);
      updateScenarioButtons(scenario);
    } else if (unitId) {
      setSelectedUnit(unitId);
      ui.selectUnit(unitId);
    }
    closeMenus();
  });

  document.addEventListener("click", (event) => {
    if (activeMenu && menuBar && !menuBar.contains(event.target)) {
      closeMenus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
    }
  });

  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const running = simulation.toggleRunning();
      ui.setRunning(running);
    });
  }

  if (importInput) {
    importInput.addEventListener("change", handleSnapshotImport);
  }
}

function toggleMenu(menu) {
  if (!menu) return;
  const button = menu.querySelector(".menu-item");
  const isOpen = menu.classList.contains("open");
  if (isOpen) {
    menu.classList.remove("open");
    if (button) {
      button.setAttribute("aria-expanded", "false");
    }
    activeMenu = null;
  } else {
    closeMenus();
    menu.classList.add("open");
    if (button) {
      button.setAttribute("aria-expanded", "true");
    }
    activeMenu = menu;
  }
}

function closeMenus() {
  if (!menuBar) return;
  menuBar.querySelectorAll(".menu.open").forEach((menu) => {
    menu.classList.remove("open");
    const button = menu.querySelector(".menu-item");
    if (button) {
      button.setAttribute("aria-expanded", "false");
    }
  });
  activeMenu = null;
}

function handleMenuAction(action) {
  switch (action) {
    case "session-reset":
      performSimulationReset();
      break;
    case "session-export":
      exportSnapshot();
      break;
    case "session-import":
      if (importInput) {
        importInput.click();
      }
      break;
    case "session-speed-slower": {
      const multiplier = simulation.adjustSpeedMultiplier(-0.25);
      simulation.pushLog("info", `Time scale set to ${multiplier.toFixed(2)}× baseline.`);
      break;
    }
    case "session-speed-normal": {
      const multiplier = simulation.setSpeedMultiplier(1);
      simulation.pushLog("info", `Time scale reset to ${multiplier.toFixed(2)}× baseline.`);
      break;
    }
    case "session-speed-faster": {
      const multiplier = simulation.adjustSpeedMultiplier(0.25);
      simulation.pushLog("info", `Time scale increased to ${multiplier.toFixed(2)}× baseline.`);
      break;
    }
    case "session-load-old":
      loadSessionPreset("legacy");
      break;
    case "session-load-new":
      loadSessionPreset("modern");
      break;
    case "view-center":
      renderer.resetView();
      simulation.pushLog("info", "Viewport recentered over refinery layout.");
      break;
    case "view-toggle-grid": {
      const nextState = !gridVisible;
      setGridVisibility(nextState);
      simulation.pushLog("info", nextState ? "Grid overlay enabled." : "Grid overlay hidden.");
      break;
    }
    case "view-toggle-flow": {
      const nextState = !flowOverlayVisible;
      setFlowVisibility(nextState);
      simulation.pushLog("info", nextState ? "Process flow glow enabled." : "Process flow glow hidden.");
      break;
    }
    case "view-cycle-light":
      renderer.cyclePalette();
      simulation.pushLog("info", "Palette cycled — channeling SimFarm and SimCity swatches.");
      break;
    default:
      break;
  }
}

function updateToggleButton(button, visible, hideLabel, showLabel) {
  if (!button) return;
  button.dataset.state = visible ? "on" : "off";
  button.textContent = visible ? hideLabel : showLabel;
}

function setGridVisibility(visible) {
  gridVisible = visible;
  renderer.setGridVisible(visible);
  updateToggleButton(gridToggleButton, gridVisible, "Hide Grid Overlay", "Show Grid Overlay");
}

function setFlowVisibility(visible) {
  flowOverlayVisible = visible;
  renderer.setFlowVisible(visible);
  updateToggleButton(flowToggleButton, flowOverlayVisible, "Hide Flow Glow", "Show Flow Glow");
}

function performSimulationReset() {
  simulation.reset();
  applyPreset("auto", { silent: true });
  activePreset = "auto";
  updatePresetButtons("auto");
  updateScenarioButtons(simulation.activeScenarioKey);
  ui.refreshControls();
  ui.setScenario(simulation.activeScenarioKey);
  if (typeof ui.setModeBadge === "function") {
    ui.setModeBadge("AUTO");
  }
  setSelectedUnit(null);
  ui.selectUnit(null);
  updateUnitButtons(null);
  populateUnitMenu();
  ui.setRunning(true);
}

function loadSessionPreset(key) {
  const preset = SESSION_PRESETS[key];
  if (!preset) {
    simulation.pushLog("info", "Preset scenario not available yet.");
    return;
  }

  simulation.reset();

  if (preset.scenario) {
    simulation.applyScenario(preset.scenario);
  }

  if (preset.params) {
    if (typeof preset.params.crude === "number") {
      simulation.setParam("crudeIntake", preset.params.crude);
    }
    if (typeof preset.params.focus === "number") {
      simulation.setParam("productFocus", preset.params.focus);
    }
    if (typeof preset.params.maintenance === "number") {
      simulation.setParam("maintenance", preset.params.maintenance);
    }
    if (typeof preset.params.safety === "number") {
      simulation.setParam("safety", preset.params.safety);
    }
    if (typeof preset.params.environment === "number") {
      simulation.setParam("environment", preset.params.environment);
    }
  }

  if (typeof preset.timeMinutes === "number") {
    simulation.timeMinutes = preset.timeMinutes;
  }

  if (typeof preset.marketStress === "number") {
    simulation.marketStress = clamp(preset.marketStress, 0, 0.85);
  }

  if (preset.storageLevels && simulation.storage?.levels) {
    Object.entries(preset.storageLevels).forEach(([product, level]) => {
      if (simulation.storage.levels[product] !== undefined) {
        const capacity = simulation.storage.capacity[product] || level;
        simulation.storage.levels[product] = clamp(level, 0, capacity);
      }
    });
  }

  simulation.shipments = [];
  if (Array.isArray(preset.shipments)) {
    const now = simulation.timeMinutes || 0;
    simulation.shipments = preset.shipments.map((shipment) => ({
      id: shipment.id || `preset-${shipment.product}-${Math.random().toString(16).slice(2, 6)}`,
      product: shipment.product,
      volume: shipment.volume,
      window: shipment.window,
      dueIn: shipment.dueIn ?? shipment.window,
      status: shipment.status || "pending",
      createdAt: now,
      cooldown: shipment.cooldown || 0,
    }));
  }

  if (preset.shipmentStats) {
    simulation.shipmentStats = {
      total: preset.shipmentStats.total ?? 0,
      onTime: preset.shipmentStats.onTime ?? 0,
      missed: preset.shipmentStats.missed ?? 0,
    };
  }

  if (typeof preset.nextShipmentIn === "number") {
    simulation.nextShipmentIn = preset.nextShipmentIn;
  }

  if (Array.isArray(preset.units)) {
    preset.units.forEach((entry) => {
      const unit = simulation.unitMap?.[entry.id];
      if (!unit) {
        return;
      }
      if (typeof entry.integrity === "number") {
        unit.integrity = clamp(entry.integrity, 0, 1);
      }
      if (typeof entry.downtime === "number" && entry.downtime > 0) {
        unit.downtime = entry.downtime;
        unit.status = "offline";
      }
      if (entry.status) {
        unit.status = entry.status;
      }
    });
  }

  simulation.unitOverrides = {};
  if (preset.unitOverrides) {
    Object.entries(preset.unitOverrides).forEach(([unitId, override]) => {
      if (typeof override.throttle === "number") {
        simulation.setUnitThrottle(unitId, override.throttle, { quiet: true });
      }
      if (override.offline) {
        simulation.setUnitOffline(unitId, true, { quiet: true });
      }
    });
  }

  simulation.pendingOperationalCost = 0;
  simulation.logisticsRushCooldown = 0;
  simulation.performanceHistory = [];
  simulation.update(1);

  activePreset = null;
  updatePresetButtons(null);
  ui.refreshControls();
  ui.setScenario(simulation.activeScenarioKey);
  updateScenarioButtons(simulation.activeScenarioKey);
  setSelectedUnit(null);
  ui.selectUnit(null);
  updateUnitButtons(null);
  populateUnitMenu();
  ui.setRunning(simulation.running);
  if (typeof ui.setModeBadge === "function") {
    ui.setModeBadge("CUSTOM");
  }
  updateMenuToggle(simulation.running);
  renderer.resetView?.();

  const message = preset.log || "Session preset loaded.";
  simulation.pushLog("info", message);
}

function exportSnapshot() {
  const snapshot = simulation.createSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `simrefinery-${timestamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  simulation.pushLog("info", "Snapshot exported for download.");
}

function handleSnapshotImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const snapshot = JSON.parse(reader.result);
      simulation.loadSnapshot(snapshot);
      activePreset = null;
      updatePresetButtons(null);
      ui.refreshControls();
      ui.setScenario(simulation.activeScenarioKey);
      updateScenarioButtons(simulation.activeScenarioKey);
      setSelectedUnit(null);
      ui.selectUnit(null);
      updateUnitButtons(null);
      populateUnitMenu();
      ui.setRunning(simulation.running);
      if (typeof ui.setModeBadge === "function") {
        ui.setModeBadge("CUSTOM");
      }
      updateMenuToggle(simulation.running);
      simulation.pushLog("info", "Snapshot imported and applied.");
    } catch (error) {
      console.error("Snapshot import failed", error);
      simulation.pushLog("warning", "Snapshot import failed. Verify the file format.");
    }
  });
  reader.readAsText(file);
  event.target.value = "";
}
function populateScenarioMenu() {
  if (!scenarioMenu) {
    return;
  }
  scenarioMenu.innerHTML = "";
  const scenarios = simulation.getScenarioList();
  scenarios.forEach((scenario) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-entry";
    button.dataset.scenario = scenario.key;
    button.textContent = scenario.name;
    button.title = scenario.description;
    scenarioMenu.appendChild(button);
  });
  updateScenarioMenuActive(simulation.activeScenarioKey);
}

function updateScenarioMenuActive(key) {
  if (!scenarioMenu) return;
  scenarioMenu.querySelectorAll(".menu-entry").forEach((entry) => {
    entry.classList.toggle("active", entry.dataset.scenario === key);
  });
}

function populateUnitMenu() {
  if (!unitMenu) {
    return;
  }
  unitMenu.innerHTML = "";
  simulation.getUnits().forEach((unit) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-entry";
    button.dataset.unit = unit.id;
    button.textContent = unit.name;
    unitMenu.appendChild(button);
  });
  updateUnitMenuActive(selectedUnitId);
}

function updateUnitMenuActive(unitId) {
  if (!unitMenu) return;
  unitMenu.querySelectorAll(".menu-entry").forEach((entry) => {
    entry.classList.toggle("active", entry.dataset.unit === unitId);
  });
}

function buildUnitModeLookup() {
  unitModeLabels.clear();
  const definitions = simulation.getUnitModeDefinitions?.();
  if (!Array.isArray(definitions)) {
    return;
  }
  definitions.forEach((definition) => {
    if (definition?.key && definition?.label) {
      unitModeLabels.set(definition.key, definition.label);
    }
  });
}

function initializeUnitPulseList() {
  if (!unitPulseList) {
    unitPulseEntries.clear();
    return;
  }
  buildUnitModeLookup();
  unitPulseList.innerHTML = "";
  unitPulseEntries.clear();
  simulation.getUnits().forEach((unit) => {
    const item = document.createElement("li");
    item.className = "pulse-entry";
    item.dataset.unit = unit.id;

    const topRow = document.createElement("div");
    topRow.className = "pulse-top";

    const name = document.createElement("span");
    name.className = "pulse-name";
    name.textContent = unit.name;
    topRow.appendChild(name);

    const mode = document.createElement("span");
    mode.className = "pulse-mode";
    mode.dataset.mode = unit.mode;
    mode.textContent = formatModeLabel(unit.mode);
    topRow.appendChild(mode);

    item.appendChild(topRow);

    const loadMeter = createPulseMeter("Load", "load");
    const integrityMeter = createPulseMeter("Integrity", "integrity");
    item.appendChild(loadMeter.wrapper);
    item.appendChild(integrityMeter.wrapper);

    const footer = document.createElement("div");
    footer.className = "pulse-footer";

    const status = document.createElement("span");
    status.className = "pulse-status";
    footer.appendChild(status);

    const incidents = document.createElement("span");
    incidents.className = "pulse-incidents";
    footer.appendChild(incidents);

    item.appendChild(footer);

    item.addEventListener("click", () => {
      setSelectedUnit(unit.id);
      ui.selectUnit(unit.id);
    });

    unitPulseList.appendChild(item);

    unitPulseEntries.set(unit.id, {
      item,
      mode,
      status,
      incidents,
      loadFill: loadMeter.fill,
      loadValue: loadMeter.value,
      integrityFill: integrityMeter.fill,
      integrityValue: integrityMeter.value,
    });
  });

  refreshUnitPulse(0, true);
}

function createPulseMeter(label, type) {
  const wrapper = document.createElement("div");
  wrapper.className = "pulse-meter";
  wrapper.dataset.type = type;
  const labelEl = document.createElement("span");
  labelEl.className = "pulse-meter-label";
  labelEl.textContent = label;
  const track = document.createElement("span");
  track.className = "pulse-meter-track";
  const fill = document.createElement("span");
  fill.className = "pulse-meter-fill";
  track.appendChild(fill);
  const value = document.createElement("span");
  value.className = "pulse-meter-value";
  wrapper.append(labelEl, track, value);
  return { wrapper, fill, value };
}

function refreshUnitPulse(time, force = false) {
  if (!unitPulseList || unitPulseEntries.size === 0) {
    return;
  }
  if (!force && time - lastPulseRefresh < 0.45) {
    return;
  }
  lastPulseRefresh = time;

  simulation.getUnits().forEach((unit) => {
    const entry = unitPulseEntries.get(unit.id);
    if (!entry) return;
    const utilization = clamp(unit.utilization ?? 0, 0, 1.4);
    const normalizedLoad = Math.min(utilization, 1);
    entry.loadFill.style.width = `${(normalizedLoad * 100).toFixed(1)}%`;
    entry.loadFill.style.background = getLoadGradient(normalizedLoad, utilization > 1);
    entry.loadValue.textContent = `${Math.round(utilization * 100)}%`;
    const integrity = clamp(unit.integrity ?? 0, 0, 1);
    entry.integrityFill.style.width = `${(integrity * 100).toFixed(1)}%`;
    entry.integrityFill.style.background = getIntegrityGradient(integrity);
    entry.integrityValue.textContent = `${Math.round(integrity * 100)}%`;
    entry.mode.textContent = formatModeLabel(unit.mode);
    entry.mode.dataset.mode = unit.mode || "balanced";
    entry.status.textContent = formatUnitStatus(unit);
    entry.incidents.textContent = formatIncidentCount(unit.incidents || 0);
    entry.item.classList.toggle("offline", unit.status === "offline");
    entry.item.classList.toggle("standby", unit.status === "standby");
    entry.item.classList.toggle("overload", utilization > 1);
    entry.item.classList.toggle("selected", selectedUnitId === unit.id);
    entry.item.classList.toggle("alerting", Boolean(unit.alert));
  });

  renderAlertCallouts();
}
function renderAlertCallouts() {
  if (!calloutShelf) {
    return;
  }
  const alerts = collectActiveAlerts();
  const signatureParts = [selectedUnitId || "none"];
  alerts.forEach((alert) => {
    signatureParts.push(
      `${alert.type || "unit"}:${alert.unitId || alert.product || alert.label || ""}:${alert.severity || ""}:${
        alert.summary || ""
      }:${alert.detail || ""}:${alert.guidance || ""}`
    );
  });
  const signature = signatureParts.join("|");
  if (calloutShelf.dataset.signature === signature) {
    return;
  }
  calloutShelf.dataset.signature = signature;

  calloutShelf.innerHTML = "";
  if (alerts.length === 0) {
    calloutShelf.dataset.state = "clear";
    const empty = document.createElement("p");
    empty.className = "alert-empty";
    empty.textContent = "All systems nominal.";
    calloutShelf.appendChild(empty);
    return;
  }

  calloutShelf.dataset.state = "active";
  const severityRank = { danger: 0, warning: 1, info: 2 };
  alerts
    .slice()
    .sort((a, b) => {
      const rankA = severityRank[a.severity] ?? 3;
      const rankB = severityRank[b.severity] ?? 3;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const timeA = a.recordedAt || "";
      const timeB = b.recordedAt || "";
      return timeB.localeCompare(timeA);
    })
    .forEach((alert) => {
      calloutShelf.appendChild(createAlertCallout(alert));
    });
}

function collectActiveAlerts() {
  if (typeof simulation.getActiveAlerts === "function") {
    const provided = simulation.getActiveAlerts();
    if (Array.isArray(provided)) {
      return provided.map((alert) => ({
        type: alert.type || "unit",
        unitId: alert.unitId || null,
        product: alert.product,
        label: alert.label || alert.name || null,
        name: alert.name || alert.label || null,
        severity: alert.severity || "warning",
        summary: alert.summary || alert.title || "",
        detail: alert.detail || alert.cause || "",
        guidance: alert.guidance || "",
        recordedAt: alert.recordedAt || alert.time || "",
        percent:
          typeof alert.percent === "number"
            ? alert.percent
            : typeof alert.utilization === "number"
            ? alert.utilization
            : undefined,
      }));
    }
  }

  return simulation
    .getUnits()
    .filter((unit) => Boolean(unit.alert))
    .map((unit) => {
      const detail = unit.alertDetail || unit.lastIncident || {};
      return {
        type: "unit",
        unitId: unit.id,
        label: unit.name,
        name: unit.name,
        severity: detail.severity || unit.alert || "warning",
        summary: detail.summary || buildUnitAlertSummary(unit),
        detail: detail.cause || buildUnitAlertDescription(unit),
        guidance: detail.guidance || "",
        recordedAt: detail.recordedAt || "",
      };
    });
}

function createAlertCallout(alert) {
  const card = document.createElement("article");
  card.className = "alert-callout";
  card.dataset.severity = alert.severity || "warning";
  const heading = document.createElement("header");
  const title = document.createElement("h4");
  title.textContent = alert.label || alert.name || "Alert";
  heading.appendChild(title);

  if (alert.severity) {
    const badge = document.createElement("span");
    badge.className = "alert-badge";
    badge.textContent = alert.severity.toUpperCase();
    heading.appendChild(badge);
  }

  card.appendChild(heading);

  if (alert.summary) {
    const summary = document.createElement("p");
    summary.className = "alert-summary";
    summary.textContent = alert.summary;
    card.appendChild(summary);
  }

  if (alert.detail) {
    const detail = document.createElement("p");
    detail.className = "alert-detail";
    detail.textContent = alert.detail;
    card.appendChild(detail);
  }

  if (alert.guidance) {
    const guidance = document.createElement("p");
    guidance.className = "alert-guidance";
    guidance.textContent = alert.guidance;
    card.appendChild(guidance);
  }

  const footer = document.createElement("footer");
  const timestamp = document.createElement("span");
  timestamp.textContent = alert.recordedAt ? `Since ${alert.recordedAt}` : "Live update";
  footer.appendChild(timestamp);

  if (alert.unitId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alert-focus-button";
    button.textContent = "Focus";
    const focusUnit = () => {
      setSelectedUnit(alert.unitId);
      ui.selectUnit(alert.unitId);
    };
    button.addEventListener("click", focusUnit);
    button.addEventListener("focus", () => highlightPipelinesForUnit(alert.unitId));
    button.addEventListener("blur", () => {
      if (selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
      } else {
        clearPipelineHighlight();
      }
    });
    footer.appendChild(button);

    const highlight = () => highlightPipelinesForUnit(alert.unitId);
    const resetHighlight = () => {
      if (selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
      } else {
        clearPipelineHighlight();
      }
    };
    card.addEventListener("mouseenter", highlight);
    card.addEventListener("focus", highlight);
    card.addEventListener("mouseleave", resetHighlight);
    card.addEventListener("blur", resetHighlight);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusUnit();
      }
    });
  } else if (alert.type === "storage") {
    const status = document.createElement("span");
    if (typeof alert.percent === "number") {
      status.textContent = `${Math.round(alert.percent)}% full`;
    } else {
      status.textContent = "Storage alert";
    }
    footer.appendChild(status);
  }

  card.appendChild(footer);

  if (alert.unitId && selectedUnitId === alert.unitId) {
    card.classList.add("selected");
  }

  return card;
}

function getLoadGradient(value, overload) {
  if (overload) {
    return "linear-gradient(90deg, #ff7a5c, #ff3624)";
  }
  const clamped = clamp(value, 0, 1);
  const hue = 210 - clamped * 170;
  const hueEnd = Math.max(15, hue - 14);
  return `linear-gradient(90deg, hsl(${hue}, 78%, 55%), hsl(${hueEnd}, 78%, 48%))`;
}

function getIntegrityGradient(value) {
  const clamped = clamp(value, 0, 1);
  const hue = 20 + clamped * 100;
  const hueEnd = Math.min(130, hue + 8);
  return `linear-gradient(90deg, hsl(${hue}, 72%, 52%), hsl(${hueEnd}, 68%, 46%))`;
}

function buildUnitAlertSummary(unit) {
  const detail = unit.alertDetail || unit.lastIncident;
  if (detail?.summary) {
    return detail.summary;
  }
  if (unit.status === "offline") {
    if (unit.emergencyOffline) {
      return "Emergency shutdown";
    }
    if (unit.manualOffline) {
      return "Manual standby";
    }
    return "Offline for repairs";
  }
  if (typeof unit.integrity === "number" && unit.integrity < 0.5) {
    return `Integrity ${Math.round(unit.integrity * 100)}%`;
  }
  if (unit.alert === "danger") {
    return "Critical fault";
  }
  if (unit.alert === "warning") {
    return "Process warning";
  }
  return "Stable";
}

function buildUnitAlertDescription(unit) {
  const detail = unit.alertDetail || unit.lastIncident;
  if (detail?.cause && detail?.guidance) {
    return `${detail.cause}. ${detail.guidance}`;
  }
  if (detail?.cause) {
    return detail.cause;
  }
  if (detail?.guidance) {
    return detail.guidance;
  }
  if (unit.alert === "danger") {
    return "Immediate intervention required.";
  }
  if (unit.alert === "warning") {
    if (typeof unit.integrity === "number") {
      return `Integrity at ${Math.round(unit.integrity * 100)}%. Adjust maintenance or throughput.`;
    }
    return "Monitor unit conditions closely.";
  }
  return "Online";
}
function formatUnitStatus(unit) {
  if (unit.status === "offline") {
    return formatOfflineStatus(unit);
  }
  if (unit.alert) {
    return buildUnitAlertSummary(unit);
  }
  if (typeof unit.utilization === "number") {
    return `Online • ${Math.round(unit.utilization * 100)}% load`;
  }
  return "Online";
}

function formatOfflineStatus(unit) {
  const minutes = Math.max(1, Math.ceil(unit.downtime || 0));
  if (unit.alert) {
    return `${buildUnitAlertSummary(unit)} (${minutes}m)`;
  }
  return `Offline (${minutes}m)`;
}

function formatIncidentCount(count) {
  return count === 1 ? "1 incident" : `${count} incidents`;
}

function formatModeLabel(key) {
  if (!key) {
    return "Balanced";
  }
  if (unitModeLabels.has(key)) {
    return unitModeLabels.get(key);
  }
  return key
    .split(/\s|_/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function updateMenuToggle(running) {
  if (!menuToggle) return;
  menuToggle.textContent = running ? "Pause" : "Resume";
  menuToggle.setAttribute("aria-pressed", running ? "false" : "true");
}

function buildProcessLegend() {
  if (!mapStatusPanel || !processTopology) {
    return;
  }
  if (mapStatusPanel.querySelector("#process-legend")) {
    return;
  }
  const legend = document.createElement("div");
  legend.id = "process-legend";
  const heading = document.createElement("h4");
  heading.textContent = "Process Flow";
  legend.appendChild(heading);
  const list = document.createElement("ol");
  const sequence = ["distillation", "reformer", "fcc", "hydrocracker", "alkylation", "sulfur"];
  sequence.forEach((unitId) => {
    const entry = processTopology[unitId];
    if (!entry) {
      return;
    }
    const item = document.createElement("li");
    item.dataset.unit = unitId;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    const name = document.createElement("span");
    name.textContent = entry.name || unitId;
    item.appendChild(name);
    const summary = document.createElement("small");
    summary.textContent = entry.summary || "";
    item.appendChild(summary);
    item.addEventListener("mouseenter", () => highlightPipelinesForUnit(unitId));
    item.addEventListener("focus", () => highlightPipelinesForUnit(unitId));
    item.addEventListener("mouseleave", () => {
      if (selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
      } else {
        clearPipelineHighlight();
      }
    });
    item.addEventListener("blur", () => {
      if (selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
      } else {
        clearPipelineHighlight();
      }
    });
    item.addEventListener("click", () => {
      setSelectedUnit(unitId);
      ui.selectUnit(unitId);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedUnit(unitId);
        ui.selectUnit(unitId);
      }
    });
    list.appendChild(item);
  });
  legend.appendChild(list);
  mapStatusPanel.appendChild(legend);
}

function highlightPipelinesForUnit(unitId) {
  if (!unitId) {
    clearPipelineHighlight();
    return;
  }
  const pipelines = unitConnectionIndex.get(unitId) || [];
  renderer.setHighlightedPipelines(pipelines);
}

function clearPipelineHighlight() {
  renderer.setHighlightedPipelines([]);
}

function setSelectedUnit(unitId) {
  selectedUnitId = unitId || null;
  renderer.setSelectedUnit(selectedUnitId);
  updateUnitButtons(selectedUnitId);
  if (selectedUnitId) {
    highlightPipelinesForUnit(selectedUnitId);
  } else {
    clearPipelineHighlight();
  }
}

function handleToolbarCommand(command) {
  switch (command) {
    case "record-demo":
      simulation.pushLog(
        "info",
        "Whiteboard recorder placeholder: review the included tutorial playback for orientation."
      );
      break;
    case "inspection":
      simulation.pushLog(
        "info",
        "Inspection window is mostly blank in the original prototype — guidance comes from the Tour Book."
      );
      break;
    case "build-road":
      simulation.dispatchLogisticsConvoy();
      break;
    case "build-pipe": {
      const success = simulation.deployPipelineBypass(selectedUnitId);
      if (success && selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
      }
      break;
    }
    case "bulldoze":
      simulation.scheduleTurnaround(selectedUnitId);
      break;
    default:
      break;
  }
}

function renderPrototypeNotes() {
  if (!prototypeNotes) {
    return;
  }
  prototypeNotes.innerHTML = "";
  const history = document.createElement("p");
  history.textContent =
    "Recovered Richmond interface now wires convoy drills, pipeline bypasses, and scenario loads directly into the edit console.";
  const placeholders = document.createElement("ul");
  placeholders.className = "prototype-list";
  [
    "Session → Load Old/New drop you into curated Chevron training scenarios with different bottlenecks to solve.",
    "ROAD dispatches a truck convoy to bleed down whichever product tanks are overflowing the most.",
    "PIPE stages a temporary bypass for the selected unit’s feed, while BULLDOZE schedules a turnaround to restore integrity.",
  ].forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    placeholders.appendChild(item);
  });
  prototypeNotes.append(history, placeholders);
}

function buildUnitConnectionIndex(topology) {
  const map = new Map();
  if (!topology) {
    return map;
  }
  Object.entries(topology).forEach(([unitId, entry]) => {
    const pipelines = new Set();
    (entry.feeds || []).forEach((item) => {
      if (item && item.pipeline) {
        pipelines.add(item.pipeline);
      }
    });
    (entry.outputs || []).forEach((item) => {
      if (item && item.pipeline) {
        pipelines.add(item.pipeline);
      }
    });
    map.set(unitId, Array.from(pipelines));
  });
  return map;
}

