'use strict';

/* ================= 全局状态 ================= */
const PALETTE = ['#2f9e44', '#1971c2', '#e8590c', '#9c36b5', '#c2255c', '#0c8599', '#5f3dc4', '#b0891c'];
let nextId = 1;
const uid = () => 'id' + (nextId++);

const state = {
  room: { width: 6.5, depth: 8.0, height: 2.8, margin: 0.3 },
  screen: { width: 2.2, height: 1.24, bottom: 0.9, cx: 3.25 },
  schemes: [],
  obstacles: [],
  selectedSchemeId: null,
  selectedObstacleId: null,
  point: { x: 3.25, y: 3.6 },     // 镜头安装点（顶视图坐标）
  lensHeight: 1.55,               // 镜头高度
  showAll: true,
  drawMode: false,
};

let result = null;                // 最近一次服务器计算结果
let resultById = {};
let drag = null;                  // 当前拖拽会话
let examples = [];

/* ================= 工具 ================= */
const SVGNS = 'http://www.w3.org/2000/svg';
const topSvg = document.getElementById('topView');
const sideSvg = document.getElementById('sideView');

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v, d = 2) => Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function svgWorld(svg, e) {
  const pt = new DOMPoint(e.clientX, e.clientY);
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function colorOf(id) {
  const i = state.schemes.findIndex(s => s.id === id);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}
function currentScheme() {
  return state.schemes.find(s => s.id === state.selectedSchemeId) || null;
}

/* ================= 数据清洗 ================= */
function sanitize() {
  const r = state.room, s = state.screen;
  r.width = clamp(r.width, 1, 30);
  r.depth = clamp(r.depth, 1, 40);
  r.height = clamp(r.height, 1.8, 10);
  r.margin = clamp(r.margin, 0, Math.min(r.width, r.depth) / 2 - 0.01);
  s.width = clamp(s.width, 0.5, r.width);
  s.height = clamp(s.height, 0.4, r.height);
  s.bottom = clamp(s.bottom, 0, r.height - s.height);
  s.cx = clamp(s.cx, s.width / 2, r.width - s.width / 2);
  for (const sch of state.schemes) {
    sch.tr_min = clamp(sch.tr_min, 0.1, 10);
    sch.tr_max = clamp(sch.tr_max, 0.1, 10);
    if (sch.tr_min > sch.tr_max) [sch.tr_min, sch.tr_max] = [sch.tr_max, sch.tr_min];
    sch.h_shift = clamp(sch.h_shift, 0, 1.5);
    sch.v_shift = clamp(sch.v_shift, 0, 1.5);
    sch.body_w = clamp(sch.body_w, 0.1, 2);
    sch.body_d = clamp(sch.body_d, 0.1, 2);
    sch.body_h = clamp(sch.body_h, 0.05, 1.5);
  }
  for (const ob of state.obstacles) {
    ob.w = clamp(ob.w, 0.1, r.width);
    ob.h = clamp(ob.h, 0.1, r.depth);
    ob.x = clamp(ob.x, 0, r.width - ob.w);
    ob.y = clamp(ob.y, 0, r.depth - ob.h);
  }
  state.point.x = clamp(state.point.x, 0, r.width);
  state.point.y = clamp(state.point.y, 0, r.depth);
  state.lensHeight = clamp(state.lensHeight, 0, r.height);
  // 镜头高度夹取到当前方案可行范围（依据最近一次计算）
  const sel = resultById[state.selectedSchemeId];
  if (sel && sel.ranges.z) {
    state.lensHeight = clamp(state.lensHeight, sel.ranges.z[0], sel.ranges.z[1]);
  }
}

/* ================= 服务器计算 ================= */
let computeTimer = null, computeSeq = 0;
function scheduleCompute() {
  clearTimeout(computeTimer);
  computeTimer = setTimeout(doCompute, 40);
}
async function doCompute() {
  const seq = ++computeSeq;
  const payload = {
    room: state.room, screen: state.screen, schemes: state.schemes,
    obstacles: state.obstacles, point: state.point, lens_height: state.lensHeight,
  };
  try {
    const res = await fetch('/api/compute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok || seq !== computeSeq) return;
    result = await res.json();
    resultById = {};
    for (const s of result.schemes) resultById[s.id] = s;
    render();
  } catch (err) { /* 网络异常时保留旧结果 */ }
}
function onStateChange() {
  render();
  scheduleCompute();
}

/* ================= SVG 公共件 ================= */
function addDefs(svg, suffix) {
  const defs = el('defs', {}, svg);
  const mk = el('marker', {
    id: 'arrow' + suffix, viewBox: '0 0 10 10', refX: 8, refY: 5,
    markerWidth: 0.13, markerHeight: 0.13, markerUnits: 'userSpaceOnUse',
    orient: 'auto-start-reverse',
  }, defs);
  el('path', { d: 'M 0 1 L 9 5 L 0 9 z', fill: '#868e96' }, mk);
  const pat = el('pattern', {
    id: 'hatch' + suffix, width: 0.14, height: 0.14,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  }, defs);
  el('rect', { width: 0.14, height: 0.14, fill: 'rgba(224,49,49,0.10)' }, pat);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 0.14, stroke: 'rgba(224,49,49,0.55)', 'stroke-width': 0.035 }, pat);
}

