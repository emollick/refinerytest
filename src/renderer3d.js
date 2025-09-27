import * as THREE from "../vendor/three.module.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, t) => start + (end - start) * t;

const DEFAULT_OPTIONS = {
  interactionEnabled: true,
};

const SHIP_COLORS = {
  gasoline: 0xffa552,
  diesel: 0x7ed37e,
  jet: 0x6fc7ff,
};
const DEFAULT_SHIP_COLOR = 0x8ba7d6;

const PALETTES = [
  {
    name: "Twilight",
    sky: 0x0f1726,
    ground: 0x1b2736,
    gridMajor: 0x2e3f55,
    gridMinor: 0x233244,
    sun: 0xffe7b0,
    ambientTop: 0x8ea9ff,
    ambientBottom: 0x101829,
    flowLow: 0x2469a4,
    flowHigh: 0x66f5ff,
    pointer: 0xffffff,
    storageShell: 0x2b3442,
    storageLabels: 0xeaf2ff,
    highlight: 0xffffff,
  },
  {
    name: "Daybreak",
    sky: 0x1c2736,
    ground: 0x263445,
    gridMajor: 0x3b516b,
    gridMinor: 0x2b3c4f,
    sun: 0xfff2cc,
    ambientTop: 0xb0c6ff,
    ambientBottom: 0x1a2434,
    flowLow: 0x2c7a45,
    flowHigh: 0x98ff9f,
    pointer: 0xf6ffdc,
    storageShell: 0x304050,
    storageLabels: 0xf7fbe9,
    highlight: 0xf0ffd5,
  },
];

const STORAGE_CONFIG = [
  { key: "gasoline", color: 0xffc857, offset: new THREE.Vector2(2.6, -1.8) },
  { key: "diesel", color: 0x88f18b, offset: new THREE.Vector2(2.6, 0.2) },
  { key: "jet", color: 0x6fd3ff, offset: new THREE.Vector2(2.6, 2) },
];

export class TileRenderer {
  constructor(container, simulationInstance, unitDefs, pipelineDefs, options = {}) {
    this.container = container;
    this.simulation = simulationInstance;
    this.unitDefs = unitDefs;
    this.pipelineDefs = pipelineDefs;
    this.unitDefMap = new Map((unitDefs || []).map((unit) => [unit.id, unit]));
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.interactionEnabled = Boolean(this.options.interactionEnabled);

    this.tileScale = 6.4;
    this.paletteIndex = 0;
    this.flowVisible = true;
    this.gridVisible = true;
    this.highlightedPipelines = new Set();
    this.hoverUnitId = null;
    this.selectedUnitId = null;
    this.time = 0;
    this.selectionPulse = 0;
    this.shipLane = null;
    this.shipLayer = null;
    this.shipMeshes = new Map();
    this.waterMesh = null;
    this.dockMesh = null;
    this.dockLight = null;
    this.dockApron = null;
    this.quayMesh = null;
    this.groundDetailLayer = null;
    this.groundDetailMaterials = [];
    this._vectorA = new THREE.Vector3();
    this._vectorB = new THREE.Vector3();

    this.deviceScaleX = 1;
    this.deviceScaleY = 1;
    this.displayWidth = container?.clientWidth || 960;
    this.displayHeight = container?.clientHeight || 540;

    this._computeBounds();
    this._initThree();
    this._buildScene();
    this.resizeToContainer(container);
    this._applyPalette(true);
    this._updateCamera();
  }

  getSurface() {
    return this.renderer?.domElement;
  }

