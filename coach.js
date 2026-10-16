/* Carnet de tactique — Coach : leçons interactives sur une vraie partie.
   Tu demandes un thème (« les plans de la Dragon avec les blancs ») ou tu donnes une position ;
   le coach trouve une partie de maîtres qui l'illustre (base Lichess Masters, sur le site, avec ton jeton Lichess)
   ou, à défaut, en cite une de mémoire. Il la commente, s'arrête sur les moments clés pour te faire chercher
   le coup, puis explique. Claude (version Claude) ou Gemini (site) rédige ; chess.js vérifie chaque coup ;
   Stockfish juge tes réponses. */
"use strict";
const CO={key:"carnet:lessons",li:"carnet:lichess",cur:null,ply:0,cg:null,quiz:null,run:false,chat:[],fens:[],ucis:[],prefill:null};
const CO_EX=["Apprends-moi les plans de la Sicilienne Dragon avec les blancs","L'attaque de minorité dans la structure Carlsbad, avec les blancs","Comment jouer contre le pion isolé avec les noirs","Les plans de la Caro-Kann variante d'avance avec les noirs","La Française Winawer avec les noirs"];
const START=()=>VCore.START_FEN;
function coLessons(){return store.get(CO.key)||[]}
function coSave(L){store.set(CO.key,L.slice(0,40))}
function coGet(){return coLessons().find(x=>x.id===CO.cur)||null}
function coPut(l){coSave(coLessons().map(x=>x.id===l.id?l:x))}
const inClaude=()=>!!window.claude;

/* ---------- l'IA qui rédige : Claude dans la version Claude, Gemini sur le site ---------- */
function coEngineName(){return SAMPLE?"Claude":"Gemini"}
async function coLLM(prompt,json){
  if(SAMPLE){const r=await SAMPLE(prompt,{cache:false,modelTier:"complex"});return json?VCore.vParseJSON(r.text):r.text}
  const cfg=vCfg();
  if(!cfg.k)throw new Error("pour préparer une leçon sur ce site, ajoute ta clé Gemini dans l'onglet Vidéos (ou utilise la version Claude du carnet)");
  const models=[cfg.model,"gemini-3.6-flash","gemini-3.8-flash"].filter((m,i,a)=>a.indexOf(m)===i);let last=null;
  for(const model of models)for(let k=0;k<3;k++){
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.k},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:Object.assign({temperature:0.4},json?{responseMimeType:"application/json"}:{})})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){const e=new Error((j.error&&j.error.message)||"HTTP "+r.status);e.status=r.status;throw e}
      const txt=((j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[]).map(p=>p.text||"").join("");
      if(!txt)throw new Error("réponse vide");
      return json?VCore.vParseJSON(txt):txt;
    }catch(e){last=e;if(!VCore.busyErr(e)&&!e.net)throw e;if(k<2)await VCore.sleep((k?15:5)*1000)}
  }
  throw new Error("Gemini est saturé pour le moment, réessaie dans quelques minutes ("+(last&&last.message)+")");
}

