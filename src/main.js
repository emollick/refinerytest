import * as THREE from "https://unpkg.com/three@0.152.2/build/three.module.js";
import { RefinerySimulation } from "./simulation.js";
import { UIController } from "./ui.js";

const mapViewport = document.getElementById("map-viewport");
const sceneContainer = document.getElementById("scene-container");

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneContainer.appendChild(renderer.domElement);
renderer.domElement.classList.add("scene-canvas");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08101d);

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
keyLight.position.set(160, 220, 80);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.28);
fillLight.position.set(-140, 120, -160);
scene.add(fillLight);

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
const gaugeColors = {
  good: new THREE.Color(0x6ae28a),
  warn: new THREE.Color(0xf2d06b),
  bad: new THREE.Color(0xff6b5a),
};

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

if (ui.elements?.reset) {
  ui.elements.reset.addEventListener("click", () => {
    setSelectedUnit(null);
    ui.selectUnit(null);
    updateUnitButtons(null);
    applyPreset("auto", { silent: true });
    updatePresetButtons("auto");
    if (typeof ui.setModeBadge === "function") {
      ui.setModeBadge("AUTO");
    }
    updateScenarioButtons(simulation.activeScenarioKey);
  });
}

applyPreset("auto", { silent: true });
updatePresetButtons("auto");
updateScenarioButtons(simulation.activeScenarioKey);
updateUnitButtons(null);
ui.refreshControls();

renderer.domElement.addEventListener("pointerdown", handlePointerDown);
renderer.domElement.addEventListener("pointermove", handlePointerMove);
renderer.domElement.addEventListener("pointerup", handlePointerUp);
renderer.domElement.addEventListener("pointerleave", handlePointerUp);
renderer.domElement.addEventListener("pointercancel", handlePointerUp);
renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(() => resizeRenderer());
  resizeObserver.observe(mapViewport);
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  elapsed += delta;

  simulation.update(delta);
  ui.update();

  updateUnits(elapsed);
  updatePipelines(simulation.getFlows(), elapsed);
  updateEnvironment(elapsed);

  renderer.render(scene, camera);
}

animate();

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
}

function updateScenarioButtons(key) {
  toolbarScenarioButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === key);
  });
}

function resizeRenderer() {
  const rect = mapViewport.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(240, rect.height);
  renderer.setSize(width, height, false);
  updateCamera(width / height);
}

function updateCamera(aspect) {
  camera.left = -viewHeight * aspect;
  camera.right = viewHeight * aspect;
  camera.top = viewHeight;
  camera.bottom = -viewHeight;
  camera.updateProjectionMatrix();
  camera.position.copy(cameraTarget).add(cameraOffset);
  camera.lookAt(cameraTarget);
}

function buildTerrain() {
  createGroundTiles();
  createWaterArea(11, 0, 5, 6);
  createWaterArea(12, 6, 4, 3);
  createPavedStrip(0, 8.5, 16, 1.2, 0x343b3d, 0.12);
  createPavedStrip(0, 10.5, 16, 1.2, 0x2c3234, 0.12);
  createPavedStrip(5.5, 2, 5, 0.6, 0x474f52, 0.1);
  createPavedStrip(5.5, 6.8, 5, 0.6, 0x474f52, 0.1);
  createGridOverlay();
}

function createGroundTiles() {
  const colors = [0x21302a, 0x1b2a24];
  for (let y = 0; y < MAP_ROWS; y += 1) {
    for (let x = 0; x < MAP_COLS; x += 1) {
      const color = colors[(x + y) % 2];
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE),
        new THREE.MeshBasicMaterial({ color })
      );
      tile.rotation.x = -Math.PI / 2;
      const position = tileToWorld(x, y);
      tile.position.set(position.x, 0, position.z);
      scene.add(tile);
    }
  }
}

