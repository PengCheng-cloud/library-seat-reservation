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
import openpyxl
import pandas as pd
import seaborn as sns
from joblib import dump
from matplotlib import font_manager
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
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
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

try:
    from sklearn.model_selection import StratifiedGroupKFold
except ImportError:  # pragma: no cover
    StratifiedGroupKFold = None


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_DATASET = DATA_DIR / "座位推荐评分数据集.xlsx"
RESULTS_ROOT = DATA_DIR / "桌组场景分类实验结果"

SHEET_NAME = "桌组训练数据"
ID_COL = "桌组编号"
GROUP_COL = "区域编码"
LABEL_COL = "最终场景标签"
FEATURE_COLS = [
    "单桌容量",
    "座位数",
    "靠窗比例",
    "插座比例",
    "安静比例",
    "通道比例",
    "卫生间临近比例",
    "茶水间临近比例",
    "空调临近比例",
    "书架临近比例",
    "日照比例",
    "是否北侧区域",
    "是否西侧区域",
    "是否东侧区域",
    "是否南侧内圈",
    "是否南侧外圈",
]
CLASS_ORDER = ["深度专注型", "舒适久学型", "设备作业型", "开放协作型"]
MODEL_ALIASES = {
    "logistic": "逻辑回归",
    "lr": "逻辑回归",
    "knn": "K近邻KNN",
    "tree": "决策树",
    "decision_tree": "决策树",
    "random_forest": "随机森林",
    "rf": "随机森林",
    "svm": "支持向量机SVM",
    "svc": "支持向量机SVM",
    "mlp": "多层感知机MLP",
    "deep": "多层感知机MLP",
}
MODEL_PRIORITY = {
    "多层感知机MLP": 6,
    "支持向量机SVM": 5,
    "随机森林": 4,
    "逻辑回归": 3,
    "K近邻KNN": 2,
    "决策树": 1,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run group-level scene classification experiments on the scored dataset."
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATASET,
        help="Path to the scored seat recommendation workbook.",
    )
    parser.add_argument(
        "--n-splits",
        type=int,
        default=5,
        help="Number of cross-validation folds.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed used for model initialization and fold shuffling.",
    )
    parser.add_argument(
        "--deployment-model",
        default="best",
        help="Model to export as the app runtime deployment model. Use best, svm, mlp, rf, lr, knn, or tree.",
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


def autosize_workbook(path: Path) -> None:
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        for column_cells in sheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(value))
            sheet.column_dimensions[column_letter].width = min(max_length + 2, 36)
    workbook.save(path)


def make_output_dir() -> Path:
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    output_dir = RESULTS_ROOT / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_实验结果"
    output_dir.mkdir(parents=True, exist_ok=False)
    return output_dir


def load_dataset(dataset_path: Path) -> Tuple[pd.DataFrame, pd.Series, pd.Series, pd.Series]:
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")
    df = pd.read_excel(dataset_path, sheet_name=SHEET_NAME)
    X = df[FEATURE_COLS].apply(pd.to_numeric, errors="raise").astype(float)
    y = df[LABEL_COL].astype(str)
    sample_ids = df[ID_COL].astype(str)
    groups = df[GROUP_COL].astype(str)
    return X, y, sample_ids, groups


def build_models(random_state: int) -> Dict[str, object]:
    return {
        "逻辑回归": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", LogisticRegression(max_iter=3000, class_weight="balanced")),
            ]
        ),
        "K近邻KNN": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", KNeighborsClassifier(n_neighbors=5)),
            ]
        ),
        "决策树": DecisionTreeClassifier(max_depth=5, min_samples_leaf=3, random_state=random_state),
        "随机森林": RandomForestClassifier(
            n_estimators=500,
            max_depth=10,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=random_state,
        ),
        "支持向量机SVM": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", SVC(kernel="rbf", C=2.5, gamma="scale", class_weight="balanced")),
            ]
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
                        max_iter=2500,
                        early_stopping=False,
                        random_state=random_state,
                    ),
                ),
            ]
        ),
    }


def build_splitter(y: pd.Series, groups: pd.Series, n_splits: int, random_state: int):
    if StratifiedGroupKFold is not None and groups.nunique() >= n_splits:
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
        split_iter = list(splitter.split(np.zeros(len(y)), y, groups=groups))
        scheme_name = "StratifiedGroupKFold(按区域编码分组)"
    else:
        splitter = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
        split_iter = list(splitter.split(np.zeros(len(y)), y))
        scheme_name = "StratifiedKFold"
    return split_iter, scheme_name


def safe_name(text: str) -> str:
    return (
        text.replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
    )


