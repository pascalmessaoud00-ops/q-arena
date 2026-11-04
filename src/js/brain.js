// Q-Arena – Wahrnehmung (Sensoren), Q-Learning, Taktiken und Liga-Gegner.
import { ACTIONS, MOVES, CATS, catOf, GEAR, SIZE, STARTER_GEAR, cheb, manh, inLine, meleeReach, rangedReach, legal, newBattle, cloneBattle, step } from './engine.js';

export const pick = a => a.length ? a[(Math.random() * a.length) | 0] : null;
const catIdx = a => CATS.indexOf(catOf(a));
const hpBand = f => { const r = f.hp / f.maxHp; return r > 0.6 ? 0 : r > 0.3 ? 1 : 2; };

/* ---------- Sensoren ---------- */
// Jeder Sensor liefert eine kleine Zahl. Zusammen bilden sie den Zustand, den der Agent „sieht“.
export const SENSORS = {
  compass: { name: 'Kompass', n: 8, price: 0, desc: 'Richtung zum Gegner in 8 Himmelsrichtungen.',
    read: (f, o) => { const s = Math.round(Math.atan2(o.y - f.y, o.x - f.x) / (Math.PI / 4)); return ((s % 8) + 8) % 8; } },
  range: { name: 'Entfernungsmesser', n: 4, price: 0, desc: 'Abstand zum Gegner: 1, 2, 3 oder 4 Felder.',
    read: (f, o) => Math.min(cheb(f, o), 4) - 1 },
  sight: { name: 'Visier', n: 2, price: 0, desc: 'Gegner in Reichweite der Fernwaffe und Waffe bereit.',
    read: (f, o) => rangedReach(f, o) && f.rcd === 0 ? 1 : 0 },
  threat: { name: 'Gefahrensinn', n: 3, price: 150, desc: 'Kann der Gegner mich treffen? Nein, im Nahkampf oder mit der Fernwaffe.',
    read: (f, o) => meleeReach(o, f, o) && o.mcd === 0 ? 1 : rangedReach(o, f, o) && o.rcd === 0 ? 2 : 0 },
  wall: { name: 'Raumgefühl', n: 3, price: 120, desc: 'Stehe ich in der Mitte, am Rand oder in einer Ecke?',
    read: f => (f.x === 0 || f.x === SIZE - 1 ? 1 : 0) + (f.y === 0 || f.y === SIZE - 1 ? 1 : 0) },
  hp: { name: 'Vitalscanner', n: 3, price: 100, desc: 'Eigene Lebenspunkte: hoch, mittel oder kritisch.', read: f => hpBand(f) },
  ehp: { name: 'Feindscanner', n: 3, price: 100, desc: 'Lebenspunkte des Gegners: hoch, mittel oder kritisch.', read: (f, o) => hpBand(o) },
  ready: { name: 'Statusanzeige', n: 4, price: 100, desc: 'Ist meine Fernwaffe bereit? Bin ich aufgeladen?',
    read: f => (f.rcd === 0 ? 2 : 0) + (f.charged ? 1 : 0) },
  mem: { name: 'Gedächtnis', n: 6, price: 120, desc: 'Art meines letzten Zuges.', read: f => catIdx(f.hist.at(-1)) },
  watch: { name: 'Beobachter', n: 6, price: 150, desc: 'Art des letzten Zuges des Gegners.', read: (f, o) => catIdx(o.hist.at(-1)) },
  pattern: { name: 'Musterkenner', n: 36, price: 300, desc: 'Die letzten zwei Züge des Gegners. Erkennt Gewohnheiten, lernt aber langsam.',
    read: (f, o) => catIdx(o.hist.at(-2)) * 6 + catIdx(o.hist.at(-1)) },
  grid: { name: 'Peilsender', n: 81, price: 250, desc: 'Exakte Position des Gegners relativ zu mir. Sehr genau, sehr viele Zustände.',
    read: (f, o) => (o.x - f.x + 4) * 9 + (o.y - f.y + 4) },
};
export const SENSOR_ORDER = Object.keys(SENSORS);
export const STARTER_SENSORS = ['compass', 'range', 'sight'];
export const sortSensors = s => SENSOR_ORDER.filter(k => s.includes(k));
export const brainKey = s => sortSensors(s).join(',');
export const stateSpace = s => s.reduce((p, k) => p * SENSORS[k].n, 1);
// Egozentrische Sicht: Für die obere Seite wird das Brett um 180° gedreht, damit jeder Agent
// die Welt so wahrnimmt, als stünde er unten. „Hoch“ heißt dann immer: zum Gegner-Startfeld.
const FLIP = { up: 'down', down: 'up', left: 'right', right: 'left' };
export const ego = (a, i) => i === 1 && FLIP[a] ? FLIP[a] : a;
const turn = f => ({ ...f, x: SIZE - 1 - f.x, y: SIZE - 1 - f.y });
export const stateKey = (b, i, sens) => {
  let f = b.f[i], o = b.f[1 - i];
  if (i === 1) { f = turn(f); o = turn(o); }
  return sens.map(k => SENSORS[k].read(f, o)).join('.');
};

