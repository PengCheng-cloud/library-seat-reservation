#!/usr/bin/env python3
import json
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
INPUT_PATH = DATA_DIR / "seat_master.json"
OUTPUT_PATH = DATA_DIR / "seat_classification_dataset.xlsx"

QUIET = "\u5b89\u9759"
FOUR_PERSON = "4\u4eba\u684c"
EIGHT_PERSON = "8\u4eba\u684c"
SUNLIGHT_YES = "\u6709"
SUNLIGHT_NO = "\u65e0"

CLASS_ORDER = ["focus", "light", "power", "general"]
CLASS_LABELS = {
    "focus": "\u4e13\u6ce8\u9759\u5b66\u578b",
    "light": "\u91c7\u5149\u8212\u9002\u578b",
    "power": "\u4fbf\u6377\u5145\u7535\u578b",
    "general": "\u534f\u4f5c\u4ea4\u6d41\u578b",
}
CLASS_DESCRIPTIONS = {
    "focus": "\u4f18\u5148\u9009\u53d6\u5b89\u9759\u3001\u8fdc\u79bb\u901a\u9053\u548c\u670d\u52a1\u70b9\u7684\u533a\u57df\uff0c\u9002\u5408\u72ec\u7acb\u5b66\u4e60\u3002",
    "light": "\u4e25\u683c\u9650\u5b9a\u4e3a\u9760\u7a97\u4e14\u6709\u65e5\u7167\u7684\u5ea7\u4f4d\uff0c\u9002\u5408\u9605\u8bfb\u548c\u957f\u65f6\u95f4\u5b66\u4e60\u3002",
    "power": "\u4f18\u5148\u9009\u53d6\u6709\u63d2\u5ea7\u4e14\u9760\u8fd1\u901a\u9053/\u7a7a\u8c03/\u8336\u6c34\u70b9\u7684\u5ea7\u4f4d\uff0c\u9002\u5408\u7b14\u8bb0\u672c\u4f7f\u7528\u3002",
    "general": "\u4f18\u5148\u9009\u53d6\u5357\u4fa7\u6216\u8f83\u5f00\u653e\u76848\u4eba\u684c\u533a\u57df\uff0c\u9002\u5408\u8ba8\u8bba\u3001\u77ed\u65f6\u4ea4\u6d41\u548c\u534f\u4f5c\u3002",
}

FEATURE_COLUMNS = [
    "has_power",
    "near_window",
    "is_quiet",
    "near_restroom",
    "near_pantry",
    "near_ac",
    "near_bookshelf",
    "seat_type_4",
    "seat_type_8",
    "near_corridor",
    "sunlight_yes",
    "sunlight_no",
    "zone_north",
    "zone_west",
    "zone_east",
    "zone_south_inner",
    "zone_south_outer",
]

HEADER_LABELS = {
    "seat_id": "\u5ea7\u4f4d\u7f16\u53f7",
    "has_power": "\u662f\u5426\u6709\u63d2\u5ea7",
    "near_window": "\u662f\u5426\u9760\u7a97",
    "is_quiet": "\u662f\u5426\u5b89\u9759",
    "near_restroom": "\u662f\u5426\u9760\u8fd1\u536b\u751f\u95f4",
    "near_pantry": "\u662f\u5426\u9760\u8fd1\u8336\u6c34\u95f4",
    "near_ac": "\u662f\u5426\u9760\u8fd1\u7a7a\u8c03",
    "near_bookshelf": "\u662f\u5426\u9760\u8fd1\u4e66\u67b6",
    "seat_type_4": "\u662f\u54264\u4eba\u684c",
    "seat_type_8": "\u662f\u54268\u4eba\u684c",
    "near_corridor": "\u662f\u5426\u9760\u8fd1\u901a\u9053",
    "sunlight_yes": "\u662f\u5426\u6709\u65e5\u7167",
    "sunlight_no": "\u662f\u5426\u65e0\u65e5\u7167",
    "zone_north": "\u662f\u5426\u5317\u4fa7\u533a\u57df",
    "zone_west": "\u662f\u5426\u897f\u4fa7\u533a\u57df",
    "zone_east": "\u662f\u5426\u4e1c\u4fa7\u533a\u57df",
    "zone_south_inner": "\u662f\u5426\u5357\u4fa7\u5185\u5708",
    "zone_south_outer": "\u662f\u5426\u5357\u4fa7\u5916\u5708",
    "class_label": "\u7c7b\u522b\u6807\u7b7e",
}


def load_seats():
    with INPUT_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload["seats"]


def build_feature_row(seat):
    return {
        "seat_id": seat["seatId"],
        "has_power": int(seat["hasPower"]),
        "near_window": int(seat["nearWindow"]),
        "is_quiet": int(seat["quietLevel"] == QUIET),
        "near_restroom": int(seat["nearRestroom"]),
        "near_pantry": int(seat["nearPantry"]),
        "near_ac": int(seat["nearAC"]),
        "near_bookshelf": int(seat["nearBookshelf"]),
        "seat_type_4": int(seat["seatType"] == FOUR_PERSON),
        "seat_type_8": int(seat["seatType"] == EIGHT_PERSON),
        "near_corridor": int(seat["nearCorridor"]),
        "sunlight_yes": int(seat["sunlight"] == SUNLIGHT_YES),
        "sunlight_no": int(seat["sunlight"] == SUNLIGHT_NO),
        "zone_north": int(seat["zoneBand"] == "north"),
        "zone_west": int(seat["zoneBand"] == "west"),
        "zone_east": int(seat["zoneBand"] == "east"),
        "zone_south_inner": int(seat["zoneBand"] == "south_inner"),
        "zone_south_outer": int(seat["zoneBand"] == "south_outer"),
    }


