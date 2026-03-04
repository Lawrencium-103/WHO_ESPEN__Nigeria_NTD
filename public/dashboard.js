'use strict';
// ================================================================
//  WHO ESPEN Nigeria SCH Intelligence Platform · dashboard.js v4
// ================================================================

let G = {};
let charts = {};
let mapMode = 'burden';
let lgaLayer = null, nationalLayer = null, map;

// ─── BOOT ───────────────────────────────────────────────────────
async function boot() {
    try {
        const [dataRes, trendRes] = await Promise.all([
            fetch('/api/data'),
            fetch('/api/trend?state=National')
        ]);
        G.base = await dataRes.json();
        G.trendNational = await trendRes.json();
        G.currentYear = G.base.meta.years[0];
        G.currentState = 'National';

        populateFilters();
        setupNav();
        initMap();
        await refreshAll();

        document.getElementById('scopeMeta').textContent =
            `${G.base.meta.years.length} yrs · ${G.base.meta.states.length} states · ${G.base.meta.totalLGAs.toLocaleString()} LGAs`;
        document.getElementById('nb-lga').textContent = G.base.meta.totalLGAs.toLocaleString();

    } catch (e) {
        console.error('Boot failed:', e);
        alert('Could not connect to server on port 3001.');
    }
}

// ─── FILTERS ────────────────────────────────────────────────────
function populateFilters() {
    const sSel = document.getElementById('stateSel');
    G.base.meta.states.forEach(s => sSel.appendChild(new Option(s, s)));

    sSel.addEventListener('change', async () => {
        G.currentState = sSel.value;
        G.trendState = G.currentState !== 'National'
            ? await (await fetch(`/api/trend?state=${encodeURIComponent(G.currentState)}`)).json()
            : null;
        await refreshAll();
        if (G.currentState === 'National') drillBack(false);
        else drillMap(G.currentState);
    });

    // Multi-select for years
    const msWrap = document.getElementById('yearMultiSelect');
    const msText = document.getElementById('yearSelText');
    const msScroll = document.getElementById('yearCheckboxes');
    const checkAll = document.getElementById('checkAllYears');
    let yearBoxes = [];

    // Dropdown toggle
    msText.addEventListener('click', e => { e.stopPropagation(); msWrap.classList.toggle('open'); });
    document.addEventListener('click', async e => {
        if (!msWrap.contains(e.target)) {
            const wasOpen = msWrap.classList.contains('open');
            msWrap.classList.remove('open');
            if (wasOpen) {
                // "if none is selected all year should be checked"
                const checkedCount = yearBoxes.filter(b => b.checked).length;
                if (checkedCount === 0) {
                    checkAll.checked = true;
                    yearBoxes.forEach(b => b.checked = true);
                    await updateYearSelection();
                }
            }
        }
    });

    // Populate year checkboxes
    G.base.meta.years.forEach(y => {
        const lbl = document.createElement('label'); lbl.className = 'multi-opt';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = y;
        cb.checked = true; // default all checked
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + y));
        msScroll.appendChild(lbl);
        yearBoxes.push(cb);

        cb.addEventListener('change', () => {
            const checkedCount = yearBoxes.filter(b => b.checked).length;
            if (checkedCount === yearBoxes.length) checkAll.checked = true;
            else checkAll.checked = false; // "if we check a single yerar all year must uncheck"
            updateYearSelection();
        });
    });

    checkAll.addEventListener('change', () => {
        // "when we select all, all other years are selected"
        yearBoxes.forEach(b => b.checked = checkAll.checked);
        updateYearSelection();
    });

    // Initialize
    checkAll.checked = true;
    G.currentYear = 'All';

    async function updateYearSelection() {
        const checkedVals = yearBoxes.filter(b => b.checked).map(b => b.value);
        if (checkAll.checked || checkedVals.length === yearBoxes.length) {
            checkAll.checked = true;
            msText.textContent = 'All Years (2014–2024)';
            G.currentYear = 'All';
        } else if (checkedVals.length === 0) {
            msText.textContent = 'None Selected (Click outside to revert)';
            G.currentYear = G.base.meta.years[0]; // Temporary fallback to safely show something
        } else {
            msText.textContent = checkedVals.length === 1 ? checkedVals[0] : `${checkedVals.length} Years Selected`;
            G.currentYear = checkedVals.join(',');
        }
        await refreshAll();
    }
}

// ─── REFRESH ────────────────────────────────────────────────────
async function refreshAll() {
    const yearParam = G.currentYear === 'All' ? 'All' : G.currentYear;
    const [statsRes, lgaRes] = await Promise.all([
        fetch(`/api/stats?year=${yearParam}&state=${encodeURIComponent(G.currentState)}`),
        fetch(`/api/lga-table?year=${yearParam}&state=${encodeURIComponent(G.currentState)}`)
    ]);
    G.stats = (await statsRes.json()).data;
    G.lgaRows = await lgaRes.json();

    rebuildMapCache();

    // For logistics KPIs, aggregate across selected years
    const yrs = G.currentYear === 'All' ? G.base.meta.years : String(G.currentYear).split(',').map(y => parseInt(y.trim()));

    // Aggregated logistics object
    const logYear = {
        totalPOs: 0,
        totalQuantityM: 0,
        avgDispatchLag: 0,
        avgTransitTime: 0,
        avgLastMile: 0,
        avgArrivalDelay: 0,
        avgMdaDelay: 0,
        records: [],
        drugBreakdown: {}
    };

    let lagSum = 0, lagCount = 0;
    let transitSum = 0, transitCount = 0;
    let lastSum = 0, lastCount = 0;
    let arrivalSum = 0, arrivalCount = 0;
    let mdaSum = 0, mdaCount = 0;

    yrs.forEach(y => {
        const yrData = G.base.logByYear[y];
        if (!yrData) return;

        logYear.totalPOs += yrData.totalPOs || 0;
        logYear.totalQuantityM += yrData.totalQuantityM || 0;
        logYear.records = logYear.records.concat(yrData.records || []);

        Object.entries(yrData.drugBreakdown || {}).forEach(([drug, qty]) => {
            logYear.drugBreakdown[drug] = (logYear.drugBreakdown[drug] || 0) + qty;
        });

        yrData.records.forEach(r => {
            if (r.dispatchLag != null) { lagSum += r.dispatchLag; lagCount++; }
            if (r.transitTime != null) { transitSum += r.transitTime; transitCount++; }
            if (r.lastMileTime != null) { lastSum += r.lastMileTime; lastCount++; }
            if (r.arrivalDelay != null) { arrivalSum += r.arrivalDelay; arrivalCount++; }
            if (r.mdaDelay != null) { mdaSum += r.mdaDelay; mdaCount++; }
        });
    });

    const getAvg = (sum, count) => count > 0 ? parseFloat((sum / count).toFixed(1)) : null;
    logYear.avgDispatchLag = getAvg(lagSum, lagCount);
    logYear.avgTransitTime = getAvg(transitSum, transitCount);
    logYear.avgLastMile = getAvg(lastSum, lastCount);
    logYear.avgArrivalDelay = getAvg(arrivalSum, arrivalCount);
    logYear.avgMdaDelay = getAvg(mdaSum, mdaCount);

    updateEpiKPIs(G.stats);
    updateCoverageKPIs(G.stats);
    updateLogisticsKPIs(logYear);
    renderEndemicityChart(G.stats);
    renderCoverageChart();
    renderTreatmentTrendChart();
    renderBurdenGapChart();
    renderStateRankChart();
    renderLogisticsChart();
    renderShipmentPipelineChart(logYear);
    renderDrugBreakdownChart(logYear);
    renderScatterChart();
    renderBottleneckChart();
    buildEpiTable(G.lgaRows);
    buildCovTable();
    buildLogTable(G.base.logByYear);
    renderDecisionPage();
    refreshCorrelation(); // Update advanced analytics
    updateMapLayerStyles();
    updateContextTag();
}

