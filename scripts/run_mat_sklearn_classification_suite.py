#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Dict, List, Tuple

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import openpyxl
import pandas as pd
import seaborn as sns
from joblib import dump
from matplotlib.colors import LinearSegmentedColormap
from matplotlib import font_manager
from scipy.io import loadmat
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    f1_score,
    hamming_loss,
    jaccard_score,
    multilabel_confusion_matrix,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESKTOP = PROJECT_ROOT.parent
DEFAULT_TRAIN_RATIOS = (0.25, 0.5, 0.75)
CANVAS_BG = "#FFFFFF"
PANEL_BG = "#FFFFFF"
GRID_COLOR = "#E5E7EB"
TEXT_COLOR = "#1F2937"
SUBTLE_TEXT = "#6B7280"
CONNECTOR_COLOR = "#D1D5DB"
MICRO_COLOR = "#3B82F6"
MACRO_COLOR = "#F97316"
PRECISION_COLOR = "#2563EB"
RECALL_COLOR = "#EA580C"
F1_COLOR = "#10B981"
HIGHLIGHT_FILL = "#F3F4F6"
MODEL_COLOR_MAP = {
    "支持向量机 SVM": "#2563EB",
    "K近邻 KNN（k=7）": "#7C3AED",
    "逻辑回归": "#059669",
    "随机森林": "#D97706",
    "决策树": "#DC2626",
    "高斯朴素贝叶斯": "#64748B",
}
MODEL_DISPLAY_LABELS = {
    "支持向量机 SVM": "支持向量机 SVM",
    "K近邻 KNN（k=7）": "K近邻 KNN (k=7)",
    "逻辑回归": "逻辑回归",
    "随机森林": "随机森林",
    "决策树": "决策树",
    "高斯朴素贝叶斯": "高斯朴素贝叶斯",
}
METRIC_CMAP = LinearSegmentedColormap.from_list(
    "defense_metrics",
    ["#EFF6FF", "#93C5FD", "#60A5FA", "#1D4ED8"],
)


@dataclass
class ModelSpec:
    model_key: str
    display_name: str
    folder_name: str
    estimator: object


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a complete sklearn classic-classifier experiment suite on a MAT multi-label dataset."
    )
    parser.add_argument(
        "--mat-path",
        type=Path,
        default=None,
        help="Path to the source output.mat file. If omitted, the latest matching desktop bundle is used.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_DESKTOP,
        help="Directory where the experiment output folder will be created.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.25,
        help="Test split ratio. Default: 0.25",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for train/test split and model initialization.",
    )
    parser.add_argument(
        "--train-ratios",
        type=float,
        nargs="*",
        default=list(DEFAULT_TRAIN_RATIOS),
        help="Training-pool usage ratios for robustness study, e.g. 0.3 0.5 0.75",
    )
    return parser.parse_args()


