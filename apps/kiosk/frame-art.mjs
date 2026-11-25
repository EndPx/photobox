import {cropRect} from './model.mjs';

export const FILTERS = {
  original: {label:'Original',css:'none',r:[1,0,0,0],g:[0,1,0,0],b:[0,0,1,0]},
  warm: {label:'Hangat',css:'sepia(.2) saturate(1.2)',r:[1.05,0,0,9],g:[0,1.01,0,2],b:[0,0,.91,0]},
  mono: {label:'Hitam putih',css:'grayscale(1) contrast(1.07)',r:[.227,.765,.077,-9],g:[.227,.765,.077,-9],b:[.227,.765,.077,-9]},
  vintage: {label:'Vintage',css:'sepia(.6) contrast(.9)',r:[.83,.18,0,14],g:[.08,.85,0,8],b:[.12,0,.73,10]},
  cream: {label:'Krim',css:'sepia(.2) brightness(1.12) contrast(.9)',r:[.92,.08,0,14],g:[0,.92,0,13],b:[.08,0,.88,12]},
  cool: {label:'Biru lembut',css:'hue-rotate(15deg) saturate(.85)',r:[.89,0,0,4],g:[0,.99,0,5],b:[0,0,1.06,12]},
  noir: {label:'Noir',css:'grayscale(1) contrast(1.36)',r:[.289,.973,.098,-46],g:[.289,.973,.098,-46],b:[.289,.973,.098,-46]},
  punch: {label:'Warna pekat',css:'saturate(1.4) contrast(1.1)',r:[1.19,-.10,-.01,-10],g:[-.03,1.13,-.01,-10],b:[-.03,-.09,1.22,-10]},
};

export function adjustedCrop(photo, width, height, edit) {
  const base = cropRect(photo.width,photo.height,width,height);
  if (!edit) return base;
  const w = base.w / edit.zoom;
  const h = base.h / edit.zoom;
  return {w,h,x:(photo.width-w)*(edit.x+1)/2,y:(photo.height-h)*(edit.y+1)/2};
}

export const PAPER = {width:1181,height:1748};

export const FRAMES = [
  {
    id:'special-day',name:'Special Day',height:1671,
    windows:[[114,359,642,654],[114,679,642,974],[114,998,642,1324]]
  },
  {
    id:'momen-kita',name:'Momen Kita',height:1672,
    windows:[[127,269,754,606],[127,664,754,1000],[127,1058,754,1394]],
    paths:[
      [[179,269],[754,269],[754,606],[127,606],[127,286]],
      [[127,664],[754,664],[754,1000],[145,1000],[160,974],[163,966],[160,960],[153,957],[127,963]],
      [[127,1058],[754,1058],[754,1378],[746,1363],[648,1394],[127,1394]]
    ]
  },
  {
    id:'obor-after-dark',name:'Obor After Dark',height:1671,
    windows:[[195,261,744,614],[195,647,744,1000],[195,1033,744,1386]]
  }
].map(frame=>({...frame,width:941,src:'/art/'+frame.id+'.webp'}));

export function placements(frame, copies) {
  const pageMargin = 18;
  const gap = 24;
  const availableWidth = (PAPER.width - 2*pageMargin - (copies-1)*gap)/copies;
  const scale = Math.min(availableWidth/frame.width,(PAPER.height - 2*pageMargin)/frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const left = (PAPER.width - copies*width - (copies-1)*gap)/2;
  return Array.from({length:copies},(_,i)=>({
    x:left+i*(width+gap), y:(PAPER.height-height)/2, width,height,scale
  }));
}

const images = new Map();

function loadArtwork(src) {
  if (!images.has(src)) {
    const pending = new Promise((resolve,reject)=>{
      const image = new Image();
      image.onload = ()=>resolve(image);
      image.onerror = ()=>reject(new Error('Gambar desain belum bisa dibuka.'));
      image.src = src;
    });
    images.set(src,pending);
    pending.catch(()=>images.delete(src));
  }
  return images.get(src);
}

export function loadFrame(frame) {
  return loadArtwork(frame.src);
}

export function loadPaperTexture() {
  return loadArtwork('/art/payment.webp');
}

export function composeSheet(frame, artwork, photos, {copies, filter, demo, paperTexture, edits}) {
  const art = document.createElement('canvas');
  art.width = frame.width;
  art.height = frame.height;
  const front = art.getContext('2d');
  front.drawImage(artwork,0,0);
  frame.windows.forEach(([left,top,right,bottom],i)=>{
    const photo = photos[i];
    if (!photo) return;
    const w = right-left, h = bottom-top;
    const crop = adjustedCrop(photo,w,h,edits?.[i]);
    front.save();
    front.beginPath();
    if (frame.paths) {
      frame.paths[i].forEach(([x,y],point)=>point ? front.lineTo(x,y) : front.moveTo(x,y));
      front.closePath();
    } else {
      front.rect(left,top,w,h);
    }
    front.clip();
    drawPhoto(front,photo,crop,left,top,w,h,filter);
    front.restore();
  });

  const sheet = document.createElement('canvas');
  sheet.width = PAPER.width;
  sheet.height = PAPER.height;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#591015';
  ctx.fillRect(0,0,sheet.width,sheet.height);
  if (paperTexture) {
    // The left part of this artwork is torn paper, without the tower illustration.
    const paperWidth = paperTexture.width * .64;
    const crop = cropRect(paperWidth,paperTexture.height,sheet.width,sheet.height);
    ctx.drawImage(paperTexture,crop.x,crop.y,crop.w,crop.h,0,0,sheet.width,sheet.height);
    ctx.fillStyle = '#2b070c2e';
    ctx.fillRect(0,0,sheet.width,sheet.height);
  }
  const plan = placements(frame,copies);
  for (const area of plan) ctx.drawImage(art,area.x,area.y,area.width,area.height);
  if (copies === 2) {
    ctx.strokeStyle = '#f0d0af';
    ctx.setLineDash([7,7]);
    ctx.beginPath();
    ctx.moveTo(sheet.width/2,plan[0].y-12);
    ctx.lineTo(sheet.width/2,plan[0].y+plan[0].height+12);
    ctx.stroke();
  }
  if (demo) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff0de';
    ctx.font = '10px Arial';
    ctx.fillText('DEMO · FOTO ILUSTRASI',sheet.width/2,sheet.height-5);
  }
  return sheet;
}

function drawPhoto(ctx,photo,crop,x,y,width,height,filter) {
  if (filter === 'original') {
    ctx.drawImage(photo,crop.x,crop.y,crop.w,crop.h,x,y,width,height);
    return;
  }
  const buffer = document.createElement('canvas');
  buffer.width = width;
  buffer.height = height;
  const area = buffer.getContext('2d',{willReadFrequently:true});
  area.drawImage(photo,crop.x,crop.y,crop.w,crop.h,0,0,width,height);
  const pixels = area.getImageData(0,0,width,height);
  const data = pixels.data;
  const {r:red,g:green,b:blue} = FILTERS[filter] || FILTERS.original;
  const channel = ([a,b,c,d],r,g,bValue) => a*r + b*g + c*bValue + d;
  for (let i=0; i<data.length; i+=4) {
    const r=data[i],g=data[i+1],b=data[i+2];
    data[i]=channel(red,r,g,b);
    data[i+1]=channel(green,r,g,b);
    data[i+2]=channel(blue,r,g,b);
  }
  area.putImageData(pixels,0,0);
  ctx.drawImage(buffer,x,y);
}