function textAt(svg, x, y, str, size = 0.13, fill = '#495057', anchor = 'middle') {
  const t = el('text', {
    x, y, 'font-size': size, fill, 'text-anchor': anchor,
    'dominant-baseline': 'middle', class: 'halo',
  }, svg);
  t.textContent = str;
  return t;
}

/* 线性尺寸标注：测量 (x1,y1)-(x2,y2)，沿法向偏移 off 绘制 */
function drawDim(svg, x1, y1, x2, y2, off, label, suffix) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = -dy / len, ny = dx / len;
  const ax = x1 + nx * off, ay = y1 + ny * off;
  const bx = x2 + nx * off, by = y2 + ny * off;
  const g = el('g', { class: 'dim' }, svg);
  const c = '#868e96';
  el('line', { x1, y1, x2: ax, y2: ay, stroke: c, 'stroke-width': 0.008 }, g);
  el('line', { x1: x2, y1: y2, x2: bx, y2: by, stroke: c, 'stroke-width': 0.008 }, g);
  el('line', {
    x1: ax, y1: ay, x2: bx, y2: by, stroke: c, 'stroke-width': 0.012,
    'marker-start': `url(#arrow${suffix})`, 'marker-end': `url(#arrow${suffix})`,
  }, g);
  textAt(g, (ax + bx) / 2, (ay + by) / 2 - 0.02, label, 0.13, '#495057');
}

/* ================= 顶视图 ================= */
const TOP_PAD = { l: 1.15, t: 0.85, r: 1.05, b: 0.95 };