function updateContextTag() {
    const el = document.getElementById('activeCtx');
    let yrLabel = 'All Years';
    if (G.currentYear !== 'All') {
        const p = String(G.currentYear).split(',');
        yrLabel = p.length === 1 ? p[0] : `${p.length} Years (${p[p.length - 1]}–${p[0]})`;
    }
    if (el) el.textContent = `${G.currentState === 'National' ? '🇳🇬 Nigeria' : '📍 ' + G.currentState} · ${yrLabel}`;
}

// ─── NAVIGATION ─────────────────────────────────────────────────
function setupNav() {
    const META = {
        epi: { title: 'Epidemiological Profile', hint: 'Disease burden, endemicity & MDA delivery across Nigeria' },
        coverage: { title: 'Programme Coverage', hint: 'Preventive Chemotherapy reach and annual programme performance' },
        logistics: { title: 'Logistics & Supply Intelligence', hint: 'Drug supply chain metrics and correlation with coverage outcomes' },
        decision: { title: 'Action Intelligence Engine', hint: 'Data-driven priority recommendations from epidemiological & supply chain analysis' }
    };
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const page = link.dataset.page;
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`page-${page}`).classList.add('active');
            document.getElementById('pageBreadcrumb').textContent = META[page].title;
            document.getElementById('dataHint').textContent = META[page].hint;
            if (page === 'epi') setTimeout(() => map?.invalidateSize(), 120);
            if (page === 'decision') refreshCorrelation();
        });
    });
}

// ─── KPIs ───────────────────────────────────────────────────────
const fmt = n => { if (n == null || isNaN(n)) return '—'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toLocaleString(); };

function updateEpiKPIs(s) {
    set('kv-iu', s.iuCount?.toLocaleString() || '—');
    set('kv-endemic-iu', s.endemicIUs?.toLocaleString() || '—');
    set('kv-burden', fmt(s.burden));
    set('kv-high', s.highEndemicity?.toLocaleString() || '0');
    set('kv-mod', s.moderateEndemicity?.toLocaleString() || '0');
    set('kv-states', s.states?.toLocaleString() || '—');
    set('ks-iu', G.currentState === 'National' ? 'Across all states' : G.currentState + ' State LGAs');
}
function updateCoverageKPIs(s) {
    set('kv-cov-pct', s.coverage != null ? s.coverage.toFixed(1) + '%' : '—');
    set('kv-cov-treated', fmt(s.treated));
    set('kv-cov-targeted', fmt(s.targeted));
    set('kv-cov-mda', s.mdaImplemented?.toLocaleString() || '—');
}
function updateLogisticsKPIs(log) {
    set('kv-po-count', log.totalPOs?.toLocaleString() || '0');
    set('kv-qty', log.totalQuantityM != null ? log.totalQuantityM.toFixed(1) + 'M tabs' : '—');
    set('kv-dlag', log.avgDispatchLag != null ? log.avgDispatchLag + 'd' : '—');
    set('kv-transit', log.avgTransitTime != null ? log.avgTransitTime + 'd' : '—');
    set('kv-lastmile', log.avgLastMile != null ? log.avgLastMile + 'd' : '—');
    set('kv-arrival-delay', log.avgArrivalDelay != null ? log.avgArrivalDelay + 'd' : '—');
    set('kv-mdadelay', log.avgMdaDelay != null ? log.avgMdaDelay + 'd' : '—');
}
function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ─── MAP ────────────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: false }).setView([9.08, 8.67], 6);
    const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    // Wash out other countries: filter the tile layer so Nigeria's overlay pops
    tiles.getContainer().style.filter = 'grayscale(100%) opacity(0.4)';

    nationalLayer = L.geoJSON(G.base.geoJson, {
        style: featureStyle,
        onEachFeature: bindFeature
    }).addTo(map);
    buildLegend();

    // Add Home Button
    const homeControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            btn.innerHTML = `<a href="#" title="Reset to National View" style="font-size:14px; display:flex; align-items:center; justify-content:center; width:30px; height:30px; color:#333; text-decoration:none;"><i class="fa-solid fa-house"></i></a>`;
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                drillBack(true);
            };
            return btn;
        }
    });
    map.addControl(new homeControl());

    // Center map consistently
    setTimeout(() => map.fitBounds(nationalLayer.getBounds(), { padding: [20, 20] }), 100);
}

// Build map cache from current G.lgaRows (called before styling)
function rebuildMapCache() {
    window._mapCache = {};
    (G.lgaRows || []).forEach(r => {
        if (!window._mapCache[r.state]) window._mapCache[r.state] = {};
        window._mapCache[r.state][r.lga] = { burden: r.burden, coverage: r.coverage };
    });
}

