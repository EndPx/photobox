import {DEFAULTS,poseCount} from './model.mjs';
import {FILTERS,FRAMES,loadFrame,loadPaperTexture,composeSheet} from './frame-art.mjs';
import {api,createCheckout} from './checkout.js';
const $=s=>document.querySelector(s),app=$('#app'),modal=$('#modal');
const settings = {...DEFAULTS};
let shopConfig = null;
let shopLoad = null;
function loadShop() {
  if (!shopLoad) shopLoad = api('shop').then(config => {
    shopConfig = config;
    settings.price = config.price;
    settings.countdown = config.countdown;
    return config;
  }).finally(() => { shopLoad = null; });
  return shopLoad;
}
const checkout = createCheckout({
  root:app,
  onPaid(id) {
    state.sessionId = id;
    startCapture();
  },
  onHome:() => resetHome()
});
let state={screen:'home',layout:'strip',frame:FRAMES[0].id,copies:1,filter:'original',editorTab:'frame',editPose:0,edits:[],demo:false,photos:[],stream:null,busy:false,sessionId:null,ready:false,result:null,file:null};
let timer,run=0,toastTimer;
const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500)}
function bind(id,fn){const el=document.getElementById(id);if(el)el.addEventListener('click',fn)}
function stopCamera(){run++;clearTimeout(timer);state.busy=false;if(state.stream)state.stream.getTracks().forEach(t=>t.stop());state.stream=null;state.ready=false;}
function top(title,description,step){return `<div class="page-top"><div><div class="eyebrow">${state.demo?'<span class="demo-badge">MODE DEMO · tanpa transaksi</span>':`<span class="tiny-star" aria-hidden="true">${step===1?'✦':'✳'}</span> PHOTOBOX SESSION`}</div><h1>${title}</h1><p>${description}</p></div><nav class="stepper" aria-label="Tahapan sesi">${['Pembayaran','Ambil foto','Frame & cetak'].map((x,i)=>`<span class="${step===i?'active':''}" ${step===i?'aria-current="step"':''}><b>${i+1}</b>${x}</span>`).join('')}</nav></div>`;}
function frameOptions() {
  return `<div class="frame-options">${FRAMES.map(frame=>`
    <button class="frame-option ${state.frame===frame.id?'selected':''}" data-frame="${frame.id}" aria-pressed="${state.frame===frame.id}">
      <img src="${frame.src}" alt="" width="${frame.width}" height="${frame.height}">
      <span>${frame.name}</span>
    </button>`).join('')}
  </div>`;
}
function attachFrames(callback){document.querySelectorAll('[data-frame]').forEach(b=>b.addEventListener('click',()=>{state.frame=b.dataset.frame;document.querySelectorAll('[data-frame]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b)});callback()}));}
function render() {
  document.body.dataset.screen = state.screen;
  if (state.result) $('#print-image').src = state.result;
  else $('#print-image').removeAttribute('src');
  if (state.screen === 'home') home();
  if (state.screen === 'capture') captureScreen();
  if (state.screen === 'result') resultScreen();
  if (state.screen === 'finish') finishScreen();
}
function home() {
  app.innerHTML = `<section class="obor-home" aria-label="Photobox Simpang Samping Obor">
    <div class="home-copy">
      <p class="home-overline">SIMPANG SAMPING OBOR</p>
      <h1>Photobox<span aria-hidden="true">.</span></h1>
      <p class="home-subtitle">3 pose, satu kenangan.</p>
      <button class="primary hero-start" id="start-button">${checkout.hasActive()?'LANJUTKAN SESI':'PRESS TO START'}</button>
      <p class="home-price">${money(settings.price)} per sesi</p>
      <button class="quiet home-demo" id="demo-button">Coba dengan foto ilustrasi</button>
    </div>
    <div class="home-art" aria-hidden="true"></div>
  </section>`;
  bind('start-button',()=>newSession(false));
  bind('demo-button',()=>newSession(true));
  for (const frame of FRAMES) loadFrame(frame).catch(()=>{});
}
async function newSession(demo) {
  stopCamera();
  checkout.hide();
  Object.assign(state,{
    layout:'strip',frame:FRAMES[0].id,copies:1,demo,photos:[],sessionId:null,filter:'original',result:null,file:null
  });
  if (demo) return startCapture();
  const launch = $('#start-button');
  if (launch) launch.disabled = true;
  try {
    const config = await loadShop();
    state.screen = 'payment';
    document.body.dataset.screen = 'payment';
    checkout.open(config);
    window.scrollTo(0,0);
  } catch (error) {
    toast(error.message);
  } finally {
    if (launch) launch.disabled = false;
  }
}
function openModal(html){$('#modal-content').innerHTML=html;if(!modal.open)modal.showModal();bind('close-modal',()=>modal.close())}
function closeButton(){return '<button class="icon-button" id="close-modal" aria-label="Tutup">×</button>'}
function startCapture(){state.screen='capture';state.photos=[];state.result=null;state.file=null;state.filter='original';state.editorTab='frame';state.editPose=0;state.edits=[];render();window.scrollTo(0,0);if(state.demo){state.ready=true;drawDemoLive();updateCameraControls();}}
function captureScreen(){const count=poseCount(state.layout);app.innerHTML=top('Sedikit senyum, yuk.','Bersiap di depan kamera. Hitung mundur berjalan saat kamu menekan Mulai Foto.',1)+`<div class="camera-layout"><div><div class="camera-stage" id="camera-stage">${state.demo?'<canvas id="demo-live" width="1000" height="750"></canvas>':'<video id="camera-video" autoplay playsinline muted></video><div class="camera-idle" id="camera-idle"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="7" y="16" width="50" height="37" rx="5"/><path d="m20 16 5-8h14l5 8"/><circle cx="32" cy="34" r="12"/></svg><h2>Siapkan pose terbaikmu.</h2><p id="camera-message">Izinkan akses kamera. Kamera hanya aktif selama sesi foto.</p><button class="secondary" id="enable-camera">Aktifkan kamera</button></div>'}<div class="camera-overlay"></div><span class="camera-caption">${state.demo?'Ilustrasi demo':'Kamera belum aktif'} · ${count} pose</span><div class="countdown" id="countdown" style="display:none"></div></div><div class="camera-toolbar"><div class="camera-status" id="camera-status"><strong>Pose 1 dari ${count}</strong>Countdown ${settings.countdown} detik per pose</div><div class="button-row">${state.demo?'':'<button class="secondary" id="switch-camera" disabled>Balik kamera</button>'}<button class="primary" id="take-photos" ${state.demo?'':'disabled'}>Mulai Foto</button></div></div><p class="photo-note">${state.demo?'Mode demo menggunakan ilustrasi. Tidak mengakses kamera atau mencatat pendapatan.':'Foto diproses di perangkat ini. Hasil foto tidak disimpan di rekap; unduh sebelum mengakhiri sesi.'}</p>${state.demo?'':`<label class="quiet upload-label">Pakai foto dari perangkat<input id="upload-photos" type="file" accept="image/*" multiple hidden></label>`}</div><aside class="camera-sidebar" id="camera-thumbs">${Array.from({length:count},(_,i)=>`<div class="shot-thumb"><span>${i+1}</span><div class="shot-placeholder" aria-hidden="true">✦</div></div>`).join('')}<button class="primary" id="review-button" disabled>Lihat hasil</button></aside></div><button class="quiet" id="cancel-session">${state.demo?'Kembali ke awal':'Jeda sesi'}</button>`;
bind('enable-camera',()=>enableCamera());bind('switch-camera',()=>enableCamera(state.facing==='environment'?'user':'environment'));bind('take-photos',()=>takeSequence());bind('review-button',()=>{if(state.photos.length===count){stopCamera();state.screen='result';render();window.scrollTo(0,0)}});bind('cancel-session',()=>exitSession());const upload=$('#upload-photos');if(upload)upload.addEventListener('change',uploadPhotos);$('#countdown').style.display='none';}
async function enableCamera(facing='user'){if(state.busy)return;const btn=$('#enable-camera');if(btn){btn.disabled=true;btn.textContent='Membuka kamera…'}const token=++run;if(state.stream)state.stream.getTracks().forEach(t=>t.stop());state.stream=null;state.ready=false;updateCameraControls();try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1440}}});if(token!==run||state.screen!=='capture'){stream.getTracks().forEach(t=>t.stop());return;}state.stream=stream;facing=stream.getVideoTracks()[0]?.getSettings().facingMode||facing;state.facing=facing;const video=$('#camera-video');video.srcObject=stream;await video.play();if(token!==run)return;state.ready=true;video.classList.toggle('mirror',settings.mirror&&facing==='user');$('#camera-idle').hidden=true;$('.camera-caption').textContent=(facing==='user'?'Kamera depan':'Kamera belakang')+' · '+poseCount(state.layout)+' pose';updateCameraControls();}catch(error){if(token!==run)return;state.ready=false;if(state.stream)state.stream.getTracks().forEach(t=>t.stop());state.stream=null;$('#camera-idle').hidden=false;$('#camera-message').textContent=error.name==='NotAllowedError'?'Akses kamera belum diizinkan. Buka pengaturan situs di Safari, izinkan kamera, lalu coba lagi.':error.name==='NotFoundError'?'Kamera tidak ditemukan. Sambungkan kamera atau pilih foto dari perangkat.':'Kamera belum bisa dibuka. Coba Safari lewat HTTPS dan tutup aplikasi lain yang memakai kamera.';if(btn){btn.disabled=false;btn.textContent='Coba kamera lagi'}updateCameraControls();}}
function updateCameraControls(){const count=poseCount(state.layout),take=$('#take-photos');if(!take)return;take.disabled=!state.ready||state.busy||state.photos.length===count;const swap=$('#switch-camera');if(swap)swap.disabled=!state.ready||state.busy;$('#review-button').disabled=state.photos.length!==count||state.busy;$('#cancel-session').disabled=state.busy;$('#brand-home').disabled=state.busy;const upload=$('#upload-photos');if(upload)upload.disabled=state.busy;take.textContent=state.photos.length===count?'Semua pose sudah diambil':state.busy?'Sesi berjalan…' : `Mulai Foto`;}
function drawDemoLive(){const el=$('#demo-live');if(!el)return;el.getContext('2d').drawImage(demoPhoto(state.photos.length),0,0,el.width,el.height)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function takeSequence(){if(state.busy||!state.ready)return;state.busy=true;const token=run;updateCameraControls();try{const count=poseCount(state.layout);for(let i=state.photos.length;i<count;i++){if(token!==run||state.screen!=='capture')return;$('#camera-status').innerHTML=`<strong>Pose ${i+1} dari ${count}</strong>${i===0?'Siap-siap…':'Ganti pose, yuk!'}`;if(state.demo)drawDemoLive();const clock=$('#countdown');clock.style.display='grid';for(let n=settings.countdown;n>0;n--){clock.textContent=n;await delay(1000);if(token!==run)return;}clock.style.display='none';let shot;if(state.demo){shot=demoPhoto(i)}else{const v=$('#camera-video');if(!v.videoWidth||state.stream?.getVideoTracks()[0]?.readyState!=='live')throw new Error('Kamera terhenti.');shot=document.createElement('canvas');shot.width=v.videoWidth;shot.height=v.videoHeight;const ctx=shot.getContext('2d');if(settings.mirror&&state.facing==='user'){ctx.translate(shot.width,0);ctx.scale(-1,1)}ctx.drawImage(v,0,0);}state.photos.push(shot);updateThumbs();const flash=document.createElement('div');flash.className='countdown flash';$('#camera-stage').append(flash);setTimeout(()=>flash.remove(),400);await delay(800);if(token!==run)return;}$('#camera-status').innerHTML='<strong>Semua pose sudah diambil.</strong>Lihat hasil untuk memilih filter dan menyimpan foto.';}catch(e){toast('Foto terhenti. Coba lagi atau gunakan foto dari perangkat.');}finally{if(token===run){state.busy=false;$('#countdown').style.display='none';updateCameraControls();$('#brand-home').disabled=false;}}}
function updateThumbs(){document.querySelectorAll('.shot-thumb').forEach((el,i)=>{if(state.photos[i])el.innerHTML=`<span>${i+1}</span><img src="${state.photos[i].toDataURL('image/jpeg',.75)}" alt="Pose ${i+1}">`;});}
async function uploadPhotos(e){const files=[...e.target.files],count=poseCount(state.layout);e.target.value='';if(files.length!==count){toast(`Pilih tepat ${count} foto untuk layout ini.`);return;}state.busy=true;updateCameraControls();const token=run;try{const photos=[];for(const file of files){if(file.size>25000000)throw new Error('large');const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const x=new Image();x.onload=()=>resolve(x);x.onerror=reject;x.src=url});if(token!==run)return;const scale=Math.min(1,2200/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);photos.push(c);}finally{URL.revokeObjectURL(url)}}state.photos=photos;updateThumbs();$('#camera-status').innerHTML='<strong>Foto berhasil dipilih.</strong>Klik Lihat hasil untuk melanjutkan.';}catch{toast('Foto tidak bisa dibuka. Gunakan JPG/PNG dengan ukuran maksimal 25 MB per foto.')}finally{if(token===run){state.busy=false;updateCameraControls();$('#brand-home').disabled=false;}}}
const defaultEdit = {zoom:1,x:0,y:0};

