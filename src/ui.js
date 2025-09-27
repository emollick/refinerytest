const PRODUCT_LABELS = {
  gasoline: "Gasoline",
  diesel: "Diesel",
  jet: "Jet Fuel",
};

export class UIController {
  constructor(simulation) {
    this.simulation = simulation;
    this.selectedUnitId = null;
    this.lastLogSignature = "";
    this.modeFlashTimeout = null;
    this.processTopology =
      typeof simulation.getProcessTopology === "function" ? simulation.getProcessTopology() : {};
    this.latestFlows = {};

    this.elements = {
      crude: document.getElementById("crude-input"),
      crudeValue: document.getElementById("crude-value"),
      focus: document.getElementById("gasoline-focus"),
      focusValue: document.getElementById("focus-value"),
      maintenance: document.getElementById("maintenance"),
      maintenanceValue: document.getElementById("maintenance-value"),
      safety: document.getElementById("safety"),
      safetyValue: document.getElementById("safety-value"),
      environment: document.getElementById("env"),
      environmentValue: document.getElementById("env-value"),
      toggle: document.getElementById("toggle-sim"),
      step: document.getElementById("step-sim"),
      reset: document.getElementById("reset-sim"),
      scenario: document.getElementById("scenario-select"),
      scenarioDescription: document.getElementById("scenario-description"),
      gasolineOutput: document.getElementById("gasoline-output"),
      dieselOutput: document.getElementById("diesel-output"),
      jetOutput: document.getElementById("jet-output"),
      lpgOutput: document.getElementById("lpg-output"),
      profitOutput: document.getElementById("profit-output"),
      revenueOutput: document.getElementById("revenue-output"),
      expenseOutput: document.getElementById("expense-output"),
      penaltyOutput: document.getElementById("penalty-output"),
      marginOutput: document.getElementById("margin-output"),
      reliabilityOutput: document.getElementById("reliability-output"),
      strainOutput: document.getElementById("strain-output"),
      carbonOutput: document.getElementById("carbon-output"),
      gasolineFutures: document.getElementById("gasoline-futures"),
      dieselFutures: document.getElementById("diesel-futures"),
      jetFutures: document.getElementById("jet-futures"),
      gasolineCost: document.getElementById("gasoline-cost"),
      dieselCost: document.getElementById("diesel-cost"),
      jetCost: document.getElementById("jet-cost"),
      gasolineBasis: document.getElementById("gasoline-basis"),
      dieselBasis: document.getElementById("diesel-basis"),
      jetBasis: document.getElementById("jet-basis"),
      scoreGrade: document.getElementById("score-grade"),
      scoreDelta: document.getElementById("score-delta"),
      scoreNote: document.getElementById("score-note"),
      scoreTrend: document.getElementById("score-trend"),
      logList: document.getElementById("event-log"),
      unitDetails: document.getElementById("unit-details"),
      clock: document.getElementById("sim-clock"),
      modeBadge: document.getElementById("mode-badge"),
      recordIndicator: document.getElementById("record-indicator"),
      inventoryGasolineBar: document.getElementById("inventory-gasoline-fill"),
      inventoryGasolineLabel: document.getElementById("inventory-gasoline-label"),
      inventoryDieselBar: document.getElementById("inventory-diesel-fill"),
      inventoryDieselLabel: document.getElementById("inventory-diesel-label"),
      inventoryJetBar: document.getElementById("inventory-jet-fill"),
      inventoryJetLabel: document.getElementById("inventory-jet-label"),
      mapLogistics: document.getElementById("map-logistics"),
      mapLogisticsStatus: document.getElementById("map-logistics-status"),
      mapLogisticsNext: document.getElementById("map-logistics-next"),
      mapLogisticsReliability: document.getElementById("map-logistics-reliability"),
      mapLogisticsGasoline: document.getElementById("map-logistics-gasoline"),
      mapLogisticsDiesel: document.getElementById("map-logistics-diesel"),
      mapLogisticsJet: document.getElementById("map-logistics-jet"),
      shipmentList: document.getElementById("shipment-list"),
      shipmentReliability: document.getElementById("shipment-reliability"),
      directiveList: document.getElementById("directive-list"),
      speedControls: document.getElementById("speed-controls"),
      speedReadout: document.getElementById("speed-readout"),
      logisticsExpedite: document.getElementById("logistics-expedite"),
      logisticsDelay: document.getElementById("logistics-delay"),
      logisticsExpand: document.getElementById("logistics-expand"),
      storageStatus: document.getElementById("storage-status"),
    };

    this.profitFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    this.priceFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    this.flowFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

    this._bindControls();
    this._populateScenarios();
    this._updateSliderLabels();
    this._updateClock();

    this.scoreTrendContext = null;
    if (this.elements.scoreTrend) {
      this.scoreTrendContext = this.elements.scoreTrend.getContext("2d");
      if (this.scoreTrendContext) {
        this.scoreTrendContext.imageSmoothingEnabled = false;
      }
    }
    this.lastScoreSignature = "";
    this.lastSpeedSignature = "";
    this.lastRecorderSignature = "";
    this.inspectionReports = new Map();
    this.storageFlashTimers = new Map();
  }