  resizeToContainer(container) {
    if (!container || !this.renderer) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const fallbackWidth = container.clientWidth || container.offsetWidth || this.displayWidth || 960;
    const fallbackHeight = container.clientHeight || container.offsetHeight || this.displayHeight || 540;
    const width = Math.max(360, Math.floor(rect.width) || fallbackWidth);
    const height = Math.max(340, Math.floor(rect.height) || fallbackHeight);
    this.renderer.setSize(width, height, false);
    this.displayWidth = width;
    this.displayHeight = height;
    this.deviceScaleX = 1;
    this.deviceScaleY = 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setGridVisible(visible) {
    this.gridVisible = Boolean(visible);
    if (this.gridHelper) {
      this.gridHelper.visible = this.gridVisible;
    }
  }

  setFlowVisible(visible) {
    this.flowVisible = Boolean(visible);
    for (const pipeline of this.pipelineMeshes.values()) {
      pipeline.glow.visible = this.flowVisible;
      if (!this.flowVisible) {
        pipeline.mesh.material.emissiveIntensity = 0.06;
        pipeline.glow.material.emissiveIntensity = 0.0;
      }
    }
  }

  cyclePalette() {
    this.paletteIndex = (this.paletteIndex + 1) % PALETTES.length;
    this._applyPalette(false);
  }

  setHighlightedPipelines(pipelines) {
    this.highlightedPipelines = new Set(pipelines || []);
  }

  setSelectedUnit(unitId) {
    this.selectedUnitId = unitId || null;
    this.selectionPulse = 0;
  }

  setHoverUnit(unitId) {
    this.hoverUnitId = unitId || null;
  }

  setPointer(tileX, tileY, active) {
    if (!this.pointerMesh) {
      return;
    }
    if (!active) {
      this.pointerMesh.visible = false;
      return;
    }
    const world = this._tileToWorld(tileX, tileY, 0.05);
    this.pointerMesh.position.copy(world);
    this.pointerMesh.material.opacity = 0.45;
    this.pointerMesh.visible = true;
  }

  render(deltaSeconds, { flows = {}, logistics = {} } = {}) {
    if (!this.renderer) {
      return;
    }
    this.time += deltaSeconds;
    this.selectionPulse += deltaSeconds;

    const unitState = new Map((this.simulation?.getUnits?.() || []).map((entry) => [entry.id, entry]));
    const palette = this._getPalette();

    for (const [unitId, unit] of this.unitMeshes.entries()) {
      const metrics = unitState.get(unitId);
      const utilization = metrics ? clamp(metrics.utilization || 0, 0, 1.5) : 0;
      const integrity = metrics ? clamp(metrics.integrity || 0, 0, 1) : 1;

      const heat = clamp(utilization, 0, 1);
      const alert = clamp(1 - integrity, 0, 1);

      const baseColor = unit.baseColor.clone().lerp(new THREE.Color(0xff7e6f), alert * 0.65);
      unit.body.material.color.copy(baseColor);

      const accentColor = unit.accentColor.clone().lerp(new THREE.Color(0xffd66f), heat * 0.45);
      if (unit.cap) {
        unit.cap.material.color.copy(accentColor);
      }
      if (Array.isArray(unit.accentMeshes)) {
        unit.accentMeshes.forEach((mesh) => {
          if (mesh?.material?.color) {
            mesh.material.color.copy(accentColor);
          }
        });
      }

      const indicatorIntensity = 0.15 + heat * 0.75;
      unit.indicator.scale.y = 0.2 + heat * 0.9;
      unit.indicator.material.opacity = clamp(indicatorIntensity, 0.12, 0.9);
      const utilColor = lerpColor(new THREE.Color(palette.flowLow), new THREE.Color(palette.flowHigh), clamp(utilization, 0, 1));
      unit.indicator.material.color.copy(utilColor);

      const highlightActive = this.selectedUnitId === unitId;
      const hoverActive = this.hoverUnitId === unitId && !highlightActive;
      const pulse = highlightActive ? 0.5 + Math.sin(this.selectionPulse * 3) * 0.25 : 0;
      const baseOpacity = highlightActive ? 0.45 + pulse * 0.4 : hoverActive ? 0.28 : 0.12;
      unit.highlight.material.opacity = baseOpacity;
      unit.highlight.material.color.setHex(palette.highlight);
      unit.highlight.visible = baseOpacity > 0.08;
      const scaleBoost = highlightActive ? 1.12 + pulse * 0.1 : hoverActive ? 1.05 : 1.0;
      unit.highlight.scale.set(scaleBoost, 1, scaleBoost);

      unit.label.material.opacity = highlightActive || hoverActive ? 1 : 0.85;
    }

    const storageLevels = logistics.storage?.levels || {};
    const storageCap = logistics.storage?.capacity || {};

    for (const tank of this.storageMeshes.values()) {
      const levelRaw = Number(storageLevels[tank.key]);
      const capacityRaw = Number(storageCap[tank.key]);
      const level = Number.isFinite(levelRaw) ? levelRaw : 0;
      const capacity = Number.isFinite(capacityRaw) && capacityRaw > 0 ? capacityRaw : 1;
      const ratio = clamp(level / capacity, 0, 1);

      if (tank.gaugeGroup) {
        const toCamera = this._vectorA.copy(this.camera.position).sub(tank.group.position);
        toCamera.y = 0;
        if (toCamera.lengthSq() > 0.0001) {
          toCamera.normalize();
          const offset = this._vectorB.copy(toCamera).multiplyScalar((tank.baseRadius || 3.2) + 1.4);
          tank.gaugeGroup.position.set(offset.x, tank.gaugeMountY ?? 0.12, offset.z);
          tank.gaugeGroup.rotation.set(0, Math.atan2(toCamera.x, toCamera.z), 0);
        }
      }

      if (tank.indicator) {
        const indicatorScale = clamp(ratio, 0.02, 1);
        tank.indicator.scale.y = indicatorScale;
        tank.indicator.material.opacity = 0.52 + ratio * 0.38;
        const gaugeColor = (tank.baseColor || new THREE.Color(0xffffff)).clone();
        gaugeColor.lerp(new THREE.Color(0xffffff), ratio * 0.25);
        tank.indicator.material.color.copy(gaugeColor);
        tank.indicator.visible = true;
        tank.indicator.position.y = 0;
      }

      if (tank.shell?.material) {
        const baseColor = tank.shell.material.userData?.baseColor || tank.shell.material.color;
        tank.shell.material.color.copy(baseColor).lerp(new THREE.Color(0xffffff), ratio * 0.1);
        tank.shell.material.emissiveIntensity = 0.08 + ratio * 0.3;
      }

      if (tank.gaugeOverlay) {
        tank.gaugeOverlay.material.opacity = 0.08 + ratio * 0.08;
      }

      if (Array.isArray(tank.gaugeTickMaterials)) {
        const tickBaseColor = (tank.baseColor || new THREE.Color(0xffffff)).clone();
        tank.gaugeTickMaterials.forEach((material, index) => {
          if (!material || !material.color) {
            return;
          }
          const emphasis = ratio >= index / Math.max(tank.gaugeTickMaterials.length - 1, 1) ? 0.35 : 0.0;
          const tint = tickBaseColor.clone().lerp(new THREE.Color(0xffffff), 0.65 + emphasis);
          material.color.copy(tint);
          material.opacity = 0.22 + emphasis * 0.9;
        });
      }

      if (tank.label) {
        tank.label.position.y = (tank.baseHeight || 14) + 5;
        tank.label.material.opacity = 0.75 + ratio * 0.25;
      }
    }

    this._updateShips(deltaSeconds, logistics);

    for (const [pipelineId, pipeline] of this.pipelineMeshes.entries()) {
      const metricValue = flows[pipeline.metric] || 0;
      const ratio = pipeline.capacity ? clamp(metricValue / pipeline.capacity, 0, 2) : 0;
      const highlighted = this.highlightedPipelines.has(pipelineId);
      const baseIntensity = highlighted ? 0.38 : 0.16;
      const dynamicIntensity = this.flowVisible ? ratio * (highlighted ? 1.8 : 1.2) : 0.04;
      const oscillation = this.flowVisible ? Math.sin(this.time * 1.6 + pipeline.phase) * 0.015 : 0;
      const glowScale = 1 + ratio * 0.1 + (highlighted ? 0.06 : 0) + oscillation;

      pipeline.mesh.material.emissiveIntensity = baseIntensity + dynamicIntensity * 0.5;
      pipeline.glow.material.emissiveIntensity = this.flowVisible ? baseIntensity * 0.6 + dynamicIntensity * 0.9 : 0.0;
      pipeline.glow.scale.setScalar(glowScale);
    }

    if (this.pointerMesh?.visible) {
      const hoverGlow = 0.45 + Math.sin(this.time * 6) * 0.25;
      this.pointerMesh.material.opacity = clamp(hoverGlow, 0.15, 0.85);
    }

    this.renderer.render(this.scene, this.camera);
  }

  screenToIso(screenX, screenY) {
    if (!this.renderer) {
      return { x: 0, y: 0 };
    }
    const width = this.displayWidth || 1;
    const height = this.displayHeight || 1;
    const ndc = new THREE.Vector2((screenX / width) * 2 - 1, -((screenY / height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) {
      return { x: 0, y: 0 };
    }
    const tileX = point.x / this.tileScale + this.mapCenter.x;
    const tileY = point.z / this.tileScale + this.mapCenter.y;
    return { x: tileX, y: tileY };
  }

  getUnitAt(tileX, tileY) {
    for (const def of this.unitDefs) {
      const withinX = tileX >= def.tileX - 0.25 && tileX <= def.tileX + def.width + 0.1;
      const withinY = tileY >= def.tileY - 0.25 && tileY <= def.tileY + def.height + 0.1;
      if (withinX && withinY) {
        return def;
      }
    }
    return null;
  }

  isPanning() {
    return Boolean(this.controlState?.active);
  }

  beginPan(screenX, screenY) {
    if (!this.interactionEnabled) {
      return;
    }
    this.controlState = {
      active: true,
      startX: screenX,
      startY: screenY,
      baseAzimuth: this.cameraAngles.azimuth,
      basePolar: this.cameraAngles.polar,
    };
  }

  panTo(screenX, screenY) {
    if (!this.interactionEnabled || !this.controlState?.active) {
      return;
    }
    const dx = (screenX - this.controlState.startX) / (this.displayWidth || 1);
    const dy = (screenY - this.controlState.startY) / (this.displayHeight || 1);
    this.cameraAngles.azimuth = this.controlState.baseAzimuth - dx * Math.PI;
    this.cameraAngles.polar = clamp(this.controlState.basePolar + dy * Math.PI * 0.7, 0.28, 1.35);
    this._updateCamera();
  }

  endPan() {
    if (this.controlState) {
      this.controlState.active = false;
    }
  }

  zoomAt(_screenX, _screenY, deltaY) {
    if (!this.interactionEnabled) {
      return;
    }
    const zoomFactor = Math.exp(-deltaY * 0.0014);
    this.cameraDistance = clamp(this.cameraDistance * zoomFactor, 32, 220);
    this._updateCamera();
  }

  nudgeCamera(deltaX, deltaY) {
    if (!this.interactionEnabled) {
      return;
    }
    const moveScale = this.cameraDistance * 0.002;
    const right = new THREE.Vector3();
    const forward = new THREE.Vector3();
    right.subVectors(this.camera.position, this.cameraTarget).cross(new THREE.Vector3(0, 1, 0)).setY(0).normalize();
    forward.copy(right).cross(new THREE.Vector3(0, 1, 0)).normalize();
    this.cameraTarget.addScaledVector(right, -deltaX * moveScale);
    this.cameraTarget.addScaledVector(forward, deltaY * moveScale);
    this._updateCamera();
  }

  resetView() {
    this.cameraAngles.azimuth = this.defaultCameraAngles.azimuth;
    this.cameraAngles.polar = this.defaultCameraAngles.polar;
    this.cameraDistance = this.defaultCameraDistance;
    this.cameraTarget.copy(this.defaultCameraTarget);
    this._updateCamera();
  }

  focusOnUnit(unitId, { onlyIfVisible = false } = {}) {
    const unit = this.unitMeshes.get(unitId);
    if (!unit) {
      return;
    }
    const worldPos = unit.group.getWorldPosition(new THREE.Vector3());
    if (onlyIfVisible) {
      const projected = worldPos.clone().project(this.camera);
      const onScreen = projected.x >= -0.7 && projected.x <= 0.7 && projected.y >= -0.7 && projected.y <= 0.7;
      if (onScreen) {
        return;
      }
    }
    this.cameraTarget.lerp(worldPos, 0.6);
    this._updateCamera();
  }

  focusOnLogistics({ onlyIfVisible = false } = {}) {
    if (!this.shipLane?.dock) {
      return;
    }
    const target = this.shipLane.dock.clone();
    if (onlyIfVisible) {
      const projected = target.clone().project(this.camera);
      const onScreen = projected.x >= -0.7 && projected.x <= 0.7 && projected.y >= -0.7 && projected.y <= 0.7;
      if (onScreen) {
        return;
      }
    }
    this.cameraTarget.lerp(target, 0.6);
    this._updateCamera();
  }

  _computeBounds() {
    const xs = [];
    const ys = [];
    for (const unit of this.unitDefs) {
      xs.push(unit.tileX, unit.tileX + unit.width);
      ys.push(unit.tileY, unit.tileY + unit.height);
    }
    if (!xs.length) {
      xs.push(0, 16);
    }
    if (!ys.length) {
      ys.push(0, 12);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    this.mapBounds = { minX, maxX, minY, maxY };
    this.mapCenter = {
      x: lerp(minX, maxX, 0.5),
      y: lerp(minY, maxY, 0.5),
    };
    this.mapSpan = {
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    };
  }

  _initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTES[this.paletteIndex].sky);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    if (this.renderer.outputColorSpace !== undefined) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (this.renderer.outputEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    this.renderer.shadowMap.enabled = false;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(44, this.displayWidth / this.displayHeight, 0.1, 600);
    this.cameraAngles = { azimuth: Math.PI * 0.62, polar: 0.88 };
    this.cameraDistance = Math.max(this.mapSpan.width, this.mapSpan.height) * this.tileScale * 2.35;
    const centerWorld = this._tileToWorld(this.mapCenter.x, this.mapCenter.y, 0);
    this.cameraTarget = centerWorld.clone();
    this.defaultCameraAngles = { ...this.cameraAngles };
    this.defaultCameraDistance = this.cameraDistance;
    this.defaultCameraTarget = centerWorld.clone();

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const groundSize = Math.max(this.mapSpan.width, this.mapSpan.height) * this.tileScale * 2.2;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 1, 1);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: PALETTES[this.paletteIndex].ground,
      roughness: 0.92,
      metalness: 0.04,
    });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this.gridHelper = new THREE.GridHelper(groundSize, Math.round(Math.max(this.mapSpan.width, this.mapSpan.height)) * 2, 0x3a4a60, 0x253347);
    this.gridHelper.position.y = 0.01;
    this.gridHelper.material.opacity = 0.24;
    this.gridHelper.material.transparent = true;
    this.scene.add(this.gridHelper);

    this.ambientLight = new THREE.HemisphereLight(0xbfd4ff, 0x0b1018, 0.8);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2cc, 0.85);
    this.sunLight.position.set(60, 90, 40);
    this.scene.add(this.sunLight);

