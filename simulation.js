/* simulation.js — Dirichlet en el anillo a < r < b por caminatas aleatorias.
   Sin dependencias. Expone window.AnnulusSimulation = { parseFunction, compileBoundary, run }. */
(function (global) {
  'use strict';
  const TWO_PI = 2 * Math.PI;

  /* ---------- Parser seguro de expresiones en theta (sin eval) ---------- */
  const FUNCS = Object.assign(Object.create(null), {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp,
    log: Math.log, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
    sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
  });
  const CONSTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E });

  function parseFunction(source) {
    const text = String(source).trim().toLowerCase();
    if (!text) throw new Error('the expression is empty.');
    const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z_][a-z0-9_]*)|(\*\*|[-+*/^(),]))/y;
    const tokens = [];
    let pos = 0;
    while (pos < text.length) {
      re.lastIndex = pos;
      const m = re.exec(text);
      if (!m) {
        const rest = text.slice(pos).trim();
        if (!rest) break;
        throw new Error(`unexpected character "${rest[0]}".`);
      }
      pos = re.lastIndex;
      if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
      else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
      else tokens.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
    }

    let k = 0;
    const eat = (op) => {
      const tk = tokens[k];
      if (tk && tk.t === 'op' && tk.v === op) { k++; return true; }
      return false;
    };
    function expr() {
      let a = term();
      for (;;) {
        const l = a;
        if (eat('+')) { const r = term(); a = (th) => l(th) + r(th); }
        else if (eat('-')) { const r = term(); a = (th) => l(th) - r(th); }
        else return a;
      }
    }
    function term() {
      let a = unary();
      for (;;) {
        const l = a;
        if (eat('*')) { const r = unary(); a = (th) => l(th) * r(th); }
        else if (eat('/')) { const r = unary(); a = (th) => l(th) / r(th); }
        else return a;
      }
    }
    function unary() {
      if (eat('-')) { const a = unary(); return (th) => -a(th); }
      if (eat('+')) return unary();
      return power();
    }
    function power() {
      const base = atom();
      if (eat('^')) { const ex = unary(); return (th) => Math.pow(base(th), ex(th)); }
      return base;
    }
    function atom() {
      const tk = tokens[k++];
      if (!tk) throw new Error('the expression ends unexpectedly.');
      if (tk.t === 'num') return () => tk.v;
      if (tk.t === 'id') {
        if (tk.v === 'theta') return (th) => th;
        if (tk.v in CONSTS) { const c = CONSTS[tk.v]; return () => c; }
        if (tk.v in FUNCS) {
          if (!eat('(')) throw new Error(`"${tk.v}" needs parentheses, e.g. ${tk.v}(theta).`);
          const arg = expr();
          if (!eat(')')) throw new Error('missing closing parenthesis.');
          const fn = FUNCS[tk.v];
          return (th) => fn(arg(th));
        }
        throw new Error(`unknown name "${tk.v}". Use theta, pi, e, or sin, cos, exp, ...`);
      }
      if (tk.v === '(') {
        const inner = expr();
        if (!eat(')')) throw new Error('missing closing parenthesis.');
        return inner;
      }
      throw new Error(`unexpected "${tk.v}".`);
    }

    const fn = expr();
    if (k < tokens.length) {
      throw new Error(`unexpected "${tokens[k].v}". Use * for products, e.g. 2 * theta.`);
    }
    return fn;
  }

  /* Compila y valida: finita en [0, 2π] y con f(0) = f(2π). */
  function compileBoundary(source, name) {
    let fn;
    try { fn = parseFunction(source); }
    catch (err) { throw new Error(`${name}: ${err.message}`); }
    for (let i = 0; i <= 360; i++) {
      const th = (TWO_PI * i) / 360;
      if (!Number.isFinite(fn(th))) {
        throw new Error(`${name}(theta) is not finite at theta = ${th.toFixed(3)}.`);
      }
    }
    const v0 = fn(0), v1 = fn(TWO_PI);
    if (Math.abs(v0 - v1) > 1e-9 + 1e-9 * Math.abs(v1)) {
      throw new Error(`${name}(0) must equal ${name}(2π); got ${v0.toPrecision(6)} and ${v1.toPrecision(6)}.`);
    }
    return fn;
  }

  /* ---------- RNG con semilla (sfc32); devuelve enteros de 32 bits ---------- */
  function makeRng(seed) {
    let s = seed | 0;
    const mix = () => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    let a = mix(), b = mix(), c = mix(), d = 1;
    const next = () => {
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return t >>> 0;
    };
    for (let i = 0; i < 12; i++) next();
    return next;
  }

  /* ---------- Solución analítica: serie de Fourier en theta ----------
     u(r,θ) = f0 (L-s)/L + g0 s/L + Σ_n [ f_n(θ) sinh(n(L-s)) + g_n(θ) sinh(n s) ] / sinh(nL),
     con L = ln(b/a), s = ln(r/a). Los cocientes se escriben con exp/expm1 para evitar desbordes. */
  const FOURIER_SAMPLES = 512, FOURIER_MAX = 128;

  function fourier(fn) {
    const K = FOURIER_SAMPLES, vals = new Float64Array(K);
    let c0 = 0, scale = 0;
    for (let k = 0; k < K; k++) {
      vals[k] = fn((TWO_PI * k) / K);
      c0 += vals[k]; scale = Math.max(scale, Math.abs(vals[k]));
    }
    c0 /= K;
    const tol = 1e-12 * (scale || 1);
    const c = new Float64Array(FOURIER_MAX + 1), s = new Float64Array(FOURIER_MAX + 1);
    let last = 0;
    for (let n = 1; n <= FOURIER_MAX; n++) {
      let sc = 0, ss = 0;
      for (let k = 0; k < K; k++) {
        const t = (TWO_PI * n * k) / K;
        sc += vals[k] * Math.cos(t); ss += vals[k] * Math.sin(t);
      }
      c[n] = (2 * sc) / K; s[n] = (2 * ss) / K;
      if (Math.abs(c[n]) > tol || Math.abs(s[n]) > tol) last = n;
    }
    return { c0, c, s, last };
  }

  function makeAnalytic(f, g, a, b) {
    const L = Math.log(b / a), F = fourier(f), G = fourier(g);
    const modes = Math.max(F.last, G.last);
    const at = (x, y) => {
      const r = Math.hypot(x, y), th = Math.atan2(y, x), s = Math.log(r / a);
      let u = (F.c0 * (L - s) + G.c0 * s) / L;
      for (let n = 1; n <= modes; n++) {
        const den = -Math.expm1(-2 * n * L);
        const wf = (Math.exp(-n * s) * -Math.expm1(-2 * n * (L - s))) / den;   // sinh(n(L-s))/sinh(nL)
        const wg = (Math.exp(-n * (L - s)) * -Math.expm1(-2 * n * s)) / den;   // sinh(n s)/sinh(nL)
        const cs = Math.cos(n * th), sn = Math.sin(n * th);
        u += wf * (F.c[n] * cs + F.s[n] * sn) + wg * (G.c[n] * cs + G.s[n] * sn);
      }
      return u;
    };
    return { at, modes };
  }

  /* ---------- Simulación ---------- */
  function abortError() {
    const e = new Error('Simulation cancelled.');
    e.name = 'AbortError';
    return e;
  }

  async function run(params, { signal, onProgress } = {}) {
    const t0 = performance.now();
    const { a, b, N, M, seed } = params;
    if (!(a > 0) || !Number.isFinite(b) || !(b > a)) throw new Error('The radii must satisfy 0 < r < R.');
    if (!Number.isInteger(N) || N < 4 || N > 300) throw new Error('N must be an integer between 4 and 300.');
    if (!Number.isInteger(M) || M < 2 || M > 1e6) throw new Error('M must be an integer between 2 and 1,000,000.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('The seed must be an integer between 0 and 4294967295.');
    const f = compileBoundary(params.fSrc, 'f');
    const g = compileBoundary(params.gSrc, 'g');

    // Grilla en [-b, b]^2, h = 2b/N. Índice lineal p = i*(N+1) + j  (i: x, j: y).
    const n1 = N + 1, h = (2 * b) / N;
    const xs = new Float64Array(n1);
    for (let i = 0; i < n1; i++) xs[i] = -b + i * h;
    xs[0] = -b; xs[N] = b;

    // Valor de borde: proyecta radialmente al círculo más cercano (empate -> interior) y evalúa.
    const payoff = (x, y, r) => {
      let v;
      if (r === 0) v = f(0);
      else {
        let th = Math.atan2(y, x);
        if (th < 0) th += TWO_PI;
        v = Math.abs(r - a) <= Math.abs(r - b) ? f(th) : g(th);
      }
      if (!Number.isFinite(v)) throw new Error('A boundary function returned a non-finite value.');
      return v;
    };

    // table: valor absorbente (nodos de parada) o NaN (nodos de continuación).
    const table = new Float64Array(n1 * n1);
    const inAnnulus = new Uint8Array(n1 * n1);
    const nodeList = [];
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n1; j++) {
        const p = i * n1 + j, x = xs[i], y = xs[j], r = Math.hypot(x, y);
        inAnnulus[p] = r > a && r < b ? 1 : 0;
        const edge = i === 0 || j === 0 || i === N || j === N;
        let absorbing = edge || r <= a || r >= b;
        if (!absorbing) {
          const rn = [Math.hypot(xs[i + 1], y), Math.hypot(xs[i - 1], y), Math.hypot(x, xs[j + 1]), Math.hypot(x, xs[j - 1])];
          absorbing = rn.some((q) => q <= a || q >= b);
        }
        if (absorbing) table[p] = payoff(x, y, r);
        else { table[p] = NaN; nodeList.push(p); }
      }
    }
    const K = nodeList.length;
    if (K === 0) throw new Error('No continuation nodes: the ring is thinner than the grid. Increase N.');

    // Campo de salida: continuación = media MC; capa absorbente dentro del anillo = valor prescrito.
    const z = new Float64Array(n1 * n1).fill(NaN);
    const se = new Float64Array(n1 * n1).fill(NaN);
    for (let p = 0; p < z.length; p++) if (inAnnulus[p] && table[p] === table[p]) z[p] = table[p];

    const next = makeRng(seed);
    const OFF = Int32Array.of(n1, -n1, 1, -1);   // (+x, -x, +y, -y)
    let bits = 0, left = 0, sumSE = 0, maxSE = 0, lastYield = performance.now();
    if (signal && signal.aborted) throw abortError();

    for (let k = 0; k < K; k++) {
      const start = nodeList[k];
      let s1 = 0, s2 = 0, v0 = 0;
      for (let m = 0; m < M; m++) {
        let p = start, v;
        while ((v = table[p]) !== v) {                 // NaN => seguir caminando
          if (left === 0) { bits = next(); left = 16; }  // 16 pasos por entero de 32 bits
          p += OFF[bits & 3]; bits >>>= 2; left--;
        }
        if (m === 0) v0 = v;
        const d = v - v0; s1 += d; s2 += d * d;
      }
      const mean = s1 / M;
      const variance = Math.max(0, (s2 - M * mean * mean) / (M - 1));
      const err = Math.sqrt(variance / M);              // error estándar = s / sqrt(M)
      z[start] = v0 + mean; se[start] = err;
      sumSE += err; if (err > maxSE) maxSE = err;

      if (performance.now() - lastYield > 30) {
        if (onProgress) onProgress((k + 1) / K);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal && signal.aborted) throw abortError();
        lastYield = performance.now();
      }
    }

    // Solución analítica y error (Û - u) en cada nodo del anillo; métricas sólo en nodos de continuación.
    const analytic = makeAnalytic(f, g, a, b);
    const exact = new Float64Array(n1 * n1).fill(NaN), err = new Float64Array(n1 * n1).fill(NaN);
    let eSum = 0, eSq = 0, eMax = 0, errLimit = 0;
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n1; j++) {
        const p = i * n1 + j;
        if (!inAnnulus[p]) continue;
        const u = analytic.at(xs[i], xs[j]), e = z[p] - u;
        exact[p] = u; err[p] = e;
        if (Math.abs(e) > errLimit) errLimit = Math.abs(e);
        if (se[p] === se[p]) { eSum += e; eSq += e * e; if (Math.abs(e) > eMax) eMax = Math.abs(e); }
      }
    }
    const errStats = { mean: eSum / K, rmse: Math.sqrt(eSq / K), maxAbs: eMax };

    let zmin = Infinity, zmax = -Infinity;
    for (let p = 0; p < z.length; p++) {
      if (z[p] === z[p]) { if (z[p] < zmin) zmin = z[p]; if (z[p] > zmax) zmax = z[p]; }
    }
    if (onProgress) onProgress(1);
    return { a, b, N, M, h, xs, z, se, nodeCount: K, zmin, zmax, meanSE: sumSE / K, maxSE, f, g, analytic, exact, err, errLimit, errStats, elapsedMs: performance.now() - t0 };
  }

  global.AnnulusSimulation = { parseFunction, compileBoundary, run };
})(window);