  _bindControls() {
    const { elements, simulation } = this;

    elements.crude.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      simulation.setParam("crudeIntake", value);
      elements.crudeValue.textContent = `${value.toFixed(0)} kbpd`;
    });

    elements.focus.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      simulation.setParam("productFocus", value);
      elements.focusValue.textContent = value > 0.5 ? "Gasoline" : value < 0.5 ? "Diesel" : "Balanced";
    });

    elements.maintenance.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      simulation.setParam("maintenance", value);
      elements.maintenanceValue.textContent = `${Math.round(value * 100)}%`;
    });

    elements.safety.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      simulation.setParam("safety", value);
      elements.safetyValue.textContent = `${Math.round(value * 100)}%`;
    });

    elements.environment.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      simulation.setParam("environment", value);
      elements.environmentValue.textContent = `${Math.round(value * 100)}%`;
    });

    elements.toggle.addEventListener("click", () => {
      const running = simulation.toggleRunning();
      elements.toggle.textContent = running ? "Pause" : "Resume";
    });

    elements.step.addEventListener("click", () => {
      simulation.requestStep();
    });

    elements.reset.addEventListener("click", () => {
      simulation.reset();
      this.selectedUnitId = null;
      this._renderUnitDetails(null);
      this._updateSliderLabels();
    });

    elements.scenario.addEventListener("change", (event) => {
      simulation.applyScenario(event.target.value);
      this._updateScenarioDescription();
    });

    if (elements.logisticsExpedite && typeof simulation.requestExtraShipment === "function") {
      elements.logisticsExpedite.addEventListener("click", () => {
        const result = simulation.requestExtraShipment();
        if (result && result.product) {
          this.flashStorageLevel(result.product);
        }
        this.update(simulation.getLogisticsState(), null);
      });
    }

    if (elements.logisticsDelay && typeof simulation.delayNextShipment === "function") {
      elements.logisticsDelay.addEventListener("click", () => {
        const delayed = simulation.delayNextShipment();
        if (delayed && delayed.product) {
          this.flashStorageLevel(delayed.product);
        }
        this.update(simulation.getLogisticsState(), null);
      });
    }

    if (elements.logisticsExpand && typeof simulation.expandStorageCapacity === "function") {
      elements.logisticsExpand.addEventListener("click", () => {
        const outcome = simulation.expandStorageCapacity();
        if (outcome && outcome.level) {
          this.update(simulation.getLogisticsState(), null);
        } else {
          this.update(simulation.getLogisticsState(), null);
        }
      });
    }
  }

  _populateScenarios() {
    const { elements, simulation } = this;
    const scenarios = simulation.getScenarioList();
    scenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.key;
      option.textContent = scenario.name;
      if (scenario.key === simulation.activeScenarioKey) {
        option.selected = true;
      }
      elements.scenario.appendChild(option);
    });
    this._updateScenarioDescription();
  }

  _updateScenarioDescription() {
    const { simulation, elements } = this;
    const scenario = simulation.scenarios[elements.scenario.value];
    if (scenario) {
      elements.scenarioDescription.textContent = scenario.description;
    }
  }

  _updateSliderLabels() {
    const { elements, simulation } = this;
    elements.crude.value = simulation.params.crudeIntake;
    elements.focus.value = Math.round(simulation.params.productFocus * 100);
    elements.maintenance.value = Math.round(simulation.params.maintenance * 100);
    elements.safety.value = Math.round(simulation.params.safety * 100);
    elements.environment.value = Math.round(simulation.params.environment * 100);

    elements.crudeValue.textContent = `${simulation.params.crudeIntake.toFixed(0)} kbpd`;
    elements.focusValue.textContent =
      simulation.params.productFocus > 0.5
        ? "Gasoline"
        : simulation.params.productFocus < 0.5
        ? "Diesel"
        : "Balanced";
    elements.maintenanceValue.textContent = `${Math.round(simulation.params.maintenance * 100)}%`;
    elements.safetyValue.textContent = `${Math.round(simulation.params.safety * 100)}%`;
    elements.environmentValue.textContent = `${Math.round(simulation.params.environment * 100)}%`;
  }

  setRunning(running) {
    this.elements.toggle.textContent = running ? "Pause" : "Resume";
  }

  selectUnit(unitId) {
    this.selectedUnitId = unitId;
    const unit = this.simulation.getUnits().find((entry) => entry.id === unitId);
    this._renderUnitDetails(unit || null);
  }

  recordInspectionReport(report) {
    if (!report || !report.unitId) {
      return;
    }
    this.inspectionReports.set(report.unitId, { ...report });
    if (this.selectedUnitId === report.unitId) {
      const unit = this.simulation.getUnits().find((entry) => entry.id === report.unitId);
      this._renderUnitDetails(unit || null);
    }
  }

  clearInspectionReports() {
    this.inspectionReports.clear();
    if (this.selectedUnitId) {
      const unit = this.simulation
        .getUnits()
        .find((entry) => entry.id === this.selectedUnitId);
      this._renderUnitDetails(unit || null);
    }
  }

  flashStorageLevel(product) {
    if (!product) {
      return;
    }
    const key = product.charAt(0).toUpperCase() + product.slice(1);
    const bar = this.elements[`inventory${key}Bar`];
    if (!bar) {
      return;
    }
    bar.classList.add("flash");
    const existingTimer = this.storageFlashTimers.get(bar);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      bar.classList.remove("flash");
      this.storageFlashTimers.delete(bar);
    }, 900);
    this.storageFlashTimers.set(bar, timer);
  }

  _renderUnitDetails(unit) {
    const { unitDetails } = this.elements;
    unitDetails.innerHTML = "";

    if (!unit) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Select a processing unit to inspect its condition.";
      unitDetails.appendChild(paragraph);
      return;
    }

    const title = document.createElement("h3");
    title.textContent = unit.name;
    unitDetails.appendChild(title);

    const status = document.createElement("p");
    status.textContent = this._describeUnitStatus(unit);
    status.classList.add("unit-status");
    unitDetails.appendChild(status);

    const list = document.createElement("div");
    list.classList.add("unit-stats");

    list.appendChild(this._statRow("Throughput", `${unit.throughput.toFixed(1)} kbpd`));
    list.appendChild(this._statRow("Utilization", `${Math.round(unit.utilization * 100)}%`));
    list.appendChild(this._statRow("Integrity", `${Math.round(unit.integrity * 100)}%`));
    list.appendChild(this._statRow("Incidents", `${unit.incidents}`));

    unitDetails.appendChild(list);

    const overrideState = this._getOverrideState(unit);
    this._renderUnitControls(unitDetails, unit, overrideState);
    this._renderAlertDetail(unitDetails, unit);
    this._renderInspectionDetail(unitDetails, unit);
    this._renderProcessTopology(unitDetails, unit);
  }

  _statRow(label, value) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("unit-stat");
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    wrapper.append(labelEl, valueEl);
    return wrapper;
  }

  update(logisticsState, flows = null) {
    if (flows) {
      this.latestFlows = { ...flows };
    } else {
      this.latestFlows = this.simulation.getFlows();
    }
    const metrics = this.simulation.getMetrics();
    this._renderMetrics(metrics);
    if (typeof this.simulation.getSpeedState === "function") {
      this._renderSpeedState(this.simulation.getSpeedState());
    }
    if (typeof this.simulation.getRecorderState === "function") {
      this._renderRecorderState(this.simulation.getRecorderState());
    }
    this._renderLogs();
    this._updateClock();
    if (this.selectedUnitId) {
      const unit = this.simulation
        .getUnits()
        .find((entry) => entry.id === this.selectedUnitId);
      this._renderUnitDetails(unit || null);
    }
    const logistics = logisticsState || this.simulation.getLogisticsState();
    this._renderLogistics(logistics);
    this._renderDirectives(this.simulation.getDirectives());
  }

  refreshControls() {
    this._updateSliderLabels();
    if (typeof this.simulation.getSpeedState === "function") {
      this._renderSpeedState(this.simulation.getSpeedState());
    }
    if (typeof this.simulation.getRecorderState === "function") {
      this._renderRecorderState(this.simulation.getRecorderState());
    }
  }

  setScenario(key) {
    if (!this.elements.scenario) return;
    if (this.elements.scenario.value !== key) {
      this.elements.scenario.value = key;
    }
    this._updateScenarioDescription();
  }

  setModeBadge(label) {
    if (!this.elements.modeBadge) return;
    this.elements.modeBadge.textContent = label;
    this.elements.modeBadge.classList.remove("flash");
    // restart animation
    void this.elements.modeBadge.offsetWidth;
    this.elements.modeBadge.classList.add("flash");
    if (this.modeFlashTimeout) {
      clearTimeout(this.modeFlashTimeout);
    }
    this.modeFlashTimeout = setTimeout(() => {
      this.elements.modeBadge?.classList.remove("flash");
    }, 450);
  }

  _renderMetrics(metrics) {
    const formatBpd = (value) => `${value.toFixed(1)} kbpd`;
    this.elements.gasolineOutput.textContent = formatBpd(metrics.gasoline);
    this.elements.dieselOutput.textContent = formatBpd(metrics.diesel);
    this.elements.jetOutput.textContent = formatBpd(metrics.jet);
    this.elements.lpgOutput.textContent = formatBpd(metrics.lpg);

    this.elements.profitOutput.textContent = `${this.profitFormatter.format(
      Math.round(metrics.profitPerHour * 1000)
    )} / hr`;

    if (this.elements.revenueOutput) {
      const revenue = typeof metrics.revenuePerDay === "number" ? metrics.revenuePerDay : 0;
      this.elements.revenueOutput.textContent = `${this.profitFormatter.format(
        Math.round(revenue * 1000)
      )} / day`;
    }

    if (this.elements.expenseOutput) {
      const expensePerHour =
        typeof metrics.expensePerDay === "number" ? metrics.expensePerDay / 24 : 0;
      this.elements.expenseOutput.textContent = `${this.profitFormatter.format(
        Math.round(expensePerHour * 1000)
      )} / hr`;
    }

    if (this.elements.penaltyOutput) {
      const penaltyPerHour =
        typeof metrics.penaltyPerDay === "number" ? metrics.penaltyPerDay / 24 : 0;
      this.elements.penaltyOutput.textContent = `${this.profitFormatter.format(
        Math.round(penaltyPerHour * 1000)
      )} / hr`;
    }

    if (this.elements.marginOutput) {
      const margin = typeof metrics.marginMultiplier === "number" ? metrics.marginMultiplier : 0;
      this.elements.marginOutput.textContent = `${Math.round(margin * 100)}%`;
    }

    this.elements.reliabilityOutput.textContent = `${Math.round(metrics.reliability * 100)}%`;
    if (this.elements.strainOutput) {
      const strainValue = Number.isFinite(metrics.operationalStrain)
        ? metrics.operationalStrain
        : 0;
      const strainRatio = Math.min(Math.max(strainValue / 12, 0), 1);
      const strainPct = Math.round(strainRatio * 100);
      this.elements.strainOutput.textContent = `${strainPct}%`;
      this.elements.strainOutput.classList.toggle("warning", strainPct >= 65);
    }
    this.elements.carbonOutput.textContent = `${metrics.carbon.toFixed(1)} tCO₂-eq`;

    this._renderEconomy(metrics);
    this._renderScorecard(metrics);
  }

  _renderSpeedState(state) {
    const { speedControls, speedReadout } = this.elements;
    const multiplier = Number.isFinite(state?.multiplier)
      ? state.multiplier
      : typeof this.simulation.getSpeedMultiplier === "function"
      ? this.simulation.getSpeedMultiplier()
      : 1;
    const baseMinutes = Number.isFinite(state?.baseMinutesPerSecond)
      ? state.baseMinutesPerSecond
      : this.simulation?.baseSpeed ?? 35;
    const minutesPerSecond = Number.isFinite(state?.minutesPerSecond)
      ? state.minutesPerSecond
      : baseMinutes * multiplier;

    if (speedControls) {
      const buttons = speedControls.querySelectorAll("button[data-speed]");
      buttons.forEach((button) => {
        const target = Number.parseFloat(button.dataset.speed);
        const isActive = Number.isFinite(target) ? Math.abs(target - multiplier) < 0.011 : false;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    if (speedReadout) {
      const signature = `${multiplier.toFixed(3)}-${minutesPerSecond.toFixed(2)}`;
      if (signature !== this.lastSpeedSignature) {
        const labelMultiplier =
          Math.abs(multiplier - Math.round(multiplier)) < 0.01
            ? `${Math.round(multiplier)}x time`
            : `${multiplier.toFixed(multiplier < 1 ? 2 : 1)}x time`;
        const speedLabel = `${minutesPerSecond.toFixed(1)} sim min/sec`;
        speedReadout.textContent = `${labelMultiplier} · ${speedLabel}`;
        this.lastSpeedSignature = signature;
      }
    }
  }

  _renderRecorderState(state) {
    const indicator = this.elements.recordIndicator;
    if (!indicator) {
      return;
    }

    const active = Boolean(state?.active);
    if (active) {
      indicator.hidden = false;
      indicator.classList.add("active");
      const elapsed = Number.isFinite(state?.elapsedHours) ? state.elapsedHours : 0;
      const elapsedLabel = elapsed >= 9.95 ? elapsed.toFixed(0) : elapsed.toFixed(1);
      indicator.textContent = `REC ${elapsedLabel}h`;
      const tooltip = `Recording shift (${elapsed.toFixed(2)} h elapsed)`;
      indicator.setAttribute("title", tooltip);
      this.lastRecorderSignature = `active-${elapsed.toFixed(2)}`;
      return;
    }

    indicator.classList.remove("active");
    const summary = state?.lastSummary;
    if (summary) {
      indicator.hidden = false;
      indicator.textContent = "REC DONE";
      const duration = Number.isFinite(summary.durationHours) ? summary.durationHours : 0;
      const net = Number.isFinite(summary.netProfit)
        ? summary.netProfit
        : (summary.profit || 0) - (summary.penalty || 0);
      const netLabel = `${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(1)}M`;
      const missed = summary.shipments?.missed || 0;
      const tooltip = `Last shift ${duration.toFixed(1)} h · ${netLabel} · ${missed} missed`; 
      indicator.setAttribute("title", tooltip);
      this.lastRecorderSignature = `done-${duration.toFixed(2)}-${netLabel}-${missed}`;
    } else {
      indicator.hidden = true;
      indicator.removeAttribute("title");
      this.lastRecorderSignature = "idle";
    }
  }

  _renderEconomy(metrics) {
    if (!this.priceFormatter) {
      return;
    }
    const products = [
      {
        label: "Gasoline",
        elementPrefix: "gasoline",
        futuresKey: "futuresGasoline",
        costKey: "costGasoline",
        basisKey: "basisGasoline",
      },
      {
        label: "Diesel",
        elementPrefix: "diesel",
        futuresKey: "futuresDiesel",
        costKey: "costDiesel",
        basisKey: "basisDiesel",
      },
      {
        label: "Jet Fuel",
        elementPrefix: "jet",
        futuresKey: "futuresJet",
        costKey: "costJet",
        basisKey: "basisJet",
      },
    ];

    products.forEach((product) => {
      const futuresValue = Number(metrics[product.futuresKey]);
      const costValue = Number(metrics[product.costKey]);
      const basisValue = Number(metrics[product.basisKey]);

      const futuresEl = this.elements[`${product.elementPrefix}Futures`];
      if (futuresEl) {
        futuresEl.textContent = this._formatCurrency(futuresValue);
        futuresEl.setAttribute(
          "title",
          `${product.label} futures respond to demand, reliability, and shipping performance.`
        );
      }

      const costEl = this.elements[`${product.elementPrefix}Cost`];
      if (costEl) {
        costEl.textContent = this._formatCurrency(costValue);
        costEl.setAttribute(
          "title",
          `${product.label} per-barrel production cost including crude, maintenance, and logistics penalties.`
        );
      }

      const basisEl = this.elements[`${product.elementPrefix}Basis`];
      if (basisEl) {
        const nearZero = !Number.isFinite(basisValue) || Math.abs(basisValue) < 0.005;
        const formatted = nearZero ? "$0.00" : this._formatSignedCurrency(basisValue);
        basisEl.textContent = formatted;
        basisEl.classList.toggle("positive", !nearZero && basisValue > 0.01);
        basisEl.classList.toggle("negative", !nearZero && basisValue < -0.01);
        basisEl.setAttribute("aria-label", `${product.label} basis ${formatted}`);
        basisEl.setAttribute("title", `Futures spread: ${formatted}`);
      }
    });
  }

  _formatCurrency(value) {
    if (!Number.isFinite(value)) {
      return "$0.00";
    }
    return this.priceFormatter.format(value);
  }

  _formatSignedCurrency(value) {
    if (!Number.isFinite(value)) {
      return "$0.00";
    }
    const absolute = Math.abs(value);
    if (absolute < 0.005) {
      return "$0.00";
    }
    const formatted = this.priceFormatter.format(absolute);
    const sign = value > 0 ? "+" : "-";
    return `${sign}${formatted}`;
  }

  _renderLogs() {
    const logs = this.simulation.getLogs();
    const signature = logs.length ? `${logs[0].timestamp}-${logs[0].message}` : "";
    if (signature === this.lastLogSignature) {
      return;
    }
    this.lastLogSignature = signature;

    this.elements.logList.innerHTML = "";
    logs.slice(0, 30).forEach((entry) => {
      const item = document.createElement("li");
      if (entry.level !== "info") {
        item.classList.add(entry.level);
      }
      item.textContent = `[${entry.timestamp}] ${entry.message}`;
      this.elements.logList.appendChild(item);
    });
  }

  _renderScorecard(metrics) {
    const { scoreGrade, scoreDelta, scoreNote } = this.elements;
    if (!scoreGrade) {
      return;
    }

    const grade = metrics.grade ?? "—";
    scoreGrade.textContent = grade;
    if (typeof metrics.score === "number") {
      scoreGrade.setAttribute("title", `Composite score ${metrics.score.toFixed(0)}`);
    } else {
      scoreGrade.removeAttribute("title");
    }

    if (scoreDelta) {
      const delta = typeof metrics.scoreDelta === "number" ? metrics.scoreDelta : 0;
      scoreDelta.classList.remove("positive", "negative");
      if (Math.abs(delta) < 0.05) {
        scoreDelta.textContent = "—";
        scoreDelta.removeAttribute("title");
      } else {
        const positive = delta > 0;
        scoreDelta.classList.add(positive ? "positive" : "negative");
        const arrow = positive ? "▲" : "▼";
        scoreDelta.textContent = `${arrow}${Math.abs(delta).toFixed(1)}`;
        scoreDelta.setAttribute(
          "title",
          positive ? "Score trending upward" : "Score trending downward"
        );
      }
    }

    if (scoreNote) {
      scoreNote.textContent = metrics.scoreNote || "Plant stabilizing…";
    }

    if (!this.scoreTrendContext) {
      return;
    }

    const history = this.simulation.getPerformanceHistory();
    const signature = history.length
      ? `${history[history.length - 1].toFixed(2)}-${history.length}`
      : "";
    if (signature === this.lastScoreSignature) {
      return;
    }
    this.lastScoreSignature = signature;
    this._drawScoreTrend(history);
  }

  _drawScoreTrend(history) {
    const ctx = this.scoreTrendContext;
    if (!ctx) return;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(6, 12, 20, 0.75)";
    ctx.fillRect(0, 0, width, height);

    if (!history.length) {
      return;
    }

    const min = Math.min(50, ...history);
    const max = Math.max(95, ...history);
    const range = Math.max(1, max - min);
    const gutterX = 4;
    const gutterY = 4;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    const targetNormalized = (75 - min) / range;
    const targetY = height - gutterY - targetNormalized * (height - gutterY * 2);
    const clampedTargetY = Math.min(height - gutterY, Math.max(gutterY, targetY));
    ctx.beginPath();
    ctx.moveTo(gutterX, clampedTargetY);
    ctx.lineTo(width - gutterX, clampedTargetY);
    ctx.stroke();
    ctx.setLineDash([]);

    const points = history.map((value, index) => {
      const x =
        gutterX +
        (index / Math.max(1, history.length - 1)) * (width - gutterX * 2);
      const normalized = (value - min) / range;
      const y = height - gutterY - normalized * (height - gutterY * 2);
      return { x, y };
    });

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.lineTo(points[points.length - 1].x, height - gutterY);
    ctx.lineTo(points[0].x, height - gutterY);
    ctx.closePath();
    ctx.fillStyle = "rgba(88, 217, 149, 0.18)";
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.strokeStyle = "#58d995";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _renderLogistics(logistics) {
    if (!logistics) {
      return;
    }
    const { storage, shipments, stats } = logistics;
    if (storage) {
      this._updateInventoryBar("gasoline", storage);
      this._updateInventoryBar("diesel", storage);
      this._updateInventoryBar("jet", storage);
    }

    if (this.elements.logisticsExpedite) {
      const cooldown = logistics?.extraShipmentCooldown ?? 0;
      const disabled = cooldown > 0.05;
      this.elements.logisticsExpedite.disabled = disabled;
      this.elements.logisticsExpedite.setAttribute("aria-disabled", disabled ? "true" : "false");
      this.elements.logisticsExpedite.textContent = disabled
        ? `Call Emergency Ship (${cooldown.toFixed(1)}h)`
        : "Call Emergency Ship";
      this.elements.logisticsExpedite.title = disabled
        ? `Emergency charter crews resetting (${cooldown.toFixed(1)} hours)`
        : "Stage an expedited marine shipment";
    }

    if (this.elements.logisticsDelay) {
      const pending = Array.isArray(shipments)
        ? shipments
            .filter((shipment) => shipment && shipment.status === "pending" && !shipment.rush)
            .sort((a, b) => (a.dueIn ?? Infinity) - (b.dueIn ?? Infinity))
        : [];
      const candidate = pending[0];
      const disabled = !candidate;
      this.elements.logisticsDelay.disabled = disabled;
      this.elements.logisticsDelay.setAttribute("aria-disabled", disabled ? "true" : "false");
      this.elements.logisticsDelay.textContent = disabled
        ? "Delay Next Ship"
        : `Delay ${PRODUCT_LABELS[candidate.product] || candidate.product}`;
      if (disabled) {
        this.elements.logisticsDelay.title = "No standard shipments are waiting at the dock.";
      } else {
        const due = Number.isFinite(candidate.dueIn) ? candidate.dueIn : 0;
        this.elements.logisticsDelay.title = `Push the next ${
          PRODUCT_LABELS[candidate.product] || candidate.product
        } sailing back (currently due in ${this._formatHours(due)}).`;
      }
    }

    if (this.elements.logisticsExpand) {
      const nextLevel = (logistics?.upgrades?.level || 0) + 1;
      const maxed = (logistics?.upgrades?.level || 0) >= 6;
      this.elements.logisticsExpand.disabled = maxed;
      this.elements.logisticsExpand.setAttribute("aria-disabled", maxed ? "true" : "false");
      this.elements.logisticsExpand.textContent = maxed
        ? "Tank Farm Fully Expanded"
        : `Expand Tank Farm (Lvl ${nextLevel})`;
      this.elements.logisticsExpand.title = maxed
        ? "All planned tank expansions complete"
        : "Authorize capital project to expand storage";
    }

    if (this.elements.storageStatus) {
      const pressure = logistics?.pressure || {};
      const throttle = Math.round((pressure.throttle ?? 1) * 100);
      const ratio = pressure.lastRatio ? Math.round(pressure.lastRatio * 100) : null;
      const parts = [`Crude feed ${throttle}%`];
      if (Number.isFinite(ratio)) {
        parts.push(`tanks ${ratio}% full`);
      }
      if (logistics?.upgrades?.level) {
        parts.push(`capacity lvl ${logistics.upgrades.level}`);
      }
      if (pressure.active) {
        parts.push("pressure easing");
        this.elements.storageStatus.dataset.state = "alert";
      } else {
        this.elements.storageStatus.dataset.state = "stable";
      }
      this.elements.storageStatus.textContent = parts.join(" · ");
    }

    this._renderMiniLogistics(logistics);

    this._renderShipmentList(Array.isArray(shipments) ? shipments : [], stats || {});
  }

  _renderMiniLogistics(logistics) {
    const {
      mapLogistics,
      mapLogisticsStatus,
      mapLogisticsNext,
      mapLogisticsReliability,
      mapLogisticsGasoline,
      mapLogisticsDiesel,
      mapLogisticsJet,
    } = this.elements;

    if (!mapLogistics) {
      return;
    }

    if (!logistics || !logistics.storage) {
      mapLogistics.hidden = true;
      return;
    }

    mapLogistics.hidden = false;

    const storage = logistics.storage;
    const setTankSnapshot = (element, product) => {
      if (!element) {
        return;
      }
      const level = storage?.levels?.[product] ?? 0;
      const capacity = storage?.capacity?.[product] ?? 0;
      const ratio = capacity > 0 ? Math.min(Math.max(level / capacity, 0), 1.05) : 0;
      const percent = `${Math.round(Math.min(ratio, 1) * 100)}%`;
      element.textContent = capacity ? `${percent} (${level.toFixed(0)} kb)` : `${level.toFixed(0)} kb`;
    };

    setTankSnapshot(mapLogisticsGasoline, "gasoline");
    setTankSnapshot(mapLogisticsDiesel, "diesel");
    setTankSnapshot(mapLogisticsJet, "jet");

    if (mapLogisticsStatus) {
      const pressure = logistics?.pressure || {};
      const throttle = Math.round((pressure.throttle ?? 1) * 100);
      const tankRatio = pressure.lastRatio ? Math.round(pressure.lastRatio * 100) : null;
      const statusParts = [`Feed ${throttle}%`];
      if (Number.isFinite(tankRatio)) {
        statusParts.push(`Tanks ${tankRatio}%`);
      }
      mapLogisticsStatus.textContent = statusParts.join(" · ");
      mapLogisticsStatus.dataset.state = pressure.active ? "alert" : "normal";
    }

    if (mapLogisticsReliability) {
      const total = logistics?.stats?.total ?? 0;
      const onTime = logistics?.stats?.onTime ?? total;
      const reliability = total ? Math.round((onTime / total) * 100) : 100;
      mapLogisticsReliability.innerHTML = `Reliability <strong>${reliability}%</strong>`;
    }

    if (mapLogisticsNext) {
      const shipments = Array.isArray(logistics?.shipments) ? logistics.shipments : [];
      let summary = "Next ship: Standby";
      const next = shipments
        .filter((entry) => entry && entry.status === "pending")
        .sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0))[0];
      if (next) {
        const productLabel = PRODUCT_LABELS[next.product] || (next.product || "Cargo");
        const dueIn = Number.isFinite(next.dueIn) ? next.dueIn : 0;
        if (dueIn > 0) {
          summary = `Next: ${productLabel} in ${this._formatHours(dueIn)}`;
        } else if (dueIn < 0) {
          summary = `${productLabel} overdue ${this._formatHours(Math.abs(dueIn))}`;
        } else {
          summary = `${productLabel} at berth`;
        }
      } else if (shipments.some((entry) => entry && entry.status === "completed")) {
        summary = "Next ship: Loading complete";
      }
      mapLogisticsNext.textContent = summary;
    }
  }

  _updateInventoryBar(product, storage) {
    const name = product.charAt(0).toUpperCase() + product.slice(1);
    const bar = this.elements[`inventory${name}Bar`];
    const label = this.elements[`inventory${name}Label`];
    if (!bar && !label) {
      return;
    }
    const level = storage?.levels?.[product] ?? 0;
    const capacity = storage?.capacity?.[product] ?? 0;
    const ratio = capacity ? Math.min(Math.max(level / capacity, 0), 1.05) : 0;
    if (bar) {
      bar.style.width = `${Math.round(Math.min(ratio, 1) * 100)}%`;
      bar.classList.toggle("over", ratio > 0.98);
    }
    if (label) {
      label.textContent = capacity
        ? `${level.toFixed(0)} / ${capacity.toFixed(0)} kb`
        : `${level.toFixed(0)} kb`;
    }
  }

  _renderShipmentList(shipments, stats) {
    const list = this.elements.shipmentList;
    if (!list) {
      return;
    }
    list.innerHTML = "";

    const entries = [...shipments];
    const statusOrder = { pending: 0, completed: 1, missed: 2 };
    entries
      .sort((a, b) => {
        const aStatus = statusOrder[a.status] ?? 3;
        const bStatus = statusOrder[b.status] ?? 3;
        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }
        return (a.dueIn ?? 0) - (b.dueIn ?? 0);
      })
      .slice(0, 5)
      .forEach((shipment) => {
        list.appendChild(this._renderShipmentItem(shipment));
      });

    if (!entries.length) {
      const item = document.createElement("li");
      item.classList.add("shipment", "empty");
      item.textContent = "No marine movements scheduled.";
      list.appendChild(item);
    }

    if (this.elements.shipmentReliability) {
      const total = stats?.total ?? 0;
      const onTime = stats?.onTime ?? 0;
      const reliability = total ? Math.round((onTime / total) * 100) : 100;
      this.elements.shipmentReliability.textContent = `${reliability}% on-time (${total} orders)`;
    }
  }

  _renderShipmentItem(shipment) {
    const item = document.createElement("li");
    const status = shipment.status || "pending";
    item.classList.add("shipment", status);
    if (shipment.rush) {
      item.classList.add("rush");
    }

    const header = document.createElement("div");
    header.classList.add("shipment-header");
    const product = document.createElement("span");
    product.classList.add("shipment-product");
    const productLabel = PRODUCT_LABELS[shipment.product] || "Product";
    const volume = typeof shipment.volume === "number" ? Math.round(shipment.volume) : 0;
    product.textContent = `${productLabel} — ${volume} kb`;
    header.appendChild(product);

    const eta = document.createElement("span");
    eta.classList.add("shipment-status");
    if (status === "pending") {
      if (shipment.dueIn > 0) {
        eta.textContent = `Due in ${this._formatHours(shipment.dueIn)}`;
      } else if (shipment.dueIn < 0) {
        eta.textContent = `Overdue ${this._formatHours(Math.abs(shipment.dueIn))}`;
      } else {
        eta.textContent = "Loading";
      }
      if (shipment.rush) {
        eta.textContent += " (rush)";
      }
    } else if (status === "completed") {
      eta.textContent = "Cleared";
    } else {
      const shortage = shipment.shortage ? `${shipment.shortage.toFixed(0)} kb short` : "Missed";
      eta.textContent = shortage;
    }
    header.appendChild(eta);
    item.appendChild(header);

    if (status === "pending") {
      const progress = document.createElement("div");
      progress.classList.add("shipment-progress");
      const fill = document.createElement("div");
      fill.classList.add("fill");
      const ratio = typeof shipment.window === "number" && shipment.window > 0
        ? Math.min(Math.max(1 - shipment.dueIn / shipment.window, 0), 1)
        : 0;
      fill.style.width = `${Math.round(ratio * 100)}%`;
      progress.appendChild(fill);
      item.appendChild(progress);
    } else if (status === "missed") {
      const note = document.createElement("div");
      note.classList.add("shipment-note");
      note.textContent = "Penalty assessed";
      item.appendChild(note);
    }

    return item;
  }

  _renderDirectives(directives) {
    const list = this.elements.directiveList;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const entries = Array.isArray(directives) ? [...directives] : [];
    const statusOrder = { active: 0, completed: 1, failed: 2 };

    entries
      .sort((a, b) => {
        const aStatus = statusOrder[a.status] ?? 3;
        const bStatus = statusOrder[b.status] ?? 3;
        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }
        return (a.timeRemaining ?? 0) - (b.timeRemaining ?? 0);
      })
      .forEach((directive) => {
        list.appendChild(this._renderDirectiveItem(directive));
      });

    if (!entries.length) {
      const empty = document.createElement("li");
      empty.classList.add("directive", "empty");
      empty.textContent = "No directives issued.";
      list.appendChild(empty);
    }
  }

  _renderDirectiveItem(directive) {
    const item = document.createElement("li");
    const status = directive.status || "active";
    item.classList.add("directive", status);

    const header = document.createElement("div");
    header.classList.add("directive-header");
    const title = document.createElement("span");
    title.classList.add("directive-title");
    title.textContent = directive.title;
    header.appendChild(title);

    const statusLabel = document.createElement("span");
    statusLabel.classList.add("directive-status");
    if (status === "active") {
      statusLabel.textContent = directive.timeRemaining > 0
        ? `${this._formatHours(directive.timeRemaining)} left`
        : "Due now";
    } else if (status === "completed") {
      statusLabel.textContent = "Completed";
    } else {
      statusLabel.textContent = "Failed";
    }
    header.appendChild(statusLabel);
    item.appendChild(header);

    if (directive.description) {
      const description = document.createElement("p");
      description.textContent = directive.description;
      item.appendChild(description);
    }

    const meta = document.createElement("div");
    meta.classList.add("directive-meta");
    if (directive.type === "delivery") {
      const progress = directive.progress || 0;
      meta.textContent = `${Math.min(progress, directive.target).toFixed(0)} / ${directive.target.toFixed(
        0
      )} kb staged`;
    } else if (directive.type === "reliability") {
      meta.textContent = `Maintain ≥ ${Math.round((directive.threshold || 0) * 100)}%`;
    } else if (directive.type === "carbon") {
      meta.textContent = `Cap at ${directive.threshold} tCO₂-eq`;
    }
    item.appendChild(meta);

    const progressBar = document.createElement("div");
    progressBar.classList.add("directive-progress");
    const fill = document.createElement("div");
    fill.classList.add("fill");
    const ratio = Math.min(Math.max(directive.progressRatio ?? 0, 0), 1);
    fill.style.width = `${Math.round(ratio * 100)}%`;
    progressBar.appendChild(fill);
    item.appendChild(progressBar);

    return item;
  }

  _formatFlow(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "—";
    }
    return `${this.flowFormatter.format(value)} kbpd`;
  }

  _lookupUnitName(unitId) {
    if (!unitId) {
      return "unit";
    }
    return this.processTopology?.[unitId]?.name || unitId;
  }

  _getOverrideState(unit) {
    const override =
      typeof this.simulation.getUnitOverride === "function"
        ? this.simulation.getUnitOverride(unit.id)
        : null;
    const throttle =
      typeof override?.throttle === "number"
        ? override.throttle
        : typeof unit.overrideThrottle === "number"
        ? unit.overrideThrottle
        : 1;
    const offline = Boolean(override?.offline) || unit.status === "standby";
    return { throttle: Math.min(Math.max(throttle, 0), 1.2), offline };
  }

  _renderUnitControls(container, unit, override) {
    const controls = document.createElement("div");
    controls.classList.add("unit-controls");

    const notices = [];
    if (unit.emergencyOffline) {
      notices.push("Emergency hold keeps this unit offline until released.");
    } else if (override.offline) {
      notices.push("Unit is manually held in standby.");
    }
    if (Math.abs((override.throttle ?? 1) - 1) > 0.01) {
      notices.push(`Throttle override set to ${Math.round((override.throttle ?? 1) * 100)}%.`);
    }
    if (notices.length) {
      const notice = document.createElement("p");
      notice.classList.add("unit-override-notice");
      notice.textContent = notices.join(" ");
      controls.appendChild(notice);
    }

    const throttleWrapper = document.createElement("div");
    throttleWrapper.classList.add("unit-throttle-control");
    const label = document.createElement("label");
    const sliderId = `unit-throttle-${unit.id}`;
    label.setAttribute("for", sliderId);
    label.classList.add("unit-throttle-label");
    const throttleValue = document.createElement("span");
    throttleValue.classList.add("unit-throttle-value");
    throttleValue.textContent = `${Math.round((override.throttle ?? 1) * 100)}%`;
    label.append(document.createTextNode("Throttle "), throttleValue);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "120";
    slider.step = "5";
    slider.id = sliderId;
    slider.value = String(Math.round((override.throttle ?? 1) * 100));
    slider.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      throttleValue.textContent = `${Math.round(value * 100)}%`;
      this.simulation.setUnitThrottle(unit.id, value, { quiet: true });
    });
    slider.addEventListener("change", (event) => {
      const value = Number(event.target.value) / 100;
      this.simulation.setUnitThrottle(unit.id, value);
      this.selectUnit(unit.id);
    });
    throttleWrapper.append(label, slider);
    controls.appendChild(throttleWrapper);

    const buttonRow = document.createElement("div");
    buttonRow.classList.add("unit-control-buttons");
    const offlineActive = override.offline;
    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.classList.add("unit-control-button");
    toggleButton.textContent = offlineActive
      ? unit.emergencyOffline
        ? "Release Hold"
        : "Bring Unit Online"
      : "Take Unit Offline";
    toggleButton.addEventListener("click", () => {
      this.simulation.setUnitOffline(unit.id, !offlineActive);
      this.selectUnit(unit.id);
    });
    buttonRow.appendChild(toggleButton);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.classList.add("unit-control-button", "secondary");
    const hasOverride = offlineActive || Math.abs((override.throttle ?? 1) - 1) > 0.01;
    clearButton.textContent = "Clear Overrides";
    clearButton.disabled = !hasOverride;
    clearButton.addEventListener("click", () => {
      this.simulation.clearUnitOverride(unit.id);
      this.selectUnit(unit.id);
    });
    buttonRow.appendChild(clearButton);

    controls.appendChild(buttonRow);
    container.appendChild(controls);
  }

  _renderAlertDetail(container, unit) {
    const detail = unit.alertDetail || unit.lastIncident;
    if (!detail) {
      return;
    }
    const alertBox = document.createElement("div");
    alertBox.classList.add("unit-incident");
    alertBox.classList.add(detail.severity === "danger" ? "danger" : "warning");
    const title = document.createElement("strong");
    title.textContent = detail.summary
      ? detail.summary
      : detail.severity === "danger"
      ? "Critical incident"
      : "Process upset";
    alertBox.appendChild(title);
    if (detail.cause) {
      const cause = document.createElement("p");
      cause.textContent = detail.cause;
      alertBox.appendChild(cause);
    }
    if (detail.guidance) {
      const guidance = document.createElement("p");
      guidance.classList.add("unit-incident-guidance");
      guidance.textContent = detail.guidance;
      alertBox.appendChild(guidance);
    }
    if (unit.status === "offline" && unit.downtime > 0) {
      const eta = document.createElement("span");
      eta.classList.add("unit-incident-eta");
      eta.textContent = `Repairs ~${Math.ceil(unit.downtime)} min`;
      alertBox.appendChild(eta);
    }
    if (detail.recordedAt) {
      const timestamp = document.createElement("span");
      timestamp.classList.add("unit-incident-time");
      timestamp.textContent = detail.recordedAt;
      alertBox.appendChild(timestamp);
    }
    container.appendChild(alertBox);
  }

  _renderInspectionDetail(container, unit) {
    if (!unit || !this.inspectionReports.has(unit.id)) {
      return;
    }
    const report = this.inspectionReports.get(unit.id);
    if (!report) {
      return;
    }

    const section = document.createElement("div");
    section.classList.add("unit-inspection");

    const header = document.createElement("div");
    header.classList.add("inspection-header");
    const badge = document.createElement("span");
    badge.classList.add("inspection-badge", report.severity || "info");
    const severityLabels = { info: "Normal", warning: "Watch", danger: "Critical" };
    badge.textContent = severityLabels[report.severity] || (report.severity || "Info").toUpperCase();
    header.appendChild(badge);
    if (report.timestamp) {
      const timestamp = document.createElement("span");
      timestamp.classList.add("inspection-timestamp");
      timestamp.textContent = report.timestamp;
      header.appendChild(timestamp);
    }
    section.appendChild(header);

    const summary = document.createElement("p");
    summary.classList.add("inspection-summary");
    summary.textContent = report.summary || "Inspection results recorded.";
    section.appendChild(summary);

    if (Array.isArray(report.findings) && report.findings.length) {
      const findingsList = document.createElement("ul");
      findingsList.classList.add("inspection-findings");
      report.findings.slice(0, 4).forEach((finding) => {
        if (!finding) {
          return;
        }
        const item = document.createElement("li");
        item.textContent = finding;
        findingsList.appendChild(item);
      });
      if (findingsList.childElementCount) {
        section.appendChild(findingsList);
      }
    }

    if (Array.isArray(report.recommendations) && report.recommendations.length) {
      const recLabel = document.createElement("p");
      recLabel.classList.add("inspection-label");
      recLabel.textContent = "Recommendations:";
      section.appendChild(recLabel);
      const recList = document.createElement("ul");
      recList.classList.add("inspection-recommendations");
      report.recommendations.slice(0, 3).forEach((recommendation) => {
        if (!recommendation) {
          return;
        }
        const item = document.createElement("li");
        item.textContent = recommendation;
        recList.appendChild(item);
      });
      if (recList.childElementCount) {
        section.appendChild(recList);
      }
    }

    container.appendChild(section);
  }

  _renderProcessTopology(container, unit) {
    const topology = this.processTopology?.[unit.id];
    if (!topology) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.classList.add("unit-process");
    if (topology.summary) {
      const summary = document.createElement("p");
      summary.classList.add("unit-process-summary");
      summary.textContent = topology.summary;
      wrapper.appendChild(summary);
    }
    this._renderProcessList(wrapper, "Feeds", topology.feeds || []);
    this._renderProcessList(wrapper, "Outputs", topology.outputs || []);
    container.appendChild(wrapper);
  }

  _renderProcessList(container, heading, items) {
    if (!items.length) {
      return;
    }
    const section = document.createElement("div");
    section.classList.add("unit-process-section");
    const title = document.createElement("h4");
    title.textContent = heading;
    section.appendChild(title);
    const list = document.createElement("ul");
    list.classList.add("unit-process-list");
    items.forEach((item) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.classList.add("unit-process-label");
      label.textContent = item.label || item.kind || this._lookupUnitName(item.unit || "");
      row.appendChild(label);
      if (item.unit) {
        const link = document.createElement("span");
        link.classList.add("unit-process-link");
        const direction = heading === "Feeds" ? "from" : "to";
        link.textContent = `${direction} ${this._lookupUnitName(item.unit)}`;
        row.appendChild(link);
      }
      if (item.pipeline) {
        const flow = document.createElement("span");
        flow.classList.add("unit-process-flow");
        flow.textContent = this._formatFlow(this.latestFlows[item.pipeline]);
        row.appendChild(flow);
      }
      list.appendChild(row);
    });
    section.appendChild(list);
    container.appendChild(section);
  }

  _describeUnitStatus(unit) {
    if (unit.status === "online") {
      return unit.alert ? `Online — ${unit.alert}` : "Online";
    }
    if (unit.status === "standby") {
      if (unit.emergencyOffline) {
        return "Standby (emergency hold)";
      }
      if (unit.manualOffline) {
        return "Standby (manual)";
      }
      return "Standby";
    }
    const minutes = Math.max(1, Math.ceil(unit.downtime || 0));
    return `Offline (${minutes} min remaining)`;
  }

  _formatHours(hours) {
    if (!Number.isFinite(hours)) {
      return "--";
    }
    const sign = hours < 0 ? -1 : 1;
    const absolute = Math.abs(hours);
    const totalMinutes = Math.round(absolute * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const prefix = sign < 0 ? "-" : "";
    if (h === 0) {
      return `${prefix}${m}m`;
    }
    if (m === 0) {
      return `${prefix}${h}h`;
    }
    return `${prefix}${h}h ${String(m).padStart(2, "0")}m`;
  }

  _updateClock() {
    if (!this.elements.clock) return;
    const totalMinutes = Math.floor(this.simulation.getTime());
    const base = Date.UTC(1992, 0, 1, 3, 0, 0);
    const current = new Date(base + totalMinutes * 60_000);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[current.getUTCMonth()];
    const day = String(current.getUTCDate()).padStart(2, "0");
    const year = current.getUTCFullYear();
    const hours = current.getUTCHours();
    const minutes = String(current.getUTCMinutes()).padStart(2, "0");
    const hour12 = ((hours + 11) % 12) + 1;
    const ampm = hours >= 12 ? "PM" : "AM";
    this.elements.clock.textContent = `${month} ${day}, ${year} ${String(hour12).padStart(2, "0")}:${minutes} ${ampm}`;
  }
}
