#!/usr/bin/env node
/* Carnet de tactique — import des vidéos dans le cloud (GitHub Actions du dépôt privé de données).

   Usage : node cloud_import.js <dossier du dépôt de données>
   Variables : GEMINI_API_KEY (secret du dépôt), STOCKFISH (chemin du moteur, défaut « stockfish »),
               GEMINI_MOCK (tests uniquement : module qui remplace les réponses de Gemini).

   Lit queue.json, traite chaque vidéo « queued » avec la même logique que le site (video-core.js),
   évalue les positions avec Stockfish, ajoute chaque partie à videos.json dès qu'elle est prête,
   et met à jour l'état de la file. Chaque écriture est un commit poussé aussitôt. */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync, spawn } = require("child_process");
const C = require("../video-core.js");
const { Chess } = require("chess.js");
C.setChess(Chess);

const DIR = path.resolve(process.argv[2] || ".");
const QF = path.join(DIR, "queue.json"), VF = path.join(DIR, "videos.json");
const KEY = process.env.GEMINI_API_KEY || "";
const STALE = 3 * 3600 * 1000; // une analyse « running » plus vieille que 3 h a été interrompue : on la reprend

if (process.env.GEMINI_MOCK) {
  const mock = require(path.resolve(process.env.GEMINI_MOCK)), real = global.fetch;
  global.fetch = async (u, o) => {
    if (!String(u).includes("generativelanguage")) return real(u, o);
    const r = await mock(JSON.parse(o.body), String(u));
    return { ok: r.status ? r.status < 300 : true, status: r.status || 200, json: async () => r.body || r };
  };
}

/* ---------- git : chaque modification est relue sur la dernière version puis poussée ---------- */
const git = (...a) => execFileSync("git", ["-C", DIR, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const branch = () => { try { return git("rev-parse", "--abbrev-ref", "HEAD").trim(); } catch (e) { return "main"; } };
const sleepMs = ms => new Promise(z => setTimeout(z, ms));
async function commit(msg, mutate) {
  const br = branch();
  for (let k = 0; k < 5; k++) {
    try { git("fetch", "-q", "origin", br); git("reset", "-q", "--hard", "origin/" + br); } catch (e) { /* dépôt sans distant (tests) */ }
    const q = readJSON(QF, { format: "carnet-queue", version: 1, jobs: [] });
    const v = readJSON(VF, { format: "carnet-videos", version: 1, videos: [] });
    if (mutate(q, v) === false) return;
    fs.writeFileSync(QF, JSON.stringify(q, null, 1) + "\n");
    fs.writeFileSync(VF, JSON.stringify(v, null, 1) + "\n");
    git("add", "queue.json", "videos.json");
    try { git("commit", "-q", "-m", msg); } catch (e) { return; } // rien n'a changé
    try { git("push", "-q", "origin", "HEAD:" + br); return; }
    catch (e) { if (k === 4) throw e; await sleepMs(2000 + 3000 * k); }
  }
}
const setJob = (id, patch, msg) => commit(msg || `File d'analyse : ${patch.status || "progression"}`, q => {
  const j = q.jobs.find(x => x.id === id); if (!j) return false; Object.assign(j, patch, { updated: Date.now() });
});

/* ---------- Stockfish natif ---------- */
class Engine {
  constructor(bin) { this.p = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] }); this.buf = ""; this.wait = null;
    this.p.stdout.on("data", d => { this.buf += d; let i; while ((i = this.buf.indexOf("\n")) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.wait && this.wait(l); } });
    this.p.on("error", () => { this.dead = true; }); }
  send(s) { this.p.stdin.write(s + "\n"); }
  until(test, ms) { return new Promise((res, rej) => { const t = setTimeout(() => { this.wait = null; rej(new Error("moteur muet")); }, ms || 60000);
    const lines = []; this.wait = l => { lines.push(l); if (test(l)) { clearTimeout(t); this.wait = null; res(lines); } }; }); }
  async init() { this.send("uci"); await this.until(l => l === "uciok", 15000); this.send("setoption name Threads value 2"); this.send("isready"); await this.until(l => l === "readyok"); }
  async eval(fen, depth) {
    this.send("position fen " + fen); this.send("go depth " + depth);
    const lines = await this.until(l => l.startsWith("bestmove"), 120000);
    let cp = 0, pv = [];
    for (const l of lines) { if (!l.startsWith("info") || !/ score /.test(l)) continue;
      const m = l.match(/ score (cp|mate) (-?\d+)/); if (m) cp = m[1] === "cp" ? +m[2] : (+m[2] > 0 ? 1500 - +m[2] : -1500 - +m[2]);
      const p = l.match(/ pv (.+)$/); if (p) pv = p[1].split(" "); }
    return { cp, pv }; // du point de vue du camp au trait, comme le moteur du site
  }
  quit() { try { this.send("quit"); } catch (e) {} }
}
async function evalVideo(E, v) {
  for (const m of v.moments) {
    if (m.ev != null || !m.fen) continue;
    const c = new Chess(m.fen);
    if (c.game_over()) { m.ev = c.in_checkmate() ? (c.turn() === "w" ? -1500 : 1500) : 0; continue; }
    const r = await E.eval(m.fen, 14); m.ev = c.turn() === "w" ? r.cp : -r.cp;
    const u = r.pv[0]; if (u) { const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (mv) m.best = mv.san; }
    for (const x of m.vars || []) {
      if (!x.sans.length || x.ev != null) continue;
      const e = new Chess(m.fen); x.sans.forEach(s => e.move(s));
      if (e.game_over()) { x.ev = e.in_checkmate() ? (e.turn() === "w" ? -1500 : 1500) : 0; continue; }
      const q = await E.eval(e.fen(), 12); x.ev = e.turn() === "w" ? q.cp : -q.cp;
    }
  }
}

