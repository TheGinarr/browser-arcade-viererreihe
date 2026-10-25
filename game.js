/* ============================================================
   VIERERREIHE · game.js
   ------------------------------------------------------------
   1. Regeln + Computer stecken in engine.js (rein, Node-testbar),
      der Computer rechnet in ki-worker.js (Web Worker).
   2. Modi: Computer (Leicht/Mittel/Schwer), zu zweit am Gerät,
      online (mehrspieler.js). Online führt der Host das Brett, der
      Gast schickt nur {t:"zug", s}; der Host antwortet mit dem
      ganzen Stand {t:"stand", …}. Nach jeder Partie beginnt der andere.
   3. Topliste "viererreihe" = längste Siegesserie auf Schwer.
   ============================================================ */

import * as E from "./engine.js?v=20261024";
import { lade, speichere, spielZuruecksetzen } from "./assets/storage.js";
import { stillEintragen, toplisteAnzeigen, bewegungReduziert } from "./assets/ui.js";
import * as FS from "./assets/fortschritt.js";
import { raumEroeffnen, raumBeitreten, CODE_MUSTER } from "./assets/mehrspieler.js";

const SPIEL = "viererreihe";
const $ = (id) => document.getElementById(id);
const el = {
  modi: $("modi"),
  stufen: $("stufen"),
  online: $("online"),
  beitritt: $("beitritt"),
  code: $("code"),
  raumkopf: $("raumkopf"),
  raumcode: $("raumcode"),
  status: $("status"),
  gitter: $("gitter"),
  vorschau: $("vorschau"),
  ende: $("ende"),
  nochmal: $("nochmal"),
  punkte: $("punkte"),
  l1: $("hud-l1"),
  w1: $("hud-1"),
  l2: $("hud-l2"),
  w2: $("hud-2"),
  topliste: $("topliste"),
};
const FARBE = { 1: "Rot", 2: "Gelb" };

/* ---------- Zustand ---------- */
let modus = "computer";
let stufe = lade(SPIEL, "stufe", "mittel");
if (!["leicht", "mittel", "schwer"].includes(stufe)) stufe = "mittel";
let brett = E.neuesBrett();
let dran = 1;
let aus = null; // {sieger, linie, remis} wenn vorbei
let letzter = null; // [s, r] für die Fall-Animation
let ich = 1; // meine Farbe (Computer/online); zu zweit egal
let beginner = 1;
let wahl = 3; // Tastatur-Spalte
let rechnet = false;
let stat = lade(SPIEL, "stat", null) || { serie: 0, beste: 0 };
// online
let netz = null; // {rolle:"host"|"gast", raum, code}
let gastDa = false;
let stand = { host: 0, gast: 0 };
let runde = 0;

/* ---------- Worker ---------- */
let worker = null;
let anfrage = 0;
try {
  worker = new Worker(new URL("./ki-worker.js?v=20261024", import.meta.url), { type: "module" });
} catch {
  worker = null;
}
function computerRechnen(b, wer, st) {
  const id = ++anfrage;
  return new Promise((fertig) => {
    if (!worker) return setTimeout(() => fertig(E.computerZug(b, wer, st)), 30);
    const an = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", an);
      fertig(e.data.spalte);
    };
    worker.addEventListener("message", an);
    worker.postMessage({ id, brett: b, wer, stufe: st });
  });
}

/* ---------- Brett zeichnen ---------- */
const spalten = [];
for (let s = 0; s < E.SPALTEN; s++) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "vr-spalte";
  b.tabIndex = -1;
  b.dataset.s = s;
  for (let r = 0; r < E.REIHEN; r++) {
    const loch = document.createElement("span");
    loch.className = "vr-loch";
    b.append(loch);
  }
  b.addEventListener("click", () => klick(s));
  b.addEventListener("pointerenter", () => vorschauZeigen(s));
  el.gitter.append(b);
  spalten.push(b);
  el.vorschau.append(document.createElement("i"));
}
el.gitter.addEventListener("pointerleave", () => vorschauZeigen(-1));

