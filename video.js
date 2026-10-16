/* Carnet de tactique — import de vidéos pédagogiques (YouTube) via l'API Gemini.
   La clé Gemini reste dans ce navigateur (localStorage) et n'est envoyée qu'à Google.
   Gemini regarde la vidéo et renvoie la partie + les commentaires horodatés ;
   chess.js vérifie chaque coup, Stockfish évalue chaque position retenue. */
"use strict";
const {START_FEN,ytId,toSec,fmtT,VSCHEMA,vPrompt,geminiOnce,busyErr,missingErr,sleep,gemini,vParseJSON,cleanSan,repairMove,replay,plyName,pgnMoves,plyOf,vBuild,vMoment,vPlace,TOC_SCHEMA,tocPrompt,vToc,vExtract,vSegMissing,vEntry}=VCore;
const VID={key:"carnet:gemini",lib:"carnet:videos",gh:"carnet:github",shared:[],priv:[],dbv:[],dbh:null,cur:null,m:0,cg:null,run:false,vfen:null};
const GMODELS=[["gemini-3.8-flash","Gemini 3.8 Flash (recommandé)"],["gemini-4-argon","Gemini 4 Argon (plus fin, plus lent)"],["gemini-3.6-flash","Gemini 3.6 Flash"],["gemini-3.5-flash-lite","Gemini 3.5 Flash-Lite (rapide)"]];

function vCfg(){return Object.assign({k:"",model:GMODELS[0][0]},store.get(VID.key)||{})}
function vLocal(){return store.get(VID.lib)||[]}
// bibliothèque = vidéos de ce navigateur + vidéos partagées (fichier videos.json du dépôt)
// bibliothèque = vidéos de ce navigateur + dépôt privé de données + fichier public du site
function vLib(){const L=vLocal(),ids=new Set(L.map(x=>x.id)),out=L.slice();
  for(const [src,f] of [[VID.dbv,"remote"],[VID.priv,"remote"],[VID.shared,"remote"]])for(const x of src)if(!ids.has(x.id)){ids.add(x.id);out.push(Object.assign(x,{[f]:true}))}
  return out}