function featureStyle(f) {
    const c = window._mapCache?.[f.properties.state]?.[f.properties.lga];
    const val = c ? (mapMode === 'burden' ? c.burden : c.coverage) : 0;
    return { fillColor: mapMode === 'burden' ? burdenColor(val) : coverageColor(val), fillOpacity: 0.78, weight: 0.7, color: '#fff', opacity: 1 };
}

function setMapMode(mode) {
    mapMode = mode;
    document.getElementById('mapColorBurden').classList.toggle('active', mode === 'burden');
    document.getElementById('mapColorCoverage').classList.toggle('active', mode === 'coverage');
    buildLegend();
    updateMapLayerStyles();
}

function updateMapLayerStyles() {
    if (nationalLayer) nationalLayer.setStyle(featureStyle);
    if (lgaLayer) lgaLayer.setStyle(featureStyle);
}

function burdenColor(v) {
    if (!v) return '#e2e8f0';
    if (v >= 500000) return '#7f1d1d'; if (v >= 200000) return '#dc2626';
    if (v >= 100000) return '#f97316'; if (v >= 50000) return '#fbbf24';
    return '#fef9c3';
}
function coverageColor(v) {
    if (!v) return '#e2e8f0';
    if (v >= 80) return '#166534'; if (v >= 60) return '#22c55e';
    if (v >= 40) return '#86efac'; if (v >= 20) return '#fbbf24';
    return '#ef4444';
}

function bindFeature(feature, layer) {
    layer.on({
        mouseover: e => {
            e.target.setStyle({ weight: 2.5, color: '#263371', fillOpacity: 0.93 });
            showPopup(feature, layer);
        },
        mouseout: e => {
            // Reset to current layer's default style
            if (lgaLayer && lgaLayer.hasLayer(e.target)) lgaLayer.resetStyle(e.target);
            else if (nationalLayer) nationalLayer.resetStyle(e.target);

            e.target.closeTooltip();
            e.target.unbindTooltip();
        },
        click: async () => {
            const state = feature.properties.state;
            if (G.currentState === state) return; // already drilled
            document.getElementById('stateSel').value = state;
            G.currentState = state;
            e.target.closeTooltip();
            G.trendState = await (await fetch(`/api/trend?state=${encodeURIComponent(state)}`)).json();
            await refreshAll();
            drillMap(state); // called after refreshAll so cache is ready
        }
    });
}

function showPopup(feature, layer) {
    const { state, lga } = feature.properties;
    const r = (G.lgaRows || []).find(x => x.state === state && x.lga === lga) || {};
    const cov = r.coverage || 0;
    const covColor = cov >= 80 ? '#4ade80' : cov >= 60 ? '#86efac' : cov >= 40 ? '#fbbf24' : cov >= 20 ? '#f97316' : '#f87171';

    const html = `
        <div class="popup-box">
            <div class="popup-title">${lga}</div>
            <div class="popup-state">${state} State &middot; ${G.currentYear === 'All' ? 'All Years' : G.currentYear}</div>
            <div class="popup-row"><span>Population at Risk</span><strong>${(r.burden || 0).toLocaleString()}</strong></div>
            <div class="popup-row"><span>Population Treated</span><strong>${(r.treated || 0).toLocaleString()}</strong></div>
            <div class="popup-row"><span>PC Coverage</span><strong style="color:${covColor}">${cov}%</strong></div>
            <div class="popup-row"><span>MDA Status</span><strong>${r.mda || 'Not Reported'}</strong></div>
            <div class="popup-row" style="border:none"><span>Endemicity</span>
                <span class="popup-endemic ${r.endemicity || 'Unknown'}">${r.endemicityRaw || 'Unknown'}</span></div>
        </div>`;

    layer.bindTooltip(html, { direction: 'top', sticky: false, className: 'hover-tooltip', opacity: 1 }).openTooltip();
}

// Drill into state — show only that state's LGAs as a new layer
function drillMap(state) {
    if (!state || state === 'National') { drillBack(true); return; }
    const feats = G.base.geoJson.features.filter(f => f.properties.state === state);
    if (!feats.length) return;

    // Hide national layer, show LGA layer
    if (nationalLayer) map.removeLayer(nationalLayer);
    if (lgaLayer) map.removeLayer(lgaLayer);

    lgaLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
        style: featureStyle,
        onEachFeature: bindFeature
    }).addTo(map);

    map.fitBounds(lgaLayer.getBounds(), { padding: [30, 30] });
    document.getElementById('backToNational').style.display = 'inline-flex';
}

function drillBack(doRefresh = true) {
    if (lgaLayer) { map.removeLayer(lgaLayer); lgaLayer = null; }
    if (nationalLayer) { map.removeLayer(nationalLayer); }
    nationalLayer = L.geoJSON(G.base.geoJson, { style: featureStyle, onEachFeature: bindFeature }).addTo(map);

    // Always perfectly center Nigeria
    map.fitBounds(nationalLayer.getBounds(), { padding: [20, 20] });
    document.getElementById('backToNational').style.display = 'none';

    if (doRefresh) {
        G.currentState = 'National'; G.trendState = null;
        document.getElementById('stateSel').value = 'National';
        refreshAll();
    }
}

function buildLegend() {
    const el = document.getElementById('mapLegend');
    if (!el) return;
    el.innerHTML = mapMode === 'burden'
        ? `<b>Population at Risk:</b>
           <span class="legend-item"><span class="legend-dot" style="background:#fef9c3"></span>&lt;50K</span>
           <span class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span>50–100K</span>
           <span class="legend-item"><span class="legend-dot" style="background:#f97316"></span>100–200K</span>
           <span class="legend-item"><span class="legend-dot" style="background:#dc2626"></span>200–500K</span>
           <span class="legend-item"><span class="legend-dot" style="background:#7f1d1d"></span>500K+</span>`
        : `<b>PC Coverage:</b>
           <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>0–20%</span>
           <span class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span>20–40%</span>
           <span class="legend-item"><span class="legend-dot" style="background:#86efac"></span>40–60%</span>
           <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>60–80%</span>
           <span class="legend-item"><span class="legend-dot" style="background:#166534"></span>80%+</span>`;
}

// ─── CHARTS ─────────────────────────────────────────────────────
const T = { font: { family: 'Inter', size: 11 } };
const G2 = { color: '#f1f5f9' };

function mkChart(id, type, data, opts) {
    if (charts[id]) charts[id].destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;
    charts[id] = new Chart(canvas.getContext('2d'), { type, data, options: { responsive: true, maintainAspectRatio: true, ...opts } });
}

