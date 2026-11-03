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
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RESULTS_ROOT = DATA_DIR / "classification_experiment_results"
DEFAULT_DATASET_CANDIDATES = [
    DATA_DIR / "seat_classification_dataset_cn.xlsx",
    DATA_DIR / "seat_classification_dataset.xlsx",
]

SEAT_ID_CANDIDATES = ["座位编号", "seat_id"]
LABEL_CANDIDATES = ["类别标签", "class_label"]
PREFERRED_CLASS_ORDER = ["专注静学型", "采光舒适型", "便捷充电型", "协作交流型"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run seat classification experiments and export metrics/figures."
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=None,
        help="Optional dataset path. Defaults to the generated seat classification workbook.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Proportion of the dataset reserved for testing. Default: 0.2",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed used for train/test split and model initialization.",
    )
    return parser.parse_args()


def configure_plot_style() -> None:
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    preferred_fonts = [
        "Microsoft YaHei",
        "SimHei",
        "SimSun",
        "KaiTi",
        "DejaVu Sans",
    ]
    selected_font = next(
        (font_name for font_name in preferred_fonts if font_name in available_fonts),
        "DejaVu Sans",
    )
    matplotlib.rcParams["font.family"] = "sans-serif"
    matplotlib.rcParams["font.sans-serif"] = [selected_font, "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    sns.set_theme(style="whitegrid", rc={"font.sans-serif": [selected_font, "DejaVu Sans"]})


def resolve_dataset_path(explicit_path: Path | None) -> Path:
    if explicit_path is not None:
        if not explicit_path.exists():
            raise FileNotFoundError(f"Dataset not found: {explicit_path}")
        return explicit_path.resolve()

    for candidate in DEFAULT_DATASET_CANDIDATES:
        if candidate.exists():
            return candidate.resolve()

    raise FileNotFoundError(
        "Could not find a classification dataset workbook in the data directory."
    )


def pick_existing_column(columns: List[str], candidates: List[str], role: str) -> str:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    raise KeyError(f"Could not find the {role} column. Candidates: {candidates}")


def resolve_class_order(y_values: pd.Series) -> List[str]:
    present = list(dict.fromkeys(y_values.astype(str).tolist()))
    ordered = [label for label in PREFERRED_CLASS_ORDER if label in present]
    ordered.extend(label for label in present if label not in ordered)
    return ordered


def safe_name(text: str) -> str:
    return (
        text.replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
    )


def load_dataset(dataset_path: Path) -> Tuple[pd.DataFrame, pd.Series, pd.Series, List[str], str, str]:
    df = pd.read_excel(dataset_path)
    columns = list(df.columns)

    seat_id_col = pick_existing_column(columns, SEAT_ID_CANDIDATES, "seat id")
    label_col = pick_existing_column(columns, LABEL_CANDIDATES, "label")
    feature_cols = [col for col in columns if col not in {seat_id_col, label_col}]

    X = df[feature_cols].apply(pd.to_numeric, errors="raise").astype(int)
    y = df[label_col].astype(str)
    seat_ids = df[seat_id_col].astype(str)
    class_order = resolve_class_order(y)
    return X, y, seat_ids, class_order, seat_id_col, label_col


def build_models(random_state: int) -> Dict[str, object]:
    return {
        "支持向量机SVM": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                (
                    "model",
                    SVC(
                        kernel="rbf",
                        C=2.0,
                        gamma="scale",
                        class_weight="balanced",
                    ),
                ),
            ]
        ),
        "随机森林": RandomForestClassifier(
            n_estimators=400,
            max_depth=12,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=random_state,
        ),
        "多层感知机MLP": Pipeline(
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
                        max_iter=2000,
                        early_stopping=True,
                        validation_fraction=0.1,
                        n_iter_no_change=40,
                        random_state=random_state,
                    ),
                ),
            ]
        ),
    }


def make_output_dir() -> Path:
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    run_name = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = RESULTS_ROOT / run_name
    output_dir.mkdir(parents=True, exist_ok=False)
    return output_dir