function createWaterArea(tileX, tileY, width, height) {
  const geometry = new THREE.BoxGeometry(width * TILE_SIZE, 0.3, height * TILE_SIZE);
  const material = new THREE.MeshPhongMaterial({
    color: 0x1c3c62,
    transparent: true,
    opacity: 0.86,
    shininess: 80,
    specular: 0x396da0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const center = tileToWorld(tileX + (width - 1) / 2, tileY + (height - 1) / 2);
  mesh.position.set(center.x, -0.16, center.z);
  scene.add(mesh);
  waterLayers.push({ mesh, material, baseColor: new THREE.Color(0x1c3c62) });
}

function createPavedStrip(tileX, tileY, width, height, color, elevation = 0.08) {
  const geometry = new THREE.BoxGeometry(width * TILE_SIZE, elevation * 2, height * TILE_SIZE);
  const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  const center = tileToWorld(tileX + (width - 1) / 2, tileY + (height - 1) / 2);
  mesh.position.set(center.x, elevation, center.z);
  scene.add(mesh);
}

function createGridOverlay() {
  const positions = [];
  const startX = -MAP_WIDTH / 2;
  const startZ = -MAP_HEIGHT / 2;
  for (let x = 0; x <= MAP_COLS; x += 1) {
    const worldX = startX + x * TILE_SIZE;
    positions.push(worldX, 0.03, startZ, worldX, 0.03, startZ + MAP_HEIGHT);
  }
  for (let y = 0; y <= MAP_ROWS; y += 1) {
    const worldZ = startZ + y * TILE_SIZE;
    positions.push(startX, 0.03, worldZ, startX + MAP_WIDTH, 0.03, worldZ);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x0c141d, transparent: true, opacity: 0.35 });
  const grid = new THREE.LineSegments(geometry, material);
  scene.add(grid);
}

function buildUnits() {
  unitConfigs.forEach((config, index) => {
    const visual = createUnitVisual(config, index * 0.6);
    unitVisuals.set(config.id, visual);
  });
}

function buildPipelines() {
  pipelineConfigs.forEach((config) => {
    const visual = createPipelineVisual(config);
    pipelineVisuals.set(config.id, visual);
  });
}

function buildDecor() {
  createTankFarm();
  dockVisual = createDock();
  flareVisual = createFlare(tileToWorld(13.5, 1));
  createLightTowers();
}

function createUnitVisual(config, phase = 0) {
  const group = new THREE.Group();
  const center = tileToWorld(
    config.tileX + (config.width - 1) / 2,
    config.tileY + (config.height - 1) / 2
  );
  group.position.set(center.x, 0, center.z);
  group.userData.unitId = config.id;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: config.color,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(
      config.width * TILE_SIZE - 2.2,
      2.6,
      config.height * TILE_SIZE - 2.2
    ),
    baseMaterial
  );
  body.position.y = 1.3;
  body.userData.unitId = config.id;
  group.add(body);
  clickableMeshes.push(body);

  const highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(config.width * TILE_SIZE + 3, config.height * TILE_SIZE + 3),
    new THREE.MeshBasicMaterial({ color: 0xfff2c9, transparent: true, opacity: 0.18, depthWrite: false })
  );
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.12;
  group.add(highlight);

  const accentMaterials = [];
  if (config.style === "towers") {
    for (let i = 0; i < 2; i += 1) {
      const towerMaterial = new THREE.MeshStandardMaterial({
        color: config.accent,
        roughness: 0.6,
        metalness: 0.2,
        flatShading: true,
      });
      const radius = 1.4 + i * 0.2;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 5.4 + i, 12), towerMaterial);
      tower.position.set((i === 0 ? -1 : 1) * TILE_SIZE * 0.6, 3.2 + i * 0.1, i === 0 ? 0 : TILE_SIZE * 0.7);
      tower.rotation.y = Math.PI / 4;
      tower.userData.unitId = config.id;
      accentMaterials.push(towerMaterial);
      group.add(tower);
      clickableMeshes.push(tower);
    }
  } else if (config.style === "reactor") {
    const plinthMaterial = new THREE.MeshStandardMaterial({
      color: config.accentAlt,
      roughness: 0.7,
      metalness: 0.15,
      flatShading: true,
    });
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(config.width * TILE_SIZE - 3, 1.2, config.height * TILE_SIZE - 3),
      plinthMaterial
    );
    plinth.position.y = 0.6;
    plinth.userData.unitId = config.id;
    group.add(plinth);
    clickableMeshes.push(plinth);
    accentMaterials.push(plinthMaterial);

    const reactorMaterial = new THREE.MeshStandardMaterial({
      color: config.accent,
      roughness: 0.5,
      metalness: 0.25,
      flatShading: true,
    });
    const reactor = new THREE.Mesh(new THREE.BoxGeometry(6, 3.6, 6), reactorMaterial);
    reactor.position.set(0, 3, 0);
    reactor.userData.unitId = config.id;
    group.add(reactor);
    clickableMeshes.push(reactor);
    accentMaterials.push(reactorMaterial);

    const stackMaterial = new THREE.MeshStandardMaterial({
      color: config.accentAlt,
      roughness: 0.4,
      metalness: 0.3,
      flatShading: true,
    });
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 5, 10), stackMaterial);
    stack.position.set(TILE_SIZE * 0.8, 4.2, -TILE_SIZE * 0.2);
    stack.userData.unitId = config.id;
    group.add(stack);
    clickableMeshes.push(stack);
    accentMaterials.push(stackMaterial);
  } else if (config.style === "support") {
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: config.accent,
      roughness: 0.65,
      metalness: 0.18,
      flatShading: true,
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 4), frameMaterial);
    frame.position.set(0, 2.2, 0);
    frame.userData.unitId = config.id;
    group.add(frame);
    clickableMeshes.push(frame);
    accentMaterials.push(frameMaterial);

    const ventMaterial = new THREE.MeshStandardMaterial({
      color: config.accentAlt,
      roughness: 0.45,
      metalness: 0.15,
      flatShading: true,
    });
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 3.2, 10, 1, true), ventMaterial);
    vent.rotation.x = Math.PI / 2;
    vent.position.set(0, 3.4, TILE_SIZE * 0.4);
    vent.userData.unitId = config.id;
    group.add(vent);
    clickableMeshes.push(vent);
    accentMaterials.push(ventMaterial);
  } else {
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: config.accentAlt,
      roughness: 0.6,
      metalness: 0.2,
      flatShading: true,
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(config.width * TILE_SIZE - 3, 1, config.height * TILE_SIZE - 3),
      roofMaterial
    );
    roof.position.y = 2.4;
    roof.userData.unitId = config.id;
    group.add(roof);
    clickableMeshes.push(roof);
    accentMaterials.push(roofMaterial);

    const towerMaterial = new THREE.MeshStandardMaterial({
      color: config.accent,
      roughness: 0.55,
      metalness: 0.2,
      flatShading: true,
    });
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.4, 10), towerMaterial);
    stack.position.set(TILE_SIZE * 0.4, 4, 0);
    stack.userData.unitId = config.id;
    group.add(stack);
    clickableMeshes.push(stack);
    accentMaterials.push(towerMaterial);
  }

  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16),
    new THREE.MeshBasicMaterial({ color: 0x7ad968, transparent: true, opacity: 0.9 })
  );
  lamp.position.set(-config.width * TILE_SIZE * 0.35, 2.5, -config.height * TILE_SIZE * 0.35);
  group.add(lamp);

  const label = createLabel(config.name, config.width * TILE_SIZE);
  label.position.set(0, 3.8, config.height * TILE_SIZE * 0.5 + 2.5);
  group.add(label);

  const gaugeWidth = Math.max(config.width * TILE_SIZE - 2.4, 4.2);
  const gauge = createGauge(gaugeWidth, 1);
  gauge.group.position.set(0, 3.35, config.height * TILE_SIZE * 0.5 + 1.4);
  group.add(gauge.group);

  const alertSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getAlertTexture("warning"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  alertSprite.visible = false;
  alertSprite.scale.set(5.2, 5.2, 1);
  alertSprite.position.set(0, 4.6, 0);
  alertSprite.userData.level = null;
  group.add(alertSprite);

  scene.add(group);

  return {
    id: config.id,
    group,
    baseMaterial,
    accentMaterials,
    baseColor: new THREE.Color(config.color),
    accentColor: new THREE.Color(config.accent),
    alertColor: new THREE.Color(config.accentAlt),
    highlight,
    label,
    statusLamp: lamp,
    gauge,
    alertSprite,
    phase,
  };
}

