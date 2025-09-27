import * as THREE from "../vendor/three.module.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, t) => start + (end - start) * t;

const DEFAULT_OPTIONS = {
  interactionEnabled: true,
};

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
      const level = storageLevels[tank.key] || 0;
      const capacity = storageCap[tank.key] || 1;
      const ratio = capacity ? clamp(level / capacity, 0, 1) : 0;
      tank.fill.scale.y = Math.max(ratio, 0.02);
      tank.fill.position.y = tank.baseHeight * tank.fill.scale.y * 0.5 + 0.05;
      const emissiveIntensity = 0.25 + ratio * 1.5;
      tank.fill.material.emissiveIntensity = emissiveIntensity;
      tank.label.material.opacity = 0.75 + ratio * 0.25;
    }

    for (const [pipelineId, pipeline] of this.pipelineMeshes.entries()) {
      const metricValue = flows[pipeline.metric] || 0;
      const ratio = pipeline.capacity ? clamp(metricValue / pipeline.capacity, 0, 2) : 0;
      const highlighted = this.highlightedPipelines.has(pipelineId);
      const baseIntensity = highlighted ? 0.4 : 0.14;
      const dynamicIntensity = this.flowVisible ? ratio * (highlighted ? 2.2 : 1.4) : 0.05;
      const wave = 0.08 + Math.sin(this.time * 3 + pipeline.phase) * 0.06;

      pipeline.mesh.material.emissiveIntensity = baseIntensity + dynamicIntensity * 0.6;
      pipeline.glow.material.emissiveIntensity = this.flowVisible ? baseIntensity * 0.8 + dynamicIntensity : 0.0;
      pipeline.glow.scale.setScalar(1 + ratio * 0.12 + wave + (highlighted ? 0.08 : 0));
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

  _computeBounds() {
    const xs = [];
    const ys = [];
    for (const unit of this.unitDefs) {
      xs.push(unit.tileX, unit.tileX + unit.width);
      ys.push(unit.tileY, unit.tileY + unit.height);
    }
    for (const pipeline of this.pipelineDefs) {
      for (const point of pipeline.path || []) {
        xs.push(point.x);
        ys.push(point.y);
      }
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
    this._createStorage();
  }

  _createUnits() {
    const footprintScale = this.tileScale * 0.82;
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

      const bodyGeometry = new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: def.color,
        metalness: 0.28,
        roughness: 0.62,
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = baseHeight / 2;
      group.add(body);

      const capGeometry = new THREE.BoxGeometry(baseWidth * 0.78, baseHeight * 0.32, baseDepth * 0.78);
      const capMaterial = new THREE.MeshStandardMaterial({
        color: def.accent,
        metalness: 0.25,
        roughness: 0.46,
      });
      const cap = new THREE.Mesh(capGeometry, capMaterial);
      cap.position.y = baseHeight + capGeometry.parameters.height / 2 - 0.4;
      group.add(cap);

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
      indicator.position.y = baseHeight * 0.62;
      group.add(indicator);

      const highlightGeometry = new THREE.CylinderGeometry(Math.max(baseWidth, baseDepth) * 0.55, Math.max(baseWidth, baseDepth) * 0.55, 0.6, 38, 1, true);
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

      const label = createLabelSprite(def.name);
      label.position.set(0, baseHeight + 6, 0);
      group.add(label);

      this.unitMeshes.set(def.id, {
        group,
        body,
        cap,
        indicator,
        highlight,
        label,
        baseColor: new THREE.Color(def.color),
        accentColor: new THREE.Color(def.accent),
      });
    }
  }

  _createPipelines() {
    for (const def of this.pipelineDefs) {
      const points = (def.path || []).map((pt) => this._tileToWorld(pt.x, pt.y, 0.6));
      if (points.length < 2) {
        continue;
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.08);
      const segments = Math.max(points.length * 12, 64);
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

      const radius = Math.max(2.6, spanX * 0.08);
      const height = 14;
      const shellGeometry = new THREE.CylinderGeometry(radius, radius, height, 26, 1, true);
      const shellMaterial = new THREE.MeshStandardMaterial({
        color: palette.storageShell,
        metalness: 0.35,
        roughness: 0.58,
        side: THREE.DoubleSide,
      });
      const shell = new THREE.Mesh(shellGeometry, shellMaterial);
      shell.position.y = height / 2;
      group.add(shell);

      const lidGeometry = new THREE.CircleGeometry(radius, 26);
      const lidMaterial = new THREE.MeshStandardMaterial({ color: palette.storageShell, metalness: 0.35, roughness: 0.45 });
      const lid = new THREE.Mesh(lidGeometry, lidMaterial);
      lid.rotation.x = -Math.PI / 2;
      lid.position.y = height + 0.02;
      group.add(lid);

      const fillGeometry = new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, height, 26, 1, true);
      const fillMaterial = new THREE.MeshStandardMaterial({
        color: entry.color,
        emissive: new THREE.Color(entry.color).multiplyScalar(0.22),
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.78,
        metalness: 0.1,
        roughness: 0.42,
      });
      const fill = new THREE.Mesh(fillGeometry, fillMaterial);
      fill.scale.y = 0.1;
      fill.position.y = height * 0.05;
      group.add(fill);

      const label = createLabelSprite(entry.key.toUpperCase(), palette.storageLabels);
      label.position.set(0, height + 5, 0);
      label.scale.set(16, 4.5, 1);
      group.add(label);

      this.storageMeshes.set(entry.key, {
        key: entry.key,
        group,
        fill,
        label,
        baseHeight: height,
      });
    }
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