function renderTop() {
  const svg = topSvg;
  svg.innerHTML = '';
  const { width: W, depth: D, margin: m } = state.room;
  const s = state.screen;
  svg.setAttribute('viewBox', `${-TOP_PAD.l} ${-TOP_PAD.t} ${W + TOP_PAD.l + TOP_PAD.r} ${D + TOP_PAD.t + TOP_PAD.b}`);
  addDefs(svg, 'T');

  // 房间与 1m 网格
  el('rect', { x: 0, y: 0, width: W, height: D, fill: '#fbfcfd', stroke: '#343a40', 'stroke-width': 0.03 }, svg);
  for (let gx = 1; gx < W; gx++) el('line', { x1: gx, y1: 0, x2: gx, y2: D, stroke: '#eef1f3', 'stroke-width': 0.01 }, svg);
  for (let gy = 1; gy < D; gy++) el('line', { x1: 0, y1: gy, x2: W, y2: gy, stroke: '#eef1f3', 'stroke-width': 0.01 }, svg);
  // 墙面余量
  if (m > 0.001) {
    el('rect', {
      x: m, y: m, width: W - 2 * m, height: D - 2 * m, fill: 'none',
      stroke: '#adb5bd', 'stroke-width': 0.012, 'stroke-dasharray': '0.09 0.05',
    }, svg);
    textAt(svg, W - m - 0.06, m + 0.12, `墙面余量 ${fmt(m)}m`, 0.11, '#868e96', 'end');
  }
  // 幕布中心线
  el('line', { x1: s.cx, y1: 0, x2: s.cx, y2: D, stroke: '#e9ecef', 'stroke-width': 0.012, 'stroke-dasharray': '0.1 0.06' }, svg);

  // 各方案可安装区域
  if (result) {
    const ordered = [...result.schemes].sort((a, b) => (a.id === state.selectedSchemeId ? 1 : 0) - (b.id === state.selectedSchemeId ? 1 : 0));
    for (const sr of ordered) {
      const isSel = sr.id === state.selectedSchemeId;
      if (!isSel && !state.showAll) continue;
      const color = colorOf(sr.id);
      for (const r of sr.region) {
        if (r[2] - r[0] <= 1e-6 && r[3] - r[1] > 1e-6) {
          // 退化可行域：固定 x 的安装线段，画成粗线段
          el('line', {
            x1: r[0], y1: r[1], x2: r[2], y2: r[3],
            stroke: color, 'stroke-width': isSel ? 0.07 : 0.05,
            'stroke-linecap': 'round',
            'stroke-opacity': isSel ? 0.95 : 0.55,
          }, svg);
          if (isSel) {
            for (const yy of [r[1], r[3]]) {
              el('line', {
                x1: r[0] - 0.1, y1: yy, x2: r[0] + 0.1, y2: yy,
                stroke: color, 'stroke-width': 0.02, 'stroke-opacity': 0.9,
              }, svg);
            }
          }
        } else {
          el('rect', {
            x: r[0], y: r[1], width: Math.max(0, r[2] - r[0]), height: Math.max(0, r[3] - r[1]),
            fill: color, 'fill-opacity': isSel ? 0.30 : 0.10,
            stroke: color, 'stroke-width': isSel ? 0.02 : 0.01,
            'stroke-opacity': isSel ? 0.95 : 0.45,
          }, svg);
        }
      }
    }
    // 选中方案：基础交集矩形 + 投射距离边界线
    const sel = resultById[state.selectedSchemeId];
    if (sel) {
      const color = colorOf(sel.id);
      if (sel.base_rect) {
        const b = sel.base_rect;
        el('rect', {
          x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], fill: 'none',
          stroke: color, 'stroke-width': 0.018, 'stroke-dasharray': '0.1 0.05', 'stroke-opacity': 0.8,
        }, svg);
      }
      for (const [yy, lbl] of [[sel.derived.d_min, `最近投射 ${fmt(sel.derived.d_min)}m`],
                               [sel.derived.d_max, `最远投射 ${fmt(sel.derived.d_max)}m`]]) {
        if (yy > 0.01 && yy < D - 0.01) {
          el('line', { x1: 0, y1: yy, x2: W, y2: yy, stroke: color, 'stroke-width': 0.014, 'stroke-dasharray': '0.14 0.07', 'stroke-opacity': 0.7 }, svg);
          textAt(svg, 0.06, yy - 0.1, lbl, 0.11, color, 'start');
        }
      }
      // 安装线方案：标注扣除障碍后的可行总长度
      if (sel.domain === 'line' && sel.line_length > 0 && sel.region.length) {
        const f = sel.region[0];
        textAt(svg, f[0] + 0.14, (f[1] + f[3]) / 2,
          `安装线可行长度 ${fmt(sel.line_length)} m`, 0.12, color, 'start');
      }
    }
  }

  // 投射包络（选中方案 + 当前选点）
  const sch = currentScheme();
  const sel = resultById[state.selectedSchemeId];
  const p = state.point;
  if (sch && sel) {
    el('polygon', {
      points: `${p.x},${p.y} ${s.cx - s.width / 2},0 ${s.cx + s.width / 2},0`,
      fill: 'rgba(25,113,194,0.08)', stroke: '#1971c2',
      'stroke-width': 0.014, 'stroke-dasharray': '0.07 0.05',
    }, svg);
  }

  // 禁装区
  for (const ob of state.obstacles) {
    const isSel = ob.id === state.selectedObstacleId;
    const g = el('g', {}, svg);
    const rect = el('rect', {
      x: ob.x, y: ob.y, width: ob.w, height: ob.h,
      fill: 'url(#hatchT)', stroke: '#e03131',
      'stroke-width': isSel ? 0.03 : 0.018, class: 'ob-rect',
    }, g);
    rect.addEventListener('pointerdown', e => {
      state.selectedObstacleId = ob.id;
      const w = svgWorld(svg, e);
      startDrag(e, { type: 'ob', id: ob.id, dx: w.x - ob.x, dy: w.y - ob.y });
      onStateChange();
    });
    textAt(g, ob.x + ob.w / 2, ob.y + ob.h / 2 - 0.08, ob.name, 0.12, '#c92a2a');
    textAt(g, ob.x + ob.w / 2, ob.y + ob.h / 2 + 0.08, `${fmt(ob.w)}×${fmt(ob.h)}m`, 0.1, '#c92a2a');
    if (isSel) {
      const h = el('circle', { cx: ob.x + ob.w, cy: ob.y + ob.h, r: 0.08, class: 'resize-handle' }, g);
      h.addEventListener('pointerdown', e => startDrag(e, { type: 'obresize', id: ob.id }));
    }
  }

  // 绘制中的禁装区预览
  if (drag && drag.type === 'draw') {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    el('rect', {
      x, y, width: w, height: h, fill: 'rgba(224,49,49,0.15)',
      stroke: '#e03131', 'stroke-width': 0.02, 'stroke-dasharray': '0.08 0.05',
    }, svg);
    textAt(svg, x + w / 2, y + h / 2, `${fmt(w)}×${fmt(h)}m`, 0.12, '#c92a2a');
  }

  // 幕布（可拖动）
  const scrHit = el('rect', {
    x: s.cx - s.width / 2, y: -0.14, width: s.width, height: 0.2,
    fill: '#1864ab', 'fill-opacity': 0.18, class: 'screen-hit',
  }, svg);
  scrHit.addEventListener('pointerdown', e => {
    const w = svgWorld(svg, e);
    startDrag(e, { type: 'screen', dx: w.x - s.cx });
  });
  el('rect', { x: s.cx - s.width / 2, y: -0.07, width: s.width, height: 0.07, fill: '#1864ab', class: 'screen-core' }, svg)
    .addEventListener('pointerdown', e => {
      const w = svgWorld(svg, e);
      startDrag(e, { type: 'screen', dx: w.x - s.cx });
    });
  textAt(svg, s.cx, -0.28, '幕布', 0.12, '#1864ab');

  // 机身 + 镜头选点
  if (sch && sel) {
    const ok = sel.point && sel.point.ok;
    el('rect', {
      x: p.x - sch.body_w / 2, y: p.y, width: sch.body_w, height: sch.body_d,
      fill: ok ? 'rgba(47,158,68,0.45)' : 'rgba(224,49,49,0.45)',
      stroke: ok ? '#2b8a3e' : '#e03131', 'stroke-width': 0.02,
    }, svg);
    const g = el('g', { class: 'point-handle' }, svg);
    el('circle', { cx: p.x, cy: p.y, r: 0.09, fill: 'rgba(25,113,194,0.25)' }, g);
    el('circle', { cx: p.x, cy: p.y, r: 0.05, fill: '#fff', stroke: '#1971c2', 'stroke-width': 0.025 }, g);
    g.addEventListener('pointerdown', e => startDrag(e, { type: 'point' }));
    textAt(svg, p.x + 0.14, p.y - 0.12, '镜头', 0.11, '#1971c2', 'start');
    // 选点边界尺寸
    drawDim(svg, 0, p.y, p.x, p.y, -0.26, `x=${fmt(p.x)}m`, 'T');
    drawDim(svg, p.x, 0, p.x, p.y, 0.26, `L=${fmt(p.y)}m`, 'T');
  }

  // 房间与幕布尺寸
  drawDim(svg, 0, D, W, D, 0.42, `房间宽 ${fmt(W)} m`, 'T');
  drawDim(svg, W, 0, W, D, -0.42, `进深 ${fmt(D)} m`, 'T');
  drawDim(svg, s.cx - s.width / 2, 0, s.cx + s.width / 2, 0, -0.5, `幕宽 ${fmt(s.width)} m`, 'T');
}