function createPipelineVisual(config) {
  const group = new THREE.Group();
  const materials = [];
  const thickness = 0.9;
  const height = 0.5;

  for (let i = 0; i < config.path.length - 1; i += 1) {
    const start = tileToWorld(config.path[i].x, config.path[i].y);
    const end = tileToWorld(config.path[i + 1].x, config.path[i + 1].y);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length <= 0) continue;
    const isHorizontal = Math.abs(dx) >= Math.abs(dz);
    const geometry = new THREE.BoxGeometry(
      isHorizontal ? length : thickness,
      height,
      isHorizontal ? thickness : length
    );
    const material = new THREE.MeshStandardMaterial({
      color: config.color,
      roughness: 0.8,
      metalness: 0.15,
      transparent: true,
      opacity: 0.32,
      emissive: new THREE.Color(config.color).multiplyScalar(0.18),
      flatShading: true,
    });
    const segment = new THREE.Mesh(geometry, material);
    segment.position.set((start.x + end.x) / 2, height, (start.z + end.z) / 2);
    group.add(segment);
    materials.push(material);
  }

  scene.add(group);

  return {
    id: config.id,
    config,
    group,
    materials,
    baseColor: new THREE.Color(config.color),
  };
}

function createTankFarm() {
  const tankPositions = [
    { x: 9.5, y: 9.3, radius: 2.2 },
    { x: 10.5, y: 10.5, radius: 2.6 },
    { x: 8.2, y: 10.2, radius: 2 },
    { x: 11.8, y: 9.7, radius: 2.4 },
  ];

  tankPositions.forEach((entry, index) => {
    const position = tileToWorld(entry.x, entry.y);
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0xdde3ea,
      roughness: 0.5,
      metalness: 0.2,
      flatShading: true,
    });
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(entry.radius, entry.radius, 2.8, 20),
      shellMaterial
    );
    shell.position.set(position.x, 1.4, position.z);
    scene.add(shell);

    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(entry.radius * 1.02, entry.radius * 1.02, 0.6, 20),
      new THREE.MeshStandardMaterial({
        color: 0xf6f8fb,
        roughness: 0.45,
        metalness: 0.1,
        flatShading: true,
      })
    );
    roof.position.set(position.x, 3.1, position.z);
    scene.add(roof);

    const ladder = new THREE.Mesh(
      new THREE.BoxGeometry(entry.radius * 2.2, 0.15, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x6c7175 })
    );
    ladder.position.set(position.x, 3.05, position.z + entry.radius * 0.9);
    ladder.rotation.y = index % 2 === 0 ? 0 : Math.PI / 6;
    scene.add(ladder);
  });
}

