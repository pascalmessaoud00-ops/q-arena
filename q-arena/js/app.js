// Q-Arena – Oberfläche, Spielstand, Kampfansicht und Online-Duell.
import { ACTIONS, MOVES, ACTION_LABEL, GEAR, STARTER_GEAR, SIZE, MAX_TURNS, newBattle, step, legal, snapshot, meleeReach, rangedReach } from './engine.js';
import { SENSORS, SENSOR_ORDER, STARTER_SENSORS, sortSensors, brainKey, stateSpace, DEFAULT_PARAMS, PRESETS, TCOND, TACT, newTactic, agentCtrl, botCtrl, runFight, combatPower, BOTS, getBrain } from './brain.js';
import { Link, sha256, nonce } from './net.js';
import { encodeQR, drawQR } from './qr.js';

/* =================== Hilfen =================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 2) => (+v).toFixed(d).replace('.', ',').replace(/^-/, '−');
const fmtInt = v => Math.round(v).toLocaleString('de-DE');
const wait = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800); }
function bump(sel) { const e = $(sel); if (!e) return; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
const initial = n => (String(n).trim()[0] || '?').toUpperCase();
const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
const FLIP = { up: 'down', down: 'up', left: 'right', right: 'left' };

/* =================== Spielstand =================== */
const SAVE = 'qarena.save.v1';
const GEAR_CAT = {};
for (const cat of ['melee', 'ranged', 'armor']) for (const id in GEAR[cat]) GEAR_CAT[id] = cat;
const GEAR_PRICE = { leather: 60, sword: 90, net: 120, daggers: 140, cloak: 140, bow: 160, spear: 180, chain: 200, axe: 280, crossbow: 280, plate: 320 };
const SLOT_LABEL = { melee: 'Nahkampf', ranged: 'Fernkampf', armor: 'Panzerung' };
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
      name: 'Agent Nr. 1', gear: { ...STARTER_GEAR }, sensors: [...STARTER_SENSORS], brains: {}, params: { ...DEFAULT_PARAMS },
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
function load() { try { const t = localStorage.getItem(SAVE); return t ? migrate(JSON.parse(t)) : null; } catch { return null; } }
const round3 = (k, v) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v;
function saveNow() {
  try { localStorage.setItem(SAVE, JSON.stringify(S, round3)); }
  catch { toast('Speichern fehlgeschlagen: Der Speicher ist voll. Lösche alte Gehirne im Tab Agent.'); }
}
let saveT = null;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
let powT = null;
function powerSoon() {
  clearTimeout(powT);
  powT = setTimeout(() => { S.power = combatPower(S.agent); renderHeader(); const e = $('#powerVal'); if (e) e.textContent = S.power; saveSoon(); }, 450);
}
function lootOpen() { const s = new Set(); BOTS.forEach((b, i) => { if ((S.league.rec[i] || {}).w > 0) b.loot.forEach(x => s.add(x)); }); return s; }
const lootOwner = id => BOTS.find(b => b.loot.includes(id));

let S = null;
const UI = { tab: 'agent', trainMode: 'random', spar: 0, trainN: 1, prog: '', bo: 1, speed: 'normal', selBot: 0, humanOpp: 'self', confirm: null, importData: null };
let busy = false;

/* =================== Kopfleiste & Tabs =================== */
function renderHeader() {
  $('#res').innerHTML = `<div class="chip coin" id="chipCoins"><span class="lbl">Münzen</span><b>${fmtInt(S.coins)}</b></div>
    <div class="chip" id="chipPacks"><span class="lbl">Pakete</span><b>${S.packs}</b></div>
    <div class="chip"><span class="lbl">Kampfkraft</span><b>${S.power ?? '–'}</b></div>`;
}
const RENDER = { agent: renderAgent, training: renderTraining, tactics: renderTactics, arena: renderArena, duel: renderDuel, shop: renderShop };
function setTab(t) {
  if (!RENDER[t]) t = 'agent';
  UI.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  RENDER[t]();
  window.scrollTo(0, 0);
  try { localStorage.setItem('qarena.tab', t); } catch { /* egal */ }
}
function refresh() { renderHeader(); RENDER[UI.tab](); saveSoon(); }

