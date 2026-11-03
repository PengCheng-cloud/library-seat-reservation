#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import numpy as np
import openpyxl
import pandas as pd
from scipy.io import savemat


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_OUTPUT_ROOT = ROOT.parent
BASE_DATASET_PATH = DATA_DIR / "seat_classification_dataset_cn.xlsx"
MASTER_PATH = DATA_DIR / "seat_master.json"

BASE_COLUMN_NAMES = [
    "seat_id",
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
    "single_label",
]

FEATURE_COLUMNS = [
    "has_power",
    "near_window",
    "is_quiet",
    "near_restroom",
    "near_bookshelf",
    "near_corridor",
    "seat_capacity",
    "seat_position_ratio",
    "edge_position",
    "zone_north",
    "zone_west",
    "zone_east",
    "zone_south",
]

FEATURE_NAME_MAP = {
    "has_power": "是否有插座",
    "near_window": "是否靠窗",
    "is_quiet": "是否安静",
    "near_restroom": "是否靠近卫生间",
    "near_bookshelf": "是否靠近书架",
    "near_corridor": "是否靠近通道",
    "seat_capacity": "座位容量",
    "seat_position_ratio": "桌组内位置比例",
    "edge_position": "是否边缘位置",
    "zone_north": "是否北侧区域",
    "zone_west": "是否西侧区域",
    "zone_east": "是否东侧区域",
    "zone_south": "是否南侧区域",
}

LABEL_NAME_MAP = {
    "focus": "深度专注型",
    "comfort": "舒适久学型",
    "device": "设备作业型",
    "collab": "开放协作型",
}

SINGLE_TO_MULTI_PRIOR = {
    "专注静学型": "focus",
    "采光舒适型": "comfort",
    "便捷充电型": "device",
    "协作交流型": "collab",
}

FEATURE_DICTIONARY = [
    ("是否有插座", "二值", "座位本身是否提供充电插座"),
    ("是否靠窗", "二值", "座位是否位于窗边或临窗位置"),
    ("是否安静", "二值", "座位是否位于相对安静区域"),
    ("是否靠近卫生间", "二值", "是否靠近卫生间等服务点"),
    ("是否靠近书架", "二值", "是否靠近书架，适合查阅纸质资料"),
    ("是否靠近通道", "二值", "是否靠近主通道或人流较多位置"),
    ("座位容量", "离散", "该座位所在桌组可容纳的人数"),
    ("桌组内位置比例", "连续", "座位在本桌组中的相对位置，越靠前越接近 0"),
    ("是否边缘位置", "二值", "是否位于桌组边缘或靠两端的位置"),
    ("是否北侧区域", "二值", "是否位于北侧分区"),
    ("是否西侧区域", "二值", "是否位于西侧分区"),
    ("是否东侧区域", "二值", "是否位于东侧分区"),
    ("是否南侧区域", "二值", "是否位于南侧区域"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a cleaner, more natural multi-label seat dataset based on the sports template style."
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory where the desktop bundle folder will be created.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=20260415,
        help="Random seed used for reproducible score perturbation.",
    )
    return parser.parse_args()


def autosize_workbook(path: Path) -> None:
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        if sheet.max_row > 1 and sheet.max_column > 1:
            sheet.freeze_panes = "A2"
        for column_cells in sheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(value))
            sheet.column_dimensions[column_letter].width = min(max_length + 2, 28)
    workbook.save(path)


def ensure_input_files() -> None:
    if not BASE_DATASET_PATH.exists():
        raise FileNotFoundError(f"Base dataset not found: {BASE_DATASET_PATH}")
    if not MASTER_PATH.exists():
        raise FileNotFoundError(f"Seat master file not found: {MASTER_PATH}")


def load_base_dataset() -> pd.DataFrame:
    df = pd.read_excel(BASE_DATASET_PATH, sheet_name="dataset")
    if len(df.columns) != len(BASE_COLUMN_NAMES):
        raise ValueError(
            f"Unexpected base dataset schema. Expected {len(BASE_COLUMN_NAMES)} columns, got {len(df.columns)}."
        )
    df.columns = BASE_COLUMN_NAMES
    return df


def load_master_dataset() -> pd.DataFrame:
    payload = json.loads(MASTER_PATH.read_text(encoding="utf-8"))
    seats = payload["seats"]
    master_df = pd.DataFrame(seats)[
        ["seatId", "tableGroupCode", "zoneCode", "seatSeq", "seatCapacity"]
    ].copy()
    master_df.columns = ["seat_id", "group_code", "zone_code", "seat_seq", "seat_capacity"]
    return master_df


