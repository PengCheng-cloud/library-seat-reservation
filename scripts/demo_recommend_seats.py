#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_DATASET = DATA_DIR / "座位推荐评分数据集.xlsx"
DEFAULT_OUTPUT_DIR = DATA_DIR / "座位推荐示例结果"
SHEET_NAME = "座位推荐数据"

SCENE_ALIASES = {
    "focus": "深度专注型",
    "comfort": "舒适久学型",
    "device": "设备作业型",
    "collab": "开放协作型",
    "深度专注型": "深度专注型",
    "舒适久学型": "舒适久学型",
    "设备作业型": "设备作业型",
    "开放协作型": "开放协作型",
}

SCENE_WEIGHTS = {
    "深度专注型": {"专注最终分": 0.65, "舒适最终分": 0.15, "设备最终分": 0.10, "协作最终分": 0.10},
    "舒适久学型": {"专注最终分": 0.20, "舒适最终分": 0.55, "设备最终分": 0.10, "协作最终分": 0.15},
    "设备作业型": {"专注最终分": 0.10, "舒适最终分": 0.15, "设备最终分": 0.60, "协作最终分": 0.15},
    "开放协作型": {"专注最终分": 0.10, "舒适最终分": 0.10, "设备最终分": 0.15, "协作最终分": 0.65},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Demo seat recommendation based on the scored seat dataset."
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATASET,
        help="Path to the scored seat dataset workbook.",
    )
    parser.add_argument(
        "--scene",
        type=str,
        default="focus",
        help="Target learning scene. Use focus/comfort/device/collab or the Chinese labels.",
    )
    parser.add_argument("--top-k", type=int, default=10, help="Number of seats to export.")
    parser.add_argument("--need-power", action="store_true", help="Prefer seats with power outlets.")
    parser.add_argument("--need-window", action="store_true", help="Prefer seats near windows.")
    parser.add_argument("--need-quiet", action="store_true", help="Prefer quiet seats.")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional path for the exported recommendation workbook.",
    )
    return parser.parse_args()


def autosize_workbook(path: Path) -> None:
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        for column_cells in sheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(value))
            sheet.column_dimensions[column_letter].width = min(max_length + 2, 34)
    workbook.save(path)


def resolve_scene(scene_arg: str) -> str:
    if scene_arg not in SCENE_ALIASES:
        raise ValueError(f"Unsupported scene: {scene_arg}")
    return SCENE_ALIASES[scene_arg]


def build_output_path(scene_label: str, top_k: int, explicit_path: Path | None) -> Path:
    if explicit_path is not None:
        explicit_path.parent.mkdir(parents=True, exist_ok=True)
        return explicit_path
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_OUTPUT_DIR / f"前{top_k}个{scene_label}推荐座位.xlsx"


def main() -> None:
    args = parse_args()
    dataset_path = args.data.resolve()
    scene_label = resolve_scene(args.scene)

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    df = pd.read_excel(dataset_path, sheet_name=SHEET_NAME)
    weights = SCENE_WEIGHTS[scene_label]
    df["场景匹配分"] = sum(df[column] * weight for column, weight in weights.items())

    df["偏好奖励分"] = 0.0
    if args.need_power:
        df["偏好奖励分"] += df["是否有插座"].map({1: 0.4, 0: -0.5})
    if args.need_window:
        df["偏好奖励分"] += df["是否靠窗"].map({1: 0.3, 0: -0.2})
    if args.need_quiet:
        df["偏好奖励分"] += df["是否安静"].map({1: 0.35, 0: -0.4})

    df["综合推荐分"] = (df["场景匹配分"] + df["偏好奖励分"]).round(2)
    df = df.sort_values(by=["综合推荐分", "主次分差"], ascending=[False, False]).reset_index(drop=True)

    export_columns = [
        "座位编号",
        "桌组编号",
        "区域编码",
        "推荐主标签",
        "综合推荐分",
        "场景匹配分",
        "偏好奖励分",
        "专注最终分",
        "舒适最终分",
        "设备最终分",
        "协作最终分",
        "是否有插座",
        "是否靠窗",
        "是否安静",
        "是否靠近通道",
        "推荐说明",
    ]
    top_df = df.loc[: args.top_k - 1, export_columns].copy()

    output_path = build_output_path(scene_label, args.top_k, args.output)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        top_df.to_excel(writer, sheet_name="推荐结果", index=False)
        pd.DataFrame(
            [
                ("目标场景", scene_label),
                ("Top-K", args.top_k),
                ("是否偏好插座", "是" if args.need_power else "否"),
                ("是否偏好靠窗", "是" if args.need_window else "否"),
                ("是否偏好安静", "是" if args.need_quiet else "否"),
                ("数据源", str(dataset_path)),
            ],
            columns=["字段", "值"],
        ).to_excel(writer, sheet_name="参数说明", index=False)
    autosize_workbook(output_path)

    print(f"Scene: {scene_label}")
    print(f"Output: {output_path}")
    print("")
    print(top_df.to_string(index=False))


if __name__ == "__main__":
    main()