const isPerso=x=>x&&x.license==="perso";
const LIC={"CC BY":"licence CC BY",accord:"accord de l'auteur",perso:"usage personnel"};
function vWhere(x){const w=[];if(VID.dbv.some(y=>y.id===x.id))w.push("base Claude");if(VID.shared.some(y=>y.id===x.id))w.push("publique");if(VID.priv.some(y=>y.id===x.id))w.push("dépôt privé");if(vLocal().some(y=>y.id===x.id)&&!w.length)w.push("sur cet appareil");return w.join(" + ")}
function vSave(lib){store.set(VID.lib,lib.filter(x=>!x.remote));VID.sig=null}


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
/* ---------- import ---------- */
async function vImport(){
  const cfg=vCfg(),url=$("#vurl").value.trim(),id=ytId(url),st=$("#vstat");
  const say=(t,err)=>{st.hidden=false;st.className="vstat"+(err?" err":"");st.textContent=t};
  if(!cfg.k)return say("Ajoute d'abord ta clé Gemini ci-dessus.",1);
  if(!id)return say("Lien YouTube non reconnu.",1);
  if($("#vlic").value!=="perso"&&!$("#vok").checked)return say("Coche la case pour confirmer la licence CC BY ou l'accord de l'auteur. Sinon, choisis « Usage personnel » : la vidéo ne sera jamais publiée dans le dépôt public.",1);
  if(VID.run)return;
  const from=toSec($("#vfrom").value),to=toSec($("#vto").value),pgn=pgnMoves($("#vpgn").value);
  if($("#vpgn").value.trim()&&!(pgn&&pgn.length))return say("Le PGN fourni est illisible.",1);
  if(from!=null&&to!=null&&to<=from)return say("La fin doit être après le début.",1);
  const yurl="https://www.youtube.com/watch?v="+id,split=$("#vsplit").checked&&!pgn;
  const form={title:$("#vtitle").value.trim(),author:$("#vauthor").value.trim(),license:$("#vlic").value};
  VID.run=true;$("#vgo").disabled=true;vAwake(true);
  const done=[],failed=[];let tok=0,vtitle=form.title;
  try{
    // 1. repérage des parties (passage rapide, image allégée)
    let segs=[{a:from,b:to,white:"",black:"",desc:""}];
    if(split){
      say("Repérage des parties de la vidéo… compte 1 à 2 minutes.");
      try{const t=await vToc(cfg,yurl,from,to,m=>say("Repérage : "+m));tok+=t.tok;if(!vtitle)vtitle=t.title;
        if(t.games.length)segs=t.games;else if(t.dur)segs=[{a:from||0,b:t.dur,white:"",black:"",desc:""}]}
      catch(e){say("Repérage impossible ("+e.message+"), analyse de la vidéo d'un seul tenant…")}
    }
    // parties déjà importées pour cette vidéo (relance après un échec) : on ne relit que les manquantes
    const miss=vSegMissing(segs,split?vLib().filter(x=>x.vid===id):[]),total=miss.total;segs=miss.segs;
    if(miss.skipped){
      if(!segs.length){VID.run=false;vAwake(false);$("#vgo").disabled=false;return say(`Les ${total} parties de cette vidéo sont déjà dans ta bibliothèque.`)}
      say(`${miss.skipped} partie${miss.skipped>1?"s":""} déjà importée${miss.skipped>1?"s":""} : lecture des ${segs.length} manquante${segs.length>1?"s":""}…`);await sleep(1500)}
    const n=total;
    // 2. une analyse par partie ; chaque partie est enregistrée dès qu'elle est prête
    for(const g of segs){
      const k=g.i,label=n>1?`Partie ${k+1}/${n}${g.white||g.black?` (${g.white} – ${g.black})`:""} · `:"";
      try{
        const r=await vExtract(cfg,yurl,g.a,g.b,pgn,say,label);tok+=r.tok;
        const {main,ms}=vBuild(r.raw,{pgn});
        if(!ms.length)throw new Error("aucun moment commenté trouvé");
        // même titre de vidéo pour toutes les parties : celui du formulaire, du repérage, ou à défaut celui lu dans la première partie
        if(!vtitle&&r.raw.titre)vtitle=r.raw.titre;
        const v=vEntry({id,yurl,g,k,n,r,main,ms,pgn,base:vtitle||"Vidéo "+id,form});
        // les parties d'une même vidéo restent dans l'ordre en tête de la bibliothèque
        const lib=vLocal(),nxt=lib.findIndex(x=>x.vid===id&&x.part&&x.part.k>k+1);let at=nxt;
        if(at<0){at=done.length;lib.forEach((x,j)=>{if(x.vid===id&&x.part&&x.part.k<k+1)at=j+1})}
        lib.splice(at,0,v);vSave(lib);
        say(`${label}${ms.length} moments, ${main.sans.length} coups vérifiés. Évaluation Stockfish…`);
        await vEval(v,i=>say(`${label}Évaluation Stockfish : moment ${i+1}/${v.moments.length}…`));
        vSave(vLocal().map(x=>x.id===v.id?v:x));
        done.push({k:k+1,v});
        await vAutoPush();
      }catch(e){failed.push({k:k+1,msg:e.message})}
    }
    if(!done.length)throw new Error(failed.map(f=>(n>1?`partie ${f.k} : `:"")+f.msg).join(" ; ")||"aucune partie extraite");
    if(n===1){VID.cur=done[0].v.id;VID.m=0}
    renderVideo();
    const v=done.length===1?done[0].v:null;
    const msg=n>1?`Terminé : ${done.length} partie${done.length>1?"s":""} importée${done.length>1?"s":""}${segs.length<n?` (sur ${segs.length} manquante${segs.length>1?"s":""})`:` sur ${n}`} (${done.map(d=>d.v.moments.length).reduce((a,b)=>a+b,0)} moments)${failed.length?`. Échec ${failed.map(f=>`partie ${f.k} : ${f.msg}`).join(" ; ")} — relance la même vidéo pour ne reprendre que ${failed.length>1?"ces parties":"cette partie"}`:""}${tok?` · ${Math.round(tok/1000)} k jetons`:""}.`
      :`Terminé : ${v.moments.length} moments, ${v.game.sans.length} coups vérifiés${v.game.fixed?` dont ${v.game.fixed} corrigé${v.game.fixed>1?"s":""}`:""}${v.game.cut?`, arrêt sur « ${v.game.cut} »`:""}${tok?` · ${Math.round(tok/1000)} k jetons`:""} · modèle ${v.model}.`;
    const e=$("#vstat");if(e){e.hidden=false;e.className="vstat"+(failed.length?" err":"");e.textContent=msg}
    if(VID.cur&&v&&VID.cur===v.id)vShowMoment(VID.m);
  }catch(e){say("Échec : "+e.message,1)}
  finally{VID.run=false;vAwake(false);const b=$("#vgo");if(b)b.disabled=false}
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
     <div class="fld"><label for="vlic">Droits</label><select id="vlic"><option value="CC BY">Licence CC BY</option><option value="accord">Accord de l'auteur</option><option value="perso">Usage personnel (jamais publiée)</option></select></div>
    </div>
    <div class="vrow">
     <div class="fld"><label for="vtitle">Titre <small class="muted">(facultatif)</small></label><input id="vtitle" autocomplete="off"></div>
     <div class="fld"><label for="vfrom">Début <small class="muted">mm:ss</small></label><input id="vfrom" inputmode="numeric" placeholder="0:00" class="mono"></div>
     <div class="fld"><label for="vto">Fin <small class="muted">mm:ss</small></label><input id="vto" inputmode="numeric" placeholder="tout" class="mono"></div>
    </div>
    <label class="chk"><input type="checkbox" id="vsplit" checked> Découper automatiquement si la vidéo commente plusieurs parties</label>
    <details><summary class="muted" style="cursor:pointer;font-size:.88rem">PGN de la partie, si tu le connais (plus fiable)</summary>
     <textarea id="vpgn" rows="4" class="mono vta" placeholder="1. e4 c6 2. d4 d5 …"></textarea></details>
    <label class="chk" id="vokl"><input type="checkbox" id="vok"> Je confirme : la vidéo est sous licence CC BY, ou j'ai l'accord de son auteur.</label>
    <p class="muted" id="vpersol" style="margin:0;font-size:.82rem" hidden>Usage personnel : la vidéo et ses exemples restent dans ce navigateur et dans ton dépôt privé si tu en configures un ; ils ne sont jamais publiés dans le dépôt public du site.</p>
    <div><button class="btn primary" id="vgo">Analyser la vidéo</button></div>
    <div id="vstat" class="vstat" hidden></div>
    <p class="muted" style="margin:0;font-size:.78rem">Une longue vidéo est d'abord parcourue pour repérer ses parties, puis chaque partie est lue en passages de 8 minutes et enregistrée séparément. Compte 10 à 30 minutes pour une vidéo d'une heure : garde la page ouverte (l'écran reste allumé pendant l'analyse). Avec un PGN, la vidéo est traitée comme une seule partie. Sur YouTube, la licence s'affiche sous la description (« Licence Creative Commons Attribution »).</p>
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
    <h3>Bibliothèque · ${lib.length} vidéo${lib.length>1?"s":""}, ${n} exemple${n>1?"s":""}${VID.dbh?` · base Claude : ${VID.dbv.length}`:""}</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${VID.dbh&&vLocal().some(x=>!VID.dbv.some(y=>y.id===x.id))?`<button class="btn primary" id="vtodb">Copier dans la base Claude</button>`:""}<button class="btn" id="vexp"${lib.length?"":" disabled"}>Exporter</button><label class="btn" for="vimp" style="display:inline-block">Importer un fichier<input type="file" id="vimp" accept="application/json,.json" hidden></label></div>
   </div>
   ${lib.length?`<ul class="vlist">${lib.map(x=>`<li><button class="vitem" data-v="${esc(x.id)}"><img src="https://i.ytimg.com/vi/${esc(x.vid)}/mqdefault.jpg" alt="" loading="lazy" width="120" height="68"><span><b>${esc(x.title)}</b><br><span class="muted">${esc(x.author||"auteur non renseigné")} · ${x.moments.length} moment${x.moments.length>1?"s":""} · ${x.game.sans.length} coup${x.game.sans.length>1?"s":""} · ${esc(LIC[x.license]||x.license||"")} · <b>${esc(vWhere(x))}</b>${x.game.white||x.game.black?` · ${esc(x.game.white)}–${esc(x.game.black)}`:""}</span></span></button></li>`).join("")}</ul>`
    :`<p class="muted" style="margin:0">Aucune vidéo importée pour l'instant.</p>`}
  </div>
  ${ghPanelHTML(lib)}`;
  // version Claude : pas d'accès à Gemini ni à GitHub, la bibliothèque vit dans la base de la page
  if(window.claude){box.querySelector(".vgrid").hidden=true;$("#ghpanel").hidden=true;
    box.insertAdjacentHTML("afterbegin",`<div class="panel"><h3>Vidéos dans la version Claude</h3><p class="muted" style="margin:0;font-size:.88rem;max-width:74ch">L'extraction d'une vidéo par Gemini se fait sur le site <a href="https://shlomcat.github.io/carnet-de-tactique/" target="_blank" rel="noopener">shlomcat.github.io/carnet-de-tactique</a>. Ensuite, clique là-bas sur « Exporter », puis ici sur « Importer un fichier » : les vidéos sont enregistrées dans la base de cette page et disponibles sur tous tes appareils. ${VID.dbh?"":"<b>La base n'est pas disponible pour le moment : les vidéos importées resteront dans ce navigateur.</b>"}</p></div>`)}
  const kv=()=>({k:$("#vkey").value.trim(),model:$("#vmodel").value});
  $("#vksave").onclick=()=>{store.set(VID.key,kv());renderVideo()};
  $("#vmodel").onchange=()=>store.set(VID.key,Object.assign(vCfg(),{model:$("#vmodel").value}));
  if($("#vkdel"))$("#vkdel").onclick=()=>{try{localStorage.removeItem(VID.key)}catch(e){}renderVideo()};
  $("#vgo").onclick=()=>{if($("#vkey").value.trim()&&$("#vkey").value.trim()!==vCfg().k)store.set(VID.key,kv());vImport()};
  box.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{VID.cur=b.dataset.v;VID.m=0;renderVideo()});
  $("#vexp").onclick=vExport;ghBind();
  $("#vlic").onchange=()=>{const p=$("#vlic").value==="perso";$("#vokl").hidden=p;$("#vpersol").hidden=!p};
  $("#vimp").onchange=e=>{const f=e.target.files[0];if(!f)return;f.text().then(async t=>{const d=JSON.parse(t),arr=(Array.isArray(d)?d:d.videos||[]).filter(x=>x&&x.id&&Array.isArray(x.moments));
    if(VID.dbh){const have=new Set(VID.dbv.map(x=>x.id));let n=0,err=null;for(const x of arr){if(have.has(x.id))continue;try{await vDbPut(x);n++}catch(e){err=e}}
      alert(`${n} vidéo${n>1?"s":""} enregistrée${n>1?"s":""} dans la base de la version Claude${err?` (erreur : ${err.message||err})`:""}.`)}
    else{const lib=vLocal(),ids=new Set(vLib().map(x=>x.id));arr.filter(x=>!ids.has(x.id)).forEach(x=>{delete x.remote;lib.push(x)});vSave(lib)}
    renderVideo()}).catch(()=>alert("Fichier illisible"))};
  if($("#vtodb"))$("#vtodb").onclick=async()=>{const have=new Set(VID.dbv.map(x=>x.id)),L=vLocal().filter(x=>!have.has(x.id));let n=0;
    for(const x of L){try{await vDbPut(x);n++}catch(e){alert("Erreur : "+(e.message||e));break}}if(n)alert(`${n} vidéo${n>1?"s":""} copiée${n>1?"s":""} dans la base de la version Claude.`);renderVideo()};
}
function vExport(){
  const blob=new Blob([JSON.stringify({format:"carnet-videos",version:1,videos:vLib()},null,1)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="carnet-videos.json";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
function vViewer(v){
  const box=$("#p-video");
  box.innerHTML=`<div class="panel">
   <div class="rhead" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div><h3 style="margin:0">${esc(v.title)}</h3><span class="muted" style="font-size:.85rem">${esc(v.author||"auteur non renseigné")} · ${esc(LIC[v.license]||v.license)} · <a href="${esc(v.url)}" target="_blank" rel="noopener">voir sur YouTube</a>${v.game.white||v.game.black?` · ${esc(v.game.white)} – ${esc(v.game.black)}`:""}</span></div>
    <button class="btn" id="vback" style="margin-left:auto">← Bibliothèque</button>
   </div>
   ${v.game.cut?`<div class="vstat err" style="display:grid;gap:8px"><span>Gemini a lu un coup impossible (« ${esc(v.game.cut)} ») après ${esc(plyName(v.game.sans.length,v.game.sans[v.game.sans.length-1]))} : la partie vérifiée s'arrête là, et les moments suivants sont placés sur cette dernière position. Tu peux faire relire la suite à Gemini, ou coller le PGN si tu le connais.</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="vcont">Relire la suite avec Gemini</button></span></div>`:""}
   <div id="vstat" class="vstat" hidden></div>
   <div class="vview">
    <div class="vleft"><div class="boardbox"><div id="vboard" class="cgb"></div></div>
     <div class="rvnav"><button class="btn" id="vprev" aria-label="Moment précédent">◀</button><span class="mono muted" id="vpos"></span><button class="btn" id="vnext" aria-label="Moment suivant">▶</button><button class="btn" id="vflip" title="Retourner l'échiquier">⇅</button></div></div>
    <div class="vright"><div id="vmom" class="rcomment"></div>
     <ol class="vmoms" id="vmoms">${v.moments.map((m,k)=>`<li><button data-m="${k}"><span class="mono">${m.t}</span> ${esc(m.idea||m.comment.slice(0,60))}</button></li>`).join("")}</ol>
     <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="veval">Évaluer avec Stockfish</button>${v.remote&&!VID.dbv.some(y=>y.id===v.id)?`<span class="muted" style="font-size:.8rem;align-self:center">Vidéo enregistrée dans un dépôt GitHub (${esc(vWhere(v))})</span>`:`<button class="btn" id="vdel">Supprimer la vidéo</button>`}</div>
    </div>
   </div></div>`;
  VID.cg=Chessground($("#vboard"),{fen:START_FEN,coordinates:true,viewOnly:true,animation:{enabled:true,duration:140},drawable:{enabled:true,visible:true}});
  $("#vback").onclick=()=>{VID.cur=null;renderVideo()};
  if($("#vcont"))$("#vcont").onclick=()=>vContinue(v.id);
  $("#vprev").onclick=()=>vShowMoment(VID.m-1);$("#vnext").onclick=()=>vShowMoment(VID.m+1);
  $("#vflip").onclick=()=>VID.cg&&VID.cg.toggleOrientation();
  $("#vmoms").onclick=e=>{const b=e.target.closest("[data-m]");if(b)vShowMoment(+b.dataset.m)};
  if($("#vdel"))$("#vdel").onclick=async()=>{if(!confirm("Supprimer cette vidéo et ses exemples ?"))return;vSave(vLocal().filter(x=>x.id!==v.id));
    if(VID.dbh&&VID.dbv.some(y=>y.id===v.id)){try{await VID.dbh.doc("videos/"+vDocId(v.id)).delete()}catch(e){alert("Suppression impossible : "+(e.message||e))}}VID.cur=null;renderVideo()};
  $("#veval").onclick=async()=>{const b=$("#veval");b.disabled=true;const st=$("#vstat");st.hidden=false;st.className="vstat";
    try{await vEval(v,i=>st.textContent=`Évaluation Stockfish : moment ${i+1}/${v.moments.length}…`);vPersist(v);st.textContent="Évaluations à jour.";vShowMoment(VID.m)}
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

/* ---------- dépôts GitHub : fichier public du site et dépôt privé de données ---------- */
function ghCfg(){const g=Object.assign({t:"",repo:"shlomcat/carnet-de-tactique",priv:""},store.get(VID.gh)||{});if(!g.priv)g.priv="shlomcat/carnet-data";return g}
function ghCounts(){
  const L=vLocal(),pub=new Set(VID.shared.map(x=>x.id)),prv=new Set(VID.priv.map(x=>x.id));
  return {pub:L.filter(x=>!isPerso(x)&&!pub.has(x.id)).length,perso:L.filter(isPerso).length,priv:L.filter(x=>!prv.has(x.id)).length};
}
function ghPanelHTML(){
  const g=ghCfg(),n=ghCounts();
  return `<div class="panel" id="ghpanel" style="margin-top:16px">
   <h3>Retrouver la bibliothèque sur tous tes appareils</h3>
   <p class="muted" style="margin:0;font-size:.86rem;max-width:74ch">Les vidéos importées restent d'abord dans ce navigateur. Deux façons de les synchroniser :</p>
   <div class="fld"><label for="ghtok">Jeton GitHub <small class="muted">(permission « Contents : Read and write » sur les dépôts ci-dessous)</small></label><input id="ghtok" style="width:100%;box-sizing:border-box" type="password" value="${esc(g.t)}" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></div>
   <div class="ghbox">
    <div><b>Dépôt privé de données</b> <span class="muted">· recommandé, accepte toutes les vidéos, y compris en usage personnel</span></div>
    <div class="fld"><label for="ghpriv">Dépôt privé <small class="muted">(à créer sur GitHub, visibilité « Private »)</small></label><input id="ghpriv" style="width:100%;box-sizing:border-box" value="${esc(g.priv)}" autocomplete="off" spellcheck="false" class="mono" placeholder="shlomcat/carnet-data"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" id="ghsync"${g.priv&&n.priv?"":" disabled"}>${n.priv?`Envoyer ${n.priv} vidéo${n.priv>1?"s":""} au dépôt privé`:"Rien de nouveau à envoyer"}</button><span class="muted" style="font-size:.85rem" id="ghprivst">${!g.t?"Colle ton jeton GitHub ci-dessus":VID.privErr?"Dépôt privé : "+esc(VID.privErr):`${VID.priv.length} vidéo${VID.priv.length>1?"s":""} dans le dépôt privé`}</span></div>
    <span class="muted" style="font-size:.78rem">Le site relit ce dépôt à chaque ouverture, sur chaque appareil où tu as saisi le jeton. Personne d'autre n'y a accès. La version Claude du carnet ne peut pas le lire : utilise « Exporter » puis « Importer un fichier » là-bas.</span>
   </div>
   <div class="ghbox">
    <div><b>Dépôt public du site</b> <span class="muted">· seulement les vidéos sous licence CC BY ou avec l'accord de l'auteur</span></div>
    <div class="fld"><label for="ghrepo">Dépôt du site</label><input id="ghrepo" style="width:100%;box-sizing:border-box" value="${esc(g.repo)}" autocomplete="off" spellcheck="false" class="mono"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn" id="ghpub"${n.pub?"":" disabled"}>${n.pub?`Publier ${n.pub} vidéo${n.pub>1?"s":""} libre${n.pub>1?"s":""}`:"Rien de nouveau à publier"}</button><span class="muted" style="font-size:.85rem">${VID.shared.length} publiée${VID.shared.length>1?"s":""}${n.perso?` · ${n.perso} en usage personnel, jamais publiée${n.perso>1?"s":""} ici`:""}</span></div>
    <span class="muted" style="font-size:.78rem">Visible par tout le monde (fichier <span class="mono">videos.json</span>), et repris dans la version Claude du carnet à sa prochaine mise à jour.</span>
   </div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${g.t?`<button class="btn" id="ghdel">Oublier le jeton</button>`:""}<span id="ghstat" class="muted" style="font-size:.85rem"></span></div>
   <p class="muted" style="margin:0;font-size:.78rem">Jeton à créer sur <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com › Settings › Fine-grained tokens</a>, limité aux dépôts du carnet. Il est gardé uniquement dans ce navigateur.</p>
  </div>`;
}
function ghBind(){
  const save=()=>{store.set(VID.gh,{t:$("#ghtok").value.trim(),repo:$("#ghrepo").value.trim(),priv:$("#ghpriv").value.trim()})};
  $("#ghtok").onchange=()=>{save();vLoadPriv()};$("#ghpriv").onchange=()=>{save();vLoadPriv()};$("#ghrepo").onchange=save;
  // active les boutons dès la saisie, sans attendre de quitter le champ
  const live=()=>{save();const n=ghCounts(),t=$("#ghtok").value.trim();$("#ghsync").disabled=!(t&&okRepo($("#ghpriv").value.trim())&&n.priv);if(!t)$("#ghprivst").textContent="Colle ton jeton GitHub ci-dessus";$("#ghpub").disabled=!(t&&n.pub)};
  ["#ghtok","#ghpriv","#ghrepo"].forEach(k=>$(k).addEventListener("input",live));live();
  $("#ghpriv").addEventListener("change",()=>{const e=$("#ghprivst");if(e)e.innerHTML=`<span class="spin" aria-hidden="true"></span> Lecture du dépôt…`});
  if($("#ghdel"))$("#ghdel").onclick=()=>{store.set(VID.gh,Object.assign(ghCfg(),{t:""}));VID.priv=[];VID.sig=null;renderVideo()};
  const run=(btn,kind)=>async()=>{save();const st=$("#ghstat"),b=$(btn),lbl=b.textContent;b.disabled=true;b.innerHTML=`<span class="spin" aria-hidden="true"></span> Envoi en cours…`;st.className="muted";st.textContent="Connexion à GitHub…";
    try{const n=await ghSync(kind);st.className="ok";st.textContent=kind==="pub"?`✓ Publié : ${n} vidéo${n>1?"s":""} dans le dépôt public. Le site sera à jour dans une minute environ.`:`✓ Enregistré : ${n} vidéo${n>1?"s":""} dans le dépôt privé.`;ghLive()}
    catch(e){st.className="err";st.textContent="Échec : "+e.message;b.textContent=lbl;b.disabled=false}};
  $("#ghsync").onclick=run("#ghsync","priv");$("#ghpub").onclick=run("#ghpub","pub");
}
const b64=str=>btoa(unescape(encodeURIComponent(str)));
const unb64=str=>decodeURIComponent(escape(atob(String(str).replace(/\s/g,""))));
const okRepo=r=>/^[\w.-]+\/[\w.-]+$/.test(r||"");
function ghH(t,raw){return {Authorization:"Bearer "+t,Accept:raw?"application/vnd.github.raw+json":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}}
async function ghRead(repo,t){
  const api=`https://api.github.com/repos/${repo}/contents/videos.json`;
  let r;try{r=await fetch(api,{headers:ghH(t),cache:"no-store"})}catch(e){throw new Error("impossible de joindre GitHub depuis cette page : utilise le site shlomcat.github.io/carnet-de-tactique")}
  if(r.status===404){
    // 404 : soit le fichier n'existe pas encore, soit le jeton ne voit pas le dépôt (GitHub cache les dépôts privés)
    const q=await fetch(`https://api.github.com/repos/${repo}`,{headers:ghH(t),cache:"no-store"}).catch(()=>null);
    if(!q||!q.ok)throw new Error(`ton jeton n'a pas accès au dépôt ${repo}. Sur GitHub, modifie le jeton (Settings › Developer settings › Fine-grained tokens) et ajoute ce dépôt dans « Repository access »`);
    return {sha:null,videos:[],api}}
  if(!r.ok)throw new Error(r.status===401?"jeton refusé":r.status===403?`jeton sans accès à ${repo}`:"GitHub "+r.status);
  const j=await r.json();let txt=null;
  try{txt=j.content?unb64(j.content):null}catch(e){}
  if(txt==null){const q=await fetch(api,{headers:ghH(t,1),cache:"no-store"});if(!q.ok)throw new Error("GitHub "+q.status);txt=await q.text()}
  let d;try{d=JSON.parse(txt)}catch(e){throw new Error(`le fichier videos.json de ${repo} est illisible ; rien n'a été modifié`)}
  return {sha:j.sha,videos:Array.isArray(d.videos)?d.videos:[],api};
}
async function ghSync(kind,update){
  const g=ghCfg(),repo=kind==="pub"?g.repo:g.priv;
  if(!g.t)throw new Error("ajoute un jeton GitHub");if(!okRepo(repo))throw new Error("nom de dépôt invalide (format : propriétaire/dépôt)");
  if(kind==="priv"&&repo===g.repo)throw new Error("le dépôt privé doit être différent du dépôt public du site");
  const cur=await ghRead(repo,g.t),ids=new Set(cur.videos.map(x=>x.id));
  const loc=vLocal().filter(x=>kind==="priv"||!isPerso(x)).map(x=>{const y=Object.assign({},x);delete y.remote;return y}),byId=new Map(loc.map(x=>[x.id,x]));
  const add=loc.filter(x=>!ids.has(x.id));
  // update : les vidéos locales remplacent leur version du dépôt (partie complétée, évaluations)
  const all=(update?cur.videos.map(x=>byId.get(x.id)||x):cur.videos).concat(add);
  if(!add.length&&!update)return all.length;
  if(kind==="pub"&&all.some(isPerso))throw new Error("le fichier public contient une vidéo en usage personnel ; rien n'a été modifié");
  const body={message:`Bibliothèque vidéos : ${all.length} vidéo${all.length>1?"s":""} (+${add.length})`,content:b64(JSON.stringify({format:"carnet-videos",version:1,videos:all},null,1))};
  if(cur.sha)body.sha=cur.sha;
  const r=await fetch(cur.api,{method:"PUT",headers:Object.assign({"Content-Type":"application/json"},ghH(g.t)),body:JSON.stringify(body)});
  if(!r.ok){const j=await r.json().catch(()=>({}));
    if(r.status===404||r.status===403)throw new Error(`ton jeton peut lire ${repo} mais pas y écrire. Sur GitHub, modifie le jeton et mets la permission « Contents » sur « Read and write »`);
    throw new Error((j.message||"GitHub "+r.status)+(r.status===409?" (réessaie)":""))}
  if(kind==="pub")VID.shared=all;else{VID.priv=all;VID.privErr=null}VID.sig=null;return all.length;
}
function vRefreshRevue(){if(typeof RV!=="undefined"&&RV.g&&typeof revGo==="function"&&RV.ply&&!RV.v)revGo(RV.ply)}
function vRefresh(){
  VID.sig=null;
  const p=document.getElementById("p-video");if(p&&!p.hidden&&!VID.run&&typeof renderVideo==="function"&&!VID.cur)renderVideo();
  if(typeof RV!=="undefined"&&RV.g&&typeof revGo==="function"&&RV.ply&&!RV.v)revGo(RV.ply);
}
function vLoadShared(){
  return fetch("videos.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(d=>{VID.shared=(d&&Array.isArray(d.videos)?d.videos:[]);vRefresh()}).catch(()=>{});
}
function vLoadPriv(){
  const g=ghCfg();if(!g.t||!okRepo(g.priv)){VID.priv=[];return Promise.resolve()}
  const e=$("#ghprivst");if(e)e.innerHTML=`<span class="spin" aria-hidden="true"></span> Lecture du dépôt…`;
  return ghRead(g.priv,g.t).then(d=>{VID.priv=d.videos;VID.privErr=null;VID.sig=null;ghLive();vRefreshRevue()}).catch(err=>{VID.privErr=err.message;console.warn("dépôt privé :",err.message);ghLive()});
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
// après le script principal (store, RV… sont définis plus bas dans la page)
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{vLoadShared();vLoadPriv()});else{vLoadShared();vLoadPriv()}

/* ---------- relire la suite de la partie après un coup illisible ---------- */
async function vContinue(id){
  const v=vLib().find(x=>x.id===id),cfg=vCfg(),st=$("#vstat"),b=$("#vcont");if(!v||VID.run)return;
  const say=(t,err)=>{st.hidden=false;st.className="vstat"+(err?" err":"");st.textContent=t};
  if(!cfg.k)return say("Ajoute ta clé Gemini dans la page de la bibliothèque.",1);
  if(v.remote&&!vLocal().some(x=>x.id===v.id))return say("Cette vidéo vient d'un dépôt GitHub : importe-la de nouveau pour la compléter.",1);
  VID.run=true;vAwake(true);if(b)b.disabled=true;
  try{
    const known=v.game.sans.slice(),R0=replay(START_FEN,known),n=known.length;
    const lost=v.moments.filter(m=>m.warn&&m.warn.length).map(m=>m.sec);
    const from=lost.length?Math.max(0,Math.min(...lost)-90):null;
    const o={prev:known,cont:{fen:R0.fens[n],next:`${Math.floor(n/2)+1} des ${n%2?"noirs":"blancs"}`}};
    if(from!=null){o.from=from;o.to=v.seg&&v.seg.to?v.seg.to:from+3600}
    say(`Gemini relit la vidéo${from!=null?` à partir de ${fmtT(from)}`:""} pour lire la suite après ${plyName(n,known[n-1])}… compte 1 à 3 minutes.`);
    const {data,model}=await gemini(cfg,v.url,o,m=>say(m));
    const nw=((data.partie&&data.partie.coups)||[]).map(cleanSan);
    const J=replay(START_FEN,known.concat(nw)),A=replay(START_FEN,nw),best=A.sans.length>J.sans.length&&A.sans.slice(0,n).join()===known.join()?A:J;
    if(best.sans.length<=n)throw new Error(`Gemini n'a pas pu lire de coup valable après ${plyName(n,known[n-1])}${nw.length?` (il propose « ${nw[0]} »)`:""}. Colle le PGN si tu le connais.`);
    v.game.sans=best.sans;v.game.cut=best.bad?best.bad.san:null;v.game.fixed=(v.game.fixed||0)+(best.fixed||0);v.model=model;
    const main={sans:best.sans,fens:best.fens};
    for(const m of v.moments)if(m.warn&&m.warn.length){if(!m.rawVars)m.rawVars=(m.vars||[]).map(x=>({coups:x.sans,verdict:x.verdict}));vPlace(m,main)}
    let added=0;
    for(const x of data.moments||[]){const m=vMoment(x,main);if(!m)continue;if(v.moments.some(y=>Math.abs(y.sec-m.sec)<8&&y.ref===m.ref))continue;v.moments.push(m);added++}
    v.moments.sort((a,b)=>a.sec-b.sec);
    vSave(vLocal().map(x=>x.id===v.id?v:x));
    say(`Partie complétée : ${best.sans.length} coups vérifiés (+${best.sans.length-n})${best.bad?`, nouvel arrêt sur « ${best.bad.san} »`:""}${added?`, ${added} nouveau${added>1?"x":""} moment${added>1?"s":""}`:""}. Évaluation Stockfish…`);
    await vEval(v,i=>say(`Évaluation Stockfish : moment ${i+1}/${v.moments.length}…`));
    vSave(vLocal().map(x=>x.id===v.id?v:x));
    VID.run=false;renderVideo();
    const s2=$("#vstat");if(s2){s2.hidden=false;s2.className="vstat";s2.textContent=`Partie complétée : ${best.sans.length} coups vérifiés${best.bad?` (nouvel arrêt sur « ${best.bad.san} »)`:""} · modèle ${model}.`}
    vAutoPush(true);
  }catch(e){say("Échec : "+e.message,1)}
  finally{VID.run=false;vAwake(false);const b2=$("#vcont");if(b2)b2.disabled=false}
}

/* ---------- base de données de la version Claude (capacité db de la page) ---------- */
const vDocId=id=>String(id).replace(/[^A-Za-z0-9_\-.~:@+]/g,"_").slice(0,180);
function vClean(v){const y=JSON.parse(JSON.stringify(v));delete y.remote;return y}
async function vDbPut(v){
  if(!VID.dbh)throw new Error("base indisponible");const y=vClean(v),n=JSON.stringify(y).length;
  if(n>250000)throw new Error(`« ${v.title} » est trop volumineuse pour la base (${Math.round(n/1024)} Ko)`);
  await VID.dbh.doc("videos/"+vDocId(v.id)).set(y);
  if(!VID.dbv.some(x=>x.id===v.id))VID.dbv.push(y);VID.sig=null;
}
// enregistre une vidéo là où elle se trouve : cet appareil ou la base Claude
function vPersist(v){
  if(vLocal().some(x=>x.id===v.id))vSave(vLocal().map(x=>x.id===v.id?v:x));
  else if(VID.dbh&&VID.dbv.some(x=>x.id===v.id))vDbPut(v).catch(e=>console.warn(e));
}
function vInitDb(){
  if(VID.dbTried||!(window.claude&&typeof claude.use==="function"))return;VID.dbTried=true;
  claude.use("db").then(db=>{if(!db)return;VID.dbh=db;
    db.collection("videos").onSnapshot(snap=>{VID.dbv=snap.docs.map(d=>d.data()).filter(x=>x&&x.id&&Array.isArray(x.moments));vRefresh()},e=>console.warn("base Claude :",e&&e.message));
    vRefresh();
  }).catch(()=>{});
}
vInitDb();document.addEventListener("DOMContentLoaded",vInitDb);setTimeout(vInitDb,1500);

// envoi automatique au dépôt privé après chaque import ou complément (si jeton et dépôt configurés)
async function vAutoPush(update){
  const g=ghCfg();if(!g.t||!okRepo(g.priv))return;
  const note=t=>{const e=$("#vstat");if(e&&!e.hidden)e.textContent=e.textContent.replace(/ · (Envoi|Envoyée|Envoi impossible)[^·]*$/,"")+" · "+t};
  try{note("Envoi au dépôt privé…");const n=await ghSync("priv",update);note(`Envoyée au dépôt privé (${n} vidéo${n>1?"s":""})`)}
  catch(e){note("Envoi impossible au dépôt privé : "+e.message)}
}

// met à jour en direct les compteurs et boutons du panneau GitHub, sans redessiner la page
function ghLive(){
  const e=$("#ghprivst");if(!e)return;const g=ghCfg(),n=ghCounts();
  e.textContent=!g.t?"Colle ton jeton GitHub ci-dessus":VID.privErr?"Dépôt privé : "+VID.privErr:`${VID.priv.length} vidéo${VID.priv.length>1?"s":""} dans le dépôt privé`;
  e.className=VID.privErr?"err":"muted";
  const b=$("#ghsync");if(b){b.textContent=n.priv?`Envoyer ${n.priv} vidéo${n.priv>1?"s":""} au dépôt privé`:"Rien de nouveau à envoyer";b.disabled=!(g.t&&okRepo(g.priv)&&n.priv)}
  const p=$("#ghpub");if(p){p.textContent=n.pub?`Publier ${n.pub} vidéo${n.pub>1?"s":""} libre${n.pub>1?"s":""}`:"Rien de nouveau à publier";p.disabled=!(g.t&&n.pub)}
  document.querySelectorAll("#p-video .vitem").forEach(it=>{const v=vLib().find(x=>x.id===it.dataset.v),w=it.querySelector(".muted b");if(v&&w)w.textContent=vWhere(v)});
}

/* ---------- garder l'écran allumé pendant une analyse (Wake Lock) ---------- */
// la mise en veille de l'écran coupe les appels réseau ; fermer l'ordinateur les coupe quand même
async function vAwake(on){
  try{
    if(on){VID.awake=true;if("wakeLock" in navigator&&!VID.lock){VID.lock=await navigator.wakeLock.request("screen");VID.lock.addEventListener("release",()=>{VID.lock=null})}}
    else{VID.awake=false;if(VID.lock){const l=VID.lock;VID.lock=null;await l.release()}}
  }catch(e){}
}
// le verrou saute quand l'onglet est masqué : on le reprend au retour si l'analyse tourne encore
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&VID.awake&&VID.run)vAwake(true)});