function resultScreen() {
  const photoThumb = state.photos[0].toDataURL('image/jpeg',.55);
  const edit = state.edits[state.editPose] || defaultEdit;
  app.innerHTML = top('Edit hasil fotomu.','Pilih tampilan, lalu cetak atau unduh hasilnya.',2)+`
    <div class="result-grid">
      <div class="preview-board result-board">
        <img class="sheet-preview" id="result-preview" alt="Pratinjau lembar cetak" hidden>
        <p class="board-caption" id="result-status" role="status"></p>
      </div>
      <div class="result-controls">
        <nav class="editor-nav" aria-label="Alat edit">
          ${[['frame','Frame'],['filter','Filter'],['crop','Crop']].map(([id,label])=>`<button class="pill" data-editor="${id}" aria-pressed="${state.editorTab===id}">${label}</button>`).join('')}
        </nav>
        <section class="control-section" data-editor-panel="frame" ${state.editorTab==='frame'?'':'hidden'}>
          ${frameOptions()}
          <div class="filter-options print-formats" aria-label="Jumlah salinan per lembar">
            ${[['1','1 frame besar'],['2','2 salinan kecil']].map(([id,name])=>`<button class="pill ${state.copies===Number(id)?'selected':''}" data-copies="${id}" aria-pressed="${state.copies===Number(id)}">${name}</button>`).join('')}
          </div>
        </section>
        <section class="control-section" data-editor-panel="filter" ${state.editorTab==='filter'?'':'hidden'}>
          <div class="filter-previews">
            ${Object.entries(FILTERS).map(([id,{label,css}])=>`<button class="filter-preview ${state.filter===id?'selected':''}" data-filter="${id}" aria-pressed="${state.filter===id}"><img src="${photoThumb}" style="filter:${css}" alt=""><span>${label}</span></button>`).join('')}
          </div>
        </section>
        <section class="control-section crop-settings" data-editor-panel="crop" ${state.editorTab==='crop'?'':'hidden'}>
          <div class="filter-options" aria-label="Pose yang diedit">
            ${state.photos.map((_,i)=>`<button class="pill" data-pose="${i}" aria-pressed="${i===state.editPose}">Pose ${i+1}</button>`).join('')}
          </div>
          <label>Perbesar <input type="range" min="1" max="1.75" step=".025" value="${edit.zoom}" data-crop="zoom"></label>
          <label>Geser kanan-kiri <input type="range" min="-1" max="1" step=".05" value="${edit.x}" data-crop="x"></label>
          <label>Geser atas-bawah <input type="range" min="-1" max="1" step=".05" value="${edit.y}" data-crop="y"></label>
          <button class="quiet" id="reset-crop">Reset crop</button>
        </section>
        <div class="result-actions">
          <button class="primary" id="print-button">Cetak foto</button>
          <button class="secondary" id="download-button">Unduh JPG</button>
          ${state.sessionId && shopConfig?.photoShare?'<button class="secondary" id="share-button">Unduh lewat QR</button>':''}
        </div>
        <div class="footer-actions">
          <button class="retake" id="retake-button">Ulangi semua pose</button>
          <button class="quiet" id="finish-button">Selesaikan sesi</button>
        </div>
      </div>
    </div>`;

  updateResult();
  attachFrames(updateResult);
  const editorButtons = [...document.querySelectorAll('[data-editor]')];
  editorButtons.forEach(button=>button.addEventListener('click',()=>{
    state.editorTab = button.dataset.editor;
    editorButtons.forEach(tab=>tab.setAttribute('aria-pressed',tab===button));
    document.querySelectorAll('[data-editor-panel]').forEach(panel=>panel.hidden=panel.dataset.editorPanel!==state.editorTab);
  }));
  const sliders = [...document.querySelectorAll('[data-crop]')];
  const poses = [...document.querySelectorAll('[data-pose]')];
  function syncCrop() {
    const pose = state.edits[state.editPose] || defaultEdit;
    sliders.forEach(slider=>slider.value=pose[slider.dataset.crop]);
    poses.forEach(button=>button.setAttribute('aria-pressed',Number(button.dataset.pose)===state.editPose));
  }
  poses.forEach(button=>button.addEventListener('click',()=>{
    state.editPose = Number(button.dataset.pose);
    syncCrop();
  }));
  sliders.forEach(slider=>slider.addEventListener('change',()=>{
    state.edits[state.editPose] = {...defaultEdit,...state.edits[state.editPose],[slider.dataset.crop]:Number(slider.value)};
    updateResult();
  }));
  bind('reset-crop',()=>{
    state.edits[state.editPose] = null;
    syncCrop();
    updateResult();
  });
  for (const key of ['copies','filter']) {
    const options = document.querySelectorAll('[data-'+key+']');
    options.forEach(button=>button.addEventListener('click',()=>{
      state[key] = key === 'copies' ? Number(button.dataset[key]) : button.dataset[key];
      options.forEach(option=>{
        option.classList.toggle('selected',option === button);
        option.setAttribute('aria-pressed',option === button);
      });
      updateResult();
    }));
  }

  bind('print-button',()=>{if(state.result)window.print()});
  bind('download-button',downloadResult);
  bind('share-button',shareResult);
  bind('retake-button',()=>{
    openModal(`<div class="modal-head"><h2>Ambil ulang semua pose?</h2>${closeButton()}</div>
      <p>Foto sesi ini akan diganti. Unduh dulu kalau ingin menyimpan hasil saat ini.</p>
      <div class="modal-actions"><button class="secondary" id="keep-photos">Simpan yang ini</button><button class="primary" id="confirm-retake">Ulangi pose</button></div>
    `);
    bind('keep-photos',()=>modal.close());
    bind('confirm-retake',()=>{modal.close();startCapture()});
  });
  bind('finish-button',finishConfirm);
}

