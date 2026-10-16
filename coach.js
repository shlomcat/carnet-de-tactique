/* Carnet de tactique — Coach : leçons interactives sur une partie modèle.
   Tu demandes un thème (« apprends-moi les plans de la Dragon avec les blancs ») ; le coach choisit une partie,
   la commente coup par coup, s'arrête sur les moments clés pour te faire chercher le coup, puis explique.
   Claude (version Claude du carnet) ou Gemini (site, avec ta clé) rédige la leçon ; chess.js vérifie chaque coup,
   Stockfish juge tes réponses. */
"use strict";
const CO={key:"carnet:lessons",cur:null,ply:0,cg:null,quiz:null,run:false,chat:[],fens:[],ucis:[]};
const CO_EX=["Apprends-moi les plans de la Sicilienne Dragon avec les blancs","L'attaque de minorité dans la structure Carlsbad, avec les blancs","Comment jouer contre le pion isolé avec les noirs","Les plans de la Caro-Kann variante d'avance avec les noirs","La finale de tours Lucena et Philidor"];
function coLessons(){return store.get(CO.key)||[]}
function coSave(L){store.set(CO.key,L.slice(0,40))}
function coGet(){return coLessons().find(x=>x.id===CO.cur)||null}
function coPut(l){coSave(coLessons().map(x=>x.id===l.id?l:x))}