function createDock() {
  const base = tileToWorld(13.8, 8.8);
  const group = new THREE.Group();

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x38424a, roughness: 0.65, metalness: 0.1, flatShading: true })
  );
  deck.position.set(base.x + 5, 0.7, base.z);
  group.add(deck);

  const ship = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(10, 2.2, 4),
    new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.5, metalness: 0.15, flatShading: true })
  );
  hull.position.y = 1.1;
  ship.add(hull);
  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.5, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xf1f2f3, roughness: 0.4, metalness: 0.05, flatShading: true })
  );
  bridge.position.set(-2, 2.1, 0);
  ship.add(bridge);
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 1.8, 12),
    new THREE.MeshStandardMaterial({ color: 0xe26d44, roughness: 0.35, metalness: 0.25, flatShading: true })
  );
  stack.position.set(2, 2.6, 0);
  ship.add(stack);
  ship.position.set(base.x + 4.8, 0, base.z - 2.6);
  group.add(ship);

  scene.add(group);
  return { group, ship };
}

function createFlare(position) {
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.8, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x555c63, roughness: 0.6, metalness: 0.25, flatShading: true })
  );
  stack.position.set(position.x, 3, position.z);
  scene.add(stack);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 3.2, 14),
    new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.55, depthWrite: false })
  );
  flame.position.set(position.x, 5.2, position.z);
  scene.add(flame);

  const light = new THREE.PointLight(0xff914d, 6, 32, 1.8);
  light.position.set(position.x, 5.6, position.z);
  scene.add(light);

  return { stack, flame, light };
}

function createLightTowers() {
  const positions = [tileToWorld(5, 1), tileToWorld(9, 2), tileToWorld(4, 8)];
  positions.forEach((position) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 5, 10),
      new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 0.7, metalness: 0.2 })
    );
    pole.position.set(position.x, 2.5, position.z);
    scene.add(pole);

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0a6, transparent: true, opacity: 0.6 })
    );
    lamp.position.set(position.x, 5.4, position.z);
    scene.add(lamp);
  });
}

