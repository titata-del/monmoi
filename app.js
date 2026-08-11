import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const PASSCODE = "071079";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

let pin = "";
let stream = null;
let landmarker = null;
let lastVideoTime = -1;
let latestLandmarks = null;
let latestAnalysis = null;
let raf = null;
let activeZone = "face";
let activeEffect = "brows";
let effectIntensity = 0.55;
let activeColor = "#8a5a52";
let activeMood = null;
let sampleCanvas = document.createElement("canvas");
let sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const videos = [$("#mirrorVideo"), $("#tryVideo"), $("#adviceVideo")];

function buildPinUI(){
  const dots = $("#pinDots");
  dots.innerHTML = "";
  for(let i=0;i<6;i++){
    const d = document.createElement("span");
    d.className = "pin-dot" + (i < pin.length ? " on" : "");
    dots.appendChild(d);
  }
  const keypad = $("#keypad");
  keypad.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","","0","del"].forEach(v=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="key"+(v===""?" blank":"");
    b.disabled=v==="";
    b.textContent=v==="del"?"⌫":v;
    if(v!=="") b.addEventListener("click",()=>tapPin(v));
    keypad.appendChild(b);
  });
}
function tapPin(v){
  if(v==="del"){ pin=pin.slice(0,-1); $("#pinError").textContent=""; buildPinUI(); return; }
  if(pin.length>=6) return;
  pin += v; buildPinUI();
  if(pin.length===6){
    setTimeout(()=>{
      if(pin===PASSCODE){
        $("#lockScreen").classList.add("hidden");
        $("#mainApp").classList.remove("hidden");
      } else {
        $("#pinError").textContent="Code incorrect";
        pin=""; buildPinUI();
      }
    },100);
  }
}
buildPinUI();

$$(".nav-button").forEach(btn=>btn.addEventListener("click",()=>{
  const tab=btn.dataset.tab;
  $$(".nav-button").forEach(b=>b.classList.toggle("active",b===btn));
  $$(".tab-view").forEach(v=>v.classList.toggle("active",v.id===`tab-${tab}`));
  $("#screenTitle").textContent = ({mirror:"Miroir",analysis:"Analyse",try:"Essayer",advice:"Conseils",profile:"Profil"})[tab];
}));

$$(".zone-chip").forEach(btn=>btn.addEventListener("click",()=>{
  activeZone=btn.dataset.zone;
  $$(".zone-chip").forEach(b=>b.classList.toggle("active",b===btn));
  renderMirrorZone();
}));

$$(".try-chip").forEach(btn=>btn.addEventListener("click",()=>{
  activeEffect=btn.dataset.effect;
  $$(".try-chip").forEach(b=>b.classList.toggle("active",b===btn));
  buildEffectColors();
}));

$("#effectIntensity").addEventListener("input",e=>{
  effectIntensity=Number(e.target.value)/100;
});

const palettes = {
  brows:["#4c342f","#69483e","#8c6656","#2f2727"],
  eyes:["#9a786f","#8c6d8f","#806f5b","#6b728b"],
  blush:["#d98b96","#d47f72","#ba6e76","#c983a7"],
  bronzer:["#a86f4b","#8d5e43","#bd8357","#79503d"],
  lips:["#a34f5d","#b9656b","#8f4052","#c87875"],
  complexion:["#e7b69d","#d99b80","#b7745d","#8a503f"]
};
function buildEffectColors(){
  const wrap=$("#effectColors");
  wrap.innerHTML="";
  (palettes[activeEffect]||palettes.lips).forEach((c,i)=>{
    const b=document.createElement("button");
    b.type="button"; b.className="color-button"+(i===0?" active":"");
    b.style.background=c; b.setAttribute("aria-label",`Couleur ${i+1}`);
    b.addEventListener("click",()=>{
      activeColor=c; $$(".color-button").forEach(x=>x.classList.remove("active")); b.classList.add("active");
    });
    wrap.appendChild(b);
  });
  activeColor=(palettes[activeEffect]||palettes.lips)[0];
}
buildEffectColors();

$$(".mood-card").forEach(btn=>btn.addEventListener("click",()=>{
  activeMood=btn.dataset.mood;
  $$(".mood-card").forEach(b=>b.classList.toggle("active",b===btn));
  const copy={
    soft:["Douce 🌸","Blush rosé diffus, lèvres fraîches et regard léger."],
    confident:["Confiante ✨","Sourcils structurés, teint lumineux et lèvres équilibrées."],
    bold:["Audacieuse 🔥","Regard plus intense, bronzer plus présent et lèvres affirmées."],
    chill:["Chill 😌","Teint naturel, blush très léger et couleurs discrètes."]
  }[activeMood];
  $("#moodTitle").textContent=copy[0];
  $("#moodDescription").textContent=copy[1];
}));

