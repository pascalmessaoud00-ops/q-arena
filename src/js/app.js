// Q-Arena – Oberfläche, Spielstand, Kampfansicht und Online-Duell.
import { ACTIONS, MOVES, GEAR, STARTER_GEAR, SIZE, MAX_TURNS, newBattle, step, legal, snapshot, meleeReach, rangedReach } from './engine.js';
import { SENSORS, SENSOR_ORDER, STARTER_SENSORS, sortSensors, brainKey, stateSpace, DEFAULT_PARAMS, PRESETS, TCOND, TACT, newTactic, agentCtrl, botCtrl, runFight, combatPower, BOTS, getBrain } from './brain.js';
import { Link, sha256, nonce } from './net.js';
import { encodeQR, drawQR } from './qr.js';
import { t, LANGS, getLang, setLang, fmtNum as fmt, fmtInt } from './i18n.js';

/* =================== Hilfen =================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wait = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2800); }
function bump(sel) { const e = $(sel); if (!e) return; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
const initial = n => (String(n).trim()[0] || '?').toUpperCase();
const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
const FLIP = { up: 'down', down: 'up', left: 'right', right: 'left' };
// Namen und Beschreibungen kommen aus den Übersetzungen, die Spieldaten nur aus engine.js/brain.js
const gName = id => t('g.' + id), gDesc = id => t('g.' + id + '.d');
const sName = k => t('s.' + k), sDesc = k => t('s.' + k + '.d');
const botName = i => t('bot.' + BOTS[i].id), botTag = i => t('bot.' + BOTS[i].id + '.d');
const botNameById = id => t('bot.' + id);

/* =================== Spielstand =================== */
const SAVE = 'qarena.save.v1';
const GEAR_CAT = {};
for (const cat of ['melee', 'ranged', 'armor']) for (const id in GEAR[cat]) GEAR_CAT[id] = cat;
const GEAR_PRICE = { leather: 60, sword: 90, net: 120, daggers: 140, cloak: 140, bow: 160, spear: 180, chain: 200, axe: 280, crossbow: 280, plate: 320 };
const PACK_PRICE = { pack1: [1, 60], pack5: [5, 270], pack10: [10, 500] };
const BO_COIN = { 1: 1, 3: 2.5 }, BO_PACK = { 1: 1, 3: 2 };
const DELAY = { slow: 900, normal: 520, fast: 220, instant: 0 };
const MAX_SENSOR_SLOTS = 6, MAX_TAC_SLOTS = 6;
const sensorSlotPrice = () => [0, 0, 0, 150, 250, 400][S.agent.sensorSlots] || 0;
const tacSlotPrice = () => 100 + 60 * (S.agent.tacSlots - 2);

function defaultSave() {
  return {
    v: 1, coins: 150, packs: 3,
    agent: {
      name: t('agent.default'), gear: { ...STARTER_GEAR }, sensors: [...STARTER_SENSORS], brains: {}, params: { ...DEFAULT_PARAMS },
      tactics: [], tacSlots: 2, sensorSlots: 3, match: { eps: 0, learn: false, tac: true }, tacInTraining: false,
    },
    owned: { melee: ['fists'], ranged: ['sling'], armor: ['cloth'], sensors: [...STARTER_SENSORS] },
    league: { unlocked: 1, rec: {} }, history: [], power: null,
    stats: { matches: 0, wins: 0, online: 0, onlineWins: 0 },
  };
}
function migrate(d) {
  const def = defaultSave();
  const a = d.agent || {};
  return {
    ...def, ...d,
    agent: { ...def.agent, ...a, params: { ...DEFAULT_PARAMS, ...(a.params || {}) }, match: { ...def.agent.match, ...(a.match || {}) }, gear: { ...def.agent.gear, ...(a.gear || {}) } },
    owned: { ...def.owned, ...(d.owned || {}) }, league: { ...def.league, ...(d.league || {}) }, stats: { ...def.stats, ...(d.stats || {}) },
  };
}
function load() { try { const s = localStorage.getItem(SAVE); return s ? migrate(JSON.parse(s)) : null; } catch { return null; } }
const round3 = (k, v) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v;
function saveNow() {
  try { localStorage.setItem(SAVE, JSON.stringify(S, round3)); }
  catch { toast(t('save.full')); }
}
let saveT = null;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
let powT = null;
function powerSoon() {
  clearTimeout(powT);
  powT = setTimeout(() => { S.power = combatPower(S.agent); renderHeader(); const e = $('#powerVal'); if (e) e.textContent = S.power; saveSoon(); }, 450);
}
function lootOpen() { const s = new Set(); BOTS.forEach((b, i) => { if ((S.league.rec[i] || {}).w > 0) b.loot.forEach(x => s.add(x)); }); return s; }
const lootOwner = id => BOTS.findIndex(b => b.loot.includes(id));

let S = null;
const UI = { tab: 'agent', trainMode: 'random', spar: 0, trainN: 1, prog: '', bo: 1, speed: 'normal', selBot: 0, humanOpp: 'self', confirm: null, importData: null };
let busy = false;