function createLabel(text, span) {
  const width = 256;
  const height = 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.fillStyle = "rgba(9, 16, 28, 0.8)";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255, 255, 255, 0.3)";
  context.lineWidth = 4;
  context.strokeRect(8, 8, width - 16, height - 16);

  context.fillStyle = "#dce9ff";
  context.font = "48px Inconsolata";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scaleX = Math.max(span * 0.6, 12);
  sprite.scale.set(scaleX, 5, 1);
  sprite.renderOrder = 3;
  return sprite;
}

function createGauge(width, height) {
  const group = new THREE.Group();
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      color: 0x0d1522,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  group.add(background);

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: gaugeColors.good.clone(),
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, height), fillMaterial);
  fill.position.z = 0.01;
  fill.scale.x = 0.2;
  fill.position.x = -width / 2 + (width * 0.2) / 2;
  group.add(fill);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)),
    new THREE.LineBasicMaterial({ color: 0x1f2f3a, transparent: true, opacity: 0.65 })
  );
  frame.position.z = 0.02;
  group.add(frame);

  group.renderOrder = 4;

  return { group, fill, background, width, height, frame };
}

function getAlertTexture(level) {
  if (alertTextures[level]) {
    return alertTextures[level];
  }
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineWidth = 18;

  if (level === "danger") {
    ctx.fillStyle = "#ff4f4f";
    ctx.strokeStyle = "#ffe8e8";
    ctx.beginPath();
    ctx.moveTo(size / 2, 20);
    ctx.lineTo(size - 24, size / 2);
    ctx.lineTo(size / 2, size - 24);
    ctx.lineTo(24, size / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = "#f3d477";
    ctx.strokeStyle = "#4a3711";
    ctx.beginPath();
    ctx.moveTo(size / 2, 24);
    ctx.lineTo(size - 28, size - 24);
    ctx.lineTo(28, size - 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = level === "danger" ? "#ffffff" : "#1e1a0b";
  ctx.font = "bold 132px Inconsolata";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", size / 2, size / 1.9);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  alertTextures[level] = texture;
  return texture;
}

function updateGauge(gauge, utilization, integrity, isOnline, isSelected) {
  const clampedUtilization = THREE.MathUtils.clamp(isOnline ? utilization : 0, 0, 1.2);
  const fillWidth = Math.max(gauge.width * 0.08, Math.min(gauge.width, gauge.width * clampedUtilization));
  gauge.fill.scale.x = fillWidth / gauge.width;
  gauge.fill.position.x = -gauge.width / 2 + fillWidth / 2;

  const color = gaugeColors.good.clone();
  if (!isOnline) {
    color.copy(gaugeColors.bad);
  } else if (integrity < 0.4) {
    color.copy(gaugeColors.bad);
  } else if (integrity < 0.65) {
    color.copy(gaugeColors.warn);
  }
  gauge.fill.material.color.copy(color);
  gauge.fill.material.opacity = isOnline ? 0.92 : 0.6;

  const baseOpacity = 0.68 + (isSelected ? 0.18 : 0);
  gauge.background.material.opacity = baseOpacity;
  gauge.background.material.color.set(isSelected ? 0x13243b : 0x0d1522);
  if (gauge.frame?.material) {
    gauge.frame.material.opacity = isSelected ? 0.85 : 0.6;
    gauge.frame.material.color.set(isOnline ? 0x39546f : 0x5c1f1f);
  }

  const scale = isSelected ? 1.08 : 1;
  gauge.group.scale.set(scale, scale, 1);
}

function updateAlertSprite(sprite, level, isSelected, time) {
  if (!level) {
    if (sprite.visible) {
      sprite.material.opacity = THREE.MathUtils.lerp(sprite.material.opacity, 0, 0.18);
      if (sprite.material.opacity < 0.05) {
        sprite.visible = false;
        sprite.userData.level = null;
      }
    }
    return;
  }

  if (sprite.userData.level !== level) {
    sprite.material.map = getAlertTexture(level);
    sprite.material.needsUpdate = true;
    sprite.userData.level = level;
  }

  const baseOpacity = level === "danger" ? 0.95 : 0.78;
  sprite.visible = true;
  sprite.material.opacity = THREE.MathUtils.lerp(sprite.material.opacity, baseOpacity, 0.18);
  const pulse = Math.sin(time * (level === "danger" ? 6 : 4)) * 0.35;
  const size = level === "danger" ? 6 + pulse : 5 + pulse * 0.6;
  sprite.scale.set(size, size, 1);
  sprite.position.y = 4.6 + (isSelected ? 0.4 : 0);
}

function billboard(object) {
  if (!object) return;
  object.quaternion.copy(camera.quaternion);
}

function tileToWorld(x, y) {
  return new THREE.Vector3(ORIGIN_X + x * TILE_SIZE, 0, ORIGIN_Z + y * TILE_SIZE);
}

function handlePointerDown(event) {
  const shouldPan =
    event.button !== 0 ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey;

  if (shouldPan) {
    beginPan(event);
    return;
  }

  selectUnitAtPointer(event);
}

function beginPan(event) {
  isPanning = true;
  activePanPointer = event.pointerId;
  panStart.set(event.clientX, event.clientY);
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch (error) {
    /* no-op */
  }
  mapViewport.classList.add("panning");
}

function handlePointerMove(event) {
  if (!isPanning || event.pointerId !== activePanPointer) {
    return;
  }
  const deltaX = event.clientX - panStart.x;
  const deltaY = event.clientY - panStart.y;
  panStart.set(event.clientX, event.clientY);
  panCamera(deltaX, deltaY);
}

function handlePointerUp(event) {
  if (isPanning && event.pointerId === activePanPointer) {
    isPanning = false;
    mapViewport.classList.remove("panning");
    try {
      renderer.domElement.releasePointerCapture(activePanPointer);
    } catch (error) {
      /* ignore */
    }
    activePanPointer = null;
  }
}

function handleWheel(event) {
  event.preventDefault();
  const direction = Math.sign(event.deltaY);
  const zoomFactor = direction > 0 ? 1.12 : 0.88;
  viewHeight = THREE.MathUtils.clamp(viewHeight * zoomFactor, 55, 170);
  const aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight;
  updateCamera(aspect);
}

function panCamera(deltaX, deltaY) {
  if (deltaX === 0 && deltaY === 0) {
    return;
  }
  const element = renderer.domElement;
  if (!element) return;

  const worldPerPixel = (viewHeight * 2) / Math.max(1, element.clientHeight);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();

  const panOffset = new THREE.Vector3();
  panOffset.addScaledVector(right, -deltaX * worldPerPixel * 0.9);
  panOffset.addScaledVector(up, deltaY * worldPerPixel * 0.9);
  panOffset.y = 0;

  cameraTarget.add(panOffset);

  const bounds = {
    minX: -MAP_WIDTH / 2 + TILE_SIZE * 1.5,
    maxX: MAP_WIDTH / 2 - TILE_SIZE * 1.5,
    minZ: -MAP_HEIGHT / 2 + TILE_SIZE * 1.5,
    maxZ: MAP_HEIGHT / 2 - TILE_SIZE * 1.5,
  };

  cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, bounds.minX, bounds.maxX);
  cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, bounds.minZ, bounds.maxZ);

  camera.position.copy(cameraTarget).add(cameraOffset);
  camera.lookAt(cameraTarget);
}

function selectUnitAtPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(clickableMeshes, true);
  if (intersections.length > 0) {
    const target = intersections[0].object.userData.unitId;
    if (target) {
      setSelectedUnit(target);
      ui.selectUnit(target);
      return;
    }
  }
  setSelectedUnit(null);
  ui.selectUnit(null);
}