def configure_plot_style() -> None:
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    preferred_fonts = ["Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "DejaVu Sans"]
    selected_font = next((name for name in preferred_fonts if name in available_fonts), "DejaVu Sans")
    matplotlib.rcParams["font.family"] = "sans-serif"
    matplotlib.rcParams["font.sans-serif"] = [selected_font, "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    matplotlib.rcParams["figure.facecolor"] = CANVAS_BG
    matplotlib.rcParams["axes.facecolor"] = PANEL_BG
    matplotlib.rcParams["savefig.facecolor"] = CANVAS_BG
    matplotlib.rcParams["savefig.edgecolor"] = CANVAS_BG
    matplotlib.rcParams["axes.edgecolor"] = GRID_COLOR
    matplotlib.rcParams["axes.labelcolor"] = TEXT_COLOR
    matplotlib.rcParams["xtick.color"] = SUBTLE_TEXT
    matplotlib.rcParams["ytick.color"] = SUBTLE_TEXT
    matplotlib.rcParams["text.color"] = TEXT_COLOR
    matplotlib.rcParams["axes.titlecolor"] = TEXT_COLOR
    matplotlib.rcParams["grid.color"] = GRID_COLOR
    matplotlib.rcParams["grid.linewidth"] = 0.8
    matplotlib.rcParams["axes.titleweight"] = "bold"
    matplotlib.rcParams["axes.titlesize"] = 16
    matplotlib.rcParams["axes.labelsize"] = 13
    matplotlib.rcParams["xtick.labelsize"] = 11
    matplotlib.rcParams["ytick.labelsize"] = 11
    matplotlib.rcParams["legend.fontsize"] = 10
    matplotlib.rcParams["figure.titlesize"] = 18
    sns.set_theme(style="white", rc={"font.sans-serif": [selected_font, "DejaVu Sans"]})


def style_category_axis(ax) -> None:
    ax.tick_params(axis="x", rotation=0, pad=10)
    for label in ax.get_xticklabels():
        label.set_horizontalalignment("center")
        label.set_verticalalignment("top")
    ax.set_axisbelow(True)


def apply_axis_chrome(ax, *, grid_axis: str = "x") -> None:
    ax.set_facecolor(PANEL_BG)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(GRID_COLOR)
    ax.spines["bottom"].set_color(GRID_COLOR)
    ax.tick_params(colors=SUBTLE_TEXT)
    ax.grid(False)


def add_bar_value_labels(ax, fmt: str = "%.3f", *, horizontal: bool = False) -> None:
    for container in ax.containers:
        if horizontal:
            ax.bar_label(container, fmt=fmt, fontsize=9, padding=4, color=TEXT_COLOR)
        else:
            ax.bar_label(container, fmt=fmt, fontsize=8, rotation=90, padding=2, color=TEXT_COLOR)


def place_legend_lower_left(ax, *, outside: bool = False, columns: int = 1) -> None:
    handles, labels = ax.get_legend_handles_labels()
    if not handles:
        return

    legend_kwargs = {
        "frameon": True,
        "fontsize": 9,
        "facecolor": "#FFFFFF",
        "edgecolor": GRID_COLOR,
    }
    if outside:
        legend = ax.legend(
            handles,
            labels,
            loc="upper left",
            bbox_to_anchor=(0.0, -0.14),
            ncol=columns,
            borderaxespad=0.0,
            **legend_kwargs,
        )
    else:
        legend = ax.legend(
            handles,
            labels,
            loc="lower left",
            **legend_kwargs,
        )

    if legend is not None:
        legend.set_title(None)
        legend.get_frame().set_linewidth(0.8)


def save_figure(figure, output_path: Path, *, rect: list[float] | None = None, bottom_margin: float = 0.0) -> None:
    if rect is None:
        figure.tight_layout()
    else:
        figure.tight_layout(rect=rect)
    if bottom_margin > 0:
        figure.subplots_adjust(bottom=bottom_margin)
    figure.savefig(output_path, dpi=220, bbox_inches="tight")
    plt.close(figure)


def get_model_color(model_name: str) -> str:
    return MODEL_COLOR_MAP.get(model_name, "#4C6378")


def get_model_plot_label(model_name: str) -> str:
    return MODEL_DISPLAY_LABELS.get(model_name, model_name)


def format_ratio_label(ratio: float) -> str:
    return f"{int(round(ratio * 100))}%"


def sanitize_train_ratios(train_ratios: List[float]) -> List[float]:
    valid_ratios = sorted({round(float(ratio), 4) for ratio in train_ratios if 0 < float(ratio) <= 1})
    if not valid_ratios:
        raise ValueError("At least one valid train ratio between 0 and 1 is required.")
    return valid_ratios


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


def find_latest_mat_path(desktop_root: Path) -> Path:
    candidates = sorted(
        [path for path in desktop_root.glob("*/output.mat") if path.is_file()],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No output.mat found under {desktop_root}")
    return candidates[0]


def resolve_mat_path(explicit_path: Path | None) -> Path:
    if explicit_path is not None:
        explicit_path = explicit_path.resolve()
        if not explicit_path.exists():
            raise FileNotFoundError(f"MAT file not found: {explicit_path}")
        return explicit_path
    return find_latest_mat_path(DEFAULT_DESKTOP.resolve())


def load_label_names(bundle_dir: Path, class_count: int) -> List[str]:
    labels_path = bundle_dir / "labels.xlsx"
    if labels_path.exists():
        df = pd.read_excel(labels_path)
        if df.shape[1] == class_count:
            return list(df.columns)
    return [f"label_{index + 1}" for index in range(class_count)]


def load_sample_metadata(bundle_dir: Path, sample_count: int) -> pd.DataFrame:
    combined_workbook = bundle_dir / "reconstructed_multilabel_seat_dataset.xlsx"
    if combined_workbook.exists():
        try:
            df = pd.read_excel(combined_workbook, sheet_name="dataset")
            candidates = [column for column in ["样本编号", "座位编号", "桌组编号", "区域编码"] if column in df.columns]
            if candidates and len(df) == sample_count:
                return df[candidates].copy()
        except Exception:
            pass
    sample_index_path = bundle_dir / "sample_index.xlsx"
    if sample_index_path.exists():
        try:
            df = pd.read_excel(sample_index_path)
            candidates = [
                column
                for column in [
                    "sample_id",
                    "group_id",
                    "zone_code",
                    "zone_name",
                    "zone_band",
                    "final_label",
                    "secondary_label",
                    "confidence",
                ]
                if column in df.columns
            ]
            if candidates and len(df) == sample_count:
                return df[candidates].copy()
        except Exception:
            pass
    cn_sample_index_path = bundle_dir / "样本索引.xlsx"
    if cn_sample_index_path.exists():
        try:
            df = pd.read_excel(cn_sample_index_path)
            candidates = [
                column
                for column in [
                    "样本编号",
                    "桌组编号",
                    "区域编码",
                    "区域名称",
                    "区域方向",
                    "主标签",
                    "次优标签",
                    "标签置信度",
                    "主标签中文",
                    "次优标签中文",
                ]
                if column in df.columns
            ]
            if candidates and len(df) == sample_count:
                return df[candidates].copy()
        except Exception:
            pass
    return pd.DataFrame({"样本编号": np.arange(1, sample_count + 1)})


def load_mat_dataset(mat_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, List[str], pd.DataFrame]:
    mat = loadmat(mat_path)
    if "X" not in mat or "Y" not in mat:
        raise KeyError(f"MAT file must contain 'X' and 'Y': {mat_path}")

    X = np.asarray(mat["X"], dtype=np.float64)
    Y = np.asarray(mat["Y"], dtype=np.int64)
    if X.ndim != 2 or Y.ndim != 2:
        raise ValueError("Both X and Y in the MAT file must be 2D arrays.")
    if X.shape[0] != Y.shape[0]:
        raise ValueError(f"Sample count mismatch: X has {X.shape[0]}, Y has {Y.shape[0]}")

    label_names = load_label_names(mat_path.parent, class_count=Y.shape[1])
    feature_columns = [f"feature_{index + 1:02d}" for index in range(X.shape[1])]
    X_df = pd.DataFrame(X, columns=feature_columns)
    Y_df = pd.DataFrame(Y, columns=label_names)
    sample_meta = load_sample_metadata(mat_path.parent, sample_count=X.shape[0])
    return X_df, Y_df, label_names, sample_meta


def build_model_specs(seed: int) -> List[ModelSpec]:
    return [
        ModelSpec(
            model_key="logistic_regression",
            display_name="逻辑回归",
            folder_name="01_逻辑回归",
            estimator=OneVsRestClassifier(
                Pipeline(
                    steps=[
                        ("scaler", StandardScaler()),
                        ("model", LogisticRegression(max_iter=2500)),
                    ]
                )
            ),
        ),
        ModelSpec(
            model_key="knn_k7",
            display_name="K近邻 KNN（k=7）",
            folder_name="02_K近邻KNN_k7",
            estimator=OneVsRestClassifier(
                Pipeline(
                    steps=[
                        ("scaler", StandardScaler()),
                        ("model", KNeighborsClassifier(n_neighbors=7)),
                    ]
                )
            ),
        ),
        ModelSpec(
            model_key="decision_tree",
            display_name="决策树",
            folder_name="03_决策树",
            estimator=OneVsRestClassifier(
                DecisionTreeClassifier(max_depth=10, min_samples_leaf=4, random_state=seed)
            ),
        ),
        ModelSpec(
            model_key="random_forest",
            display_name="随机森林",
            folder_name="04_随机森林",
            estimator=OneVsRestClassifier(
                RandomForestClassifier(
                    n_estimators=400,
                    max_depth=12,
                    min_samples_leaf=2,
                    random_state=seed,
                    n_jobs=-1,
                )
            ),
        ),
        ModelSpec(
            model_key="svm",
            display_name="支持向量机 SVM",
            folder_name="05_支持向量机SVM",
            estimator=OneVsRestClassifier(
                Pipeline(
                    steps=[
                        ("scaler", StandardScaler()),
                        ("model", SVC(C=2.0, gamma="scale", probability=True)),
                    ]
                )
            ),
        ),
        ModelSpec(
            model_key="gaussian_nb",
            display_name="高斯朴素贝叶斯",
            folder_name="06_高斯朴素贝叶斯",
            estimator=OneVsRestClassifier(GaussianNB()),
        ),
    ]


def get_model_spec(seed: int, model_key: str) -> ModelSpec:
    for spec in build_model_specs(seed):
        if spec.model_key == model_key:
            return spec
    available = ", ".join(spec.model_key for spec in build_model_specs(seed))
    raise KeyError(f"Unknown model_key '{model_key}'. Available keys: {available}")


def make_output_dirs(output_root: Path) -> tuple[Path, Path]:
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir = output_root / f"经典机器学习多算法分类实验_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir.mkdir(parents=True, exist_ok=False)
    comparison_dir = run_dir / "综合对比"
    comparison_dir.mkdir(parents=True, exist_ok=False)
    return run_dir, comparison_dir


def get_probability_scores(model: object, X_test: pd.DataFrame) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        scores = model.predict_proba(X_test)
        return np.asarray(scores, dtype=float)
    if hasattr(model, "decision_function"):
        raw_scores = np.asarray(model.decision_function(X_test), dtype=float)
        return 1.0 / (1.0 + np.exp(-raw_scores))
    raise AttributeError("Model does not support predict_proba or decision_function.")


def flatten_confusion_matrices(confusions: np.ndarray, label_names: List[str]) -> pd.DataFrame:
    rows = []
    for index, label_name in enumerate(label_names):
        tn, fp, fn, tp = confusions[index].ravel()
        rows.append({"标签": label_name, "真负例TN": int(tn), "假正例FP": int(fp), "假负例FN": int(fn), "真正例TP": int(tp)})
    return pd.DataFrame(rows)


def build_predictions_table(
    sample_meta: pd.DataFrame,
    test_indices: np.ndarray,
    y_true: pd.DataFrame,
    y_pred: pd.DataFrame,
    y_score: np.ndarray,
    label_names: List[str],
) -> pd.DataFrame:
    base = sample_meta.iloc[test_indices].reset_index(drop=True).copy()
    for label_name in label_names:
        base[f"真实_{label_name}"] = y_true[label_name].reset_index(drop=True)
    for label_name in label_names:
        base[f"预测_{label_name}"] = y_pred[label_name].reset_index(drop=True)
    for index, label_name in enumerate(label_names):
        base[f"得分_{label_name}"] = np.round(y_score[:, index], 6)
    base["真实激活标签"] = y_true.apply(
        lambda row: "、".join([name for name in label_names if int(row[name]) == 1]), axis=1
    ).reset_index(drop=True)
    base["预测激活标签"] = y_pred.apply(
        lambda row: "、".join([name for name in label_names if int(row[name]) == 1]), axis=1
    ).reset_index(drop=True)
    return base


def localize_metrics_frame(metrics_df: pd.DataFrame) -> pd.DataFrame:
    rename_map = {
        "model": "模型",
        "hamming_loss": "汉明损失",
        "micro_precision": "Micro-Precision",
        "micro_recall": "Micro-Recall",
        "micro_f1": "Micro-F1",
        "macro_precision": "Macro-Precision",
        "macro_recall": "Macro-Recall",
        "macro_f1": "Macro-F1",
        "jaccard_macro": "Macro-Jaccard",
        "roc_auc_micro": "Micro-ROC_AUC",
        "roc_auc_macro": "Macro-ROC_AUC",
        "pr_auc_micro": "Micro-PR_AUC",
        "pr_auc_macro": "Macro-PR_AUC",
        "train_ratio": "训练样本使用率",
        "train_ratio_label": "训练样本使用率标签",
        "train_samples": "训练样本数",
        "test_samples": "测试样本数",
        "fit_time_sec": "训练耗时秒",
        "predict_time_sec": "预测耗时秒",
    }
    return metrics_df.rename(columns=rename_map)


def localize_report_frame(report_df: pd.DataFrame) -> pd.DataFrame:
    frame = report_df.reset_index().rename(
        columns={
            "index": "类别",
            "precision": "精确率",
            "recall": "召回率",
            "f1-score": "F1值",
            "support": "样本数",
        }
    )
    return frame


def localize_curve_frame(frame: pd.DataFrame, value_column: str) -> pd.DataFrame:
    rename_map = {"label": "标签", value_column: "数值"}
    localized = frame.rename(columns=rename_map).copy()
    localized["标签"] = localized["标签"].replace({"micro_average": "微平均", "macro_average": "宏平均"})
    return localized


def localize_split_info_frame(split_info_df: pd.DataFrame) -> pd.DataFrame:
    return split_info_df.rename(
        columns={
            "source_mat_path": "源MAT路径",
            "seed": "随机种子",
            "test_size": "测试集比例",
            "train_samples": "训练集样本数",
            "test_samples": "测试集样本数",
            "feature_count": "特征数",
            "label_count": "标签数",
            "train_ratio_study": "训练比例稳健性方案",
        }
    )


def localize_label_distribution_frame(label_distribution_df: pd.DataFrame) -> pd.DataFrame:
    return label_distribution_df.rename(
        columns={
            "label": "标签",
            "full_count": "全量样本数",
            "train_count": "训练集样本数",
            "test_count": "测试集样本数",
            "full_ratio": "全量占比",
            "train_ratio": "训练集占比",
            "test_ratio": "测试集占比",
        }
    )


def localize_per_label_metric_frame(per_label_metric_df: pd.DataFrame) -> pd.DataFrame:
    return per_label_metric_df.rename(
        columns={
            "label": "标签",
            "precision": "精确率",
            "recall": "召回率",
            "f1-score": "F1值",
            "support": "样本数",
            "model": "模型",
        }
    )


def compute_overall_metrics(y_true: pd.DataFrame, y_pred: pd.DataFrame, y_score: np.ndarray) -> Dict[str, float]:
    return {
        "hamming_loss": float(hamming_loss(y_true, y_pred)),
        "micro_precision": float(precision_score(y_true, y_pred, average="micro", zero_division=0)),
        "micro_recall": float(recall_score(y_true, y_pred, average="micro", zero_division=0)),
        "micro_f1": float(f1_score(y_true, y_pred, average="micro", zero_division=0)),
        "macro_precision": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
        "macro_recall": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "jaccard_macro": float(jaccard_score(y_true, y_pred, average="macro", zero_division=0)),
        "roc_auc_micro": float(roc_auc_score(y_true, y_score, average="micro")),
        "roc_auc_macro": float(roc_auc_score(y_true, y_score, average="macro")),
        "pr_auc_micro": float(average_precision_score(y_true, y_score, average="micro")),
        "pr_auc_macro": float(average_precision_score(y_true, y_score, average="macro")),
    }


def compute_curve_tables(
    y_true: pd.DataFrame, y_score: np.ndarray, label_names: List[str]
) -> tuple[pd.DataFrame, pd.DataFrame]:
    roc_rows = []
    pr_rows = []
    for index, label_name in enumerate(label_names):
        label_true = y_true.iloc[:, index].to_numpy()
        label_score = y_score[:, index]
        roc_rows.append({"label": label_name, "roc_auc": float(roc_auc_score(label_true, label_score))})
        pr_rows.append(
            {"label": label_name, "average_precision": float(average_precision_score(label_true, label_score))}
        )

    roc_rows.append({"label": "micro_average", "roc_auc": float(roc_auc_score(y_true, y_score, average="micro"))})
    roc_rows.append({"label": "macro_average", "roc_auc": float(roc_auc_score(y_true, y_score, average="macro"))})
    pr_rows.append(
        {
            "label": "micro_average",
            "average_precision": float(average_precision_score(y_true, y_score, average="micro")),
        }
    )
    pr_rows.append(
        {
            "label": "macro_average",
            "average_precision": float(average_precision_score(y_true, y_score, average="macro")),
        }
    )
    return pd.DataFrame(roc_rows), pd.DataFrame(pr_rows)


def plot_confusion_grid(confusions: np.ndarray, label_names: List[str], output_path: Path, model_name: str) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    for index, label_name in enumerate(label_names):
        matrix = pd.DataFrame(confusions[index], index=["真实0", "真实1"], columns=["预测0", "预测1"])
        sns.heatmap(matrix, annot=True, fmt="d", cmap=METRIC_CMAP, cbar=False, linewidths=1, linecolor=CANVAS_BG, ax=axes[index])
        axes[index].set_title(label_name)
        axes[index].set_xlabel("预测")
        axes[index].set_ylabel("真实")
    figure.suptitle(f"{model_name} 多标签混淆矩阵", fontsize=16)
    save_figure(figure, output_path, rect=[0, 0, 1, 0.97])


def plot_roc_curves(y_true: pd.DataFrame, y_score: np.ndarray, label_names: List[str], output_path: Path, model_name: str) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    for index, label_name in enumerate(label_names):
        fpr, tpr, _ = roc_curve(y_true.iloc[:, index], y_score[:, index])
        auc_value = roc_auc_score(y_true.iloc[:, index], y_score[:, index])
        axes[index].plot(fpr, tpr, linewidth=2.5, color=get_model_color(model_name), label=f"AUC = {auc_value:.4f}")
        axes[index].plot([0, 1], [0, 1], linestyle="--", color="#999999")
        axes[index].set_title(label_name)
        axes[index].set_xlabel("假正例率")
        axes[index].set_ylabel("真正例率")
        axes[index].set_xlim(0, 1)
        axes[index].set_ylim(0, 1.02)
        apply_axis_chrome(axes[index], grid_axis="both")
        place_legend_lower_left(axes[index])
    figure.suptitle(f"{model_name} ROC 曲线", fontsize=16)
    save_figure(figure, output_path, rect=[0, 0, 1, 0.97])


def plot_pr_curves(y_true: pd.DataFrame, y_score: np.ndarray, label_names: List[str], output_path: Path, model_name: str) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    for index, label_name in enumerate(label_names):
        precision, recall, _ = precision_recall_curve(y_true.iloc[:, index], y_score[:, index])
        ap_value = average_precision_score(y_true.iloc[:, index], y_score[:, index])
        axes[index].plot(recall, precision, linewidth=2.5, color=get_model_color(model_name), label=f"AP = {ap_value:.4f}")
        axes[index].set_title(label_name)
        axes[index].set_xlabel("召回率")
        axes[index].set_ylabel("精确率")
        axes[index].set_xlim(0, 1)
        axes[index].set_ylim(0, 1.02)
        apply_axis_chrome(axes[index], grid_axis="both")
        place_legend_lower_left(axes[index])
    figure.suptitle(f"{model_name} PR 曲线", fontsize=16)
    save_figure(figure, output_path, rect=[0, 0, 1, 0.97])


def plot_label_metric(
    report_df: pd.DataFrame,
    label_names: List[str],
    metric_key: str,
    metric_label: str,
    color: str,
    output_path: Path,
    model_name: str,
) -> None:
    label_report = report_df.loc[label_names, [metric_key]].reset_index().rename(
        columns={"index": "标签", metric_key: metric_label}
    )
    label_report = label_report.sort_values(by=metric_label, ascending=True).reset_index(drop=True)
    figure, ax = plt.subplots(figsize=(9.5, 5.8))
    sns.barplot(data=label_report, y="标签", x=metric_label, ax=ax, color=color)
    ax.set_title(f"{model_name} 各标签{metric_label}")
    ax.set_xlabel(metric_label)
    ax.set_ylabel("")
    ax.set_xlim(0, 1.02)
    apply_axis_chrome(ax, grid_axis="x")
    add_bar_value_labels(ax, horizontal=True)
    save_figure(figure, output_path)


def save_model_workbook(
    path: Path,
    overall_metrics: Dict[str, float],
    report_df: pd.DataFrame,
    confusion_df: pd.DataFrame,
    roc_df: pd.DataFrame,
    pr_df: pd.DataFrame,
    predictions_df: pd.DataFrame,
) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        localize_metrics_frame(pd.DataFrame([overall_metrics])).to_excel(writer, sheet_name="总体指标", index=False)
        localize_report_frame(report_df).to_excel(writer, sheet_name="分类报告", index=False)
        confusion_df.to_excel(writer, sheet_name="混淆矩阵", index=False)
        localize_curve_frame(roc_df, "roc_auc").to_excel(writer, sheet_name="ROC面积", index=False)
        localize_curve_frame(pr_df, "average_precision").to_excel(writer, sheet_name="PR面积", index=False)
        predictions_df.to_excel(writer, sheet_name="预测结果", index=False)
    autosize_workbook(path)


def write_model_summary(
    path: Path,
    model_name: str,
    overall_metrics: Dict[str, float],
    label_names: List[str],
    report_df: pd.DataFrame,
) -> None:
    metric_name_map = {
        "hamming_loss": "汉明损失",
        "micro_precision": "Micro-Precision",
        "micro_recall": "Micro-Recall",
        "micro_f1": "Micro-F1",
        "macro_precision": "Macro-Precision",
        "macro_recall": "Macro-Recall",
        "macro_f1": "Macro-F1",
        "jaccard_macro": "Macro-Jaccard",
        "roc_auc_micro": "Micro-ROC_AUC",
        "roc_auc_macro": "Macro-ROC_AUC",
        "pr_auc_micro": "Micro-PR_AUC",
        "pr_auc_macro": "Macro-PR_AUC",
        "fit_time_sec": "训练耗时秒",
        "predict_time_sec": "预测耗时秒",
    }
    lines = [f"模型: {model_name}", "", "总体指标:"]
    for key, value in overall_metrics.items():
        if key != "model":
            lines.append(f"- {metric_name_map.get(key, key)}: {value:.6f}")
    lines.extend(["", "各标签 F1:"])
    for label_name in label_names:
        lines.append(f"- {label_name}: {report_df.loc[label_name, 'f1-score']:.6f}")
    path.write_text("\n".join(lines), encoding="utf-8")


def plot_metric_pair_dumbbell(
    metrics_df: pd.DataFrame,
    output_path: Path,
    left_metric: str,
    right_metric: str,
    left_label: str,
    right_label: str,
    title: str,
) -> None:
    ordered_df = metrics_df.sort_values(by=[right_metric, left_metric], ascending=False).reset_index(drop=True)
    labels = [get_model_plot_label(model_name) for model_name in ordered_df["model"]]
    x = np.arange(len(labels), dtype=float)
    width = 0.38

    figure, ax = plt.subplots(figsize=(13.4, 6.0))
    left_bars = ax.bar(
        x - width / 2,
        ordered_df[left_metric].to_numpy(),
        width=width,
        label=left_label,
        color=MICRO_COLOR,
        edgecolor="#FFFFFF",
    )
    right_bars = ax.bar(
        x + width / 2,
        ordered_df[right_metric].to_numpy(),
        width=width,
        label=right_label,
        color=MACRO_COLOR,
        edgecolor="#FFFFFF",
    )
    ax.set_title(title)
    ax.set_xlabel("")
    ax.set_ylabel("得分")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x, labels=labels)
    style_category_axis(ax)
    apply_axis_chrome(ax, grid_axis="y")
    ax.margins(x=0.03)
    place_legend_lower_left(ax, outside=True, columns=2)
    ax.bar_label(left_bars, fmt="%.3f", fontsize=8, rotation=90, padding=2, color=TEXT_COLOR)
    ax.bar_label(right_bars, fmt="%.3f", fontsize=8, rotation=90, padding=2, color=TEXT_COLOR)
    save_figure(figure, output_path, bottom_margin=0.18)


def plot_ranked_metric_bars(
    metrics_df: pd.DataFrame,
    output_path: Path,
    metric_column: str,
    metric_label: str,
    title: str,
    color: str,
) -> None:
    ordered_df = metrics_df.sort_values(by=metric_column, ascending=True).reset_index(drop=True)
    figure, ax = plt.subplots(figsize=(10.6, 5.8))
    sns.barplot(data=ordered_df, y="model", x=metric_column, ax=ax, color=color)
    ax.set_title(title)
    ax.set_xlabel(metric_label)
    ax.set_ylabel("")
    ax.set_xlim(0, max(ordered_df[metric_column].max() * 1.08, 0.05))
    apply_axis_chrome(ax, grid_axis="x")
    add_bar_value_labels(ax, horizontal=True)
    save_figure(figure, output_path)


def plot_core_metric_bars(metrics_df: pd.DataFrame, output_path: Path) -> None:
    plot_metric_pair_dumbbell(
        metrics_df=metrics_df,
        output_path=output_path,
        left_metric="micro_f1",
        right_metric="macro_f1",
        left_label="Micro-F1",
        right_label="Macro-F1",
        title="核心F1指标对比",
    )


def plot_precision_bars(metrics_df: pd.DataFrame, output_path: Path) -> None:
    plot_metric_pair_dumbbell(
        metrics_df=metrics_df,
        output_path=output_path,
        left_metric="micro_precision",
        right_metric="macro_precision",
        left_label="Micro-精确率",
        right_label="Macro-精确率",
        title="精确率对比",
    )


def plot_recall_bars(metrics_df: pd.DataFrame, output_path: Path) -> None:
    plot_metric_pair_dumbbell(
        metrics_df=metrics_df,
        output_path=output_path,
        left_metric="micro_recall",
        right_metric="macro_recall",
        left_label="Micro-召回率",
        right_label="Macro-召回率",
        title="召回率对比",
    )


def plot_auc_jaccard_bars(metrics_df: pd.DataFrame, output_path: Path) -> None:
    heatmap_df = metrics_df.set_index("model")[
        ["roc_auc_micro", "roc_auc_macro", "pr_auc_micro", "pr_auc_macro", "jaccard_macro"]
    ].rename(
        columns={
            "roc_auc_micro": "Micro-ROC_AUC",
            "roc_auc_macro": "Macro-ROC_AUC",
            "pr_auc_micro": "Micro-PR_AUC",
            "pr_auc_macro": "Macro-PR_AUC",
            "jaccard_macro": "Macro-Jaccard",
        }
    )
    figure, ax = plt.subplots(figsize=(10.4, 4.8))
    sns.heatmap(
        heatmap_df,
        annot=True,
        fmt=".3f",
        cmap=METRIC_CMAP,
        linewidths=1,
        linecolor=CANVAS_BG,
        cbar=True,
        ax=ax,
    )
    ax.set_title("曲线面积与宏平均 Jaccard 热力图")
    ax.set_xlabel("指标")
    ax.set_ylabel("算法")
    ax.tick_params(axis="x", rotation=0)
    save_figure(figure, output_path)


def plot_hamming_time_bars(metrics_df: pd.DataFrame, output_path: Path) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(13.6, 5.2), gridspec_kw={"width_ratios": [1, 1.15]})
    ordered_loss_df = metrics_df.sort_values(by="hamming_loss", ascending=True).copy()
    ordered_loss_df["plot_model"] = ordered_loss_df["model"].map(get_model_plot_label)
    sns.barplot(data=ordered_loss_df, y="plot_model", x="hamming_loss", ax=axes[0], color="#EF4444")
    axes[0].set_title("汉明损失排序图")
    axes[0].set_xlabel("汉明损失")
    axes[0].set_ylabel("")
    apply_axis_chrome(axes[0], grid_axis="x")
    add_bar_value_labels(axes[0], horizontal=True)

    time_df = metrics_df.melt(
        id_vars=["model"],
        value_vars=["fit_time_sec", "predict_time_sec"],
        var_name="指标",
        value_name="seconds",
    )
    time_df["plot_model"] = time_df["model"].map(get_model_plot_label)
    time_df["指标"] = time_df["指标"].map({"fit_time_sec": "训练耗时", "predict_time_sec": "预测耗时"})
    sns.barplot(
        data=time_df,
        y="plot_model",
        x="seconds",
        hue="指标",
        ax=axes[1],
        palette={"训练耗时": "#64748B", "预测耗时": "#FB923C"},
    )
    axes[1].set_title("训练与预测耗时对比")
    axes[1].set_xlabel("秒")
    axes[1].set_ylabel("")
    apply_axis_chrome(axes[1], grid_axis="x")
    add_bar_value_labels(axes[1], horizontal=True)
    place_legend_lower_left(axes[1], outside=True, columns=2)
    save_figure(figure, output_path, bottom_margin=0.18)


def plot_metric_heatmap(metrics_df: pd.DataFrame, output_path: Path) -> None:
    heatmap_df = metrics_df.assign(plot_model=metrics_df["model"].map(get_model_plot_label)).set_index("plot_model")[
        [
            "micro_precision",
            "micro_recall",
            "micro_f1",
            "macro_precision",
            "macro_recall",
            "macro_f1",
            "jaccard_macro",
            "roc_auc_micro",
            "pr_auc_micro",
            "hamming_loss",
        ]
    ].copy()
    heatmap_df = heatmap_df.rename(
        columns={
            "micro_precision": "Micro-Precision",
            "micro_recall": "Micro-Recall",
            "micro_f1": "Micro-F1",
            "macro_precision": "Macro-Precision",
            "macro_recall": "Macro-Recall",
            "macro_f1": "Macro-F1",
            "jaccard_macro": "Macro-Jaccard",
            "roc_auc_micro": "Micro-ROC_AUC",
            "pr_auc_micro": "Micro-PR_AUC",
            "hamming_loss": "汉明损失",
        }
    )
    figure, ax = plt.subplots(figsize=(13.5, 5.8))
    sns.heatmap(heatmap_df, annot=True, fmt=".3f", cmap=METRIC_CMAP, linewidths=1, linecolor=CANVAS_BG, cbar=True, ax=ax)
    ax.set_title("算法总体指标热力图")
    ax.set_xlabel("指标")
    ax.set_ylabel("算法")
    ax.tick_params(axis="x", rotation=0)
    save_figure(figure, output_path)


def plot_micro_roc_comparison(micro_curve_map: Dict[str, Tuple[np.ndarray, np.ndarray, float]], output_path: Path) -> None:
    figure, ax = plt.subplots(figsize=(8.6, 6.4))
    for model_name, (fpr, tpr, auc_value) in micro_curve_map.items():
        legend_name = get_model_plot_label(model_name).replace("\n", " ")
        ax.plot(fpr, tpr, linewidth=2.6, color=get_model_color(model_name), label=f"{legend_name}  AUC={auc_value:.3f}")
    ax.plot([0, 1], [0, 1], linestyle="--", color="#9BA4A9", linewidth=1.2)
    ax.set_title("各算法微平均 ROC 对比")
    ax.set_xlabel("假正例率")
    ax.set_ylabel("真正例率")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.02)
    apply_axis_chrome(ax, grid_axis="both")
    place_legend_lower_left(ax, outside=True, columns=2)
    save_figure(figure, output_path, bottom_margin=0.22)


