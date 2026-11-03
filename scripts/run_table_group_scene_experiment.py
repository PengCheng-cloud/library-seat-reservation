#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from joblib import dump
from matplotlib import font_manager
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_DATASET = DATA_DIR / "table_group_scene_annotation.xlsx"
RESULTS_ROOT = DATA_DIR / "table_group_scene_experiment_results"

SHEET_NAME = "table_group_labels"
ID_COL = "桌组编号"
LABEL_COL = "建议场景标签"
FEATURE_COLS = [
    "单桌容量",
    "靠窗比例",
    "插座比例",
    "安静比例",
    "通道比例",
    "卫生间临近比例",
    "茶水间临近比例",
    "空调临近比例",
    "书架临近比例",
    "日照比例",
]
PREFERRED_CLASS_ORDER = ["深度专注型", "舒适久学型", "设备作业型", "开放协作型"]
MODEL_PRIORITY = {
    "多层感知机MLP": 4,
    "逻辑回归": 3,
    "K近邻KNN": 2,
    "决策树": 1,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run table-group scene classification experiments with CV."
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATASET,
        help="Path to the table-group annotation workbook.",
    )
    parser.add_argument(
        "--n-splits",
        type=int,
        default=5,
        help="Number of StratifiedKFold splits. Default: 5",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed used for CV and model initialization.",
    )
    return parser.parse_args()


def configure_plot_style() -> None:
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    preferred_fonts = ["Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "DejaVu Sans"]
    selected_font = next(
        (font_name for font_name in preferred_fonts if font_name in available_fonts),
        "DejaVu Sans",
    )
    matplotlib.rcParams["font.family"] = "sans-serif"
    matplotlib.rcParams["font.sans-serif"] = [selected_font, "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    sns.set_theme(style="whitegrid", rc={"font.sans-serif": [selected_font, "DejaVu Sans"]})


def safe_name(text: str) -> str:
    return (
        text.replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
    )


def resolve_dataset_path(path: Path) -> Path:
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    return path.resolve()


def resolve_class_order(y_values: pd.Series) -> List[str]:
    present = list(dict.fromkeys(y_values.astype(str).tolist()))
    ordered = [label for label in PREFERRED_CLASS_ORDER if label in present]
    ordered.extend(label for label in present if label not in ordered)
    return ordered


def load_dataset(dataset_path: Path) -> Tuple[pd.DataFrame, pd.Series, pd.Series, List[str]]:
    df = pd.read_excel(dataset_path, sheet_name=SHEET_NAME)
    X = df[FEATURE_COLS].apply(pd.to_numeric, errors="raise").astype(float)
    y = df[LABEL_COL].astype(str)
    group_ids = df[ID_COL].astype(str)
    class_order = resolve_class_order(y)
    return X, y, group_ids, class_order


def build_models(random_state: int) -> Dict[str, object]:
    return {
        "决策树": DecisionTreeClassifier(
            max_depth=2,
            random_state=random_state,
        ),
        "K近邻KNN": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", KNeighborsClassifier(n_neighbors=5)),
            ]
        ),
        "逻辑回归": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                (
                    "model",
                    LogisticRegression(
                        max_iter=2000,
                    ),
                ),
            ]
        ),
        "多层感知机MLP": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                (
                    "model",
                    MLPClassifier(
                        hidden_layer_sizes=(32, 16),
                        activation="relu",
                        solver="adam",
                        alpha=0.001,
                        learning_rate_init=0.001,
                        max_iter=2000,
                        random_state=random_state,
                    ),
                ),
            ]
        ),
    }


def make_output_dir() -> Path:
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    output_dir = RESULTS_ROOT / datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir.mkdir(parents=True, exist_ok=False)
    return output_dir


def plot_class_distribution(y: pd.Series, class_order: List[str], output_dir: Path) -> None:
    counts = y.value_counts().reindex(class_order)
    fig, ax = plt.subplots(figsize=(9, 5))
    colors = sns.color_palette("Set2", n_colors=len(class_order))
    bars = ax.bar(counts.index, counts.values, color=colors)
    ax.set_title("桌组级场景标签分布")
    ax.set_xlabel("场景标签")
    ax.set_ylabel("桌组数量")
    for bar, value in zip(bars, counts.values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            value + 1.5,
            str(int(value)),
            ha="center",
            va="bottom",
            fontsize=10,
        )
    fig.tight_layout()
    fig.savefig(output_dir / "class_distribution.png", dpi=220)
    plt.close(fig)