let selectedUnitId = null;

function setSelectedUnit(unitId) {
  selectedUnitId = unitId;
  updateUnitButtons(unitId);
}

function updateUnits(time) {
  simulation.units.forEach((unit) => {
    const visual = unitVisuals.get(unit.id);
    if (!visual) return;
    const utilization = unit.utilization || 0;
    const integrity = THREE.MathUtils.clamp(unit.integrity, 0, 1);
    const statusColor = unit.status === "online" ? visual.alertColor : new THREE.Color(0xd84545);
    const mix = unit.status === "online" ? 1 - integrity : 0.85;
    const targetColor = visual.baseColor.clone().lerp(statusColor, THREE.MathUtils.clamp(mix, 0, 1));
    visual.baseMaterial.color.copy(targetColor);

    visual.accentMaterials.forEach((material, index) => {
      const pulse = (Math.sin(time * 2.2 + index) + 1) / 2;
      const accentColor = visual.accentColor
        .clone()
        .lerp(statusColor, unit.status === "online" ? 0.25 : 0.65)
        .lerp(visual.baseColor, 0.25 + pulse * 0.15);
      material.color.copy(accentColor);
    });

    if (visual.statusLamp) {
      const lampColor =
        unit.status === "online"
          ? integrity > 0.45
            ? 0x74d77a
            : 0xf2d06b
          : 0xff6b5a;
      visual.statusLamp.material.color.setHex(lampColor);
      visual.statusLamp.material.opacity = 0.7 + utilization * 0.3;
    }

    if (visual.highlight) {
      const baseOpacity = unit.status === "online" ? 0.2 : 0.3;
      const pulse = Math.abs(Math.sin(time * 2.6 + visual.phase)) * (0.25 + utilization * 0.35);
      const selectedBoost = selectedUnitId === unit.id ? 0.35 : 0;
      visual.highlight.material.opacity = baseOpacity + pulse + selectedBoost;
      visual.highlight.material.color.setHex(selectedUnitId === unit.id ? 0xfff6a5 : 0xfff2cc);
    }

    if (visual.label) {
      visual.label.material.opacity = 0.65 + utilization * 0.3;
    }

    if (visual.gauge) {
      updateGauge(visual.gauge, utilization, integrity, unit.status === "online", selectedUnitId === unit.id);
      billboard(visual.gauge.group);
    }

    if (visual.alertSprite) {
      updateAlertSprite(visual.alertSprite, unit.alert, selectedUnitId === unit.id, time);
    }

    visual.group.position.y = selectedUnitId === unit.id ? 0.22 : 0;
  });
}

