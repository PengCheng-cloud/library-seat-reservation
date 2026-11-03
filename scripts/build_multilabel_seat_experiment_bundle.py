#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List

import numpy as np
import openpyxl
import pandas as pd
from scipy.io import savemat
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, hamming_loss, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_OUTPUT_ROOT = ROOT.parent
BASE_DATASET_PATH = DATA_DIR / "seat_classification_dataset_cn.xlsx"
MASTER_PATH = DATA_DIR / "seat_master.json"

LABEL_NAME_MAP = {
    "focus": "深度专注型",
    "comfort": "舒适久学型",
    "device": "设备作业型",
    "collab": "开放协作型",
}

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

FEATURE_NAME_MAP = {
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
    "seat_capacity": "座位容量",
    "seat_seq": "桌组内座位序号",
    "seat_seq_norm": "桌组内序号归一化",
    "seat_seq_even": "座位序号是否偶数",
    "grid_number_scaled": "区域网格编号归一化",
    "group_size": "桌组规模",
    "group_size_scaled": "桌组规模归一化",
    "group_has_power": "桌组插座率",
    "group_near_window": "桌组靠窗率",
    "group_is_quiet": "桌组安静率",
    "group_near_corridor": "桌组通道率",
    "group_sunlight_yes": "桌组日照率",
    "group_near_bookshelf": "桌组书架邻近率",
    "zone_has_power": "分区插座率",
    "zone_near_window": "分区靠窗率",
    "zone_is_quiet": "分区安静率",
    "zone_near_corridor": "分区通道率",
    "zone_sunlight_yes": "分区日照率",
}

FEATURE_COLUMNS = list(FEATURE_NAME_MAP.keys())