// Epi: Endemicity doughnut
function renderEndemicityChart(s) {
    mkChart('endemicityChart', 'doughnut', {
        labels: ['High (≥50%)', 'Moderate (10–49%)', 'Low (<10%)', 'Non-endemic'],
        datasets: [{
            data: [s.highEndemicity || 0, s.moderateEndemicity || 0, s.lowEndemicity || 0, s.noneEndemicity || 0],
            backgroundColor: ['#ef4444', '#f59e0b', '#0d9488', '#94a3b8'], borderWidth: 3, borderColor: '#fff'
        }]
    }, { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { ...T, padding: 12, boxWidth: 12 } } } });
}

// Coverage: dual-axis line trend (PC Coverage History)
function renderCoverageChart() {
    const trend = G.trendState || G.trendNational;
    const labels = trend.map(t => t.year);
    mkChart('coverageChart', 'line', {
        labels,
        datasets: [
            {
                label: 'PC Coverage %', data: trend.map(t => t.coverage),
                borderColor: '#009EDB', backgroundColor: 'rgba(0,158,219,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#009EDB'
            },
            {
                label: 'High Endemicity IUs', data: trend.map(t => t.highEndemicity),
                borderColor: '#ef4444', borderDash: [5, 3], tension: 0.3, yAxisID: 'y1', pointRadius: 4, pointBackgroundColor: '#ef4444', backgroundColor: 'transparent'
            }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { grid: { display: false }, ticks: T },
            y: { grid: G2, ticks: T, title: { display: true, text: 'Coverage %', font: { family: 'Inter', size: 11 }, color: '#009EDB' } },
            y1: { position: 'right', grid: { display: false }, ticks: T, title: { display: true, text: 'High End. IUs', font: { family: 'Inter', size: 11 }, color: '#ef4444' } }
        },
        plugins: { legend: { display: true, position: 'top', labels: { ...T, boxWidth: 14 } } }
    });
}

// New: Treatment vs Coverage Trend
function renderTreatmentTrendChart() {
    const trend = G.trendState || G.trendNational;
    const labels = trend.map(t => t.year);
    mkChart('treatmentTrendChart', 'bar', {
        labels,
        datasets: [
            {
                label: 'Population Treated',
                data: trend.map(t => t.treated),
                backgroundColor: 'rgba(34, 197, 94, 0.7)',
                borderRadius: 4,
                yAxisID: 'y'
            },
            {
                label: 'PC Coverage %',
                data: trend.map(t => t.coverage),
                type: 'line',
                borderColor: '#009EDB',
                borderWidth: 3,
                pointRadius: 4,
                yAxisID: 'y1',
                tension: 0.4
            }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            y: { ticks: { callback: v => (v / 1e6).toFixed(1) + 'M' }, title: { display: true, text: 'Treatment (Millions)' } },
            y1: { position: 'right', max: 100, min: 0, title: { display: true, text: 'Coverage %' } },
            x: { grid: { display: false } }
        },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, ...T } } }
    });
}

// New: Treated vs Requiring PC (Burden Gap)
function renderBurdenGapChart() {
    const trend = G.trendState || G.trendNational;
    const labels = trend.map(t => t.year);
    mkChart('burdenGapChart', 'bar', {
        labels,
        datasets: [
            {
                label: 'Requiring PC',
                data: trend.map(t => t.burden),
                backgroundColor: 'rgba(30, 58, 138, 0.2)',
                borderColor: '#1e3a8a',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Actual Treated',
                data: trend.map(t => t.treated),
                backgroundColor: '#22c55e',
                borderRadius: 4
            }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            y: { ticks: { callback: v => (v / 1e6).toFixed(1) + 'M' }, title: { display: true, text: 'Population (Millions)' } },
            x: { grid: { display: false } }
        },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, ...T } } }
    });
}

// Coverage: ALL 37 states ranked horizontal bar — scrollable
async function renderStateRankChart() {
    const allRows = G.lgaRows.length > 0 ? G.lgaRows
        : await (await fetch(`/api/lga-table?year=${G.currentYear}&state=National`)).json();
    const byState = {};
    allRows.forEach(r => {
        if (!byState[r.state]) byState[r.state] = { b: 0, t: 0 };
        byState[r.state].b += r.burden || 0;
        byState[r.state].t += r.treated || 0;
    });
    const ranked = Object.entries(byState)
        .map(([s, d]) => ({ s, cov: d.b > 0 ? parseFloat((d.t / d.b * 100).toFixed(1)) : 0 }))
        .sort((a, b) => b.cov - a.cov);

    const h = Math.max(ranked.length * 26, 400); // dynamic height based on state count
    const canvas = document.getElementById('stateRankChart');
    if (canvas) { canvas.style.height = h + 'px'; canvas.height = h; }

    const colors = ranked.map(r => r.cov >= 80 ? '#166534' : r.cov >= 60 ? '#22c55e' : r.cov >= 40 ? '#009EDB' : r.cov >= 20 ? '#f59e0b' : '#ef4444');

    mkChart('stateRankChart', 'bar', {
        labels: ranked.map(r => r.s),
        datasets: [{ label: 'PC Coverage %', data: ranked.map(r => r.cov), backgroundColor: colors, borderRadius: 3 }]
    }, {
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
            x: { max: 100, grid: G2, ticks: T, title: { display: true, text: '% Coverage', font: { family: 'Inter', size: 11 } } },
            y: { grid: { display: false }, ticks: { ...T, font: { family: 'Inter', size: 10 } }, beginAtZero: true }
        },
        plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}% coverage` } }
        }
    });

    const sub = document.getElementById('rankSubtitle');
    if (sub) sub.textContent = `${ranked.length} states · ${G.currentYear}`;
}

// Logistics: grouped bar timeline
function renderLogisticsChart() {
    const trend = G.trendNational;
    const labels = trend.map(t => t.year);
    mkChart('logisticsChart', 'bar', {
        labels,
        datasets: [
            { label: 'Dispatch Lag (d)', data: trend.map(t => t.dispatchLag), backgroundColor: 'rgba(245,158,11,0.8)', borderRadius: 3 },
            { label: 'Transit Time (d)', data: trend.map(t => t.transitTime), backgroundColor: 'rgba(0,158,219,0.8)', borderRadius: 3 },
            { label: 'Last-Mile (d)', data: trend.map(t => t.lastMile), backgroundColor: 'rgba(13,148,136,0.8)', borderRadius: 3 },
            { label: 'MDA Delay (d)', data: trend.map(t => t.mdaDelay), backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 3 }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false }, ticks: T }, y: { grid: G2, ticks: T } },
        plugins: { legend: { display: true, position: 'top', labels: { ...T, boxWidth: 12 } } }
    });
}

// New: Shipment Pipeline by Stage (Dual Axis)
function renderShipmentPipelineChart(log) {
    const raw = log.records || [];
    const stages = ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5'];
    const counts = stages.map(s => raw.filter(r => String(r.stage).includes(s)).length);
    const qtys = stages.map(s => raw.filter(r => String(r.stage).includes(s)).reduce((a, b) => a + (b.quantity || 0), 0) / 1e6);

    mkChart('shipmentPipelineChart', 'bar', {
        labels: ['Draft/Pending', 'Approved', 'Shipped', 'Arrived', 'Delivered'],
        datasets: [
            {
                label: 'Orders', data: counts, backgroundColor: 'rgba(54, 162, 235, 0.7)',
                borderRadius: 4, yAxisID: 'y'
            },
            {
                label: 'Qty (Millions)', data: qtys, type: 'line', borderColor: '#22c55e',
                borderWidth: 3, pointRadius: 4, yAxisID: 'y1', tension: 0.3
            }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            y: { title: { display: true, text: 'Number of Orders' }, beginAtZero: true },
            y1: { position: 'right', title: { display: true, text: 'Drug Quantity (M)' }, grid: { display: false }, beginAtZero: true },
            x: { grid: { display: false } }
        },
        plugins: { legend: { position: 'top', labels: { ...T, boxWidth: 12 } } }
    });
}

// New: Drug Quantity Breakdown
function renderDrugBreakdownChart(log) {
    const bd = log.drugBreakdown || {};
    const labels = Object.keys(bd);
    const data = Object.values(bd).map(v => +(v / 1e6).toFixed(2));

    mkChart('drugBreakdownChart', 'doughnut', {
        labels,
        datasets: [{
            data,
            backgroundColor: ['#009EDB', '#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd'],
            borderWidth: 2, borderColor: '#fff'
        }]
    }, {
        cutout: '65%',
        plugins: {
            legend: { position: 'bottom', labels: { ...T, padding: 10, boxWidth: 10 } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}M tabs` } }
        }
    });
}

