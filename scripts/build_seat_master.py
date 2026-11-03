#!/usr/bin/env python3
import json
import re
from collections import Counter
from pathlib import Path

import openpyxl
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

YES = "\u662f"
NO = "\u5426"
QUIET = "\u5b89\u9759"
GENERAL = "\u4e00\u822c"
FOUR_PERSON = "4\u4eba\u684c"
EIGHT_PERSON = "8\u4eba\u684c"
SUNLIGHT_YES = "\u6709"
SUNLIGHT_NO = "\u65e0"
TAG_SEPARATOR = "\u3001"

HEADER_KEYS = {
    "seat_id": "\u5ea7\u4f4d\u7f16\u53f7",
    "has_power": "\u662f\u5426\u6709\u5145\u7535\u63d2\u5ea7",
    "near_window": "\u662f\u5426\u9760\u7a97",
    "quiet_level": "\u5b89\u9759\u7a0b\u5ea6",
    "near_restroom": "\u662f\u5426\u9760\u8fd1\u536b\u751f\u95f4",
    "near_pantry": "\u662f\u5426\u9760\u8fd1\u8336\u6c34\u95f4",
    "near_ac": "\u662f\u5426\u9760\u8fd1\u7a7a\u8c03\u51fa\u98ce\u53e3",
    "near_bookshelf": "\u662f\u5426\u9760\u8fd1\u4e66\u67b6\u533a",
    "seat_type": "\u5ea7\u4f4d\u7c7b\u578b",
    "near_corridor": "\u662f\u5426\u9760\u8fd1\u7535\u68af\u548c\u901a\u9053",
    "sunlight": "\u65e5\u7167\u7a0b\u5ea6(\u6674\u5929\u662f\u5426\u6709\u592a\u9633\u5149\u7167\u5c04)",
    "raw_tags": "\u6807\u7b7e",
    "specific_location": "\u5177\u4f53\u4f4d\u7f6e",
}


def find_first(patterns):
    for pattern in patterns:
        matches = sorted(ROOT.glob(pattern))
        if matches:
            return matches[0]
    raise FileNotFoundError(f"Unable to find file for patterns: {patterns}")


def load_sheet():
    workbook_path = find_first(["*.xlsx"])
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    headers = list(rows[0])
    header_index = {str(name): idx for idx, name in enumerate(headers)}
    return workbook_path, headers, header_index, rows[1:]


def parse_seat_id(seat_id):
    match = re.fullmatch(r"([A-Z]+\d+)-([A-Z]+)-(\d+)", seat_id)
    if not match:
        raise ValueError(f"Unexpected seat id format: {seat_id}")

    zone_code, table_code, seat_seq = match.groups()
    zone_match = re.fullmatch(r"([A-Z]+)(\d+)", zone_code)
    if not zone_match:
        raise ValueError(f"Unexpected zone code format: {zone_code}")

    grid_letter, grid_number = zone_match.groups()
    grid_number = int(grid_number)
    seat_seq_int = int(seat_seq)

    return {
        "zoneCode": zone_code,
        "tableCode": table_code,
        "seatSeq": seat_seq_int,
        "seatSeqLabel": seat_seq,
        "tableGroupCode": f"{zone_code}-{table_code}",
        "gridLetter": grid_letter,
        "gridNumber": grid_number,
    }


def infer_zone_band(grid_letter, grid_number):
    if grid_letter == "Q":
        return "north"
    if grid_letter == "C":
        return "south_outer"
    if grid_letter == "D" and grid_number not in (3, 15):
        return "south_inner"
    if grid_number == 3:
        return "west"
    if grid_number == 15:
        return "east"
    return "inner"


def infer_zone_display_name(grid_letter, grid_number, band):
    band_name = {
        "north": "\u5317\u4fa7",
        "south_outer": "\u5357\u4fa7\u5916\u5708",
        "south_inner": "\u5357\u4fa7\u5185\u5708",
        "west": "\u897f\u4fa7",
        "east": "\u4e1c\u4fa7",
        "inner": "\u4e2d\u90e8",
    }[band]
    return f"{band_name}{grid_letter}{grid_number}\u533a"