def build_clean_feature_frame(base_df: pd.DataFrame, master_df: pd.DataFrame) -> pd.DataFrame:
    df = base_df.merge(master_df, on="seat_id", how="left", validate="one_to_one")
    if df[["group_code", "zone_code", "seat_seq", "seat_capacity"]].isna().any().any():
        raise ValueError("Failed to join all seats with master metadata.")

    for column in BASE_COLUMN_NAMES[1:-1]:
        df[column] = pd.to_numeric(df[column], errors="raise").astype(int)

    group_size = df.groupby("group_code").size().rename("group_size")
    df = df.join(group_size, on="group_code")
    df["seat_capacity"] = pd.to_numeric(df["seat_capacity"], errors="raise").astype(int)
    df["seat_seq"] = pd.to_numeric(df["seat_seq"], errors="raise").astype(int)
    df["seat_position_ratio"] = (df["seat_seq"] / df["group_size"]).round(4)
    df["edge_position"] = ((df["seat_position_ratio"] <= 0.25) | (df["seat_position_ratio"] >= 0.75)).astype(int)
    df["zone_south"] = ((df["zone_south_inner"] == 1) | (df["zone_south_outer"] == 1)).astype(int)
    return df


def indicator(series: pd.Series) -> pd.Series:
    return series.astype(float)


def build_label_scores(df: pd.DataFrame, seed: int) -> pd.DataFrame:
    prior_series = df["single_label"].map(SINGLE_TO_MULTI_PRIOR)
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 0.18, size=(len(df), 4))

    focus_score = (
        1.10 * df["is_quiet"]
        + 0.70 * (1 - df["near_corridor"])
        + 0.55 * (1 - df["near_restroom"])
        + 0.35 * df["near_bookshelf"]
        + 0.25 * df["zone_north"]
        + 0.20 * df["zone_west"]
        - 0.20 * indicator(df["seat_capacity"] >= 8)
        + 0.45 * indicator(prior_series == "focus")
        + noise[:, 0]
    )

    comfort_score = (
        1.10 * df["near_window"]
        + 0.35 * df["is_quiet"]
        + 0.20 * (1 - df["near_restroom"])
        + 0.35 * df["edge_position"]
        + 0.45 * indicator(prior_series == "comfort")
        + noise[:, 1]
    )

    device_score = (
        1.20 * df["has_power"]
        + 0.35 * df["near_corridor"]
        + 0.20 * indicator(df["seat_capacity"] >= 8)
        + 0.20 * df["zone_east"]
        + 0.20 * df["zone_south"]
        + 0.45 * indicator(prior_series == "device")
        + noise[:, 2]
    )

    collab_score = (
        1.05 * indicator(df["seat_capacity"] >= 8)
        + 0.45 * df["near_corridor"]
        + 0.35 * df["zone_south"]
        + 0.20 * df["zone_east"]
        + 0.25 * (1 - df["is_quiet"])
        + 0.45 * indicator(prior_series == "collab")
        + noise[:, 3]
    )

    return pd.DataFrame(
        {
            "focus": focus_score,
            "comfort": comfort_score,
            "device": device_score,
            "collab": collab_score,
        },
        index=df.index,
    )


def scores_to_labels(score_df: pd.DataFrame) -> pd.DataFrame:
    labels = []
    for _, row in score_df.iterrows():
        ordered = row.sort_values(ascending=False)
        active = [ordered.index[0]]

        if ordered.iloc[1] >= 1.15 and (ordered.iloc[0] - ordered.iloc[1]) <= 0.55:
            active.append(ordered.index[1])

        if ordered.iloc[2] >= 1.45 and (ordered.iloc[1] - ordered.iloc[2]) <= 0.25:
            active.append(ordered.index[2])

        label_row = {column: int(column in active) for column in score_df.columns}
        labels.append(label_row)

    return pd.DataFrame(labels, index=score_df.index).astype(int)


