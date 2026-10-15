/* Carnet de tactique — explication d'un coup en français.
 * Tout est calculé à partir de la position et des suites de Stockfish : ce que fait le coup
 * (prise, échec, menace, parade, développement…), ce qu'il laisse en prise, et ce que donne la
 * suite du moteur en matériel. Nécessite Chess (chess.js) et Strat (strategy.js).
 */
(function (root) {
  "use strict";
  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  var ART = { p: "le pion", n: "le cavalier", b: "le fou", r: "la tour", q: "la dame", k: "le roi" };
  var NAME = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" };
  function opp(c) { return c === "w" ? "b" : "w"; }
  function mv(ch, u) { return u ? ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }) : null; }
  function art(t, sq) { return ART[t] + (sq ? " " + sq : ""); }
  function list(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1]; }
  function fmt(cp) { var v = (cp / 100).toFixed(1).replace(".", ","); return cp > 0 ? "+" + v : v; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function threatSet(Strat, fen, c) { return Strat.threats(fen, c).filter(function (x) { return x.t !== "p"; }); }
  function attacked(fen, sq) { // la case est-elle attaquée par le camp qui a le trait ?
    var c = new Chess0(fen); return c.moves({ verbose: true }).some(function (m) { return m.to === sq; });
  }
  var Chess0 = null;
  // le camp qui vient de jouer menace-t-il mat en un coup ? (on donne le trait à ce camp une seconde fois)
  function threatensMate(Chess, fen) {
    var c = new Chess(fen); if (c.in_check()) return null;
    var f = fen.split(" "); f[1] = f[1] === "w" ? "b" : "w"; f[3] = "-";
    var t = new Chess(); if (!t.load(f.join(" "))) return null;
    var ms = t.moves({ verbose: true });
    for (var i = 0; i < ms.length; i++) { var x = new Chess(t.fen()); x.move(ms[i]); if (x.in_checkmate()) return ms[i].san; }
    return null;
  }

  // Ce que fait un coup, en une proposition (sans majuscule ni point final).
  function describe(Chess, Strat, fen, uci, ctx) {
    Chess0 = Chess; ctx = ctx || {};
    var ch = new Chess(fen), me = ch.turn(), o = opp(me);
    var thrBefore = threatSet(Strat, fen, me), oppThrBefore = threatSet(Strat, fen, o);
    var m = mv(ch, uci); if (!m) return { text: "", tags: [] };
    var after = ch.fen(), parts = [], tags = [];
    if (m.flags.indexOf("k") >= 0 || m.flags.indexOf("q") >= 0) { parts.push("roque " + (m.flags.indexOf("k") >= 0 ? "côté roi" : "côté dame") + " : le roi se met à l'abri et la tour entre en jeu"); tags.push("roque"); }
    if (m.captured) {
      var recapt = attacked(after, m.to);
      if (ctx.lastCapSq === m.to) { parts.push("reprend " + art(m.captured, m.to)); tags.push("reprise"); }
      else if (!recapt && VAL[m.captured] >= 1) { parts.push("prend " + art(m.captured, m.to) + (ch.in_checkmate() ? "" : " sans contrepartie immédiate")); tags.push("gain"); }
      else if (VAL[m.captured] >= VAL[m.piece] && m.piece !== "k") { parts.push("prend " + art(m.captured, m.to) + (VAL[m.captured] > VAL[m.piece] ? " avec une pièce de moindre valeur" : " : c'est un échange")); tags.push("echange"); }
      else { parts.push("prend " + art(m.captured, m.to) + ", mais " + art(m.piece) + " peut être reprise" + " : l'échange est défavorable"); tags.push("prise"); ctx.skipTo = m.to; }
    }
    if (m.promotion) { parts.push("promeut en " + NAME[m.promotion]); tags.push("promotion"); }
    if (ch.in_checkmate()) { parts.push("fait échec et mat"); tags.push("mat"); }
    else if (ch.in_check()) { parts.push("donne échec"); tags.push("echec"); }
    // nouvelles menaces sur des pièces adverses
    var oppThrAfter = threatSet(Strat, after, o);
    var newT = oppThrAfter.filter(function (x) { return !oppThrBefore.some(function (y) { return y.sq === x.sq; }) && x.sq !== m.to; });
    if (newT.length >= 2 || (newT.length && ch.in_check())) { parts.push("attaque à la fois " + list(newT.slice(0, 2).map(function (x) { return art(x.t, x.sq); }).concat(ch.in_check() && newT.length < 2 ? ["le roi"] : [])) + " (fourchette ou double attaque)"); tags.push("double"); }
    else if (newT.length) { parts.push("menace " + art(newT[0].t, newT[0].sq)); tags.push("menace"); }
    if (!ch.in_check() && !ch.game_over()) { var tm = threatensMate(Chess, after); if (tm) { parts.push("menace mat (" + tm + ")"); tags.push("menace_mat"); } }
    // parade : une de tes pièces menacées ne l'est plus
    var thrAfter = threatSet(Strat, after, me);
    var saved = thrBefore.filter(function (x) { var sq = x.sq === m.from ? m.to : x.sq; return !thrAfter.some(function (y) { return y.sq === sq; }); });
    if (saved.length && !m.captured) { parts.push(saved[0].sq === m.from ? "met " + art(saved[0].t) + " à l'abri" : "protège " + art(saved[0].t, saved[0].sq)); tags.push("parade"); }
    // ce que le coup laisse en prise
    var hung = thrAfter.filter(function (x) { return !thrBefore.some(function (y) { return y.sq === x.sq; }) || x.sq === m.to; });
    hung = hung.filter(function (x) { return !(m.captured && x.sq === m.to && VAL[m.captured] >= VAL[x.t]) && x.sq !== ctx.skipTo; });
    if (hung.length && !ch.in_checkmate()) { ctx.hung = hung; tags.push("en_prise"); }
    if (!parts.length) {
      var ply = ctx.ply || 99, rankFrom = +m.from[1], back = me === "w" ? 1 : 8;
      if ((m.piece === "n" || m.piece === "b") && rankFrom === back && ply < 24) { parts.push("développe " + art(m.piece) + " en " + m.to); tags.push("developpement"); }
      else if (m.piece === "p" && "cdef".indexOf(m.to[0]) >= 0 && ply < 16) { parts.push("prend position au centre"); tags.push("centre"); }
      else if (m.piece === "p") {
        var F = Strat.features(after)[me];
        var isPassed = F.passed.some(function (s) { return Strat.sqName(s) === m.to; });
        parts.push(isPassed ? "pousse un pion passé" : "avance le pion en " + m.to); tags.push(isPassed ? "passe" : "pion");
      } else if (m.piece === "r") {
        var Fr = Strat.features(after)[me];
        var open = Fr.rooksOpen.some(function (x) { return x.file === m.to[0]; });
        parts.push(open ? "place la tour sur la colonne " + m.to[0] + (Fr.rooksOpen.filter(function (x) { return x.file === m.to[0]; })[0].open ? " ouverte" : " semi-ouverte") : "replace la tour en " + m.to); tags.push("tour");
      } else if (m.piece === "k") { parts.push(ply > 60 || Strat.features(after)[me].queens === 0 ? "active le roi" : "déplace le roi en " + m.to); tags.push("roi"); }
      else {
        var towards = me === "w" ? +m.to[1] > rankFrom : +m.to[1] < rankFrom;
        parts.push((towards ? "avance " : "replie ") + art(m.piece) + " en " + m.to); tags.push(towards ? "activation" : "repli");
      }
    }
    var text = parts.join(", ");
    if (ctx.hung && ctx.hung.length) {
      var h = ctx.hung[0];
      text += (text ? ", mais " : "") + "laisse " + art(h.t, h.sq === m.to ? m.to : h.sq) + " en prise";
    }
    return { text: text, tags: tags, san: m.san, piece: m.piece, captured: m.captured };
  }

  // Bilan matériel d'une suite de coups (uci), du point de vue du camp qui a le trait au départ.
  function outcome(Chess, fen, line, maxPlies) {
    var ch = new Chess(fen), me = ch.turn(), d = 0, sans = [], gotR = 0, gotMinor = 0, lostR = 0, lostMinor = 0, mate = false, oppRun = [], got = [], lost = [];
    for (var i = 0; i < line.length && i < (maxPlies || 8); i++) {
      var m = mv(ch, line[i]); if (!m) break; sans.push(m.san);
      if (m.piece === "p" && m.color !== me) { var rel = m.color === "w" ? +m.to[1] : 9 - +m.to[1]; if (rel >= 6) oppRun.push(m.san); }
      if (m.captured) {
        var v = VAL[m.captured] + (m.promotion ? VAL[m.promotion] - 1 : 0);
        if (m.color === me) { d += v; got.push(m.captured); if (m.captured === "r") gotR++; if ("nb".indexOf(m.captured) >= 0) gotMinor++; }
        else { d -= v; lost.push(m.captured); if (m.captured === "r") lostR++; if ("nb".indexOf(m.captured) >= 0) lostMinor++; }
      } else if (m.promotion) d += (m.color === me ? 1 : -1) * (VAL[m.promotion] - 1);
      if (ch.in_checkmate()) { mate = m.color === me ? 1 : -1; break; }
    }
    var exch = Math.abs(d) === 2 && ((gotR && lostMinor) || (lostR && gotMinor));
    return { d: d, sans: sans, mate: mate, what: exch ? "la qualité" : tradeText(got, lost, d), oppRun: oppRun };
  }
  // « le cavalier contre un pion », « deux pions », « la tour »… à partir des pièces prises de part et d'autre
  function tradeText(got, lost, d) {
    var g = got.slice(), l = lost.slice();
    for (var i = g.length - 1; i >= 0; i--) { var k = l.indexOf(g[i]); if (k >= 0) { l.splice(k, 1); g.splice(i, 1); } }
    function names(a) {
      var cnt = {}; a.forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; });
      var NUM = ["", "un", "deux", "trois", "quatre", "cinq"];
      return list(["q", "r", "b", "n", "p"].filter(function (t) { return cnt[t]; }).map(function (t) {
        var n = cnt[t]; if (n === 1) return t === "p" ? "un pion" : t === "n" || t === "b" ? (g.length + l.length > 1 ? art(t) : "une pièce") : art(t);
        return (NUM[n] || n) + " " + (t === "p" ? "pions" : t === "n" ? "cavaliers" : t === "b" ? "fous" : t === "r" ? "tours" : "dames");
      }));
    }
    var win = d >= 0 ? g : l, give = d >= 0 ? l : g;
    if (!win.length) return matText(Math.abs(d));
    return names(win) + (give.length ? " contre " + names(give) : "");
  }
  function matText(v, exch) {
    if (exch) return "la qualité";
    return v >= 9 ? "la dame ou l'équivalent" : v >= 6 ? "beaucoup de matériel" : v === 5 ? "une tour" : v === 4 ? "une pièce et un pion" : v === 3 ? "une pièce" : v === 2 ? "deux pions" : v === 1 ? "un pion" : "";
  }

  function sentence(o, who) {
    if (o.mate === 1) return "la suite " + o.sans.join(" ") + " mène au mat";
    if (o.mate === -1) return "la suite " + o.sans.join(" ") + " mène au mat contre " + who;
    if (o.d >= 1) return "la suite " + o.sans.join(" ") + " gagne " + o.what;
    if (o.d <= -1) return "la suite " + o.sans.join(" ") + " coûte " + o.what;
    return "";
  }

  /* Commentaire complet d'un coup.
   * g : partie (mv, ev, bm, c, f) ; i : index du coup ; fens : positions ; opts : { reading, lastCapSq, crit }
   * Retourne { text, kind } : text est un paragraphe en français. */
  function comment(Chess, Strat, g, i, fens, opts) {
    opts = opts || {};
    var fen = fens[i], u = g.mv[i], best = g.bm && g.bm[i], mover = i % 2 === 0 ? "w" : "b", mine = mover === g.c;
    var who = mine ? "tu" : "l'adversaire", Who = mine ? "Tu" : "L'adversaire";
    var lossMover = mine ? g.ev[i] - g.ev[i + 1] : g.ev[i + 1] - g.ev[i];
    var before = mine ? g.ev[i] : -g.ev[i];
    var ctx = { ply: i, lastCapSq: opts.lastCapSq };
    var d = describe(Chess, Strat, fen, u, ctx);
    var out = [];
    var san = d.san || "";
    out.push(Who + (mine ? " joues " : " joue ") + san + (d.text ? " : " + d.text : "") + ".");
    var isBest = best && best.slice(0, 4) === u.slice(0, 4);
    var decided = before <= -400;
    if (isBest) {
      out.push(before >= 400 ? "C'est le meilleur coup, et la position reste gagnante." : "C'est le meilleur coup.");
      return { text: out.join(" "), kind: "best" };
    }
    var bd = best ? describe(Chess, Strat, fen, best, { ply: i, lastCapSq: opts.lastCapSq }) : null;
    if (lossMover < 30 || decided) {
      if (bd && !decided) out.push("Bon coup ; le moteur jouait " + bd.san + " à peu près aussi bien.");
      return { text: out.join(" "), kind: "good" };
    }
    if (lossMover < 80) {
      if (bd) out.push("Coup jouable, mais " + bd.san + " était un peu plus précis" + (bd.text ? " : il " + bd.text : "") + ".");
      return { text: out.join(" "), kind: "ok" };
    }
    // faute : pourquoi le coup joué est mauvais
    var f = opts.fault, reading = opts.reading;
    var label = lossMover >= 300 ? "gaffe" : lossMover >= 150 ? "erreur" : "imprécision";
    var nature = reading ? reading.nature : null;
    var why = "", gain = f && f.pvu ? outcome(Chess, fen, f.pvu, 6) : null, missed = false, tact = false;
    if (f && f.rv && f.rv.length) {
      var played = outcome(Chess, fen, [u].concat(f.rv), 6); // ton coup puis la meilleure réponse adverse, de ton point de vue
      var delta = gain ? gain.d - played.d : -played.d;
      if (played.mate === -1) { why = "Après " + played.sans.slice(0, 5).join(" ") + ", l'adversaire obtient le mat."; tact = true; }
      else if (played.d <= -1 && delta >= 1) { why = "Après " + played.sans.slice(0, 4).join(" ") + (played.sans.length > 4 ? "…" : "") + ", tu perds " + played.what + "."; tact = true; }
      else if (d.tags.indexOf("prise") >= 0 && VAL[d.piece] - VAL[d.captured] >= 2) { why = "Tu donnes " + art(d.piece) + " contre " + art(d.captured) + " : un échange très défavorable."; tact = true; }
      else if (played.oppRun.length && (!gain || gain.oppRun.length < played.oppRun.length)) { why = "Après " + played.sans.slice(0, 4).join(" ") + (played.sans.length > 4 ? "…" : "") + ", les pions passés adverses avancent (" + played.oppRun.join(", ") + ") et menacent d'aller à dame."; tact = true; }
      else if (gain && (gain.d - Math.max(0, played.d) >= 2 || gain.mate === 1)) { why = "Ton coup ne perd rien de lui-même, mais tu laisses passer une occasion."; missed = true; tact = true; }
    } else if (best && g.bm[i + 1]) {
      var pun = describe(Chess, Strat, fens[i + 1], g.bm[i + 1], { ply: i + 1 });
      var evAfter = g.ev[i + 1], swing = mine ? "" : evAfter >= 300 ? " Ta position devient gagnante (" + fmt(evAfter) + ")." : evAfter >= 100 ? " Tu prends l'avantage (" + fmt(evAfter) + ")." : "";
      if (pun.san) why = (mine ? "L'adversaire" : "Tu") + " peu" + (mine ? "t" : "x") + " alors jouer " + pun.san + (pun.text ? ", qui " + pun.text : "") + "." + swing;
    }
    if (!why && d.tags.indexOf("en_prise") >= 0 && ctx.hung) why = "Le coup laisse " + art(ctx.hung[0].t, ctx.hung[0].sq) + " sans défense suffisante.";
    if (!why && reading && reading.findings.length) why = cap(reading.findings[0].txt.replace(/\.$/, "")) + ".";
    if (tact) nature = "tactique";
    var qual = missed ? " (occasion manquée)" : nature === "stratégique" ? " stratégique" : nature === "tactique" ? " tactique" : nature === "concret" ? " de calcul" : "";
    out.push("C'est une " + label + qual + ", qui coûte environ " + (lossMover / 100).toFixed(1).replace(".", ",") + " pion" + (lossMover >= 200 ? "s" : "") + "." + (nature === "stratégique" && !missed ? " La position se dégrade sans perte de matériel immédiate." : ""));
    if (why) out.push(why);
    // pourquoi le meilleur coup est meilleur
    if (bd) {
      var s = "Il fallait jouer " + bd.san + (bd.text ? ", qui " + bd.text : "");
      if (gain) { var gs = sentence(gain, "toi"); if (gs) s += " ; " + gs; }
      else if (reading && reading.nature === "stratégique" && reading.findings.length > 1) s += " ; " + reading.findings[1].txt.replace(/\.$/, "").replace(/^Le meilleur coup /, "il ");
      out.push(s + ".");
    }
    if (!mine && g.bm[i + 1]) {
      var pb = describe(Chess, Strat, fens[i + 1], g.bm[i + 1], { ply: i + 1 });
      if (pb.san && (!why || why.indexOf(" " + pb.san + ",") < 0 && why.indexOf(" " + pb.san + ".") < 0)) out.push("À toi d'en profiter avec " + pb.san + (pb.text ? ", qui " + pb.text : "") + ".");
    }
    return { text: out.join(" "), kind: label, tact: tact };
  }


  /* ---------- analyse approfondie (moteur à la demande) ---------- */
  function nullMove(Chess, fen) { // même position, mais c'est au camp qui vient de jouer de rejouer
    var c = new Chess(fen); if (c.in_check()) return null;
    var f = fen.split(" "); f[1] = f[1] === "w" ? "b" : "w"; f[3] = "-";
    var t = new Chess(); return t.load(f.join(" ")) ? t.fen() : null;
  }
  // Nature d'une suite : mat, échec perpétuel, répétition, bilan matériel. cp : score pour le camp au trait.
  function lineInfo(Chess, fen, pv, cp) {
    var ch = new Chess(fen), stm = ch.turn(), checks = { w: 0, b: 0 }, moves = { w: 0, b: 0 }, seen = {}, rep = false, sans = [];
    seen[fen.split(" ").slice(0, 2).join(" ")] = 1;
    for (var i = 0; i < pv.length && i < 12; i++) {
      var m = mv(ch, pv[i]); if (!m) break; sans.push(m.san); moves[m.color]++;
      if (ch.in_check()) checks[m.color]++;
      var k = ch.fen().split(" ").slice(0, 2).join(" "); if (seen[k]) rep = true; seen[k] = 1;
    }
    var info = { sans: sans, stm: stm, cp: cp, mate: null, perp: null, rep: rep, out: outcome(Chess, fen, pv, 8) };
    if (Math.abs(cp) >= 1400) info.mate = { side: cp > 0 ? stm : opp(stm), n: Math.max(1, 1500 - Math.abs(cp)) };
    else if (Math.abs(cp) <= 50) ["w", "b"].forEach(function (c) { if (checks[c] >= 3 && checks[c] >= moves[c] - 1) info.perp = c; else if (rep && checks[c] >= 2 && checks[c] >= moves[c] - 1) info.perp = c; });
    return info;
  }
  // Conséquence d'une suite, formulée pour le camp `side`.
  function conseq(info, side) {
    if (info.mate) return info.mate.side === side ? "mène au mat en " + info.mate.n + " coup" + (info.mate.n > 1 ? "s" : "") : "permet à l'adversaire de mater en " + info.mate.n;
    if (info.perp) return info.perp === side ? "force un échec perpétuel, donc la nulle" : "permet à l'adversaire de s'en sortir par un échec perpétuel";
    var d = info.out.d * (info.stm === side ? 1 : -1);
    if (d >= 1) return "gagne " + info.out.what;
    if (d <= -1) return "coûte " + info.out.what;
    return "";
  }
  function pron(mine) { return mine ? { Who: "Tu", who: "tu", verb: " joues ", lose: "tu perds", his: "ton", Opp: "L'adversaire", opp: "l'adversaire", can: "peux" } : { Who: "L'adversaire", who: "il", verb: " joue ", lose: "il perd", his: "son", Opp: "Tu", opp: "toi", can: "peut" }; }

  /* Commentaire approfondi. E(fen, depth, multipv) -> Promise<{cp, cp2, pv, pv2}> (scores pour le camp au trait). */
  async function deepComment(Chess, Strat, E, g, i, fens, opts) {
    opts = opts || {};
    var depth = opts.depth || 13, fen0 = fens[i], fen1 = fens[i + 1], u = g.mv[i];
    var mover = i % 2 === 0 ? "w" : "b", other = opp(mover), mine = mover === g.c, P = pron(mine);
    var ctx = { ply: i, lastCapSq: opts.lastCapSq }, d = describe(Chess, Strat, fen0, u, ctx);
    // suites de coups cliquables : chaque suite est remplacée dans le texte par un marqueur \u0001k\u0002
    var L = [];
    function S(f, ucis, n) {
      var c = new Chess(f), sans = [], used = [];
      for (var k = 0; k < (ucis || []).length && k < n; k++) { var m = mv(c, ucis[k]); if (!m) break; sans.push(m.san); used.push(ucis[k]); }
      if (!sans.length) return "";
      L.push({ fen: f, ucis: used, sans: sans }); return "\u0001" + (L.length - 1) + "\u0002";
    }
    var A = await E(fen0, depth, 2);            // meilleure suite et alternative avant le coup
    var B = await E(fen1, depth, 1);            // meilleure réponse adverse après le coup
    var evBefore = A.cp, evAfter = -B.cp;       // du point de vue du joueur qui joue le coup
    var loss = evBefore - evAfter;
    var isBest = A.pv[0] && A.pv[0].slice(0, 4) === u.slice(0, 4);
    var Ainfo = lineInfo(Chess, fen0, A.pv, A.cp), Binfo = lineInfo(Chess, fen1, B.pv, B.cp);
    var out = [], parts = [];
    // 1. ce que fait le coup, en vérifiant si la pièce « en prise » l'est vraiment
    var base = d.text, apparent = null;
    if (ctx.hung && ctx.hung.length && !new Chess(fen1).in_checkmate()) {
      var h = ctx.hung[0], caps = new Chess(fen1).moves({ verbose: true }).filter(function (m) { return m.to === h.sq; });
      if (caps.length) {
        var c1 = new Chess(fen1); c1.move(caps[0]); var fenC = c1.fen();
        var C = await E(fenC, depth, 1), Cinfo = lineInfo(Chess, fenC, C.pv, C.cp);
        if (C.cp >= evAfter - 80) apparent = { san: caps[0].san, info: Cinfo, h: h, fen: fenC, pv: C.pv, capUci: caps[0].from + caps[0].to };
      }
    }
    if (apparent) base = base.replace(/,? ?mais laisse .* en prise$/, "").replace(/^laisse .* en prise$/, "");
    out.push(P.Who + P.verb + (d.san || "") + (base ? " : " + base : "") + ".");
    if (apparent) {
      var cs = conseq(apparent.info, mover);
      if (cs) cs = (mine ? "et tu " : "et l'adversaire ") + (mine ? cs.replace(/^gagne/, "gagnes").replace(/^mène/, "mènes").replace(/^force/, "forces").replace(/^permet/, "permets").replace(/^coûte/, "perds") : cs.replace(/^coûte/, "perd"));
      var pr = apparent.h.t === "q" || apparent.h.t === "r" ? "la" : "le";
      out.push(cap(art(apparent.h.t, apparent.h.sq)) + " n'est en prise qu'en apparence : si " + (mine ? "l'adversaire " + pr + " prend" : "tu " + pr + " prends") + " (" + S(fen1, [apparent.capUci].concat(apparent.pv), 1) + "), " + (apparent.info.sans.length ? S(apparent.fen, apparent.pv, 5) + (cs ? " " + cs : "") : "la position reste équilibrée") + ".");
    }
    // 2. la menace du coup : ce que le joueur jouerait s'il rejouait
    var fenN = nullMove(Chess, fen1);
    if (fenN && !new Chess(fen1).game_over()) {
      var T = await E(fenN, depth, 1);
      if (T.pv && T.pv[0]) {
        var Tinfo = lineInfo(Chess, fenN, T.pv, T.cp), gain = T.cp - evAfter;
        var tSan = Tinfo.sans[0], tc = conseq(Tinfo, mover);
        var already = d.text.indexOf(tSan.replace(/[+#]/g, "").slice(-2)) >= 0 && /menace/.test(d.text);
        var mateT = Tinfo.mate && Tinfo.mate.side === mover && Tinfo.mate.n <= 3, perpT = Tinfo.perp === mover && evAfter < -80;
        var fault = evBefore - evAfter >= 80;
        var positive = /^(gagne|mène|force)/.test(tc);
        if (/menace mat/.test(d.text)) positive = false;
        if (tSan && positive && (mateT || perpT || (!fault && gain >= 200 && evAfter < 400 && !already))) {
          out.push((mine ? "Ton coup menace " : "Le coup menace ") + (Tinfo.sans.length > 1 && !Tinfo.mate ? tSan : S(fenN, T.pv, 3)) + (tc ? ", qui " + tc : "") + (Tinfo.sans.length > 1 && !Tinfo.mate ? " (" + S(fenN, T.pv, 5) + ")" : "") + ".");
        }
      }
    }
    // 3. verdict
    var decided = evBefore <= -400;
    if (isBest || loss < 30 || decided) {
      if (new Chess(fen1).in_checkmate()) { out.push("Échec et mat."); return { lines: L, text: out.join(" "), kind: "best", deep: true }; }
      if (isBest) {
        var ac = conseq(Ainfo, mover);
        var good = ac && /^(gagne|mène|force)/.test(ac) && (Ainfo.mate || Ainfo.perp || Math.abs(Ainfo.out.d) >= 2);
        out.push("C'est le meilleur coup" + (good ? " : la suite " + S(fen0, A.pv, 6) + " " + ac : evBefore <= -150 ? ", même si la position reste difficile" : "") + ".");
      } else if (!decided && A.pv[0]) out.push("Bon coup ; le moteur jouait " + S(fen0, A.pv, 1) + " à peu près aussi bien.");
      return { lines: L, text: out.join(" "), kind: isBest ? "best" : "good", deep: true };
    }
    // prophylaxie : le meilleur coup rend impossible la réponse qui punissait le coup joué
    var proph = "";
    if (B.pv[0]) {
      var pb = new Chess(fen0); mv(pb, A.pv[0]);
      var legal = pb.moves({ verbose: true }).some(function (m) { return m.from + m.to === B.pv[0].slice(0, 4); });
      if (!legal && pb.turn() === other) {
        var rd = describe(Chess, Strat, fen1, B.pv[0], { ply: i + 1 });
        proph = ", qui empêche " + (other === "b" ? "…" : "") + S(fen1, B.pv, 1) + (rd.text ? " (un coup qui " + rd.text.replace(/^menace /, "aurait menacé ").replace(/^avance /, "aurait avancé ") + ")" : "");
      }
    }
    var label = loss >= 300 ? "gaffe" : loss >= 150 ? "erreur" : loss >= 80 ? "imprécision" : null;
    if (!label) {
      var bd0 = describe(Chess, Strat, fen0, A.pv[0], { ply: i });
      out.push("Coup jouable, mais " + S(fen0, A.pv, 1) + " était un peu plus précis" + (proph ? proph.replace(/^, qui /, " : il ") : bd0.text ? " : il " + bd0.text : "") + ".");
      return { lines: L, text: out.join(" "), kind: "ok", deep: true };
    }
    // 4. pourquoi c'est une faute : la meilleure réponse adverse
    var rc = conseq(Binfo, other), why = "", usedB = false;
    var played = outcome(Chess, fen0, [u].concat(B.pv), 6);
    var rep = mine ? " répond " : " réponds ";
    if (Binfo.mate && Binfo.mate.side === other) { why = P.Opp + rep + Binfo.sans[0] + " et " + rc + " (" + S(fen1, B.pv, 5) + ")."; usedB = true; }
    else if (Binfo.perp === other) { why = P.Opp + " " + (mine ? "s'en sort" : "t'en sors") + " par un échec perpétuel : " + S(fen1, B.pv, 5) + "."; usedB = true; }
    else if (d.tags.indexOf("prise") >= 0 && VAL[d.piece] - VAL[d.captured] >= 2) why = (mine ? "Tu donnes " : "Il donne ") + art(d.piece) + " contre " + art(d.captured) + " : un échange très défavorable.";
    else if (played.oppRun && played.oppRun.length && played.d > -3) why = "Après " + S(fen0, [u].concat(B.pv), 4) + "…, les pions passés adverses avancent (" + played.oppRun.join(", ") + ") et menacent d'aller à dame.";
    else if (played.d <= -1) why = "Après " + S(fen0, [u].concat(B.pv), 4) + (played.sans.length > 4 ? "…" : "") + ", " + P.lose + " " + played.what + ".";
    else if (d.tags.indexOf("prise") >= 0 && VAL[d.piece] - VAL[d.captured] >= 2) why = (mine ? "Tu donnes " : "Il donne ") + art(d.piece) + " contre " + art(d.captured) + " : un échange très défavorable.";
    else if (played.oppRun && played.oppRun.length) why = "Après " + S(fen0, [u].concat(B.pv), 4) + "…, les pions passés adverses avancent (" + played.oppRun.join(", ") + ") et menacent d'aller à dame.";
    else if (Binfo.sans.length) {
      var bdB = describe(Chess, Strat, fen1, B.pv[0], { ply: i + 1 });
      why = P.Opp + rep + S(fen1, B.pv, 1) + (bdB.text ? ", qui " + bdB.text : "") + (rc ? " ; la suite " + S(fen1, B.pv, 6) + " " + rc : "") + "."; usedB = true;
    }
    var tact = !!(Binfo.mate || Binfo.perp || played.d <= -1 || (Ainfo.out.d * (Ainfo.stm === mover ? 1 : -1)) >= 2 || Ainfo.mate || Ainfo.perp);
    var reading = opts.reading, nature = tact ? "tactique" : reading ? reading.nature : null;
    if (!tact && reading && reading.findings.length && reading.nature === "stratégique") why = (why ? why + " " : "") + cap(reading.findings[0].txt.replace(/\.$/, "")) + ".";
    var qual = nature === "stratégique" ? " stratégique" : nature === "tactique" ? " tactique" : nature === "concret" ? " de calcul" : "";
    out.push("C'est une " + label + qual + ", qui coûte environ " + (loss / 100).toFixed(1).replace(".", ",") + " pion" + (Math.round(loss / 10) >= 20 ? "s" : "") + "." + (why ? " " + why : ""));
    // 5. pourquoi le meilleur coup est meilleur
    if (A.pv[0]) {
      var bd = describe(Chess, Strat, fen0, A.pv[0], { ply: i }), ac2 = conseq(Ainfo, mover);
      var ac2t = ac2 ? (/^coûte /.test(ac2) ? " ; la suite " + S(fen0, A.pv, 6) + " limite la casse (elle ne " + ac2.replace(/^coûte /, "coûte que ") + ")" : " ; la suite " + S(fen0, A.pv, 6) + " " + ac2) : "";
      out.push("Il fallait jouer " + S(fen0, A.pv, 1) + (proph || (bd.text ? ", qui " + bd.text : "")) + ac2t + ".");
    }
    if (/Après \u0001/.test(why)) usedB = true;
    if (!mine && Binfo.sans[0] && !usedB) out.push("À toi d'en profiter avec " + S(fen1, B.pv, 1) + ".");
    return { lines: L, text: out.join(" "), kind: label, tact: tact, deep: true };
  }
  function plain(r) { return r && r.text ? r.text.replace(/\u0001(\d+)\u0002/g, function (_, k) { return r.lines[+k] ? r.lines[+k].sans.join(" ") : ""; }) : ""; }
  root.Explain = { nullMove: nullMove, plain: plain, describe: describe, outcome: outcome, comment: comment, deepComment: deepComment, lineInfo: lineInfo };
})(typeof window !== "undefined" ? window : module.exports);
