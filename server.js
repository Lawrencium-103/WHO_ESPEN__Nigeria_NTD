const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
app.use(cors());
app.use(express.static('public'));

let DB = { geoJson: null, meta: {}, stats: {}, logistics: [], timeseries: {} };

function run() {
    console.log('\n=== WHO ESPEN Nigeria Intelligence Platform ===');
    console.log('Initializing data pipeline...\n');

    // --- 1. GEOSPATIAL ---
    const rawGeo = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ESPEN_IU_2024 (2).json'), 'utf8'));
    DB.geoJson = {
        type: 'FeatureCollection',
        features: rawGeo.features
            .filter(f => f.properties.ADMIN0 === 'Nigeria')
            .map(f => ({
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    state: (f.properties.ADMIN1 || '').trim(),
                    lga: (f.properties.IUs_NAME || '').trim(),
                    id: f.properties.IU_ID
                }
            }))
    };
    console.log(`✔ GeoJSON: ${DB.geoJson.features.length} LGA geometries loaded for Nigeria`);

    // --- 2. EPI DATA ---
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'espen_sch_data_complete.json'), 'utf8'));
    const epi = raw.filter(r => r.State && r.LGA && r.Year);

    // Normalize endemicity to short labels
    function classifyEndemicity(e) {
        if (!e) return 'Unknown';
        if (e.includes('High') || e.includes('high')) return 'High';
        if (e.includes('Moderate') || e.includes('moderate')) return 'Moderate';
        if (e.includes('Low') || e.includes('low')) return 'Low';
        if (e.includes('No') || e.includes('Non')) return 'None';
        return 'Unknown';
    }

    const years = [...new Set(epi.map(r => r.Year))].sort((a, b) => b - a);
    const states = [...new Set(epi.map(r => r.State))].sort();
    DB.meta = { years, states, totalLGAs: DB.geoJson.features.length };

    // Build stats tree: year → state → { agg + lgas }
    years.forEach(yr => {
        DB.stats[yr] = { national: null, states: {} };

        states.forEach(st => {
            const srecs = epi.filter(r => r.Year === yr && r.State === st && r['Target Population'] === 'Total');
            if (!srecs.length) return;

            const lgas = {};
            let burden = 0, targeted = 0, treated = 0, hiE = 0, modE = 0, loE = 0, noE = 0, mdaCount = 0;

            srecs.forEach(r => {
                const ec = classifyEndemicity(r['Endemicity']);
                const lgaBurden = r['Population Requiring Treatment'] || 0;
                const lgaTreated = r['Population Treated'] || 0;
                const lgaCov = lgaBurden > 0 ? (lgaTreated / lgaBurden * 100) : 0;

                lgas[r.LGA] = {
                    burden: lgaBurden,
                    targeted: r['Population Targeted'] || 0,
                    treated: lgaTreated,
                    coverage: parseFloat(lgaCov.toFixed(1)),
                    endemicity: ec,
                    endemicityRaw: r['Endemicity'] || 'Unknown',
                    mda: r['Mass Drug Administration Scheme Delivered'] || null
                };

                burden += lgaBurden;
                targeted += (r['Population Targeted'] || 0);
                treated += lgaTreated;
                if (ec === 'High') hiE++;
                else if (ec === 'Moderate') modE++;
                else if (ec === 'Low') loE++;
                else if (ec === 'None') noE++;
                if (r['Mass Drug Administration Scheme Delivered']) mdaCount++;
            });

            const stateCov = burden > 0 ? parseFloat((treated / burden * 100).toFixed(1)) : 0;

            DB.stats[yr].states[st] = {
                burden, targeted, treated,
                coverage: stateCov,
                highEndemicity: hiE, moderateEndemicity: modE,
                lowEndemicity: loE, noneEndemicity: noE,
                iuCount: srecs.length, mdaImplemented: mdaCount,
                lgas
            };
        });

        // National aggregation
        let nb = 0, nt = 0, ntr = 0, nh = 0, nm = 0, nl = 0, nn = 0, niu = 0, nmd = 0;
        Object.values(DB.stats[yr].states).forEach(s => {
            nb += s.burden; nt += s.targeted; ntr += s.treated;
            nh += s.highEndemicity; nm += s.moderateEndemicity;
            nl += s.lowEndemicity; nn += s.noneEndemicity;
            niu += s.iuCount; nmd += s.mdaImplemented;
        });
        DB.stats[yr].national = {
            burden: nb, targeted: nt, treated: ntr,
            coverage: nb > 0 ? parseFloat((ntr / nb * 100).toFixed(1)) : 0,
            highEndemicity: nh, moderateEndemicity: nm,
            lowEndemicity: nl, noneEndemicity: nn,
            iuCount: niu, mdaImplemented: nmd,
            states: Object.keys(DB.stats[yr].states).length
        };
    });
    console.log(`✔ Epi Data: ${years.length} years × ${states.length} states processed`);

    // --- 3. LOGISTICS ---
    const rawLog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clean_delivery_data.json'), 'utf8'));
    DB.logistics = rawLog.map(r => ({
        po: r['PO Number'],
        year: r['Year'],
        drug: r['Drug'],
        quantity: r['Quantity'],
        stage: r['Stage'],
        estimatedArrival: r['Estimated Shipment Arrival'],
        actualShipment: r['Actual Shipment Date'],
        actualArrival: r['Actual Arrival Date'],
        actualDelivery: r['Actual Delivery Date'],
        mdaDate: r['MDA Date'],
        dispatchLag: r['Dispatch Lag'],
        transitTime: r['Transit Time'],
        lastMileTime: r['Last-Mile Time'],
        mdaDelay: r['MDA Delay']
    }));

    // Aggregate logistics by year for join with epi
    DB.logByYear = {};
    DB.logistics.forEach(r => {
        if (!DB.logByYear[r.year]) DB.logByYear[r.year] = { quantity: 0, records: [] };
        DB.logByYear[r.year].records.push(r);
        DB.logByYear[r.year].quantity += (r.quantity || 0);
    });
    // Compute year-level averages
    Object.entries(DB.logByYear).forEach(([yr, obj]) => {
        const valid = (key) => obj.records.map(r => r[key]).filter(v => v !== null && v > 0);
        const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
        obj.avgDispatchLag = avg(valid('dispatchLag'));
        obj.avgTransitTime = avg(valid('transitTime'));
        obj.avgLastMile = avg(valid('lastMileTime'));
        obj.avgMdaDelay = avg(valid('mdaDelay'));
        obj.totalQuantityM = parseFloat((obj.quantity / 1000000).toFixed(2));
        obj.stage = obj.records[0]?.stage;
    });
    console.log(`✔ Logistics: ${DB.logistics.length} PO records processed`);

    // --- 4. TIME SERIES for charts ---
    // National trend: coverage, burden, treated per year
    DB.timeseries.national = years.slice().reverse().map(yr => ({
        year: yr,
        coverage: DB.stats[yr].national?.coverage || 0,
        burden: DB.stats[yr].national?.burden || 0,
        treated: DB.stats[yr].national?.treated || 0,
        highEndemicity: DB.stats[yr].national?.highEndemicity || 0,
        logistics: DB.logByYear[yr] || null
    }));

    console.log('\n✔ Data modeling complete — Epi ↔ Logistics joined on Year dimension\n');
}