/* ================= 侧视图 ================= */
const SIDE_PAD = { l: 1.15, t: 0.55, r: 1.05, b: 1.15 };

function renderSide() {
  const svg = sideSvg;
  svg.innerHTML = '';
  const { depth: D, height: H } = state.room;
  const s = state.screen;
  svg.setAttribute('viewBox', `${-SIDE_PAD.l} ${-SIDE_PAD.t} ${D + SIDE_PAD.l + SIDE_PAD.r} ${H + SIDE_PAD.t + SIDE_PAD.b}`);
  addDefs(svg, 'S');
  const Z = z => H - z;

  el('rect', { x: 0, y: 0, width: D, height: H, fill: '#fbfcfd', stroke: '#343a40', 'stroke-width': 0.03 }, svg);
  el('line', { x1: 0, y1: H, x2: D, y2: H, stroke: '#343a40', 'stroke-width': 0.045 }, svg);
  textAt(svg, 0.06, -0.16, '幕布墙', 0.12, '#868e96', 'start');
  textAt(svg, D - 0.06, -0.16, '后墙', 0.12, '#868e96', 'end');
  textAt(svg, D - 0.06, H - 0.12, '地面', 0.11, '#868e96', 'end');

  // 禁装区（全高障碍带）
  for (const ob of state.obstacles) {
    el('rect', {
      x: ob.y, y: 0, width: ob.h, height: H,
      fill: 'url(#hatchS)', stroke: '#e03131', 'stroke-width': 0.012, 'stroke-opacity': 0.6,
    }, svg);
    textAt(svg, ob.y + ob.h / 2, 0.14, ob.name, 0.1, '#c92a2a');
  }

  // 各方案侧视可行域（投射距离 × 镜头高度）
  if (result) {
    const ordered = [...result.schemes].sort((a, b) => (a.id === state.selectedSchemeId ? 1 : 0) - (b.id === state.selectedSchemeId ? 1 : 0));
    for (const sr of ordered) {
      const isSel = sr.id === state.selectedSchemeId;
      if (!isSel && !state.showAll) continue;
      if (!sr.ranges.y || !sr.ranges.z) continue;
      const color = colorOf(sr.id);
      const [y1, y2] = sr.ranges.y, [z1, z2] = sr.ranges.z;
      el('rect', {
        x: y1, y: Z(z2), width: Math.max(0, y2 - y1), height: Math.max(0, z2 - z1),
        fill: color, 'fill-opacity': isSel ? 0.26 : 0.09,
        stroke: color, 'stroke-width': isSel ? 0.018 : 0.01,
        'stroke-opacity': isSel ? 0.9 : 0.4,
      }, svg);
    }
  }

  // 幕布
  el('rect', { x: -0.06, y: Z(s.bottom + s.height), width: 0.06, height: s.height, fill: '#1864ab' }, svg);
  drawDim(svg, 0, Z(0), 0, Z(s.bottom), -0.3, `下沿 ${fmt(s.bottom)}m`, 'S');
  drawDim(svg, 0, Z(s.bottom), 0, Z(s.bottom + s.height), -0.3, `幕高 ${fmt(s.height)}m`, 'S');

  // 投影机（镜头 + 机身，可拖动）
  const sch = currentScheme();
  const sel = resultById[state.selectedSchemeId];
  const p = state.point;
  const hz = state.lensHeight;
  if (sch && sel) {
    const ok = sel.point && sel.point.ok;
    // 投射包络
    el('line', { x1: p.y, y1: Z(hz), x2: 0, y2: Z(s.bottom + s.height), stroke: '#1971c2', 'stroke-width': 0.014, 'stroke-dasharray': '0.07 0.05' }, svg);
    el('line', { x1: p.y, y1: Z(hz), x2: 0, y2: Z(s.bottom), stroke: '#1971c2', 'stroke-width': 0.014, 'stroke-dasharray': '0.07 0.05' }, svg);
    // 机身（镜头在前表面，机身向后延伸）
    const body = el('rect', {
      x: p.y, y: Z(hz + sch.body_h / 2), width: sch.body_d, height: sch.body_h,
      fill: ok ? 'rgba(47,158,68,0.45)' : 'rgba(224,49,49,0.45)',
      stroke: ok ? '#2b8a3e' : '#e03131', 'stroke-width': 0.02, class: 'side-body',
    }, svg);
    body.addEventListener('pointerdown', e => startDrag(e, { type: 'sidepoint' }));
    const lens = el('g', { class: 'point-handle' }, svg);
    el('circle', { cx: p.y, cy: Z(hz), r: 0.08, fill: 'rgba(25,113,194,0.3)' }, lens);
    el('circle', { cx: p.y, cy: Z(hz), r: 0.045, fill: '#fff', stroke: '#1971c2', 'stroke-width': 0.022 }, lens);
    lens.addEventListener('pointerdown', e => startDrag(e, { type: 'sidepoint' }));
    textAt(svg, p.y + 0.12, Z(hz) - 0.14, '镜头', 0.11, '#1971c2', 'start');
    // 选点边界尺寸
    drawDim(svg, p.y, Z(0), p.y, Z(hz), 0.3, `h=${fmt(hz)}m`, 'S');
    drawDim(svg, 0, H, p.y, H, 0.38, `L=${fmt(p.y)}m`, 'S');
  }

  // 房间尺寸
  drawDim(svg, 0, H, D, H, 0.78, `进深 ${fmt(D)} m`, 'S');
  drawDim(svg, D, 0, D, H, -0.42, `净高 ${fmt(H)} m`, 'S');
}

