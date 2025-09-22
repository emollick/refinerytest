import * as THREE from "https://unpkg.com/three@0.152.2/build/three.module.js";
import { RefinerySimulation } from "./simulation.js";
import { UIController } from "./ui.js";

const mapViewport = document.getElementById("map-viewport");
const sceneContainer = document.getElementById("scene-container");
const menuBar = document.getElementById("menu-bar");
const menuToggle = document.getElementById("menu-toggle");
const scenarioMenu = document.getElementById("scenario-menu");
const unitMenu = document.getElementById("unit-menu");
const importInput = document.getElementById("session-import-input");
const unitPulseList = document.getElementById("unit-pulse");
const gridToggleButton = menuBar?.querySelector('[data-action="view-toggle-grid"]');
const flowToggleButton = menuBar?.querySelector('[data-action="view-toggle-flow"]');

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch (error) {
    return false;
  }
}

function showWebglFallback(message) {
  if (!mapViewport) return;
  const overlay = document.createElement("div");
  overlay.className = "webgl-warning";
  overlay.innerHTML =
    "<strong>WebGL unavailable.</strong><br/>This simulation requires WebGL. " +
    "Please use a modern browser or enable hardware acceleration." +
    (message ? `<br/><small>${message}</small>` : "");
  mapViewport.innerHTML = "";
  mapViewport.appendChild(overlay);
}

if (!isWebGLAvailable()) {
  showWebglFallback();
  throw new Error("WebGL not supported in this environment.");
}

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneContainer.appendChild(renderer.domElement);
renderer.domElement.classList.add("scene-canvas");

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const BASE_VIEW = 110;
camera.position.set(120, 145, 120);
const cameraTarget = new THREE.Vector3(0, 0, 0);
camera.lookAt(cameraTarget);
const cameraOffset = camera.position.clone().sub(cameraTarget);
let viewHeight = BASE_VIEW;

const ambient = new THREE.AmbientLight(0xffffff, 0.92);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xfff2c6, 0.45);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.28);
scene.add(fillLight);

const lightingPresets = [
  {
    name: "Day Shift",
    background: 0x08101d,
    ambient: 0.92,
    key: { color: 0xfff2c6, intensity: 0.45, position: [160, 220, 80] },
    fill: { color: 0x88aaff, intensity: 0.28, position: [-140, 120, -160] },
  },
  {
    name: "Dusk Watch",
    background: 0x101a2c,
    ambient: 0.72,
    key: { color: 0xffb05a, intensity: 0.6, position: [130, 210, 60] },
    fill: { color: 0x425a82, intensity: 0.34, position: [-120, 150, -120] },
  },
  {
    name: "Night Ops",
    background: 0x030b14,
    ambient: 0.56,
    key: { color: 0xf4f0d0, intensity: 0.44, position: [110, 190, 40] },
    fill: { color: 0x6a7fb6, intensity: 0.26, position: [-160, 120, -140] },
  },
];
let activeLightingIndex = 0;
applyLightingPreset(activeLightingIndex);

const simulation = new RefinerySimulation();
const ui = new UIController(simulation);
if (typeof ui.setModeBadge === "function") {
  ui.setModeBadge("AUTO");
}

const MAP_COLS = 16;
const MAP_ROWS = 12;
const TILE_SIZE = 6;
const MAP_WIDTH = MAP_COLS * TILE_SIZE;
const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;
const ORIGIN_X = -MAP_WIDTH / 2 + TILE_SIZE / 2;
const ORIGIN_Z = -MAP_HEIGHT / 2 + TILE_SIZE / 2;

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const panStart = new THREE.Vector2();
let isPanning = false;
let activePanPointer = null;

const clickableMeshes = [];
const unitVisuals = new Map();
const pipelineVisuals = new Map();
const waterLayers = [];
let dockVisual = null;
let flareVisual = null;
const alertTextures = {};
let gridOverlay = null;
let gridVisible = true;
let flowOverlayVisible = true;
let selectedUnitId = null;
let activeMenu = null;

const gaugeColors = {
  good: new THREE.Color(0x6ae28a),
  warn: new THREE.Color(0xf2d06b),
  bad: new THREE.Color(0xff6b5a),
};
const unitPulseEntries = new Map();
const unitModeLabels = new Map();
let lastPulseRefresh = 0;

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

buildTerrain();
buildUnits();
buildPipelines();
buildDecor();
populateScenarioMenu();
populateUnitMenu();

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
    crude: 60,
    focus: 0.42,
    maintenance: 0.82,
    safety: 0.72,
    environment: 0.55,
    log: "Emergency shutdown drill initiated.",
  },
};

let activePreset = "auto";

const toolbarPresetButtons = document.querySelectorAll("[data-preset]");
const toolbarUnitButtons = document.querySelectorAll("[data-unit-target]");
const toolbarScenarioButtons = document.querySelectorAll("[data-scenario]");

toolbarPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    applyPreset(preset)
