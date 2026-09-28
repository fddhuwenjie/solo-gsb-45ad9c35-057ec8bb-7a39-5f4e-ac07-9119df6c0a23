"""内置示例场景。所有尺寸单位：米；投射比无量纲；位移为幕宽/幕高的比例。"""

EXAMPLES = [
    {
        "id": "conf",
        "name": "示例 1：标准会议室 6.5×8m",
        "data": {
            "room": {"width": 6.5, "depth": 8.0, "height": 2.8, "margin": 0.3},
            "screen": {"width": 2.2, "height": 1.24, "bottom": 0.9, "cx": 3.25},
            "schemes": [
                {"name": "标准镜头 1.3–2.1", "tr_min": 1.3, "tr_max": 2.1,
                 "h_shift": 0.30, "v_shift": 0.50,
                 "body_w": 0.40, "body_d": 0.32, "body_h": 0.15},
                {"name": "短焦镜头 0.8–1.0", "tr_min": 0.8, "tr_max": 1.0,
                 "h_shift": 0.10, "v_shift": 0.20,
                 "body_w": 0.42, "body_d": 0.35, "body_h": 0.16},
                {"name": "长焦镜头 2.0–3.2", "tr_min": 2.0, "tr_max": 3.2,
                 "h_shift": 0.50, "v_shift": 0.60,
                 "body_w": 0.45, "body_d": 0.38, "body_h": 0.18},
                {"name": "定焦镜头 1.3–2.1（水平位移 0，安装线）",
                 "tr_min": 1.3, "tr_max": 2.1,
                 "h_shift": 0.0, "v_shift": 0.50,
                 "body_w": 0.40, "body_d": 0.32, "body_h": 0.15},
            ],
            "obstacles": [
                {"name": "吊灯", "x": 2.65, "y": 3.4, "w": 1.2, "h": 0.8},
                {"name": "横梁", "x": 0.0, "y": 5.2, "w": 6.5, "h": 0.4},
                {"name": "空调柜机", "x": 5.6, "y": 0.3, "w": 0.6, "h": 0.6},
            ],
        },
    },
    {
        "id": "training",
        "name": "示例 2：小型培训室 5×6m",
        "data": {
            "room": {"width": 5.0, "depth": 6.0, "height": 2.6, "margin": 0.25},
            "screen": {"width": 1.8, "height": 1.01, "bottom": 0.95, "cx": 2.5},
            "schemes": [
                {"name": "超短焦 0.4–0.5", "tr_min": 0.4, "tr_max": 0.5,
                 "h_shift": 0.05, "v_shift": 0.10,
                 "body_w": 0.38, "body_d": 0.30, "body_h": 0.12},
                {"name": "标准镜头 1.4–2.2", "tr_min": 1.4, "tr_max": 2.2,
                 "h_shift": 0.25, "v_shift": 0.45,
                 "body_w": 0.36, "body_d": 0.28, "body_h": 0.13},
                {"name": "长焦镜头 2.2–3.0", "tr_min": 2.2, "tr_max": 3.0,
                 "h_shift": 0.40, "v_shift": 0.55,
                 "body_w": 0.44, "body_d": 0.40, "body_h": 0.17},
            ],
            "obstacles": [
                {"name": "结构柱", "x": 3.6, "y": 2.2, "w": 0.5, "h": 0.5},
                {"name": "吊灯", "x": 1.9, "y": 3.6, "w": 1.0, "h": 0.7},
            ],
        },
    },
    {
        "id": "hall",
        "name": "示例 3：报告厅 10×14m（含无解方案）",
        "data": {
            "room": {"width": 10.0, "depth": 14.0, "height": 3.6, "margin": 0.4},
            "screen": {"width": 4.0, "height": 2.25, "bottom": 1.0, "cx": 5.0},
            "schemes": [
                {"name": "标准镜头 1.4–2.3", "tr_min": 1.4, "tr_max": 2.3,
                 "h_shift": 0.30, "v_shift": 0.55,
                 "body_w": 0.50, "body_d": 0.45, "body_h": 0.20},
                {"name": "长焦镜头 2.2–3.5", "tr_min": 2.2, "tr_max": 3.5,
                 "h_shift": 0.50, "v_shift": 0.65,
                 "body_w": 0.55, "body_d": 0.50, "body_h": 0.22},
                {"name": "超长焦 3.6–5.0", "tr_min": 3.6, "tr_max": 5.0,
                 "h_shift": 0.60, "v_shift": 0.70,
                 "body_w": 0.60, "body_d": 0.55, "body_h": 0.25},
            ],
            "obstacles": [
                {"name": "舞台灯光架", "x": 3.0, "y": 2.0, "w": 4.0, "h": 0.6},
                {"name": "楼座挑台", "x": 0.0, "y": 11.0, "w": 10.0, "h": 2.0},
                {"name": "设备间", "x": 8.6, "y": 6.0, "w": 1.4, "h": 2.0},
            ],
        },
    },
]
