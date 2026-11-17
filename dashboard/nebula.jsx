// nebula.jsx: the Brain as a star field you can fly around, plus the Cradle.
//
// Adapted from Adam Chan's Creative Second Brain (知識星雲 and 星之搖籃), used
// with his permission. The nebula background is his fragment shader; the stars,
// camera and Cradle are rebuilt here for todouz's notes and typed links.
//
// - Drag to turn the sky, scroll or pinch to zoom, click a star to read it.
// - Put two or three stars in the Cradle (or press Encounter to draw three),
//   ask a question, and the "cradle" routine writes a new thinking note that
//   links back to them. It lands in the Brain and as an insight in the Feed.

const { useState: nUseState, useEffect: nUseEffect, useMemo: nUseMemo, useRef: nUseRef, useCallback: nUseCallback } = React;

const NEBULA_PALETTES = [
  { id: 'violet', name: 'Violet', a: [.025, .40, .80], b: [.36, .10, .88], c: [.75, .065, .42], veil: [.055, .025, .15], base: [.003, .006, .020], swatch: 'linear-gradient(135deg,#49bbf0,#9254e8,#da548e)' },
  { id: 'aurora', name: 'Aurora', a: [.015, .47, .52], b: [.055, .65, .36], c: [.12, .32, .75], veil: [.008, .07, .07], base: [.002, .012, .019], swatch: 'linear-gradient(135deg,#55cdda,#69edb6,#4375dd)' },
  { id: 'rose', name: 'Rose', a: [.25, .15, .60], b: [.72, .13, .42], c: [.95, .38, .28], veil: [.10, .025, .095], base: [.014, .004, .018], swatch: 'linear-gradient(135deg,#8c70d7,#e566ab,#e6a189)' },
  { id: 'amber', name: 'Amber', a: [.21, .24, .40], b: [.68, .35, .08], c: [.95, .62, .22], veil: [.085, .045, .018], base: [.012, .008, .003], swatch: 'linear-gradient(135deg,#7c90bb,#d49b56,#eed3a0)' },
];