$("#cameraButton").addEventListener("click",startCamera);

$("#flashButton").addEventListener("click", async ()=>{
  const flash=$("#screenFlash");
  flash.classList.add("on");
  $("#guideMessage").textContent="Éclairage du visage…";
  await new Promise(r=>setTimeout(r,520));
  flash.classList.remove("on");
  setTimeout(()=>{
    if(latestLandmarks) $("#guideMessage").textContent="Analyse active";
  },180);
});

async function initLandmarker(){
  $("#cameraStatus").textContent="Chargement de l’analyse…";
  const vision=await FilesetResolver.forVisionTasks(WASM_URL);
  landmarker=await FaceLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},
    runningMode:"VIDEO",
    numFaces:1,
    minFaceDetectionConfidence:.55,
    minFacePresenceConfidence:.55,
    minTrackingConfidence:.55,
    outputFaceBlendshapes:true,
    outputFacialTransformationMatrixes:true
  });
}

async function startCamera(){
  try{
    $("#cameraButton").disabled=true;
    $("#cameraStatus").textContent="Demande caméra…";
    stream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:"user"},
        width:{ideal:720},
        height:{ideal:960}
      },
      audio:false
    });
    videos.forEach(v=>v.srcObject=stream);
    await Promise.all(videos.map(v=>v.play().catch(()=>{})));
    await initLandmarker();
    $("#cameraStatus").textContent="Analyse en direct";
    $("#cameraButton").textContent="Active";
    $("#guideMessage").textContent="Place ton visage face caméra";
    $("#tryHint").textContent="Analyse en direct";
    $("#adviceHint").textContent="Analyse en direct";
    loop();
  }catch(err){
    console.error(err);
    $("#cameraStatus").textContent="Caméra refusée ou indisponible";
    $("#cameraButton").disabled=false;
    $("#cameraButton").textContent="Réessayer";
  }
}

function loop(){
  if(!stream || !landmarker){ raf=requestAnimationFrame(loop); return; }
  const v=$("#mirrorVideo");
  if(v.readyState>=2 && v.currentTime!==lastVideoTime){
    lastVideoTime=v.currentTime;
    const now=performance.now();
    const result=landmarker.detectForVideo(v,now);
    if(result.faceLandmarks?.length){
      latestLandmarks=result.faceLandmarks[0];
      latestAnalysis=analyzeFace(latestLandmarks,v);
      updateAnalysisUI(latestAnalysis);
      $("#cameraStatus").textContent="Visage détecté ✓ · analyse en direct";
      $("#guideMessage").textContent="Analyse active";
      drawLandmarks($("#mirrorCanvas"),v,latestLandmarks);
      drawMakeup($("#tryCanvas"),$("#tryVideo"),latestLandmarks,activeEffect,activeColor,effectIntensity);
      drawMood($("#adviceCanvas"),$("#adviceVideo"),latestLandmarks,activeMood);
      renderMirrorZone();
    }else{
      latestLandmarks=null;
      $("#cameraStatus").textContent="Place ton visage face caméra";
      $("#guideMessage").textContent="Visage non détecté";
      clearCanvas($("#mirrorCanvas"));
      clearCanvas($("#tryCanvas"));
      clearCanvas($("#adviceCanvas"));
    }
  }
  raf=requestAnimationFrame(loop);
}