function ichDarf() {
  if (aus || rechnet) return false;
  if (modus === "zweit") return true;
  if (modus === "online") return !!netz && (netz.rolle === "gast" || gastDa) && dran === ich;
  return dran === ich;
}

function vorschauZeigen(s) {
  const steine = el.vorschau.children;
  for (let i = 0; i < steine.length; i++) {
    const zeig = i === s && ichDarf() && E.erlaubt(brett, i);
    steine[i].className = zeig ? `an p${dran}` : "";
  }
}

function zeichnen() {
  const sieg = new Set((aus?.linie || []).map(([s, r]) => `${s},${r}`));
  const ruhig = bewegungReduziert();
  for (let s = 0; s < E.SPALTEN; s++) {
    const frei = E.REIHEN - E.hoehe(brett, s);
    spalten[s].setAttribute("aria-label", `Spalte ${s + 1}${frei ? `, ${frei} frei` : ", voll"}`);
    spalten[s].classList.toggle("wahl", s === wahl && document.activeElement === el.gitter);
    const loecher = spalten[s].children;
    for (let r = 0; r < E.REIHEN; r++) {
      const wer = brett[s][r];
      const loch = loecher[r];
      let stein = loch.firstElementChild;
      if (!wer) {
        stein?.remove();
        continue;
      }
      if (!stein || !stein.classList.contains(`p${wer}`)) {
        stein?.remove();
        stein = document.createElement("span");
        stein.className = `stein p${wer}`;
        if (!ruhig && letzter && letzter[0] === s && letzter[1] === r) {
          stein.classList.add("faellt");
          stein.style.setProperty("--fall", String(E.REIHEN - r));
        }
        loch.append(stein);
      }
      stein.classList.toggle("sieg", sieg.has(`${s},${r}`));
    }
  }
  el.gitter.classList.toggle("warten", !ichDarf());
  statusSetzen();
  hud();
  el.ende.hidden = !aus || (modus === "online" && !netz);
  vorschauZeigen(-1);
}

function statusSetzen(text, art) {
  el.status.dataset.art = art || "";
  el.status.replaceChildren();
  if (text) {
    el.status.textContent = text;
    return;
  }
  const mini = (p) => {
    const i = document.createElement("span");
    i.className = `mini p${p}`;
    i.setAttribute("aria-hidden", "true");
    return i;
  };
  let t;
  if (modus === "online" && !netz) t = "Eröffne ein Spiel oder tritt mit Code bei.";
  else if (modus === "online" && netz.rolle === "host" && !gastDa) t = "Warte auf Mitspieler …";
  else if (aus?.sieger)
    t =
      modus === "zweit"
        ? `${FARBE[aus.sieger]} gewinnt!`
        : aus.sieger === ich
          ? "Du gewinnst!"
          : modus === "online"
            ? "Dein Gegenüber gewinnt."
            : "Der Computer gewinnt.";
  else if (aus) t = "Unentschieden – das Brett ist voll.";
  else if (modus === "zweit") t = `${FARBE[dran]} ist dran`;
  else if (dran === ich) t = "Du bist dran";
  else t = modus === "online" ? "Dein Gegenüber ist dran …" : "Der Computer überlegt …";
  const zeig = aus?.sieger || (!aus && (modus !== "online" || netz) ? dran : 0);
  if (zeig) el.status.append(mini(zeig));
  el.status.append(t);
}

