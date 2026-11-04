// Q-Arena – Kampfregeln.
// Vollständig deterministisch: gleiche Aktionen ergeben auf jedem Gerät denselben Kampf.
// Dadurch können Online-Duelle nur die gewählten Aktionen austauschen.

export const SIZE = 5, MAX_TURNS = 30, BASE_HP = 10;
export const ACTIONS = ['up', 'down', 'left', 'right', 'melee', 'ranged', 'block', 'charge'];
export const MOVES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const CATS = ['none', 'move', 'melee', 'ranged', 'block', 'charge'];
export const catOf = a => a == null ? 'none' : MOVES[a] ? 'move' : a;
export const ACTION_LABEL = {
  up: 'Hoch', down: 'Runter', left: 'Links', right: 'Rechts',
  melee: 'Nahkampf', ranged: 'Fernkampf', block: 'Blocken', charge: 'Aufladen',
};

export const GEAR = {
  melee: {
    fists:   { name: 'Fäuste', dmg: 1, cd: 0, reach: 'adj', desc: '1 Schaden auf alle 8 Nachbarfelder.' },
    sword:   { name: 'Kurzschwert', dmg: 2, cd: 0, reach: 'adj', desc: '2 Schaden auf alle 8 Nachbarfelder.' },
    spear:   { name: 'Speer', dmg: 2, cd: 0, reach: 'line2', desc: '2 Schaden, trifft zusätzlich 2 Felder geradeaus.' },
    daggers: { name: 'Dolche', dmg: 2, cd: 0, reach: 'adj', pierce: true, desc: '2 Schaden, durchdringt Blocken.' },
    axe:     { name: 'Streitaxt', dmg: 4, cd: 1, reach: 'adj', desc: '4 Schaden, danach eine Runde kein Nahkampf.' },
  },
  ranged: {
    sling:    { name: 'Schleuder', dmg: 1, range: 3, cd: 1, desc: '1 Schaden, Reichweite 3, jede 2. Runde.' },
    bow:      { name: 'Bogen', dmg: 2, range: 4, cd: 1, desc: '2 Schaden, Reichweite 4, jede 2. Runde.' },
    net:      { name: 'Wurfnetz', dmg: 0, range: 3, cd: 3, root: 2, desc: 'Fesselt den Gegner 2 Runden, Reichweite 3, jede 4. Runde.' },
    crossbow: { name: 'Armbrust', dmg: 3, range: 4, cd: 2, desc: '3 Schaden, Reichweite 4, jede 3. Runde.' },
  },
  armor: {
    cloth:   { name: 'Stoffwams', hp: 0, red: 0, desc: 'Keine Panzerung.' },
    leather: { name: 'Lederrüstung', hp: 3, red: 0, desc: '+3 LP.' },
    chain:   { name: 'Kettenhemd', hp: 4, red: 0, rangedRed: 1, desc: '+4 LP, Fernkampfschaden −1.' },
    cloak:   { name: 'Schattenmantel', hp: 1, red: 0, dodge: 3, desc: '+1 LP, Schüsse aus 3 oder mehr Feldern verfehlen.' },
    plate:   { name: 'Plattenpanzer', hp: 5, red: 1, desc: '+5 LP, jeder Treffer −1 Schaden.' },
  },
};
export const STARTER_GEAR = { melee: 'fists', ranged: 'sling', armor: 'cloth' };

export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const inLine = (a, b) => a.x === b.x || a.y === b.y;

export function meleeReach(f, o, pos = f) {
  const w = GEAR.melee[f.gear.melee];
  if (cheb(pos, o) === 1) return true;
  return w.reach === 'line2' && inLine(pos, o) && manh(pos, o) === 2;
}
export function rangedReach(f, o, pos = f) {
  const w = GEAR.ranged[f.gear.ranged];
  return inLine(pos, o) && manh(pos, o) <= w.range;
}

export function makeFighter(gear, side) {
  const hp = BASE_HP + GEAR.armor[gear.armor].hp;
  return { x: 2, y: side === 0 ? 4 : 0, hp, maxHp: hp, gear: { ...gear }, rcd: 0, mcd: 0, charged: false, root: 0, rootNext: 0, hist: [] };
}
export function newBattle(gearA, gearB) {
  return { turn: 0, f: [makeFighter(gearA, 0), makeFighter(gearB, 1)], over: null };
}
export function cloneBattle(b) {
  return { turn: b.turn, over: b.over, f: b.f.map(f => ({ ...f, hist: f.hist.slice() })) };
}

export function legal(b, i) {
  const f = b.f[i];
  return ACTIONS.filter(a => {
    if (MOVES[a]) {
      if (f.root > 0) return false;
      const nx = f.x + MOVES[a][0], ny = f.y + MOVES[a][1];
      return nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE;
    }
    if (a === 'ranged') return f.rcd === 0;
    if (a === 'melee') return f.mcd === 0;
    if (a === 'charge') return !f.charged;
    return true;
  });
}