function P(lm,i){return lm[i]}
function d(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function avg(...n){return n.reduce((a,b)=>a+b,0)/n.length}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function label3(v,a,b,labels){return v<a?labels[0]:v>b?labels[2]:labels[1]}
function signedSlope(a,b){return (b.y-a.y)/(Math.abs(b.x-a.x)+1e-6)}

function analyzeFace(lm,video){
  // Face proportions using stable MediaPipe landmark anchors.
  const left=P(lm,234), right=P(lm,454), top=P(lm,10), chin=P(lm,152);
  const faceW=d(left,right), faceH=d(top,chin), ratio=faceH/(faceW||1);

  const jawL=P(lm,172), jawR=P(lm,397);
  const jawW=d(jawL,jawR)/(faceW||1);

  const foreheadY=(P(lm,10).y + P(lm,151).y)/2;
  const browY=avg(P(lm,70).y,P(lm,300).y);
  const eyeY=avg(P(lm,33).y,P(lm,263).y);
  const foreheadShare=(browY-foreheadY)/(faceH||1);

  const mouthW=d(P(lm,61),P(lm,291))/(faceW||1);
  const lipH=d(P(lm,13),P(lm,14))/(faceH||1);

  const eyeLeftW=d(P(lm,33),P(lm,133));
  const eyeLeftH=d(P(lm,159),P(lm,145));
  const eyeRatio=eyeLeftW/(eyeLeftH||1);
  const eyeSlope=avg(signedSlope(P(lm,33),P(lm,133)),signedSlope(P(lm,362),P(lm,263)));

  const browThickness=avg(d(P(lm,70),P(lm,63)),d(P(lm,300),P(lm,293)))/(faceH||1);
  const browArch=avg(
    P(lm,105).y - avg(P(lm,70).y,P(lm,107).y),
    P(lm,334).y - avg(P(lm,300).y,P(lm,336).y)
  )/(faceH||1);

  const chinWidth=d(P(lm,176),P(lm,400))/(faceW||1);

  let faceShape="ovale";
  if(ratio>1.55) faceShape="allongé";
  else if(ratio<1.25 && jawW>0.72) faceShape="rond";
  else if(jawW>0.78) faceShape="carré";
  else if(chinWidth<0.28 && jawW<0.70) faceShape="cœur";

  const forehead=label3(foreheadShare,.17,.24,["court","moyen","haut"]);
  const eyeShape=eyeRatio>3.2?"amande":eyeRatio<2.5?"rond":"amande douce";
  const eyeTilt=eyeSlope<-0.08?"relevée":eyeSlope>0.08?"descendante":"neutre";
  const browSize=label3(browThickness,.010,.018,["fin","moyen","épais"]);
  const browShape=browArch<-0.018?"arqué":Math.abs(browArch)<0.010?"droit":"courbe douce";
  const lipWidth=label3(mouthW,.34,.43,["étroite","moyenne","large"]);
  const lipVolume=label3(lipH,.018,.035,["fin","moyen","plein"]);
  const lipShape=lipVolume==="plein"?"pulpeuse":lipWidth==="large"?"étirée douce":lipVolume==="fin"?"fine définie":"équilibrée";
  const jaw=label3(jawW,.66,.76,["fine","moyenne","large"]);
  const chinShape=chinWidth<.24?"pointu":chinWidth>.34?"large et arrondi":"arrondi";

  const colors=sampleColors(video,lm);
  return {faceShape,forehead,foreheadShare,eyeShape,eyeTilt,browSize,browShape,lipWidth,lipVolume,lipShape,jaw,chinShape,...colors};
}

function getPixel(video,x,y){
  const w=video.videoWidth,h=video.videoHeight;
  if(!w||!h) return [180,140,125];
  sampleCanvas.width=w; sampleCanvas.height=h;
  sampleCtx.drawImage(video,0,0,w,h);
  const px=clamp(Math.round(x*w),0,w-1), py=clamp(Math.round(y*h),0,h-1);
  const data=sampleCtx.getImageData(px,py,1,1).data;
  return [data[0],data[1],data[2]];
}
function mixColor(samples){
  const n=samples.length;
  return samples.reduce((a,c)=>[a[0]+c[0]/n,a[1]+c[1]/n,a[2]+c[2]/n],[0,0,0]).map(Math.round);
}
function rgbHex(c){return "#"+c.map(v=>v.toString(16).padStart(2,"0")).join("")}
function luminance([r,g,b]){return .2126*r+.7152*g+.0722*b}
function sampleColors(video,lm){
  const skin=mixColor([
    getPixel(video,P(lm,123).x,P(lm,123).y),
    getPixel(video,P(lm,352).x,P(lm,352).y),
    getPixel(video,P(lm,9).x,P(lm,9).y)
  ]);
  const lips=mixColor([
    getPixel(video,P(lm,13).x,P(lm,13).y),
    getPixel(video,P(lm,14).x,P(lm,14).y)
  ]);
  const brows=mixColor([
    getPixel(video,P(lm,70).x,P(lm,70).y),
    getPixel(video,P(lm,300).x,P(lm,300).y)
  ]);
  const irisL=getPixel(video,P(lm,468)?.x ?? P(lm,159).x,P(lm,468)?.y ?? P(lm,159).y);
  const irisR=getPixel(video,P(lm,473)?.x ?? P(lm,386).x,P(lm,473)?.y ?? P(lm,386).y);
  const iris=mixColor([irisL,irisR]);
  const warmth=(skin[0]-skin[2])+(skin[1]-skin[2])*.25;
  const undertone=warmth>45?"chaud":warmth<25?"froid":"neutre";
  const light=luminance(skin);
  const complexion=light>190?"claire":light>145?"moyenne":light>100?"mate":"profonde";
  const contrast=Math.abs(luminance(skin)-luminance(iris));
  const contrastLabel=contrast>95?"fort":contrast>55?"moyen":"doux";
  return {
    skinHex:rgbHex(skin),lipHex:rgbHex(lips),irisHex:rgbHex(iris),browHex:rgbHex(brows),
    undertone,complexion,contrastLabel
  };
}

function updateAnalysisUI(a){
  $("#aFace").textContent=`Visage ${a.faceShape}. Structure globale détectée à partir du contour et des proportions du visage.`;
  $("#aForehead").textContent=`Front ${a.forehead}. Sa place dans le tiers supérieur du visage est ${a.forehead==="haut"?"marquée":a.forehead==="court"?"compacte":"équilibrée"}.`;
  $("#aEyes").textContent=`Yeux ${a.eyeShape}, inclinaison ${a.eyeTilt}. Avec cette lumière, l’iris détecté est ${a.irisHex}.`;
  $("#aBrows").textContent=`Sourcils ${a.browSize}, forme ${a.browShape}. Avec cette lumière, teinte détectée : ${a.browHex}.`;
  $("#aLips").textContent=`Lèvres ${a.lipShape}, largeur ${a.lipWidth}, volume ${a.lipVolume}. Teinte détectée maintenant : ${a.lipHex}.`;
  $("#aJaw").textContent=`Mâchoire ${a.jaw}. Menton ${a.chinShape}.`;
  $("#aColor").textContent=`Carnation ${a.complexion}, sous-ton ${a.undertone}, contraste ${a.contrastLabel}. La couleur de peau lue maintenant est ${a.skinHex}; ces valeurs suivent l’image de la caméra.`;
  $("#aBrowAdvice").textContent=browAdvice(a.faceShape);
  $("#profileAnalysis").textContent=`Visage ${a.faceShape} · yeux ${a.eyeShape} · mâchoire ${a.jaw}.`;
  $("#profileColor").textContent=`Carnation ${a.complexion} · sous-ton ${a.undertone} · contraste ${a.contrastLabel}.`;
  const pal=recommendPalette(a);
  $("#palette").innerHTML=pal.map(c=>`<span class="palette-swatch" style="background:${c}"></span>`).join("");
}
function browAdvice(shape){
  const map={
    rond:"Soft arch : un arc doux apporte de la structure tout en gardant un résultat naturel.",
    allongé:"Droit doux : une ligne moins arquée équilibre visuellement la longueur du visage.",
    carré:"Arc doux : une courbe souple adoucit la structure de la mâchoire.",
    cœur:"Arc léger : une montée progressive équilibre le front et le menton.",
    ovale:"Arc naturel : la morphologie accepte une ligne douce sans correction marquée."
  };
  return map[shape]||map.ovale;
}
function recommendPalette(a){
  if(a.undertone==="chaud") return ["#D28A70","#B96F52","#9B6A46","#C77A72"];
  if(a.undertone==="froid") return ["#C9859C","#A86882","#8D718A","#B86276"];
  return ["#CD8A82","#B67B75","#9B786A","#B76D83"];
}

function renderMirrorZone(){
  if(!latestAnalysis) return;
  const a=latestAnalysis;
  const data={
    face:["Visage",`Forme ${a.faceShape}. Structure globale analysée en direct.`],
    forehead:["Front",`Hauteur ${a.forehead}. Proportion ${a.forehead==="haut"?"dominante":a.forehead==="court"?"compacte":"équilibrée"}.`],
    brows:["Sourcils",`Épaisseur ${a.browSize}. Forme ${a.browShape}. Avec cette lumière : ${a.browHex}.`],
    eyes:["Yeux",`Forme ${a.eyeShape}. Inclinaison ${a.eyeTilt}. Avec cette lumière : ${a.irisHex}.`],
    lips:["Lèvres",`Forme ${a.lipShape}. Largeur ${a.lipWidth}. Volume ${a.lipVolume}. Teinte ${a.lipHex}.`],
    jaw:["Mâchoire",`Mâchoire ${a.jaw}. Menton ${a.chinShape}.`],
    skin:["Peau",`Carnation ${a.complexion}. Sous-ton ${a.undertone}. Contraste ${a.contrastLabel}. Couleur caméra ${a.skinHex}.`]
  }[activeZone];
  $("#mirrorResultTitle").textContent=data[0];
  $("#mirrorResult").textContent=data[1];
}

function fitCanvas(canvas,video){
  const r=video.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(r.width*dpr); canvas.height=Math.round(r.height*dpr);
  canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";
  const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,w:r.width,h:r.height};
}
function clearCanvas(canvas){
  const c=canvas.getContext("2d");c.clearRect(0,0,canvas.width,canvas.height);
}
function mapPoint(p,w,h){return {x:(1-p.x)*w,y:p.y*h}}
function drawLandmarks(canvas,video,lm){
  const {ctx,w,h}=fitCanvas(canvas,video);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle="rgba(255,255,255,.72)";
  const indices=[10,21,54,58,93,132,152,361,323,288,284,251,70,63,105,66,107,336,296,334,293,300,33,133,159,145,362,263,386,374,61,13,14,291,172,397];
  indices.forEach(i=>{const p=mapPoint(lm[i],w,h);ctx.beginPath();ctx.arc(p.x,p.y,1.35,0,Math.PI*2);ctx.fill()});
}

