#!/usr/bin/env python3
"""ろくが（RoQga）のアイコン・ロゴ・OGP を作る。

名前は「ろくが」（録画）。キャッチコピーは「撮った試合も、取った点も、とっておき」（撮った試合も、取った点も、どちらも「とっておき」＝撮っておく・取っておきの宝物 のかけことば）。英字は RoQga（おくるん＝OQRN・キロっく＝kiloQ と同じ作り方で、「く」を Q にする）。
アイコンはおくるんと同じ角の丸い四角に、さくせん盤と同じピッチの緑（さくせん盤の追加アプリなので）。録画のランプだけ赤。
Q はカメラのレンズの輪：白い輪の真ん中に、録画中の赤いランプ（白い丸の中の赤い点）。Q のしっぽは右下へ、短く太く（細長いと虫めがねに見える）。

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「RoQga」（R の斜めの足が o＝サッカーボールを蹴る。tools/logo_ro.py。Q はアイコンと同じ形、R・g・a は Jua）
  ogp.png  … 共有したときの画像（1200×630）。左上に、動画に入るのと同じ得点板（チーム名なし＝色の丸の形）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
from pathlib import Path

import brandkit_path  # noqa: F401（となりのおくるん（q-oqrn）の tools/brandkit.py を読めるようにする）
from brandkit import FONT_PATH, Brand, centered, polar
from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = Brand(light=(92, 194, 122), dark=(46, 139, 74))  # さくせん盤のアイコンと同じピッチの緑（--pitch #2e8b4a）
REC = (229, 57, 53)  # 録画のランプの赤

C = (46, 46)  # 輪の中心
R, RING_W = 23, 10  # 輪の半径（線の真ん中）・太さ
TAIL_DIR = 45  # しっぽの向き（右下）


def build():
    """Q の形。外形（しっぽを含む）の真ん中をアイコンの真ん中にそろえる（ロゴも同じ形を使う）"""
    return centered([
        {"t": "circle", "c": C, "r": R, "alpha": 0.16},  # 輪の内側（うっすら）
        {"t": "ring", "c": C, "r": R, "w": RING_W},  # レンズの輪（Q）
        {"t": "circle", "c": C, "r": 10.5},  # ランプの白いふち
        {"t": "circle", "c": C, "r": 7, "fill": REC},  # 録画中の赤いランプ
        # Q のしっぽ：輪に食いこませて短く太く（細く長いと虫めがね＝さがすに見えるため）
        {"t": "line", "p": [polar(C, TAIL_DIR, R - 3), polar(C, TAIL_DIR, R + 11)], "w": RING_W + 3},
    ])


SHAPES, (_DX, _DY) = build()
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


# OGP の左上の得点板：動画に入る得点板（app.js の drawScoreboard）と同じ形。チーム名がないときの、色の丸の形。
# 色は、はじめて開いたときのチームの色（app.js の state の初期値）
SCORE_US, SCORE_THEM = (108, 71, 255), (255, 255, 255)


def scoreboard(d, s, k=1.15):
    """濃い札に [色の帯] ● 2 - 1 ● [色の帯]。k は動画の 720p のときの何倍か"""
    u = lambda v: v * k * s  # noqa: E731
    pad, box_h, gap, chip, dot = u(36), u(64), u(16), u(10), u(26)
    font = ImageFont.truetype(str(FONT_PATH), round(u(40)))
    # 「2 - 1」は字ごとに置く（Jua の空白は広いため）
    parts = ["2", "-", "1"]
    sep = u(12)
    score_w = sum(d.textlength(t, font=font) for t in parts) + sep * (len(parts) - 1)
    box_w = chip + gap + dot + gap * 1.5 + score_w + gap * 1.5 + dot + gap + chip + gap * 1.2
    x, y = pad, pad
    d.rounded_rectangle((x, y, x + box_w, y + box_h), radius=u(14), fill=(12, 22, 16, 205))
    d.rectangle((x + gap * 0.6, y + u(12), x + gap * 0.6 + chip, y + box_h - u(12)), fill=SCORE_US)
    d.rectangle((x + box_w - gap * 0.6 - chip, y + u(12), x + box_w - gap * 0.6, y + box_h - u(12)), fill=SCORE_THEM)
    cx = x + gap * 0.6 + chip + gap
    cy = y + box_h / 2
    for color, at in ((SCORE_US, cx), (SCORE_THEM, cx + dot + gap * 1.5 + score_w + gap * 1.5)):
        d.ellipse((at, cy - dot / 2, at + dot, cy + dot / 2), fill=color, outline=(255, 255, 255), width=round(u(2.5)))
    tx = cx + dot + gap * 1.5
    for t in parts:
        d.text((tx, cy + u(2)), t, font=font, fill=(255, 255, 255), anchor="lm")
        tx += d.textlength(t, font=font) + sep


def main():
    BRAND.write_icons(ROOT, SHAPES)
    from logo_ro import build as build_logo  # logo_ro は Q・g・a をここの BRAND・SHAPES で作る

    logo, ratio = build_logo(BRAND, SHAPES, C, RING_OUTER)
    (ROOT / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(ROOT / "ogp.png", SHAPES, "ろくが", "RoQga", ["試合をスマホで撮りながら", "得点板を動画にそのまま残せる"], scoreboard, copy="撮った試合も、取った点も、とっておき")
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
