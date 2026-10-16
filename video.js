/* Carnet de tactique — import de vidéos pédagogiques (YouTube) via l'API Gemini.
   La clé Gemini reste dans ce navigateur (localStorage) et n'est envoyée qu'à Google.
   Gemini regarde la vidéo et renvoie la partie + les commentaires horodatés ;
   chess.js vérifie chaque coup, Stockfish évalue chaque position retenue. */
"use strict";
const VID={key:"carnet:gemini",lib:"carnet:videos",gh:"carnet:github",shared:[],cur:null,m:0,cg:null,run:false,vfen:null};
const GMODELS=[["gemini-3.8-flash","Gemini 3.8 Flash (recommandé)"],["gemini-4-argon","Gemini 4 Argon (plus fin, plus lent)"],["gemini-3.6-flash","Gemini 3.6 Flash"],["gemini-3.5-flash-lite","Gemini 3.5 Flash-Lite (rapide)"]];
const START_FEN="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function vCfg(){return Object.assign({k:"",model:GMODELS[0][0]},store.get(VID.key)||{})}
function vLocal(){return store.get(VID.lib)||[]}
// bibliothèque = vidéos de ce navigateur + vidéos partagées (fichier videos.json du dépôt)
function vLib(){const L=vLocal(),ids=new Set(L.map(x=>x.id));return L.concat(VID.shared.filter(x=>!ids.has(x.id)).map(x=>Object.assign(x,{shared:true})))}
function vSave(lib){store.set(VID.lib,lib.filter(x=>!x.shared));VID.sig=null}
function ytId(u){const m=String(u||"").match(/(?:youtu\.be\/|v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);return m?m[1]:null}
function toSec(s){if(s==null||s==="")return null;if(typeof s==="number")return s;const p=String(s).trim().split(":").map(Number);if(p.some(isNaN))return null;return p.reduce((a,b)=>a*60+b,0)}
function fmtT(s){s=Math.max(0,Math.round(s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,"0");return h?`${h}:${String(m).padStart(2,"0")}:${x}`:`${m}:${x}`}

/* ---------- appel Gemini ---------- */
const VSCHEMA={type:"OBJECT",properties:{
  titre:{type:"STRING"},
  partie:{type:"OBJECT",properties:{blancs:{type:"STRING"},noirs:{type:"STRING"},evenement:{type:"STRING"},
    coups:{type:"ARRAY",items:{type:"STRING"},description:"Coups de la partie principale en SAN anglaise, dans l'ordre, sans numéros."}}},
  moments:{type:"ARRAY",items:{type:"OBJECT",properties:{
    t:{type:"STRING",description:"Horodatage MM:SS ou H:MM:SS"},
    coup:{type:"STRING",description:"Dernier coup joué sur l'échiquier de la partie à ce moment, avec son numéro : '23. Nf3' ou '23... Nf6'. Vide si la partie n'a pas commencé."},
    fen:{type:"STRING",description:"FEN seulement si la position montrée n'est pas une position de la partie principale (exercice, autre partie)."},
    commentaire:{type:"STRING"},
    idee:{type:"STRING"},
    variantes:{type:"ARRAY",items:{type:"OBJECT",properties:{coups:{type:"ARRAY",items:{type:"STRING"}},verdict:{type:"STRING"}}}}},
   required:["t","commentaire"]}}},required:["moments"]};

function vPrompt(o){
  return [
   "Tu regardes une vidéo pédagogique d'échecs où un commentateur explique une ou plusieurs parties sur un échiquier visible à l'écran.",
   "Extrais, en JSON :",
   "1. partie.coups : la suite complète des coups de la partie principale montrée, en notation SAN anglaise (K, Q, R, B, N ; ex. Nf3, exd5, O-O, e8=Q), sans numéros. Lis l'échiquier et, s'il y en a, la liste des coups affichée à l'écran. Ne devine pas : arrête-toi si tu n'es pas sûr.",
   "2. moments : chaque passage où le commentateur explique quelque chose d'instructif (un plan, une erreur, une idée stratégique, une tactique, un calcul). Pour chacun :",
   "   - t : l'horodatage du début du passage ;",
   "   - coup : le dernier coup joué sur l'échiquier de la partie à ce moment, avec numéro (ex. « 14... Bd6 ») ;",
   "   - commentaire : en français, 2 à 4 phrases qui résument fidèlement l'explication (le pourquoi, pas seulement le quoi). Reformule, ne recopie pas mot pour mot ;",
   "   - idee : le thème en quelques mots (ex. « case faible d5 », « attaque de minorité », « pion isolé bloqué ») ;",
   "   - variantes : les suites que le commentateur montre ou cite à partir de cette position, en SAN anglaise, avec son verdict en quelques mots.",
   "Ne note que ce qui est réellement dit ou montré dans la vidéo. N'invente aucun coup.",
   o.prev&&o.prev.length?`Coups déjà joués avant ce passage (à continuer, ne pas répéter) : ${o.prev.join(" ")}.`:"",
   o.pgn?`La partie est connue, utilise cette liste de coups comme référence et concentre-toi sur les commentaires : ${o.pgn.join(" ")}.`:"",
   o.from!=null?`Ne traite que le passage de ${fmtT(o.from)} à ${fmtT(o.to)} ; les horodatages restent ceux de la vidéo complète.`:""
  ].filter(Boolean).join("\n");
}
async function gemini(cfg,url,o){
  const part={fileData:{fileUri:url}};
  if(o.from!=null)part.videoMetadata={startOffset:Math.round(o.from)+"s",endOffset:Math.round(o.to)+"s"};
  const body=s=>({contents:[{parts:[part,{text:vPrompt(o)}]}],generationConfig:Object.assign({responseMimeType:"application/json",temperature:0.2},s?{responseSchema:VSCHEMA}:{})});
  const call=async s=>{
    let r;
    try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.k},body:JSON.stringify(body(s))})}
    catch(e){throw new Error("Impossible de joindre l'API Gemini depuis cette page (réseau ou page hébergée qui bloque les appels externes). Utilise le site GitHub.")}
    const j=await r.json().catch(()=>({}));
    if(!r.ok){const m=(j.error&&j.error.message)||("HTTP "+r.status);const e=new Error(m);e.status=r.status;throw e}
    const c=j.candidates&&j.candidates[0];
    const txt=(c&&c.content&&c.content.parts||[]).map(p=>p.text||"").join("");
    if(!txt)throw new Error("Réponse vide de Gemini"+(c&&c.finishReason?` (${c.finishReason})`:"")+". La vidéo est-elle publique ?");
    return {data:vParseJSON(txt),usage:j.usageMetadata||null};
  };
  try{return await call(true)}
  catch(e){if(e.status===400&&/schema|response_schema|responseSchema|Invalid JSON payload/i.test(e.message))return call(false);throw e}
}
function vParseJSON(t){
  t=String(t).trim().replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"");
  try{return JSON.parse(t)}catch(e){const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a)return JSON.parse(t.slice(a,b+1));throw new Error("Gemini n'a pas renvoyé de JSON lisible")}
}

