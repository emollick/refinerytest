import { RefinerySimulation } from "./simulation.js?v=2";
import { UIController } from "./ui.js?v=2";

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

sceneContainer.innerHTML = "";

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


const SVG_NS = "http://www.w3.org/2000/svg";

class TileRenderer {
  constructor(container, simulationInstance, unitDefs, pipelineDefs) {
    this.container = container;
    this.simulation = simulationInstance;
    this.unitDefs = unitDefs;
    this.pipelineDefs = pipelineDefs;
    this.pipelineLookup = new Map(pipelineDefs.map((entry) => [entry.id, entry]));
    this.tileWidth = 64;
    this.tileHeight = 32;
    this.mapCols = 16;
    this.mapRows = 12;
    this.viewWidth = 1180;
    this.viewHeight = 760;
    this.originX = this.viewWidth / 2;
    this.originY = 150;
    this.time = 0;
    this.selectionFlash = 0;
    this.gridVisible = true;
    this.flowVisible = true;
    this.highlightedPipelines = new Set();
    this.selectedUnitId = null;
    this.hoverUnitId = null;
    this.pointer = { x: 0, y: 0, active: false };
    this.deviceScaleX = 1;
    this.deviceScaleY = 1;
    this.paletteIndex = 0;
    this.camera = {
      zoom: 1,
      minZoom: 0.65,
      maxZoom: 2.8,
      offsetX: 0,
      offsetY: 0,
      userControlled: false,
    };
    this.panSession = null;

    this.palettes = [
      {
        pavement: "#c7c0ae",
        pavementShadow: "#8f8774",
        water: "#1e3358",
        waterHighlight: "#2c4b7e",
        shore: "#345168",
        grass: "#7aa471",
        green: "#76a08c",
        field: "#a37a41",
        fieldAlt: "#c99c50",
        road: "#3f465c",
        roadLine: "#dcd4a4",
        walkway: "#bfa98b",
        grid: "rgba(32, 40, 54, 0.4)",
        outline: "#1c1d20",
        pipeBase: "#76aee8",
        pipeGlow: "rgba(240,252,255,0.75)",
        labelBg: "rgba(12, 16, 22, 0.6)",
      },
      {
        pavement: "#b5bcc8",
        pavementShadow: "#88909f",
        water: "#142a44",
        waterHighlight: "#1e3f63",
        shore: "#2f4663",
        grass: "#6b8f67",
        green: "#6b9aa2",
        field: "#996a33",
        fieldAlt: "#bf8c3c",
        road: "#3a4255",
        roadLine: "#e2dcae",
        walkway: "#b69f82",
        grid: "rgba(20, 32, 48, 0.42)",
        outline: "#16171c",
        pipeBase: "#8ec8ff",
        pipeGlow: "rgba(226,246,255,0.8)",
        labelBg: "rgba(10, 12, 18, 0.65)",
      },
    ];

    this.tiles = this._buildBaseTiles();
    this.decor = this._buildDecor();

    this.svg = createSvgElement("svg", {
      class: "tile-svg",
      viewBox: `0 0 ${this.viewWidth} ${this.viewHeight}`,
      role: "presentation",
      "aria-hidden": "true",
    });
    this.container.appendChild(this.svg);

    this.worldGroup = createSvgElement("g", { class: "map-world" });
    this.svg.appendChild(this.worldGroup);

    this.layers = {
      base: this._createLayer("tile-layer base"),
      grid: this._createLayer("tile-layer grid"),
      decor: this._createLayer("tile-layer decor"),
      pipelines: this._createLayer("tile-layer pipelines"),
      pipelineGlow: this._createLayer("tile-layer pipeline-glow"),
      units: this._createLayer("tile-layer units"),
      overlay: this._createLayer("tile-layer overlay"),
    };

    this.tileNodes = this._createTiles();
    this.gridNodes = this._createGrid();
    this.decorNodes = this._createDecorNodes();
    this.pipelineNodes = this._createPipelineNodes();
    this.unitNodes = this._createUnitNodes();
    this.pointerNode = this._createPointerNode();
    this.tankNodes = this._createTankNodes();

    this._applyPalette();
    this.mapBounds = this._calculateMapBounds();
    this._fitCameraToView();
    this.resizeToContainer(this.container);
  }

  getSurface() {
    return this.svg;
  }

  resizeToContainer(container) {
    const rect = container.getBoundingClientRect();
    const width = Math.max(720, Math.floor(rect.width));
    const height = Math.max(480, Math.floor(rect.height));
    this.svg.setAttribute("width", width);
    this.svg.setAttribute("height", height);
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
    this.deviceScaleX = this.viewWidth / width;
    this.deviceScaleY = this.viewHeight / height;
    this.displayWidth = width;
    this.displayHeight = height;
    if (!this.camera.userControlled) {
      this._fitCameraToView({ preserveZoom: true });
    } else {
      this._clampCamera();
      this._updateCameraTransform();
    }
  }

  setGridVisible(visible) {
    this.gridVisible = visible;
    this.layers.grid.classList.toggle("hidden", !visible);
  }

  setFlowVisible(visible) {
    this.flowVisible = visible;
    this.layers.pipelineGlow.classList.toggle("hidden", !visible);
  }

  cyclePalette() {
    this.paletteIndex = (this.paletteIndex + 1) % this.palettes.length;
    this._applyPalette();
  }

  setHighlightedPipelines(pipelines) {
    this.highlightedPipelines = new Set(pipelines);
    for (const [id, node] of this.pipelineNodes.entries()) {
      node.group.classList.toggle("highlighted", this.highlightedPipelines.has(id));
    }
  }

