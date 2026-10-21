#!/usr/bin/env python3
"""横長のロゴ「RoQga」の「Ro」：R の斜めの足が、o（サッカーボール）を蹴る。

R の縦の棒とふくらみは Jua の字そのまま（斜めの足だけ切り取る）なので、Q・g・a と同じ太さ・丸み。
斜めの足は、R の足と同じ向きのまま、つま先を少し上げてボールをとらえる。
Q・g・a は、ほかの仲間と同じ作り方（tools/icon.py の Q の形と Jua の字。brandkit の logo_svg）。

tools/icon.py から使う（build() が logo.svg の中身と横:縦の比を返す）。
"""
import math
import re

import brandkit_path  # noqa: F401
from brandkit import _glyphs, glyph_path, hex_, num

INK = "#ffffff"
PATTERN = hex_((31, 92, 52))  # ボールの模様（濃い緑）
JUA_STEM = 0.18  # Jua の R の縦の棒の太さ（字の高さに対する割合。測った値）


def line(points, w):
    d = "M" + "L".join(f"{num(x)} {num(y)}" for x, y in points)
    return f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{num(w)}" stroke-linecap="round" stroke-linejoin="round"/>'


def ball(cx, cy, r):
    """サッカーボール：白い丸に、真ん中の五角形と、まわりの欠けた五角形（ふちで切る）"""
    def penta(c, size, rot):
        return " ".join(f"{num(c[0] + size * math.cos(math.radians(rot + 72 * i)))},{num(c[1] + size * math.sin(math.radians(rot + 72 * i)))}" for i in range(5))
    out = [f'<circle cx="{num(cx)}" cy="{num(cy)}" r="{num(r)}" fill="{INK}"/>',
           f'<clipPath id="ballClip"><circle cx="{num(cx)}" cy="{num(cy)}" r="{num(r)}"/></clipPath>',
           f'<polygon points="{penta((cx, cy), r * 0.36, -90)}" fill="{PATTERN}"/>',
           '<g clip-path="url(#ballClip)">']
    for i in range(5):
        a = math.radians(-90 + 36 + 72 * i)
        c = (cx + math.cos(a) * r * 0.98, cy + math.sin(a) * r * 0.98)
        out.append(f'<polygon points="{penta(c, r * 0.32, -90 + 36 + 72 * i)}" fill="{PATTERN}"/>')
    out.append("</g>")
    return "".join(out)


def r_body(h):
    """Jua の R（高さ h、0〜h）から、斜めの足を切り取った「縦の棒＋ふくらみ」"""
    from fontTools.pens.boundsPen import BoundsPen
    glyphs, cmap = _glyphs()
    pen = BoundsPen(glyphs)
    glyphs[cmap[ord("R")]].draw(pen)
    b = pen.bounds
    w = (b[2] - b[0]) * h / (b[3] - b[1])
    path = f'<path d="{glyph_path("R", (w / 2, h / 2), h)}" fill="{INK}"/>'
    # 残すのは「上から 0.6 まで（ふくらみ）」と「左の縦の棒（幅 0.2）」
    clip = (f'<clipPath id="rClip"><rect x="{num(-h)}" y="{num(-h)}" width="{num(3 * h)}" height="{num(h * 1.6)}"/>'
            f'<rect x="{num(-h)}" y="{num(-h)}" width="{num(h * 1.2)}" height="{num(3 * h)}"/></clipPath>')
    return f'{clip}<g clip-path="url(#rClip)">{path}</g>'


def ro(h):
    """Ro の SVG と、Q を置きはじめる x"""
    ws = JUA_STEM * h
    leg = [(0.44 * h, 0.56 * h), (0.56 * h, 0.78 * h), (0.64 * h, 0.92 * h)]  # 腰（ふくらみの下）から R の斜めの向きへ
    toe = (0.76 * h, 0.88 * h)  # つま先を少し上げる
    kick = "".join(line([leg[i], leg[i + 1]], ws * (1 - 0.12 * i)) for i in range(len(leg) - 1)) + line([leg[-1], toe], ws * 0.78)
    r = h * 0.3
    bx, by = 0.82 * h + r * 0.95, h - r
    return r_body(h) + kick + ball(bx, by, r), bx + r + h * 0.08


def build(brand, shapes, c, ring_outer):
    """logo.svg の中身と、横:縦の比"""
    svg, _ = brand.logo_svg("Qga", shapes, c, ring_outer, "RoQga")
    inner = re.search(r'(<g stroke-width=.*</g>)</svg>', svg, re.S).group(1)
    x0, y0, width, height = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    h = float(re.search(r'<rect [^>]*rx="([^"]+)"', svg).group(1)) / 0.3  # logo_svg の角の丸み（h × 0.3）から字の高さ
    ro_svg, ro_right = ro(h)
    pad_x = h * 0.55
    left, new_w = -pad_x, ro_right + x0 + width + pad_x
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(left)} {num(y0)} {num(new_w)} {num(height)}" role="img" aria-label="RoQga（ろくが）">'
        f"<defs>{brand.gradient_svg(left, y0, new_w, height)}</defs>"
        f'<rect x="{num(left)}" y="{num(y0)}" width="{num(new_w)}" height="{num(height)}" rx="{num(h * 0.3)}" fill="url(#g)"/>'
        + ro_svg
        + f'<g transform="translate({num(ro_right)} 0)">{inner}</g>'
        + "</svg>\n"
    ), new_w / height