/* ---------- une vidéo de la file ---------- */
async function runJob(job, E) {
  const id = C.ytId(job.url); if (!id) throw new Error("lien YouTube non reconnu");
  const cfg = { k: KEY, model: job.model || "gemini-3.8-flash" }, yurl = "https://www.youtube.com/watch?v=" + id;
  const pgn = Array.isArray(job.pgn) && job.pgn.length ? job.pgn : null, split = job.split !== false && !pgn;
  const form = { author: job.author || "", license: job.license || "perso" };
  let vtitle = job.title || "", last = 0;
  const say = t => { console.log("  " + t); };
  const progress = async (t, extra) => { console.log("> " + t); if (Date.now() - last > 20000 || extra) { last = Date.now(); await setJob(job.id, Object.assign({ progress: t }, extra || {}), "File d'analyse : progression"); } };

  let segs = [{ a: job.from ?? null, b: job.to ?? null, white: "", black: "", desc: "" }];
  if (split) {
    await progress("Repérage des parties de la vidéo…", {});
    try { const t = await C.vToc(cfg, yurl, job.from ?? null, job.to ?? null, say); if (!vtitle) vtitle = t.title;
      if (t.games.length) segs = t.games; else if (t.dur) segs = [{ a: job.from || 0, b: t.dur, white: "", black: "", desc: "" }]; }
    catch (e) { say("Repérage impossible : " + e.message); }
  }
  const have = readJSON(VF, { videos: [] }).videos.filter(x => x.vid === id);
  const miss = C.vSegMissing(segs, split ? have : []), n = miss.total, done = [], failed = [];
  if (!miss.segs.length) return { done, failed, n, skipped: miss.skipped };
  await progress(`${n} partie${n > 1 ? "s" : ""} repérée${n > 1 ? "s" : ""}${miss.skipped ? `, ${miss.skipped} déjà importée${miss.skipped > 1 ? "s" : ""}` : ""}.`, { parts: { done: 0, total: miss.segs.length } });
  for (const g of miss.segs) {
    const k = g.i, label = n > 1 ? `Partie ${k + 1}/${n}${g.white || g.black ? ` (${g.white} – ${g.black})` : ""} · ` : "";
    try {
      await progress(label + "lecture par Gemini…");
      const r = await C.vExtract(cfg, yurl, g.a, g.b, pgn, say, label);
      const { main, ms } = C.vBuild(r.raw, { pgn });
      if (!ms.length) throw new Error("aucun moment commenté trouvé");
      if (!vtitle && r.raw.titre) vtitle = r.raw.titre;
      const v = C.vEntry({ id, yurl, g, k, n, r, main, ms, pgn, base: vtitle || "Vidéo " + id, form });
      if (E) { try { await evalVideo(E, v); } catch (e) { say("Stockfish : " + e.message); } }
      done.push(v);
      await commit(`Vidéo : ${v.title}`.slice(0, 120), (q, lib) => {
        lib.videos = lib.videos.filter(x => x.id !== v.id); lib.videos.push(v);
        const j = q.jobs.find(x => x.id === job.id); if (j) Object.assign(j, { parts: { done: done.length, total: miss.segs.length }, progress: `${label}${ms.length} moments, ${main.sans.length} coups vérifiés.`, updated: Date.now() });
      });
      last = Date.now();
    } catch (e) { failed.push({ k: k + 1, msg: e.message }); console.log("! " + label + e.message); }
  }
  return { done, failed, n, skipped: miss.skipped };
}