FEATURE_DICTIONARY = [
    ("是否有插座", "二值", "座位本身是否提供充电插座"),
    ("是否靠窗", "二值", "座位是否位于窗边或临窗位置"),
    ("是否安静", "二值", "座位是否位于相对安静区域"),
    ("是否靠近卫生间", "二值", "是否靠近卫生间等服务点"),
    ("是否靠近茶水间", "二值", "是否靠近茶水区或饮水点"),
    ("是否靠近空调", "二值", "是否处于空调影响更明显的位置"),
    ("是否靠近书架", "二值", "是否靠近书架，适合查阅纸质资料"),
    ("是否4人桌", "二值", "座位是否属于 4 人桌"),
    ("是否8人桌", "二值", "座位是否属于 8 人桌"),
    ("是否靠近通道", "二值", "是否靠近主通道或人流较多位置"),
    ("是否有日照", "二值", "是否为日照更明显座位"),
    ("是否无日照", "二值", "是否为背光或无日照座位"),
    ("是否北侧区域", "二值", "是否位于北侧分区"),
    ("是否西侧区域", "二值", "是否位于西侧分区"),
    ("是否东侧区域", "二值", "是否位于东侧分区"),
    ("是否南侧内圈", "二值", "是否位于南侧内圈分区"),
    ("是否南侧外圈", "二值", "是否位于南侧外圈分区"),
    ("座位容量", "离散", "座位所属桌组的容纳人数"),
    ("桌组内座位序号", "离散", "座位在本桌组中的顺序"),
    ("桌组内序号归一化", "连续", "座位序号除以桌组规模后的相对位置"),
    ("座位序号是否偶数", "二值", "用于模拟左右侧、边缘位等隐含位置差异"),
    ("区域网格编号归一化", "连续", "区域编号的相对位置强度"),
    ("桌组规模", "离散", "当前桌组总座位数"),
    ("桌组规模归一化", "连续", "桌组规模的归一化结果"),
    ("桌组插座率", "连续", "同桌组内插座座位占比"),
    ("桌组靠窗率", "连续", "同桌组内靠窗座位占比"),
    ("桌组安静率", "连续", "同桌组内安静座位占比"),
    ("桌组通道率", "连续", "同桌组内靠近通道座位占比"),
    ("桌组日照率", "连续", "同桌组内有日照座位占比"),
    ("桌组书架邻近率", "连续", "同桌组内靠近书架座位占比"),
    ("分区插座率", "连续", "同区域内插座座位占比"),
    ("分区靠窗率", "连续", "同区域内靠窗座位占比"),
    ("分区安静率", "连续", "同区域内安静座位占比"),
    ("分区通道率", "连续", "同区域内靠近通道座位占比"),
    ("分区日照率", "连续", "同区域内有日照座位占比"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a reconstructed multi-label seat dataset bundle for algorithm comparison."
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
        default=20260414,
        help="Random seed used for reproducible score perturbation and benchmark split.",
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
        ["seatId", "tableGroupCode", "zoneCode", "seatSeq", "gridNumber", "seatCapacity"]
    ].copy()
    master_df.columns = ["seat_id", "group_code", "zone_code", "seat_seq", "grid_number", "seat_capacity"]
    return master_df


def indicator(series: pd.Series) -> pd.Series:
    return series.astype(float)


def build_enriched_dataset(base_df: pd.DataFrame, master_df: pd.DataFrame) -> pd.DataFrame:
    df = base_df.merge(master_df, on="seat_id", how="left", validate="one_to_one")
    if df[["group_code", "zone_code", "seat_seq", "grid_number", "seat_capacity"]].isna().any().any():
        raise ValueError("Failed to join all seat records with master metadata.")

    binary_columns = BASE_COLUMN_NAMES[1:-1]
    for column in binary_columns:
        df[column] = pd.to_numeric(df[column], errors="raise").astype(int)

    group_stats = df.groupby("group_code")[binary_columns].mean().add_prefix("group_")
    group_size = df.groupby("group_code").size().rename("group_size")
    zone_stats = (
        df.groupby("zone_code")[["has_power", "near_window", "is_quiet", "near_corridor", "sunlight_yes"]]
        .mean()
        .add_prefix("zone_")
    )

    df = df.join(group_stats, on="group_code").join(group_size, on="group_code").join(zone_stats, on="zone_code")
    df["seat_capacity"] = pd.to_numeric(df["seat_capacity"], errors="raise").astype(int)
    df["seat_seq"] = pd.to_numeric(df["seat_seq"], errors="raise").astype(int)
    df["grid_number"] = pd.to_numeric(df["grid_number"], errors="raise").astype(int)
    df["seat_seq_norm"] = df["seat_seq"] / df["group_size"]
    df["seat_seq_even"] = (df["seat_seq"] % 2 == 0).astype(int)
    df["grid_number_scaled"] = df["grid_number"] / df["grid_number"].max()
    df["group_size_scaled"] = df["group_size"] / df["group_size"].max()
    return df


def generate_multilabel_targets(df: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    focus_score = (
        1.25 * df["is_quiet"]
        + 0.75 * (1 - df["near_corridor"])
        + 0.60 * (1 - df["near_restroom"])
        + 0.45 * (1 - df["near_pantry"])
        + 0.35 * df["near_bookshelf"]
        + 0.35 * df["zone_north"]
        + 0.25 * df["zone_west"]
        + 0.40 * df["group_is_quiet"]
        + 0.35 * (1 - df["group_near_corridor"])
        - 0.30 * df["seat_type_8"]
        + 1.00
        * indicator(
            (df["is_quiet"] == 1) & (df["near_corridor"] == 0) & (df["group_is_quiet"] > 0.75)
        )
        + 0.55
        * indicator(
            ((df["zone_north"] == 1) | (df["zone_west"] == 1))
            & ((df["near_bookshelf"] == 1) | (df["seat_seq_norm"] < 0.40))
        )
    )

    comfort_score = (
        1.15 * df["near_window"]
        + 0.95 * df["sunlight_yes"]
        + 0.40 * df["is_quiet"]
        + 0.25 * (1 - df["near_corridor"])
        + 0.35 * df["group_near_window"]
        + 0.30 * df["group_sunlight_yes"]
        + 0.20 * df["zone_near_window"]
        - 0.20 * df["near_restroom"]
        + 1.10 * indicator((df["near_window"] == 1) & (df["sunlight_yes"] == 1))
        + 0.55
        * indicator(
            (df["near_window"] == 1)
            & ((df["seat_seq_norm"] <= 0.25) | (df["seat_seq_norm"] >= 0.75))
        )
    )

    device_score = (
        1.15 * df["has_power"]
        + 0.55 * df["near_ac"]
        + 0.45 * df["near_corridor"]
        + 0.30 * df["near_pantry"]
        + 0.20 * df["near_restroom"]
        + 0.30 * df["group_has_power"]
        + 0.20 * df["group_near_corridor"]
        + 0.20 * df["zone_has_power"]
        + 1.15
        * indicator(
            (df["has_power"] == 1)
            & ((df["near_ac"] == 1) | (df["near_corridor"] == 1) | (df["near_pantry"] == 1))
        )
        + 0.40 * indicator((df["has_power"] == 1) & (df["seat_seq_even"] == 1))
        + 0.20 * df["zone_east"]
        + 0.20 * df["zone_south_outer"]
    )

    collab_score = (
        1.00 * df["seat_type_8"]
        + 0.50 * df["near_corridor"]
        + 0.40 * df["zone_south_inner"]
        + 0.35 * df["zone_south_outer"]
        + 0.20 * df["zone_east"]
        + 0.35 * df["group_size_scaled"]
        + 0.25 * df["group_seat_type_8"]
        + 0.25 * (1 - df["is_quiet"])
        - 0.15 * df["near_window"]
        + 1.15
        * indicator(
            (df["seat_type_8"] == 1)
            & (
                (df["zone_south_inner"] == 1)
                | (df["zone_south_outer"] == 1)
                | (df["group_size_scaled"] > 0.70)
            )
        )
        + 0.45 * indicator((df["near_corridor"] == 1) & (df["grid_number_scaled"] > 0.55))
    )

    rng = np.random.default_rng(seed)
    score_noise = rng.normal(0, 0.70, size=(len(df), 4))

    scores = pd.DataFrame(
        {
            "focus": focus_score + score_noise[:, 0],
            "comfort": comfort_score + score_noise[:, 1],
            "device": device_score + score_noise[:, 2],
            "collab": collab_score + score_noise[:, 3],
        },
        index=df.index,
    )

    thresholds = {"focus": 2.95, "comfort": 2.75, "device": 2.75, "collab": 2.65}
    labels = pd.DataFrame(
        {column: (scores[column] >= threshold).astype(int) for column, threshold in thresholds.items()},
        index=df.index,
    )

    for idx in labels.index:
        active_count = int(labels.loc[idx].sum())
        if active_count == 0:
            top_column = scores.loc[idx].idxmax()
            labels.loc[idx, top_column] = 1
        elif active_count > 3:
            top_columns = list(scores.loc[idx].nlargest(3).index)
            labels.loc[idx] = 0
            labels.loc[idx, top_columns] = 1

    return scores, labels.astype(int)


def build_output_frames(
    enriched_df: pd.DataFrame, score_df: pd.DataFrame, label_df: pd.DataFrame
) -> Dict[str, pd.DataFrame]:
    features_output = enriched_df[FEATURE_COLUMNS].astype(float).rename(columns=FEATURE_NAME_MAP)
    labels_output = label_df.rename(columns=LABEL_NAME_MAP).astype(int)

    active_label_names: List[str] = []
    for _, row in label_df.iterrows():
        active_names = [LABEL_NAME_MAP[column] for column, value in row.items() if int(value) == 1]
        active_label_names.append("、".join(active_names))

    score_output = score_df.rename(
        columns={key: f"{value}潜在分" for key, value in LABEL_NAME_MAP.items()}
    ).round(4)

    dataset_output = pd.DataFrame(
        {
            "样本编号": np.arange(1, len(enriched_df) + 1),
            "座位编号": enriched_df["seat_id"],
            "桌组编号": enriched_df["group_code"],
            "区域编码": enriched_df["zone_code"],
            "原始单标签": enriched_df["single_label"],
        }
    )
    dataset_output = pd.concat([dataset_output, features_output, labels_output], axis=1)
    dataset_output["激活标签数"] = labels_output.sum(axis=1)
    dataset_output["激活标签"] = active_label_names

    label_summary = pd.DataFrame(
        {
            "标签": [LABEL_NAME_MAP[column] for column in label_df.columns],
            "正样本数": [int(label_df[column].sum()) for column in label_df.columns],
            "正样本比例": [round(float(label_df[column].mean()), 4) for column in label_df.columns],
        }
    )

    label_cardinality = label_df.sum(axis=1).value_counts().sort_index()
    cardinality_summary = pd.DataFrame(
        {
            "每条样本激活标签数": label_cardinality.index.astype(int),
            "样本数量": label_cardinality.values.astype(int),
            "样本占比": np.round(label_cardinality.values / len(label_df), 4),
        }
    )

    cooccurrence = label_df.T.dot(label_df)
    cooccurrence.index = [LABEL_NAME_MAP[column] for column in cooccurrence.index]
    cooccurrence.columns = [LABEL_NAME_MAP[column] for column in cooccurrence.columns]

    feature_dictionary_df = pd.DataFrame(
        FEATURE_DICTIONARY, columns=["特征名", "特征类型", "说明"]
    )

    score_reference = pd.DataFrame(
        {
            "样本编号": np.arange(1, len(enriched_df) + 1),
            "座位编号": enriched_df["seat_id"],
            **score_output.to_dict(orient="list"),
            **labels_output.to_dict(orient="list"),
        }
    )

    return {
        "features": features_output,
        "labels": labels_output,
        "dataset": dataset_output,
        "label_summary": label_summary,
        "cardinality_summary": cardinality_summary,
        "cooccurrence": cooccurrence,
        "score_reference": score_reference,
        "feature_dictionary": feature_dictionary_df,
    }


def build_benchmark_models(seed: int) -> Dict[str, object]:
    return {
        "LogisticRegression(OvR)": OneVsRestClassifier(LogisticRegression(max_iter=2000)),
        "KNN": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", KNeighborsClassifier(n_neighbors=7)),
            ]
        ),
        "DecisionTree": DecisionTreeClassifier(max_depth=10, min_samples_leaf=4, random_state=seed),
        "RandomForest": RandomForestClassifier(
            n_estimators=300,
            max_depth=10,
            min_samples_leaf=2,
            random_state=seed,
            n_jobs=-1,
        ),
        "SVM(RBF, OvR)": OneVsRestClassifier(
            Pipeline(
                steps=[
                    ("scaler", StandardScaler()),
                    ("model", SVC(C=2.0, gamma="scale")),
                ]
            )
        ),
        "MLP(OvR)": OneVsRestClassifier(
            Pipeline(
                steps=[
                    ("scaler", StandardScaler()),
                    (
                        "model",
                        MLPClassifier(
                            hidden_layer_sizes=(64, 32),
                            activation="relu",
                            solver="adam",
                            alpha=0.0005,
                            learning_rate_init=0.001,
                            max_iter=1500,
                            random_state=seed,
                        ),
                    ),
                ]
            )
        ),
    }


