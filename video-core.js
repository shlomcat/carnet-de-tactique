/* Carnet de tactique — logique d'import des vidéos, commune au site (navigateur) et à l'import dans le cloud (Node).
   Gemini lit la vidéo, chess.js vérifie chaque coup. Aucune dépendance au DOM. */
(function(root){
"use strict";
let ChessCtor=null;
function NewChess(f){const K=ChessCtor||root.Chess;return f!==undefined?new K(f):new K()}
const START_FEN="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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
   o.cont?`Les coups ci-dessus sont vérifiés. La position atteinte est (FEN) : ${o.cont.fen}. Le prochain coup est le coup ${o.cont.next}. Dans partie.coups, donne UNIQUEMENT les coups qui suivent cette position, dans l'ordre, en vérifiant sur l'échiquier de la vidéo que chacun est possible. Dans moments, ne donne que les passages commentés à partir de cette position.`:"",
   o.pgn?`La partie est connue, utilise cette liste de coups comme référence et concentre-toi sur les commentaires : ${o.pgn.join(" ")}.`:"",
   o.from!=null?`Ne traite que le passage de ${fmtT(o.from)} à ${fmtT(o.to)} ; les horodatages restent ceux de la vidéo complète.`:""
  ].filter(Boolean).join("\n");
}
async function geminiOnce(cfg,model,url,o,plain){
  const part={fileData:{fileUri:url}},vm={};
  if(o.from!=null){vm.startOffset=Math.round(o.from)+"s";if(o.to!=null)vm.endOffset=Math.round(o.to)+"s"}
  if(o.fps&&!plain)vm.fps=o.fps;
  if(Object.keys(vm).length)part.videoMetadata=vm;
  const gc=s=>Object.assign({responseMimeType:"application/json",temperature:0.2},s?{responseSchema:o.schema||VSCHEMA}:{},o.lowres&&!plain?{mediaResolution:"MEDIA_RESOLUTION_LOW"}:{});
  const body=s=>({contents:[{parts:[part,{text:o.prompt||vPrompt(o)}]}],generationConfig:gc(s)});
  const call=async s=>{
    let r;
    try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.k},body:JSON.stringify(body(s))})}
    catch(e){if(typeof window!=="undefined"&&window.claude)throw new Error("La version Claude du carnet ne peut pas joindre Gemini : importe les vidéos depuis le site GitHub.");const x=new Error("connexion à Gemini interrompue (réseau, mise en veille de l'écran ?)");x.net=true;throw x}
    const j=await r.json().catch(()=>({}));
    if(!r.ok){const m=(j.error&&j.error.message)||("HTTP "+r.status);const e=new Error(m);e.status=r.status;throw e}
    const c=j.candidates&&j.candidates[0];
    const txt=(c&&c.content&&c.content.parts||[]).map(p=>p.text||"").join("");
    if(!txt)throw new Error("Réponse vide de Gemini"+(c&&c.finishReason?` (${c.finishReason})`:"")+". La vidéo est-elle publique ?");
    return {data:vParseJSON(txt),usage:j.usageMetadata||null};
  };
  try{return await call(true)}
  catch(e){
    if(e.status===400&&!plain&&(o.fps||o.lowres)&&/fps|media_?resolution|video_?metadata/i.test(e.message))return geminiOnce(cfg,model,url,o,true);
    if(e.status===400&&/schema|response_schema|responseSchema|Invalid JSON payload/i.test(e.message))return call(false);throw e}
}
// saturation (503, quota 429) : on réessaie, puis on bascule sur un autre modèle
const busyErr=e=>e&&(e.net||e.status===503||e.status===429||e.status===500||/high demand|overloaded|unavailable|try again later|resource.?exhausted|quota/i.test(e.message||""));
const missingErr=e=>e&&(e.status===404||/not found|is not supported|unknown model/i.test(e.message||""));
const sleep=ms=>new Promise(z=>setTimeout(z,ms));
async function gemini(cfg,url,o,info){
  const models=[cfg.model,...["gemini-3.6-flash","gemini-3.8-flash","gemini-3.5-flash-lite"].filter(m=>m!==cfg.model)];
  let last=null;
  for(const model of models){
    for(let k=0;k<3;k++){
      try{const r=await geminiOnce(cfg,model,url,o);r.model=model;return r}
      catch(e){last=e;
        if(missingErr(e)){info&&info(`Modèle ${model} indisponible, essai avec un autre…`);break}
        if(!busyErr(e))throw e;
        if(k<2){if(e.net){const w=k?20:5;info&&info(`Connexion interrompue, nouvel essai dans ${w} s…`);await sleep(w*1000);continue}const q=e.status===429||/quota|resource.?exhausted/i.test(e.message||""),w=q?(k?60:30):(k?15:5);info&&info(`${model} ${q?"a atteint sa limite de débit":"est saturé"}, nouvel essai dans ${w} s…`);await sleep(w*1000)}
        else info&&info(`${model} reste saturé, essai avec un autre modèle…`)}
    }
  }
  throw new Error("tous les modèles Gemini sont saturés pour le moment, réessaie dans quelques minutes ("+(last&&last.message||"")+")");
}
function vParseJSON(t){
  t=String(t).trim().replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"");
  try{return JSON.parse(t)}catch(e){const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a)return JSON.parse(t.slice(a,b+1));throw new Error("Gemini n'a pas renvoyé de JSON lisible")}
}

