#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SQL_DIR = ROOT / "sql"
ZONE_FILE = DATA_DIR / "seat_zone_template.json"
SEAT_FILE = DATA_DIR / "seat_master.json"
OUTPUT_FILE = SQL_DIR / "003_seed_library_layout.sql"


def sql_string(value):
    if value is None:
        return "NULL"
    text = str(value).replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


def sql_bool(value):
    return "1" if value else "0"


def sql_json(value):
    if value is None:
        return "NULL"
    return sql_string(json.dumps(value, ensure_ascii=False))


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_zone_rows(zone_data):
    rows = []
    for sort_order, zone in enumerate(zone_data["zones"], start=1):
        rows.append(
            "("
            + ", ".join(
                [
                    sql_string(zone["zoneCode"]),
                    str(zone_data["floor"]),
                    sql_string(zone["gridLetter"]),
                    str(zone["gridNumber"]),
                    sql_string(zone["band"]),
                    sql_string(zone["displayName"]),
                    str(zone["seatCount"]),
                    str(zone["tableGroupCount"]),
                    sql_string(zone.get("imageRef")),
                    sql_json(zone.get("polygon")),
                    sql_json(zone.get("bbox")),
                    sql_string(zone.get("annotationStatus", "pending")),
                    str(sort_order),
                    "1",
                    sql_string(zone.get("notes")),
                ]
            )
            + ")"
        )
    return rows


def build_seat_rows(seat_data):
    rows = []
    for sort_order, seat in enumerate(seat_data["seats"], start=1):
        qr_token = f"SEAT:{seat['seatId']}"
        zone_subquery = (
            f"(SELECT `id` FROM `library_zone` WHERE `floor_no` = {seat['floor']} "
            f"AND `zone_code` = {sql_string(seat['zoneCode'])})"
        )
        rows.append(
            "("
            + ", ".join(
                [
                    zone_subquery,
                    sql_string(seat["seatId"]),
                    str(seat["floor"]),
                    sql_string(seat["tableCode"]),
                    sql_string(seat["tableGroupCode"]),
                    str(seat["seatSeq"]),
                    sql_string(seat["seatSeqLabel"]),
                    sql_string(qr_token),
                    sql_string(seat["seatType"]),
                    str(seat["seatCapacity"]),
                    sql_string("available"),
                    sql_bool(seat["hasPower"]),
                    sql_bool(seat["nearWindow"]),
                    sql_string(seat["quietLevel"]),
                    sql_bool(seat["nearRestroom"]),
                    sql_bool(seat["nearPantry"]),
                    sql_bool(seat["nearAC"]),
                    sql_bool(seat["nearBookshelf"]),
                    sql_bool(seat["nearCorridor"]),
                    sql_string(seat["sunlight"]),
                    sql_string(seat.get("rawTagsText")),
                    sql_json(seat.get("rawTags")),
                    sql_json(seat.get("tagKeys")),
                    sql_string(seat.get("specificLocation")),
                    "NULL",
                    "NULL",
                    str(sort_order),
                ]
            )
            + ")"
        )
    return rows


def render_multi_insert(table_name, columns, rows, chunk_size):
    statements = []
    for index in range(0, len(rows), chunk_size):
        chunk = rows[index:index + chunk_size]
        values_sql = ",\n  ".join(chunk)

        if table_name == "library_zone":
            update_columns = columns
        else:
            update_columns = [column for column in columns if column != "zone_id"]

        update_sql = ",\n  ".join(
            f"`{column}` = VALUES(`{column}`)" for column in update_columns
        )

        statement = (
            f"INSERT INTO `{table_name}` (\n"
            f"  " + ", ".join(f"`{column}`" for column in columns) + "\n"
            f") VALUES\n  {values_sql}\n"
            f"ON DUPLICATE KEY UPDATE\n  {update_sql};\n"
        )
        statements.append(statement)
    return "\n".join(statements)


def main():
    zone_data = load_json(ZONE_FILE)
    seat_data = load_json(SEAT_FILE)

    zone_columns = [
        "zone_code",
        "floor_no",
        "grid_letter",
        "grid_number",
        "zone_band",
        "display_name",
        "seat_count",
        "table_group_count",
        "image_ref",
        "polygon_json",
        "bbox_json",
        "annotation_status",
        "sort_order",
        "is_enabled",
        "notes",
    ]

    seat_columns = [
        "zone_id",
        "seat_code",
        "floor_no",
        "table_code",
        "table_group_code",
        "seat_seq",
        "seat_seq_label",
        "qr_token",
        "seat_type",
        "seat_capacity",
        "seat_status",
        "has_power",
        "near_window",
        "quiet_level",
        "near_restroom",
        "near_pantry",
        "near_ac",
        "near_bookshelf",
        "near_corridor",
        "sunlight",
        "raw_tags_text",
        "raw_tags_json",
        "tag_keys_json",
        "specific_location",
        "coord_x",
        "coord_y",
        "sort_order",
    ]

    zone_rows = build_zone_rows(zone_data)
    seat_rows = build_seat_rows(seat_data)

    content = (
        "SET NAMES utf8mb4;\n\n"
        "USE `library_seat_reservation`;\n\n"
        "START TRANSACTION;\n\n"
        + render_multi_insert("library_zone", zone_columns, zone_rows, chunk_size=100)
        + "\n"
        + render_multi_insert("library_seat", seat_columns, seat_rows, chunk_size=150)
        + "\nCOMMIT;\n"
    )

    OUTPUT_FILE.write_text(content, encoding="utf-8")
    print(f"Generated {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
