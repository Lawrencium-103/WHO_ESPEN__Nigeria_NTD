# WHO ESPEN Intelligence Platform: Epidemiological & Supply Chain Nexus

<p align="center">
  <img src="https://img.shields.io/badge/Status-Production%20Ready-brightgreen" alt="Status">
  <img src="https://img.shields.io/badge/Architecture-Vanilla%20JS%20%2B%20Node.js-blue" alt="Architecture">
  <img src="https://img.shields.io/badge/Focus-Global%20Health%20Security-red" alt="Focus">
</p>

## 🔬 The Vision & Purpose

Stakeholders at the **WHO Expanded Special Project for Elimination of Neglected Tropical Diseases (ESPEN)** face a complex challenge: translating drug delivery logistics into real-world Preventive Chemotherapy (PC) coverage. Delays in the supply chain directly result in endemicity spikes, leaving vulnerable populations without critical treatments against NTDs (Schistosomiasis, Onchocerciasis, etc.).

As a **Think Tank and strategic data engineering entity**, I designed this platform to bridge the gap between two traditionally isolated data silos: **Epidemiological Disease Burden** and **Supply Chain Logistics**. The purpose of this architecture is to transform raw, disconnected datasets into actionable, geo-spatial intelligence that empowers senior stakeholders and ministries of health to make rapid, resource-allocating decisions.

## 🛠️ Technical Architecture & The "Why"

This project was built from the ground up to prioritize **performance, resilience, and clarity**. 

- **Frontend Core**: Vanilla JavaScript (ES6+), HTML5, CSS3. 
  - *Why?* To guarantee blazing-fast performance, zero-dependency overhead, and maximum resilience in low-bandwidth deployment environments typical of Global South intervention zones. Heavy UI frameworks like React or Angular were intentionally bypassed to eliminate bloated initial load times.
- **Geospatial Engine**: Leaflet.js with CartoDB Voyager tiles.
  - *Why?* Extremely precise vector polygon rendering maps 774 Local Government Areas (LGAs) in Nigeria dynamically. Custom CSS filters completely wash out neighboring countries, stripping away visual noise and forcing absolute stakeholder focus on the intervention zone.
- **Visualization Engine**: Chart.js.
  - *Why?* Highly reliable, responsive HTML5 canvas rendering capable of handling complex dual-axis trends, scatter distributions, and stacked bottleneck analyses.
- **Backend API Layer**: Node.js & Express.
  - *Why?* Async, non-blocking I/O is ideal for rapidly joining simulated epidemiology telemetry with logistics Purchase Order (PO) logs at runtime without blocking the event loop.

## 🚧 Challenges Faced & Overcome

1. **The Challenge**: Merging Asynchronous Data Streams  
   Epidemiological data is modeled spatially (by region and LGA), while logistics data is modeled temporarily (by shipment POs).  
   **The Solution**: I constructed a dynamic, temporal Node.js aggregation layer that joins thousands of shipment records (Dispatch -> Transit -> Last-mile delays) directly against historical PC coverage outcomes by year. This allowed the system to establish a unique causal link between supply chain delays and disease coverage.

2. **The Challenge**: Stakeholder Information Overload  
   Presenting 10 years of data across 774 LGAs typically results in "analysis paralysis."  
   **The Solution**: Developed the **Action Intelligence Engine**. Instead of forcing users to guess what the data implies, the platform's algorithms immediately sift through 37 states and output direct alerts (Critical, Warning, Info) and prioritized tables recommending emergency interventions based on high-burden + low-coverage overlapping logic.

3. **The Challenge**: Map UI Friction  
   Native mapping tools often suffer from "sticky" tooltips that obstruct neighboring polygons when trying to rapidly scan regions.  
   **The Solution**: Re-engineered the Leaflet event listeners to utilize completely custom, non-obstructive hover tooltips that track mouse movement cleanly, combined with `fitBounds()` geometry calculations to always keep the map perfectly centered on the target nation.

## 💡 Unique Value Proposition

What makes this idea unique is the **Actionable Triangulation** of data. 
Most platforms either show you a map of disease, OR a table of drug shipments. This platform does both, and mathematically correlates them:
- **Scatter Plot Correlator**: Proves that MDA Delays mathematically drag down PC Coverage.
- **Logistics Bottleneck Analyzer**: Stacks Dispatch vs. Transit vs. Last-Mile delays chronologically, allowing operations managers to point to exactly *where* in the supply chain the failure occurred.
- **Priority State Ranking**: Automatically lists which states are failing geographically so they can receive immediate intervention.

This is not just a dashboard; it is a **diagnostic and strategic recommendation engine** aligned perfectly with stakeholder requirements to eliminate NTDs.

---

### Setup & Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/who-espen-intelligence.git
cd who-espen-intelligence

# 2. Install dependencies (Node.js & Express)
npm install

# 3. Start the internal API and static server
npm start
```

*Access the dashboard locally at `http://localhost:3001`.*
