#!/usr/bin/env python3
"""
Cut the cat part sheet into transparent PNGs.

The sheet arrives as one flat RGB image on a near-white background: twelve
parts, no alpha, nothing separable by a bounding box alone. This turns it into
`public/cat/*.png` plus the numbers the renderer needs.

Re-run it whenever the sheet is regenerated. It is deterministic — same sheet
in, same files and same anchors out — which is the only reason it is a script
in the repository rather than something done once by hand and forgotten.

    python3 scripts/cut-parts.py

## Why the background is found by flood fill and not by colour

The obvious cut is "every near-white pixel is background". It destroys the art:
the belly, the paw tips and the fluff inside the ears are all near-white too,
and a colour test cannot tell them from the page behind them. So the background
is whatever is **reachable from the border** — a topological question, which
those enclosed shapes fail by construction.

## Why the edges are matted against the colour behind them

The sheet is antialiased, so the outermost pixel of every part is a blend of
the art and the white page. Keeping it opaque leaves a pale rim — invisible on
the white sheet, and a visible halo the moment the cat stands on the game's
near-black background, which is the only place it will ever be seen.

Ramping alpha by absolute whiteness does not fix it either: the paw tips and
the belly ARE near-white, so any rule that reads "pale means transparent" eats
the art. What works is asking, per edge pixel, what colour sits just inside it
and solving for the blend that produced what is there:

    observed = inside x alpha + 255 x (1 - alpha)

Two pixels deep, which is as far as the antialiasing goes.
"""
from collections import deque
from pathlib import Path
import json
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is needed: python3 -m pip install Pillow')

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT.parent / 'neko-dancer-pics' / 'ChatGPT Image Aug 27, 2026, 08_33_46 PM.png'
OUT = ROOT / 'public' / 'cat'
GENERATED_TS = ROOT / 'src' / 'render' / 'catParts.ts'

# A pixel this close to white, and reachable from the border, is the page.
BG_MIN = 241
# Components smaller than this are speckle, not a part.
MIN_PART_PX = 2000


def load_sheet():
    im = Image.open(SHEET).convert('RGB')
    return im, im.size