// Scatter: MDA Delay vs PC Coverage (all years)
function renderScatterChart() {
    const pts = G.trendNational
        .filter(t => t.mdaDelay != null && t.coverage > 0)
        .map(t => ({ x: t.mdaDelay, y: t.coverage, yr: t.year }));

    mkChart('scatterChart', 'scatter', {
        datasets: [{
            label: 'Year',
            data: pts,
            backgroundColor: pts.map(p => p.y < 30 ? '#ef4444' : p.y < 55 ? '#f59e0b' : '#009EDB'),
            pointRadius: 8, pointHoverRadius: 11
        }]
    }, {
        scales: {
            x: { grid: G2, ticks: T, title: { display: true, text: 'MDA Delay (days)', font: { family: 'Inter', size: 11 } }, min: 0 },
            y: { grid: G2, ticks: T, title: { display: true, text: 'PC Coverage (%)', font: { family: 'Inter', size: 11 } }, min: 0, max: 100 }
        },
        plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${ctx.raw.yr}: Delay=${ctx.raw.x}d · Coverage=${ctx.raw.y}%` } }
        }
    });
}

// Logistics Bottleneck Analysis (Stacked Bar)
function renderBottleneckChart() {
    const trend = G.trendNational.slice().reverse(); // Show oldest to newest
    const labels = trend.map(t => t.year);

    mkChart('bottleneckChart', 'bar', {
        labels,
        datasets: [
            { label: 'Dispatch Lag (Days)', data: trend.map(t => t.dispatchLag), backgroundColor: '#f97316' }, // Orange
            { label: 'Transit Time (Days)', data: trend.map(t => t.transitTime), backgroundColor: '#1e3a8a' }, // Navy
            { label: 'Last-Mile Time (Days)', data: trend.map(t => t.lastMile), backgroundColor: '#0d9488' } // Teal
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { stacked: true, grid: { display: false }, ticks: T },
            y: { stacked: true, grid: G2, ticks: T, title: { display: true, text: 'Total Delay (Days)', font: { family: 'Inter', size: 11 }, color: '#64748b' } }
        },
        plugins: { legend: { position: 'bottom', labels: { ...T, boxWidth: 12 } } }
    });
}

// ─── DECISION / ACTION PAGE ──────────────────────────────────────
async function renderDecisionPage() {
    // Always use national LGA data for decision page
    let all = G.currentState === 'National'
        ? G.lgaRows
        : await (await fetch(`/api/lga-table?year=${G.currentYear}&state=National`)).json();

    // State aggregates
    const by = {};
    all.forEach(r => {
        if (!by[r.state]) by[r.state] = { b: 0, t: 0, h: 0, m: 0, lo: 0, iu: 0, mda: 0 };
        by[r.state].b += r.burden || 0;
        by[r.state].t += r.treated || 0;
        by[r.state].h += r.endemicity === 'High' ? 1 : 0;
        by[r.state].m += r.endemicity === 'Moderate' ? 1 : 0;
        by[r.state].lo += r.endemicity === 'Low' ? 1 : 0;
        by[r.state].iu++;
        if (r.mda) by[r.state].mda++;
    });

    const states = Object.entries(by).map(([s, d]) => ({
        state: s, burden: d.b, treated: d.t,
        cov: d.b > 0 ? parseFloat((d.t / d.b * 100).toFixed(1)) : 0,
        highIUs: d.h, modIUs: d.m, lowIUs: d.lo, iu: d.iu, mda: d.mda
    })).sort((a, b) => b.burden - a.burden);

    const log = G.base.logByYear[G.currentYear] || {};
    const natCov = G.stats?.coverage || 0;
    const natBurd = G.stats?.burden || 0;
    const alerts = [];

    // 1. Critical coverage gap
    const critical = states.filter(s => s.cov < 30 && s.burden > 100000);
    if (critical.length) alerts.push({
        type: 'critical', icon: 'fa-triangle-exclamation',
        title: `${critical.length} Priority States Below 30% Coverage`,
        body: `<strong>${critical.slice(0, 4).map(s => s.state).join(', ')}${critical.length > 4 ? ' +' + (critical.length - 4) + ' more' : ''}</strong> have high disease burden with inadequate MDA coverage. These states require immediate programme reinforcement and additional PZQ allocation.`,
        meta: `National coverage: ${natCov.toFixed(1)}% · WHO target: ≥75%`
    });

    // 2. Logistics bottleneck
    if (log.avgMdaDelay != null) {
        if (log.avgMdaDelay > 200) alerts.push({
            type: 'critical', icon: 'fa-clock',
            title: `Severe Supply Delay: ${log.avgMdaDelay} Days Past MDA Date`,
            body: `Historical analysis confirms: when MDA delay exceeds 200 days, national coverage drops below 15%. The primary bottleneck is <strong>Last-Mile delivery (${log.avgLastMile}d)</strong>. Engage State Primary Health Care departments to pre-position drugs before MDA dates.`,
            meta: `Dispatch Lag: ${log.avgDispatchLag || '—'}d · Transit: ${log.avgTransitTime || '—'}d · Last-Mile: ${log.avgLastMile || '—'}d`
        }); else if (log.avgMdaDelay > 90) alerts.push({
            type: 'warning', icon: 'fa-clock-rotate-left',
            title: `MDA Delay of ${log.avgMdaDelay} Days Needs Attention`,
            body: `A delay above 90 days risks treatment falling outside the optimal transmission window. Prioritise pre-shipment coordination. Data shows 2019–2020 (delay ≤116d) achieved 54–59% coverage vs 5% in 2021 (delay=459d).`,
            meta: `Year ${G.currentYear} · Target: MDA Delay < 90 days`
        });
    }

    // 3. High endemicity clusters
    const totalHigh = states.reduce((a, s) => a + s.highIUs, 0);
    if (totalHigh >= 50) alerts.push({
        type: 'warning', icon: 'fa-virus-covid',
        title: `${totalHigh} High-Endemicity IUs Require Annual MDA`,
        body: `WHO guidelines mandate ≥2× annual MDA in high-endemicity LGAs (SCH ≥50%). Currently, only ${states.filter(s => s.mda > 0).length} of ${states.length} states report MDA implementation. Biannual MDA scheduling must be confirmed for all ${totalHigh} high-endemicity IUs.`,
        meta: `Moderate: ${G.stats?.moderateEndemicity || 0} IUs also require ≥1× annual MDA`
    });

    // 4. Supply quantity check
    if (log.totalQuantityM) {
        const need = parseFloat((natBurd * 2 / 1e6 * 1.1).toFixed(1));
        const surplus = parseFloat((log.totalQuantityM - need).toFixed(1));
        alerts.push({
            type: surplus > 0 ? 'info' : 'warning',
            icon: surplus > 0 ? 'fa-pills' : 'fa-triangle-exclamation',
            title: surplus > 0 ? `PZQ Supply Adequate: ${log.totalQuantityM}M Tablets` : `Potential Stock Shortfall Detected`,
            body: surplus > 0
                ? `Estimated need (2 tabs/person, 10% buffer): <strong>${need}M tablets</strong>. Delivered: ${log.totalQuantityM}M. Surplus of ~${surplus}M tabs provides buffer for additional LGAs or school-based campaigns.`
                : `Estimated need: <strong>${need}M tablets</strong> but only ${log.totalQuantityM}M delivered. A shortfall of ~${Math.abs(surplus)}M tabs may leave ${fmt(Math.abs(surplus) * 500000)} people untreated.`,
            meta: `Pop at Risk: ${fmt(natBurd)} · 2 tabs/person standard dose`
        });
    }

    // 5. Best practice
    const best = states.filter(s => s.cov >= 70).sort((a, b) => b.cov - a.cov)[0];
    if (best) alerts.push({
        type: 'success', icon: 'fa-circle-check',
        title: `Best Practice: ${best.state} — ${best.cov}% Coverage`,
        body: `${best.state} has treated <strong>${fmt(best.treated)}</strong> people (${best.cov}% of those requiring treatment). The state's logistics and community engagement model should be documented and shared across underperforming states as a scale-up blueprint.`,
        meta: `${best.burden.toLocaleString()} at risk · ${best.mda} LGAs with confirmed MDA delivery`
    });

    // 6. COVID impact observation
    const yr2021 = G.trendNational.find(t => t.year === 2021);
    const yr2020 = G.trendNational.find(t => t.year === 2020);
    if (yr2021 && yr2020 && yr2021.coverage < yr2020.coverage * 0.3) alerts.push({
        type: 'info', icon: 'fa-chart-line',
        title: 'COVID-19 Impact Quantified in Programme Data',
        body: `Coverage collapsed from <strong>${yr2020.coverage}%</strong> (2020) to <strong>${yr2021.coverage}%</strong> (2021), a reduction of ${(yr2020.coverage - yr2021.coverage).toFixed(1)} percentage points. MDA delay simultaneously rose from ${yr2020.mdaDelay}d to ${yr2021.mdaDelay}d. This validates the need for resilient supply models beyond central delivery.`,
        meta: `MDA Delay 2020: ${yr2020.mdaDelay}d vs 2021: ${yr2021.mdaDelay}d`
    });

    // Render alerts
    document.getElementById('alertGrid').innerHTML = alerts.map(a => `
        <div class="alert-card ${a.type}">
            <div class="alert-title"><i class="fa-solid ${a.icon}"></i>${a.title}</div>
            <div class="alert-body">${a.body}</div>
            <div class="alert-meta">${a.meta}</div>
        </div>`).join('');
    const critCount = alerts.filter(a => a.type === 'critical').length;
    set('nb-alerts', critCount > 0 ? String(critCount) : '—');

    // Priority chart
    const top = states.slice(0, 12);
    mkChart('priorityChart', 'bar', {
        labels: top.map(s => s.state),
        datasets: [
            { label: 'Pop at Risk (M)', data: top.map(s => +(s.burden / 1e6).toFixed(2)), backgroundColor: 'rgba(38,51,113,0.8)', borderRadius: 3, yAxisID: 'y' },
            { label: 'High End. IUs', data: top.map(s => s.highIUs), backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 3, yAxisID: 'y1' }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { grid: { display: false }, ticks: { ...T, font: { family: 'Inter', size: 10 } } },
            y: { grid: G2, ticks: T, title: { display: true, text: 'Burden (M)' } },
            y1: { position: 'right', grid: { display: false }, ticks: T, title: { display: true, text: 'High End. IUs' } }
        },
        plugins: { legend: { display: true, position: 'top', labels: { ...T, boxWidth: 12 } } }
    });

    // Gap scatter (Burden vs Coverage)
    const gpts = states.map(s => ({ x: +(s.burden / 1e6).toFixed(2), y: s.cov, label: s.state }));
    mkChart('gapChart', 'scatter', {
        datasets: [{
            label: 'State', data: gpts,
            backgroundColor: gpts.map(p => p.y < 40 && p.x > 3 ? '#ef4444' : p.y >= 60 ? '#22c55e' : '#f59e0b'),
            pointRadius: 7, pointHoverRadius: 10
        }]
    }, {
        scales: {
            x: { grid: G2, ticks: T, title: { display: true, text: 'Population at Risk (M)' } },
            y: { grid: G2, ticks: T, title: { display: true, text: 'PC Coverage (%)' }, min: 0, max: 100 }
        },
        plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${ctx.raw.label}: ${ctx.raw.x}M at risk · ${ctx.raw.y}% cov` } }
        }
    });

    // Action table
    const tbody = document.getElementById('actionTableBody');
    tbody.innerHTML = '';
    const rows = [];

    if (log.avgMdaDelay > 90) rows.push({ p: 'critical', state: '🇳🇬 NATIONAL', issue: 'Logistics Bottleneck', metric: `MDA Delay: ${log.avgMdaDelay}d · Last-Mile: ${log.avgLastMile || '—'}d`, action: 'Pre-position PZQ at state SPHCDA 60 days pre-MDA · Quarterly logistics review · Engage 3PL partners', urg: '🔴 Critical' });
    critical.forEach(s => rows.push({ p: 'critical', state: s.state, issue: 'Critical Coverage Gap', metric: `${s.cov}% cov · ${fmt(s.burden)} at risk · ${s.highIUs} High IUs`, action: 'Priority stock allocation · Deploy mobile MDA teams · Community mobilisation campaign', urg: '🔴 Critical' }));
    states.filter(s => s.highIUs > 5 && s.cov < 60).forEach(s => rows.push({ p: 'high', state: s.state, issue: 'High Endemicity – Insufficient MDA Frequency', metric: `${s.highIUs} High IUs · ${s.cov}% coverage`, action: 'Increase to 2× annual MDA for SAC · Confirm school-based distribution · Expand CHW network', urg: '🟠 High' }));
    states.filter(s => s.cov >= 40 && s.cov < 65).forEach(s => rows.push({ p: 'medium', state: s.state, issue: 'Approaching Coverage Target', metric: `${s.cov}% (target 75%) · ${s.iu} IUs`, action: 'Target missed LGAs with mop-up rounds · Use local government data to identify gaps', urg: '🔵 Medium' }));
    states.filter(s => s.cov >= 80).forEach(s => rows.push({ p: 'low', state: s.state, issue: 'Target Achieved – Sustain & Scale', metric: `${s.cov}% · ${s.mda} MDA IUs`, action: `Document ${s.state} delivery model · Share capacity-building approach with low-coverage neighbours`, urg: '✅ Sustain' }));

    rows.slice(0, 20).forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><span class="p-${r.p}">${r.p.toUpperCase()}</span></td>
            <td><strong>${r.state}</strong></td><td>${r.issue}</td>
            <td style="font-size:11px;color:var(--text-dim)">${r.metric}</td>
            <td style="font-size:11.5px;max-width:320px">${r.action}</td>
            <td style="white-space:nowrap">${r.urg}</td>`;
        tbody.appendChild(tr);
    });
}