def plot_metrics_comparison(metrics_df: pd.DataFrame, output_dir: Path) -> None:
    plot_df = metrics_df.melt(
        id_vars=["模型"],
        value_vars=["准确率", "宏平均精确率", "宏平均召回率", "宏平均F1"],
        var_name="指标",
        value_name="分数",
    )
    fig, ax = plt.subplots(figsize=(12, 6))
    sns.barplot(data=plot_df, x="模型", y="分数", hue="指标", ax=ax)
    ax.set_title("桌组级分类模型交叉验证指标对比")
    ax.set_xlabel("模型")
    ax.set_ylabel("平均指标值")
    ax.set_ylim(0, 1.05)
    for container in ax.containers:
        ax.bar_label(container, fmt="%.3f", fontsize=9, rotation=90, padding=2)
    ax.legend(title="指标", loc="lower right")
    fig.tight_layout()
    fig.savefig(output_dir / "model_metrics_comparison.png", dpi=220)
    plt.close(fig)


def plot_macro_f1_cv(fold_metrics_df: pd.DataFrame, output_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 6))
    sns.lineplot(
        data=fold_metrics_df,
        x="折次",
        y="宏平均F1",
        hue="模型",
        marker="o",
        ax=ax,
    )
    ax.set_title("各模型在不同折次上的 Macro-F1")
    ax.set_xlabel("交叉验证折次")
    ax.set_ylabel("Macro-F1")
    ax.set_ylim(0.6, 1.05)
    fig.tight_layout()
    fig.savefig(output_dir / "macro_f1_by_fold.png", dpi=220)
    plt.close(fig)


