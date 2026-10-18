'use strict';
const C = ChoiceCore, $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pct = n => n === null ? '未知' : (n * 100).toFixed(1) + '%';
const dec = n => n.toFixed(4);
const sample = {title:'客服意图分流 · 手工构造的概率与标签',provenance:'synthetic',rows:[
  ['E01',[.94,.04,.02],'查件','直接查询物流轨迹'],
  ['E02',[.03,.92,.05],'催件','询问超时包裹'],
  ['E03',[.04,.06,.90],'查件','高把握也能选错：特意保留的反例'],
  ['E04',[.88,.08,.04],'查件','信息明确'],
  ['E05',[.10,.80,.10],'催件','门槛边界附近'],
  ['E06',[.12,.16,.72],'其他','需要澄清'],
  ['E07',[.60,.30,.10],'查件','0.60 概率只对应 0.40 confidence'],
  ['E08',[.25,.55,.20],'其他','类别重叠'],
  ['E09',[.50,.50,0],'催件','最高值并列，始终复核'],
  ['E10',[.34,.33,.33],null,'没有人工标签，正确性未知'],
  ['H01',[.96,.03,.01],'查件','留出构造记录'],
  ['H02',[.02,.91,.07],'其他','留出构造反例'],
  ['H03',[.25,.25,.50],'其他','留出构造记录'],
  ['H04',[.05,.05,.90],null,'留出集也可能缺标签']
].map(([id,p,label,note])=>({id,question_id:'客服意图',probabilities:{'查件':p[0],'催件':p[1],'其他':p[2]},label,note,split:id.startsWith('H')?'holdout':'explore'}))};
let data = null, threshold = .8, metric = 'confidence', group = '', last = null, holdout = null, holdoutChecks = 0;
function status(msg, error = false) { $('status').textContent = msg; $('status').className = 'status ' + (error ? 'error' : 'ok'); }
function formula() {
  try {
    const values = ['prob-a','prob-b','prob-c'].map(id=>{if($(id).value.trim()==='')throw Error('请填写三个概率');return Number($(id).value)});
    const row = C.validateRow({probabilities:Object.fromEntries(['A','B','C'].map((k,i)=>[k,values[i]]))},0);
    $('formula-result').innerHTML = '<h3>最高概率 '+pct(row.top)+' → confidence '+dec(row.confidence)+'</h3><div class="formula">('+dec(row.top)+' − 1/3) ÷ (1 − 1/3)<br>= '+dec(row.confidence)+'</div><p class="muted">confidence '+dec(row.confidence)+' 不是 '+pct(row.confidence)+' 的实际正确率。</p>';
  } catch(e) { $('formula-result').textContent = e.message; }
}
function load(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const next = C.parse(parsed);
    const groups = [...new Set(next.rows.map(r=>r.group))];
    let settings = parsed.settings;
    if (settings && (!Number.isFinite(settings.threshold)||settings.threshold<0||settings.threshold>1||!['confidence','top'].includes(settings.metric))) throw Error('项目设置无效，未替换当前数据');
    data=next; group=settings && groups.includes(settings.group) ? settings.group : groups[0];
    threshold=settings?.threshold ?? .8; metric=settings?.metric ?? 'confidence';
    $('group').replaceChildren(...groups.map(g=>{const row=data.rows.find(r=>r.group===g),o=document.createElement('option');o.value=g;o.textContent=row.question_id+' · '+row.n+' 个选项 · '+data.rows.filter(r=>r.group===g).length+' 条';return o;}));
    $('group').disabled=false; $('group').value=group;
    $('threshold').value=threshold; $('threshold-number').value=threshold; $('metric').value=metric;
    $('export-project').disabled=false; $('export-report').disabled=false; $('results').hidden=false;
    holdout=null; holdoutChecks=0; render();
    status('已载入 '+data.rows.length+' 条记录。'+data.warnings.join('；'));
  }catch(e){status('导入失败：'+e.message+'。当前已载入数据保留，可修正后重试。',true);}
}
function activeRows(split){return data.rows.filter(r=>r.group===group&&r.split===split)}
function tableRows(rows){return rows.map(r=>'<tr><td>'+esc(r.id)+(r.note?'<br><small>'+esc(r.note)+'</small>':'')+'</td><td>'+esc(r.choice)+' → '+esc(r.label??'未标注')+'</td><td class="num">'+pct(r.top)+'</td><td class="num">'+dec(r.confidence)+(r.supplied_confidence!==null?'<br><small>输入 '+dec(r.supplied_confidence)+'</small>':'')+'</td><td class="'+(r.route==='pass'?'pass':'review')+'">'+(r.route==='pass'?'放行建议':'人工复核')+(r.tied?'<br><small>最高概率并列</small>':'')+'</td><td>'+(r.correct===null?'未知':r.correct?'一致':'<strong class="warn">错分</strong>')+(r.mismatch?'<br><span class="warn">confidence 与公式不符</span>':'')+'</td></tr>').join('')}
function summary(a){return '共 '+a.total+' 条；建议放行 '+a.passed+' 条，复核 '+a.review+' 条。放行中有标签 '+a.passed_labelled+' 条，错分 '+a.errors+' 条；其余 '+a.passed_unlabelled+' 条正确性未知。';}
function render(){
  if(!data){$('equivalent').textContent='confidence = (p(max) − 1/n) ÷ (1 − 1/n)';return}
  holdout=null;$('holdout-result').textContent='留出集尚未检查；导出不会展示其表现。';
  const rows=activeRows('explore'), all=data.rows.filter(r=>r.group===group), n=all[0].n;
  last=C.analyse(rows,threshold,metric);
  $('dataset-title').textContent=data.title+' · 当前探索集 '+rows.length+' 条，留出集 '+activeRows('holdout').length+' 条';
  $('provenance').textContent=data.provenance==='synthetic'?'构造数据 · 非模型实测':'用户导入 · 来源未独立验证';
  $('equivalent').textContent=metric==='confidence'?'n = '+n+'；confidence ≥ '+threshold.toFixed(2)+' ⇔ 最高概率 ≥ '+dec(1/n+threshold*(1-1/n)):'按最高概率 ≥ '+threshold.toFixed(2)+' 分流；最高概率并列时仍转复核';
  $('metrics').innerHTML='<div class="metric"><small>建议放行 / 探索总数</small><strong>'+last.passed+' / '+last.total+'</strong><small>覆盖率 '+pct(last.coverage)+'</small></div><div class="metric"><small>人工复核</small><strong>'+last.review+'</strong><small>含并列最高值</small></div><div class="metric"><small>放行中的已知错分</small><strong>'+last.errors+' / '+last.passed_labelled+'</strong><small>分母仅为有标签记录</small></div>';
  $('meaning').textContent=summary(last)+' 有标签放行记录正确率：'+pct(last.accuracy)+'。'+(data.provenance==='synthetic'?'这些数值只说明工具计算行为，不说明模型能力。':'阈值需要独立样本验证，不能据此认定可以上线。');
  $('rows').innerHTML=tableRows(last.rows.slice(0,300));
  $('row-limit').textContent=last.rows.length>300?'页面显示前 300 条；导出报告包含完整记录。':'';
  $('holdout').disabled=activeRows('holdout').length===0;
  const bins=last.bins;
  $('bin-table').innerHTML='<div class="table-scroll"><table><thead><tr><th>最高概率区间</th><th>有标签记录数</th><th>平均最高概率</th><th>样本正确率</th></tr></thead><tbody>'+bins.map((b,i)=>'<tr><td>['+b.low.toFixed(1)+', '+b.high.toFixed(1)+(i===4?']':')')+'</td><td>'+b.count+'</td><td>'+pct(b.mean_probability)+'</td><td>'+pct(b.accuracy)+'</td></tr>').join('')+'</tbody></table></div>';
  $('calibration').innerHTML='<svg class="mini" viewBox="0 0 500 175" role="img" aria-label="各概率箱平均最高概率与样本正确率"><line x1="30" y1="140" x2="490" y2="140"/><line x1="30" y1="20" x2="490" y2="20"/><text x="0" y="24">100%</text><text x="4" y="143">0%</text>'+bins.map((b,i)=>b.count?'<rect x="'+(60+i*85)+'" y="'+(140-120*b.accuracy)+'" width="30" height="'+120*b.accuracy+'"/><path stroke="#9b3c1d" stroke-width="3" d="M '+(50+i*85)+' '+(140-120*b.mean_probability)+' h 50"/><text x="'+(45+i*85)+'" y="163">'+b.low.toFixed(1)+'–'+b.high.toFixed(1)+'</text>':'<text x="'+(45+i*85)+'" y="120">无标签</text>').join('')+'</svg>';
}
function adjust(value){
  if(value.trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1){status('门槛须为 0–1。结果保留上次有效门槛 '+threshold+'；导出暂停，请先修正。',true);$('export-project').disabled=true;$('export-report').disabled=true;$('holdout').disabled=true;return}
  threshold=Number(value);$('threshold').value=threshold;$('threshold-number').value=threshold;
  $('export-project').disabled=!data;$('export-report').disabled=!data;render();status('当前门槛已更新，留出检查已失效。');
}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('已发起下载：'+name+'。如未出现文件，请检查浏览器下载提示。');}
function exportReport(){
  const heading='<tr><th>记录 / 备注</th><th>选中 → 标签</th><th>最高概率</th><th>复算 confidence</th><th>分流</th><th>核对</th></tr>';
  const report='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>Choice 分析报告</title><style>body{font:16px/1.6 system-ui;margin:36px;max-width:1200px;color:#142b32}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #ccd7d4;text-align:left}.warn{color:#9b3c1d}small{color:#55676b}</style><h1>Choice 分析报告</h1><p>'+esc(data.title)+'</p><p>来源：'+(data.provenance==='synthetic'?'构造数据，非模型实测':'用户导入，来源未独立验证')+'；问题：'+esc(data.rows.find(r=>r.group===group).question_id)+'；门槛：'+esc(metric)+' ≥ '+threshold+'</p><p>生成：'+new Date().toISOString()+' · 工具 '+C.VERSION+'</p><p>算法：confidence = (最高概率 − 1/n) / (1 − 1/n)；最高概率并列时始终复核。confidence 门槛按最短十进制输入用 BigInt 精确比较，不加 epsilon；显示数值可能含浮点近似。没有人工标签时，对错未知。项目字段不自动去敏。</p><h2>探索集</h2><p>'+summary(last)+'</p><p>覆盖率 '+pct(last.coverage)+'；有标签放行记录正确率 '+pct(last.accuracy)+'。仅是这批样本的结果，不是未来表现保证。</p><table>'+heading+tableRows(last.rows)+'</table><h2>留出集</h2>'+(holdout?'<p>'+summary(holdout)+' 此次会话已查看 '+holdoutChecks+' 次；多次查看不能作为独立最终验证。</p><table>'+heading+tableRows(holdout.rows)+'</table>':'<p>尚未检查；本报告不作留出表现结论。</p>')+'<p>未调用模型，未执行业务分流。数据与门槛可通过项目 JSON 继续分析。</p><p>公式与范围依据：<a href="https://docs.typesafe.ai/confidence">TypeSafe 官方 Confidence 文档</a>，核对于 2026-10-12。</p></html>';
  download('choice-analysis-report.html',report,'text/html;charset=utf-8');
}
$('sample').onclick=()=>load(sample);
$('paste-toggle').onclick=()=>{$('import-details').open=true;$('json-input').focus()};
$('import').onclick=()=>{if(new Blob([$('json-input').value]).size>5*1024*1024){status('内容超过 5 MiB。',true);return}load($('json-input').value)};
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024){status('文件超过 5 MiB，未读取。',true);return}try{load(await f.text())}catch{status('无法读取文件，请改用粘贴 JSON。',true)}e.target.value=''};
$('calculate').onclick=formula;
$('threshold').oninput=e=>adjust(e.target.value);
$('threshold-number').oninput=e=>adjust(e.target.value);
$('metric').onchange=e=>{metric=e.target.value;adjust($('threshold-number').value)};
$('group').onchange=e=>{group=e.target.value;adjust($('threshold-number').value)};
$('holdout').onclick=()=>{holdout=C.analyse(activeRows('holdout'),threshold,metric);holdoutChecks++;$('holdout-result').textContent=summary(holdout)+' 本会话第 '+holdoutChecks+' 次查看。改变门槛后必须重新检查；重复查看已不独立。'};
$('export-project').onclick=()=>download('choice-project.json',JSON.stringify(C.project(data,threshold,metric,group),null,2),'application/json');
$('export-report').onclick=exportReport;
formula();render();