def benchmark_models(feature_df: pd.DataFrame, label_df: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, Dict[str, object]]:
    X_train, X_test, y_train, y_test = train_test_split(
        feature_df.astype(float),
        label_df.astype(int),
        test_size=0.25,
        random_state=seed,
    )

    benchmark_rows = []
    split_info = {
        "训练样本数": len(X_train),
        "测试样本数": len(X_test),
        "随机种子": seed,
        "测试集比例": 0.25,
    }

    for model_name, model in build_benchmark_models(seed).items():
        model.fit(X_train, y_train)
        predictions = model.predict(X_test)
        benchmark_rows.append(
            {
                "模型": model_name,
                "精确子集准确率": round(float(accuracy_score(y_test, predictions)), 4),
                "Micro-Precision": round(
                    float(precision_score(y_test, predictions, average="micro", zero_division=0)), 4
                ),
                "Micro-Recall": round(
                    float(recall_score(y_test, predictions, average="micro", zero_division=0)), 4
                ),
                "Micro-F1": round(
                    float(f1_score(y_test, predictions, average="micro", zero_division=0)), 4
                ),
                "Macro-Precision": round(
                    float(precision_score(y_test, predictions, average="macro", zero_division=0)), 4
                ),
                "Macro-Recall": round(
                    float(recall_score(y_test, predictions, average="macro", zero_division=0)), 4
                ),
                "Macro-F1": round(
                    float(f1_score(y_test, predictions, average="macro", zero_division=0)), 4
                ),
                "Hamming Loss": round(float(hamming_loss(y_test, predictions)), 4),
            }
        )

    metrics_df = pd.DataFrame(benchmark_rows).sort_values(
        by=["Macro-F1", "Micro-F1", "精确子集准确率"], ascending=False
    )
    split_df = pd.DataFrame([split_info])
    return metrics_df.reset_index(drop=True), {"split_info": split_df}