def resolve_model_name(value: str, valid_names: List[str], best_model_name: str) -> str:
    raw_value = str(value or "best").strip()
    normalized = raw_value.lower().replace("-", "_")
    if normalized in {"", "auto", "best"}:
        return best_model_name

    candidate = MODEL_ALIASES.get(normalized, raw_value)
    if candidate not in valid_names:
        valid_text = ", ".join(["best", *sorted(MODEL_ALIASES), *valid_names])
        raise ValueError(f"Unknown deployment model: {raw_value}. Valid values: {valid_text}")
    return candidate


def plot_class_distribution(y: pd.Series, output_dir: Path) -> None:
    counts = y.value_counts().reindex(CLASS_ORDER)
    fig, ax = plt.subplots(figsize=(9, 5))
    colors = sns.color_palette("Set2", n_colors=len(CLASS_ORDER))
    bars = ax.bar(counts.index, counts.values, color=colors)
    ax.set_title("桌组场景标签分布")
    ax.set_xlabel("场景标签")
    ax.set_ylabel("桌组数量")
    for bar, value in zip(bars, counts.values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 1, str(int(value)), ha="center", va="bottom", fontsize=10)
    fig.tight_layout()
    fig.savefig(output_dir / "场景标签分布图.png", dpi=220)
    plt.close(fig)


def plot_metrics_comparison(metrics_df: pd.DataFrame, output_dir: Path) -> None:
    plot_df = metrics_df.melt(
        id_vars=["model"],
        value_vars=["accuracy", "macro_precision", "macro_recall", "macro_f1"],
        var_name="metric",
        value_name="score",
    )
    fig, ax = plt.subplots(figsize=(12, 6))
    sns.barplot(data=plot_df, x="model", y="score", hue="metric", ax=ax)
    ax.set_title("不同算法在桌组分类任务上的指标对比")
    ax.set_xlabel("模型")
    ax.set_ylabel("平均指标值")
    ax.set_ylim(0, 1.05)
    for container in ax.containers:
        ax.bar_label(container, fmt="%.3f", fontsize=8, rotation=90, padding=2)
    ax.legend(title="指标", loc="lower right")
    fig.tight_layout()
    fig.savefig(output_dir / "模型指标对比图.png", dpi=220)
    plt.close(fig)


def plot_macro_f1_by_fold(fold_metrics_df: pd.DataFrame, output_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 6))
    sns.lineplot(data=fold_metrics_df, x="fold", y="macro_f1", hue="model", marker="o", ax=ax)
    ax.set_title("各模型在不同折次上的 Macro-F1")
    ax.set_xlabel("交叉验证折次")
    ax.set_ylabel("Macro-F1")
    ax.set_ylim(0.5, 1.05)
    fig.tight_layout()
    fig.savefig(output_dir / "各折Macro_F1对比图.png", dpi=220)
    plt.close(fig)