async function main() {
  const q = readJSON(QF, null);
  const todo = (q && q.jobs || []).filter(j => j.status === "queued" || (j.status === "running" && Date.now() - (j.updated || j.started || 0) > STALE));
  if (!todo.length) { console.log("Aucune vidéo en attente."); return; }
  let E = null;
  try { E = new Engine(process.env.STOCKFISH || "stockfish"); await E.init(); } catch (e) { console.log("Stockfish indisponible : les positions ne seront pas évaluées."); E = null; }
  for (const job of todo) {
    console.log(`\n=== ${job.url}`);
    if (!KEY && !process.env.GEMINI_MOCK) {
      await setJob(job.id, { status: "error", msg: "Clé Gemini absente : ajoute le secret GEMINI_API_KEY dans les réglages du dépôt (Settings › Secrets and variables › Actions).", finished: Date.now() }, "File d'analyse : clé manquante");
      continue;
    }
    await setJob(job.id, { status: "running", started: Date.now(), progress: "Démarrage…", msg: "" }, "File d'analyse : démarrage");
    try {
      const r = await runJob(job, E), nd = r.done.length, mom = r.done.reduce((a, v) => a + v.moments.length, 0);
      let msg;
      if (!nd && !r.failed.length) msg = r.skipped ? `Les ${r.n} parties étaient déjà importées.` : "Rien à importer.";
      else if (!nd) throw new Error(r.failed.map(f => (r.n > 1 ? `partie ${f.k} : ` : "") + f.msg).join(" ; "));
      else msg = `${nd} partie${nd > 1 ? "s" : ""} importée${nd > 1 ? "s" : ""}${r.n > 1 ? ` sur ${r.n}` : ""} (${mom} moments)` +
        (r.failed.length ? `. Échec ${r.failed.map(f => `partie ${f.k} : ${f.msg}`).join(" ; ")} — relance la vidéo pour reprendre` : "") + ".";
      await setJob(job.id, { status: r.failed.length && nd ? "partial" : "done", msg, progress: "", finished: Date.now() }, "File d'analyse : terminé");
    } catch (e) {
      await setJob(job.id, { status: "error", msg: e.message, progress: "", finished: Date.now() }, "File d'analyse : échec");
    }
  }
  if (E) E.quit();
}
main().catch(e => { console.error(e); process.exit(1); });
