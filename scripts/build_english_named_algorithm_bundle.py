#!/usr/bin/env python3
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd
from scipy.io import savemat

import build_integrated_group_and_seat_dataset as integrated_builder


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_DIR = ROOT.parent

FEATURE_NAME_MAP = {
    "单桌容量": "seat_capacity",
    "靠窗比例": "window_ratio",
    "插座比例": "power_ratio",
    "安静比例": "quiet_ratio",
    "通道比例": "corridor_ratio",
    "卫生间临近比例": "restroom_ratio",
    "茶水间临近比例": "pantry_ratio",
    "空调临近比例": "ac_ratio",
    "书架临近比例": "bookshelf_ratio",
    "日照比例": "sunlight_ratio",
    "是否北侧区域": "zone_north",
    "是否南侧外圈": "zone_south_outer",
}

LABEL_NAME_MAP = {
    "深度专注型": "focus",
    "舒适久学型": "comfort",
    "设备作业型": "device",
    "开放协作型": "collab",
}

LABEL_EN_TO_CN = {value: key for key, value in LABEL_NAME_MAP.items()}


def autosize_workbook(path: Path) -> None:
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        for column_cells in sheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(value))
            sheet.column_dimensions[column_letter].width = min(max_length + 2, 40)
    workbook.save(path)


def make_output_dir() -> Path:
    folder_name = f"seat_group_algorithm_bundle_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    output_dir = DESKTOP_DIR / folder_name
    output_dir.mkdir(parents=True, exist_ok=False)
    return output_dir


def label_to_english(label: str) -> str:
    return LABEL_NAME_MAP.get(label, label)


def export_simple_excel(path: Path, df: pd.DataFrame) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Sheet1", index=False)
    autosize_workbook(path)


def write_excel_to_mat_script(output_dir: Path) -> None:
    script_text = """#!/usr/bin/env python3
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import savemat


BASE_DIR = Path(__file__).resolve().parent
FEATURES_PATH = BASE_DIR / "features.xlsx"
LABELS_PATH = BASE_DIR / "labels.xlsx"
OUTPUT_PATH = BASE_DIR / "output.mat"


def main() -> None:
    features_df = pd.read_excel(FEATURES_PATH)
    labels_df = pd.read_excel(LABELS_PATH)
    X = features_df.values.astype(np.float64)
    Y = labels_df.values.astype(np.float64)
    savemat(OUTPUT_PATH, {"X": X, "Y": Y})
    print(f"Saved: {OUTPUT_PATH}")
    print(f"X shape: {X.shape}")
    print(f"Y shape: {Y.shape}")


if __name__ == "__main__":
    main()
"""
    (output_dir / "excel_to_mat.py").write_text(script_text, encoding="utf-8")


