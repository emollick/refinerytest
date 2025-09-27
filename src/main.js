import { RefinerySimulation } from "./simulation.js?v=3";
import { UIController } from "./ui.js?v=3";
import { TileRenderer } from "./renderer3d.js?v=3";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const HOURS_PER_DAY = 24;

const mapViewport = document.getElementById("map-viewport");
let sceneContainer = document.getElementById("scene-container");
if (!sceneContainer && mapViewport) {
  sceneContainer = document.createElement("div");
  sceneContainer.id = "scene-container";
  sceneContainer.classList.add("tile-surface");
  mapViewport.prepend(sceneContainer);
}
if (!sceneContainer) {
  throw new Error("Tile renderer container missing");
}
sceneContainer.classList.add("tile-surface");
const menuBar = document.getElementById("menu-bar");
const menuToggle = document.getElementById("menu-toggle");
const scenarioMenu = document.getElementById("scenario-menu");
const unitMenu = document.getElementById("unit-menu");
const importInput = document.getElementById("session-import-input");
const unitPulseList = document.getElementById("unit-pulse");
const mapToolbar = document.querySelector(".map-toolbar");
const recordToolbarButton = mapToolbar?.querySelector('button[data-command="record-demo"]');
const prototypeNotes = document.getElementById("prototype-notes");
const speedControls = document.getElementById("speed-controls");
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
    capacity: 70 / HOURS_PER_DAY,
    color: 0x6fc2ff,
    phase: 0,
    path: [
      { unit: "distillation", anchor: "west", dy: -0.2 },
      { x: 5.6, y: 4.5 },
      { x: 5.2, y: 7.1 },
      { unit: "reformer", anchor: "east", dy: -0.1 },
    ],
  },
  {
    id: "toCracker",
    metric: "toCracker",
    capacity: 90 / HOURS_PER_DAY,
    color: 0xf7b25c,
    phase: 1.3,
    path: [
      { unit: "distillation", anchor: "east", dy: -0.25 },
      { x: 9.5, y: 4.5 },
      { x: 9.7, y: 6.8 },
      { unit: "fcc", anchor: "west", dy: -0.1 },
    ],
  },
  {
    id: "toHydrocracker",
    metric: "toHydrocracker",
    capacity: 70 / HOURS_PER_DAY,
    color: 0x8ee2c4,
    phase: 2.2,
    path: [
      { unit: "distillation", anchor: "north", dx: 0.2 },
      { x: 4.6, y: 3.2 },
      { unit: "hydrocracker", anchor: "south", dx: 0.1 },
    ],
  },
  {
    id: "toAlkylation",
    metric: "toAlkylation",
    capacity: 45 / HOURS_PER_DAY,
    color: 0xc5a1ff,
    phase: 2.9,
    path: [
      { unit: "fcc", anchor: "east", dy: -0.15 },
      { x: 12, y: 6.9 },
      { unit: "alkylation", anchor: "west", dy: -0.1 },
    ],
  },
  {
    id: "toExport",
    metric: "toExport",
    capacity: 160 / HOURS_PER_DAY,
    color: 0x9ec8ff,
    phase: 3.6,
    path: [
      { unit: "distillation", anchor: "east", dy: 0.3 },
      { x: 11, y: 4.8 },
      { x: 11.3, y: 9.4 },
      { x: 13.6, y: 9.4 },
    ],
  },
];


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

function updateRecordButtonState(active) {
  if (!recordToolbarButton) {
    return;
  }
  const recording = Boolean(active);
  recordToolbarButton.classList.toggle("active", recording);
  recordToolbarButton.setAttribute("aria-pressed", recording ? "true" : "false");
  recordToolbarButton.textContent = recording ? "REC" : "RECORD";
}

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
  if (typeof ui.clearInspectionReports === "function") {
    ui.clearInspectionReports();
  }
  updateRecordButtonState(false);
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

const initialLogistics = simulation.getLogisticsState();
const initialFlows = simulation.getFlows();
renderer.render(0, { flows: initialFlows, logistics: initialLogistics });
ui.update(initialLogistics, initialFlows);
refreshUnitPulse(0, true);

if (mapToolbar) {
  mapToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-command]");
    if (!button) return;
    const command = button.dataset.command;
    handleToolbarCommand(command);
  });
}

if (speedControls) {
  speedControls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-speed]");
    if (!button) {
      return;
    }
    const targetSpeed = Number.parseFloat(button.dataset.speed);
    if (!Number.isFinite(targetSpeed)) {
      return;
    }
    const previous = simulation.getSpeedMultiplier();
    const multiplier = simulation.setSpeedFromPreset(targetSpeed);
    if (Math.abs(multiplier - previous) > 0.001) {
      simulation.pushLog("info", `Time scale set to ${multiplier.toFixed(2)}× baseline.`);
    }
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

