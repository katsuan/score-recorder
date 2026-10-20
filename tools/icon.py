#!/usr/bin/env python3
"""ろくが（RoQga）のアイコン・ロゴ・OGP を作る。

名前は「ろくが」（録画）。キャッチコピーは「得点もいっしょにとろう」（撮る＝録画と、取る＝点を取るのかけことば）。英字は RoQga（おくるん＝OQRN・キロっく＝kiloQ と同じ作り方で、「く」を Q にする）。
アイコンはおくるんと同じ角の丸い四角に、さくせん盤と同じピッチの緑（さくせん盤の追加アプリなので）。録画のランプだけ赤。
Q はカメラのレンズの輪：白い輪の真ん中に、録画中の赤いランプ（白い丸の中の赤い点）。Q のしっぽは右下へ、短く太く（細長いと虫めがねに見える）。

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「RoQga」（Q はアイコンと同じ形、R・o・g・a は Jua）
  ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
from pathlib import Path

import brandkit_path  # noqa: F401（となりのおくるん（q-oqrn）の tools/brandkit.py を読めるようにする）
from brandkit import Brand, centered, polar

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


def main():
    BRAND.write_icons(ROOT, SHAPES)
    logo, ratio = BRAND.logo_svg("RoQga", SHAPES, C, RING_OUTER, "RoQga（ろくが）")
    (ROOT / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(ROOT / "ogp.png", SHAPES, "ろくが", "RoQga", ["試合をスマホで撮りながら", "得点板を動画にそのまま残せる"], copy="得点もいっしょにとろう")
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
