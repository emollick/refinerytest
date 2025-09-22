const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const randomRange = (min, max) => min + Math.random() * (max - min);

const PRODUCT_LABELS = {
  gasoline: "gasoline",
  diesel: "diesel",
  jet: "jet fuel",
};

const HOURS_PER_DAY = 24;

export class RefinerySimulation {
  constructor() {
    this.timeMinutes = 0;
    this.tickInterval = 1; // simulated minute per tick
    this.speed = 35; // simulated minutes per real second
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
      reliability: 1,
      carbon: 0,
      waste: 0,
      flareLevel: 0,
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

    this.performanceHistory = [];

    this.storage = this._initStorage();
    this.shipments = [];
    this.shipmentStats = { total: 0, onTime: 0, missed: 0 };
    this.nextShipmentIn = 2.5;
    this.directives = [];
    this.directiveStats = { total: 0, completed: 0, failed: 0 };
    this._seedDirectives();

    this.logs = [];
    this.pushLog(
      "info",
      "Simulation initialized. Adjust the sliders to explore the refinery."
    );
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
    };
  }

  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
    }
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
    this.metrics = {
      gasoline: 0,
      diesel: 0,
      jet: 0,
      lpg: 0,
      profitPerHour: 0,
      reliability: 1,
      carbon: 0,
      waste: 0,
      flareLevel: 0,
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
    this.storage = this._initStorage();
    this.shipments = [];
    this.shipmentStats = { total: 0, onTime: 0, missed: 0 };
    this.nextShipmentIn = 2.5;
    this.directives = [];
    this.directiveStats = { total: 0, completed: 0, failed: 0 };
    this._seedDirectives();
    this.units.forEach((unit) => {
      unit.throughput = 0;
      unit.utilization = 0;
      unit.integrity = 1;
      unit.downtime = 0;
      unit.status = "online";
      unit.incidents = 0;
      unit.alert = null;
      unit.alertTimer = 0;
    });
    this.performanceHistory = [];
    this.logs = [];
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

    const scenario = this.activeScenario;
    const crudeSetting = this.params.crudeIntake;
    const crudeAvailable = crudeSetting * scenario.crudeMultiplier;

    const distillation = this.unitMap.distillation;
    const distOnline = this._unitIsAvailable(distillation);
    const distCapacity = distOnline ? distillation.capacity : 0;
    const crudeThroughput = Math.min(crudeAvailable, distCapacity);
    distillation.throughput = crudeThroughput;
    distillation.utilization = distCapacity
      ? crudeThroughput / distCapacity
      : 0;

    const focus = clamp(this.params.productFocus, 0, 1);
    const centered = focus - 0.5;

    let gasShare = clamp(0.05 + centered * 0.05, 0.02, 0.12);
    let naphthaShare = clamp(0.32 + centered * 0.22, 0.22, 0.5);
    let keroseneShare = 0.11 + scenario.jetBias * 0.05;
    let dieselShare = clamp(0.28 - centered * 0.16 + scenario.dieselBias * 0.06, 0.18, 0.38);
    let heavyShare = clamp(0.19 - centered * 0.08, 0.12, 0.28);

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

    const reformer = this.unitMap.reformer;
    const reformerOnline = this._unitIsAvailable(reformer);
    const reformerCapacity = reformerOnline ? reformer.capacity : 0;
    const reformFeed = Math.min(naphthaPool, reformerCapacity);
    naphthaPool -= reformFeed;
    reformer.throughput = reformFeed;
    reformer.utilization = reformerCapacity ? reformFeed / reformerCapacity : 0;

    const reformate = reformFeed * 0.92;
    const reformHydrogen = reformFeed * 0.05;
    const reformLoss = reformFeed * 0.03;
    result.gasoline += reformate;
    result.hydrogen += reformHydrogen;
    result.waste += reformLoss;

    const fcc = this.unitMap.fcc;
    const fccOnline = this._unitIsAvailable(fcc);
    const fccCapacity = fccOnline ? fcc.capacity : 0;
    const heavyAvailableForFcc = heavyPool + residPool * 0.6;
    const fccFeed = Math.min(heavyAvailableForFcc, fccCapacity);
    const heavyUsedByFcc = Math.min(heavyPool, fccFeed * 0.7);
    heavyPool -= heavyUsedByFcc;
    const residUsedByFcc = Math.min(residPool, fccFeed - heavyUsedByFcc);
    residPool -= residUsedByFcc;

    fcc.throughput = fccFeed;
    fcc.utilization = fccCapacity ? fccFeed / fccCapacity : 0;

    const fccGasoline = fccFeed * 0.54;
    const fccDiesel = fccFeed * 0.12;
    const fccLpg = fccFeed * 0.18;
    const fccLoss = fccFeed * 0.08;
    result.gasoline += fccGasoline;
    dieselPool += fccDiesel;
    let lpgPool = distGas + fccLpg;
    result.waste += fccLoss;
    flare += fccLoss * 0.5;

    const hydrocracker = this.unitMap.hydrocracker;
    const hydroOnline = this._unitIsAvailable(hydrocracker);
    const hydroCapacity = hydroOnline ? hydrocracker.capacity : 0;
    const hydroFeedAvailable = heavyPool + residPool + dieselPool * 0.25;
    const hydroFeed = Math.min(hydroFeedAvailable, hydroCapacity);

    const heavyUsedHydro = Math.min(heavyPool, hydroFeed * 0.55);
    heavyPool -= heavyUsedHydro;
    const residUsedHydro = Math.min(residPool, hydroFeed * 0.35);
    residPool -= residUsedHydro;
    const dieselUsedHydro = Math.min(dieselPool * 0.5, hydroFeed - heavyUsedHydro - residUsedHydro);
    dieselPool -= dieselUsedHydro;

    hydrocracker.throughput = hydroFeed;
    hydrocracker.utilization = hydroCapacity ? hydroFeed / hydroCapacity : 0;

    const hydroGasoline = hydroFeed * 0.42;
    const hydroDiesel = hydroFeed * 0.3;
    const hydroJet = hydroFeed * 0.2;
    const hydroLoss = hydroFeed * 0.08;
    result.gasoline += hydroGasoline;
    dieselPool += hydroDiesel;
    kerosenePool += hydroJet;
    result.hydrogen += hydroFeed * 0.04;
    result.waste += hydroLoss;

    const alkylation = this.unitMap.alkylation;
    const alkOnline = this._unitIsAvailable(alkylation);
    const alkCapacity = alkOnline ? alkylation.capacity : 0;
    const alkFeed = Math.min(lpgPool, alkCapacity);
    lpgPool -= alkFeed;

    alkylation.throughput = alkFeed;
    alkylation.utilization = alkCapacity ? alkFeed / alkCapacity : 0;

    const alkGasoline = alkFeed * 0.88;
    const alkLoss = alkFeed * 0.06;
    result.gasoline += alkGasoline;
    result.lpg += lpgPool;
    result.waste += alkLoss;

    const sulfur = this.unitMap.sulfur;
    const sulfurOnline = this._unitIsAvailable(sulfur);
    const sulfurCapacity = sulfurOnline ? sulfur.capacity : 0;
    const sulfurFeed = Math.min(residPool + heavyPool, sulfurCapacity);
    const sulfurRemoved = sulfurFeed * (0.55 + this.params.environment * 0.4);
    sulfur.throughput = sulfurFeed;
    sulfur.utilization = sulfurCapacity ? sulfurFeed / sulfurCapacity : 0;
    residPool -= sulfurFeed * 0.6;
    heavyPool -= sulfurFeed * 0.4;
    result.sulfur += sulfurRemoved;
    result.waste += Math.max(0, sulfurFeed - sulfurRemoved);

    result.gasoline += naphthaPool * 0.82;
    result.diesel += dieselPool;
    result.jet += kerosenePool * (1 + demandJetBias * 0.2);
    result.waste += residPool + heavyPool;
    result.lpg += Math.max(0, lpgPool);

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

    const crudeCostPerBbl = 53 * (1 + scenario.qualityShift * 0.8);
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
      { hours, scenario, flare }
    );

    const logisticsReport = this._updateLogistics({
      hours,
      production: result,
      prices: { gasoline: gasolinePrice, diesel: dieselPrice, jet: jetPrice },
    });

    const penalty = incidentsRisk.incidentPenalty + logisticsReport.penalty;
    const profitPerDay = productRevenue - crudeExpense - operatingExpense - penalty;
    const profitPerHour = profitPerDay / HOURS_PER_DAY;

    this.metrics.gasoline = this._round(result.gasoline);
    this.metrics.diesel = this._round(result.diesel);
    this.metrics.jet = this._round(result.jet);
    this.metrics.lpg = this._round(result.lpg);
    this.metrics.profitPerHour = profitPerHour;
    this.metrics.waste = result.waste;
    this.metrics.flareLevel = clamp((result.waste + flare * 1.4) / (crudeThroughput * 0.5 || 1), 0, 1);
    this.metrics.incidents = incidentsRisk.incidents;
    this.metrics.reliability = incidentsRisk.reliability;

    const carbonBase =
      result.waste * 3.5 +
      result.diesel * 0.6 +
      result.gasoline * 0.5 +
      incidentsRisk.incidents * 2.8;
    const envMitigation = 1 - clamp(this.params.environment * 0.55, 0, 0.6);
    this.metrics.carbon = carbonBase * envMitigation;

    this.flows.toReformer = reformFeed;
    this.flows.toCracker = fccFeed;
    this.flows.toHydrocracker = hydroFeed;
    this.flows.toAlkylation = alkFeed;
    this.flows.toExport = result.gasoline + result.diesel + result.jet;

    this._updateDirectives(hours, { shipments: logisticsReport, metrics: this.metrics });


    this._updateScorecard({
      profitPerHour,
      crudeThroughput,
      incidents: incidentsRisk.incidents,
      reliability: this.metrics.reliability,
      carbon: this.metrics.carbon,
      gasoline: this.metrics.gasoline,
      diesel: this.metrics.diesel,
      jet: this.metrics.jet,
      shipmentScore: this.metrics.shipmentReliability,
      directiveScore: this.metrics.directiveReliability,
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
        this.pushLog("info", `${unit.name} cleared maintenance and is back online.`, {
          unitId: unit.id,
        });
      }
      return false;
    }
    return true;
  }

  _updateReliability(units, context) {
    const maintenance = this.params.maintenance;
    const safety = this.params.safety;
    const scenario = context.scenario;

    let incidents = 0;
    let penalty = 0;
    let integritySum = 0;

    Object.values(units).forEach((unit) => {
      if (!unit) return;
      const utilization = unit.utilization || 0;
      const baseWear = 0.004 * context.hours;
      const stressWear = Math.max(0, utilization - 1) * 0.04 * context.hours;
      const maintenanceFactor = 1.3 - maintenance * 0.9 - safety * 0.4;
      const scenarioFactor = scenario.riskMultiplier;
      const wear = (baseWear + stressWear) * maintenanceFactor * scenarioFactor;
      unit.integrity = clamp(unit.integrity - wear, 0, 1);
      integritySum += unit.integrity;

      if (unit.integrity < 0.35 && unit.status === "online") {
        const failurePressure = clamp(0.35 - unit.integrity, 0, 0.35);
        const overload = Math.max(0, utilization - 0.95);
        const riskIndex =
          failurePressure * (0.9 + overload * 1.8) * (1.1 - maintenance) * scenario.riskMultiplier;
        if (Math.random() < riskIndex) {
          const severity = overload > 0.2 && safety < 0.45 ? "danger" : "warning";
          const downtime = 30 + Math.random() * 90 + overload * 120;
          unit.status = "offline";
          unit.downtime = downtime;
          unit.incidents += 1;
          incidents += severity === "danger" ? 2 : 1;
          penalty += severity === "danger" ? 320 : 140;
          this.pushLog(
            severity,
            `${unit.name} tripped offline after a ${
              severity === "danger" ? "critical" : "process"
            } upset.`,
            { unitId: unit.id }
          );
          if (severity === "danger") {
            this.pushLog(
              "danger",
              `Emergency crews respond to pressure surge at ${unit.name}. Throughput curtailed.`,
              { unitId: unit.id }
            );
          }
          unit.alert = severity;
          unit.alertTimer = Math.max(unit.alertTimer, severity === "danger" ? 180 : 90);
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
    const profitScore = clamp((context.profitPerHour + 140) / 320, 0, 1);
    const reliabilityScore = clamp(context.reliability, 0, 1);
    const carbonScore = clamp(1 - context.carbon / 140, 0, 1);
    const incidentScore = clamp(1 - context.incidents * 0.18, 0, 1);
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
      throughputScore * 0.2 +
        profitScore * 0.18 +
        reliabilityScore * 0.2 +
        carbonScore * 0.14 +
        incidentScore * 0.1 +
        shipmentScore * 0.1 +
        directiveScore * 0.08,
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

  _countPendingShipments() {
    return this.shipments.filter((shipment) => shipment.status === "pending").length;
  }

  _scheduleShipment() {
    const productPool = ["gasoline", "gasoline", "diesel", "diesel", "jet"];
    const product = productPool[Math.floor(Math.random() * productPool.length)];
    const base = product === "jet" ? 46 : product === "diesel" ? 54 : 60;
    const volume = Math.round(randomRange(base * 0.75, base * 1.35));
    const window = randomRange(4, 7.5);
    const shipment = {
      id: `ship-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      product,
      volume,
      window,
      dueIn: window,
      status: "pending",
      createdAt: this.timeMinutes,
      cooldown: 0,
    };
    this.shipments.push(shipment);
    this.pushLog(
      "info",
      `${volume.toFixed(0)} kb of ${PRODUCT_LABELS[product]} requested at the marine dock within ${window.toFixed(
        1
      )} h.`
    );
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
    const { production, hours, prices } = context;
    const produced = {
      gasoline: Math.max(0, production.gasoline * hours),
      diesel: Math.max(0, production.diesel * hours),
      jet: Math.max(0, production.jet * hours),
    };

    Object.entries(produced).forEach(([product, volume]) => {
      const capacity = this.storage.capacity[product];
      this.storage.levels[product] = clamp(this.storage.levels[product] + volume, 0, capacity);
    });

    this.nextShipmentIn -= hours;
    if (this._countPendingShipments() < 3 && this.nextShipmentIn <= 0) {
      this._scheduleShipment();
      this.nextShipmentIn = randomRange(2.5, 5.5);
    }

    const report = {
      delivered: { gasoline: 0, diesel: 0, jet: 0 },
      failed: 0,
      penalty: 0,
    };

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

  _seedDirectives() {
    while (this.directives.length < 3) {
      this.directives.push(this._createDirective());
    }
  }

  _createDirective() {
    const id = `dir-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const roll = Math.random();

    if (roll < 0.4) {
      const duration = randomRange(10, 16);
      const threshold = randomRange(0.78, 0.88);
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
      const base = product === "jet" ? 60 : product === "diesel" ? 70 : 85;
      const target = Math.round(randomRange(base * 0.9, base * 1.3));
      const duration = randomRange(14, 20);
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

    const duration = randomRange(12, 18);
    const threshold = Math.round(randomRange(58, 72));
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
      if (unit.status === "offline") {
        unit.alert = unit.alert === "danger" ? "danger" : "warning";
        unit.alertTimer = Math.max(unit.alertTimer, 45);
      } else if (unit.integrity < 0.45) {
        unit.alert = unit.alert === "danger" ? "danger" : "warning";
        unit.alertTimer = Math.max(unit.alertTimer, 30);
      }

      if (unit.alertTimer > 0) {
        unit.alertTimer = Math.max(0, unit.alertTimer - deltaMinutes);
        if (
          unit.alertTimer === 0 &&
          unit.status === "online" &&
          unit.integrity >= 0.5 &&
          unit.alert !== "danger"
        ) {
          unit.alert = null;
        }
      } else if (unit.alert && unit.status === "online" && unit.integrity >= 0.6) {
        unit.alert = null;
      }
    });
  }

  getLogisticsState() {
    return {
      storage: {
        capacity: { ...this.storage.capacity },
        levels: { ...this.storage.levels },
      },
      shipments: this.shipments.map((shipment) => ({ ...shipment })),
      stats: { ...this.shipmentStats },
    };
  }

  getDirectives() {
    return this.directives.map((directive) => ({ ...directive }));
  }

}
