const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const screens = { mirror: 'Miroir', analysis: 'Analyse', try: 'Essayer', advice: 'Conseils', profile: 'Profil' };
function go(target){
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === target));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.target === target));
  $('#screenTitle').textContent = screens[target];
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-target]').forEach(b => b.addEventListener('click',()=>go(b.dataset.target)));

const modal = $('#modal');
function showModal(title, html){ $('#modalBody').innerHTML = `<h2>${title}</h2>${html}`; modal.showModal(); }
$('#modalClose').addEventListener('click',()=>modal.close());
$('#infoBtn').addEventListener('click',()=>showModal('À propos de Luma','<p>Cette V1 pose le design et le parcours : Miroir → Analyse → Essayer → Conseils → Profil. Les estimations de teinte dépendent fortement de la lumière et ne constituent pas une mesure médicale.</p>'));
$('#privacyBtn').addEventListener('click',()=>showModal('Confidentialité','<p>La V1 ne téléverse aucune photo vers un serveur. La caméra est utilisée localement dans le navigateur. Tu peux couper son accès dans les réglages du navigateur ou de l’iPhone.</p>'));

let stream = null, detectorReady = false, faceLandmarker = null, lastResults = null, loopId = null;
const video = $('#camera'), canvas = $('#overlay'), ctx = canvas.getContext('2d');

async function setupFaceLandmarker(){
  try{
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
    const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions:{ modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate:'GPU' },
      runningMode:'VIDEO', numFaces:1, outputFaceBlendshapes:false, outputFacialTransformationMatrixes:false
    });
    detectorReady = true;
  }catch(err){ console.warn('Face landmarks unavailable, fallback UI active.', err); }
}
setupFaceLandmarker();

$('#startCamera').addEventListener('click', async()=>{
  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:1600}},audio:false});
    video.srcObject = stream; await video.play();
    $('#cameraPlaceholder').style.display='none'; $('#scanBtn').disabled=false; $('#mirrorHint').textContent='Visage détecté : touche Analyser';
    resizeCanvas(); loop();
  }catch(e){ showModal('Caméra indisponible','<p>Autorise la caméra dans Safari/Chrome puis recharge la page. Sur GitHub Pages, utilise bien l’adresse HTTPS.</p>'); }
});
function resizeCanvas(){ canvas.width=video.videoWidth||720; canvas.height=video.videoHeight||960; }
window.addEventListener('resize',resizeCanvas);

function loop(){
  if(!stream) return;
  if(detectorReady && video.readyState>=2){
    try{ lastResults = faceLandmarker.detectForVideo(video, performance.now()); drawLandmarks(lastResults?.faceLandmarks?.[0]); }catch(e){}
  }
  loopId=requestAnimationFrame(loop);
}
function drawLandmarks(points){
  ctx.clearRect(0,0,canvas.width,canvas.height); if(!points) return;
  const key = [10,21,54,67,103,109,151,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,
    33,133,362,263,70,63,105,66,107,336,296,334,293,300,61,291,0,17,78,308,13,14,1,4,168];
  ctx.fillStyle='rgba(255,255,255,.82)';
  key.forEach(i=>{const p=points[i]; if(!p)return; ctx.beginPath(); ctx.arc(p.x*canvas.width,p.y*canvas.height,1.55,0,Math.PI*2); ctx.fill();});
}

const zoneData = {
  Sourcils:[['Courbure','douce à modérée'],['Épaisseur','moyenne'],['Longueur','équilibrée'],['Teinte','à estimer selon la lumière']],
  Yeux:[['Forme','à analyser'],['Écartement','proportionnel'],['Inclinaison','à mesurer'],['Teinte','détection à venir']],
  Lèvres:[['Forme','à analyser'],['Largeur','relative au visage'],['Volume','apparent'],['Teinte','détection à venir']],
  Front:[['Hauteur','relative'],['Largeur','relative'],['Contour','à analyser'],['Proportion','haut du visage']],
  'Mâchoire':[['Largeur','relative'],['Angle','à estimer'],['Menton','forme à analyser'],['Proportion','bas du visage']],
  Peau:[['Carnation','à estimer'],['Sous-ton','à confirmer'],['Contraste','à analyser'],['Uniformité','observation visuelle']]
};
$('#scanBtn').addEventListener('click',()=>{
  $('#mirrorHint').textContent='Touche une zone ci-dessous';
  showZonePicker();
});
function showZonePicker(){
  $('#zoneTitle').textContent='Choisis une zone';
  $('#zoneContent').innerHTML=Object.keys(zoneData).map(z=>`<button class="chip zone-choice" data-zone="${z}">${z}</button>`).join('');
  $('#zoneSheet').hidden=false;
  $$('.zone-choice').forEach(b=>b.addEventListener('click',()=>showZone(b.dataset.zone)));
}
function showZone(zone){
  $('#zoneTitle').textContent=zone;
  $('#zoneContent').innerHTML=zoneData[zone].map(([a,b])=>`<div class="metric"><small>${a}</small><strong>${b}</strong></div>`).join('');
}
$('#closeZone').addEventListener('click',()=>$('#zoneSheet').hidden=true);