/* =================== Agent =================== */
function chartHTML(H) {
  if (!H.length) return `<div class="note">Noch keine Trainingsdaten. Nach jedem Paket mit 1 000 Kämpfen erscheint hier ein Punkt für die Kampfkraft und ein Balken mit Siegen, Remis und Niederlagen.</div>`;
  const W = 640, pl = 34, pr = 12, pt = 22, h1 = 110, gap = 34, h2 = 100, pb = 22, iw = W - pl - pr, n = H.length, bw = iw / n, Ht = pt + h1 + gap + h2 + pb;
  const x = i => pl + bw * i + bw / 2, y1 = v => pt + h1 * (1 - v / 100), y2t = pt + h1 + gap;
  let g = '';
  for (const v of [0, 50, 100]) {
    g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y1(v)}" y2="${y1(v)}"/><text class="ax" x="${pl - 6}" y="${y1(v) + 3}" text-anchor="end">${v}</text>`;
    const yy = y2t + h2 * (1 - v / 100);
    g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="ax" x="${pl - 6}" y="${yy + 3}" text-anchor="end">${v}%</text>`;
  }
  g += `<text class="ax" x="${pl}" y="${pt - 9}" style="font-weight:700">Kampfkraft (0–100)</text><text class="ax" x="${pl}" y="${y2t - 9}" style="font-weight:700">Ergebnisse je Paket</text>`;
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
  return `<div class="chart" id="chart" data-n="${n}" data-w="${W}" data-pl="${pl}" data-bw="${bw}"><svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Lernkurve über ${n} Trainingspakete">${g}</svg><div class="tip" id="tip" hidden></div></div>
  <div class="legend"><span><i class="sw" style="background:var(--me)"></i>Kampfkraft</span><span><i class="sw" style="background:var(--good)"></i>Siege</span><span><i class="sw" style="background:var(--muted)"></i>Remis</span><span><i class="sw" style="background:var(--bad)"></i>Niederlagen</span></div>
  <details><summary>Als Tabelle anzeigen</summary><div class="tablewrap"><table><thead><tr><th>Paket</th><th>Gegner</th><th>Siege</th><th>Remis</th><th>Niederl.</th><th>ε danach</th><th>Kampfkraft</th></tr></thead><tbody>
  ${H.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.m)}</td><td>${h.w}</td><td>${h.d}</td><td>${h.l}</td><td>${fmt(h.e, 3)}</td><td>${h.s}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function bindChart() {
  const c = $('#chart'); if (!c) return;
  const svg = c.querySelector('svg'), tip = $('#tip'), line = $('#crossLine');
  const n = +c.dataset.n, W = +c.dataset.w, pl = +c.dataset.pl, bw = +c.dataset.bw;
  const hide = () => { tip.hidden = true; line.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, i = Math.floor((px - pl) / bw);
    if (i < 0 || i >= n) { hide(); return; }
    const h = S.history[i], cx = pl + bw * i + bw / 2;
    line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>Paket ${i + 1}</b> · ${esc(h.m)}<br>Kampfkraft <b class="mono">${h.s}</b><br><span style="color:var(--good)">Siege ${h.w}</span> · Remis ${h.d} · <span style="color:var(--bad)">Niederlagen ${h.l}</span><br>ε danach ${fmt(h.e, 3)}${h.k ? `<br><span class="muted">${esc(h.k)}</span>` : ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth; let left = cx / W * r.width + 12; if (left + tw > r.width) left = cx / W * r.width - tw - 12;
    tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', hide);
}
const sensorNames = keys => keys.map(k => SENSORS[k] ? SENSORS[k].name : k).join(', ');
function confirmHTML(id, text, label) {
  return UI.confirm === id ? `<div class="row note warn"><span>${text}</span><button class="btn sm danger" data-action="doConfirm" data-v="${id}">${label}</button><button class="btn sm" data-action="cancelConfirm">Abbrechen</button></div>` : '';
}
function renderAgent() {
  const A = S.agent, br = getBrain(A, false), sens = sortSensors(A.sensors), nK = Object.keys(br.q).length, space = stateSpace(sens);
  const beaten = BOTS.filter((_, i) => (S.league.rec[i] || {}).w > 0).length;
  let hint;
  if (!br.fights) hint = 'Dieses Gehirn hat noch nichts gelernt und kämpft praktisch zufällig. Starte im Tab <b>Training</b> ein Paket gegen die Strohpuppe.';
  else if (!beaten) hint = 'Erste Erfahrung ist da. Fordere in der <b>Arena</b> die Strohpuppe heraus. Siege bringen Münzen, Pakete und neue Ausrüstung.';
  else if (beaten < BOTS.length) hint = `Nächster Gegner in der Arena: <b>${esc(BOTS[Math.min(beaten, BOTS.length - 1)].name)}</b>. Gegen stärkere Gegner helfen Sparring, mehr Sensoren und Taktiken.`;
  else hint = 'Alle Liga-Gegner besiegt. Fordere Kollegen im Tab <b>Duell</b> heraus.';
  const gearRows = ['melee', 'ranged', 'armor'].map(slot => {
    const cur = A.gear[slot];
    return `<div class="slot"><label class="eyebrow" for="gear-${slot}">${SLOT_LABEL[slot]}</label>
      <select id="gear-${slot}" data-gear="${slot}" ${busy ? 'disabled' : ''}>${S.owned[slot].map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(GEAR[slot][id].name)}</option>`).join('')}</select>
      <p class="desc">${esc(GEAR[slot][cur].desc)}</p></div>`;
  }).join('');
  const ownedSens = SENSOR_ORDER.filter(k => S.owned.sensors.includes(k));
  const cur = brainKey(A.sensors);
  const others = Object.entries(A.brains).filter(([k]) => k !== cur);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#view').innerHTML = `<div class="grid">
   <section class="card">
     <div class="stack" style="gap:4px"><label class="eyebrow" for="agentName">Name deines Agenten</label><input type="text" id="agentName" class="name-input" value="${esc(A.name)}" maxlength="20"></div>
     <div class="power"><b id="powerVal">${S.power ?? '–'}</b><span class="small muted">Kampfkraft von 100.<br>72 Testkämpfe gegen alle Liga-Gegner, ohne Zufall, mit deiner Ausrüstung und deinen Taktiken.</span></div>
     <dl class="facts">
       <div><dt>Kämpfe trainiert</dt><dd>${fmtInt(br.fights)}</dd></div>
       <div><dt>Zustände bekannt</dt><dd>${fmtInt(nK)} / ${fmtInt(space)}</dd></div>
       <div><dt style="text-transform:none">ε AKTUELL</dt><dd>${fmt(A.params.eps, 3)}</dd></div>
       <div><dt>Liga besiegt</dt><dd>${beaten} / ${BOTS.length}</dd></div>
     </dl>
     <div class="note">${hint}</div>
     ${standalone ? '' : `<p class="small muted">Tipp: Installiere Q-Arena als App. Im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen, danach läuft alles offline.</p>`}
   </section>
   <section class="card">
     <header><h2>Ausrüstung</h2><span class="small muted">Neue Teile gibt es im Shop</span></header>
     <div>${gearRows}</div>
     <p class="small muted">Blocken halbiert Nahkampfschaden und hält Schüsse komplett ab. Aufladen verdoppelt den nächsten Angriff. Ausrüstung kannst du jederzeit wechseln, das Gehirn bleibt erhalten.</p>
   </section>
   <section class="card">
     <header><h2>Sensoren</h2><div class="row"><div class="slotbar" aria-hidden="true">${Array.from({ length: A.sensorSlots }, (_, i) => `<i class="${i < sens.length ? 'on' : ''}"></i>`).join('')}</div><span class="mono small">${sens.length} / ${A.sensorSlots}</span></div></header>
     <p class="small">Sensoren bestimmen, was dein Agent wahrnimmt. Mehr Sensoren unterscheiden mehr Situationen, brauchen aber mehr Training.</p>
     <div class="chips">${ownedSens.map(k => `<button class="sensor" data-action="sensor" data-v="${k}" aria-pressed="${sens.includes(k)}" ${busy ? 'disabled' : ''}><b>${esc(SENSORS[k].name)}</b><span>${SENSORS[k].n} Werte</span></button>`).join('')}</div>
     <p class="space">Zustandsraum: ${sens.map(k => SENSORS[k].n).join(' × ')} = <b>${fmtInt(space)}</b> Zustände</p>
     <ul class="small muted" style="margin:0;padding-left:18px">${sens.map(k => `<li><b>${esc(SENSORS[k].name)}:</b> ${esc(SENSORS[k].desc)}</li>`).join('')}</ul>
     <div class="note small">Jede Sensor-Kombination hat ein eigenes Gehirn. Wechselst du die Sensoren, lernt der Agent von vorn, das alte Gehirn bleibt gespeichert.</div>
     ${others.length ? `<div class="brains"><span class="eyebrow">Gespeicherte Gehirne</span>${others.map(([k, b]) => {
       const ks = k.split(','), ok = ks.every(x => S.owned.sensors.includes(x)) && ks.length <= A.sensorSlots;
       return `<div class="row"><span class="small"><b>${esc(sensorNames(ks))}</b><br><span class="muted mono">${fmtInt(b.fights)} Kämpfe · ${fmtInt(Object.keys(b.q).length)} Zustände</span></span>
         <span class="row"><button class="btn sm" data-action="useBrain" data-v="${esc(k)}" ${ok && !busy ? '' : 'disabled'}>Aktivieren</button><button class="btn sm danger" data-action="askConfirm" data-v="brain:${esc(k)}">Löschen</button></span></div>
         ${confirmHTML('brain:' + k, 'Dieses Gehirn endgültig löschen?', 'Löschen')}`;
     }).join('')}</div>` : ''}
   </section>
   <section class="card wide"><header><h2>Lernkurve</h2><span class="small muted">${S.history.length} Pakete</span></header>${chartHTML(S.history)}</section>
   <section class="card">
     <h2>Spielstand</h2>
     <p class="small muted">Der Spielstand liegt nur auf diesem Gerät. Sichere ihn regelmäßig als Datei.</p>
     <div class="row"><button class="btn" data-action="exportSave">Als Datei sichern</button><label class="btn" for="importFile" style="display:inline-flex;align-items:center">Datei laden</label><input type="file" id="importFile" accept=".json,application/json" hidden></div>
     ${UI.importData ? `<div class="note warn">Datei gelesen: <b>${esc(UI.importData.agent.name)}</b>, ${fmtInt(UI.importData.coins)} Münzen.</div><div class="row"><button class="btn danger" data-action="doImport">Aktuellen Spielstand ersetzen</button><button class="btn" data-action="cancelImport">Abbrechen</button></div>` : ''}
     <div class="row"><button class="btn danger sm" data-action="askConfirm" data-v="wipeBrain" ${busy ? 'disabled' : ''}>Aktuelles Gehirn löschen</button><button class="btn danger sm" data-action="askConfirm" data-v="wipeAll" ${busy ? 'disabled' : ''}>Alles zurücksetzen</button></div>
     ${confirmHTML('wipeBrain', 'Der Agent vergisst alles, was er mit diesen Sensoren gelernt hat.', 'Gehirn löschen')}
     ${confirmHTML('wipeAll', 'Alles wird gelöscht: Agent, Münzen, Ausrüstung, Liga-Fortschritt.', 'Alles zurücksetzen')}
   </section>
  </div>`;
  bindChart();
}

/* =================== Training =================== */
const PARAM_DEFS = [
  { g: 'Erkundung' },
  { k: 'eps', label: 'ε Zufälligkeit', min: 0, max: 1, step: 0.01, d: 3, hint: 'Anteil zufälliger Züge im Training. Hoch: probiert viel aus. Niedrig: nutzt, was er kann.' },
  { k: 'epsDecay', label: 'ε-Abklingen pro Kampf', min: 0.99, max: 1, step: 0.0001, d: 4, hint: 'ε wird nach jedem Kampf damit multipliziert. 0,9995 halbiert ε etwa alle 1 400 Kämpfe.' },
  { k: 'epsMin', label: 'ε-Minimum', min: 0, max: 0.5, step: 0.01, d: 2, hint: 'Untergrenze, damit der Agent nie ganz aufhört auszuprobieren.' },
  { k: 'qInit', label: 'Startwert neuer Züge', min: -1, max: 1, step: 0.05, d: 2, hint: 'Werte über 0 machen unerprobte Züge attraktiv.' },
  { g: 'Lernen' },
  { k: 'alpha', label: 'α Lernrate', min: 0.01, max: 1, step: 0.01, d: 2, hint: 'Wie stark eine neue Erfahrung den bisherigen Q-Wert überschreibt.' },
  { k: 'neg', label: 'Gewicht negativer Erfahrungen', min: 0.1, max: 3, step: 0.05, d: 2, hint: 'Faktor auf α, wenn ein Wert sinkt. Über 1: nachtragend und vorsichtig. Unter 1: unbekümmert.' },
  { k: 'gamma', label: 'γ Weitblick', min: 0, max: 0.99, step: 0.01, d: 2, hint: 'Wie viel spätere Belohnungen jetzt zählen. Hoch: plant Züge voraus. Niedrig: denkt nur an diese Runde.' },
  { k: 'lambda', label: 'λ Rückwirkung', min: 0, max: 1, step: 0.01, d: 2, hint: 'Wie stark ein Ergebnis auf die Züge davor zurückwirkt. Hoch: lernt Zugfolgen schneller.' },
  { g: 'Belohnungen' },
  { k: 'rWin', label: 'Belohnung Sieg', min: 0, max: 20, step: 0.5, d: 1 },
  { k: 'rLoss', label: 'Strafe Niederlage', min: -20, max: 0, step: 0.5, d: 1 },
  { k: 'rDraw', label: 'Belohnung Remis', min: -5, max: 5, step: 0.25, d: 2, hint: 'Remis gibt es bei gleichem LP-Anteil nach 30 Runden oder wenn beide fallen.' },
  { k: 'rDealt', label: 'Belohnung je verursachtem Schaden', min: 0, max: 3, step: 0.05, d: 2 },
  { k: 'rTaken', label: 'Strafe je erlittenem Schaden', min: -3, max: 0, step: 0.05, d: 2 },
  { k: 'rStep', label: 'Kosten pro Runde', min: -0.5, max: 0, step: 0.01, d: 2, hint: 'Eine kleine Strafe je Runde treibt den Agenten zu schnellen Siegen.' },
];
function paramsHTML(P) {
  return PARAM_DEFS.map(p => p.g ? `<h3 class="group-title">${p.g}</h3>` : `<div class="param"><div class="ph"><label for="p-${p.k}">${p.label}</label><output id="o-${p.k}">${fmt(P[p.k], p.d)}</output></div>
    <input type="range" id="p-${p.k}" data-param="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${P[p.k]}">${p.hint ? `<p class="hint">${p.hint}</p>` : ''}</div>`).join('');
}
const sparBots = () => BOTS.map((b, i) => ({ b, i })).filter(x => x.i < S.league.unlocked);
function renderTraining() {
  const A = S.agent, P = A.params, can = S.packs >= UI.trainN && !busy;
  if (!sparBots().some(x => x.i === UI.spar)) UI.spar = 0;
  $('#view').innerHTML = `<div class="grid">
   <section class="card">
     <header><h2>Trainingseinheit</h2><span class="small muted">1 Paket = 1 000 Kämpfe</span></header>
     <div class="modes" role="group" aria-label="Trainingsmodus">
       <button class="mode" data-action="tmode" data-v="random" aria-pressed="${UI.trainMode === 'random'}"><b>Zufallsgegner</b><span>Die Strohpuppe macht zufällige Züge. Ideal für die Grundlagen.</span></button>
       <button class="mode" data-action="tmode" data-v="spar" aria-pressed="${UI.trainMode === 'spar'}"><b>Sparring</b><span>Ein freigeschalteter Liga-Gegner mit eigenem Stil und eigener Ausrüstung.</span></button>
       <button class="mode" data-action="tmode" data-v="self" aria-pressed="${UI.trainMode === 'self'}"><b>Selbstspiel</b><span>Der Agent kämpft gegen sich selbst und lernt auf beiden Seiten.</span></button>
     </div>
     ${UI.trainMode === 'spar' ? `<div class="row"><label for="sparSel">Sparringspartner</label><select id="sparSel">${sparBots().map(x => `<option value="${x.i}" ${x.i === UI.spar ? 'selected' : ''}>${esc(x.b.name)}</option>`).join('')}</select></div>` : ''}
     <div class="row"><span>Pakete</span><div class="seg">${[1, 5, 10].map(n => `<button data-action="tn" data-v="${n}" aria-pressed="${UI.trainN === n}">${n}</button>`).join('')}</div></div>
     <label class="check"><input type="checkbox" id="tacTrain" ${A.tacInTraining ? 'checked' : ''}><span>Taktiken auch im Training ausführen<br><span class="small muted">Die Q-Table lernt trotzdem aus jedem Zug, der tatsächlich gespielt wurde.</span></span></label>
     <p class="small muted">Trainiert wird das Gehirn für <b>${esc(sensorNames(sortSensors(A.sensors)))}</b> mit deiner aktuellen Ausrüstung.</p>
     <div class="row"><button class="btn primary" data-action="train" ${can ? '' : 'disabled'}>${UI.trainN} ${UI.trainN === 1 ? 'Paket' : 'Pakete'} trainieren</button>
       ${S.packs < UI.trainN ? `<span class="small muted">Du hast ${S.packs} ${S.packs === 1 ? 'Paket' : 'Pakete'}. Mehr gibt es im Shop und für Siege in der Arena.</span>` : ''}</div>
     <div id="trainProg">${UI.prog}</div>
   </section>
   <section class="card">
     <header><h2>Lernparameter</h2></header>
     <div class="row">${Object.keys(PRESETS).map(k => `<button class="btn sm" data-action="preset" data-v="${k}">${k}</button>`).join('')}</div>
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
  const mode = UI.trainMode, bot = mode === 'spar' ? BOTS[UI.spar] : BOTS[0];
  const label = mode === 'self' ? 'Selbstspiel' : mode === 'spar' ? bot.name : 'Zufallsgegner';
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
        setProg(`<div class="stack" style="gap:8px"><div class="row" style="justify-content:space-between"><b>Paket ${pk + 1} von ${N} · ${esc(label)}</b><span class="mono small">${g + 1} / 1 000</span></div>
          <div class="progress"><i style="width:${(g + 1) / 10}%"></i></div>
          <div class="tally"><span class="w">Siege ${w}</span><span class="d">Remis ${d}</span><span class="l">Niederlagen ${l}</span><span>ε ${fmt(A.params.eps, 3)}</span></div></div>`);
        const o = $('#o-eps'), inp = $('#p-eps'); if (o) o.textContent = fmt(A.params.eps, 3); if (inp) inp.value = A.params.eps;
        await wait(0);
      }
    }
    S.power = combatPower(A);
    S.history.push({ m: label, w, d, l, e: A.params.eps, s: S.power, k: sensorNames(sortSensors(A.sensors)) });
    if (S.history.length > 300) S.history.shift();
    renderHeader(); saveSoon();
  }
  try { await lock?.release(); } catch { /* egal */ }
  busy = false;
  const h = S.history.at(-1);
  setProg(`<div class="note ok"><b>Training abgeschlossen.</b> Letztes Paket: <span style="color:var(--good)">${h.w} Siege</span>, ${h.d} Remis, <span style="color:var(--bad)">${h.l} Niederlagen</span>.<br>Kampfkraft ${before ?? '–'} → <b>${S.power}</b> · ${fmtInt(Object.keys(getBrain(A, false).q).length)} Zustände bekannt</div>`);
  refresh();
}

