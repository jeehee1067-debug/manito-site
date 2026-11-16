# 파트장님·PL님 그림(방탈출 boss1~4)에 크리스마스 꾸밈을 얹는다 — 2차(업그레이드).
# 원본과 같은 1픽셀 해상도로 그리고 3~4단계 음영과 잉크 테두리를 넣는다. 손에는 소품을 쥐여 준다(손 픽셀을 다시 위에 덮어 "쥔" 모양).
# 사용법: python3 tools/xmas/deco.py public/char <출력 폴더>
import sys
import math
import random
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
OX, OY = 18, 64  # 원본 기준 좌표를 캔버스로 옮길 때 더하는 값(왼쪽 여백: 머그·상자 자리, 위쪽 여백: 모자·뿔 자리)
INK = (34, 28, 38, 255)

def C(*rgb, a=255):
    return (*rgb, a)

RED, RED_D, RED_DD, RED_L = C(206, 46, 56), C(160, 30, 44), C(112, 20, 34), C(240, 104, 100)
GRN, GRN_D, GRN_DD, GRN_L = C(48, 152, 88), C(30, 110, 64), C(20, 76, 46), C(104, 200, 126)
WHT, WHT_D, WHT_DD = C(252, 252, 248), C(216, 224, 236), C(178, 190, 210)
GOLD, GOLD_D, GOLD_DD, GOLD_L = C(242, 192, 62), C(194, 138, 36), C(140, 92, 22), C(255, 232, 150)
BRN, BRN_D, BRN_DD, BRN_L = C(146, 96, 54), C(106, 66, 36), C(72, 44, 24), C(190, 138, 84)
PINK = C(236, 150, 150)
COCOA, COCOA_D = C(122, 72, 44), C(90, 50, 30)


GLOW = []  # 루돌프 코 빛(테두리 없이 맨 마지막에 반투명으로)


def P(x, y):
    return (x + OX, y + OY)


def PS(pts):
    return [P(x, y) for x, y in pts]


class Layer:
    def __init__(self, size):
        self.im = Image.new("RGBA", size, (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def poly(self, pts, fill):
        self.d.polygon(PS(pts), fill=fill)

    def ell(self, x0, y0, x1, y1, fill):
        self.d.ellipse([*P(x0, y0), *P(x1, y1)], fill=fill)

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([*P(x0, y0), *P(x1, y1)], fill=fill)

    def line(self, pts, fill, width=1):
        self.d.line(PS(pts), fill=fill, width=width)

    def px(self, x, y, fill):
        self.d.point(P(x, y), fill=fill)

    def stroke(self, pts, fill, r):
        """굵은 선: 점을 촘촘히 찍어 둥근 끝을 만든다(r = 반지름)."""
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) * 2))
            for i in range(n + 1):
                t = i / n
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                self.ell(x - r, y - r, x + r, y + r, fill)