/* ---------- Lernparameter ---------- */
export const DEFAULT_PARAMS = { eps: 0.25, epsDecay: 0.9995, epsMin: 0.03, qInit: 0, alpha: 0.15, neg: 1, gamma: 0.9, lambda: 0.5,
  rWin: 5, rLoss: -5, rDraw: 0, rDealt: 0.5, rTaken: -0.5, rStep: -0.02 };
export const PRESETS = {
  'Ausgewogen': {},
  'Schnelllerner': { alpha: 0.35, lambda: 0.7, epsDecay: 0.999 },
  'Vorsichtig': { neg: 2, rTaken: -1, rLoss: -8, rDealt: 0.3 },
  'Berserker': { rDealt: 1, rTaken: -0.2, neg: 0.5, qInit: 0.5, rStep: -0.05 },
};

/* ---------- Bewegungshilfen (für Taktiken und Liga-Gegner) ---------- */
function moveBy(b, i, score) {
  const f = b.f[i], L = legal(b, i).filter(a => MOVES[a]);
  let best = -Infinity, out = [];
  for (const a of L) {
    const p = { x: f.x + MOVES[a][0], y: f.y + MOVES[a][1] };
    const v = score(p, f, b.f[1 - i]);
    if (v > best + 1e-9) { best = v; out = [a]; } else if (Math.abs(v - best) <= 1e-9) out.push(a);
  }
  return pick(out);
}
export const MOVE_TACTICS = {
  toward: (b, i) => moveBy(b, i, (p, f, o) => cheb(p, o) === 0 ? -99 : -cheb(p, o) * 10 - manh(p, o)),
  away: (b, i) => moveBy(b, i, (p, f, o) => cheb(p, o) * 10 + manh(p, o) - (p.x === 0 || p.x === 4 ? 1 : 0) - (p.y === 0 || p.y === 4 ? 1 : 0)),
  align: (b, i) => moveBy(b, i, (p, f, o) => (inLine(p, o) && rangedReach(f, o, p) ? 20 : 0) + (cheb(p, o) >= 2 ? 5 : 0) - manh(p, o) * 0.1),
  unalign: (b, i) => moveBy(b, i, (p, f, o) => (inLine(p, o) ? 0 : 20) + cheb(p, o)),
  sidestep: (b, i) => { const f = b.f[i], o = b.f[1 - i], dx = Math.abs(o.x - f.x), dy = Math.abs(o.y - f.y);
    const side = dx >= dy ? ['up', 'down'] : ['left', 'right'];
    return pick(legal(b, i).filter(a => side.includes(a))); },
};

