"""Regression of real CLI file output for 1.0.1; no third-party dependencies."""
import concurrent.futures
import hashlib
import html
import json
import math
import re
import subprocess
import tempfile
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cli = root / 'choice.js'
checks = []

def run(*args, expected=0):
    r = subprocess.run(['node', str(cli), *map(str, args)], text=True, capture_output=True)
    assert r.returncode == expected, (r.returncode, r.stdout, r.stderr)
    return r

with tempfile.TemporaryDirectory(prefix='choice-101-') as tmp:
    tmp = Path(tmp)
    for index, (p, threshold) in enumerate([(0.6, 0.4), (0.9, 0.85), (0.88, 0.82)]):
        src = tmp / f'boundary-{index}.json'
        values = [math.nextafter(p, -math.inf), p, math.nextafter(p, math.inf)]
        src.write_text(json.dumps({'provenance':'synthetic','rows':[
            {'id':name, 'probabilities':{'A':v, 'B':1-v, 'C':0}}
            for name,v in zip(['below','equal','above'],values)]}))
        out = tmp / f'out-{index}'
        run('--input',src,'--threshold',threshold,'--out',out)
        result = json.loads((out/'results.json').read_text())
        assert [r['route'] for r in result['exploration']['rows']] == ['review','pass','pass']
        assert result['version'] == '1.0.1'
        assert result['exploration']['comparison']['method'] == 'exact-canonical-decimal'
        assert result['input']['sha256'] == hashlib.sha256(src.read_bytes()).hexdigest()
        report = (out/'report.md').read_text()
        assert '比较算术误差为 0' in report and '| equal |' in report
        reopened = tmp / f'reopened-{index}'
        run('--input',out/'project.json','--out',reopened)
        assert json.loads((reopened/'results.json').read_text())['exploration'] == result['exploration']
        checks.append(f'CLI {p}/{threshold}: nearest below/equal/above => review/pass/pass; export and reopen identical')

    payload = 'MSTART ![img](https://evil.invalid/p.png) [link](https://evil.invalid/) <img src="https://evil.invalid/x"> a|b\n\\ `code` **bold** @mail.test &#60;img&#62; MEND'
    hostile = tmp/'hostile.json'
    hostile.write_text(json.dumps({'title':payload, 'rows':[{'id':payload, 'question_id':payload,
        'probabilities':{payload:0.9,'other':0.1},'label':payload,'note':payload}]}))
    out = tmp/'safe-report'
    run('--input',hostile,'--threshold',0.8,'--out',out)
    report = (out/'report.md').read_text()
    rendered_fields = re.findall(r'MSTART (.*?) MEND',report)
    assert len(rendered_fields) >= 5
    for text in rendered_fields:
        assert html.unescape(text) == payload.removeprefix('MSTART ').removesuffix(' MEND').replace('\n',' ')
        # After removing emitted entities, no raw ASCII punctuation can act as
        # a Markdown delimiter, GFM autolink, HTML tag or table boundary.
        residual=re.sub(r'&#\d+;', '', text)
        assert not re.search(r'[!-/:-@\[-`{-~]',residual),residual
    assert 'https://evil.invalid' not in report and '<img ' not in report
    assert '![img]' not in report and '[link]' not in report
    saved=json.loads((out/'project.json').read_text())
    assert saved['title'] == payload and saved['rows'][0]['note'] == payload
    checks.append('Markdown image/link, raw URL, HTML, pipe/newline/backslash and entity injection rendered as encoded plain text; raw project preserved, not anonymized')

    # Simultaneous actual CLI processes target one path with distinct payloads.
    target=tmp/'concurrent'
    barrier=threading.Barrier(8)
    def contender(i):
        src=tmp/f'writer-{i}.json'
        src.write_text(json.dumps({'title':f'writer {i}', 'probabilities':{'A':0.9,'B':0.1}}))
        barrier.wait()
        return i,src,subprocess.run(['node',str(cli),'--input',str(src),'--out',str(target)],text=True,capture_output=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        attempts=list(pool.map(contender,range(8)))
    winners=[x for x in attempts if x[2].returncode==0]
    assert len(winners)==1,[(i,r.returncode) for i,_,r in attempts]
    assert all(r.returncode in (0,2) for _,_,r in attempts)
    _,winner_src,_=winners[0]
    result=json.loads((target/'results.json').read_text())
    assert result['input']['sha256'] == hashlib.sha256(winner_src.read_bytes()).hexdigest()
    assert set(p.name for p in target.iterdir()) == {'report.md','results.json','project.json'}
    before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
    run('--input',hostile,'--out',target,expected=2)
    assert before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
    checks.append('8 concurrent CLI writers: exactly one success, 7 refused; winner hash matches and later attempt leaves all files unchanged')

    missing=tmp/'missing-parent'/'child'
    run('--input',hostile,'--out',missing,expected=2)
    assert not missing.exists()
    checks.append('Missing output parent fails without partial parent creation')

print(json.dumps({'status':'passed','version':'1.0.1','checks':checks},ensure_ascii=False,indent=2))
