const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const randomRange = (min, max) => min + Math.random() * (max - min);

const PRODUCT_LABELS = {
  gasoline: "gasoline",
  diesel: "diesel",
  jet: "jet fuel",
};

const HOURS_PER_DAY = 24;
const perDayToPerHour = (value) => value / HOURS_PER_DAY;
const perHourToPerDay = (value) => value * HOURS_PER_DAY;

const SHIPMENT_PARCEL_SIZES = {
  gasoline: 44,
  diesel: 36,
  jet: 30,
};

const SHIPMENT_HORIZON_HOURS = 48;
const BASE_CRUDE_THROUGHPUT = 120;

export class RefinerySimulation {
  constructor() {
    this.timeMinutes = 0;
    this.tickInterval = 1; // simulated minute per tick
    this.baseSpeed = 35; // simulated minutes per real second at 1×
    this.speedMultiplier = 1;
    this.minSpeedMultiplier = 0.25;
    this.maxSpeedMultiplier = 4;
    this.speed = this.baseSpeed * this.speedMultiplier;
    this.speedPresets = [
      { label: "0.25x", value: 0.25 },
      { label: "0.5x", value: 0.5 },
      { label: "1x", value: 1 },
      { label: "2x", value: 2 },
      { label: "4x", value: 4 },
    ];
    this._accumulator = 0;
    this.running = true;
    this.stepOnce = false;

    this.params = {
      crudeIntake: 120, // kbpd
      productFocus: 0.5, // 0 diesel, 1 gasoline
      maintenance: 0.65,
      safety: 0.45,
      environment: 0.35,
    };

    this.scenarios = this._createScenarios();
    this.activeScenarioKey = "steady";
    this.activeScenario = this.scenarios[this.activeScenarioKey];

    this.units = this._createUnits();
    this.unitMap = Object.fromEntries(this.units.map((unit) => [unit.id, unit]));

    this.metrics = {
      gasoline: 0,
      diesel: 0,
      jet: 0,
      lpg: 0,
      profitPerHour: 0,
      revenuePerDay: 0,
      expensePerDay: 0,
      operatingExpensePerDay: 0,
      crudeExpensePerDay: 0,
      penaltyPerDay: 0,
      marginMultiplier: 1,
      futuresGasoline: 0,
      futuresDiesel: 0,
      futuresJet: 0,
      costGasoline: 0,
      costDiesel: 0,
      costJet: 0,
      basisGasoline: 0,
      basisDiesel: 0,
      basisJet: 0,
      reliability: 1,
      carbon: 0,
      waste: 0,
      flareLevel: 0,
      operationalStrain: 0,
      incidents: 0,
      score: 0,
      grade: "B",
      scoreNote: "Plant stabilizing…",
      scoreDelta: 0,
      storageGasoline: 0,
      storageDiesel: 0,
      storageJet: 0,
      storageUtilization: 0,
      shipmentReliability: 1,
      directivesCompleted: 0,
      directiveReliability: 1,
    };

    this.marketStress = 0.16;
    this.pendingOperationalCost = 0;
    this.logisticsRushCooldown = 0;
    this.pipelineBoosts = {};

    this.flows = {
      toReformer: 0,
      toCracker: 0,
      toHydrocracker: 0,
      toAlkylation: 0,
      toExport: 0,
    };

    this.performanceHistory = [];
    this.market = this._initMarketState();

    this.storage = this._initStorage();
    this.storageBaseCapacity = { ...this.storage.capacity };
    this.storageAlertCache = this._createStorageAlertCache();
    this.shipments = [];
    this.shipmentStats = { total: 0, onTime: 0, missed: 0 };
    this.nextShipmentIn = 0;
    this.storagePressure = { active: false, throttle: 1, timer: 0, lastRatio: 0 };
    this.extraShipmentCooldown = 0;
    this.storageUpgrades = { level: 0 };
    this.directives = [];
    this.directiveStats = { total: 0, completed: 0, failed: 0 };
    this._seedDirectives();

    this.shipmentHorizonHours = SHIPMENT_HORIZON_HOURS;
    this.operationalStrain = 0;

    this.unitOverrides = {};
    this.emergencyShutdown = false;
    this.processTopology = this._createTopology();

    this.logs = [];
    this.pushLog(
      "info",
      "Simulation initialized. Adjust the sliders to explore the refinery."
    );

    this._environmentPenaltyCooldown = 0;
    this._lastShipmentScheduled = { gasoline: -Infinity, diesel: -Infinity, jet: -Infinity };

    this._ensureScheduledShipments(this.shipmentHorizonHours);
    this._updateNextShipmentCountdown();

    this.recorder = this._createRecorderState();
    this.lastRecordingSummary = null;
  }

  _createScenarios() {
    return {
      steady: {
        key: "steady",
        name: "Steady Operations",
        description: "Balanced demand and average Bay Area crude quality.",
        crudeMultiplier: 1,
        qualityShift: 0,
        priceModifier: 1,
        gasolineBias: 0,
        dieselBias: 0,
        jetBias: 0,
        riskMultiplier: 1,
        maintenancePenalty: 0,
        environmentPressure: 0.2,
      },
      summerRush: {
        key: "summerRush",
        name: "Summer Driving Rush",
        description:
          "Gasoline demand surges with tourist traffic. Lighter crudes are available but the plant runs hot.",
        crudeMultiplier: 1.05,
        qualityShift: -0.05,
        priceModifier: 1.08,
        gasolineBias: 0.24,
        dieselBias: -0.12,
        jetBias: -0.05,
        riskMultiplier: 1.12,
        maintenancePenalty: 0.05,
        environmentPressure: 0.1,
      },
      winterDiesel: {
        key: "winterDiesel",
        name: "Winter Heating Demand",
        description:
          "Heating oil and diesel spike while heavy, sour crude dominates supply.",
        crudeMultiplier: 0.95,
        qualityShift: 0.08,
        priceModifier: 1.02,
        gasolineBias: -0.1,
        dieselBias: 0.28,
        jetBias: -0.04,
        riskMultiplier: 1.2,
        maintenancePenalty: 0.12,
        environmentPressure: 0.28,
      },
      exportPush: {
        key: "exportPush",
        name: "Pacific Jet Fuel Push",
        description:
          "Airlines pre-buy jet fuel for Pacific routes. Margins improve for kerosene and hydrogen-hungry units.",
        crudeMultiplier: 1,
        qualityShift: -0.02,
        priceModifier: 1.06,
        gasolineBias: -0.04,
        dieselBias: -0.08,
        jetBias: 0.32,
        riskMultiplier: 1.15,
        maintenancePenalty: 0.08,
        environmentPressure: 0.18,
      },
      maintenanceCrunch: {
        key: "maintenanceCrunch",
        name: "Deferred Maintenance",
        description:
          "Budget cuts delayed turnarounds. Equipment is fragile and utilities are strained.",
        crudeMultiplier: 0.9,
        qualityShift: 0.05,
        priceModifier: 0.97,
        gasolineBias: 0,
        dieselBias: 0.05,
        jetBias: 0,
        riskMultiplier: 1.45,
        maintenancePenalty: 0.3,
        environmentPressure: 0.35,
      },
      quakeDrill: {
        key: "quakeDrill",
        name: "Earthquake Drill",
        description:
          "A simulated quake tests emergency response. Utilities cut, shipments disrupted, and accidents spike.",
        crudeMultiplier: 0.82,
        qualityShift: 0.12,
        priceModifier: 1.11,
        gasolineBias: -0.06,
        dieselBias: 0.12,
        jetBias: 0,
        riskMultiplier: 1.85,
        maintenancePenalty: 0.42,
        environmentPressure: 0.42,
      },
    };
  }

  _initMarketState() {
    const baseFutures = {
      gasoline: 112,
      diesel: 96,
      jet: 108,
    };
    const productionCost = {
      gasoline: 78,
      diesel: 74,
      jet: 81,
    };
    return {
      futures: { ...baseFutures },
      productionCost: { ...productionCost },
      basis: {
        gasoline: baseFutures.gasoline - productionCost.gasoline,
        diesel: baseFutures.diesel - productionCost.diesel,
        jet: baseFutures.jet - productionCost.jet,
      },
      drift: {
        gasoline: 0,
        diesel: 0,
        jet: 0,
      },
      updatedAt: this.timeMinutes || 0,
    };
  }

  _createUnits() {
    return [
      this._unit("distillation", "Crude Distillation Unit", 180, "core"),
      this._unit("reformer", "Naphtha Reformer", 60, "naphtha"),
      this._unit("fcc", "Catalytic Cracker", 85, "conversion"),
      this._unit("hydrocracker", "Hydrocracker", 65, "conversion"),
      this._unit("alkylation", "Alkylation", 45, "finishing"),
      this._unit("sulfur", "Sulfur Recovery", 35, "support"),
    ];
  }

  _createTopology() {
    return {
      distillation: {
        name: "Crude Distillation Unit",
        summary: "Primary separation of crude into gas, naphtha, kerosene, diesel, and resid pools.",
        feeds: [{ label: "Crude feed", kind: "feed" }],
        outputs: [
          { label: "Naphtha to Reformer", unit: "reformer", pipeline: "toReformer" },
          { label: "Heavy gas oil to FCC", unit: "fcc", pipeline: "toCracker" },
          { label: "VGO / resid to Hydrocracker", unit: "hydrocracker", pipeline: "toHydrocracker" },
          { label: "LPG cut to Alkylation", unit: "alkylation", pipeline: "toAlkylation" },
        ],
      },
      reformer: {
        name: "Naphtha Reformer",
        summary: "Upgrades naphtha into high-octane reformate and generates hydrogen for other units.",
        feeds: [{ label: "Naphtha from CDU", unit: "distillation", pipeline: "toReformer" }],
        outputs: [
          { label: "Reformate to gasoline pool", kind: "product", pipeline: "toExport" },
          { label: "Hydrogen to Hydrocracker", unit: "hydrocracker" },
        ],
      },
      fcc: {
        name: "Catalytic Cracker",
        summary: "Cracks heavy gas oils into lighter products with high gasoline yield.",
        feeds: [{ label: "Heavy gas oil / resid", unit: "distillation", pipeline: "toCracker" }],
        outputs: [
          { label: "Blendstock to gasoline", kind: "product", pipeline: "toExport" },
          { label: "Cycle oil to diesel pool", kind: "product", pipeline: "toExport" },
          { label: "LPG to Alkylation", unit: "alkylation" },
        ],
      },
      hydrocracker: {
        name: "Hydrocracker",
        summary: "Adds hydrogen to heavier fractions for jet and diesel production.",
        feeds: [
          { label: "VGO / resid", unit: "distillation", pipeline: "toHydrocracker" },
          { label: "Hydrogen from Reformer", unit: "reformer" },
        ],
        outputs: [
          { label: "Jet fuel blend", kind: "product", pipeline: "toExport" },
          { label: "Premium diesel", kind: "product", pipeline: "toExport" },
          { label: "Gasoline upgrade", kind: "product", pipeline: "toExport" },
        ],
      },
      alkylation: {
        name: "Alkylation",
        summary: "Combines light olefins and isobutane into high-octane alkylate.",
        feeds: [
          { label: "LPG from CDU / FCC", unit: "distillation", pipeline: "toAlkylation" },
          { label: "LPG from FCC", unit: "fcc" },
        ],
        outputs: [
          { label: "Alkylate to gasoline", kind: "product" },
          { label: "Excess LPG to export", pipeline: "toExport" },
        ],
      },
      sulfur: {
        name: "Sulfur Recovery",
        summary: "Pulls sulfur out of resid streams to keep emissions under control.",
        feeds: [{ label: "Sour resid / offgas", unit: "distillation" }],
        outputs: [{ label: "Recovered sulfur", kind: "byproduct" }],
      },
    };
  }