let renderToken = 0;
async function updateResult() {
  const token = ++renderToken;
  const frame = FRAMES.find(item=>item.id===state.frame) || FRAMES[0];
  const options = {copies:state.copies,filter:state.filter,demo:state.demo,edits:[...state.edits]};
  const preview = $('#result-preview');
  const status = $('#result-status');
  const resultButtons = document.querySelectorAll('.result-actions button');
  resultButtons.forEach(button=>button.disabled=true);
  state.result = null;
  state.file = null;
  status.textContent = 'Menyiapkan frame…';
  const isCurrent = ()=>token===renderToken && state.screen==='result' && preview.isConnected;
  try {
    const [artwork,paperTexture] = await Promise.all([
      loadFrame(frame),
      loadPaperTexture().catch(()=>null)
    ]);
    if (!isCurrent()) return;
    const canvas = composeSheet(frame,artwork,state.photos,{...options,paperTexture});
    const result = canvas.toDataURL('image/jpeg',.95);
    preview.src = result;
    await preview.decode();
    if (!isCurrent()) return;
    const print = $('#print-image');
    print.src = result;
    await print.decode();
    if (!isCurrent()) return;
    state.result = result;
    preview.hidden = false;
    status.textContent = options.copies===2 ? '2 salinan kecil dalam 1 lembar' : '1 frame besar dalam 1 lembar';
    canvas.toBlob(blob=>{
      if (!isCurrent()) return;
      if (blob) state.file = new File([blob],filename(),{type:'image/jpeg'});
      resultButtons.forEach(button=>button.disabled=button.id==='share-button' && !blob);
    },'image/jpeg',.95);
  } catch (error) {
    if (isCurrent()) {
      preview.hidden = true;
      status.textContent = 'Frame gagal dimuat. Pilih ulang frame untuk mencoba lagi.';
    }
  }
}