    const pointerGeometry = new THREE.RingGeometry(0.55, 0.82, 32);
    const pointerMaterial = new THREE.MeshBasicMaterial({ color: PALETTES[this.paletteIndex].pointer, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    this.pointerMesh = new THREE.Mesh(pointerGeometry, pointerMaterial);
    this.pointerMesh.rotation.x = -Math.PI / 2;
    this.pointerMesh.visible = false;
    this.scene.add(this.pointerMesh);
  }

  _buildScene() {
    this.unitMeshes = new Map();
    this.pipelineMeshes = new Map();
    this.storageMeshes = new Map();

    this._createUnits();
    this._createPipelines();
    this._createGroundDetails();
    this._createStorage();
    this._createLogisticsZone();
  }

  _createUnits() {
    const footprintScale = this.tileScale * 0.82;
    const palette = this._getPalette();
    for (const def of this.unitDefs) {
      const centerX = def.tileX + def.width / 2;
      const centerY = def.tileY + def.height / 2;
      const world = this._tileToWorld(centerX, centerY, 0);
      const group = new THREE.Group();
      group.position.copy(world);
      this.scene.add(group);

      const baseWidth = Math.max(def.width * footprintScale, this.tileScale * 0.8);
      const baseDepth = Math.max(def.height * footprintScale, this.tileScale * 0.8);
      const baseHeight = 6 + def.height * 1.4;

      const padGeometry = new THREE.PlaneGeometry(baseWidth * 1.28, baseDepth * 1.28, 1, 1);
      const padMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.ground || 0x1b2736).lerp(new THREE.Color(0x283749), 0.4),
        metalness: 0.12,
        roughness: 0.88,
        transparent: true,
        opacity: 0.9,
      });
      const pad = new THREE.Mesh(padGeometry, padMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.02;
      group.add(pad);

      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: def.color,
        metalness: 0.28,
        roughness: 0.62,
      });
      const accentMaterial = new THREE.MeshStandardMaterial({
        color: def.accent,
        metalness: 0.25,
        roughness: 0.46,
      });
      const accentMeshes = [];
      let body;
      let cap = null;
      let indicatorAnchor = baseHeight * 0.62;

      switch (def.style) {
        case "towers": {
          const towerRadius = Math.min(baseWidth, baseDepth) * 0.18;
          const towerSpacing = Math.min(baseWidth, baseDepth) * 0.42;
          const heights = [baseHeight * 1.18, baseHeight * 0.94, baseHeight * 0.78];
          const offsets = [-towerSpacing, 0, towerSpacing];
          heights.forEach((height, index) => {
            const radius = towerRadius * (index === 0 ? 1.08 : 0.94 - index * 0.04);
            const shell = new THREE.Mesh(
              new THREE.CylinderGeometry(radius, radius * 0.96, height, 28),
              index === 0 ? bodyMaterial : accentMaterial.clone()
            );
            shell.position.set(offsets[index], height / 2, index === 1 ? towerSpacing * 0.25 : 0);
            group.add(shell);
            if (index === 0) {
              body = shell;
            } else {
              accentMeshes.push(shell);
            }
          });
          const walkway = new THREE.Mesh(
            new THREE.TorusGeometry(towerRadius * 1.15, towerRadius * 0.08, 12, 32),
            accentMaterial.clone()
          );
          walkway.rotation.x = Math.PI / 2;
          walkway.position.y = heights[0] * 0.72;
          group.add(walkway);
          cap = walkway;
          accentMeshes.push(walkway);

          const stackHeight = heights[0] * 0.35;
          const stack = new THREE.Mesh(
            new THREE.CylinderGeometry(towerRadius * 0.42, towerRadius * 0.32, stackHeight, 20),
            accentMaterial.clone()
          );
          stack.position.set(offsets[0] * 0.42, heights[0] - stackHeight / 2, 0);
          group.add(stack);
          accentMeshes.push(stack);

          indicatorAnchor = heights[0] * 0.74;
          break;
        }
        case "reactor": {
          const pedestalHeight = Math.max(1.6, baseHeight * 0.32);
          const pedestalRadius = Math.min(baseWidth, baseDepth) * 0.32;
          const pedestal = new THREE.Mesh(
            new THREE.CylinderGeometry(pedestalRadius * 0.95, pedestalRadius * 1.02, pedestalHeight, 32),
            accentMaterial.clone()
          );
          pedestal.position.y = pedestalHeight / 2;
          group.add(pedestal);
          accentMeshes.push(pedestal);

          const sphereRadius = Math.min(baseWidth, baseDepth) * 0.55;
          const vessel = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius, 40, 32), bodyMaterial);
          vessel.position.y = pedestalHeight + sphereRadius;
          group.add(vessel);
          body = vessel;

          const band = new THREE.Mesh(
            new THREE.TorusGeometry(sphereRadius * 0.82, sphereRadius * 0.08, 16, 48),
            accentMaterial.clone()
          );
          band.rotation.x = Math.PI / 2;
          band.position.y = vessel.position.y;
          group.add(band);
          cap = band;
          accentMeshes.push(band);

          const riserHeight = sphereRadius * 1.2;
          const riser = new THREE.Mesh(
            new THREE.CylinderGeometry(sphereRadius * 0.2, sphereRadius * 0.16, riserHeight, 24),
            accentMaterial.clone()
          );
          riser.position.set(sphereRadius * 0.48, pedestalHeight + sphereRadius * 1.1, 0);
          group.add(riser);
          accentMeshes.push(riser);

          const cyclone = new THREE.Mesh(
            new THREE.ConeGeometry(sphereRadius * 0.24, sphereRadius * 0.5, 24),
            accentMaterial.clone()
          );
          cyclone.position.set(-sphereRadius * 0.6, pedestalHeight + sphereRadius * 1.4, 0);
          group.add(cyclone);
          accentMeshes.push(cyclone);

          indicatorAnchor = pedestalHeight + sphereRadius * 1.35;
          break;
        }
        case "support": {
          const cradleHeight = baseHeight * 0.18;
          const cradle = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth * 0.92, cradleHeight, baseDepth * 0.74),
            accentMaterial.clone()
          );
          cradle.position.y = cradleHeight / 2;
          group.add(cradle);
          accentMeshes.push(cradle);

          const drumRadius = Math.min(baseHeight, baseDepth) * 0.36;
          const drumLength = baseWidth * 0.95;
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(drumRadius, drumRadius, drumLength, 32), bodyMaterial);
          drum.rotation.z = Math.PI / 2;
          drum.position.y = cradleHeight + drumRadius;
          group.add(drum);
          body = drum;

          const scrubber = new THREE.Mesh(
            new THREE.CylinderGeometry(drumRadius * 0.28, drumRadius * 0.24, baseHeight * 0.65, 20),
            accentMaterial.clone()
          );
          scrubber.position.set(0, drum.position.y + baseHeight * 0.32, baseDepth * 0.3);
          group.add(scrubber);
          cap = scrubber;
          accentMeshes.push(scrubber);

          indicatorAnchor = drum.position.y + baseHeight * 0.35;
          break;
        }
        case "rect": {
          const pedestalHeight = baseHeight * 0.18;
          const pedestal = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth * 0.98, pedestalHeight, baseDepth * 0.9),
            accentMaterial.clone()
          );
          pedestal.position.y = pedestalHeight / 2;
          group.add(pedestal);
          accentMeshes.push(pedestal);

          const blockHeight = baseHeight * 0.78;
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth * 0.9, blockHeight, baseDepth * 0.82),
            bodyMaterial
          );
          block.position.y = pedestalHeight + blockHeight / 2;
          group.add(block);
          body = block;

          const roofHeight = baseHeight * 0.12;
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth * 0.94, roofHeight, baseDepth * 0.86),
            accentMaterial.clone()
          );
          roof.position.y = pedestalHeight + blockHeight + roofHeight / 2;
          group.add(roof);
          cap = roof;
          accentMeshes.push(roof);

          const stack = new THREE.Mesh(
            new THREE.CylinderGeometry(baseWidth * 0.08, baseWidth * 0.1, baseHeight * 0.82, 18),
            accentMaterial.clone()
          );
          stack.position.set(-baseWidth * 0.28, pedestalHeight + blockHeight + baseHeight * 0.42, baseDepth * 0.18);
          group.add(stack);
          accentMeshes.push(stack);

          indicatorAnchor = pedestalHeight + blockHeight + roofHeight * 0.6;
          break;
        }
        default: {
          const block = new THREE.Mesh(new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth), bodyMaterial);
          block.position.y = baseHeight / 2;
          group.add(block);
          body = block;

          const topper = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth * 0.78, baseHeight * 0.32, baseDepth * 0.78),
            accentMaterial.clone()
          );
          topper.position.y = baseHeight + topper.geometry.parameters.height / 2 - 0.4;
          group.add(topper);
          cap = topper;
          accentMeshes.push(topper);
          break;
        }
      }

      if (!body) {
        body = new THREE.Mesh(new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth), bodyMaterial);
        body.position.y = baseHeight / 2;
        group.add(body);
      }

      const indicatorGeometry = new THREE.ConeGeometry(Math.min(baseWidth, baseDepth) * 0.22, baseHeight * 0.9, 20, 1, true);
      const indicatorMaterial = new THREE.MeshStandardMaterial({
        color: 0x66f5ff,
        transparent: true,
        opacity: 0.25,
        metalness: 0.1,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });
      const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
      indicator.rotation.x = Math.PI;
      indicator.position.y = indicatorAnchor;
      group.add(indicator);

      const highlightScale = def.style === "towers" ? 0.72 : def.style === "reactor" ? 0.68 : def.style === "support" ? 0.7 : 0.55;
      const highlightGeometry = new THREE.CylinderGeometry(
        Math.max(baseWidth, baseDepth) * highlightScale,
        Math.max(baseWidth, baseDepth) * highlightScale,
        0.6,
        38,
        1,
        true
      );
      const highlightMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      });
      const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
      highlight.rotation.x = Math.PI / 2;
      highlight.position.y = 0.12;
      group.add(highlight);

      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      const topHeight = Number.isFinite(bounds.max?.y) ? bounds.max.y : baseHeight;

      const label = createLabelSprite(def.name);
      label.position.set(0, topHeight + 6, 0);
      group.add(label);

      this.unitMeshes.set(def.id, {
        group,
        body,
        cap,
        indicator,
        highlight,
        label,
        pad,
        padMaterial,
        accentMeshes,
        baseColor: new THREE.Color(def.color),
        accentColor: new THREE.Color(def.accent),
      });
    }
  }

  _createPipelines() {
    for (const def of this.pipelineDefs) {
      const points = [];
      (def.path || []).forEach((entry, index) => {
        const point = this._resolvePipelinePoint(entry, index, def);
        if (point) {
          points.push(point);
        }
      });
      const filtered = points.filter(
        (pt) =>
          pt &&
          typeof pt.x === "number" &&
          typeof pt.y === "number" &&
          typeof pt.z === "number" &&
          Number.isFinite(pt.x) &&
          Number.isFinite(pt.y) &&
          Number.isFinite(pt.z)
      );
      if (filtered.length < 2) {
        continue;
      }
      const curve = new THREE.CatmullRomCurve3(filtered, false, "catmullrom", 0.4);
      const segments = Math.max(filtered.length * 12, 64);
      const tubeGeometry = new THREE.TubeGeometry(curve, segments, 0.4, 16, false);
      const baseColor = new THREE.Color(def.color ?? 0x6aa5ff);

      const tubeMaterial = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor.clone().multiplyScalar(0.12),
        emissiveIntensity: 0.12,
        metalness: 0.6,
        roughness: 0.32,
        transparent: true,
        opacity: 0.92,
      });
      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      this.scene.add(tube);

      const glowGeometry = tubeGeometry.clone();
      const glowMaterial = new THREE.MeshStandardMaterial({
        color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
        emissive: baseColor.clone().multiplyScalar(0.6),
        emissiveIntensity: 0.0,
        metalness: 0.2,
        roughness: 0.8,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.scale.setScalar(1.04);
      this.scene.add(glow);

      this.pipelineMeshes.set(def.id, {
        mesh: tube,
        glow,
        baseColor,
        metric: def.metric,
        capacity: def.capacity || 100,
        phase: def.phase || 0,
      });
    }
  }

  _resolvePipelinePoint(entry, index, def) {
    if (!entry) {
      return null;
    }
    const height = typeof entry.height === "number" ? entry.height : 0.6;
    if (entry.unit) {
      const anchor = this._resolveUnitAnchor(entry);
      return this._tileToWorld(anchor.x, anchor.y, height);
    }
    if (typeof entry.x === "number" && typeof entry.y === "number") {
      const offsetX = entry.dx || 0;
      const offsetY = entry.dy || 0;
      return this._tileToWorld(entry.x + offsetX, entry.y + offsetY, height);
    }
    return null;
  }

  _resolveUnitAnchor(entry) {
    const unit = this.unitDefMap?.get(entry.unit);
    if (!unit) {
      return { x: entry.x || 0, y: entry.y || 0 };
    }
    const anchor = entry.anchor || "center";
    const pad = typeof entry.pad === "number" ? entry.pad : 0.35;
    let x = unit.tileX + unit.width / 2;
    let y = unit.tileY + unit.height / 2;

    switch (anchor) {
      case "east":
        x = unit.tileX + unit.width + pad;
        break;
      case "west":
        x = unit.tileX - pad;
        break;
      case "north":
        y = unit.tileY - pad;
        break;
      case "south":
        y = unit.tileY + unit.height + pad;
        break;
      default:
        break;
    }

    x += entry.dx || 0;
    y += entry.dy || 0;

    return { x, y };
  }

  _createGroundDetails() {
    if (this.groundDetailLayer) {
      this.scene.remove(this.groundDetailLayer);
      this.groundDetailLayer.traverse((child) => {
        if (child.material?.dispose) {
          child.material.dispose();
        }
        if (child.geometry?.dispose) {
          child.geometry.dispose();
        }
      });
    }
    this.groundDetailMaterials = [];

    const group = new THREE.Group();
    group.name = "ground-decoration";

    const palette = this._getPalette();

    const apronWidth = this.tileScale * (this.mapSpan.width + 6.5);
    const apronDepth = this.tileScale * 3.4;
    const apronGeometry = new THREE.PlaneGeometry(apronWidth, apronDepth);
    const apronMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.ground).lerp(new THREE.Color(0x1f2c3b), 0.28),
      metalness: 0.18,
      roughness: 0.82,
      transparent: true,
      opacity: 0.92,
    });
    apronMaterial.userData.role = "apron";
    const apron = new THREE.Mesh(apronGeometry, apronMaterial);
    apron.rotation.x = -Math.PI / 2;
    const apronTileX = this.mapBounds.maxX + 3.8;
    const apronTileY = this.mapBounds.minY + this.mapSpan.height + 1.6;
    apron.position.copy(this._tileToWorld(apronTileX, apronTileY, 0));
    apron.position.y = 0.015;
    apron.receiveShadow = false;
    group.add(apron);
    this.dockApron = apronMaterial;
    this.groundDetailMaterials.push(apronMaterial);

    const latticeMinX = this.mapBounds.minX - 1.5;
    const latticeMaxX = this.mapBounds.maxX + 6.2;
    const latticeMinY = this.mapBounds.minY - 1.6;
    const latticeMaxY = this.mapBounds.maxY + 3.2;
    const latticeStep = 1.6;
    const latticePositions = [];
    for (let x = latticeMinX; x <= latticeMaxX; x += latticeStep) {
      const start = this._tileToWorld(x, latticeMinY, 0.018);
      const end = this._tileToWorld(x, latticeMaxY, 0.018);
      latticePositions.push(start.x, 0.018, start.z, end.x, 0.018, end.z);
    }
    for (let y = latticeMinY; y <= latticeMaxY; y += latticeStep) {
      const start = this._tileToWorld(latticeMinX, y, 0.018);
      const end = this._tileToWorld(latticeMaxX, y, 0.018);
      latticePositions.push(start.x, 0.018, start.z, end.x, 0.018, end.z);
    }
    if (latticePositions.length > 0) {
      const latticeGeometry = new THREE.BufferGeometry();
      latticeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(latticePositions, 3));
      const latticeMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(palette.gridMinor || 0x233244).lerp(new THREE.Color(0x415064), 0.35),
        transparent: true,
        opacity: 0.28,
        linewidth: 1,
      });
      latticeMaterial.userData.role = "lattice";
      const lattice = new THREE.LineSegments(latticeGeometry, latticeMaterial);
      lattice.position.y = 0.01;
      group.add(lattice);
      this.groundDetailMaterials.push(latticeMaterial);
    }

    const spineMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x28384c).lerp(new THREE.Color(palette.gridMajor || 0x2e3f55), 0.25),
      metalness: 0.24,
      roughness: 0.68,
      transparent: true,
      opacity: 0.94,
    });
    spineMaterial.userData.role = "spine";
    const spineGeometry = new THREE.BoxGeometry(this.tileScale * (this.mapSpan.width + 1.5), 0.12, this.tileScale * 0.7);
    const spine = new THREE.Mesh(spineGeometry, spineMaterial);
    spine.position.copy(this._tileToWorld(this.mapCenter.x, this.mapBounds.maxY + 0.6, 0));
    spine.position.y = 0.06;
    group.add(spine);
    this.groundDetailMaterials.push(spineMaterial);

    const corridorMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x32455c).lerp(new THREE.Color(palette.gridMajor || 0x2e3f55), 0.15),
      metalness: 0.22,
      roughness: 0.72,
      transparent: true,
      opacity: 0.96,
    });
    corridorMaterial.userData.role = "corridor";
    this.groundDetailMaterials.push(corridorMaterial);
    const corridorTargetY = this.mapBounds.maxY + 0.6;
    this.unitDefs.forEach((def) => {
      const centerX = def.tileX + def.width / 2;
      const centerY = def.tileY + def.height / 2;
      const deltaY = corridorTargetY - centerY;
      if (Math.abs(deltaY) < 0.05) {
        return;
      }
      const length = Math.abs(deltaY) * this.tileScale;
      const corridorGeometry = new THREE.BoxGeometry(this.tileScale * 0.42, 0.08, length);
      const corridor = new THREE.Mesh(corridorGeometry, corridorMaterial.clone());
      corridor.material.userData.role = "corridor";
      corridor.position.copy(this._tileToWorld(centerX, corridorTargetY - deltaY / 2, 0));
      corridor.position.y = 0.05;
      group.add(corridor);
      this.groundDetailMaterials.push(corridor.material);
    });

    this.scene.add(group);
    this.groundDetailLayer = group;
  }

  _createStorage() {
    const spanX = this.mapBounds.maxX - this.mapBounds.minX;
    const baseX = this.mapBounds.maxX + 1.8;
    const baseY = lerp(this.mapBounds.minY, this.mapBounds.maxY, 0.5);
    const palette = this._getPalette();

    for (const entry of STORAGE_CONFIG) {
      const offsetTileX = baseX + entry.offset.x;
      const offsetTileY = baseY + entry.offset.y;
      const world = this._tileToWorld(offsetTileX, offsetTileY, 0);
      const group = new THREE.Group();
      group.position.copy(world);
      this.scene.add(group);

      const radius = 3.2;
      const height = 14;
      const shellGeometry = new THREE.CylinderGeometry(radius, radius, height, 26, 1, true);
      const shellMaterial = new THREE.MeshStandardMaterial({
        color: palette.storageShell,
        metalness: 0.35,
        roughness: 0.58,
        side: THREE.DoubleSide,
      });
      shellMaterial.userData.baseColor = new THREE.Color(shellMaterial.color.getHex());
      const shell = new THREE.Mesh(shellGeometry, shellMaterial);
      shell.position.y = height / 2;
      group.add(shell);

      const lidGeometry = new THREE.CircleGeometry(radius, 26);
      const lidMaterial = new THREE.MeshStandardMaterial({ color: palette.storageShell, metalness: 0.35, roughness: 0.45 });
      const lid = new THREE.Mesh(lidGeometry, lidMaterial);
      lid.rotation.x = -Math.PI / 2;
      lid.position.y = height + 0.02;
      group.add(lid);

      const gaugeGroup = new THREE.Group();
      const gaugeMountY = height * 0.08;
      gaugeGroup.position.set(radius + 0.8, gaugeMountY, 0);
      group.add(gaugeGroup);

      const gaugeHeight = height * 0.84;
      const gaugeWidth = radius * 0.6;

      const frameGeometry = new THREE.PlaneGeometry(gaugeWidth * 1.18, gaugeHeight + 0.4);
      const frameMaterial = new THREE.MeshBasicMaterial({
        color: palette.storageShell ? new THREE.Color(palette.storageShell).lerp(new THREE.Color(0x0c121b), 0.65) : 0x0c121b,
        transparent: true,
        opacity: 0.9,
      });
      const frame = new THREE.Mesh(frameGeometry, frameMaterial);
      frame.position.set(0, gaugeHeight * 0.5 + 0.12, -0.01);
      gaugeGroup.add(frame);

      const fillGeometry = new THREE.PlaneGeometry(gaugeWidth, gaugeHeight);
      fillGeometry.translate(0, gaugeHeight / 2, 0);
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: entry.color,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const fill = new THREE.Mesh(fillGeometry, fillMaterial);
      fill.position.z = 0.01;
      gaugeGroup.add(fill);

      const overlayGeometry = new THREE.PlaneGeometry(gaugeWidth * 1.02, gaugeHeight + 0.22);
      overlayGeometry.translate(0, gaugeHeight / 2 + 0.11, 0);
      const overlayMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
      overlay.position.z = 0.02;
      gaugeGroup.add(overlay);

      const tickMaterial = new THREE.MeshBasicMaterial({
        color: palette.storageLabels || 0xeaf2ff,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const tickGroup = new THREE.Group();
      const tickMaterials = [];
      for (let i = 0; i <= 5; i += 1) {
        const tickGeometry = new THREE.PlaneGeometry(gaugeWidth * 1.08, 0.08);
        const tick = new THREE.Mesh(tickGeometry, tickMaterial.clone());
        tick.position.set(0, (gaugeHeight / 5) * i + 0.04, 0.018);
        tickGroup.add(tick);
        tickMaterials.push(tick.material);
      }
      gaugeGroup.add(tickGroup);

      const label = createLabelSprite(entry.key.toUpperCase(), palette.storageLabels);
      label.position.set(0, height + 5, 0);
      label.scale.set(16, 4.5, 1);
      group.add(label);

      this.storageMeshes.set(entry.key, {
        key: entry.key,
        group,
        shell,
        lid,
        indicator: fill,
        gaugeGroup,
        gaugeMountY,
        gaugeFrame: frame,
        gaugeOverlay: overlay,
        gaugeTicks: tickGroup,
        gaugeTickMaterials: tickMaterials,
        gaugeHeight,
        label,
        baseRadius: radius,
        baseHeight: height,
        radius,
        baseColor: new THREE.Color(entry.color),
      });
    }
  }

  _createLogisticsZone() {
    const exportPipeline = this.pipelineDefs?.find((pipe) => pipe.id === "toExport");
    const lastPoint = exportPipeline?.path?.[exportPipeline.path.length - 1];
    const dockTileX = lastPoint?.x ?? this.mapBounds.maxX + 1.6;
    const dockTileY = lastPoint?.y ?? this.mapBounds.minY + this.mapSpan.height * 0.72;

    const laneOffset = 2.8;
    const waterLength = this.tileScale * 15.5;
    const waterWidth = this.tileScale * 7.2;
    const waterGeometry = new THREE.PlaneGeometry(waterLength, waterWidth, 1, 1);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x162b3d,
      transparent: true,
      opacity: 0.78,
      metalness: 0.16,
      roughness: 0.52,
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    const waterWorld = this._tileToWorld(dockTileX + 7.6, dockTileY + laneOffset, 0);
    water.position.copy(waterWorld);
    water.position.y = 0.018;
    this.scene.add(water);
    this.waterMesh = water;

    const quayGeometry = new THREE.PlaneGeometry(this.tileScale * 5.2, this.tileScale * 2.8);
    const quayMaterial = new THREE.MeshStandardMaterial({
      color: 0x525b66,
      metalness: 0.18,
      roughness: 0.74,
    });
    const quay = new THREE.Mesh(quayGeometry, quayMaterial);
    quay.rotation.x = -Math.PI / 2;
    const quayWorld = this._tileToWorld(dockTileX + 1.8, dockTileY + laneOffset + 0.68, 0);
    quay.position.copy(quayWorld);
    quay.position.y = 0.031;
    this.scene.add(quay);
    this.quayMesh = quay;

    const dockGeometry = new THREE.BoxGeometry(this.tileScale * 4.8, 0.6, this.tileScale * 2.1);
    const dockMaterial = new THREE.MeshStandardMaterial({
      color: 0x6c7682,
      metalness: 0.12,
      roughness: 0.74,
    });
    const dock = new THREE.Mesh(dockGeometry, dockMaterial);
    const dockWorld = this._tileToWorld(dockTileX + 1.6, dockTileY + laneOffset - 0.15, 0);
    dock.position.copy(dockWorld);
    dock.position.y = 0.32;
    this.scene.add(dock);
    this.dockMesh = dock;

    const bollardGeometry = new THREE.CylinderGeometry(0.25, 0.32, 1.2, 10);
    const bollardMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f3f6, metalness: 0.32, roughness: 0.38 });
    const bollardOffsets = [-1.2, -0.2, 0.8];
    bollardOffsets.forEach((offset) => {
      const bollard = new THREE.Mesh(bollardGeometry, bollardMaterial);
      bollard.position.set(dockWorld.x + offset * this.tileScale * 0.38, 0.9, dockWorld.z + this.tileScale * 0.88);
      this.scene.add(bollard);
    });

    const dockLight = new THREE.PointLight(0x9ac9ff, 0.5, 42, 2.2);
    dockLight.position.set(dockWorld.x - this.tileScale * 0.4, 4.2, dockWorld.z + this.tileScale * 0.4);
    this.scene.add(dockLight);
    this.dockLight = dockLight;

    const approach = this._tileToWorld(dockTileX + 10.4, dockTileY + laneOffset - 0.4, 0.12);
    const dockPosition = this._tileToWorld(dockTileX + 2.2, dockTileY + laneOffset - 0.1, 0.12);
    const depart = this._tileToWorld(dockTileX + 13.6, dockTileY + laneOffset + 0.2, 0.12);

    const dockDirection = dockPosition.clone().sub(approach).setY(0).normalize();
    const departDirection = depart.clone().sub(dockPosition).setY(0).normalize();
    if (dockDirection.lengthSq() === 0) {
      dockDirection.set(1, 0, 0);
    }
    if (departDirection.lengthSq() === 0) {
      departDirection.copy(dockDirection);
    }

    this.shipLane = {
      approach,
      dock: dockPosition,
      depart,
      dockDirection,
      departDirection,
      surfaceY: water.position.y + 0.02,
    };

    this.shipLayer = new THREE.Group();
    this.scene.add(this.shipLayer);
  }

  _updateShips(deltaSeconds, logistics = {}) {
    if (!this.shipLane) {
      return;
    }
    const shipments = Array.isArray(logistics.shipments) ? logistics.shipments : [];
    const activeIds = new Set();

    shipments.forEach((shipment) => {
      if (!shipment) {
        return;
      }
      const dueIn = typeof shipment.dueIn === "number" ? shipment.dueIn : Infinity;
      if (shipment.status === "pending" && !shipment.rush && dueIn > 18) {
        return;
      }
      const ship = this._ensureShip(shipment);
      activeIds.add(ship.id);
      this._stepShip(ship, deltaSeconds, shipment);
    });

    for (const [id, ship] of [...this.shipMeshes.entries()]) {
      if (!activeIds.has(id)) {
        this._retireShip(ship, deltaSeconds);
      }
    }
  }

  _ensureShip(shipment) {
    const id = shipment.id || `${shipment.product || "cargo"}-${shipment.createdAt || Date.now()}`;
    let ship = this.shipMeshes.get(id);
    if (ship) {
      ship.product = shipment.product || ship.product;
      return ship;
    }
    ship = this._createShip(shipment, id);
    this.shipMeshes.set(id, ship);
    return ship;
  }

  _createShip(shipment, id) {
    const group = new THREE.Group();
    const baseColorHex = SHIP_COLORS[shipment.product] || DEFAULT_SHIP_COLOR;
    const baseColor = new THREE.Color(baseColorHex);

    const hullLength = this.tileScale * 1.85;
    const hullWidth = this.tileScale * 0.56;
    const hullHeight = 0.74;

    const hullShape = new THREE.Shape();
    const halfLength = hullLength / 2;
    const halfWidth = hullWidth / 2;
    hullShape.moveTo(-halfLength * 0.95, -halfWidth * 0.7);
    hullShape.lineTo(halfLength * 0.42, -halfWidth);
    hullShape.quadraticCurveTo(halfLength * 0.62, 0, halfLength * 0.42, halfWidth);
    hullShape.lineTo(-halfLength * 0.95, halfWidth * 0.7);
    hullShape.quadraticCurveTo(-halfLength * 1.12, 0, -halfLength * 0.95, -halfWidth * 0.7);

    const hullGeometry = new THREE.ExtrudeGeometry(hullShape, {
      depth: hullHeight,
      bevelEnabled: false,
      curveSegments: 24,
      steps: 1,
    });
    hullGeometry.rotateX(-Math.PI / 2);
    hullGeometry.translate(0, hullHeight / 2, 0);
    hullGeometry.computeVertexNormals();

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().multiplyScalar(0.82),
      metalness: 0.22,
      roughness: 0.4,
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    group.add(hull);

    const waterlineGeometry = new THREE.BoxGeometry(hullLength * 0.96, hullHeight * 0.22, hullWidth * 0.88);
    const waterlineMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().multiplyScalar(0.35),
      metalness: 0.3,
      roughness: 0.48,
      transparent: true,
      opacity: 0.95,
    });
    const waterline = new THREE.Mesh(waterlineGeometry, waterlineMaterial);
    waterline.position.y = hullHeight * 0.22;
    group.add(waterline);

    const deckGeometry = new THREE.PlaneGeometry(hullLength * 0.9, hullWidth * 0.6, 1, 1);
    const deckMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().lerp(new THREE.Color(0xf7f9fc), 0.48),
      metalness: 0.1,
      roughness: 0.35,
    });
    const deck = new THREE.Mesh(deckGeometry, deckMaterial);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = hullHeight * 0.9;
    group.add(deck);

    const bridgeHeight = hullHeight * 0.58;
    const bridgeGeometry = new THREE.BoxGeometry(hullLength * 0.32, bridgeHeight, hullWidth * 0.58);
    const bridgeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f4f8,
      metalness: 0.05,
      roughness: 0.32,
    });
    const bridge = new THREE.Mesh(bridgeGeometry, bridgeMaterial);
    bridge.position.set(-hullLength * 0.18, hullHeight + bridgeHeight / 2, 0);
    group.add(bridge);

    const stackGeometry = new THREE.CylinderGeometry(hullWidth * 0.12, hullWidth * 0.18, hullHeight * 0.64, 14);
    const stackMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().lerp(new THREE.Color(0x2d3442), 0.55),
      metalness: 0.3,
      roughness: 0.44,
    });
    const stack = new THREE.Mesh(stackGeometry, stackMaterial);
    stack.position.set(-hullLength * 0.05, hullHeight + hullHeight * 0.55, 0);
    group.add(stack);

    const mastGeometry = new THREE.CylinderGeometry(0.12, 0.14, hullHeight * 1.1, 12);
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xfdfdfd, metalness: 0.18, roughness: 0.28 });
    const mast = new THREE.Mesh(mastGeometry, mastMaterial);
    mast.position.set(hullLength * 0.3, hullHeight + hullHeight * 0.75, 0);
    group.add(mast);

    const radarGeometry = new THREE.BoxGeometry(hullLength * 0.22, hullHeight * 0.08, hullWidth * 0.12);
    const radarMaterial = new THREE.MeshStandardMaterial({ color: 0xf5faff, metalness: 0.12, roughness: 0.28 });
    const radar = new THREE.Mesh(radarGeometry, radarMaterial);
    radar.position.set(hullLength * 0.3, mast.position.y + hullHeight * 0.3, 0);
    group.add(radar);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.7),
      metalness: 0.4,
      roughness: 0.25,
    });
    const railGeometry = new THREE.BoxGeometry(hullLength * 0.86, 0.06, 0.04);
    const portRail = new THREE.Mesh(railGeometry, railMaterial);
    portRail.position.set(0, hullHeight + 0.14, hullWidth * 0.34);
    group.add(portRail);
    const starboardRail = portRail.clone();
    starboardRail.position.z = -hullWidth * 0.34;
    group.add(starboardRail);

    const cargoGroup = new THREE.Group();
    const cargoMaterial = new THREE.MeshStandardMaterial({
      color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.2),
      metalness: 0.16,
      roughness: 0.52,
    });
    const segments = 3;
    for (let i = 0; i < segments; i += 1) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(hullLength * 0.2, hullHeight * 0.22, hullWidth * 0.48), cargoMaterial);
      const offset = (i - (segments - 1) / 2) * hullLength * 0.26;
      box.position.set(offset, hullHeight + hullHeight * 0.36, 0);
      cargoGroup.add(box);
    }
    group.add(cargoGroup);

    const navLight = new THREE.PointLight(baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35), 0.48, 42, 2.4);
    navLight.position.set(hullLength * 0.34, hullHeight + bridgeHeight + 0.46, 0);
    group.add(navLight);

    const labelText = (shipment.product || "cargo").toUpperCase();
    const label = createLabelSprite(labelText);
    label.scale.set(12, 3, 1);
    label.position.set(0, hullHeight + bridgeHeight + 1.4, 0);
    group.add(label);

    const wakeGeometry = new THREE.PlaneGeometry(hullWidth * 1.1, hullLength * 0.9);
    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wake = new THREE.Mesh(wakeGeometry, wakeMaterial);
    wake.rotation.x = -Math.PI / 2;
    wake.rotation.z = Math.PI / 2;
    wake.position.set(-hullLength * 0.55, waterline.position.y - hullHeight * 0.18, 0);
    group.add(wake);

    const initialPosition = this.shipLane?.approach.clone() || new THREE.Vector3();
    group.position.copy(initialPosition);
    group.position.y = (this.shipLane?.surfaceY ?? 0.04) + 0.02;

    this.shipLayer?.add(group);

    const window = Math.max(0.1, shipment.window || 1);
    const dueIn = Math.max(0, shipment.dueIn || 0);
    const status = shipment.status || "pending";
    const initialProgress =
      status === "pending"
        ? clamp(1 - dueIn / window, 0, 1) * 0.94
        : 1 + clamp(1 - (shipment.cooldown || 0) / Math.max(shipment.cooldown || 0.01, 0.01), 0, 1);

    return {
      id,
      product: shipment.product || "cargo",
      group,
      hull,
      deck,
      bridge,
      mast,
      rails: [portRail, starboardRail],
      cargo: cargoGroup,
      wake,
      light: navLight,
      label,
      baseColor,
      status,
      progress: clamp(initialProgress, 0, 1.8),
      targetProgress: clamp(initialProgress, 0, 1.8),
      bobPhase: Math.random() * Math.PI * 2,
      cooldownOrigin: shipment.cooldown || 0,
      retireTimer: 0,
    };
  }

  _stepShip(ship, deltaSeconds, shipment) {
    const status = shipment.status || "pending";
    if (ship.status !== status) {
      ship.status = status;
      if (status !== "pending") {
        ship.cooldownOrigin = shipment.cooldown || ship.cooldownOrigin || 0;
      }
    }

    ship.bobPhase += deltaSeconds * 1.35;
    const bob = Math.sin(ship.bobPhase) * 0.16;

    if (status === "pending") {
      const window = Math.max(0.1, shipment.window || 1);
      const dueIn = Math.max(0, shipment.dueIn || 0);
      ship.targetProgress = clamp(1 - dueIn / window, 0, 1);
    } else {
      const origin = ship.cooldownOrigin || shipment.cooldown || 0.01;
      const remaining = Math.max(0, shipment.cooldown || 0);
      const departProgress = origin > 0 ? clamp(1 - remaining / origin, 0, 1) : 1;
      ship.targetProgress = 1 + departProgress;
    }

    ship.progress += (ship.targetProgress - ship.progress) * Math.min(1, deltaSeconds * 2.4);
    ship.progress = clamp(ship.progress, 0, 2.2);

    const colorTarget =
      status === "missed"
        ? new THREE.Color(0xb34b4b)
        : status === "completed"
        ? ship.baseColor.clone().lerp(new THREE.Color(0xffffff), 0.15)
        : ship.baseColor;
    ship.hull.material.color.lerp(colorTarget, clamp(deltaSeconds * 2.5, 0, 1));
    ship.light.intensity = status === "missed" ? 0.3 : status === "pending" ? 0.5 : 0.38;

    this._positionShip(ship, ship.progress, bob);
    if (ship.wake?.material) {
      const underway = ship.progress < 0.95 && ship.targetProgress > ship.progress + 0.02;
      const departing = ship.progress > 1.02;
      const wakeOpacity = underway || departing ? 0.22 : 0.08;
      ship.wake.material.opacity = wakeOpacity;
    }
    ship.retireTimer = 0;
  }

  _positionShip(ship, progress, bob = 0) {
    if (!this.shipLane) {
      return;
    }
    const approach = this.shipLane.approach;
    const dock = this.shipLane.dock;
    const depart = this.shipLane.depart;

    const clampedProgress = Math.max(0, progress);
    let position;
    let direction;
    if (clampedProgress <= 1) {
      const t = easeInOut(clamp(clampedProgress, 0, 1));
      position = approach.clone().lerp(dock, t);
      direction = this.shipLane.dockDirection;
    } else {
      const leaveProgress = clamp(clampedProgress - 1, 0, 1);
      const t = easeInOut(leaveProgress);
      position = dock.clone().lerp(depart, t);
      direction = this.shipLane.departDirection;
    }

    ship.group.position.x = position.x;
    ship.group.position.z = position.z;
    ship.group.position.y = (this.shipLane.surfaceY ?? 0.04) + bob;
    const yaw = Math.atan2(direction.x, direction.z);
    ship.group.rotation.y = yaw;
  }

  _retireShip(ship, deltaSeconds) {
    ship.retireTimer = (ship.retireTimer || 0) + deltaSeconds;
    ship.bobPhase += deltaSeconds * 1.2;
    const bob = Math.sin(ship.bobPhase) * 0.12;
    ship.progress += deltaSeconds * 0.45;
    ship.progress = Math.min(ship.progress, 2.3);
    ship.hull.material.color.lerp(ship.baseColor.clone().multiplyScalar(0.9), clamp(deltaSeconds * 1.5, 0, 1));
    ship.light.intensity = Math.max(0.2, ship.light.intensity - deltaSeconds * 0.1);
    this._positionShip(ship, ship.progress, bob);
    if (ship.wake?.material) {
      ship.wake.material.opacity = Math.max(0.04, ship.wake.material.opacity - deltaSeconds * 0.06);
    }
    if (ship.retireTimer > 5.5) {
      this._removeShip(ship.id);
    }
  }

  _removeShip(id) {
    const ship = typeof id === "string" ? this.shipMeshes.get(id) : id;
    if (!ship) {
      return;
    }
    this.shipLayer?.remove(ship.group);
    ship.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      } else if (child.isSprite) {
        child.material?.map?.dispose?.();
        child.material?.dispose?.();
      }
      if (child.isLight && typeof child.dispose === "function") {
        child.dispose();
      }
    });
    this.shipMeshes.delete(ship.id);
  }

  _updateCamera() {
    const polar = clamp(this.cameraAngles.polar, 0.2, 1.45);
    const azimuth = this.cameraAngles.azimuth;
    const distance = this.cameraDistance;
    const target = this.cameraTarget;

    const sinPhi = Math.sin(polar);
    const cosPhi = Math.cos(polar);
    const sinTheta = Math.sin(azimuth);
    const cosTheta = Math.cos(azimuth);

    const x = target.x + distance * sinPhi * cosTheta;
    const y = target.y + distance * cosPhi;
    const z = target.z + distance * sinPhi * sinTheta;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(target);
  }

  _applyPalette(initial) {
    const palette = this._getPalette();
    if (this.scene?.background) {
      this.scene.background.set(palette.sky);
    }
    if (this.ground?.material) {
      this.ground.material.color.set(palette.ground);
    }
    if (this.gridHelper) {
      const materials = Array.isArray(this.gridHelper.material)
        ? this.gridHelper.material
        : [this.gridHelper.material];
      materials.forEach((material, index) => {
        const color = index === 0 ? palette.gridMajor : palette.gridMinor;
        material.color.set(color);
        material.opacity = 0.28;
        material.transparent = true;
      });
    }
    if (this.ambientLight) {
      this.ambientLight.color.set(palette.ambientTop);
      if (this.ambientLight.groundColor) {
        this.ambientLight.groundColor.set(palette.ambientBottom);
      }
    }
    if (this.sunLight) {
      this.sunLight.color.set(palette.sun);
    }
    if (this.pointerMesh?.material) {
      this.pointerMesh.material.color.set(palette.pointer);
    }
    if (this.waterMesh?.material) {
      const waterBase = new THREE.Color(palette.flowLow || 0x1a5d8f);
      this.waterMesh.material.color.copy(waterBase.lerp(new THREE.Color(0x162b3d), 0.45));
    }
    if (this.dockApron?.color) {
      this.dockApron.color.copy(new THREE.Color(palette.ground || 0x1b2736).lerp(new THREE.Color(0x1f2c3b), 0.28));
    }
    if (this.dockMesh?.material) {
      const dockBase = new THREE.Color(palette.storageShell || 0x6c7682);
      this.dockMesh.material.color.copy(dockBase.lerp(new THREE.Color(0x88929f), 0.4));
    }
    if (this.dockLight) {
      this.dockLight.color = new THREE.Color(palette.flowHigh || 0xaad0ff);
    }
    if (this.quayMesh?.material) {
      const quayColor = new THREE.Color(palette.storageShell || 0x6c7682).lerp(new THREE.Color(0x4e5965), 0.35);
      this.quayMesh.material.color.copy(quayColor);
    }
    for (const unit of this.unitMeshes?.values?.() || []) {
      if (unit.padMaterial?.color) {
        unit.padMaterial.color.copy(new THREE.Color(palette.ground || 0x1b2736).lerp(new THREE.Color(0x283749), 0.4));
      }
    }
    for (const tank of this.storageMeshes.values()) {
      if (tank.gaugeFrame?.material) {
        const frameColor = palette.storageShell ? new THREE.Color(palette.storageShell).lerp(new THREE.Color(0x0c121b), 0.65) : new THREE.Color(0x0c121b);
        tank.gaugeFrame.material.color.copy(frameColor);
      }
      if (Array.isArray(tank.gaugeTickMaterials)) {
        tank.gaugeTickMaterials.forEach((material) => {
          if (!material?.color) {
            return;
          }
          material.color.copy(new THREE.Color(palette.storageLabels || 0xeaf2ff));
        });
      }
    }
    if (Array.isArray(this.groundDetailMaterials)) {
      this.groundDetailMaterials.forEach((material) => {
        if (!material || !material.color) {
          return;
        }
        const role = material.userData?.role;
        switch (role) {
          case "apron":
            material.color.copy(new THREE.Color(palette.ground || 0x1b2736).lerp(new THREE.Color(0x1f2c3b), 0.28));
            break;
          case "lattice":
            material.color.copy(new THREE.Color(palette.gridMinor || 0x233244).lerp(new THREE.Color(0x415064), 0.35));
            material.opacity = 0.24;
            break;
          case "spine":
            material.color.copy(new THREE.Color(0x28384c).lerp(new THREE.Color(palette.gridMajor || 0x2e3f55), 0.25));
            break;
          case "corridor":
            material.color.copy(new THREE.Color(0x32455c).lerp(new THREE.Color(palette.gridMajor || 0x2e3f55), 0.15));
            break;
          default:
            break;
        }
      });
    }
    if (!initial) {
      for (const pipeline of this.pipelineMeshes.values()) {
        pipeline.mesh.material.color.copy(pipeline.baseColor);
        pipeline.glow.material.color.copy(pipeline.baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35));
      }
      for (const tank of this.storageMeshes.values()) {
        const material = tank.label.material;
        const oldMap = material.map;
        const newMap = makeLabelTexture(tank.key.toUpperCase(), palette.storageLabels);
        material.map = newMap;
        material.needsUpdate = true;
        if (oldMap) {
          oldMap.dispose?.();
        }
      }
    }
  }

  _tileToWorld(tileX, tileY, height = 0) {
    const centeredX = (tileX - this.mapCenter.x) * this.tileScale;
    const centeredY = (tileY - this.mapCenter.y) * this.tileScale;
    return new THREE.Vector3(centeredX, height, centeredY);
  }

  _getPalette() {
    return PALETTES[this.paletteIndex] || PALETTES[0];
  }
}

function lerpColor(a, b, t) {
  const colorA = a instanceof THREE.Color ? a : new THREE.Color(a);
  const colorB = b instanceof THREE.Color ? b : new THREE.Color(b);
  return colorA.clone().lerp(colorB, clamp(t, 0, 1));
}

function createLabelSprite(text, fill = 0xf0f6ff) {
  const texture = makeLabelTexture(text, fill);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(22, 5.5, 1);
  return sprite;
}

function makeLabelTexture(text, fillColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(10, 16, 26, 0.68)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = typeof fillColor === "number" ? `#${fillColor.toString(16).padStart(6, "0")}` : fillColor;
  ctx.font = "32px 'Inter', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else {
    texture.encoding = THREE.sRGBEncoding;
  }
  texture.needsUpdate = true;
  return texture;
}

function easeInOut(t) {
  const clamped = clamp(t, 0, 1);
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}
