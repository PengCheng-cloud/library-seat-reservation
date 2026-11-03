#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
INPUT_PATH = DATA_DIR / "seat_master.json"
GROUP_OUTPUT_PATH = DATA_DIR / "table_group_scene_annotation.xlsx"
SEAT_OUTPUT_PATH = DATA_DIR / "seat_scene_dataset_group_annotated_cn.xlsx"

QUIET = "安静"
SUNLIGHT_YES = "有"
SUNLIGHT_NO = "无"

LABELS = {
    "focus": "深度专注型",
    "comfort": "舒适久学型",
    "device": "设备作业型",
    "open": "开放协作型",
}

FEATURE_HEADER_LABELS = {
    "has_power": "是否有插座",
    "near_window": "是否靠窗",
    "is_quiet": "是否安静",
    "near_restroom": "是否靠近卫生间",
    "near_pantry": "是否靠近茶水间",
    "near_ac": "是否靠近空调",
    "near_bookshelf": "是否靠近书架",
    "seat_type_4": "是否4人桌",
    "seat_type_8": "是否8人桌",
    "near_corridor": "是否靠近通道",
    "sunlight_yes": "是否有日照",
    "sunlight_no": "是否无日照",
    "zone_north": "是否北侧区域",
    "zone_west": "是否西侧区域",
    "zone_east": "是否东侧区域",
    "zone_south_inner": "是否南侧内圈",
    "zone_south_outer": "是否南侧外圈",
}

FEATURE_COLUMNS = list(FEATURE_HEADER_LABELS.keys())

POWER_BASE_BY_BAND = {
    "north": 0.50,
    "west": 0.72,
    "east": 0.76,
    "south_outer": 0.68,
    "south_inner": 0.30,
}

WINDOW_POWER_BONUS_BY_BAND = {
    "north": 0.10,
    "west": 0.08,
    "east": 0.10,
    "south_outer": 0.06,
    "south_inner": 0.00,
}

QUIET_BASE_BY_BAND = {
    "north": 0.82,
    "west": 0.68,
    "east": 0.58,
    "south_outer": 0.46,
    "south_inner": 0.40,
}

SUNLIGHT_BASE_BY_BAND = {
    "north": 0.16,
    "west": 0.20,
    "east": 0.26,
    "south_outer": 0.30,
    "south_inner": 0.02,
}

WINDOW_SUNLIGHT_BONUS_BY_BAND = {
    "north": 0.48,
    "west": 0.50,
    "east": 0.56,
    "south_outer": 0.58,
    "south_inner": 0.00,
}

BOOKSHELF_BASE_BY_BAND = {
    "north": 0.00,
    "west": 0.00,
    "east": 0.02,
    "south_outer": 0.03,
    "south_inner": 0.04,
}


def load_seats():
    with INPUT_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)["seats"]


def stable_unit(*parts: object) -> float:
    text = "|".join(map(str, parts))
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def stable_signed(*parts: object) -> float:
    return stable_unit(*parts) * 2 - 1


