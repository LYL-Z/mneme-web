"""Rasterize brand-mark PNGs for the web app manifest. Matches public/favicon.svg."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
BG = (20, 18, 14, 255)
INK = (194, 164, 107, 255)


def mark(size: int, pad_ratio: float = 0.0) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * pad_ratio
    inner = size - 2 * pad
    sw = max(4, round(inner * 54 / 512))
    left = pad + inner * 170 / 512
    right = pad + inner * 342 / 512
    top = pad + inner * 146 / 512
    bot = pad + inner * 372 / 512
    mid_x = pad + inner * 256 / 512
    mid_y = pad + inner * 336 / 512
    d.line([(left, bot), (left, top)], fill=INK, width=sw)
    d.line([(right, bot), (right, top)], fill=INK, width=sw)
    d.line([(left, top), (mid_x, mid_y)], fill=INK, width=sw)
    d.line([(right, top), (mid_x, mid_y)], fill=INK, width=sw)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mark(192).save(OUT / "icon-192.png", optimize=True)
    mark(512).save(OUT / "icon-512.png", optimize=True)
    mark(512, pad_ratio=0.12).save(OUT / "icon-maskable-512.png", optimize=True)
    mark(180).save(OUT / "apple-touch-icon.png", optimize=True)
    print("wrote icons in", OUT)


if __name__ == "__main__":
    main()