/* =================== Kopfleiste, Tabs, Sprache =================== */
function renderHeader() {
  $('#res').innerHTML = `<div class="chip coin" id="chipCoins"><span class="lbl">${t('chip.coins')}</span><b>${fmtInt(S.coins)}</b></div>
    <div class="chip" id="chipPacks"><span class="lbl">${t('chip.packs')}</span><b>${S.packs}</b></div>
    <div class="chip"><span class="lbl">${t('chip.power')}</span><b>${S.power ?? '–'}</b></div>`;
}
// Texte, die fest in index.html stehen
function applyStatic() {
  document.querySelectorAll('#tabs button').forEach(b => { b.querySelector('span').textContent = t('tab.' + b.dataset.tab); });
  $('#installBtn').textContent = t('install');
  $('#updateText').textContent = t('update.text');
  $('#updateBtn').textContent = t('update.btn');
  const sel = $('#langSel');
  sel.setAttribute('aria-label', t('lang.label'));
  sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${k.toUpperCase()} – ${v}</option>`).join('');
}
const RENDER = { agent: renderAgent, training: renderTraining, tactics: renderTactics, arena: renderArena, duel: renderDuel, shop: renderShop };
function setTab(tab) {
  if (!RENDER[tab]) tab = 'agent';
  UI.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  RENDER[tab]();
  window.scrollTo(0, 0);
  try { localStorage.setItem('qarena.tab', tab); } catch { /* egal */ }
}
function refresh() { renderHeader(); RENDER[UI.tab](); saveSoon(); }

/* =================== Agent =================== */
const sensorNames = keys => keys.map(k => SENSORS[k] ? sName(k) : k).join(', ');
// Lernkurven-Einträge speichern Kennungen, ältere Spielstände noch fertigen Text
const histLabel = h => h.mode ? (h.mode === 'spar' ? botNameById(h.bot) : t('mode.' + h.mode)) : (h.m || '');
const histSens = h => h.sens ? sensorNames(h.sens) : (h.k || '');
function chartHTML(H) {
  if (!H.length) return `<div class="note">${t('chart.empty')}</div>`;
  const W = 640, pl = 34, pr = 12, pt = 22, h1 = 110, gap = 34, h2 = 100, pb = 22, iw = W - pl - pr, n = H.length, bw = iw / n, Ht = pt + h1 + gap + h2 + pb;
  const x = i => pl + bw * i + bw / 2, y1 = v => pt + h1 * (1 - v / 100), y2t = pt + h1 + gap;
  let g = '';
  for (const v of [0, 50, 100]) {
    g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y1(v)}" y2="${y1(v)}"/><text class="ax" x="${pl - 6}" y="${y1(v) + 3}" text-anchor="end">${v}</text>`;
    const yy = y2t + h2 * (1 - v / 100);
    g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="ax" x="${pl - 6}" y="${yy + 3}" text-anchor="end">${v}%</text>`;
  }
  g += `<text class="ax" x="${pl}" y="${pt - 9}" style="font-weight:700">${t('chart.power')}</text><text class="ax" x="${pl}" y="${y2t - 9}" style="font-weight:700">${t('chart.results')}</text>`;
  const pts = H.map((h, i) => [x(i), y1(h.s)]);
  if (n > 1) g += `<path class="ar" d="M${pts[0][0]},${y1(0)} L${pts.map(p => p.join(',')).join(' L')} L${pts[n - 1][0]},${y1(0)} Z"/><path class="ln" d="M${pts.map(p => p.join(',')).join(' L')}"/>`;
  const lp = pts[n - 1];
  g += `<circle cx="${lp[0]}" cy="${lp[1]}" r="5" fill="var(--me)" stroke="var(--surface)" stroke-width="2"/><text class="ax" x="${Math.min(lp[0] - 8, W - pr)}" y="${lp[1] - 9}" text-anchor="end" style="fill:var(--ink);font-weight:700">${H[n - 1].s}</text>`;
  const barW = Math.min(bw * 0.72, 26);
  H.forEach((h, i) => {
    const tot = h.w + h.d + h.l || 1; let yy = y2t + h2;
    for (const [v, c] of [[h.w, 'var(--good)'], [h.d, 'var(--muted)'], [h.l, 'var(--bad)']]) {
      const hh = h2 * v / tot; if (hh <= 0) continue; yy -= hh;
      g += `<rect x="${x(i) - barW / 2}" y="${yy + 1}" width="${barW}" height="${Math.max(0, hh - 2)}" rx="2" fill="${c}"/>`;
    }
  });
  g += `<text class="ax" x="${x(0)}" y="${Ht - 6}" text-anchor="middle">1</text>${n > 1 ? `<text class="ax" x="${x(n - 1)}" y="${Ht - 6}" text-anchor="middle">${n}</text>` : ''}`;
  g += `<line class="cross" id="crossLine" x1="0" x2="0" y1="${pt}" y2="${y2t + h2}" visibility="hidden"/>`;
  return `<div class="chart" id="chart" data-n="${n}" data-w="${W}" data-pl="${pl}" data-bw="${bw}"><svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${t('chart.aria', { n })}">${g}</svg><div class="tip" id="tip" hidden></div></div>
  <div class="legend"><span><i class="sw" style="background:var(--me)"></i>${t('chip.power')}</span><span><i class="sw" style="background:var(--good)"></i>${t('wins')}</span><span><i class="sw" style="background:var(--muted)"></i>${t('draws')}</span><span><i class="sw" style="background:var(--bad)"></i>${t('losses')}</span></div>
  <details><summary>${t('chart.table')}</summary><div class="tablewrap"><table><thead><tr><th>${t('th.pack')}</th><th>${t('th.opp')}</th><th>${t('wins')}</th><th>${t('draws')}</th><th>${t('th.lossShort')}</th><th>${t('th.eps')}</th><th>${t('th.power')}</th></tr></thead><tbody>
  ${H.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(histLabel(h))}</td><td>${h.w}</td><td>${h.d}</td><td>${h.l}</td><td>${fmt(h.e, 3)}</td><td>${h.s}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function bindChart() {
  const c = $('#chart'); if (!c) return;
  const svg = c.querySelector('svg'), tip = $('#tip'), line = $('#crossLine');
  const n = +c.dataset.n, W = +c.dataset.w, pl = +c.dataset.pl, bw = +c.dataset.bw;
  const hide = () => { tip.hidden = true; line.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, i = Math.floor((px - pl) / bw);
    if (i < 0 || i >= n) { hide(); return; }
    const h = S.history[i], cx = pl + bw * i + bw / 2, sens = histSens(h);
    line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${t('tip.pack', { n: i + 1 })}</b> · ${esc(histLabel(h))}<br>${t('chip.power')} <b class="mono">${h.s}</b><br><span style="color:var(--good)">${t('wins')} ${h.w}</span> · ${t('draws')} ${h.d} · <span style="color:var(--bad)">${t('losses')} ${h.l}</span><br>${t('tip.eps')} ${fmt(h.e, 3)}${sens ? `<br><span class="muted">${esc(sens)}</span>` : ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth; let left = cx / W * r.width + 12; if (left + tw > r.width) left = cx / W * r.width - tw - 12;
    tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', hide);
}
function confirmHTML(id, text, label) {
  return UI.confirm === id ? `<div class="row note warn"><span>${text}</span><button class="btn sm danger" data-action="doConfirm" data-v="${esc(id)}">${label}</button><button class="btn sm" data-action="cancelConfirm">${t('cancel')}</button></div>` : '';
}
function renderAgent() {
  const A = S.agent, br = getBrain(A, false), sens = sortSensors(A.sensors), nK = Object.keys(br.q).length, space = stateSpace(sens);
  const beaten = BOTS.filter((_, i) => (S.league.rec[i] || {}).w > 0).length;
  let hint;
  if (!br.fights) hint = t('hint.untrained');
  else if (!beaten) hint = t('hint.first');
  else if (beaten < BOTS.length) hint = t('hint.next', { bot: esc(botName(Math.min(beaten, BOTS.length - 1))) });
  else hint = t('hint.done');
  const gearRows = ['melee', 'ranged', 'armor'].map(slot => {
    const cur = A.gear[slot];
    return `<div class="slot"><label class="eyebrow" for="gear-${slot}">${t('slot.' + slot)}</label>
      <select id="gear-${slot}" data-gear="${slot}" ${busy ? 'disabled' : ''}>${S.owned[slot].map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(gName(id))}</option>`).join('')}</select>
      <p class="desc">${esc(gDesc(cur))}</p></div>`;
  }).join('');
  const ownedSens = SENSOR_ORDER.filter(k => S.owned.sensors.includes(k));
  const cur = brainKey(A.sensors);
  const others = Object.entries(A.brains).filter(([k]) => k !== cur);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#view').innerHTML = `<div class="grid">
   <section class="card">
     <div class="stack" style="gap:4px"><label class="eyebrow" for="agentName">${t('agent.name')}</label><input type="text" id="agentName" class="name-input" value="${esc(A.name)}" maxlength="20"></div>
     <div class="power"><b id="powerVal">${S.power ?? '–'}</b><span class="small muted">${t('power.desc')}</span></div>
     <dl class="facts">
       <div><dt>${t('fact.fights')}</dt><dd>${fmtInt(br.fights)}</dd></div>
       <div><dt>${t('fact.states')}</dt><dd>${fmtInt(nK)} / ${fmtInt(space)}</dd></div>
       <div><dt style="text-transform:none">${t('fact.eps')}</dt><dd>${fmt(A.params.eps, 3)}</dd></div>
       <div><dt>${t('fact.league')}</dt><dd>${beaten} / ${BOTS.length}</dd></div>
     </dl>
     <div class="note">${hint}</div>
     ${standalone ? '' : `<p class="small muted">${t('install.tip')}</p>`}
   </section>
   <section class="card">
     <header><h2>${t('gear.title')}</h2><span class="small muted">${t('gear.sub')}</span></header>
     <div>${gearRows}</div>
     <p class="small muted">${t('gear.note')}</p>
   </section>
   <section class="card">
     <header><h2>${t('sens.title')}</h2><div class="row"><div class="slotbar" aria-hidden="true">${Array.from({ length: A.sensorSlots }, (_, i) => `<i class="${i < sens.length ? 'on' : ''}"></i>`).join('')}</div><span class="mono small">${sens.length} / ${A.sensorSlots}</span></div></header>
     <p class="small">${t('sens.intro')}</p>
     <div class="chips">${ownedSens.map(k => `<button class="sensor" data-action="sensor" data-v="${k}" aria-pressed="${sens.includes(k)}" ${busy ? 'disabled' : ''}><b>${esc(sName(k))}</b><span>${t('sens.values', { n: SENSORS[k].n })}</span></button>`).join('')}</div>
     <p class="space">${t('sens.space')}: ${sens.map(k => SENSORS[k].n).join(' × ')} = <b>${fmtInt(space)}</b> ${t('sens.states')}</p>
     <ul class="small muted" style="margin:0;padding-left:18px">${sens.map(k => `<li><b>${esc(sName(k))}:</b> ${esc(sDesc(k))}</li>`).join('')}</ul>
     <div class="note small">${t('sens.brainNote')}</div>
     ${others.length ? `<div class="brains"><span class="eyebrow">${t('brains.saved')}</span>${others.map(([k, b]) => {
       const ks = k.split(','), ok = ks.every(x => S.owned.sensors.includes(x)) && ks.length <= A.sensorSlots;
       return `<div class="row"><span class="small"><b>${esc(sensorNames(ks))}</b><br><span class="muted mono">${t('brains.stats', { f: fmtInt(b.fights), s: fmtInt(Object.keys(b.q).length) })}</span></span>
         <span class="row"><button class="btn sm" data-action="useBrain" data-v="${esc(k)}" ${ok && !busy ? '' : 'disabled'}>${t('brains.activate')}</button><button class="btn sm danger" data-action="askConfirm" data-v="brain:${esc(k)}">${t('delete')}</button></span></div>
         ${confirmHTML('brain:' + k, t('brains.confirm'), t('delete'))}`;
     }).join('')}</div>` : ''}
   </section>
   <section class="card wide"><header><h2>${t('curve.title')}</h2><span class="small muted">${t('curve.packs', { n: S.history.length })}</span></header>${chartHTML(S.history)}</section>
   <section class="card">
     <h2>${t('save.title')}</h2>
     <p class="small muted">${t('save.note')}</p>
     <div class="row"><button class="btn" data-action="exportSave">${t('save.export')}</button><label class="btn" for="importFile" style="display:inline-flex;align-items:center">${t('save.import')}</label><input type="file" id="importFile" accept=".json,application/json" hidden></div>
     ${UI.importData ? `<div class="note warn">${t('save.read', { name: esc(UI.importData.agent.name), coins: fmtInt(UI.importData.coins) })}</div><div class="row"><button class="btn danger" data-action="doImport">${t('save.replace')}</button><button class="btn" data-action="cancelImport">${t('cancel')}</button></div>` : ''}
     <div class="row"><button class="btn danger sm" data-action="askConfirm" data-v="wipeBrain" ${busy ? 'disabled' : ''}>${t('save.wipeBrain')}</button><button class="btn danger sm" data-action="askConfirm" data-v="wipeAll" ${busy ? 'disabled' : ''}>${t('save.wipeAll')}</button></div>
     ${confirmHTML('wipeBrain', t('save.wipeBrainText'), t('save.wipeBrainBtn'))}
     ${confirmHTML('wipeAll', t('save.wipeAllText'), t('save.wipeAll'))}
   </section>
  </div>`;
  bindChart();
}

/* =================== Training =================== */
const PARAM_DEFS = [
  { g: 'explore' },
  { k: 'eps', min: 0, max: 1, step: 0.01, d: 3, hint: true },
  { k: 'epsDecay', min: 0.99, max: 1, step: 0.0001, d: 4, hint: true },
  { k: 'epsMin', min: 0, max: 0.5, step: 0.01, d: 2, hint: true },
  { k: 'qInit', min: -1, max: 1, step: 0.05, d: 2, hint: true },
  { g: 'learn' },
  { k: 'alpha', min: 0.01, max: 1, step: 0.01, d: 2, hint: true },
  { k: 'neg', min: 0.1, max: 3, step: 0.05, d: 2, hint: true },
  { k: 'gamma', min: 0, max: 0.99, step: 0.01, d: 2, hint: true },
  { k: 'lambda', min: 0, max: 1, step: 0.01, d: 2, hint: true },
  { g: 'reward' },
  { k: 'rWin', min: 0, max: 20, step: 0.5, d: 1 },
  { k: 'rLoss', min: -20, max: 0, step: 0.5, d: 1 },
  { k: 'rDraw', min: -5, max: 5, step: 0.25, d: 2, hint: true },
  { k: 'rDealt', min: 0, max: 3, step: 0.05, d: 2 },
  { k: 'rTaken', min: -3, max: 0, step: 0.05, d: 2 },
  { k: 'rStep', min: -0.5, max: 0, step: 0.01, d: 2, hint: true },
];
function paramsHTML(P) {
  return PARAM_DEFS.map(p => p.g ? `<h3 class="group-title">${t('group.' + p.g)}</h3>` : `<div class="param"><div class="ph"><label for="p-${p.k}">${t('p.' + p.k)}</label><output id="o-${p.k}">${fmt(P[p.k], p.d)}</output></div>
    <input type="range" id="p-${p.k}" data-param="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${P[p.k]}">${p.hint ? `<p class="hint">${t('p.' + p.k + '.h')}</p>` : ''}</div>`).join('');
}
const sparBots = () => BOTS.map((b, i) => ({ b, i })).filter(x => x.i < S.league.unlocked);
function renderTraining() {
  const A = S.agent, P = A.params, can = S.packs >= UI.trainN && !busy;
  if (!sparBots().some(x => x.i === UI.spar)) UI.spar = 0;
  const mode = m => `<button class="mode" data-action="tmode" data-v="${m}" aria-pressed="${UI.trainMode === m}"><b>${t('mode.' + m)}</b><span>${t('mode.' + m + '.d')}</span></button>`;
  $('#view').innerHTML = `<div class="grid">
   <section class="card">
     <header><h2>${t('train.title')}</h2><span class="small muted">${t('train.sub')}</span></header>
     <div class="modes" role="group" aria-label="${t('train.modeAria')}">${mode('random')}${mode('spar')}${mode('self')}</div>
     ${UI.trainMode === 'spar' ? `<div class="row"><label for="sparSel">${t('train.partner')}</label><select id="sparSel">${sparBots().map(x => `<option value="${x.i}" ${x.i === UI.spar ? 'selected' : ''}>${esc(botName(x.i))}</option>`).join('')}</select></div>` : ''}
     <div class="row"><span>${t('train.packs')}</span><div class="seg">${[1, 5, 10].map(n => `<button data-action="tn" data-v="${n}" aria-pressed="${UI.trainN === n}">${n}</button>`).join('')}</div></div>
     <label class="check"><input type="checkbox" id="tacTrain" ${A.tacInTraining ? 'checked' : ''}><span>${t('train.tac')}<br><span class="small muted">${t('train.tac.h')}</span></span></label>
     <p class="small muted">${t('train.brain', { s: esc(sensorNames(sortSensors(A.sensors))) })}</p>
     <div class="row"><button class="btn primary" data-action="train" ${can ? '' : 'disabled'}>${t('train.btn', { n: UI.trainN })}</button>
       ${S.packs < UI.trainN ? `<span class="small muted">${t('train.have', { n: S.packs })}</span>` : ''}</div>
     <div id="trainProg">${UI.prog}</div>
   </section>
   <section class="card">
     <header><h2>${t('train.params')}</h2></header>
     <div class="row">${Object.keys(PRESETS).map(k => `<button class="btn sm" data-action="preset" data-v="${k}">${t('preset.' + k)}</button>`).join('')}</div>
     <div class="params">${paramsHTML(P)}</div>
   </section></div>`;
}
function setProg(h) { UI.prog = h; const e = $('#trainProg'); if (e) e.innerHTML = h; }
async function startTraining() {
  const A = S.agent, N = UI.trainN;
  if (busy || S.packs < N) return;
  busy = true;
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  const mode = UI.trainMode, botIdx = mode === 'spar' ? UI.spar : 0, bot = BOTS[botIdx];
  const label = mode === 'spar' ? botName(botIdx) : t('mode.' + mode);
  renderTraining();
  const before = S.power;
  for (let pk = 0; pk < N; pk++) {
    S.packs--; renderHeader();
    let w = 0, d = 0, l = 0;
    const opts = { eps: A.params.eps, learn: true, useTac: A.tacInTraining };
    const me = agentCtrl(A, opts);
    const op = mode === 'self' ? agentCtrl(A, opts) : botCtrl(bot);
    const og = mode === 'self' ? A.gear : bot.gear;
    for (let g = 0; g < 1000; g++) {
      const side = g % 2;
      const r = side === 0 ? runFight(me, op, A.gear, og) : runFight(op, me, og, A.gear);
      if (r === -1) d++; else if (r === side) w++; else l++;
      A.params.eps = Math.max(A.params.epsMin, A.params.eps * A.params.epsDecay);
      me.eps = A.params.eps; if (mode === 'self') op.eps = A.params.eps;
      if (g % 50 === 49) {
        setProg(`<div class="stack" style="gap:8px"><div class="row" style="justify-content:space-between"><b>${t('train.prog', { i: pk + 1, n: N, label: esc(label) })}</b><span class="mono small">${fmtInt(g + 1)} / ${fmtInt(1000)}</span></div>
          <div class="progress"><i style="width:${(g + 1) / 10}%"></i></div>
          <div class="tally"><span class="w">${t('wins')} ${w}</span><span class="d">${t('draws')} ${d}</span><span class="l">${t('losses')} ${l}</span><span>ε ${fmt(A.params.eps, 3)}</span></div></div>`);
        const o = $('#o-eps'), inp = $('#p-eps'); if (o) o.textContent = fmt(A.params.eps, 3); if (inp) inp.value = A.params.eps;
        await wait(0);
      }
    }
    S.power = combatPower(A);
    S.history.push({ mode, bot: bot.id, w, d, l, e: A.params.eps, s: S.power, sens: sortSensors(A.sensors) });
    if (S.history.length > 300) S.history.shift();
    renderHeader(); saveSoon();
  }
  try { await lock?.release(); } catch { /* egal */ }
  busy = false;
  const h = S.history.at(-1);
  setProg(`<div class="note ok">${t('train.done', { w: h.w, d: h.d, l: h.l, before: before ?? '–', after: S.power, states: fmtInt(Object.keys(getBrain(A, false).q).length) })}</div>`);
  refresh();
}

/* =================== Taktiken =================== */
function condHTML(c, ri, ci) {
  const d = TCOND[c.type];
  const ctl = d.ops
    ? `<select data-tac="op" data-r="${ri}" data-c="${ci}" aria-label="${t('aria.compare')}">${d.ops.map(o => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select><input type="number" data-tac="val" data-r="${ri}" data-c="${ci}" min="${d.num[0]}" max="${d.num[1]}" value="${c.val}" aria-label="${t('aria.value')}">`
    : `<select data-tac="val" data-r="${ri}" data-c="${ci}" aria-label="${t('aria.value')}">${d.vals.map(v => `<option value="${esc(v)}" ${v === c.val ? 'selected' : ''}>${esc(t('val.' + v))}</option>`).join('')}</select>`;
  return `<div class="cond"><select data-tac="ctype" data-r="${ri}" data-c="${ci}" aria-label="${t('aria.cond')}">${Object.keys(TCOND).map(k => `<option value="${k}" ${k === c.type ? 'selected' : ''}>${t('cond.' + k)}</option>`).join('')}</select>${ctl}<button class="btn icon sm" data-action="delCond" data-r="${ri}" data-c="${ci}" aria-label="${t('aria.removeCond')}">×</button></div>`;
}
function renderTactics() {
  const A = S.agent, full = A.tactics.length >= A.tacSlots, n = A.tactics.length;
  const acts = Object.keys(TACT);
  const opt = (k, r) => `<option value="${k}" ${k === r.act ? 'selected' : ''}>${t('tact.' + k)}</option>`;
  $('#view').innerHTML = `<div class="stack">
   <section class="card">
     <header><h2>${t('tac.title')}</h2><div class="row"><div class="slotbar" aria-hidden="true">${Array.from({ length: A.tacSlots }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div><span class="mono small">${t('tac.slots', { n, max: A.tacSlots })}</span></div></header>
     <p class="small">${t('tac.intro')}</p>
     <div class="row"><button class="btn primary" data-action="addTac" data-v="" ${full ? 'disabled' : ''}>${t('tac.addEmpty')}</button>
       <span class="small muted">${t('tac.templates')}</span>${['snipe', 'retreat', 'counter', 'dodge'].map(k => `<button class="btn sm" data-action="addTac" data-v="${k}" ${full ? 'disabled' : ''}>${t('tpl.' + k)}</button>`).join('')}</div>
     ${full ? `<p class="small muted">${t('tac.full')}</p>` : ''}
   </section>
   ${A.tactics.map((r, ri) => `<article class="rule ${r.on ? '' : 'off'}">
     <div class="rule-head"><span class="prio" title="${t('tac.prio')}">${ri + 1}</span><input type="text" data-tac="name" data-r="${ri}" value="${esc(r.name)}" maxlength="28" aria-label="${t('tac.nameAria')}">
       <label class="check" style="align-items:center"><input type="checkbox" data-tac="on" data-r="${ri}" ${r.on ? 'checked' : ''}><span>${t('tac.active')}</span></label>
       <span class="mono small muted">${t('tac.fired', { n: r.fired || 0 })}</span>
       <button class="btn icon sm" data-action="tacUp" data-r="${ri}" ${ri === 0 ? 'disabled' : ''} aria-label="${t('tac.up')}">↑</button>
       <button class="btn icon sm" data-action="tacDown" data-r="${ri}" ${ri === n - 1 ? 'disabled' : ''} aria-label="${t('tac.down')}">↓</button>
       <button class="btn icon sm danger" data-action="delTac" data-r="${ri}" aria-label="${t('tac.del')}">×</button></div>
     <div class="rule-body">
       <div class="stack"><h3>${t('tac.when')}</h3>${r.conds.length ? r.conds.map((c, ci) => condHTML(c, ri, ci)).join('') : `<span class="small muted">${t('tac.noCond')}</span>`}<div><button class="btn sm" data-action="addCond" data-r="${ri}">${t('tac.addCond')}</button></div></div>
       <div class="stack"><h3>${t('tac.then')}</h3><select data-tac="act" data-r="${ri}" aria-label="${t('aria.action')}">
         <optgroup label="${t('tac.optAction')}">${acts.slice(0, 4).map(k => opt(k, r)).join('')}</optgroup>
         <optgroup label="${t('tac.optMove')}">${acts.slice(4).map(k => opt(k, r)).join('')}</optgroup></select>
         <p class="small muted">${t('tac.dirNote')}</p></div>
     </div></article>`).join('') || `<div class="note">${t('tac.empty')}</div>`}
   <p class="small muted">${t('tac.footer')}</p></div>`;
}

/* =================== Arena =================== */
function botReward(bot, N) { return t('arena.reward', { c: Math.round(bot.coins * BO_COIN[N]), p: bot.packs * BO_PACK[N] }); }
const gearLine = g => `${gName(g.melee)} · ${gName(g.ranged)} · ${gName(g.armor)}`;
function renderArena() {
  const A = S.agent, M = A.match;
  if (UI.selBot >= S.league.unlocked) UI.selBot = 0;
  const bots = BOTS.map((b, i) => {
    const locked = i >= S.league.unlocked, r = S.league.rec[i] || { w: 0, d: 0, l: 0 }, nm = botName(i);
    const extra = r.w ? '' : ` · ${t('arena.first')}${b.loot.length ? ', ' + t('arena.loot', { items: esc(b.loot.map(gName).join(', ')) }) : ''}`;
    return `<button class="bot ${locked ? 'locked' : ''}" data-action="selBot" data-v="${i}" aria-pressed="${UI.selBot === i}" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="avatar" style="${i >= 4 ? 'background:var(--ink)' : ''}">${esc(nm.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>
      <span class="nm">${esc(nm)}<span class="lvl">${t('arena.level', { n: i + 1 })}</span></span>
      <span class="tg">${locked ? t('arena.unlock', { bot: esc(botName(i - 1)) }) : esc(botTag(i))}</span>
      ${locked ? '' : `<span class="gear muted">${esc(gearLine(b.gear))}</span><span class="rw">${botReward(b, UI.bo)} · ${t('arena.record', r)}${extra}</span>`}
    </button>`;
  }).join('');
  const sel = BOTS[UI.selBot];
  $('#view').innerHTML = `<div class="grid">
   <section class="card wide"><header><h2>${t('arena.league')}</h2><span class="small muted">${t('arena.leagueSub')}</span></header><div class="bots">${bots}</div></section>
   <section class="card">
     <h2>${t('arena.matchVs', { bot: esc(botName(UI.selBot)) })}</h2>
     <div class="row"><span>${t('arena.format')}</span><div class="seg">${[1, 3].map(n => `<button data-action="bo" data-v="${n}" aria-pressed="${UI.bo === n}">${t('arena.bestOf', { n })}</button>`).join('')}</div></div>
     <div class="row"><span>${t('arena.tempo')}</span><div class="seg">${['slow', 'normal', 'fast', 'instant'].map(k => `<button data-action="speed" data-v="${k}" aria-pressed="${UI.speed === k}">${t('speed.' + k)}</button>`).join('')}</div></div>
     <h3>${t('arena.agentInMatch')}</h3>
     <div class="param"><div class="ph"><label for="m-eps">${t('arena.eps')}</label><output id="mo-eps">${fmt(M.eps, 2)}</output></div><input type="range" id="m-eps" min="0" max="0.5" step="0.01" value="${M.eps}"><p class="hint">${t('arena.eps.h')}</p></div>
     <label class="check"><input type="checkbox" id="m-tac" ${M.tac ? 'checked' : ''}><span>${t('arena.tac')}</span></label>
     <label class="check"><input type="checkbox" id="m-learn" ${M.learn ? 'checked' : ''}><span>${t('arena.learn')}<br><span class="small muted">${t('arena.learn.h')}</span></span></label>
     <button class="btn primary" data-action="startLeague" ${busy ? 'disabled' : ''}>${t('arena.start')}</button>
     <p class="small muted">${botReward(sel, UI.bo)} · ${t('arena.drawNote')}</p>
   </section>
   <section class="card">
     <h2>${t('arena.self')}</h2>
     <p class="small">${t('arena.self.intro')}</p>
     <div class="row"><label for="humanOpp">${t('opponent')}</label><select id="humanOpp"><option value="self" ${UI.humanOpp === 'self' ? 'selected' : ''}>${t('arena.myAgent', { name: esc(A.name) })}</option>${sparBots().map(x => `<option value="${x.i}" ${String(x.i) === UI.humanOpp ? 'selected' : ''}>${esc(botName(x.i))}</option>`).join('')}</select></div>
     <button class="btn" data-action="startHuman" ${busy ? 'disabled' : ''}>${t('arena.fight')}</button>
     <p class="small muted">${t('arena.keys')}</p>
   </section></div>`;
}

/* =================== Kampfansicht =================== */
let V = null;
const actLabel = a => MOVES[a] ? t('act.move', { arrow: ARROW[V && V.me === 1 ? FLIP[a] : a] }) : t('act.' + a);
function openBattle(cfg) {
  V = { ...cfg, cfg, frames: [], sc: [0, 0, 0], game: 0, done: false, aborted: false, awaiting: null, danger: cfg.mode !== 'league', log: [], replay: null, waitText: '' };
  const el = $('#battle');
  el.hidden = false; document.body.style.overflow = 'hidden';
  el.innerHTML = `<div class="b-wrap">
    <div class="b-top"><button class="btn sm" data-action="bClose">${cfg.mode === 'online' ? t('b.resign') : t('close')}</button>
      <div class="title"><span class="eyebrow" id="bSub"></span><b>${esc(cfg.title)}</b></div><div class="b-score" id="bScore"></div></div>
    <div class="fighters" id="bFighters"></div>
    <div class="b-main">
      <div class="stack"><div class="board" id="bBoard"><div class="tiles" id="bTiles">${'<i></i>'.repeat(25)}</div><div class="layer" id="bLayer"></div></div>
        <label class="check small"><input type="checkbox" id="bDanger" ${V.danger ? 'checked' : ''}><span>${t('b.danger')}</span></label></div>
      <div class="stack"><div id="bPad"></div><div id="bInfo"></div><div id="bReplay"></div><div id="bResult"></div></div>
    </div></div>`;
  const layer = $('#bLayer');
  for (const i of [0, 1]) {
    const tok = document.createElement('div');
    tok.className = 'token ' + (i === V.me ? 'me' : 'foe'); tok.id = 'tok' + i;
    tok.innerHTML = `<div class="body">${esc(initial(V.names[i]))}</div>`;
    layer.append(tok);
  }
}
const orient = p => V.me === 1 ? { x: SIZE - 1 - p.x, y: SIZE - 1 - p.y } : p;
const pct = p => { const q = orient(p); return { left: (q.x + 0.5) * 20 + '%', top: (q.y + 0.5) * 20 + '%' }; };
function fx(cls, p, text, color) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && cls !== 'dmg') return;
  const e = document.createElement('div');
  e.className = 'fx ' + cls; Object.assign(e.style, pct(p)); if (color) e.style.setProperty('--c', color);
  if (text) e.textContent = text;
  $('#bLayer').append(e); setTimeout(() => e.remove(), 950);
}
function shot(from, to, color) {
  const e = document.createElement('div');
  e.className = 'fx shot'; e.style.setProperty('--c', color); Object.assign(e.style, pct(from));
  $('#bLayer').append(e);
  const a = e.animate([pct(from), pct(to)], { duration: 260, easing: 'ease-in' });
  a.onfinish = () => e.remove();
}
const sideColor = i => i === V.me ? 'var(--me)' : 'var(--foe)';
function playFx(fr) {
  const F = fr.snap.f, myV = V;
  const later = (fn) => setTimeout(() => { if (V === myV) fn(); }, 240);
  for (const e of fr.ev) {
    const c = sideColor(e.i);
    if (e.t === 'bump') { const tok = $('#tok' + e.i); tok.classList.remove('bump'); void tok.offsetWidth; tok.classList.add('bump'); }
    else if (e.t === 'melee') { if (e.hit) { fx('slash', e.at, '', c); if (e.blocked) fx('txt', e.at, t('fx.blocked')); } else fx('txt', F[e.i], t('fx.missed')); }
    else if (e.t === 'ranged') {
      if (e.inRange) shot(e.from, e.to, c); else fx('txt', F[e.i], t('fx.noTarget'));
      if (e.blocked) later(() => fx('txt', e.to, t('fx.blocked')));
      if (e.dodged) later(() => fx('txt', e.to, t('fx.dodged')));
    }
    else if (e.t === 'charge') fx('ring', F[e.i], '', 'var(--gold)');
    else if (e.t === 'root') fx('ring', F[e.i], '', 'var(--muted)');
    else if (e.t === 'dmg') later(() => fx('dmg', F[e.i], '−' + e.d));
  }
}
function dangerSet(snap) {
  const s = new Set(), fi = 1 - V.me, f = snap.f[fi], foe = { x: f.x, y: f.y, gear: V.gears[fi] };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x === f.x && y === f.y) continue;
    const c = { x, y };
    if ((f.mcd === 0 && meleeReach(foe, c)) || (f.rcd === 0 && rangedReach(foe, c))) { const q = orient(c); s.add(q.y * SIZE + q.x); }
  }
  return s;
}
function fighterCard(i, f) {
  const g = V.gears[i], tags = [];
  if (f.charged) tags.push(`<span class="tag hot">${t('tag.charged')}</span>`);
  if (f.root > 0) tags.push(`<span class="tag bad">${t('tag.rooted', { n: f.root })}</span>`);
  tags.push(`<span class="tag">${esc(gName(g.ranged))} ${f.rcd ? t('tag.in', { n: f.rcd }) : t('tag.ready')}</span>`);
  if (f.mcd) tags.push(`<span class="tag">${t('tag.meleePause')}</span>`);
  return `<div class="fcard ${i === V.me ? 'me' : 'foe'}"><span class="nm">${esc(V.names[i])}</span>
    <div class="hpbar" role="meter" aria-label="${t('hp.aria')}" aria-valuemin="0" aria-valuemax="${f.maxHp}" aria-valuenow="${f.hp}"><i style="width:${100 * f.hp / f.maxHp}%"></i></div>
    <span class="mono small">${f.hp} / ${f.maxHp} ${t('hp')}</span><div class="st">${tags.join('')}</div></div>`;
}
function srcPill(d) {
  if (!d) return '';
  if (d.src === 'tac') return `<span class="pill tac">${t('src.tac', { name: esc(d.rule) })}</span>`;
  if (d.src === 'explore') return `<span class="pill explore">${t('src.explore')}</span>`;
  if (d.src === 'q') return `<span class="pill q">${t('src.q')}${d.known ? '' : t('src.unknown')}</span>`;
  return '';
}
function qList(d) {
  const m = Math.max(0.5, ...d.L.map(a => Math.abs(d.q[ACTIONS.indexOf(a)])));
  return `<div class="qlist">${ACTIONS.map((a, k) => {
    const v = d.q[k], ok = d.L.includes(a), w = Math.min(50, Math.abs(v) / m * 50);
    return `<div class="qrow ${ok ? '' : 'illegal'} ${a === d.a ? 'pick' : ''}"><span>${a === d.a ? '▸ ' : ''}${actLabel(a)}</span><span class="bar"><i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></i></span><span class="v">${fmt(v)}</span></div>`;
  }).join('')}</div>`;
}
function drawFrame(fr, animate) {
  const F = fr.snap.f;
  F.forEach((f, i) => {
    const tok = $('#tok' + i), q = orient(f);
    if (!animate) tok.style.transition = 'none';
    tok.style.setProperty('--x', q.x); tok.style.setProperty('--y', q.y);
    if (!animate) { void tok.offsetWidth; tok.style.transition = ''; }
    tok.classList.toggle('charged', f.charged); tok.classList.toggle('rooted', f.root > 0); tok.classList.toggle('dead', f.hp <= 0);
    tok.classList.toggle('blocking', !!(fr.acts && fr.acts[i] === 'block'));
  });
  $('#bFighters').innerHTML = fighterCard(V.me, F[V.me]) + fighterCard(1 - V.me, F[1 - V.me]);
  const ds = V.danger && !fr.snap.over ? dangerSet(fr.snap) : new Set();
  [...$('#bTiles').children].forEach((tile, k) => tile.classList.toggle('danger', ds.has(k)));
  $('#bScore').innerHTML = `${V.sc[V.me]}<span class="muted"> : </span>${V.sc[1 - V.me]}`;
  $('#bSub').textContent = `${V.bo > 1 ? t('b.game', { i: V.game + 1, n: V.bo }) : ''}${t('b.round', { r: fr.snap.turn, max: MAX_TURNS })}`;
  const decs = [0, 1].filter(i => fr.dec && fr.dec[i] && fr.dec[i].q);
  $('#bInfo').innerHTML = `${decs.map(i => `<div class="card" style="padding:12px;gap:8px"><div class="row"><span class="eyebrow">${t('b.chose', { name: esc(V.names[i]) })}</span>${srcPill(fr.dec[i])}</div>${qList(fr.dec[i])}</div>`).join('')}
    ${V.log.length ? `<details ${V.mode === 'league' ? 'open' : ''}><summary>${t('b.log')}</summary><ul class="log">${V.log.slice(-40).reverse().map(l => `<li>${l}</li>`).join('')}</ul></details>` : ''}`;
  if (animate && fr.ev) playFx(fr);
}
function logTurn(fr) {
  const nm = i => `<span class="${i === V.me ? 'm' : 'f'}">${esc(V.names[i])}</span>`;
  const dmg = i => { const e = fr.ev.find(x => x.t === 'dmg' && x.i === 1 - i); return e ? ` (−${e.d})` : ''; };
  V.log.push(`R${fr.snap.turn}: ${nm(0)} ${actLabel(fr.acts[0])}${dmg(0)} · ${nm(1)} ${actLabel(fr.acts[1])}${dmg(1)}`);
}
function renderPad() {
  const el = $('#bPad'); if (!el) return;
  const hs = V.sides.findIndex(s => s.kind === 'human');
  if (hs < 0 || V.done) { el.innerHTML = V.waitText ? `<p class="small muted">${esc(V.waitText)}</p>` : ''; return; }
  if (!V.awaiting) { el.innerHTML = `<div class="pad"><div class="waiting">${esc(V.waitText || t('pad.evaluating'))}</div></div>`; return; }
  const L = V.awaiting.L, f = V.b.f[hs], g = V.gears[hs];
  const dir = d => V.me === 1 ? FLIP[d] : d;
  const b = (a, txt, area, cls = '') => `<button class="${cls}" style="grid-area:${area}" data-action="pad" data-v="${a}" ${L.includes(a) ? '' : 'disabled'}>${txt}</button>`;
  el.innerHTML = `<div class="pad" role="group" aria-label="${t('pad.aria')}">
    ${b(dir('up'), '↑', '1/2', 'arrow')}${b(dir('left'), '←', '2/1', 'arrow')}${b(dir('right'), '→', '2/3', 'arrow')}${b(dir('down'), '↓', '3/2', 'arrow')}
    ${b('melee', `${t('act.melee')}<small>${t('pad.dmg', { n: GEAR.melee[g.melee].dmg })}${f.charged ? ' ×2' : ''}</small>`, '1/5', 'act')}
    ${b('ranged', `${t('act.ranged')}<small>${f.rcd ? t('pad.readyIn', { n: f.rcd }) : t('pad.ready')}</small>`, '1/6', 'act')}
    ${b('block', `${t('act.block')}<small>${t('pad.block')}</small>`, '2/5', 'act')}
    ${b('charge', `${t('act.charge')}<small>${f.charged ? t('pad.charged') : t('pad.charge')}</small>`, '2/6', 'act')}
  </div>`;
}
function humanInput(b, i) {
  return new Promise(resolve => { V.awaiting = { resolve, L: legal(b, i) }; V.waitText = ''; renderPad(); });
}
function padChoose(a) {
  if (!V || !V.awaiting || !V.awaiting.L.includes(a)) return;
  const r = V.awaiting.resolve; V.awaiting = null; renderPad(); r(a);
}
async function runSeries() {
  const myV = V;
  for (let g = 0; g < myV.bo && !myV.aborted; g++) {
    myV.game = g;
    const b = newBattle(myV.gears[0], myV.gears[1]); myV.b = b;
    myV.frames = [{ snap: snapshot(b), ev: [], acts: null, dec: [null, null] }];
    if (g > 0) myV.log.push(t('b.gameSep', { n: g + 1 }));
    drawFrame(myV.frames[0], false); renderPad();
    if (myV.delay) await wait(350);
    while (!b.over && !myV.aborted) {
      const acts = [null, null], dec = [null, null];
      for (const i of [0, 1]) { const s = myV.sides[i]; if (s.ctrl) { acts[i] = s.ctrl.decide(b, i); dec[i] = s.ctrl.last; } }
      if (myV.mode === 'online') { if (!(await onlineRound(b, acts, dec))) break; }
      else for (const i of [0, 1]) if (myV.sides[i].kind === 'human') { acts[i] = await humanInput(b, i); dec[i] = { src: 'human' }; }
      if (myV.aborted) break;
      const res = step(b, acts);
      for (const i of [0, 1]) myV.sides[i].ctrl && myV.sides[i].ctrl.observe(b, i, res);
      const fr = { snap: snapshot(b), ev: res.ev, acts: res.acts, dec };
      myV.frames.push(fr); logTurn(fr);
      if (myV.delay || !b.over) { drawFrame(fr, true); renderPad(); }
      if (myV.delay) await wait(myV.delay); else if (b.turn % 5 === 0) await wait(0);
    }
    if (myV.aborted) break;
    const w = b.over.w;
    if (w === -1) myV.sc[2]++; else myV.sc[w]++;
    myV.log.push(w === -1 ? t('b.draw') : t('b.winsLog', { name: esc(myV.names[w]), time: b.over.timeout }));
    drawFrame(myV.frames.at(-1), false);
    if (g < myV.bo - 1) await wait(myV.delay ? 1200 : 150);
  }
  if (myV !== V) return;
  myV.done = true;
  finishBattle();
}
function finishBattle() {
  const sc = V.sc, me = V.me, won = sc[me] > sc[1 - me], draw = sc[me] === sc[1 - me];
  let text = '', title = won ? t('res.win') : draw ? t('res.draw') : t('res.loss');
  if (V.aborted) { title = V.oppResigned ? t('res.resigned') : t('res.aborted'); text = V.abortText || ''; }
  else if (V.mode === 'league') text = leagueReward(won, draw);
  else if (V.mode === 'online') {
    S.stats.online++;
    if (won) { S.stats.onlineWins++; S.coins += 15; text = t('res.online'); setTimeout(() => bump('#chipCoins'), 50); }
    else text = t('res.none');
  } else text = V.sides[me].kind === 'human' ? (won ? t('res.humanWin') : t('res.humanLoss')) : '';
  if (V.oppResigned) { S.stats.online++; S.stats.onlineWins++; }
  if (S.agent.match.learn && V.mode === 'league') powerSoon();
  V.waitText = ''; renderPad();
  const color = V.aborted ? 'var(--muted)' : won ? 'var(--good)' : draw ? 'var(--ink)' : 'var(--bad)';
  $('#bResult').innerHTML = `<div class="result"><h3 style="color:${color}">${title}</h3>${text ? `<p>${text}</p>` : ''}
    <div class="row">${V.frames.length > 1 ? `<button class="btn" data-action="bReplay">${t('res.replay')}</button>` : ''}
    ${V.mode === 'online' ? (UI.duel.connected ? `<button class="btn primary" data-action="duelReady">${t('res.rematch')}</button>` : '') : `<button class="btn primary" data-action="bAgain">${t('res.again')}</button>`}
    <button class="btn" data-action="bClose">${t('close')}</button></div></div>`;
  renderHeader(); saveSoon();
}
function leagueReward(won, draw) {
  const i = V.botIdx, bot = BOTS[i], N = V.bo, r = S.league.rec[i] || (S.league.rec[i] = { w: 0, d: 0, l: 0 });
  S.stats.matches++;
  if (won) {
    const first = r.w === 0; r.w++; S.stats.wins++;
    const c = Math.round(bot.coins * BO_COIN[N]); let p = bot.packs * BO_PACK[N];
    const parts = [t('rw.coins', { c })];
    if (p) parts.push(t('rw.packs', { p }));
    let tail = '';
    if (first) {
      p += 2; parts.push(t('rw.first'));
      if (bot.loot.length) tail += '. ' + t('rw.unlocked', { items: bot.loot.map(x => esc(gName(x))).join(', ') });
      if (i + 1 < BOTS.length && S.league.unlocked < i + 2) { S.league.unlocked = i + 2; UI.selBot = i + 1; tail += '. ' + t('rw.newOpp', { bot: esc(botName(i + 1)) }); }
    }
    S.coins += c; S.packs += p; setTimeout(() => { bump('#chipCoins'); bump('#chipPacks'); }, 50);
    return parts.join(', ') + tail + '.';
  }
  if (draw) { r.d++; const c = Math.floor(bot.coins * BO_COIN[N] * 0.25); S.coins += c; return c ? t('rw.draw', { c }) : t('res.none'); }
  r.l++; return t('rw.loss');
}
function closeBattle() {
  if (!V) return;
  if (!V.done) {
    V.aborted = true;
    if (V.mode === 'online') { UI.duel.link && UI.duel.link.send({ k: 'resign' }); UI.duel.wake(); }
    if (V.awaiting) { const r = V.awaiting.resolve; V.awaiting = null; r('block'); }
  }
  V = null;
  $('#battle').hidden = true; $('#battle').innerHTML = ''; document.body.style.overflow = '';
  refresh();
}
function showReplay(idx) {
  const n = V.frames.length - 1;
  V.replay = Math.max(0, Math.min(n, idx));
  const fr = V.frames[V.replay];
  drawFrame(fr, false); if (fr.ev) playFx(fr);
  $('#bReplay').innerHTML = `<div class="card" style="padding:12px;gap:8px"><span class="eyebrow">${t('replay.title')}</span>
    <div class="replay"><button class="btn icon sm" data-action="rPrev" aria-label="${t('replay.prev')}">◀</button><input type="range" id="rSlider" min="0" max="${n}" value="${V.replay}" aria-label="${t('replay.pick')}"><button class="btn icon sm" data-action="rNext" aria-label="${t('replay.next')}">▶</button></div>
    <span class="small mono">${t('replay.round', { r: fr.snap.turn, n })}${fr.acts ? ` · ${esc(V.names[0])}: ${actLabel(fr.acts[0])} · ${esc(V.names[1])}: ${actLabel(fr.acts[1])}` : ''}</span></div>`;
}
function startLeague() {
  if (busy) return;
  const A = S.agent, bot = BOTS[UI.selBot], nm = botName(UI.selBot);
  openBattle({
    mode: 'league', botIdx: UI.selBot, title: t('title.league', { bot: nm }), names: [A.name, nm], me: 0, gears: [{ ...A.gear }, { ...bot.gear }], bo: UI.bo, delay: DELAY[UI.speed],
    sides: [{ kind: 'agent', ctrl: agentCtrl(A, { eps: A.match.eps, learn: A.match.learn, useTac: A.match.tac, countTac: true }) }, { kind: 'bot', ctrl: botCtrl(bot) }],
  });
  runSeries();
}
function startHuman() {
  if (busy) return;
  const A = S.agent, self = UI.humanOpp === 'self', bot = self ? null : BOTS[+UI.humanOpp], nm = self ? A.name : botName(+UI.humanOpp);
  openBattle({
    mode: 'human', title: t('title.youVs', { name: nm }), names: [t('you'), nm], me: 0, gears: [{ ...A.gear }, self ? { ...A.gear } : { ...bot.gear }], bo: 1, delay: 380,
    sides: [{ kind: 'human' }, self ? { kind: 'agent', ctrl: agentCtrl(A, { eps: A.match.eps, learn: A.match.learn, useTac: A.match.tac, countTac: true }) } : { kind: 'bot', ctrl: botCtrl(bot) }],
  });
  runSeries();
}
function again() {
  const mode = V.cfg.mode;
  closeBattle();
  if (mode === 'league') startLeague(); else if (mode === 'human') startHuman();
}

/* =================== Online-Duell =================== */
UI.duel = { phase: 'idle', role: null, ctrl: 'agent', code: '', answer: '', err: '', status: '', opp: null, link: null, connected: false, myReady: 0, oppReady: 0, fightNo: 0, rb: {}, waker: null, wake() { const w = this.waker; this.waker = null; w && w(); } };
async function waitFor(cond) { while (!cond()) await new Promise(r => { UI.duel.waker = r; }); }
function validGear(g) {
  g = g || {};
  return { melee: GEAR.melee[g.melee] ? g.melee : 'fists', ranged: GEAR.ranged[g.ranged] ? g.ranged : 'sling', armor: GEAR.armor[g.armor] ? g.armor : 'cloth' };
}
function duelHandlers() {
  const d = UI.duel;
  return {
    open() { d.connected = true; d.phase = 'connected'; d.err = ''; d.link.send({ k: 'hello', v: 1, name: S.agent.name, gear: S.agent.gear, ctrl: d.ctrl }); duelRender(); },
    close() { duelLost(t('duel.lost')); },
    state(s) { if (s === 'failed' || s === 'disconnected' || s === 'closed') duelLost(s === 'failed' ? t('duel.failed') : t('duel.lost')); },
    msg(m) {
      const key = m.f + ':' + m.r;
      switch (m.k) {
        case 'hello': d.opp = { name: String(m.name || t('opponent')).slice(0, 20), gear: validGear(m.gear), ctrl: m.ctrl === 'human' ? 'human' : 'agent' }; duelRender(); break;
        case 'ready': d.oppReady = +m.n || 0; maybeStartOnline(); duelRender(); break;
        case 'commit': (d.rb[key] = d.rb[key] || {}).oc = String(m.h); d.wake(); break;
        case 'reveal': (d.rb[key] = d.rb[key] || {}).or = { a: String(m.a), s: String(m.s) }; d.wake(); break;
        case 'resign': if (V && V.mode === 'online' && !V.done) { V.oppResigned = true; V.aborted = true; d.wake(); if (V.awaiting) { const r = V.awaiting.resolve; V.awaiting = null; r('block'); } } break;
      }
    },
  };
}
function duelLost(msg) {
  const d = UI.duel;
  if (!d.link) return; // selbst getrennt oder schon behandelt
  d.connected = false; d.phase = 'idle'; d.err = msg; d.myReady = d.oppReady = 0;
  if (d.link) { d.link.close(); d.link = null; }
  if (V && V.mode === 'online' && !V.done) { V.aborted = true; V.abortText = msg; d.wake(); if (V.awaiting) { const r = V.awaiting.resolve; V.awaiting = null; r('block'); } }
  duelRender();
}
function duelRender() { if (UI.tab === 'duel' && !V) renderDuel(); }
function maybeStartOnline() {
  const d = UI.duel;
  if (!d.myReady || d.myReady !== d.oppReady || !d.opp || d.fightNo === d.myReady) return;
  d.fightNo = d.myReady; d.rb = {};
  if (V) { V.done = true; V = null; }
  const A = S.agent, me = d.role === 'host' ? 0 : 1;
  const names = me === 0 ? [A.name, d.opp.name] : [d.opp.name, A.name];
  const gears = me === 0 ? [{ ...A.gear }, d.opp.gear] : [d.opp.gear, { ...A.gear }];
  const mine = d.ctrl === 'agent' ? { kind: 'agent', ctrl: agentCtrl(A, { eps: 0, useTac: A.match.tac, countTac: true }) } : { kind: 'human' };
  const sides = me === 0 ? [mine, { kind: 'remote' }] : [{ kind: 'remote' }, mine];
  openBattle({ mode: 'online', title: t('title.duel', { name: d.opp.name }), names, me, gears, sides, bo: 1, delay: 650 });
  runSeries();
}
async function onlineRound(b, acts, dec) {
  const d = UI.duel, me = V.me, myV = V, key = d.fightNo + ':' + (b.turn + 1);
  if (acts[me] == null) { acts[me] = await humanInput(b, me); dec[me] = { src: 'human' }; }
  if (myV.aborted) return false;
  const n = nonce(), h = await sha256(key + ':' + acts[me] + ':' + n);
  const rb = d.rb[key] = d.rb[key] || {};
  d.link.send({ k: 'commit', f: d.fightNo, r: b.turn + 1, h });
  myV.waitText = t('duel.waitMove'); renderPad();
  await waitFor(() => rb.oc || myV.aborted || !d.connected);
  if (myV.aborted || !d.connected) return false;
  d.link.send({ k: 'reveal', f: d.fightNo, r: b.turn + 1, a: acts[me], s: n });
  await waitFor(() => rb.or || myV.aborted || !d.connected);
  if (myV.aborted || !d.connected) return false;
  const ok = ACTIONS.includes(rb.or.a) && (await sha256(key + ':' + rb.or.a + ':' + rb.or.s)) === rb.oc;
  if (!ok) { myV.aborted = true; myV.abortText = t('duel.mismatch'); return false; }
  acts[1 - me] = rb.or.a; dec[1 - me] = { src: 'remote' };
  myV.waitText = ''; return true;
}
/* ---------- Einladungslink, QR-Code und Scanner ---------- */
const CODE_RE = /QA1[zp][A-Za-z0-9_-]{20,}/;
const extractCode = s => { const m = String(s || '').replace(/\s+/g, '').match(CODE_RE); return m ? m[0] : null; };
const appBase = () => location.origin + location.pathname.replace(/index\.html$/, '');
const inviteLink = code => `${appBase()}#join=${code}`;
const answerLink = code => `${appBase()}#answer=${code}`;
const qrCache = new Map();
function paintQRs() {
  document.querySelectorAll('canvas[data-qr]').forEach(c => {
    const txt = c.dataset.qr;
    let q = qrCache.get(txt);
    if (!q) { try { q = encodeQR(txt, 'L'); qrCache.set(txt, q); } catch { c.hidden = true; return; } }
    drawQR(c, q, 4);
  });
}
async function copyText(text, msg, fallbackSel) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { const el = fallbackSel && $(fallbackSel); if (el) { el.hidden = false; el.focus(); el.select(); } toast(t('copy.fail')); }
}
async function shareLink(url, text) {
  try { if (navigator.share) { await navigator.share({ title: t('share.title'), text, url }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  copyText(url, t('copy.link'), '#codeOut');
}
let canScan = false;
(async () => { try { canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia && (await BarcodeDetector.getSupportedFormats()).includes('qr_code'); } catch { canScan = false; } if (canScan && UI.tab === 'duel' && !V) renderDuel(); })();
async function openScanner(onCode) {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `<div class="scanbox"><video playsinline muted></video><i class="scanframe"></i></div><p>${t('scan.text')}</p><button class="btn">${t('cancel')}</button>`;
  document.body.append(ov);
  let stream, alive = true;
  const stop = () => { alive = false; stream && stream.getTracks().forEach(tr => tr.stop()); ov.remove(); };
  ov.querySelector('button').onclick = stop;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { stop(); toast(t('scan.denied')); return; }
  const video = ov.querySelector('video'); video.srcObject = stream;
  try { await video.play(); } catch { /* startet trotzdem */ }
  const det = new BarcodeDetector({ formats: ['qr_code'] });
  while (alive) {
    try { const hits = await det.detect(video); const code = hits.map(h => extractCode(h.rawValue)).find(Boolean); if (code) { stop(); onCode(code); return; } } catch { /* nächster Versuch */ }
    await wait(180);
  }
}
// Antwortlinks, die in einem zweiten Fenster geöffnet werden, an das wartende Duell weiterreichen
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('qarena-duel') : null;
if (bc) bc.onmessage = e => {
  const m = e.data || {}, d = UI.duel;
  if (m.k === 'answer' && d.phase === 'hosting' && d.code && !d.connected) { bc.postMessage({ k: 'ack', id: m.id }); acceptAnswer(m.code); }
};
function relayAnswer(code) {
  if (!bc) return Promise.resolve(false);
  const id = Math.random().toString(36).slice(2);
  return new Promise(res => {
    const tm = setTimeout(() => { bc.removeEventListener('message', on); res(false); }, 1500);
    const on = e => { if (e.data && e.data.k === 'ack' && e.data.id === id) { clearTimeout(tm); bc.removeEventListener('message', on); res(true); } };
    bc.addEventListener('message', on);
    bc.postMessage({ k: 'answer', code, id });
  });
}
let lastIncoming = '';
async function handleIncoming(url) {
  const hash = String(url || '').split('#')[1] || '';
  const join = /(?:^|&)join=/.test(hash) && extractCode(hash), ans = /(?:^|&)answer=/.test(hash) && extractCode(hash);
  if (!join && !ans) return;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if ((join || ans) === lastIncoming) return;
  lastIncoming = join || ans;
  if (V && !V.done) { toast(t('duel.finishFirst')); return; }
  if (V) closeBattle();
  const d = UI.duel;
  if (ans) {
    if (d.phase === 'hosting' && d.code && !d.connected) { setTab('duel'); acceptAnswer(ans); return; }
    const ok = await relayAnswer(ans);
    d.relay = ok ? 'ok' : ans; setTab('duel'); return;
  }
  if (d.connected || d.phase === 'hosting') { toast(t('duel.running')); setTab('duel'); return; }
  Object.assign(d, { phase: 'joining', role: 'guest', answer: '', err: '', invite: join, myReady: 0, oppReady: 0, fightNo: 0, relay: null });
  setTab('duel');
  if (!wasFresh) duelAnswer(join);
}
function qrBlock(url, label) {
  return `<figure class="qrwrap"><canvas class="qr" data-qr="${esc(url)}" role="img" aria-label="${esc(label)}"></canvas><figcaption class="small muted">${esc(label)}</figcaption></figure>`;
}
function renderDuel() {
  const d = UI.duel, A = S.agent;
  const ctrlSeg = `<div class="row"><span>${t('duel.fights')}</span><div class="seg"><button data-action="duelCtrl" data-v="agent" aria-pressed="${d.ctrl === 'agent'}">${t('duel.myAgent')}</button><button data-action="duelCtrl" data-v="human" aria-pressed="${d.ctrl === 'human'}">${t('duel.me')}</button></div></div>`;
  const scanBtn = act => canScan ? `<button class="btn" data-action="${act}">${t('duel.scan')}</button>` : '';
  const err = d.err ? `<div class="note warn">${esc(d.err)}</div>` : '';
  const cancel = `<div class="row"><button class="btn sm" data-action="duelCancel">${t('cancel')}</button></div>`;
  const relay = d.relay === 'ok'
    ? `<div class="note ok">${t('duel.relayOk')}</div>`
    : d.relay ? `<div class="note warn">${t('duel.relayNone')}<div class="row" style="margin-top:8px"><button class="btn sm" data-action="copyRelay">${t('duel.copyCode')}</button></div></div>` : '';
  let body = '';
  if (d.phase === 'idle') {
    body = `<p class="small">${t('duel.intro')}</p>
      ${relay}${ctrlSeg}${err}
      <div class="row"><button class="btn primary" data-action="duelHost">${t('duel.host')}</button><button class="btn" data-action="duelJoinStart">${t('duel.join')}</button></div>`;
  } else if (d.phase === 'hosting') {
    body = `<div class="steps">
      <div><b>${t('duel.invite')}</b>${d.code ? `<p class="small muted">${t('duel.inviteHint')}</p>
        ${qrBlock(inviteLink(d.code), t('duel.inviteQr'))}
        <div class="row"><button class="btn primary" data-action="shareInvite">${t('duel.shareLink')}</button><button class="btn" data-action="copyInvite">${t('duel.copyLink')}</button></div>
        <details><summary>${t('duel.codeInstead')}</summary><textarea id="codeOut" class="codebox" readonly aria-label="${t('duel.inviteCodeAria')}">${esc(d.code)}</textarea></details>` : `<p class="small muted"><span class="dot wait"></span>${t('duel.creating')}</p>`}</div>
      <div><b>${t('duel.takeAnswer')}</b>
        <p class="small muted">${canScan ? t('duel.scanHint') : ''}${t('duel.answerHint')}</p>
        <div class="row">${scanBtn('scanAnswer')}</div>
        <textarea id="answerIn" aria-label="${t('duel.answerAria')}" placeholder="${t('duel.answerIn')}"></textarea>
        <div class="row"><button class="btn primary" data-action="duelFinish" ${d.code ? '' : 'disabled'}>${t('duel.connect')}</button></div></div></div>
      ${err}${cancel}`;
  } else if (d.phase === 'joining') {
    const freshHint = wasFresh && d.invite && !d.answer ? `<div class="note warn">${t('duel.freshHint')}<div class="row" style="margin-top:8px"><button class="btn sm" data-action="copyInviteIn">${t('duel.copyCode')}</button></div></div>` : '';
    body = `<div class="steps">
      <div><b>${t('duel.takeInvite')}</b>${freshHint}
        <div class="row">${scanBtn('scanInvite')}</div>
        <textarea id="inviteIn" aria-label="${t('duel.inviteAria')}" placeholder="${t('duel.inviteIn')}">${esc(d.invite || '')}</textarea>
        <div class="row"><button class="btn primary" data-action="duelAnswer" ${d.answer || d.working ? 'disabled' : ''}>${wasFresh && d.invite ? t('duel.joinHere') : t('duel.makeAnswer')}</button></div></div>
      <div><b>${t('duel.giveAnswer')}</b>${d.answer ? `<p class="small muted">${t('duel.answerShow')}</p>
        ${qrBlock(answerLink(d.answer), t('duel.answerQr'))}
        <div class="row"><button class="btn primary" data-action="shareAnswer">${t('duel.shareLink')}</button><button class="btn" data-action="copyAnswer">${t('duel.copyLink')}</button></div>
        <details><summary>${t('duel.codeInstead')}</summary><textarea id="codeOut" class="codebox" readonly aria-label="${t('duel.answerCodeAria')}">${esc(d.answer)}</textarea></details>
        <p class="small muted"><span class="dot wait"></span>${t('duel.waitTake')}</p>` : d.working ? `<p class="small muted"><span class="dot wait"></span>${t('duel.answerWorking')}</p>` : `<p class="small muted">${t('duel.afterStep1')}</p>`}</div></div>
      ${err}${cancel}`;
  } else if (d.phase === 'connected') {
    const waitingOpp = d.myReady && d.oppReady !== d.myReady;
    body = `<p><span class="dot on"></span>${t('duel.connected', { name: d.opp ? esc(d.opp.name) : '' })}</p>
      ${d.opp ? `<p class="small muted">${t('duel.oppGear', { gear: esc(gearLine(d.opp.gear)), human: d.opp.ctrl === 'human' })}</p>` : ''}
      ${ctrlSeg}
      <div class="row"><button class="btn primary" data-action="duelReady" ${waitingOpp ? 'disabled' : ''}>${d.fightNo ? t('duel.next') : t('duel.start')}</button><button class="btn danger sm" data-action="duelCancel">${t('duel.disconnect')}</button></div>
      ${waitingOpp ? `<p class="small muted"><span class="dot wait"></span>${t('duel.waitReady')}</p>` : d.oppReady > d.fightNo && d.oppReady !== d.myReady ? `<p class="small">${t('duel.oppReady')}</p>` : ''}`;
  }
  $('#view').innerHTML = `<div class="grid">
    <section class="card"><header><h2>${t('duel.title')}</h2><span class="small muted">${t('duel.stats', { w: S.stats.onlineWins, n: S.stats.online })}</span></header>${body}</section>
    <section class="card"><h2>${t('duel.how')}</h2>
      <ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${[1, 2, 3, 4, 5].map(i => `<li>${t('duel.how' + i)}</li>`).join('')}</ul>
      <p class="small muted">${t('duel.compete', { name: esc(A.name), gear: esc(gearLine(A.gear)) })}</p></section></div>`;
  paintQRs();
}
async function duelHost() {
  const d = UI.duel; d.err = ''; d.role = 'host'; d.phase = 'hosting'; d.code = ''; d.myReady = d.oppReady = d.fightNo = 0; renderDuel();
  try { d.link = new Link(duelHandlers()); d.code = await d.link.host(); }
  catch (e) { d.phase = 'idle'; d.err = t('duel.errCreate', { msg: e.message || e }); }
  duelRender();
}
async function duelAnswer(given) {
  const d = UI.duel, code = extractCode(given || ($('#inviteIn') || {}).value);
  d.err = '';
  if (!code) { d.err = t('duel.errNoInvite'); renderDuel(); return; }
  if (d.working || d.answer) return;
  d.invite = code; d.working = true; duelRender();
  try { d.link = new Link(duelHandlers()); d.answer = await d.link.join(code); }
  catch { d.err = t('duel.errInvite'); if (d.link) d.link.close(); d.link = null; }
  d.working = false;
  duelRender();
}
async function acceptAnswer(code) {
  const d = UI.duel; d.err = '';
  if (!code) { d.err = t('duel.errNoAnswer'); duelRender(); return; }
  if (!d.link) { d.err = t('duel.errNoDuel'); duelRender(); return; }
  try { await d.link.finish(code); toast(t('duel.connecting')); }
  catch { d.err = t('duel.errAnswer'); }
  duelRender();
}
function duelFinish() { acceptAnswer(extractCode(($('#answerIn') || {}).value)); }
function duelCancel() {
  const d = UI.duel;
  const l = d.link; d.link = null; if (l) l.close();
  Object.assign(d, { phase: 'idle', role: null, code: '', answer: '', invite: null, working: false, relay: null, err: '', opp: null, connected: false, myReady: 0, oppReady: 0, fightNo: 0, rb: {} });
  renderDuel();
}
function duelReady() {
  const d = UI.duel; if (!d.connected) return;
  d.myReady = d.fightNo + 1;
  d.link.send({ k: 'hello', v: 1, name: S.agent.name, gear: S.agent.gear, ctrl: d.ctrl });
  d.link.send({ k: 'ready', n: d.myReady });
  if (V && V.done) { V.waitText = t('duel.waitReady'); $('#bResult').innerHTML = `<p class="small muted"><span class="dot wait"></span>${V.waitText}</p>`; }
  maybeStartOnline(); duelRender();
}

/* =================== Shop =================== */
function itemHTML(o) {
  return `<div class="item ${o.owned ? 'owned' : ''}"><span class="kind">${o.kind}</span><h3>${esc(o.name)}</h3><p class="small muted" style="flex:1">${o.desc}</p>
    <div class="row" style="justify-content:space-between"><span class="price">${o.owned ? '' : o.price ? t('shop.coins', { n: fmtInt(o.price) }) : ''}</span>
    ${o.owned ? `<span class="small muted">${t('shop.owned')}</span>` : o.locked ? `<span class="small muted">${o.locked}</span>` : `<button class="btn primary sm" data-action="buy" data-v="${o.id}" ${S.coins < o.price ? 'disabled' : ''}>${t('shop.buy')}</button>`}</div></div>`;
}
function renderShop() {
  const A = S.agent, open = lootOpen();
  const packs = Object.entries(PACK_PRICE).map(([id, [n, p]]) => itemHTML({ id, kind: t('shop.training'), name: t('shop.packName', { n }), desc: t('shop.packDesc', { fights: fmtInt(n * 1000), save: n > 1 ? n * 60 - p : 0 }), price: p }));
  const gear = Object.keys(GEAR_PRICE).sort((a, b) => GEAR_PRICE[a] - GEAR_PRICE[b]).map(id => {
    const cat = GEAR_CAT[id];
    return itemHTML({ id: 'gear:' + id, kind: t('slot.' + cat), name: gName(id), desc: esc(gDesc(id)), price: GEAR_PRICE[id], owned: S.owned[cat].includes(id), locked: open.has(id) ? '' : t('shop.beat', { bot: esc(botName(lootOwner(id))) }) });
  });
  const sensors = SENSOR_ORDER.filter(k => SENSORS[k].price).map(k => itemHTML({ id: 'sensor:' + k, kind: t('shop.sensorKind', { n: SENSORS[k].n }), name: sName(k), desc: esc(sDesc(k)), price: SENSORS[k].price, owned: S.owned.sensors.includes(k) }));
  const ext = [
    itemHTML({ id: 'sslot', kind: t('shop.ext'), name: t('shop.sslot'), desc: A.sensorSlots >= MAX_SENSOR_SLOTS ? t('shop.sslotMax') : t('shop.sslotDesc', { n: A.sensorSlots + 1 }), price: sensorSlotPrice(), owned: A.sensorSlots >= MAX_SENSOR_SLOTS }),
    itemHTML({ id: 'tslot', kind: t('shop.ext'), name: t('shop.tslot'), desc: A.tacSlots >= MAX_TAC_SLOTS ? t('shop.tslotMax') : t('shop.tslotDesc', { n: A.tacSlots + 1 }), price: tacSlotPrice(), owned: A.tacSlots >= MAX_TAC_SLOTS }),
  ];
  $('#view').innerHTML = `<div class="stack">
    <section class="card"><header><h2>${t('shop.packsTitle')}</h2></header><div class="shopgrid">${packs.join('')}</div></section>
    <section class="card"><header><h2>${esc(t('shop.gearTitle'))}</h2><span class="small muted">${t('shop.gearSub')}</span></header><div class="shopgrid">${gear.join('')}</div></section>
    <section class="card"><header><h2>${t('shop.sensTitle')}</h2><span class="small muted">${t('shop.sensSub')}</span></header><div class="shopgrid">${sensors.join('')}</div></section>
    <section class="card"><header><h2>${t('shop.extTitle')}</h2></header><div class="shopgrid">${ext.join('')}</div></section></div>`;
}
function buy(id) {
  const A = S.agent;
  let price = 0, done = '';
  if (PACK_PRICE[id]) { price = PACK_PRICE[id][1]; if (S.coins < price) return; S.packs += PACK_PRICE[id][0]; done = t('bought.packs', { n: PACK_PRICE[id][0] }); }
  else if (id.startsWith('gear:')) {
    const g = id.slice(5), cat = GEAR_CAT[g]; price = GEAR_PRICE[g];
    if (S.coins < price || S.owned[cat].includes(g) || !lootOpen().has(g)) return;
    S.owned[cat].push(g); done = t('bought.gear', { name: gName(g) });
  } else if (id.startsWith('sensor:')) {
    const k = id.slice(7); price = SENSORS[k].price;
    if (S.coins < price || S.owned.sensors.includes(k)) return;
    S.owned.sensors.push(k); done = t('bought.sensor', { name: sName(k) });
  } else if (id === 'sslot') { price = sensorSlotPrice(); if (S.coins < price || A.sensorSlots >= MAX_SENSOR_SLOTS) return; A.sensorSlots++; done = t('bought.sslot'); }
  else if (id === 'tslot') { price = tacSlotPrice(); if (S.coins < price || A.tacSlots >= MAX_TAC_SLOTS) return; A.tacSlots++; done = t('bought.tslot'); }
  S.coins -= price; toast(done); refresh(); bump('#chipCoins');
}

/* =================== Spielstand-Datei =================== */
function exportSave() {
  const blob = new Blob([JSON.stringify({ kind: 'q-arena-save', ...S }, round3)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `q-arena-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function readImport(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try { const d = JSON.parse(fr.result); if (d.kind !== 'q-arena-save' || !d.agent || !d.owned) throw 0; delete d.kind; UI.importData = migrate(d); }
    catch { UI.importData = null; toast(t('msg.notSave')); }
    renderAgent();
  };
  fr.readAsText(file);
}

/* =================== Ereignisse =================== */
document.addEventListener('click', e => {
  const tab = e.target.closest('#tabs button'); if (tab) { if (!V) setTab(tab.dataset.tab); return; }
  const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
  const act = b.dataset.action, v = b.dataset.v, ri = +b.dataset.r, A = S.agent;
  switch (act) {
    case 'sensor': {
      if (busy) return;
      const on = A.sensors.includes(v);
      if (on && A.sensors.length === 1) { toast(t('msg.minSensor')); return; }
      if (!on && A.sensors.length >= A.sensorSlots) { toast(t('msg.slotsFull')); return; }
      A.sensors = on ? A.sensors.filter(x => x !== v) : [...A.sensors, v];
      refresh(); powerSoon(); break;
    }
    case 'useBrain': A.sensors = v.split(','); toast(t('msg.brainOn')); refresh(); powerSoon(); break;
    case 'askConfirm': UI.confirm = v; renderAgent(); break;
    case 'cancelConfirm': UI.confirm = null; renderAgent(); break;
    case 'doConfirm':
      UI.confirm = null;
      if (v.startsWith('brain:')) { delete A.brains[v.slice(6)]; toast(t('msg.brainDeleted')); }
      if (v === 'wipeBrain') { delete A.brains[brainKey(A.sensors)]; A.params.eps = DEFAULT_PARAMS.eps; toast(t('msg.brainDeleted')); powerSoon(); }
      if (v === 'wipeAll') { S = defaultSave(); S.power = combatPower(S.agent); UI.prog = ''; UI.selBot = 0; toast(t('msg.reset')); }
      refresh(); break;
    case 'exportSave': exportSave(); break;
    case 'doImport': S = UI.importData; UI.importData = null; if (S.power == null) S.power = combatPower(S.agent); toast(t('msg.loaded')); refresh(); break;
    case 'cancelImport': UI.importData = null; renderAgent(); break;
    case 'tmode': UI.trainMode = v; if (!busy) UI.prog = ''; renderTraining(); break;
    case 'tn': UI.trainN = +v; renderTraining(); break;
    case 'train': startTraining(); break;
    case 'preset': { const eps = A.params.eps; Object.assign(A.params, DEFAULT_PARAMS, PRESETS[v]); if (getBrain(A, false).fights) A.params.eps = eps; toast(t('preset.applied', { name: t('preset.' + v) })); refresh(); break; }
    case 'addTac': if (A.tactics.length < A.tacSlots) { const tac = newTactic(v); tac.name = t('tpl.' + (v || '')); A.tactics.push(tac); refresh(); powerSoon(); } break;
    case 'delTac': A.tactics.splice(ri, 1); refresh(); powerSoon(); break;
    case 'tacUp': if (ri > 0) { [A.tactics[ri - 1], A.tactics[ri]] = [A.tactics[ri], A.tactics[ri - 1]]; refresh(); powerSoon(); } break;
    case 'tacDown': if (ri < A.tactics.length - 1) { [A.tactics[ri + 1], A.tactics[ri]] = [A.tactics[ri], A.tactics[ri + 1]]; refresh(); powerSoon(); } break;
    case 'addCond': A.tactics[ri].conds.push({ type: 'dist', op: '=', val: 1 }); refresh(); powerSoon(); break;
    case 'delCond': A.tactics[ri].conds.splice(+b.dataset.c, 1); refresh(); powerSoon(); break;
    case 'selBot': if (+v < S.league.unlocked) { UI.selBot = +v; renderArena(); } break;
    case 'bo': UI.bo = +v; renderArena(); break;
    case 'speed': UI.speed = v; renderArena(); break;
    case 'startLeague': startLeague(); break;
    case 'startHuman': startHuman(); break;
    case 'bClose': closeBattle(); break;
    case 'bAgain': again(); break;
    case 'bReplay': showReplay(0); break;
    case 'rPrev': showReplay(V.replay - 1); break;
    case 'rNext': showReplay(V.replay + 1); break;
    case 'pad': padChoose(v); break;
    case 'buy': buy(v); break;
    case 'duelCtrl': UI.duel.ctrl = v; renderDuel(); if (UI.duel.connected) UI.duel.link.send({ k: 'hello', v: 1, name: A.name, gear: A.gear, ctrl: v }); break;
    case 'duelHost': duelHost(); break;
    case 'duelJoinStart': Object.assign(UI.duel, { phase: 'joining', role: 'guest', answer: '', invite: null, working: false, relay: null, err: '', myReady: 0, oppReady: 0, fightNo: 0 }); renderDuel(); break;
    case 'duelAnswer': duelAnswer(); break;
    case 'duelFinish': duelFinish(); break;
    case 'shareInvite': shareLink(inviteLink(UI.duel.code), t('share.invite', { name: A.name })); break;
    case 'copyInvite': copyText(inviteLink(UI.duel.code), t('copy.invite'), '#codeOut'); break;
    case 'shareAnswer': shareLink(answerLink(UI.duel.answer), t('share.answer')); break;
    case 'copyAnswer': copyText(answerLink(UI.duel.answer), t('copy.answer'), '#codeOut'); break;
    case 'copyRelay': copyText(UI.duel.relay, t('copy.code')); break;
    case 'copyInviteIn': copyText(UI.duel.invite, t('copy.code'), '#inviteIn'); break;
    case 'scanAnswer': openScanner(code => acceptAnswer(code)); break;
    case 'scanInvite': openScanner(code => duelAnswer(code)); break;
    case 'duelCancel': duelCancel(); break;
    case 'duelReady': duelReady(); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target, A = S.agent;
  if (el.dataset.param) { const d = PARAM_DEFS.find(p => p.k === el.dataset.param); A.params[d.k] = +el.value; $('#o-' + d.k).textContent = fmt(+el.value, d.d); saveSoon(); return; }
  if (el.id === 'agentName') { A.name = el.value.trim() || 'Agent'; saveSoon(); return; }
  if (el.id === 'm-eps') { A.match.eps = +el.value; $('#mo-eps').textContent = fmt(+el.value, 2); saveSoon(); return; }
  if (el.id === 'rSlider') { showReplay(+el.value); return; }
  if (el.dataset.tac === 'name') { A.tactics[+el.dataset.r].name = el.value; saveSoon(); return; }
  if (el.dataset.tac === 'val' && el.type === 'number') { A.tactics[+el.dataset.r].conds[+el.dataset.c].val = +el.value; saveSoon(); powerSoon(); }
});
document.addEventListener('change', e => {
  const el = e.target, A = S.agent;
  if (el.id === 'langSel') { setLang(el.value); applyStatic(); refresh(); return; }
  if (el.id === 'sparSel') { UI.spar = +el.value; return; }
  if (el.id === 'humanOpp') { UI.humanOpp = el.value; return; }
  if (el.id === 'tacTrain') { A.tacInTraining = el.checked; saveSoon(); return; }
  if (el.id === 'm-tac') { A.match.tac = el.checked; saveSoon(); powerSoon(); return; }
  if (el.id === 'm-learn') { A.match.learn = el.checked; saveSoon(); return; }
  if (el.id === 'bDanger') { V.danger = el.checked; drawFrame(V.replay != null ? V.frames[V.replay] : V.frames.at(-1), false); return; }
  if (el.id === 'importFile' && el.files[0]) { readImport(el.files[0]); return; }
  if (el.dataset.gear) { A.gear[el.dataset.gear] = el.value; refresh(); powerSoon(); return; }
  const k = el.dataset.tac; if (!k) return;
  const r = A.tactics[+el.dataset.r];
  if (k === 'on') r.on = el.checked;
  else if (k === 'act') r.act = el.value;
  else if (k === 'ctype') { const d = TCOND[el.value]; r.conds[+el.dataset.c] = d.ops ? { type: el.value, op: d.ops[0], val: d.num[2] } : { type: el.value, val: d.vals[0] }; }
  else if (k === 'op') r.conds[+el.dataset.c].op = el.value;
  else if (k === 'val' && el.tagName === 'SELECT') r.conds[+el.dataset.c].val = el.value;
  else return;
  refresh(); powerSoon();
});
document.addEventListener('keydown', e => {
  if (!V || !V.awaiting || e.target.matches('input, textarea, select')) return;
  const map = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', 1: 'melee', 2: 'ranged', 3: 'block', 4: 'charge' };
  let a = map[e.key]; if (!a) return;
  if (MOVES[a] && V.me === 1) a = FLIP[a];
  e.preventDefault(); padChoose(a);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

/* =================== Start =================== */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; });
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const ask = w => { $('#updateBar').hidden = false; $('#updateBtn').onclick = () => w.postMessage('skipWaiting'); };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); }); });
  }).catch(() => { /* z. B. file:// – App läuft trotzdem */ });
  // Nur nach einem bestätigten Update neu laden, nicht beim allerersten Besuch (dort übernimmt der SW nur die Kontrolle)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
S = load();
const wasFresh = !S;
if (!S) S = defaultSave();
if (S.power == null) S.power = combatPower(S.agent);
applyStatic();
renderHeader();
let startTab = 'agent'; try { startTab = localStorage.getItem('qarena.tab') || startTab; } catch { /* egal */ }
setTab(startTab);
registerSW();
// Einladungs- und Antwortlinks: beim Öffnen per Link und, in der installierten App, über die Launch-Queue
handleIncoming(location.href);
if ('launchQueue' in window) window.launchQueue.setConsumer(p => { if (p && p.targetURL) handleIncoming(p.targetURL); });
window.addEventListener('hashchange', () => handleIncoming(location.href));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* optional */ }