const analysisCards = [
  ['Forme du visage','Mesures des proportions du front, des pommettes, de la mâchoire et du menton.'],
  ['Sourcils recommandés','2 à 3 formes proposées selon la morphologie, sans modifier le Miroir.'],
  ['Colorimétrie','Estimation inclusive de la carnation, du sous-ton, du contraste et des teintes qui harmonisent le visage.'],
  ['Yeux & contraste','Prise en compte de toutes les nuances d’yeux et du contraste global du visage.']
];
$('#runAnalysis').addEventListener('click',()=>{
  $('#analysisCards').innerHTML=analysisCards.map((c,i)=>`<article class="analysis-card"><span class="eyebrow">${String(i+1).padStart(2,'0')}</span><h3>${c[0]}</h3><p>${c[1]}</p>${i===2?'<div class="palette"><i class="swatch" style="background:#8d5f52"></i><i class="swatch" style="background:#c98e7a"></i><i class="swatch" style="background:#b87080"></i><i class="swatch" style="background:#745d79"></i></div>':''}</article>`).join('');
});

const cats=['Sourcils','Yeux','Blush','Bronzer','Lèvres','Teint'];
$('#tryCategories').innerHTML=cats.map(c=>`<button class="chip">${c}</button>`).join('');
$$('#tryCategories .chip').forEach(b=>b.addEventListener('click',()=>{
  $$('#tryCategories .chip').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  $('#tryMessage').textContent=`Mode ${b.textContent} sélectionné — les essais réalistes en réalité augmentée seront branchés dans la prochaine étape.`;
}));

const moods=[['🌸','Douce'],['✨','Confiante'],['🔥','Audacieuse'],['😌','Chill'],['🌙','Mystérieuse']];
$('#moods').innerHTML=moods.map(m=>`<button class="chip" data-mood="${m[1]}">${m[0]} ${m[1]}</button>`).join('');
$$('#moods .chip').forEach(b=>b.addEventListener('click',()=>{
  $$('#moods .chip').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  $('#moodResult').hidden=false; $('#moodResult').innerHTML=`<h3>Look ${b.dataset.mood}</h3><p>Une proposition adaptée à ton analyse, ta carnation, tes yeux et ta colorimétrie apparaîtra ici.</p>`;
}));
$('#adviceList').innerHTML=[['Blush','Placement et teinte recommandés selon la morphologie et la carnation.'],['Bronzer','Placement naturel pour accompagner les volumes du visage.'],['Sourcils','Guide personnalisé basé sur la forme recommandée dans Analyse.'],['Yeux','Conseils de teintes et de placement selon la forme et la nuance des yeux.']].map(x=>`<article class="advice-card"><h3>${x[0]}</h3><p>${x[1]}</p></article>`).join('');

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));


// Passcode lock — interface-only protection for this static PWA.
const passcodeLock = $('#passcodeLock');
const passcodeDots = $$('#passcodeDots span');
const passcodeDotsBox = $('#passcodeDots');
const passcodeError = $('#passcodeError');
let enteredPasscode = '';
let passcodeBusy = false;
const APP_PASSCODE = '071079';

function renderPasscode(){
  passcodeDots.forEach((dot,i)=>dot.classList.toggle('filled', i < enteredPasscode.length));
  passcodeDotsBox.setAttribute('aria-label', `Code saisi : ${enteredPasscode.length} chiffre${enteredPasscode.length>1?'s':''} sur 6`);
}
function clearPasscodeError(){ passcodeError.textContent=''; }
function unlockApp(){
  passcodeLock.classList.add('unlocked');
  document.body.classList.remove('locked');
  setTimeout(()=>{ passcodeLock.hidden=true; },420);
}
function wrongPasscode(){
  passcodeBusy=true;
  passcodeError.textContent='Code incorrect';
  passcodeDotsBox.classList.remove('wrong');
  void passcodeDotsBox.offsetWidth;
  passcodeDotsBox.classList.add('wrong');
  if(navigator.vibrate) navigator.vibrate(70);
  setTimeout(()=>{
    enteredPasscode='';
    renderPasscode();
    passcodeBusy=false;
  },420);
}
function submitPasscodeDigit(digit){
  if(passcodeBusy || enteredPasscode.length>=6) return;
  clearPasscodeError();
  enteredPasscode += digit;
  renderPasscode();
  if(enteredPasscode.length===6){
    if(enteredPasscode===APP_PASSCODE){
      passcodeBusy=true;
      setTimeout(unlockApp,120);
    }else wrongPasscode();
  }
}
$('#keypad').addEventListener('click',(e)=>{
  const key=e.target.closest('[data-key]');
  if(key) submitPasscodeDigit(key.dataset.key);
});
$('#deleteKey').addEventListener('click',()=>{
  if(passcodeBusy || !enteredPasscode.length) return;
  enteredPasscode=enteredPasscode.slice(0,-1);
  clearPasscodeError();
  renderPasscode();
});
window.addEventListener('keydown',(e)=>{
  if(passcodeLock.hidden || passcodeLock.classList.contains('unlocked')) return;
  if(/^\\d$/.test(e.key)) submitPasscodeDigit(e.key);
  else if(e.key==='Backspace') $('#deleteKey').click();
});
renderPasscode();