/* ================= 面板动态区 ================= */
function renderSchemeList() {
  const ul = document.getElementById('schemeList');
  ul.innerHTML = '';
  const items = state.schemes.map(sch => ({ sch, r: resultById[sch.id] }));
  // 可行方案排在不可行前；可行方案内普通二维区域（按面积降序）在前、退化安装线（按可行长度降序）在后
  const rankOf = r => (!r || !r.feasible) ? 2 : (r.domain === 'line' ? 1 : 0);
  const metricOf = r => (!r || !r.feasible) ? 0 : (r.domain === 'line' ? r.line_length : r.area);
  items.sort((a, b) => {
    const ra = rankOf(a.r), rb = rankOf(b.r);
    if (ra !== rb) return ra - rb;
    return metricOf(b.r) - metricOf(a.r);
  });
  items.forEach(({ sch, r }, i) => {
    const li = document.createElement('li');
    li.className = 'scheme-item' + (sch.id === state.selectedSchemeId ? ' selected' : '');
    const feasible = r && r.feasible;
    let areaTxt;
    if (!r) areaTxt = '…';
    else if (feasible && r.domain === 'line') areaTxt = `安装线 ${fmt(r.line_length)} m`;
    else if (feasible) areaTxt = `${fmt(r.area)} m²`;
    else areaTxt = '不可行';
    li.innerHTML =
      `<span class="rank">${i + 1}</span>` +
      `<span class="chip" style="background:${colorOf(sch.id)}"></span>` +
      `<span class="name" title="${esc(sch.name)}">${esc(sch.name)}</span>` +
      `<span class="tr">TR ${sch.tr_min}–${sch.tr_max}</span>` +
      `<span class="area ${feasible ? '' : 'bad'}">${areaTxt}</span>`;
    if (r && !feasible && r.diagnostics.length) li.title = r.diagnostics.join('\n');
    li.addEventListener('click', () => { state.selectedSchemeId = sch.id; onStateChange(); });
    ul.appendChild(li);
  });
  document.getElementById('delSchemeBtn').disabled = state.schemes.length <= 1;
  document.getElementById('schemeEditorCard').style.display = currentScheme() ? '' : 'none';
}

