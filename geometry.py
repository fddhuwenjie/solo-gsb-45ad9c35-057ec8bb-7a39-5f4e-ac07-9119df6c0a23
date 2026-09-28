"""投影机选位几何计算核心。

坐标约定（顶视图）：房间左上角为原点，x 轴向右，y 轴由幕布墙指向后墙，单位米。
幕布安装在 y=0 的前墙上，中心 x 坐标为 screen["cx"]。
投影机镜头位置记为 (px, py)，镜头位于机身前表面中央，
因此机身占据矩形 [px-bw/2, px+bw/2] × [py, py+bd]。

每个镜头方案的可安装区域 = 以下约束的交集：
  1. 投射距离：py ∈ [tr_min*Sw, tr_max*Sw]
  2. 镜头水平位移：px ∈ [cx-hs, cx+hs]
  3. 墙面余量：机身矩形不得越出四墙内缩 margin 的范围
  4. 机身避障：机身矩形不得与任何禁装区相交
交集为空时给出导致为空的约束诊断。

注意：水平位移为 0（且镜头恰好固定在幕布中心）时，交集退化为
「固定 x、长度 > 0 的安装线（纵深线段）」。线段面积为 0 但仍是可行域：
仅命中该 x 的禁装区（按机身尺寸膨胀后）投影为纵深区间并从线段扣除，
边界接触不阻挡；线段被完全覆盖才判定避障无解。
"""

EPS = 1e-9


def rect_area(r):
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def rects_intersect(a, b):
    return (min(a[2], b[2]) - max(a[0], b[0]) > EPS and
            min(a[3], b[3]) - max(a[1], b[1]) > EPS)


def subtract_rect(rect, hole):
    """从 rect 中减去 hole，返回 0~4 个互不重叠的矩形（用于禁装区扣除）。"""
    x1, y1, x2, y2 = rect
    hx1, hy1, hx2, hy2 = hole
    ix1, iy1 = max(x1, hx1), max(y1, hy1)
    ix2, iy2 = min(x2, hx2), min(y2, hy2)
    if ix1 >= ix2 - EPS or iy1 >= iy2 - EPS:
        return [list(rect)]
    out = []
    if ix1 - x1 > EPS:
        out.append([x1, y1, ix1, y2])          # 左条
    if x2 - ix2 > EPS:
        out.append([ix2, y1, x2, y2])          # 右条
    if iy1 - y1 > EPS:
        out.append([ix1, y1, ix2, iy1])        # 上条
    if y2 - iy2 > EPS:
        out.append([ix1, iy2, ix2, y2])        # 下条
    return out


def subtract_interval(iv, hole):
    """从一维区间 iv 中减去 hole，返回 0~2 个子区间（边界接触规则同 subtract_rect）。"""
    a, b = iv
    ha, hb = hole
    ia, ib = max(a, ha), min(b, hb)
    if ib - ia <= EPS:
        return [tuple(iv)]                         # 无正长度重叠（含仅边界接触）
    out = []
    if ia - a > EPS:
        out.append((a, ia))
    if b - ib > EPS:
        out.append((ib, b))
    return out


def _derive(room, screen, scheme):
    """汇总方案派生量。"""
    sw, sh = screen["width"], screen["height"]
    return {
        "W": room["width"], "D": room["depth"], "H": room["height"],
        "m": room.get("margin", 0.0),
        "Sw": sw, "Sh": sh,
        "cx": screen["cx"], "sb": screen["bottom"],
        "sc": screen["bottom"] + sh / 2.0,               # 幕布中心高度
        "bw": scheme["body_w"], "bd": scheme["body_d"], "bh": scheme["body_h"],
        "d_min": scheme["tr_min"] * sw,                  # 最近投射距离
        "d_max": scheme["tr_max"] * sw,                  # 最远投射距离
        "hs": scheme["h_shift"] * sw,                    # 水平位移半宽（米）
        "vs": scheme["v_shift"] * sh,                    # 垂直位移半高（米）
    }


def _obstacle_rect(ob):
    return [ob["x"], ob["y"], ob["x"] + ob["w"], ob["y"] + ob["h"]]


