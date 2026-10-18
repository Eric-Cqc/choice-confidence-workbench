#!/usr/bin/env node
'use strict';
// Offline file analysis only. No networking, credentials, or external actions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('./src/core.js');
const help = `Choice Workbench ${C.VERSION} — 离线 Choice 结果分析

用法：
  node choice.js --input examples/labelled-batch.json --list
  node choice.js --input examples/labelled-batch.json --threshold 0.8 --out my-result
  node choice.js --input my-result/project.json --threshold 0.9 --out my-next-result

选项：
  --input FILE         去敏后的 Choice / answers / rows JSON（最大 5 MiB）
  --list               只列出问题组，不写文件
  --group NUMBER       选择 --list 返回的 1 起始序号，多组时必须显式选择
  --threshold NUMBER   门槛 0–1，默认读取项目设置，否则 0.8
  --metric METRIC      confidence 或 top；默认读取项目设置，否则 confidence
  --holdout            明确要求用当前门槛分析留出集；不自动调参
  --out DIRECTORY      必须是尚不存在的新目录，其父目录须已存在；排他创建
  --help               显示帮助

输出：report.md、results.json、project.json。未标注记录的正确性为未知。
本工具不生成概率、不调用 Jev、不验证模型能力。`;
const pct = n => n === null ? '未知' : (n * 100).toFixed(1) + '%';
// Encode every ASCII punctuation character, not only Markdown's delimiters.
// This also prevents GFM automatic links, raw HTML and table/line injection.
// Character references are emitted in a single pass and render as plain text.
const safe = s => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/[!-/:-@\[-`{-~]/g, ch => '&#' + ch.charCodeAt(0) + ';');
function main(args) {
  const opts = {};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(['--help','--list','--holdout'].includes(key)){opts[key]=true;continue}
    if(!['--input','--out','--threshold','--metric','--group'].includes(key)) throw Error('未知参数：'+key);
    if(!args[i+1] || args[i+1].startsWith('--')) throw Error(key+' 缺少值');
    if(Object.hasOwn(opts,key)) throw Error('重复参数：'+key);
    opts[key]=args[++i];
  }
  if(opts['--help']){console.log(help);return}
  if(!opts['--input'])throw Error('请提供 --input；使用 --help 查看流程');
  const input=path.resolve(opts['--input']);
  const stat=fs.statSync(input);if(!stat.isFile()||stat.size>5*1024*1024)throw Error('输入必须是最大 5 MiB 的普通文件');
  const inputBytes=fs.readFileSync(input), raw=JSON.parse(inputBytes.toString('utf8')), data=C.parse(raw);
  const inputSha256=crypto.createHash('sha256').update(inputBytes).digest('hex');
  const groups=[...new Set(data.rows.map(r=>r.group))];
  if(opts['--list']){console.log(JSON.stringify(groups.map((g,i)=>({group:i+1,question:JSON.parse(g)[0],options:JSON.parse(g)[1],records:data.rows.filter(r=>r.group===g).length})),null,2));return}
  if(groups.length>1&&!opts['--group'])throw Error('存在多个问题/选项集合；先 --list，再用 --group 选择一个');
  const idx=Number(opts['--group']??1)-1;
  if(!Number.isInteger(idx)||idx<0||idx>=groups.length)throw Error('--group 超出范围');
  const threshold=Number(opts['--threshold']??raw.settings?.threshold??.8),metric=opts['--metric']??raw.settings?.metric??'confidence';
  const group=groups[idx], chosen=data.rows.filter(r=>r.group===group);
  const exploration=C.analyse(chosen.filter(r=>r.split==='explore'),threshold,metric);
  const holdout=opts['--holdout']?C.analyse(chosen.filter(r=>r.split==='holdout'),threshold,metric):null;
  if(!opts['--out'])throw Error('请用 --out 指定尚不存在的新输出目录');
  const output=path.resolve(opts['--out']);
  const created=new Date().toISOString();
  const summary=a=>`共 ${a.total} 条；建议放行 ${a.passed} 条（覆盖率 ${pct(a.coverage)}），人工复核 ${a.review} 条。放行中 ${a.passed_labelled} 条有标签，错分 ${a.errors} 条，另 ${a.passed_unlabelled} 条对错未知。有标签放行记录正确率 ${pct(a.accuracy)}。`;
  const table=a=>['| 记录 | 选中 | 人工标签 | 最高概率 | confidence | 建议 | 核对 |','|---|---|---|---:|---:|---|---|',...a.rows.map(r=>`| ${safe(r.id)} | ${safe(r.choice)} | ${safe(r.label??'未标注')} | ${pct(r.top)} | ${r.confidence.toFixed(4)} | ${r.route==='pass'?'放行建议':'人工复核'}${r.tied?'（并列）':''} | ${r.correct===null?'未知':r.correct?'一致':'错分'}${r.mismatch?'；输入 confidence 与公式不符':''} |`)].join('\n');
  const md=[`# Choice 分析报告`,`${safe(data.title)}`,`来源：${data.provenance==='synthetic'?'构造数据，非模型实测':'用户导入，来源未独立验证'}。生成时间：${created}；工具：${C.VERSION}。`,
    `输入文件：${safe(path.basename(input))}；SHA-256：${inputSha256}。完整概率、逐条记录 ID 与标签保存在同目录 results.json 和 project.json。`,
    `问题：${safe(JSON.parse(group)[0])}；选项数：${chosen[0].n}。规则：${metric} ≥ ${threshold}，最高概率并列时始终复核。`,
    `confidence = (最高概率 − 1/n) / (1 − 1/n)。confidence 不等于实际正确率。`,
    `confidence 门槛使用已解析数字的最短十进制表示，以 BigInt 分数交叉相乘精确判断，比较算术误差为 0、不加 epsilon；top 门槛直接比较已解析概率。confidence 数值字段是浮点近似，仅用于展示；分流以 meets_threshold 和 route 字段为准。JSON 数字仍受 binary64 输入精度限制。`,
    `## 探索集`,summary(exploration),table(exploration),
    `## 留出集`,holdout?summary(holdout)+' 该结果仅对本批记录有效；用同一留出集反复调参不能视作独立验证。':'尚未检查，未展示留出表现；需要时显式传 --holdout。',holdout?table(holdout):'',
    `## 概率分箱（探索集中有人工标签的记录）`,
    '| 最高概率区间 | 数量 | 平均最高概率 | 样本正确率 |\n|---|---:|---:|---:|',
    ...exploration.bins.map((b,i)=>`| [${b.low.toFixed(1)}, ${b.high.toFixed(1)}${i===4?']':')'} | ${b.count} | ${pct(b.mean_probability)} | ${pct(b.accuracy)} |`),
    `## 解释边界`,
    `本工具没有推理模型，也不执行分流动作。小样本或构造数据不能证明模型校准、业务安全性或未来表现。不同问题和选项集合分开计算；标签只代表导入者给出的标注。输入 confidence 与复算值相差超过 0.015 时提示不一致，该提示容差不用于门槛比较。概率总和容差为 0.000001，不自动归一化。标题、ID、标签及备注可能含私有资料，白名单保留不等于自动去敏。`,
    `[公式来源：TypeSafe Confidence](https://docs.typesafe.ai/confidence)；[响应格式](https://docs.typesafe.ai/api)，2026-10-12 核对。`,
    `继续使用：将同目录 project.json 作为下次 --input，输出到新目录。`,
    ...data.warnings.map(w=>'导入提示：'+safe(w))].filter(Boolean).join('\n\n')+'\n';
  // Atomic directory creation chooses one winner between concurrent writers.
  // Exclusive files additionally refuse pre-existing targets. Do not clean up
  // partial output after a failure: preserve evidence for the user to inspect.
  try { fs.mkdirSync(output,{mode:0o700}); }
  catch(e) { if(e.code==='EEXIST')throw Error('输出目录已存在，为避免覆盖已停止：'+output);throw e; }
  const exclusive={flag:'wx',mode:0o600};
  fs.writeFileSync(path.join(output,'report.md'),md,exclusive);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({version:C.VERSION,created,input:{filename:path.basename(input),sha256:inputSha256},provenance:data.provenance,exploration,holdout},null,2),exclusive);
  fs.writeFileSync(path.join(output,'project.json'),JSON.stringify(C.project(data,threshold,metric,group),null,2),exclusive);
  console.log(summary(exploration));console.log('报告与可恢复项目已写入：'+output);
}
try{main(process.argv.slice(2))}catch(e){console.error('未完成：'+e.message);process.exitCode=2}
