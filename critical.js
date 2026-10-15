/* Carnet de tactique — moments critiques.
 * Un moment critique est une position où un seul coup garde l'évaluation : l'écart entre le meilleur
 * et le deuxième meilleur coup du moteur dépasse 1,5 pion, sans être évident (reprise forcée, très peu de coups légaux). On mesure le temps que tu y as passé
 * (grâce à la pendule enregistrée par Chess.com) et ce que tu y as joué.
 * Nécessite Chess (chess.js) et Strat (strategy.js). Les parties doivent contenir g.gap (analyse « moments critiques »).
 */
(function (root) {
  "use strict";
  var CRIT = 150, CALM = 30, FAULT = 150;
  var KIND = { danger: "Danger à parer", occasion: "Occasion à saisir", subtil: "Coup unique discret" };
  var KIND_DESC = {
    danger: "ton roi est en échec ou une de tes pièces est menacée",
    occasion: "le bon coup est une prise ou un échec",
    subtil: "rien ne signale le danger : le bon coup est un coup calme"
  };

  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function rate(f, n) { return n ? Math.round(100 * f / n) : null; }
  function bucket(t) { return t < 5 ? 0 : t < 15 ? 1 : 2; }
  var BUCKETS = ["moins de 5 s", "5 à 15 s", "plus de 15 s"];

  function moves(Chess, Strat, g) {
    if (!g.gap || !g.mv || !g.ev || !g.ck) return [];
    var ch = new Chess(), out = [], first = g.c === "w" ? 0 : 1, lastCap = null;
    for (var i = 0; i < g.mv.length; i++) {
      var fen = ch.fen(), u = g.mv[i], mine = (i % 2) === first;
      if (mine && i >= 10 && g.gap[i] != null && i >= 2 && g.ck[i] != null && g.ck[i - 2] != null) {
        var spent = Math.max(0, g.ck[i - 2] - g.ck[i] + (g.inc || 0));
        var loss = g.ev[i] - g.ev[i + 1], ev0 = g.ev[i], gap = g.gap[i];
        var playable = ev0 > -300 && ev0 < 600;
        var item = { g: g, ply: i, n: (i >> 1) + 1, fen: fen, gap: gap, loss: loss, ev: ev0, t: spent, clock: g.ck[i], fault: loss >= FAULT,
          crit: playable && gap >= CRIT, calm: playable && gap <= CALM, bu: g.bm[i], pu: u };
        // coups uniques évidents : peu de coups légaux, ou reprise de la pièce qui vient d'être prise
        if (item.crit) {
          var nLegal = ch.moves().length;
          item.obvious = nLegal <= 3 || (lastCap && item.bu && item.bu.slice(2, 4) === lastCap);
          if (item.obvious) item.crit = false;
        }
        if (item.crit || item.calm) {
          var t1 = new Chess(fen), bm = item.bu && t1.move({ from: item.bu.slice(0, 2), to: item.bu.slice(2, 4), promotion: item.bu[4] || "q" });
          item.b = bm ? bm.san : null;
          var thr = Strat.threats(fen, g.c).filter(function (x) { return x.t !== "p"; });
          item.kind = ch.in_check() || thr.length ? "danger" : (bm && /[x+#]/.test(bm.san)) ? "occasion" : "subtil";
        }
        out.push(item);
      }
      var m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
      if (!m) break;
      lastCap = m.captured ? m.to : null;
      if (out.length && out[out.length - 1].ply === i) out[out.length - 1].p = m.san;
    }
    return out;
  }

  function analyze(Chess, Strat, games) {
    var all = [];
    games.forEach(function (g) { all = all.concat(moves(Chess, Strat, g)); });
    if (!all.length) return { available: false };
    var med = median(all.map(function (x) { return x.t; })) || 1;
    var slowT = Math.max(1.5 * med, med + 3);
    all.forEach(function (x) { x.slow = x.t >= slowT; });
    var crit = all.filter(function (x) { return x.crit; }), other = all.filter(function (x) { return !x.crit; });
    var cf = crit.filter(function (x) { return x.fault; }).length, of = other.filter(function (x) { return x.fault; }).length;
    var byB = [0, 1, 2].map(function (b) { var c = crit.filter(function (x) { return bucket(x.t) === b; }); return { label: BUCKETS[b], n: c.length, f: c.filter(function (x) { return x.fault; }).length }; });
    var byK = Object.keys(KIND).map(function (k) {
      var c = crit.filter(function (x) { return x.kind === k; });
      return { k: k, label: KIND[k], desc: KIND_DESC[k], n: c.length, slow: c.filter(function (x) { return x.slow; }).length, f: c.filter(function (x) { return x.fault; }).length };
    });
    var critSlow = crit.filter(function (x) { return x.slow; }).length;
    var gaffes = all.filter(function (x) { return x.loss >= 300; });
    var clockAtGaffe = median(gaffes.map(function (x) { return x.clock; }));
    var stats = { med: med, slowT: slowT, n: all.length, nCrit: crit.length, critFault: rate(cf, crit.length), otherFault: rate(of, other.length),
      critSlow: rate(critSlow, crit.length), allSlow: rate(all.filter(function (x) { return x.slow; }).length, all.length),
      critMedT: median(crit.map(function (x) { return x.t; })), byB: byB, byK: byK, clockAtGaffe: clockAtGaffe, nGaffes: gaffes.length,
      critShareOfFaults: rate(cf, cf + of) };

    var ins = [];
    if (crit.length >= 10) {
      ins.push("Tu fais une faute dans " + stats.critFault + " % des moments critiques, contre " + stats.otherFault + " % sur les autres coups. Ces moments ne représentent que " + rate(crit.length, all.length) + " % de tes coups, mais " + stats.critShareOfFaults + " % de tes fautes.");
      var fast = byB[0], slow = byB[2];
      var mid = byB[1];
      if (fast.n >= 8 && slow.n < 8 && mid.n >= 8) ins.push("Dans un moment critique joué en moins de 5 s, tu te trompes " + rate(fast.f, fast.n) + " % du temps ; entre 5 et 15 s, " + rate(mid.f, mid.n) + " %.");
      if (fast.n >= 8 && slow.n >= 8) ins.push("Dans un moment critique joué en moins de 5 s, tu te trompes " + rate(fast.f, fast.n) + " % du temps ; au-delà de 15 s, " + rate(slow.f, slow.n) + " %.");
      ins.push("Tu ralentis (au moins " + Math.round(slowT) + " s, soit nettement plus que ton rythme habituel de " + Math.round(med) + " s) sur " + stats.critSlow + " % des moments critiques" + (stats.critSlow - stats.allSlow >= 10 ? ", contre " + stats.allSlow + " % des coups en général : tu sens souvent le danger." : stats.critSlow - stats.allSlow >= 0 ? ", à peine plus que sur un coup ordinaire (" + stats.allSlow + " %) : l'alerte ne se déclenche pas assez." : "."));
      var ks = byK.filter(function (k) { return k.n >= 4; }).map(function (k) { return { k: k, s: rate(k.slow, k.n), f: rate(k.f, k.n) }; });
      if (ks.length >= 2) {
        ks.sort(function (a, b) { return a.s - b.s; });
        var lo = ks[0], hi = ks[ks.length - 1];
        if (hi.s - lo.s >= 15) ins.push("Tu ralentis bien face à « " + hi.k.label.toLowerCase() + " » (" + hi.s + " % des cas), beaucoup moins face à « " + lo.k.label.toLowerCase() + " » (" + lo.s + " %), où " + lo.k.desc + ". C'est là que l'alerte manque.");
      }
      if (clockAtGaffe != null && gaffes.length >= 5) ins.push("Au moment de tes gaffes, il te restait typiquement environ " + fmtClock(clockAtGaffe) + " à la pendule : " + (clockAtGaffe >= 30 ? "le temps n'était pas le problème, c'est le signal d'alerte qui manquait." : "le manque de temps pèse vraiment."));
    }
    return { available: true, all: all, crit: crit, calm: all.filter(function (x) { return x.calm; }), stats: stats, insights: ins };
  }
  function fmtClock(s) { s = Math.round(s); var m = Math.floor(s / 60), r = s % 60; return (m ? m + " min " : "") + (r < 10 && m ? "0" : "") + r + " s"; }

  root.Crit = { analyze: analyze, moves: moves, KIND: KIND, KIND_DESC: KIND_DESC, CRIT: CRIT, BUCKETS: BUCKETS, fmtClock: fmtClock };
})(typeof window !== "undefined" ? window : module.exports);
