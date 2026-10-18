"""Build the standalone HTML with Python standard library. No downloads."""
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / 'src/shell.html').read_text()
for marker, name in [('/*STYLE*/', 'style.css'), ('/*CORE*/', 'core.js'), ('/*APP*/', 'app.js')]:
    html = html.replace(marker, (root / 'src' / name).read_text())
(root / 'dist').mkdir(exist_ok=True)
target = root / 'dist/Choice-Workbench.html'
target.write_text(html, encoding='utf-8')
print(f'Built {target.name}: {target.stat().st_size} bytes')