/* ---------- Taktiken (Signature Moves) ---------- */
const CAT_VALS = ['Bewegung', 'Nahkampf', 'Fernkampf', 'Blocken', 'Aufladen'];
const CAT_MAP = { Bewegung: 'move', Nahkampf: 'melee', Fernkampf: 'ranged', Blocken: 'block', Aufladen: 'charge' };
export const TCOND = {
  dist: { label: 'Abstand zum Gegner', ops: ['=', '≤', '≥'], num: [1, 4, 1] },
  inSight: { label: 'Gegner in meiner Schusslinie', vals: ['ja', 'nein'] },
  threatened: { label: 'Gegner kann mich treffen', vals: ['ja', 'nein'] },
  hp: { label: 'Meine LP in %', ops: ['≤', '≥'], num: [0, 100, 30] },
  ehp: { label: 'LP des Gegners in %', ops: ['≤', '≥'], num: [0, 100, 30] },
  rReady: { label: 'Fernwaffe bereit', vals: ['ja', 'nein'] },
  charged: { label: 'Ich bin aufgeladen', vals: ['ja', 'nein'] },
  eCharged: { label: 'Gegner ist aufgeladen', vals: ['ja', 'nein'] },
  eLast: { label: 'Letzter Zug des Gegners', vals: CAT_VALS },
  myLast: { label: 'Mein letzter Zug', vals: CAT_VALS },
  pos: { label: 'Ich stehe', vals: ['in der Mitte', 'am Rand', 'in einer Ecke'] },
  round: { label: 'Runde', ops: ['≤', '≥'], num: [1, 30, 5] },
};
export const TACT = {
  melee: 'Nahkampf', ranged: 'Fernkampf', block: 'Blocken', charge: 'Aufladen',
  toward: 'Auf den Gegner zu', away: 'Vom Gegner weg', align: 'In Schusslinie gehen', unalign: 'Aus der Schusslinie gehen',
  sidestep: 'Seitlich ausweichen', up: 'Hoch', down: 'Runter', left: 'Links', right: 'Rechts',
};
const cmp = (a, op, b) => op === '=' ? a === b : op === '≤' ? a <= b : op === '≥' ? a >= b : false;
function condOk(c, b, i) {
  const f = b.f[i], o = b.f[1 - i];
  switch (c.type) {
    case 'dist': return cmp(Math.min(cheb(f, o), 4), c.op, +c.val);
    case 'inSight': return rangedReach(f, o) === (c.val === 'ja');
    case 'threatened': return (meleeReach(o, f, o) && o.mcd === 0 || rangedReach(o, f, o) && o.rcd === 0) === (c.val === 'ja');
    case 'hp': return cmp(Math.round(100 * f.hp / f.maxHp), c.op, +c.val);
    case 'ehp': return cmp(Math.round(100 * o.hp / o.maxHp), c.op, +c.val);
    case 'rReady': return (f.rcd === 0) === (c.val === 'ja');
    case 'charged': return f.charged === (c.val === 'ja');
    case 'eCharged': return o.charged === (c.val === 'ja');
    case 'eLast': return catOf(o.hist.at(-1)) === CAT_MAP[c.val];
    case 'myLast': return catOf(f.hist.at(-1)) === CAT_MAP[c.val];
    case 'pos': return SENSORS.wall.read(f) === ['in der Mitte', 'am Rand', 'in einer Ecke'].indexOf(c.val);
    case 'round': return cmp(b.turn + 1, c.op, +c.val);
  }
  return true;
}
export function evalTactics(rules, b, i, L, count) {
  for (const r of rules) {
    if (!r.on || !r.conds.every(c => condOk(c, b, i))) continue;
    const a = MOVE_TACTICS[r.act] ? MOVE_TACTICS[r.act](b, i) : ego(r.act, i);
    if (a && L.includes(a)) { if (count) r.fired = (r.fired || 0) + 1; return { a, rule: r }; }
  }
  return null;
}
let tSeq = 1;
export function newTactic(t) {
  const base = { id: 't' + Date.now().toString(36) + (tSeq++), name: 'Neue Taktik', on: true, conds: [], act: 'block', fired: 0 };
  switch (t) {
    case 'retreat': return { ...base, name: 'Rückzug', conds: [{ type: 'hp', op: '≤', val: 30 }, { type: 'threatened', val: 'ja' }], act: 'away' };
    case 'snipe': return { ...base, name: 'Scharfschuss', conds: [{ type: 'inSight', val: 'ja' }, { type: 'rReady', val: 'ja' }, { type: 'dist', op: '≥', val: 2 }], act: 'ranged' };
    case 'counter': return { ...base, name: 'Konter', conds: [{ type: 'eLast', val: 'Blocken' }, { type: 'dist', op: '=', val: 1 }], act: 'melee' };
    case 'dodge': return { ...base, name: 'Ladung ausweichen', conds: [{ type: 'eCharged', val: 'ja' }, { type: 'dist', op: '≤', val: 2 }], act: 'sidestep' };
  }
  return base;
}

/* ---------- Q-Learning-Agent ---------- */
// q ist egozentrisch indiziert, L enthält absolute Aktionen der Seite i
const qOf = (q, a, i) => q[ACTIONS.indexOf(ego(a, i))];
const argmaxL = (q, L, i) => { let m = -Infinity, out = []; for (const a of L) { const v = qOf(q, a, i); if (v > m + 1e-9) { m = v; out = [a]; } else if (Math.abs(v - m) <= 1e-9) out.push(a); } return pick(out); };
const maxL = (q, L, i) => { let m = -Infinity; for (const a of L) m = Math.max(m, qOf(q, a, i)); return m === -Infinity ? 0 : m; };

export function getBrain(A, create = true) {
  const k = brainKey(A.sensors);
  if (!A.brains[k] && create) A.brains[k] = { q: {}, fights: 0 };
  return A.brains[k] || { q: {}, fights: 0 };
}