/* ---------- l'IA qui rédige : Claude dans la version Claude, Gemini sur le site ---------- */
function coEngineName(){return SAMPLE?"Claude":"Gemini"}
async function coLLM(prompt,json){
  if(SAMPLE){
    const r=await SAMPLE(prompt,{cache:false,modelTier:"complex"});
    return json?VCore.vParseJSON(r.text):r.text;
  }
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

/* ---------- préparation de la leçon ---------- */
function coSide(txt,sel){if(sel==="w"||sel==="b")return sel;const t=(txt||"").toLowerCase();if(/avec les noirs|côté noir|pour les noirs|en noir/.test(t))return "b";return "w"}
function coPrompt(ask,camp){
  const C=camp==="w"?"blancs":"noirs",elo=(S&&S.games&&S.games[0]&&S.games[0].r)||2300;
  return `Tu es un entraîneur d'échecs expérimenté. Tu prépares une leçon interactive pour un joueur d'environ ${elo} Elo en blitz.
Demande du joueur : « ${ask} »
Le joueur joue avec les ${C} : les questions portent uniquement sur des coups des ${C}.

Choisis UNE partie qui illustre parfaitement ce thème. De préférence une partie réelle célèbre de maîtres que tu connais coup par coup. Si tu n'es pas certain des coups exacts d'une partie réelle, construis une partie modèle crédible, typique du thème, et indique "reelle": false. Ne présente jamais comme réelle une partie dont tu n'es pas sûr.

Réponds UNIQUEMENT par un objet JSON de cette forme :
{
 "titre": "titre court de la leçon",
 "introduction": "4 à 6 phrases : les idées de l'ouverture ou de la structure, les plans typiques des deux camps, ce qu'il faut surveiller",
 "partie": {"blancs": "...", "noirs": "...", "evenement": "...", "annee": "...", "reelle": true, "coups": ["e4", "c5", "Nf3", ...]},
 "commentaires": [{"coup": "9. O-O-O", "texte": "2 à 4 phrases : ce que prépare ce coup, le plan en cours, ce qu'il faut retenir"}],
 "questions": [{"coup": "14. h4", "question": "la question posée au joueur, sans donner la réponse", "indice": "un indice qui oriente sans révéler", "explication": "3 à 5 phrases : pourquoi ce coup, quelles alternatives et pourquoi elles sont moins bonnes"}],
 "resume": ["3 à 5 leçons à retenir, une phrase chacune"]
}
Règles :
- "coups" : toute la partie depuis la position initiale, en notation SAN anglaise (K, Q, R, B, N), sans numéros, au moins 25 coups de chaque camp si possible.
- "coup" dans commentaires et questions : le numéro et le coup tel qu'il est joué dans la partie, par exemple "9. O-O-O" pour les blancs ou "9... Rc8" pour les noirs.
- 8 à 14 commentaires répartis sur toute la partie (ouverture, milieu de jeu, conversion).
- 4 à 6 questions aux moments clés pour les ${C} : rupture de pions, sacrifice thématique, changement de plan, coup prophylactique. Jamais un coup évident ou une simple reprise.
- Écris en français, comme un entraîneur qui parle à son élève.`;
}
function coResolve(ref,sans){const p=VCore.plyOf(ref,sans);return p>0?p:-1}
async function coBuild(ask,camp,say){
  say(`${coEngineName()} prépare la leçon… compte 20 à 60 secondes.`);
  const raw=await coLLM(coPrompt(ask,camp),true);
  const P=raw.partie||{};let r=VCore.replay(VCore.START_FEN,P.coups||[]),fixed=0;
  // un coup impossible : on demande une seule fois la suite corrigée à partir de la position vérifiée
  if(r.bad&&r.sans.length<(P.coups||[]).length-2){
    const n=r.sans.length,fen=r.fens[n];say(`Correction de la partie après ${VCore.plyName(n,r.sans[n-1])}…`);
    try{const fx=await coLLM(`Dans la partie que tu as proposée (${P.blancs||"?"} – ${P.noirs||"?"}), le coup « ${r.bad.san} » est impossible.
Coups vérifiés jusqu'ici : ${r.sans.join(" ")}
Position atteinte (FEN) : ${fen}
Réponds UNIQUEMENT en JSON {"coups": [...]} avec la suite correcte de la partie à partir de cette position (seulement les coups suivants, notation SAN anglaise).`,true);
      const r2=VCore.replay(VCore.START_FEN,r.sans.concat(fx.coups||[]));if(r2.sans.length>r.sans.length){r=r2;fixed=1}}catch(e){}
  }
  if(r.sans.length<16)throw new Error("la partie proposée n'a pas pu être vérifiée (coups impossibles). Relance la demande.");
  const sans=r.sans,me=camp;
  const comments=(raw.commentaires||[]).map(c=>({ply:coResolve(c.coup,sans),text:String(c.texte||"").trim()})).filter(c=>c.ply>0&&c.text);
  const quizzes=(raw.questions||[]).map(q=>({ply:coResolve(q.coup,sans),q:String(q.question||"").trim(),hint:String(q.indice||"").trim(),expl:String(q.explication||"").trim()}))
    .filter(q=>q.ply>0&&((q.ply%2===1)===(me==="w")))
    .map(q=>({...q,san:sans[q.ply-1]}));
  const seen=new Set(),qs=quizzes.filter(q=>!seen.has(q.ply)&&seen.add(q.ply)).sort((a,b)=>a.ply-b.ply);
  return {id:"l"+Date.now().toString(36),at:Date.now(),ask,by:coEngineName(),title:String(raw.titre||ask).trim(),camp,intro:String(raw.introduction||"").trim(),
    game:{white:String(P.blancs||""),black:String(P.noirs||""),event:String(P.evenement||""),year:String(P.annee||""),real:P.reelle!==false,sans,cut:r.bad?r.bad.san:null,fixed},
    comments,quizzes:qs,summary:(raw.resume||[]).map(String),answers:{},ply:0};
}
async function coStart(){
  if(CO.run)return;const ask=$("#coask").value.trim(),st=$("#costat");
  const say=(t,err)=>{st.hidden=false;st.className="vstat"+(err?" err":"");st.textContent=t};
  if(ask.length<8)return say("Décris ce que tu veux apprendre, par exemple « les plans de la Dragon avec les blancs ».",1);
  CO.run=true;$("#cogo").disabled=true;
  try{const l=await coBuild(ask,coSide(ask,$("#coside").value),say);const L=coLessons();L.unshift(l);coSave(L);CO.cur=l.id;CO.ply=0;renderCoach()}
  catch(e){say("Échec : "+(e.message||e),1)}
  finally{CO.run=false;const b=$("#cogo");if(b)b.disabled=false}
}

/* ---------- affichage ---------- */
function renderCoach(){
  const box=$("#p-coach");if(!box)return;
  if(CO.cg){try{CO.cg.destroy()}catch(e){}CO.cg=null}
  const l=coGet();if(l)return coViewer(l);
  const L=coLessons(),noLLM=!SAMPLE&&!vCfg().k;
  box.innerHTML=`<div class="panel">
    <h3>Coach · leçon sur une partie modèle</h3>
    <p class="muted" style="margin:0;font-size:.88rem;max-width:72ch">Dis au coach ce que tu veux apprendre. Il choisit une partie qui illustre le thème, la commente coup par coup et s'arrête sur les moments clés pour te faire chercher le coup, puis il explique. Les coups sont vérifiés par chess.js et tes réponses jugées par Stockfish.</p>
    <div class="fld"><label for="coask">Que veux-tu apprendre ?</label><textarea id="coask" rows="2" class="vta" placeholder="Apprends-moi les plans de la Sicilienne Dragon avec les blancs"></textarea></div>
    <div class="coex">${CO_EX.map(x=>`<button class="lm" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <div class="vrow"><div class="fld"><label for="coside">Je joue</label><select id="coside"><option value="auto">D'après ma demande</option><option value="w">Les blancs</option><option value="b">Les noirs</option></select></div></div>
    <div><button class="btn primary" id="cogo"${noLLM?" disabled":""}>Préparer la leçon</button></div>
    ${noLLM?`<p class="vstat err" style="margin:0">Sur ce site, le coach utilise Gemini : ajoute ta clé Gemini dans l'onglet Vidéos. Dans la version Claude du carnet, c'est Claude qui prépare les leçons.</p>`:`<p class="muted" style="margin:0;font-size:.78rem">Leçon rédigée par ${coEngineName()}.</p>`}
    <div id="costat" class="vstat" hidden></div>
  </div>
  ${L.length?`<div class="panel" style="margin-top:16px"><h3>Mes leçons</h3><ul class="vlist">${L.map(x=>{const n=x.quizzes.length,ok=Object.values(x.answers||{}).filter(a=>a.ok).length,dn=Object.keys(x.answers||{}).length;
    return `<li><button class="vitem" data-l="${esc(x.id)}"><span style="padding:4px 6px"><b>${esc(x.title)}</b><br><span class="muted">${esc(x.game.white)} – ${esc(x.game.black)}${x.game.year?` (${esc(x.game.year)})`:""} · avec les ${x.camp==="w"?"blancs":"noirs"} · ${dn}/${n} questions${dn?` · ${ok} trouvée${ok>1?"s":""}`:""}</span></span></button></li>`}).join("")}</ul></div>`:""}`;
  box.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{$("#coask").value=b.dataset.ex});
  box.querySelectorAll("[data-l]").forEach(b=>b.onclick=()=>{CO.cur=b.dataset.l;const l=coGet();CO.ply=l&&l.ply||0;renderCoach()});
  $("#cogo").onclick=coStart;
  $("#coask").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))coStart()});
}
function coViewer(l){
  const box=$("#p-coach"),g=l.game;
  const r=VCore.replay(VCore.START_FEN,g.sans);CO.fens=r.fens;CO.ucis=r.ucis;CO.chat=[];CO.quiz=null;
  box.innerHTML=`<div class="panel">
   <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div><h3 style="margin:0">${esc(l.title)}</h3><span class="muted" style="font-size:.85rem">${esc(g.white)} – ${esc(g.black)}${g.event?` · ${esc(g.event)}`:""}${g.year?` (${esc(g.year)})`:""} · ${g.real?`partie réelle citée par ${esc(l.by)}`:"partie modèle"} · coups vérifiés</span></div>
    <button class="btn" id="coback" style="margin-left:auto">← Mes leçons</button>
   </div>
   ${g.real?`<p class="muted" style="margin:0;font-size:.78rem">${esc(l.by)} cite cette partie de mémoire : chaque coup est légal, mais quelques coups peuvent différer de la partie historique.</p>`:""}
   <div class="vview coview">
    <div class="vleft"><div class="boardbox"><div id="coboard" class="cgb"></div></div>
     <div class="rvnav"><button class="btn" id="cofirst" aria-label="Début">⏮</button><button class="btn" id="coprev" aria-label="Coup précédent">◀</button><button class="btn primary" id="conext" aria-label="Coup suivant">▶</button><span class="mono muted" id="copos"></span></div>
     <div class="moves mono" id="comoves" style="font-size:.85rem"></div></div>
    <div class="vright"><div id="copanel" class="rcomment"></div>
     <form class="ask" id="coaskf"><label for="coq" class="muted" style="font-size:.8rem">Une question au coach sur la position affichée ?</label><textarea id="coq" rows="2"></textarea><div><button class="btn" type="submit">Demander</button></div></form>
     <div id="cochat" class="cochat"></div></div>
   </div></div>`;
  CO.cg=Chessground($("#coboard"),{fen:VCore.START_FEN,orientation:l.camp==="w"?"white":"black",coordinates:true,movable:{free:false,color:undefined,showDests:true,events:{after:coUserMove}},
    draggable:{enabled:true,showGhost:true},premovable:{enabled:false},animation:{enabled:true,duration:160},highlight:{lastMove:true,check:true},drawable:{enabled:true,visible:true}});
  $("#coback").onclick=()=>{CO.cur=null;renderCoach()};
  $("#cofirst").onclick=()=>coGo(0);$("#coprev").onclick=()=>coGo(CO.ply-1);$("#conext").onclick=()=>coNext();
  $("#comoves").onclick=e=>{const b=e.target.closest("[data-p]");if(b)coGo(+b.dataset.p)};
  $("#coaskf").onsubmit=e=>{e.preventDefault();coAsk()};
  coGo(Math.min(l.ply||0,coMaxPly(l)));
}
// on ne peut pas dépasser une question pas encore résolue
function coMaxPly(l){const q=l.quizzes.find(q=>!(l.answers||{})[q.ply]);return q?q.ply-1:l.game.sans.length}
function coNext(){const l=coGet();if(!l)return;
  if(CO.quiz)return;
  const q=l.quizzes.find(q=>q.ply===CO.ply+1);
  if(q&&!(l.answers||{})[q.ply])return coAskQuiz(l,q);
  coGo(CO.ply+1)}
function coGo(p){
  const l=coGet();if(!l)return;CO.quiz=null;
  p=Math.max(0,Math.min(coMaxPly(l),p));CO.ply=p;l.ply=p;coPut(l);
  const u=p>0?CO.ucis[p-1]:null;coBoard(CO.fens[p],u?[u.slice(0,2),u.slice(2,4)]:undefined,false);
  const com=l.comments.filter(c=>c.ply===p).map(c=>c.text),ans=(l.answers||{})[p],q=l.quizzes.find(x=>x.ply===p);
  let h="";
  if(p===0)h=`<p style="margin:0"><b>Introduction</b></p><p style="margin:4px 0">${esc(l.intro)}</p><p class="muted" style="margin:0;font-size:.85rem">Avance avec ▶. Le coach s'arrêtera ${l.quizzes.length} fois pour te faire chercher le coup des ${l.camp==="w"?"blancs":"noirs"}.</p>`;
  else{
    h=`<div class="muted mono" style="font-size:.82rem">${esc(VCore.plyName(p,l.game.sans[p-1]))}</div>`;
    if(q&&ans)h+=`<div class="coans ${ans.ok?"ok":"ko"}"><b>${ans.ok?"Trouvé":"Le coup de la partie"} : ${esc(q.san)}</b>${ans.mine&&ans.mine!==q.san?` <span class="muted">(tu as proposé ${esc(ans.mine)})</span>`:""}<br>${esc(q.expl)}</div>`;
    if(com.length)h+=com.map(t=>`<p style="margin:6px 0">${esc(t)}</p>`).join("");
    if(!com.length&&!(q&&ans))h+=`<p class="muted" style="margin:6px 0">Pas de commentaire sur ce coup.</p>`;
  }
  if(p===l.game.sans.length){const n=l.quizzes.length,ok=l.quizzes.filter(q=>(l.answers||{})[q.ply]&&l.answers[q.ply].ok).length;
    h+=`<div class="stbox"><b>À retenir</b>${l.summary.map(t=>`<span>• ${esc(t)}</span>`).join("")}<span class="muted">Questions trouvées : ${ok}/${n}.</span></div>`}
  $("#copanel").innerHTML=h;coMoves(l);
  $("#copos").textContent=`${p}/${l.game.sans.length}`;
  const nb=$("#conext");nb.disabled=p>=l.game.sans.length;
}
function coMoves(l){
  const s=l.game.sans,mx=CO.ply;let h="";
  for(let i=0;i<mx;i++){if(i%2===0)h+=`<span class="muted">${i/2+1}.</span> `;const q=l.quizzes.some(x=>x.ply===i+1);h+=`<button class="lm${i+1===CO.ply?" on":""}" data-p="${i+1}">${q?"★ ":""}${esc(s[i])}</button> `}
  $("#comoves").innerHTML=h||'<span class="muted">Position initiale</span>';
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
  $("#copanel").innerHTML=`<div class="coquiz"><b>À toi de jouer</b> <span class="muted mono" style="font-size:.82rem">(${esc(VCore.plyName(q.ply-1,l.game.sans[q.ply-2]))})</span>
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
  const fen=CO.quiz?CO.fens[CO.quiz.q.ply-1]:CO.fens[CO.ply];
  CO.chat.push({q:t,a:null});coChat();
  let facts="";
  try{if(!ENG)ENG=await startEngine();const r=await engineCall(fen,13,3),stm=fen.split(" ")[1];
    facts=`Évaluation Stockfish (pour les blancs) et meilleurs coups : ${(r.lines||[]).map(x=>`${sanLine(fen,x.pv,1)[0]} (${evfmt(stm==="w"?x.cp:-x.cp)}) suite ${sanLine(fen,x.pv,5).join(" ")}`).join(" ; ")}.`}catch(e){}
  const hidden=CO.quiz?`Le joueur est en train de chercher le coup de la partie : ne le révèle pas, aide-le seulement à réfléchir.`:"";
  const prompt=`Tu es l'entraîneur d'échecs de la leçon « ${l.title} » (${l.game.white} – ${l.game.black}). Le joueur, environ 2300 Elo en blitz, joue avec les ${l.camp==="w"?"blancs":"noirs"}.
Coups joués jusqu'à la position affichée : ${l.game.sans.slice(0,CO.quiz?CO.quiz.q.ply-1:CO.ply).join(" ")||"(position initiale)"}
Position (FEN) : ${fen}
${facts}
${hidden}
Question du joueur : « ${t} »
Réponds en français, en 3 à 6 phrases concrètes. Appuie-toi sur les données Stockfish ci-dessus et n'invente pas de variante qui les contredit.`;
  try{CO.chat[CO.chat.length-1].a=await coLLM(prompt,false)}catch(e){CO.chat[CO.chat.length-1].a="Réponse indisponible : "+(e.message||e)}
  coChat();
}
function coChat(){const e=$("#cochat");if(!e)return;e.innerHTML=CO.chat.map(c=>`<div class="coq"><b>Toi :</b> ${esc(c.q)}</div><div class="coa">${c.a==null?'<span class="spin" aria-hidden="true"></span> Le coach réfléchit…':esc(c.a).replace(/\n/g,"<br>")}</div>`).join("")}