def save_excel(path: Path, sheets: Dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for sheet_name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    autosize_workbook(path)


def save_combined_workbook(
    path: Path, output_frames: Dict[str, pd.DataFrame], benchmark_df: pd.DataFrame, split_df: pd.DataFrame
) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        output_frames["dataset"].to_excel(writer, sheet_name="dataset", index=False)
        output_frames["label_summary"].to_excel(writer, sheet_name="label_summary", index=False)
        output_frames["cardinality_summary"].to_excel(writer, sheet_name="cardinality", index=False)
        output_frames["cooccurrence"].to_excel(writer, sheet_name="label_cooccur")
        output_frames["feature_dictionary"].to_excel(writer, sheet_name="feature_dict", index=False)
        output_frames["score_reference"].to_excel(writer, sheet_name="score_ref", index=False)
        benchmark_df.to_excel(writer, sheet_name="baseline_metrics", index=False)
        split_df.to_excel(writer, sheet_name="benchmark_split", index=False)
    autosize_workbook(path)


def generate_excel_to_mat_script(bundle_dir: Path) -> None:
    script_text = f"""#!/usr/bin/env python3
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
    savemat(OUTPUT_PATH, {{"X": X, "Y": Y}})
    print(f"Saved: {{OUTPUT_PATH}}")
    print(f"X shape: {{X.shape}}")
    print(f"Y shape: {{Y.shape}}")


if __name__ == "__main__":
    main()
"""
    target_path = bundle_dir / "excel_to_mat_multilabel.py"
    target_path.write_text(script_text, encoding="utf-8")


def write_readme(
    bundle_dir: Path,
    feature_df: pd.DataFrame,
    label_df: pd.DataFrame,
    benchmark_df: pd.DataFrame,
) -> None:
    label_counts = label_df.sum()
    multi_label_ratio = float((label_df.sum(axis=1) > 1).mean())
    triple_label_ratio = float((label_df.sum(axis=1) > 2).mean())
    avg_cardinality = float(label_df.sum(axis=1).mean())
    best_model = benchmark_df.iloc[0]

    lines = [
        "图书馆座位多标签实验合集说明",
        "=" * 36,
        "",
        "1. 数据集设计目标",
        "本合集不是把原始单标签机械改成 one-hot，而是针对“后续做多算法分类对比”重新构造的多标签数据集。",
        "重构原则是：保留图书馆座位场景规律、增强标签交叉、加入桌组/分区上下文，并引入适度扰动，避免数据过于简单导致模型接近满分。",
        "",
        "2. 样本规模",
        f"- 样本数：{len(feature_df)}",
        f"- 特征数：{feature_df.shape[1]}",
        f"- 标签数：{label_df.shape[1]}",
        f"- 平均每条样本激活标签数：{avg_cardinality:.4f}",
        f"- 多标签样本占比：{multi_label_ratio:.4%}",
        f"- 三标签样本占比：{triple_label_ratio:.4%}",
        "",
        "3. 标签统计",
    ]
    for internal_name, chinese_name in LABEL_NAME_MAP.items():
        count = int(label_counts[internal_name])
        rate = count / len(label_df)
        lines.append(f"- {chinese_name}：{count} 条，占比 {rate:.4%}")

    lines.extend(
        [
            "",
            "4. 文件说明",
            "- features.xlsx：可直接用于训练的特征表，只有数值特征。",
            "- labels.xlsx：多标签 one-hot/multi-hot 标签表，每列一个场景标签。",
            "- output.mat：已经转换好的 MATLAB 数据文件，包含 X 和 Y。",
            "- reconstructed_multilabel_seat_dataset.xlsx：总览工作簿，含样本表、标签统计、标签共现、基线评估、特征词典。",
            "- excel_to_mat_multilabel.py：如果你后续改了 features/labels，可重新生成 output.mat。",
            "- README_使用说明.txt：当前说明文件。",
            "",
            "5. 使用建议",
            "- 如果老师的代码只认 features.xlsx 和 labels.xlsx，直接使用本目录这两份文件即可。",
            "- 如果后续你要做论文对比实验，建议至少比较 LogisticRegression、KNN、DecisionTree、RandomForest、SVM、MLP。",
            "- reconstructed_multilabel_seat_dataset.xlsx 里的 score_ref 工作表只用于解释标签生成逻辑，不建议把潜在分列再次当作训练特征，否则会造成标签泄漏。",
            "",
            "6. 本次基线试跑结果（随机切分 test_size=0.25）",
            f"- 当前最优模型：{best_model['模型']}",
            f"- 精确子集准确率：{best_model['精确子集准确率']}",
            f"- Micro-F1：{best_model['Micro-F1']}",
            f"- Macro-F1：{best_model['Macro-F1']}",
            f"- Hamming Loss：{best_model['Hamming Loss']}",
            "",
            "7. 如果你后续还要继续增强数据集",
            "- 可以继续扩展时间特征、预约热度特征、真实用户偏好特征。",
            "- 也可以把 4 个场景扩展成 6 到 8 个更细粒度标签，但注意控制标签稀疏度。",
        ]
    )

    (bundle_dir / "README_使用说明.txt").write_text("\n".join(lines), encoding="utf-8")


def save_mat_file(path: Path, feature_df: pd.DataFrame, label_df: pd.DataFrame) -> None:
    savemat(
        path,
        {
            "X": feature_df.values.astype(np.float64),
            "Y": label_df.values.astype(np.float64),
        },
    )


def make_bundle_dir(output_root: Path) -> Path:
    output_root.mkdir(parents=True, exist_ok=True)
    folder_name = f"图书馆座位多标签实验合集_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    bundle_dir = output_root / folder_name
    bundle_dir.mkdir(parents=True, exist_ok=False)
    return bundle_dir


def print_summary(bundle_dir: Path, label_df: pd.DataFrame, benchmark_df: pd.DataFrame) -> None:
    print(f"Bundle directory: {bundle_dir}")
    print(f"Features shape: ({len(label_df)}, {len(FEATURE_COLUMNS)})")
    print(f"Labels shape: {label_df.shape}")
    print("Label distribution:")
    for internal_name, chinese_name in LABEL_NAME_MAP.items():
        print(f"  {chinese_name}: {int(label_df[internal_name].sum())}")
    print("")
    print("Baseline metrics:")
    print(benchmark_df.to_string(index=False))
    print("")
    print("Generated files:")
    for path in sorted(bundle_dir.iterdir()):
        print(f"  {path.name}")


def main() -> None:
    args = parse_args()
    ensure_input_files()

    base_df = load_base_dataset()
    master_df = load_master_dataset()
    enriched_df = build_enriched_dataset(base_df, master_df)
    score_df, label_df = generate_multilabel_targets(enriched_df, seed=args.seed)
    output_frames = build_output_frames(enriched_df, score_df, label_df)
    benchmark_df, benchmark_meta = benchmark_models(
        enriched_df[FEATURE_COLUMNS], label_df, seed=args.seed
    )

    bundle_dir = make_bundle_dir(args.output_root.resolve())

    features_path = bundle_dir / "features.xlsx"
    labels_path = bundle_dir / "labels.xlsx"
    combined_path = bundle_dir / "reconstructed_multilabel_seat_dataset.xlsx"
    mat_path = bundle_dir / "output.mat"

    save_excel(features_path, {"Sheet1": output_frames["features"]})
    save_excel(labels_path, {"Sheet1": output_frames["labels"]})
    save_combined_workbook(
        combined_path,
        output_frames=output_frames,
        benchmark_df=benchmark_df,
        split_df=benchmark_meta["split_info"],
    )
    save_mat_file(mat_path, output_frames["features"], output_frames["labels"])
    generate_excel_to_mat_script(bundle_dir)
    write_readme(bundle_dir, enriched_df[FEATURE_COLUMNS], label_df, benchmark_df)
    print_summary(bundle_dir, label_df, benchmark_df)


if __name__ == "__main__":
    main()