function hud() {
  if (modus === "computer") {
    el.l1.textContent = "Serie (Schwer)";
    el.w1.textContent = String(stat.serie);
    el.l2.textContent = "Beste Serie";
    el.w2.textContent = String(stat.beste);
    el.punkte.textContent = `Du spielst Rot · ${beginner === ich ? "du beginnst" : "der Computer beginnt"}.`;
  } else if (modus === "zweit") {
    el.l1.textContent = "Rot";
    el.w1.textContent = String(stand.host);
    el.l2.textContent = "Gelb";
    el.w2.textContent = String(stand.gast);
    el.punkte.textContent = "";
  } else {
    const ichHost = netz?.rolle === "host";
    el.l1.textContent = "Du";
    el.w1.textContent = String(ichHost ? stand.host : stand.gast);
    el.l2.textContent = "Gegenüber";
    el.w2.textContent = String(ichHost ? stand.gast : stand.host);
    el.punkte.textContent = netz ? `Du spielst ${FARBE[ich]}.` : "";
  }
}

/* ---------- Spielablauf ---------- */
function neuePartie() {
  brett = E.neuesBrett();
  aus = null;
  letzter = null;
  dran = beginner;
  rechnet = false;
  anfrage++; // alte Computer-Antwort verwerfen
  zeichnen();
  if (modus === "computer" && dran !== ich) computerZieht();
}

function setzen(s, wer) {
  const r = E.setzen(brett, s, wer);
  if (r < 0) return false;
  letzter = [s, r];
  const linie = E.linieDurch(brett, s, r);
  if (linie) aus = { sieger: wer, linie, remis: false };
  else if (E.voll(brett)) aus = { sieger: 0, linie: null, remis: true };
  else dran = 3 - wer;
  return true;
}

function klick(s) {
  wahl = s;
  if (!ichDarf()) return;
  if (!E.erlaubt(brett, s)) {
    statusSetzen("Diese Spalte ist voll – wähle eine andere.", "fehler");
    return;
  }
  if (modus === "online" && netz.rolle === "gast") {
    netz.raum.senden({ t: "zug", s });
    rechnet = true; // bis der Stand vom Host kommt
    zeichnen();
    return;
  }
  setzen(s, dran);
  zeichnen();
  if (modus === "online") return aus ? hostPartieEnde() : hostStandSenden();
  if (aus) return partieEnde();
  if (modus === "computer") computerZieht();
}

async function computerZieht() {
  rechnet = true;
  zeichnen();
  const meine = anfrage + 1;
  const t0 = performance.now();
  const s = await computerRechnen(E.kopie(brett), dran, stufe);
  if (meine !== anfrage || modus !== "computer") return;
  const warte = Math.max(0, 420 - (performance.now() - t0)); // kurze Denkpause wirkt natürlicher
  await new Promise((r) => setTimeout(r, warte));
  if (meine !== anfrage || modus !== "computer") return;
  rechnet = false;
  setzen(s, dran);
  zeichnen();
  if (aus) partieEnde();
}

function partieEnde() {
  const sieg = aus.sieger !== 0 && aus.sieger === ich;
  if (modus === "computer") {
    if (stufe === "schwer") {
      if (sieg) {
        stat.serie++;
        // Fortschritt VOR dem Eintragen (vergleicht mit altem Bestwert)
        try {
          FS.runde(SPIEL, { punkte: stat.serie });
        } catch {
          /* Zugabe */
        }
        if (stat.serie > stat.beste) stat.beste = stat.serie;
        stillEintragen(SPIEL, stat.serie, "hoch");
        toplisteAnzeigen(el.topliste, SPIEL, serienText);
      } else {
        if (stat.serie > 0)
          statusSetzen(
            `${aus.sieger ? "Verloren" : "Unentschieden"} – deine Serie endet bei ${stat.serie}.`,
          );
        stat.serie = 0;
        epRunde(false);
      }
      speichere(SPIEL, "stat", stat);
    } else epRunde(sieg);
    beginner = 3 - beginner; // abwechselnd beginnen (du bleibst Rot)
  } else if (modus === "zweit") {
    if (aus.sieger === 1) stand.host++;
    else if (aus.sieger === 2) stand.gast++;
    beginner = 3 - beginner;
    epRunde(false);
  }
  hud();
}

