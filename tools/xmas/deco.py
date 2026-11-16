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

# 모자는 머리 실루엣에 맞춘다: 띠(챙) 폭과 가운데는 띠 윗줄의 머리 폭으로, 모자 안쪽 높이는 머리카락을 덮을 만큼만.
# 챙은 머리를 감싸듯 가운데가 살짝 내려간 곡선, 긴 머리는 띠 아래로 흘러나온다.

def head_profile(src):
    """머리 쪽 실루엣: y별 (왼쪽 x, 오른쪽 x), 원본 좌표."""
    a = src.split()[3]
    prof = {}
    for y in range(0, 60):
        xs = [x for x in range(30, min(src.width, 126)) if a.getpixel((x, y)) > 0]
        if xs:
            prof[y] = (xs[0], xs[-1])
    return prof


class Fit:
    """모자 자리. top·bottom = 띠의 윗줄·아랫줄(양 끝 기준), cx·w = 가운데·폭, dome = 머리카락을 덮는 모자 안쪽 높이."""

    def __init__(self, prof, top, bottom, overhang=2, margin=2):
        self.top, self.bottom = top, bottom
        xl, xr = prof[top]
        self.cx = (xl + xr) / 2
        self.w = (xr - xl + 1) + overhang * 2
        self.l, self.r = self.cx - self.w / 2, self.cx + self.w / 2
        a = self.w / 2 - 1
        need = 0
        for y, (x0, x1) in prof.items():
            if y >= top:
                continue
            for x in (x0, x1):
                t = max(0.05, 1 - ((x - self.cx) / a) ** 2)
                need = max(need, (top - y) / math.sqrt(t))
        self.dome = need + margin

    def curve(self, x, depth=2):
        """챙 곡선: 가운데가 depth만큼 내려간 U자. x 위치에서 더할 y."""
        u = (x - self.cx) / (self.w / 2)
        return round(depth * max(0.0, 1 - u * u))

    def dome_pts(self, b=None, inset=1):
        """띠 윗줄 위의 반타원(모자 안쪽) 점들."""
        a, b = self.w / 2 - inset, b or self.dome
        pts = [(self.cx + a * math.cos(t), self.top + 1 - b * math.sin(t)) for t in [i * math.pi / 32 for i in range(33)]]
        return pts


def band(L, f, top_off, bot_off, fill):
    """챙 곡선을 따라 띠 한 줄을 칠한다(top_off·bot_off는 f.top 기준)."""
    for x in range(math.floor(f.l), math.ceil(f.r) + 1):
        c = f.curve(x)
        L.line([(x, f.top + top_off + c), (x, f.top + bot_off + c)], fill)


def contact_shadow(base, f):
    """모자 아래 머리·이마에 얇은 그림자(머리에 얹힌 느낌)."""
    px = base.load()
    for x in range(math.floor(f.l) + 1, math.ceil(f.r)):
        y = f.bottom + f.curve(x) + 2
        for dy, a in ((0, 70), (1, 34)):
            X, Y = x + OX, y + dy + OY
            if 0 <= X < base.width and 0 <= Y < base.height and px[X, Y][3] > 0:
                r, g, b, al = px[X, Y]
                k = 1 - a / 255
                px[X, Y] = (int(r * k), int(g * k), int(b * k), al)


