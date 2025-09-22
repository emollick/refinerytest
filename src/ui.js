export class UIController {
  constructor(simulation) {
    this.simulation = simulation;
    this.selectedUnitId = null;
    this.lastLogSignature = "";
    this.modeFlashTimeout = null;

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
      reliabilityOutput: document.getElementById("reliability-output"),
      carbonOutput: document.getElementById("carbon-output"),
      scoreGrade: document.getElementById("score-grade"),
      scoreDelta: document.getElementById("score-delta"),
      scoreNote: document.getElementById("score-note"),
      scoreTrend: document.getElementById("score-trend"),
      logList: document.getElementById("event-log"),
      unitDetails: document.getElementById("unit-details"),
      clock: document.getElementById("sim-clock"),
      modeBadge: document.getElementById("mode-badge"),
    };

    this.profitFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

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
    status.textContent = unit.status === "online" ? "Online" : `Offline (${Math.ceil(unit.downtime)} min remaining)`;
    status.classList.add("unit-status");
    unitDetails.appendChild(status);

    const list = document.createElement("div");
    list.classList.add("unit-stats");

    list.appendChild(this._statRow("Throughput", `${unit.throughput.toFixed(1)} kbpd`));
    list.appendChild(this._statRow("Utilization", `${Math.round(unit.utilization * 100)}%`));
    list.appendChild(this._statRow("Integrity", `${Math.round(unit.integrity * 100)}%`));
    list.appendChild(this._statRow("Incidents", `${unit.incidents}`));

    unitDetails.appendChild(list);
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

  update() {
    const metrics = this.simulation.getMetrics();
    this._renderMetrics(metrics);
    this._renderLogs();
    this._updateClock();
    if (this.selectedUnitId) {
      const unit = this.simulation
        .getUnits()
        .find((entry) => entry.id === this.selectedUnitId);
      this._renderUnitDetails(unit || null);
    }
  }

  refreshControls() {
    this._updateSliderLabels();
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

    this.elements.reliabilityOutput.textContent = `${Math.round(metrics.reliability * 100)}%`;
    this.elements.carbonOutput.textContent = `${metrics.carbon.toFixed(1)} tCO₂-eq`;

    this._renderScorecard(metrics);
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