run();

// =========== API ===========
// Unified data endpoint
app.get('/api/data', (req, res) => {
    res.json({
        meta: DB.meta,
        geoJson: DB.geoJson,
        timeseries: DB.timeseries.national,
        logByYear: DB.logByYear
    });
});

// Year + State specific stats
app.get('/api/stats', (req, res) => {
    const { year, state } = req.query;

    if (year === 'All' || (typeof year === 'string' && year.includes(','))) {
        // Aggregate across requested years
        const yrs = year === 'All' ? DB.meta.years : year.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        const agg = { burden: 0, targeted: 0, treated: 0, highEndemicity: 0, moderateEndemicity: 0, lowEndemicity: 0, noneEndemicity: 0, iuCount: 0, mdaImplemented: 0 };
        yrs.forEach(yr => {
            const s = (!state || state === 'National') ? DB.stats[yr]?.national : DB.stats[yr]?.states[state];
            if (!s) return;
            agg.burden += s.burden || 0;
            agg.targeted += s.targeted || 0;
            agg.treated += s.treated || 0;
            agg.highEndemicity = Math.max(agg.highEndemicity, s.highEndemicity || 0);
            agg.moderateEndemicity = Math.max(agg.moderateEndemicity, s.moderateEndemicity || 0);
            agg.lowEndemicity = Math.max(agg.lowEndemicity, s.lowEndemicity || 0);
            agg.noneEndemicity = Math.max(agg.noneEndemicity, s.noneEndemicity || 0);
            agg.iuCount = Math.max(agg.iuCount, s.iuCount || 0);
            agg.mdaImplemented += s.mdaImplemented || 0;
        });
        agg.coverage = agg.burden > 0 ? parseFloat((agg.treated / agg.burden * 100).toFixed(1)) : 0;
        agg.states = (!state || state === 'National') ? DB.meta.states.length : 1;
        return res.json({ level: state === 'National' ? 'national' : 'state', year: String(year), data: agg });
    }

    const yr = parseInt(year) || DB.meta.years[0];
    if (!DB.stats[yr]) return res.status(404).json({ error: 'Year not found' });
    if (!state || state === 'National') {
        return res.json({ level: 'national', year: yr, data: DB.stats[yr].national });
    }
    const st = DB.stats[yr].states[state];
    if (!st) return res.status(404).json({ error: 'State not found' });
    return res.json({ level: 'state', year: yr, state, data: st });
});