def build_output_frames(feature_source_df: pd.DataFrame, score_df: pd.DataFrame, label_df: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    features_output = feature_source_df[FEATURE_COLUMNS].astype(float).rename(columns=FEATURE_NAME_MAP)
    labels_output = label_df.rename(columns=LABEL_NAME_MAP).astype(int)

    active_label_names: List[str] = []
    for _, row in labels_output.iterrows():
        active = [column for column, value in row.items() if int(value) == 1]
        active_label_names.append("、".join(active))

    dataset_output = pd.DataFrame(
        {
            "样本编号": np.arange(1, len(feature_source_df) + 1),
            "座位编号": feature_source_df["seat_id"],
            "桌组编号": feature_source_df["group_code"],
            "区域编码": feature_source_df["zone_code"],
            "原始单标签": feature_source_df["single_label"],
        }
    )
    dataset_output = pd.concat([dataset_output, features_output, labels_output], axis=1)
    dataset_output["激活标签数"] = labels_output.sum(axis=1)
    dataset_output["激活标签"] = active_label_names

    label_summary = pd.DataFrame(
        {
            "标签": labels_output.columns,
            "正样本数": [int(labels_output[column].sum()) for column in labels_output.columns],
            "正样本比例": [round(float(labels_output[column].mean()), 4) for column in labels_output.columns],
        }
    )

    cardinality = labels_output.sum(axis=1).value_counts().sort_index()
    cardinality_summary = pd.DataFrame(
        {
            "每条样本激活标签数": cardinality.index.astype(int),
            "样本数量": cardinality.values.astype(int),
            "样本占比": np.round(cardinality.values / len(labels_output), 4),
        }
    )

    score_output = score_df.rename(columns={key: f"{value}得分" for key, value in LABEL_NAME_MAP.items()}).round(4)
    score_reference = pd.DataFrame(
        {
            "样本编号": np.arange(1, len(feature_source_df) + 1),
            "座位编号": feature_source_df["seat_id"],
            **score_output.to_dict(orient="list"),
            **labels_output.to_dict(orient="list"),
        }
    )

    feature_dict = pd.DataFrame(FEATURE_DICTIONARY, columns=["特征名", "特征类型", "说明"])
    return {
        "features": features_output,
        "labels": labels_output,
        "dataset": dataset_output,
        "label_summary": label_summary,
        "cardinality_summary": cardinality_summary,
        "score_reference": score_reference,
        "feature_dict": feature_dict,
    }


def save_excel(path: Path, sheets: Dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for sheet_name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    autosize_workbook(path)


def save_combined_workbook(path: Path, frames: Dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        frames["dataset"].to_excel(writer, sheet_name="dataset", index=False)
        frames["feature_dict"].to_excel(writer, sheet_name="feature_dict", index=False)
        frames["label_summary"].to_excel(writer, sheet_name="label_summary", index=False)
        frames["cardinality_summary"].to_excel(writer, sheet_name="cardinality", index=False)
        frames["score_reference"].to_excel(writer, sheet_name="score_ref", index=False)
    autosize_workbook(path)


def save_mat_file(path: Path, features_df: pd.DataFrame, labels_df: pd.DataFrame) -> None:
    savemat(
        path,
        {
            "X": features_df.values.astype(np.float64),
            "Y": labels_df.values.astype(np.float64),
        },
    )


def write_readme(bundle_dir: Path, frames: Dict[str, pd.DataFrame]) -> None:
    labels_df = frames["labels"]
    label_counts = labels_df.sum()
    lines = [
        "图书馆座位自然多标签数据集说明",
        "=" * 32,
        "",
        "这版数据集按照你给的运动示例思路重新整理：",
        "1. 只保留直观、好解释的座位特征，不再加入太多聚合率特征。",
        "2. 标签仍然是多标签 one-hot 格式，但规则更自然，主要围绕专注、舒适、设备、协作四类场景。",
        "3. 每条样本通常激活 1-2 个标签，少量样本激活 3 个标签。",
        "",
        f"样本数：{len(frames['features'])}",
        f"特征数：{frames['features'].shape[1]}",
        f"标签数：{frames['labels'].shape[1]}",
        "",
        "标签分布：",
    ]
    for column in labels_df.columns:
        lines.append(f"- {column}：{int(label_counts[column])} 条，占比 {label_counts[column] / len(labels_df):.4%}")

    lines.extend(
        [
            "",
            "文件说明：",
            "- features.xlsx：简化后的特征表。",
            "- labels.xlsx：多标签 one-hot 标签表。",
            "- output.mat：由 features 和 labels 转换得到的 MAT 文件。",
            "- natural_multilabel_seat_dataset.xlsx：总览工作簿，方便检查样本、特征和标签。",
        ]
    )
    (bundle_dir / "README_说明.txt").write_text("\n".join(lines), encoding="utf-8")


def make_bundle_dir(output_root: Path) -> Path:
    output_root.mkdir(parents=True, exist_ok=True)
    folder_name = f"图书馆座位自然多标签数据集_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    bundle_dir = output_root / folder_name
    bundle_dir.mkdir(parents=True, exist_ok=False)
    return bundle_dir


def print_summary(bundle_dir: Path, frames: Dict[str, pd.DataFrame]) -> None:
    labels_df = frames["labels"]
    print(f"Bundle directory: {bundle_dir}")
    print(f"Features shape: {frames['features'].shape}")
    print(f"Labels shape: {labels_df.shape}")
    print("Label distribution:")
    for column in labels_df.columns:
        print(f"  {column}: {int(labels_df[column].sum())}")
    print("Cardinality distribution:")
    cardinality = labels_df.sum(axis=1).value_counts().sort_index()
    for count, total in cardinality.items():
        print(f"  {int(count)} labels: {int(total)}")


def main() -> None:
    args = parse_args()
    ensure_input_files()

    base_df = load_base_dataset()
    master_df = load_master_dataset()
    clean_df = build_clean_feature_frame(base_df, master_df)
    score_df = build_label_scores(clean_df, seed=args.seed)
    label_df = scores_to_labels(score_df)
    frames = build_output_frames(clean_df, score_df, label_df)

    bundle_dir = make_bundle_dir(args.output_root.resolve())
    features_path = bundle_dir / "features.xlsx"
    labels_path = bundle_dir / "labels.xlsx"
    combined_path = bundle_dir / "natural_multilabel_seat_dataset.xlsx"
    mat_path = bundle_dir / "output.mat"

    save_excel(features_path, {"Sheet1": frames["features"]})
    save_excel(labels_path, {"Sheet1": frames["labels"]})
    save_combined_workbook(combined_path, frames)
    save_mat_file(mat_path, frames["features"], frames["labels"])
    write_readme(bundle_dir, frames)
    print_summary(bundle_dir, frames)


if __name__ == "__main__":
    main()