def plot_confusion_matrix(cm_df: pd.DataFrame, model_name: str, output_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    sns.heatmap(cm_df, annot=True, fmt="d", cmap="Blues", cbar=False, ax=ax)
    ax.set_title(f"{model_name} 混淆矩阵")
    ax.set_xlabel("预测类别")
    ax.set_ylabel("真实类别")
    fig.tight_layout()
    fig.savefig(output_dir / f"混淆矩阵_{safe_name(model_name)}.png", dpi=220)
    plt.close(fig)


def plot_best_model_report(report_df: pd.DataFrame, output_dir: Path) -> None:
    heatmap_df = report_df[["precision", "recall", "f1-score"]].copy()
    fig, ax = plt.subplots(figsize=(7, max(4, len(heatmap_df) * 0.6)))
    sns.heatmap(heatmap_df, annot=True, fmt=".3f", cmap="YlGnBu", ax=ax)
    ax.set_title("最佳模型分类报告热力图")
    ax.set_xlabel("指标")
    ax.set_ylabel("类别")
    fig.tight_layout()
    fig.savefig(output_dir / "最佳模型分类报告热力图.png", dpi=220)
    plt.close(fig)


def plot_mlp_loss_curve(mlp_model: Pipeline, output_dir: Path) -> None:
    estimator = mlp_model.named_steps["model"]
    if not hasattr(estimator, "loss_curve_"):
        return
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(range(1, len(estimator.loss_curve_) + 1), estimator.loss_curve_, color="#d1495b", linewidth=2)
    ax.set_title("MLP 训练损失曲线")
    ax.set_xlabel("迭代轮次")
    ax.set_ylabel("Loss")
    fig.tight_layout()
    fig.savefig(output_dir / "MLP训练损失曲线.png", dpi=220)
    plt.close(fig)


def evaluate_models(
    X: pd.DataFrame,
    y: pd.Series,
    sample_ids: pd.Series,
    groups: pd.Series,
    split_iter: List[Tuple[np.ndarray, np.ndarray]],
    random_state: int,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, pd.DataFrame], Dict[str, pd.DataFrame], Dict[str, pd.DataFrame]]:
    models = build_models(random_state)
    metrics_rows = []
    fold_rows = []
    report_frames: Dict[str, pd.DataFrame] = {}
    confusion_frames: Dict[str, pd.DataFrame] = {}
    prediction_frames: Dict[str, pd.DataFrame] = {}

    for model_name, model in models.items():
        oof_pred = np.empty(shape=len(y), dtype=object)
        fold_metrics = []
        for fold_index, (train_idx, test_idx) in enumerate(split_iter, start=1):
            current_model = clone(model)
            current_model.fit(X.iloc[train_idx], y.iloc[train_idx])
            pred = current_model.predict(X.iloc[test_idx])
            oof_pred[test_idx] = pred

            fold_record = {
                "model": model_name,
                "fold": fold_index,
                "accuracy": accuracy_score(y.iloc[test_idx], pred),
                "macro_precision": precision_score(y.iloc[test_idx], pred, average="macro", zero_division=0),
                "macro_recall": recall_score(y.iloc[test_idx], pred, average="macro", zero_division=0),
                "macro_f1": f1_score(y.iloc[test_idx], pred, average="macro", zero_division=0),
            }
            fold_rows.append(fold_record)
            fold_metrics.append(fold_record)

        y_pred = pd.Series(oof_pred, index=y.index)
        prediction_frames[model_name] = pd.DataFrame(
            {
                ID_COL: sample_ids.values,
                GROUP_COL: groups.values,
                f"真实{LABEL_COL}": y.values,
                f"预测{LABEL_COL}": y_pred.values,
            }
        )

        report_dict = classification_report(y, y_pred, labels=CLASS_ORDER, output_dict=True, zero_division=0)
        report_frames[model_name] = pd.DataFrame(report_dict).T
        cm = confusion_matrix(y, y_pred, labels=CLASS_ORDER)
        confusion_frames[model_name] = pd.DataFrame(cm, index=CLASS_ORDER, columns=CLASS_ORDER)

        metrics_rows.append(
            {
                "model": model_name,
                "accuracy": float(np.mean([item["accuracy"] for item in fold_metrics])),
                "accuracy_std": float(np.std([item["accuracy"] for item in fold_metrics], ddof=0)),
                "macro_precision": float(np.mean([item["macro_precision"] for item in fold_metrics])),
                "macro_recall": float(np.mean([item["macro_recall"] for item in fold_metrics])),
                "macro_f1": float(np.mean([item["macro_f1"] for item in fold_metrics])),
            }
        )

    metrics_df = pd.DataFrame(metrics_rows)
    metrics_df["priority"] = metrics_df["model"].map(MODEL_PRIORITY).fillna(0)
    metrics_df = metrics_df.sort_values(by=["macro_f1", "accuracy", "priority"], ascending=[False, False, False]).drop(columns=["priority"])
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
    workbook_path = output_dir / "实验结果汇总.xlsx"
    with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
        metrics_df.to_excel(writer, sheet_name="指标汇总", index=False)
        fold_metrics_df.to_excel(writer, sheet_name="各折指标", index=False)
        for model_name, frame in prediction_frames.items():
            frame.to_excel(writer, sheet_name=f"预测_{safe_name(model_name)}"[:31], index=False)
        for model_name, frame in report_frames.items():
            frame.to_excel(writer, sheet_name=f"报告_{safe_name(model_name)}"[:31])
        for model_name, frame in confusion_frames.items():
            frame.to_excel(writer, sheet_name=f"混淆矩阵_{safe_name(model_name)}"[:31])
    autosize_workbook(workbook_path)
    return workbook_path