def build_dictionary_frames(feature_df: pd.DataFrame, label_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    feature_rows = []
    for zh_name, en_name in FEATURE_NAME_MAP.items():
        feature_rows.append(
            {
                "english_name": en_name,
                "chinese_name": zh_name,
                "meaning": {
                    "seat_capacity": "桌组是4人桌还是8人桌。",
                    "window_ratio": "这个桌组中靠窗座位所占比例。",
                    "power_ratio": "这个桌组中有插座座位所占比例。",
                    "quiet_ratio": "这个桌组中安静座位所占比例。",
                    "corridor_ratio": "这个桌组中靠近通道座位所占比例。",
                    "restroom_ratio": "这个桌组中靠近卫生间座位所占比例。",
                    "pantry_ratio": "这个桌组中靠近茶水间座位所占比例。",
                    "ac_ratio": "这个桌组中靠近空调座位所占比例。",
                    "bookshelf_ratio": "这个桌组中靠近书架座位所占比例。",
                    "sunlight_ratio": "这个桌组中有日照座位所占比例。",
                    "zone_north": "桌组是否位于北侧区域。",
                    "zone_south_outer": "桌组是否位于南侧外圈。",
                }[en_name],
            }
        )

    label_rows = []
    for en_name in label_df.columns:
        label_rows.append(
            {
                "english_name": en_name,
                "chinese_name": LABEL_EN_TO_CN[en_name],
                "meaning": {
                    "focus": "深度专注型，适合沉浸自习。",
                    "comfort": "舒适久学型，适合长时间阅读和久坐学习。",
                    "device": "设备作业型，适合带电脑和短时作业。",
                    "collab": "开放协作型，适合讨论与结伴学习。",
                }[en_name],
            }
        )

    return pd.DataFrame(feature_rows), pd.DataFrame(label_rows)


def export_dataset_workbook(
    path: Path,
    group_df: pd.DataFrame,
    seat_df: pd.DataFrame,
    feature_df: pd.DataFrame,
    label_df: pd.DataFrame,
    sample_index_df: pd.DataFrame,
    feature_dict_df: pd.DataFrame,
    label_dict_df: pd.DataFrame,
) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        group_df.to_excel(writer, sheet_name="group_training_data", index=False)
        seat_df.to_excel(writer, sheet_name="seat_recommendation_data", index=False)
        feature_df.to_excel(writer, sheet_name="features", index=False)
        label_df.to_excel(writer, sheet_name="labels", index=False)
        sample_index_df.to_excel(writer, sheet_name="sample_index", index=False)
        feature_dict_df.to_excel(writer, sheet_name="feature_dictionary", index=False)
        label_dict_df.to_excel(writer, sheet_name="label_dictionary", index=False)
    autosize_workbook(path)


def export_mat(path: Path, feature_df: pd.DataFrame, label_df: pd.DataFrame) -> None:
    savemat(
        path,
        {
            "X": feature_df.to_numpy(dtype=np.float64),
            "Y": label_df.to_numpy(dtype=np.float64),
        },
    )


def write_readme(
    output_dir: Path,
    feature_df: pd.DataFrame,
    label_df: pd.DataFrame,
    sample_index_df: pd.DataFrame,
) -> None:
    label_counts = label_df.sum().to_dict()
    active_count_distribution = label_df.sum(axis=1).value_counts().sort_index().to_dict()
    lines = [
        "Seat Group Algorithm Bundle",
        "=" * 32,
        "",
        "This folder was rebuilt from the latest seat recommendation data in the project.",
        "",
        f"sample_count: {len(feature_df)}",
        f"feature_count: {feature_df.shape[1]}",
        f"label_count: {label_df.shape[1]}",
        "",
        "files:",
        "- features.xlsx: numeric feature matrix for algorithm training.",
        "- labels.xlsx: multi-label one-hot target matrix.",
        "- output.mat: MAT file with X and Y.",
        "- sample_index.xlsx: metadata for each table-group sample.",
        "- integrated_dataset.xlsx: combined workbook for reference.",
        "- excel_to_mat.py: rebuild output.mat after editing features or labels.",
        "- run_mat_sklearn_classification_suite.py: run classic sklearn multi-label classifiers.",
        "",
        "active_label_distribution:",
    ]
    for active_count, sample_count in active_count_distribution.items():
        lines.append(f"- {active_count} active labels: {sample_count}")
    lines.extend(["", "label_counts:"])
    for label_name, count in label_counts.items():
        lines.append(f"- {label_name}: {int(count)}")
    lines.extend(
        [
            "",
            "sample_index columns:",
            "- sample_id: row id used by this bundle.",
            "- group_id / zone_code: table-group identity for recommendation mapping.",
            "- final_label / secondary_label: single-label scene ranking converted from the scored workbook.",
            "- final_label_cn / secondary_label_cn: Chinese labels for direct reading.",
            "",
            "recommended next step:",
            "Run: python run_mat_sklearn_classification_suite.py --mat-path output.mat --output-root .",
        ]
    )
    (output_dir / "README.txt").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    output_dir = make_output_dir()

    integrated_builder.rebuild_upstream_sources()
    group_df, seat_df = integrated_builder.load_scored_workbook()
    core_feature_df = integrated_builder.build_core_feature_df(group_df)
    multilabel_df = integrated_builder.build_multilabel_df(group_df)
    singlelabel_df = integrated_builder.build_singlelabel_df(group_df)

    feature_df = core_feature_df[integrated_builder.CORE_FEATURE_COLUMNS].rename(columns=FEATURE_NAME_MAP).copy()
    label_df = multilabel_df[list(LABEL_NAME_MAP.keys())].rename(columns=LABEL_NAME_MAP).astype(int).copy()

    sample_index_df = pd.DataFrame(
        {
            "sample_id": np.arange(1, len(group_df) + 1, dtype=int),
            "group_id": group_df["桌组编号"].astype(str),
            "zone_code": group_df["区域编码"].astype(str),
            "zone_name": group_df["区域名称"].astype(str),
            "zone_band": group_df["区域方向"].astype(str),
            "final_label": singlelabel_df["最终场景标签"].map(label_to_english),
            "secondary_label": singlelabel_df["次优场景标签"].map(label_to_english),
            "confidence": singlelabel_df["标签置信度"].astype(str),
            "final_label_cn": singlelabel_df["最终场景标签"].astype(str),
            "secondary_label_cn": singlelabel_df["次优场景标签"].astype(str),
        }
    )

    feature_dict_df, label_dict_df = build_dictionary_frames(feature_df, label_df)

    export_simple_excel(output_dir / "features.xlsx", feature_df)
    export_simple_excel(output_dir / "labels.xlsx", label_df)
    export_simple_excel(output_dir / "sample_index.xlsx", sample_index_df)
    export_simple_excel(output_dir / "feature_dictionary.xlsx", feature_dict_df)
    export_simple_excel(output_dir / "label_dictionary.xlsx", label_dict_df)
    export_dataset_workbook(
        output_dir / "integrated_dataset.xlsx",
        group_df=group_df,
        seat_df=seat_df,
        feature_df=feature_df,
        label_df=label_df,
        sample_index_df=sample_index_df,
        feature_dict_df=feature_dict_df,
        label_dict_df=label_dict_df,
    )
    export_mat(output_dir / "output.mat", feature_df, label_df)
    write_excel_to_mat_script(output_dir)
    write_readme(output_dir, feature_df, label_df, sample_index_df)

    shutil.copy2(ROOT / "scripts" / "run_mat_sklearn_classification_suite.py", output_dir / "run_mat_sklearn_classification_suite.py")
    shutil.copy2(__file__, output_dir / "build_english_named_algorithm_bundle.py")

    print(f"Output directory: {output_dir}")
    print(f"features.xlsx shape: {feature_df.shape}")
    print(f"labels.xlsx shape: {label_df.shape}")
    print("Label sums:")
    for column in label_df.columns:
        print(f"  {column}: {int(label_df[column].sum())}")
    print("Generated files:")
    for path in sorted(output_dir.iterdir()):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
