"""Independent physical-dimension and raster checks of WallPro export fixtures.
Run after verify-wallpro-print.mjs; requires Poppler, pypdf, Pillow and numpy.
"""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from pypdf import PdfReader

root = Path(sys.argv[1]).resolve()
dpi = 24
checks = []

def render(path, density=dpi):
    target = path.with_suffix('')
    subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-r', str(density), '-png', str(path), str(target)], check=True, capture_output=True)
    return np.array(Image.open(target.with_suffix('.png')).convert('RGB')).astype(np.int16)

def same(label, a, b):
    assert a.shape == b.shape, (label, a.shape, b.shape)
    difference = np.abs(a-b)
    assert difference.mean() < .3, (label, float(difference.mean()), int(difference.max()))
    checks.append({'check': label, 'mean_pixel_error': float(difference.mean()), 'max_pixel_error': int(difference.max())})

for mode in ['repeat', 'mural', 'contain']:
    manifest = json.loads((root / mode / 'manifest.json').read_text())
    for panel in manifest['panels']:
        pdf = PdfReader(root / mode / panel['filename'])
        assert len(pdf.pages) == 1
        page = pdf.pages[0]
        unit = float(page.get('/UserUnit', 1))
        width = float(page.mediabox.width) * unit / 72
        height = float(page.mediabox.height) * unit / 72
        assert abs(width-panel['width']) < 1e-6 and abs(height-panel['height']) < 1e-6
        assert width <= 51
        for key in ['/BleedBox', '/TrimBox']:
            assert key in page
        images = list(page.images)
        assert len(images) == 1
        assert images[0].image.size == (manifest['source']['widthPixels'], manifest['source']['heightPixels'])
        checks.append({'check': f'{mode}/{panel["filename"]}', 'width_inches': width, 'height_inches': height, 'source_pixels_preserved': True})

manifest = json.loads((root/'repeat/manifest.json').read_text())
master = render(root/'repeat/wall-master-full-size.pdf')
panels = []
for panel in manifest['panels']:
    image = render(root/'repeat'/panel['filename'])
    panels.append(image)
    left = round((panel['x']+manifest['settings']['bleed'])*dpi)
    same(f'panel {panel["number"]} matches master coordinates', image, master[:,left:left+image.shape[1]])
overlap = round(manifest['settings']['overlap']*dpi)
for i in range(1, len(panels)):
    same(f'overlap {i}/{i+1} duplicates identical artwork', panels[i-1][:,-overlap:], panels[i][:,:overlap])

mural = render(root/'mural/wall-master-full-size.pdf', 100)
b = 100
same('left mirror bleed', mural[b:-b,:b], mural[b:-b,b:2*b][:,::-1])
same('right mirror bleed', mural[b:-b,-b:], mural[b:-b,-2*b:-b][:,::-1])
same('top mirror bleed', mural[:b,b:-b], mural[b:2*b,b:-b][::-1])
same('bottom mirror bleed', mural[-b:,b:-b], mural[-2*b:-b,b:-b][::-1])
contained = render(root/'contain/wall-master-full-size.pdf')
assert np.all(contained[:, :2*dpi] == 255) and np.all(contained[:, -2*dpi:] == 255)
checks.append({'check': 'contain keeps the intended white margins', 'passed': True})

for mode in ['repeat', 'mural', 'contain']:
    pdf = root/mode/'installation-layout.pdf'
    subprocess.run(['pdftoppm','-f','1','-l','2','-r','100','-png',str(pdf),str(root/mode/'installation-sheet')],check=True,capture_output=True)
receipt = {'passed': True, 'checks': checks}
(root/'verification.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2))