def beanie(L, f):
    cx, top = f.cx, f.top
    b = max(f.dome, 10)
    L.poly(f.dome_pts(b), RED)
    a = f.w / 2 - 1
    for x in range(math.floor(f.l) + 1, math.ceil(f.r)):  # 오른쪽 그늘 + 니트 골
        t = max(0.0, 1 - ((x - cx) / a) ** 2)
        y0 = round(top + 1 - b * math.sqrt(t)) + 1
        if x > cx + 6:
            L.line([(x, y0), (x, top + 1)], RED_D)
        if (x - math.floor(f.l)) % 4 == 0 and y0 < top:
            L.line([(x, y0 + 1), (x, top + 1)], RED_DD if x > cx + 6 else RED_D)
    for y in range(round(top - b + 6), top - 1, 5):  # 꽈배기 무늬
        L.line([(cx - 2, y), (cx + 2, y + 3)], RED_L)
        L.line([(cx + 2, y), (cx - 2, y + 3)], RED_DD)
    L.line([(f.l + 6, top - b * 0.35), (f.l + 11, top - b * 0.7), (cx - 7, top - b * 0.93)], RED_L)
    # 접은 단: 곡선을 따라
    band(L, f, 0, f.bottom - top, RED_D)
    for x in range(math.floor(f.l), math.ceil(f.r) + 1):
        c = f.curve(x)
        L.px(x, top + 2 + abs((x % 6) - 3) // 2 + c, WHT)
        L.px(x, f.bottom - 2 - abs((x % 6) - 3) // 2 + c, WHT_D)
        L.px(x, f.bottom + c, RED_DD)
    for x in range(math.floor(f.l) + 5, math.ceil(f.r) - 3, 11):
        y = (top + f.bottom) // 2 + f.curve(x)
        for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            L.px(x + dx, y + dy, WHT)
    # 털 방울(작게)
    py = top - b - 3
    for dx, dy, rr in ((0, 0, 5), (-3, 2, 3), (3, 2, 3), (0, -3, 3)):
        L.ell(cx + dx - rr, py + dy - rr, cx + dx + rr, py + dy + rr, WHT)
    L.ell(cx, py - 1, cx + 5, py + 4, WHT_D)
    L.px(cx - 2, py - 3, C(255, 255, 255))
    return f


def santa_hat(L, f):
    cx, top, l, r = f.cx, f.top, f.l, f.r
    b = max(f.dome, 10)
    L.poly(f.dome_pts(b), RED)
    # 오른쪽으로 접혀 늘어진 끝
    tip = (r + 11, top + 1)
    flop = [(cx - 6, top - b + 2), (cx, top - b - 7), (cx + 8, top - b - 12), (cx + 16, top - b - 11), (r, top - b * 0.5 - 3),
            (r + 9, top - b * 0.15), (tip[0] + 2, tip[1] - 2), (tip[0] - 4, tip[1] + 1), (r + 1, top - b * 0.05), (r - 4, top - b * 0.3)]
    L.poly(flop, RED)
    L.poly([(cx + 8, top - b - 12), (cx + 16, top - b - 11), (r, top - b * 0.5 - 3), (r + 9, top - b * 0.15), (tip[0] + 2, tip[1] - 2),
            (tip[0] - 4, tip[1] + 1), (r + 1, top - b * 0.05), (r - 4, top - b * 0.3), (cx + 10, top - b * 0.55), (cx + 6, top - b - 6)], RED_D)
    L.line([(cx + 6, top - b - 6), (cx + 10, top - b * 0.55), (r - 3, top - b * 0.28), (r + 2, top - b * 0.05)], RED_DD)  # 접힌 주름
    a = f.w / 2 - 1
    for x in range(math.floor(cx) + 6, math.ceil(r)):  # 안쪽 오른쪽 그늘
        t = max(0.0, 1 - ((x - cx) / a) ** 2)
        y0 = round(top + 1 - b * math.sqrt(t)) + 1
        L.line([(x, max(y0, top - b * 0.3)), (x, top + 1)], RED_D)
    L.line([(l + 5, top - b * 0.3), (l + 10, top - b * 0.68), (cx - 5, top - b * 0.96), (cx, top - b - 5)], RED_L)
    # 방울
    px, py = tip
    L.ell(px - 6, py - 6, px + 6, py + 6, WHT)
    L.ell(px - 2, py - 2, px + 6, py + 6, WHT_D)
    L.ell(px - 5, py - 5, px + 3, py + 3, WHT)
    L.px(px - 3, py - 3, C(255, 255, 255))
    # 털 테두리: 곡선을 따라
    rnd = random.Random(4)
    band(L, f, -1, f.bottom - top, WHT)
    for x in range(math.floor(l), math.ceil(r) + 1, 4):
        c = f.curve(x)
        L.ell(x - 2, top - 2 + c, x + 3, top + 2 + c, WHT)
        L.ell(x - 2, f.bottom - 2 + c, x + 3, f.bottom + 2 + c, WHT)
    for x in range(math.floor(l), math.ceil(r) + 1):
        c = f.curve(x)
        for y in range((top + f.bottom) // 2 + c, f.bottom + c + 1):
            if rnd.random() < 0.2:
                L.px(x, y, WHT_D)
        if rnd.random() < 0.3:
            L.px(x, f.bottom - 1 + c, WHT_DD)
    holly(L, l + 7, top + 1 + f.curve(l + 7))
    return f


def elf_hat(L, f):
    cx, top, l, r = f.cx, f.top, f.l, f.r
    b = max(f.dome, 10)
    L.poly(f.dome_pts(b), GRN)
    tip = (l - 10, top - b - 17)
    cone = [(l + 2, top - b * 0.45), (l + 4, top - b * 0.85), (l - 2, top - b - 6), (tip[0], tip[1]),
            (l + 8, top - b - 10), (cx - 2, top - b - 3), (cx + 6, top - b * 0.9)]
    L.poly(cone, GRN)
    a = f.w / 2 - 1
    for x in range(math.floor(cx) + 4, math.ceil(r)):  # 오른쪽 그늘
        t = max(0.0, 1 - ((x - cx) / a) ** 2)
        y0 = round(top + 1 - b * math.sqrt(t)) + 1
        L.line([(x, y0), (x, top + 1)], GRN_D)
    L.poly([(l + 1, top - b * 0.8), (l - 2, top - b - 4), (tip[0] + 2, tip[1] + 2), (l + 3, top - b * 0.75)], GRN_L)
    L.line([(l + 5, top - b * 0.75), (cx - 2, top - b * 0.5)], GRN_DD)  # 천 주름
    bell(L, tip[0] - 2, tip[1] - 2, 4)
    # 금색 띠 + 초록 마름모 무늬, 곡선을 따라
    band(L, f, -1, f.bottom - top, GOLD)
    for x in range(math.floor(l), math.ceil(r) + 1):
        c = f.curve(x)
        L.px(x, top - 1 + c, GOLD_L)
        L.px(x, f.bottom + c, GOLD_D)
        L.px(x, f.bottom - 1 + c, GOLD_D)
    for x in range(math.floor(l) + 3, math.ceil(r) - 4, 8):
        y = (top + f.bottom) // 2 + f.curve(x + 3)
        L.poly([(x, y), (x + 3, y - 3), (x + 6, y), (x + 3, y + 3)], GRN_D)
        L.px(x + 3, y - 1, GRN_L)
    holly(L, r - 6, top + f.curve(r - 6), -1)
    return f


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
    1: dict(name="santa", label="산타",
            head=lambda L, s, p: santa_hat(L, Fit(p, 12, 23)),
            scarf=(73, 82, 46, RED, RED_D, WHT, -1),
            prop=lambda L: candy_cane(L, 15, 250, 320), hand=(3, 258, 28, 300)),
    2: dict(name="elf", label="엘프",
            head=lambda L, s, p: elf_hat(L, Fit(p, 12, 21)),
            scarf=(75, 82, 46, RED, RED_D, GRN, 1),
            prop=lambda L: gift_box(L, 2, 297, 28, 318), hand=(3, 258, 28, 300)),
    3: dict(name="rudolph", label="루돌프",
            head=lambda L, s, p: antlers(L, 73, 2, 60, (73, 58)),
            scarf=(72, 86, 52, GRN, GRN_D, WHT, 1),
            prop=lambda L: cocoa_mug(L, -14, 276, 2, 296), hand=(0, 256, 24, 302)),
    4: dict(name="santa", label="산타",
            head=lambda L, s, p: santa_hat(L, Fit(p, 12, 23)),
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
    prof = head_profile(src)
    hd = Layer((W, H))
    fit = spec["head"](hd, skin, prof)
    base.alpha_composite(outlined(hd))
    if isinstance(fit, Fit):
        contact_shadow(base, fit)

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