function renderObstacleList() {
  const ul = document.getElementById('obstacleList');
  ul.innerHTML = '';
  for (const ob of state.obstacles) {
    const li = document.createElement('li');
    li.className = 'ob-item' + (ob.id === state.selectedObstacleId ? ' selected' : '');
    li.innerHTML = `<span class="ob-dot"></span><span>${esc(ob.name)}</span>` +
      `<span class="dim">${fmt(ob.w)}×${fmt(ob.h)}m @ (${fmt(ob.x)}, ${fmt(ob.y)})</span>`;
    li.addEventListener('click', () => { state.selectedObstacleId = ob.id; render(); });
    ul.appendChild(li);
  }
  if (!state.obstacles.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = '暂无禁装区';
    ul.appendChild(li);
  }
  document.getElementById('delObstacleBtn').disabled = !state.selectedObstacleId;
}

function renderPointInfo() {
  const box = document.getElementById('pointInfo');
  const sch = currentScheme();
  const sel = resultById[state.selectedSchemeId];
  if (!sch || !sel) {
    box.innerHTML = '<h2>选点与约束</h2><p class="hint">请添加并选择镜头方案</p>';
    return;
  }
  let html = `<h2>选点与约束 — ${esc(sel.name)}</h2>`;
  if (sel.diagnostics.length) {
    html += `<div class="diag-box"><b>⚠ 可安装区域为空，冲突约束：</b><ul>` +
      sel.diagnostics.map(d => `<li>${esc(d)}</li>`).join('') + '</ul></div>';
  } else if (sel.feasible) {
    if (sel.domain === 'line') {
      html += `<div class="ok-box">✅ 水平位移为 0，退化为固定 x=<b>${fmt(sel.base_rect[0])}m</b> 的安装线，` +
        `扣除禁装区后可行纵深合计 <b>${fmt(sel.line_length)} m</b>（面积为 0 但仍可沿线安放）</div>`;
    } else {
      html += `<div class="ok-box">✅ 可安装区域面积 <b>${fmt(sel.area)} m²</b>（镜头位置）</div>`;
    }
  }
  const p = sel.point;
  if (p) {
    const zr = sel.ranges.z;
    const rows = [
      ['投射距离', p.checks.throw,
        `L=${fmt(p.throw_distance)}m → 投射比 ${fmt(p.throw_ratio)}（要求 ${sch.tr_min}–${sch.tr_max}）`],
      ['水平位移', p.checks.shift,
        `偏移 ${fmt(p.h_shift_used * state.screen.width)}m＝${fmt(p.h_shift_used * 100, 0)}% 幕宽（允许 ±${fmt(sch.h_shift * 100, 0)}%）`],
      ['墙面余量', p.checks.wall,
        p.checks.wall ? '机身与四墙余量满足' : '机身越出墙面余量边界'],
      ['机身避障', p.checks.obstacle,
        p.checks.obstacle ? '未触碰禁装区' : `与禁装区「${esc(p.obstacle_hit || '')}」相交`],
      ['镜头高度', p.checks.height,
        `h=${fmt(p.z)}m＝位移 ${fmt(p.v_shift_used * 100, 0)}% 幕高` +
        (zr ? `（允许 ${fmt(zr[0])}–${fmt(zr[1])}m）` : '（垂直方向无解）')],
    ];
    html += '<table class="checks">' + rows.map(([name, ok, txt]) =>
      `<tr><td class="ico">${ok ? '✅' : '❌'}</td><td class="cname">${name}</td><td>${txt}</td></tr>`).join('') +
      '</table>';
    html += p.ok
      ? '<div class="ok-box">✅ 当前选点可安装</div>'
      : '<div class="diag-box">❌ 当前选点不可安装（见上方 ✗ 项）</div>';
  }
  box.innerHTML = html;
}

/* ================= 输入绑定 ================= */
const numBindings = [];
function bindNum(id, get, set, digits = 2) {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) { set(v); onStateChange(); }
  });
  numBindings.push([input, get, digits]);
}