/** EP für eine Partie ohne Serienwertung: 10 EP für einen Sieg, sonst 2. */
function epRunde(sieg) {
  const pb = Number(lade("konto", `pb:${SPIEL}`, 0)) || 0;
  try {
    FS.runde(SPIEL, { punkte: sieg && pb >= 1 ? 1 : 0 });
  } catch {
    /* Fortschritt ist Zugabe */
  }
}

const serienText = (p) => `${p} ${p === 1 ? "Sieg" : "Siege"}`;

/* ---------- Bedienung ---------- */
el.gitter.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    wahl = (wahl + (e.key === "ArrowLeft" ? E.SPALTEN - 1 : 1)) % E.SPALTEN;
    zeichnen();
    vorschauZeigen(wahl);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    klick(wahl);
  } else if (/^[1-7]$/.test(e.key)) klick(Number(e.key) - 1);
});
el.gitter.addEventListener("focus", () => zeichnen());
el.gitter.addEventListener("blur", () => zeichnen());

function knopfWahl(gruppe, attr, wert) {
  for (const k of gruppe.querySelectorAll("button"))
    k.setAttribute("aria-pressed", String(k.dataset[attr] === wert));
}

function modusSetzen(m) {
  if (netz) return;
  modus = m;
  knopfWahl(el.modi, "modus", m);
  el.stufen.hidden = m !== "computer";
  el.online.hidden = m !== "online";
  stand = { host: 0, gast: 0 };
  beginner = 1;
  ich = 1;
  neuePartie();
}
el.modi.addEventListener("click", (e) => {
  const k = e.target.closest("button[data-modus]");
  if (k) modusSetzen(k.dataset.modus);
});
el.stufen.addEventListener("click", (e) => {
  const k = e.target.closest("button[data-stufe]");
  if (!k || k.dataset.stufe === stufe) return;
  // Wechsel mitten in einer Schwer-Partie beendet die Serie nicht – sie zählt nur auf Schwer weiter
  stufe = k.dataset.stufe;
  speichere(SPIEL, "stufe", stufe);
  knopfWahl(el.stufen, "stufe", stufe);
  neuePartie();
});
el.nochmal.addEventListener("click", () => {
  if (modus === "online") {
    if (netz.rolle === "host") hostNeueRunde();
    else netz.raum.senden({ t: "revanche" });
    return;
  }
  neuePartie();
});

$("reset").addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  stat = { serie: 0, beste: 0 };
  hud();
  toplisteAnzeigen(el.topliste, SPIEL, serienText);
});

/* ---------- Online ---------- */
function onlineStart(n) {
  netz = n;
  el.modi.classList.add("gesperrt");
  el.online.hidden = true;
  el.raumkopf.hidden = false;
  el.raumcode.textContent = n.code;
  stand = { host: 0, gast: 0 };
}
function onlineEnde(text) {
  try {
    netz?.rolle === "host" ? netz.raum.schliessen() : netz?.raum.verlassen();
  } catch {
    /* schon zu */
  }
  netz = null;
  gastDa = false;
  el.modi.classList.remove("gesperrt");
  el.raumkopf.hidden = true;
  el.online.hidden = modus !== "online";
  ich = 1;
  beginner = 1;
  brett = E.neuesBrett();
  aus = null;
  zeichnen();
  if (text) statusSetzen(text, "fehler");
}

// Host: Platz 0 = Host, Platz 1 = Gast. Gast spielt die Farbe 3 - hostFarbe.
let hostFarbe = 1;
function hostStandSenden() {
  netz?.raum.senden(1, {
    t: "stand",
    brett,
    dran,
    aus,
    letzter,
    farbe: 3 - hostFarbe,
    stand,
    runde,
  });
}
function hostNeueRunde() {
  runde++;
  beginner = runde % 2 ? 1 : 2; // Runde 1: Host beginnt, dann abwechselnd
  hostFarbe = 1;
  ich = 1;
  // Wer beginnt, spielt Rot
  if (beginner === 2) {
    hostFarbe = 2;
    ich = 2;
  }
  brett = E.neuesBrett();
  aus = null;
  letzter = null;
  dran = 1;
  rechnet = false;
  zeichnen();
  hostStandSenden();
}
function hostPartieEnde() {
  if (aus.sieger === hostFarbe) stand.host++;
  else if (aus.sieger) stand.gast++;
  epRunde(aus.sieger === hostFarbe);
  hostStandSenden();
  hud();
}