def outlined(layer, color=INK):
    """레이어 바깥에 1픽셀 테두리를 두른다."""
    a = layer.im.split()[3].point(lambda v: 255 if v > 0 else 0)
    grown = a.filter(ImageFilter.MaxFilter(3))
    out = Image.new("RGBA", layer.im.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", layer.im.size, color), mask=grown)
    out.alpha_composite(layer.im)
    return out


def clip_to(layer_im, mask_im):
    """layer_im의 그림을 mask_im의 불투명 영역 안으로만 남긴다."""
    m = mask_im.split()[3].point(lambda v: 255 if v > 0 else 0)
    out = Image.new("RGBA", layer_im.size, (0, 0, 0, 0))
    out.paste(layer_im, mask=m)
    return out


def fur(L, x0, y0, x1, y1, seed):
    """흰 털 테두리: 둥근 덩어리 + 아래쪽 음영 + 털 결 점."""
    rnd = random.Random(seed)
    h = y1 - y0
    L.rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, WHT)
    x = x0
    while x <= x1:
        L.ell(x - 3, y0, x + 4, y0 + 7, WHT)
        L.ell(x - 3, y1 - 7, x + 4, y1, WHT)
        x += 5
    L.ell(x0 - 2, y0 + 1, x0 + 6, y1 - 1, WHT)
    L.ell(x1 - 6, y0 + 1, x1 + 2, y1 - 1, WHT)
    # 아래쪽 음영과 털 결
    for xx in range(x0, x1 + 1):
        for yy in range(y0 + h // 2, y1):
            if rnd.random() < 0.18:
                L.px(xx, yy, WHT_D)
        if rnd.random() < 0.35:
            L.px(xx, y1 - 2, WHT_DD)
    for xx in range(x0 + 2, x1 - 1, 3):
        L.px(xx, y0 + 2 + (xx % 2), WHT)


def holly(L, x, y, flip=1):
    """호랑가시 잎 두 장 + 열매 셋."""
    for sx in (-1, 1):
        sx *= flip
        L.poly([(x, y), (x + sx * 4, y - 3), (x + sx * 7, y - 2), (x + sx * 9, y - 5), (x + sx * 10, y - 1),
                (x + sx * 8, y + 1), (x + sx * 9, y + 4), (x + sx * 5, y + 3), (x + sx * 2, y + 4)], GRN)
        L.line([(x + sx * 1, y + 1), (x + sx * 8, y - 1)], GRN_D)
        L.px(x + sx * 4, y - 2, GRN_L)
    for dx, dy in ((-2, -2), (2, -2), (0, 1)):
        L.ell(x + dx - 2, y + dy - 2, x + dx + 2, y + dy + 2, RED)
        L.px(x + dx - 1, y + dy - 1, RED_L)


def bell(L, x, y, r=4):
    """금색 방울."""
    L.ell(x - r, y - r, x + r, y + r, GOLD)
    L.ell(x - r + 2, y - r + 2, x + r, y + r, GOLD_D)
    L.ell(x - r, y - r, x + r - 2, y + r - 2, GOLD)
    L.px(x - r + 2, y - r + 2, GOLD_L)
    L.px(x - r + 3, y - r + 2, GOLD_L)
    L.line([(x - r + 2, y + 1), (x + r - 2, y + 1)], GOLD_DD)
    L.ell(x - 1, y + 1, x + 1, y + 3, GOLD_DD)


# ── 모자·머리띠 ───────────────────────────────────────────────────────────────

def santa_hat(L, cx, by, w):
    l, r = cx - w // 2, cx + w // 2
    body = [(l + 2, by + 4), (l + 5, by - 10), (l + 12, by - 26), (cx - 6, by - 38), (cx + 8, by - 43), (cx + 22, by - 40),
            (r + 2, by - 28), (r + 14, by - 12), (r + 22, by - 2), (r + 12, by - 4), (r + 2, by - 12), (r - 2, by + 4)]
    L.poly(body, RED)
    L.poly([(cx + 8, by - 43), (cx + 22, by - 40), (r + 2, by - 28), (r + 14, by - 12), (r + 22, by - 2), (r + 12, by - 4),
            (r + 2, by - 12), (r - 2, by + 4), (cx + 14, by + 4), (cx + 12, by - 18)], RED_D)
    L.line([(cx + 12, by - 18), (r + 4, by - 14), (r + 14, by - 6)], RED_DD, 2)  # 접힌 주름
    L.poly([(l + 8, by - 6), (l + 13, by - 20), (cx - 8, by - 33), (cx - 5, by - 29), (l + 15, by - 14), (l + 11, by)], RED_L)
    L.line([(cx - 2, by - 38), (cx + 6, by - 40)], RED_L)
    # 방울
    px, py = r + 21, by + 2
    L.ell(px - 8, py - 8, px + 8, py + 8, WHT)
    L.ell(px - 4, py - 3, px + 8, py + 8, WHT_D)
    L.ell(px - 7, py - 7, px + 4, py + 4, WHT)
    L.px(px - 4, py - 4, C(255, 255, 255))
    L.px(px + 5, py + 5, WHT_DD)
    fur(L, l - 3, by - 2, r + 3, by + 13, 4)
    holly(L, l + 8, by + 1)


def elf_hat(L, cx, by, w):
    l, r = cx - w // 2, cx + w // 2
    cone = [(l + 2, by + 2), (l + 6, by - 12), (l + 2, by - 26), (l - 8, by - 38), (l - 18, by - 46), (l - 8, by - 42),
            (l + 8, by - 32), (cx - 2, by - 22), (cx + 12, by - 10), (r - 2, by + 2)]
    L.poly(cone, GRN)
    L.poly([(cx - 2, by - 22), (cx + 12, by - 10), (r - 2, by + 2), (cx + 6, by + 2), (cx - 4, by - 12)], GRN_D)
    L.poly([(l + 6, by - 10), (l + 3, by - 24), (l - 6, by - 36), (l - 2, by - 35), (l + 7, by - 25), (l + 10, by - 10)], GRN_L)
    L.line([(l + 4, by - 26), (cx - 4, by - 14)], GRN_DD)  # 천 주름
    bell(L, l - 21, by - 48, 5)
    # 금색 띠 + 초록 마름모 무늬
    L.rect(l - 3, by - 2, r + 3, by + 11, GOLD)
    L.rect(l - 3, by + 8, r + 3, by + 11, GOLD_D)
    L.line([(l - 3, by - 1), (r + 3, by - 1)], GOLD_L)
    for x in range(l + 2, r, 9):
        L.poly([(x, by + 4), (x + 3, by + 1), (x + 6, by + 4), (x + 3, by + 7)], GRN_D)
        L.px(x + 3, by + 3, GRN_L)
    holly(L, r - 6, by, -1)


def elf_ears(L, left_x, right_x, top_y, skin, skin_d):
    """뾰족한 엘프 귀(원래 귀 위에)."""
    for side, x in ((-1, left_x), (1, right_x)):
        L.poly([(x, top_y + 2), (x + side * 11, top_y - 12), (x + side * 9, top_y - 6), (x + side * 4, top_y + 6), (x, top_y + 14)], skin)
        L.line([(x + side * 1, top_y + 4), (x + side * 8, top_y - 7)], skin_d)
        L.px(x + side * 9, top_y - 10, skin_d)


def beanie(L, cx, by, w):
    l, r = cx - w // 2, cx + w // 2
    a, b, cy = (r - l) / 2, 20, by - 12  # 돔(타원) 반지름·중심. 아래 끝(by+8)은 접은 단(by-2~by+13) 뒤로 숨는다
    def top(x):
        t = max(0.0, 1 - ((x - cx) / a) ** 2)
        return cy - b * math.sqrt(t)
    L.ell(l, cy - b, r, cy + b, RED)
    for x in range(l + 1, r):  # 오른쪽 그늘 + 니트 골
        y0 = round(top(x)) + 1
        if x > cx + 8:
            L.line([(x, y0), (x, by)], RED_D)
        if (x - l) % 4 == 0:
            L.line([(x, y0 + 2), (x, by)], RED_DD if x > cx + 8 else RED_D)
    for y in range(by - 22, by - 2, 5):  # 꽈배기 무늬
        L.line([(cx - 2, y), (cx + 2, y + 3)], RED_L)
        L.line([(cx + 2, y), (cx - 2, y + 3)], RED_DD)
    L.line([(l + 7, by - 12), (l + 13, by - 22), (cx - 8, by - 27)], RED_L)
    # 접은 단: 빨강 바탕 + 흰 지그재그·눈송이 무늬
    L.rect(l - 3, by - 2, r + 3, by + 13, RED_D)
    for x in range(l - 2, r + 3):
        y = by + 2 + (abs((x % 6) - 3) if True else 0)
        L.px(x, y, WHT)
        L.px(x, by + 10 - abs((x % 6) - 3), WHT_D)
    for x in range(l + 4, r - 2, 12):
        for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            L.px(x + dx, by + 6 + dy, WHT)
    L.line([(l - 3, by + 13), (r + 3, by + 13)], RED_DD)
    # 털 방울
    for dx, dy, rr in ((0, -34, 7), (-5, -31, 5), (5, -31, 5), (0, -39, 5), (-4, -37, 4), (4, -37, 4)):
        L.ell(cx + dx - rr, by + dy - rr, cx + dx + rr, by + dy + rr, WHT)
    L.ell(cx - 1, by - 34, cx + 7, by - 27, WHT_D)
    L.px(cx - 3, by - 38, C(255, 255, 255))
    L.px(cx + 5, by - 29, WHT_DD)


def antlers(L, cx, ty, w, nose):
    l, r = cx - w // 2, cx + w // 2
    # 사슴 귀
    for side, x in ((-1, l + 4), (1, r - 4)):
        L.poly([(x, ty + 12), (x + side * 12, ty + 4), (x + side * 14, ty + 8), (x + side * 6, ty + 16)], BRN)
        L.poly([(x + side * 2, ty + 12), (x + side * 10, ty + 7), (x + side * 7, ty + 12)], PINK)
    # 뿔
    for side in (-1, 1):
        bx = cx + side * int(w * 0.24)
        main = [(bx, ty + 4), (bx + side * 4, ty - 10), (bx + side * 10, ty - 26), (bx + side * 18, ty - 42)]
        L.stroke(main, BRN, 2.6)
        L.stroke([(bx + side * 6, ty - 14), (bx + side * 16, ty - 18), (bx + side * 24, ty - 26)], BRN, 2)
        L.stroke([(bx + side * 10, ty - 27), (bx + side * 4, ty - 38), (bx + side * 2, ty - 48)], BRN, 1.8)
        L.stroke([(bx + side * 14, ty - 34), (bx + side * 22, ty - 40)], BRN, 1.5)
        # 밝은 면·어두운 면
        L.line([(bx - side * 1, ty + 2), (bx + side * 3, ty - 10), (bx + side * 9, ty - 26), (bx + side * 16, ty - 41)], BRN_L)
        L.line([(bx + side * 3, ty + 4), (bx + side * 7, ty - 8), (bx + side * 13, ty - 24)], BRN_D)
        bell(L, bx + side * 24, ty - 21, 3)  # 가지 끝 작은 방울
    # 머리띠(벨벳 빨강)
    band = [(l + 1, ty + 24), (l + 5, ty + 12), (l + 14, ty + 4), (cx, ty + 1), (r - 14, ty + 4), (r - 5, ty + 12), (r - 1, ty + 24)]
    L.stroke(band, RED_D, 2)
    L.line(band[1:-1], RED_L)
    holly(L, cx - int(w * 0.24) - 2, ty + 6)
    # 루돌프 코(빛은 GLOW에 따로 그려 테두리가 생기지 않게)
    nx, ny = nose
    GLOW.append((nx, ny))
    L.ell(nx - 4, ny - 4, nx + 4, ny + 4, RED)
    L.ell(nx - 1, ny - 1, nx + 4, ny + 4, RED_D)
    L.ell(nx - 4, ny - 4, nx + 2, ny + 2, C(226, 58, 64))
    L.px(nx - 2, ny - 2, C(255, 225, 225))
    L.px(nx - 1, ny - 3, RED_L)


# ── 목도리 ───────────────────────────────────────────────────────────────────

def scarf(L, cx, ny, w, main, main_d, stripe, side):
    l, r = cx - w // 2, cx + w // 2
    wrap = [(l, ny), (cx, ny + 5), (r, ny), (r + 2, ny + 11), (cx, ny + 18), (l - 2, ny + 11)]
    base = Layer(L.im.size)
    base.poly(wrap, main)
    tx = cx + side * int(w * 0.2)
    tail = [(tx - 7, ny + 12), (tx + 7, ny + 12), (tx + side * 9 + 7, ny + 54), (tx + side * 9 - 7, ny + 56)]
    base.poly(tail, main)
    pattern = Layer(L.im.size)
    for x in range(l - 2, r + 3, 9):  # 감은 부분: 세로 줄무늬
        pattern.rect(x, ny - 1, x + 3, ny + 19, stripe)
    for k in range(4):  # 늘어진 끝: 가로 줄무늬
        y = ny + 22 + k * 8
        pattern.rect(tx - 12, y, tx + 16, y + 3, stripe)
    shade = Layer(L.im.size)
    shade.poly([(cx, ny + 11), (r + 2, ny + 7), (r + 2, ny + 11), (cx, ny + 18), (l - 2, ny + 11), (l - 2, ny + 8)], main_d)
    for x in range(l, r, 2):  # 니트 결
        shade.px(x, ny + 4 + (x % 4 == 0), main_d)
    shade.line([(tx + side * 5, ny + 14), (tx + side * 9 + side * 5, ny + 54)], main_d, 2)
    img = base.im.copy()
    img.alpha_composite(clip_to(pattern.im, base.im))
    img.alpha_composite(clip_to(shade.im, base.im))
    knot = Layer(L.im.size)
    knot.ell(tx - 7, ny + 6, tx + 7, ny + 19, main_d)
    knot.ell(tx - 5, ny + 7, tx + 4, ny + 15, main)
    img.alpha_composite(knot.im)
    fringe = Layer(L.im.size)
    fx = tx + side * 9
    for k in range(5):
        fringe.rect(fx - 7 + k * 3, ny + 55, fx - 6 + k * 3, ny + 60, stripe)
    img.alpha_composite(fringe.im)
    L.im.alpha_composite(img)


# ── 손에 든 소품 ────────────────────────────────────────────────────────────────

def candy_cane(L, x, y_top, y_bot):
    m = Layer(L.im.size)
    m.stroke([(x, y_bot), (x, y_top + 8)], WHT, 2.5)
    arc = [(x + 7 - 7 * math.cos(t), y_top + 8 - 7 * math.sin(t)) for t in [i * math.pi / 12 for i in range(13)]]
    m.stroke(arc + [(x + 14, y_top + 13)], WHT, 2.5)
    im = m.im
    px = im.load()
    for yy in range(im.height):  # 빨강 사선 줄무늬 + 오른쪽 음영
        for xx in range(im.width):
            if px[xx, yy][3]:
                red = ((xx + yy) // 4) % 2 == 0
                c = RED if red else WHT
                if px[xx + 1, yy][3] == 0 if xx + 1 < im.width else True:
                    c = RED_D if red else WHT_D
                px[xx, yy] = c
    L.im.alpha_composite(im)


def gift_box(L, x0, y0, x1, y1):
    cx0 = (x0 + x1) // 2
    L.stroke([(cx0 - 2, y0 - 2), (cx0 - 1, y0 - 14)], GOLD, 1)  # 손에 쥔 리본 고리
    L.stroke([(cx0 + 2, y0 - 2), (cx0 + 1, y0 - 14)], GOLD_D, 1)
    L.rect(x0, y0, x1, y1, GRN)
    L.rect(x1 - 5, y0, x1, y1, GRN_D)
    L.rect(x0, y0, x1, y0 + 4, GRN_L)
    cx = (x0 + x1) // 2
    L.rect(cx - 2, y0, cx + 1, y1, GOLD)
    L.rect(x0, (y0 + y1) // 2 - 1, x1, (y0 + y1) // 2 + 2, GOLD)
    L.line([(cx + 1, y0), (cx + 1, y1)], GOLD_D)
    L.line([(x0, (y0 + y1) // 2 + 2), (x1, (y0 + y1) // 2 + 2)], GOLD_D)
    for sx in (-1, 1):  # 리본 고리
        L.ell(cx + (sx < 0) * -9, y0 - 8, cx + (sx > 0) * 9, y0 + 1, GOLD)
        L.ell(cx + (sx < 0) * -6, y0 - 5, cx + (sx > 0) * 6, y0 - 1, GOLD_D)
    L.ell(cx - 2, y0 - 3, cx + 2, y0 + 1, GOLD_L)


def cocoa_mug(L, x0, y0, x1, y1):
    # 김
    steam = Layer(L.im.size)
    for k, sx in enumerate((x0 + 4, x0 + 10)):
        pts = [(sx + 2 * math.sin(t / 3 + k), y0 - 3 - t) for t in range(0, 18)]
        for (ax, ay) in pts:
            steam.px(round(ax), round(ay), C(255, 255, 255, a=150))
    L.im.alpha_composite(steam.im)
    # 손잡이(오른쪽, 손이 쥔다)
    L.stroke([(x1, y0 + 4), (x1 + 6, y0 + 5), (x1 + 7, y0 + 11), (x1 + 6, y0 + 16), (x1, y1 - 4)], WHT, 1.6)
    L.rect(x0, y0, x1, y1, WHT)
    L.rect(x1 - 4, y0, x1, y1, WHT_D)
    L.rect(x0, y0 + 7, x1, y0 + 12, RED)
    L.rect(x1 - 4, y0 + 7, x1, y0 + 12, RED_D)
    for xx in range(x0 + 2, x1 - 2, 5):
        L.px(xx, y0 + 9, WHT)
    L.ell(x0, y0 - 2, x1, y0 + 3, COCOA)
    L.ell(x0 + 2, y0 - 1, x1 - 2, y0 + 2, COCOA_D)
    L.rect(x0 + 3, y0 - 2, x0 + 5, y0, WHT)  # 마시멜로
    L.rect(x0 + 8, y0 - 1, x0 + 10, y0 + 1, WHT)


def gift_sack(L, x, y_neck, h):
    # 끈(손에 쥔 부분)
    L.stroke([(x - 1, y_neck - 14), (x, y_neck)], GOLD, 1.2)
    L.stroke([(x + 2, y_neck - 14), (x + 2, y_neck)], GOLD_D, 1)
    # 자루
    body = [(x - 4, y_neck), (x + 5, y_neck), (x + 14, y_neck + 10), (x + 17, y_neck + h - 10), (x + 10, y_neck + h),
            (x - 9, y_neck + h), (x - 15, y_neck + h - 10), (x - 13, y_neck + 10)]
    L.poly(body, RED)
    L.poly([(x + 5, y_neck), (x + 14, y_neck + 10), (x + 17, y_neck + h - 10), (x + 10, y_neck + h), (x + 2, y_neck + h), (x + 6, y_neck + 12)], RED_D)
    L.poly([(x - 4, y_neck + 4), (x - 10, y_neck + 14), (x - 12, y_neck + 26), (x - 8, y_neck + 14)], RED_L)
    for sx, sy in ((-6, 18), (6, 26), (-2, 34), (8, 12)):  # 금색 별
        for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            L.px(x + sx + dx, y_neck + sy + dy, GOLD)
        L.px(x + sx, y_neck + sy, GOLD_L)
    L.rect(x - 5, y_neck - 1, x + 6, y_neck + 2, GOLD)  # 묶은 끈
    L.line([(x - 5, y_neck + 2), (x + 6, y_neck + 2)], GOLD_D)


# ── 사람별 구성 ───────────────────────────────────────────────────────────────

def skin_of(src, box):
    px = [src.getpixel((x, y)) for x in range(box[0], box[2]) for y in range(box[1], box[3])]
    px = sorted(p for p in px if p[3] > 0)
    r, g, b, _ = px[len(px) // 2]
    return C(r, g, b), C(int(r * 0.78), int(g * 0.7), int(b * 0.68))


def hand_mask(src, box):
    """원본에서 손(피부색) 픽셀만 골라 덮을 레이어."""
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    for x in range(box[0], box[2]):
        for y in range(box[1], box[3]):
            r, g, b, a = src.getpixel((x, y))
            if a > 0 and r > 130 and r > g > b and r - b > 28:
                out.putpixel((x, y), (r, g, b, a))
    return out


SPECS = {
    1: dict(name="rudolph", label="루돌프",
            head=lambda L, s: antlers(L, 73, 2, 56, (73, 57)),
            scarf=(73, 82, 46, RED, RED_D, WHT, -1),
            prop=lambda L: candy_cane(L, 15, 250, 320), hand=(3, 258, 28, 300)),
    2: dict(name="elf", label="엘프",
            head=lambda L, s: (elf_ears(L, 49, 101, 42, *s), elf_hat(L, 75, 14, 60)),
            scarf=(75, 82, 46, RED, RED_D, GRN, 1),
            prop=lambda L: gift_box(L, 2, 297, 28, 318), hand=(3, 258, 28, 300)),
    3: dict(name="beanie", label="털모자",
            head=lambda L, s: beanie(L, 73, 18, 66),
            scarf=(72, 86, 52, GRN, GRN_D, WHT, 1),
            prop=lambda L: cocoa_mug(L, -14, 276, 2, 296), hand=(0, 256, 24, 302)),
    4: dict(name="santa", label="산타",
            head=lambda L, s: santa_hat(L, 75, 14, 60),
            scarf=(74, 82, 46, GRN, GRN_D, RED, -1),
            prop=lambda L: gift_sack(L, 15, 292, 38), hand=(3, 258, 28, 300)),
}

results = {}
for k, spec in SPECS.items():
    src = Image.open(f"{SRC}/boss{k}.png").convert("RGBA")
    W, H = src.width + OX + 30, src.height + OY
    base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    base.alpha_composite(src, (OX, OY))
    skin = skin_of(src, (65, 58, 85, 66))

    # 목도리 → 소품 → 손 다시 덮기 → 머리 장식 순서(머리 장식이 맨 위)
    sc = Layer((W, H)); scarf(sc, *spec["scarf"]); base.alpha_composite(outlined(sc))
    pr = Layer((W, H)); spec["prop"](pr); base.alpha_composite(outlined(pr))
    hb = spec["hand"]
    base.alpha_composite(hand_mask(src, hb), (OX, OY))
    hd = Layer((W, H)); spec["head"](hd, skin)
    if k == 2:  # 엘프 귀는 피부색 테두리, 모자는 잉크 테두리
        ears = Layer((W, H)); elf_ears(ears, 49, 101, 42, *skin)
        base.alpha_composite(outlined(ears, skin[1]))
        hat = Layer((W, H)); elf_hat(hat, 75, 14, 60); base.alpha_composite(outlined(hat))
    else:
        base.alpha_composite(outlined(hd))

    if GLOW:
        g = Layer((W, H))
        for nx, ny in GLOW:
            for rr, a in ((9, 26), (7, 40)):
                g.ell(nx - rr, ny - rr, nx + rr, ny + rr, C(255, 70, 70, a=a))
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        glow.alpha_composite(g.im)
        # 코 자리는 비우고 둘레만 빛나게
        hole = Layer((W, H)); hole.ell(GLOW[0][0] - 5, GLOW[0][1] - 5, GLOW[0][0] + 5, GLOW[0][1] + 5, (0, 0, 0, 255))
        glow.paste((0, 0, 0, 0), mask=hole.im.split()[3])
        base.alpha_composite(glow)
        GLOW.clear()

    # 좌우 빈 여백을 잘라 낸다(높이는 그대로: 로그인 화면이 높이로 맞춘다)
    bbox = base.getbbox()
    x0, x1 = max(0, bbox[0] - 1), min(W, bbox[2] + 1)
    final = base.crop((x0, 0, x1, H))
    final.save(f"{OUT}/leader{k}.png", optimize=True)
    results[k] = final
    print(f"leader{k}.png {final.size} ({spec['label']})")