if (renderer.interactionEnabled) {
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
} else {
  surface.style.cursor = "default";
}

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
  const recorderState =
    typeof simulation.getRecorderState === "function"
      ? simulation.getRecorderState()
      : null;
  const logisticsState = simulation.getLogisticsState();
  const flows = simulation.getFlows();
  updateRecordButtonState(Boolean(recorderState?.active));
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
      const multiplier = simulation.cycleSpeedPreset(-1);
      simulation.pushLog("info", `Time scale set to ${multiplier.toFixed(2)}× baseline.`);
      break;
    }
    case "session-speed-normal": {
      const multiplier = simulation.setSpeedFromPreset(1);
      simulation.pushLog("info", `Time scale reset to ${multiplier.toFixed(2)}× baseline.`);
      break;
    }
    case "session-speed-faster": {
      const multiplier = simulation.cycleSpeedPreset(1);
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
  heading.textContent = "Process & Logistics";
  legend.appendChild(heading);
  const helper = document.createElement("p");
  helper.className = "legend-hint";
  helper.textContent = "Hover to trace connections, click to center the view.";
  legend.appendChild(helper);
  const list = document.createElement("ol");
  const logisticAnchor = {
    id: "logistics",
    name: "Marine Terminal",
    summary: "Balances product tanks and dispatches cargo briefs to ships.",
    pipelines: ["toExport"],
  };
  const sequence = ["distillation", "reformer", "fcc", "hydrocracker", "alkylation", "sulfur", logisticAnchor.id];
  sequence.forEach((unitId) => {
    if (unitId === logisticAnchor.id) {
      const item = document.createElement("li");
      item.dataset.role = "logistics";
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      const name = document.createElement("span");
      name.className = "process-step-name";
      name.textContent = logisticAnchor.name;
      item.appendChild(name);
      const summary = document.createElement("small");
      summary.className = "process-step-summary";
      summary.textContent = logisticAnchor.summary;
      item.appendChild(summary);
      const highlight = () => renderer.setHighlightedPipelines(logisticAnchor.pipelines);
      const reset = () => {
        if (selectedUnitId) {
          highlightPipelinesForUnit(selectedUnitId);
        } else {
          clearPipelineHighlight();
        }
      };
      item.addEventListener("mouseenter", highlight);
      item.addEventListener("focus", highlight);
      item.addEventListener("mouseleave", reset);
      item.addEventListener("blur", reset);
      item.addEventListener("click", () => {
        setSelectedUnit(null);
        ui.selectUnit(null);
        renderer.focusOnLogistics({ onlyIfVisible: true });
        renderer.setHighlightedPipelines(logisticAnchor.pipelines);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedUnit(null);
          ui.selectUnit(null);
          renderer.focusOnLogistics({ onlyIfVisible: false });
          renderer.setHighlightedPipelines(logisticAnchor.pipelines);
        }
      });
      list.appendChild(item);
      return;
    }
    const entry = processTopology[unitId];
    if (!entry) {
      return;
    }
    const item = document.createElement("li");
    item.dataset.unit = unitId;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    const name = document.createElement("span");
    name.className = "process-step-name";
    name.textContent = entry.name || unitId;
    item.appendChild(name);
    const summary = document.createElement("small");
    summary.className = "process-step-summary";
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
      updateRecordButtonState(
        Boolean(simulation.togglePerformanceRecording()?.active)
      );
      break;
    case "inspection":
      if (!selectedUnitId) {
        simulation.performInspection(null);
        break;
      }
      const report = simulation.performInspection(selectedUnitId);
      if (report) {
        if (typeof ui.recordInspectionReport === "function") {
          ui.recordInspectionReport(report);
        }
        renderer.focusOnUnit?.(selectedUnitId, { onlyIfVisible: true });
        highlightPipelinesForUnit(selectedUnitId);
      }
      break;
    case "build-road": {
      const result = simulation.dispatchLogisticsConvoy();
      if (result?.product && typeof ui.flashStorageLevel === "function") {
        ui.flashStorageLevel(result.product);
      }
      break;
    }
    case "build-pipe": {
      const success = simulation.deployPipelineBypass(selectedUnitId);
      if (success && selectedUnitId) {
        highlightPipelinesForUnit(selectedUnitId);
        renderer.focusOnUnit?.(selectedUnitId, { onlyIfVisible: true });
      }
      break;
    }
    case "bulldoze": {
      const scheduled = simulation.scheduleTurnaround(selectedUnitId);
      if (scheduled && selectedUnitId) {
        ui.selectUnit(selectedUnitId);
        renderer.focusOnUnit?.(selectedUnitId, { onlyIfVisible: false });
      }
      break;
    }
    default:
      break;
  }
}

function renderPrototypeNotes() {
  if (!prototypeNotes) {
    return;
  }
  prototypeNotes.innerHTML = "";
  const descriptor = document.createElement("p");
  descriptor.textContent =
    "SimRefinery is the Maxis Business Simulations prototype built for Chevron, mixing management play with the choreography of a live refinery.";
  const restoration = document.createElement("p");
  restoration.textContent =
    "This restoration uses surviving screenshots and reporting and builds on them with new visuals, a working economic model, and other details.";
  const creditIntro = document.createElement("p");
  creditIntro.textContent = "Historical context from The Obscuritory: A close look at SimRefiner,";
  const creditDetail = document.createElement("p");
  creditDetail.textContent = "June 6, 2020, Phil Salvador";
  prototypeNotes.append(descriptor, restoration, creditIntro, creditDetail);
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