def plot_confusion_matrix(cm_df: pd.DataFrame, model_name: str, output_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    sns.heatmap(cm_df, annot=True, fmt="d", cmap="Blues", cbar=False, ax=ax)
    ax.set_title(f"{model_name} 混淆矩阵")
    ax.set_xlabel("预测类别")
    ax.set_ylabel("真实类别")
    fig.tight_layout()
    fig.savefig(output_dir / f"confusion_matrix_{safe_name(model_name)}.png", dpi=220)
    plt.close(fig)


def plot_best_model_report(report_df: pd.DataFrame, output_dir: Path) -> None:
    heatmap_df = report_df[["precision", "recall", "f1-score"]].copy()
    heatmap_df.columns = ["精确率", "召回率", "F1"]
    fig, ax = plt.subplots(figsize=(7, max(4, len(heatmap_df) * 0.6)))
    sns.heatmap(heatmap_df, annot=True, fmt=".3f", cmap="YlGnBu", ax=ax)
    ax.set_title("最佳模型分类报告热力图")
    ax.set_xlabel("指标")
    ax.set_ylabel("类别")
    fig.tight_layout()
    fig.savefig(output_dir / "best_model_report_heatmap.png", dpi=220)
    plt.close(fig)


def evaluate_models(
    X: pd.DataFrame,
    y: pd.Series,
    group_ids: pd.Series,
    class_order: List[str],
    random_state: int,
    n_splits: int,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, pd.DataFrame], Dict[str, pd.DataFrame], Dict[str, pd.DataFrame]]:
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
    metrics_rows = []
    fold_rows = []
    report_frames: Dict[str, pd.DataFrame] = {}
    confusion_frames: Dict[str, pd.DataFrame] = {}
    prediction_frames: Dict[str, pd.DataFrame] = {}

    label_to_int = {label: index for index, label in enumerate(class_order)}
    int_to_label = {index: label for label, index in label_to_int.items()}
    y_encoded = y.map(label_to_int).astype(int)

    for model_name, model in build_models(random_state).items():
        oof_pred = np.full(shape=len(y_encoded), fill_value=-1, dtype=int)
        fold_metrics = []

        for fold_index, (train_idx, test_idx) in enumerate(cv.split(X, y_encoded), start=1):
            current_model = clone(model)
            current_model.fit(X.iloc[train_idx], y_encoded.iloc[train_idx])
            pred = current_model.predict(X.iloc[test_idx])
            oof_pred[test_idx] = pred

            y_true_fold = y_encoded.iloc[test_idx]
            fold_record = {
                "模型": model_name,
                "折次": fold_index,
                "准确率": accuracy_score(y_true_fold, pred),
                "宏平均精确率": precision_score(
                    y_true_fold, pred, average="macro", zero_division=0
                ),
                "宏平均召回率": recall_score(
                    y_true_fold, pred, average="macro", zero_division=0
                ),
                "宏平均F1": f1_score(
                    y_true_fold, pred, average="macro", zero_division=0
                ),
            }
            fold_rows.append(fold_record)
            fold_metrics.append(fold_record)

        y_pred_labels = pd.Series([int_to_label[int(v)] for v in oof_pred], index=y.index)
        prediction_frames[model_name] = pd.DataFrame(
            {
                ID_COL: group_ids.values,
                f"真实{LABEL_COL}": y.values,
                f"预测{LABEL_COL}": y_pred_labels.values,
            }
        )

        report_dict = classification_report(
            y,
            y_pred_labels,
            labels=class_order,
            output_dict=True,
            zero_division=0,
        )
        report_frames[model_name] = pd.DataFrame(report_dict).T

        cm = confusion_matrix(y, y_pred_labels, labels=class_order)
        confusion_frames[model_name] = pd.DataFrame(cm, index=class_order, columns=class_order)

        metrics_rows.append(
            {
                "模型": model_name,
                "准确率": np.mean([row["准确率"] for row in fold_metrics]),
                "准确率标准差": np.std([row["准确率"] for row in fold_metrics], ddof=0),
                "宏平均精确率": np.mean([row["宏平均精确率"] for row in fold_metrics]),
                "宏平均召回率": np.mean([row["宏平均召回率"] for row in fold_metrics]),
                "宏平均F1": np.mean([row["宏平均F1"] for row in fold_metrics]),
            }
        )

    metrics_df = pd.DataFrame(metrics_rows)
    metrics_df["优先级"] = metrics_df["模型"].map(MODEL_PRIORITY).fillna(0)
    metrics_df = metrics_df.sort_values(
        by=["宏平均F1", "准确率", "优先级"],
        ascending=[False, False, False],
    ).drop(columns=["优先级"])

    fold_metrics_df = pd.DataFrame(fold_rows)
    return metrics_df, fold_metrics_df, report_frames, confusion_frames, prediction_frames


def save_results_workbook(
    metrics_df: pd.DataFrame,
    fold_metrics_df: pd.DataFrame,
    report_frames: Dict[str, pd.DataFrame],
    confusion_frames: Dict[str, pd.DataFrame],
    prediction_frames: Dict[str, pd.DataFrame],
    output_dir: Path,
) -> Path:
    workbook_path = output_dir / "experiment_results.xlsx"
    with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
        metrics_df.to_excel(writer, sheet_name="metrics_summary", index=False)
        fold_metrics_df.to_excel(writer, sheet_name="cv_fold_metrics", index=False)
        for model_name, frame in prediction_frames.items():
            frame.to_excel(writer, sheet_name=f"pred_{safe_name(model_name)}"[:31], index=False)
        for model_name, frame in report_frames.items():
            frame.to_excel(writer, sheet_name=f"report_{safe_name(model_name)}"[:31])
        for model_name, frame in confusion_frames.items():
            frame.to_excel(writer, sheet_name=f"cm_{safe_name(model_name)}"[:31])
    return workbook_path