// o: { eps, learn, useTac, countTac }
export function agentCtrl(A, o = {}) {
  const P = A.params, sens = sortSensors(A.sensors), brain = getBrain(A, !!o.learn), nA = ACTIONS.length;
  const c = {
    eps: o.eps || 0, trace: [], pend: null, last: null,
    decide(b, i) {
      const k = stateKey(b, i, sens);
      let q = brain.q[k];
      const known = !!q;
      if (!q) { q = new Array(nA).fill(P.qInit); if (o.learn) brain.q[k] = q; }
      const L = legal(b, i);
      let a = null, src = 'q', rule = null;
      if (o.useTac && A.tactics && A.tactics.length) { const r = evalTactics(A.tactics, b, i, L, o.countTac); if (r) { a = r.a; src = 'tac'; rule = r.rule.name; } }
      if (a === null && c.eps > 0 && Math.random() < c.eps) { a = pick(L); src = 'explore'; }
      if (a === null) a = argmaxL(q, L, i);
      // für die Anzeige in absoluter Reihenfolge
      c.last = { a, src, rule, q: ACTIONS.map(x => qOf(q, x, i)), L, known, k };
      if (o.learn) c.pend = { k, ai: ACTIONS.indexOf(ego(a, i)) };
      return a;
    },
    // Q(λ) mit Spuren: jede Runde wird sofort gelernt, frühere Züge bekommen einen abgeschwächten Anteil.
    observe(b, i, res) {
      if (!o.learn || !c.pend) return;
      const { k, ai } = c.pend; c.pend = null;
      let r = P.rStep + P.rDealt * res.dmg[1 - i] + P.rTaken * res.dmg[i];
      const done = !!b.over;
      if (done) r += b.over.w === i ? P.rWin : b.over.w === -1 ? P.rDraw : P.rLoss;
      let target = r;
      if (!done) {
        const k2 = stateKey(b, i, sens);
        const q2 = brain.q[k2] || (brain.q[k2] = new Array(nA).fill(P.qInit));
        target += P.gamma * maxL(q2, legal(b, i), i);
      }
      const delta = target - brain.q[k][ai];
      const decay = P.gamma * P.lambda;
      for (const t of c.trace) t.e *= decay;
      c.trace = c.trace.filter(t => t.e > 0.02 && !(t.k === k && t.ai === ai));
      c.trace.push({ k, ai, e: 1 });
      const lr = Math.min(1, P.alpha * (delta < 0 ? P.neg : 1));
      for (const t of c.trace) brain.q[t.k][t.ai] += lr * delta * t.e;
      if (done) { c.trace = []; brain.fights++; }
    },
  };
  return c;
}