function updatePipelines(flows, time) {
  pipelineVisuals.forEach((visual) => {
    const flow = flows[visual.config.metric] || 0;
    const normalized = visual.config.capacity
      ? THREE.MathUtils.clamp(flow / visual.config.capacity, 0, 1.4)
      : 0;
    const pulse = Math.max(0, Math.sin(time * 3 + visual.config.phase));
    visual.materials.forEach((material) => {
      material.opacity = 0.18 + normalized * 0.5 + pulse * 0.12;
      const emissive = visual.baseColor.clone().multiplyScalar(0.25 + normalized * 1.4 + pulse * 0.4);
      material.emissive.copy(emissive);
      material.color.copy(visual.baseColor.clone().lerp(new THREE.Color(0xffffff), normalized * 0.2));
    });
  });
}

function updateEnvironment(time) {
  waterLayers.forEach((layer, index) => {
    const wave = Math.sin(time * 1.1 + index * 0.6) * 0.12;
    layer.mesh.position.y = -0.16 + wave * 0.4;
    const hueShift = 0.04 * Math.sin(time * 0.5 + index);
    const color = layer.baseColor.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    hsl.l = THREE.MathUtils.clamp(hsl.l + hueShift * 0.08, 0, 1);
    layer.material.color.setHSL(hsl.h, hsl.s, hsl.l);
    layer.material.opacity = 0.82 + 0.05 * Math.sin(time * 0.9 + index);
  });

  if (dockVisual) {
    dockVisual.ship.position.y = Math.sin(time * 1.1) * 0.4;
    dockVisual.ship.rotation.z = Math.sin(time * 0.9) * 0.05;
  }

  if (flareVisual) {
    const metrics = simulation.getMetrics();
    const flareLevel = THREE.MathUtils.clamp(metrics.flareLevel, 0, 1.3);
    const flicker = 0.2 + Math.abs(Math.sin(time * 9.2)) * 0.35;
    flareVisual.flame.scale.set(1 + flareLevel * 0.45, 1 + flareLevel * 1.6 + flicker, 1);
    flareVisual.flame.material.opacity = 0.35 + flareLevel * 0.4 + flicker * 0.2;
    flareVisual.light.intensity = 3 + flareLevel * 8;
    flareVisual.light.distance = 22 + flareLevel * 26;
  }
}