function syncInputs() {
  for (const [input, get, digits] of numBindings) {
    if (document.activeElement !== input) input.value = fmt(get(), digits);
  }
  const sch = currentScheme();
  document.getElementById('schName').value = sch ? sch.name : '';
  // 镜头高度滑块
  const slider = document.getElementById('lensHeight');
  const sel = resultById[state.selectedSchemeId];
  const lo = sel && sel.ranges.z ? sel.ranges.z[0] : 0;
  const hi = sel && sel.ranges.z ? sel.ranges.z[1] : state.room.height;
  slider.min = lo.toFixed(2);
  slider.max = hi.toFixed(2);
  if (document.activeElement !== slider) slider.value = state.lensHeight;
  document.getElementById('lensHeightVal').textContent = fmt(state.lensHeight) + ' m';
  const hint = document.getElementById('lensHeightHint');
  if (sel && sel.ranges.z) {
    hint.textContent = `允许 ${fmt(lo)}–${fmt(hi)} m（幕布中心 ${fmt(sel.derived.sc)}m，垂直位移 ±${fmt(sch.v_shift * 100, 0)}%）`;
    hint.className = 'hint';
  } else if (sel) {
    hint.textContent = '⚠ 该方案垂直方向无可行高度';
    hint.className = 'hint warn';
  } else {
    hint.textContent = '';
  }
}

function bindAllInputs() {
  const R = () => state.room, S = () => state.screen;
  bindNum('roomWidth', () => R().width, v => R().width = v);
  bindNum('roomDepth', () => R().depth, v => R().depth = v);
  bindNum('roomHeight', () => R().height, v => R().height = v);
  bindNum('roomMargin', () => R().margin, v => R().margin = v);
  bindNum('screenWidth', () => S().width, v => S().width = v);
  bindNum('screenHeight', () => S().height, v => S().height = v);
  bindNum('screenBottom', () => S().bottom, v => S().bottom = v);
  bindNum('screenCx', () => S().cx, v => S().cx = v);
  bindNum('schTrMin', () => currentScheme()?.tr_min ?? 0, v => { const s = currentScheme(); if (s) s.tr_min = v; });
  bindNum('schTrMax', () => currentScheme()?.tr_max ?? 0, v => { const s = currentScheme(); if (s) s.tr_max = v; });
  bindNum('schHShift', () => (currentScheme()?.h_shift ?? 0) * 100, v => { const s = currentScheme(); if (s) s.h_shift = v / 100; }, 0);
  bindNum('schVShift', () => (currentScheme()?.v_shift ?? 0) * 100, v => { const s = currentScheme(); if (s) s.v_shift = v / 100; }, 0);
  bindNum('schBodyW', () => currentScheme()?.body_w ?? 0, v => { const s = currentScheme(); if (s) s.body_w = v; });
  bindNum('schBodyD', () => currentScheme()?.body_d ?? 0, v => { const s = currentScheme(); if (s) s.body_d = v; });
  bindNum('schBodyH', () => currentScheme()?.body_h ?? 0, v => { const s = currentScheme(); if (s) s.body_h = v; });

  document.getElementById('schName').addEventListener('input', e => {
    const s = currentScheme();
    if (s) { s.name = e.target.value; renderSchemeList(); scheduleCompute(); }
  });
  document.getElementById('lensHeight').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) { state.lensHeight = v; onStateChange(); }
  });
  document.getElementById('showAll').addEventListener('change', e => {
    state.showAll = e.target.checked;
    render();
  });
  document.getElementById('addSchemeBtn').addEventListener('click', () => {
    const s = {
      id: uid(), name: `方案 ${state.schemes.length + 1}`,
      tr_min: 1.2, tr_max: 1.9, h_shift: 0.25, v_shift: 0.4,
      body_w: 0.4, body_d: 0.32, body_h: 0.15,
    };
    state.schemes.push(s);
    state.selectedSchemeId = s.id;
    onStateChange();
  });
  document.getElementById('delSchemeBtn').addEventListener('click', () => {
    if (state.schemes.length <= 1) return;
    state.schemes = state.schemes.filter(s => s.id !== state.selectedSchemeId);
    state.selectedSchemeId = state.schemes[0].id;
    onStateChange();
  });
  const drawBtn = document.getElementById('drawBtn');
  drawBtn.addEventListener('click', () => {
    state.drawMode = !state.drawMode;
    drawBtn.classList.toggle('active', state.drawMode);
    topSvg.classList.toggle('drawing', state.drawMode);
  });
  document.getElementById('delObstacleBtn').addEventListener('click', deleteSelectedObstacle);
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedObstacleId) {
      deleteSelectedObstacle();
    } else if (e.key === 'Escape') {
      state.drawMode = false;
      state.selectedObstacleId = null;
      drawBtn.classList.remove('active');
      topSvg.classList.remove('drawing');
      onStateChange();
    }
  });
}