def compute_scheme(room, screen, scheme, obstacles, point=None, lens_height=None):
    """计算单个方案的可安装区域、面积、诊断与选点校验。"""
    g = _derive(room, screen, scheme)
    W, D, H, m = g["W"], g["D"], g["H"], g["m"]
    cx, hs, sc, vs = g["cx"], g["hs"], g["sc"], g["vs"]
    bw, bd, bh = g["bw"], g["bd"], g["bh"]
    d_min, d_max = g["d_min"], g["d_max"]

    diags = []

    # ---- 各约束区间 ----
    wall_x = (m + bw / 2, W - m - bw / 2)     # 墙面余量（水平，机身不越界）
    shift_x = (cx - hs, cx + hs)              # 镜头水平位移
    wall_y = (m, D - m - bd)                  # 墙面余量（纵深，机身在镜头后方）
    throw_y = (d_min, d_max)                  # 投射距离
    fit_z = (bh / 2, H - bh / 2)              # 机身不穿出地板/天花板
    shift_z = (sc - vs, sc + vs)              # 镜头垂直位移

    x_rng = (max(wall_x[0], shift_x[0]), min(wall_x[1], shift_x[1]))
    y_rng = (max(wall_y[0], throw_y[0]), min(wall_y[1], throw_y[1]))
    z_rng = (max(fit_z[0], shift_z[0]), min(fit_z[1], shift_z[1]))

    x_ok = x_rng[1] - x_rng[0] > -EPS
    y_ok = y_rng[1] - y_rng[0] > -EPS
    z_ok = z_rng[1] - z_rng[0] > -EPS

    # ---- 交集为空时定位元凶约束 ----
    if not x_ok:
        if wall_x[1] < wall_x[0]:
            diags.append(
                f"墙面余量约束不可满足：机身宽 {bw:.2f}m + 两侧余量 {2 * m:.2f}m "
                f"超过房间宽 {W:.2f}m")
        elif shift_x[0] > wall_x[1]:
            diags.append(
                f"镜头水平位移与墙面余量冲突：幕布中心偏右（cx={cx:.2f}m），"
                f"位移仅 ±{hs:.2f}m，机身无法避开右墙余量")
        elif shift_x[1] < wall_x[0]:
            diags.append(
                f"镜头水平位移与墙面余量冲突：幕布中心偏左（cx={cx:.2f}m），"
                f"位移仅 ±{hs:.2f}m，机身无法避开左墙余量")
        else:
            diags.append("镜头水平位移范围与墙面余量范围无交集")
    if not y_ok:
        if wall_y[1] < wall_y[0]:
            diags.append(
                f"墙面余量约束不可满足：机深 {bd:.2f}m + 前后余量 {2 * m:.2f}m "
                f"超过房间进深 {D:.2f}m")
        elif throw_y[0] > wall_y[1]:
            diags.append(
                f"投射距离与墙面余量冲突：最小投射距离 {throw_y[0]:.2f}m "
                f"大于可用进深 {wall_y[1]:.2f}m（投射比过大或房间太浅）")
        elif throw_y[1] < wall_y[0]:
            diags.append(
                f"投射距离与墙面余量冲突：最大投射距离 {throw_y[1]:.2f}m "
                f"小于前墙余量 {wall_y[0]:.2f}m")
        else:
            diags.append("投射距离范围与墙面余量范围无交集")
    if not z_ok:
        if fit_z[1] < fit_z[0]:
            diags.append(f"房间净高 {H:.2f}m 容不下机身高 {bh:.2f}m")
        elif shift_z[0] > fit_z[1]:
            diags.append(
                f"镜头垂直位移与房间净高冲突：幕布中心 {sc:.2f}m 过高且向下位移 "
                f"仅 {vs:.2f}m，机身将顶到天花板")
        elif shift_z[1] < fit_z[0]:
            diags.append(
                f"镜头垂直位移与地板冲突：幕布中心 {sc:.2f}m 过低且向上位移 "
                f"仅 {vs:.2f}m，机身将触地")
        else:
            diags.append("镜头垂直位移范围与房间净高范围无交集")

    # ---- 顶视图可安装区域 = 基础矩形 − 各禁装区（按机身尺寸膨胀）----
    base_rect = None
    region = []
    area = 0.0
    line = None        # 退化可行域：固定 x 的安装线段（面积为 0、长度 > 0 即可行）
    if x_ok and y_ok:
        base_rect = [x_rng[0], y_rng[0], x_rng[1], y_rng[1]]
        y_len = y_rng[1] - y_rng[0]
        line_mode = x_rng[1] - x_rng[0] <= EPS and y_len > EPS
        if line_mode:
            # 水平位移为 0：可行域是固定 x=x0 的纵深线段（面积为 0、长度 > 0 即可行）。
            # 仅将膨胀后严格覆盖 x0 的禁装区投影为纵深区间并扣除（贴边不阻挡）。
            x0 = x_rng[0]
            intervals = [(y_rng[0], y_rng[1])]
            hits = []          # (障碍序号, 命中后的纵深区间)
            for i, ob in enumerate(obstacles):
                ex1 = ob["x"] - bw / 2
                ex2 = ob["x"] + ob["w"] + bw / 2
                if x0 <= ex1 + EPS or x0 >= ex2 - EPS:
                    continue                    # 未命中该 x：机身在水平方向不与该禁装区相交
                hy = (ob["y"] - bd, ob["y"] + ob["h"])
                hits.append((i, hy))
                nxt = []
                for iv in intervals:
                    nxt.extend(subtract_interval(iv, hy))
                intervals = nxt
            intervals = [iv for iv in intervals if iv[1] - iv[0] > EPS]
            length = sum(b - a for a, b in intervals)
            line = {"x": x0, "length": length,
                    "segments": [[a, b] for a, b in intervals]}
            region = [[x0, a, x0, b] for a, b in intervals]
            if length <= EPS:
                # 逐一移除禁装区做恢复测试，找出覆盖安装线段的元凶
                names = []
                for i, hy in hits:
                    rest = [(y_rng[0], y_rng[1])]
                    for j, hyj in hits:
                        if i == j:
                            continue
                        nxt = []
                        for iv in rest:
                            nxt.extend(subtract_interval(iv, hyj))
                        rest = nxt
                    if sum(b - a for a, b in rest) > EPS:
                        names.append(obstacles[i].get("name") or f"#{i + 1}")
                if names:
                    diags.append("机身避障约束不可满足：禁装区 " +
                                 "、".join(f"「{n}」" for n in names) +
                                 " 完全覆盖了固定 x 的安装线段")
                else:
                    diags.append("机身避障约束不可满足：多个禁装区组合完全覆盖了安装线段")
        else:
            region = [list(base_rect)]
            expanded = []
            for ob in obstacles:
                exp = [ob["x"] - bw / 2, ob["y"] - bd,
                       ob["x"] + ob["w"] + bw / 2, ob["y"] + ob["h"]]
                expanded.append(exp)
                nxt = []
                for r in region:
                    nxt.extend(subtract_rect(r, exp))
                region = nxt
            area = sum(rect_area(r) for r in region)
            if area <= EPS and rect_area(base_rect) > EPS:
                # 逐一移除禁装区做恢复测试，找出覆盖可安装区域的元凶
                names = []
                for i, ob in enumerate(obstacles):
                    if not rects_intersect(base_rect, expanded[i]):
                        continue
                    rest = [list(base_rect)]
                    for j, exp in enumerate(expanded):
                        if i == j:
                            continue
                        nxt = []
                        for r in rest:
                            nxt.extend(subtract_rect(r, exp))
                        rest = nxt
                    if sum(rect_area(r) for r in rest) > EPS:
                        names.append(ob.get("name") or f"#{i + 1}")
                if names:
                    diags.append("机身避障约束不可满足：禁装区 " +
                                 "、".join(f"「{n}」" for n in names) +
                                 " 完全覆盖了可安装区域")
                else:
                    diags.append("机身避障约束不可满足：多个禁装区组合完全覆盖了可安装区域")
            elif area <= EPS:
                diags.append("可安装区域退化为点（纵深与水平方向长度均为 0），实际无法安放机身")

    # ---- 当前选点校验 ----
    pt = None
    if point is not None:
        px, py = point["x"], point["y"]
        hz = lens_height if lens_height is not None else sc
        body = [px - bw / 2, py, px + bw / 2, py + bd]
        ob_hit = None
        for i, ob in enumerate(obstacles):
            if rects_intersect(body, _obstacle_rect(ob)):
                ob_hit = ob.get("name") or f"#{i + 1}"
                break
        checks = {
            "throw": throw_y[0] - EPS <= py <= throw_y[1] + EPS,
            "shift": shift_x[0] - EPS <= px <= shift_x[1] + EPS,
            "wall": (wall_x[0] - EPS <= px <= wall_x[1] + EPS and
                     wall_y[0] - EPS <= py and py + bd <= D - m + EPS),
            "obstacle": ob_hit is None,
            "height": bool(z_ok) and z_rng[0] - EPS <= hz <= z_rng[1] + EPS,
        }
        pt = {
            "x": px, "y": py, "z": hz,
            "ok": all(checks.values()),
            "checks": checks,
            "obstacle_hit": ob_hit,
            "throw_distance": py,
            "throw_ratio": py / g["Sw"] if g["Sw"] else 0.0,
            "h_shift_used": (px - cx) / g["Sw"] if g["Sw"] else 0.0,
            "v_shift_used": (hz - sc) / g["Sh"] if g["Sh"] else 0.0,
        }

    feasible = bool(
        x_ok and y_ok and z_ok and
        (area > EPS or (line is not None and line["length"] > EPS))
    )
    return {
        "id": scheme.get("id"),
        "name": scheme.get("name", "方案"),
        "feasible": feasible,
        "area": round(area, 4),
        "line": ({"x": round(line["x"], 4), "length": round(line["length"], 4),
                 "segments": [[round(a, 4), round(b, 4)] for a, b in line["segments"]]}
                if line is not None else None),
        "base_rect": [round(v, 4) for v in base_rect] if base_rect else None,
        "region": [[round(v, 4) for v in r] for r in region],
        "diagnostics": diags,
        "ranges": {
            "x": [round(v, 4) for v in x_rng] if x_ok else None,
            "y": [round(v, 4) for v in y_rng] if y_ok else None,
            "z": [round(v, 4) for v in z_rng] if z_ok else None,
            "throw": [round(d_min, 4), round(d_max, 4)],
            "shift_x": [round(v, 4) for v in shift_x],
            "shift_z": [round(v, 4) for v in shift_z],
        },
        "derived": {
            "d_min": round(d_min, 4), "d_max": round(d_max, 4),
            "hs": round(hs, 4), "vs": round(vs, 4), "sc": round(sc, 4),
        },
        "point": pt,
    }
