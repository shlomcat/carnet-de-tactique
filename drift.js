/* Carnet de tactique — dérives lentes.
 * Une dérive est une suite de coups sans gaffe ni erreur (chaque coup perd moins de 1,5 pion)
 * pendant laquelle l'évaluation glisse nettement. On regarde alors où tu jouais (aile dame,
 * centre, aile roi), où le moteur voulait jouer, ce que prévoit le plan de la structure,
 * et ce qui a changé dans la position entre le début et la fin de la dérive.
 * Nécessite Chess (chess.js), Strat (strategy.js) et, si disponible, Struct (structures.js).
 */
(function (root) {
  "use strict";
  var WING = { q: "à l'aile dame", c: "au centre", k: "à l'aile roi" };
  var WING_SHORT = { q: "aile dame", c: "centre", k: "aile roi" };
  function wingOf(sq) { var f = "abcdefgh".indexOf(sq[0]); return f <= 2 ? "q" : f <= 4 ? "c" : "k"; }
  function majority(list) {
    var c = { q: 0, c: 0, k: 0 }; list.forEach(function (w) { c[w]++; });
    var best = "c"; ["q", "k", "c"].forEach(function (w) { if (c[w] > c[best]) best = w; });
    return { w: best, n: c[best], counts: c };
  }
  function fmt(cp) { var v = (cp / 100).toFixed(1).replace(".", ","); return cp > 0 ? "+" + v : v; }

  // Recherche des segments : sous-suite contiguë de tes coups (sans faute) dont la perte cumulée est maximale.
  function find(g, opts) {
    opts = opts || {};
    var minSum = opts.minSum || 150, minLen = opts.minLen || 3, maxLen = opts.maxLen || 14, brk = opts.brk || 150;
    var ev = g.ev, mv = g.mv; if (!ev || !mv || ev.length < 10) return [];
    var first = g.c === "w" ? 0 : 1, own = [];
    for (var i = first; i < mv.length; i += 2) own.push(i);
    var out = [], k = 0;
    while (k < own.length) {
      // segment courant sans faute
      var seg = [];
      while (k < own.length) {
        var i2 = own[k], loss = ev[i2] - ev[i2 + 1];
        if (loss >= brk || ev[i2] < -250 || ev[i2] > 500) { k++; break; }
        if (i2 >= 14) seg.push({ ply: i2, loss: Math.max(-30, loss) });
        k++;
      }
      // meilleurs sous-segments (Kadane répété)
      var start = 0;
      while (start < seg.length) {
        var bestSum = 0, bestA = -1, bestB = -1, sum = 0, a = start;
        for (var j = start; j < seg.length; j++) {
          if (j - a >= maxLen) { sum -= seg[a].loss; a++; }
          sum += seg[j].loss;
          if (sum <= 0) { sum = 0; a = j + 1; continue; }
          if (sum > bestSum && j - a + 1 >= minLen) { bestSum = sum; bestA = a; bestB = j; }
        }
        if (bestA < 0 || bestSum < minSum) break;
        var p0 = seg[bestA].ply, p1 = seg[bestB].ply + 1;
        if (ev[p0] - ev[p1] >= 120) out.push({ from: p0, to: p1, cost: ev[p0] - ev[p1], e0: ev[p0], e1: ev[p1], own: seg.slice(bestA, bestB + 1).map(function (x) { return x.ply; }) });
        start = bestB + 1;
      }
    }
    return out;
  }

  function evolution(Strat, fen0, fen1, me) {
    var o = me === "w" ? "b" : "w", A = Strat.features(fen0), B = Strat.features(fen1), r = [];
    var a = A[me], ao = A[o], b = B[me], bo = B[o];
    function add(k, w, t) { r.push({ k: k, w: w, txt: t }); }
    var newOut = bo.outposts.filter(function (x) { return !ao.outposts.some(function (y) { return y.sq === x.sq; }); });
    if (newOut.length) add("avantposte", 5, "l'adversaire a installé un " + (newOut[0].t === "n" ? "cavalier" : "fou") + " sur l'avant-poste " + Strat.sqName(newOut[0].sq));
    if (bo.passed.length > ao.passed.length) add("passe", 5, "l'adversaire a obtenu un pion passé");
    if (a.shield - b.shield >= 1 && bo.mat > 12) add("roi", 5, "la protection de ton roi s'est affaiblie");
    if (b.kingAttackers - a.kingAttackers >= 2) add("roi", 4, "les pièces adverses se sont rapprochées de ton roi (" + b.kingAttackers + " contre " + a.kingAttackers + ")");
    var w0 = a.isolated.length + a.backward.length, w1 = b.isolated.length + b.backward.length;
    if (w1 > w0) add("structure", 4, "ta structure a pris " + (w1 - w0) + " faiblesse" + (w1 - w0 > 1 ? "s" : "") + " de pions (isolé ou arriéré)");
    var of0 = ao.rooksOpen.filter(function (x) { return x.t === "r" && x.open; }).length, of1 = bo.rooksOpen.filter(function (x) { return x.t === "r" && x.open; }).length;
    var mf0 = a.rooksOpen.filter(function (x) { return x.t === "r" && x.open; }).length, mf1 = b.rooksOpen.filter(function (x) { return x.t === "r" && x.open; }).length;
    if (of1 - mf1 > of0 - mf0) add("colonne", 3, "l'adversaire a pris le contrôle des colonnes ouvertes");
    var matSame = Math.abs((a.mat - ao.mat) - (b.mat - bo.mat)) < 2;
    if (matSame) {
      var m0 = a.mob - ao.mob, m1 = b.mob - bo.mob;
      if (m0 - m1 >= 8) add("activite", 4, "l'activité de tes pièces a baissé (différence de mobilité de " + (m0 > 0 ? "+" : "") + m0 + " à " + (m1 > 0 ? "+" : "") + m1 + " cases)");
      var s0 = a.space - ao.space, s1 = b.space - bo.space;
      if (s0 - s1 >= 4) add("espace", 2, "tu as cédé de l'espace");
    }
    r.sort(function (x, y) { return y.w - x.w; });
    return r.slice(0, 3);
  }

  function describe(Chess, Strat, Struct, g, d) {
    var ch = new Chess(), fens = [ch.fen()], sans = [];
    for (var i = 0; i < d.to && i < g.mv.length; i++) {
      var u = g.mv[i], m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
      if (!m) break; sans.push(m.san); fens.push(ch.fen());
    }
    var mine = [], best = [], kinds = { pawn: 0, retreat: 0, capture: 0, king: 0 };
    d.own.forEach(function (p) {
      var u = g.mv[p], b = g.bm && g.bm[p];
      if (!u) return;
      mine.push(wingOf(u.slice(2, 4)));
      if (b) best.push(wingOf(b.slice(2, 4)));
      var san = sans[p] || "", fr = +u[1], to = +u[3];
      if (/^[a-h]/.test(san)) kinds.pawn++;
      if (san.indexOf("x") >= 0) kinds.capture++;
      if (san[0] === "K") kinds.king++;
      if (!/^[a-h]/.test(san) && (g.c === "w" ? to < fr : to > fr)) kinds.retreat++;
    });
    var n = d.own.length, M = majority(mine), B = majority(best);
    // le plan de la structure ne s'applique que si la structure est bien en place au début de la dérive
    var plan = null;
    if (Struct && g.st) { var cs = Struct.classify(fens[d.from]); if (cs && cs.id === g.st) plan = Struct.planFor(g.st, Struct.sideOf(cs, g.c)); }
    var lines = [], tags = [];
    var n0 = Math.floor(d.from / 2) + 1, n1 = Math.floor((d.to - 1) / 2) + 1;
    var head = "Du coup " + n0 + " au coup " + n1 + ", sans gaffe ni erreur, ta position est passée de " + fmt(d.e0) + " à " + fmt(d.e1) + ", soit environ " + fmt(-d.cost).replace("-", "") + " pion" + (d.cost >= 200 ? "s" : "") + " perdu" + (d.cost >= 200 ? "s" : "") + " en " + n + " coups.";
    if (best.length >= 3 && B.n / best.length >= 0.5 && M.w !== B.w) {
      lines.push("Tu as surtout joué " + WING[M.w] + " (" + M.n + " coups sur " + n + "), alors que le moteur voulait jouer " + WING[B.w] + " (" + B.n + " sur " + best.length + ").");
      tags.push("aile");
    } else if (best.length >= 3 && M.w === B.w) {
      lines.push("Tu jouais sur la bonne aile (" + WING_SHORT[M.w] + ") : le problème est dans le choix des coups, pas dans la direction.");
    }
    if (plan && plan.wing) {
      if (M.w === plan.wing) lines.push("Dans cette structure (" + plan.name + "), tu jouais bien " + WING[plan.wing] + ", là où se joue ton plan typique.");
      else if (B.w === plan.wing && best.length >= 3) { lines.push("Dans cette structure (" + plan.name + "), ton plan typique se joue " + WING[plan.wing] + ", et le moteur confirme : tu t'es écarté du plan. Rappel : " + plan.plan); tags.push("plan"); }
    }
    if (kinds.retreat / n >= 0.4) { lines.push("Beaucoup de coups de repli ou d'attente (" + kinds.retreat + " sur " + n + ") : ton jeu est devenu passif."); tags.push("passif"); }
    if (kinds.pawn / n >= 0.5) { lines.push("Beaucoup de coups de pions (" + kinds.pawn + " sur " + n + ") : chacun crée des cases faibles qu'on ne récupère plus."); tags.push("pions"); }
    if (kinds.capture / n >= 0.5) { lines.push("Beaucoup d'échanges (" + kinds.capture + " sur " + n + ") : simplifier a soulagé l'adversaire."); tags.push("echanges"); }
    var evo = Strat ? evolution(Strat, fens[d.from], fens[Math.min(d.to, fens.length - 1)], g.c) : [];
    if (evo.length) lines.push("Entre le début et la fin : " + evo.map(function (x) { return x.txt; }).join(" ; ") + ".");
    evo.forEach(function (x) { tags.push(x.k); });
    if (!lines.length || (lines.length === 1 && /bonne aile/.test(lines[0]))) lines.push("Pas de cause positionnelle simple : c'est une accumulation de petits choix concrets. Rejoue la séquence en cherchant, à chaque coup, ce que voulait l'adversaire.");
    return { head: head, lines: lines, tags: tags, fen: fens[d.from], played: sans[d.from], best: g.bm && g.bm[d.from], moves: d.own.map(function (p) { return sans[p]; }), n0: n0, n1: n1, wingMine: M.w, wingBest: B.w, wingPlan: plan && plan.wing };
  }

  var TAGS = { aile: "Mauvaise aile par rapport au moteur", plan: "Plan de la structure non suivi", passif: "Jeu passif (replis, attente)", pions: "Trop de coups de pions",
    echanges: "Échanges qui soulagent l'adversaire", avantposte: "Avant-poste cédé", passe: "Pion passé cédé", roi: "Roi exposé petit à petit", structure: "Faiblesses de pions",
    colonne: "Colonnes ouvertes cédées", activite: "Pièces devenues passives", espace: "Espace cédé" };

  root.Drift = { find: find, describe: describe, TAGS: TAGS, WING: WING, wingOf: wingOf };
})(typeof window !== "undefined" ? window : module.exports);