// ─── TABLES ─────────────────────────────────────────────────────
const eb = e => { const m = { High: 'badge-high', Moderate: 'badge-mod', Low: 'badge-low' }[e] || 'badge-none'; return `<span class="${m}">${e || 'Unknown'}</span>`; };
const cb = p => `<div class="cov-bar"><div class="cov-bar-bg"><div class="cov-bar-inner" style="width:${Math.min(p, 100)}%"></div></div><span>${p}%</span></div>`;

function buildEpiTable(rows) {
    const td = document.getElementById('epiTableBody');
    td.innerHTML = '';
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.state}</td><td><strong>${r.lga}</strong></td>
            <td>${eb(r.endemicity)}</td>
            <td>${(r.burden || 0).toLocaleString()}</td>
            <td>${(r.treated || 0).toLocaleString()}</td>
            <td>${cb(r.coverage || 0)}</td>
            <td style="font-size:11px;color:var(--text-dim)">${r.mda || '—'}</td>`;
        td.appendChild(tr);
    });
    const foot = document.getElementById('epiTableFooter');
    if (foot) foot.textContent = `${rows.length.toLocaleString()} LGAs · ${G.currentState} · ${G.currentYear}`;
    set('epiTableTitle', G.currentState);
}

function buildCovTable() {
    const td = document.getElementById('covTableBody'); td.innerHTML = '';
    const by = {};
    (G.lgaRows || []).forEach(r => {
        if (!by[r.state]) by[r.state] = { b: 0, t: 0, c: 0, m: 0 };
        by[r.state].b += r.burden || 0; by[r.state].t += r.treated || 0;
        by[r.state].c++; if (r.mda) by[r.state].m++;
    });
    Object.entries(by).sort((a, b) => b[1].b - a[1].b).forEach(([s, d]) => {
        const cov = d.b > 0 ? parseFloat((d.t / d.b * 100).toFixed(1)) : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${s}</strong></td><td>${fmt(d.b)}</td><td>${fmt(d.t)}</td>
            <td>${cb(cov)}</td><td>${d.c}</td><td>${d.m}</td>`;
        td.appendChild(tr);
    });
}