def split_raw_tags(raw_tags):
    if not raw_tags:
        return []
    return [tag.strip() for tag in str(raw_tags).split(TAG_SEPARATOR) if tag and str(tag).strip()]


def extract_seat_capacity(seat_type):
    match = re.search(r"(\d+)", str(seat_type or ""))
    return int(match.group(1)) if match else None


def bool_key(value):
    return value == YES


def build_tag_keys(record):
    keys = []
    keys.append("power_outlet" if record["hasPower"] else "no_power_outlet")
    keys.append("window" if record["nearWindow"] else "inner_side")
    keys.append("quiet" if record["quietLevel"] == QUIET else "normal_noise")
    keys.append("near_restroom" if record["nearRestroom"] else "away_from_restroom")
    keys.append("near_pantry" if record["nearPantry"] else "away_from_pantry")
    keys.append("near_ac" if record["nearAC"] else "balanced_temperature")
    keys.append("near_bookshelf" if record["nearBookshelf"] else "away_from_bookshelf")
    keys.append("near_corridor" if record["nearCorridor"] else "quiet_position")
    keys.append("sunlight_yes" if record["sunlight"] == SUNLIGHT_YES else "sunlight_no")
    capacity = record["seatCapacity"]
    if capacity:
        keys.append(f"table_{capacity}")
    return keys


def build_raw_tags_from_record(record):
    tags = []

    if record["hasPower"]:
        tags.append("\u6709\u5145\u7535\u63d2\u5ea7")
    if record["nearWindow"]:
        tags.append("\u9760\u7a97\u5ea7\u4f4d")
    else:
        tags.append("\u5185\u4fa7\u5ea7\u4f4d")

    tags.append("\u73af\u5883\u5b89\u9759" if record["quietLevel"] == QUIET else "\u666e\u901a\u97f3\u91cf")
    tags.append("\u9760\u8fd1\u536b\u751f\u95f4" if record["nearRestroom"] else "\u8fdc\u79bb\u536b\u751f\u95f4")
    tags.append("\u9760\u8fd1\u8336\u6c34\u95f4" if record["nearPantry"] else "\u8fdc\u79bb\u8336\u6c34\u95f4")
    tags.append("\u9760\u8fd1\u7a7a\u8c03\u51fa\u98ce\u53e3" if record["nearAC"] else "\u6e29\u5ea6\u5747\u8861")
    tags.append("\u9760\u8fd1\u4e66\u67b6\u533a" if record["nearBookshelf"] else "\u8fdc\u79bb\u4e66\u67b6\u533a")
    tags.append("\u9760\u8fd1\u901a\u9053" if record["nearCorridor"] else "\u4f4d\u7f6e\u907f\u9759")
    tags.append(record["seatType"])
    tags.append("\u9633\u5149\u5145\u8db3" if record["sunlight"] == SUNLIGHT_YES else "\u65e5\u7167\u8f83\u5f31")
    return tags


def refresh_record_derived_fields(record):
    record["zoneBand"] = infer_zone_band(record["gridLetter"], record["gridNumber"])
    record["zoneDisplayName"] = infer_zone_display_name(
        record["gridLetter"],
        record["gridNumber"],
        record["zoneBand"],
    )
    record["rawTags"] = build_raw_tags_from_record(record)
    record["rawTagsText"] = TAG_SEPARATOR.join(record["rawTags"])
    record["tagKeys"] = build_tag_keys(record)
    return record


def clone_record(record):
    return json.loads(json.dumps(record, ensure_ascii=False))