def plot_micro_pr_comparison(micro_curve_map: Dict[str, Tuple[np.ndarray, np.ndarray, float]], output_path: Path) -> None:
    figure, ax = plt.subplots(figsize=(8.6, 6.4))
    for model_name, (recall, precision, ap_value) in micro_curve_map.items():
        legend_name = get_model_plot_label(model_name).replace("\n", " ")
        ax.plot(recall, precision, linewidth=2.6, color=get_model_color(model_name), label=f"{legend_name}  AP={ap_value:.3f}")
    ax.set_title("各算法微平均 PR 对比")
    ax.set_xlabel("召回率")
    ax.set_ylabel("精确率")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.02)
    apply_axis_chrome(ax, grid_axis="both")
    place_legend_lower_left(ax, outside=True, columns=2)
    save_figure(figure, output_path, bottom_margin=0.22)


def plot_per_label_f1_heatmap(per_label_df: pd.DataFrame, output_path: Path) -> None:
    matrix = per_label_df.assign(plot_model=per_label_df["model"].map(get_model_plot_label)).pivot(
        index="plot_model", columns="label", values="f1-score"
    )
    figure, ax = plt.subplots(figsize=(10.6, 5.4))
    sns.heatmap(matrix, annot=True, fmt=".3f", cmap=METRIC_CMAP, linewidths=1, linecolor=CANVAS_BG, ax=ax)
    ax.set_title("各算法各标签 F1 热力图")
    ax.set_xlabel("标签")
    ax.set_ylabel("算法")
    ax.tick_params(axis="x", rotation=0)
    save_figure(figure, output_path)


