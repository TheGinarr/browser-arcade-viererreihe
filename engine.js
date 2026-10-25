/* ============================================================
   engine.js · Viererreihe – reine Regeln + Computer-Gegner
   (kein DOM, in Node testbar)
   Brett: 7 Spalten × 6 Reihen, brett[s][r], r = 0 ist unten.
   Steine: 0 leer, 1 Spieler 1, 2 Spieler 2.
   ============================================================ */

export const SPALTEN = 7;
export const REIHEN = 6;
const MITTE_ZUERST = [3, 2, 4, 1, 5, 0, 6];

export function neuesBrett() {
  return Array.from({ length: SPALTEN }, () => Array(REIHEN).fill(0));
}
export const kopie = (b) => b.map((s) => s.slice());
export const hoehe = (b, s) => (b[s].indexOf(0) === -1 ? REIHEN : b[s].indexOf(0));
export const erlaubt = (b, s) =>
  Number.isInteger(s) && s >= 0 && s < SPALTEN && b[s][REIHEN - 1] === 0;
export const zuege = (b) => MITTE_ZUERST.filter((s) => erlaubt(b, s));
export const voll = (b) => b.every((s) => s[REIHEN - 1] !== 0);

/** Legt einen Stein ab (verändert b) und gibt die Reihe zurück, -1 wenn voll. */
export function setzen(b, s, wer) {
  if (!erlaubt(b, s)) return -1;
  const r = hoehe(b, s);
  b[s][r] = wer;
  return r;
}

const RICHTUNGEN = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
/** Gewinnlinie durch (s,r) als [[s,r],…] (4+ Steine) oder null. */
export function linieDurch(b, s, r) {
  const wer = b[s]?.[r];
  if (!wer) return null;
  for (const [ds, dr] of RICHTUNGEN) {
    const l = [[s, r]];
    for (const v of [1, -1]) {
      let x = s + ds * v,
        y = r + dr * v;
      while (x >= 0 && x < SPALTEN && y >= 0 && y < REIHEN && b[x][y] === wer) {
        l.push([x, y]);
        x += ds * v;
        y += dr * v;
      }
    }
    if (l.length >= 4) return l.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  }
  return null;
}

/** Ergebnis des ganzen Bretts: { sieger: 0|1|2, linie, remis } */
export function auswerten(b) {
  for (let s = 0; s < SPALTEN; s++)
    for (let r = 0; r < REIHEN; r++) {
      const l = linieDurch(b, s, r);
      if (l) return { sieger: b[s][r], linie: l, remis: false };
    }
  return { sieger: 0, linie: null, remis: voll(b) };
}

/* ---------- Computer ---------- */
// Bewertung aller 69 Viererfenster aus Sicht von `wer`
const FENSTER = [];
for (let s = 0; s < SPALTEN; s++)
  for (let r = 0; r < REIHEN; r++)
    for (const [ds, dr] of RICHTUNGEN) {
      const es = s + 3 * ds,
        er = r + 3 * dr;
      if (es < 0 || es >= SPALTEN || er < 0 || er >= REIHEN) continue;
      FENSTER.push([0, 1, 2, 3].map((i) => [s + i * ds, r + i * dr]));
    }
function bewerten(b, wer) {
  const geg = 3 - wer;
  let w = 0;
  for (let r = 0; r < REIHEN; r++) w += b[3][r] === wer ? 3 : b[3][r] === geg ? -3 : 0;
  for (const f of FENSTER) {
    let m = 0,
      g = 0;
    for (const [s, r] of f) {
      const x = b[s][r];
      if (x === wer) m++;
      else if (x === geg) g++;
    }
    if (m && g) continue;
    if (m === 3) w += 50;
    else if (m === 2) w += 6;
    else if (g === 3) w -= 60;
    else if (g === 2) w -= 6;
  }
  return w;
}

const SIEG = 1e6;
function negamax(b, tiefe, alpha, beta, wer, zaehler) {
  zaehler.n++;
  const liste = zuege(b);
  if (!liste.length) return 0;
  // sofortiger Sieg?
  for (const s of liste) {
    const r = setzen(b, s, wer);
    const sieg = linieDurch(b, s, r);
    b[s][r] = 0;
    if (sieg) return SIEG + tiefe;
  }
  if (tiefe === 0 || zaehler.n > zaehler.max) return bewerten(b, wer);
  let best = -Infinity;
  for (const s of liste) {
    const r = setzen(b, s, wer);
    const w = -negamax(b, tiefe - 1, -beta, -alpha, 3 - wer, zaehler);
    b[s][r] = 0;
    if (w > best) best = w;
    if (w > alpha) alpha = w;
    if (alpha >= beta) break;
  }
  return best;
}

function sofort(b, wer) {
  for (const s of zuege(b)) {
    const t = kopie(b);
    const r = setzen(t, s, wer);
    if (linieDurch(t, s, r)) return s;
  }
  return -1;
}

/**
 * Bester Zug für `wer`. stufe: "leicht" | "mittel" | "schwer".
 * zufall(): 0..1 (für Tests austauschbar).
 */
export function computerZug(b, wer, stufe = "mittel", zufall = Math.random) {
  const liste = zuege(b);
  if (!liste.length) return -1;
  const sieg = sofort(b, wer);
  if (sieg >= 0) return sieg;
  const block = sofort(b, 3 - wer);
  if (stufe === "leicht") {
    if (block >= 0 && zufall() < 0.7) return block;
    // meidet nur grobe Fehler: keinen Stein legen, auf den der Gegner sofort gewinnt
    const sicher = liste.filter((s) => {
      const t = kopie(b);
      setzen(t, s, wer);
      return sofort(t, 3 - wer) < 0;
    });
    const aus = sicher.length && zufall() < 0.6 ? sicher : liste;
    return aus[Math.floor(zufall() * aus.length)];
  }
  if (block >= 0) return block;
  const tiefe = stufe === "schwer" ? 8 : 4;
  const zaehler = { n: 0, max: stufe === "schwer" ? 400000 : 50000 };
  let bester = liste[0],
    bestW = -Infinity;
  const werte = [];
  for (const s of liste) {
    const t = kopie(b);
    setzen(t, s, wer);
    const w = -negamax(t, tiefe - 1, -Infinity, Infinity, 3 - wer, zaehler);
    werte.push([s, w]);
    if (w > bestW) {
      bestW = w;
      bester = s;
    }
  }
  // Mittel: unter gleich guten Zügen etwas Abwechslung
  if (stufe === "mittel") {
    const gleich = werte.filter(([, w]) => w >= bestW - 4).map(([s]) => s);
    return gleich[Math.floor(zufall() * gleich.length)];
  }
  return bester;
}