// LGA table for a state/year
app.get('/api/lga-table', (req, res) => {
    const { year, state } = req.query;

    if (year === 'All' || (typeof year === 'string' && year.includes(','))) {
        // Aggregate each LGA across requested years
        const yrs = year === 'All' ? DB.meta.years : year.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        const lgaMap = {};
        yrs.forEach(yr => {
            const statesData = (!state || state === 'National') ? DB.stats[yr]?.states : { [state]: DB.stats[yr]?.states[state] };
            if (!statesData) return;
            Object.entries(statesData).forEach(([st, sd]) => {
                if (!sd) return;
                Object.entries(sd.lgas).forEach(([lga, ld]) => {
                    const key = `${st}||${lga}`;
                    if (!lgaMap[key]) lgaMap[key] = { state: st, lga, burden: 0, targeted: 0, treated: 0, endemicity: ld.endemicity, endemicityRaw: ld.endemicityRaw, mda: null };
                    lgaMap[key].burden += ld.burden || 0;
                    lgaMap[key].targeted += ld.targeted || 0;
                    lgaMap[key].treated += ld.treated || 0;
                    if (ld.mda) lgaMap[key].mda = ld.mda;
                    // Use most severe endemicity across years
                    const rank = { High: 4, Moderate: 3, Low: 2, None: 1, Unknown: 0 };
                    if ((rank[ld.endemicity] || 0) > (rank[lgaMap[key].endemicity] || 0)) {
                        lgaMap[key].endemicity = ld.endemicity;
                        lgaMap[key].endemicityRaw = ld.endemicityRaw;
                    }
                });
            });
        });
        const rows = Object.values(lgaMap).map(r => ({
            ...r,
            coverage: r.burden > 0 ? parseFloat((r.treated / r.burden * 100).toFixed(1)) : 0
        }));
        return res.json(rows);
    }

    const yr = parseInt(year) || DB.meta.years[0];
    if (!state || state === 'National') {
        const rows = [];
        Object.entries(DB.stats[yr]?.states || {}).forEach(([st, sd]) => {
            Object.entries(sd.lgas).forEach(([lga, ld]) => { rows.push({ state: st, lga, ...ld }); });
        });
        return res.json(rows);
    }
    const stData = DB.stats[yr]?.states[state];
    if (!stData) return res.json([]);
    const rows = Object.entries(stData.lgas).map(([lga, ld]) => ({ state, lga, ...ld }));
    return res.json(rows);
});

// State trend for a single state
app.get('/api/trend', (req, res) => {
    const { state } = req.query;
    const trend = DB.meta.years.slice().reverse().map(yr => {
        const s = (!state || state === 'National') ? DB.stats[yr].national : DB.stats[yr].states[state];
        const log = DB.logByYear[yr];
        return {
            year: yr,
            coverage: s?.coverage || 0,
            burden: s?.burden || 0,
            treated: s?.treated || 0,
            highEndemicity: s?.highEndemicity || 0,
            moderateEndemicity: s?.moderateEndemicity || 0,
            dispatchLag: log?.avgDispatchLag || null,
            transitTime: log?.avgTransitTime || null,
            lastMile: log?.avgLastMile || null,
            mdaDelay: log?.avgMdaDelay || null,
            quantityM: log?.totalQuantityM || null
        };
    });
    res.json(trend);
});

app.listen(PORT, () => console.log(`\n🌍 WHO ESPEN Nigeria Intelligence Platform → http://localhost:${PORT}\n`));