/* ---------- base Lichess Masters (site uniquement : jeton personnel, sans droits particuliers) ---------- */
function liTok(){return (store.get(CO.li)||{}).t||""}
async function liGet(url,text){
  let r;try{r=await fetch(url,{headers:{Authorization:"Bearer "+liTok()}})}catch(e){throw new Error("base Lichess injoignable")}
  if(r.status===401||r.status===403)throw new Error("jeton Lichess refusé : recrée-le sur lichess.org (aucune case à cocher)");
  if(r.status===429)throw new Error("trop de demandes à Lichess, réessaie dans une minute");
  if(!r.ok)throw new Error("base Lichess : erreur "+r.status);
  return text?r.text():r.json();
}
const liMasters=fen=>liGet(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=6&topGames=15`);
const liPgn=id=>liGet(`https://explorer.lichess.ovh/master/pgn/${encodeURIComponent(id)}`,true);
const placement=f=>f.split(" ").slice(0,2).join(" ");
function liStats(d,fen){
  const tot=(d.white||0)+(d.draws||0)+(d.black||0);if(!tot)return "";
  const c=new Chess(fen),stm=c.turn();
  const mv=(d.moves||[]).slice(0,5).map(m=>{const n=m.white+m.draws+m.black,sc=(m.white+m.draws/2)/n;return `${m.san} (${Math.round(100*n/tot)} % des parties, ${Math.round(100*(stm==="w"?sc:1-sc))} % de points pour le camp au trait)`});
  return `Base Lichess Masters, ${tot} parties dans cette position${d.opening&&d.opening.name?` (${d.opening.name})`:""} : ${mv.join(" ; ")}.`;
}
// choisit une vraie partie qui passe par la position : de préférence gagnée par le camp du joueur, entre joueurs forts
async function liFindGame(fen,camp,say){
  const d=await liMasters(fen),win=camp==="w"?"white":"black";
  const games=(d.topGames||[]).slice().sort((a,b)=>((b.winner===win)-(a.winner===win))||((b.white.rating+b.black.rating)-(a.white.rating+a.black.rating)));
  if(!games.length)return {stats:liStats(d,fen),game:null};
  for(const g of games.slice(0,4)){
    say(`Base Lichess : partie ${g.white.name} – ${g.black.name} (${g.year})…`);
    try{
      const pgn=await liPgn(g.id),c=new Chess();if(!c.load_pgn(pgn,{sloppy:true}))continue;
      const sans=c.history(),r=VCore.replay(START(),sans);if(r.bad||sans.length<20)continue;
      const k=r.fens.findIndex(f=>placement(f)===placement(fen));if(k<0)continue;
      const res=(pgn.match(/\[Result "([^"]+)"\]/)||[])[1]||(g.winner==="white"?"1-0":g.winner==="black"?"0-1":"1/2-1/2");
      return {stats:liStats(d,fen),game:{id:g.id,white:g.white.name,black:g.black.name,rw:g.white.rating,rb:g.black.rating,year:String(g.year||""),event:(pgn.match(/\[Event "([^"]+)"\]/)||[])[1]||"",result:res,sans,focus:k}};
    }catch(e){if(/jeton|trop de demandes/.test(e.message))throw e}
  }
  return {stats:liStats(d,fen),game:null};
}

/* ---------- position de départ : FEN ou suite de coups ---------- */
function coParsePos(txt){
  txt=(txt||"").trim();if(!txt)return null;
  if(/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}(\s|$)/.test(txt)){const c=new Chess();const f=txt.split(/\s+/).length>=4?txt:txt+" w - - 0 1";if(!c.load(f))throw new Error("FEN illisible");return {fen:c.fen(),moves:null}}
  const mv=VCore.pgnMoves(txt);if(!mv||!mv.length)throw new Error("position illisible : colle une FEN ou une suite de coups (1. e4 c5 2. Nf3 …)");
  const r=VCore.replay(START(),mv);return {fen:r.fens[r.sans.length],moves:r.sans};
}
function coSide(txt,sel,pos){if(sel==="w"||sel==="b")return sel;const t=(txt||"").toLowerCase();if(/avec les noirs|côté noir|pour les noirs|en noir/.test(t))return "b";if(/avec les blancs|pour les blancs|en blanc/.test(t))return "w";return pos?pos.fen.split(" ")[1]:"w"}

/* ---------- consignes à l'IA ---------- */
const ELO=()=>(S&&S.games&&S.games[0]&&S.games[0].r)||2300;
const RULES=C=>`- 8 à 14 commentaires répartis sur la partie, 2 à 4 phrases chacun : ce que prépare le coup, le plan en cours, ce qu'il faut retenir.
- 4 à 6 questions aux moments clés pour les ${C} : rupture de pions, sacrifice thématique, changement de plan, coup prophylactique. Jamais un coup évident ou une simple reprise. La question ne doit pas donner la réponse ; l'indice oriente sans révéler ; l'explication (3 à 5 phrases) dit pourquoi ce coup et pourquoi les alternatives sont moins bonnes.
- Écris en français, comme un entraîneur qui parle à son élève d'environ ${ELO()} Elo en blitz.`;
function numbered(sans,fen0){
  const r=VCore.replay(fen0,sans);
  return sans.map((s,i)=>{const f=r.fens[i].split(" "),n=f[5],w=f[1]==="w";return `[${i+1}] ${n}${w?".":"..."} ${s}`}).join(" ");
}
function annotatePrompt(ask,camp,G,stats){
  const C=camp==="w"?"blancs":"noirs";
  return `Tu es un entraîneur d'échecs expérimenté. Tu prépares une leçon interactive à partir d'une partie réelle.
Demande du joueur : « ${ask||"les plans dans cette position"} ». Le joueur joue avec les ${C}.
Partie : ${G.white}${G.rw?` (${G.rw})`:""} – ${G.black}${G.rb?` (${G.rb})`:""}${G.event?`, ${G.event}`:""}${G.year?`, ${G.year}`:""}, résultat ${G.result}.
Coups, avec leur index entre crochets : ${numbered(G.sans,START())}
La position étudiée est atteinte après le coup d'index [${G.focus}].
${stats||""}
Réponds UNIQUEMENT par un objet JSON :
{"titre": "...", "introduction": "4 à 6 phrases : la structure ou l'ouverture, les plans typiques des deux camps dans la position étudiée",
 "commentaires": [{"n": 25, "texte": "..."}], "questions": [{"n": 31, "question": "...", "indice": "...", "explication": "..."}], "resume": ["3 à 5 leçons à retenir"]}
- "n" est l'index du coup commenté (ou du coup à trouver), tel qu'entre crochets.
- Les questions portent sur des coups des ${C} joués APRÈS l'index ${G.focus}.
${RULES(C)}
- Ne cite que des coups de cette partie ; ne contredis pas le déroulement de la partie.`;
}
function memoryPrompt(ask,camp,pos,stats){
  const C=camp==="w"?"blancs":"noirs";
  const where=pos?(pos.moves?`La partie doit passer par cette suite de coups depuis la position initiale : ${pos.moves.join(" ")}. Donne dans "coups" UNIQUEMENT les coups qui suivent.`:`Point de départ imposé, la position FEN : ${pos.fen}. Donne dans "coups" UNIQUEMENT les coups joués à partir de cette position.`):"Donne dans \"coups\" toute la partie depuis la position initiale.";
  return `Tu es un entraîneur d'échecs expérimenté. Tu prépares une leçon interactive pour un joueur d'environ ${ELO()} Elo en blitz.
Demande du joueur : « ${ask||"les plans dans cette position"} ». Le joueur joue avec les ${C} : les questions portent uniquement sur des coups des ${C}.
${stats||""}
Choisis UNE partie qui illustre parfaitement ce thème : de préférence une partie réelle célèbre de maîtres que tu connais coup par coup. Si tu n'es pas certain des coups exacts d'une partie réelle, construis une partie modèle crédible et indique "reelle": false. Ne présente jamais comme réelle une partie dont tu n'es pas sûr.
${where}
Réponds UNIQUEMENT par un objet JSON :
{"titre": "...", "introduction": "4 à 6 phrases : les idées, les plans typiques des deux camps, ce qu'il faut surveiller",
 "partie": {"blancs": "...", "noirs": "...", "evenement": "...", "annee": "...", "reelle": true, "coups": ["...", "..."]},
 "commentaires": [{"n": 9, "texte": "..."}], "questions": [{"n": 14, "question": "...", "indice": "...", "explication": "..."}], "resume": ["3 à 5 leçons à retenir"]}
- "coups" en notation SAN anglaise (K, Q, R, B, N), sans numéros ; au moins 40 coups au total si possible.
- "n" = position du coup dans ta liste "coups" (1 = premier coup de la liste).
${RULES(C)}`;
}
function linePrompt(ask){
  return `Pour la demande d'échecs suivante : « ${ask} », donne la suite de coups (depuis la position initiale, notation SAN anglaise, sans numéros) qui mène à la position typique où se décident les plans dont il est question, en général la fin de la théorie principale, entre 8 et 16 coups de chaque camp.
Réponds UNIQUEMENT en JSON : {"coups": ["e4", "c5", ...], "nom": "nom de la variante"}`;
}

/* ---------- préparation de la leçon ---------- */
function coItems(list,sans,offset){
  return (list||[]).map(x=>{let p=Number.isFinite(+x.n)&&+x.n>0?+x.n+(offset||0):-1;
    if(p<0&&x.coup)p=VCore.plyOf(x.coup,sans);return {...x,ply:p}}).filter(x=>x.ply>0&&x.ply<=sans.length);
}
function coAssemble(o){
  const {ask,camp,raw,sans,fen0,game,src,focus,stats}=o;
  const r=VCore.replay(fen0,sans);
  const comments=coItems(raw.commentaires,sans,o.offset).map(c=>({ply:c.ply,text:String(c.texte||"").trim()})).filter(c=>c.text);
  const seen=new Set();
  const quizzes=coItems(raw.questions,sans,o.offset)
    .filter(q=>r.fens[q.ply-1].split(" ")[1]===camp&&q.ply>(focus||0)&&!seen.has(q.ply)&&seen.add(q.ply))
    .map(q=>({ply:q.ply,san:sans[q.ply-1],q:String(q.question||"").trim(),hint:String(q.indice||"").trim(),expl:String(q.explication||"").trim()})).sort((a,b)=>a.ply-b.ply);
  return {id:"l"+Date.now().toString(36),at:Date.now(),ask,by:coEngineName(),title:String(raw.titre||ask||"Leçon").trim(),camp,intro:String(raw.introduction||"").trim(),stats:stats||"",
    startFen:fen0,focus:focus||0,src,game:Object.assign({sans},game),comments,quizzes,summary:(raw.resume||[]).map(String),answers:{},ply:focus||0};
}
async function coBuild(ask,camp,pos,say){
  let stats="",liErr=null;
  const canLi=!inClaude()&&!!liTok();
  // 1. la position à étudier : donnée par le joueur, ou la ligne principale du thème proposée par l'IA
  let target=pos&&pos.moves?pos:(pos||null);
  if(!target&&canLi){
    say(`${coEngineName()} cherche la position typique du thème…`);
    try{const ln=await coLLM(linePrompt(ask),true),r=VCore.replay(START(),ln.coups||[]);if(r.sans.length>=6)target={fen:r.fens[r.sans.length],moves:r.sans,name:ln.nom}}catch(e){}
  }
  // 2. une vraie partie de la base Lichess Masters qui passe par cette position
  if(target&&canLi){
    say("Recherche d'une partie de maîtres dans la base Lichess…");
    try{const f=await liFindGame(target.fen,camp,say);stats=f.stats;
      if(f.game){
        say(`${coEngineName()} annote ${f.game.white} – ${f.game.black} (${f.game.year})… compte 20 à 60 secondes.`);
        const raw=await coLLM(annotatePrompt(ask,camp,f.game,stats),true);
        return coAssemble({ask,camp,raw,sans:f.game.sans,fen0:START(),focus:f.game.focus,stats,src:"lichess",
          game:{white:f.game.white,black:f.game.black,event:f.game.event,year:f.game.year,result:f.game.result,real:true,lichess:f.game.id,rw:f.game.rw,rb:f.game.rb}});
      }
      liErr="aucune partie de maîtres trouvée dans cette position";
    }catch(e){liErr=e.message}
  }
  // 3. à défaut : une partie citée de mémoire (ou une partie modèle), vérifiée coup par coup
  say(`${coEngineName()} prépare la leçon${liErr?` (base Lichess : ${liErr})`:""}… compte 20 à 60 secondes.`);
  const raw=await coLLM(memoryPrompt(ask,camp,pos,stats),true),P=raw.partie||{};
  const fen0=pos&&!pos.moves?pos.fen:START(),pre=pos&&pos.moves?pos.moves:[];
  let r=VCore.replay(fen0,pre.concat(P.coups||[])),fixed=0;
  if(r.bad&&r.sans.length<pre.length+(P.coups||[]).length-2){
    const n=r.sans.length,fen=r.fens[n];say(`Correction de la partie après le coup ${n}…`);
    try{const fx=await coLLM(`Dans la partie que tu as proposée, le coup « ${r.bad.san} » est impossible.
Position atteinte (FEN) : ${fen}${n?`, après les coups : ${r.sans.join(" ")}`:""}
Réponds UNIQUEMENT en JSON {"coups": [...]} avec la suite correcte à partir de cette position (seulement les coups suivants, notation SAN anglaise).`,true);
      const r2=VCore.replay(fen0,r.sans.concat(fx.coups||[]));if(r2.sans.length>r.sans.length){r=r2;fixed=1}}catch(e){}
  }
  if(r.sans.length-pre.length<12)throw new Error("la partie proposée n'a pas pu être vérifiée (coups impossibles). Relance la demande.");
  return coAssemble({ask,camp,raw,sans:r.sans,fen0,offset:pre.length,focus:pre.length,stats,src:P.reelle===false?"modele":"memoire",
    game:{white:String(P.blancs||""),black:String(P.noirs||""),event:String(P.evenement||""),year:String(P.annee||""),real:P.reelle!==false,cut:r.bad?r.bad.san:null,fixed}});
}
async function coStart(){
  if(CO.run)return;const ask=$("#coask").value.trim(),st=$("#costat");
  const say=(t,err)=>{st.hidden=false;st.className="vstat"+(err?" err":"");st.textContent=t};
  let pos=null;try{pos=coParsePos($("#copos").value)}catch(e){return say(e.message,1)}
  if(ask.length<8&&!pos)return say("Décris ce que tu veux apprendre, ou donne une position (FEN ou suite de coups).",1);
  if($("#cotok")&&$("#cotok").value.trim()!==liTok())store.set(CO.li,{t:$("#cotok").value.trim()});
  CO.run=true;$("#cogo").disabled=true;
  try{const l=await coBuild(ask,coSide(ask,$("#coside").value,pos),pos,say);const L=coLessons();L.unshift(l);coSave(L);CO.cur=l.id;CO.ply=l.ply;CO.prefill=null;renderCoach()}
  catch(e){say("Échec : "+(e.message||e),1)}
  finally{CO.run=false;const b=$("#cogo");if(b)b.disabled=false}
}
// depuis le Bilan : une leçon sur un point faible, préparée tout de suite
function coLaunch(x){
  if(!x)return;CO.prefill={ask:x.ask,moves:x.moves||"",camp:x.camp||""};CO.cur=null;tab("coach");renderCoach();
  if(!$("#cogo").disabled)coStart();
}
// depuis la Revue : « les plans de cette position avec le coach »
function coFromRevue(p){
  if(typeof RV==="undefined"||!RV.g)return;
  CO.prefill={moves:RV.sans.slice(0,p).join(" "),camp:RV.g.c,ask:`Quels sont les plans dans cette position de ma partie${RV.g.opp?` contre ${RV.g.opp}`:""} ?`};
  CO.cur=null;tab("coach");renderCoach();
}

/* ---------- affichage ---------- */
function coSrcLabel(l){return l.src==="lichess"?"partie réelle · base Lichess Masters":l.src==="modele"?"partie modèle":`partie réelle citée de mémoire par ${esc(l.by)}`}
function renderCoach(){
  const box=$("#p-coach");if(!box)return;
  if(CO.cg){try{CO.cg.destroy()}catch(e){}CO.cg=null}
  const l=coGet();if(l)return coViewer(l);
  const L=coLessons(),noLLM=!SAMPLE&&!vCfg().k,pf=CO.prefill;
  box.innerHTML=`<div class="panel">
    <h3>Coach · leçon sur une vraie partie</h3>
    <p class="muted" style="margin:0;font-size:.88rem;max-width:72ch">Demande un thème ou donne une position. Le coach trouve une partie qui l'illustre, la commente coup par coup et s'arrête sur les moments clés pour te faire chercher le coup, puis il explique. Coups vérifiés par chess.js, réponses jugées par Stockfish.</p>
    <div class="fld"><label for="coask">Que veux-tu apprendre ?</label><textarea id="coask" rows="2" class="vta" placeholder="Apprends-moi les plans de la Sicilienne Dragon avec les blancs">${esc(pf&&pf.ask||"")}</textarea></div>
    <div class="coex">${CO_EX.map(x=>`<button class="lm" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <div class="fld"><label for="copos">Position à étudier <small class="muted">(facultatif : FEN ou suite de coups)</small></label><textarea id="copos" rows="2" class="vta mono" placeholder="1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. Be3 Bg7 7. f3">${esc(pf&&pf.moves||"")}</textarea></div>
    <div class="vrow"><div class="fld"><label for="coside">Je joue</label><select id="coside"><option value="auto">D'après ma demande</option><option value="w"${pf&&pf.camp==="w"?" selected":""}>Les blancs</option><option value="b"${pf&&pf.camp==="b"?" selected":""}>Les noirs</option></select></div></div>
    ${inClaude()?`<p class="muted" style="margin:0;font-size:.78rem">Ici, Claude cite les parties de mémoire : la base Lichess Masters n'est accessible que depuis le site.</p>`:`
    <details${liTok()?"":" open"}><summary class="muted" style="cursor:pointer;font-size:.88rem">Base de parties Lichess Masters ${liTok()?"· jeton enregistré":"· recommandé"}</summary>
     <div class="fld" style="margin-top:6px"><label for="cotok">Jeton Lichess <small class="muted">(gratuit, aucune case à cocher)</small></label><input id="cotok" type="password" value="${esc(liTok())}" autocomplete="off" spellcheck="false" placeholder="lip_…" style="width:100%;box-sizing:border-box"></div>
     <p class="muted" style="margin:4px 0 0;font-size:.78rem">Crée-le sur <a href="https://lichess.org/account/oauth/token/create?description=Carnet%20de%20tactique" target="_blank" rel="noopener">lichess.org › Jetons d'accès</a> sans cocher de case. Gardé dans ce navigateur. Avec lui, le coach part d'une vraie partie de maîtres au lieu de la citer de mémoire.</p></details>`}
    <div><button class="btn primary" id="cogo"${noLLM?" disabled":""}>Préparer la leçon</button></div>
    ${noLLM?`<p class="vstat err" style="margin:0">Sur ce site, le coach rédige avec Gemini : ajoute ta clé Gemini dans l'onglet Vidéos. Dans la version Claude du carnet, c'est Claude.</p>`:`<p class="muted" style="margin:0;font-size:.78rem">Leçon rédigée par ${coEngineName()}.</p>`}
    <div id="costat" class="vstat" hidden></div>
  </div>
  ${L.length?`<div class="panel" style="margin-top:16px"><h3>Mes leçons</h3><ul class="vlist">${L.map(x=>{const n=x.quizzes.length,ok=Object.values(x.answers||{}).filter(a=>a.ok).length,dn=Object.keys(x.answers||{}).length;
    return `<li><button class="vitem" data-l="${esc(x.id)}"><span style="padding:4px 6px"><b>${esc(x.title)}</b><br><span class="muted">${esc(x.game.white)} – ${esc(x.game.black)}${x.game.year?` (${esc(x.game.year)})`:""} · ${coSrcLabel(x)} · avec les ${x.camp==="w"?"blancs":"noirs"} · ${dn}/${n} questions${dn?` · ${ok} trouvée${ok>1?"s":""}`:""}</span></span></button></li>`}).join("")}</ul></div>`:""}`;
  box.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{$("#coask").value=b.dataset.ex});
  box.querySelectorAll("[data-l]").forEach(b=>b.onclick=()=>{CO.cur=b.dataset.l;const l=coGet();CO.ply=l&&l.ply||0;renderCoach()});
  $("#cogo").onclick=coStart;
  if($("#cotok"))$("#cotok").onchange=()=>store.set(CO.li,{t:$("#cotok").value.trim()});
  $("#coask").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))coStart()});
}
// numéro de coup affiché : « 14. h4 » ou « 14... Rc8 », y compris pour une leçon qui part d'une FEN
function coLabel(p){if(p<=0)return "position de départ";const f=CO.fens[p-1].split(" "),l=coGet(),san=l?l.game.sans[p-1]:"";return `${f[5]}${f[1]==="w"?".":"..."} ${san}`}
function coViewer(l){
  const box=$("#p-coach"),g=l.game;
  const r=VCore.replay(l.startFen||START(),g.sans);CO.fens=r.fens;CO.ucis=r.ucis;CO.chat=[];CO.quiz=null;
  box.innerHTML=`<div class="panel">
   <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div><h3 style="margin:0">${esc(l.title)}</h3><span class="muted" style="font-size:.85rem">${esc(g.white)}${g.rw?` (${g.rw})`:""} – ${esc(g.black)}${g.rb?` (${g.rb})`:""}${g.event?` · ${esc(g.event)}`:""}${g.year?` (${esc(g.year)})`:""}${g.result?` · ${esc(g.result)}`:""} · ${coSrcLabel(l)}</span></div>
    <button class="btn" id="coback" style="margin-left:auto">← Mes leçons</button>
   </div>
   ${l.src==="memoire"?`<p class="muted" style="margin:0;font-size:.78rem">${esc(l.by)} cite cette partie de mémoire : chaque coup est légal, mais quelques coups peuvent différer de la partie historique.</p>`:""}
   <div class="vview coview">
    <div class="vleft"><div class="boardbox"><div id="coboard" class="cgb"></div></div>
     <div class="rvnav"><button class="btn" id="cofirst" aria-label="Début">⏮</button><button class="btn" id="coprev" aria-label="Coup précédent">◀</button><button class="btn primary" id="conext" aria-label="Coup suivant">▶</button><span class="mono muted" id="coply"></span></div>
     <div class="moves mono" id="comoves" style="font-size:.85rem"></div></div>
    <div class="vright"><div id="copanel" class="rcomment"></div>
     <form class="ask" id="coaskf"><label for="coq" class="muted" style="font-size:.8rem">Une question au coach sur la position affichée ?</label><textarea id="coq" rows="2"></textarea><div><button class="btn" type="submit">Demander</button></div></form>
     <div id="cochat" class="cochat"></div></div>
   </div></div>`;
  CO.cg=Chessground($("#coboard"),{fen:CO.fens[0],orientation:l.camp==="w"?"white":"black",coordinates:true,movable:{free:false,color:undefined,showDests:true,events:{after:coUserMove}},
    draggable:{enabled:true,showGhost:true},premovable:{enabled:false},animation:{enabled:true,duration:160},highlight:{lastMove:true,check:true},drawable:{enabled:true,visible:true}});
  $("#coback").onclick=()=>{CO.cur=null;renderCoach()};
  $("#cofirst").onclick=()=>coGo(0);$("#coprev").onclick=()=>coGo(CO.ply-1);$("#conext").onclick=()=>coNext();
  $("#comoves").onclick=e=>{const b=e.target.closest("[data-p]");if(b)coGo(+b.dataset.p)};
  $("#coaskf").onsubmit=e=>{e.preventDefault();coAsk()};
  coGo(Math.min(l.ply||0,coMaxPly(l)));
}
// on ne peut pas dépasser une question pas encore résolue
function coMaxPly(l){const q=l.quizzes.find(q=>!(l.answers||{})[q.ply]);return q?q.ply-1:l.game.sans.length}
function coNext(){const l=coGet();if(!l||CO.quiz)return;
  const q=l.quizzes.find(q=>q.ply===CO.ply+1);
  if(q&&!(l.answers||{})[q.ply])return coAskQuiz(l,q);
  coGo(CO.ply+1)}
function coGo(p){
  const l=coGet();if(!l)return;CO.quiz=null;
  p=Math.max(0,Math.min(coMaxPly(l),p));CO.ply=p;l.ply=p;coPut(l);
  const u=p>0?CO.ucis[p-1]:null;coBoard(CO.fens[p],u?[u.slice(0,2),u.slice(2,4)]:undefined,false);
  const com=l.comments.filter(c=>c.ply===p).map(c=>c.text),ans=(l.answers||{})[p],q=l.quizzes.find(x=>x.ply===p),focus=l.focus||0;
  let h="";
  if(p===focus)h=`<p style="margin:0"><b>${p?"La position étudiée":"Introduction"}</b></p><p style="margin:4px 0">${esc(l.intro)}</p>${l.stats?`<p class="muted" style="margin:4px 0;font-size:.82rem">${esc(l.stats)}</p>`:""}<p class="muted" style="margin:0;font-size:.85rem">Avance avec ▶. Le coach s'arrêtera ${l.quizzes.length} fois pour te faire chercher le coup des ${l.camp==="w"?"blancs":"noirs"}.${p?" ⏮ remonte au début de la partie.":""}</p>`;
  if(p>0){
    h+=`<div class="muted mono" style="font-size:.82rem">${esc(coLabel(p))}</div>`;
    if(q&&ans)h+=`<div class="coans ${ans.ok?"ok":"ko"}"><b>${ans.ok?"Trouvé":"Le coup de la partie"} : ${esc(q.san)}</b>${ans.mine&&ans.mine!==q.san?` <span class="muted">(tu as proposé ${esc(ans.mine)})</span>`:""}<br>${esc(q.expl)}</div>`;
    if(com.length)h+=com.map(t=>`<p style="margin:6px 0">${esc(t)}</p>`).join("");
    if(!com.length&&!(q&&ans)&&p!==focus)h+=`<p class="muted" style="margin:6px 0">Pas de commentaire sur ce coup.</p>`;
  }
  if(p===l.game.sans.length){const n=l.quizzes.length,ok=l.quizzes.filter(q=>(l.answers||{})[q.ply]&&l.answers[q.ply].ok).length;
    h+=`<div class="stbox"><b>À retenir</b>${l.summary.map(t=>`<span>• ${esc(t)}</span>`).join("")}<span class="muted">Questions trouvées : ${ok}/${n}.${l.game.result?` Résultat de la partie : ${esc(l.game.result)}.`:""}</span></div>`}
  $("#copanel").innerHTML=h;coMoves(l);
  $("#coply").textContent=`${p}/${l.game.sans.length}`;
  $("#conext").disabled=p>=l.game.sans.length;
}
function coMoves(l){
  const s=l.game.sans,mx=CO.ply;let h="";
  for(let i=0;i<mx;i++){const f=CO.fens[i].split(" ");if(f[1]==="w"||i===0)h+=`<span class="muted">${f[5]}.${f[1]==="b"?"..":""}</span> `;const q=l.quizzes.some(x=>x.ply===i+1);h+=`<button class="lm${i+1===CO.ply?" on":""}" data-p="${i+1}">${q?"★ ":""}${esc(s[i])}</button> `}
  $("#comoves").innerHTML=h||'<span class="muted">Position de départ</span>';
}
function coBoard(fen,last,move){
  const c=new Chess(fen),side=c.turn()==="w"?"white":"black";
  CO.cg.set({fen,lastMove:last,check:c.in_check()?side:false,turnColor:side,movable:{color:move?side:undefined,dests:move?dests(fen):new Map()}});
  CO.cg.setAutoShapes([]);
}

/* ---------- les questions ---------- */
function coAskQuiz(l,q){
  CO.quiz={q,tries:0,eval:null};const fen=CO.fens[q.ply-1];
  coBoard(fen,q.ply>1?[CO.ucis[q.ply-2].slice(0,2),CO.ucis[q.ply-2].slice(2,4)]:undefined,true);
  $("#copanel").innerHTML=`<div class="coquiz"><b>À toi de jouer</b> <span class="muted mono" style="font-size:.82rem">(après ${esc(coLabel(q.ply-1))})</span>
    <p style="margin:6px 0">${esc(q.q||`Que jouent les ${l.camp==="w"?"blancs":"noirs"} ?`)}</p>
    <p class="muted" style="margin:0;font-size:.85rem">Joue ton coup sur l'échiquier.</p>
    <div id="cofb"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" id="cohint">Indice</button><button class="btn" id="coreveal">Voir la réponse</button></div></div>`;
  $("#cohint").onclick=()=>{$("#cofb").innerHTML=`<p class="muted" style="margin:6px 0"><b>Indice :</b> ${esc(q.hint||"Cherche le coup qui sert le plan principal de la position.")}</p>`};
  $("#coreveal").onclick=()=>coAnswer(l,q,null,false);
  $("#conext").disabled=true;
  coPrepEval(fen);
}
// Stockfish regarde la position pendant que tu réfléchis
async function coPrepEval(fen){
  try{if(!ENG)ENG=await startEngine();if(!CO.quiz)return;const r=await engineCall(fen,14,3);if(CO.quiz&&CO.fens[CO.quiz.q.ply-1]===fen)CO.quiz.eval=r}catch(e){}
}
async function coUserMove(orig,dest){
  const l=coGet(),Q=CO.quiz;if(!l||!Q)return;const q=Q.q,fen=CO.fens[q.ply-1];
  const c=new Chess(fen),pc=c.get(orig),m=c.move({from:orig,to:dest,promotion:pc&&pc.type==="p"&&(dest[1]==="8"||dest[1]==="1")?"q":undefined});
  if(!m){coBoard(fen,undefined,true);return}
  const u=orig+dest+(m.promotion||"");
  if(u.slice(0,4)===CO.ucis[q.ply-1].slice(0,4))return coAnswer(l,q,m.san,true);
  Q.tries++;const fb=$("#cofb");fb.innerHTML=`<p class="muted" style="margin:6px 0"><span class="spin" aria-hidden="true"></span> Stockfish regarde ${esc(m.san)}…</p>`;
  let verdict=null;
  try{
    if(!ENG)ENG=await startEngine();
    if(!Q.eval)Q.eval=await engineCall(fen,14,3);
    const after=await engineCall(c.fen(),13,1),mine=-after.cp;
    const gl=(Q.eval.lines||[]).find(x=>x.pv&&x.pv[0]&&x.pv[0].slice(0,4)===CO.ucis[q.ply-1].slice(0,4));
    const game=gl?gl.cp:-(await engineCall(CO.fens[q.ply],13,1)).cp,best=Q.eval.cp;
    // aussi bon que le coup de la partie : accepté ; un peu moins bon : « raisonnable, cherche mieux »
    verdict={mine,game,best,ok:mine>=game-15&&mine>=best-40,close:mine>=game-70,line:sanLine(c.fen(),after.pv,4)};
  }catch(e){verdict=null}
  const pov=x=>evfmt(x);
  if(verdict&&verdict.ok)return coAnswer(l,q,m.san,true,`${m.san} est aussi un bon coup (${pov(verdict.mine)} contre ${pov(verdict.game)} pour le coup de la partie). Voici l'idée du coup joué :`);
  coBoard(fen,undefined,true);
  fb.innerHTML=verdict&&verdict.close?`<p class="coans ko" style="margin:6px 0"><b>${esc(m.san)} se joue</b> (${pov(verdict.mine)}), mais il y a plus fort et plus dans l'esprit de la position (${pov(verdict.game)}). ${Q.tries<2?"Cherche encore.":""}</p>`:`<p class="coans ko" style="margin:6px 0"><b>${esc(m.san)} n'est pas le meilleur.</b> ${verdict?`Stockfish : ${pov(verdict.mine)} après ton coup, contre ${pov(verdict.game)} pour le coup de la partie.${verdict.line.length?` Suite probable : <span class="mono">${esc(verdict.line.join(" "))}</span>.`:""}`:""} ${Q.tries<2?"Essaie encore.":""}</p>`;
  if(Q.tries>=2)setTimeout(()=>coAnswer(l,q,m.san,false),1800);
}
function coAnswer(l,q,mine,ok,note){
  l.answers=l.answers||{};l.answers[q.ply]={ok:!!ok,mine:mine||null,at:Date.now()};coPut(l);
  CO.quiz=null;coGo(q.ply);
  if(note){const p=$("#copanel"),d=document.createElement("p");d.className="muted";d.style.margin="0 0 6px";d.textContent=note;p.prepend(d)}
}

/* ---------- questions libres au coach ---------- */
async function coAsk(){
  const l=coGet(),t=$("#coq").value.trim();if(!l||!t)return;$("#coq").value="";
  const at=CO.quiz?CO.quiz.q.ply-1:CO.ply,fen=CO.fens[at];
  CO.chat.push({q:t,a:null});coChat();
  let facts="";
  try{if(!ENG)ENG=await startEngine();const r=await engineCall(fen,13,3),stm=fen.split(" ")[1];
    facts=`Évaluation Stockfish (pour les blancs) et meilleurs coups : ${(r.lines||[]).map(x=>`${sanLine(fen,x.pv,1)[0]} (${evfmt(stm==="w"?x.cp:-x.cp)}) suite ${sanLine(fen,x.pv,5).join(" ")}`).join(" ; ")}.`}catch(e){}
  const hidden=CO.quiz?`Le joueur est en train de chercher le coup de la partie : ne le révèle pas, aide-le seulement à réfléchir.`:"";
  const prompt=`Tu es l'entraîneur d'échecs de la leçon « ${l.title} » (${l.game.white} – ${l.game.black}). Le joueur, environ ${ELO()} Elo en blitz, joue avec les ${l.camp==="w"?"blancs":"noirs"}.
Coups joués jusqu'à la position affichée : ${l.game.sans.slice(0,at).join(" ")||"(position de départ)"}${l.startFen&&l.startFen!==START()?` (à partir de la position ${l.startFen})`:""}
Position (FEN) : ${fen}
${facts}
${hidden}
Question du joueur : « ${t} »
Réponds en français, en 3 à 6 phrases concrètes. Appuie-toi sur les données Stockfish ci-dessus et n'invente pas de variante qui les contredit.`;
  try{CO.chat[CO.chat.length-1].a=await coLLM(prompt,false)}catch(e){CO.chat[CO.chat.length-1].a="Réponse indisponible : "+(e.message||e)}
  coChat();
}
function coChat(){const e=$("#cochat");if(!e)return;e.innerHTML=CO.chat.slice().reverse().map(c=>`<div class="coq"><b>Toi :</b> ${esc(c.q)}</div><div class="coa">${c.a==null?'<span class="spin" aria-hidden="true"></span> Le coach réfléchit…':esc(c.a).replace(/\n/g,"<br>")}</div>`).join("")}
