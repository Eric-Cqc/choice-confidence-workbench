'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core.js');
const parse=p=>C.parse({probabilities:p});
test('0.60 with 3 choices yields 0.40; distribution tail does not affect it',()=>{
 assert.ok(Math.abs(parse({A:.6,B:.3,C:.1}).rows[0].confidence-.4)<1e-12);
 assert.equal(parse({A:.6,B:.3,C:.1}).rows[0].confidence,parse({A:.6,B:.2,C:.2}).rows[0].confidence);
});
test('uniform and certain extremes',()=>{assert.ok(parse({A:1/3,B:1/3,C:1/3}).rows[0].confidence<1e-12);assert.equal(parse({A:1,B:0}).rows[0].confidence,1)});
test('ties always review even at threshold zero',()=>{assert.equal(C.analyse(parse({A:.5,B:.5}).rows,0).passed,0)});
test('missing labels never count as correct or wrong',()=>{const r=C.analyse(parse({A:.9,B:.1}).rows,.8);assert.equal(r.accuracy,null);assert.equal(r.passed_unlabelled,1);assert.equal(r.passed_labelled,0)});
test('threshold includes exact boundary and 1 works',()=>{const d=parse({A:1,B:0});assert.equal(C.analyse(d.rows,1).passed,1);assert.equal(C.analyse(parse({A:.9,B:.1}).rows,.8).passed,1)});
test('reject bad probabilities, bad totals, one option, boolean',()=>{
 for(const p of [{A:1},{A:-.1,B:1.1},{A:.6,B:.5},{A:true,B:0},{A:NaN,B:1},{A:Infinity,B:0},{A:'0.5',B:.5}])assert.throws(()=>parse(p));
});
test('reject invalid choice, label, split, confidence',()=>{
 for(const extra of [{choice:'B'},{label:'C'},{split:'test'},{confidence:2},{confidence:true},{type:'score'}])assert.throws(()=>C.parse({probabilities:{A:.9,B:.1},...extra}));
});
test('reported confidence never overrides calculation',()=>{const d=C.parse({probabilities:{A:.6,B:.3,C:.1},confidence:.99});assert.equal(d.rows[0].mismatch,true);assert.equal(C.analyse(d.rows,.8).passed,0)});
test('API response skips non-choice but says so',()=>{const d=C.parse({answers:{q:{type:'choice',choice:'A',probabilities:{A:.8,B:.2}},n:{type:'noul',noul:.9}}});assert.equal(d.rows.length,1);assert.equal(d.warnings.length,1);assert.throws(()=>C.parse({answers:{n:{type:'noul',noul:.9}}}))});
test('different questions or option sets cannot aggregate',()=>{const d=C.parse([{id:'1',question_id:'q',probabilities:{A:.9,B:.1}},{id:'2',question_id:'q',probabilities:{A:.9,C:.1}}]);assert.throws(()=>C.analyse(d.rows,.8))});
test('duplicate IDs rejected',()=>{assert.throws(()=>C.parse([{id:'x',probabilities:{A:1,B:0}},{id:'x',probabilities:{A:1,B:0}}]))});
test('roundtrip preserves mismatch, label and split',()=>{const d=C.parse({title:'test',rows:[{id:'x',probabilities:{A:.8,B:.2},confidence:.1,label:'B',split:'holdout'}]});const d2=C.parse(C.project(d,.7,'top',d.rows[0].group));assert.deepEqual(d2.rows,d.rows)});
test('bins include p=1 and empty bins are unknown',()=>{const d=C.parse({probabilities:{A:1,B:0},label:'A'});const a=C.analyse(d.rows,.8);assert.equal(a.bins[4].count,1);assert.equal(a.bins[0].accuracy,null)});
test('explicit denominators do not include unknown labels',()=>{const d=C.parse([{probabilities:{A:.9,B:.1},label:'A'},{probabilities:{A:.9,B:.1},label:'B'},{probabilities:{A:.9,B:.1}}]);const a=C.analyse(d.rows,.8);assert.equal(a.passed,3);assert.equal(a.errors,1);assert.equal(a.accuracy,.5);assert.equal(a.passed_unlabelled,1)});
test('empty exploration set uses unknown coverage',()=>{const a=C.analyse([],.8);assert.equal(a.coverage,null);assert.equal(a.accuracy,null)});
test('invalid thresholds and metrics rejected',()=>{for(const t of [-1,2,NaN])assert.throws(()=>C.analyse([],t));assert.throws(()=>C.analyse([],0,'other'))});

function adjacent(value, direction) {
 const bytes=new DataView(new ArrayBuffer(8)); bytes.setFloat64(0,value);
 bytes.setBigUint64(0,bytes.getBigUint64(0)+BigInt(direction));return bytes.getFloat64(0);
}
function rowWith(n, top) { return parse(Object.fromEntries(Array.from({length:n},(_,i)=>['P'+i,i===0?top:(1-top)/(n-1)]))).rows; }
for(const [n,p,t] of [[2,.7,.4],[3,.6,.4],[3,.9,.85],[3,.88,.82],[4,.7,.6],[10,.55,.5],[255,.492,.49]]) {
 test(`exact confidence boundary and nearest representable neighbours: n=${n}, p=${p}, t=${t}`,()=>{
  for(const [value,expected] of [[adjacent(p,-1),0],[p,1],[adjacent(p,1),1]]) {
   assert.equal(C.analyse(rowWith(n,value),t).passed,expected,`p=${value}`);
  }
  assert.equal(C.analyse(rowWith(n,p),adjacent(t,-1)).passed,1);
  assert.equal(C.analyse(rowWith(n,p),adjacent(t,1)).passed,0);
 });
}
test('sub-picounit differences are not silently treated as ties',()=>{
 const rows=parse({A:.5000000000000001,B:.4999999999999999}).rows;
 assert.equal(rows[0].tied,false);
 assert.equal(C.analyse(rows,2e-16).passed,1);
 assert.equal(C.analyse(rows,adjacent(2e-16,1)).passed,0);
 assert.throws(()=>C.parse({probabilities:{A:.5000000000000001,B:.4999999999999999},choice:'B'}));
});
test('top metric retains strict boundary without any tolerance',()=>{
 const rows=rowWith(3,.6);
 assert.equal(C.analyse(rows,.6,'top').passed,1);
 assert.equal(C.analyse(rows,adjacent(.6,1),'top').passed,0);
});
test('confidence 1 never accepts the preceding representable probability',()=>{
 assert.equal(C.analyse(rowWith(3,adjacent(1,-1)),1).passed,0);
 assert.equal(C.analyse(rowWith(3,1),1).passed,1);
});
