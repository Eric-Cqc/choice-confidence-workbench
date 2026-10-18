/* Choice Workbench 1.0.1 — no network or model calls. */
(function (root) {
  'use strict';
  const VERSION = '1.0.1';
  const COMPARISON = Object.freeze({
    method: 'exact-canonical-decimal',
    formula: 'max(0, n*pmax - 1) / (n - 1) >= threshold',
    arithmetic_error: '0 (BigInt rational cross-multiplication; no epsilon)',
    input_semantics: 'Each parsed Number is interpreted as its shortest round-trip decimal Number.toString(); JSON parsing still has binary64 precision limits.'
  });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const str = (x, name, fallback) => {
    if (x === undefined) return fallback;
    if (typeof x !== 'string' || !x.trim() || x.length > 300) throw Error(name + ' 须为 1–300 字符的非空文字');
    return x;
  };
  function confidence(probabilities) {
    const p = Object.values(probabilities), n = p.length;
    return Math.max(0, Math.min(1, (Math.max(...p) - 1 / n) / (1 - 1 / n)));
  }
  function decimalFraction(value) {
    // Inputs are validated finite nonnegative Numbers. Decimal semantics make
    // 0.60 at confidence 0.40 an exact equality, while preserving adjacent
    // representable inputs. No positive comparison tolerance is introduced.
    const [mantissa, exponent = '0'] = value.toString().split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const scale = fraction.length - Number(exponent);
    const numerator = BigInt(whole + fraction);
    return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
  }
  function meetsThreshold(row, threshold, metric) {
    if (metric === 'top') return row.top >= threshold; // no derived arithmetic
    const [p, pd] = decimalFraction(row.top), [t, td] = decimalFraction(threshold);
    const numerator = BigInt(row.n) * p - pd;
    // Apply the same zero floor as displayed confidence. n is 2..255.
    return (numerator < 0n ? 0n : numerator) * td >= t * BigInt(row.n - 1) * pd;
  }
  function validateRow(row, i) {
    const prefix = '第 ' + (i + 1) + ' 条：';
    if (!object(row)) throw Error(prefix + '需要对象');
    if (row.type !== undefined && row.type !== 'choice') throw Error(prefix + '只支持 Choice；Score 和 Noul 使用不同定义');
    const p = row.probabilities;
    if (!object(p) || Object.keys(p).length < 2 || Object.keys(p).length > 255) throw Error(prefix + '需要 2–255 个选项');
    const entries = Object.entries(p);
    for (const [k, v] of entries) {
      str(k, prefix + '选项名');
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw Error(prefix + '概率须为 0–1 的有限数值');
    }
    const sum = entries.reduce((s, [, v]) => s + v, 0);
    if (Math.abs(sum - 1) > 1e-6) throw Error(prefix + '概率之和为 ' + sum.toFixed(6) + '，必须等于 1（容差 0.000001）；不自动归一化');
    const top = Math.max(...entries.map(([, v]) => v));
    const winners = entries.filter(([, v]) => v === top).map(([k]) => k);
    const choice = str(row.choice, prefix + 'choice', winners[0]);
    if (!own(p, choice) || !winners.includes(choice)) throw Error(prefix + 'choice 必须是概率最高的选项');
    const label = row.label === undefined || row.label === null || row.label === '' ? null : str(row.label, prefix + '人工标签');
    if (label !== null && !own(p, label)) throw Error(prefix + '人工标签不在选项中');
    const supplied = row.confidence;
    if (supplied !== undefined && (typeof supplied !== 'number' || !Number.isFinite(supplied) || supplied < 0 || supplied > 1)) throw Error(prefix + 'confidence 须在 0–1 之间');
    const computed = confidence(p);
    const split = row.split === undefined ? 'explore' : row.split;
    if (!['explore', 'holdout'].includes(split)) throw Error(prefix + 'split 仅支持 explore / holdout');
    const question = str(row.question_id, prefix + '问题名', 'choice');
    return {id: str(row.id, prefix + 'id', 'row-' + (i + 1)), question_id: question,
      probabilities: Object.fromEntries(entries), choice, label, split,
      note: typeof row.note === 'string' ? row.note.slice(0, 1000) : '',
      supplied_confidence: supplied ?? null, confidence: computed, top,
      tied: winners.length > 1, n: entries.length,
      mismatch: supplied !== undefined && Math.abs(supplied - computed) > 0.015,
      group: JSON.stringify([question, Object.keys(p).sort()])};
  }
  function parse(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    let title = '导入的概率结果', provenance = 'imported', rows = [], warnings = [];
    if (Array.isArray(data)) rows = data;
    else if (object(data) && Array.isArray(data.rows)) {
      rows = data.rows; title = str(data.title, '标题', title);
      provenance = data.provenance === 'synthetic' ? 'synthetic' : 'imported';
    } else if (object(data) && object(data.answers)) {
      for (const [q, answer] of Object.entries(data.answers)) {
        if (answer?.type === 'choice') rows.push({...answer, id: q, question_id: q});
        else warnings.push(q + '：不是 Choice，已跳过');
      }
    } else if (object(data) && own(data, 'probabilities')) rows = [data];
    else throw Error('需要 Choice 对象、含 answers 的 API 响应，或含 rows 的批量项目');
    if (rows.length < 1 || rows.length > 5000) throw Error('须含 1–5000 条 Choice 记录');
    rows = rows.map(validateRow);
    const seen = new Set();
    for (const r of rows) { if (seen.has(r.id)) throw Error('记录 id 重复：' + r.id); seen.add(r.id); }
    return {title, provenance, rows, warnings};
  }
  function analyse(rows, threshold, metric = 'confidence') {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error('阈值须在 0–1 之间');
    if (!['confidence', 'top'].includes(metric)) throw Error('未知门槛口径');
    if (new Set(rows.map(r => r.group)).size > 1) throw Error('不同问题或选项集合不能合并计算');
    const result = rows.map(r => {
      const qualifies = meetsThreshold(r, threshold, metric);
      return {...r, meets_threshold: qualifies, route: !r.tied && qualifies ? 'pass' : 'review',
        correct: r.label === null ? null : r.choice === r.label};
    });
    const passed = result.filter(r => r.route === 'pass');
    const labelled = result.filter(r => r.correct !== null), passedLabelled = passed.filter(r => r.correct !== null);
    const errors = passedLabelled.filter(r => !r.correct).length;
    const bins = Array.from({length:5}, (_, i) => {
      const set = labelled.filter(r => Math.min(4, Math.floor(r.top * 5)) === i);
      return {low:i/5, high:(i+1)/5, count:set.length,
        mean_probability:set.length ? set.reduce((s,r)=>s+r.top,0)/set.length : null,
        accuracy:set.length ? set.filter(r=>r.correct).length/set.length : null};
    });
    const comparison = metric === 'confidence' ? COMPARISON : {
      method: 'direct-number-order', formula: 'pmax >= threshold',
      arithmetic_error: '0 (comparison of parsed values; no arithmetic or epsilon)',
      input_semantics: COMPARISON.input_semantics
    };
    return {threshold, metric, comparison, total:result.length, passed:passed.length, review:result.length-passed.length,
      labelled:labelled.length, passed_labelled:passedLabelled.length, passed_unlabelled:passed.length-passedLabelled.length,
      errors, accuracy:passedLabelled.length ? 1-errors/passedLabelled.length : null,
      coverage:result.length ? passed.length/result.length : null, bins, rows:result};
  }
  function project(data, threshold, metric, group) {
    return {format:'choice-workbench-v1', version:VERSION, title:data.title, provenance:data.provenance,
      settings:{threshold, metric, group}, rows:data.rows.map(r=>({id:r.id,question_id:r.question_id,
        probabilities:r.probabilities, choice:r.choice, label:r.label, split:r.split, note:r.note,
        ...(r.supplied_confidence === null ? {} : {confidence:r.supplied_confidence})}))};
  }
  const api = {VERSION, COMPARISON, confidence, parse, validateRow, analyse, project};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChoiceCore = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