  _unit(id, name, capacity, category) {
    return {
      id,
      name,
      capacity,
      category,
      throughput: 0,
      utilization: 0,
      integrity: 1,
      downtime: 0,
      status: "online",
      incidents: 0,
      alert: null,
      alertTimer: 0,
      manualOffline: false,
      emergencyOffline: false,
      overrideThrottle: 1,
      alertDetail: null,
      lastIncident: null,
    };
  }

  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
    }
  }
  getSpeedMultiplier() {
    return this.speedMultiplier;
  }

  getSpeedState() {
    return {
      multiplier: this.speedMultiplier,
      min: this.minSpeedMultiplier,
      max: this.maxSpeedMultiplier,
      baseMinutesPerSecond: this.baseSpeed,
      minutesPerSecond: this.speed,
      presets: this.speedPresets.map((entry) => ({ ...entry })),
    };
  }

  cycleSpeedPreset(direction = 1) {
    if (!Array.isArray(this.speedPresets) || this.speedPresets.length === 0) {
      return this.speedMultiplier;
    }
    const sorted = [...this.speedPresets].sort((a, b) => a.value - b.value);
    const currentValue = this.speedMultiplier;
    let index = sorted.findIndex((entry) => Math.abs(entry.value - currentValue) < 1e-3);
    if (index === -1) {
      index = sorted.findIndex((entry) => entry.value > currentValue);
      if (index === -1) {
        index = sorted.length - 1;
      }
    }
    const nextIndex = clamp(index + Math.sign(direction || 1), 0, sorted.length - 1);
    return this.setSpeedMultiplier(sorted[nextIndex].value);
  }

  setSpeedFromPreset(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return this.speedMultiplier;
    }
    return this.setSpeedMultiplier(value);
  }

  setSpeedMultiplier(multiplier) {
    const value = typeof multiplier === "number" && Number.isFinite(multiplier) ? multiplier : 1;
    const clamped = clamp(value, this.minSpeedMultiplier, this.maxSpeedMultiplier);
    this.speedMultiplier = clamped;
    this.speed = this.baseSpeed * this.speedMultiplier;
    return this.speedMultiplier;
  }

  adjustSpeedMultiplier(delta) {
    const change = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
    return this.setSpeedMultiplier(this.speedMultiplier + change);
  }

  applyScenario(key) {
    if (this.scenarios[key]) {
      this.activeScenarioKey = key;
      this.activeScenario = this.scenarios[key];
      this.pushLog(
        "info",
        `${this.activeScenario.name} scenario engaged. ${this.activeScenario.description}`
      );
    }
  }

  toggleRunning() {
    this.running = !this.running;
    return this.running;
  }

  requestStep() {
    if (!this.running) {
      this.stepOnce = true;
    }
  }

  reset() {
    this.timeMinutes = 0;
    this._accumulator = 0;
    this.running = true;
    this.stepOnce = false;
    this.speedMultiplier = 1;
    this.speed = this.baseSpeed;
    this.metrics = {
      gasoline: 0,
      diesel: 0,
      jet: 0,
      lpg: 0,
      profitPerHour: 0,
      revenuePerDay: 0,
      expensePerDay: 0,
      operatingExpensePerDay: 0,
      crudeExpensePerDay: 0,
      penaltyPerDay: 0,
      marginMultiplier: 1,
      futuresGasoline: 0,
      futuresDiesel: 0,
      futuresJet: 0,
      costGasoline: 0,
      costDiesel: 0,
      costJet: 0,
      basisGasoline: 0,
      basisDiesel: 0,
      basisJet: 0,
      reliability: 1,
      carbon: 0,
      waste: 0,
      flareLevel: 0,
      operationalStrain: 0,
      incidents: 0,
      score: 0,
      grade: "B",
      scoreNote: "Plant stabilizing…",
      scoreDelta: 0,
      storageGasoline: 0,
      storageDiesel: 0,
      storageJet: 0,
      storageUtilization: 0,
      shipmentReliability: 1,
      directivesCompleted: 0,
      directiveReliability: 1,
    };
    this.flows = {
      toReformer: 0,
      toCracker: 0,
      toHydrocracker: 0,
      toAlkylation: 0,
      toExport: 0,
    };
    this.marketStress = 0.16;
    this.pendingOperationalCost = 0;
    this.logisticsRushCooldown = 0;
    this.pipelineBoosts = {};
    this.storage = this._initStorage();
    this.storageBaseCapacity = { ...this.storage.capacity };
    this.storageAlertCache = this._createStorageAlertCache();
    this.shipments = [];
    this.shipmentStats = { total: 0, onTime: 0, missed: 0 };
    this.nextShipmentIn = 0;
    this.storagePressure = { active: false, throttle: 1, timer: 0, lastRatio: 0 };
    this.extraShipmentCooldown = 0;
    this.storageUpgrades = { level: 0 };
    this.directives = [];
    this.directiveStats = { total: 0, completed: 0, failed: 0 };
    this._seedDirectives();
    this.shipmentHorizonHours = SHIPMENT_HORIZON_HOURS;
    this.operationalStrain = 0;
    this.unitOverrides = {};
    this.emergencyShutdown = false;
    this.units.forEach((unit) => {
      unit.throughput = 0;
      unit.utilization = 0;
      unit.integrity = 1;
      unit.downtime = 0;
      unit.status = "online";
      unit.incidents = 0;
      unit.alert = null;
      unit.alertTimer = 0;
      unit.manualOffline = false;
      unit.emergencyOffline = false;
      unit.overrideThrottle = 1;
      unit.alertDetail = null;
      unit.lastIncident = null;
    });
    this.performanceHistory = [];
    this.market = this._initMarketState();
    this.logs = [];
    this._environmentPenaltyCooldown = 0;
    this._lastShipmentScheduled = { gasoline: -Infinity, diesel: -Infinity, jet: -Infinity };
    this._ensureScheduledShipments(this.shipmentHorizonHours);
    this._updateNextShipmentCountdown();
    this.recorder = this._createRecorderState();
    this.lastRecordingSummary = null;
    this.pushLog(
      "info",
      "Simulation reset. Systems stabilized at baseline steady-state."
    );
  }

  pushLog(level, message, meta = {}) {
    const timestamp = this._formatTime();
    this.logs.push({ level, message, timestamp, ...meta });
    if (this.logs.length > 80) {
      this.logs.splice(0, this.logs.length - 80);
    }
  }

  getLogs() {
    return [...this.logs].reverse();
  }

  getScenarioList() {
    return Object.values(this.scenarios);
  }

  getMarketState() {
    if (!this.market) {
      this.market = this._initMarketState();
    }
    return {
      futures: { ...this.market.futures },
      productionCost: { ...this.market.productionCost },
      basis: { ...this.market.basis },
    };
  }

  update(deltaSeconds) {
    if (!this.running && !this.stepOnce) {
      return;
    }

    this._accumulator += deltaSeconds * this.speed;

    while (this._accumulator >= this.tickInterval) {
      this._accumulator -= this.tickInterval;
      this._advanceTick(this.tickInterval);

      if (this.stepOnce) {
        this.stepOnce = false;
        this.running = false;
        break;
      }

      if (!this.running) {
        break;
      }
    }
  }

  _advanceTick(deltaMinutes) {
    this.timeMinutes += deltaMinutes;
    const hours = deltaMinutes / 60;

    this.logisticsRushCooldown = Math.max(0, this.logisticsRushCooldown - hours);
    this.extraShipmentCooldown = Math.max(0, (this.extraShipmentCooldown || 0) - hours);
    this._prunePipelineBoosts();
    const extraOperationalCost = this._consumeOperationalCost();

    const scenario = this.activeScenario;
    const storageThrottle = this.storagePressure?.throttle ?? 1;
    const crudeDailyTarget =
      this.params.crudeIntake * scenario.crudeMultiplier * storageThrottle;
    const crudeAvailable = perDayToPerHour(crudeDailyTarget);

    const distState = this._resolveUnitState("distillation");
    const distillation = distState.unit;
    const distCapacity =
      distillation && distState.online
        ? perDayToPerHour(distillation.capacity) * clamp(distState.throttle, 0, 1.2)
        : 0;
    const crudeThroughput = Math.min(crudeAvailable, distCapacity);
    const crudeThroughputPerDay = perHourToPerDay(crudeThroughput);
    if (distillation) {
      distillation.throughput = crudeThroughputPerDay;
      distillation.utilization = distillation.capacity
        ? distillation.throughput / Math.max(1, distillation.capacity)
        : 0;
      this._updateUnitMode(distillation);
    }

    const focus = clamp(this.params.productFocus, 0, 1);
    const centered = focus - 0.5;

    let gasShare = clamp(0.08 + centered * 0.05, 0.035, 0.16);
    let naphthaShare = clamp(0.36 + centered * 0.25, 0.26, 0.55);
    let keroseneShare = 0.11 + scenario.jetBias * 0.05;
    let dieselShare = clamp(0.27 - centered * 0.14 + scenario.dieselBias * 0.06, 0.18, 0.36);
    let heavyShare = clamp(0.17 - centered * 0.06, 0.11, 0.26);

    let residShare = Math.max(
      0.06,
      1 - (gasShare + naphthaShare + keroseneShare + dieselShare + heavyShare)
    );

    const qualityShift = scenario.qualityShift;
    if (qualityShift !== 0) {
      const heavyAdjust = 1 + qualityShift;
      naphthaShare *= 1 - 0.35 * qualityShift;
      dieselShare *= 1 - 0.18 * qualityShift;
      heavyShare *= heavyAdjust;
      residShare *= heavyAdjust * 1.2;
    }

    const totalShares =
      gasShare + naphthaShare + keroseneShare + dieselShare + heavyShare + residShare;
    gasShare /= totalShares;
    naphthaShare /= totalShares;
    keroseneShare /= totalShares;
    dieselShare /= totalShares;
    heavyShare /= totalShares;
    residShare /= totalShares;

    const distGas = crudeThroughput * gasShare;
    let naphthaPool = crudeThroughput * naphthaShare;
    let kerosenePool = crudeThroughput * keroseneShare;
    let dieselPool = crudeThroughput * dieselShare;
    let heavyPool = crudeThroughput * heavyShare;
    let residPool = crudeThroughput * residShare;

    const result = {
      gasoline: 0,
      diesel: 0,
      jet: 0,
      lpg: 0,
      hydrogen: 0,
      waste: crudeThroughput * 0.01,
      sulfur: 0,
    };

    let flare = 0;
    const demandGasolineBias = scenario.gasolineBias;
    const demandJetBias = scenario.jetBias;

    const strainState = this._updateOperationalStrain({
      hours,
      crudeThroughputPerDay,
      scenario,
    });

    if (strainState.factor > 0.2) {
      this.pendingOperationalCost += strainState.factor * hours * 35;
    }

    const reformerState = this._resolveUnitState("reformer");
    const reformer = reformerState.unit;
    const reformerCapacity =
      reformer && reformerState.online
        ? perDayToPerHour(reformer.capacity) * clamp(reformerState.throttle, 0, 1.2)
        : 0;
    const reformFeed = Math.min(
      naphthaPool,
      reformerCapacity * this._pipelineMultiplier("toReformer")
    );
    naphthaPool -= reformFeed;
    if (reformer) {
      reformer.throughput = perHourToPerDay(reformFeed);
      reformer.utilization = reformer.capacity > 0 ? reformer.throughput / reformer.capacity : 0;
      this._updateUnitMode(reformer);
    }

    const reformate = reformFeed * 0.92;
    const reformHydrogen = reformFeed * 0.05;
    const reformLoss = reformFeed * 0.03;
    result.gasoline += reformate;
    result.hydrogen += reformHydrogen;
    result.waste += reformLoss;

    const fccState = this._resolveUnitState("fcc");
    const fcc = fccState.unit;
    const fccCapacity =
      fcc && fccState.online
        ? perDayToPerHour(fcc.capacity) * clamp(fccState.throttle, 0, 1.2)
        : 0;
    const heavyAvailableForFcc = heavyPool + residPool * 0.6;
    const fccFeed = Math.min(
      heavyAvailableForFcc,
      fccCapacity * this._pipelineMultiplier("toCracker")
    );
    const heavyUsedByFcc = Math.min(heavyPool, fccFeed * 0.7);
    heavyPool -= heavyUsedByFcc;
    const residUsedByFcc = Math.min(residPool, fccFeed - heavyUsedByFcc);
    residPool -= residUsedByFcc;

    if (fcc) {
      fcc.throughput = perHourToPerDay(fccFeed);
      fcc.utilization = fcc.capacity > 0 ? fcc.throughput / fcc.capacity : 0;
      this._updateUnitMode(fcc);
    }

    const fccGasoline = fccFeed * 0.54;
    const fccDiesel = fccFeed * 0.12;
    const fccLpg = fccFeed * 0.18;
    const fccLoss = fccFeed * 0.08;
    result.gasoline += fccGasoline;
    dieselPool += fccDiesel;
    let lpgPool = distGas + fccLpg;
    result.waste += fccLoss;
    flare += fccLoss * 0.5;

    const hydroState = this._resolveUnitState("hydrocracker");
    const hydrocracker = hydroState.unit;
    const hydroCapacity =
      hydrocracker && hydroState.online
        ? perDayToPerHour(hydrocracker.capacity) * clamp(hydroState.throttle, 0, 1.2)
        : 0;
    const hydroFeedAvailable = heavyPool + residPool + dieselPool * 0.25;
    const hydroFeed = Math.min(
      hydroFeedAvailable,
      hydroCapacity * this._pipelineMultiplier("toHydrocracker")
    );

    const heavyUsedHydro = Math.min(heavyPool, hydroFeed * 0.55);
    heavyPool -= heavyUsedHydro;
    const residUsedHydro = Math.min(residPool, hydroFeed * 0.35);
    residPool -= residUsedHydro;
    const dieselUsedHydro = Math.min(dieselPool * 0.5, hydroFeed - heavyUsedHydro - residUsedHydro);
    dieselPool -= dieselUsedHydro;

    if (hydrocracker) {
      hydrocracker.throughput = perHourToPerDay(hydroFeed);
      hydrocracker.utilization = hydrocracker.capacity > 0 ? hydrocracker.throughput / hydrocracker.capacity : 0;
      this._updateUnitMode(hydrocracker);
    }

    const hydroGasoline = hydroFeed * 0.42;
    const hydroDiesel = hydroFeed * 0.3;
    const hydroJet = hydroFeed * 0.2;
    const hydroLoss = hydroFeed * 0.08;
    result.gasoline += hydroGasoline;
    dieselPool += hydroDiesel;
    kerosenePool += hydroJet;
    result.hydrogen += hydroFeed * 0.04;
    result.waste += hydroLoss;

    const alkylationState = this._resolveUnitState("alkylation");
    const alkylation = alkylationState.unit;
    const alkCapacity =
      alkylation && alkylationState.online
        ? perDayToPerHour(alkylation.capacity) * clamp(alkylationState.throttle, 0, 1.2)
        : 0;
    const alkFeed = Math.min(
      lpgPool,
      alkCapacity * this._pipelineMultiplier("toAlkylation")
    );
    lpgPool -= alkFeed;

    if (alkylation) {
      alkylation.throughput = perHourToPerDay(alkFeed);
      alkylation.utilization = alkylation.capacity > 0 ? alkylation.throughput / alkylation.capacity : 0;
      this._updateUnitMode(alkylation);
    }

    const alkGasoline = alkFeed * 0.88;
    const alkLoss = alkFeed * 0.06;
    result.gasoline += alkGasoline;
    result.lpg += lpgPool;
    result.waste += alkLoss;

    const sulfurState = this._resolveUnitState("sulfur");
    const sulfur = sulfurState.unit;
    const sulfurCapacity =
      sulfur && sulfurState.online
        ? perDayToPerHour(sulfur.capacity) * clamp(sulfurState.throttle, 0, 1.2)
        : 0;
    const sulfurFeed = Math.min(residPool + heavyPool, sulfurCapacity);
    const sulfurRemoved = sulfurFeed * (0.55 + this.params.environment * 0.4);
    if (sulfur) {
      sulfur.throughput = perHourToPerDay(sulfurFeed);
      sulfur.utilization = sulfur.capacity > 0 ? sulfur.throughput / sulfur.capacity : 0;
      this._updateUnitMode(sulfur);
    }
    residPool -= sulfurFeed * 0.6;
    heavyPool -= sulfurFeed * 0.4;
    result.sulfur += sulfurRemoved;
    result.waste += Math.max(0, sulfurFeed - sulfurRemoved);

    result.gasoline += naphthaPool * 0.82;
    result.diesel += dieselPool;
    result.jet += kerosenePool * (1 + demandJetBias * 0.2);
    result.waste += residPool + heavyPool;
    result.lpg += Math.max(0, lpgPool);

    const totalLiquidProducts = result.gasoline + result.diesel + result.jet;
    const maxLiquidProducts = crudeThroughput * 1.02;
    if (totalLiquidProducts > maxLiquidProducts && totalLiquidProducts > 0) {
      const scale = maxLiquidProducts / totalLiquidProducts;
      result.gasoline *= scale;
      result.diesel *= scale;
      result.jet *= scale;
    }
    const maxLpg = crudeThroughput * 0.12;
    if (result.lpg > maxLpg) {
      result.lpg = maxLpg;
    }

    if (strainState.penalty > 0.0001) {
      const penalty = clamp(strainState.penalty, 0, 0.4);
      const diverted = crudeThroughput * penalty * 0.26;
      result.gasoline *= 1 - penalty * 0.6;
      result.diesel *= 1 - penalty * 0.55;
      result.jet *= 1 - penalty * 0.5;
      result.lpg *= 1 - penalty * 0.45;
      result.waste += diverted;
      flare += diverted * 0.35;
    }

    const basePrices = {
      gasoline: 96,
      diesel: 88,
      jet: 112,
      lpg: 54,
    };

    const priceModifier = scenario.priceModifier;
    const gasolinePrice = basePrices.gasoline * priceModifier * (1 + demandGasolineBias * 0.3);
    const dieselPrice = basePrices.diesel * priceModifier * (1 + scenario.dieselBias * 0.25);
    const jetPrice = basePrices.jet * priceModifier * (1 + demandJetBias * 0.35);
    const lpgPrice = basePrices.lpg * priceModifier * (1 + demandGasolineBias * 0.1);

    const crudeCostPerBbl = this._resolveCrudeCostPerBarrel(scenario);
    const maintenanceBudget =
      2.2 * this.units.length * (0.5 + this.params.maintenance * 1.4 + scenario.maintenancePenalty);
    const safetyBudget = 1.1 * this.params.safety * this.units.length;
    const envBudget = 1.6 * this.params.environment * (1 + scenario.environmentPressure);

    const productRevenue =
      result.gasoline * gasolinePrice +
      result.diesel * dieselPrice +
      result.jet * jetPrice +
      result.lpg * lpgPrice;
    const crudeExpense = crudeThroughput * crudeCostPerBbl;
    const operatingExpense = maintenanceBudget + safetyBudget + envBudget;

    const incidentsRisk = this._updateReliability(
      { distillation, reformer, fcc, hydrocracker, alkylation, sulfur },
      {
        hours,
        scenario,
        flare,
        maintenance: this.params.maintenance,
        safety: this.params.safety,
        environment: this.params.environment,
        strain: strainState,
      }
    );

    const logisticsReport = this._updateLogistics({
      hours,
      production: result,
      prices: { gasoline: gasolinePrice, diesel: dieselPrice, jet: jetPrice },
      scenario,
    });

    const environmentLevel = clamp(this.params.environment ?? 0.35, 0, 1);
    const carbonBase =
      result.waste * 3.5 +
      result.diesel * 0.6 +
      result.gasoline * 0.5 +
      incidentsRisk.incidents * 2.8;
    const envMitigation = 1 - clamp(0.1 + environmentLevel * 0.55 + environmentLevel * environmentLevel * 0.32, 0, 0.88);
    const carbonPerHour = carbonBase * envMitigation;
    const carbonPerDay = perHourToPerDay(carbonPerHour);
    const productionPerDay = perHourToPerDay(result.gasoline + result.diesel + result.jet);
    const environmentTarget = clamp(
      0.5 - environmentLevel * 0.28 + (scenario.environmentPressure || 0) * 0.05,
      0.22,
      0.55
    );
    const carbonIntensity = productionPerDay > 0 ? carbonPerDay / productionPerDay : carbonPerDay;
    const envExcess = Math.max(0, carbonIntensity - environmentTarget);
    let environmentPenalty = 0;
    if (envExcess > 0) {
      environmentPenalty = envExcess * productionPerDay * 9;
      if (envExcess > 0.05) {
        environmentPenalty *= 1.15;
      }
      const penaltySuppression = clamp(1 - environmentLevel * 1.05, 0, 1);
      environmentPenalty *= penaltySuppression;
    }

    if (this._environmentPenaltyCooldown > 0) {
      this._environmentPenaltyCooldown = Math.max(0, this._environmentPenaltyCooldown - hours);
    }
    if (environmentPenalty > 4 && this._environmentPenaltyCooldown <= 0) {
      this.pushLog(
        envExcess > 0.08 ? "warning" : "info",
        `Environmental compliance drag: $${environmentPenalty.toFixed(1)}k this hour (intensity ${(carbonIntensity * 100).toFixed(1)}%).`
      );
      this._environmentPenaltyCooldown = 1.6;
    }

    let penalty = incidentsRisk.incidentPenalty + logisticsReport.penalty + environmentPenalty;
    const fixedOverhead = this._calculateFixedOverhead({
      crudeThroughput: crudeThroughputPerDay,
      scenario,
    });
    const marketConditions = this._updateMarketConditions({
      scenario,
      incidents: incidentsRisk,
      logistics: logisticsReport,
    });
    const adjustedRevenue = productRevenue * marketConditions.multiplier;
    const carryingCost = marketConditions.carryingCost;
    const totalOperatingExpense = operatingExpense + fixedOverhead + carryingCost + extraOperationalCost;
    const economy = this._updateEconomy({
      scenario,
      spotPrices: { gasoline: gasolinePrice, diesel: dieselPrice, jet: jetPrice },
      production: result,
      crudeCostPerBbl,
      totalOperatingExpense,
      penalty,
      logistics: logisticsReport,
      incidents: incidentsRisk,
      marketConditions,
      crudeThroughput,
    });
    const revenuePerHour = adjustedRevenue;
    const operatingExpensePerHour = totalOperatingExpense;
    const crudeExpensePerHour = crudeExpense;
    const expensePerHour = operatingExpensePerHour + crudeExpensePerHour;
    const penaltyPerHour = penalty;
    const profitPerHour = revenuePerHour - expensePerHour - penaltyPerHour;
    const profitPerDay = profitPerHour * HOURS_PER_DAY;

    this.metrics.gasoline = this._round(perHourToPerDay(result.gasoline));
    this.metrics.diesel = this._round(perHourToPerDay(result.diesel));
    this.metrics.jet = this._round(perHourToPerDay(result.jet));
    this.metrics.lpg = this._round(perHourToPerDay(result.lpg));
    this.metrics.crudeCostPerBbl = crudeCostPerBbl;
    this.metrics.profitPerHour = profitPerHour;
    this.metrics.revenuePerDay = revenuePerHour * HOURS_PER_DAY;
    this.metrics.expensePerDay = expensePerHour * HOURS_PER_DAY;
    this.metrics.operatingExpensePerDay = operatingExpensePerHour * HOURS_PER_DAY;
    this.metrics.crudeExpensePerDay = crudeExpensePerHour * HOURS_PER_DAY;
    this.metrics.penaltyPerDay = penaltyPerHour * HOURS_PER_DAY;
    this.metrics.marginMultiplier = marketConditions.multiplier;
    this.metrics.storageThrottle = storageThrottle;
    this.metrics.futuresGasoline = economy.futures.gasoline;
    this.metrics.futuresDiesel = economy.futures.diesel;
    this.metrics.futuresJet = economy.futures.jet;
    this.metrics.costGasoline = economy.productionCost.gasoline;
    this.metrics.costDiesel = economy.productionCost.diesel;
    this.metrics.costJet = economy.productionCost.jet;
    this.metrics.basisGasoline = economy.basis.gasoline;
    this.metrics.basisDiesel = economy.basis.diesel;
    this.metrics.basisJet = economy.basis.jet;
    this.metrics.waste = result.waste;
    this.metrics.flareLevel = clamp((result.waste + flare * 1.4) / (crudeThroughput * 0.5 || 1), 0, 1);
    this.metrics.incidents = incidentsRisk.incidents;
    this.metrics.reliability = incidentsRisk.reliability;
    this.metrics.operationalStrain = this._round(strainState.strain);

    this.metrics.carbon = carbonPerHour;

    this.flows.toReformer = reformFeed;
    this.flows.toCracker = fccFeed;
    this.flows.toHydrocracker = hydroFeed;
    this.flows.toAlkylation = alkFeed;
    this.flows.toExport = result.gasoline + result.diesel + result.jet;

    this._updateDirectives(hours, { shipments: logisticsReport, metrics: this.metrics });

    this._updateScorecard({
      profitPerHour,
      crudeThroughput: crudeThroughputPerDay,
      incidents: incidentsRisk.incidents,
      reliability: this.metrics.reliability,
      carbon: this.metrics.carbon,
      gasoline: this.metrics.gasoline,
      diesel: this.metrics.diesel,
      jet: this.metrics.jet,
      shipmentScore: this.metrics.shipmentReliability,
      directiveScore: this.metrics.directiveReliability,
      strain: strainState.factor,
    });

    this._updateRecorder({
      hours,
      production: result,
      profitPerHour,
      penalty,
      incidents: incidentsRisk.incidents,
      reliability: this.metrics.reliability,
      carbon: this.metrics.carbon,
      logistics: logisticsReport,
    });

    this._updateAlerts(deltaMinutes);
  }

  _unitIsAvailable(unit) {
    if (!unit) return false;
    if (unit.downtime > 0) {
      unit.downtime = Math.max(0, unit.downtime - this.tickInterval);
      if (unit.downtime === 0) {
        unit.status = "online";
        unit.integrity = 0.65 + Math.random() * 0.25;
        unit.alert = null;
        unit.alertTimer = 6;
        if (unit.alertDetail && unit.alertDetail.kind !== "incident") {
          unit.alertDetail = null;
        }
        this.pushLog("info", `${unit.name} cleared maintenance and is back online.`, {
          unitId: unit.id,
        });
      }
      return false;
    }
    return true;
  }

  _resolveUnitState(unitId) {
    const unit = this.unitMap[unitId];
    if (!unit) {
      return { unit: null, online: false, throttle: 0 };
    }

    const override = this.unitOverrides[unitId] || {};
    const throttle =
      typeof override.throttle === "number" ? clamp(override.throttle, 0, 1.2) : 1;

    const available = this._unitIsAvailable(unit);
    unit.overrideThrottle = override.offline ? 0 : throttle;

    if (override.offline) {
      if (unit.downtime <= 0 && unit.status !== "offline") {
        unit.status = "standby";
      }
      unit.manualOffline = !unit.emergencyOffline;
      unit.throughput = 0;
      unit.utilization = 0;
      return { unit, online: false, throttle: 0 };
    }

    unit.manualOffline = false;

    if (!available) {
      return { unit, online: false, throttle: 0 };
    }

    if (unit.status === "standby") {
      unit.status = "online";
    }

    return { unit, online: true, throttle };
  }

  _updateUnitMode(unit) {
    if (!unit) {
      return;
    }
    if (unit.status === "offline") {
      unit.mode = "offline";
      return;
    }
    if (unit.status === "standby" || unit.manualOffline || unit.emergencyOffline) {
      unit.mode = "standby";
      return;
    }
    const utilization = unit.utilization || 0;
    if (utilization > 1.15) {
      unit.mode = "overdrive";
    } else if (utilization > 0.95) {
      unit.mode = "push";
    } else if (utilization < 0.45) {
      unit.mode = "idle";
    } else {
      unit.mode = "balanced";
    }
  }

  _updateReliability(units, context) {
    const maintenance = clamp(context.maintenance ?? this.params.maintenance ?? 0.6, 0, 1);
    const safety = clamp(context.safety ?? this.params.safety ?? 0.45, 0, 1);
    const environment = clamp(context.environment ?? this.params.environment ?? 0.35, 0, 1);
    const strainFactor = clamp(
      (context.strain?.strain ?? this.operationalStrain ?? 0) / 12,
      0,
      1
    );
    const scenario = context.scenario;

    let incidents = 0;
    let penalty = 0;
    let integritySum = 0;

    Object.values(units).forEach((unit) => {
      if (!unit) return;
      if (unit.status === "standby") {
        integritySum += unit.integrity;
        return;
      }
      const utilization = unit.utilization || 0;
      const baseWear = 0.004 * context.hours;
      const stressWear = Math.max(0, utilization - 1) * 0.04 * context.hours;
      const maintenanceFactor = 1.3 - maintenance * 0.9 - safety * 0.4;
      const scenarioFactor = scenario.riskMultiplier;
      const strainWear = 1 + strainFactor * 1.4 + clamp((context.flare || 0) / 160, 0, 0.45);
      const envRelief = clamp(1 - environment * 0.25, 0.6, 1);
      const wear = (baseWear + stressWear) * maintenanceFactor * scenarioFactor * strainWear * envRelief;
      unit.integrity = clamp(unit.integrity - wear, 0, 1);
      integritySum += unit.integrity;

      if (unit.integrity < 0.35 && unit.status === "online") {
        const failurePressure = clamp(0.35 - unit.integrity, 0, 0.35);
        const overload = Math.max(0, utilization - 0.95);
        const strainRisk = 1 + strainFactor * 1.6;
        const flareRisk = 1 + clamp((context.flare || 0) / 140, 0, 0.5);
        const envShield = clamp(1 - environment * 0.3, 0.55, 1);
        const riskIndex = clamp(
          failurePressure *
            (0.9 + overload * 1.8) *
            (1.1 - maintenance) *
            scenario.riskMultiplier *
            strainRisk *
            flareRisk *
            envShield,
          0,
          0.85
        );
        if (Math.random() < riskIndex) {
          const severity = overload > 0.2 && safety < 0.45 ? "danger" : "warning";
          const downtime = 30 + Math.random() * 90 + overload * 120;
          unit.status = "offline";
          unit.downtime = downtime;
          unit.incidents += 1;
          incidents += severity === "danger" ? 2 : 1;
          penalty += severity === "danger" ? 320 : 140;
          const cause = this._describeIncidentCause({
            overload,
            maintenance,
            safety,
            scenario,
            integrity: unit.integrity,
          });
          const message = `${unit.name} tripped offline after a ${
            severity === "danger" ? "critical" : "process"
          } upset (${cause.detail}).`;
          const guidanceNote = cause.guidance ? ` ${cause.guidance}` : "";
          this.pushLog(severity, `${message}${guidanceNote}`, { unitId: unit.id });
          if (severity === "danger") {
            this.pushLog(
              "danger",
              `Emergency crews respond to pressure surge at ${unit.name}. Throughput curtailed.`,
              { unitId: unit.id }
            );
          }
          unit.alert = severity;
          unit.alertTimer = Math.max(unit.alertTimer, severity === "danger" ? 180 : 90);
          unit.alertDetail = {
            kind: "incident",
            severity,
            summary: cause.summary,
            cause: cause.detail,
            guidance: cause.guidance,
            recordedAt: this._formatTime(),
            integrity: unit.integrity,
            overload,
            maintenance,
            safety,
          };
          unit.lastIncident = { ...unit.alertDetail };
        }
      }
    });

    const reliability = clamp(
      integritySum / Math.max(1, Object.keys(units).length),
      0,
      1
    );
    return {
      reliability,
      incidents,
      incidentPenalty: penalty,
    };
  }

  _describeIncidentCause(details) {
    const reasons = [];
    const summaryHints = [];
    if (details.overload > 0.25) {
      reasons.push("overpressure from aggressive throughput");
      summaryHints.push("Overpressure event");
    } else if (details.overload > 0.12) {
      reasons.push("running above nameplate capacity");
      summaryHints.push("Running hot");
    }
    if (details.integrity < 0.18) {
      reasons.push("equipment fatigue from deferred maintenance");
      summaryHints.push("Severe equipment fatigue");
    } else if (details.integrity < 0.3) {
      reasons.push("aging hardware under stress");
      summaryHints.push("Integrity stress");
    }
    if (details.maintenance < 0.45) {
      reasons.push("maintenance backlog");
    }
    if (details.safety < 0.4) {
      reasons.push("thin safety coverage");
    }
    if (details.scenario?.riskMultiplier > 1.4) {
      reasons.push("scenario hazards amplified the upset");
    }
    if (!reasons.length) {
      reasons.push("process variability");
      summaryHints.push("Process instability");
    }

    let detail;
    if (reasons.length === 1) {
      detail = reasons[0];
    } else if (reasons.length === 2) {
      detail = `${reasons[0]} and ${reasons[1]}`;
    } else {
      const last = reasons.pop();
      detail = `${reasons.join(", ")}, and ${last}`;
    }

    const summary = summaryHints.length ? summaryHints[0] : "Process instability";

    const guidanceParts = [];
    if (details.overload > 0.12) {
      guidanceParts.push("Trim throughput to relieve unit pressure.");
    }
    if (details.integrity < 0.3) {
      guidanceParts.push("Plan downtime to restore fatigued hardware.");
    }
    if (details.maintenance < 0.5) {
      guidanceParts.push("Increase maintenance coverage to rebuild integrity.");
    }
    if (details.safety < 0.4) {
      guidanceParts.push("Raise safety staffing for faster response.");
    }
    if (!guidanceParts.length) {
      guidanceParts.push("Hold rates steady while monitoring recovery.");
    }

    return {
      detail,
      summary,
      guidance: guidanceParts.join(" "),
    };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getPerformanceHistory() {
    return [...this.performanceHistory];
  }

  getTime() {
    return this.timeMinutes;
  }

  getUnits() {
    return this.units.map((unit) => ({ ...unit }));
  }

  getFlows() {
    return { ...this.flows };
  }

  _formatTime() {
    const totalMinutes = Math.floor(this.timeMinutes);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    return `Day ${days + 1}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}`;
  }

  _round(value) {
    return Math.round(value * 10) / 10;
  }

  _updateScorecard(context) {
    const throughputTotal = context.gasoline + context.diesel + context.jet;
    const throughputScore = clamp(throughputTotal / Math.max(1, context.crudeThroughput * 0.92), 0, 1);
    const profitScore = clamp((context.profitPerHour + 100) / 240, 0, 1);
    const reliabilityScore = clamp(context.reliability, 0, 1);
    const carbonScore = clamp(1 - context.carbon / 140, 0, 1);
    const incidentScore = clamp(1 - context.incidents * 0.18, 0, 1);
    const strainScore = clamp(1 - (context.strain ?? clamp(this.operationalStrain / 12, 0, 1)), 0, 1);
    const shipmentScore = clamp(
      typeof context.shipmentScore === "number"
        ? context.shipmentScore
        : this.metrics.shipmentReliability ?? 1,
      0,
      1
    );
    const directiveScore = clamp(
      typeof context.directiveScore === "number"
        ? context.directiveScore
        : this.metrics.directiveReliability ?? 1,
      0,
      1
    );

    const composite = clamp(
      throughputScore * 0.18 +
        profitScore * 0.16 +
        reliabilityScore * 0.18 +
        carbonScore * 0.12 +
        incidentScore * 0.1 +
        shipmentScore * 0.1 +
        directiveScore * 0.08 +
        strainScore * 0.08,
      0,
      1
    );

    const score = composite * 100;
    const previous = this.performanceHistory.length
      ? this.performanceHistory[this.performanceHistory.length - 1]
      : score;
    const delta = score - previous;

    this.metrics.score = score;
    this.metrics.grade = this._scoreToGrade(score);
    this.metrics.scoreNote = this._scoreNarrative({
      throughputScore,
      profitScore,
      reliabilityScore,
      carbonScore,
      incidentScore,
      shipmentScore,
      directiveScore,
      strainScore,
    });
    this.metrics.scoreDelta = delta;

    this._recordPerformance(score);
  }

  _recordPerformance(score) {
    this.performanceHistory.push(score);
    if (this.performanceHistory.length > 240) {
      this.performanceHistory.shift();
    }
  }

  _scoreToGrade(score) {
    if (score >= 92) return "A";
    if (score >= 88) return "A-";
    if (score >= 82) return "B+";
    if (score >= 76) return "B";
    if (score >= 70) return "B-";
    if (score >= 64) return "C+";
    if (score >= 58) return "C";
    if (score >= 50) return "C-";
    if (score >= 40) return "D";
    return "F";
  }

  _scoreNarrative(scores) {
    const issues = [];
    const highlights = [];

    if (scores.profitScore < 0.45) {
      issues.push("Margins are tightening – rebalance crude or product slate.");
    } else if (scores.profitScore > 0.75) {
      highlights.push("Commercial returns are strong this shift.");
    }

    if (scores.reliabilityScore < 0.6) {
      issues.push("Unit integrity is slipping; schedule maintenance time.");
    } else if (scores.reliabilityScore > 0.85) {
      highlights.push("Equipment health remains excellent.");
    }

    if (typeof scores.strainScore === "number") {
      if (scores.strainScore < 0.6) {
        issues.push("Operations are running hot — ease crude or invest in maintenance.");
      } else if (scores.strainScore > 0.85) {
        highlights.push("Crews kept process strain comfortably in check.");
      }
    }

    if (scores.carbonScore < 0.55) {
      issues.push("Environmental controls are lagging – increase mitigation spend.");
    } else if (scores.carbonScore > 0.8) {
      highlights.push("Environmental intensity is well managed.");
    }

    if (scores.incidentScore < 0.75) {
      issues.push("Recent upsets rattled crews; stabilize operations.");
    }

    if (scores.throughputScore < 0.55) {
      issues.push("Throughput is under target; inspect front-end feed handling.");
    } else if (scores.throughputScore > 0.8) {
      highlights.push("Product output is beating plan.");
    }

    if (typeof scores.shipmentScore === "number") {
      if (scores.shipmentScore < 0.6) {
        issues.push("Marine dispatch is missing windows; balance inventories to meet dock orders.");
      } else if (scores.shipmentScore > 0.85) {
        highlights.push("Dock schedule is flowing smoothly with on-time sailings.");
      }
    }

    if (typeof scores.directiveScore === "number") {
      if (scores.directiveScore < 0.55) {
        issues.push("Supervisors flag missed directives—align operations with shift goals.");
      } else if (scores.directiveScore > 0.85) {
        highlights.push("Shift directives are being crushed; crews are in sync.");
      }
    }

    if (issues.length) {
      return issues[0];
    }
    if (highlights.length) {
      return highlights[0];
    }
    return "Plant stabilizing…";
  }

  _initStorage() {
    const capacity = { gasoline: 220, diesel: 180, jet: 140 };
    return {
      capacity,
      levels: {
        gasoline: capacity.gasoline * 0.52,
        diesel: capacity.diesel * 0.48,
        jet: capacity.jet * 0.45,
      },
    };
  }

  _createStorageAlertCache() {
    const products = ["gasoline", "diesel", "jet"];
    const cache = {};
    products.forEach((product) => {
      cache[product] = {
        highActive: false,
        lowActive: false,
        highSeverity: "warning",
        lowSeverity: "warning",
        highTime: "",
        lowTime: "",
        latestRatio: 0,
      };
    });
    return cache;
  }

  _countPendingShipments() {
    return this.shipments.filter((shipment) => shipment.status === "pending").length;
  }

  _scheduleShipment(options = {}) {
    const {
      product,
      dueIn,
      volume,
      window,
      rush = false,
      autoplan = false,
      context = null,
    } = options || {};

    const planning = context || this._prepareShipmentPlanningContext();
    const chosenProduct = product || this._pickShipmentProduct(planning.weights);
    if (!chosenProduct) {
      return null;
    }

    const overallRatio = planning.overallRatio ?? this._computeStorageUtilization();
    const capacity = this.storage?.capacity?.[chosenProduct] || 0;
    const level = this.storage?.levels?.[chosenProduct] || 0;
    const productRatio = capacity ? clamp(level / capacity, 0, 1.3) : 0;
    const minProductThreshold =
      chosenProduct === "gasoline" ? 0.42 : chosenProduct === "diesel" ? 0.32 : 0.28;
    const lastScheduledMinutes = this._lastShipmentScheduled?.[chosenProduct] ?? -Infinity;
    const hoursSinceLast = lastScheduledMinutes === -Infinity ? Infinity : (this.timeMinutes - lastScheduledMinutes) / 60;

    if (autoplan) {
      const allowByStaleness = hoursSinceLast >= 10;
      if ((productRatio < minProductThreshold || overallRatio < 0.42) && !allowByStaleness) {
        return null;
      }
      if (productRatio < minProductThreshold + 0.12 && overallRatio < 0.58 && !allowByStaleness) {
        return null;
      }
    }

    const resolvedDueIn = Math.max(
      autoplan ? 6.5 : 0.5,
      typeof dueIn === "number" && Number.isFinite(dueIn)
        ? dueIn
        : randomRange(autoplan ? planning.baseSpacing * 0.85 : 4, autoplan ? planning.baseSpacing * 1.2 : 9)
    );

    const resolvedVolume = Math.max(
      18,
      Math.round(
        typeof volume === "number" && Number.isFinite(volume)
          ? volume
          : this._estimateShipmentVolume(chosenProduct, planning.demandPerDay, rush)
      )
    );

    const cappedVolume = autoplan
      ? Math.min(
          resolvedVolume,
          capacity
            ? Math.max(20, Math.min(capacity * 0.55, level * 0.85 + capacity * 0.1))
            : resolvedVolume
        )
      : resolvedVolume;

    const resolvedWindow = Math.max(
      3,
      typeof window === "number" && Number.isFinite(window)
        ? window
        : this._estimateShipmentWindow(chosenProduct, resolvedDueIn, { rush, autoplan })
    );

    return this._registerShipment({
      product: chosenProduct,
      dueIn: autoplan ? Math.max(6, resolvedDueIn) : resolvedDueIn,
      volume: cappedVolume,
      window: resolvedWindow,
      rush,
      autoplan,
    });
  }

  _prepareShipmentPlanningContext() {
    const scenario = this.activeScenario || this.scenarios?.steady || {};
    const demandPerDay = this._calculateMarketDemand(HOURS_PER_DAY, scenario);
    const weights = this._calculateShipmentWeights(demandPerDay, scenario);
    let baseSpacing = this._computeShipmentSpacing(demandPerDay);
    const overallRatio = this._computeStorageUtilization();
    if (overallRatio < 0.8) {
      const slackFactor = 1.1 + Math.max(0, 0.8 - overallRatio) * 0.8;
      baseSpacing *= slackFactor;
    }
    return { demandPerDay, weights, baseSpacing, scenario, overallRatio };
  }

  _calculateShipmentWeights(demandPerDay, scenario = {}) {
    const focus = clamp(this.params.productFocus ?? 0.5, 0, 1);
    const focusShift = focus - 0.5;
    const weights = {
      gasoline: (demandPerDay.gasoline || 0) * (1 + focusShift * 0.55 + (scenario.gasolineBias || 0) * 0.6),
      diesel: (demandPerDay.diesel || 0) * (1 - focusShift * 0.45 + (scenario.dieselBias || 0) * 0.7),
      jet: (demandPerDay.jet || 0) * (1 - Math.abs(focusShift) * 0.25 + (scenario.jetBias || 0) * 0.9),
    };
    let total = 0;
    Object.keys(weights).forEach((key) => {
      weights[key] = Math.max(0.1, weights[key] || 0);
      total += weights[key];
    });
    if (total <= 0) {
      return { gasoline: 1, diesel: 1, jet: 1 };
    }
    return weights;
  }

  _computeShipmentSpacing(demandPerDay) {
    const shipmentsPerDay = Object.entries(SHIPMENT_PARCEL_SIZES).reduce((acc, [product, parcel]) => {
      const volume = Math.max(0, demandPerDay?.[product] || 0);
      if (!parcel) {
        return acc;
      }
      return acc + volume / parcel;
    }, 0);
    if (!Number.isFinite(shipmentsPerDay) || shipmentsPerDay <= 0) {
      return 10;
    }
    return clamp(24 / shipmentsPerDay, 4.5, 14);
  }

  _pickShipmentProduct(weights) {
    const entries = Object.entries(weights || {}).filter(([, weight]) => weight > 0);
    if (!entries.length) {
      return null;
    }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) {
      return entries[0][0];
    }
    let roll = Math.random() * total;
    for (const [product, weight] of entries) {
      roll -= weight;
      if (roll <= 0) {
        return product;
      }
    }
    return entries[entries.length - 1][0];
  }

  _estimateShipmentVolume(product, demandPerDay, rush = false) {
    const parcel = SHIPMENT_PARCEL_SIZES[product] || 40;
    const demand = Math.max(0, demandPerDay?.[product] || parcel);
    const capacity = this.storage?.capacity?.[product] || parcel * 3;
    const focus = clamp(this.params.productFocus ?? 0.5, 0, 1);
    const focusShift = focus - 0.5;
    let mixAdjust = 1;
    if (product === "gasoline") {
      mixAdjust += focusShift * 0.55;
    } else if (product === "diesel") {
      mixAdjust -= focusShift * 0.45;
    } else if (product === "jet") {
      mixAdjust -= Math.abs(focusShift) * 0.25;
    }
    const demandFactor = clamp(demand / Math.max(parcel, 1), 0.6, 1.75);
    const rushFactor = rush ? 1.15 : 1;
    const estimated = parcel * mixAdjust * demandFactor * rushFactor * randomRange(0.88, 1.12);
    const maxVolume = capacity * 0.72;
    return clamp(estimated, parcel * 0.5, maxVolume);
  }

  _estimateShipmentWindow(product, dueIn, { rush = false, autoplan = false } = {}) {
    const base = product === "jet" ? 8 : product === "diesel" ? 7.2 : 6.8;
    const slack = autoplan ? clamp(dueIn * 0.3, 1.5, 4.5) : 0;
    const rushFactor = rush ? 0.6 : 1;
    return clamp((base + slack) * rushFactor, 3.2, 12.5);
  }

  _registerShipment({ product, dueIn, volume, window, rush = false, autoplan = false }) {
    if (!product || !Number.isFinite(dueIn) || dueIn <= 0) {
      return null;
    }

    const shipment = {
      id: `ship-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      product,
      volume: Math.round(Math.max(10, volume || 0)),
      window,
      dueIn,
      status: "pending",
      createdAt: this.timeMinutes,
      scheduledAt: this.timeMinutes + dueIn * 60,
      cooldown: 0,
      rush: Boolean(rush),
    };

    this.shipments.push(shipment);

    if (!autoplan || dueIn <= 18 || rush) {
      const label = PRODUCT_LABELS[product] || product;
      this.pushLog(
        "info",
        `${shipment.volume.toFixed(0)} kb of ${label} slated for the dock within ${window.toFixed(1)} h.`,
        { product }
      );
    }

    this._updateNextShipmentCountdown();
    if (!this._lastShipmentScheduled) {
      this._lastShipmentScheduled = {};
    }
    this._lastShipmentScheduled[product] = this.timeMinutes;
    return shipment;
  }

  _ensureScheduledShipments(horizonHours = this.shipmentHorizonHours || SHIPMENT_HORIZON_HOURS) {
    if (!Array.isArray(this.shipments)) {
      this.shipments = [];
    }

    const nowHours = this.timeMinutes / 60;
    const target = nowHours + Math.max(12, horizonHours || SHIPMENT_HORIZON_HOURS);
    const pending = this.shipments.filter((shipment) => shipment && shipment.status === "pending");
    const farthestDue = pending.reduce((max, shipment) => {
      if (!shipment || !Number.isFinite(shipment.dueIn)) {
        return max;
      }
      return Math.max(max, shipment.dueIn);
    }, 0);
    let scheduledThrough = nowHours + farthestDue;
    const planning = this._prepareShipmentPlanningContext();

    let guard = 0;
    while (scheduledThrough < target && guard < 32) {
      const spacing = randomRange(planning.baseSpacing * 0.7, planning.baseSpacing * 1.35);
      scheduledThrough += Math.max(0.5, spacing);
      const dueIn = Math.max(0.75, scheduledThrough - nowHours);
      const created = this._scheduleShipment({ dueIn, autoplan: true, context: planning });
      guard += 1;
      if (!created) {
        break;
      }
    }

    this._updateNextShipmentCountdown();
  }

  _updateNextShipmentCountdown() {
    if (!Array.isArray(this.shipments) || !this.shipments.length) {
      this.nextShipmentIn = 0;
      return;
    }
    const pending = this.shipments.filter((shipment) => shipment && shipment.status === "pending");
    if (!pending.length) {
      this.nextShipmentIn = 0;
      return;
    }
    const next = pending.reduce((min, shipment) => {
      if (!shipment || !Number.isFinite(shipment.dueIn)) {
        return min;
      }
      const value = Math.max(0, shipment.dueIn);
      if (min === null || value < min) {
        return value;
      }
      return min;
    }, null);
    this.nextShipmentIn = next ?? 0;
  }

  _computeStorageUtilization() {
    if (!this.storage?.capacity || !this.storage?.levels) {
      return 0;
    }
    const totalCapacity =
      (this.storage.capacity.gasoline || 0) +
      (this.storage.capacity.diesel || 0) +
      (this.storage.capacity.jet || 0);
    if (totalCapacity <= 0) {
      return 0;
    }
    const totalLevel =
      (this.storage.levels.gasoline || 0) +
      (this.storage.levels.diesel || 0) +
      (this.storage.levels.jet || 0);
    return clamp(totalLevel / totalCapacity, 0, 1.4);
  }

  _updateOperationalStrain({ hours, crudeThroughputPerDay, scenario }) {
    const maintenance = clamp(this.params.maintenance ?? 0.65, 0, 1);
    const safety = clamp(this.params.safety ?? 0.45, 0, 1);
    const environment = clamp(this.params.environment ?? 0.35, 0, 1);
    const scenarioPenalty = scenario?.maintenancePenalty || 0;

    const load = clamp(crudeThroughputPerDay / Math.max(20, BASE_CRUDE_THROUGHPUT), 0, 2.5);
    const stress = load * (1 + scenarioPenalty * 0.9 + (this.marketStress || 0) * 0.45);
    const mitigation = 0.5 + maintenance * 0.65 + safety * 0.4 + environment * 0.5;
    const target = clamp((stress - mitigation + 0.08) * 5.2, 0, 12);
    const response = clamp(0.22 + maintenance * 0.28 + safety * 0.18, 0.22, 0.8);

    this.operationalStrain += (target - this.operationalStrain) * Math.min(1, hours * response);
    const relief = (environment * 0.55 + maintenance * 0.22 + safety * 0.12) * hours;
    this.operationalStrain = clamp(this.operationalStrain - relief, 0, 12);

    const factor = clamp(this.operationalStrain / 12, 0, 1);
    const penalty = factor * 0.16;

    return { strain: this.operationalStrain, factor, penalty };
  }

  _resolveShipment(shipment, prices, report) {
    shipment.dueIn = 0;
    const product = shipment.product;
    const available = this.storage.levels[product];
    const price = prices[product] || 1.6;

    if (available >= shipment.volume) {
      this.storage.levels[product] = available - shipment.volume;
      shipment.status = "completed";
      shipment.completedAt = this.timeMinutes;
      shipment.cooldown = 6;
      this.shipmentStats.total += 1;
      this.shipmentStats.onTime += 1;
      report.delivered[product] += shipment.volume;
      this._relieveStoragePressure(0.14);
      this.pushLog(
        "info",
        `Loaded ${shipment.volume.toFixed(0)} kb of ${PRODUCT_LABELS[product]} for departure.`
      );
    } else {
      const shortage = Math.max(0, shipment.volume - available);
      this.storage.levels[product] = 0;
      shipment.status = "missed";
      shipment.completedAt = this.timeMinutes;
      shipment.shortage = shortage;
      shipment.cooldown = 6;
      this.shipmentStats.total += 1;
      this.shipmentStats.missed = (this.shipmentStats.missed || 0) + 1;
      report.failed += 1;
      const severity = shipment.volume ? shortage / shipment.volume : 1;
      const penalty = shortage * price * 0.6;
      report.penalty += penalty;
      const level = severity > 0.35 ? "danger" : "warning";
      this.pushLog(
        level,
        `Dock missed ${PRODUCT_LABELS[product]} charter by ${shortage.toFixed(0)} kb. Penalty assessed.`,
        { product }
      );
    }
  }

  _updateLogistics(context) {
    const { production, hours, prices, scenario } = context;
    const produced = {
      gasoline: Math.max(0, production.gasoline * hours),
      diesel: Math.max(0, production.diesel * hours),
      jet: Math.max(0, production.jet * hours),
    };

    Object.entries(produced).forEach(([product, volume]) => {
      const capacity = this.storage.capacity[product];
      this.storage.levels[product] = clamp(this.storage.levels[product] + volume, 0, capacity);
    });

    const demandDraw = this._calculateMarketDemand(hours, scenario);
    const demandShortages = [];
    Object.entries(demandDraw).forEach(([product, draw]) => {
      const capacity = this.storage.capacity[product];
      const available = this.storage.levels[product];
      if (draw <= 0) {
        return;
      }
      const consumed = Math.min(draw, available);
      this.storage.levels[product] = clamp(available - consumed, 0, capacity);
      if (draw > consumed) {
        const shortage = draw - consumed;
        demandShortages.push({ product, shortage });
      }
    });

    let maxRatio = 0;
    Object.keys(this.storage.levels).forEach((product) => {
      const capacity = this.storage.capacity[product] || 0;
      const level = this.storage.levels[product] || 0;
      const ratio = capacity ? clamp(level / capacity, 0, 1.2) : 0;
      maxRatio = Math.max(maxRatio, ratio);
      this._updateStorageAlert(product, ratio);
    });

    this._applyStoragePressure(maxRatio, hours);

    const report = {
      delivered: { gasoline: 0, diesel: 0, jet: 0 },
      failed: 0,
      penalty: 0,
      demandShortage: 0,
      inventory: {
        levels: { ...this.storage.levels },
        capacity: { ...this.storage.capacity },
      },
      storageUtil: this.metrics.storageUtilization,
    };

    if (demandShortages.length) {
      demandShortages.forEach(({ product, shortage }) => {
        const price = prices?.[product] || 82;
        report.demandShortage += shortage;
        report.penalty += shortage * price * 0.35;
      });
    }

    this.shipments.forEach((shipment) => {
      if (shipment.status === "pending") {
        shipment.dueIn -= hours;
        if (shipment.dueIn <= 0) {
          this._resolveShipment(shipment, prices, report);
        }
      } else {
        shipment.cooldown = Math.max(0, shipment.cooldown - hours);
      }
    });

    this.shipments = this.shipments.filter(
      (shipment) => shipment.status === "pending" || shipment.cooldown > 0
    );

    this._updateNextShipmentCountdown();

    if (this._countPendingShipments() < 8) {
      this._ensureScheduledShipments();
    }

    const capacityTotal =
      this.storage.capacity.gasoline +
      this.storage.capacity.diesel +
      this.storage.capacity.jet;
    const levelTotal =
      this.storage.levels.gasoline +
      this.storage.levels.diesel +
      this.storage.levels.jet;

    this.metrics.storageGasoline = this._round(this.storage.levels.gasoline);
    this.metrics.storageDiesel = this._round(this.storage.levels.diesel);
    this.metrics.storageJet = this._round(this.storage.levels.jet);
    this.metrics.storageUtilization = capacityTotal
      ? clamp(levelTotal / capacityTotal, 0, 1)
      : 0;

    const shipmentTotal = Math.max(0, this.shipmentStats.total);
    const onTime = this.shipmentStats.onTime;
    this.metrics.shipmentReliability = shipmentTotal ? clamp(onTime / shipmentTotal, 0, 1) : 1;

    return report;
  }

  _applyStoragePressure(maxRatio, hours) {
    if (!this.storagePressure) {
      this.storagePressure = { active: false, throttle: 1, timer: 0, lastRatio: 0 };
    }
    const pressure = this.storagePressure;
    pressure.lastRatio = maxRatio;

    const threshold = 0.95;
    const reliefRate = Math.max(0.08, hours * 0.16);

    if (maxRatio >= threshold) {
      const severity = clamp((maxRatio - threshold) / 0.07, 0, 1);
      const newThrottle = clamp(1 - severity * 0.55, 0.45, 1);
      const wasActive = pressure.active;
      pressure.active = true;
      pressure.throttle = Math.min(pressure.throttle, newThrottle);
      pressure.timer = Math.max(pressure.timer, 2 + severity * 6);
      if (!wasActive) {
        this.pushLog(
          "warning",
          `Storage congestion forcing crude intake to ${Math.round(pressure.throttle * 100)}%.`,
          { storage: true }
        );
      }
    } else if (pressure.active) {
      pressure.timer = Math.max(pressure.timer - hours, 0);
      pressure.throttle = clamp(pressure.throttle + reliefRate, 0.45, 1);
      if (pressure.timer <= 0 || pressure.throttle >= 0.995) {
        pressure.active = false;
        pressure.throttle = 1;
        pressure.timer = 0;
        this.pushLog("info", "Tank pressure relieved; crude feed restored to 100%.", { storage: true });
      }
    } else {
      pressure.throttle = clamp(pressure.throttle + reliefRate, 0.45, 1);
      pressure.timer = Math.max(pressure.timer - hours, 0);
      if (pressure.throttle >= 0.995) {
        pressure.throttle = 1;
      }
    }
  }

  _relieveStoragePressure(boost = 0.12) {
    if (!this.storagePressure) {
      return;
    }
    const pressure = this.storagePressure;
    if (!pressure.active) {
      return;
    }
    pressure.throttle = clamp(pressure.throttle + boost, 0.45, 1);
    pressure.timer = Math.max(0, pressure.timer - boost * 8);
    if (pressure.throttle >= 0.995 || pressure.timer <= 0) {
      pressure.active = false;
      pressure.throttle = 1;
      pressure.timer = 0;
      this.pushLog("info", "Logistics relief eased tank pressure; crude feed back to 100%.", {
        storage: true,
      });
    }
  }

  _updateRecorder(context) {
    if (!this.recorder?.active) {
      return;
    }

    const hours = Math.max(0, context?.hours || 0);
    if (hours <= 0) {
      return;
    }

    this.recorder.elapsedHours += hours;
    this.recorder.lastUpdatedAt = this.timeMinutes;

    const production = context?.production || {};
    const produced = {
      gasoline: Math.max(0, (production.gasoline || 0) * hours),
      diesel: Math.max(0, (production.diesel || 0) * hours),
      jet: Math.max(0, (production.jet || 0) * hours),
    };
    Object.entries(produced).forEach(([product, volume]) => {
      this.recorder.production[product] += volume;
    });

    const profitPerHour = Number.isFinite(context?.profitPerHour) ? context.profitPerHour : 0;
    this.recorder.profit += profitPerHour * hours;

    if (Number.isFinite(context?.penalty)) {
      this.recorder.penalty += Math.max(0, context.penalty);
    }

    if (Number.isFinite(context?.incidents)) {
      this.recorder.incidents += Math.max(0, context.incidents);
    }

    const reliability = Number.isFinite(context?.reliability)
      ? context.reliability
      : Number.isFinite(this.metrics.reliability)
      ? this.metrics.reliability
      : 0;
    this.recorder.reliabilityHours += Math.max(0, reliability) * hours;

    if (Number.isFinite(context?.carbon)) {
      this.recorder.carbon += Math.max(0, context.carbon) * hours;
    }

    const logistics = context?.logistics || {};
    const delivered = logistics.delivered || {};
    this.recorder.shipments.delivered +=
      (delivered.gasoline || 0) + (delivered.diesel || 0) + (delivered.jet || 0);
    if (Number.isFinite(logistics.failed)) {
      this.recorder.shipments.missed += Math.max(0, logistics.failed);
    }
  }

  _updateEconomy({
    scenario,
    spotPrices,
    production,
    crudeCostPerBbl,
    totalOperatingExpense,
    penalty,
    logistics,
    incidents,
    marketConditions,
    crudeThroughput,
  }) {
    if (!this.market) {
      this.market = this._initMarketState();
    }
    const state = this.market;
    const spot = spotPrices || {};
    const prod = production || {};
    const totalOutput = Math.max((prod.gasoline || 0) + (prod.diesel || 0) + (prod.jet || 0), 0);
    const totalBarrels = totalOutput > 0 ? totalOutput * 1000 : 0;
    const throughput = Math.max(crudeThroughput || 0, 0.001);
    const feedConversion = totalOutput > 0 ? clamp(throughput / totalOutput, 0.55, 1.4) : 1;
    const feedCostPerBbl = crudeCostPerBbl * feedConversion;
    const operationsPerBbl = totalBarrels > 0 ? totalOperatingExpense / totalBarrels : 0;
    const penaltyPerBbl = totalBarrels > 0 ? penalty / totalBarrels : 0;
    const carryingPerBbl =
      totalBarrels > 0 && marketConditions
        ? (marketConditions.carryingCost || 0) / totalBarrels
        : 0;

    const shippingReliability = clamp(this.metrics.shipmentReliability ?? 1, 0, 1);
    const downtimeReliability = clamp(this.metrics.reliability ?? 1, 0, 1);
    const directiveReliability = clamp(this.metrics.directiveReliability ?? 1, 0, 1);
    const shippingPressure = Math.max(0, 1 - shippingReliability);
    const downtimePressure = Math.max(0, 1 - downtimeReliability);
    const directiveDrag = Math.max(0, 1 - directiveReliability);

    const maintenanceLevel = clamp(this.params.maintenance ?? 0.62, 0, 1);
    const safetyLevel = clamp(this.params.safety ?? 0.45, 0, 1);
    const environmentLevel = clamp(this.params.environment ?? 0.35, 0, 1);
    const maintenanceRelief = clamp(maintenanceLevel - 0.62, -0.35, 0.35);
    const safetyPremium = clamp(0.48 - safetyLevel, -0.25, 0.45);
    const environmentPremium = clamp(environmentLevel - 0.35, -0.25, 0.5);

    const focus = clamp(this.params.productFocus ?? 0.5, 0, 1);
    const focusShift = focus - 0.5;

    const inventoryLevels = logistics?.inventory?.levels || {};
    const inventoryCapacity = logistics?.inventory?.capacity || {};

    const demandDaily = this._calculateMarketDemand(HOURS_PER_DAY, scenario || this.activeScenario);
    const smoothingFutures = 0.25;
    const smoothingCost = 0.35;

    const weightProfile = {
      gasoline: { shipping: 1.05, downtime: 0.9, maintenance: 0.82, env: 0.65 },
      diesel: { shipping: 0.92, downtime: 1.05, maintenance: 1, env: 0.88 },
      jet: { shipping: 1.2, downtime: 1.12, maintenance: 0.9, env: 1.12 },
    };

    Object.keys(weightProfile).forEach((product) => {
      const weights = weightProfile[product];
      const output = Math.max(prod[product] || 0, 0);
      const share = totalOutput > 0 ? output / totalOutput : 0;
      const demand = Math.max(demandDaily[product] || 0, 0.0001);
      const supplyPerDay = perHourToPerDay(output);
      const demandGap = clamp(demand > 0 ? (demand - supplyPerDay) / demand : 0, -0.55, 0.65);
      const inventoryLevel = inventoryLevels[product] ?? demand * 0.4;
      const inventoryCap = Math.max(inventoryCapacity[product] ?? demand * 1.6, demand * 0.6);
      const inventoryRatio = clamp(inventoryLevel / inventoryCap, 0, 1.4);
      const storagePressure = clamp(inventoryRatio - 0.55, -0.45, 0.65);
      const logisticPenalty = logistics?.penalty || 0;
      const logisticDrag = totalBarrels > 0 ? logisticPenalty / totalBarrels : 0;
      const mixBias =
        product === "gasoline"
          ? focusShift * 0.35
          : product === "diesel"
          ? -focusShift * 0.28
          : -Math.abs(focusShift) * 0.18;

      state.drift[product] = clamp(
        (state.drift[product] || 0) * 0.78 + demandGap * 0.28 - shippingPressure * 0.16 - storagePressure * 0.18 + mixBias * 0.22,
        -0.6,
        0.6
      );

      const costTarget = Math.max(
        feedCostPerBbl * 0.7,
        feedCostPerBbl +
          operationsPerBbl +
          carryingPerBbl +
          penaltyPerBbl * (0.24 + share * 0.32) +
          logisticDrag * (0.1 + weights.shipping * 0.08) +
          shippingPressure * weights.shipping * 8 +
          downtimePressure * weights.downtime * 10 +
          directiveDrag * 4 +
          environmentPremium * weights.env * 7 +
          safetyPremium * weights.maintenance * 4 -
          maintenanceRelief * weights.maintenance * 12
      );

      const prevCost = Number.isFinite(state.productionCost[product])
        ? state.productionCost[product]
        : costTarget;
      const newCost = prevCost + (costTarget - prevCost) * smoothingCost;
      state.productionCost[product] = Math.max(newCost, feedCostPerBbl * 0.65);

      const spotPrice = Math.max(spot[product] || state.futures[product] || newCost, 0);
      const futuresTarget = Math.max(
        spotPrice * 0.65,
        spotPrice *
          (1 + demandGap * 0.72 + storagePressure * 0.28 + shippingPressure * weights.shipping * 0.2 + downtimePressure * weights.downtime * 0.16 - maintenanceRelief * weights.maintenance * 0.16 + mixBias * 0.2) +
          (penaltyPerBbl + carryingPerBbl) * 0.4 +
          logisticDrag * 1.0 +
          state.drift[product] * 5.5 +
          environmentPremium * weights.env * 3.8
      );

      const prevFuture = Number.isFinite(state.futures[product])
        ? state.futures[product]
        : futuresTarget;
      const newFuture = prevFuture + (futuresTarget - prevFuture) * smoothingFutures;
      state.futures[product] = Math.max(newFuture, 12);
      state.basis[product] = state.futures[product] - state.productionCost[product];
    });

    state.updatedAt = this.timeMinutes;
    return state;
  }

  _consumeOperationalCost() {
    const cost = this.pendingOperationalCost || 0;
    this.pendingOperationalCost = 0;
    return cost;
  }

  _resolveCrudeCostPerBarrel(scenario) {
    const base = scenario?.crudeBasePrice ?? 51;
    const qualityShift = scenario?.qualityShift ?? 0;
    return base * (1 + qualityShift * 0.8);
  }

  _calculateFixedOverhead({ crudeThroughput, scenario }) {
    const maintenancePenalty = scenario?.maintenancePenalty || 0;
    const base = 480 + maintenancePenalty * 260;
    const throughputDaily = Math.max(crudeThroughput || 0, 0);
    const throughputLoad = throughputDaily * (3.2 + maintenancePenalty * 1.8);
    const maintenanceFactor = 0.55 + (this.params.maintenance || 0) * 0.8;
    const safetyFactor = 0.4 + (this.params.safety || 0) * 0.6;
    const overheadPerDay =
      (base + throughputLoad) * (0.48 + maintenanceFactor * 0.32 + safetyFactor * 0.18);
    return overheadPerDay / HOURS_PER_DAY;
  }

  _updateMarketConditions({ scenario, incidents, logistics }) {
    if (!Number.isFinite(this.marketStress)) {
      this.marketStress = 0.16;
    }

    const storageUtil = this.metrics.storageUtilization || 0;
    const shipmentReliability = this.metrics.shipmentReliability ?? 1;
    const directiveReliability = this.metrics.directiveReliability ?? 1;
    const reliability = this.metrics.reliability ?? 1;
    const incidentCount = incidents?.incidents || 0;
    const incidentPenalty = incidents?.incidentPenalty || 0;
    const demandShortage = logistics?.demandShortage || 0;
    const scenarioRisk = scenario?.riskMultiplier || 1;

    const basePressure = 0.05 + (scenario?.environmentPressure || 0) * 0.14;
    const storagePressure = storageUtil > 0.8 ? (storageUtil - 0.8) * 0.85 : 0;
    const reliabilityPressure = Math.max(0, 1 - reliability) * (0.4 + scenarioRisk * 0.08);
    const shipmentPressure = Math.max(0, 1 - shipmentReliability) * 0.55;
    const directivePressure = Math.max(0, 1 - directiveReliability) * 0.32;
    const shortagePressure = demandShortage > 0 ? Math.min(0.26, demandShortage / 360) : 0;
    const incidentPressure = Math.min(0.28, incidentCount * 0.05 + incidentPenalty / 1150);

    const targetStress = clamp(
      basePressure +
        storagePressure +
        reliabilityPressure +
        shipmentPressure +
        directivePressure +
        shortagePressure +
        incidentPressure,
      0.04,
      0.65
    );

    this.marketStress += (targetStress - this.marketStress) * 0.16;

    const multiplier = clamp(1 - this.marketStress * 0.7, 0.55, 1.05);
    const carryingCost =
      storageUtil > 0.55
        ? Math.pow(storageUtil, 1.35) * 340 + Math.max(0, storageUtil - 0.85) * 640
        : storageUtil * 120;

    return { multiplier, carryingCost };
  }

  _pipelineMultiplier(stream) {
    const boost = this.pipelineBoosts?.[stream];
    if (!boost) {
      return 1;
    }
    if (boost.expiresAt <= this.timeMinutes) {
      delete this.pipelineBoosts[stream];
      return 1;
    }
    return typeof boost.multiplier === "number" ? boost.multiplier : 1;
  }

  _prunePipelineBoosts() {
    if (!this.pipelineBoosts) {
      return;
    }
    const now = this.timeMinutes;
    Object.entries({ ...this.pipelineBoosts }).forEach(([stream, boost]) => {
      if (!boost) {
        return;
      }
      if (boost.expiresAt <= now) {
        const label = boost.label || stream;
        this.pushLog("info", `${label} bypass crews stand down; capacity back to normal.`);
        delete this.pipelineBoosts[stream];
      }
    });
  }

  _calculateMarketDemand(hours, scenario) {
    const baseDemand = { gasoline: 55, diesel: 30, jet: 14 };
    const focus = clamp(this.params.productFocus, 0, 1);
    const focusShift = focus - 0.5;
    const reliability = clamp(this.metrics.reliability ?? 1, 0.4, 1.2);
    const score = typeof this.metrics.score === "number" ? this.metrics.score : 0;
    const gradeFactor = clamp(1 + score / 260, 0.75, 1.25);
    const demand = {
      gasoline:
        baseDemand.gasoline *
        (1 + (scenario?.gasolineBias || 0) * 0.9) *
        (1 + focusShift * 0.55),
      diesel:
        baseDemand.diesel *
        (1 + (scenario?.dieselBias || 0) * 0.9) *
        (1 - focusShift * 0.45),
      jet:
        baseDemand.jet *
        (1 + (scenario?.jetBias || 0) * 1.1) *
        (1 - Math.abs(focusShift) * 0.25),
    };

    const stability = 0.7 + reliability * 0.2;
    const adjusted = {};
    Object.entries(demand).forEach(([product, perDay]) => {
      const scaled = clamp(perDay * stability * gradeFactor, 0, perDay * 1.6);
      adjusted[product] = (scaled / HOURS_PER_DAY) * hours;
    });
    return adjusted;
  }

  _updateStorageAlert(product, ratio) {
    if (!this.storageAlertCache || !this.storageAlertCache[product]) {
      return;
    }
    const cache = this.storageAlertCache[product];
    cache.latestRatio = ratio * 100;
    const label = this._formatProductLabel(product);

    if (ratio >= 0.92) {
      const severity = ratio > 0.98 ? "danger" : "warning";
      if (!cache.highActive || cache.highSeverity !== severity) {
        cache.highActive = true;
        cache.highSeverity = severity;
        cache.highTime = this._formatTime();
        const message =
          severity === "danger"
            ? `${label} tank farm is overflowing at ${Math.round(ratio * 100)}% capacity.`
            : `${label} tanks at ${Math.round(ratio * 100)}% capacity.`;
        this.pushLog(
          severity === "danger" ? "danger" : "warning",
          `${message} Expedite shipments or cut crude charge.`,
          { product }
        );
      }
    } else if (cache.highActive && ratio <= 0.86) {
      cache.highActive = false;
      cache.highSeverity = "warning";
      cache.highTime = "";
      this.pushLog("info", `${label} storage relieved below 86%.`, { product });
    }

    if (ratio <= 0.14) {
      const severity = ratio < 0.07 ? "danger" : "warning";
      if (!cache.lowActive || cache.lowSeverity !== severity) {
        cache.lowActive = true;
        cache.lowSeverity = severity;
        cache.lowTime = this._formatTime();
        const message =
          severity === "danger"
            ? `${label} tanks nearly drained (${Math.round(ratio * 100)}%).`
            : `${label} storage running thin at ${Math.round(ratio * 100)}%.`;
        this.pushLog(
          severity === "danger" ? "danger" : "warning",
          `${message} Increase production or redirect supply.`,
          { product }
        );
      }
    } else if (cache.lowActive && ratio >= 0.2) {
      cache.lowActive = false;
      cache.lowSeverity = "warning";
      cache.lowTime = "";
      this.pushLog("info", `${label} storage recovered above 20%.`, { product });
    }
  }

  _formatProductLabel(product) {
    const label = PRODUCT_LABELS[product] || product;
    return label
      .split(" ")
      .map((segment) =>
        segment.length ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment
      )
      .join(" ");
  }

  _createRecorderState() {
    return {
      active: false,
      startedAt: 0,
      elapsedHours: 0,
      production: { gasoline: 0, diesel: 0, jet: 0 },
      profit: 0,
      penalty: 0,
      incidents: 0,
      reliabilityHours: 0,
      carbon: 0,
      shipments: { delivered: 0, missed: 0 },
    };
  }

  dispatchLogisticsConvoy() {
    if (this.logisticsRushCooldown > 0.1) {
      const waitHours = Math.max(1, Math.round(this.logisticsRushCooldown));
      this.pushLog(
        "warning",
        `Convoy already mobilized — wait ~${waitHours} h for crews to reset.`
      );
      return false;
    }

    const storage = this.storage;
    if (!storage?.levels) {
      this.pushLog("info", "Storage data unavailable; convoy dispatch skipped.");
      return false;
    }

    let targetProduct = null;
    let highestRatio = 0;
    Object.entries(storage.levels).forEach(([product, level]) => {
      const capacity = storage.capacity?.[product] || 0;
      if (!capacity) {
        return;
      }
      const ratio = clamp(level / capacity, 0, 1.2);
      if (ratio > highestRatio) {
        highestRatio = ratio;
        targetProduct = product;
      }
    });

    if (!targetProduct || highestRatio < 0.35) {
      this.logisticsRushCooldown = Math.max(this.logisticsRushCooldown, 2);
      this.pushLog("info", "Tanks are already comfortable — no need for a convoy right now.");
      return false;
    }

    const capacity = storage.capacity[targetProduct] || 0;
    const level = storage.levels[targetProduct] || 0;
    const reliefFraction = Math.min(0.28, 0.14 + highestRatio * 0.24);
    const relief = Math.min(level, capacity * reliefFraction);
    if (relief <= 0) {
      this.pushLog("info", "Convoy stood down — nothing available to move.");
      return false;
    }

    storage.levels[targetProduct] = clamp(level - relief, 0, capacity);
    const label = this._formatProductLabel(targetProduct);
    this.pendingOperationalCost += 260 + relief * 1.6;
    this.nextShipmentIn = Math.min(this.nextShipmentIn, 1.05);
    this.logisticsRushCooldown = 6;
    this._relieveStoragePressure(0.18);

    const rushDueIn = Math.min(Math.max(2.5, this.nextShipmentIn || 6), 6.5);
    this._scheduleShipment({
      product: targetProduct,
      dueIn: rushDueIn,
      rush: true,
    });

    this.pushLog(
      "info",
      `Convoy cleared ${relief.toFixed(0)} kb of ${label}; trucking charges booked to logistics.`,
      { product: targetProduct }
    );
    return { product: targetProduct, volume: relief };
  }

  delayNextShipment({ product } = {}) {
    const candidates = this.shipments
      .filter(
        (shipment) =>
          shipment &&
          shipment.status === "pending" &&
          !shipment.rush &&
          (typeof product === "string" ? shipment.product === product : true)
      )
      .sort((a, b) => (a.dueIn ?? Infinity) - (b.dueIn ?? Infinity));

    const target = candidates[0];
    if (!target) {
      this.pushLog("info", "No standard shipments available to delay.");
      return false;
    }

    const nowDue = Number.isFinite(target.dueIn) ? Math.max(0.1, target.dueIn) : 2.5;
    const baseWindow = Math.max(1.5, target.window || 6);
    const delayHours = clamp(Math.max(4, baseWindow * 0.4), 4, 10);
    const maxSlack = Math.max(6, baseWindow * 1.2);
    const newDue = Math.min(nowDue + delayHours, nowDue + maxSlack);

    if (newDue <= nowDue + 0.2) {
      this.pushLog("info", "Dock already allotted maximum slack for that charter.");
      return false;
    }

    target.dueIn = newDue;
    target.window = Math.max(target.window || newDue, newDue + Math.max(1.5, delayHours * 0.35));
    target.rescheduledAt = this.timeMinutes;

    this.pendingOperationalCost += delayHours * 18;
    this._updateNextShipmentCountdown();
    this._ensureScheduledShipments(this.shipmentHorizonHours);

    const label = this._formatProductLabel(target.product);
    this.pushLog(
      "info",
      `Delayed ${label} charter by ${delayHours.toFixed(1)} h to rebalance inventories.`,
      { product: target.product }
    );

    return { product: target.product, delay: delayHours, dueIn: target.dueIn };
  }

  requestExtraShipment() {
    if (this.extraShipmentCooldown > 0.1) {
      const waitHours = Math.max(1, Math.round(this.extraShipmentCooldown));
      this.pushLog(
        "info",
        `Expedite crews already en route — try again in ~${waitHours} h.`
      );
      return false;
    }

    if (!this.storage?.levels) {
      this.pushLog("info", "Storage data unavailable; request skipped.");
      return false;
    }

    let targetProduct = null;
    let highestRatio = 0;
    Object.entries(this.storage.levels).forEach(([product, level]) => {
      const capacity = this.storage.capacity?.[product] || 0;
      if (!capacity) {
        return;
      }
      const ratio = capacity ? clamp(level / capacity, 0, 1.2) : 0;
      if (ratio > highestRatio) {
        highestRatio = ratio;
        targetProduct = product;
      }
    });

    if (!targetProduct) {
      this.pushLog("info", "No product selected for emergency shipment.");
      return false;
    }

    if (highestRatio < 0.55) {
      this.pushLog("info", "Tanks are manageable — emergency charter not approved.");
      return false;
    }

    const capacity = this.storage.capacity[targetProduct] || 0;
    const level = this.storage.levels[targetProduct] || 0;
    if (level <= 0) {
      this.pushLog("info", "No inventory available to stage an emergency shipment.");
      return false;
    }

    const urgency = clamp((highestRatio - 0.55) / 0.45, 0, 1);
    const window = Math.max(0.8, randomRange(1.0, 1.6) * (1 - urgency * 0.35));
    const dueIn = Math.max(0.25, randomRange(0.35, 0.9) * (1 - urgency * 0.3));
    const volume = Math.min(level, capacity * clamp(0.12 + urgency * 0.24, 0.12, 0.34));

    const shipment = this._registerShipment({
      product: targetProduct,
      volume,
      window,
      dueIn,
      rush: true,
      autoplan: false,
    });
    if (!shipment) {
      this.pushLog("warning", "Unable to stage emergency charter; scheduling failed.");
      return false;
    }

    const cost = 420 + volume * 2.4;
    this.pendingOperationalCost += cost;
    this.extraShipmentCooldown = 4;
    this._relieveStoragePressure(0.1);

    const label = this._formatProductLabel(targetProduct);
    this.pushLog(
      "info",
      `Emergency charter staged: ${volume.toFixed(0)} kb of ${label} loading in ~${shipment.dueIn.toFixed(
        1
      )} h (cost $${cost.toFixed(0)}k).`
    );

    return { product: targetProduct, volume, dueIn: shipment.dueIn, cost };
  }

  expandStorageCapacity() {
    const level = this.storageUpgrades?.level || 0;
    if (level >= 6) {
      this.pushLog("info", "Tank farm already at maximum planned expansion.");
      return false;
    }

    const growth = clamp(0.08 + level * 0.02, 0.08, 0.18);
    const cost = 680 + level * 340;

    Object.entries(this.storage.capacity).forEach(([product, capacity]) => {
      const newCapacity = capacity * (1 + growth);
      this.storage.capacity[product] = newCapacity;
      if (this.storage.levels[product] > newCapacity) {
        this.storage.levels[product] = newCapacity;
      }
    });

    this.pendingOperationalCost += cost;
    this.storageUpgrades.level = level + 1;
    this._relieveStoragePressure(0.22);

    this.pushLog(
      "info",
      `Construction staged — tank farm capacity up ${(growth * 100).toFixed(0)}% (cost $${cost.toFixed(
        0
      )}k).`
    );

    return { level: this.storageUpgrades.level, growth, cost };
  }

  togglePerformanceRecording() {
    if (this.recorder?.active) {
      const summary = this._summarizeRecorderState();
      this.lastRecordingSummary = summary ? { ...summary } : null;
      this.recorder = this._createRecorderState();

      if (summary) {
        const duration = summary.durationHours || 0;
        const totalVolume =
          (summary.production.gasoline || 0) +
          (summary.production.diesel || 0) +
          (summary.production.jet || 0);
        const netProfit = summary.netProfit ?? summary.profit - summary.penalty;
        const reliabilityPct = Math.round((summary.avgReliability || 0) * 100);
        const missed = summary.shipments?.missed || 0;
        const level = missed > 0 ? (missed > 1 ? "warning" : "info") : "info";
        const profitLabel = `${netProfit >= 0 ? "+" : "-"}$${Math.abs(netProfit).toFixed(1)}M`;
        const message =
          `Recording stopped after ${duration.toFixed(1)} h — ${totalVolume.toFixed(0)} kb shipped, ` +
          `${profitLabel} net, reliability ${reliabilityPct}%.`;
        this.pushLog(level, message, { recording: summary });
      } else {
        this.pushLog("info", "Shift recorder cleared.");
      }

      return { active: false, summary };
    }

    this.recorder = this._createRecorderState();
    this.recorder.active = true;
    this.recorder.startedAt = this.timeMinutes;
    this.recorder.lastUpdatedAt = this.timeMinutes;
    this.pushLog("info", "Shift recorder armed — capturing performance snapshot.");
    return { active: true, summary: null };
  }

  getRecorderState() {
    const recorder = this.recorder || this._createRecorderState();
    return {
      active: Boolean(recorder.active),
      startedAt: recorder.startedAt || null,
      elapsedHours: recorder.elapsedHours || 0,
      lastUpdatedAt: recorder.lastUpdatedAt || null,
      production: { ...recorder.production },
      profit: recorder.profit || 0,
      penalty: recorder.penalty || 0,
      incidents: recorder.incidents || 0,
      shipments: { ...recorder.shipments },
      avgReliability:
        recorder.elapsedHours > 0
          ? recorder.reliabilityHours / recorder.elapsedHours
          : this.metrics.reliability || 0,
      carbonPerHour:
        recorder.elapsedHours > 0 ? recorder.carbon / recorder.elapsedHours : this.metrics.carbon || 0,
      lastSummary: this.lastRecordingSummary ? { ...this.lastRecordingSummary } : null,
    };
  }

  _summarizeRecorderState() {
    if (!this.recorder) {
      return null;
    }
    const duration = this.recorder.elapsedHours || 0;
    const avgReliability =
      duration > 0
        ? this.recorder.reliabilityHours / duration
        : Number.isFinite(this.metrics.reliability)
        ? this.metrics.reliability
        : 0;
    const production = {
      gasoline: this.recorder.production.gasoline || 0,
      diesel: this.recorder.production.diesel || 0,
      jet: this.recorder.production.jet || 0,
    };
    const summary = {
      startedAt: this.recorder.startedAt || this.timeMinutes,
      endedAt: this.timeMinutes,
      durationHours: duration,
      production,
      profit: this.recorder.profit || 0,
      penalty: this.recorder.penalty || 0,
      netProfit: (this.recorder.profit || 0) - (this.recorder.penalty || 0),
      incidents: this.recorder.incidents || 0,
      avgReliability,
      carbonPerHour:
        duration > 0 ? (this.recorder.carbon || 0) / duration : this.metrics.carbon || 0,
      shipments: {
        delivered: this.recorder.shipments.delivered || 0,
        missed: this.recorder.shipments.missed || 0,
      },
    };
    return summary;
  }

  deployPipelineBypass(targetUnitId) {
    const pipelineMap = {
      reformer: { stream: "toReformer", label: "reformer feed bypass" },
      fcc: { stream: "toCracker", label: "FCC transfer line" },
      hydrocracker: { stream: "toHydrocracker", label: "hydrocracker feed loop" },
      alkylation: { stream: "toAlkylation", label: "alkylation LPG manifold" },
    };

    const fallback = pipelineMap.hydrocracker || pipelineMap.fcc;
    const entry = pipelineMap[targetUnitId] || fallback;
    if (!entry) {
      this.pushLog("info", "No suitable pipeline to bypass.");
      return false;
    }

    const existing = this.pipelineBoosts?.[entry.stream];
    if (existing && existing.expiresAt > this.timeMinutes) {
      const remaining = Math.max(1, Math.round((existing.expiresAt - this.timeMinutes) / 60));
      this.pushLog("info", `${entry.label} already boosted for ~${remaining} more h.`);
      return false;
    }

    const duration = 300 + Math.random() * 120;
    if (!this.pipelineBoosts) {
      this.pipelineBoosts = {};
    }
    this.pipelineBoosts[entry.stream] = {
      multiplier: 1.25,
      expiresAt: this.timeMinutes + duration,
      label: entry.label,
    };
    this.pendingOperationalCost += 180;
    this.pushLog(
      "info",
      `${entry.label} staged; expect extra capacity for ~${Math.round(duration / 60)} h.`
    );
    return true;
  }

  scheduleTurnaround(unitId) {
    if (!unitId) {
      this.pushLog("info", "Select a processing unit to schedule a turnaround.");
      return false;
    }
    const unit = this.unitMap[unitId];
    if (!unit) {
      this.pushLog("info", "Unknown unit selected.");
      return false;
    }
    if (unit.downtime > 0) {
      this.pushLog(
        "warning",
        unit.name +
          " already offline for maintenance (" +
          Math.round(unit.downtime) +
          " min remaining).",
        { unitId }
      );
      return false;
    }

    const downtime = 180 + Math.random() * 180;
    unit.status = "offline";
    unit.downtime = downtime;
    unit.throughput = 0;
    unit.utilization = 0;
    unit.alert = "warning";
    unit.alertTimer = Math.max(unit.alertTimer, 120);
    unit.alertDetail = {
      kind: "turnaround",
      severity: "warning",
      summary: "Turnaround in progress",
      cause: "Estimated " + Math.round(downtime) + " minutes until restart.",
      guidance: "Expect improved integrity once crews wrap up.",
      recordedAt: this._formatTime(),
    };
    unit.integrity = clamp(unit.integrity + 0.3, 0, 1);
    this.pendingOperationalCost += 340;
    this.pushLog(
      "info",
      unit.name + " turnaround scheduled; crews draining and opening equipment.",
      { unitId }
    );
    return true;
  }

  performInspection(unitId) {
    if (!unitId) {
      this.pushLog("info", "Select a processing unit to inspect.");
      return null;
    }
    const unit = this.unitMap[unitId];
    if (!unit) {
      this.pushLog("info", "Unable to find that unit on the board.");
      return null;
    }

    const report = this._buildInspectionReport(unit);
    const level = report.severity === "danger" ? "danger" : report.severity === "warning" ? "warning" : "info";
    this.pushLog(level, `${unit.name} inspection: ${report.summary}`, { unitId, inspection: report });
    return report;
  }

  _buildInspectionReport(unit) {
    const integrity = clamp(unit.integrity ?? 1, 0, 1);
    const utilization = clamp(unit.utilization ?? 0, 0, 1.5);
    const downtime = Math.max(0, unit.downtime || 0);
    const incidents = Math.max(0, unit.incidents || 0);
    const alert = unit.alert || null;

    let severityScore = 0;
    if (alert === "warning") {
      severityScore = Math.max(severityScore, 1);
    } else if (alert === "danger") {
      severityScore = Math.max(severityScore, 2);
    }
    if (integrity < 0.35) {
      severityScore = Math.max(severityScore, 2);
    } else if (integrity < 0.6) {
      severityScore = Math.max(severityScore, 1);
    }
    if (downtime > 0) {
      severityScore = Math.max(severityScore, 1);
    }

    const findings = [];
    if (downtime > 0) {
      findings.push(`Offline for ${Math.round(downtime)} minutes of maintenance.`);
    } else {
      const loadPct = Math.round(utilization * 100);
      if (loadPct > 110) {
        findings.push(`Running hot at ${loadPct}% of rated capacity.`);
        severityScore = Math.max(severityScore, 1);
      } else if (loadPct < 45) {
        findings.push(`Coasting at ${loadPct}% utilization; spare capacity available.`);
      }
    }

    const integrityPct = Math.round(integrity * 100);
    if (integrityPct < 40) {
      findings.push(`Integrity degraded to ${integrityPct}% — immediate turnaround recommended.`);
    } else if (integrityPct < 65) {
      findings.push(`Integrity drifting low at ${integrityPct}%.`);
    } else {
      findings.push(`Mechanical integrity steady at ${integrityPct}%.`);
    }

    if (incidents > 0) {
      findings.push(`Logged ${incidents} incident${incidents === 1 ? "" : "s"} this shift.`);
      severityScore = Math.max(severityScore, incidents > 1 ? 2 : 1);
    }

    const recommendations = [];
    if (integrity < 0.55) {
      recommendations.push("Increase maintenance allocation or schedule a turnaround soon.");
    }
    if (utilization > 1.05) {
      recommendations.push("Trim feed rates or deploy a bypass to relieve the unit.");
    }
    if (!recommendations.length) {
      recommendations.push("Keep monitoring — no urgent actions flagged.");
    }

    const severity = severityScore >= 2 ? "danger" : severityScore === 1 ? "warning" : "info";
    const summary = findings[0] || "Unit operating within expected range.";

    return {
      unitId: unit.id,
      unitName: unit.name,
      severity,
      integrity,
      utilization,
      incidents,
      downtime,
      summary,
      findings,
      recommendations,
      timestamp: this._formatTime(),
    };
  }

  _seedDirectives() {
    while (this.directives.length < 3) {
      this.directives.push(this._createDirective());
    }
  }

  _createDirective() {
    const id = `dir-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const roll = Math.random();

    if (roll < 0.4) {
      const duration = randomRange(8, 14);
      const threshold = randomRange(0.74, 0.84);
      return {
        id,
        type: "reliability",
        title: `Hold reliability ≥ ${Math.round(threshold * 100)}%`,
        description: "Keep units stable and avoid unplanned outages for the next shift.",
        threshold,
        duration,
        timeRemaining: duration,
        status: "active",
        progress: 0,
        progressRatio: 0,
        cooldown: 0,
      };
    }

    if (roll < 0.7) {
      const products = ["gasoline", "diesel", "jet"];
      const product = products[Math.floor(Math.random() * products.length)];
      const base = product === "jet" ? 48 : product === "diesel" ? 60 : 72;
      const target = Math.round(randomRange(base * 0.85, base * 1.15));
      const duration = randomRange(12, 18);
      return {
        id,
        type: "delivery",
        title: `Stage ${target} kb ${PRODUCT_LABELS[product]}`,
        description: "Build inventory to satisfy a contracted marine charter.",
        product,
        target,
        duration,
        timeRemaining: duration,
        status: "active",
        progress: 0,
        progressRatio: 0,
        cooldown: 0,
      };
    }

    const duration = randomRange(10, 16);
    const threshold = Math.round(randomRange(64, 78));
    return {
      id,
      type: "carbon",
      title: `Hold carbon ≤ ${threshold} tCO₂-eq`,
      description: "Throttle flaring and emissions until regulators stand-down.",
      threshold,
      allowance: 1.2,
      breach: 0,
      duration,
      timeRemaining: duration,
      status: "active",
      progress: 0,
      progressRatio: 0,
      cooldown: 0,
    };
  }

  _updateDirectives(hours, context) {
    const shipments = context?.shipments ?? { delivered: {} };
    const metrics = context?.metrics ?? this.metrics;

    const completed = [];
    const failed = [];

    this.directives.forEach((directive) => {
      if (directive.status === "completed" || directive.status === "failed") {
        directive.cooldown = Math.max(0, (directive.cooldown || 0) - hours);
        return;
      }

      directive.timeRemaining = Math.max(0, directive.timeRemaining - hours);

      if (directive.type === "delivery") {
        const product = directive.product;
        const delivered = shipments.delivered?.[product] || 0;
        if (delivered > 0) {
          directive.progress = (directive.progress || 0) + delivered;
        }
        directive.progressRatio = directive.target
          ? clamp(directive.progress / directive.target, 0, 1)
          : 0;
        if (directive.progress >= directive.target) {
          directive.status = "completed";
          directive.cooldown = 6;
          completed.push(directive);
          this.pushLog("info", `Directive complete: ${directive.title}`);
        } else if (directive.timeRemaining <= 0) {
          directive.status = "failed";
          directive.cooldown = 6;
          failed.push(directive);
          this.pushLog("warning", `Directive lapsed: ${directive.title}`);
        }
        return;
      }

      if (directive.type === "reliability") {
        const ratio = directive.duration
          ? clamp(1 - directive.timeRemaining / directive.duration, 0, 1)
          : 0;
        directive.progressRatio = ratio;
        if (metrics.reliability < directive.threshold) {
          directive.status = "failed";
          directive.cooldown = 6;
          failed.push(directive);
          this.pushLog("warning", `Directive failed: ${directive.title}`);
        } else if (directive.timeRemaining <= 0) {
          directive.status = "completed";
          directive.cooldown = 6;
          completed.push(directive);
          this.pushLog("info", `Directive complete: ${directive.title}`);
        }
        return;
      }

      if (directive.type === "carbon") {
        const ratio = directive.duration
          ? clamp(1 - directive.timeRemaining / directive.duration, 0, 1)
          : 0;
        directive.progressRatio = ratio;
        directive.breach = directive.breach || 0;
        if (metrics.carbon > directive.threshold) {
          directive.breach += hours;
        } else if (directive.breach > 0) {
          directive.breach = Math.max(0, directive.breach - hours * 0.5);
        }
        if (directive.breach >= (directive.allowance || 1)) {
          directive.status = "failed";
          directive.cooldown = 6;
          failed.push(directive);
          this.pushLog("warning", `Directive failed: ${directive.title}`);
        } else if (directive.timeRemaining <= 0) {
          directive.status = "completed";
          directive.cooldown = 6;
          completed.push(directive);
          this.pushLog("info", `Directive complete: ${directive.title}`);
        }
      }
    });

    if (completed.length || failed.length) {
      completed.forEach(() => {
        this.directiveStats.total += 1;
        this.directiveStats.completed += 1;
        this.metrics.directivesCompleted += 1;
      });
      failed.forEach(() => {
        this.directiveStats.total += 1;
        this.directiveStats.failed = (this.directiveStats.failed || 0) + 1;
      });
    }

    this.directives = this.directives.filter(
      (directive) => directive.status === "active" || (directive.cooldown || 0) > 0
    );

    let activeCount = this.directives.filter((directive) => directive.status === "active").length;
    while (activeCount < 3) {
      this.directives.push(this._createDirective());
      activeCount += 1;
    }

    const total = this.directiveStats.total;
    this.metrics.directiveReliability = total ? clamp(this.directiveStats.completed / total, 0, 1) : 1;
  }

  _updateAlerts(deltaMinutes) {
    this.units.forEach((unit) => {
      if (!unit) {
        return;
      }
      if (unit.status === "offline") {
        const severity = unit.alert === "danger" ? "danger" : "warning";
        unit.alert = severity;
        this._ensureOfflineAlertDetail(unit, severity);
        unit.alertTimer = Math.max(unit.alertTimer, severity === "danger" ? 180 : 90);
      } else if (unit.status === "online" && unit.integrity < 0.45) {
        const severity = unit.integrity < 0.28 ? "danger" : "warning";
        unit.alert = severity;
        this._ensureIntegrityAlertDetail(unit, severity);
        unit.alertTimer = Math.max(unit.alertTimer, severity === "danger" ? 60 : 30);
      } else if (unit.alert && unit.status === "online" && unit.integrity >= 0.6) {
        if (unit.alertDetail && unit.alertDetail.kind !== "incident") {
          unit.alertDetail = null;
        }
        unit.alert = null;
      }

      if (unit.alertTimer > 0) {
        unit.alertTimer = Math.max(0, unit.alertTimer - deltaMinutes);
        if (
          unit.alertTimer === 0 &&
          unit.status === "online" &&
          unit.integrity >= 0.6 &&
          unit.alert !== "danger"
        ) {
          if (unit.alertDetail && unit.alertDetail.kind !== "incident") {
            unit.alertDetail = null;
          }
          unit.alert = null;
        }
      }
    });
  }

  _ensureOfflineAlertDetail(unit, severity) {
    if (unit.alertDetail && unit.alertDetail.kind === "incident") {
      return;
    }
    const summary = unit.emergencyOffline
      ? "Emergency shutdown"
      : unit.manualOffline
      ? "Manual standby"
      : "Offline for repairs";
    const cause = unit.emergencyOffline
      ? "Emergency stop engaged; crews are stabilizing conditions."
      : unit.manualOffline
      ? "Operators have parked the unit in standby."
      : "Maintenance crews are restoring the unit to service.";
    const guidance = unit.emergencyOffline
      ? "Investigate alarms and release the hold once the area is safe."
      : unit.manualOffline
      ? "Resume operations when downstream demand requires it."
      : "Increase maintenance resources to hasten repairs.";

    if (!unit.alertDetail || unit.alertDetail.kind !== "offline") {
      unit.alertDetail = {
        kind: "offline",
        severity,
        summary,
        cause,
        guidance,
        recordedAt: this._formatTime(),
      };
    } else {
      unit.alertDetail.severity = severity;
      unit.alertDetail.summary = summary;
      unit.alertDetail.cause = cause;
      unit.alertDetail.guidance = guidance;
    }
  }

  _ensureIntegrityAlertDetail(unit, severity) {
    if (unit.alertDetail && unit.alertDetail.kind === "incident") {
      return;
    }
    const integrityPercent = Math.round((unit.integrity ?? 0) * 100);
    const summary = severity === "danger" ? "Integrity critical" : "Integrity low";
    const cause = `Integrity at ${integrityPercent}%.`;
    const guidance =
      severity === "danger"
        ? "Cut feed immediately and dispatch maintenance crews."
        : "Ease throughput and increase maintenance to recover.";

    if (!unit.alertDetail || unit.alertDetail.kind !== "integrity") {
      unit.alertDetail = {
        kind: "integrity",
        severity,
        summary,
        cause,
        guidance,
        integrity: unit.integrity,
        recordedAt: this._formatTime(),
      };
    } else {
      unit.alertDetail.severity = severity;
      unit.alertDetail.summary = summary;
      unit.alertDetail.cause = cause;
      unit.alertDetail.guidance = guidance;
      unit.alertDetail.integrity = unit.integrity;
    }
  }

  getLogisticsState() {
    return {
      storage: {
        capacity: { ...this.storage.capacity },
        levels: { ...this.storage.levels },
        baseCapacity: { ...(this.storageBaseCapacity || this.storage.capacity) },
      },
      shipments: this.shipments.map((shipment) => ({ ...shipment })),
      stats: { ...this.shipmentStats },
      convoyCooldown: this.logisticsRushCooldown,
      nextShipmentIn: Math.max(0, this.nextShipmentIn),
      pressure: this.storagePressure ? { ...this.storagePressure } : { active: false, throttle: 1, timer: 0 },
      extraShipmentCooldown: this.extraShipmentCooldown || 0,
      upgrades: { ...this.storageUpgrades },
      alerts: this.getStorageAlerts(),
      inventory: {
        levels: { ...this.storage.levels },
        capacity: { ...this.storage.capacity },
      },
    };
  }

  getStorageAlerts() {
    const alerts = [];
    if (!this.storageAlertCache) {
      return alerts;
    }
    Object.entries(this.storageAlertCache).forEach(([product, cache]) => {
      const capacity = this.storage.capacity[product] || 0;
      const level = this.storage.levels[product] || 0;
      const ratio = capacity ? clamp(level / capacity, 0, 1.2) : 0;
      const label = this._formatProductLabel(product);
      if (cache.highActive) {
        alerts.push({
          type: "storage",
          product,
          label,
          severity: cache.highSeverity || "warning",
          summary: cache.highSeverity === "danger" ? "Tanks critical" : "Tanks near capacity",
          detail: `${label} storage at ${Math.round(ratio * 100)}% (${level.toFixed(0)} / ${capacity.toFixed(0)} kb).`,
          guidance: "Schedule exports or trim crude rates to relieve pressure.",
          recordedAt: cache.highTime,
          percent: ratio * 100,
        });
      }
      if (cache.lowActive) {
        alerts.push({
          type: "storage",
          product,
          label,
          severity: cache.lowSeverity || "warning",
          summary: cache.lowSeverity === "danger" ? "Tanks nearly empty" : "Tanks running low",
          detail: `${label} tanks at ${Math.round(ratio * 100)}% (${level.toFixed(0)} / ${capacity.toFixed(0)} kb).`,
          guidance: "Boost production, delay the next charter, or call an emergency shipment until inventory recovers.",
          recordedAt: cache.lowTime,
          percent: ratio * 100,
        });
      }
    });
    return alerts;
  }

  getActiveAlerts() {
    const alerts = [];
    this.units.forEach((unit) => {
      if (!unit.alert) {
        return;
      }
      const detail = unit.alertDetail || unit.lastIncident || {};
      const summary = detail.summary
        || (unit.status === "offline"
          ? unit.emergencyOffline
            ? "Emergency shutdown"
            : "Offline for repairs"
          : unit.alert === "danger"
          ? "Critical fault"
          : unit.alert === "warning"
          ? `Integrity ${Math.round((unit.integrity ?? 0) * 100)}%`
          : "Process warning");
      const detailText = detail.cause
        || (unit.alert === "warning" && typeof unit.integrity === "number"
          ? `Integrity at ${Math.round(unit.integrity * 100)}%.`
          : "");
      const guidance = detail.guidance
        || (unit.alert === "danger"
          ? "Dispatch crews and stabilize the unit immediately."
          : unit.alert === "warning"
          ? "Increase maintenance or trim feed to recover stability."
          : "");
      alerts.push({
        type: "unit",
        unitId: unit.id,
        label: unit.name,
        name: unit.name,
        severity: detail.severity || unit.alert,
        summary,
        detail: detailText,
        guidance,
        recordedAt: detail.recordedAt || "",
      });
    });
    return alerts.concat(this.getStorageAlerts());
  }

  getDirectives() {
    return this.directives.map((directive) => ({ ...directive }));
  }

  getProcessTopology() {
    return this.processTopology;
  }

  getUnitOverride(unitId) {
    const override = this.unitOverrides[unitId];
    if (!override) {
      return { throttle: 1, offline: false };
    }
    return {
      throttle: typeof override.throttle === "number" ? clamp(override.throttle, 0, 1.2) : 1,
      offline: Boolean(override.offline),
    };
  }

  getUnitOverrides() {
    const map = {};
    Object.entries(this.unitOverrides).forEach(([unitId, override]) => {
      map[unitId] = {
        throttle: typeof override.throttle === "number" ? clamp(override.throttle, 0, 1.2) : 1,
        offline: Boolean(override.offline),
      };
    });
    return map;
  }
  createSnapshot() {
    const clone = (value) => {
      if (Array.isArray(value)) {
        return value.map((item) => clone(item));
      }
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
      }
      return value;
    };

    const units = this.units.map((unit) => ({
      id: unit.id,
      integrity: unit.integrity,
      status: unit.status,
      downtime: unit.downtime,
      incidents: unit.incidents,
      manualOffline: unit.manualOffline,
      emergencyOffline: unit.emergencyOffline,
      overrideThrottle: unit.overrideThrottle,
      mode: unit.mode,
      alert: unit.alert,
      alertTimer: unit.alertTimer,
      alertDetail: unit.alertDetail ? clone(unit.alertDetail) : null,
      lastIncident: unit.lastIncident ? clone(unit.lastIncident) : null,
    }));

    const snapshot = {
      version: 1,
      timeMinutes: this.timeMinutes,
      running: this.running,
      speedMultiplier: this.speedMultiplier,
      params: { ...this.params },
      scenario: this.activeScenarioKey,
      metrics: { ...this.metrics },
      flows: { ...this.flows },
      marketStress: this.marketStress,
      pendingOperationalCost: this.pendingOperationalCost,
      logisticsRushCooldown: this.logisticsRushCooldown,
      nextShipmentIn: this.nextShipmentIn,
      emergencyShutdown: this.emergencyShutdown,
      storage: {
        capacity: { ...this.storage.capacity },
        levels: { ...this.storage.levels },
        baseCapacity: { ...(this.storageBaseCapacity || this.storage.capacity) },
      },
      storageAlerts: clone(this.storageAlertCache),
      shipments: this.shipments.map((shipment) => ({ ...shipment })),
      shipmentStats: { ...this.shipmentStats },
      pipelineBoosts: clone(this.pipelineBoosts),
      unitOverrides: this.getUnitOverrides(),
      units,
      recorder: this.getRecorderState(),
      lastRecordingSummary: this.lastRecordingSummary ? { ...this.lastRecordingSummary } : null,
      storagePressure: this.storagePressure ? { ...this.storagePressure } : null,
      extraShipmentCooldown: this.extraShipmentCooldown,
      storageUpgrades: this.storageUpgrades ? { ...this.storageUpgrades } : null,
      directives: this.directives.map((directive) => ({ ...directive })),
      directiveStats: { ...this.directiveStats },
      performanceHistory: this.performanceHistory.map((entry) => ({ ...entry })),
      logs: this.logs.map((entry) => ({ ...entry })),
      market: this.getMarketState(),
    };

    return snapshot;
  }

  loadSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Invalid snapshot payload");
    }

    this._accumulator = 0;
    this.stepOnce = false;

    if (typeof snapshot.running === "boolean") {
      this.running = snapshot.running;
    }

    if (typeof snapshot.timeMinutes === "number" && Number.isFinite(snapshot.timeMinutes)) {
      this.timeMinutes = Math.max(0, snapshot.timeMinutes);
    } else {
      this.timeMinutes = 0;
    }

    if (typeof snapshot.speedMultiplier === "number") {
      this.setSpeedMultiplier(snapshot.speedMultiplier);
    } else {
      this.setSpeedMultiplier(1);
    }

    if (snapshot.params && typeof snapshot.params === "object") {
      Object.entries(snapshot.params).forEach(([key, value]) => {
        if (key in this.params && typeof value === "number" && Number.isFinite(value)) {
          this.params[key] = value;
        }
      });
    }

    if (snapshot.scenario && this.scenarios[snapshot.scenario]) {
      this.activeScenarioKey = snapshot.scenario;
      this.activeScenario = this.scenarios[this.activeScenarioKey];
    }

    if (!this.storage) {
      this.storage = this._initStorage();
    }
    if (!this.storageAlertCache) {
      this.storageAlertCache = this._createStorageAlertCache();
    }

    if (snapshot.storage && typeof snapshot.storage === "object") {
      if (snapshot.storage.capacity && typeof snapshot.storage.capacity === "object") {
        Object.entries(snapshot.storage.capacity).forEach(([product, capacity]) => {
          if (typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0) {
            this.storage.capacity[product] = capacity;
          }
        });
      }

      if (snapshot.storage.levels && typeof snapshot.storage.levels === "object") {
        Object.entries(snapshot.storage.levels).forEach(([product, level]) => {
          if (typeof level !== "number" || !Number.isFinite(level)) {
            return;
          }
          const capacity = this.storage.capacity[product] || 0;
          const clampMax = capacity || Math.max(level, 0);
          this.storage.levels[product] = clamp(level, 0, clampMax);
        });
      }

      if (snapshot.storage.baseCapacity && typeof snapshot.storage.baseCapacity === "object") {
        this.storageBaseCapacity = { ...snapshot.storage.baseCapacity };
      }
    }

    if (!this.storageBaseCapacity) {
      this.storageBaseCapacity = { ...this.storage.capacity };
    }

    this.storageAlertCache = this._createStorageAlertCache();
    if (snapshot.storageAlerts && typeof snapshot.storageAlerts === "object") {
      Object.entries(snapshot.storageAlerts).forEach(([product, cache]) => {
        if (!cache || typeof cache !== "object") {
          return;
        }
        if (!this.storageAlertCache[product]) {
          this.storageAlertCache[product] = { ...cache };
        } else {
          this.storageAlertCache[product] = {
            ...this.storageAlertCache[product],
            ...cache,
          };
        }
      });
    }

    this.metrics = { ...this.metrics, ...(snapshot.metrics || {}) };
    this.flows = { ...this.flows, ...(snapshot.flows || {}) };

    if (snapshot.market && typeof snapshot.market === "object") {
      const restored = this._initMarketState();
      if (snapshot.market.futures && typeof snapshot.market.futures === "object") {
        Object.entries(snapshot.market.futures).forEach(([product, value]) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            restored.futures[product] = value;
          }
        });
      }
      if (snapshot.market.productionCost && typeof snapshot.market.productionCost === "object") {
        Object.entries(snapshot.market.productionCost).forEach(([product, value]) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            restored.productionCost[product] = value;
          }
        });
      }
      if (snapshot.market.basis && typeof snapshot.market.basis === "object") {
        Object.entries(snapshot.market.basis).forEach(([product, value]) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            restored.basis[product] = value;
          }
        });
      }
      this.market = restored;
    } else {
      this.market = this._initMarketState();
    }

    if (this.market) {
      this.metrics.futuresGasoline = this.market.futures.gasoline;
      this.metrics.futuresDiesel = this.market.futures.diesel;
      this.metrics.futuresJet = this.market.futures.jet;
      this.metrics.costGasoline = this.market.productionCost.gasoline;
      this.metrics.costDiesel = this.market.productionCost.diesel;
      this.metrics.costJet = this.market.productionCost.jet;
      this.metrics.basisGasoline = this.market.basis.gasoline;
      this.metrics.basisDiesel = this.market.basis.diesel;
      this.metrics.basisJet = this.market.basis.jet;
    }

    if (typeof snapshot.marketStress === "number" && Number.isFinite(snapshot.marketStress)) {
      this.marketStress = clamp(snapshot.marketStress, 0, 1);
    }

    this.pendingOperationalCost =
      typeof snapshot.pendingOperationalCost === "number" && Number.isFinite(snapshot.pendingOperationalCost)
        ? snapshot.pendingOperationalCost
        : 0;

    this.logisticsRushCooldown =
      typeof snapshot.logisticsRushCooldown === "number" && Number.isFinite(snapshot.logisticsRushCooldown)
        ? Math.max(0, snapshot.logisticsRushCooldown)
        : 0;

    this.nextShipmentIn =
      typeof snapshot.nextShipmentIn === "number" && Number.isFinite(snapshot.nextShipmentIn)
        ? Math.max(0, snapshot.nextShipmentIn)
        : this.nextShipmentIn;

    if (snapshot.storagePressure && typeof snapshot.storagePressure === "object") {
      this.storagePressure = {
        active: Boolean(snapshot.storagePressure.active),
        throttle:
          typeof snapshot.storagePressure.throttle === "number"
            ? clamp(snapshot.storagePressure.throttle, 0.45, 1)
            : 1,
        timer:
          typeof snapshot.storagePressure.timer === "number" && Number.isFinite(snapshot.storagePressure.timer)
            ? Math.max(0, snapshot.storagePressure.timer)
            : 0,
        lastRatio:
          typeof snapshot.storagePressure.lastRatio === "number"
            ? clamp(snapshot.storagePressure.lastRatio, 0, 1.2)
            : 0,
      };
    } else {
      this.storagePressure = { active: false, throttle: 1, timer: 0, lastRatio: 0 };
    }

    this.extraShipmentCooldown =
      typeof snapshot.extraShipmentCooldown === "number" && Number.isFinite(snapshot.extraShipmentCooldown)
        ? Math.max(0, snapshot.extraShipmentCooldown)
        : 0;

    if (snapshot.storageUpgrades && typeof snapshot.storageUpgrades === "object") {
      this.storageUpgrades = {
        level:
          typeof snapshot.storageUpgrades.level === "number" && Number.isFinite(snapshot.storageUpgrades.level)
            ? Math.max(0, Math.round(snapshot.storageUpgrades.level))
            : 0,
      };
    } else {
      this.storageUpgrades = { level: 0 };
    }

    if (snapshot.recorder && typeof snapshot.recorder === "object") {
      const restored = this._createRecorderState();
      restored.active = Boolean(snapshot.recorder.active);
      restored.startedAt =
        typeof snapshot.recorder.startedAt === "number" && Number.isFinite(snapshot.recorder.startedAt)
          ? snapshot.recorder.startedAt
          : 0;
      restored.elapsedHours =
        typeof snapshot.recorder.elapsedHours === "number" && Number.isFinite(snapshot.recorder.elapsedHours)
          ? Math.max(0, snapshot.recorder.elapsedHours)
          : 0;
      restored.lastUpdatedAt =
        typeof snapshot.recorder.lastUpdatedAt === "number" && Number.isFinite(snapshot.recorder.lastUpdatedAt)
          ? snapshot.recorder.lastUpdatedAt
          : null;
      restored.profit =
        typeof snapshot.recorder.profit === "number" && Number.isFinite(snapshot.recorder.profit)
          ? snapshot.recorder.profit
          : 0;
      restored.penalty =
        typeof snapshot.recorder.penalty === "number" && Number.isFinite(snapshot.recorder.penalty)
          ? Math.max(0, snapshot.recorder.penalty)
          : 0;
      restored.incidents =
        typeof snapshot.recorder.incidents === "number" && Number.isFinite(snapshot.recorder.incidents)
          ? Math.max(0, snapshot.recorder.incidents)
          : 0;
      restored.reliabilityHours =
        typeof snapshot.recorder.reliabilityHours === "number" && Number.isFinite(snapshot.recorder.reliabilityHours)
          ? Math.max(0, snapshot.recorder.reliabilityHours)
          : 0;
      restored.carbon =
        typeof snapshot.recorder.carbon === "number" && Number.isFinite(snapshot.recorder.carbon)
          ? Math.max(0, snapshot.recorder.carbon)
          : 0;
      if (snapshot.recorder.production && typeof snapshot.recorder.production === "object") {
        ["gasoline", "diesel", "jet"].forEach((product) => {
          const value = snapshot.recorder.production[product];
          if (typeof value === "number" && Number.isFinite(value)) {
            restored.production[product] = Math.max(0, value);
          }
        });
      }
      if (snapshot.recorder.shipments && typeof snapshot.recorder.shipments === "object") {
        const delivered = snapshot.recorder.shipments.delivered;
        const missed = snapshot.recorder.shipments.missed;
        restored.shipments.delivered =
          typeof delivered === "number" && Number.isFinite(delivered) ? Math.max(0, delivered) : 0;
        restored.shipments.missed =
          typeof missed === "number" && Number.isFinite(missed) ? Math.max(0, missed) : 0;
      }
      this.recorder = restored;
    } else {
      this.recorder = this._createRecorderState();
    }

    if (snapshot.lastRecordingSummary && typeof snapshot.lastRecordingSummary === "object") {
      this.lastRecordingSummary = { ...snapshot.lastRecordingSummary };
    } else {
      this.lastRecordingSummary = null;
    }

    if (typeof snapshot.emergencyShutdown === "boolean") {
      this.emergencyShutdown = snapshot.emergencyShutdown;
    } else {
      this.emergencyShutdown = false;
    }

    if (snapshot.pipelineBoosts && typeof snapshot.pipelineBoosts === "object") {
      this.pipelineBoosts = {};
      Object.entries(snapshot.pipelineBoosts).forEach(([stream, boost]) => {
        if (!boost || typeof boost !== "object") {
          return;
        }
        const multiplier =
          typeof boost.multiplier === "number" && Number.isFinite(boost.multiplier)
            ? boost.multiplier
            : 1;
        const expiresAt =
          typeof boost.expiresAt === "number" && Number.isFinite(boost.expiresAt)
            ? boost.expiresAt
            : this.timeMinutes;
        const label = typeof boost.label === "string" ? boost.label : stream;
        this.pipelineBoosts[stream] = { multiplier, expiresAt, label };
      });
    } else {
      this.pipelineBoosts = {};
    }

    if (Array.isArray(snapshot.shipments)) {
      this.shipments = snapshot.shipments.map((shipment, index) => {
        const id =
          typeof shipment.id === "string" && shipment.id
            ? shipment.id
            : `snapshot-ship-${index}-${Math.random().toString(16).slice(2, 6)}`;
        const product = shipment.product || "gasoline";
        const volume =
          typeof shipment.volume === "number" && Number.isFinite(shipment.volume) ? shipment.volume : 0;
        const window =
          typeof shipment.window === "number" && Number.isFinite(shipment.window) ? shipment.window : 0;
        const dueIn =
          typeof shipment.dueIn === "number" && Number.isFinite(shipment.dueIn)
            ? shipment.dueIn
            : window;
        const status =
          shipment.status === "completed" || shipment.status === "missed" || shipment.status === "pending"
            ? shipment.status
            : "pending";
        const createdAt =
          typeof shipment.createdAt === "number" && Number.isFinite(shipment.createdAt)
            ? shipment.createdAt
            : this.timeMinutes;
        const cooldown =
          typeof shipment.cooldown === "number" && Number.isFinite(shipment.cooldown)
            ? Math.max(0, shipment.cooldown)
            : 0;
        const record = {
          id,
          product,
          volume,
          window,
          dueIn,
          status,
          createdAt,
          cooldown,
        };
        if (typeof shipment.completedAt === "number" && Number.isFinite(shipment.completedAt)) {
          record.completedAt = shipment.completedAt;
        }
        if (typeof shipment.shortage === "number" && Number.isFinite(shipment.shortage)) {
          record.shortage = Math.max(0, shipment.shortage);
        }
        return record;
      });
    } else {
      this.shipments = [];
    }

    if (snapshot.shipmentStats && typeof snapshot.shipmentStats === "object") {
      const { total, onTime, missed } = snapshot.shipmentStats;
      this.shipmentStats = {
        total: typeof total === "number" && Number.isFinite(total) ? Math.max(0, total) : 0,
        onTime: typeof onTime === "number" && Number.isFinite(onTime) ? Math.max(0, onTime) : 0,
        missed: typeof missed === "number" && Number.isFinite(missed) ? Math.max(0, missed) : 0,
      };
    } else {
      this.shipmentStats = { total: 0, onTime: 0, missed: 0 };
    }

    this._updateNextShipmentCountdown();
    this._ensureScheduledShipments(this.shipmentHorizonHours);

    this.units.forEach((unit) => {
      unit.throughput = 0;
      unit.utilization = 0;
    });

    if (Array.isArray(snapshot.units)) {
      snapshot.units.forEach((entry) => {
        const unit = entry && this.unitMap[entry.id];
        if (!unit) {
          return;
        }
        if (typeof entry.integrity === "number" && Number.isFinite(entry.integrity)) {
          unit.integrity = clamp(entry.integrity, 0, 1);
        }
        if (typeof entry.downtime === "number" && Number.isFinite(entry.downtime)) {
          unit.downtime = Math.max(0, entry.downtime);
        }
        if (typeof entry.incidents === "number" && Number.isFinite(entry.incidents)) {
          unit.incidents = Math.max(0, entry.incidents);
        }
        if (typeof entry.status === "string") {
          unit.status = entry.status;
        }
        unit.manualOffline = Boolean(entry.manualOffline);
        unit.emergencyOffline = Boolean(entry.emergencyOffline);
        if (typeof entry.overrideThrottle === "number" && Number.isFinite(entry.overrideThrottle)) {
          unit.overrideThrottle = clamp(entry.overrideThrottle, 0, 1.2);
        }
        if (typeof entry.mode === "string") {
          unit.mode = entry.mode;
        }
        if (typeof entry.alert === "string" || entry.alert === null) {
          unit.alert = entry.alert;
        }
        if (typeof entry.alertTimer === "number" && Number.isFinite(entry.alertTimer)) {
          unit.alertTimer = Math.max(0, entry.alertTimer);
        } else {
          unit.alertTimer = Math.max(0, unit.alertTimer || 0);
        }
        unit.alertDetail = entry.alertDetail ? { ...entry.alertDetail } : null;
        unit.lastIncident = entry.lastIncident ? { ...entry.lastIncident } : null;
      });
    }

    this.unitOverrides = {};
    if (snapshot.unitOverrides && typeof snapshot.unitOverrides === "object") {
      Object.entries(snapshot.unitOverrides).forEach(([unitId, override]) => {
        if (!override || typeof override !== "object") {
          return;
        }
        const unit = this.unitMap[unitId];
        if (!unit) {
          return;
        }
        const record = {};
        if (typeof override.throttle === "number" && Number.isFinite(override.throttle)) {
          record.throttle = clamp(override.throttle, 0, 1.2);
          unit.overrideThrottle = record.throttle;
        }
        if (override.offline) {
          record.offline = true;
          unit.manualOffline = unit.manualOffline || !unit.emergencyOffline;
          if (unit.downtime <= 0 && unit.status !== "offline") {
            unit.status = "standby";
          }
        }
        if (Object.keys(record).length) {
          this.unitOverrides[unitId] = record;
        }
      });
    }

    if (Array.isArray(snapshot.directives)) {
      this.directives = snapshot.directives.map((directive) => ({ ...directive }));
    } else {
      this.directives = [];
    }
    while (this.directives.length < 3) {
      this.directives.push(this._createDirective());
    }

    if (snapshot.directiveStats && typeof snapshot.directiveStats === "object") {
      this.directiveStats = {
        total:
          typeof snapshot.directiveStats.total === "number" && Number.isFinite(snapshot.directiveStats.total)
            ? Math.max(0, snapshot.directiveStats.total)
            : 0,
        completed:
          typeof snapshot.directiveStats.completed === "number" && Number.isFinite(snapshot.directiveStats.completed)
            ? Math.max(0, snapshot.directiveStats.completed)
            : 0,
        failed:
          typeof snapshot.directiveStats.failed === "number" && Number.isFinite(snapshot.directiveStats.failed)
            ? Math.max(0, snapshot.directiveStats.failed)
            : 0,
      };
    } else {
      this.directiveStats = { total: this.directives.length, completed: 0, failed: 0 };
    }

    if (Array.isArray(snapshot.performanceHistory)) {
      this.performanceHistory = snapshot.performanceHistory
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({ ...entry }))
        .slice(-120);
    } else {
      this.performanceHistory = [];
    }

    if (Array.isArray(snapshot.logs)) {
      this.logs = snapshot.logs
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          level: entry.level || "info",
          message: entry.message || "",
          timestamp: entry.timestamp || this._formatTime(),
          unitId: entry.unitId,
          product: entry.product,
        }))
        .slice(-80);
    } else {
      this.logs = [];
    }

    const storageLevels = this.storage?.levels || {};
    const storageCapacity = this.storage?.capacity || {};
    const levelTotal =
      (storageLevels.gasoline || 0) + (storageLevels.diesel || 0) + (storageLevels.jet || 0);
    const capacityTotal =
      (storageCapacity.gasoline || 0) + (storageCapacity.diesel || 0) + (storageCapacity.jet || 0);
    this.metrics.storageGasoline = this._round(storageLevels.gasoline || 0);
    this.metrics.storageDiesel = this._round(storageLevels.diesel || 0);
    this.metrics.storageJet = this._round(storageLevels.jet || 0);
    this.metrics.storageUtilization = capacityTotal ? clamp(levelTotal / capacityTotal, 0, 1) : 0;

    const shipmentTotal = Math.max(0, this.shipmentStats.total || 0);
    const onTime = Math.max(0, this.shipmentStats.onTime || 0);
    this.metrics.shipmentReliability = shipmentTotal ? clamp(onTime / shipmentTotal, 0, 1) : 1;

    this.metrics.directivesCompleted = this.directiveStats.completed || 0;
    const directiveTotal = Math.max(0, this.directiveStats.total || 0);
    const directiveReliability = directiveTotal
      ? clamp((this.directiveStats.completed || 0) / directiveTotal, 0, 1)
      : 1;
    this.metrics.directiveReliability = directiveReliability;

    if (!Number.isFinite(this.metrics.reliability) || this.metrics.reliability === undefined) {
      const averageIntegrity =
        this.units.reduce((sum, unit) => sum + (unit.integrity || 0), 0) / Math.max(1, this.units.length);
      this.metrics.reliability = clamp(averageIntegrity, 0, 1);
    }
  }

  setUnitThrottle(unitId, fraction, options = {}) {
    const unit = this.unitMap[unitId];
    if (!unit) {
      return;
    }
    const throttle = clamp(typeof fraction === "number" ? fraction : 1, 0, 1.2);
    let override = this.unitOverrides[unitId];
    if (!override) {
      override = {};
    }
    if (throttle >= 0.99) {
      delete override.throttle;
    } else {
      override.throttle = throttle;
    }
    unit.overrideThrottle = throttle;
    if (override.offline) {
      this.unitOverrides[unitId] = override;
    } else if (override.throttle === undefined) {
      delete this.unitOverrides[unitId];
    } else {
      this.unitOverrides[unitId] = override;
    }
    if (!options.quiet) {
      this.pushLog(
        "info",
        `${unit.name} throughput target set to ${Math.round(throttle * 100)}%.`,
        { unitId }
      );
    }
  }

  setUnitOffline(unitId, offline, options = {}) {
    const unit = this.unitMap[unitId];
    if (!unit) {
      return;
    }
    if (options.emergencyOnly && !unit.emergencyOffline) {
      return;
    }
    let override = this.unitOverrides[unitId];
    if (!override) {
      override = {};
    }

    if (offline) {
      override.offline = true;
      unit.manualOffline = !options.emergency;
      unit.emergencyOffline = Boolean(options.emergency);
      if (unit.downtime <= 0 && unit.status !== "offline") {
        unit.status = "standby";
      }
      unit.throughput = 0;
      unit.utilization = 0;
      unit.overrideThrottle = 0;
    } else {
      if (options.emergencyOnly && !unit.emergencyOffline) {
        return;
      }
      delete override.offline;
      unit.emergencyOffline = false;
      unit.manualOffline = false;
      if (override.throttle === undefined) {
        unit.overrideThrottle = 1;
      } else {
        unit.overrideThrottle = override.throttle;
      }
      if (unit.status === "standby" && unit.downtime <= 0) {
        unit.status = "online";
      }
    }

    if (override.offline || override.throttle !== undefined) {
      this.unitOverrides[unitId] = override;
    } else {
      delete this.unitOverrides[unitId];
    }

    if (!options.quiet) {
      this.pushLog(
        offline ? "warning" : "info",
        offline ? `${unit.name} placed in standby.` : `${unit.name} returned to service.`,
        { unitId }
      );
    }
  }

  clearUnitOverride(unitId, options = {}) {
    const unit = this.unitMap[unitId];
    if (!unit) {
      return;
    }
    delete this.unitOverrides[unitId];
    unit.manualOffline = false;
    unit.emergencyOffline = false;
    unit.overrideThrottle = 1;
    if (unit.status === "standby" && unit.downtime <= 0) {
      unit.status = "online";
    }
    if (!options.quiet) {
      this.pushLog("info", `${unit.name} reset to automatic control.`, { unitId });
    }
  }

  setAllUnitsOffline(offline, options = {}) {
    this.units.forEach((unit) => {
      if (!unit) return;
      if (offline) {
        this.setUnitOffline(unit.id, true, { ...options, quiet: true });
      } else if (!options.emergencyOnly || unit.emergencyOffline) {
        this.setUnitOffline(unit.id, false, { ...options, quiet: true });
      }
    });
  }

  triggerEmergencyShutdown() {
    if (this.emergencyShutdown) {
      return;
    }
    this.emergencyShutdown = true;
    this.setAllUnitsOffline(true, { emergency: true, quiet: true });
    this.pushLog(
      "warning",
      "Emergency shutdown drill engaged. Crude charge isolated and units standing by."
    );
  }

  releaseEmergencyShutdown() {
    if (!this.emergencyShutdown) {
      return;
    }
    this.emergencyShutdown = false;
    this.setAllUnitsOffline(false, { emergencyOnly: true, quiet: true });
    this.pushLog("info", "Emergency shutdown cleared; restart crews may warm up units.");
  }
}