def write_summary_text(
    dataset_path: Path,
    output_dir: Path,
    metrics_df: pd.DataFrame,
    best_model_name: str,
    split_scheme: str,
    n_splits: int,
    random_state: int,
) -> Path:
    summary_path = output_dir / "实验结果摘要.txt"
    lines = [
        f"数据集: {dataset_path}",
        f"输出目录: {output_dir}",
        f"交叉验证方案: {split_scheme}",
        f"交叉验证折数: {n_splits}",
        f"随机种子: {random_state}",
        f"使用特征: {', '.join(FEATURE_COLS)}",
        "",
        "模型指标汇总:",
    ]
    for _, row in metrics_df.iterrows():
        lines.append(
            "  {model}: accuracy={acc:.4f}, acc_std={std:.4f}, macro_precision={pre:.4f}, "
            "macro_recall={rec:.4f}, macro_f1={f1:.4f}".format(
                model=row["model"],
                acc=row["accuracy"],
                std=row["accuracy_std"],
                pre=row["macro_precision"],
                rec=row["macro_recall"],
                f1=row["macro_f1"],
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
    split_scheme: str,
    n_splits: int,
    random_state: int,
    best_model_name: str,
    deployment_model_name: str,
    deployment_model_path: Path,
) -> Path:
    payload = {
        "dataset_path": str(dataset_path),
        "output_dir": str(output_dir),
        "sheet_name": SHEET_NAME,
        "feature_columns": FEATURE_COLS,
        "label_column": LABEL_COL,
        "group_column": GROUP_COL,
        "split_scheme": split_scheme,
        "n_splits": n_splits,
        "random_state": random_state,
        "best_model": best_model_name,
        "deployment_model": deployment_model_name,
        "deployment_model_path": str(deployment_model_path),
        "metrics": metrics_df.to_dict(orient="records"),
        "fold_metrics": fold_metrics_df.to_dict(orient="records"),
    }
    metadata_path = output_dir / "实验运行元数据.json"
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata_path


def main() -> None:
    args = parse_args()
    configure_plot_style()

    dataset_path = args.data.resolve()
    X, y, sample_ids, groups = load_dataset(dataset_path)
    split_iter, split_scheme = build_splitter(y=y, groups=groups, n_splits=args.n_splits, random_state=args.random_state)
    output_dir = make_output_dir()

    plot_class_distribution(y, output_dir)
    metrics_df, fold_metrics_df, report_frames, confusion_frames, prediction_frames = evaluate_models(
        X=X,
        y=y,
        sample_ids=sample_ids,
        groups=groups,
        split_iter=split_iter,
        random_state=args.random_state,
    )
    plot_metrics_comparison(metrics_df, output_dir)
    plot_macro_f1_by_fold(fold_metrics_df, output_dir)
    for model_name, cm_df in confusion_frames.items():
        plot_confusion_matrix(cm_df, model_name, output_dir)

    fitted_models = {name: clone(model).fit(X, y) for name, model in build_models(args.random_state).items()}
    best_model_name = metrics_df.iloc[0]["model"]
    deployment_model_name = resolve_model_name(
        args.deployment_model,
        valid_names=list(fitted_models.keys()),
        best_model_name=best_model_name,
    )
    best_model = fitted_models[best_model_name]
    dump(best_model, output_dir / "最佳模型.joblib")
    for model_name, fitted_model in fitted_models.items():
        dump(fitted_model, output_dir / f"模型_{safe_name(model_name)}.joblib")
    deployment_model_path = output_dir / "部署模型.joblib"
    dump(fitted_models[deployment_model_name], deployment_model_path)
    plot_mlp_loss_curve(fitted_models["多层感知机MLP"], output_dir)

    best_report = report_frames[best_model_name]
    best_report.to_excel(output_dir / "最佳模型分类报告.xlsx")
    prediction_frames[best_model_name].to_excel(output_dir / "最佳模型预测结果.xlsx", index=False)
    plot_best_model_report(best_report.loc[CLASS_ORDER, ["precision", "recall", "f1-score"]], output_dir)

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
        best_model_name=best_model_name,
        split_scheme=split_scheme,
        n_splits=args.n_splits,
        random_state=args.random_state,
    )
    save_metadata(
        dataset_path=dataset_path,
        output_dir=output_dir,
        metrics_df=metrics_df,
        fold_metrics_df=fold_metrics_df,
        split_scheme=split_scheme,
        n_splits=args.n_splits,
        random_state=args.random_state,
        best_model_name=best_model_name,
        deployment_model_name=deployment_model_name,
        deployment_model_path=deployment_model_path,
    )
    (RESULTS_ROOT / "最新结果目录.txt").write_text(str(output_dir), encoding="utf-8")

    print(f"Dataset: {dataset_path}")
    print(f"Results directory: {output_dir}")
    print(f"Split scheme: {split_scheme}")
    print("")
    print("Metrics summary:")
    print(metrics_df.to_string(index=False))
    print("")
    print(f"Best model: {best_model_name}")
    print(f"Deployment model: {deployment_model_name}")
    print("Generated files:")
    for path in sorted(output_dir.iterdir()):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