def write_summary_text(
    dataset_path: Path,
    output_dir: Path,
    metrics_df: pd.DataFrame,
    feature_cols: List[str],
    best_model_name: str,
    n_splits: int,
    random_state: int,
) -> Path:
    summary_path = output_dir / "experiment_summary.txt"
    lines = [
        f"数据集: {dataset_path}",
        f"输出目录: {output_dir}",
        f"交叉验证折数: {n_splits}",
        f"随机种子: {random_state}",
        f"实验对象: 桌组级场景分类",
        f"使用特征: {', '.join(feature_cols)}",
        "",
        "模型指标汇总:",
    ]
    for _, row in metrics_df.iterrows():
        lines.append(
            "  {model}: accuracy={acc:.4f}, acc_std={std:.4f}, "
            "macro_precision={pre:.4f}, macro_recall={rec:.4f}, macro_f1={f1:.4f}".format(
                model=row["模型"],
                acc=row["准确率"],
                std=row["准确率标准差"],
                pre=row["宏平均精确率"],
                rec=row["宏平均召回率"],
                f1=row["宏平均F1"],
            )
        )
    lines.extend(["", f"最佳模型: {best_model_name}"])
    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return summary_path


def save_metadata(
    dataset_path: Path,
    output_dir: Path,
    metrics_df: pd.DataFrame,
    fold_metrics_df: pd.DataFrame,
    feature_cols: List[str],
    n_splits: int,
    random_state: int,
) -> Path:
    metadata = {
        "dataset_path": str(dataset_path),
        "output_dir": str(output_dir),
        "feature_columns": feature_cols,
        "n_splits": n_splits,
        "random_state": random_state,
        "metrics": metrics_df.to_dict(orient="records"),
        "fold_metrics": fold_metrics_df.to_dict(orient="records"),
    }
    metadata_path = output_dir / "run_metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata_path


def main() -> None:
    args = parse_args()
    configure_plot_style()
    dataset_path = resolve_dataset_path(args.data)
    X, y, group_ids, class_order = load_dataset(dataset_path)
    output_dir = make_output_dir()

    plot_class_distribution(y, class_order, output_dir)
    metrics_df, fold_metrics_df, report_frames, confusion_frames, prediction_frames = evaluate_models(
        X=X,
        y=y,
        group_ids=group_ids,
        class_order=class_order,
        random_state=args.random_state,
        n_splits=args.n_splits,
    )

    plot_metrics_comparison(metrics_df, output_dir)
    plot_macro_f1_cv(fold_metrics_df, output_dir)
    for model_name, cm_df in confusion_frames.items():
        plot_confusion_matrix(cm_df, model_name, output_dir)

    best_model_name = metrics_df.iloc[0]["模型"]
    best_model = clone(build_models(args.random_state)[best_model_name])
    best_model.fit(X, y)
    dump(best_model, output_dir / "best_model.joblib")

    report_frames[best_model_name].to_excel(output_dir / "best_model_classification_report.xlsx")
    prediction_frames[best_model_name].to_excel(output_dir / "best_model_predictions.xlsx", index=False)
    plot_best_model_report(
        report_frames[best_model_name].loc[class_order, ["precision", "recall", "f1-score"]],
        output_dir,
    )

    save_results_workbook(
        metrics_df=metrics_df,
        fold_metrics_df=fold_metrics_df,
        report_frames=report_frames,
        confusion_frames=confusion_frames,
        prediction_frames=prediction_frames,
        output_dir=output_dir,
    )
    write_summary_text(
        dataset_path=dataset_path,
        output_dir=output_dir,
        metrics_df=metrics_df,
        feature_cols=FEATURE_COLS,
        best_model_name=best_model_name,
        n_splits=args.n_splits,
        random_state=args.random_state,
    )
    save_metadata(
        dataset_path=dataset_path,
        output_dir=output_dir,
        metrics_df=metrics_df,
        fold_metrics_df=fold_metrics_df,
        feature_cols=FEATURE_COLS,
        n_splits=args.n_splits,
        random_state=args.random_state,
    )

    (RESULTS_ROOT / "latest_run.txt").write_text(str(output_dir), encoding="utf-8")

    print(f"Dataset: {dataset_path}")
    print(f"Results directory: {output_dir}")
    print("")
    print("Metrics summary:")
    print(metrics_df.to_string(index=False))
    print("")
    print(f"Best model: {best_model_name}")
    print(f"Best model artifact: {output_dir / 'best_model.joblib'}")
    print("Generated files:")
    for path in sorted(output_dir.iterdir()):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
