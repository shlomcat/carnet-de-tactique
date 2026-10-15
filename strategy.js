/* Carnet de tactique — lecture stratégique d'une position.
 * Extrait des caractéristiques statiques (structure de pions, avant-postes, sécurité du roi,
 * colonnes, activité, espace, développement) et compare la position obtenue après le coup joué
 * avec celle obtenue après le meilleur coup du moteur. Aucune IA : tout est calculé et vérifiable.
 */
(function (root) {
  "use strict";
  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  var NAME = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" };
  var FILES = "abcdefgh";
  var KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function sqName(s) { return FILES[s & 7] + ((s >> 3) + 1); }
  function opp(c) { return c === "w" ? "b" : "w"; }
  function rr(c, s) { return c === "w" ? s >> 3 : 7 - (s >> 3); }

  function parse(fen) {
    var pos = fen.split(" ")[0], B = new Array(64).fill(null), r = 7, f = 0;
    for (var i = 0; i < pos.length; i++) {
      var ch = pos[i];
      if (ch === "/") { r--; f = 0; continue; }
      if (ch >= "1" && ch <= "8") { f += +ch; continue; }
      B[r * 8 + f] = { c: ch === ch.toUpperCase() ? "w" : "b", t: ch.toLowerCase() };
      f++;
    }
    return B;
  }
  function attacks(B, s) {
    var p = B[s], f = s & 7, r = s >> 3, out = [];
    function add(df, dr) { var nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf); }
    if (p.t === "p") { var d = p.c === "w" ? 1 : -1; add(-1, d); add(1, d); }
    else if (p.t === "n") KN.forEach(function (o) { add(o[0], o[1]); });
    else if (p.t === "k") KG.forEach(function (o) { add(o[0], o[1]); });
    else {
      var dirs = p.t === "b" ? DIAG : p.t === "r" ? ORTH : DIAG.concat(ORTH);
      dirs.forEach(function (o) {
        var nf = f + o[0], nr = r + o[1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { var t = nr * 8 + nf; out.push(t); if (B[t]) break; nf += o[0]; nr += o[1]; }
      });
    }
    return out;
  }

  function features(fen) {
    var B = parse(fen);
    var att = { w: new Array(64).fill(0), b: new Array(64).fill(0) };
    var patt = { w: new Array(64).fill(0), b: new Array(64).fill(0) };
    var targets = new Array(64).fill(null);
    for (var s = 0; s < 64; s++) if (B[s]) {
      var a = attacks(B, s); targets[s] = a;
      a.forEach(function (t) { att[B[s].c][t]++; if (B[s].t === "p") patt[B[s].c][t]++; });
    }
    var ctx = { B: B, att: att, patt: patt, targets: targets };
    return { w: side(ctx, "w"), b: side(ctx, "b"), B: B };
  }

  function side(ctx, c) {
    var B = ctx.B, o = opp(c), d = c === "w" ? 1 : -1;
    var own = [], en = [], fc = [0, 0, 0, 0, 0, 0, 0, 0], efc = [0, 0, 0, 0, 0, 0, 0, 0];
    var F = { mat: 0, bishops: [], isolated: [], doubled: [], backward: [], passed: [], outposts: [], rooksOpen: [], badBishops: [],
      mob: 0, space: 0, center: 0, undeveloped: 0, castled: false, kingCenter: false, shield: 0, openNearKing: 0, kingAttackers: 0, islands: 0, ks: -1, queens: 0 };
    for (var s = 0; s < 64; s++) {
      var p = B[s]; if (!p) continue;
      if (p.t === "p") { if (p.c === c) { own.push(s); fc[s & 7]++; } else { en.push(s); efc[s & 7]++; } }
      if (p.c !== c) { if (p.t === "q") F.queens++; continue; }
      F.mat += VAL[p.t];
      if (p.t === "b") F.bishops.push(s);
      if (p.t === "k") F.ks = s;
      if (p.t === "q") F.queens++;
    }
    // un pion propre peut-il un jour attaquer la case s ? (pion sur colonne adjacente, derrière ou juste devant)
    function canEverAttack(col, sq) {
      var f = sq & 7;
      for (var i = 0; i < 64; i++) {
        var p = B[i]; if (!p || p.t !== "p" || p.c !== col) continue;
        if (Math.abs((i & 7) - f) === 1 && rr(col, i) <= rr(col, sq) - 1) return true;
      }
      return false;
    }
    own.forEach(function (s) {
      var f = s & 7, r = rr(c, s);
      var isoL = f === 0 || fc[f - 1] === 0, isoR = f === 7 || fc[f + 1] === 0;
      var isolated = isoL && isoR;
      if (isolated) F.isolated.push(s);
      var passed = !en.some(function (e) { return Math.abs((e & 7) - f) <= 1 && rr(c, e) > r; });
      if (passed) F.passed.push(s);
      if (!isolated && !passed) {
        var supported = own.some(function (x) { return Math.abs((x & 7) - f) === 1 && rr(c, x) <= r; });
        var stop = s + 8 * d;
        if (!supported && stop >= 0 && stop < 64 && ctx.patt[o][stop] > 0) F.backward.push(s);
      }
    });
    for (var f = 0; f < 8; f++) if (fc[f] > 1) F.doubled.push(FILES[f]);
    var inIsland = false;
    for (f = 0; f < 8; f++) { if (fc[f] && !inIsland) F.islands++; inIsland = fc[f] > 0; }
    // avant-postes occupés : case du camp adverse soutenue par un pion, jamais attaquable par un pion adverse
    for (s = 0; s < 64; s++) {
      var p2 = B[s]; if (!p2 || p2.c !== c || (p2.t !== "n" && p2.t !== "b")) continue;
      var r2 = rr(c, s), f2 = s & 7;
      if (r2 >= 3 && r2 <= 5 && f2 >= 1 && f2 <= 6 && ctx.patt[c][s] > 0 && !canEverAttack(o, s)) F.outposts.push({ sq: s, t: p2.t });
    }
    // tours et dames sur colonnes ouvertes ou semi-ouvertes
    for (s = 0; s < 64; s++) {
      var p3 = B[s]; if (!p3 || p3.c !== c || (p3.t !== "r" && p3.t !== "q")) continue;
      var ff = s & 7;
      if (fc[ff] === 0) F.rooksOpen.push({ sq: s, t: p3.t, file: FILES[ff], open: efc[ff] === 0 });
    }
    // fou mauvais : beaucoup de pions propres sur sa couleur, dont des pions centraux bloqués
    F.bishops.forEach(function (bs) {
      var col = ((bs & 7) + (bs >> 3)) % 2, same = 0, blocked = 0;
      own.forEach(function (x) {
        if (((x & 7) + (x >> 3)) % 2 !== col) return; same++;
        var fr = x + 8 * d; if ((x & 7) >= 2 && (x & 7) <= 5 && fr >= 0 && fr < 64 && B[fr]) blocked++;
      });
      if (same >= 4 && blocked >= 1) F.badBishops.push({ sq: bs, color: col === 1 ? "claires" : "foncées", same: same });
    });
    // mobilité sûre des pièces (cases non tenues par un pion adverse)
    for (s = 0; s < 64; s++) {
      var p4 = B[s]; if (!p4 || p4.c !== c || "nbrq".indexOf(p4.t) < 0) continue;
      ctx.targets[s].forEach(function (t) { if ((!B[t] || B[t].c !== c) && ctx.patt[o][t] === 0) F.mob++; });
    }
    // espace : cases centrales de son camp non contrôlées par les pions adverses, bonus derrière ses pions
    for (s = 0; s < 64; s++) {
      var fx = s & 7, rx = rr(c, s);
      if (fx < 2 || fx > 5 || rx < 1 || rx > 3) continue;
      if (B[s] && B[s].c === c && B[s].t === "p") continue;
      if (ctx.patt[o][s] > 0) continue;
      F.space++;
      if (own.some(function (x) { return (x & 7) === fx && rr(c, x) > rx; })) F.space++;
    }
    [27, 28, 35, 36].forEach(function (s) { F.center += ctx.att[c][s]; if (B[s] && B[s].c === c && B[s].t === "p") F.center += 2; });
    var home = c === "w" ? [1, 6, 2, 5] : [57, 62, 58, 61];
    home.forEach(function (s, i) { var p5 = B[s]; if (p5 && p5.c === c && p5.t === (i < 2 ? "n" : "b")) F.undeveloped++; });
    if (F.ks >= 0) {
      var kf = F.ks & 7, kr = rr(c, F.ks);
      F.castled = kr === 0 && (kf <= 2 || kf >= 6);
      F.kingCenter = kr <= 1 && kf >= 3 && kf <= 4;
      var zone = {};
      zone[F.ks] = 1; ctx.targets[F.ks].forEach(function (t) { zone[t] = 1; });
      for (var df = -1; df <= 1; df++) {
        var nf = kf + df; if (nf < 0 || nf > 7) continue;
        var front = own.filter(function (x) { return (x & 7) === nf && rr(c, x) > kr && rr(c, x) <= kr + 2; });
        if (front.length) F.shield++;
        if (fc[nf] === 0) F.openNearKing++;
        var z2 = F.ks + 16 * d + df; if (z2 >= 0 && z2 < 64) zone[z2] = 1;
      }
      for (s = 0; s < 64; s++) {
        var p6 = B[s]; if (!p6 || p6.c !== o || p6.t === "p" || p6.t === "k") continue;
        if (ctx.targets[s].some(function (t) { return zone[t]; })) F.kingAttackers++;
      }
    }
    return F;
  }

  function play(Chess, fen, line, maxPlies) {
    var ch = new Chess(fen), n = 0;
    for (var i = 0; i < line.length && n < maxPlies; i++) {
      var u = line[i], m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
      if (!m) break; n++;
      // on prolonge tant que des échanges sont en cours, pour ne pas photographier une position au milieu d'une prise
      if (n === maxPlies && m.captured && maxPlies < line.length) maxPlies++;
    }
    return { fen: ch.fen(), plies: n };
  }

  function piece(t) { return NAME[t]; }
  function list(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1]; }
  function minus(a, b, key) { var kb = b.map(key); return a.filter(function (x) { return kb.indexOf(key(x)) < 0; }); }

  /* fault = { fen, pu (coup joué), rv (suite du moteur après le coup joué), pvu (meilleure suite), l (perte en centipions), ph } */
  function compare(Chess, fault, opts) {
    opts = opts || {};
    var me = fault.fen.split(" ")[1], o = opp(me), plies = opts.plies || 4;
    var lineA = [fault.pu].concat(fault.rv || []), lineB = fault.pvu || [fault.bu];
    var pA = play(Chess, fault.fen, lineA, plies), pB = play(Chess, fault.fen, lineB, plies);
    var FA = features(pA.fen), FB = features(pB.fen);
    var A = FA[me], Ao = FA[o], Bm = FB[me], Bo = FB[o];
    // le matériel se juge plus loin : au bout de la suite complète, échanges terminés
    var LA = features(play(Chess, fault.fen, lineA, 9).fen), LB = features(play(Chess, fault.fen, lineB, 9).fen);
    var out = [];
    function add(k, w, txt) { out.push({ k: k, w: w, txt: txt }); }

    var dmat = (LA[me].mat - LA[o].mat) - (LB[me].mat - LB[o].mat);
    var mate = fault.l >= 1400;
    if (mate) add("mat", 10, "Le meilleur coup menait au mat (ou l'évitait) : c'est un calcul concret, pas une question de plan.");
    else if (dmat <= -2) add("materiel", 9, "Perte de matériel : environ " + (-dmat) + " point" + (dmat <= -2 ? "s" : "") + " de moins qu'avec le meilleur coup, au bout de quelques coups.");
    else if (dmat >= 2) add("gourmandise", 6, fault.p.indexOf("x") >= 0
      ? "Ta prise gagne du matériel, mais l'adversaire obtient plus que ce qu'il a perdu : elle était empoisonnée."
      : "Le meilleur coup sacrifiait du matériel pour obtenir davantage (initiative, attaque) : tu as préféré garder le matériel.");

    // roi
    if (Bm.shield - A.shield >= 1 && (Ao.mat > 12) && (A.kingAttackers >= 2 || A.openNearKing > Bm.openNearKing))
      add("roi", 7, "Ton roque s'affaiblit : " + A.shield + " colonne" + (A.shield > 1 ? "s" : "") + " protégée" + (A.shield > 1 ? "s" : "") + " par un pion devant ton roi, contre " + Bm.shield + " avec le meilleur coup.");
    if (A.kingAttackers - Bm.kingAttackers >= 2)
      add("roi", 6, "Ton roi passe sous le feu : " + A.kingAttackers + " pièces adverses visent sa zone, contre " + Bm.kingAttackers + " avec le meilleur coup.");
    if (A.kingCenter && !Bm.kingCenter && Ao.queens > 0 && fault.ph !== "f")
      add("roi", 5, "Ton roi reste au centre alors que les dames sont encore là.");
    if (Bo.kingAttackers - Ao.kingAttackers >= 2)
      add("attaque", 6, "Le meilleur coup lançait l'attaque : " + Bo.kingAttackers + " de tes pièces visaient le roi adverse, contre " + Ao.kingAttackers + " après ton coup.");
    else if (Ao.shield - Bo.shield >= 1 && Bo.kingAttackers >= 2)
      add("attaque", 5, "Le meilleur coup ouvrait le roque adverse.");

    // avant-postes
    minus(Ao.outposts, Bo.outposts, function (x) { return x.sq; }).slice(0, 1).forEach(function (x) {
      add("avantposte", 6, "Le " + piece(x.t) + " adverse s'installe sur l'avant-poste " + sqName(x.sq) + ", d'où aucun de tes pions ne pourra le chasser.");
    });
    minus(Bm.outposts, A.outposts, function (x) { return x.sq; }).slice(0, 1).forEach(function (x) {
      add("avantposte", 5, "Le meilleur coup installait ton " + piece(x.t) + " sur l'avant-poste " + sqName(x.sq) + ", inexpugnable.");
    });

    // structure de pions
    var key = function (s) { return s; };
    var newIso = A.isolated.length > Bm.isolated.length ? minus(A.isolated, Bm.isolated, key).slice(0, 1) : [];
    var newBack = A.backward.length > Bm.backward.length ? minus(A.backward, Bm.backward, key).slice(0, 1) : [];
    var newDbl = A.doubled.filter(function (f) { return Bm.doubled.indexOf(f) < 0; });
    if (newIso.length) add("structure", 5, "Ton coup te laisse un pion isolé en " + list(newIso.map(sqName)) + ".");
    if (newBack.length) add("structure", 5, "Ton coup crée un pion arriéré en " + list(newBack.map(sqName)) + ", une cible durable.");
    if (newDbl.length) add("structure", 3, "Tes pions se retrouvent doublés en colonne " + list(newDbl) + ".");
    if (A.islands - Bm.islands >= 1) add("structure", 2, "Ta structure se fragmente : " + A.islands + " îlots de pions contre " + Bm.islands + ".");
    var weakOpp = (Bo.isolated.length + Bo.backward.length) > (Ao.isolated.length + Ao.backward.length) ? minus(Bo.isolated.concat(Bo.backward), Ao.isolated.concat(Ao.backward), key) : [];
    if (weakOpp.length) add("structure", 4, "Le meilleur coup créait une faiblesse chez l'adversaire : pion " + (Bo.isolated.indexOf(weakOpp[0]) >= 0 ? "isolé" : "arriéré") + " en " + sqName(weakOpp[0]) + ".");

    // pions passés
    var oppPassed = Ao.passed.length > Bo.passed.length ? minus(Ao.passed, Bo.passed, key).slice(0, 1) : [];
    if (oppPassed.length) {
      var adv = oppPassed.some(function (s) { return rr(o, s) >= 4; });
      add("passe", adv ? 7 : 5, "L'adversaire obtient un pion passé en " + list(oppPassed.map(sqName)) + (adv ? ", déjà avancé." : "."));
    }
    var myPassed = Bm.passed.length > A.passed.length ? minus(Bm.passed, A.passed, key).slice(0, 1) : [];
    if (myPassed.length) add("passe", 5, "Le meilleur coup te donnait un pion passé en " + list(myPassed.map(sqName)) + ".");

    // colonnes
    var rk = function (a) { return a.filter(function (x) { return x.t === "r" && x.open; }); };
    var oppFiles = rk(Ao.rooksOpen).length > rk(Bo.rooksOpen).length ? minus(rk(Ao.rooksOpen), rk(Bo.rooksOpen), function (x) { return x.file; }) : [];
    if (oppFiles.length) add("colonne", 3, "L'adversaire prend la colonne " + oppFiles[0].file + (oppFiles[0].open ? " ouverte" : " semi-ouverte") + " avec sa " + piece(oppFiles[0].t) + ".");
    var myFiles = rk(Bm.rooksOpen).length > rk(A.rooksOpen).length ? minus(rk(Bm.rooksOpen), rk(A.rooksOpen), function (x) { return x.file; }) : [];
    if (myFiles.length) add("colonne", 3, "Le meilleur coup te donnait la colonne " + myFiles[0].file + (myFiles[0].open ? " ouverte." : " semi-ouverte."));

    // fous
    if (Bm.bishops.length >= 2 && A.bishops.length < 2 && Math.abs(dmat) < 2 && Math.abs((A.mat - Ao.mat) - (Bm.mat - Bo.mat)) < 2) add("fous", 3, "Tu cèdes la paire de fous.");
    var bad = minus(A.badBishops, Bm.badBishops, function (x) { return x.color; });
    if (bad.length) add("fous", 3, "Ton fou de cases " + bad[0].color + " devient mauvais : " + bad[0].same + " de tes pions sont sur sa couleur.");

    // activité, espace, centre : seulement à matériel comparable, sinon la comparaison n'a pas de sens
    var dShort = (A.mat - Ao.mat) - (Bm.mat - Bo.mat);
    if (Math.abs(dShort) < 2) {
    var mobA = A.mob - Ao.mob, mobB = Bm.mob - Bo.mob;
    if (mobB - mobA >= 8) add("activite", 3, "Tes pièces deviennent passives : la différence de mobilité passe de " + sign(mobB) + " à " + sign(mobA) + " cases.");
    var spA = A.space - Ao.space, spB = Bm.space - Bo.space;
    if (spB - spA >= 4) add("espace", 2, "Tu cèdes de l'espace à l'adversaire.");
    var ceA = A.center - Ao.center, ceB = Bm.center - Bo.center;
    if (ceB - ceA >= 3) add("centre", 2, "Tu relâches ton contrôle du centre (d4, e4, d5, e5).");
    }
    if (fault.ph === "o") {
      if (A.undeveloped - Bm.undeveloped >= 1) add("developpement", 3, "Retard de développement : " + A.undeveloped + " pièce" + (A.undeveloped > 1 ? "s" : "") + " mineure" + (A.undeveloped > 1 ? "s" : "") + " encore sur leur case de départ.");
      if (Bm.castled && !A.castled) add("developpement", 3, "Le meilleur coup permettait de mettre ton roi à l'abri par le roque.");
    }

    out.sort(function (a, b) { return b.w - a.w; });
    var tactical = mate || dmat <= -2;
    var strongPos = out.some(function (x) { return x.w >= 5 && x.k !== "materiel" && x.k !== "gourmandise"; });
    var somePos = out.some(function (x) { return x.w >= 3 && x.k !== "materiel" && x.k !== "gourmandise"; });
    var nature = tactical ? "tactique" : (fault.l >= 300 ? (strongPos ? "stratégique" : "concret") : (somePos ? "stratégique" : "concret"));
    return { nature: nature, findings: out.slice(0, 4), dmat: dmat, plies: [pA.plies, pB.plies] };
  }
  function sign(n) { return n > 0 ? "+" + n : String(n); }

  var THEMES = { mat: "Mat manqué ou subi", materiel: "Perte de matériel", gourmandise: "Prise empoisonnée", roi: "Sécurité de ton roi", attaque: "Attaque sur le roi adverse manquée",
    avantposte: "Avant-postes", structure: "Structure de pions", passe: "Pions passés", colonne: "Colonnes ouvertes", fous: "Fous (paire, mauvais fou)",
    activite: "Activité des pièces", espace: "Espace", centre: "Centre", developpement: "Développement et roque" };

  // pièces en danger pour le camp `me` : attaquées et non défendues, ou attaquées par une pièce de moindre valeur
  function threats(fen, me) {
    var B = parse(fen), o = opp(me), minAtt = { w: new Array(64).fill(99), b: new Array(64).fill(99) }, def = new Array(64).fill(0), out = [];
    for (var s = 0; s < 64; s++) if (B[s]) attacks(B, s).forEach(function (t) {
      var v = B[s].t === "k" ? 50 : VAL[B[s].t];
      if (v < minAtt[B[s].c][t]) minAtt[B[s].c][t] = v;
      if (B[s].c === me) def[t]++;
    });
    for (s = 0; s < 64; s++) {
      var p = B[s]; if (!p || p.c !== me || p.t === "k") continue;
      var a = minAtt[o][s]; if (a === 99) continue;
      if (def[s] === 0 || a < VAL[p.t]) out.push({ sq: sqName(s), t: p.t });
    }
    return out;
  }
  root.Strat = { features: features, compare: compare, threats: threats, THEMES: THEMES, sqName: sqName };
})(typeof window !== "undefined" ? window : module.exports);