def augment_generated_seats(seat_records):
    if any(seat["zoneCode"] == "H15" for seat in seat_records):
        return seat_records

    h3_records = [
        clone_record(seat)
        for seat in sorted(
            seat_records,
            key=lambda item: (item["tableGroupCode"], item["seatSeq"])
        )
        if seat["zoneCode"] == "H3"
    ]

    if not h3_records:
        return seat_records

    augmented = list(seat_records)

    for record in h3_records:
        cloned = clone_record(record)
        cloned["seatId"] = cloned["seatId"].replace("H3", "H15", 1)
        cloned["zoneCode"] = "H15"
        cloned["gridNumber"] = 15
        cloned["tableGroupCode"] = cloned["tableGroupCode"].replace("H3", "H15", 1)

        table_code = cloned["tableCode"]

        if table_code in {"A", "B"}:
            cloned["quietLevel"] = QUIET
            cloned["nearBookshelf"] = True
            cloned["nearPantry"] = False
            cloned["nearAC"] = False
            cloned["sunlight"] = SUNLIGHT_YES
        elif table_code == "C":
            cloned["quietLevel"] = QUIET
            cloned["nearBookshelf"] = True
            cloned["nearPantry"] = False
            cloned["nearAC"] = False
            cloned["sunlight"] = SUNLIGHT_YES
        elif table_code in {"D", "E"}:
            cloned["quietLevel"] = QUIET
            cloned["nearWindow"] = cloned["seatSeq"] <= 2
            cloned["sunlight"] = SUNLIGHT_YES
            cloned["nearCorridor"] = False
            cloned["nearRestroom"] = False
            cloned["nearPantry"] = False
            cloned["nearAC"] = False
        elif table_code == "F":
            cloned["quietLevel"] = QUIET
            cloned["nearBookshelf"] = True
            cloned["nearRestroom"] = True
            cloned["nearPantry"] = False
            cloned["nearAC"] = False
            cloned["sunlight"] = SUNLIGHT_YES

        refresh_record_derived_fields(cloned)
        augmented.append(cloned)

    return augmented


def build_zone_summary_from_seats(seat_records):
    zone_summary = {}

    for seat in seat_records:
        zone = zone_summary.setdefault(
            seat["zoneCode"],
            {
                "gridLetter": seat["gridLetter"],
                "gridNumber": seat["gridNumber"],
                "band": seat["zoneBand"],
                "displayName": seat["zoneDisplayName"],
                "seatCount": 0,
                "tableGroups": set(),
            },
        )
        zone["seatCount"] += 1
        zone["tableGroups"].add(seat["tableGroupCode"])

    for zone in zone_summary.values():
        zone["tableGroupCount"] = len(zone.pop("tableGroups"))

    return zone_summary


def build_zone_template(zone_summary, image_meta):
    zones = []
    for zone_code in sorted(zone_summary):
        item = zone_summary[zone_code]
        zones.append(
            {
                "zoneCode": zone_code,
                "gridLetter": item["gridLetter"],
                "gridNumber": item["gridNumber"],
                "band": item["band"],
                "displayName": item["displayName"],
                "seatCount": item["seatCount"],
                "tableGroupCount": item["tableGroupCount"],
                "imageRef": image_meta["fileName"],
                "polygon": [],
                "bbox": None,
                "annotationStatus": "pending",
                "notes": "\u6839\u636e\u5ea7\u4f4d\u7f16\u53f7\u548c\u4e03\u5c42\u5e73\u9762\u56fe\u63a8\u65ad\u7684\u533a\u57df\u952e\uff0c\u5f85\u540e\u7eed\u624b\u52a8\u6807\u6ce8\u5750\u6807\u3002",
            }
        )
    return {
        "floor": 7,
        "image": image_meta,
        "zoneCount": len(zones),
        "zones": zones,
    }


def build_stats(seat_records, zone_summary):
    return {
        "seatCount": len(seat_records),
        "zoneCount": len(zone_summary),
        "tableGroupCount": len({seat["tableGroupCode"] for seat in seat_records}),
        "seatTypeDistribution": dict(Counter(seat["seatType"] for seat in seat_records)),
        "hasPowerDistribution": dict(Counter(seat["hasPower"] for seat in seat_records)),
        "windowDistribution": dict(Counter(seat["nearWindow"] for seat in seat_records)),
        "quietDistribution": dict(Counter(seat["quietLevel"] for seat in seat_records)),
        "bandDistribution": dict(Counter(seat["zoneBand"] for seat in seat_records)),
        "rawTagPatternCount": len({seat["rawTagsText"] for seat in seat_records if seat["rawTagsText"]}),
    }