/* =================== Taktiken =================== */
function condHTML(c, ri, ci) {
  const d = TCOND[c.type];
  const ctl = d.ops
    ? `<select data-tac="op" data-r="${ri}" data-c="${ci}" aria-label="Vergleich">${d.ops.map(o => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select><input type="number" data-tac="val" data-r="${ri}" data-c="${ci}" min="${d.num[0]}" max="${d.num[1]}" value="${c.val}" aria-label="Wert">`
    : `<select data-tac="val" data-r="${ri}" data-c="${ci}" aria-label="Wert">${d.vals.map(v => `<option ${v === c.val ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  return `<div class="cond"><select data-tac="ctype" data-r="${ri}" data-c="${ci}" aria-label="Bedingung">${Object.entries(TCOND).map(([k, v]) => `<option value="${k}" ${k === c.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select>${ctl}<button class="btn icon sm" data-action="delCond" data-r="${ri}" data-c="${ci}" aria-label="Bedingung entfernen">×</button></div>`;
}
function renderTactics() {
  const A = S.agent, full = A.tactics.length >= A.tacSlots, n = A.tactics.length;
  const acts = Object.entries(TACT);
  $('#view').innerHTML = `<div class="stack">
   <section class="card">
     <header><h2>Taktiken</h2><div class="row"><div class="slotbar" aria-hidden="true">${Array.from({ length: A.tacSlots }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div><span class="mono small">${n} / ${A.tacSlots} Slots</span></div></header>
     <p class="small">Taktiken sind feste Reflexe, die vor der Q-Table geprüft werden. Die erste Taktik von oben, deren Bedingungen alle zutreffen, entscheidet. Ist ihre Aktion gerade nicht möglich, geht es mit der nächsten weiter.</p>
     <div class="row"><button class="btn primary" data-action="addTac" data-v="" ${full ? 'disabled' : ''}>+ Leere Taktik</button>
       <span class="small muted">Vorlagen:</span>${[['snipe', 'Scharfschuss'], ['retreat', 'Rückzug'], ['counter', 'Konter'], ['dodge', 'Ladung ausweichen']].map(([k, l]) => `<button class="btn sm" data-action="addTac" data-v="${k}" ${full ? 'disabled' : ''}>${l}</button>`).join('')}</div>
     ${full ? `<p class="small muted">Alle Slots belegt. Weitere Slots gibt es im Shop.</p>` : ''}
   </section>
   ${A.tactics.map((r, ri) => `<article class="rule ${r.on ? '' : 'off'}">
     <div class="rule-head"><span class="prio" title="Priorität">${ri + 1}</span><input type="text" data-tac="name" data-r="${ri}" value="${esc(r.name)}" maxlength="28" aria-label="Name der Taktik">
       <label class="check" style="align-items:center"><input type="checkbox" data-tac="on" data-r="${ri}" ${r.on ? 'checked' : ''}><span>aktiv</span></label>
       <span class="mono small muted">${r.fired || 0}× ausgelöst</span>
       <button class="btn icon sm" data-action="tacUp" data-r="${ri}" ${ri === 0 ? 'disabled' : ''} aria-label="Priorität erhöhen">↑</button>
       <button class="btn icon sm" data-action="tacDown" data-r="${ri}" ${ri === n - 1 ? 'disabled' : ''} aria-label="Priorität senken">↓</button>
       <button class="btn icon sm danger" data-action="delTac" data-r="${ri}" aria-label="Taktik löschen">×</button></div>
     <div class="rule-body">
       <div class="stack"><h3>Wenn alle Bedingungen gelten …</h3>${r.conds.length ? r.conds.map((c, ci) => condHTML(c, ri, ci)).join('') : '<span class="small muted">Keine Bedingung: greift immer.</span>'}<div><button class="btn sm" data-action="addCond" data-r="${ri}">+ Bedingung</button></div></div>
       <div class="stack"><h3>… dann</h3><select data-tac="act" data-r="${ri}" aria-label="Aktion">
         <optgroup label="Aktion">${acts.slice(0, 4).map(([k, v]) => `<option value="${k}" ${k === r.act ? 'selected' : ''}>${v}</option>`).join('')}</optgroup>
         <optgroup label="Bewegung">${acts.slice(4).map(([k, v]) => `<option value="${k}" ${k === r.act ? 'selected' : ''}>${v}</option>`).join('')}</optgroup></select>
         <p class="small muted">„Hoch“, „Runter“, „Links“, „Rechts“ gelten aus Sicht deines Agenten: Hoch führt immer Richtung Startfeld des Gegners.</p></div>
     </div></article>`).join('') || '<div class="note">Noch keine Taktiken. Starte mit einer Vorlage, zum Beispiel „Scharfschuss“.</div>'}
   <p class="small muted">Taktiken wirken in Arena, Duell und Kampfkraft-Messung. Im Training nur, wenn du es dort einschaltest.</p></div>`;
}

/* =================== Arena =================== */
function botReward(bot, N) { const c = Math.round(bot.coins * BO_COIN[N]), p = bot.packs * BO_PACK[N]; return `Sieg: ${c} Münzen${p ? ` + ${p} ${p === 1 ? 'Paket' : 'Pakete'}` : ''}`; }
const gearLine = g => `${GEAR.melee[g.melee].name} · ${GEAR.ranged[g.ranged].name} · ${GEAR.armor[g.armor].name}`;
function renderArena() {
  const A = S.agent, M = A.match;
  if (UI.selBot >= S.league.unlocked) UI.selBot = 0;
  const bots = BOTS.map((b, i) => {
    const locked = i >= S.league.unlocked, r = S.league.rec[i] || { w: 0, d: 0, l: 0 };
    return `<button class="bot ${locked ? 'locked' : ''}" data-action="selBot" data-v="${i}" aria-pressed="${UI.selBot === i}" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="avatar" style="${i >= 4 ? 'background:var(--ink)' : ''}">${esc(b.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>
      <span class="nm">${esc(b.name)}<span class="lvl">Stufe ${i + 1}</span></span>
      <span class="tg">${locked ? `Besiege ${esc(BOTS[i - 1].name)}, um freizuschalten.` : esc(b.tag)}</span>
      ${locked ? '' : `<span class="gear muted">${esc(gearLine(b.gear))}</span><span class="rw">${botReward(b, UI.bo)} · Bilanz ${r.w}–${r.d}–${r.l}${r.w ? '' : ` · Erstsieg: +2 Pakete${b.loot.length ? ', Beute: ' + esc(b.loot.map(x => GEAR[GEAR_CAT[x]][x].name).join(', ')) : ''}`}</span>`}
    </button>`;
  }).join('');
  const sel = BOTS[UI.selBot];
  $('#view').innerHTML = `<div class="grid">
   <section class="card wide"><header><h2>Liga</h2><span class="small muted">Jeder Erstsieg schaltet den nächsten Gegner frei und gibt dessen Ausrüstung im Shop frei</span></header><div class="bots">${bots}</div></section>
   <section class="card">
     <h2>Match gegen ${esc(sel.name)}</h2>
     <div class="row"><span>Format</span><div class="seg">${[1, 3].map(n => `<button data-action="bo" data-v="${n}" aria-pressed="${UI.bo === n}">Best of ${n}</button>`).join('')}</div></div>
     <div class="row"><span>Tempo</span><div class="seg">${[['slow', 'Langsam'], ['normal', 'Normal'], ['fast', 'Schnell'], ['instant', 'Sofort']].map(([k, l]) => `<button data-action="speed" data-v="${k}" aria-pressed="${UI.speed === k}">${l}</button>`).join('')}</div></div>
     <h3>Dein Agent im Match</h3>
     <div class="param"><div class="ph"><label for="m-eps">ε Zufälligkeit im Match</label><output id="mo-eps">${fmt(M.eps, 2)}</output></div><input type="range" id="m-eps" min="0" max="0.5" step="0.01" value="${M.eps}"><p class="hint">Meist 0: Im Ernstfall spielt der Agent seinen besten bekannten Zug.</p></div>
     <label class="check"><input type="checkbox" id="m-tac" ${M.tac ? 'checked' : ''}><span>Taktiken aktiv</span></label>
     <label class="check"><input type="checkbox" id="m-learn" ${M.learn ? 'checked' : ''}><span>Aus Matches lernen<br><span class="small muted">Nutzt die Lernparameter aus dem Training.</span></span></label>
     <button class="btn primary" data-action="startLeague" ${busy ? 'disabled' : ''}>Match starten</button>
     <p class="small muted">${botReward(sel, UI.bo)} · Remis: ein Viertel der Münzen.</p>
   </section>
   <section class="card">
     <h2>Selbst kämpfen</h2>
     <p class="small">Steuere selbst und lerne die Regeln kennen. Du kämpfst mit der Ausrüstung deines Agenten, ohne Belohnung.</p>
     <div class="row"><label for="humanOpp">Gegner</label><select id="humanOpp"><option value="self" ${UI.humanOpp === 'self' ? 'selected' : ''}>Mein Agent (${esc(A.name)})</option>${sparBots().map(x => `<option value="${x.i}" ${String(x.i) === UI.humanOpp ? 'selected' : ''}>${esc(x.b.name)}</option>`).join('')}</select></div>
     <button class="btn" data-action="startHuman" ${busy ? 'disabled' : ''}>Kampf starten</button>
     <p class="small muted">Steuerung: Pfeiltasten oder WASD, 1 Nahkampf, 2 Fernkampf, 3 Blocken, 4 Aufladen.</p>
   </section></div>`;
}

/* =================== Kampfansicht =================== */
let V = null;
const actLabel = a => MOVES[a] ? `Zug ${ARROW[V && V.me === 1 ? FLIP[a] : a]}` : ACTION_LABEL[a];
function openBattle(cfg) {
  V = { ...cfg, cfg, frames: [], sc: [0, 0, 0], game: 0, done: false, aborted: false, awaiting: null, danger: cfg.mode !== 'league', log: [], replay: null, waitText: '' };
  const el = $('#battle');
  el.hidden = false; document.body.style.overflow = 'hidden';
  el.innerHTML = `<div class="b-wrap">
    <div class="b-top"><button class="btn sm" data-action="bClose">${cfg.mode === 'online' ? 'Aufgeben' : 'Schließen'}</button>
      <div class="title"><span class="eyebrow" id="bSub"></span><b>${esc(cfg.title)}</b></div><div class="b-score" id="bScore"></div></div>
    <div class="fighters" id="bFighters"></div>
    <div class="b-main">
      <div class="stack"><div class="board" id="bBoard"><div class="tiles" id="bTiles">${'<i></i>'.repeat(25)}</div><div class="layer" id="bLayer"></div></div>
        <label class="check small"><input type="checkbox" id="bDanger" ${V.danger ? 'checked' : ''}><span>Gefahrenzonen zeigen: Felder, die der Gegner nächste Runde treffen kann</span></label></div>
      <div class="stack"><div id="bPad"></div><div id="bInfo"></div><div id="bReplay"></div><div id="bResult"></div></div>
    </div></div>`;
  const layer = $('#bLayer');
  for (const i of [0, 1]) {
    const t = document.createElement('div');
    t.className = 'token ' + (i === V.me ? 'me' : 'foe'); t.id = 'tok' + i;
    t.innerHTML = `<div class="body">${esc(initial(V.names[i]))}</div>`;
    layer.append(t);
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
    if (e.t === 'bump') { const t = $('#tok' + e.i); t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump'); }
    else if (e.t === 'melee') { if (e.hit) { fx('slash', e.at, '', c); if (e.blocked) fx('txt', e.at, 'geblockt'); } else fx('txt', F[e.i], 'verfehlt'); }
    else if (e.t === 'ranged') {
      if (e.inRange) shot(e.from, e.to, c); else fx('txt', F[e.i], 'kein Ziel');
      if (e.blocked) later(() => fx('txt', e.to, 'geblockt'));
      if (e.dodged) later(() => fx('txt', e.to, 'ausgewichen'));
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
  if (f.charged) tags.push('<span class="tag hot">aufgeladen</span>');
  if (f.root > 0) tags.push(`<span class="tag bad">gefesselt ${f.root}</span>`);
  tags.push(`<span class="tag">${esc(GEAR.ranged[g.ranged].name)} ${f.rcd ? 'in ' + f.rcd : 'bereit'}</span>`);
  if (f.mcd) tags.push('<span class="tag">Nahkampf Pause</span>');
  return `<div class="fcard ${i === V.me ? 'me' : 'foe'}"><span class="nm">${esc(V.names[i])}</span>
    <div class="hpbar" role="meter" aria-label="Lebenspunkte" aria-valuemin="0" aria-valuemax="${f.maxHp}" aria-valuenow="${f.hp}"><i style="width:${100 * f.hp / f.maxHp}%"></i></div>
    <span class="mono small">${f.hp} / ${f.maxHp} LP</span><div class="st">${tags.join('')}</div></div>`;
}
function srcPill(d) {
  if (!d) return '';
  if (d.src === 'tac') return `<span class="pill tac">Taktik · ${esc(d.rule)}</span>`;
  if (d.src === 'explore') return '<span class="pill explore">Erkundung (Zufall)</span>';
  if (d.src === 'q') return `<span class="pill q">Q-Table${d.known ? '' : ' · unbekannter Zustand'}</span>`;
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
    const t = $('#tok' + i), q = orient(f);
    if (!animate) t.style.transition = 'none';
    t.style.setProperty('--x', q.x); t.style.setProperty('--y', q.y);
    if (!animate) { void t.offsetWidth; t.style.transition = ''; }
    t.classList.toggle('charged', f.charged); t.classList.toggle('rooted', f.root > 0); t.classList.toggle('dead', f.hp <= 0);
    t.classList.toggle('blocking', !!(fr.acts && fr.acts[i] === 'block'));
  });
  $('#bFighters').innerHTML = fighterCard(V.me, F[V.me]) + fighterCard(1 - V.me, F[1 - V.me]);
  const ds = V.danger && !fr.snap.over ? dangerSet(fr.snap) : new Set();
  [...$('#bTiles').children].forEach((t, k) => t.classList.toggle('danger', ds.has(k)));
  $('#bScore').innerHTML = `${V.sc[V.me]}<span class="muted"> : </span>${V.sc[1 - V.me]}`;
  $('#bSub').textContent = `${V.bo > 1 ? `Partie ${V.game + 1} von ${V.bo} · ` : ''}Runde ${fr.snap.turn} / ${MAX_TURNS}`;
  const decs = [0, 1].filter(i => fr.dec && fr.dec[i] && fr.dec[i].q);
  $('#bInfo').innerHTML = `${decs.map(i => `<div class="card" style="padding:12px;gap:8px"><div class="row"><span class="eyebrow">${esc(V.names[i])} wählte</span>${srcPill(fr.dec[i])}</div>${qList(fr.dec[i])}</div>`).join('')}
    ${V.log.length ? `<details ${V.mode === 'league' ? 'open' : ''}><summary>Kampfprotokoll</summary><ul class="log">${V.log.slice(-40).reverse().map(l => `<li>${l}</li>`).join('')}</ul></details>` : ''}`;
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
  if (!V.awaiting) { el.innerHTML = `<div class="pad"><div class="waiting">${esc(V.waitText || 'Runde wird ausgewertet …')}</div></div>`; return; }
  const L = V.awaiting.L, f = V.b.f[hs], g = V.gears[hs];
  const dir = d => V.me === 1 ? FLIP[d] : d;
  const b = (a, txt, area, cls = '') => `<button class="${cls}" style="grid-area:${area}" data-action="pad" data-v="${a}" ${L.includes(a) ? '' : 'disabled'}>${txt}</button>`;
  el.innerHTML = `<div class="pad" role="group" aria-label="Deine Aktion">
    ${b(dir('up'), '↑', '1/2', 'arrow')}${b(dir('left'), '←', '2/1', 'arrow')}${b(dir('right'), '→', '2/3', 'arrow')}${b(dir('down'), '↓', '3/2', 'arrow')}
    ${b('melee', `Nahkampf<small>${GEAR.melee[g.melee].dmg} Schaden${f.charged ? ' ×2' : ''}</small>`, '1/5', 'act')}
    ${b('ranged', `Fernkampf<small>${f.rcd ? 'bereit in ' + f.rcd : 'bereit'}</small>`, '1/6', 'act')}
    ${b('block', 'Blocken<small>halbiert / stoppt</small>', '2/5', 'act')}
    ${b('charge', `Aufladen<small>${f.charged ? 'schon geladen' : 'nächster ×2'}</small>`, '2/6', 'act')}
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
    if (g > 0) myV.log.push(`— Partie ${g + 1} —`);
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
    myV.log.push(w === -1 ? 'Unentschieden' : `<b>${esc(myV.names[w])}</b> gewinnt${b.over.timeout ? ' nach Zeit' : ''}`);
    drawFrame(myV.frames.at(-1), !myV.delay ? false : false);
    if (g < myV.bo - 1) await wait(myV.delay ? 1200 : 150);
  }
  if (myV !== V) return;
  myV.done = true;
  finishBattle();
}
function finishBattle() {
  const sc = V.sc, me = V.me, won = sc[me] > sc[1 - me], draw = sc[me] === sc[1 - me];
  let text = '', title = won ? 'Sieg!' : draw ? 'Unentschieden' : 'Niederlage';
  if (V.aborted) { title = V.oppResigned ? 'Gegner hat aufgegeben' : 'Kampf abgebrochen'; text = V.abortText || ''; }
  else if (V.mode === 'league') text = leagueReward(won, draw);
  else if (V.mode === 'online') {
    S.stats.online++;
    if (won) { S.stats.onlineWins++; S.coins += 15; text = '+15 Münzen für den Online-Sieg.'; setTimeout(() => bump('#chipCoins'), 50); }
    else text = 'Keine Belohnung.';
  } else text = V.sides[me].kind === 'human' ? (won ? 'Gut gekämpft. Dein Agent kann von dir lernen: Trainiere ihn gezielt.' : 'Schau dir in der Wiederholung an, wie der Gegner entschieden hat.') : '';
  if (V.oppResigned) { S.stats.online++; S.stats.onlineWins++; }
  if (S.agent.match.learn && V.mode === 'league') powerSoon();
  V.waitText = ''; renderPad();
  const color = V.aborted ? 'var(--muted)' : won ? 'var(--good)' : draw ? 'var(--ink)' : 'var(--bad)';
  $('#bResult').innerHTML = `<div class="result"><h3 style="color:${color}">${title}</h3>${text ? `<p>${text}</p>` : ''}
    <div class="row">${V.frames.length > 1 ? '<button class="btn" data-action="bReplay">Wiederholung</button>' : ''}
    ${V.mode === 'online' ? (UI.duel.connected ? '<button class="btn primary" data-action="duelReady">Revanche</button>' : '') : '<button class="btn primary" data-action="bAgain">Nochmal</button>'}
    <button class="btn" data-action="bClose">Schließen</button></div></div>`;
  renderHeader(); saveSoon();
}
function leagueReward(won, draw) {
  const i = V.botIdx, bot = BOTS[i], N = V.bo, r = S.league.rec[i] || (S.league.rec[i] = { w: 0, d: 0, l: 0 });
  S.stats.matches++;
  if (won) {
    const first = r.w === 0; r.w++; S.stats.wins++;
    const c = Math.round(bot.coins * BO_COIN[N]); let p = bot.packs * BO_PACK[N];
    let t = `+${c} Münzen${p ? `, +${p} ${p === 1 ? 'Trainingspaket' : 'Trainingspakete'}` : ''}`;
    if (first) {
      p += 2; t += ', Erstsieg-Bonus +2 Trainingspakete';
      if (bot.loot.length) t += `. Im Shop freigeschaltet: <b>${bot.loot.map(x => esc(GEAR[GEAR_CAT[x]][x].name)).join(', ')}</b>`;
      if (i + 1 < BOTS.length && S.league.unlocked < i + 2) { S.league.unlocked = i + 2; UI.selBot = i + 1; t += `. Neuer Gegner: <b>${esc(BOTS[i + 1].name)}</b>`; }
    }
    S.coins += c; S.packs += p; setTimeout(() => { bump('#chipCoins'); bump('#chipPacks'); }, 50);
    return t + '.';
  }
  if (draw) { r.d++; const c = Math.floor(bot.coins * BO_COIN[N] * 0.25); S.coins += c; return c ? `+${c} Münzen für das Unentschieden.` : 'Keine Belohnung.'; }
  r.l++; return 'Keine Belohnung. Mehr Training, andere Sensoren oder eine passende Taktik helfen.';
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
  $('#bReplay').innerHTML = `<div class="card" style="padding:12px;gap:8px"><span class="eyebrow">Wiederholung der letzten Partie</span>
    <div class="replay"><button class="btn icon sm" data-action="rPrev" aria-label="Runde zurück">◀</button><input type="range" id="rSlider" min="0" max="${n}" value="${V.replay}" aria-label="Runde wählen"><button class="btn icon sm" data-action="rNext" aria-label="Runde vor">▶</button></div>
    <span class="small mono">Runde ${fr.snap.turn} von ${n}${fr.acts ? ` · ${esc(V.names[0])}: ${actLabel(fr.acts[0])} · ${esc(V.names[1])}: ${actLabel(fr.acts[1])}` : ''}</span></div>`;
}
function startLeague() {
  if (busy) return;
  const A = S.agent, bot = BOTS[UI.selBot];
  openBattle({
    mode: 'league', botIdx: UI.selBot, title: `Liga · ${bot.name}`, names: [A.name, bot.name], me: 0, gears: [{ ...A.gear }, { ...bot.gear }], bo: UI.bo, delay: DELAY[UI.speed],
    sides: [{ kind: 'agent', ctrl: agentCtrl(A, { eps: A.match.eps, learn: A.match.learn, useTac: A.match.tac, countTac: true }) }, { kind: 'bot', ctrl: botCtrl(bot) }],
  });
  runSeries();
}
function startHuman() {
  if (busy) return;
  const A = S.agent, self = UI.humanOpp === 'self', bot = self ? null : BOTS[+UI.humanOpp];
  openBattle({
    mode: 'human', title: `Du gegen ${self ? A.name : bot.name}`, names: ['Du', self ? A.name : bot.name], me: 0, gears: [{ ...A.gear }, self ? { ...A.gear } : { ...bot.gear }], bo: 1, delay: 380,
    sides: [{ kind: 'human' }, self ? { kind: 'agent', ctrl: agentCtrl(A, { eps: A.match.eps, learn: A.match.learn, useTac: A.match.tac, countTac: true }) } : { kind: 'bot', ctrl: botCtrl(bot) }],
  });
  runSeries();
}
function again() {
  const c = V.cfg, mode = c.mode;
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
    close() { duelLost('Die Verbindung wurde getrennt.'); },
    state(s) { if (s === 'failed' || s === 'disconnected' || s === 'closed') duelLost(s === 'failed' ? 'Die Verbindung ist fehlgeschlagen. In Firmen-WLANs blockieren Firewalls oft direkte Verbindungen, dann hilft mobiles Netz.' : 'Die Verbindung wurde getrennt.'); },
    msg(m) {
      const key = m.f + ':' + m.r;
      switch (m.k) {
        case 'hello': d.opp = { name: String(m.name || 'Gegner').slice(0, 20), gear: validGear(m.gear), ctrl: m.ctrl === 'human' ? 'human' : 'agent' }; duelRender(); break;
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
  openBattle({ mode: 'online', title: `Duell gegen ${d.opp.name}`, names, me, gears, sides, bo: 1, delay: 650 });
  runSeries();
}
async function onlineRound(b, acts, dec) {
  const d = UI.duel, me = V.me, myV = V, key = d.fightNo + ':' + (b.turn + 1);
  if (acts[me] == null) { acts[me] = await humanInput(b, me); dec[me] = { src: 'human' }; }
  if (myV.aborted) return false;
  const n = nonce(), h = await sha256(key + ':' + acts[me] + ':' + n);
  const rb = d.rb[key] = d.rb[key] || {};
  d.link.send({ k: 'commit', f: d.fightNo, r: b.turn + 1, h });
  myV.waitText = 'Warte auf den Zug des Gegners …'; renderPad();
  await waitFor(() => rb.oc || myV.aborted || !d.connected);
  if (myV.aborted || !d.connected) return false;
  d.link.send({ k: 'reveal', f: d.fightNo, r: b.turn + 1, a: acts[me], s: n });
  await waitFor(() => rb.or || myV.aborted || !d.connected);
  if (myV.aborted || !d.connected) return false;
  const ok = ACTIONS.includes(rb.or.a) && (await sha256(key + ':' + rb.or.a + ':' + rb.or.s)) === rb.oc;
  if (!ok) { myV.aborted = true; myV.abortText = 'Der Zug des Gegners passt nicht zu seiner Zusage. Der Kampf wurde abgebrochen.'; return false; }
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
    const t = c.dataset.qr;
    let q = qrCache.get(t);
    if (!q) { try { q = encodeQR(t, 'L'); qrCache.set(t, q); } catch { c.hidden = true; return; } }
    drawQR(c, q, 4);
  });
}
async function copyText(text, msg, fallbackSel) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { const t = fallbackSel && $(fallbackSel); if (t) { t.hidden = false; t.focus(); t.select(); } toast('Kopieren nicht möglich. Der Text ist markiert, kopiere ihn manuell.'); }
}
async function shareLink(url, text) {
  try { if (navigator.share) { await navigator.share({ title: 'Q-Arena Duell', text, url }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  copyText(url, 'Link kopiert. Schick ihn deinem Gegner, zum Beispiel per Chat.', '#codeOut');
}
let canScan = false;
(async () => { try { canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia && (await BarcodeDetector.getSupportedFormats()).includes('qr_code'); } catch { canScan = false; } if (canScan && UI.tab === 'duel' && !V) renderDuel(); })();
async function openScanner(onCode) {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `<div class="scanbox"><video playsinline muted></video><i class="scanframe"></i></div><p>Halte die Kamera auf den QR-Code auf dem Display deines Gegners.</p><button class="btn">Abbrechen</button>`;
  document.body.append(ov);
  let stream, alive = true;
  const stop = () => { alive = false; stream && stream.getTracks().forEach(t => t.stop()); ov.remove(); };
  ov.querySelector('button').onclick = stop;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { stop(); toast('Kein Zugriff auf die Kamera. Füge den Code oder Link stattdessen ein.'); return; }
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
    const t = setTimeout(() => { bc.removeEventListener('message', on); res(false); }, 1500);
    const on = e => { if (e.data && e.data.k === 'ack' && e.data.id === id) { clearTimeout(t); bc.removeEventListener('message', on); res(true); } };
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
  if (V && !V.done) { toast('Beende zuerst den laufenden Kampf.'); return; }
  if (V) closeBattle();
  const d = UI.duel;
  if (ans) {
    if (d.phase === 'hosting' && d.code && !d.connected) { setTab('duel'); acceptAnswer(ans); return; }
    const ok = await relayAnswer(ans);
    d.relay = ok ? 'ok' : ans; setTab('duel'); return;
  }
  if (d.connected || d.phase === 'hosting') { toast('Es läuft bereits ein Duell. Trenne es zuerst.'); setTab('duel'); return; }
  Object.assign(d, { phase: 'joining', role: 'guest', answer: '', err: '', invite: join, myReady: 0, oppReady: 0, fightNo: 0, relay: null });
  setTab('duel');
  if (!wasFresh) duelAnswer(join);
}
function qrBlock(url, label) {
  return `<figure class="qrwrap"><canvas class="qr" data-qr="${esc(url)}" role="img" aria-label="${esc(label)}"></canvas><figcaption class="small muted">${esc(label)}</figcaption></figure>`;
}
function renderDuel() {
  const d = UI.duel, A = S.agent;
  const ctrlSeg = `<div class="row"><span>Im Duell kämpft</span><div class="seg"><button data-action="duelCtrl" data-v="agent" aria-pressed="${d.ctrl === 'agent'}">mein Agent</button><button data-action="duelCtrl" data-v="human" aria-pressed="${d.ctrl === 'human'}">ich selbst</button></div></div>`;
  const scanBtn = act => canScan ? `<button class="btn" data-action="${act}">QR-Code scannen</button>` : '';
  const relay = d.relay === 'ok'
    ? '<div class="note ok">Die Antwort wurde an dein offenes Duell in einem anderen Fenster übergeben. Du kannst dieses Fenster schließen.</div>'
    : d.relay ? `<div class="note warn">Auf diesem Gerät wartet kein Duell auf diese Antwort. Hast du das Duell in der installierten App erstellt? Dann kopiere den Code und füge ihn dort ein.<div class="row" style="margin-top:8px"><button class="btn sm" data-action="copyRelay">Code kopieren</button></div></div>` : '';
  let body = '';
  if (d.phase === 'idle') {
    body = `<p class="small">Fordere jemanden direkt von Gerät zu Gerät heraus. Dein Gegner scannt deinen QR-Code oder öffnet deinen Einladungslink, danach zeigt er dir seine Antwort. Der Kampf läuft ohne Server.</p>
      ${relay}${ctrlSeg}
      ${d.err ? `<div class="note warn">${esc(d.err)}</div>` : ''}
      <div class="row"><button class="btn primary" data-action="duelHost">Duell erstellen</button><button class="btn" data-action="duelJoinStart">Einladung annehmen</button></div>`;
  } else if (d.phase === 'hosting') {
    body = `<div class="steps">
      <div><b>Gegner einladen</b>${d.code ? `<p class="small muted">Lass deinen Gegner den Code mit der Handykamera scannen oder schick ihm den Link.</p>
        ${qrBlock(inviteLink(d.code), 'Einladung zu deinem Duell')}
        <div class="row"><button class="btn primary" data-action="shareInvite">Link teilen</button><button class="btn" data-action="copyInvite">Link kopieren</button></div>
        <details><summary>Code statt Link</summary><textarea id="codeOut" class="codebox" readonly aria-label="Einladungscode">${esc(d.code)}</textarea></details>` : '<p class="small muted"><span class="dot wait"></span>Einladung wird erzeugt …</p>'}</div>
      <div><b>Antwort deines Gegners übernehmen</b>
        <p class="small muted">${canScan ? 'Scanne den QR-Code auf seinem Display. ' : ''}Schickt er dir den Antwortlink, öffne ihn einfach auf diesem Gerät. Er landet automatisch hier.</p>
        <div class="row">${scanBtn('scanAnswer')}</div>
        <textarea id="answerIn" aria-label="Antwortlink oder -code" placeholder="Antwortlink oder Code einfügen"></textarea>
        <div class="row"><button class="btn primary" data-action="duelFinish" ${d.code ? '' : 'disabled'}>Verbinden</button></div></div></div>
      ${d.err ? `<div class="note warn">${esc(d.err)}</div>` : ''}
      <div class="row"><button class="btn sm" data-action="duelCancel">Abbrechen</button></div>`;
  } else if (d.phase === 'joining') {
    const freshHint = wasFresh && d.invite && !d.answer ? `<div class="note warn">Dieser Link hat Q-Arena mit einem neuen Agenten geöffnet. Hast du Q-Arena schon als App installiert und dort deinen Agenten? Dann kopiere den Code und füge ihn in der App unter Duell → Einladung annehmen ein.<div class="row" style="margin-top:8px"><button class="btn sm" data-action="copyInviteIn">Code kopieren</button></div></div>` : '';
    body = `<div class="steps">
      <div><b>Einladung übernehmen</b>${freshHint}
        <div class="row">${scanBtn('scanInvite')}</div>
        <textarea id="inviteIn" aria-label="Einladungslink oder -code" placeholder="Einladungslink oder Code einfügen">${esc(d.invite || '')}</textarea>
        <div class="row"><button class="btn primary" data-action="duelAnswer" ${d.answer || d.working ? 'disabled' : ''}>${wasFresh && d.invite ? 'Hier beitreten' : 'Antwort erzeugen'}</button></div></div>
      <div><b>Antwort zurückgeben</b>${d.answer ? `<p class="small muted">Zeig deinem Gegner diesen QR-Code oder schick ihm den Link.</p>
        ${qrBlock(answerLink(d.answer), 'Deine Antwort für den Gastgeber')}
        <div class="row"><button class="btn primary" data-action="shareAnswer">Link teilen</button><button class="btn" data-action="copyAnswer">Link kopieren</button></div>
        <details><summary>Code statt Link</summary><textarea id="codeOut" class="codebox" readonly aria-label="Antwortcode">${esc(d.answer)}</textarea></details>
        <p class="small muted"><span class="dot wait"></span>Warte, bis dein Gegner die Antwort übernimmt …</p>` : d.working ? '<p class="small muted"><span class="dot wait"></span>Antwort wird erzeugt …</p>' : '<p class="small muted">Erscheint nach Schritt 1.</p>'}</div></div>
      ${d.err ? `<div class="note warn">${esc(d.err)}</div>` : ''}
      <div class="row"><button class="btn sm" data-action="duelCancel">Abbrechen</button></div>`;
  } else if (d.phase === 'connected') {
    const waitingOpp = d.myReady && d.oppReady !== d.myReady;
    body = `<p><span class="dot on"></span>Verbunden${d.opp ? ` mit <b>${esc(d.opp.name)}</b>` : ''}.</p>
      ${d.opp ? `<p class="small muted">Ausrüstung: ${esc(gearLine(d.opp.gear))} · kämpft ${d.opp.ctrl === 'human' ? 'selbst' : 'mit seinem Agenten'}</p>` : ''}
      ${ctrlSeg}
      <div class="row"><button class="btn primary" data-action="duelReady" ${waitingOpp ? 'disabled' : ''}>${d.fightNo ? 'Nächsten Kampf starten' : 'Kampf starten'}</button><button class="btn danger sm" data-action="duelCancel">Trennen</button></div>
      ${waitingOpp ? '<p class="small muted"><span class="dot wait"></span>Warte, bis dein Gegner bereit ist …</p>' : d.oppReady > d.fightNo && d.oppReady !== d.myReady ? '<p class="small">Dein Gegner ist bereit.</p>' : ''}`;
  }
  $('#view').innerHTML = `<div class="grid">
    <section class="card"><header><h2>Online-Duell</h2><span class="small muted">${S.stats.onlineWins} Siege in ${S.stats.online} Duellen</span></header>${body}</section>
    <section class="card"><h2>So funktioniert es</h2>
      <ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
        <li>Du erstellst das Duell, dein Gegner scannt deinen QR-Code mit der Kamera oder öffnet deinen Link. Danach zeigt er dir seinen Antwort-QR-Code oder schickt dir seinen Antwortlink.</li>
        <li>Beide Geräte brauchen für den Verbindungsaufbau Internet. Danach gehen die Züge direkt von Gerät zu Gerät.</li>
        <li>Beide wählen jede Runde geheim. Jeder Zug wird erst als Prüfsumme zugesagt und dann aufgedeckt, damit niemand den Zug des anderen abwarten kann.</li>
        <li>In Firmen-WLANs blockieren Firewalls direkte Verbindungen oft. Dann hilft mobiles Netz auf einem der Geräte.</li>
        <li>Ein Online-Sieg bringt 15 Münzen. Im Duell lernt dein Agent nicht dazu.</li>
      </ul>
      <p class="small muted">Du trittst mit ${esc(A.name)} und ${esc(gearLine(A.gear))} an.</p></section></div>`;
  paintQRs();
}
async function duelHost() {
  const d = UI.duel; d.err = ''; d.role = 'host'; d.phase = 'hosting'; d.code = ''; d.myReady = d.oppReady = d.fightNo = 0; renderDuel();
  try { d.link = new Link(duelHandlers()); d.code = await d.link.host(); }
  catch (e) { d.phase = 'idle'; d.err = 'Der Code konnte nicht erzeugt werden: ' + (e.message || e); }
  duelRender();
}
async function duelAnswer(given) {
  const d = UI.duel, code = extractCode(given || ($('#inviteIn') || {}).value);
  d.err = '';
  if (!code) { d.err = 'Füge zuerst den Einladungslink oder Code ein. Er beginnt mit „QA1“ oder enthält „#join=“.'; renderDuel(); return; }
  if (d.working || d.answer) return;
  d.invite = code; d.working = true; duelRender();
  try { d.link = new Link(duelHandlers()); d.answer = await d.link.join(code); }
  catch { d.err = 'Die Einladung ist ungültig oder unvollständig. Prüfe, ob der Link komplett kopiert wurde.'; if (d.link) d.link.close(); d.link = null; }
  d.working = false;
  duelRender();
}
async function acceptAnswer(code) {
  const d = UI.duel; d.err = '';
  if (!code) { d.err = 'Füge zuerst den Antwortlink oder Code ein.'; duelRender(); return; }
  if (!d.link) { d.err = 'Es gibt kein offenes Duell, das auf eine Antwort wartet.'; duelRender(); return; }
  try { await d.link.finish(code); toast('Verbinde …'); }
  catch { d.err = 'Die Antwort ist ungültig oder unvollständig. Prüfe, ob sie zu diesem Duell gehört.'; }
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
  if (V && V.done) { V.waitText = 'Warte, bis dein Gegner bereit ist …'; $('#bResult').innerHTML = `<p class="small muted"><span class="dot wait"></span>${V.waitText}</p>`; }
  maybeStartOnline(); duelRender();
}

/* =================== Shop =================== */
function itemHTML(o) {
  return `<div class="item ${o.owned ? 'owned' : ''}"><span class="kind">${o.kind}</span><h3>${esc(o.name)}</h3><p class="small muted" style="flex:1">${o.desc}</p>
    <div class="row" style="justify-content:space-between"><span class="price">${o.owned ? '' : o.price ? o.price + ' Münzen' : ''}</span>
    ${o.owned ? '<span class="small muted">im Besitz</span>' : o.locked ? `<span class="small muted">${o.locked}</span>` : `<button class="btn primary sm" data-action="buy" data-v="${o.id}" ${S.coins < o.price ? 'disabled' : ''}>Kaufen</button>`}</div></div>`;
}
function renderShop() {
  const A = S.agent, open = lootOpen();
  const packs = Object.entries(PACK_PRICE).map(([id, [n, p]]) => itemHTML({ id, kind: 'Training', name: `${n} Trainingspaket${n > 1 ? 'e' : ''}`, desc: `${fmtInt(n * 1000)} Trainingskämpfe.${n > 1 ? ` Du sparst ${n * 60 - p} Münzen.` : ''}`, price: p }));
  const gear = Object.keys(GEAR_PRICE).sort((a, b) => GEAR_PRICE[a] - GEAR_PRICE[b]).map(id => {
    const cat = GEAR_CAT[id], g = GEAR[cat][id], owner = lootOwner(id);
    return itemHTML({ id: 'gear:' + id, kind: SLOT_LABEL[cat], name: g.name, desc: esc(g.desc), price: GEAR_PRICE[id], owned: S.owned[cat].includes(id), locked: open.has(id) ? '' : `Besiege ${esc(owner.name)}` });
  });
  const sensors = SENSOR_ORDER.filter(k => SENSORS[k].price).map(k => itemHTML({ id: 'sensor:' + k, kind: `Sensor · ${SENSORS[k].n} Werte`, name: SENSORS[k].name, desc: esc(SENSORS[k].desc), price: SENSORS[k].price, owned: S.owned.sensors.includes(k) }));
  const ext = [
    itemHTML({ id: 'sslot', kind: 'Erweiterung', name: 'Sensor-Slot', desc: A.sensorSlots >= MAX_SENSOR_SLOTS ? 'Maximum von 6 Sensoren erreicht.' : `Ein weiterer gleichzeitig aktiver Sensor (Slot ${A.sensorSlots + 1}).`, price: sensorSlotPrice(), owned: A.sensorSlots >= MAX_SENSOR_SLOTS }),
    itemHTML({ id: 'tslot', kind: 'Erweiterung', name: 'Taktik-Slot', desc: A.tacSlots >= MAX_TAC_SLOTS ? 'Maximum von 6 Taktiken erreicht.' : `Platz für eine weitere Taktik (Slot ${A.tacSlots + 1}).`, price: tacSlotPrice(), owned: A.tacSlots >= MAX_TAC_SLOTS }),
  ];
  $('#view').innerHTML = `<div class="stack">
    <section class="card"><header><h2>Trainingspakete</h2></header><div class="shopgrid">${packs.join('')}</div></section>
    <section class="card"><header><h2>Waffen &amp; Panzerung</h2><span class="small muted">Freigeschaltet durch Siege in der Liga</span></header><div class="shopgrid">${gear.join('')}</div></section>
    <section class="card"><header><h2>Sensoren</h2><span class="small muted">Was dein Agent wahrnehmen kann</span></header><div class="shopgrid">${sensors.join('')}</div></section>
    <section class="card"><header><h2>Erweiterungen</h2></header><div class="shopgrid">${ext.join('')}</div></section></div>`;
}
function buy(id) {
  const A = S.agent;
  let price = 0, done = '';
  if (PACK_PRICE[id]) { price = PACK_PRICE[id][1]; if (S.coins < price) return; S.packs += PACK_PRICE[id][0]; done = `${PACK_PRICE[id][0]} Trainingspaket${PACK_PRICE[id][0] > 1 ? 'e' : ''} gekauft.`; }
  else if (id.startsWith('gear:')) {
    const g = id.slice(5), cat = GEAR_CAT[g]; price = GEAR_PRICE[g];
    if (S.coins < price || S.owned[cat].includes(g) || !lootOpen().has(g)) return;
    S.owned[cat].push(g); done = `${GEAR[cat][g].name} gekauft. Rüste es im Tab Agent aus.`;
  } else if (id.startsWith('sensor:')) {
    const k = id.slice(7); price = SENSORS[k].price;
    if (S.coins < price || S.owned.sensors.includes(k)) return;
    S.owned.sensors.push(k); done = `${SENSORS[k].name} gekauft. Aktiviere ihn im Tab Agent.`;
  } else if (id === 'sslot') { price = sensorSlotPrice(); if (S.coins < price || A.sensorSlots >= MAX_SENSOR_SLOTS) return; A.sensorSlots++; done = 'Neuer Sensor-Slot freigeschaltet.'; }
  else if (id === 'tslot') { price = tacSlotPrice(); if (S.coins < price || A.tacSlots >= MAX_TAC_SLOTS) return; A.tacSlots++; done = 'Neuer Taktik-Slot freigeschaltet.'; }
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
    catch { UI.importData = null; toast('Diese Datei ist kein Q-Arena-Spielstand.'); }
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
      if (on && A.sensors.length === 1) { toast('Mindestens ein Sensor muss aktiv bleiben.'); return; }
      if (!on && A.sensors.length >= A.sensorSlots) { toast('Alle Sensor-Slots belegt. Deaktiviere erst einen Sensor oder kaufe einen Slot.'); return; }
      A.sensors = on ? A.sensors.filter(x => x !== v) : [...A.sensors, v];
      refresh(); powerSoon(); break;
    }
    case 'useBrain': A.sensors = v.split(','); toast('Gehirn aktiviert.'); refresh(); powerSoon(); break;
    case 'askConfirm': UI.confirm = v; renderAgent(); break;
    case 'cancelConfirm': UI.confirm = null; renderAgent(); break;
    case 'doConfirm':
      UI.confirm = null;
      if (v.startsWith('brain:')) { delete A.brains[v.slice(6)]; toast('Gehirn gelöscht.'); }
      if (v === 'wipeBrain') { delete A.brains[brainKey(A.sensors)]; A.params.eps = DEFAULT_PARAMS.eps; toast('Gehirn gelöscht.'); powerSoon(); }
      if (v === 'wipeAll') { S = defaultSave(); S.power = combatPower(S.agent); UI.prog = ''; UI.selBot = 0; toast('Spielstand zurückgesetzt.'); }
      refresh(); break;
    case 'exportSave': exportSave(); break;
    case 'doImport': S = UI.importData; UI.importData = null; if (S.power == null) S.power = combatPower(S.agent); toast('Spielstand geladen.'); refresh(); break;
    case 'cancelImport': UI.importData = null; renderAgent(); break;
    case 'tmode': UI.trainMode = v; if (!busy) UI.prog = ''; renderTraining(); break;
    case 'tn': UI.trainN = +v; renderTraining(); break;
    case 'train': startTraining(); break;
    case 'preset': { const eps = A.params.eps; Object.assign(A.params, DEFAULT_PARAMS, PRESETS[v]); if (getBrain(A, false).fights) A.params.eps = eps; toast(`Voreinstellung „${v}“ übernommen.`); refresh(); break; }
    case 'addTac': if (A.tactics.length < A.tacSlots) { A.tactics.push(newTactic(v)); refresh(); powerSoon(); } break;
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
    case 'shareInvite': shareLink(inviteLink(UI.duel.code), `${A.name} fordert dich zum Duell in Q-Arena heraus. Link öffnen, um beizutreten:`); break;
    case 'copyInvite': copyText(inviteLink(UI.duel.code), 'Einladungslink kopiert.', '#codeOut'); break;
    case 'shareAnswer': shareLink(answerLink(UI.duel.answer), 'Meine Antwort für unser Q-Arena-Duell. Öffne den Link auf dem Gerät, auf dem du das Duell erstellt hast:'); break;
    case 'copyAnswer': copyText(answerLink(UI.duel.answer), 'Antwortlink kopiert.', '#codeOut'); break;
    case 'copyRelay': copyText(UI.duel.relay, 'Code kopiert.'); break;
    case 'copyInviteIn': copyText(UI.duel.invite, 'Code kopiert.', '#inviteIn'); break;
    case 'scanAnswer': openScanner(code => acceptAnswer(code)); break;
    case 'scanInvite': openScanner(code => duelAnswer(code)); break;
    case 'duelCancel': duelCancel(); break;
    case 'duelReady': duelReady(); break;
  }
});
document.addEventListener('input', e => {
  const t = e.target, A = S.agent;
  if (t.dataset.param) { const d = PARAM_DEFS.find(p => p.k === t.dataset.param); A.params[d.k] = +t.value; $('#o-' + d.k).textContent = fmt(+t.value, d.d); saveSoon(); return; }
  if (t.id === 'agentName') { A.name = t.value.trim() || 'Agent'; saveSoon(); return; }
  if (t.id === 'm-eps') { A.match.eps = +t.value; $('#mo-eps').textContent = fmt(+t.value, 2); saveSoon(); return; }
  if (t.id === 'rSlider') { showReplay(+t.value); return; }
  if (t.dataset.tac === 'name') { A.tactics[+t.dataset.r].name = t.value; saveSoon(); return; }
  if (t.dataset.tac === 'val' && t.type === 'number') { A.tactics[+t.dataset.r].conds[+t.dataset.c].val = +t.value; saveSoon(); powerSoon(); }
});
document.addEventListener('change', e => {
  const t = e.target, A = S.agent;
  if (t.id === 'sparSel') { UI.spar = +t.value; return; }
  if (t.id === 'humanOpp') { UI.humanOpp = t.value; return; }
  if (t.id === 'tacTrain') { A.tacInTraining = t.checked; saveSoon(); return; }
  if (t.id === 'm-tac') { A.match.tac = t.checked; saveSoon(); powerSoon(); return; }
  if (t.id === 'm-learn') { A.match.learn = t.checked; saveSoon(); return; }
  if (t.id === 'bDanger') { V.danger = t.checked; drawFrame(V.replay != null ? V.frames[V.replay] : V.frames.at(-1), false); return; }
  if (t.id === 'importFile' && t.files[0]) { readImport(t.files[0]); return; }
  if (t.dataset.gear) { A.gear[t.dataset.gear] = t.value; refresh(); powerSoon(); return; }
  const k = t.dataset.tac; if (!k) return;
  const r = A.tactics[+t.dataset.r];
  if (k === 'on') r.on = t.checked;
  else if (k === 'act') r.act = t.value;
  else if (k === 'ctype') { const d = TCOND[t.value]; r.conds[+t.dataset.c] = d.ops ? { type: t.value, op: d.ops[0], val: d.num[2] } : { type: t.value, val: d.vals[0] }; }
  else if (k === 'op') r.conds[+t.dataset.c].op = t.value;
  else if (k === 'val' && t.tagName === 'SELECT') r.conds[+t.dataset.c].val = t.value;
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
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
S = load();
const wasFresh = !S;
if (!S) S = defaultSave();
if (S.power == null) S.power = combatPower(S.agent);
renderHeader();
let startTab = 'agent'; try { startTab = localStorage.getItem('qarena.tab') || startTab; } catch { /* egal */ }
setTab(startTab);
registerSW();
// Einladungs- und Antwortlinks: beim Öffnen per Link und, in der installierten App, über die Launch-Queue
handleIncoming(location.href);
if ('launchQueue' in window) window.launchQueue.setConsumer(p => { if (p && p.targetURL) handleIncoming(p.targetURL); });
window.addEventListener('hashchange', () => handleIncoming(location.href));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* optional */ }
