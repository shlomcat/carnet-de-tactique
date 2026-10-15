/* Carnet de tactique — reconnaissance des structures de pions.
 * Chaque structure est décrite du point de vue d'un camp « A » (comme s'il avait les blancs) ;
 * la détection est testée dans les deux orientations, donc une structure peut appartenir aux noirs.
 * Pour chaque structure : plans du camp A, plans du camp B, et pièges typiques.
 */
(function (root) {
  "use strict";

  // Pions normalisés : A joue « vers le haut », rangs relatifs à A (1 à 8).
  function pawnSets(fen, aColor) {
    var rows = fen.split(" ")[0].split("/"), A = {}, B = {};
    for (var r = 0; r < 8; r++) {
      var f = 0, rank = 8 - r;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (ch >= "1" && ch <= "8") { f += +ch; continue; }
        if (ch === "P" || ch === "p") {
          var white = ch === "P", rel = aColor === "w" ? rank : 9 - rank;
          var key = "abcdefgh"[f] + rel;
          if (white === (aColor === "w")) A[key] = 1; else B[key] = 1;
        }
        f++;
      }
    }
    return { A: A, B: B };
  }
  function on(S, sq) { return !!S[sq]; }
  function file(S, f) { for (var r = 2; r <= 7; r++) if (S[f + r]) return true; return false; }
  function any(S, list) { return list.some(function (x) { return S[x]; }); }

  var DEFS = [
    { id: "iqp", wingA: "k", wingB: "c", roleA: "avec le pion isolé", roleB: "contre le pion isolé", name: "Pion-dame isolé",
      test: function (A, B) { return on(A, "d4") && !file(A, "c") && !file(A, "e") && !file(B, "d"); },
      desc: "Un camp a un pion d isolé au centre : il gagne de l'activité et des cases (e5, c5) mais le pion est une cible à long terme.",
      planA: "Joue pour l'initiative : pièces actives, cavalier en e5, batterie dame-fou contre le roque, tours sur les colonnes c et e, et poussée d5 au bon moment pour ouvrir le jeu. Évite les échanges.",
      planB: "Bloque la case d5, idéalement avec un cavalier, échange les pièces mineures et vise la finale, où le pion isolé devient une vraie faiblesse.",
      trapA: "Échanger les pièces sans contrepartie ; laisser l'adversaire installer un bloqueur en d5.",
      trapB: "Attaquer le pion trop tôt et laisser l'initiative adverse se développer contre ton roi." },

    { id: "hanging", wingA: "c", wingB: "c", roleA: "avec les pions pendants", roleB: "contre les pions pendants", name: "Pions pendants",
      test: function (A, B) { return on(A, "c4") && on(A, "d4") && !file(A, "b") && !file(A, "e") && !file(B, "c") && !file(B, "d"); },
      desc: "Deux pions c et d côte à côte, sans voisins : dynamiques tant qu'ils restent sur la même rangée, faibles s'ils sont forcés d'avancer.",
      planA: "Garde les deux pions sur la même rangée, place tes pièces derrière eux et menace d5 ou c5 pour ouvrir le jeu au moment favorable.",
      planB: "Mets la pression sur c4 et d4 pour forcer l'un des deux à avancer, bloque la case devant lui, puis attaque le pion resté en arrière.",
      trapA: "Pousser un des pions sans nécessité, ce qui crée une case de blocage et un pion arriéré.",
      trapB: "Laisser les pions avancer en bloc et ouvrir le centre contre toi." },

    { id: "carlsbad", wingA: "q", wingB: "k", roleA: "côté attaque de minorité", roleB: "côté c6-d5", name: "Carlsbad",
      test: function (A, B) { return on(A, "d4") && !file(A, "c") && file(A, "e") && on(B, "d5") && any(B, ["c6", "c7"]) && !file(B, "e"); },
      desc: "La structure du Gambit Dame échange : colonne c semi-ouverte pour un camp, colonne e semi-ouverte pour l'autre.",
      planA: "Attaque de minorité : b4-b5 pour échanger sur c6 et laisser un pion faible en c6 ou un pion isolé en d5. Plan alternatif : f3 puis e4 après bonne préparation.",
      planB: "Joue à l'aile roi : cavalier en e4, poussée f5, attaque avec les pièces ; utilise la colonne e. Contre l'attaque de minorité, prépare b5 ou accepte un pion en c6 en gardant du jeu actif.",
      trapA: "Pousser e4 trop tôt et te retrouver avec un pion-dame isolé sans compensation.",
      trapB: "Subir passivement l'attaque de minorité sans contre-jeu sur l'aile roi." },

    { id: "caro", wingA: "k", wingB: "c", roleA: "côté d4, avec l'espace", roleB: "côté c6 (Caro / Slave)", name: "Caro-Kann / Slave (c6 contre d4)",
      test: function (A, B) { return on(A, "d4") && !file(A, "e") && on(B, "c6") && !file(B, "d") && !on(B, "e5"); },
      desc: "Le camp au pion d4 a plus d'espace ; l'autre a une structure très solide mais un peu passive, qu'il doit libérer.",
      planA: "Profite de l'espace : cavalier en e5, gain d'espace à l'aile roi (h4-h5 dans la Caro classique), et empêche les poussées libératrices c5 et e5 adverses.",
      planB: "Reste solide puis libère ton jeu avec c5 ou e5 au bon moment ; échange ton fou de cases claires avant de l'enfermer derrière e6 ; roque du côté le plus sûr.",
      trapA: "T'étendre sans soutien (h5, g4) et laisser des cases faibles ; laisser l'adversaire libérer par c5 sans réaction.",
      trapB: "Attendre trop longtemps : sans c5 ou e5, l'espace adverse finit par t'étouffer." },

    { id: "french", wingA: "k", wingB: "q", roleA: "côté e5-d4", roleB: "côté e6-d5", name: "Chaîne française (e5-d4 contre e6-d5)",
      test: function (A, B) { return on(A, "e5") && on(A, "d4") && on(B, "e6") && on(B, "d5"); },
      desc: "Chaînes de pions imbriquées : on attaque la base de la chaîne adverse et on joue du côté où pointe sa propre chaîne.",
      planA: "Joue à l'aile roi, où pointe ta chaîne : f4-f5, attaque contre le roque. Tiens absolument d4, la base qui soutient e5.",
      planB: "Attaque la base de la chaîne : c5 contre d4 (avec Db6, Cc6), puis f6 contre e5. Ton fou de cases claires est le problème principal : trouve-lui une diagonale ou échange-le.",
      trapA: "Laisser tomber d4 ; échanger trop vite sur c5 et libérer le jeu adverse.",
      trapB: "Oublier f6 et te faire étouffer à l'aile roi." },

    { id: "wedge", wingA: "k", wingB: "q", roleA: "avec le pion e5", roleB: "contre le pion e5", name: "Coin e5 (centre semi-fermé)",
      test: function (A, B) { return on(A, "e5") && !file(A, "d") && any(B, ["e6", "e7"]) && !file(B, "d"); },
      desc: "Un pion avancé en e5 coupe l'échiquier : il prend de l'espace et prive l'adversaire de d6 et f6, mais il doit être soutenu.",
      planA: "Utilise l'espace à l'aile roi (Dg4, f4-f5, cavalier vers g5 ou d6) et soutiens e5 avec f4 et tes pièces ; la case d4 est idéale pour un cavalier.",
      planB: "Attaque le pion e5 (f6, Dc7, Cd7 ou Cc6) ou bloque-le, et joue à l'aile dame où tu as les coudées franches.",
      trapA: "Laisser tomber e5 faute de soutien.",
      trapB: "Laisser le pion e5 étouffer ton roque sans réagir." },

    { id: "kid", wingA: "q", wingB: "k", roleA: "côté d5-e4, jeu aile dame", roleB: "côté d6-e5, jeu aile roi", name: "Centre bloqué (type Est-Indienne)",
      test: function (A, B) { return on(A, "d5") && on(A, "e4") && on(B, "d6") && on(B, "e5"); },
      desc: "Centre fermé : chaque camp attaque sur l'aile où pointe sa chaîne. C'est une course, le tempo compte plus que tout.",
      planA: "Joue à l'aile dame : c4-c5, b4, ouverture de la colonne c ; infiltre-toi en c7.",
      planB: "Joue à l'aile roi : f5, puis f4 et g5-g4 ; amène les pièces vers le roque adverse.",
      trapA: "Te laisser distraire à l'aile roi et perdre la course.",
      trapB: "Prendre en e4 trop tôt (fxe4), ce qui donne la case e4 et relâche la pression." },

    { id: "benoni", wingA: "c", wingB: "q", roleA: "majorité centrale", roleB: "majorité aile dame", name: "Benoni",
      test: function (A, B) { return on(A, "d5") && on(A, "c4") && on(B, "c5") && on(B, "d6") && !file(B, "e"); },
      desc: "Majorité centrale pour un camp, majorité à l'aile dame pour l'autre : chacun pousse sa majorité.",
      planA: "Prépare e4-e5 avec ta majorité centrale, bloque l'aile dame (a4) pour freiner b5.",
      planB: "Pousse ta majorité à l'aile dame (a6, b5), utilise le fianchetto en g7 et la pression sur e4.",
      trapA: "Laisser passer b5 sans réaction.",
      trapB: "Laisser la poussée e5 arriver dans de bonnes conditions." },

    { id: "bolesl", wingA: "c", wingB: "q", roleA: "côté e4, case d5", roleB: "côté d6-e5", name: "Sicilienne Boleslavsky / Najdorf (trou d5)",
      test: function (A, B) { return on(A, "e4") && !file(A, "d") && on(B, "e5") && on(B, "d6") && !file(B, "c"); },
      desc: "Le camp aux pions d6-e5 a un trou en d5 et un pion arriéré en d6, mais beaucoup de contre-jeu.",
      planA: "Contrôle et occupe d5 : cavalier en d5, échange les pièces adverses qui défendent cette case (cavalier f6, fou e6 ou e7).",
      planB: "Neutralise d5 puis joue d5 pour libérer ; contre-jeu sur la colonne c et avec b5.",
      trapA: "Laisser l'adversaire réussir d5.",
      trapB: "Échanger le fou qui défend d5 et laisser un cavalier s'y installer." },

    { id: "schev", wingA: "k", wingB: "q", roleA: "côté e4", roleB: "côté d6-e6", name: "Sicilienne Scheveningen / Hérisson",
      test: function (A, B) { return on(A, "e4") && !file(A, "d") && on(B, "e6") && on(B, "d6") && !file(B, "c"); },
      desc: "Petit centre compact pour un camp, plus d'espace pour l'autre. Structure élastique : tout se joue sur les ruptures.",
      planA: "Attaque à l'aile roi (f4, g4-g5) ou prépare e5 ; garde le contrôle de d5 pour empêcher la rupture d5.",
      planB: "Contre-jeu à l'aile dame (b5, colonne c) et ruptures d5 ou e5 au bon moment.",
      trapA: "Attaquer sans avoir sécurisé ton roi, alors que le contre-jeu adverse arrive vite par la colonne c.",
      trapB: "Rester passif : sans rupture, l'attaque adverse finit par passer." },

    { id: "maroczy", wingA: null, wingB: null, roleA: "avec l'étau", roleB: "contre l'étau", name: "Bind de Maroczy",
      test: function (A, B) { return on(A, "c4") && on(A, "e4") && !file(A, "d") && !file(B, "c") && file(B, "d"); },
      desc: "Étau sur la case d5 : un camp a beaucoup d'espace, l'autre doit trouver une rupture.",
      planA: "Étouffe : empêche b5 et d5, joue lentement avec ton avantage d'espace.",
      planB: "Sois patient : échange des pièces pour respirer, puis prépare b5 ou d5.",
      trapA: "Ouvrir le jeu toi-même et relâcher l'étau.",
      trapB: "Forcer une rupture mal préparée." },

    { id: "stonewall", wingA: "k", wingB: "c", roleA: "avec le Stonewall", roleB: "contre le Stonewall", name: "Stonewall",
      test: function (A, B) { return on(A, "d4") && on(A, "e3") && on(A, "f4"); },
      desc: "Mur de pions d4-e3-f4 : case e5 forte pour un cavalier, mais trou en e4 et fou de cases claires enfermé.",
      planA: "Installe un cavalier en e5 et attaque à l'aile roi (g4, tour par f3-h3).",
      planB: "Occupe le trou en e4, échange le cavalier qui arrive en e5, et exploite le mauvais fou de cases claires adverse.",
      trapA: "Attaquer sans le cavalier en e5 ; laisser un cavalier adverse s'installer en e4.",
      trapB: "Laisser l'attaque se développer sans occuper e4." },

    { id: "slow", wingA: null, wingB: null, roleA: "côté e4-d3", roleB: "côté e5-d6", name: "Centre e4-e5 fermé (Espagnole, Italienne lente)",
      test: function (A, B) { return on(A, "e4") && on(A, "d3") && on(B, "e5") && on(B, "d6"); },
      desc: "Centre symétrique et tendu : partie de manœuvres où la qualité du regroupement compte plus que le calcul.",
      planA: "Prépare d4 (c3, puis manœuvre Cbd2-f1-g3), ou joue à l'aile roi avec f4 ; ne bloque pas tes pièces.",
      planB: "Cherche la rupture d5 ou f5, ou le contre-jeu à l'aile dame avec b5 et c5.",
      trapA: "Jouer d4 avant d'avoir assez de soutien.",
      trapB: "Laisser l'adversaire réussir d4 dans de bonnes conditions." },

    { id: "open", wingA: null, wingB: null, roleA: "", roleB: "", name: "Centre ouvert",
      test: function (A, B) { return !file(A, "d") && !file(A, "e") && !file(B, "d") && !file(B, "e"); },
      desc: "Plus de pions centraux : le jeu est dicté par l'activité des pièces et les colonnes ouvertes.",
      planA: "Développe vite, occupe les colonnes d et e avec les tours, mets ton roi à l'abri et vise les pièces mal placées.",
      planB: "Développe vite, occupe les colonnes d et e avec les tours, mets ton roi à l'abri et vise les pièces mal placées.",
      trapA: "Perdre du temps dans l'ouverture, garder le roi au centre.",
      trapB: "Perdre du temps dans l'ouverture, garder le roi au centre." }
  ];
  var BYID = {}; DEFS.forEach(function (d) { BYID[d.id] = d; });

  function classify(fen) {
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      for (var k = 0; k < 2; k++) {
        var a = k === 0 ? "w" : "b", S = pawnSets(fen, a);
        if (d.test(S.A, S.B)) return { id: d.id, a: a };
      }
    }
    return null;
  }

  // Structure d'une partie : la plus fréquente entre les coups 8 et 25 (demi-coups 16 à 50), en exigeant qu'elle tienne plusieurs coups.
  function ofGame(fens) {
    var count = {};
    fens.forEach(function (fen, ply) {
      if (ply < 16 || ply > 50 || ply % 2) return;
      var c = classify(fen); if (!c) return;
      var k = c.id + ":" + c.a; count[k] = (count[k] || 0) + 1;
    });
    var best = null, n = 0;
    Object.keys(count).forEach(function (k) { if (count[k] > n) { n = count[k]; best = k; } });
    if (!best || n < 3) return null;
    var p = best.split(":");
    return { id: p[0], a: p[1] };
  }

  // Pour un joueur de couleur `me` : 1 s'il est le camp A, 0 s'il est le camp B, -1 si la structure est symétrique dans ses plans.
  function sideOf(st, me) { if (!st) return null; if (st.id === "open") return -1; return st.a === me ? 1 : 0; }
  function planFor(id, side) {
    var d = BYID[id]; if (!d) return null;
    return { wing: side === 0 ? d.wingB : side === 1 ? d.wingA : null, name: d.name, role: side === 0 ? d.roleB : side === 1 ? d.roleA : "", desc: d.desc, plan: side === 0 ? d.planB : d.planA, opp: side === 0 ? d.planA : d.planB, trap: side === 0 ? d.trapB : d.trapA };
  }

  root.Struct = { DEFS: DEFS, BYID: BYID, classify: classify, ofGame: ofGame, sideOf: sideOf, planFor: planFor };
})(typeof window !== "undefined" ? window : module.exports);