def plot_class_distribution(y: pd.Series, class_order: List[str], output_dir: Path) -> None:
    counts = y.value_counts().reindex(class_order)
    fig, ax = plt.subplots(figsize=(9, 5))
    palette = sns.color_palette("Set2", n_colors=len(class_order))
    bars = ax.bar(counts.index, counts.values, color=palette)
    ax.set_title("数据集类别分布")
    ax.set_xlabel("类别")
    ax.set_ylabel("样本数")
    for bar, value in zip(bars, counts.values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            value + 8,
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

    fig, ax = plt.subplots(figsize=(11, 6))
    sns.barplot(data=plot_df, x="模型", y="分数", hue="指标", ax=ax)
    ax.set_title("分类模型指标对比")
    ax.set_xlabel("模型")
    ax.set_ylabel("指标值")
    ax.set_ylim(0, 1.05)
    for container in ax.containers:
        ax.bar_label(container, fmt="%.3f", fontsize=9, rotation=90, padding=2)
    ax.legend(title="指标", loc="lower right")
    fig.tight_layout()
    fig.savefig(output_dir / "model_metrics_comparison.png", dpi=220)
    plt.close(fig)


def plot_confusion_matrix_figure(
    cm_df: pd.DataFrame, model_name: str, output_path: Path
) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    sns.heatmap(
        cm_df,
        annot=True,
        fmt="d",
        cmap="Blues",
        cbar=False,
        ax=ax,
    )
    ax.set_title(f"{model_name} 混淆矩阵")
    ax.set_xlabel("预测类别")
    ax.set_ylabel("真实类别")
    fig.tight_layout()
    fig.savefig(output_path, dpi=220)
    plt.close(fig)


def plot_best_model_report(report_df: pd.DataFrame, output_path: Path) -> None:
    metric_columns = ["precision", "recall", "f1-score"]
    heatmap_df = report_df[metric_columns].copy()
    heatmap_df.columns = ["精确率", "召回率", "F1"]
    fig, ax = plt.subplots(figsize=(7, max(4, len(heatmap_df) * 0.6)))
    sns.heatmap(
        heatmap_df,
        annot=True,
        fmt=".3f",
        cmap="YlGnBu",
        cbar=True,
        ax=ax,
    )
    ax.set_title("最佳模型分类报告热力图")
    ax.set_xlabel("指标")
    ax.set_ylabel("类别")
    fig.tight_layout()
    fig.savefig(output_path, dpi=220)
    plt.close(fig)


def save_results_workbook(
    metrics_df: pd.DataFrame,
    report_frames: Dict[str, pd.DataFrame],
    confusion_frames: Dict[str, pd.DataFrame],
    best_predictions_df: pd.DataFrame,
    output_dir: Path,
) -> Path:
    workbook_path = output_dir / "experiment_results.xlsx"
    with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
        metrics_df.to_excel(writer, sheet_name="metrics_summary", index=False)
        best_predictions_df.to_excel(writer, sheet_name="best_model_predictions", index=False)

        for model_name, report_df in report_frames.items():
            report_df.to_excel(writer, sheet_name=f"report_{safe_name(model_name)}"[:31])

        for model_name, cm_df in confusion_frames.items():
            cm_df.to_excel(writer, sheet_name=f"cm_{safe_name(model_name)}"[:31])

    return workbook_path


def write_summary_text(
    dataset_path: Path,
    output_dir: Path,
    metrics_df: pd.DataFrame,
    best_model_name: str,
    best_model_metrics: pd.Series,
    class_order: List[str],
    test_size: float,
    random_state: int,
) -> Path:
    summary_path = output_dir / "experiment_summary.txt"
    lines = [
        f"数据集: {dataset_path}",
        f"输出目录: {output_dir}",
        f"测试集比例: {test_size}",
        f"随机种子: {random_state}",
        f"类别顺序: {', '.join(class_order)}",
        "",
        "模型指标汇总:",
    ]
    for _, row in metrics_df.iterrows():
        lines.append(
            "  {model}: accuracy={acc:.4f}, macro_precision={pre:.4f}, "
            "macro_recall={rec:.4f}, macro_f1={f1:.4f}".format(
                model=row["模型"],
                acc=row["准确率"],
                pre=row["宏平均精确率"],
                rec=row["宏平均召回率"],
                f1=row["宏平均F1"],
            )
        )
    lines.extend(
        [
            "",
            f"最佳模型: {best_model_name}",
            f"最佳模型准确率: {best_model_metrics['准确率']:.4f}",
            f"最佳模型宏平均F1: {best_model_metrics['宏平均F1']:.4f}",
        ]
    )
    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return summary_path


def save_run_metadata(
    dataset_path: Path,
    output_dir: Path,
    feature_columns: List[str],
    class_order: List[str],
    metrics_df: pd.DataFrame,
    best_model_name: str,
    test_size: float,
    random_state: int,
) -> Path:
    metadata = {
        "dataset_path": str(dataset_path),
        "output_dir": str(output_dir),
        "feature_columns": feature_columns,
        "class_order": class_order,
        "best_model": best_model_name,
        "test_size": test_size,
        "random_state": random_state,
        "metrics": metrics_df.to_dict(orient="records"),
    }
    metadata_path = output_dir / "run_metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata_path


def main() -> None:
    args = parse_args()
    configure_plot_style()

    dataset_path = resolve_dataset_path(args.data)
    X, y, seat_ids, class_order, seat_id_col, label_col = load_dataset(dataset_path)
    output_dir = make_output_dir()
    label_to_int = {label: index for index, label in enumerate(class_order)}
    int_to_label = {index: label for label, index in label_to_int.items()}
    y_encoded = y.map(label_to_int).astype(int)

    X_train, X_test, y_train, y_test, seat_train, seat_test = train_test_split(
        X,
        y_encoded,
        seat_ids,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=y_encoded,
    )

    plot_class_distribution(y, class_order, output_dir)

    metrics_rows = []
    report_frames: Dict[str, pd.DataFrame] = {}
    confusion_frames: Dict[str, pd.DataFrame] = {}
    prediction_tables: Dict[str, pd.DataFrame] = {}
    trained_models: Dict[str, object] = {}

    for model_name, model in build_models(args.random_state).items():
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        trained_models[model_name] = model
        y_test_labels = pd.Series(
            [int_to_label[int(value)] for value in y_test], index=y_test.index
        )
        y_pred_labels = pd.Series(
            [int_to_label[int(value)] for value in y_pred], index=y_test.index
        )

        metrics_rows.append(
            {
                "模型": model_name,
                "准确率": accuracy_score(y_test_labels, y_pred_labels),
                "宏平均精确率": precision_score(
                    y_test_labels, y_pred_labels, average="macro", zero_division=0
                ),
                "宏平均召回率": recall_score(
                    y_test_labels, y_pred_labels, average="macro", zero_division=0
                ),
                "宏平均F1": f1_score(
                    y_test_labels, y_pred_labels, average="macro", zero_division=0
                ),
            }
        )

        report_dict = classification_report(
            y_test_labels,
            y_pred_labels,
            labels=class_order,
            output_dict=True,
            zero_division=0,
        )
        report_df = pd.DataFrame(report_dict).T
        report_frames[model_name] = report_df

        cm = confusion_matrix(y_test_labels, y_pred_labels, labels=class_order)
        cm_df = pd.DataFrame(cm, index=class_order, columns=class_order)
        confusion_frames[model_name] = cm_df
        plot_confusion_matrix_figure(
            cm_df,
            model_name,
            output_dir / f"confusion_matrix_{safe_name(model_name)}.png",
        )

        prediction_tables[model_name] = pd.DataFrame(
            {
                seat_id_col: seat_test.values,
                f"真实{label_col}": y_test_labels.values,
                f"预测{label_col}": y_pred_labels.values,
            }
        )

    metrics_df = pd.DataFrame(metrics_rows).sort_values(
        by=["宏平均F1", "准确率"], ascending=False
    )
    plot_metrics_comparison(metrics_df, output_dir)

    best_model_name = metrics_df.iloc[0]["模型"]
    best_model_metrics = metrics_df.iloc[0]
    best_model = trained_models[best_model_name]

    best_predictions_df = prediction_tables[best_model_name]
    best_predictions_df.to_excel(output_dir / "best_model_predictions.xlsx", index=False)
    report_frames[best_model_name].to_excel(
        output_dir / "best_model_classification_report.xlsx"
    )

    plot_best_model_report(
        report_frames[best_model_name].loc[class_order, ["precision", "recall", "f1-score"]],
        output_dir / "best_model_report_heatmap.png",
    )

    save_results_workbook(
        metrics_df=metrics_df,
        report_frames=report_frames,
        confusion_frames=confusion_frames,
        best_predictions_df=best_predictions_df,
        output_dir=output_dir,
    )

    dump(best_model, output_dir / "best_model.joblib")

    write_summary_text(
        dataset_path=dataset_path,
        output_dir=output_dir,
        metrics_df=metrics_df,
        best_model_name=best_model_name,
        best_model_metrics=best_model_metrics,
        class_order=class_order,
        test_size=args.test_size,
        random_state=args.random_state,
    )

    save_run_metadata(
        dataset_path=dataset_path,
        output_dir=output_dir,
        feature_columns=list(X.columns),
        class_order=class_order,
        metrics_df=metrics_df,
        best_model_name=best_model_name,
        test_size=args.test_size,
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