function buildLogTable(logByYear) {
    const td = document.getElementById('logTableBody'); td.innerHTML = '';
    Object.entries(logByYear).sort((a, b) => b[0] - a[0]).forEach(([, obj]) => {
        obj.records.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="font-family:monospace;font-size:11px">${r.po}</td>
                <td>${r.year}</td><td>${r.drug || 'PZQ'}</td>
                <td>${r.quantity ? (r.quantity / 1e6).toFixed(2) : '—'}</td>
                <td><span class="badge-${r.stage === 'delivered' ? 'delivered' : 'shipped'}">${r.stage}</span></td>
                <td>${r.dispatchLag != null ? r.dispatchLag + 'd' : '—'}</td>
                <td>${r.transitTime != null ? r.transitTime + 'd' : '—'}</td>
                <td>${r.lastMile != null ? r.lastMile + 'd' : '—'}</td>
                <td>${r.mdaDelay != null ? r.mdaDelay + 'd' : '—'}</td>`;
            td.appendChild(tr);
        });
    });
}

// ─── TABLE UTILS ────────────────────────────────────────────────
function filterTable(id, q) {
    q = q.toLowerCase();
    document.querySelectorAll(`#${id} tbody tr`).forEach(r => {
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}
function sortTable(id, c) {
    const tbl = document.getElementById(id), tb = tbl.querySelector('tbody');
    const rows = [...tb.querySelectorAll('tr')];
    const asc = tbl.dataset.sc === String(c) && tbl.dataset.sd !== 'asc';
    tbl.dataset.sc = c; tbl.dataset.sd = asc ? 'asc' : 'desc';
    rows.sort((a, b) => {
        const A = a.cells[c]?.textContent.trim() || '', B = b.cells[c]?.textContent.trim() || '';
        const nA = parseFloat(A.replace(/[^0-9.-]/g, '')), nB = parseFloat(B.replace(/[^0-9.-]/g, ''));
        return isNaN(nA) || isNaN(nB) ? (asc ? A.localeCompare(B) : B.localeCompare(A)) : (asc ? nA - nB : nB - nA);
    });
    rows.forEach(r => tb.appendChild(r));
}
function exportCSV(id, name) {
    const tbl = document.getElementById(id);
    const csv = [...tbl.querySelectorAll('tr')].map(r =>
        [...r.querySelectorAll('th,td')].map(c => `"${c.textContent.trim().replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name}_${G.currentYear}.csv`; a.click();
}

window.addEventListener('DOMContentLoaded', boot);

// ─── ADVANCED CORRELATION ANALYTICS ────────────────────────────

/**
 * Calculates Pearson Correlation Coefficient (r)
 */
function getPearsonCorrelation(x, y) {
    if (x.length !== y.length || x.length === 0) return 0;
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
    const sumX2 = x.reduce((a, b) => a + b * b, 0);
    const sumY2 = y.reduce((a, b) => a + b * b, 0);

    const num = (n * sumXY) - (sumX * sumY);
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (den === 0) return 0;
    return num / den;
}

/**
 * Interprets the r value
 */
function interpretPearson(r) {
    const absR = Math.abs(r);
    let level = 'None', cls = 'corr-none';
    if (absR > 0.7) { level = 'Strong'; cls = r > 0 ? 'corr-strong-pos' : 'corr-strong-neg'; }
    else if (absR > 0.4) { level = 'Moderate'; cls = r > 0 ? 'corr-mod-pos' : 'corr-mod-neg'; }
    else if (absR > 0.1) { level = 'Weak'; cls = r > 0 ? 'corr-weak-pos' : 'corr-weak-neg'; }

    const direction = r > 0 ? 'Positive' : 'Negative';
    return { text: `${level} ${r === 0 ? '' : direction}`, class: cls };
}

/**
 * Main function to refresh the correlation dashboard
 */
async function refreshCorrelation() {
    const indA = document.getElementById('corrIndA').value;
    const indB = document.getElementById('corrIndB').value;

    // We use trend data for national or state Level
    const trend = G.currentState === 'National'
        ? G.trendNational
        : (G.trendState || []);

    if (!trend.length) return;

    // Map keys to data series
    const getSeries = (key) => trend.map(t => {
        if (key === 'burden') return t.burden || 0;
        if (key === 'treated') return t.treated || 0;
        if (key === 'coverage') return t.coverage || 0;
        if (key === 'mdaDelay') return t.mdaDelay || 0;
        // The trend object might not have all supply chain fields directly if it's strictly Epi
        // But for National we joined them in trendNational.
        return t[key] || 0;
    });

    const seriesA = getSeries(indA);
    const seriesB = getSeries(indB);
    const labels = trend.map(t => t.year);

    // 1. Calculate Correlation
    const r = getPearsonCorrelation(seriesA, seriesB);
    const interp = interpretPearson(r);

    const valEl = document.getElementById('pearsonVal');
    const interpEl = document.getElementById('pearsonInterpret');

    if (valEl) valEl.textContent = r.toFixed(2);
    if (interpEl) {
        interpEl.textContent = interp.text;
        interpEl.className = 'corr-interpret ' + interp.class;
    }

    // 2. Render Scatter Plot
    const scatterData = seriesA.map((v, i) => ({ x: v, y: seriesB[i], year: labels[i] }));
    const labelA = document.getElementById('corrIndA').selectedOptions[0].text;
    const labelB = document.getElementById('corrIndB').selectedOptions[0].text;

    mkChart('correlationScatterChart', 'scatter', {
        datasets: [{
            label: 'Annual Observations',
            data: scatterData,
            backgroundColor: 'rgba(0, 158, 219, 0.6)',
            borderColor: '#009EDB',
            borderWidth: 1,
            pointRadius: 6,
            pointHoverRadius: 9
        }]
    }, {
        scales: {
            x: { title: { display: true, text: labelA, font: { ...T.font, weight: 'bold' } }, ticks: T },
            y: { title: { display: true, text: labelB, font: { ...T.font, weight: 'bold' } }, ticks: T }
        }
    });

    // 3. Render Comparison Trend
    mkChart('comparisonTrendChart', 'line', {
        labels: labels,
        datasets: [
            {
                label: labelA,
                data: seriesA,
                borderColor: '#009EDB',
                backgroundColor: 'rgba(0, 158, 219, 0.1)',
                yAxisID: 'y',
                tension: 0.4,
                fill: true
            },
            {
                label: labelB,
                data: seriesB,
                borderColor: '#f43f5e',
                backgroundColor: 'transparent',
                yAxisID: 'y1',
                tension: 0.4,
                borderDash: [5, 5]
            }
        ]
    }, {
        interaction: { mode: 'index', intersect: false },
        scales: {
            y: { title: { display: true, text: labelA }, ticks: T },
            y1: {
                position: 'right',
                title: { display: true, text: labelB },
                grid: { display: false },
                ticks: T
            }
        }
    });
}