/* ---------- vérification avec chess.js ---------- */
const cleanSan=s=>String(s||"").replace(/^\s*\d+\s*\.+\s*/,"").replace(/[!?]+$/,"").replace(/0-0-0/g,"O-O-O").replace(/0-0/g,"O-O").trim();
function replay(fen,sans){
  const c=new Chess(fen),ok=[],fens=[c.fen()],ucis=[];let bad=null;
  for(const s0 of sans||[]){const s=cleanSan(s0);if(!s||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s))continue;
    const m=c.move(s,{sloppy:true});if(!m){bad={i:ok.length,san:s0};break}
    ok.push(m.san);ucis.push(m.from+m.to+(m.promotion||""));fens.push(c.fen())}
  return {sans:ok,fens,ucis,bad};
}
function pgnMoves(txt){
  if(!txt||!txt.trim())return null;
  const c=new Chess();if(c.load_pgn(txt,{sloppy:true}))return c.history();
  const toks=txt.replace(/\{[^}]*\}|\([^)]*\)|\[[^\]]*\]|\$\d+/g," ").split(/\s+/).map(cleanSan).filter(s=>s&&!/^\d+\.*$/.test(s));
  return replay(START_FEN,toks).sans;
}
// "23... Nf6" -> ply 46 (index dans fens), en vérifiant que le coup correspond
function plyOf(ref,sans){
  if(!ref)return 0;const m=String(ref).match(/(\d+)\s*(\.\.\.|\.)?\s*(\S+)?/);const san=cleanSan(m&&m[3]?m[3]:ref);
  if(m&&m[1]){const n=+m[1],black=m[2]==="..."||/\.\.\./.test(ref),p=(n-1)*2+(black?2:1);
    if(p<=sans.length&&(!san||sans[p-1]===san||sans[p-1].replace(/[+#]/,"")===san.replace(/[+#]/,"")))return p;
    for(let d=1;d<=6;d++)for(const q of [p-d,p+d])if(q>=1&&q<=sans.length&&sans[q-1].replace(/[+#]/,"")===san.replace(/[+#]/,""))return q;
    return p<=sans.length?-p:-1}
  const k=sans.findIndex(s=>s.replace(/[+#]/,"")===san.replace(/[+#]/,""));return k>=0?k+1:-1;
}
function vBuild(raw,o){
  const own=o.pgn&&o.pgn.length?o.pgn:null;
  const main=replay(START_FEN,own||(raw.partie&&raw.partie.coups)||[]);
  const ms=[];
  for(const x of raw.moments||[]){
    const sec=toSec(x.t);if(sec==null)continue;
    let fen=null,ply=null,warn=[];
    if(x.fen){const c=new Chess();if(c.load(String(x.fen).trim()))fen=c.fen();else warn.push("FEN illisible")}
    if(!fen){const p=plyOf(x.coup,main.sans);
      if(p>=0){ply=p;fen=main.fens[p]}else{ply=Math.min(-p,main.sans.length);fen=main.fens[Math.max(0,ply)];warn.push(`coup « ${x.coup} » non retrouvé dans la partie`)}}
    const vars=(x.variantes||[]).map(v=>{const r=replay(fen,v.coups||[]);return {sans:r.sans,ucis:r.ucis,bad:r.bad?r.bad.san:null,verdict:String(v.verdict||"")}}).filter(v=>v.sans.length||v.bad);
    ms.push({sec,t:fmtT(sec),ref:String(x.coup||""),ply,fen,comment:String(x.commentaire||"").trim(),idea:String(x.idee||"").trim(),vars,warn});
  }
  ms.sort((a,b)=>a.sec-b.sec);
  return {main,ms};
}

/* ---------- moteur ---------- */
async function vEval(v,onStep){
  if(typeof busy!=="undefined"&&busy)return;
  if(!ENG)ENG=await startEngine();
  for(let i=0;i<v.moments.length;i++){const m=v.moments[i];if(m.ev!=null||!m.fen)continue;
    const c=new Chess(m.fen);if(c.game_over()){m.ev=c.in_checkmate()?(c.turn()==="w"?-1500:1500):0;continue}
    onStep&&onStep(i);
    try{const r=await engineCall(m.fen,12,1),w=c.turn()==="w"?r.cp:-r.cp;m.ev=w;
      const u=r.pv&&r.pv[0];if(u){const mv=c.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||"q"});if(mv)m.best=mv.san}
      for(const x of m.vars){if(!x.sans.length||x.ev!=null)continue;const e=new Chess(m.fen);x.sans.forEach(s=>e.move(s));if(e.game_over()){x.ev=e.in_checkmate()?(e.turn()==="w"?-1500:1500):0;continue}
        const q=await engineCall(e.fen(),11,1);x.ev=e.turn()==="w"?q.cp:-q.cp}
    }catch(e){break}
  }
}
const evW=cp=>cp==null?"":cp>=1400?"mat (blancs)":cp<=-1400?"mat (noirs)":(cp>0?"+":"")+(cp/100).toFixed(1).replace(".",",");

/* ---------- import ---------- */
async function vImport(){
  const cfg=vCfg(),url=$("#vurl").value.trim(),id=ytId(url),st=$("#vstat");
  const say=(t,err)=>{st.hidden=false;st.className="vstat"+(err?" err":"");st.textContent=t};
  if(!cfg.k)return say("Ajoute d'abord ta clé Gemini ci-dessus.",1);
  if(!id)return say("Lien YouTube non reconnu.",1);
  if(!$("#vok").checked)return say("Coche la case sur les droits de la vidéo : seules les vidéos sous licence CC BY, ou avec l'accord de leur auteur, peuvent être importées.",1);
  if(VID.run)return;
  const from=toSec($("#vfrom").value),to=toSec($("#vto").value),pgn=pgnMoves($("#vpgn").value);
  if($("#vpgn").value.trim()&&!(pgn&&pgn.length))return say("Le PGN fourni est illisible.",1);
  if(from!=null&&to!=null&&to<=from)return say("La fin doit être après le début.",1);
  const yurl="https://www.youtube.com/watch?v="+id;
  const chunks=[];if(from!=null&&to!=null){const L=480;for(let a=from;a<to;a+=L)chunks.push([a,Math.min(to,a+L)])}else chunks.push([from,to]);
  VID.run=true;$("#vgo").disabled=true;
  const raw={titre:"",partie:{coups:[]},moments:[],cut:null};let tok=0;
  try{
    for(let k=0;k<chunks.length;k++){
      const [a,b]=chunks[k];
      say(chunks.length>1?`Gemini regarde la vidéo : passage ${k+1}/${chunks.length} (${fmtT(a)}–${fmtT(b)})… compte 1 à 3 minutes par passage.`:"Gemini regarde la vidéo… compte 1 à 3 minutes selon la durée.");
      const o={pgn,prev:pgn?null:replay(START_FEN,raw.partie.coups).sans};
      if(a!=null||b!=null){o.from=a||0;o.to=b!=null?b:a+3600}
      const {data,usage}=await gemini(cfg,yurl,o);
      if(usage&&usage.totalTokenCount)tok+=usage.totalTokenCount;
      if(data.titre&&!raw.titre)raw.titre=data.titre;
      const p=data.partie||{};["blancs","noirs","evenement"].forEach(f=>{if(p[f]&&!raw.partie[f])raw.partie[f]=p[f]});
      if(p.coups&&p.coups.length){const prev=raw.partie.coups,nw=p.coups.map(cleanSan);
        // Gemini peut répéter le début : on garde la plus longue suite légale
        const J=replay(START_FEN,prev.concat(nw)),A=replay(START_FEN,nw),best=A.sans.length>J.sans.length?A:J;
        if(best.sans.length>prev.length){raw.partie.coups=best.sans;raw.cut=best.bad?best.bad.san:null}else if(!raw.cut&&J.bad)raw.cut=J.bad.san}
      raw.moments.push(...(data.moments||[]));
    }
    const {main,ms}=vBuild(raw,{pgn});
    if(!ms.length)throw new Error("Gemini n'a trouvé aucun moment commenté. Essaie un autre passage ou le modèle Argon.");
    const v={id:id+"-"+Date.now().toString(36),vid:id,url:yurl,at:Date.now(),model:cfg.model,tokens:tok,
      title:raw.titre||$("#vtitle").value.trim()||"Vidéo "+id,author:$("#vauthor").value.trim(),license:$("#vlic").value,
      game:{white:raw.partie.blancs||"",black:raw.partie.noirs||"",event:raw.partie.evenement||"",sans:main.sans,given:!!pgn,cut:main.bad?main.bad.san:(pgn?null:raw.cut)},
      moments:ms};
    if($("#vtitle").value.trim())v.title=$("#vtitle").value.trim();
    const lib=vLocal();lib.unshift(v);vSave(lib);
    say(`${ms.length} moments extraits, ${main.sans.length} coups vérifiés${v.game.cut?` (liste coupée au coup illégal « ${v.game.cut} »)`:""}. Évaluation Stockfish en cours…`);
    VID.cur=v.id;VID.m=0;renderVideo();
    await vEval(v,i=>{const e=$("#vstat");if(e)e.textContent=`Évaluation Stockfish : moment ${i+1}/${v.moments.length}…`});
    vSave(vLib().map(x=>x.id===v.id?v:x));
    const e=$("#vstat");if(e){e.textContent=`Terminé : ${ms.length} moments, ${main.sans.length} coups vérifiés${tok?` · ${Math.round(tok/1000)} k jetons`:""}.`}
    if(VID.cur===v.id)vShowMoment(VID.m);
  }catch(e){say("Échec : "+e.message,1)}
  finally{VID.run=false;const b=$("#vgo");if(b)b.disabled=false}
}

/* ---------- affichage ---------- */
function renderVideo(){
  const box=$("#p-video");if(!box)return;
  if(VID.cg){try{VID.cg.destroy()}catch(e){}VID.cg=null}
  const v=VID.cur&&vLib().find(x=>x.id===VID.cur);
  if(v)return vViewer(v);
  const cfg=vCfg(),lib=vLib(),n=lib.reduce((a,x)=>a+x.moments.length,0);
  box.innerHTML=`<div class="vgrid">
   <div class="panel">
    <h3>Importer une vidéo pédagogique</h3>
    <p class="muted" style="margin:0;font-size:.88rem;max-width:70ch">Gemini (Google) regarde la vidéo YouTube et en extrait la partie et les explications horodatées. Chaque coup est vérifié avec chess.js, chaque position est évaluée par Stockfish. Les exemples restent dans ce navigateur.</p>
    <div class="fld"><label for="vurl">Lien YouTube (vidéo publique)</label><input id="vurl" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" spellcheck="false"></div>
    <div class="vrow">
     <div class="fld"><label for="vauthor">Auteur / chaîne</label><input id="vauthor" autocomplete="off"></div>
     <div class="fld"><label for="vlic">Droits</label><select id="vlic"><option value="CC BY">Licence CC BY</option><option value="accord">Accord de l'auteur</option></select></div>
    </div>
    <div class="vrow">
     <div class="fld"><label for="vtitle">Titre <small class="muted">(facultatif)</small></label><input id="vtitle" autocomplete="off"></div>
     <div class="fld"><label for="vfrom">Début <small class="muted">mm:ss</small></label><input id="vfrom" inputmode="numeric" placeholder="0:00" class="mono"></div>
     <div class="fld"><label for="vto">Fin <small class="muted">mm:ss</small></label><input id="vto" inputmode="numeric" placeholder="tout" class="mono"></div>
    </div>
    <details><summary class="muted" style="cursor:pointer;font-size:.88rem">PGN de la partie, si tu le connais (plus fiable)</summary>
     <textarea id="vpgn" rows="4" class="mono vta" placeholder="1. e4 c6 2. d4 d5 …"></textarea></details>
    <label class="chk"><input type="checkbox" id="vok"> La vidéo est sous licence CC BY, ou j'ai l'accord de son auteur.</label>
    <div><button class="btn primary" id="vgo">Analyser la vidéo</button></div>
    <div id="vstat" class="vstat" hidden></div>
    <p class="muted" style="margin:0;font-size:.78rem">Pour une longue vidéo, indique début et fin : elle est découpée en passages de 8 minutes, plus précis. Sur YouTube, la licence s'affiche sous la description (« Licence Creative Commons Attribution »).</p>
   </div>
   <div class="panel${cfg.k?"":" needkey"}">
    <h3>Clé Gemini</h3>
    <div class="fld"><label for="vkey">Clé API Google AI Studio</label><input id="vkey" type="password" autocomplete="off" spellcheck="false" value="${esc(cfg.k)}" placeholder="AIza…"></div>
    <div class="fld"><label for="vmodel">Modèle</label><select id="vmodel">${GMODELS.map(([id,l])=>`<option value="${id}"${id===cfg.model?" selected":""}>${esc(l)}</option>`).join("")}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="vksave">Enregistrer</button>${cfg.k?`<button class="btn" id="vkdel">Oublier la clé</button>`:""}</div>
    <p class="muted" style="margin:0;font-size:.8rem">Crée une clé gratuite sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Elle est gardée seulement dans ce navigateur et envoyée uniquement à Google. ${cfg.k?"<b>Clé enregistrée.</b>":""}</p>
   </div>
  </div>
  <div class="panel" style="margin-top:16px">
   <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
    <h3>Bibliothèque · ${lib.length} vidéo${lib.length>1?"s":""}, ${n} exemple${n>1?"s":""}</h3>
    <div style="display:flex;gap:8px"><button class="btn" id="vexp"${lib.length?"":" disabled"}>Exporter</button><label class="btn" for="vimp" style="display:inline-block">Importer un fichier<input type="file" id="vimp" accept="application/json,.json" hidden></label></div>
   </div>
   ${lib.length?`<ul class="vlist">${lib.map(x=>`<li><button class="vitem" data-v="${esc(x.id)}"><img src="https://i.ytimg.com/vi/${esc(x.vid)}/mqdefault.jpg" alt="" loading="lazy" width="120" height="68"><span><b>${esc(x.title)}</b><br><span class="muted">${esc(x.author||"auteur non renseigné")} · ${x.moments.length} moments · ${x.game.sans.length} coups${VID.shared.some(y=>y.id===x.id)?" · <b>partagée</b>":" · sur cet appareil"}${x.game.white||x.game.black?` · ${esc(x.game.white)}–${esc(x.game.black)}`:""}</span></span></button></li>`).join("")}</ul>`
    :`<p class="muted" style="margin:0">Aucune vidéo importée pour l'instant.</p>`}
  </div>
  ${ghPanelHTML(lib)}`;
  const kv=()=>({k:$("#vkey").value.trim(),model:$("#vmodel").value});
  $("#vksave").onclick=()=>{store.set(VID.key,kv());renderVideo()};
  $("#vmodel").onchange=()=>store.set(VID.key,Object.assign(vCfg(),{model:$("#vmodel").value}));
  if($("#vkdel"))$("#vkdel").onclick=()=>{try{localStorage.removeItem(VID.key)}catch(e){}renderVideo()};
  $("#vgo").onclick=()=>{if($("#vkey").value.trim()&&$("#vkey").value.trim()!==vCfg().k)store.set(VID.key,kv());vImport()};
  box.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{VID.cur=b.dataset.v;VID.m=0;renderVideo()});
  $("#vexp").onclick=vExport;ghBind();
  $("#vimp").onchange=e=>{const f=e.target.files[0];if(!f)return;f.text().then(t=>{const d=JSON.parse(t),arr=Array.isArray(d)?d:d.videos||[];const lib=vLib(),ids=new Set(lib.map(x=>x.id));
    arr.filter(x=>x&&x.id&&x.moments&&!ids.has(x.id)).forEach(x=>lib.push(x));vSave(lib);renderVideo()}).catch(()=>alert("Fichier illisible"))};
}
function vExport(){
  const blob=new Blob([JSON.stringify({format:"carnet-videos",version:1,videos:vLib()},null,1)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="carnet-videos.json";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
function vViewer(v){
  const box=$("#p-video");
  box.innerHTML=`<div class="panel">
   <div class="rhead" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div><h3 style="margin:0">${esc(v.title)}</h3><span class="muted" style="font-size:.85rem">${esc(v.author||"auteur non renseigné")} · ${esc(v.license)} · <a href="${esc(v.url)}" target="_blank" rel="noopener">voir sur YouTube</a>${v.game.white||v.game.black?` · ${esc(v.game.white)} – ${esc(v.game.black)}`:""}</span></div>
    <button class="btn" id="vback" style="margin-left:auto">← Bibliothèque</button>
   </div>
   ${v.game.cut?`<p class="vstat err" style="margin:0">La liste de coups lue par Gemini contenait un coup illégal (« ${esc(v.game.cut)} ») : la partie s'arrête au coup ${v.game.sans.length}. Colle le PGN pour fiabiliser.</p>`:""}
   <div id="vstat" class="vstat" hidden></div>
   <div class="vview">
    <div class="vleft"><div class="boardbox"><div id="vboard" class="cgb"></div></div>
     <div class="rvnav"><button class="btn" id="vprev" aria-label="Moment précédent">◀</button><span class="mono muted" id="vpos"></span><button class="btn" id="vnext" aria-label="Moment suivant">▶</button><button class="btn" id="vflip" title="Retourner l'échiquier">⇅</button></div></div>
    <div class="vright"><div id="vmom" class="rcomment"></div>
     <ol class="vmoms" id="vmoms">${v.moments.map((m,k)=>`<li><button data-m="${k}"><span class="mono">${m.t}</span> ${esc(m.idea||m.comment.slice(0,60))}</button></li>`).join("")}</ol>
     <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="veval">Évaluer avec Stockfish</button>${VID.shared.some(y=>y.id===v.id)?`<span class="muted" style="font-size:.8rem;align-self:center">Vidéo partagée dans le dépôt GitHub</span>`:`<button class="btn" id="vdel">Supprimer la vidéo</button>`}</div>
    </div>
   </div></div>`;
  VID.cg=Chessground($("#vboard"),{fen:START_FEN,coordinates:true,viewOnly:true,animation:{enabled:true,duration:140},drawable:{enabled:true,visible:true}});
  $("#vback").onclick=()=>{VID.cur=null;renderVideo()};
  $("#vprev").onclick=()=>vShowMoment(VID.m-1);$("#vnext").onclick=()=>vShowMoment(VID.m+1);
  $("#vflip").onclick=()=>VID.cg&&VID.cg.toggleOrientation();
  $("#vmoms").onclick=e=>{const b=e.target.closest("[data-m]");if(b)vShowMoment(+b.dataset.m)};
  if($("#vdel"))$("#vdel").onclick=()=>{if(!confirm("Supprimer cette vidéo et ses exemples ?"))return;vSave(vLib().filter(x=>x.id!==v.id));VID.cur=null;renderVideo()};
  $("#veval").onclick=async()=>{const b=$("#veval");b.disabled=true;const st=$("#vstat");st.hidden=false;st.className="vstat";
    try{await vEval(v,i=>st.textContent=`Évaluation Stockfish : moment ${i+1}/${v.moments.length}…`);vSave(vLib().map(x=>x.id===v.id?v:x));st.textContent="Évaluations à jour.";vShowMoment(VID.m)}
    catch(e){st.className="vstat err";st.textContent="Moteur : "+e.message}finally{b.disabled=false}};
  if(v.moments.every(m=>m.ev!=null))$("#veval").hidden=true;
  vShowMoment(VID.m||0);
}
function vShowMoment(k){
  const v=vLib().find(x=>x.id===VID.cur);if(!v||!v.moments.length)return;
  k=Math.max(0,Math.min(v.moments.length-1,k));VID.m=k;VID.vfen=null;const m=v.moments[k];
  const last=m.ply>0&&m.fen?(()=>{const r=replay(START_FEN,v.game.sans.slice(0,m.ply));const u=r.ucis[r.ucis.length-1];return u?[u.slice(0,2),u.slice(2,4)]:undefined})():undefined;
  vBoard(m.fen,last);
  const ref=m.ply!=null&&m.ply>0?`après ${Math.ceil(m.ply/2)}${m.ply%2?".":"..."} ${esc(v.game.sans[m.ply-1]||"")}`:m.ply===0?"position de départ":"position hors partie";
  $("#vmom").innerHTML=`<div class="muted" style="font-size:.82rem;display:flex;gap:8px;flex-wrap:wrap"><a class="mono" href="${esc(v.url)}&t=${m.sec}s" target="_blank" rel="noopener">▶ ${m.t}</a><span>${ref}</span>${m.ev!=null?`<span class="mono">Stockfish ${evW(m.ev)}${m.best?` · meilleur ${esc(m.best)}`:""}</span>`:""}</div>
   ${m.idea?`<p style="margin:6px 0 2px"><b>${esc(m.idea)}</b></p>`:""}<p style="margin:4px 0">${esc(m.comment)}</p>
   ${m.vars.length?`<div class="vvars">${m.vars.map((x,j)=>`<div><button class="lm" data-var="${j}">${esc(x.sans.join(" "))}</button>${x.bad?` <span class="flag" title="Coup illégal, variante coupée">coupée à « ${esc(x.bad)} »</span>`:""}${x.verdict?` <span class="muted">— ${esc(x.verdict)}</span>`:""}${x.ev!=null?` <span class="mono muted">(${evW(x.ev)})</span>`:""}</div>`).join("")}</div>`:""}
   ${m.warn&&m.warn.length?`<p class="flag" style="margin:4px 0 0">${esc(m.warn.join(" · "))}</p>`:""}`;
  $("#vmom").querySelectorAll("[data-var]").forEach(b=>b.onclick=()=>vPlayVar(m,+b.dataset.var));
  $("#vpos").textContent=`${k+1}/${v.moments.length}`;
  document.querySelectorAll("#vmoms button").forEach((b,j)=>b.classList.toggle("on",j===k));
}
function vBoard(fen,last){if(!VID.cg||!fen)return;const c=new Chess(fen);VID.cg.set({fen,lastMove:last,check:c.in_check()?(c.turn()==="w"?"white":"black"):false,turnColor:c.turn()==="w"?"white":"black"})}
// rejoue la variante coup par coup sur l'échiquier
async function vPlayVar(m,j){
  const x=m.vars[j];if(!x)return;const tag=VID.vfen=Symbol();vBoard(m.fen);
  const r=replay(m.fen,x.sans);
  for(let i=0;i<r.ucis.length;i++){await new Promise(z=>setTimeout(z,520));if(VID.vfen!==tag)return;const u=r.ucis[i];vBoard(r.fens[i+1],[u.slice(0,2),u.slice(2,4)])}
}
// exemples à plat, pour la recherche d'exemples similaires plus tard
function videoExamples(){return vLib().flatMap(v=>v.moments.filter(m=>m.fen&&m.comment).map(m=>({fen:m.fen,comment:m.comment,idea:m.idea,vars:m.vars.map(x=>x.sans.join(" ")),ev:m.ev,src:`${v.author||"?"} — ${v.title} (${m.t}) ${v.url}&t=${m.sec}s`})))}

/* ---------- bibliothèque partagée : videos.json dans le dépôt GitHub ---------- */
function ghCfg(){return Object.assign({t:"",repo:"shlomcat/carnet-de-tactique"},store.get(VID.gh)||{})}
function ghPanelHTML(lib){
  const g=ghCfg(),loc=vLocal().filter(x=>!VID.shared.some(y=>y.id===x.id)).length;
  return `<div class="panel" style="margin-top:16px">
   <h3>Partager la bibliothèque sur tous tes appareils</h3>
   <p class="muted" style="margin:0;font-size:.86rem;max-width:72ch">Les vidéos importées ici restent dans ce navigateur. Pour les retrouver sur ton téléphone, ton ordinateur et dans la version Claude du carnet, publie-les dans le fichier <span class="mono">videos.json</span> du dépôt GitHub (le site se met à jour en une minute environ). ${VID.shared.length} vidéo${VID.shared.length>1?"s":""} déjà partagée${VID.shared.length>1?"s":""}, ${loc} seulement sur cet appareil.</p>
   <div class="vrow">
    <div class="fld"><label for="ghrepo">Dépôt</label><input id="ghrepo" value="${esc(g.repo)}" autocomplete="off" spellcheck="false" class="mono"></div>
    <div class="fld"><label for="ghtok">Jeton GitHub <small class="muted">(droit « Contents » sur ce dépôt)</small></label><input id="ghtok" type="password" value="${esc(g.t)}" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></div>
   </div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" id="ghpub"${loc?"":" disabled"}>Publier ${loc||""} vidéo${loc>1?"s":""} dans le dépôt</button>${g.t?`<button class="btn" id="ghdel">Oublier le jeton</button>`:""}<span id="ghstat" class="muted" style="font-size:.85rem"></span></div>
   <p class="muted" style="margin:0;font-size:.78rem">Jeton à créer sur <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com › Settings › Fine-grained tokens</a> : accès au seul dépôt du carnet, permission « Contents : Read and write ». Il est gardé uniquement dans ce navigateur. Sans jeton : exporte le fichier et envoie-le à Claude, ou dépose-le sous le nom <span class="mono">videos.json</span> dans le dépôt (Add file › Upload files).</p>
  </div>`;
}
function ghBind(){
  const save=()=>store.set(VID.gh,{t:$("#ghtok").value.trim(),repo:$("#ghrepo").value.trim()});
  $("#ghtok").onchange=save;$("#ghrepo").onchange=save;
  if($("#ghdel"))$("#ghdel").onclick=()=>{store.set(VID.gh,{t:"",repo:ghCfg().repo});renderVideo()};
  $("#ghpub").onclick=async()=>{save();const st=$("#ghstat"),b=$("#ghpub");b.disabled=true;st.textContent="Publication…";
    try{const n=await ghPublish();st.textContent=`Publié : ${n} vidéos dans le dépôt. Le site sera à jour dans une minute environ.`;setTimeout(renderVideo,1500)}
    catch(e){st.textContent="Échec : "+e.message;b.disabled=false}};
}
const b64=str=>btoa(unescape(encodeURIComponent(str)));
const unb64=str=>decodeURIComponent(escape(atob(String(str).replace(/\s/g,""))));
async function ghPublish(){
  const g=ghCfg();if(!g.t)throw new Error("ajoute un jeton GitHub");if(!/^[\w.-]+\/[\w.-]+$/.test(g.repo))throw new Error("dépôt invalide");
  const api=`https://api.github.com/repos/${g.repo}/contents/videos.json`,H={Authorization:"Bearer "+g.t,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  let sha=null,remote=[];
  const r0=await fetch(api+"?ref=main",{headers:H,cache:"no-store"});
  if(r0.ok){const j=await r0.json();sha=j.sha;try{remote=(JSON.parse(unb64(j.content)).videos)||[]}catch(e){throw new Error("le fichier videos.json du dépôt est illisible ; rien n'a été modifié")}}
  else if(r0.status!==404){throw new Error(r0.status===401?"jeton refusé":r0.status===403?"jeton sans accès à ce dépôt":"GitHub "+r0.status)}
  const ids=new Set(remote.map(x=>x.id)),add=vLocal().filter(x=>!ids.has(x.id)).map(x=>{const y=Object.assign({},x);delete y.shared;return y});
  const all=remote.concat(add);
  const body={message:`Bibliothèque vidéos : ${all.length} vidéo${all.length>1?"s":""} (+${add.length})`,content:b64(JSON.stringify({format:"carnet-videos",version:1,videos:all},null,1)),branch:"main"};
  if(sha)body.sha=sha;
  const r=await fetch(api,{method:"PUT",headers:Object.assign({"Content-Type":"application/json"},H),body:JSON.stringify(body)});
  if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error((j.message||"GitHub "+r.status)+(r.status===409?" (réessaie)":""))}
  VID.shared=all;VID.sig=null;return all.length;
}
function vLoadShared(){
  return fetch("videos.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(d=>{
    VID.shared=(d&&Array.isArray(d.videos)?d.videos:[]);VID.sig=null;
    const p=document.getElementById("p-video");if(p&&!p.hidden&&!VID.run&&typeof renderVideo==="function")renderVideo();
    if(typeof RV!=="undefined"&&RV.g&&typeof revGo==="function"&&RV.ply)revGo(RV.ply);
  }).catch(()=>{});
}

/* ---------- exemples similaires : comparaison de positions ---------- */
const PV={p:1,n:3,b:3,r:5,q:9};
function vSig(fen){
  const rows=fen.split(" ")[0].split("/"),pw=new Set(),mat={w:{},b:{}};let nonPawn=0;
  rows.forEach((row,ri)=>{let f=0;for(const ch of row){if(/\d/.test(ch)){f+=+ch;continue}
    const c=ch===ch.toUpperCase()?"w":"b",t=ch.toLowerCase(),sq="abcdefgh"[f]+(8-ri);
    if(t==="p")pw.add(c+sq);if(t!=="k"){mat[c][t]=(mat[c][t]||0)+1;if(t!=="p")nonPawn+=PV[t]}f++}});
  let st=null;try{st=window.Struct?Struct.classify(fen):null}catch(e){}
  return {pw,mat,np:nonPawn,st:st&&st.id,sta:st&&st.a,stm:fen.split(" ")[1]};
}
// la même position vue par l'autre camp (couleurs et rangées inversées)
function vMirror(fen){
  const [pl,stm,cas,ep,...rest]=fen.split(" ");
  const p=pl.split("/").reverse().map(r=>[...r].map(ch=>/[a-z]/.test(ch)?ch.toUpperCase():/[A-Z]/.test(ch)?ch.toLowerCase():ch).join("")).join("/");
  const c=cas==="-"?"-":((cas.includes("k")?"K":"")+(cas.includes("q")?"Q":"")+(cas.includes("K")?"k":"")+(cas.includes("Q")?"q":""));
  const e=ep==="-"?"-":ep[0]+(9-+ep[1]);
  return [p,stm==="w"?"b":"w",c,e,...rest].join(" ");
}
function vSim(A,B){
  let inter=0;A.pw.forEach(x=>{if(B.pw.has(x))inter++});const uni=A.pw.size+B.pw.size-inter;
  const pawn=uni?inter/uni:1;
  let md=0,mt=0;for(const c of ["w","b"])for(const t of ["p","n","b","r","q"]){const a=A.mat[c][t]||0,b=B.mat[c][t]||0;md+=Math.abs(a-b)*PV[t];mt+=Math.max(a,b)*PV[t]}
  const mat=mt?1-md/mt:1,phase=1-Math.min(1,Math.abs(A.np-B.np)/40);
  const ka=A.st&&A.st!=="open",kb=B.st&&B.st!=="open";
  // structure reconnue des deux côtés : même structure ou pas ; sinon on se fie aux pions seuls
  const st=ka&&kb?(A.st===B.st&&A.sta===B.sta?1:0):ka||kb?0:pawn;
  return 0.55*pawn+0.15*mat+0.1*phase+0.2*st;
}
function vExampleSigs(){
  if(VID.sig)return VID.sig;
  VID.sig=[];
  vLib().forEach(v=>v.moments.forEach((m,k)=>{if(!m.fen||!m.comment)return;try{VID.sig.push({v,m,k,s:vSig(m.fen)})}catch(e){}}));
  return VID.sig;
}
// les n exemples de la bibliothèque les plus proches d'une position
function videoSimilar(fen,n,min){
  const ex=vExampleSigs();if(!ex.length||!fen)return [];
  const A=vSig(fen),M=vSig(vMirror(fen)),out=[];
  for(const e of ex){const a=vSim(A,e.s),b=vSim(M,e.s);const sc=Math.max(a,b);if(sc>=(min||0.75))out.push({sc,flip:b>a,...e})}
  out.sort((x,y)=>y.sc-x.sc);
  const seen=new Set();return out.filter(x=>{const k=x.v.id+":"+x.k;if(seen.has(k))return false;seen.add(k);return true}).slice(0,n||3);
}
function vSrc(x){return `${x.v.author||"auteur non renseigné"}, « ${x.v.title} », ${x.m.t}`}
function videoSimilarHTML(fen){
  const L=videoSimilar(fen,2);if(!L.length)return "";
  return `<div class="stbox vsim"><b>Vu dans une vidéo</b>${L.map(x=>`<div><span class="muted mono" style="font-size:.78rem">ressemblance ${Math.round(x.sc*100)} %${x.flip?" · couleurs inversées":""}${x.s.st&&window.Struct&&Struct.BYID&&Struct.BYID[x.s.st]?" · "+esc(Struct.BYID[x.s.st].name):""}</span><br>${x.m.idea?`<b>${esc(x.m.idea)}</b> — `:""}${esc(x.m.comment)}<br><span style="font-size:.82rem"><a href="${esc(x.v.url)}&t=${x.m.sec}s" target="_blank" rel="noopener">▶ ${esc(vSrc(x))}</a> · <button class="lm" onclick="videoOpen('${esc(x.v.id)}',${x.k})">voir la position</button></span></div>`).join("")}</div>`;
}
function videoOpen(id,k){VID.cur=id;VID.m=k;if(typeof tab==="function")tab("video");renderVideo()}
// texte transmis à Claude
function videoContext(fen){
  const L=videoSimilar(fen,3);if(!L.length)return "";
  return "Exemples tirés de vidéos pédagogiques, dans des positions semblables (repérées automatiquement par la structure de pions et le matériel ; sers-t'en seulement s'ils éclairent vraiment la position, et cite alors la source entre parenthèses) :\n"+
   L.map(x=>`- ressemblance ${Math.round(x.sc*100)} %${x.flip?" (couleurs inversées : l'exemple concerne l'autre camp)":""} ; position de l'exemple (FEN) : ${x.m.fen}${x.m.idea?` ; thème : ${x.m.idea}`:""} ; explication du commentateur : ${x.m.comment}${x.m.vars.length?` ; variantes citées : ${x.m.vars.map(v=>v.sans.join(" ")+(v.verdict?" ("+v.verdict+")":"")).join(" ; ")}`:""} ; source : ${vSrc(x)}`).join("\n")+"\n";
}
vLoadShared();