def clamp_probability(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def build_group_contexts(raw_seats):
    by_group = defaultdict(list)
    for seat in raw_seats:
        by_group[seat["tableGroupCode"]].append(seat)

    ordered_group_codes = sorted(by_group)
    by_zone = defaultdict(list)
    for group_code in ordered_group_codes:
        zone_code = by_group[group_code][0]["zoneCode"]
        by_zone[zone_code].append(group_code)

    contexts = {}
    for zone_code, group_codes in by_zone.items():
        total_groups = len(group_codes)
        for index, group_code in enumerate(group_codes):
            items = by_group[group_code]
            rank_ratio = 0.0 if total_groups <= 1 else index / (total_groups - 1)
            edge_group_factor = abs(rank_ratio - 0.5) * 2
            contexts[group_code] = {
                "group_code": group_code,
                "zone_code": zone_code,
                "zone_band": items[0]["zoneBand"],
                "seat_capacity": items[0]["seatCapacity"],
                "rank_ratio": rank_ratio,
                "edge_group_factor": edge_group_factor,
                "raw_bookshelf_ratio": sum(int(item["nearBookshelf"]) for item in items) / len(items),
            }
    return contexts


def reconstruct_seat(raw_seat: dict, group_context: dict) -> dict:
    seat = dict(raw_seat)

    group_code = seat["tableGroupCode"]
    seat_id = seat["seatId"]
    band = seat["zoneBand"]
    edge_group_factor = group_context["edge_group_factor"]

    near_window = int(seat["nearWindow"])
    near_corridor = int(seat["nearCorridor"])
    near_restroom = int(seat["nearRestroom"])
    near_pantry = int(seat["nearPantry"])
    near_ac = int(seat["nearAC"])
    raw_near_bookshelf = int(seat["nearBookshelf"])
    seat_type_8 = int(seat["seatCapacity"] == 8)
    service_point = max(near_restroom, near_pantry)

    power_prob = (
        POWER_BASE_BY_BAND[band]
        + WINDOW_POWER_BONUS_BY_BAND[band] * near_window
        + 0.08 * service_point
        + 0.05 * near_ac
        + 0.04 * int(near_corridor and band in {"south_outer", "south_inner"})
        - 0.05 * seat_type_8
        + 0.05 * edge_group_factor
        + 0.12 * stable_signed("group-power", group_code)
        + 0.06 * stable_signed("seat-power", seat_id)
    )
    has_power = stable_unit("power", seat_id) < clamp_probability(power_prob, 0.05, 0.95)

    quiet_edge_bonus = 0.04 * (1 - edge_group_factor) if band in {"north", "west"} else -0.02 * edge_group_factor
    quiet_prob = (
        QUIET_BASE_BY_BAND[band]
        + 0.12 * near_window
        - 0.22 * near_corridor
        - 0.16 * service_point
        - 0.08 * near_ac
        + 0.12 * raw_near_bookshelf
        - 0.04 * int(has_power)
        + quiet_edge_bonus
        + 0.12 * stable_signed("group-quiet", group_code)
        + 0.08 * stable_signed("seat-quiet", seat_id)
    )
    is_quiet = stable_unit("quiet", seat_id) < clamp_probability(quiet_prob, 0.05, 0.98)

    sunlight_prob = (
        SUNLIGHT_BASE_BY_BAND[band]
        + WINDOW_SUNLIGHT_BONUS_BY_BAND[band] * near_window
        - 0.05 * near_corridor
        - 0.04 * service_point
        + 0.04 * edge_group_factor
        + 0.08 * stable_signed("group-sunlight", group_code)
        + 0.06 * stable_signed("seat-sunlight", seat_id)
    )
    sunlight_yes = stable_unit("sunlight", seat_id) < clamp_probability(sunlight_prob, 0.0, 0.98)

    bookshelf_base = 0.34 + 0.06 * (1 - edge_group_factor) if raw_near_bookshelf else BOOKSHELF_BASE_BY_BAND[band]
    bookshelf_prob = (
        bookshelf_base
        + 0.03 * near_window
        - 0.03 * near_corridor
        + 0.08 * stable_signed("group-bookshelf", group_code)
        + 0.05 * stable_signed("seat-bookshelf", seat_id)
    )
    near_bookshelf = stable_unit("bookshelf", seat_id) < clamp_probability(bookshelf_prob, 0.0, 0.75)

    seat["hasPower"] = bool(has_power)
    seat["quietLevel"] = QUIET if is_quiet else "一般"
    seat["sunlight"] = SUNLIGHT_YES if sunlight_yes else SUNLIGHT_NO
    seat["nearBookshelf"] = bool(near_bookshelf)
    return seat


def build_group_stats(items):
    count = len(items)
    zone_code = items[0]["zoneCode"]
    zone_band = items[0]["zoneBand"]
    zone_display_name = items[0]["zoneDisplayName"]
    table_group_code = items[0]["tableGroupCode"]
    seat_capacity = items[0]["seatCapacity"]

    window_ratio = sum(int(item["nearWindow"]) for item in items) / count
    power_ratio = sum(int(item["hasPower"]) for item in items) / count
    quiet_ratio = sum(int(item["quietLevel"] == QUIET) for item in items) / count
    corridor_ratio = sum(int(item["nearCorridor"]) for item in items) / count
    restroom_ratio = sum(int(item["nearRestroom"]) for item in items) / count
    pantry_ratio = sum(int(item["nearPantry"]) for item in items) / count
    ac_ratio = sum(int(item["nearAC"]) for item in items) / count
    bookshelf_ratio = sum(int(item["nearBookshelf"]) for item in items) / count
    sunlight_ratio = sum(int(item["sunlight"] == SUNLIGHT_YES) for item in items) / count

    return {
        "table_group_code": table_group_code,
        "zone_code": zone_code,
        "zone_band": zone_band,
        "zone_display_name": zone_display_name,
        "seat_capacity": seat_capacity,
        "seat_count": count,
        "window_ratio": window_ratio,
        "power_ratio": power_ratio,
        "quiet_ratio": quiet_ratio,
        "corridor_ratio": corridor_ratio,
        "restroom_ratio": restroom_ratio,
        "pantry_ratio": pantry_ratio,
        "ac_ratio": ac_ratio,
        "bookshelf_ratio": bookshelf_ratio,
        "sunlight_ratio": sunlight_ratio,
    }


def infer_label_and_reason(stats):
    zone = stats["zone_band"]
    cap = stats["seat_capacity"]
    window = stats["window_ratio"]
    power = stats["power_ratio"]
    quiet = stats["quiet_ratio"]
    corridor = stats["corridor_ratio"]
    service = max(stats["restroom_ratio"], stats["pantry_ratio"], stats["ac_ratio"])

    if zone == "south_inner":
        return (
            "open",
            "高",
            "南侧内圈桌组开放度更高，且整体更贴近多人交流与结伴自习场景。",
        )

    if zone == "south_outer" and cap == 8 and corridor >= 0.75:
        return (
            "open",
            "高",
            "南侧外圈的 8 人桌兼顾通行与开放度，更接近协作讨论场景。",
        )

    if zone == "south_outer" and power >= 0.6:
        return (
            "device",
            "中",
            "南侧外圈桌组的插座覆盖与通行便利性更强，更适合设备作业。",
        )

    if zone == "north":
        if window >= 0.4 and quiet >= 0.7 and stats["sunlight_ratio"] >= 0.35:
            return (
                "comfort",
                "高",
                "北侧桌组兼顾采光与安静度，更适合舒适久学。",
            )
        return (
            "focus",
            "高",
            "北侧桌组整体更安静，也远离主要通道，更接近深度专注场景。",
        )

    if zone in {"west", "east"}:
        if power >= 0.7 and (corridor >= 0.2 or service > 0):
            return (
                "device",
                "高" if service > 0 else "中",
                "侧向区域桌组的插座覆盖较高，且更贴近服务点或通道，更适合设备作业。",
            )
        if window >= 0.3 and quiet >= 0.65 and corridor <= 0.25:
            return (
                "comfort",
                "中",
                "侧向区域桌组具备一定采光与稳定性，更偏向舒适久学。",
            )
        return (
            "focus",
            "中",
            "该桌组整体干扰较少，综合特征更偏向专注学习。",
        )

    return (
        "focus",
        "低",
        "当前区域信息较弱，暂按更保守的专注学习场景进行初标。",
    )


def build_seat_feature_row(seat):
    return {
        "seat_id": seat["seatId"],
        "table_group_code": seat["tableGroupCode"],
        "zone_code": seat["zoneCode"],
        "has_power": int(seat["hasPower"]),
        "near_window": int(seat["nearWindow"]),
        "is_quiet": int(seat["quietLevel"] == QUIET),
        "near_restroom": int(seat["nearRestroom"]),
        "near_pantry": int(seat["nearPantry"]),
        "near_ac": int(seat["nearAC"]),
        "near_bookshelf": int(seat["nearBookshelf"]),
        "seat_type_4": int(seat["seatCapacity"] == 4),
        "seat_type_8": int(seat["seatCapacity"] == 8),
        "near_corridor": int(seat["nearCorridor"]),
        "sunlight_yes": int(seat["sunlight"] == SUNLIGHT_YES),
        "sunlight_no": int(seat["sunlight"] != SUNLIGHT_YES),
        "zone_north": int(seat["zoneBand"] == "north"),
        "zone_west": int(seat["zoneBand"] == "west"),
        "zone_east": int(seat["zoneBand"] == "east"),
        "zone_south_inner": int(seat["zoneBand"] == "south_inner"),
        "zone_south_outer": int(seat["zoneBand"] == "south_outer"),
    }


def build_reconstruction_rows():
    return [
        [
            "是否靠近卫生间",
            "保持原始布局",
            "按原始平面位置保留，不参与捏造。",
        ],
        [
            "是否靠近茶水间",
            "保持原始布局",
            "同属建筑服务点，和真实空间关系强绑定。",
        ],
        [
            "是否靠近空调",
            "保持原始布局",
            "按原始平面位置保留，不参与捏造。",
        ],
        [
            "是否靠近通道",
            "保持原始布局",
            "按原始平面位置保留，不参与捏造。",
        ],
        [
            "是否靠窗",
            "保持原始布局",
            "沿用原始座位朝窗分布，维持和外墙位置的一致性。",
        ],
        [
            "是否有插座",
            "空间约束重构",
            "按区域类型、靠窗/服务点/桌型和组内微差异重构，不再整桌全 0 或全 1。",
        ],
        [
            "是否安静",
            "空间约束重构",
            "同时考虑区域、通道、服务点、空调、靠窗和组内微差异，让同桌组不同座位有自然区别。",
        ],
        [
            "是否有日照",
            "空间约束重构",
            "以靠窗和区域朝向为主，再叠加少量空间微差异，避免整桌完全一致。",
        ],
        [
            "是否靠近书架",
            "空间约束重构",
            "保留原始书架热点区域，同时改成更像真实场景的局部邻近分布。",
        ],
    ]


def autosize_sheet(sheet):
    for column_cells in sheet.columns:
        max_length = 0
        column_letter = column_cells[0].column_letter
        for cell in column_cells:
            value = "" if cell.value is None else str(cell.value)
            max_length = max(max_length, len(value))
        sheet.column_dimensions[column_letter].width = min(max_length + 2, 34)


def write_group_workbook(group_rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "桌组标注"
    ws.append(
        [
            "桌组编号",
            "区域编码",
            "区域名称",
            "区域方向",
            "单桌容量",
            "座位数",
            "靠窗比例",
            "插座比例",
            "安静比例",
            "通道比例",
            "卫生间临近比例",
            "茶水间临近比例",
            "空调临近比例",
            "书架临近比例",
            "日照比例",
            "建议场景标签",
            "标注置信度",
            "标注理由",
        ]
    )
    for row in group_rows:
        ws.append(
            [
                row["table_group_code"],
                row["zone_code"],
                row["zone_display_name"],
                row["zone_band"],
                row["seat_capacity"],
                row["seat_count"],
                round(row["window_ratio"], 3),
                round(row["power_ratio"], 3),
                round(row["quiet_ratio"], 3),
                round(row["corridor_ratio"], 3),
                round(row["restroom_ratio"], 3),
                round(row["pantry_ratio"], 3),
                round(row["ac_ratio"], 3),
                round(row["bookshelf_ratio"], 3),
                round(row["sunlight_ratio"], 3),
                row["scene_label"],
                row["confidence"],
                row["reason"],
            ]
        )

    summary = wb.create_sheet("标签统计")
    summary.append(["scene_label", "group_count"])
    counts = Counter(row["scene_label"] for row in group_rows)
    for label in LABELS.values():
        summary.append([label, counts[label]])

    reconstruction = wb.create_sheet("重构规则")
    reconstruction.append(["字段", "处理方式", "说明"])
    for row in build_reconstruction_rows():
        reconstruction.append(row)

    autosize_sheet(ws)
    autosize_sheet(summary)
    autosize_sheet(reconstruction)
    wb.save(GROUP_OUTPUT_PATH)


def write_seat_dataset(seat_rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "座位数据"
    ws.append(
        [
            "座位编号",
            "桌组编号",
            "区域编码",
            *[FEATURE_HEADER_LABELS[key] for key in FEATURE_COLUMNS],
            "场景标签",
            "标注置信度",
        ]
    )
    for row in seat_rows:
        ws.append(
            [
                row["seat_id"],
                row["table_group_code"],
                row["zone_code"],
                *[row[key] for key in FEATURE_COLUMNS],
                row["scene_label"],
                row["confidence"],
            ]
        )

    summary = wb.create_sheet("标签统计")
    summary.append(["scene_label", "seat_count"])
    counts = Counter(row["scene_label"] for row in seat_rows)
    for label in LABELS.values():
        summary.append([label, counts[label]])

    reconstruction = wb.create_sheet("重构规则")
    reconstruction.append(["字段", "处理方式", "说明"])
    for row in build_reconstruction_rows():
        reconstruction.append(row)

    autosize_sheet(ws)
    autosize_sheet(summary)
    autosize_sheet(reconstruction)
    wb.save(SEAT_OUTPUT_PATH)


def main():
    raw_seats = load_seats()
    group_contexts = build_group_contexts(raw_seats)
    adjusted_seats = [reconstruct_seat(seat, group_contexts[seat["tableGroupCode"]]) for seat in raw_seats]

    by_group = defaultdict(list)
    for seat in adjusted_seats:
        by_group[seat["tableGroupCode"]].append(seat)

    group_rows = []
    group_label_map = {}
    for group_code, items in sorted(by_group.items()):
        row = build_group_stats(items)
        label_key, confidence, reason = infer_label_and_reason(row)
        row["scene_label"] = LABELS[label_key]
        row["confidence"] = confidence
        row["reason"] = reason
        group_rows.append(row)
        group_label_map[group_code] = (LABELS[label_key], confidence)

    seat_rows = []
    for seat in adjusted_seats:
        row = build_seat_feature_row(seat)
        row["scene_label"], row["confidence"] = group_label_map[seat["tableGroupCode"]]
        seat_rows.append(row)

    write_group_workbook(group_rows)
    write_seat_dataset(seat_rows)

    print(f"Generated: {GROUP_OUTPUT_PATH}")
    print(f"Generated: {SEAT_OUTPUT_PATH}")
    print("Group label distribution:")
    group_counts = Counter(row["scene_label"] for row in group_rows)
    for label in LABELS.values():
        print(f"  {label}: {group_counts[label]}")
    print("Seat label distribution:")
    seat_counts = Counter(row["scene_label"] for row in seat_rows)
    for label in LABELS.values():
        print(f"  {label}: {seat_counts[label]}")


if __name__ == "__main__":
    main()