/* ---------- Liga-Gegner ---------- */
function champMove(b, i) {
  const L = legal(b, i), Lo = legal(b, 1 - i), oLast = b.f[1 - i].hist.at(-1);
  let best = -Infinity, out = [];
  for (const a of L) {
    let s = 0, ws = 0;
    for (const x of Lo) {
      const w = x === oLast ? 3 : 1, c = cloneBattle(b);
      const r = step(c, i === 0 ? [a, x] : [x, a]);
      let v = r.dmg[1 - i] * 1.2 - r.dmg[i];
      if (c.over) v += c.over.w === i ? 25 : c.over.w === -1 ? 0 : -25;
      const me = c.f[i], op = c.f[1 - i];
      if (meleeReach(me, op) && me.mcd === 0) v += 0.4;
      if (me.charged) v += 0.5;
      s += w * v; ws += w;
    }
    const v = s / ws + Math.random() * 0.35;
    if (v > best) { best = v; out = [a]; }
  }
  return out[0];
}
const AI = {
  random: (b, i) => pick(legal(b, i)),
  brute: (b, i) => {
    const f = b.f[i], o = b.f[1 - i], r = Math.random();
    if (meleeReach(f, o) && f.mcd === 0) return r < 0.25 ? 'block' : r < 0.35 ? pick(legal(b, i)) : 'melee';
    if (r < 0.25) return pick(legal(b, i));
    return MOVE_TACTICS.toward(b, i);
  },
  archer: (b, i) => {
    const f = b.f[i], o = b.f[1 - i], r = Math.random();
    if (cheb(f, o) <= 1) return r < 0.55 ? (MOVE_TACTICS.away(b, i) || 'melee') : 'melee';
    if (rangedReach(f, o) && f.rcd === 0) return r < 0.85 ? 'ranged' : 'block';
    if (f.rcd > 0 && !f.charged && r < 0.4) return 'charge';
    return MOVE_TACTICS.align(b, i) || 'block';
  },
  turtle: (b, i) => {
    const f = b.f[i], o = b.f[1 - i], r = Math.random();
    if (meleeReach(f, o)) {
      if (o.charged) return 'block';
      if (catOf(o.hist.at(-1)) === 'block') return 'melee';
      return r < 0.4 ? 'block' : 'melee';
    }
    if (rangedReach(o, f, o) && o.rcd === 0 && r < 0.5) return 'block';
    if (!f.charged && r < 0.15) return 'charge';
    return MOVE_TACTICS.toward(b, i) || 'block';
  },
  fox: (b, i) => {
    const f = b.f[i], o = b.f[1 - i], r = Math.random();
    if (o.root > 0) return meleeReach(f, o) ? 'melee' : (MOVE_TACTICS.toward(b, i) || 'charge');
    if (rangedReach(f, o) && f.rcd === 0 && manh(f, o) >= 2) return 'ranged';
    if (o.charged && meleeReach(o, f, o)) return MOVE_TACTICS.sidestep(b, i) || MOVE_TACTICS.away(b, i) || 'block';
    if (meleeReach(f, o)) return r < 0.65 ? 'melee' : (MOVE_TACTICS.sidestep(b, i) || 'melee');
    if (cheb(f, o) === 2 && !f.charged && r < 0.5) return 'charge';
    return (f.rcd === 0 ? MOVE_TACTICS.align(b, i) : MOVE_TACTICS.toward(b, i)) || 'block';
  },
  champ: champMove,
};
export const BOTS = [
  { id: 'dummy', name: 'Strohpuppe', tag: 'Macht irgendwas. Ideal zum Aufwärmen.', ai: 'random', gear: { ...STARTER_GEAR }, coins: 15, packs: 0, loot: ['leather'] },
  { id: 'brute', name: 'Bruno Rammbock', tag: 'Läuft stur auf dich zu und schlägt mit dem Schwert zu.', ai: 'brute', gear: { melee: 'sword', ranged: 'sling', armor: 'cloth' }, coins: 25, packs: 1, loot: ['sword'] },
  { id: 'fox', name: 'Fiona Fuchs', tag: 'Fesselt dich mit dem Netz und sticht mit Dolchen zu.', ai: 'fox', gear: { melee: 'daggers', ranged: 'net', armor: 'cloak' }, coins: 40, packs: 1, loot: ['daggers', 'net', 'cloak'] },
  { id: 'archer', name: 'Sira Scharfblick', tag: 'Hält Abstand, lädt auf und schießt aus der Linie.', ai: 'archer', gear: { melee: 'fists', ranged: 'bow', armor: 'leather' }, coins: 60, packs: 2, loot: ['bow'] },
  { id: 'turtle', name: 'Igor Igel', tag: 'Blockt, wenn du kommst, und kontert mit dem Speer.', ai: 'turtle', gear: { melee: 'spear', ranged: 'sling', armor: 'chain' }, coins: 90, packs: 2, loot: ['spear', 'chain'] },
  { id: 'champ', name: 'Der Champion', tag: 'Rechnet jede Runde alle deine Antworten durch.', ai: 'champ', gear: { melee: 'axe', ranged: 'crossbow', armor: 'plate' }, coins: 140, packs: 3, loot: ['axe', 'crossbow', 'plate'] },
];
export function botCtrl(bot) {
  return { decide(b, i) { const a = AI[bot.ai](b, i); this.last = { src: 'bot' }; return legal(b, i).includes(a) ? a : pick(legal(b, i)); }, observe() {} };
}

/* ---------- Kampf ohne Anzeige ---------- */
export function runFight(c0, c1, g0, g1) {
  const b = newBattle(g0, g1);
  while (!b.over) {
    const a0 = c0.decide(b, 0), a1 = c1.decide(b, 1);
    const res = step(b, [a0, a1]);
    c0.observe(b, 0, res); c1.observe(b, 1, res);
  }
  return b.over.w;
}
// Kampfkraft: der komplette Agent (ohne Zufall, mit Taktiken) gegen alle Liga-Gegner
export function combatPower(A, n = 12) {
  const me = agentCtrl(A, { eps: 0, learn: false, useTac: A.match.tac });
  let s = 0, t = 0;
  for (const bot of BOTS) {
    const op = botCtrl(bot);
    for (let k = 0; k < n; k++) { const w = runFight(me, op, A.gear, bot.gear); s += w === 0 ? 1 : w === -1 ? 0.5 : 0; t++; }
  }
  return Math.round(100 * s / t);
}