function deleteSelectedObstacle() {
  if (!state.selectedObstacleId) return;
  state.obstacles = state.obstacles.filter(o => o.id !== state.selectedObstacleId);
  state.selectedObstacleId = null;
  onStateChange();
}

/* ================= 视图交互 ================= */
function startDrag(e, info) {
  drag = info;
  e.stopPropagation();
  e.preventDefault();
}

function attachViewHandlers() {
  topSvg.addEventListener('pointerdown', e => {
    const p = svgWorld(topSvg, e);
    const W = state.room.width, D = state.room.depth;
    if (state.drawMode) {
      drag = { type: 'draw', x0: clamp(p.x, 0, W), y0: clamp(p.y, 0, D), x1: clamp(p.x, 0, W), y1: clamp(p.y, 0, D) };
    } else {
      state.point.x = clamp(p.x, 0, W);
      state.point.y = clamp(p.y, 0, D);
      drag = { type: 'point' };
    }
    onStateChange();
  });
  sideSvg.addEventListener('pointerdown', e => {
    const p = svgWorld(sideSvg, e);
    state.point.y = clamp(p.x, 0, state.room.depth);
    state.lensHeight = clamp(state.room.height - p.y, 0, state.room.height);
    drag = { type: 'sidepoint' };
    onStateChange();
  });

  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.type === 'sidepoint') {
      const p = svgWorld(sideSvg, e);
      state.point.y = clamp(p.x, 0, state.room.depth);
      state.lensHeight = clamp(state.room.height - p.y, 0, state.room.height);
    } else {
      const p = svgWorld(topSvg, e);
      const W = state.room.width, D = state.room.depth;
      if (drag.type === 'point') {
        state.point.x = clamp(p.x, 0, W);
        state.point.y = clamp(p.y, 0, D);
      } else if (drag.type === 'screen') {
        state.screen.cx = clamp(p.x - drag.dx, state.screen.width / 2, W - state.screen.width / 2);
      } else if (drag.type === 'ob') {
        const ob = state.obstacles.find(o => o.id === drag.id);
        if (ob) {
          ob.x = clamp(p.x - drag.dx, 0, W - ob.w);
          ob.y = clamp(p.y - drag.dy, 0, D - ob.h);
        }
      } else if (drag.type === 'obresize') {
        const ob = state.obstacles.find(o => o.id === drag.id);
        if (ob) {
          ob.w = clamp(p.x - ob.x, 0.1, W - ob.x);
          ob.h = clamp(p.y - ob.y, 0.1, D - ob.y);
        }
      } else if (drag.type === 'draw') {
        drag.x1 = clamp(p.x, 0, W);
        drag.y1 = clamp(p.y, 0, D);
      }
    }
    onStateChange();
  });

  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.type === 'draw') {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      if (w > 0.08 && h > 0.08) {
        const ob = { id: uid(), name: `禁装区${state.obstacles.length + 1}`, x, y, w, h };
        state.obstacles.push(ob);
        state.selectedObstacleId = ob.id;
      }
    }
    drag = null;
    onStateChange();
  });
}

/* ================= 渲染总入口 ================= */
function render() {
  sanitize();
  renderTop();
  renderSide();
  renderSchemeList();
  renderObstacleList();
  renderPointInfo();
  syncInputs();
}

/* ================= 示例 ================= */
function applyState(data) {
  state.room = { ...data.room };
  state.screen = { ...data.screen };
  state.schemes = data.schemes.map(s => ({ ...s, id: uid() }));
  state.obstacles = data.obstacles.map(o => ({ ...o, id: uid() }));
  state.selectedSchemeId = state.schemes.length ? state.schemes[0].id : null;
  state.selectedObstacleId = null;
  const first = state.schemes[0];
  state.point = {
    x: state.screen.cx,
    y: first ? clamp((first.tr_min + first.tr_max) / 2 * state.screen.width, 0, state.room.depth) : state.room.depth / 2,
  };
  state.lensHeight = state.screen.bottom + state.screen.height / 2;
  result = null;
  resultById = {};
  onStateChange();
}

async function initExamples() {
  try {
    const res = await fetch('/api/examples');
    examples = await res.json();
  } catch (err) {
    examples = [];
  }
  const sel = document.getElementById('exampleSelect');
  sel.innerHTML = '<option value="">载入示例…</option>' +
    examples.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  sel.addEventListener('change', () => {
    const ex = examples.find(x => x.id === sel.value);
    if (ex) applyState(ex.data);
    sel.value = '';
  });
  if (examples.length) applyState(examples[0].data);
}

/* ================= 启动 ================= */
bindAllInputs();
attachViewHandlers();
render();
initExamples();