def score_record(record):
    return {
        "focus": (
            3 * record["is_quiet"]
            + 2 * (1 - record["near_corridor"])
            + 1 * (1 - record["near_restroom"])
            + 1 * (1 - record["near_pantry"])
            + 1 * record["zone_north"]
            + 1 * record["zone_west"]
        ),
        "light": (
            4 * record["near_window"]
            + 3 * record["sunlight_yes"]
            + 1 * record["is_quiet"]
            + 1 * record["zone_north"]
            + 1 * record["zone_east"]
            + 1 * record["zone_south_outer"]
        ),
        "power": (
            4 * record["has_power"]
            + 2 * record["near_corridor"]
            + 1 * record["near_ac"]
            + 1 * record["near_pantry"]
            + 1 * record["near_restroom"]
            + 1 * record["zone_east"]
            + 1 * record["zone_south_outer"]
            + 1 * record["zone_west"]
        ),
        "general": (
            3 * record["seat_type_8"]
            + 2 * record["zone_south_inner"]
            + 2 * record["zone_south_outer"]
            + 1 * record["zone_east"]
            + 1 * record["near_corridor"]
            + 1 * (1 - record["near_window"])
        ),
    }


def choose_class(record):
    # 采光舒适型必须全部来自靠窗且有日照的座位，避免和原始属性冲突。
    if record["near_window"] == 1 and record["sunlight_yes"] == 1:
        return "light"

    # 便捷充电型强调插座和区域便利性，优先落在东/西/南外侧等相对便捷区域。
    if (
        record["has_power"] == 1
        and (
            record["near_corridor"] == 1
            or record["near_ac"] == 1
            or record["near_pantry"] == 1
            or record["near_restroom"] == 1
        )
        and (
            record["zone_east"] == 1
            or record["zone_west"] == 1
            or record["zone_south_outer"] == 1
        )
    ):
        return "power"

    # 专注静学型优先来自安静、远离通道和服务点的北/西侧区域。
    if (
        record["is_quiet"] == 1
        and record["near_corridor"] == 0
        and record["near_restroom"] == 0
        and record["near_pantry"] == 0
        and (record["zone_north"] == 1 or record["zone_west"] == 1)
    ):
        return "focus"

    # 其余优先落入协作交流型，强调南侧与开放桌组。
    if (
        record["seat_type_8"] == 1
        and (
            record["zone_south_inner"] == 1
            or record["zone_south_outer"] == 1
            or record["zone_east"] == 1
        )
    ):
        return "general"

    # 剩余样本按得分选择最接近的类别，保持标签自然但不过度人为均衡。
    scores = score_record(record)
    return max(CLASS_ORDER, key=lambda class_key: scores[class_key])


def assign_natural_classes(records):
    for record in records:
        class_key = choose_class(record)
        record["class_key"] = class_key
        record["class_label"] = CLASS_LABELS[class_key]

    return Counter(record["class_key"] for record in records)


def autosize_sheet(sheet):
    for column_cells in sheet.columns:
        max_length = 0
        column_letter = column_cells[0].column_letter
        for cell in column_cells:
            value = "" if cell.value is None else str(cell.value)
            max_length = max(max_length, len(value))
        sheet.column_dimensions[column_letter].width = min(max_length + 2, 28)


def write_dataset_sheet(workbook, records):
    sheet = workbook.active
    sheet.title = "dataset"

    header_keys = ["seat_id", *FEATURE_COLUMNS, "class_label"]
    headers = [HEADER_LABELS[key] for key in header_keys]
    sheet.append(headers)

    for record in records:
        row = [record["seat_id"]]
        row.extend(record[column] for column in FEATURE_COLUMNS)
        row.append(record["class_label"])
        sheet.append(row)

    sheet.freeze_panes = "A2"
    autosize_sheet(sheet)


def write_summary_sheet(workbook, records, quotas):
    sheet = workbook.create_sheet("summary")
    class_counts = Counter(record["class_label"] for record in records)

    sheet.append(["output_file", str(OUTPUT_PATH)])
    sheet.append(["source_file", str(INPUT_PATH)])
    sheet.append(["total_rows", len(records)])
    sheet.append([])

    sheet.append(["class_label", "count", "rule_basis", "description"])
    for class_key in CLASS_ORDER:
        label = CLASS_LABELS[class_key]
        sheet.append(
            [label, class_counts[label], class_key, CLASS_DESCRIPTIONS[class_key]]
        )

    sheet.append([])
    sheet.append(["feature_mean_by_class"])
    sheet.append(["class_label", *FEATURE_COLUMNS])

    grouped = defaultdict(list)
    for record in records:
        grouped[record["class_label"]].append(record)

    for class_key in CLASS_ORDER:
        label = CLASS_LABELS[class_key]
        group = grouped[label]
        row = [label]
        for feature_name in FEATURE_COLUMNS:
            feature_mean = sum(item[feature_name] for item in group) / len(group)
            row.append(round(feature_mean, 4))
        sheet.append(row)

    autosize_sheet(sheet)


def main():
    seats = load_seats()
    records = [build_feature_row(seat) for seat in seats]
    class_key_counts = assign_natural_classes(records)

    workbook = openpyxl.Workbook()
    write_dataset_sheet(workbook, records)
    write_summary_sheet(workbook, records, class_key_counts)
    workbook.save(OUTPUT_PATH)

    class_counts = Counter(record["class_label"] for record in records)
    print(f"Generated: {OUTPUT_PATH}")
    print("Class distribution:")
    for class_key in CLASS_ORDER:
        label = CLASS_LABELS[class_key]
        print(f"  {label}: {class_counts[label]}")


if __name__ == "__main__":
    main()