def plot_label_distribution(y_full: pd.DataFrame, y_train: pd.DataFrame, y_test: pd.DataFrame, output_path: Path) -> None:
    distribution_df = pd.DataFrame(
        {
            "标签": list(y_full.columns),
            "全量数据": y_full.sum().to_numpy(),
            "训练集": y_train.sum().to_numpy(),
            "测试集": y_test.sum().to_numpy(),
        }
    )
    plot_df = distribution_df.melt(id_vars=["标签"], var_name="数据划分", value_name="样本数")
    figure, ax = plt.subplots(figsize=(10.8, 5.6))
    sns.barplot(
        data=plot_df,
        x="标签",
        y="样本数",
        hue="数据划分",
        ax=ax,
        palette={"全量数据": "#74838F", "训练集": "#4D7C59", "测试集": "#C67B5C"},
    )
    ax.set_title("标签分布与数据切分情况")
    ax.set_xlabel("标签")
    ax.set_ylabel("样本数")
    style_category_axis(ax)
    apply_axis_chrome(ax, grid_axis="y")
    add_bar_value_labels(ax, fmt="%.0f")
    place_legend_lower_left(ax, outside=True, columns=3)
    save_figure(figure, output_path, bottom_margin=0.2)


def save_comparison_workbook(
    path: Path,
    metrics_df: pd.DataFrame,
    split_info_df: pd.DataFrame,
    label_distribution_df: pd.DataFrame,
    per_label_metric_df: pd.DataFrame,
    roc_auc_df: pd.DataFrame,
    pr_auc_df: pd.DataFrame,
) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        localize_metrics_frame(metrics_df).to_excel(writer, sheet_name="总体指标", index=False)
        localize_split_info_frame(split_info_df).to_excel(writer, sheet_name="数据切分", index=False)
        localize_label_distribution_frame(label_distribution_df).to_excel(writer, sheet_name="标签分布", index=False)
        localize_per_label_metric_frame(per_label_metric_df).to_excel(writer, sheet_name="各标签指标", index=False)
        localize_curve_frame(roc_auc_df, "roc_auc").to_excel(writer, sheet_name="ROC面积汇总", index=False)
        localize_curve_frame(pr_auc_df, "average_precision").to_excel(writer, sheet_name="PR面积汇总", index=False)
    autosize_workbook(path)


