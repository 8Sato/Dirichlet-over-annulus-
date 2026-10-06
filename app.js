/* app.js — controles, progreso, superficie 3D giratoria y mapa de calor (Plotly). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('simulation-form'), runBtn = $('simulate-button'), cancelBtn = $('cancel-button');
  const statusEl = $('status'), bar = $('simulation-progress'), errorEl = $('error-message');
  const Sim = window.AnnulusSimulation;

  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
  const missing = [];
  if (!Sim) missing.push('simulation.js (is it uploaded next to index.html, with that exact name?)');
  if (!window.Plotly) missing.push('Plotly (blocked or missing <script> tag for the CDN)');
  if (missing.length) {
    statusEl.textContent = 'Initialization failed.';
    showError('Missing: ' + missing.join(' and ') + '.');
    return;
  }
  statusEl.textContent = 'Ready. Choose parameters and press Simulate.';
  runBtn.disabled = false;

  let controller = null;
  const config = { responsive: true, displaylogo: false, scrollZoom: true };
  let lastResult = null;
  const root = document.documentElement;
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  function setBusy(busy) {
    runBtn.disabled = busy;
    cancelBtn.disabled = !busy;
    form.querySelectorAll('input').forEach((el) => { el.disabled = busy; });
  }

  // z[j][i] (filas = y, columnas = x); null donde no hay dato (fuera del anillo).
  function rowsOf(res, valueAt) {
    const n1 = res.N + 1, rows = [];
    for (let j = 0; j < n1; j++) {
      const row = new Array(n1);
      for (let i = 0; i < n1; i++) row[i] = valueAt(i * n1 + j, i, j);
      rows.push(row);
    }
    return rows;
  }

  function ring(r, fn) {
    const th = Array.from({ length: 361 }, (_, k) => (2 * Math.PI * k) / 360);
    return { x: th.map((t) => r * Math.cos(t)), y: th.map((t) => r * Math.sin(t)), z: th.map(fn) };
  }

  function clearPlaceholder(el) {
    const p = el.querySelector(':scope > p');
    if (p) p.remove();
  }

  function draw(res) {
    const { z, se, xs, a, b } = res;
    const dark = root.getAttribute('data-theme') === 'dark';
    const ink = cssVar('--ink'), grid = cssVar('--line'), clear = 'rgba(0,0,0,0)';
    const axis = { color: ink, gridcolor: grid, zerolinecolor: grid, linecolor: grid };
    const zRows = rowsOf(res, (p) => (Number.isNaN(z[p]) ? null : z[p]));
    const common = { cmin: res.zmin, cmax: res.zmax, colorscale: 'Viridis' };

    const ringA = ring(a, res.f), ringB = ring(b, res.g);
    const lineA = { type: 'scatter3d', mode: 'lines', x: ringA.x, y: ringA.y, z: ringA.z, name: 'f on r = a', line: { color: dark ? '#ff9a4d' : '#d35400', width: 6 }, hoverinfo: 'skip' };
    const lineB = { type: 'scatter3d', mode: 'lines', x: ringB.x, y: ringB.y, z: ringB.z, name: 'g on r = b', line: { color: ink, width: 6 }, hoverinfo: 'skip' };

    const surface = {
      type: 'surface', x: Array.from(xs), y: Array.from(xs), z: zRows, ...common,
      connectgaps: false, name: 'Approximate u',
      colorbar: { title: { text: 'u' }, thickness: 14 },
      hovertemplate: 'x: %{x:.3f}<br>y: %{y:.3f}<br>u ≈ %{z:.4f}<extra></extra>',
    };
    const el3d = $('solution-plot');
    clearPlaceholder(el3d);
    Plotly.react(el3d, [surface, lineA, lineB], {
      margin: { l: 0, r: 0, t: 10, b: 0 },
      paper_bgcolor: clear, font: { color: ink },
      legend: { orientation: 'h', y: 0 },
      scene: {
        bgcolor: clear,
        xaxis: { ...axis, title: { text: 'x' } }, yaxis: { ...axis, title: { text: 'y' } }, zaxis: { ...axis, title: { text: 'u' } },
        aspectmode: 'manual', aspectratio: { x: 1, y: 1, z: 0.7 }, dragmode: 'turntable',
      },
      uirevision: 'keep',
    }, config);

    const hover = rowsOf(res, (p, i, j) => {
      if (Number.isNaN(z[p])) return '';
      const where = `x = ${xs[i].toFixed(3)}, y = ${xs[j].toFixed(3)}`;
      return Number.isNaN(se[p])
        ? `${where}<br>u = ${z[p].toFixed(4)} (prescribed)`
        : `${where}<br>u ≈ ${z[p].toFixed(4)} ± ${se[p].toFixed(4)} (1 SE)`;
    });
    const heat = {
      type: 'heatmap', x: Array.from(xs), y: Array.from(xs), z: zRows, zmin: res.zmin, zmax: res.zmax,
      colorscale: 'Viridis', zsmooth: false, text: hover, hovertemplate: '%{text}<extra></extra>',
      colorbar: { title: { text: 'u' }, thickness: 14 },
    };
    const circle = (r) => ({ type: 'circle', xref: 'x', yref: 'y', x0: -r, y0: -r, x1: r, y1: r, line: { color: ink, width: 1.5 } });
    const elHeat = $('heatmap-plot');
    clearPlaceholder(elHeat);
    const pad = b * 1.03;
    Plotly.react(elHeat, [heat], {
      margin: { l: 50, r: 10, t: 10, b: 45 },
      paper_bgcolor: clear, plot_bgcolor: clear, font: { color: ink },
      xaxis: { ...axis, title: { text: 'x' }, range: [-pad, pad], constrain: 'domain' },
      yaxis: { ...axis, title: { text: 'y' }, range: [-pad, pad], scaleanchor: 'x' },
      shapes: [circle(a), circle(b)],
    }, config);
    drawAnalytic(res);
  }

  function drawAnalytic(res) {
    const { z, se, xs, a, b, N } = res, n1 = N + 1;
    const dark = root.getAttribute('data-theme') === 'dark';
    const ink = cssVar('--ink'), grid = cssVar('--line'), clear = 'rgba(0,0,0,0)';
    const axis = { color: ink, gridcolor: grid, zerolinecolor: grid, linecolor: grid };

    // Superficie exacta en malla polar + estimaciones Monte Carlo.
    const nr = 50, nt = 140, X = [], Y = [], Z = [];
    for (let k = 0; k < nt; k++) {
      const th = (2 * Math.PI * k) / (nt - 1), rx = [], ry = [], rz = [];
      for (let m = 0; m < nr; m++) {
        const r = a + ((b - a) * m) / (nr - 1), x = r * Math.cos(th), y = r * Math.sin(th);
        rx.push(x); ry.push(y); rz.push(res.analytic.at(x, y));
      }
      X.push(rx); Y.push(ry); Z.push(rz);
    }
    const surface = {
      type: 'surface', x: X, y: Y, z: Z, surfacecolor: Z.map((row) => row.map(() => 0)),
      colorscale: [[0, '#e8833a'], [1, '#e8833a']], showscale: false, opacity: 0.55,
      name: 'Analytic solution', showlegend: true,
      hovertemplate: 'x: %{x:.3f}<br>y: %{y:.3f}<br>u = %{z:.4f}<extra>analytic</extra>',
    };
    const px = [], py = [], pz = [];
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n1; j++) {
        const p = i * n1 + j;
        if (!Number.isNaN(se[p])) { px.push(xs[i]); py.push(xs[j]); pz.push(z[p]); }
      }
    }
    const points = {
      type: 'scatter3d', mode: 'markers', x: px, y: py, z: pz, name: 'Monte Carlo estimates',
      marker: { size: 2.5, color: dark ? '#6ea8ff' : '#2f5fd0' },
      hovertemplate: 'x: %{x:.3f}<br>y: %{y:.3f}<br>u ≈ %{z:.4f}<extra>Monte Carlo</extra>',
    };
    const el3d = $('exact-plot');
    clearPlaceholder(el3d);
    Plotly.react(el3d, [surface, points], {
      margin: { l: 0, r: 0, t: 10, b: 0 }, paper_bgcolor: clear, font: { color: ink },
      legend: { orientation: 'h', y: 0 },
      scene: {
        bgcolor: clear,
        xaxis: { ...axis, title: { text: 'x' } }, yaxis: { ...axis, title: { text: 'y' } }, zaxis: { ...axis, title: { text: 'u' } },
        aspectmode: 'manual', aspectratio: { x: 1, y: 1, z: 0.7 }, dragmode: 'turntable',
      },
      uirevision: 'keep',
    }, config);

    // Mapa del error con signo (escala simétrica alrededor de 0).
    const eRows = rowsOf(res, (p) => (Number.isNaN(res.err[p]) ? null : res.err[p]));
    const lim = res.errLimit || 1e-12;
    const hover = rowsOf(res, (p, i, j) => {
      if (Number.isNaN(res.err[p])) return '';
      const where = `x = ${xs[i].toFixed(3)}, y = ${xs[j].toFixed(3)}`;
      return Number.isNaN(se[p])
        ? `${where}<br>error = ${res.err[p].toFixed(4)} (prescribed layer)`
        : `${where}<br>error = ${res.err[p].toFixed(4)} (1 SE = ${se[p].toFixed(4)})`;
    });
    const heat = {
      type: 'heatmap', x: Array.from(xs), y: Array.from(xs), z: eRows, zmin: -lim, zmax: lim,
      colorscale: 'RdBu', reversescale: true, zsmooth: false, text: hover, hovertemplate: '%{text}<extra></extra>',
      colorbar: { title: { text: 'Û − u' }, thickness: 14 },
    };
    const circle = (r) => ({ type: 'circle', xref: 'x', yref: 'y', x0: -r, y0: -r, x1: r, y1: r, line: { color: ink, width: 1.5 } });
    const elErr = $('error-plot');
    clearPlaceholder(elErr);
    const pad = b * 1.03;
    Plotly.react(elErr, [heat], {
      margin: { l: 50, r: 10, t: 10, b: 45 },
      paper_bgcolor: clear, plot_bgcolor: clear, font: { color: ink },
      xaxis: { ...axis, title: { text: 'x' }, range: [-pad, pad], constrain: 'domain' },
      yaxis: { ...axis, title: { text: 'y' }, range: [-pad, pad], scaleanchor: 'x' },
      shapes: [circle(a), circle(b)],
    }, config);
  }

  function showSummary(res) {
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set('result-spacing', res.h.toPrecision(4));
    set('result-nodes', res.nodeCount.toLocaleString());
    set('result-walks', res.M.toLocaleString());
    set('result-time', `${(res.elapsedMs / 1000).toFixed(2)} s`);
    set('result-se', `${res.meanSE.toFixed(4)} / ${res.maxSE.toFixed(4)}`);
    $('simulation-summary').hidden = false;
    const sgn = (v) => (v >= 0 ? '+' : '') + v.toFixed(4);
    set('err-rmse', res.errStats.rmse.toFixed(4));
    set('err-mean', sgn(res.errStats.mean));
    set('err-max', res.errStats.maxAbs.toFixed(4));
    set('err-se', res.meanSE.toFixed(4));
    set('err-modes', String(res.analytic.modes));
    $('error-summary').hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (controller) return;
    errorEl.hidden = true;
    const data = new FormData(form);   // leer antes de deshabilitar los inputs
    const params = {
      a: Number(data.get('innerRadius')), b: Number(data.get('outerRadius')),
      fSrc: data.get('innerFunction'), gSrc: data.get('outerFunction'),
      N: Number(data.get('N')), M: Number(data.get('M')), seed: Number(data.get('seed')),
    };
    controller = new AbortController();
    setBusy(true);
    bar.value = 0;
    statusEl.textContent = 'Preparing grid…';
    try {
      const res = await Sim.run(params, {
        signal: controller.signal,
        onProgress: (p) => { bar.value = p * 100; statusEl.textContent = `Simulating… ${Math.round(p * 100)}%`; },
      });
      draw(res);
      lastResult = res;
      showSummary(res);
      statusEl.textContent = `Done. u ranges from ${res.zmin.toFixed(3)} to ${res.zmax.toFixed(3)}; ` +
        `mean standard error ${res.meanSE.toFixed(4)}.`;
    } catch (err) {
      if (err && err.name === 'AbortError') { statusEl.textContent = 'Cancelled.'; bar.value = 0; }
      else { statusEl.textContent = 'The simulation could not run.'; showError(err && err.message ? err.message : String(err)); }
    } finally {
      controller = null;
      setBusy(false);
    }
  });

  cancelBtn.addEventListener('click', () => { if (controller) controller.abort(); });
  document.addEventListener('themechange', () => { if (lastResult) draw(lastResult); });
})();