function rgba(hex,a){
  const n=parseInt(hex.slice(1),16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}
function pathPoints(ctx,lm,indices,w,h){
  indices.forEach((i,k)=>{const p=mapPoint(lm[i],w,h); if(k===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)});
}
function drawMakeup(canvas,video,lm,effect,color,intensity){
  if(!lm) return;
  const {ctx,w,h}=fitCanvas(canvas,video);
  ctx.clearRect(0,0,w,h);
  const a=Math.max(.03,intensity*.34);
  ctx.lineCap="round";ctx.lineJoin="round";

  if(effect==="lips"){
    ctx.fillStyle=rgba(color,a+.18);
    ctx.beginPath();pathPoints(ctx,lm,[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61],w,h);ctx.closePath();ctx.fill();
  }
  if(effect==="blush"){
    [123,352].forEach(i=>{const p=mapPoint(lm[i],w,h);const g=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,w*.10);g.addColorStop(0,rgba(color,a));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,w*.11,0,Math.PI*2);ctx.fill()});
  }
  if(effect==="bronzer"){
    ctx.strokeStyle=rgba(color,a);ctx.lineWidth=w*.045;
    [[127,34,139],[356,264,368],[172,136,150],[397,365,379]].forEach(seq=>{ctx.beginPath();pathPoints(ctx,lm,seq,w,h);ctx.stroke()});
  }
  if(effect==="eyes"){
    ctx.strokeStyle=rgba(color,a+.1);ctx.lineWidth=w*.025;
    [[33,160,158,133],[362,385,387,263]].forEach(seq=>{ctx.beginPath();pathPoints(ctx,lm,seq,w,h);ctx.stroke()});
  }
  if(effect==="brows"){
    ctx.strokeStyle=rgba(color,a+.15);ctx.lineWidth=w*.018;
    [[70,63,105,66,107],[336,296,334,293,300]].forEach(seq=>{ctx.beginPath();pathPoints(ctx,lm,seq,w,h);ctx.stroke()});
  }
  if(effect==="complexion"){
    const c=mapPoint(lm[1],w,h);const grad=ctx.createRadialGradient(c.x,c.y,w*.06,c.x,c.y,w*.36);grad.addColorStop(0,rgba(color,a*.18));grad.addColorStop(1,rgba(color,0));ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  }
}
function drawMood(canvas,video,lm,mood){
  if(!mood){clearCanvas(canvas);return}
  const recipe={
    soft:[["blush","#D98B96",.42],["lips","#B9656B",.35],["eyes","#9A786F",.22]],
    confident:[["brows","#69483E",.48],["blush","#C77A72",.35],["lips","#A34F5D",.42]],
    bold:[["eyes","#6B526F",.55],["bronzer","#8D5E43",.45],["lips","#8F4052",.58]],
    chill:[["complexion","#D9A18A",.20],["blush","#D98B96",.24],["lips","#C87875",.22]]
  }[mood];
  const {ctx,w,h}=fitCanvas(canvas,video);ctx.clearRect(0,0,w,h);
  const temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;
  recipe.forEach(([effect,color,intensity])=>{
    drawMakeup(temp,video,lm,effect,color,intensity);
    ctx.drawImage(temp,0,0,w,h);
    temp.getContext("2d").clearRect(0,0,temp.width,temp.height);
  });
}

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
}