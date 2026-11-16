# 크리스마스 캐릭터 내보내기: 투명 원본, 4배 확대, 카드(1080x1920)
# 사용법: python3 tools/xmas/export_cards.py <deco.py 출력 폴더> <내보낼 폴더>
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter
SRC, DST = sys.argv[1], sys.argv[2]
NAMES = {1: "santa", 2: "elf", 3: "rudolph", 4: "santa"}
INK = (34, 28, 38, 255)

def card(fig, seed):
    W, H, S = 1080, 1920, 3
    rnd = random.Random(seed)
    bg = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(bg)
    top, bot = (16, 22, 40), (44, 58, 92)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W / 2 - 420, 420, W / 2 + 420, 1500], fill=(255, 214, 140, 70))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    for _ in range(170):
        x, y, r = rnd.randrange(W), rnd.randrange(H - 220), rnd.choice((2, 3, 3, 4, 6))
        a = rnd.randrange(120, 240)
        if r >= 6:
            for dx, dy in ((0, 0), (-6, 0), (6, 0), (0, -6), (0, 6)):
                d.rectangle([x + dx - 3, y + dy - 3, x + dx + 3, y + dy + 3], fill=(255, 255, 255, a))
        else:
            d.rectangle([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    for _ in range(14):
        x, y = rnd.randrange(60, W - 60), rnd.randrange(170, 1300)
        c = (255, 232, 150, 230)
        d.rectangle([x - 3, y - 15, x + 3, y + 15], fill=c)
        d.rectangle([x - 15, y - 3, x + 15, y + 3], fill=c)
        d.rectangle([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 255, 255))
    base_y, amp = 22, 22  # 전구 줄(모자 끝과 겹치지 않게 위쪽에)
    yof = lambda x: base_y + amp * math.sin(x / W * math.pi * 3) ** 2
    d.line([(x, yof(x)) for x in range(-20, W + 21, 6)], fill=(30, 70, 40, 255), width=6)
    colors = [(232, 60, 60), (60, 190, 100), (250, 200, 70), (90, 150, 240)]
    for i, x in enumerate(range(30, W, 72)):
        y, c = yof(x), colors[i % 4]
        d.ellipse([x - 20, y + 4, x + 20, y + 44], fill=c + (60,))
        d.rectangle([x - 5, y - 2, x + 5, y + 8], fill=(70, 74, 86, 255))
        d.ellipse([x - 10, y + 6, x + 10, y + 34], fill=c + (255,), outline=INK, width=3)
        d.rectangle([x - 5, y + 11, x - 2, y + 16], fill=(255, 255, 255, 200))
    d.ellipse([-260, H - 300, W * 0.62, H + 260], fill=(236, 244, 252, 255))
    d.ellipse([W * 0.38, H - 260, W + 260, H + 260], fill=(222, 234, 248, 255))
    d.rectangle([0, H - 150, W, H], fill=(236, 244, 252, 255))
    for _ in range(90):
        x, y = rnd.randrange(W), rnd.randrange(H - 230, H)
        d.rectangle([x, y, x + 6, y + 6], fill=(200, 216, 238, 255))
    big = fig.resize((fig.width * S, fig.height * S), Image.NEAREST)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([W / 2 - 230, H - 150, W / 2 + 230, H - 96], fill=(40, 60, 100, 110))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(8)))
    bg.alpha_composite(big, ((W - big.width) // 2, H - 120 - big.height))
    return bg.convert("RGB")

for k, name in NAMES.items():
    fig = Image.open(f"{SRC}/leader{k}.png")
    fig.save(f"{DST}/xmas{k}_{name}.png", optimize=True)
    fig.resize((fig.width * 4, fig.height * 4), Image.NEAREST).save(f"{DST}/xmas{k}_{name}_x4.png", optimize=True)
    card(fig, k).save(f"{DST}/xmas{k}_{name}_card.png", optimize=True)
    print(f"xmas{k}_{name}: 원본 {fig.size}, 4배 {(fig.width * 4, fig.height * 4)}, 카드 (1080, 1920)")