  setSelectedUnit(unitId) {
    this.selectedUnitId = unitId;
    for (const [id, node] of this.unitNodes.entries()) {
      node.group.classList.toggle("selected", id === unitId);
    }
    if (unitId) {
      this.focusOnUnit(unitId, { onlyIfVisible: true });
    }
  }

  setHoverUnit(unitId) {
    this.hoverUnitId = unitId;
    for (const [id, node] of this.unitNodes.entries()) {
      const isHover = unitId === id && this.selectedUnitId !== id;
      node.group.classList.toggle("hover", isHover);
    }
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

    for (const pipeline of this.pipelineDefs) {
      const nodes = this.pipelineNodes.get(pipeline.id);
      if (!nodes) continue;
      const value = flows?.[pipeline.metric] ?? 0;
      const ratio = pipeline.capacity ? clamp(value / pipeline.capacity, 0, 1.5) : 0;
      const highlight = this.highlightedPipelines.has(pipeline.id);
      const intensity = highlight ? 1 : clamp(ratio, 0.2, 0.9);
      nodes.base.setAttribute("stroke-width", highlight ? 10 : 6);
      nodes.base.setAttribute("stroke-opacity", (0.25 + intensity * 0.6).toFixed(3));
      const glowOpacity = this.flowVisible ? (0.12 + intensity * 0.6).toFixed(3) : 0;
      nodes.glow.setAttribute("stroke-opacity", glowOpacity);
      const dashOffset = ((this.time * 60 + pipeline.phase * 40) % 180).toFixed(2);
      nodes.glow.setAttribute("stroke-dashoffset", dashOffset);
    }

    const unitMetrics = new Map(this.simulation.getUnits().map((unit) => [unit.id, unit]));
    for (const [id, node] of this.unitNodes.entries()) {
      const data = unitMetrics.get(id);
      const utilization = clamp(data?.utilization ?? 0, 0, 1.3);
      const integrity = clamp(data?.integrity ?? 0, 0, 1);
      node.loadBar.setAttribute("width", (node.barWidth * clamp(utilization, 0, 1)).toFixed(1));
      node.healthBar.setAttribute("width", (node.barWidth * integrity).toFixed(1));
      if (this.selectedUnitId === id) {
        const pulse = 0.45 + Math.sin(this.selectionFlash * 3) * 0.35;
        node.highlight.setAttribute("stroke-opacity", pulse.toFixed(2));
      } else {
        node.highlight.setAttribute("stroke-opacity", node.baseOpacity);
      }
    }

    if (this.pointer.active) {
      const points = this._diamondPoints(this.pointer.x, this.pointer.y);
      this.pointerNode.setAttribute("points", pointsToString(points));
      this.pointerNode.classList.add("visible");
    } else {
      this.pointerNode.classList.remove("visible");
    }

    if (this.decorDynamic?.flare) {
      const flame = this.decorDynamic.flare;
      const scale = 1 + Math.sin(this.time * 4.5) * 0.2;
      flame.element.setAttribute(
        "transform",
        `translate(${flame.baseX} ${flame.baseY}) scale(1 ${scale.toFixed(3)})`
      );
    }

    const storage = logistics?.storage || {};
    const levels = storage.levels || {};
    const capacity = storage.capacity || {};
    for (const [product, node] of this.tankNodes.entries()) {
      const level = levels[product] || 0;
      const cap = capacity[product] || 1;
      const ratio = cap ? clamp(level / cap, 0, 1) : 0;
      const height = node.maxHeight * ratio;
      node.fill.setAttribute("height", height.toFixed(1));
      node.fill.setAttribute("y", (node.baseY + node.maxHeight - height).toFixed(1));
    }

    if (!this.panSession && !this.camera.userControlled && this.mapBounds) {
      const targetX = this.viewWidth / 2 - this.mapBounds.centerX * this.camera.zoom;
      const targetY = this.viewHeight / 2 - this.mapBounds.centerY * this.camera.zoom;
      const beforeX = this.camera.offsetX;
      const beforeY = this.camera.offsetY;
      this.camera.offsetX += (targetX - this.camera.offsetX) * 0.15;
      this.camera.offsetY += (targetY - this.camera.offsetY) * 0.15;
      this._clampCamera();
      const changedX = Math.abs(beforeX - this.camera.offsetX) > 0.01;
      const changedY = Math.abs(beforeY - this.camera.offsetY) > 0.01;
      if (changedX || changedY) {
        this._updateCameraTransform();
      }
    }
  }

  screenToIso(clientX, clientY) {
    const adjustedX = (clientX - this.camera.offsetX) / this.camera.zoom;
    const adjustedY = (clientY - this.camera.offsetY) / this.camera.zoom;
    const x = (adjustedX - this.originX) / (this.tileWidth / 2);
    const y = (adjustedY - this.originY) / (this.tileHeight / 2);
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
    this.camera.userControlled = false;
    this._fitCameraToView({ preserveZoom: false });
  }

  getSurfaceBounds() {
    return this.svg.getBoundingClientRect();
  }

