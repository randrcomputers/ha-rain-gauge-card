/**
 * Rain Gauge Plus — Home Assistant Lovelace.
 * Realistic dual-scale rain tube, 12/24h totals, and daily history.
 */
(function () {
  const LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
  const { html, css } = LitElement.prototype;

  const DEFAULTS = Object.freeze({
    name: "Rain Gauge",
    look: "tube",
    size: "100",
    max_level: 5,
    show_history: true,
    history_days: 14,
    show_rate: true,
    show_yesterday: true,
  });

  const LOOKS = Object.freeze({
    tube: { label: "Classic tube (5 in)", maxIn: 5 },
    wedge: { label: "Yellow wedge (6 in)", maxIn: 6 },
    cone: { label: "Blue cone (2 in)", maxIn: 2 },
    taper: { label: "Clear taper (5 in)", maxIn: 5 },
    glass7: { label: "Glass cylinder (7 in)", maxIn: 7 },
    fence: { label: "Fence cup (6 in)", maxIn: 6 },
    garden: { label: "Garden stake (7 in)", maxIn: 7 },
  });

  const MM_PER_IN = 25.4;
  const CM_PER_IN_GAUGE = 2.4; // printed La Crosse-style 5 in = 12 cm

  function lookIdOf(config) {
    const id = config?.look;
    return LOOKS[id] ? id : "tube";
  }

  function sizeOf(config) {
    const id = String(config?.size ?? "100");
    return id === "50" || id === "75" || id === "100" ? id : "100";
  }

  function mergeConfig(config) {
    const merged = {
      ...DEFAULTS,
      ...(config || {}),
    };
    merged.size = sizeOf(merged);
    return merged;
  }

  function num(config, key, fallback) {
    const v = config[key];
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function entityState(hass, entityId) {
    if (!entityId || !hass?.states?.[entityId]) return null;
    return hass.states[entityId];
  }

  function parseNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function unitOf(st) {
    return String(st?.attributes?.unit_of_measurement || "")
      .trim()
      .toLowerCase();
  }

  function toInches(value, unit) {
    if (value == null) return null;
    const u = String(unit || "").toLowerCase();
    if (u === "mm" || u === "millimeter" || u === "millimeters") return value / MM_PER_IN;
    if (u === "cm" || u === "centimeter" || u === "centimeters") return value / 2.54;
    return value;
  }

  function displayUnit(config, st) {
    if (config.unit_system === "metric") return "mm";
    if (config.unit_system === "imperial") return "in";
    const u = unitOf(st);
    if (u.startsWith("mm")) return "mm";
    if (u.startsWith("cm")) return "cm";
    return "in";
  }

  function formatAmount(inches, unit, digits) {
    if (inches == null || !Number.isFinite(inches)) return "—";
    if (unit === "mm") {
      const d = digits != null ? digits : inches * MM_PER_IN >= 10 ? 0 : 1;
      return `${(inches * MM_PER_IN).toFixed(d)} mm`;
    }
    if (unit === "cm") return `${(inches * 2.54).toFixed(2)} cm`;
    const d = digits != null ? digits : inches >= 10 ? 1 : 2;
    return `${inches.toFixed(d)} in`;
  }

  function formatAmountShort(inches, unit) {
    if (inches == null || !Number.isFinite(inches)) return "—";
    if (unit === "mm") return (inches * MM_PER_IN).toFixed(inches * MM_PER_IN >= 10 ? 0 : 1);
    if (unit === "cm") return (inches * 2.54).toFixed(1);
    return inches.toFixed(inches >= 10 ? 1 : 2);
  }

  function unitLabel(unit) {
    if (unit === "mm") return "mm";
    if (unit === "cm") return "cm";
    return "in";
  }

  function stamp(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function roundRain(n) {
    if (n == null || !Number.isFinite(n)) return 0;
    return Math.round(Math.max(0, n) * 1000) / 1000;
  }

  function sumChanges(rows, sinceMs, untilMs, liveInches) {
    let total = 0;
    let last = null;
    for (const row of rows || []) {
      const start = stamp(row.start);
      const end = stamp(row.end);
      if (!Number.isFinite(end)) continue;
      if (untilMs != null && start >= untilMs) continue;
      if (end > sinceMs) total += Math.max(0, Number(row.change) || 0);
      last = row;
    }
    if (last && liveInches != null) {
      const lastState = Number(last.state);
      if (Number.isFinite(lastState) && liveInches + 0.0005 >= lastState) {
        const extra = liveInches - lastState;
        if (extra > 0.0005) total += extra;
      }
    }
    return roundRain(total);
  }

  function dayKey(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ms));
    } catch {
      const d = new Date(ms);
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
  }

  function weekdayLetter(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        weekday: "narrow",
      }).format(new Date(ms));
    } catch {
      return ["S", "M", "T", "W", "T", "F", "S"][new Date(ms).getDay()];
    }
  }

  function dayNum(ms) {
    return String(new Date(ms).getDate());
  }

  function monthDay(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        month: "short",
        day: "numeric",
      }).format(new Date(ms));
    } catch {
      const d = new Date(ms);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
  }

  class RainGaugePlusCard extends LitElement {
    static get properties() {
      return {
        hass: {},
        config: {},
        _historyDays: { state: true },
        _hours: { state: true },
        _days: { state: true },
        _selectedDay: { state: true },
        _histError: { state: true },
      };
    }

    static getConfigElement() {
      return document.createElement("rain-gauge-plus-card-editor");
    }

    static getStubConfig(hass) {
      const ids = Object.keys(hass?.states || {});
      const entity =
        ids.find((id) => /rain_total/.test(id)) ||
        ids.find((id) => {
          const st = hass.states[id];
          return (
            st?.attributes?.device_class === "precipitation" &&
            /rain|precip/i.test(id)
          );
        }) ||
        "";
      const rate =
        ids.find((id) => /precipitation$/.test(id) && id !== entity) ||
        ids.find((id) => stClass(hass, id) === "precipitation_intensity") ||
        "";
      return {
        type: "custom:rain-gauge-plus-card",
        entity,
        hourly_rate_entity: rate,
        look: "tube",
        size: "100",
        name: "Rain Gauge",
      };
    }

    constructor() {
      super();
      this._hours = [];
      this._days = [];
      this._historyDays = 14;
      this._selectedDay = null;
      this._histError = "";
      this._histKey = "";
    }

    getCardSize() {
      const size = Number(sizeOf(this.config));
      const base = this.config?.show_history === false ? 4 : 6;
      return Math.max(2, Math.round((base * size) / 100));
    }

    setConfig(config) {
      if (!config) throw new Error("Invalid configuration");
      this.config = mergeConfig(config);
      this._historyDays = num(this.config, "history_days", 14);
      this.dataset.size = sizeOf(this.config);
    }

    updated(changed) {
      this.dataset.size = sizeOf(this.config);
      if (changed.has("hass") || changed.has("config")) {
        this._loadHistory();
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._histKey = "";
    }

    _moreInfo(entityId) {
      if (!entityId) return;
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          bubbles: true,
          composed: true,
          detail: { entityId },
        })
      );
    }

    async _loadHistory() {
      const entity = this.config?.entity;
      const hass = this.hass;
      if (!entity || !hass?.callWS) return;
      const days = Math.max(7, Number(this._historyDays) || 14);
      const key = `${entity}|${days}|${Math.floor(Date.now() / 120000)}`;
      if (key === this._histKey) return;
      this._histKey = key;
      const end = new Date();
      const startDaily = new Date(end.getTime() - (days + 1) * 86400000);
      const startHourly = new Date(end.getTime() - 36 * 3600000);
      try {
        const [daily, hourly] = await Promise.all([
          hass.callWS({
            type: "recorder/statistics_during_period",
            start_time: startDaily.toISOString(),
            end_time: end.toISOString(),
            statistic_ids: [entity],
            period: "day",
            types: ["change", "state"],
          }),
          hass.callWS({
            type: "recorder/statistics_during_period",
            start_time: startHourly.toISOString(),
            end_time: end.toISOString(),
            statistic_ids: [entity],
            period: "hour",
            types: ["change", "state"],
          }),
        ]);
        this._days = daily?.[entity] || [];
        this._hours = hourly?.[entity] || [];
        this._histError = "";
      } catch (err) {
        this._histError = err?.message || "history unavailable";
        this._days = [];
        this._hours = [];
      }
    }

    _model() {
      const cfg = mergeConfig(this.config || {});
      const st = entityState(this.hass, cfg.entity);
      const rateSt = entityState(this.hass, cfg.hourly_rate_entity);
      const unit = displayUnit(cfg, st);
      const lookId = lookIdOf(cfg);
      const live = st ? toInches(parseNumber(st.state), unitOf(st)) : null;
      const nativeMax = LOOKS[lookId].maxIn;
      const maxIn =
        lookId === "tube"
          ? Math.max(
              0.5,
              toInches(
                num(cfg, "max_level", nativeMax),
                unit === "mm" ? "mm" : unit === "cm" ? "cm" : "in"
              ) || nativeMax
            )
          : nativeMax;
      const now = Date.now();
      const last12 = live != null ? sumChanges(this._hours, now - 12 * 3600000, now, live) : null;
      const last24 = live != null ? sumChanges(this._hours, now - 24 * 3600000, now, live) : null;
      const yesterdayAttr = parseNumber(st?.attributes?.last_period);
      const yesterday = yesterdayAttr != null ? toInches(yesterdayAttr, unitOf(st)) : null;
      const rateVal = rateSt ? parseNumber(rateSt.state) : null;
      const rateIn = rateVal != null ? toInches(rateVal, unitOf(rateSt)) : null;
      const raining = (rateIn != null && rateIn > 0.001) || (last12 != null && last12 > 0 && rateIn !== 0 && this._recentHourRain());
      const unavailable = !st || ["unavailable", "unknown"].includes(String(st.state));
      return {
        cfg,
        st,
        rateSt,
        unit,
        live: live != null ? roundRain(live) : null,
        maxIn,
        last12,
        last24,
        yesterday: yesterday != null ? roundRain(yesterday) : null,
        rateIn: rateIn != null ? roundRain(rateIn) : null,
        lookId,
        size: sizeOf(cfg),
        raining,
        unavailable,
        title: cfg.name || st?.attributes?.friendly_name || "Rain Gauge",
      };
    }

    _recentHourRain() {
      const rows = this._hours || [];
      if (!rows.length) return false;
      const last = rows[rows.length - 1];
      return (Number(last.change) || 0) > 0.0005;
    }

    _historyBars(unit) {
      const want = Number(this._historyDays) || 14;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const byStart = new Map();
      for (const row of this._days || []) {
        byStart.set(stamp(row.start), roundRain(Number(row.change) || 0));
      }
      const bars = [];
      for (let i = want - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const startMs = d.getTime();
        let amount = 0;
        let matched = false;
        for (const [ms, val] of byStart) {
          if (Math.abs(ms - startMs) < 3 * 3600000) {
            amount = val;
            matched = true;
            break;
          }
        }
        if (!matched) {
          const key = dayKey(startMs, this.hass);
          for (const [ms, val] of byStart) {
            if (dayKey(ms, this.hass) === key) {
              amount = val;
              break;
            }
          }
        }
        if (i === 0) {
          const live = this._modelLiveFallback();
          if (live != null && live > amount) amount = live;
        }
        bars.push({
          start: startMs,
          amount,
          label:
            want <= 7
              ? weekdayLetter(startMs, this.hass)
              : want <= 14 || i === 0 || (want - 1 - i) % 5 === 0
                ? dayNum(startMs)
                : "",
          title: `${monthDay(startMs, this.hass)} · ${formatAmount(amount, unit)}`,
        });
      }
      return bars;
    }

    _modelLiveFallback() {
      const st = entityState(this.hass, this.config?.entity);
      if (!st) return null;
      const live = toInches(parseNumber(st.state), unitOf(st));
      return live != null ? roundRain(live) : null;
    }

    render() {
      if (!this.hass || !this.config) return html``;
      const m = this._model();
      if (!m.cfg.entity) {
        return html`
          <ha-card>
            <div class="wrap setup">
              <p>Pick a rain sensor in the card editor.</p>
            </div>
          </ha-card>
        `;
      }
      const bars = m.cfg.show_history !== false ? this._historyBars(m.unit) : [];
      const maxBar = Math.max(0.01, ...bars.map((b) => b.amount));
      const selected =
        this._selectedDay != null
          ? bars.find((b) => b.start === this._selectedDay) || null
          : bars[bars.length - 1] || null;
      const periodTotal = roundRain(bars.reduce((s, b) => s + b.amount, 0));

      return html`
        <ha-card>
          <div class="wrap ${m.raining ? "raining" : ""}">
            <div class="header">
              <button class="title" @click=${() => this._moreInfo(m.cfg.entity)}>
                ${m.title}
              </button>
              ${m.unavailable
                ? html`<span class="badge warn">Unavailable</span>`
                : m.raining
                  ? html`<span class="badge wet">Currently raining</span>`
                  : html`<span class="badge dry">Currently dry</span>`}
            </div>

            <div class="body">
              <div class="gauge-col" aria-hidden="true">
                ${this._renderGauge(m.live || 0, m.maxIn, m.raining, m.lookId)}
              </div>

              <div class="info-col">
                <div class="tiles">
                  <button class="tile" @click=${() => this._moreInfo(m.cfg.entity)}>
                    <span class="tile-k">Last 12 hours</span>
                    <span class="tile-v">${formatAmount(m.last12 ?? m.live, m.unit)}</span>
                  </button>
                  <button class="tile" @click=${() => this._moreInfo(m.cfg.entity)}>
                    <span class="tile-k">Last 24 hours</span>
                    <span class="tile-v">${formatAmount(m.last24 ?? m.live, m.unit)}</span>
                  </button>
                </div>

                <div class="stats">
                  <div class="stat">
                    <span class="stat-k">Today</span>
                    <span class="stat-v">${formatAmount(m.live, m.unit)}</span>
                  </div>
                  ${m.cfg.show_yesterday !== false
                    ? html`
                        <div class="stat">
                          <span class="stat-k">Yesterday</span>
                          <span class="stat-v">${formatAmount(m.yesterday, m.unit)}</span>
                        </div>
                      `
                    : ""}
                  ${m.cfg.show_rate !== false && m.cfg.hourly_rate_entity
                    ? html`
                        <div class="stat">
                          <span class="stat-k">Rate</span>
                          <span class="stat-v"
                            >${m.rateIn == null
                              ? "—"
                              : `${formatAmountShort(m.rateIn, m.unit)} ${unitLabel(m.unit)}/h`}</span
                          >
                        </div>
                      `
                    : ""}
                </div>

                ${m.cfg.show_history !== false
                  ? html`
                      <div class="hist">
                        <div class="hist-head">
                          <span class="hist-title">History</span>
                          <div class="pills">
                            ${[7, 14, 30].map(
                              (d) => html`
                                <button
                                  class="pill ${this._historyDays === d ? "on" : ""}"
                                  @click=${() => {
                                    this._historyDays = d;
                                    this._histKey = "";
                                    this._loadHistory();
                                  }}
                                >
                                  ${d}d
                                </button>
                              `
                            )}
                          </div>
                        </div>
                        <div class="chart ${bars.length > 16 ? "dense" : ""}" role="img" aria-label="Daily rainfall history">
                          ${bars.map(
                            (b) => html`
                              <button
                                class="bar-col ${selected?.start === b.start ? "sel" : ""} ${b.amount > 0 ? "wet" : ""}"
                                title=${b.title}
                                @click=${() => {
                                  this._selectedDay = b.start;
                                }}
                              >
                                <span
                                  class="bar"
                                  style="height:${Math.max(b.amount > 0 ? 6 : 2, (b.amount / maxBar) * 100)}%"
                                ></span>
                                <span class="bar-l">${b.label}</span>
                              </button>
                            `
                          )}
                        </div>
                        <div class="hist-foot">
                          <span
                            >${selected
                              ? `${monthDay(selected.start, this.hass)} · ${formatAmount(selected.amount, m.unit)}`
                              : ""}</span
                          >
                          <span>${this._historyDays}d total ${formatAmount(periodTotal, m.unit)}</span>
                        </div>
                        ${this._histError
                          ? html`<div class="hist-err">${this._histError}</div>`
                          : ""}
                      </div>
                    `
                  : ""}
              </div>
            </div>
          </div>
        </ha-card>
      `;
    }

    _renderGauge(inches, maxIn, raining, lookId) {
      const look = lookIdOf({ look: lookId });
      return html`
        <div class="gauge look-${look}">
          ${raining
            ? html`
                <div class="drops">
                  ${[0, 1, 2, 3, 4].map(
                    (i) => html`<span class="drop d${i}"></span>`
                  )}
                </div>
              `
            : ""}
          <div class="gauge-svg" .innerHTML=${this._gaugeSvg(inches, maxIn, look)}></div>
        </div>
      `;
    }

    _gaugeSvg(inches, maxIn, look) {
      const builders = {
        tube: () => this._svgTube(inches, maxIn),
        wedge: () => this._svgWedge(inches, maxIn),
        cone: () => this._svgCone(inches, maxIn),
        taper: () => this._svgTaper(inches, maxIn),
        glass7: () => this._svgGlass7(inches, maxIn),
        fence: () => this._svgFence(inches, maxIn),
        garden: () => this._svgGarden(inches, maxIn),
      };
      return (builders[look] || builders.tube)();
    }

    _uid() {
      return `rg${lookIdOf(this.config)}${String(this.config?.entity || "x").replace(/[^a-z0-9]/gi, "")}`;
    }

    _waterFill(inches, maxIn, yTop, yBot) {
      const fill = Math.max(0, Math.min(1, Number(inches) / maxIn));
      const yWater = yBot - fill * (yBot - yTop);
      const waterH = fill > 0 ? Math.max(8, yBot - yWater) : 0;
      return { fill, yWater, waterH };
    }

    _svgTube(inches, maxIn) {
      const yTop = 70;
      const yBot = 448;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const ticks = this._tubeTicks(maxIn, yTop, yBot);
      const water =
        fill > 0
          ? `<rect x="69" y="${yWater.toFixed(2)}" width="62" height="${(waterH + 24).toFixed(2)}" fill="url(#${uid}-water)"/>
             <path d="M69 ${yWater.toFixed(2)} C84 ${(yWater - 6).toFixed(2)}, 116 ${(yWater + 6).toFixed(2)}, 131 ${yWater.toFixed(2)} L131 ${(yWater + 12).toFixed(2)} L69 ${(yWater + 12).toFixed(2)} Z" fill="#c9efff" fill-opacity="0.65"/>`
          : "";
      return `
        <svg viewBox="0 0 200 510" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#b7c0c8" stop-opacity="0.35"/>
              <stop offset="22%" stop-color="#ffffff" stop-opacity="0.92"/>
              <stop offset="48%" stop-color="#f4f7fa" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#9aa4ae" stop-opacity="0.38"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a5c96"/>
              <stop offset="55%" stop-color="#1c90d8"/>
              <stop offset="100%" stop-color="#7ed0ff"/>
            </linearGradient>
            <clipPath id="${uid}-clip">
              <path d="M69 50 C69 42, 78 36, 100 36 C122 36, 131 42, 131 50 L131 446 C131 462, 117 470, 100 470 C83 470, 69 462, 69 446 Z"/>
            </clipPath>
          </defs>
          <ellipse cx="100" cy="492" rx="36" ry="7" fill="rgba(0,0,0,0.32)"/>
          <path d="M66 50 C66 40, 78 32, 100 32 C122 32, 134 40, 134 50 L134 446 C134 466, 118 476, 100 476 C82 476, 66 466, 66 446 Z" fill="url(#${uid}-glass)" stroke="#c5ced6" stroke-width="1.6"/>
          <path d="M69 50 C69 42, 79 36, 100 36 C121 36, 131 42, 131 50 L131 446 C131 462, 117 472, 100 472 C83 472, 69 462, 69 446 Z" fill="#ffffff" fill-opacity="0.55" stroke="#dbe3ea" stroke-width="0.5"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          <path d="M76 52 C76 52, 78 220, 79 446" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round"/>
          <line x1="100" y1="${yTop - 8}" x2="100" y2="${yBot}" stroke="#111" stroke-width="1.35"/>
          ${ticks}
          <text x="78" y="464" text-anchor="middle" font-size="11" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">IN.</text>
          <text x="122" y="464" text-anchor="middle" font-size="11" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">CM.</text>
          <ellipse cx="100" cy="28" rx="48" ry="12" fill="#fbfcfd" stroke="#c8d0d7" stroke-width="2"/>
          <ellipse cx="100" cy="26" rx="33" ry="7.5" fill="#eef3f7" stroke="#d3dbe2" stroke-width="1"/>
          <ellipse cx="100" cy="24.5" rx="22" ry="4.8" fill="none" stroke="#c5ccd3" stroke-width="1"/>
        </svg>
      `;
    }

    _tubeTicks(maxIn, yTop, yBot) {
      const scaleH = yBot - yTop;
      const yAtIn = (v) => yBot - (v / maxIn) * scaleH;
      const inchStep = maxIn <= 5 ? 0.5 : maxIn <= 10 ? 1 : 2;
      const cmMax = maxIn * CM_PER_IN_GAUGE;
      const cmStep = cmMax <= 12 ? 1 : cmMax <= 25 ? 2 : 5;
      let out = "";
      for (let v = inchStep; v <= maxIn + 0.001; v += inchStep) {
        const y = yAtIn(v);
        const major = Math.abs(v - Math.round(v)) < 0.001;
        out += `<line x1="${major ? 78 : 87}" y1="${y.toFixed(2)}" x2="100" y2="${y.toFixed(2)}" stroke="#111" stroke-width="${major ? 1.7 : 1}"/>`;
        if (major) {
          out += `<text x="74" y="${(y + 7).toFixed(2)}" text-anchor="end" font-size="22" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">${Math.round(v)}</text>`;
        } else if (maxIn <= 5) {
          out += `<text x="82" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="10" font-family="Arial, Helvetica, sans-serif" fill="#222">${v.toFixed(1)}</text>`;
        }
      }
      for (let c = 1; c <= cmMax + 0.001; c += cmStep) {
        const inches = c / CM_PER_IN_GAUGE;
        if (inches > maxIn + 0.02) continue;
        const y = yAtIn(inches);
        const even = c % 2 === 0 || cmStep > 1;
        out += `<line x1="100" y1="${y.toFixed(2)}" x2="${even ? 122 : 113}" y2="${y.toFixed(2)}" stroke="#111" stroke-width="${even ? 1.6 : 1}"/>`;
        if (even || cmMax <= 12) {
          out += `<text x="${even ? 126 : 117}" y="${(y + (even ? 6 : 3.5)).toFixed(2)}" text-anchor="start" font-size="${even ? 16 : 10}" font-weight="${even ? 700 : 500}" font-family="Arial, Helvetica, sans-serif" fill="#111">${c}</text>`;
        }
      }
      return out;
    }

    _svgWedge(inches, maxIn) {
      const yTop = 58;
      const yBot = 355;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      let ticks = "";
      for (let c = 1; c <= 15; c++) {
        const y = yAt(c / 2.54);
        if (c / 2.54 > maxIn + 0.02) continue;
        const major = c % 5 === 0;
        ticks += `<line x1="78" y1="${y.toFixed(2)}" x2="${major ? 96 : 90}" y2="${y.toFixed(2)}" stroke="#111" stroke-width="${major ? 1.6 : 1}"/>`;
        ticks += `<text x="74" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="${major ? 12 : 9}" font-weight="${major ? 700 : 500}" font-family="Arial, Helvetica, sans-serif" fill="#111">${c}</text>`;
      }
      for (let v = 0.5; v <= maxIn + 0.001; v += 0.5) {
        const y = yAt(v);
        const major = Number.isInteger(v);
        ticks += `<line x1="${major ? 118 : 122}" y1="${y.toFixed(2)}" x2="136" y2="${y.toFixed(2)}" stroke="#111" stroke-width="${major ? 1.7 : 1}"/>`;
        ticks += `<text x="134" y="${(y + (major ? 5 : 3.5)).toFixed(2)}" text-anchor="end" font-size="${major ? 13 : 9}" font-weight="${major ? 700 : 500}" font-family="Arial, Helvetica, sans-serif" fill="#111">${major ? v.toFixed(1) : v.toFixed(1)}</text>`;
      }
      const water =
        fill > 0
          ? `<rect x="74" y="${yWater.toFixed(2)}" width="70" height="${(waterH + 20).toFixed(2)}" fill="url(#${uid}-water)"/>`
          : "";
      return `
        <svg viewBox="0 0 220 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-yel" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#e6b000"/>
              <stop offset="40%" stop-color="#ffd54a"/>
              <stop offset="100%" stop-color="#f0b400"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a6a9a"/>
              <stop offset="100%" stop-color="#5ec4ef"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><path d="M72 42 L150 42 L144 360 L78 360 Z"/></clipPath>
          </defs>
          <ellipse cx="110" cy="505" rx="28" ry="6" fill="rgba(0,0,0,0.28)"/>
          <path d="M68 36 L154 36 L146 362 L74 362 Z" fill="url(#${uid}-yel)" stroke="#c49200" stroke-width="1.8"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          <path d="M68 36 L154 36 L146 362 L74 362 Z" fill="#ffcc00" fill-opacity="0.28"/>
          <line x1="108" y1="${yTop}" x2="108" y2="${yBot}" stroke="#111" stroke-width="1.2"/>
          ${ticks}
          <text x="86" y="348" font-size="10" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">CM.</text>
          <text x="122" y="348" font-size="10" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">IN.</text>
          <rect x="102" y="362" width="16" height="96" rx="2" fill="#f0b400" stroke="#c49200"/>
          <path d="M96 456 L124 456 L110 508 Z" fill="#e6a800" stroke="#c49200"/>
        </svg>
      `;
    }

    _svgCone(inches, maxIn) {
      const yTop = 92;
      const yBot = 430;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      let ticks = "";
      for (let v = 0.5; v <= maxIn + 0.001; v += 0.5) {
        const y = yAt(v);
        ticks += `<line x1="78" y1="${y.toFixed(2)}" x2="100" y2="${y.toFixed(2)}" stroke="#fff" stroke-width="1.4"/>`;
        ticks += `<text x="74" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="12" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">${v.toFixed(1)}</text>`;
      }
      for (let mm = 10; mm <= 40; mm += 10) {
        const y = yAt(mm / 25.4);
        ticks += `<line x1="100" y1="${y.toFixed(2)}" x2="122" y2="${y.toFixed(2)}" stroke="#fff" stroke-width="1.4"/>`;
        ticks += `<text x="126" y="${(y + 5).toFixed(2)}" font-size="13" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">${mm}</text>`;
      }
      const water =
        fill > 0
          ? `<rect x="40" y="${yWater.toFixed(2)}" width="120" height="${(waterH + 40).toFixed(2)}" fill="url(#${uid}-water)"/>`
          : "";
      return `
        <svg viewBox="0 0 220 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-blue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#1488a8"/>
              <stop offset="45%" stop-color="#2ec4d6"/>
              <stop offset="100%" stop-color="#0e7a96"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a4f80"/>
              <stop offset="100%" stop-color="#7edfff"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><path d="M42 78 L158 78 L112 478 L88 478 Z"/></clipPath>
          </defs>
          <ellipse cx="110" cy="505" rx="26" ry="6" fill="rgba(0,0,0,0.28)"/>
          <path d="M38 72 L162 72 L114 488 L86 488 Z" fill="url(#${uid}-blue)" stroke="#0c6d86" stroke-width="1.6"/>
          <ellipse cx="100" cy="72" rx="62" ry="14" fill="#3fd0de" stroke="#d8fbff" stroke-width="2"/>
          <ellipse cx="100" cy="70" rx="48" ry="8" fill="#1aa8bc"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          <path d="M38 72 L162 72 L114 488 L86 488 Z" fill="#2ec4d6" fill-opacity="0.18"/>
          <line x1="100" y1="${yTop}" x2="100" y2="${yBot}" stroke="#fff" stroke-width="1.3"/>
          ${ticks}
          <text x="78" y="448" text-anchor="middle" font-size="10" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">IN.</text>
          <text x="122" y="448" text-anchor="middle" font-size="10" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">MM.</text>
          <text x="100" y="64" text-anchor="middle" font-size="7.5" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">2 INCHES / 50 MM WHEN FULL</text>
        </svg>
      `;
    }

    _svgTaper(inches, maxIn) {
      const yTop = 62;
      const yBot = 355;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      const marks = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5];
      let ticks = "";
      for (const v of marks) {
        const y = yAt(v);
        const major = Number.isInteger(v);
        ticks += `<line x1="88" y1="${y.toFixed(2)}" x2="${major ? 128 : 118}" y2="${y.toFixed(2)}" stroke="#fff" stroke-width="${major ? 1.8 : 1.1}"/>`;
        ticks += `<text x="84" y="${(y + (major ? 7 : 4)).toFixed(2)}" text-anchor="end" font-size="${major ? 20 : 11}" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">${major ? Math.round(v) : "½"}</text>`;
      }
      const water =
        fill > 0
          ? `<rect x="70" y="${yWater.toFixed(2)}" width="60" height="${(waterH + 24).toFixed(2)}" fill="url(#${uid}-water)"/>`
          : "";
      return `
        <svg viewBox="0 0 200 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#c5d0da" stop-opacity="0.45"/>
              <stop offset="40%" stop-color="#ffffff" stop-opacity="0.7"/>
              <stop offset="100%" stop-color="#9aa8b4" stop-opacity="0.4"/>
            </linearGradient>
            <linearGradient id="${uid}-navy" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#1b2a4a"/>
              <stop offset="100%" stop-color="#243868"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a5c96"/>
              <stop offset="100%" stop-color="#7ed0ff"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><path d="M78 48 L122 48 L114 365 L86 365 Z"/></clipPath>
          </defs>
          <ellipse cx="100" cy="505" rx="24" ry="6" fill="rgba(0,0,0,0.28)"/>
          <path d="M74 42 L126 42 L118 368 L82 368 Z" fill="url(#${uid}-glass)" stroke="#c5d0da" stroke-width="1.5"/>
          <path d="M80 50 L120 50 L113 360 L87 360 Z" fill="url(#${uid}-navy)"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          ${ticks}
          <text x="78" y="52" font-size="11" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#fff">5 in.</text>
          <rect x="94" y="368" width="12" height="90" fill="#e8eef3" stroke="#c5d0da"/>
          <path d="M88 456 L112 456 L100 508 Z" fill="#e8eef3" stroke="#c5d0da"/>
        </svg>
      `;
    }

    _svgGlass7(inches, maxIn) {
      const yTop = 58;
      const yBot = 430;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      let ticks = "";
      for (let v = 1; v <= maxIn + 0.001; v++) {
        const y = yAt(v);
        ticks += `<line x1="78" y1="${y.toFixed(2)}" x2="122" y2="${y.toFixed(2)}" stroke="#111" stroke-width="1.2"/>`;
        ticks += `<text x="72" y="${(y + 8).toFixed(2)}" text-anchor="end" font-size="28" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="#111">${v}</text>`;
        for (let i = 1; i < 5; i++) {
          const yi = yAt(v - 1 + i * 0.2);
          if (v === 1 && i === 0) continue;
          ticks += `<line x1="90" y1="${yi.toFixed(2)}" x2="110" y2="${yi.toFixed(2)}" stroke="#333" stroke-width="0.8"/>`;
        }
      }
      const water =
        fill > 0
          ? `<rect x="78" y="${yWater.toFixed(2)}" width="44" height="${(waterH + 20).toFixed(2)}" fill="url(#${uid}-water)"/>
             <ellipse cx="100" cy="${yWater.toFixed(2)}" rx="23" ry="6" fill="#e23b3b" stroke="#b81e1e" stroke-width="1.5"/>`
          : "";
      return `
        <svg viewBox="0 0 200 510" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#b7c0c8" stop-opacity="0.35"/>
              <stop offset="30%" stop-color="#ffffff" stop-opacity="0.85"/>
              <stop offset="100%" stop-color="#9aa4ae" stop-opacity="0.35"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a7ad4"/>
              <stop offset="100%" stop-color="#5ec7ff"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><rect x="78" y="48" width="44" height="400" rx="6"/></clipPath>
          </defs>
          <ellipse cx="100" cy="492" rx="30" ry="6" fill="rgba(0,0,0,0.28)"/>
          <rect x="74" y="44" width="52" height="410" rx="10" fill="url(#${uid}-glass)" stroke="#c5ced6" stroke-width="1.6"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          <rect x="74" y="44" width="52" height="410" rx="10" fill="#fff" fill-opacity="0.12" stroke="#dbe3ea"/>
          ${ticks}
          <ellipse cx="100" cy="40" rx="32" ry="9" fill="#f7fafc" stroke="#c8d0d7" stroke-width="2"/>
        </svg>
      `;
    }

    _svgFence(inches, maxIn) {
      const yTop = 78;
      const yBot = 355;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      let ticks = "";
      for (let v = 1; v <= maxIn + 0.001; v += 0.5) {
        const y = yAt(v);
        const major = Number.isInteger(v);
        ticks += `<line x1="78" y1="${y.toFixed(2)}" x2="${major ? 128 : 118}" y2="${y.toFixed(2)}" stroke="#333" stroke-width="${major ? 1.6 : 1}"/>`;
        if (major) {
          ticks += `<text x="74" y="${(y + 6).toFixed(2)}" text-anchor="end" font-size="18" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#222">${v}</text>`;
        }
      }
      const water =
        fill > 0
          ? `<rect x="70" y="${yWater.toFixed(2)}" width="68" height="${(waterH + 16).toFixed(2)}" fill="url(#${uid}-water)"/>`
          : "";
      return `
        <svg viewBox="0 0 210 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#d9e2ea"/>
              <stop offset="50%" stop-color="#ffffff"/>
              <stop offset="100%" stop-color="#c5d0da"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#0a5c96"/>
              <stop offset="100%" stop-color="#7ed0ff"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><rect x="68" y="58" width="72" height="310" rx="10"/></clipPath>
          </defs>
          <rect x="62" y="52" width="84" height="322" rx="14" fill="url(#${uid}-glass)" stroke="#b7c2cc" stroke-width="1.6"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          ${ticks}
          <path d="M58 48 H150 C158 48 162 58 150 70 H58 C46 58 50 48 58 48Z" fill="#2a9aa8" stroke="#1e7d88"/>
          <rect x="68" y="${(yWater - 2).toFixed(2)}" width="72" height="5" rx="1.5" fill="#d23b3b" stroke="#b81e1e" stroke-width="0.6"/>
        </svg>
      `;
    }

    _svgGarden(inches, maxIn) {
      const yTop = 70;
      const yBot = 400;
      const { fill, yWater, waterH } = this._waterFill(inches, maxIn, yTop, yBot);
      const uid = this._uid();
      const yAt = (v) => yBot - (v / maxIn) * (yBot - yTop);
      let ticks = "";
      for (let v = 1; v <= maxIn + 0.001; v++) {
        const y = yAt(v);
        ticks += `<line x1="70" y1="${y.toFixed(2)}" x2="110" y2="${y.toFixed(2)}" stroke="#111" stroke-width="1.1"/>`;
        ticks += `<text x="90" y="${(y + 7).toFixed(2)}" text-anchor="middle" font-size="18" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="#111">${v}</text>`;
      }
      const water =
        fill > 0
          ? `<rect x="70" y="${yWater.toFixed(2)}" width="40" height="${(waterH + 18).toFixed(2)}" fill="url(#${uid}-water)"/>`
          : "";
      return `
        <svg viewBox="0 0 240 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#b7c0c8" stop-opacity="0.4"/>
              <stop offset="35%" stop-color="#ffffff" stop-opacity="0.9"/>
              <stop offset="100%" stop-color="#9aa4ae" stop-opacity="0.4"/>
            </linearGradient>
            <linearGradient id="${uid}-water" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#1280d0"/>
              <stop offset="100%" stop-color="#6fd0ff"/>
            </linearGradient>
            <clipPath id="${uid}-clip"><rect x="70" y="52" width="40" height="360" rx="8"/></clipPath>
          </defs>
          <ellipse cx="90" cy="505" rx="40" ry="7" fill="rgba(0,0,0,0.28)"/>
          <path d="M86 430 L94 430 L94 508 L86 508 Z" fill="#6b7280"/>
          <path d="M128 250 C128 190, 160 150, 200 168 C218 130, 236 168, 222 198 C248 220, 220 280, 186 250 C170 300, 130 300, 128 250 Z" fill="none" stroke="#9ca3af" stroke-width="7" stroke-linecap="round"/>
          <path d="M196 176 C214 146, 242 164, 228 190 C252 198, 236 232, 210 214 C200 230, 180 200, 196 176 Z" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>
          <circle cx="220" cy="174" r="2.6" fill="#111"/>
          <rect x="66" y="48" width="48" height="372" rx="12" fill="url(#${uid}-glass)" stroke="#c5ced6" stroke-width="1.6"/>
          <g clip-path="url(#${uid}-clip)">${water}</g>
          ${ticks}
          <ellipse cx="90" cy="44" rx="30" ry="8" fill="#f7fafc" stroke="#c8d0d7" stroke-width="2"/>
        </svg>
      `;
    }

    static get styles() {
      return css`
        :host {
          display: block;
        }
        :host([data-size="75"]) {
          zoom: 0.75;
        }
        :host([data-size="50"]) {
          zoom: 0.5;
        }
        ha-card {
          overflow: hidden;
          background: var(--card-background-color, var(--ha-card-background));
        }
        .wrap {
          padding: 12px 14px 14px;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .setup {
          min-height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--secondary-text-color);
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          margin-bottom: 8px;
        }
        .title {
          border: 0;
          background: none;
          padding: 0;
          font-size: 1.05rem;
          font-weight: 650;
          color: var(--primary-text-color);
          cursor: pointer;
          text-align: left;
        }
        .badge {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 3px 8px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .badge.wet {
          color: #dff6ff;
          background: #0b6aa2;
        }
        .badge.dry {
          color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
        }
        .badge.warn {
          color: #3b1d00;
          background: #f8c15c;
        }
        .body {
          display: grid;
          grid-template-columns: minmax(132px, 0.9fr) minmax(220px, 1.2fr);
          gap: 10px 16px;
          align-items: stretch;
          flex: 1;
          min-height: 0;
        }
        .gauge-col {
          display: flex;
          justify-content: center;
          align-items: stretch;
        }
        .gauge {
          position: relative;
          width: 100%;
          max-width: 180px;
        }
        .gauge.look-wedge,
        .gauge.look-cone,
        .gauge.look-garden {
          max-width: 214px;
        }
        .gauge.look-fence {
          max-width: 200px;
        }
        .gauge-svg,
        .gauge-svg svg {
          width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.28));
        }
        .drops {
          position: absolute;
          left: 34%;
          right: 34%;
          top: 0;
          height: 18%;
          pointer-events: none;
          overflow: hidden;
        }
        .drop {
          position: absolute;
          top: -8px;
          width: 5px;
          height: 10px;
          border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
          background: #7ecfff;
          opacity: 0.85;
          animation: fall 1.1s linear infinite;
        }
        .d0 { left: 12%; animation-delay: 0s; }
        .d1 { left: 32%; animation-delay: 0.22s; }
        .d2 { left: 50%; animation-delay: 0.45s; }
        .d3 { left: 68%; animation-delay: 0.18s; }
        .d4 { left: 82%; animation-delay: 0.7s; }
        .info-col {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
        }
        .tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          flex: 0 0 auto;
        }
        .tile {
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.04));
          color: var(--primary-text-color);
          border-radius: 12px;
          padding: 12px 12px 11px;
          text-align: left;
          cursor: pointer;
        }
        .tile-k {
          display: block;
          font-size: 0.72rem;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 650;
        }
        .tile-v {
          display: block;
          margin-top: 4px;
          font-size: 1.35rem;
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          flex: 0 0 auto;
        }
        .stat {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.04));
          border-radius: 12px;
          padding: 10px 10px 9px;
        }
        .stat-k {
          font-size: 0.7rem;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 650;
        }
        .stat-v {
          font-size: 0.98rem;
          font-weight: 650;
        }
        .hist {
          margin-top: 0;
          min-width: 0;
          min-height: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .hist-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .hist-title {
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--secondary-text-color);
        }
        .pills {
          display: flex;
          gap: 4px;
        }
        .pill {
          border: 0;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
          color: var(--secondary-text-color);
          font-size: 0.72rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .pill.on {
          background: #0b6aa2;
          color: #fff;
        }
        .chart {
          display: flex;
          align-items: stretch;
          gap: 3px;
          flex: 1;
          min-height: 148px;
          height: auto;
          padding: 6px 0 0;
        }
        .bar-col {
          flex: 1;
          min-width: 0;
          border: 0;
          background: none;
          padding: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          cursor: pointer;
          height: 100%;
        }
        .bar {
          width: 70%;
          max-width: 14px;
          border-radius: 4px 4px 2px 2px;
          background: rgba(127, 199, 255, 0.28);
          display: block;
        }
        .bar-col.wet .bar {
          background: linear-gradient(180deg, #7ecfff 0%, #1a8fd4 100%);
        }
        .bar-col.sel .bar {
          outline: 2px solid #e8f7ff;
          outline-offset: 1px;
        }
        .bar-l {
          margin-top: 4px;
          font-size: 0.62rem;
          color: var(--secondary-text-color);
          line-height: 1;
          min-height: 0.7rem;
          white-space: nowrap;
        }
        .chart.dense {
          gap: 2px;
        }
        .chart.dense .bar {
          width: 90%;
          max-width: 10px;
        }
        .hist-foot {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-top: 6px;
          font-size: 0.78rem;
          color: var(--secondary-text-color);
        }
        .hist-err {
          margin-top: 4px;
          font-size: 0.75rem;
          color: var(--error-color, #f87171);
        }
        @media (max-width: 520px) {
          .body {
            grid-template-columns: 1fr;
          }
          .gauge {
            max-width: 170px;
            margin: 0 auto;
          }
          .chart {
            min-height: 110px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .drop {
            animation: none;
            display: none;
          }
        }
        @keyframes fall {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          15% {
            opacity: 0.9;
          }
          100% {
            transform: translateY(28px);
            opacity: 0;
          }
        }
      `;
    }
  }

  function stClass(hass, id) {
    return hass?.states?.[id]?.attributes?.device_class || "";
  }

  class RainGaugePlusCardEditor extends LitElement {
    static get properties() {
      return { hass: {}, config: {} };
    }

    setConfig(config) {
      this.config = mergeConfig(config || {});
    }

    _valueChanged(ev) {
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
        })
      );
    }

    render() {
      if (!this.hass) return html``;
      const merged = mergeConfig(this.config || {});
      return html`
        <ha-form
          .hass=${this.hass}
          .data=${merged}
          .schema=${[
            { name: "name", selector: { text: {} } },
            {
              name: "look",
              selector: {
                select: {
                  mode: "dropdown",
                  options: Object.keys(LOOKS).map((value) => ({
                    value,
                    label: LOOKS[value].label,
                  })),
                },
              },
            },
            {
              name: "size",
              selector: {
                select: {
                  mode: "dropdown",
                  options: [
                    { value: "100", label: "Full (100%)" },
                    { value: "75", label: "75%" },
                    { value: "50", label: "50%" },
                  ],
                },
              },
            },
            {
              name: "entity",
              selector: {
                entity: {
                  domain: "sensor",
                  device_class: "precipitation",
                },
              },
            },
            {
              name: "hourly_rate_entity",
              selector: { entity: { domain: "sensor" } },
            },
            {
              name: "max_level",
              selector: {
                number: { min: 0.5, max: 50, step: 0.5, mode: "box" },
              },
            },
            {
              name: "unit_system",
              selector: {
                select: {
                  options: [
                    { value: "auto", label: "Auto (from sensor)" },
                    { value: "imperial", label: "Inches" },
                    { value: "metric", label: "Millimeters" },
                  ],
                },
              },
            },
            {
              name: "history_days",
              selector: {
                select: {
                  mode: "dropdown",
                  options: [
                    { value: "7", label: "7 days" },
                    { value: "14", label: "14 days" },
                    { value: "30", label: "30 days" },
                  ],
                },
              },
            },
            { name: "show_history", selector: { boolean: {} } },
            { name: "show_yesterday", selector: { boolean: {} } },
            { name: "show_rate", selector: { boolean: {} } },
          ]}
          .computeLabel=${(s) =>
            ({
              name: "Card title",
              look: "Gauge look",
              size: "Card size",
              entity: "Rain total (today / accumulating)",
              hourly_rate_entity: "Rain rate (optional)",
              max_level: "Gauge max (classic tube only)",
              unit_system: "Display units",
              history_days: "Default history range",
              show_history: "Show daily history",
              show_yesterday: "Show yesterday",
              show_rate: "Show rain rate",
            })[s.name] || s.name}
          @value-changed=${this._valueChanged}
        ></ha-form>
      `;
    }
  }

  customElements.define("rain-gauge-plus-card", RainGaugePlusCard);
  customElements.define("rain-gauge-plus-card-editor", RainGaugePlusCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "rain-gauge-plus-card",
    name: "Rain Gauge Plus",
    description:
      "Realistic rain gauge with last 12/24 hours and daily history",
    preview: true,
    documentationURL: "https://github.com/randrcomputers/ha-rain-gauge-card#readme",
  });
})();
