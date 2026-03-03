# WHO ESPEN Intervention Dashboard

A data correlation and visualization dashboard built to bridge the gap between supply chain logistics and epidemiological outcomes for the WHO Expanded Special Project for Elimination of Neglected Tropical Diseases (ESPEN).

## The Problem

Mass Drug Administration (MDA) targets frequently miss the mark, leaving vulnerable populations without critical treatments against NTDs (like Schistosomiasis and Onchocerciasis). The core issue isn't just medical—it's logistical. Supply chain delays directly result in endemicity spikes, but the data has historically lived in separate silos. Stakeholders lack a unified view of how transit lag impacts disease control on the ground.

## Objective & Approach

As a **Data Analyst / Associate** who specializes in solving complex problems using **Data-Driven Decision Making (DDDM)** across the Health and Finance sectors, my goal with this project was to bring quantitative accountability to global health logistics. I took raw, disconnected datasets (Purchase Order logs and epidemiological surveys) and built a platform that explicitly models their financial and operational relationship. Instead of just plotting points on a map, this dashboard actively correlates dispatch delays with failed MDA coverage, highlighting exactly where and why the supply chain is failing the medical objectives and wasting operational resources.

## Tech Stack & Rationale

I built this with a focus on performance, low footprint, and clear data communication.

- **Vanilla JavaScript (ES6+), HTML5, CSS3**
  I aggressively avoided heavy frontend frameworks like React or Angular. This application needs to run reliably on low-end devices and weak networks common in remote intervention zones. Relying on native browser APIs ensures sub-second load times and zero framework bloat.
- **Node.js & Express**
  Used for the backend API and data aggregation. The non-blocking async architecture is ideal for mathematically joining thousands of logistics shipment records against regional geometry and year-over-year health stats without dropping requests.
- **Leaflet.js & CartoDB**
  Selected for lightweight geospatial rendering. I used custom bounding calculations and CSS filters to isolate Nigeria's 774 Local Government Areas (LGAs), completely washing out neighboring regions to reduce noise and keep the user focused entirely on the active intervention zones.
- **Chart.js**
  A dependable canvas-based charting library used to render dual-axis trendlines, scatter plots (correlating delay vs coverage), and stacked bar charts for supply chain bottleneck analysis.

## Key Challenges Solved

### 1. Data Asymmetry (Spatial vs Temporal)
**Challenge:** Epidemiological data is spatial (recorded by LGA region), while logistics data is temporal (recorded by shipment and PO dates). 
**Execution:** Drawing on finance and data modeling methodologies, I wrote a custom Node.js aggregation pipeline that calculates average transit times, dispatch lags, and last-mile delays per year. I then joined those temporal metrics directly against the annual PC coverage rates. This makes it mathematically obvious how a 30-day delay in shipping drags down national treatment coverage and return on investment.

### 2. Information Density & Alerting
**Challenge:** Plotting 10 years of data across 774 districts creates overwhelming visual noise.
**Execution:** Utilizing core DDDM principles, I built an Action Intelligence engine that automatically scores states based on a combined risk matrix (High Burden + Low Coverage). Instead of forcing stakeholders to dig through tables, the dashboard surfaces prioritized alerts indicating exactly which states require emergency logistics and financial intervention.

### 3. Map UX Friction
**Challenge:** Standard mapping libraries use click-to-open popups that remain sticky, obscuring neighboring polygons and slowing down rapid data scanning.
**Execution:** I rewrote the interaction layer to use non-intrusive hover tooltips synced with dynamic bounding-box logic. The map autonomously keeps the target nation perfectly centered regardless of screen size, and tooltips vanish instantly on mouseout, creating a fluid, frictionless review process for decision-makers.

---

### Setup & Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/who-espen-intelligence.git
cd who-espen-intelligence

# 2. Install dependencies
npm install

# 3. Start the local server
npm start
```

*Access the dashboard at `http://localhost:3001`.*