  nudgeCamera(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) && !Number.isFinite(deltaY)) {
      return;
    }
    if (Number.isFinite(deltaX)) {
      this.camera.offsetX += deltaX;
    }
    if (Number.isFinite(deltaY)) {
      this.camera.offsetY += deltaY;
    }
    this.camera.userControlled = true;
    this._clampCamera();
    this._updateCameraTransform();
  }

  _createLayer(className) {
    const group = createSvgElement("g", { class: className });
    this.worldGroup.appendChild(group);
    return group;
  }

  _createTiles() {
    const nodes = [];
    for (let y = 0; y < this.mapRows; y += 1) {
      for (let x = 0; x < this.mapCols; x += 1) {
        const type = this.tiles[y][x];
        const baseType = type.split("-")[0];
        const points = this._tileDiamondPoints(x, y);
        const group = createSvgElement("g", {
          class: `tile tile-${baseType}`,
        });
        const base = createSvgElement("polygon", {
          class: "tile-base",
          points: pointsToString(points),
        });
        const highlight = createSvgElement("polygon", {
          class: "tile-highlight",
          points: pointsToString(this._tileHighlightPoints(points)),
        });
        highlight.setAttribute("stroke", "none");
        const shadow = createSvgElement("polygon", {
          class: "tile-shadow",
          points: pointsToString(this._tileShadowPoints(points)),
        });
        shadow.setAttribute("stroke", "none");
        group.appendChild(base);
        group.appendChild(shadow);
        group.appendChild(highlight);
        this.layers.base.appendChild(group);
        const tile = {
          group,
          base,
          highlight,
          shadow,
          type,
          baseType,
          x,
          y,
        };
        const overlay = this._decorateTile(tile);
        if (overlay) {
          tile.overlay = overlay;
        }
        nodes.push(tile);
      }
    }
    return nodes;
  }

  _tileHighlightPoints(points) {
    const [top, right, bottom, left] = points;
    const center = [
      (top[0] + right[0] + bottom[0] + left[0]) / 4,
      (top[1] + right[1] + bottom[1] + left[1]) / 4,
    ];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [
      top,
      lerp(top, right, 0.45),
      center,
      lerp(top, left, 0.45),
    ];
  }

  _tileShadowPoints(points) {
    const [top, right, bottom, left] = points;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [
      right,
      lerp(right, bottom, 0.55),
      bottom,
      lerp(bottom, left, 0.4),
      lerp(right, top, 0.25),
    ];
  }

  _createGrid() {
    const nodes = [];
    for (let y = 0; y < this.mapRows; y += 1) {
      for (let x = 0; x < this.mapCols; x += 1) {
        const polygon = createSvgElement("polygon", {
          class: "grid-line",
          points: pointsToString(this._tileDiamondPoints(x, y)),
        });
        this.layers.grid.appendChild(polygon);
        nodes.push(polygon);
      }
    }
    return nodes;
  }

  _decorateTile(tile) {
    const [baseType, orientation] = tile.type.split("-");
    const corners = this._tileDiamondPoints(tile.x, tile.y);
    const [topCorner, rightCorner, bottomCorner, leftCorner] = corners;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (baseType === "road") {
      const dir = orientation || "ew";
      const buildPoints = (direction) => {
        if (direction === "ns") {
          return [
            lerp(topCorner, rightCorner, 0.4),
            lerp(topCorner, leftCorner, 0.4),
            lerp(bottomCorner, leftCorner, 0.4),
            lerp(bottomCorner, rightCorner, 0.4),
          ];
        }
        return [
          lerp(leftCorner, topCorner, 0.4),
          lerp(rightCorner, topCorner, 0.4),
          lerp(rightCorner, bottomCorner, 0.4),
          lerp(leftCorner, bottomCorner, 0.4),
        ];
      };
      const createLine = (direction) => {
        if (direction === "ns") {
          const start = lerp(topCorner, bottomCorner, 0.12);
          const end = lerp(topCorner, bottomCorner, 0.88);
          return this._createRoadLine(start, end);
        }
        if (direction === "ew") {
          const start = lerp(leftCorner, rightCorner, 0.12);
          const end = lerp(leftCorner, rightCorner, 0.88);
          return this._createRoadLine(start, end);
        }
        return null;
      };
      if (dir === "cross") {
        const group = createSvgElement("g", { class: "road-surface cross" });
        const horizontal = createSvgElement("polygon", {
          class: "road-part ew",
          points: pointsToString(buildPoints("ew")),
        });
        const vertical = createSvgElement("polygon", {
          class: "road-part ns",
          points: pointsToString(buildPoints("ns")),
        });
        group.appendChild(horizontal);
        group.appendChild(vertical);
        this.layers.decor.appendChild(group);
        const lines = [createLine("ew"), createLine("ns")].filter(Boolean);
        return { node: group, type: "road", orientation: dir, parts: [horizontal, vertical], lines };
      }
      const polygon = createSvgElement("polygon", {
        class: `road-surface ${dir}`,
        points: pointsToString(buildPoints(dir)),
      });
      this.layers.decor.appendChild(polygon);
      const line = createLine(dir);
      return { node: polygon, type: "road", orientation: dir, line };
    }
    if (baseType === "walkway") {
      const points = [
        lerp(corners[0], corners[1], 0.6),
        lerp(corners[0], corners[3], 0.6),
        lerp(corners[2], corners[3], 0.6),
        lerp(corners[2], corners[1], 0.6),
      ];
      const polygon = createSvgElement("polygon", {
        class: "walkway",
        points: pointsToString(points),
      });
      this.layers.decor.appendChild(polygon);
      return { node: polygon, type: "walkway" };
    }
    if (baseType === "water") {
      const group = createSvgElement("g", { class: "water-detail" });
      const crest = createSvgElement("polyline", {
        class: "water-ripple",
        points: pointsToString([
          lerp(leftCorner, topCorner, 0.55),
          lerp(topCorner, rightCorner, 0.5),
          lerp(rightCorner, bottomCorner, 0.45),
        ]),
      });
      const trough = createSvgElement("polyline", {
        class: "water-ripple",
        points: pointsToString([
          lerp(leftCorner, bottomCorner, 0.65),
          lerp(bottomCorner, rightCorner, 0.55),
          lerp(rightCorner, topCorner, 0.6),
        ]),
      });
      group.appendChild(crest);
      group.appendChild(trough);
      this.layers.decor.appendChild(group);
      return { type: "water", ripples: [crest, trough] };
    }
    if (baseType === "field" || baseType === "fieldAlt") {
      const group = createSvgElement("g", { class: "field-detail" });
      const stripes = [];
      for (let i = 1; i <= 3; i += 1) {
        const stripe = createSvgElement("polygon", {
          class: "field-stripe",
          points: pointsToString([
            lerp(leftCorner, topCorner, 0.15 * i),
            lerp(rightCorner, topCorner, 0.18 * i + 0.15),
            lerp(rightCorner, bottomCorner, 0.18 * i + 0.22),
            lerp(leftCorner, bottomCorner, 0.15 * i + 0.2),
          ]),
        });
        stripes.push(stripe);
        group.appendChild(stripe);
      }
      this.layers.decor.appendChild(group);
      return { type: "field", stripes };
    }
    return null;
  }

  _createRoadLine(start, end) {
    const line = createSvgElement("line", {
      class: "road-centerline",
      x1: start[0].toFixed(1),
      y1: start[1].toFixed(1),
      x2: end[0].toFixed(1),
      y2: end[1].toFixed(1),
    });
    this.layers.decor.appendChild(line);
    return line;
  }

  _createDecorNodes() {
    const nodes = [];
    this.decorDynamic = {};
    for (const item of this.decor) {
      if (item.type === "parking") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const width = this.tileWidth * item.width * 0.5;
        const height = this.tileHeight * item.height;
        const polygon = createSvgElement("polygon", {
          class: "decor parking",
          points: pointsToString([
            [x, y],
            [x + width, y + height * 0.5],
            [x, y + height],
            [x - width, y + height * 0.5],
          ]),
        });
        this.layers.decor.appendChild(polygon);
        nodes.push(polygon);
      } else if (item.type === "booth") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const booth = createSvgElement("polygon", {
          class: "decor booth",
          points: pointsToString([
            [x, y + this.tileHeight * 0.2],
            [x + 14, y + this.tileHeight * 0.45],
            [x, y + this.tileHeight * 0.7],
            [x - 14, y + this.tileHeight * 0.45],
          ]),
        });
        this.layers.decor.appendChild(booth);
        nodes.push(booth);
      } else if (item.type === "flare") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const base = createSvgElement("circle", {
          class: "decor flare-base",
          cx: x,
          cy: y + 6,
          r: 4,
        });
        const flame = createSvgElement("ellipse", {
          class: "decor flare",
          cx: 0,
          cy: 0,
          rx: 6,
          ry: 20,
        });
        flame.setAttribute("transform", `translate(${x} ${y - 14})`);
        this.layers.decor.appendChild(base);
        this.layers.decor.appendChild(flame);
        nodes.push(base, flame);
        this.decorDynamic.flare = { element: flame, baseX: x, baseY: y - 14 };
      } else if (item.type === "dock") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const polygon = createSvgElement("polygon", {
          class: "decor dock",
          points: pointsToString([
            [x, y],
            [x + 22, y + 14],
            [x - 6, y + 30],
            [x - 24, y + 14],
          ]),
        });
        this.layers.decor.appendChild(polygon);
        nodes.push(polygon);
      } else if (item.type === "barn") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const barn = createSvgElement("polygon", {
          class: "decor barn",
          points: pointsToString([
            [x, y + this.tileHeight * 0.3],
            [x + 20, y + this.tileHeight * 0.55],
            [x, y + this.tileHeight * 0.82],
            [x - 20, y + this.tileHeight * 0.55],
          ]),
        });
        this.layers.decor.appendChild(barn);
        nodes.push(barn);
      } else if (item.type === "recording") {
        const { x, y } = this._tileToScreen(item.x, item.y);
        const note = createSvgElement("rect", {
          class: "decor recording",
          x: x - 22,
          y: y - 6,
          width: 44,
          height: 16,
          rx: 2,
        });
        this.layers.decor.appendChild(note);
        nodes.push(note);
      }
    }
    return nodes;
  }

  _createPipelineNodes() {
    const nodes = new Map();
    for (const pipeline of this.pipelineDefs) {
      const pathData = this._pipelinePath(pipeline.path);
      const base = createSvgElement("path", {
        class: "pipeline-base",
        d: pathData,
        stroke: toHex(pipeline.color),
      });
      const glow = createSvgElement("path", {
        class: "pipeline-glow",
        d: pathData,
        stroke: this.palettes[this.paletteIndex].pipeGlow,
        "stroke-dasharray": "18 22",
      });
      this.layers.pipelines.appendChild(base);
      this.layers.pipelineGlow.appendChild(glow);
      nodes.set(pipeline.id, { group: base, base, glow });
    }
    return nodes;
  }

  _createUnitNodes() {
    const nodes = new Map();
    for (const unit of this.unitDefs) {
      const center = this._tileToScreen(unit.tileX + unit.width / 2, unit.tileY + unit.height / 2);
      const group = createSvgElement("g", {
        class: "unit",
        "data-unit": unit.id,
        transform: `translate(${center.x} ${center.y})`,
      });

      const highlight = createSvgElement("polygon", {
        class: "unit-highlight",
        points: pointsToString(this._footprintPoints(unit, true)),
      });
      const body = createSvgElement("polygon", {
        class: "unit-body",
        points: pointsToString(this._unitBodyPoints(unit)),
      });
      const accent = createSvgElement("polygon", {
        class: `unit-accent ${unit.style}`,
        points: pointsToString(this._unitAccentPoints(unit)),
      });

      const gauges = createSvgElement("g", {
        class: "unit-gauges",
        transform: `translate(-28 ${this.tileHeight * 0.5})`,
      });
      const loadBar = createSvgElement("rect", {
        class: "gauge-load",
        x: 0,
        y: 0,
        width: 0,
        height: 4,
        rx: 2,
      });
      const healthBar = createSvgElement("rect", {
        class: "gauge-health",
        x: 0,
        y: 6,
        width: 0,
        height: 4,
        rx: 2,
      });
      const gaugeBg = createSvgElement("rect", {
        class: "gauge-bg",
        x: 0,
        y: 0,
        width: 52,
        height: 10,
        rx: 3,
      });
      gauges.appendChild(gaugeBg);
      gauges.appendChild(loadBar);
      gauges.appendChild(healthBar);

      const label = createSvgElement("text", {
        class: "unit-label",
        "text-anchor": "middle",
        transform: `translate(0 ${this.tileHeight * 0.85})`,
      });
      label.textContent = unit.name;

      group.appendChild(highlight);
      group.appendChild(body);
      group.appendChild(accent);
      group.appendChild(gauges);
      group.appendChild(label);
      this.layers.units.appendChild(group);

      nodes.set(unit.id, {
        group,
        highlight,
        body,
        accent,
        loadBar,
        healthBar,
        barWidth: 52,
        baseOpacity: 0.35,
      });
    }
    return nodes;
  }

  _createPointerNode() {
    const pointer = createSvgElement("polygon", { class: "pointer" });
    this.layers.overlay.appendChild(pointer);
    return pointer;
  }

  _createTankNodes() {
    const nodes = new Map();
    const tanks = [
      { product: "gasoline", x: 13.6, y: 5.6 },
      { product: "diesel", x: 13.2, y: 6.6 },
      { product: "jet", x: 14.0, y: 6.2 },
    ];
    tanks.forEach((tank) => {
      const { x, y } = this._tileToScreen(tank.x, tank.y);
      const base = createSvgElement("polygon", {
        class: "tank-base",
        points: pointsToString([
          [x, y],
          [x + 18, y + 12],
          [x, y + 24],
          [x - 18, y + 12],
        ]),
      });
      const fill = createSvgElement("rect", {
        class: "tank-fill",
        x: x - 12,
        y: y + 8,
        width: 24,
        height: 0,
      });
      this.layers.decor.appendChild(base);
      this.layers.decor.appendChild(fill);
      nodes.set(tank.product, {
        base,
        fill,
        maxHeight: 14,
        baseY: y + 8,
      });
    });
    return nodes;
  }

  _applyPalette() {
    const palette = this.palettes[this.paletteIndex] || this.palettes[0];
    this.tileNodes.forEach((tile) => {
      const color = palette[tile.baseType] || palette.pavement;
      tile.base.setAttribute("fill", color);
      tile.base.setAttribute("stroke", palette.outline);
      const highlightColor =
        palette[`${tile.baseType}Highlight`] || lightenColor(color, tile.baseType === "water" ? 0.35 : 0.25);
      const shadowColor =
        palette[`${tile.baseType}Shadow`] || darkenColor(color, tile.baseType === "water" ? 0.25 : 0.35);
      const highlightAlpha = tile.baseType === "water" ? 0.55 : 0.4;
      const shadowAlpha = tile.baseType === "water" ? 0.4 : 0.55;
      tile.highlight.setAttribute("fill", applyAlpha(highlightColor, highlightAlpha));
      tile.shadow.setAttribute("fill", applyAlpha(shadowColor, shadowAlpha));

      if (!tile.overlay) {
        return;
      }
      if (tile.overlay.type === "walkway") {
        const overlayColor = palette.walkway || lightenColor(color, 0.15);
        tile.overlay.node.setAttribute("fill", overlayColor);
      } else if (tile.overlay.type === "road") {
        const surfaceColor = palette.road || darkenColor(color, 0.3);
        if (tile.overlay.parts && tile.overlay.parts.length) {
          tile.overlay.parts.forEach((part) => part.setAttribute("fill", surfaceColor));
        } else if (tile.overlay.node) {
          tile.overlay.node.setAttribute("fill", surfaceColor);
        }
        const lineColor = palette.roadLine || lightenColor(surfaceColor, 0.55);
        if (tile.overlay.lines && tile.overlay.lines.length) {
          tile.overlay.lines.forEach((line) => line.setAttribute("stroke", lineColor));
        } else if (tile.overlay.line) {
          tile.overlay.line.setAttribute("stroke", lineColor);
        }
      } else if (tile.overlay.type === "water") {
        const rippleColor = palette.waterHighlight || lightenColor(color, 0.45);
        tile.overlay.ripples.forEach((ripple, index) => {
          ripple.setAttribute("stroke", applyAlpha(rippleColor, index === 0 ? 0.7 : 0.45));
        });
      } else if (tile.overlay.type === "field") {
        const bright = lightenColor(color, 0.28);
        const dark = darkenColor(color, 0.15);
        tile.overlay.stripes.forEach((stripe, index) => {
          const mix = index % 2 === 0 ? bright : dark;
          stripe.setAttribute("fill", applyAlpha(mix, 0.75));
        });
      }
    });
    this.gridNodes.forEach((grid) => {
      grid.setAttribute("stroke", palette.grid);
    });
    this.decorNodes.forEach((node) => {
      if (node.classList?.contains("recording")) {
        node.setAttribute("fill", "rgba(255,255,255,0.18)");
      }
    });
    for (const [id, nodes] of this.pipelineNodes.entries()) {
      const config = this.pipelineLookup.get(id);
      nodes.base.setAttribute("stroke", palette.pipeBase);
      nodes.glow.setAttribute("stroke", palette.pipeGlow);
      if (config?.color) {
        nodes.base.setAttribute("stroke", toHex(config.color));
      }
    }
    for (const unit of this.unitDefs) {
      const node = this.unitNodes.get(unit.id);
      if (!node) continue;
      node.body.setAttribute("fill", toHex(unit.color));
      node.accent.setAttribute("fill", toHex(unit.accent));
      node.highlight.setAttribute("stroke", "rgba(255,244,180,0.4)");
      node.highlight.setAttribute("stroke-opacity", node.baseOpacity);
      const labelBg = palette.labelBg;
      node.group.querySelector(".unit-label").setAttribute("fill", "#f1f5ff");
      const gaugeBg = node.group.querySelector(".gauge-bg");
      if (gaugeBg) {
        gaugeBg.setAttribute("fill", labelBg);
      }
      node.loadBar.setAttribute("fill", "#6ed16f");
      node.healthBar.setAttribute("fill", "#66b0ff");
    }
  }

  _calculateMapBounds() {
    const corners = [
      this._isoToScreen(0, 0),
      this._isoToScreen(this.mapCols, 0),
      this._isoToScreen(0, this.mapRows),
      this._isoToScreen(this.mapCols, this.mapRows),
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }

  _fitCameraToView({ preserveZoom = false } = {}) {
    if (!this.mapBounds) {
      return;
    }
    const marginX = 160;
    const marginY = 140;
    const availableWidth = this.viewWidth - marginX;
    const availableHeight = this.viewHeight - marginY;
    if (!preserveZoom) {
      const scaleX = availableWidth / Math.max(1, this.mapBounds.width);
      const scaleY = availableHeight / Math.max(1, this.mapBounds.height);
      const targetZoom = clamp(Math.min(scaleX, scaleY), this.camera.minZoom, this.camera.maxZoom);
      this.camera.zoom = targetZoom;
    }
    const offsetX = this.viewWidth / 2 - this.mapBounds.centerX * this.camera.zoom;
    const offsetY = this.viewHeight / 2 - this.mapBounds.centerY * this.camera.zoom;
    this.camera.offsetX = offsetX;
    this.camera.offsetY = offsetY;
    this._clampCamera();
    this._updateCameraTransform();
  }

  _updateCameraTransform() {
    const { zoom, offsetX, offsetY } = this.camera;
    const matrix = `${zoom.toFixed(4)} 0 0 ${zoom.toFixed(4)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)}`;
    this.worldGroup.setAttribute("transform", `matrix(${matrix})`);
  }

  _clampCamera() {
    if (!this.mapBounds) {
      return;
    }
    const { minX, maxX, minY, maxY } = this.mapBounds;
    const { zoom } = this.camera;
    let { offsetX, offsetY } = this.camera;
    const margin = 48;
    const width = this.viewWidth;
    const height = this.viewHeight;
    const mapWidth = (maxX - minX) * zoom;
    const mapHeight = (maxY - minY) * zoom;
    const effectiveMarginX = Math.min(margin, Math.max((width - mapWidth) / 2, 0));
    const effectiveMarginY = Math.min(margin, Math.max((height - mapHeight) / 2, 0));

    const minOffsetX = effectiveMarginX - minX * zoom;
    const maxOffsetX = width - effectiveMarginX - maxX * zoom;
    if (minOffsetX <= maxOffsetX) {
      offsetX = clamp(offsetX, minOffsetX, maxOffsetX);
    } else {
      offsetX = (minOffsetX + maxOffsetX) / 2;
    }

    const minOffsetY = effectiveMarginY - minY * zoom;
    const maxOffsetY = height - effectiveMarginY - maxY * zoom;
    if (minOffsetY <= maxOffsetY) {
      offsetY = clamp(offsetY, minOffsetY, maxOffsetY);
    } else {
      offsetY = (minOffsetY + maxOffsetY) / 2;
    }

    this.camera.offsetX = offsetX;
    this.camera.offsetY = offsetY;
  }

  beginPan(screenX, screenY) {
    this.panSession = {
      startX: screenX,
      startY: screenY,
      baseOffsetX: this.camera.offsetX,
      baseOffsetY: this.camera.offsetY,
    };
    this.camera.userControlled = true;
  }

  panTo(screenX, screenY) {
    if (!this.panSession) {
      return;
    }
    const dx = screenX - this.panSession.startX;
    const dy = screenY - this.panSession.startY;
    this.camera.offsetX = this.panSession.baseOffsetX + dx;
    this.camera.offsetY = this.panSession.baseOffsetY + dy;
    this._clampCamera();
    this._updateCameraTransform();
  }

  endPan() {
    this.panSession = null;
  }

  isPanning() {
    return Boolean(this.panSession);
  }

  zoomAt(screenX, screenY, deltaY) {
    const zoomFactor = Math.exp(-deltaY * 0.0012);
    const nextZoom = clamp(this.camera.zoom * zoomFactor, this.camera.minZoom, this.camera.maxZoom);
    if (Math.abs(nextZoom - this.camera.zoom) < 0.0001) {
      return;
    }
    const worldX = (screenX - this.camera.offsetX) / this.camera.zoom;
    const worldY = (screenY - this.camera.offsetY) / this.camera.zoom;
    this.camera.zoom = nextZoom;
    this.camera.offsetX = screenX - worldX * nextZoom;
    this.camera.offsetY = screenY - worldY * nextZoom;
    this.camera.userControlled = true;
    this._clampCamera();
    this._updateCameraTransform();
  }

  focusOnUnit(unitId, { onlyIfVisible = true } = {}) {
    if (!unitId) {
      return;
    }
    const unit = this.unitDefs.find((entry) => entry.id === unitId);
    if (!unit) {
      return;
    }
    const center = this._tileToScreen(unit.tileX + unit.width / 2, unit.tileY + unit.height / 2);
    const screen = this._worldToScreen(center.x, center.y);
    const margin = 120;
    if (
      onlyIfVisible &&
      screen.x >= margin &&
      screen.x <= this.viewWidth - margin &&
      screen.y >= margin &&
      screen.y <= this.viewHeight - margin
    ) {
      return;
    }
    this._moveCameraTo(center.x, center.y);
    this.camera.userControlled = true;
  }

  _worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.camera.zoom + this.camera.offsetX,
      y: worldY * this.camera.zoom + this.camera.offsetY,
    };
  }

  _moveCameraTo(worldX, worldY) {
    this.camera.offsetX = this.viewWidth / 2 - worldX * this.camera.zoom;
    this.camera.offsetY = this.viewHeight / 2 - worldY * this.camera.zoom;
    this._clampCamera();
    this._updateCameraTransform();
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
        const current = tiles[y][x];
        if (
          y === 5 &&
          x >= 2 &&
          x <= this.mapCols - 2 &&
          current !== "water" &&
          current !== "shore"
        ) {
          tiles[y][x] = current?.startsWith("road") ? "road-cross" : "road-ew";
        }
        if (
          x === 7 &&
          y >= 2 &&
          y <= this.mapRows - 2 &&
          current !== "water" &&
          current !== "shore"
        ) {
          tiles[y][x] = tiles[y][x]?.startsWith("road") ? "road-cross" : "road-ns";
        }
        if (
          (x === 6 || x === 8 || (y === 6 && (x === 5 || x === 9))) &&
          tiles[y][x] !== "water" &&
          tiles[y][x] !== "shore" &&
          !tiles[y][x]?.startsWith("road")
        ) {
          tiles[y][x] = "walkway";
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

  _tileToScreen(tileX, tileY) {
    return this._isoToScreen(tileX, tileY);
  }

  _isoToScreen(worldX, worldY) {
    const screenX = this.originX + (worldX - worldY) * (this.tileWidth / 2);
    const screenY = this.originY + (worldX + worldY) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }

  _tileDiamondPoints(tileX, tileY) {
    const { x, y } = this._tileToScreen(tileX, tileY);
    return [
      [x, y],
      [x + this.tileWidth / 2, y + this.tileHeight / 2],
      [x, y + this.tileHeight],
      [x - this.tileWidth / 2, y + this.tileHeight / 2],
    ];
  }

  _footprintPoints(unit, relative = false) {
    const corners = [
      this._isoToScreen(unit.tileX, unit.tileY),
      this._isoToScreen(unit.tileX + unit.width, unit.tileY),
      this._isoToScreen(unit.tileX + unit.width, unit.tileY + unit.height),
      this._isoToScreen(unit.tileX, unit.tileY + unit.height),
    ];
    if (!relative) {
      return corners.map((point) => [point.x, point.y]);
    }
    const center = this._tileToScreen(unit.tileX + unit.width / 2, unit.tileY + unit.height / 2);
    return corners.map((point) => [point.x - center.x, point.y - center.y]);
  }

  _unitBodyPoints(unit) {
    const width = this.tileWidth * Math.max(0.55, unit.width * 0.45);
    const height = this.tileHeight * Math.max(0.6, unit.height * 0.5);
    return [
      [0, -height / 2],
      [width / 2, 0],
      [0, height / 2],
      [-width / 2, 0],
    ];
  }

  _unitAccentPoints(unit) {
    switch (unit.style) {
      case "towers":
        return [
          [-(this.tileWidth * 0.1), -this.tileHeight * 0.35],
          [-(this.tileWidth * 0.02), -this.tileHeight * 0.2],
          [-(this.tileWidth * 0.1), -this.tileHeight * 0.05],
          [-(this.tileWidth * 0.18), -this.tileHeight * 0.2],
        ];
      case "reactor":
        return [
          [0, -this.tileHeight * 0.3],
          [this.tileWidth * 0.18, -this.tileHeight * 0.12],
          [0, this.tileHeight * 0.05],
          [-this.tileWidth * 0.18, -this.tileHeight * 0.12],
        ];
      case "support":
        return [
          [this.tileWidth * 0.22, -this.tileHeight * 0.15],
          [this.tileWidth * 0.22, this.tileHeight * 0.12],
          [-this.tileWidth * 0.22, this.tileHeight * 0.12],
          [-this.tileWidth * 0.22, -this.tileHeight * 0.15],
        ];
      default:
        return [
          [this.tileWidth * 0.18, -this.tileHeight * 0.18],
          [this.tileWidth * 0.24, 0],
          [this.tileWidth * 0.18, this.tileHeight * 0.18],
          [-this.tileWidth * 0.18, this.tileHeight * 0.18],
          [-this.tileWidth * 0.24, 0],
          [-this.tileWidth * 0.18, -this.tileHeight * 0.18],
        ];
    }
  }

  _pipelinePath(points) {
    return points
      .map((point, index) => {
        const { x, y } = this._tileToScreen(point.x, point.y);
        const prefix = index === 0 ? "M" : "L";
        return `${prefix}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  _diamondPoints(worldX, worldY) {
    const { x, y } = this._isoToScreen(worldX, worldY);
    return [
      [x, y],
      [x + this.tileWidth / 2, y + this.tileHeight / 2],
      [x, y + this.tileHeight],
      [x - this.tileWidth / 2, y + this.tileHeight / 2],
    ];
  }
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    element.setAttribute(key, value);
  });
  return element;
}

function pointsToString(points) {
  return points.map((point) => `${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ");
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

function mixColor(baseHex, mixHex, amount) {
  const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
  const a = clamp01(amount);
  const base = baseHex.startsWith("#") ? baseHex.slice(1) : baseHex;
  const mix = mixHex.startsWith("#") ? mixHex.slice(1) : mixHex;
  const baseR = parseInt(base.slice(0, 2), 16);
  const baseG = parseInt(base.slice(2, 4), 16);
  const baseB = parseInt(base.slice(4, 6), 16);
  const mixR = parseInt(mix.slice(0, 2), 16);
  const mixG = parseInt(mix.slice(2, 4), 16);
  const mixB = parseInt(mix.slice(4, 6), 16);
  const r = Math.round(baseR + (mixR - baseR) * a);
  const g = Math.round(baseG + (mixG - baseG) * a);
  const b = Math.round(baseB + (mixB - baseB) * a);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function lightenColor(baseHex, amount) {
  return mixColor(baseHex, "#ffffff", amount);
}

function darkenColor(baseHex, amount) {
  return mixColor(baseHex, "#000000", amount);
}

const renderer = new TileRenderer(sceneContainer, simulation, unitConfigs, pipelineConfigs);
const surface = renderer.getSurface();

const unitPulseEntries = new Map();
const unitModeLabels = new Map();
let selectedUnitId = null;
let activePreset = "auto";
let lastPulseRefresh = 0;
let gridVisible = true;
let flowOverlayVisible = true;
let activeMenu = null;
let panPointerId = null;
let panMoved = false;
let panStart = { x: 0, y: 0 };
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
setGridVisibility(gridVisible);
setFlowVisibility(flowOverlayVisible);
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

surface.addEventListener("mousemove", (event) => {
  if (typeof renderer.isPanning === "function" && renderer.isPanning()) {
    return;
  }
  const rect = surface.getBoundingClientRect();
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

surface.addEventListener("mouseleave", () => {
  renderer.setPointer(0, 0, false);
  renderer.setHoverUnit(null);
  if (selectedUnitId) {
    highlightPipelinesForUnit(selectedUnitId);
  } else {
    clearPipelineHighlight();
  }
});

surface.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  const rect = surface.getBoundingClientRect();
  const pointerX = (event.clientX - rect.left) * renderer.deviceScaleX;
  const pointerY = (event.clientY - rect.top) * renderer.deviceScaleY;
  panPointerId = event.pointerId;
  panStart = { x: pointerX, y: pointerY };
  panMoved = false;
  surface.setPointerCapture(event.pointerId);
});

surface.addEventListener("pointermove", (event) => {
  if (panPointerId !== event.pointerId) {
    return;
  }
  const rect = surface.getBoundingClientRect();
  const pointerX = (event.clientX - rect.left) * renderer.deviceScaleX;
  const pointerY = (event.clientY - rect.top) * renderer.deviceScaleY;
  if (!renderer.isPanning()) {
    const dx = pointerX - panStart.x;
    const dy = pointerY - panStart.y;
    if (Math.hypot(dx, dy) > 6) {
      renderer.beginPan(panStart.x, panStart.y);
      renderer.setPointer(0, 0, false);
      if (mapViewport) {
        mapViewport.classList.add("panning");
      }
    } else {
      return;
    }
  }
  renderer.panTo(pointerX, pointerY);
  panMoved = true;
});

const endPan = (event) => {
  if (panPointerId !== event.pointerId) {
    return;
  }
  if (renderer.isPanning()) {
    renderer.endPan();
  }
  if (mapViewport) {
    mapViewport.classList.remove("panning");
  }
  surface.releasePointerCapture(event.pointerId);
  panPointerId = null;
};

surface.addEventListener("pointerup", (event) => {
  endPan(event);
});

surface.addEventListener("pointercancel", (event) => {
  endPan(event);
});

surface.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) * renderer.deviceScaleX;
    const pointerY = (event.clientY - rect.top) * renderer.deviceScaleY;
    const panIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.75;
    if (panIntent) {
      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      const DOM_DELTA_LINE = typeof WheelEvent !== "undefined" ? WheelEvent.DOM_DELTA_LINE : 1;
      const DOM_DELTA_PAGE = typeof WheelEvent !== "undefined" ? WheelEvent.DOM_DELTA_PAGE : 2;
      if (event.deltaMode === DOM_DELTA_LINE) {
        deltaX *= 32;
        deltaY *= 32;
      } else if (event.deltaMode === DOM_DELTA_PAGE) {
        deltaX *= surface.clientWidth || 1;
        deltaY *= surface.clientHeight || 1;
      }
      deltaX = -deltaX * renderer.deviceScaleX;
      deltaY = -deltaY * renderer.deviceScaleY;
      renderer.nudgeCamera(deltaX, deltaY);
    } else {
      renderer.zoomAt(pointerX, pointerY, event.deltaY);
    }
  },
  { passive: false }
);

surface.addEventListener("dblclick", (event) => {
  event.preventDefault();
  renderer.resetView();
});

surface.addEventListener("click", (event) => {
  if (event.detail > 1) {
    return;
  }
  if (panMoved) {
    panMoved = false;
    return;
  }
  const rect = surface.getBoundingClientRect();
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
    "Drag the refinery map to pan and use the mouse wheel to zoom in on the SimCity-style detail work.",
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

