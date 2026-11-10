"""Draws the PaperPad app icon (1024x1024) with Pillow.

Run:  python3 scripts/make-icon.py && npx tauri icon app-icon.png
The second command generates every platform icon in src-tauri/icons.
"""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded tile with a chunky 90s bevel.
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=180, fill=(38, 84, 124))
d.rounded_rectangle((40, 40, S - 40, S - 70), radius=180, fill=(52, 110, 158))
d.rounded_rectangle((70, 70, S - 70, S - 100), radius=150, fill=(45, 98, 142))

# Paper sheet with folded corner and hard drop shadow.
px0, py0, px1, py1, fold = 250, 190, 720, 820, 120
shadow = 26
d.polygon([(px0 + shadow, py0 + shadow), (px1 - fold + shadow, py0 + shadow),
           (px1 + shadow, py0 + fold + shadow), (px1 + shadow, py1 + shadow),
           (px0 + shadow, py1 + shadow)], fill=(18, 40, 62))
d.polygon([(px0, py0), (px1 - fold, py0), (px1, py0 + fold), (px1, py1), (px0, py1)],
          fill=(250, 246, 234), outline=(20, 20, 20), width=14)
d.polygon([(px1 - fold, py0), (px1 - fold, py0 + fold), (px1, py0 + fold)],
          fill=(214, 206, 186), outline=(20, 20, 20), width=14)

# Text lines.
for i, w in enumerate([330, 380, 300, 360, 220]):
    y = 340 + i * 82
    d.rectangle((px0 + 60, y, px0 + 60 + w, y + 26), fill=(60, 60, 70))

# Pencil (yellow body, pink eraser, wood tip).
pencil = Image.new("RGBA", (S, S), (0, 0, 0, 0))
p = ImageDraw.Draw(pencil)
cx, top, bw, length = 512, 120, 96, 560
p.rectangle((cx - bw // 2, top, cx + bw // 2, top + 90), fill=(236, 120, 150), outline=(20, 20, 20), width=12)
p.rectangle((cx - bw // 2, top + 90, cx + bw // 2, top + 130), fill=(190, 190, 200), outline=(20, 20, 20), width=12)
p.rectangle((cx - bw // 2, top + 130, cx + bw // 2, top + length), fill=(255, 200, 40), outline=(20, 20, 20), width=12)
p.rectangle((cx - 8, top + 130, cx + 8, top + length), fill=(230, 170, 20))
p.polygon([(cx - bw // 2, top + length), (cx + bw // 2, top + length), (cx, top + length + 150)],
          fill=(240, 205, 150), outline=(20, 20, 20), width=12)
p.polygon([(cx - 22, top + length + 85), (cx + 22, top + length + 85), (cx, top + length + 150)], fill=(20, 20, 20))
pencil = pencil.rotate(-38, resample=Image.BICUBIC, center=(512, 512))
img.alpha_composite(pencil, (170, 120))

img.save("app-icon.png")
print("wrote app-icon.png")
