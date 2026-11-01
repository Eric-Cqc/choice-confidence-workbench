"""End-to-end acceptance of the delivered command entry; standard library only."""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cli = root / 'choice.js'
checks = []

def run(*args, expected=0):
    result = subprocess.run(['node', str(cli), *map(str, args)], text=True, capture_output=True)
    assert result.returncode == expected, (result.returncode, result.stdout, result.stderr)
    return result

with tempfile.TemporaryDirectory(prefix='choice-acceptance-') as tmp:
    tmp = Path(tmp)
    source = root / 'examples/labelled-batch.json'
    original = hashlib.sha256(source.read_bytes()).hexdigest()
    run('--input', source, '--threshold', '.8', '--out', tmp / 'first')
    first = json.loads((tmp / 'first/results.json').read_text())
    assert first['input']['sha256'] == original
    a = first['exploration']
    assert (a['total'], a['passed'], a['review'], a['errors'], a['passed_labelled']) == (10, 4, 6, 1, 4)
    assert first['holdout'] is None
    checks.append('输入→报告→结果→可恢复项目：10/4/6/1，留出默认未读')
    run('--input', tmp / 'first/project.json', '--out', tmp / 'reopened')
    reopened = json.loads((tmp / 'reopened/results.json').read_text())
    assert reopened['exploration'] == a
    checks.append('保存的项目重开复算，逐条结果与设置一致')
    run('--input', tmp / 'first/project.json', '--threshold', '.9', '--out', tmp / 'changed')
    assert json.loads((tmp / 'changed/results.json').read_text())['exploration']['passed'] == 1
    checks.append('门槛改为0.9，放行从4条降为1条')
    run('--input', source, '--threshold', '.8', '--holdout', '--out', tmp / 'holdout')
    h = json.loads((tmp / 'holdout/results.json').read_text())['holdout']
    assert (h['total'], h['passed'], h['errors'], h['passed_unlabelled']) == (4, 3, 1, 1)
    checks.append('显式留出检查：4条中放行3条，已知错分1条、未知1条')
    run('--input', root / 'examples/official-format.json', '--out', tmp / 'unlabelled')
    u = json.loads((tmp / 'unlabelled/results.json').read_text())['exploration']
    assert u['accuracy'] is None and u['passed_unlabelled'] == 1
    checks.append('官方响应格式导入；无标签正确率为null，未当作100%')
    before = (tmp / 'first/report.md').read_bytes()
    run('--input', source, '--out', tmp / 'first', expected=2)
    assert (tmp / 'first/report.md').read_bytes() == before
    checks.append('已有输出目录被拒绝，旧报告字节不变')
    invalid = tmp / 'invalid.json'
    invalid.write_text('{"probabilities":{"A":0.8,"B":0.8}}')
    run('--input', invalid, '--out', tmp / 'bad', expected=2)
    assert not (tmp / 'bad').exists()
    checks.append('非法概率停止，未产生结果目录')
    multi = tmp / 'multi.json'
    multi.write_text(json.dumps([{'id':'x','question_id':'one','probabilities':{'A':1,'B':0}}, {'id':'y','question_id':'two','probabilities':{'A':1,'B':0}}]))
    run('--input', multi, '--out', tmp / 'mixed', expected=2)
    groups = json.loads(run('--input', multi, '--list').stdout)
    assert len(groups) == 2
    run('--input', multi, '--group', '2', '--out', tmp / 'selected')
    assert json.loads((tmp / 'selected/results.json').read_text())['exploration']['rows'][0]['id'] == 'y'
    checks.append('混合问题拒绝汇总；显式选组只含选中问题')
    run('--input', tmp / 'selected/project.json', '--out', tmp / 'selected-reopened')
    restored = json.loads((tmp / 'selected-reopened/results.json').read_text())['exploration']
    assert [r['id'] for r in restored['rows']] == ['y']
    run('--input', tmp / 'selected/project.json', '--group', '1', '--out', tmp / 'selected-override')
    overridden = json.loads((tmp / 'selected-override/results.json').read_text())['exploration']
    assert [r['id'] for r in overridden['rows']] == ['x']
    checks.append('多问题项目恢复已保存的问题组；显式 --group 可覆盖')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == original
    checks.append('源输入未修改')

print(json.dumps({'status':'passed','entry':'node choice.js','checks':checks,
                  'not_verified':['真实浏览器交互','手机布局','真实Jev推理','真实业务校准']},ensure_ascii=False,indent=2))