// Eine Runde: beide Aktionen gleichzeitig. Reihenfolge: Bewegung → Angriffe → Schaden → Abklingzeiten.
export function step(b, acts) {
  const F = b.f, ev = [];
  b.turn++;
  acts = acts.map((a, i) => legal(b, i).includes(a) ? a : 'block');
  const from = F.map(f => ({ x: f.x, y: f.y }));
  const tgt = F.map((f, i) => { const m = MOVES[acts[i]]; return m ? { x: f.x + m[0], y: f.y + m[1] } : { ...from[i] }; });
  const same = (p, q) => p.x === q.x && p.y === q.y;
  const stay = [false, false];
  if (same(tgt[0], tgt[1]) || (same(tgt[0], from[1]) && same(tgt[1], from[0]))) { stay[0] = stay[1] = true; }
  else {
    if (same(tgt[0], from[1]) && same(tgt[1], from[1])) stay[0] = true;
    if (same(tgt[1], from[0]) && same(tgt[0], from[0])) stay[1] = true;
  }
  F.forEach((f, i) => {
    if (!MOVES[acts[i]]) return;
    if (stay[i]) ev.push({ t: 'bump', i, to: tgt[i] });
    else { f.x = tgt[i].x; f.y = tgt[i].y; ev.push({ t: 'move', i, from: from[i], to: tgt[i] }); }
  });

  const dmg = [0, 0];
  const blocking = acts.map(a => a === 'block');
  F.forEach((f, i) => {
    const oi = 1 - i, o = F[oi], a = acts[i], ar = GEAR.armor[o.gear.armor];
    if (a === 'block') ev.push({ t: 'block', i });
    else if (a === 'charge') { f.charged = true; ev.push({ t: 'charge', i }); }
    else if (a === 'melee') {
      const w = GEAR.melee[f.gear.melee], hit = meleeReach(f, o);
      let d = 0, blocked = false;
      if (hit) {
        d = w.dmg * (f.charged ? 2 : 1);
        if (blocking[oi] && !w.pierce) { d = Math.floor(d / 2); blocked = true; }
        d = Math.max(0, d - ar.red);
      }
      f.charged = false;
      f.mcd = w.cd ? w.cd + 1 : 0;
      dmg[oi] += d;
      ev.push({ t: 'melee', i, hit, d, blocked, at: { x: o.x, y: o.y } });
    } else if (a === 'ranged') {
      const w = GEAR.ranged[f.gear.ranged], inR = rangedReach(f, o);
      let d = 0, blocked = false, dodged = false;
      if (inR) {
        if (blocking[oi]) blocked = true;
        else if (ar.dodge && manh(f, o) >= ar.dodge) dodged = true;
        else {
          if (w.dmg > 0) d = Math.max(0, w.dmg * (f.charged ? 2 : 1) - ar.red - (ar.rangedRed || 0));
          if (w.root) o.rootNext = w.root;
        }
      }
      f.charged = false;
      f.rcd = w.cd + 1;
      dmg[oi] += d;
      ev.push({ t: 'ranged', i, hit: inR && !blocked && !dodged, inRange: inR, d, blocked, dodged, root: !!(w.root && inR && !blocked && !dodged), from: { x: f.x, y: f.y }, to: { x: o.x, y: o.y } });
    }
  });

  F.forEach((f, i) => { f.hp = Math.max(0, f.hp - dmg[i]); if (dmg[i] > 0) ev.push({ t: 'dmg', i, d: dmg[i] }); });
  F.forEach((f, i) => {
    if (f.rcd > 0) f.rcd--;
    if (f.mcd > 0) f.mcd--;
    if (f.root > 0) f.root--;
    if (f.rootNext) { f.root = f.rootNext; f.rootNext = 0; ev.push({ t: 'root', i }); }
    f.hist.push(acts[i]); if (f.hist.length > 4) f.hist.shift();
  });

  const dead = F.map(f => f.hp <= 0);
  if (dead[0] && dead[1]) b.over = { w: -1 };
  else if (dead[0]) b.over = { w: 1 };
  else if (dead[1]) b.over = { w: 0 };
  else if (b.turn >= MAX_TURNS) {
    const r = F.map(f => f.hp / f.maxHp);
    b.over = { w: r[0] > r[1] + 1e-9 ? 0 : r[1] > r[0] + 1e-9 ? 1 : -1, timeout: true };
  }
  return { ev, acts, dmg };
}

// Kompakter Zustand für Anzeige und Wiederholung
export function snapshot(b) {
  return { turn: b.turn, over: b.over, f: b.f.map(f => ({ x: f.x, y: f.y, hp: f.hp, maxHp: f.maxHp, charged: f.charged, root: f.root, rcd: f.rcd, mcd: f.mcd })) };
}
