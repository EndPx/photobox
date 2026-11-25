import test from 'node:test';
import assert from 'node:assert/strict';
import {slots,cropRect,cleanSettings,poseCount,csvCell,revenue} from '../packages/browser/model.mjs';

test('both print layouts fit a 300 dpi postcard without overlapping photos',()=>{
  for(const layout of ['strip','grid']){
    const p=slots(layout);
    assert.equal(p.width,1181);assert.equal(p.height,1748);
    for(const s of p.slots){assert(s.x>=0&&s.y>=0&&s.x+s.w<=p.width&&s.y+s.h<=p.height);}
    for(let i=0;i<p.slots.length;i++)for(let j=i+1;j<p.slots.length;j++){
      const a=p.slots[i],b=p.slots[j];
      assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
    }
    assert.equal(new Set(p.slots.map(s=>s.pose)).size,poseCount(layout));
  }
  assert.deepEqual(slots('strip').slots.map(s=>s.pose),[0,1,2,0,1,2]);
});
test('center crop preserves target aspect ratio and stays inside source',()=>{
  for(const source of [[1920,1440],[1440,1920],[500,500]])for(const s of slots('grid').slots.concat(slots('strip').slots)){
    const r=cropRect(...source,s.w,s.h);assert(Math.abs(r.w/r.h-s.w/s.h)<1e-10);
    assert(r.x>=0&&r.y>=0);assert(r.x+r.w<=source[0]+1e-8&&r.y+r.h<=source[1]+1e-8);
  }
});
test('cashier settings reject invalid prices and countdowns',()=>{
  assert.equal(cleanSettings({price:-1,countdown:0}).price,35000);
  assert.equal(cleanSettings({price:25000,countdown:5}).countdown,5);
  assert.equal(cleanSettings({price:'no',countdown:100}).countdown,3);
  assert.equal(cleanSettings({brand:' a '.repeat(30)}).brand.length,30);
  assert.equal(cleanSettings({price:0}).price,0);
});
test('revenue includes confirmed payments even if photos are incomplete, for the selected day only',()=>{
  const records=[{date:'2026-11-24T10:00',price:35000,paid:true,status:'Foto belum selesai'},
    {date:'2026-11-24T11:00',price:25000,paid:true,status:'Selesai'},
    {date:'2026-11-24T11:30',price:35000,paid:false},
    {date:'2026-11-23T10:00',price:35000,paid:true}];
  assert.equal(revenue(records,'2026-11-24'),60000);assert.equal(revenue([],'2026-11-24'),0);
});
test('CSV cells preserve quotes and prevent formula interpretation',()=>{
  assert.equal(csvCell('a,"b"'),'"a,""b"""');assert.equal(csvCell('=1+1'),'"\'=1+1"');
  assert.equal(csvCell(35000),'"35000"');
});