// Adam's nebula fragment shader (shaders.js NFS), trimmed to the uniforms todouz drives.
const NEBULA_VS = `attribute vec2 p;varying vec2 u;void main(){u=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const NEBULA_FS = `precision mediump float;
varying vec2 u;
uniform vec2 r;uniform vec2 par;uniform float t;uniform float attention;uniform float seedOffset;uniform float approach;uniform float energy;
uniform vec3 palette_a,palette_b,palette_c,palette_veil,palette_base;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.53;mat2 turn=mat2(.82,-.57,.57,.82);for(int i=0;i<6;i++){v+=a*noise(p);p=turn*p*2.04+vec2(3.7,8.2);a*=.49;}return v;}
void main(){
 vec2 uv=(u-.5)*vec2(r.x/r.y,1.);
 vec2 origin=vec2(seedOffset,seedOffset*.713);
 vec2 p=uv*(1.62-approach*.18)+par;
 vec2 drift=vec2(t*.012,-t*.008);
 vec2 warp=vec2(fbm(p*1.4+drift+origin),fbm(p*1.7-drift+5.2+origin));
 float cloud=fbm(p*2.4+warp*1.55+drift+origin);
 float wisps=fbm(p*6.2+warp*2.1-drift*.5+origin);
 float ridge=pow(1.-abs(wisps*2.-1.),7.);
 float ribbon=p.y+.21*sin(p.x*2.8+warp.x*3.6)-p.x*.22;
 float envelope=exp(-ribbon*ribbon*3.6);
 float density=smoothstep(.37,.80,cloud)*envelope;
 float pockets=smoothstep(.31,.63,fbm(p*2.9-warp*.7));
 float filament=smoothstep(.50,.86,wisps)*density;
 float hue=fbm(p*.75+vec2(8.2,4.1)+origin);
 vec3 color=mix(palette_a,palette_b,smoothstep(.28,.60,hue));
 color=mix(color,palette_c,smoothstep(.57,.76,fbm(p*1.1+12.))*.7);
 color=mix(color,vec3(.3,.55,.9),attention*.12);
 vec3 fog=color*density*(.36+pockets*1.4);
 fog+=mix(color,vec3(.62,.76,1.),.16)*filament*.8;
 fog+=color*ridge*density*.14;
 float cavity=smoothstep(.20,.55,fbm(p*1.8+warp+2.1));
 fog*=.23+.77*cavity;
 float veil=fbm(uv*1.8+par*.27-drift*.23+origin);
 fog+=palette_veil*smoothstep(.36,.73,veil)*.40;
 float embers=pow(smoothstep(.44,.78,wisps),2.)*density;
 fog+=mix(color,vec3(.78,.87,1.),.18)*embers*(approach*.95+energy*.8);
 float vign=1.-smoothstep(.42,1.30,length(uv));
 vec3 c=palette_base+fog*vign*1.12;
 c=1.-exp(-c*1.42);
 gl_FragColor=vec4(c,1.);
}`;

function nebulaHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
const nebulaHex = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0x8fa3c4; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const NEBULA_TENSE = new Set(['contradicts', 'limits', 'tradeoff']);

// Places notes in 3D: the existing deterministic force layout gives x/y, and a
// per-note hash plus cluster depth gives z, so linked notes still sit together.
function nebulaPlace(graph) {
  const W = 900, H = 560;
  const { pos, deg } = brainForceLayout(graph.nodes, graph.edges, { w: W, h: H, iters: 300 });
  let sx = 1; for (const p of pos) sx = Math.max(sx, Math.abs(p.x), Math.abs(p.y) * 1.3);
  return graph.nodes.map((n, i) => {
    const z = (nebulaHash(n.slug) - 0.5) * (deg[i] ? 0.9 : 1.6);
    return { ...n, x: pos[i].x / sx * 3, y: pos[i].y / sx * 3, z: z * 3, deg: deg[i] };
  });
}

// Encounter: three stars with roles, after Adam's 偶遇. A note under tension,
// a well-connected hub that is not next to it, and a distant or new note.
function nebulaEncounter(stars, edges, locked = []) {
  const nb = new Map(stars.map(s => [s.slug, new Set()]));
  const tense = new Map();
  for (const e of edges) {
    if (!nb.has(e.from) || !nb.has(e.to)) continue;
    nb.get(e.from).add(e.to); nb.get(e.to).add(e.from);
    if (NEBULA_TENSE.has(e.type)) { tense.set(e.from, (tense.get(e.from) || 0) + 1); tense.set(e.to, (tense.get(e.to) || 0) + 1); }
  }
  const pick = (list) => list.length ? list[Math.floor(Math.random() * Math.min(list.length, 12))] : null;
  const taken = new Set(locked);
  const near = () => { const s = new Set(); for (const t of taken) { s.add(t); for (const x of nb.get(t) || []) { s.add(x); for (const y of nb.get(x) || []) s.add(y); } } return s; };
  const out = locked.map(slug => ({ slug, role: 'yours', why: 'you chose this one' }));
  const roles = [
    { role: 'tension', why: 'other notes push against it', pool: () => stars.filter(s => tense.get(s.slug)).sort((a, b) => tense.get(b.slug) - tense.get(a.slug)) },
    { role: 'hub', why: 'many notes lean on it', pool: () => { const n = near(); return stars.filter(s => s.deg > 1 && !n.has(s.slug)).sort((a, b) => b.deg - a.deg); } },
    { role: 'stranger', why: 'far from the others, or still on its own', pool: () => { const n = near(); const now = Date.now(); return stars.filter(s => !n.has(s.slug)).sort((a, b) => (a.deg - b.deg) || ((now - new Date(a.updated || 0)) - (now - new Date(b.updated || 0)))); } },
  ];
  for (const r of roles) {
    if (out.length >= 3) break;
    let got = pick(r.pool().filter(s => !taken.has(s.slug)));
    if (!got) got = pick(stars.filter(s => !taken.has(s.slug)).sort(() => Math.random() - 0.5));
    if (got) { taken.add(got.slug); out.push({ slug: got.slug, role: r.role, why: r.why }); }
  }
  return out;
}

function nebulaSuggest(cradle, byId, mode) {
  const titles = cradle.map(c => (byId.get(c.slug) || {}).title).filter(Boolean);
  if (!titles.length) return '';
  if (titles.length === 1) return mode === 'connect' ? `What else in my Brain does "${titles[0]}" quietly depend on?` : `When does "${titles[0]}" stop being true?`;
  const last = titles[titles.length - 1], rest = titles.slice(0, -1).map(t => `"${t}"`).join(', ');
  return mode === 'connect' ? `What links ${rest} and "${last}" that I have not noticed?` : `If ${rest} and "${last}" are all true, what should I do differently?`;
}

function BrainNebula({ graph, onOpen, onClose }) {
  const bgRef = nUseRef(null), fgRef = nUseRef(null), wrapRef = nUseRef(null);
  const stars = nUseMemo(() => nebulaPlace(graph), [graph]);
  const byId = nUseMemo(() => new Map(stars.map(s => [s.slug, s])), [stars]);
  const edges = nUseMemo(() => graph.edges.filter(e => byId.has(e.from) && byId.has(e.to)), [graph, byId]);
  const [palette, setPalette] = nUseState(() => { try { return localStorage.getItem('todouz-nebula-palette') || 'violet'; } catch { return 'violet'; } });
  const [hover, setHover] = nUseState(null);
  const [selected, setSelected] = nUseState(null);
  const [cradle, setCradle] = nUseState([]);       // [{ slug, role, why }]
  const [mode, setMode] = nUseState('deeper');
  const [question, setQuestion] = nUseState('');
  const [edited, setEdited] = nUseState(false);
  const [busy, setBusy] = nUseState(false);
  const [toast, setToast] = nUseState('');
  const [query, setQuery] = nUseState('');
  const reduced = nUseMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }, []);
  const cam = nUseRef({ yaw: 0.4, pitch: -0.18, dist: 9, tyaw: 0.4, tpitch: -0.18, tdist: 9, tx: 0, ty: 0, tz: 0, fx: 0, fy: 0, fz: 0, drag: null, idle: 0, energy: 0 });
  const live = nUseRef({}); live.current = { hover, selected, cradle, palette, query };
  const proj = nUseRef([]);

  nUseEffect(() => { try { localStorage.setItem('todouz-nebula-palette', palette); } catch {} }, [palette]);
  nUseEffect(() => { if (!edited) setQuestion(nebulaSuggest(cradle, byId, mode)); }, [cradle, mode, edited, byId]);
  nUseEffect(() => { const k = (e) => { if (e.key === 'Escape') { if (live.current.selected) setSelected(null); else onClose(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  // Fly the camera to a star when one is chosen.
  nUseEffect(() => {
    const c = cam.current, s = selected && byId.get(selected);
    if (s) { c.tx = s.x; c.ty = s.y; c.tz = s.z; c.tdist = 4.2; c.energy = 1; } else { c.tx = c.ty = c.tz = 0; c.tdist = 9; }
  }, [selected, byId]);

  // The nebula background (WebGL, half resolution) and the stars (2D canvas).
  nUseEffect(() => {
    const bg = bgRef.current, fg = fgRef.current; if (!bg || !fg) return;
    let gl = null, prog = null, uni = {};
    try {
      gl = bg.getContext('webgl', { antialias: false, premultipliedAlpha: false });
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, NEBULA_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, NEBULA_FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['r', 'par', 't', 'attention', 'seedOffset', 'approach', 'energy', 'palette_a', 'palette_b', 'palette_c', 'palette_veil', 'palette_base']) uni[n] = gl.getUniformLocation(prog, n);
    } catch (e) { gl = null; }
    const ctx = fg.getContext('2d');
    const seed = nebulaHash(stars.map(s => s.slug).join('|')) * 40;
    let raf = 0, last = performance.now(), W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = fg.clientWidth; H = fg.clientHeight;
      fg.width = W * dpr; fg.height = H * dpr; bg.width = Math.max(1, Math.floor(W / 2)); bg.height = Math.max(1, Math.floor(H / 2));
    };
    resize(); window.addEventListener('resize', resize);
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const c = cam.current, L = live.current;
      c.idle += dt;
      if (!reduced && !c.drag && c.idle > 2.5 && !L.selected) c.tyaw += dt * 0.05;
      const k = reduced ? 1 : 1 - Math.pow(0.002, dt);
      c.yaw += (c.tyaw - c.yaw) * k; c.pitch += (c.tpitch - c.pitch) * k; c.dist += (c.tdist - c.dist) * k;
      c.fx += (c.tx - c.fx) * k; c.fy += (c.ty - c.fy) * k; c.fz += (c.tz - c.fz) * k;
      c.energy = Math.max(0, c.energy - dt * 0.6);
      const pal = NEBULA_PALETTES.find(p => p.id === L.palette) || NEBULA_PALETTES[0];
      if (gl) {
        gl.viewport(0, 0, bg.width, bg.height);
        gl.uniform2f(uni.r, bg.width, bg.height); gl.uniform2f(uni.par, c.yaw * 0.35, c.pitch * 0.35);
        gl.uniform1f(uni.t, reduced ? 0 : now / 1000); gl.uniform1f(uni.attention, L.hover || L.selected ? 1 : 0);
        gl.uniform1f(uni.seedOffset, seed); gl.uniform1f(uni.approach, Math.max(0, Math.min(1, (9 - c.dist) / 6))); gl.uniform1f(uni.energy, c.energy);
        gl.uniform3fv(uni.palette_a, pal.a); gl.uniform3fv(uni.palette_b, pal.b); gl.uniform3fv(uni.palette_c, pal.c); gl.uniform3fv(uni.palette_veil, pal.veil); gl.uniform3fv(uni.palette_base, pal.base);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // Project every star.
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const f = Math.min(W, H) * (W < 600 ? 1.3 : 0.9);
      const P = stars.map(s => {
        let x = s.x - c.fx, y = s.y - c.fy, z = s.z - c.fz;
        const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
        const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const d = z2 + c.dist;
        return { s, x: W / 2 + (x1 / d) * f, y: H / 2 + (y1 / d) * f, d, ok: d > 0.3 };
      });
      proj.current = P;
      const pi = new Map(P.map(p => [p.s.slug, p]));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!gl) { const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, '#1b1440'); g.addColorStop(1, '#03040c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      const focus = L.hover || L.selected;
      const inCradle = new Set(L.cradle.map(x => x.slug));
      const q = L.query.trim().toLowerCase();
      const near = new Set(); if (focus) { near.add(focus); for (const e of edges) { if (e.from === focus) near.add(e.to); if (e.to === focus) near.add(e.from); } }
      // Links: soft for support, bright red-amber for tension; focus lights its own.
      ctx.lineCap = 'round';
      for (const e of edges) {
        const a = pi.get(e.from), b = pi.get(e.to); if (!a.ok || !b.ok) continue;
        const m = BRAIN_REL_META[e.type] || BRAIN_REL_META.supports; const [r, g, bl] = nebulaHex(m.color);
        const mine = focus && (e.from === focus || e.to === focus);
        const both = inCradle.has(e.from) && inCradle.has(e.to);
        const base = NEBULA_TENSE.has(e.type) ? 0.42 : 0.2;
        const alpha = focus ? (mine ? 0.9 : 0.04) : both ? 0.9 : base;
        if (alpha < 0.03) continue;
        ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`; ctx.lineWidth = mine || both ? 1.8 : 1;
        ctx.setLineDash(m.dash && (mine || both) ? m.dash.split(' ').map(Number) : []);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      // Stars, far to near.
      const order = P.filter(p => p.ok).sort((a, b) => b.d - a.d);
      const tw = reduced ? 0 : now / 1000;
      for (const p of order) {
        const s = p.s, [r, g, bl] = nebulaHex((BRAIN_TYPE_META[s.type] || BRAIN_TYPE_META.note).color);
        const lit = !focus || near.has(s.slug), match = q && s.title.toLowerCase().includes(q);
        const size = (2.1 + Math.sqrt(s.deg) * 1.2) * (9 / p.d) * (s.slug === focus ? 1.6 : 1);
        const twinkle = 0.85 + 0.15 * Math.sin(tw * 1.7 + nebulaHash(s.slug) * 20);
        const a = (lit ? 1 : 0.18) * (q && !match ? 0.25 : 1) * twinkle;
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5);
        halo.addColorStop(0, `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 120)},${Math.min(255, bl + 120)},${0.95 * a})`);
        halo.addColorStop(0.25, `rgba(${r},${g},${bl},${0.45 * a})`);
        halo.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, size * 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.8, size * 0.55), 0, Math.PI * 2); ctx.fill();
        if (inCradle.has(s.slug) || match) { ctx.strokeStyle = inCradle.has(s.slug) ? 'rgba(255,214,140,0.95)' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, size * 2.2 + 4, 0, Math.PI * 2); ctx.stroke(); }
      }
      // Labels: focus and its neighbours, cradle stars, search hits, else the hubs.
      ctx.font = '500 12px ' + (T.fontBody || 'system-ui'); ctx.textAlign = 'center';
      for (const p of order) {
        const s = p.s; const show = (focus ? near.has(s.slug) : s.deg >= 3) || inCradle.has(s.slug) || (q && s.title.toLowerCase().includes(q));
        if (!show) continue;
        const t = s.title.length > 40 ? s.title.slice(0, 38) + '…' : s.title;
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(3,4,12,0.85)'; ctx.strokeText(t, p.x, p.y - 12);
        ctx.fillStyle = s.slug === focus ? '#fff' : 'rgba(225,230,245,0.88)'; ctx.fillText(t, p.x, p.y - 12);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [stars, edges, reduced]);

  const hit = (cx, cy) => {
    const box = fgRef.current.getBoundingClientRect(); const x = cx - box.left, y = cy - box.top;
    let best = null, bd = 18 * 18;
    for (const p of proj.current) { if (!p.ok) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p.s.slug; } }
    return best;
  };
  const pointers = nUseRef(new Map());
  const onDown = (e) => { fgRef.current.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const c = cam.current; c.drag = { x: e.clientX, y: e.clientY, moved: 0, pinch: null }; c.idle = 0; };
  const onMove = (e) => {
    const c = cam.current;
    if (!c.drag) { setHover(hit(e.clientX, e.clientY)); return; }
    const prev = pointers.current.get(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (c.drag.pinch) c.tdist = Math.max(2.5, Math.min(16, c.tdist * c.drag.pinch / d)); c.drag.pinch = d; c.drag.moved = 99; return;
    }
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y; c.drag.moved += Math.abs(dx) + Math.abs(dy);
    c.tyaw += dx * 0.006; c.tpitch = Math.max(-1.2, Math.min(1.2, c.tpitch + dy * 0.006)); c.idle = 0;
  };
  const onUp = (e) => {
    const c = cam.current; pointers.current.delete(e.pointerId);
    if (c.drag && c.drag.moved < 6 && pointers.current.size === 0) { const s = hit(e.clientX, e.clientY); setSelected(s); }
    if (pointers.current.size === 0) c.drag = null;
  };
  const onWheel = (e) => { const c = cam.current; c.tdist = Math.max(2.5, Math.min(16, c.tdist * Math.exp(e.deltaY * 0.0012))); c.idle = 0; };

  const addToCradle = (slug) => {
    if (cradle.some(c => c.slug === slug)) { setCradle(cradle.filter(c => c.slug !== slug)); return; }
    if (cradle.length >= 3) { flash('The Cradle holds three stars. Take one out first.'); return; }
    setCradle([...cradle, { slug, role: 'yours', why: 'you chose this one' }]);
  };
  const encounter = () => {
    if (stars.length < 2) { flash('Add a few more notes first.'); return; }
    const mine = cradle.filter(c => c.role === 'yours').map(c => c.slug).slice(0, 2);
    setCradle(nebulaEncounter(stars, edges, mine)); setEdited(false);
  };
  const incubate = async () => {
    if (!cradle.length || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/routines/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'cradle', slugs: cradle.map(c => c.slug), question: question.trim(), mode }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) flash(j.error || (r.status === 403 ? 'Only the owner can run the Cradle.' : `Could not start (HTTP ${r.status}).`));
      else { flash('Incubating. The new note will appear in your Brain and as an insight in the Feed in a few minutes.'); setCradle([]); setEdited(false); }
    } catch { flash('Offline: the Cradle needs a connection.'); }
    setBusy(false);
  };

  const sel = selected && byId.get(selected);
  const selLinks = sel ? edges.filter(e => e.from === sel.slug || e.to === sel.slug) : [];
  const ROLE = { yours: '★', tension: '⚡', hub: '◎', stranger: '✧' };
  const glass = { background: 'rgba(10,12,28,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, color: '#e6e9f5' };
  const btn = (on) => ({ fontFamily: T.fontBody, fontSize: 12.5, padding: '6px 11px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? 'rgba(255,214,140,0.8)' : 'rgba(255,255,255,0.18)'}`, background: on ? 'rgba(255,214,140,0.16)' : 'rgba(255,255,255,0.06)', color: '#eef0fa' });
  const isMobile = typeof useIsMobile === 'function' ? useIsMobile() : false;

  return (
    <div ref={wrapRef} role="dialog" aria-label="Brain nebula" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#03040c', overflow: 'hidden', fontFamily: T.fontBody }}>
      <canvas ref={bgRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={fgRef} aria-label="Your notes as stars. Drag to turn, scroll to zoom, click a star to read it." style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: hover ? 'pointer' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)} onWheel={onWheel} />

      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'none' }}>
        <div style={{ ...glass, padding: '7px 12px', fontWeight: 700, letterSpacing: '0.02em', pointerEvents: 'auto' }}>✦ Brain nebula <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6, fontSize: 12 }}>{stars.length} stars · {edges.length} links</span></div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a star…" style={{ ...glass, padding: '7px 12px', fontSize: 13, outline: 'none', width: isMobile ? 130 : 200, pointerEvents: 'auto' }} />
        <div style={{ ...glass, display: 'flex', gap: 5, padding: 5, pointerEvents: 'auto' }}>
          {NEBULA_PALETTES.map(p => <button key={p.id} title={p.name} aria-label={`${p.name} palette`} onClick={() => setPalette(p.id)} style={{ width: 20, height: 20, borderRadius: 999, border: palette === p.id ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)', background: p.swatch, cursor: 'pointer', padding: 0 }} />)}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...btn(false), pointerEvents: 'auto' }}>Close ✕</button>
      </div>

      {sel && (
        <div style={{ ...glass, position: 'absolute', top: 64, right: 12, width: isMobile ? 'calc(100% - 24px)' : 320, maxHeight: isMobile ? '40%' : '60%', overflow: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><BrainTypeBadge type={sel.type} small /><span style={{ fontSize: 11, opacity: 0.6 }}>{(BRAIN_STATUS_META[sel.status] || {}).icon} {sel.status} · {brainAgo(sel.updated)}</span></div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>{sel.title}</div>
          {selLinks.length > 0 && <div style={{ fontSize: 12.5, lineHeight: 1.45, display: 'grid', gap: 6, marginBottom: 10 }}>
            {selLinks.slice(0, 8).map(e => { const other = byId.get(e.from === sel.slug ? e.to : e.from), m = BRAIN_REL_META[e.type] || BRAIN_REL_META.supports; return (
              <div key={e.id}><span style={{ color: m.color, fontWeight: 700 }}>{m.icon} {m.label}</span> <button onClick={() => setSelected(other.slug)} style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>{other.title}</button>
                {e.insight && <div style={{ opacity: 0.7 }}>{e.insight}</div>}</div>); })}
          </div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => onOpen(sel.slug)} style={btn(false)}>Read note</button>
            <button onClick={() => addToCradle(sel.slug)} style={btn(cradle.some(c => c.slug === sel.slug))}>{cradle.some(c => c.slug === sel.slug) ? 'In the Cradle ✓' : 'Add to Cradle'}</button>
          </div>
        </div>
      )}

      <div style={{ ...glass, position: 'absolute', left: 12, bottom: 12, width: isMobile ? 'calc(100% - 24px)' : 420, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <b style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>🌙 Cradle</b><span style={{ fontSize: 11.5, opacity: 0.65, flex: 1, minWidth: 0 }}>let a few stars meet</span>
          <button onClick={encounter} style={{ ...btn(false), whiteSpace: 'nowrap' }} title="Draw three stars: one under tension, one hub, one stranger">✦ Encounter</button>
        </div>
        {cradle.length === 0 ? <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.45 }}>Click a star and press Add to Cradle, or press Encounter to draw three.</div> : (
          <div style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
            {cradle.map(c => { const s = byId.get(c.slug); if (!s) return null; return (
              <div key={c.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span title={c.why} style={{ width: 18, textAlign: 'center', color: '#ffd68c' }}>{ROLE[c.role] || '★'}</span>
                <button onClick={() => setSelected(c.slug)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</button>
                {!isMobile && <span style={{ fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' }}>{c.why}</span>}
                <button aria-label="Take out" onClick={() => setCradle(cradle.filter(x => x.slug !== c.slug))} style={{ background: 'none', border: 'none', color: '#fff', opacity: 0.6, cursor: 'pointer' }}>✕</button>
              </div>); })}
          </div>
        )}
        {cradle.length > 0 && <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={() => setMode('deeper')} style={btn(mode === 'deeper')}>Think deeper</button>
            <button onClick={() => setMode('connect')} style={btn(mode === 'connect')}>Find the link</button>
          </div>
          <textarea value={question} onChange={e => { setQuestion(e.target.value); setEdited(true); }} rows={2} placeholder="Your question (optional)"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: 8, fontFamily: 'inherit', fontSize: 12.5 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button onClick={incubate} disabled={busy} style={{ ...btn(true), fontWeight: 700 }}>{busy ? 'Starting…' : 'Incubate ✦'}</button>
            {edited && <button onClick={() => setEdited(false)} style={{ ...btn(false), fontSize: 11.5 }}>Suggest a question</button>}
          </div>
        </>}
      </div>

      {!isMobile && <div style={{ position: 'absolute', right: 14, bottom: 14, fontSize: 11, color: 'rgba(230,233,245,0.55)' }}>drag to turn · scroll to zoom · click a star · Esc to close</div>}
      {toast && <div style={{ ...glass, position: 'absolute', left: '50%', top: 64, transform: 'translateX(-50%)', padding: '9px 14px', fontSize: 13, maxWidth: 'calc(100% - 40px)' }}>{toast}</div>}
    </div>
  );
}