def main():
    DATA_DIR.mkdir(exist_ok=True)
    workbook_path, headers, header_index, rows = load_sheet()

    missing_headers = [value for value in HEADER_KEYS.values() if value not in header_index]
    if missing_headers:
        raise ValueError(f"Missing headers: {missing_headers}")

    image_path = find_first(["*.jpg", "*.jpeg", "*.png"])
    image = Image.open(image_path)
    image_meta = {
        "fileName": image_path.name,
        "width": image.width,
        "height": image.height,
    }

    seat_records = []
    zone_summary = {}

    for row in rows:
        seat_id = row[header_index[HEADER_KEYS["seat_id"]]]
        if not seat_id:
            continue

        parts = parse_seat_id(str(seat_id))
        band = infer_zone_band(parts["gridLetter"], parts["gridNumber"])
        display_name = infer_zone_display_name(parts["gridLetter"], parts["gridNumber"], band)

        record = {
            "seatId": str(seat_id),
            "floor": 7,
            "zoneCode": parts["zoneCode"],
            "tableCode": parts["tableCode"],
            "tableGroupCode": parts["tableGroupCode"],
            "seatSeq": parts["seatSeq"],
            "seatSeqLabel": parts["seatSeqLabel"],
            "gridLetter": parts["gridLetter"],
            "gridNumber": parts["gridNumber"],
            "zoneBand": band,
            "zoneDisplayName": display_name,
            "hasPower": bool_key(row[header_index[HEADER_KEYS["has_power"]]]),
            "nearWindow": bool_key(row[header_index[HEADER_KEYS["near_window"]]]),
            "quietLevel": row[header_index[HEADER_KEYS["quiet_level"]]],
            "nearRestroom": bool_key(row[header_index[HEADER_KEYS["near_restroom"]]]),
            "nearPantry": bool_key(row[header_index[HEADER_KEYS["near_pantry"]]]),
            "nearAC": bool_key(row[header_index[HEADER_KEYS["near_ac"]]]),
            "nearBookshelf": bool_key(row[header_index[HEADER_KEYS["near_bookshelf"]]]),
            "seatType": row[header_index[HEADER_KEYS["seat_type"]]],
            "seatCapacity": extract_seat_capacity(row[header_index[HEADER_KEYS["seat_type"]]]),
            "nearCorridor": bool_key(row[header_index[HEADER_KEYS["near_corridor"]]]),
            "sunlight": row[header_index[HEADER_KEYS["sunlight"]]],
            "rawTagsText": row[header_index[HEADER_KEYS["raw_tags"]]],
            "rawTags": split_raw_tags(row[header_index[HEADER_KEYS["raw_tags"]]]),
            "specificLocation": row[header_index[HEADER_KEYS["specific_location"]]],
        }
        record["tagKeys"] = build_tag_keys(record)

        seat_records.append(record)

        zone = zone_summary.setdefault(
            parts["zoneCode"],
            {
                "gridLetter": parts["gridLetter"],
                "gridNumber": parts["gridNumber"],
                "band": band,
                "displayName": display_name,
                "seatCount": 0,
                "tableGroups": set(),
            },
        )
        zone["seatCount"] += 1
        zone["tableGroups"].add(parts["tableGroupCode"])

    seat_records = augment_generated_seats(seat_records)
    zone_summary = build_zone_summary_from_seats(seat_records)

    seat_master = {
        "sourceWorkbook": workbook_path.name,
        "headers": headers,
        "seatCount": len(seat_records),
        "zoneCount": len(zone_summary),
        "seats": seat_records,
    }

    zone_template = build_zone_template(zone_summary, image_meta)
    stats = build_stats(seat_records, zone_summary)

    (DATA_DIR / "seat_master.json").write_text(
        json.dumps(seat_master, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA_DIR / "seat_zone_template.json").write_text(
        json.dumps(zone_template, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA_DIR / "seat_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
