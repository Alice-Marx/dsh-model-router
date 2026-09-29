"""Prepare authorized generated boards: real alpha sprites, no synthetic emotions."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
from collections import deque
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'spring'
EMOTIONS = ['neutral', 'happy', 'sad', 'determined', 'surprised', 'shy']


def clean_alpha(image):
    image = image.convert('RGBA')
    alpha = image.getchannel('A')
    # Some generators return an opaque white matte. Remove only near-white
    # pixels connected to the border, never enclosed white clothes/eyes.
    if alpha.getextrema()[0] > 240:
        w, h = image.size
        pixels = image.load()
        queue = deque([(x, 0) for x in range(w)] + [(x, h-1) for x in range(w)] + [(0, y) for y in range(h)] + [(w-1, y) for y in range(h)])
        seen = set()
        while queue:
            x, y = queue.popleft()
            if (x, y) in seen or x < 0 or y < 0 or x >= w or y >= h:
                continue
            seen.add((x, y))
            r, g, b, a = pixels[x, y]
            if min(r, g, b) < 240 or max(r, g, b)-min(r, g, b) > 12:
                continue
            pixels[x, y] = (r, g, b, 0)
            queue.extend([(x-1, y), (x+1, y), (x, y-1), (x, y+1)])
    return image


def main():
    cast = {}
    for name in ['generated-initial.json', 'generated-cast-a.json', 'generated-cast-b.json']:
        cast.update(json.loads((OUT/name).read_text(encoding='utf-8')))
    assert len(cast) == 27, f'Expected 27 boards, got {len(cast)}'
    manifest = {'emotions': EMOTIONS, 'characters': {}, 'backgrounds': {}}
    imports, objects, base_imports, base_objects = [], [], [], []
    review = Image.new('RGB', (1200, 27*156), '#eee9e0')
    draw = ImageDraw.Draw(review)
    for row, (key, record) in enumerate(cast.items()):
        if not record.get('generated'):
            raise ValueError(f'Missing generated board for {key}: {record}')
        board = Image.open(record['generated']).convert('RGBA')
        w, h = board.size
        paths, stats = {}, {}
        for index, emotion in enumerate(EMOTIONS):
            x, y = index % 3, index // 3
            tile = clean_alpha(board.crop((round(x*w/3), round(y*h/2), round((x+1)*w/3), round((y+1)*h/2))))
            # Discard alpha noise before obtaining the bounding box, but preserve
            # the actual portrait alpha and all artwork inside the box.
            box = tile.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
            if not box:
                raise ValueError(f'Empty sprite: {key}/{emotion}')
            tile = tile.crop(box)
            tile.thumbnail((480, 620), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (512, 640))
            canvas.alpha_composite(tile, ((512-tile.width)//2, 640-tile.height))
            target = OUT/'portraits'/f'{key}-{emotion}.webp'
            canvas.save(target, 'WEBP', quality=90, method=6)
            paths[emotion] = target.relative_to(ROOT).as_posix()
            extrema = canvas.getchannel('A').getextrema()
            stats[emotion] = {'size': list(canvas.size), 'alphaRange': list(extrema), 'sourceCell': [x, y], 'sourceBounds': list(box)}
            assert extrema[0] == 0 and extrema[1] > 100
            variable = f'{key}_{emotion}'
            imports.append(f"import {variable} from '../../{paths[emotion]}'")
            preview = canvas.copy()
            preview.thumbnail((150, 130))
            review.paste(preview, (index*195+35, row*156+20), preview)
            draw.text((index*195+5, row*156+3), f'{key} / {emotion}', fill='#20352d')
        objects.append(f"  {key}: Object.freeze({{ " + ', '.join(f'{e}: {key}_{e}' for e in EMOTIONS) + ' }),')
        # Keep the supplied originals independently available for fallback.
        source = clean_alpha(Image.open(record['source']))
        box = source.getchannel('A').getbbox()
        if box:
            source = source.crop(box)
        source.thumbnail((800, 1100), Image.Resampling.LANCZOS)
        original = OUT/'portraits'/f'{key}-original.webp'
        source.save(original, 'WEBP', quality=92, method=6)
        base_imports.append(f"import {key} from '../../{original.relative_to(ROOT).as_posix()}'")
        base_objects.append(key)
        manifest['characters'][key] = {**record, 'expressions': paths, 'original': original.relative_to(ROOT).as_posix(), 'validation': stats}
    review.save(OUT/'cast-contact-sheet.jpg', quality=92)
    generated = ROOT/'.dsh-plugin/client/gal-spring-portraits.mjs'
    generated.write_text('// Generated from authorized image boards; see output/spring/asset-manifest.json.\n'+'\n'.join(imports)+'\nexport const SPRING_PORTRAITS = Object.freeze({\n'+'\n'.join(objects)+'\n})\n'+'\n'.join(base_imports)+'\nexport const SPRING_ORIGINALS = Object.freeze({ '+', '.join(base_objects)+' })\n', encoding='utf-8')
    backgrounds = json.loads((OUT/'generated-backgrounds.json').read_text(encoding='utf-8'))
    assert len(backgrounds) == 8
    bg_imports, bg_objects = [], []
    contact = Image.new('RGB', (1280, 4*380), '#f5f1e9')
    contact_draw = ImageDraw.Draw(contact)
    for index, (key, record) in enumerate(backgrounds.items()):
        image = ImageOps.fit(Image.open(record['generated']).convert('RGB'), (1536, 864), method=Image.Resampling.LANCZOS)
        target = OUT/'backgrounds'/f'{key}.webp'
        image.save(target, 'WEBP', quality=91, method=6)
        path = target.relative_to(ROOT).as_posix()
        variable = key.replace('-', '_')
        bg_imports.append(f"import {variable} from '../../{path}'")
        bg_objects.append(f"  '{key}': {variable},")
        manifest['backgrounds'][key] = {**record, 'file': path, 'size': [1536, 864]}
        image.thumbnail((620, 349))
        xy = (index%2*640, index//2*380)
        contact.paste(image, (xy[0]+10, xy[1]+25))
        contact_draw.text((xy[0]+10, xy[1]+5), key, fill='#20352d')
    contact.save(OUT/'background-contact-sheet.jpg', quality=92)
    (ROOT/'.dsh-plugin/client/gal-spring-backgrounds.mjs').write_text('\n'.join(bg_imports)+'\nexport const SPRING_BACKGROUNDS = Object.freeze({\n'+'\n'.join(bg_objects)+'\n})\n', encoding='utf-8')
    (OUT/'asset-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'characters': len(cast), 'expressions': len(cast)*6, 'backgrounds': len(backgrounds), 'manifest': str(OUT/'asset-manifest.json')}))

if __name__ == '__main__':
    main()