def write_experiment_readme(
    path: Path,
    source_mat_path: Path,
    metrics_df: pd.DataFrame,
    label_names: List[str],
    sample_count: int,
    feature_count: int,
    split_info_df: pd.DataFrame,
    train_ratios: List[float],
) -> None:
    best_row = metrics_df.iloc[0]
    metric_name_map = {
        "macro_precision": "Macro-Precision",
        "macro_recall": "Macro-Recall",
        "macro_f1": "Macro-F1",
        "micro_f1": "Micro-F1",
        "jaccard_macro": "Macro-Jaccard",
        "roc_auc_micro": "Micro-ROC_AUC",
        "pr_auc_micro": "Micro-PR_AUC",
    }
    lines = [
        "scikit-learn 多算法 MAT 分类实验说明",
        "=" * 40,
        "",
        f"源 MAT 文件: {source_mat_path}",
        f"样本数: {sample_count}",
        f"特征数: {feature_count}",
        f"标签数: {len(label_names)}",
        f"标签名称: {', '.join(label_names)}",
        "",
        "本次算法:",
    ]
    for model_name in metrics_df["model"].tolist():
        lines.append(f"- {model_name}")
    lines.extend(["", "数据切分设置:"])
    for column, value in split_info_df.iloc[0].items():
        lines.append(f"- {column}: {value}")
    lines.extend(
        [
            "",
            "综合表现最优模型:",
            f"- 模型: {best_row['model']}",
            f"- {metric_name_map['macro_precision']}: {best_row['macro_precision']:.4f}",
            f"- {metric_name_map['macro_recall']}: {best_row['macro_recall']:.4f}",
            f"- {metric_name_map['macro_f1']}: {best_row['macro_f1']:.4f}",
            f"- {metric_name_map['micro_f1']}: {best_row['micro_f1']:.4f}",
            f"- {metric_name_map['jaccard_macro']}: {best_row['jaccard_macro']:.4f}",
            f"- {metric_name_map['roc_auc_micro']}: {best_row['roc_auc_micro']:.4f}",
            f"- {metric_name_map['pr_auc_micro']}: {best_row['pr_auc_micro']:.4f}",
            "",
            "多比例稳健性实验:",
            f"- 训练样本使用率: {' / '.join(format_ratio_label(ratio) for ratio in train_ratios)}",
            "- 说明: 固定同一测试集，仅缩放训练池使用比例，用于展示样本规模变化下的算法稳定性。",
            "",
            "目录说明:",
            "- 综合对比/: 各算法之间的总对比表和对比图。",
            "- 01_*/02_*/...: 每个算法自己的完整结果子文件夹，包含模型文件、预测结果、分类报告、混淆矩阵、ROC/PR 图，以及可直接运行的 run_当前算法.py。",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def sample_training_subset_indices(train_index: pd.Index, ratio: float, seed: int) -> pd.Index:
    ratio = float(ratio)
    subset_size = max(1, int(round(len(train_index) * ratio)))
    if subset_size >= len(train_index):
        return train_index
    rng = np.random.default_rng(seed + int(round(ratio * 1000)))
    selected = rng.choice(train_index.to_numpy(), size=subset_size, replace=False)
    return pd.Index(sorted(selected))


def run_ratio_stability_experiment(
    X_train: pd.DataFrame,
    y_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_test: pd.DataFrame,
    train_ratios: List[float],
    seed: int,
) -> pd.DataFrame:
    ratio_rows: List[Dict[str, float]] = []
    base_index = X_train.index
    ratio_index_map = {ratio: sample_training_subset_indices(base_index, ratio, seed) for ratio in train_ratios}

    for ratio in train_ratios:
        subset_index = ratio_index_map[ratio]
        X_ratio = X_train.loc[subset_index]
        y_ratio = y_train.loc[subset_index]

        for spec in build_model_specs(seed):
            fit_started_at = perf_counter()
            spec.estimator.fit(X_ratio, y_ratio)
            fit_time_sec = perf_counter() - fit_started_at

            predict_started_at = perf_counter()
            y_pred_array = spec.estimator.predict(X_test)
            y_score = get_probability_scores(spec.estimator, X_test)
            predict_time_sec = perf_counter() - predict_started_at

            y_pred_df = pd.DataFrame(y_pred_array, columns=y_test.columns, index=y_test.index).astype(int)
            metric_row = compute_overall_metrics(y_test, y_pred_df, y_score)
            metric_row.update(
                {
                    "model": spec.display_name,
                    "train_ratio": float(ratio),
                    "train_ratio_label": format_ratio_label(ratio),
                    "train_samples": int(len(X_ratio)),
                    "test_samples": int(len(X_test)),
                    "fit_time_sec": float(fit_time_sec),
                    "predict_time_sec": float(predict_time_sec),
                }
            )
            ratio_rows.append(metric_row)

    ratio_df = pd.DataFrame(ratio_rows).sort_values(
        by=["train_ratio", "macro_f1", "micro_f1"],
        ascending=[True, False, False],
    ).reset_index(drop=True)
    return ratio_df


def plot_ratio_line_chart(
    ratio_df: pd.DataFrame,
    metric_column: str,
    metric_label: str,
    title: str,
    output_path: Path,
) -> None:
    sort_basis = (
        ratio_df[ratio_df["train_ratio"] == ratio_df["train_ratio"].max()][["model", metric_column]]
        .sort_values(by=metric_column, ascending=False)["model"]
        .tolist()
    )
    ordered_df = (
        ratio_df.copy()
        .assign(plot_model=ratio_df["model"].map(get_model_plot_label))
        .set_index(["model", "plot_model", "train_ratio_label"])[metric_column]
        .unstack("train_ratio_label")
        .loc[sort_basis]
    )
    ratio_labels = [format_ratio_label(ratio) for ratio in sorted(ratio_df["train_ratio"].unique())]
    ordered_df = ordered_df[ratio_labels]

    x = np.arange(len(ordered_df.index), dtype=float)
    width = 0.22
    colors = ["#9EC5FE", "#60A5FA", "#2563EB"]

    figure, ax = plt.subplots(figsize=(13.4, 6.1))
    containers = []
    for idx, ratio_label in enumerate(ratio_labels):
        bars = ax.bar(
            x + (idx - 1) * width,
            ordered_df[ratio_label].to_numpy(),
            width=width,
            label=ratio_label,
            color=colors[idx],
            edgecolor="#FFFFFF",
        )
        containers.append(bars)

    ax.set_title(title)
    ax.set_xlabel("")
    ax.set_ylabel(metric_label)
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x, labels=[label for _, label in ordered_df.index])
    style_category_axis(ax)
    apply_axis_chrome(ax, grid_axis="y")
    ax.margins(x=0.03)
    place_legend_lower_left(ax, outside=True, columns=3)
    for bars in containers:
        ax.bar_label(bars, fmt="%.3f", fontsize=8, rotation=90, padding=2, color=TEXT_COLOR)
    save_figure(figure, output_path, bottom_margin=0.18)


def plot_ratio_heatmap(ratio_df: pd.DataFrame, metric_column: str, metric_label: str, output_path: Path) -> None:
    heatmap_df = ratio_df.assign(plot_model=ratio_df["model"].map(get_model_plot_label)).pivot(
        index="plot_model", columns="train_ratio_label", values=metric_column
    )
    ordered_columns = [format_ratio_label(ratio) for ratio in sorted(ratio_df["train_ratio"].unique())]
    heatmap_df = heatmap_df[ordered_columns]
    figure, ax = plt.subplots(figsize=(8.8, 4.9))
    sns.heatmap(heatmap_df, annot=True, fmt=".3f", cmap=METRIC_CMAP, linewidths=1, linecolor=CANVAS_BG, ax=ax)
    ax.set_title(f"{metric_label} 训练比例稳健性热力图")
    ax.set_xlabel("训练样本使用率")
    ax.set_ylabel("算法")
    ax.tick_params(axis="x", rotation=0)
    save_figure(figure, output_path)


def plot_best_model_ratio_metrics(ratio_df: pd.DataFrame, best_model_name: str, output_path: Path) -> None:
    best_df = ratio_df[ratio_df["model"] == best_model_name].sort_values("train_ratio")
    metric_map = {
        "macro_precision": ("Macro-Precision", PRECISION_COLOR),
        "macro_recall": ("Macro-Recall", RECALL_COLOR),
        "macro_f1": ("Macro-F1", F1_COLOR),
    }
    figure, ax = plt.subplots(figsize=(8.8, 5.4))
    for metric_key, (metric_label, color) in metric_map.items():
        ax.plot(
            best_df["train_ratio"],
            best_df[metric_key],
            marker="o",
            markersize=7,
            linewidth=2.4,
            color=color,
            label=metric_label,
        )
        for _, row in best_df.iterrows():
            ax.text(row["train_ratio"], row[metric_key] + 0.012, f"{row[metric_key]:.3f}", fontsize=8.5, color=color, ha="center")

    ax.set_title(f"{best_model_name} 多比例指标变化图")
    ax.set_xlabel("训练样本使用率")
    ax.set_ylabel("得分")
    ax.set_xticks(best_df["train_ratio"])
    ax.set_xticklabels([format_ratio_label(ratio) for ratio in best_df["train_ratio"]])
    ax.set_ylim(max(0.0, best_df[["macro_precision", "macro_recall", "macro_f1"]].min().min() - 0.05), 1.01)
    apply_axis_chrome(ax, grid_axis="both")
    place_legend_lower_left(ax, outside=True, columns=3)
    save_figure(figure, output_path, bottom_margin=0.2)


def save_ratio_experiment_workbook(path: Path, ratio_df: pd.DataFrame, best_model_name: str) -> None:
    best_model_ratio_df = ratio_df[ratio_df["model"] == best_model_name].copy()
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        localize_metrics_frame(ratio_df).to_excel(writer, sheet_name="比例实验明细", index=False)
        localize_metrics_frame(best_model_ratio_df).to_excel(writer, sheet_name="最佳模型比例曲线", index=False)
    autosize_workbook(path)


def run_single_model(
    model_key: str,
    mat_path: Path,
    output_dir: Path,
    test_size: float = 0.25,
    seed: int = 42,
) -> Dict[str, float]:
    configure_plot_style()
    mat_path = resolve_mat_path(mat_path)
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    X_df, Y_df, label_names, sample_meta = load_mat_dataset(mat_path)
    X_train, X_test, y_train, y_test, _train_indices, test_indices = train_test_split(
        X_df,
        Y_df,
        np.arange(len(X_df)),
        test_size=test_size,
        random_state=seed,
    )

    spec = get_model_spec(seed, model_key)

    fit_started_at = perf_counter()
    spec.estimator.fit(X_train, y_train)
    fit_time_sec = perf_counter() - fit_started_at

    predict_started_at = perf_counter()
    y_pred_array = spec.estimator.predict(X_test)
    y_score = get_probability_scores(spec.estimator, X_test)
    predict_time_sec = perf_counter() - predict_started_at

    y_pred_df = pd.DataFrame(y_pred_array, columns=label_names, index=y_test.index).astype(int)
    overall_metrics = compute_overall_metrics(y_test, y_pred_df, y_score)
    overall_metrics["fit_time_sec"] = float(fit_time_sec)
    overall_metrics["predict_time_sec"] = float(predict_time_sec)
    overall_metrics["model"] = spec.display_name

    report_dict = classification_report(
        y_test,
        y_pred_df,
        target_names=label_names,
        output_dict=True,
        zero_division=0,
    )
    report_df = pd.DataFrame(report_dict).T
    confusion_array = multilabel_confusion_matrix(y_test, y_pred_df)
    confusion_df = flatten_confusion_matrices(confusion_array, label_names)
    roc_auc_df, pr_auc_df = compute_curve_tables(y_test, y_score, label_names)
    predictions_df = build_predictions_table(sample_meta, test_indices, y_test, y_pred_df, y_score, label_names)

    save_model_workbook(
        output_dir / "模型结果.xlsx",
        overall_metrics=overall_metrics,
        report_df=report_df,
        confusion_df=confusion_df,
        roc_df=roc_auc_df,
        pr_df=pr_auc_df,
        predictions_df=predictions_df,
    )
    with pd.ExcelWriter(output_dir / "预测结果.xlsx", engine="openpyxl") as writer:
        predictions_df.to_excel(writer, sheet_name="predictions", index=False)
    autosize_workbook(output_dir / "预测结果.xlsx")
    plot_confusion_grid(confusion_array, label_names, output_dir / "混淆矩阵图.png", spec.display_name)
    plot_roc_curves(y_test, y_score, label_names, output_dir / "受试者工作特征曲线图.png", spec.display_name)
    plot_pr_curves(y_test, y_score, label_names, output_dir / "查准率召回率曲线图.png", spec.display_name)
    plot_label_metric(
        report_df,
        label_names,
        metric_key="precision",
        metric_label="精确率",
        color=PRECISION_COLOR,
        output_path=output_dir / "各标签精确率柱状图.png",
        model_name=spec.display_name,
    )
    plot_label_metric(
        report_df,
        label_names,
        metric_key="recall",
        metric_label="召回率",
        color=RECALL_COLOR,
        output_path=output_dir / "各标签召回率柱状图.png",
        model_name=spec.display_name,
    )
    plot_label_metric(
        report_df,
        label_names,
        metric_key="f1-score",
        metric_label="F1值",
        color=F1_COLOR,
        output_path=output_dir / "各标签F1柱状图.png",
        model_name=spec.display_name,
    )
    write_model_summary(output_dir / "结果摘要.txt", spec.display_name, overall_metrics, label_names, report_df)
    dump(spec.estimator, output_dir / "模型文件.joblib")

    return overall_metrics


def write_single_model_runner(path: Path, spec: ModelSpec) -> None:
    script_text = f"""#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


CURRENT_DIR = Path(__file__).resolve().parent
RUN_DIR = CURRENT_DIR.parent
BUNDLE_DIR = RUN_DIR.parent

if str(RUN_DIR) not in sys.path:
    sys.path.insert(0, str(RUN_DIR))

from run_mat_sklearn_classification_suite import run_single_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="重新运行当前算法，并覆盖当前文件夹中的结果文件。")
    parser.add_argument("--mat-path", type=Path, default=BUNDLE_DIR / "output.mat", help="默认使用当前数据包内的 output.mat")
    parser.add_argument("--seed", type=int, default=42, help="随机种子，默认 42。")
    parser.add_argument("--test-size", type=float, default=0.25, help="测试集比例，默认 0.25。")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_single_model(
        model_key="{spec.model_key}",
        mat_path=args.mat_path,
        output_dir=CURRENT_DIR,
        test_size=args.test_size,
        seed=args.seed,
    )
    print(f"已完成 {spec.display_name} 的结果重生成，输出目录: {{CURRENT_DIR}}")


if __name__ == "__main__":
    main()
"""
    path.write_text(script_text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    configure_plot_style()
    train_ratios = sanitize_train_ratios(args.train_ratios)

    mat_path = resolve_mat_path(args.mat_path)
    X_df, Y_df, label_names, sample_meta = load_mat_dataset(mat_path)

    X_train, X_test, y_train, y_test, _train_indices, test_indices = train_test_split(
        X_df,
        Y_df,
        np.arange(len(X_df)),
        test_size=args.test_size,
        random_state=args.seed,
    )

    run_dir, comparison_dir = make_output_dirs(args.output_root.resolve())
    split_info_df = pd.DataFrame(
        [
            {
                "source_mat_path": str(mat_path),
                "seed": args.seed,
                "test_size": args.test_size,
                "train_samples": len(X_train),
                "test_samples": len(X_test),
                "feature_count": X_df.shape[1],
                "label_count": Y_df.shape[1],
                "train_ratio_study": " / ".join(format_ratio_label(ratio) for ratio in train_ratios),
            }
        ]
    )

    label_distribution_df = pd.DataFrame(
        {
            "label": label_names,
            "full_count": Y_df.sum().to_numpy().astype(int),
            "train_count": y_train.sum().to_numpy().astype(int),
            "test_count": y_test.sum().to_numpy().astype(int),
            "full_ratio": np.round(Y_df.mean().to_numpy(), 4),
            "train_ratio": np.round(y_train.mean().to_numpy(), 4),
            "test_ratio": np.round(y_test.mean().to_numpy(), 4),
        }
    )

    metrics_rows: List[Dict[str, float]] = []
    per_label_metric_frames: List[pd.DataFrame] = []
    roc_auc_frames: List[pd.DataFrame] = []
    pr_auc_frames: List[pd.DataFrame] = []
    micro_roc_map: Dict[str, Tuple[np.ndarray, np.ndarray, float]] = {}
    micro_pr_map: Dict[str, Tuple[np.ndarray, np.ndarray, float]] = {}

    for spec in build_model_specs(args.seed):
        model_dir = run_dir / spec.folder_name
        model_dir.mkdir(parents=True, exist_ok=False)

        fit_started_at = perf_counter()
        spec.estimator.fit(X_train, y_train)
        fit_time_sec = perf_counter() - fit_started_at

        predict_started_at = perf_counter()
        y_pred_array = spec.estimator.predict(X_test)
        y_score = get_probability_scores(spec.estimator, X_test)
        predict_time_sec = perf_counter() - predict_started_at

        y_pred_df = pd.DataFrame(y_pred_array, columns=label_names, index=y_test.index).astype(int)
        overall_metrics = compute_overall_metrics(y_test, y_pred_df, y_score)
        overall_metrics["fit_time_sec"] = float(fit_time_sec)
        overall_metrics["predict_time_sec"] = float(predict_time_sec)
        overall_metrics["model"] = spec.display_name

        report_dict = classification_report(
            y_test,
            y_pred_df,
            target_names=label_names,
            output_dict=True,
            zero_division=0,
        )
        report_df = pd.DataFrame(report_dict).T
        confusion_array = multilabel_confusion_matrix(y_test, y_pred_df)
        confusion_df = flatten_confusion_matrices(confusion_array, label_names)
        roc_auc_df, pr_auc_df = compute_curve_tables(y_test, y_score, label_names)
        predictions_df = build_predictions_table(sample_meta, test_indices, y_test, y_pred_df, y_score, label_names)

        save_model_workbook(
            model_dir / "模型结果.xlsx",
            overall_metrics=overall_metrics,
            report_df=report_df,
            confusion_df=confusion_df,
            roc_df=roc_auc_df,
            pr_df=pr_auc_df,
            predictions_df=predictions_df,
        )
        with pd.ExcelWriter(model_dir / "预测结果.xlsx", engine="openpyxl") as writer:
            predictions_df.to_excel(writer, sheet_name="predictions", index=False)
        autosize_workbook(model_dir / "预测结果.xlsx")
        plot_confusion_grid(confusion_array, label_names, model_dir / "混淆矩阵图.png", spec.display_name)
        plot_roc_curves(y_test, y_score, label_names, model_dir / "受试者工作特征曲线图.png", spec.display_name)
        plot_pr_curves(y_test, y_score, label_names, model_dir / "查准率召回率曲线图.png", spec.display_name)
        plot_label_metric(
            report_df,
            label_names,
            metric_key="precision",
            metric_label="精确率",
            color=PRECISION_COLOR,
            output_path=model_dir / "各标签精确率柱状图.png",
            model_name=spec.display_name,
        )
        plot_label_metric(
            report_df,
            label_names,
            metric_key="recall",
            metric_label="召回率",
            color=RECALL_COLOR,
            output_path=model_dir / "各标签召回率柱状图.png",
            model_name=spec.display_name,
        )
        plot_label_metric(
            report_df,
            label_names,
            metric_key="f1-score",
            metric_label="F1值",
            color=F1_COLOR,
            output_path=model_dir / "各标签F1柱状图.png",
            model_name=spec.display_name,
        )
        write_model_summary(model_dir / "结果摘要.txt", spec.display_name, overall_metrics, label_names, report_df)
        dump(spec.estimator, model_dir / "模型文件.joblib")
        write_single_model_runner(model_dir / "run_当前算法.py", spec)

        fpr_micro, tpr_micro, _ = roc_curve(y_test.to_numpy().ravel(), y_score.ravel())
        micro_roc_map[spec.display_name] = (
            fpr_micro,
            tpr_micro,
            float(roc_auc_score(y_test, y_score, average="micro")),
        )

        precision_micro, recall_micro, _ = precision_recall_curve(y_test.to_numpy().ravel(), y_score.ravel())
        micro_pr_map[spec.display_name] = (
            recall_micro,
            precision_micro,
            float(average_precision_score(y_test, y_score, average="micro")),
        )

        metrics_rows.append(overall_metrics)

        current_label_metrics = report_df.loc[label_names, ["precision", "recall", "f1-score", "support"]].reset_index()
        current_label_metrics["model"] = spec.display_name
        current_label_metrics = current_label_metrics.rename(columns={"index": "label"})
        per_label_metric_frames.append(current_label_metrics)

        current_roc_auc = roc_auc_df.copy()
        current_roc_auc["model"] = spec.display_name
        roc_auc_frames.append(current_roc_auc)

        current_pr_auc = pr_auc_df.copy()
        current_pr_auc["model"] = spec.display_name
        pr_auc_frames.append(current_pr_auc)

    metrics_df = pd.DataFrame(metrics_rows).sort_values(
        by=["macro_f1", "micro_f1", "jaccard_macro", "roc_auc_micro"],
        ascending=[False, False, False, False],
    ).reset_index(drop=True)
    best_model_name = metrics_df.iloc[0]["model"]
    per_label_metric_df = pd.concat(per_label_metric_frames, ignore_index=True)
    roc_auc_by_model_df = pd.concat(roc_auc_frames, ignore_index=True)
    pr_auc_by_model_df = pd.concat(pr_auc_frames, ignore_index=True)
    ratio_df = run_ratio_stability_experiment(
        X_train=X_train,
        y_train=y_train,
        X_test=X_test,
        y_test=y_test,
        train_ratios=train_ratios,
        seed=args.seed,
    )

    save_comparison_workbook(
        comparison_dir / "综合对比结果.xlsx",
        metrics_df=metrics_df,
        split_info_df=split_info_df,
        label_distribution_df=label_distribution_df,
        per_label_metric_df=per_label_metric_df,
        roc_auc_df=roc_auc_by_model_df,
        pr_auc_df=pr_auc_by_model_df,
    )
    plot_core_metric_bars(metrics_df, comparison_dir / "01_核心F1指标对比图.png")
    plot_precision_bars(metrics_df, comparison_dir / "02_精确率对比图.png")
    plot_recall_bars(metrics_df, comparison_dir / "03_召回率对比图.png")
    plot_auc_jaccard_bars(metrics_df, comparison_dir / "04_曲线面积与宏平均Jaccard热力图.png")
    plot_hamming_time_bars(metrics_df, comparison_dir / "05_汉明损失与耗时对比图.png")
    plot_metric_heatmap(metrics_df, comparison_dir / "06_总体指标热力图.png")
    plot_micro_roc_comparison(micro_roc_map, comparison_dir / "07_微平均受试者工作特征曲线对比图.png")
    plot_micro_pr_comparison(micro_pr_map, comparison_dir / "08_微平均查准率召回率曲线对比图.png")
    plot_per_label_f1_heatmap(per_label_metric_df, comparison_dir / "09_各标签F1热力图.png")
    plot_label_distribution(Y_df, y_train, y_test, comparison_dir / "10_标签分布图.png")

    ratio_dir = comparison_dir / "训练比例稳健性分析"
    ratio_dir.mkdir(parents=True, exist_ok=False)
    save_ratio_experiment_workbook(ratio_dir / "多比例训练稳健性实验.xlsx", ratio_df, best_model_name)
    plot_ratio_line_chart(
        ratio_df,
        "macro_f1",
        "Macro-F1",
        "25% / 50% / 75% 样本下 Macro-F1 对比",
        ratio_dir / "01_25_50_75样本Macro-F1对比图.png",
    )
    plot_ratio_line_chart(
        ratio_df,
        "micro_f1",
        "Micro-F1",
        "25% / 50% / 75% 样本下 Micro-F1 对比",
        ratio_dir / "02_25_50_75样本Micro-F1对比图.png",
    )

    write_experiment_readme(
        run_dir / "实验说明.txt",
        source_mat_path=mat_path,
        metrics_df=metrics_df,
        label_names=label_names,
        sample_count=len(X_df),
        feature_count=X_df.shape[1],
        split_info_df=split_info_df,
        train_ratios=train_ratios,
    )
    shutil.copy2(__file__, run_dir / "run_mat_sklearn_classification_suite.py")
    (run_dir / "源数据路径.txt").write_text(str(mat_path), encoding="utf-8")
    (run_dir / "指标汇总.json").write_text(
        json.dumps(metrics_df.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (run_dir / "比例实验汇总.json").write_text(
        json.dumps(ratio_df.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Source MAT: {mat_path}")
    print(f"Output directory: {run_dir}")
    print(f"Train ratio study: {' / '.join(format_ratio_label(ratio) for ratio in train_ratios)}")
    print("")
    print("Overall ranking:")
    print(
        metrics_df[
            [
                "model",
                "micro_precision",
                "micro_recall",
                "micro_f1",
                "macro_f1",
                "jaccard_macro",
                "roc_auc_micro",
                "pr_auc_micro",
                "hamming_loss",
            ]
        ].to_string(index=False)
    )
    print("")
    print("Generated top-level items:")
    for path in sorted(run_dir.iterdir()):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