def background_mask(px, w, h):
    """Every pixel reachable from the border across near-white. Topology, not colour."""
    def white(x, y):
        r, g, b = px[x, y]
        return r >= BG_MIN and g >= BG_MIN and b >= BG_MIN

    mask = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white(x, y) and not mask[y * w + x]:
                mask[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white(x, y) and not mask[y * w + x]:
                mask[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not mask[i] and white(nx, ny):
                    mask[i] = 1
                    q.append((nx, ny))
    return mask


def components(mask, px, w, h):
    """Each connected run of foreground, with its bounding box."""
    seen = bytearray(w * h)
    found = []
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if seen[i] or mask[i]:
                continue
            q = deque([(sx, sy)])
            seen[i] = 1
            pixels = [(sx, sy)]
            x0 = x1 = sx
            y0 = y1 = sy
            while q:
                x, y = q.popleft()
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and not mask[j]:
                            seen[j] = 1
                            q.append((nx, ny))
                            pixels.append((nx, ny))
            if len(pixels) >= MIN_PART_PX:
                found.append({'pixels': pixels, 'box': (x0, y0, x1, y1)})
    return found


# How many pixels of antialiasing to matte. Two covers this sheet.
EDGE_DEPTH = 2

NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def edge_depths(inside):
    """
    How far each pixel is from the background, up to `EDGE_DEPTH`.

    A plain flood from the outside, so "edge" means *actually on the boundary*
    rather than *pale*. That distinction is the whole reason the belly and the
    paw tips survive being cut out.
    """
    depth = {}
    frontier = [
        pos for pos in inside
        if any((pos[0] + dx, pos[1] + dy) not in inside for dx, dy in NEIGHBOURS)
    ]
    for pos in frontier:
        depth[pos] = 1
    current = frontier
    for d in range(2, EDGE_DEPTH + 1):
        nxt = []
        for x, y in current:
            for dx, dy in NEIGHBOURS:
                pos = (x + dx, y + dy)
                if pos in inside and pos not in depth:
                    depth[pos] = d
                    nxt.append(pos)
        current = nxt
    return depth


def matte(px, x, y, inside, depth):
    """
    Alpha and true colour for one edge pixel, from the colour just inside it.

    Returns `None` when nothing solid can be found to compare against — a part
    thinner than the antialiasing, which this sheet does not contain but a
    future one might. Better to leave such a pixel opaque than to invent a
    number for it.
    """
    core = None
    for radius in range(1, 5):
        best = None
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                pos = (x + dx, y + dy)
                if pos in inside and pos not in depth:
                    c = px[pos]
                    # The most saturated nearby pixel gives the most stable
                    # solve: a nearly-white neighbour makes the divisor tiny
                    # and the answer noise.
                    score = 255 - min(c)
                    if best is None or score > best[0]:
                        best = (score, c)
        if best and best[0] > 10:
            core = best[1]
            break
    if core is None:
        return None

    r, g, b = px[(x, y)]
    alphas = []
    for observed, base in zip((r, g, b), core):
        if 255 - base < 12:
            continue
        alphas.append((255 - observed) / (255 - base))
    if not alphas:
        return None
    a = max(0.0, min(1.0, sum(alphas) / len(alphas)))
    if a <= 0.004:
        return None
    # Un-blend: what colour, composited over white at this alpha, gives what is
    # there. Skipped, the edge keeps the white mixed into it and stays pale.
    out = tuple(
        max(0, min(255, int(round((c - 255 * (1 - a)) / a))))
        for c in (r, g, b)
    )
    return out + (int(round(a * 255)),)


def cut(part, px, w, h):
    x0, y0, x1, y1 = part['box']
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    op = out.load()
    inside = set(part['pixels'])
    depth = edge_depths(inside)

    for pos in part['pixels']:
        x, y = pos
        if pos in depth:
            solved = matte(px, x, y, inside, depth)
            if solved is None:
                r, g, b = px[pos]
                solved = (r, g, b, 255)
        else:
            r, g, b = px[pos]
            solved = (r, g, b, 255)
        if solved[3] == 0:
            continue
        op[x - x0, y - y0] = solved
    return out


def opaque_span(img, axis):
    """Width (or height) of the opaque run at each row (or column). For anchors."""
    w, h = img.size
    p = img.load()
    spans = []
    outer = h if axis == 'row' else w
    inner = w if axis == 'row' else h
    for i in range(outer):
        lo, hi = None, None
        for j in range(inner):
            a = p[j, i][3] if axis == 'row' else p[i, j][3]
            if a > 128:
                if lo is None:
                    lo = j
                hi = j
        spans.append((lo, hi) if lo is not None else None)
    return spans


def limb_anchor(img):
    """
    Top-centre of the ball joint — brief rule 5.

    Measured rather than guessed: the pivot is the centre of the widest part of
    the top fifth, which is exactly where the rounded cap sits. A flat-cut
    shoulder opens a gap the instant the limb rotates; the cap is what keeps it
    covered, so the pivot belongs at its centre and not at the texture corner.
    """
    w, h = img.size
    rows = opaque_span(img, 'row')
    cap = [r for r in rows[: max(1, h // 5)] if r]
    if not cap:
        return (0.5, 0.1)
    widest = max(cap, key=lambda r: r[1] - r[0])
    cx = (widest[0] + widest[1]) / 2
    # Down by half the cap's own width, so the pivot is the ball's centre.
    cy = (widest[1] - widest[0]) / 2
    return (round(cx / w, 4), round(min(cy, h) / h, 4))


def thicker_end(img):
    """Which end of a tail is the base. The body end is the thick one."""
    w, h = img.size
    rows = [r for r in opaque_span(img, 'row') if r]
    cols = [c for c in opaque_span(img, 'col') if c]
    vertical = len(rows) >= len(cols)
    spans = rows if vertical else cols
    n = max(1, len(spans) // 5)
    start = sum(s[1] - s[0] for s in spans[:n]) / n
    end = sum(s[1] - s[0] for s in spans[-n:]) / n
    return {
        'axis': 'vertical' if vertical else 'horizontal',
        'startThickness': round(start, 1),
        'endThickness': round(end, 1),
        'baseAtStart': start > end,
    }


NAMES = [
    # row 1 — heads, left to right
    'head-open', 'head-closed', 'head-happy',
    # row 2 — torso, then the curved pair
    'torso', 'arm-left', 'arm-right',
    # row 3 — the straight pair
    'leg-left', 'leg-right',
    # row 4 — tails, left to right
    'tail-curl', 'tail-raised', 'tail-wave', 'tail-arc',
]


def main():
    im, (w, h) = load_sheet()
    px = im.load()
    print(f'sheet {w}x{h}')

    mask = background_mask(px, w, h)
    parts = components(mask, px, w, h)
    print(f'{len(parts)} parts found')
    if len(parts) != len(NAMES):
        sys.exit(f'expected {len(NAMES)} parts, found {len(parts)} — the sheet changed shape')

    # Reading order: rows top to bottom, then left to right within a row.
    #
    # Rows are found by whether the parts' vertical extents OVERLAP, not by
    # dividing y into fixed bands. Fixed bands split the tails in half the first
    # time this ran — they sit at y=936..1021, which straddles any round number
    # you pick — and the four names landed on the wrong four images. Parts in a
    # row are never perfectly aligned, so alignment is the wrong thing to ask.
    parts.sort(key=lambda p: p['box'][1])
    rows = []
    for part in parts:
        y0, y1 = part['box'][1], part['box'][3]
        for row in rows:
            top = min(p['box'][1] for p in row)
            bottom = max(p['box'][3] for p in row)
            overlap = min(y1, bottom) - max(y0, top)
            if overlap > 0.4 * min(y1 - y0, bottom - top):
                row.append(part)
                break
        else:
            rows.append([part])
    parts = [p for row in rows for p in sorted(row, key=lambda p: p['box'][0])]

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, part in zip(NAMES, parts):
        img = cut(part, px, w, h)
        img.save(OUT / f'{name}.png')
        entry = {'width': img.size[0], 'height': img.size[1]}
        if name.startswith(('arm-', 'leg-')):
            entry['anchor'] = limb_anchor(img)
        if name.startswith('tail-'):
            entry['tail'] = thicker_end(img)
        manifest[name] = entry
        print(f'  {name:14s} {img.size[0]:4d}x{img.size[1]:4d}  {entry.get("anchor", "")} {entry.get("tail", "")}')

    (OUT / 'parts.json').write_text(json.dumps(manifest, indent=2) + '\n')
    write_ts(manifest)
    print(f'\nwrote {len(manifest)} PNGs and parts.json to {OUT.relative_to(ROOT)}')
    print(f'wrote {GENERATED_TS.relative_to(ROOT)}')


def write_ts(manifest):
    """
    Emit the part table as TypeScript, rather than letting anyone retype it.

    Sizes and ball-joint positions are MEASURED off the cut images. Typed by
    hand into a second file they would be right once and wrong after the first
    regenerated sheet, silently — a limb would pivot half a pixel off and it
    would read as bad animation rather than as stale data.
    """
    heads = [n for n in manifest if n.startswith('head-')]
    tails = [n for n in manifest if n.startswith('tail-')]
    limbs = [n for n in manifest if n.startswith(('arm-', 'leg-'))]

    def entry(name):
        m = manifest[name]
        anchor = m.get('anchor')
        ball = f'ballAnchor: [{anchor[0]}, {anchor[1]}]' if anchor else 'ballAnchor: null'
        return f"  '{name}': {{ width: {m['width']}, height: {m['height']}, {ball} }},"

    lines = [
        '/**',
        ' * The cat part table. GENERATED — do not edit.',
        ' *',
        ' * Written by `scripts/cut-parts.py`, which cuts the part sheet into',
        ' * `public/cat/*.png` and measures what it produced. Re-run that script',
        ' * rather than changing anything here; a hand edit is a number that',
        ' * disagrees with the image it describes.',
        ' */',
        '',
        'export const CAT_HEADS = [' + ', '.join(f"'{h}'" for h in heads) + '] as const;',
        'export const CAT_TAILS = [' + ', '.join(f"'{t}'" for t in tails) + '] as const;',
        'export const CAT_LIMBS = [' + ', '.join(f"'{l}'" for l in limbs) + '] as const;',
        '',
        'export type CatHead = (typeof CAT_HEADS)[number];',
        'export type CatTail = (typeof CAT_TAILS)[number];',
        'export type CatLimb = (typeof CAT_LIMBS)[number];',
        "export type CatPartName = CatHead | CatTail | CatLimb | 'torso';",
        '',
        'export interface CatPartMeta {',
        '  readonly width: number;',
        '  readonly height: number;',
        '  /**',
        "   * Centre of the limb's rounded cap, as a fraction of the texture.",
        '   *',
        '   * The pivot a rotating limb needs — a flat-cut shoulder opens a gap the',
        '   * instant an arm lifts, and the cap is what keeps the joint covered',
        '   * (`ART-BRIEF.md` §4 rule 1). The standing pose does not rotate anything,',
        '   * so nothing reads this yet; it is measured now because it is measured',
        '   * from the art, and the art is what changes.',
        '   */',
        '  readonly ballAnchor: readonly [number, number] | null;',
        '}',
        '',
        'export const CAT_PARTS: Record<CatPartName, CatPartMeta> = {',
    ]
    lines += [entry(n) for n in manifest]
    lines += ['};', '']
    GENERATED_TS.write_text('\n'.join(lines))


if __name__ == '__main__':
    main()
