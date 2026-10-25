/* ki-worker.js · rechnet den Computerzug im Hintergrund (Seite ruckelt nicht) */
import { computerZug } from "./engine.js?v=20261024";

self.onmessage = (e) => {
  const { id, brett, wer, stufe } = e.data;
  self.postMessage({ id, spalte: computerZug(brett, wer, stufe) });
};