$("eroeffnen").addEventListener("click", async () => {
  statusSetzen("Eröffne Spiel …");
  try {
    const raum = await raumEroeffnen(SPIEL, {
      gast() {
        gastDa = true;
        if (!runde) hostNeueRunde();
        else hostStandSenden(); // Wiederverbinden: aktueller Stand
        zeichnen();
      },
      gastWeg() {
        gastDa = false;
        zeichnen();
        statusSetzen("Verbindung weg – warte auf Rückkehr …");
      },
      nachricht(platz, d) {
        if (platz !== 1 || !d) return;
        if (d.t === "zug" && !aus && dran !== hostFarbe && E.erlaubt(brett, d.s)) {
          setzen(d.s, dran);
          zeichnen();
          if (aus) hostPartieEnde();
          else hostStandSenden();
        } else if (d.t === "zug")
          hostStandSenden(); // ungültig → Stand erneut
        else if (d.t === "revanche" && aus) hostNeueRunde();
      },
      status(text, art) {
        statusSetzen(text, art);
      },
    });
    runde = 0;
    onlineStart({ rolle: "host", raum, code: raum.code });
    zeichnen();
  } catch (err) {
    statusSetzen(err.message || "Eröffnen hat nicht geklappt.", "fehler");
  }
});

el.beitritt.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = el.code.value.toUpperCase().trim();
  if (!CODE_MUSTER.test(code)) return statusSetzen("Der Code hat 4 Zeichen (A–Z, 2–9).", "fehler");
  statusSetzen("Verbinde …");
  try {
    const raum = await raumBeitreten(SPIEL, code, {
      verbunden() {
        statusSetzen("Verbunden – gleich geht's los.");
      },
      nachricht(d) {
        if (d?.t !== "stand") return;
        brett = d.brett;
        dran = d.dran;
        aus = d.aus;
        letzter = d.letzter;
        ich = d.farbe;
        stand = d.stand;
        rechnet = false;
        zeichnen();
      },
      status(text, art) {
        statusSetzen(text, art);
      },
      ende(grund) {
        onlineEnde(grund || "Das Spiel ist beendet.");
      },
    });
    onlineStart({ rolle: "gast", raum, code });
    statusSetzen("Verbinde direkt …");
  } catch (err) {
    statusSetzen(err.message || "Beitreten hat nicht geklappt.", "fehler");
  }
});

$("aufstehen").addEventListener("click", () => onlineEnde("Du hast das Spiel verlassen."));
$("teilen").addEventListener("click", async () => {
  const code = netz?.code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}?tisch=${code}`;
  try {
    if (navigator.share)
      await navigator.share({
        title: "Viererreihe",
        text: `Spiel Viererreihe mit mir: ${code}`,
        url,
      });
    else {
      await navigator.clipboard.writeText(url);
      statusSetzen("Link kopiert.");
    }
  } catch {
    statusSetzen(`Code: ${code}`);
  }
});
window.addEventListener("pagehide", () => {
  if (netz?.rolle === "host") netz.raum.schliessen();
});

/* ---------- Start ---------- */
knopfWahl(el.stufen, "stufe", stufe);
toplisteAnzeigen(el.topliste, SPIEL, serienText);
const eingeladen = new URLSearchParams(location.search).get("tisch");
if (eingeladen) {
  modusSetzen("online");
  el.code.value = eingeladen.toUpperCase().slice(0, 4);
} else neuePartie();