/* ---------- vérification avec chess.js ---------- */
const cleanSan=s=>String(s||"").replace(/^\s*\d+\s*\.+\s*/,"").replace(/[!?]+$/,"").replace(/0-0-0/g,"O-O-O").replace(/0-0/g,"O-O").trim();
// coup mal noté par Gemini (« Nfxe4 » alors que c'est le cavalier d2) : on cherche le seul coup légal
// de la même pièce vers la même case
function repairMove(c,s){
  const m=String(s).replace(/[+#!?]/g,"").match(/^([KQRBN])?([a-h])?([1-8])?x?-?([a-h][1-8])(?:=?([QRBNqrbn]))?$/);
  if(!m)return null;
  const piece=m[1]?m[1].toLowerCase():"p",promo=m[5]?m[5].toLowerCase():null;
  let L=c.moves({verbose:true}).filter(x=>x.to===m[4]&&x.piece===piece&&(!promo||x.promotion===promo)&&(promo||!x.promotion||x.promotion==="q"));
  if(L.length>1&&m[2])L=L.filter(x=>x.from[0]===m[2]);
  if(L.length>1&&m[3])L=L.filter(x=>x.from[1]===m[3]);
  return L.length===1?c.move(L[0]):null;
}
function replay(fen,sans){
  const c=NewChess(fen),ok=[],fens=[c.fen()],ucis=[];let bad=null,fixed=0;
  for(const s0 of sans||[]){const s=cleanSan(s0);if(!s||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s))continue;
    let m=c.move(s,{sloppy:true});if(!m){m=repairMove(c,s);if(m)fixed++}
    if(!m){bad={i:ok.length,san:s0};break}
    ok.push(m.san);ucis.push(m.from+m.to+(m.promotion||""));fens.push(c.fen())}
  return {sans:ok,fens,ucis,bad,fixed};
}
const plyName=(n,san)=>n>0?`${Math.ceil(n/2)}${n%2?".":"..."} ${san||""}`.trim():"le début";
function pgnMoves(txt){
  if(!txt||!txt.trim())return null;
  const c=NewChess();if(c.load_pgn(txt,{sloppy:true}))return c.history();
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
  for(const x of raw.moments||[]){const m=vMoment(x,main);if(m)ms.push(m)}
  ms.sort((a,b)=>a.sec-b.sec);
  return {main,ms};
}
// un moment commenté, replacé sur la partie vérifiée ; on garde les variantes brutes pour pouvoir les rejouer
// si la partie est complétée plus tard
function vMoment(x,main){
  const sec=toSec(x.t);if(sec==null)return null;
  const m={sec,t:fmtT(sec),ref:String(x.coup||""),rawFen:x.fen?String(x.fen).trim():null,rawVars:(x.variantes||[]).map(v=>({coups:(v.coups||[]).map(String),verdict:String(v.verdict||"")})),
    comment:String(x.commentaire||"").trim(),idea:String(x.idee||"").trim()};
  vPlace(m,main);return m;
}
function vPlace(m,main){
  let fen=null,ply=null;const warn=[];
  if(m.rawFen){const c=NewChess();if(c.load(m.rawFen))fen=c.fen();else warn.push("FEN illisible")}
  if(!fen){const p=plyOf(m.ref,main.sans);
    if(p>=0){ply=p;fen=main.fens[p]}else{ply=Math.min(-p,main.sans.length);fen=main.fens[Math.max(0,ply)];warn.push(`coup « ${m.ref} » non retrouvé dans la partie`)}}
  const changed=m.fen!==fen;m.fen=fen;m.ply=ply;m.warn=warn;
  m.vars=(m.rawVars||[]).map(v=>{const r=replay(fen,v.coups);return {sans:r.sans,ucis:r.ucis,bad:r.bad?r.bad.san:null,verdict:v.verdict}}).filter(v=>v.sans.length||v.bad);
  if(changed){delete m.ev;delete m.best}
  return m;
}

/* ---------- repérage des parties d'une longue vidéo ---------- */
const TOC_SCHEMA={type:"OBJECT",properties:{titre:{type:"STRING"},duree:{type:"STRING"},
  parties:{type:"ARRAY",items:{type:"OBJECT",properties:{debut:{type:"STRING"},fin:{type:"STRING"},blancs:{type:"STRING"},noirs:{type:"STRING"},description:{type:"STRING"}},required:["debut","fin"]}}},required:["parties"]};
function tocPrompt(from,to){
  return ["Cette vidéo d'échecs peut contenir plusieurs parties commentées l'une après l'autre.",
   "Fais-en la table des matières, en JSON :",
   "- titre : le titre de la vidéo s'il est visible ;",
   "- duree : la durée totale de la vidéo (H:MM:SS ou MM:SS) ;",
   "- parties : chaque partie d'échecs commentée, dans l'ordre, avec debut et fin (horodatages de la vidéo complète, H:MM:SS ou MM:SS), blancs et noirs (noms ou pseudos affichés), et une description de quelques mots (ouverture, cadence, événement).",
   "Une partie commence quand l'échiquier revient à la position initiale ou qu'une nouvelle partie est annoncée, et finit quand le commentateur passe à la suivante. N'inclus pas l'introduction, les publicités, ni les discussions sans partie.",
   "Si la vidéo ne commente qu'une seule partie, renvoie une seule entrée.",
   from!=null?`Ne traite que le passage de ${fmtT(from)} à ${to!=null?fmtT(to):"la fin"}.`:""].filter(Boolean).join("\n");
}
async function vToc(cfg,yurl,from,to,say){
  const o={prompt:tocPrompt(from,to),schema:TOC_SCHEMA,fps:0.2,lowres:true};
  if(from!=null||to!=null){o.from=from||0;o.to=to!=null?to:null}
  const {data,usage,model}=await gemini(cfg,yurl,o,say);
  const end=to!=null?to:toSec(data.duree);
  let games=(data.parties||[]).map(g=>({a:toSec(g.debut),b:toSec(g.fin),white:String(g.blancs||""),black:String(g.noirs||""),desc:String(g.description||"")}))
    .filter(g=>g.a!=null&&g.b!=null&&g.b-g.a>=60).sort((x,y)=>x.a-y.a);
  games=games.map(g=>({...g,a:Math.max(g.a,from||0),b:end?Math.min(g.b,end):g.b})).filter(g=>g.b>g.a);
  return {games,title:String(data.titre||""),dur:end,tok:usage&&usage.totalTokenCount||0,model};
}
// lit une partie (passage a–b), en tranches de 8 minutes qui se suivent
async function vExtract(cfg,yurl,a,b,pgn,say,label){
  const chunks=[];if(a!=null&&b!=null){const L=480;for(let x=a;x<b;x+=L)chunks.push([x,Math.min(b,x+L)])}else chunks.push([a,b]);
  const raw={titre:"",partie:{coups:[]},moments:[],cut:null,fixed:0};let tok=0,usedModel=cfg.model;
  for(let k=0;k<chunks.length;k++){
    const [x,y]=chunks[k];
    say(`${label}Gemini regarde ${chunks.length>1?`le passage ${k+1}/${chunks.length} (${fmtT(x)}–${fmtT(y)})`:"la vidéo"}… compte 1 à 3 minutes.`);
    const o={pgn,prev:pgn?null:replay(START_FEN,raw.partie.coups).sans};
    if(x!=null||y!=null){o.from=x||0;o.to=y!=null?y:(x||0)+3600}
    const {data,usage,model}=await gemini(cfg,yurl,o,m=>say(label+m));usedModel=model;
    if(usage&&usage.totalTokenCount)tok+=usage.totalTokenCount;
    if(data.titre&&!raw.titre)raw.titre=data.titre;
    const p=data.partie||{};["blancs","noirs","evenement"].forEach(f=>{if(p[f]&&!raw.partie[f])raw.partie[f]=p[f]});
    if(p.coups&&p.coups.length){const prev=raw.partie.coups,nw=p.coups.map(cleanSan);
      // Gemini peut répéter le début : on garde la plus longue suite légale
      const J=replay(START_FEN,prev.concat(nw)),A=replay(START_FEN,nw),best=A.sans.length>J.sans.length?A:J;
      if(best.sans.length>prev.length){raw.partie.coups=best.sans;raw.cut=best.bad?best.bad.san:null;raw.fixed+=best.fixed||0}else if(!raw.cut&&J.bad)raw.cut=J.bad.san}
    raw.moments.push(...(data.moments||[]));
  }
  return {raw,tok,model:usedModel};
}


const api={START_FEN,ytId,toSec,fmtT,VSCHEMA,vPrompt,geminiOnce,busyErr,missingErr,sleep,gemini,vParseJSON,cleanSan,repairMove,replay,plyName,pgnMoves,plyOf,vBuild,vMoment,vPlace,TOC_SCHEMA,tocPrompt,vToc,vExtract,setChess:C=>{ChessCtor=C}};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.VCore=api;
})(typeof window!=="undefined"?window:globalThis);