function filename() {
  const date = new Date().toISOString().replace(/[:.]/g,'-');
  return `simpang-samping-obor-${state.frame}-${date}${state.demo?'-demo':''}.jpg`;
}
function downloadResult(){if(!state.result)return;const a=document.createElement('a'),url=state.file?URL.createObjectURL(state.file):state.result;a.href=url;a.download=filename();document.body.append(a);a.click();a.remove();if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Jika foto terbuka di tab baru, gunakan Bagikan → Simpan Gambar.');}
async function shareResult() {
  if (!state.file || !state.sessionId) return;
  const button = $('#share-button');
  openModal(`<div class="modal-head"><h2>Unduh foto ke HP</h2>${closeButton()}</div>
    <p>Foto hasil edit akan disimpan sementara. Tautan berlaku hingga 24 jam sejak pembayaran. Siapa pun yang memegang tautan dapat mengunduhnya.</p>
    <button class="primary" id="create-photo-qr">Buat QR unduhan</button>
    <div id="photo-qr" class="photo-qr" role="status"></div>`);
  bind('create-photo-qr',async()=>{
    const draft = state.file;
    const sessionId = state.sessionId;
    const action = $('#create-photo-qr');
    const output = $('#photo-qr');
    if (!draft || !sessionId) return;
    action.disabled = true;
    output.textContent = 'Menyiapkan QR…';
    try {
      const {default:generateQR} = await import('./qrcode.mjs');
      const response = await fetch('/api/photo/share',{
        method:'POST',headers:{'Content-Type':'image/jpeg','X-Photo-Session':sessionId},body:draft
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!modal.open || !output.isConnected || button !== $('#share-button')) return;
      const url = new URL(payload.path,location.origin);
      const qr = generateQR(0,'M');
      qr.addData(url.href);
      qr.make();
      const img = document.createElement('img');
      img.src = qr.createDataURL(6,24);
      img.alt = 'Pindai untuk mengunduh hasil foto';
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = 'Buka tautan JPG';
      output.replaceChildren(img,link);
      action.hidden = true;
    } catch (error) {
      output.textContent = error.message || 'QR gagal dibuat. Coba lagi atau pilih Unduh JPG.';
      action.disabled = false;
    }
  });
}

function finishConfirm() {
  openModal(`<div class="modal-head"><h2>Sudah simpan fotonya?</h2>${closeButton()}</div><p>Unduh atau cetak dulu sebelum kembali ke layar awal.</p><div class="modal-actions"><button class="secondary" id="stay-result">Kembali ke hasil</button><button class="primary" id="confirm-finish">Ya, selesai</button></div>`);
  bind('stay-result',()=>modal.close());
  bind('confirm-finish',async event=>{
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (state.sessionId) await checkout.complete();
      modal.close();
      state.screen = 'finish';
      render();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
}
function finishScreen(){app.innerHTML=`<section class="finish"><div class="finish-icon" aria-hidden="true">✳</div><div class="eyebrow" style="justify-content:center">SAMPAI MAMPIR LAGI</div><h1>Momenmu, sudah dibungkus.</h1><p>Terima kasih sudah berbagi tawa di ${esc(settings.brand)}.<br>Yang kecil begini, kadang paling lama diingat.</p><img class="mini-result" src="${state.result||''}" alt="Hasil sesi photobox"><div class="button-row"><button class="primary" id="next-session">Kembali ke awal</button><button class="secondary" id="back-result">Lihat hasil lagi</button></div></section>`;bind('next-session',()=>resetHome());bind('back-result',()=>{state.screen='result';render()})}
function exitSession() {
  if (state.screen === 'home') return;
  if (state.screen === 'payment' && checkout.hasActive()) {
    toast('Selesaikan atau batalkan QRIS di layar pembayaran.');
    return;
  }
  if (state.screen === 'payment') return resetHome();
  if (state.screen === 'finish') return resetHome();
  openModal(`<div class="modal-head"><h2>${state.demo?'Kembali ke awal?':'Jeda sesi foto?'}</h2>${closeButton()}</div><p>${state.demo?'Foto demo akan dihapus.':'Foto sementara akan dihapus. Sesi yang sudah dibayar bisa dilanjutkan dari layar awal tanpa membayar lagi.'}</p><div class="modal-actions"><button class="secondary" id="stay-session">Lanjut sesi</button><button class="primary" id="exit-confirm">Kembali ke awal</button></div>`);
  bind('stay-session',()=>modal.close());
  bind('exit-confirm',()=>{modal.close();resetHome()});
}
function resetHome(){checkout.hide();stopCamera();state.photos=[];state.result=null;state.file=null;state.sessionId=null;state.demo=false;state.screen='home';$('#brand-home').disabled=false;render();window.scrollTo(0,0)}
function help() {
  const paymentHint = shopConfig?.mode === 'production'
    ? 'Pindai QRIS dengan aplikasi pembayaran di HP dan tunggu konfirmasi.'
    : 'Untuk mode uji, pindai QRIS menggunakan simulator resmi Midtrans Sandbox.';
  openModal(`<div class="modal-head"><h2>Cara pakai Photobox</h2>${closeButton()}</div>
    <ol class="help-list"><li>Tekan Press to Start. Kalau punya kode promo dari kasir, masukkan sebelum membuka QRIS.</li><li>${paymentHint}</li><li>Aktifkan kamera dan tekan Mulai Foto untuk hitung mundur. Ada 3 pose.</li><li>Ambil ulang jika perlu, pilih frame, lalu cetak atau unduh JPG.</li></ol>
    <p>Hasil foto dibuat di perangkat ini. Simpan sebelum sesi ditutup.</p>
    <button class="primary" id="help-done">Siap</button>`);
  bind('help-done',()=>modal.close());
}
function demoPhoto(index){const c=document.createElement('canvas');c.width=1000;c.height=750;const x=c.getContext('2d'),bg=['#b9c8b1','#c0ad93','#a5b8ae','#d7b7a7'][index%4];x.fillStyle=bg;x.fillRect(0,0,1000,750);x.fillStyle='#e4dbc3';x.beginPath();x.roundRect(650,65,240,470,[130,130,0,0]);x.fill();x.strokeStyle='#a9997a';x.lineWidth=5;x.beginPath();x.moveTo(770,65);x.lineTo(770,535);x.moveTo(650,280);x.lineTo(890,280);x.stroke();x.fillStyle='#566c53';for(let i=0;i<5;i++){x.beginPath();x.ellipse(110+i*16,460-i*55,32,70,i*.4,0,Math.PI*2);x.fill()}x.fillStyle='#a96e4e';x.fillRect(80,495,140,170);person(x,390,490,'#b74e38','#322d27',index,false);person(x,660,510,'#e5d9b7','#352b26',index,true);x.fillStyle='#ffffffc9';x.font='19px Arial';x.textAlign='left';x.fillText('ILLUSTRATED DEMO',28,40);x.fillStyle='#f5e8ca';for(let i=0;i<3;i++){const sx=100+i*360,sy=90+(i%2)*70;x.font='55px Georgia';x.fillText('✳',sx,sy)}return c;}
function person(x,cx,cy,shirt,hair,pose,second){x.save();x.translate(cx,cy);x.rotate((pose%3-1)*(second?-.06:.06));x.fillStyle=shirt;x.beginPath();x.ellipse(0,270,180,225,0,0,Math.PI*2);x.fill();x.fillStyle='#c18b68';x.fillRect(-30,50,60,95);x.fillStyle=hair;x.beginPath();x.ellipse(0,-47,107,144,0,0,Math.PI*2);x.fill();x.fillStyle=second?'#dba47e':'#d4a17f';x.beginPath();x.ellipse(0,-13,86,112,0,0,Math.PI*2);x.fill();x.fillStyle=hair;x.beginPath();x.ellipse(-10,-101,95,48,-.16,0,Math.PI*2);x.fill();if(second){x.fillRect(67,-84,32,205);x.fillRect(-102,-80,30,190)}x.strokeStyle='#352b26';x.lineWidth=6;x.lineCap='round';for(const ex of [-32,32]){x.beginPath();x.arc(ex,-20,11,Math.PI,Math.PI*2);x.stroke()}x.beginPath();x.arc(0,24,25,0,Math.PI);x.stroke();x.fillStyle='#c77868';x.globalAlpha=.5;x.beginPath();x.ellipse(-53,17,17,10,0,0,Math.PI*2);x.ellipse(53,17,17,10,0,0,Math.PI*2);x.fill();x.globalAlpha=1;if(pose%3===1){x.strokeStyle=second?'#dba47e':'#d4a17f';x.lineWidth=25;const side=second?1:-1;x.beginPath();x.moveTo(side*115,170);x.lineTo(side*145,25);x.stroke();x.lineWidth=13;x.beginPath();x.moveTo(side*145,25);x.lineTo(side*130,-20);x.moveTo(side*145,25);x.lineTo(side*163,-15);x.stroke()}x.restore();}
bind('help-button',help);bind('brand-home',()=>state.screen==='home'?null:exitSession());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.screen==='capture'&&state.busy){stopCamera();const clock=$('#countdown');if(clock)clock.style.display='none';$('#brand-home').disabled=false;if(state.demo){state.ready=true;updateCameraControls()}else{const idle=$('#camera-idle');if(idle){idle.hidden=false;$('#enable-camera').disabled=false;$('#enable-camera').textContent='Aktifkan kamera lagi';$('#camera-message').textContent='Sesi foto dijeda saat aplikasi berpindah ke latar belakang. Aktifkan kamera untuk melanjutkan.'}updateCameraControls()}toast('Sesi dijeda. Foto yang sudah diambil tetap tersedia.')}});
window.addEventListener('pagehide',stopCamera);
render();
loadShop().then(()=>{if(state.screen==='home')render()}).catch(()=>{});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
