#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import joblib
import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
WORKBOOK_PATH = DATA_DIR / "座位推荐评分数据集.xlsx"
EXPERIMENT_ROOT = DATA_DIR / "桌组场景分类实验结果"
LATEST_RUN_POINTER = EXPERIMENT_ROOT / "最新结果目录.txt"
OUTPUT_PATH = DATA_DIR / "seat_recommendation_runtime.json"

GROUP_SHEET_NAME = "桌组训练数据"
SEAT_SHEET_NAME = "座位推荐数据"
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

SCENE_PROFILES = {
    "default": {
        "label": "综合优选",
        "weights": {"focus": 0.35, "comfort": 0.30, "device": 0.20, "collab": 0.15},
    },
    "focus": {
        "label": "深度专注型",
        "weights": {"focus": 0.65, "comfort": 0.15, "device": 0.10, "collab": 0.10},
    },
    "comfort": {
        "label": "舒适久学型",
        "weights": {"focus": 0.20, "comfort": 0.55, "device": 0.10, "collab": 0.15},
    },
    "device": {
        "label": "设备作业型",
        "weights": {"focus": 0.10, "comfort": 0.15, "device": 0.60, "collab": 0.15},
    },
    "collab": {
        "label": "开放协作型",
        "weights": {"focus": 0.10, "comfort": 0.10, "device": 0.15, "collab": 0.65},
    },
}

FINAL_SCORE_COLUMNS = {
    "focus": "专注最终分",
    "comfort": "舒适最终分",
    "device": "设备最终分",
    "collab": "协作最终分",
}

BASE_SCORE_COLUMNS = {
    "focus": "专注基础分",
    "comfort": "舒适基础分",
    "device": "设备基础分",
    "collab": "协作基础分",
}

ADJUSTMENT_COLUMNS = {
    "focus": "专注修正分",
    "comfort": "舒适修正分",
    "device": "设备修正分",
    "collab": "协作修正分",
}


def to_float(value, digits: int = 4) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float, np.floating, np.integer)):
        if isinstance(value, float) and math.isnan(value):
            return 0.0
        return round(float(value), digits)
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return 0.0


def to_int(value) -> int:
    try:
        if pd.isna(value):
            return 0
        return int(value)
    except (TypeError, ValueError):
        return 0


def read_json(path: Path) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export app recommendation runtime data from a trained model.")
    parser.add_argument(
        "--model-name",
        default="deployment",
        help="Model to use for runtime prediction. Use deployment, best, svm, mlp, rf, lr, knn, or tree.",
    )
    parser.add_argument(
        "--model-path",
        type=Path,
        default=None,
        help="Optional explicit joblib model path.",
    )
    return parser.parse_args()


def parse_run_time(run_dir: Path) -> str:
    matched = re.match(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", run_dir.name)
    if not matched:
        return ""
    return (
        f"{matched.group(1)}-{matched.group(2)}-{matched.group(3)} "
        f"{matched.group(4)}:{matched.group(5)}:{matched.group(6)}"
    )


def resolve_latest_run_dir() -> Path:
    if LATEST_RUN_POINTER.exists():
        candidate = Path(LATEST_RUN_POINTER.read_text(encoding="utf-8").strip())
        if candidate.is_dir():
            return candidate

    run_dirs = sorted(
        [path for path in EXPERIMENT_ROOT.iterdir() if path.is_dir()],
        key=lambda item: item.name,
        reverse=True,
    )
    if not run_dirs:
        raise FileNotFoundError(f"No experiment directory found under {EXPERIMENT_ROOT}")
    return run_dirs[0]


def resolve_classes(model) -> List[str]:
    if hasattr(model, "classes_"):
        return [str(item) for item in model.classes_]

    named_steps = getattr(model, "named_steps", None)
    if named_steps:
        estimator = named_steps.get("model")
        if estimator is not None and hasattr(estimator, "classes_"):
            return [str(item) for item in estimator.classes_]

    raise RuntimeError("Unable to resolve classes_ from the saved best model.")


def softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values, axis=1, keepdims=True)
    exp_values = np.exp(shifted)
    denom = np.sum(exp_values, axis=1, keepdims=True)
    return exp_values / denom


def compute_probability_matrix(model, features: pd.DataFrame, classes: List[str]) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        return np.asarray(model.predict_proba(features), dtype=float)

    if hasattr(model, "decision_function"):
        decision = np.asarray(model.decision_function(features), dtype=float)
        if decision.ndim == 1:
            prob_positive = 1.0 / (1.0 + np.exp(-decision))
            return np.column_stack([1.0 - prob_positive, prob_positive])
        return softmax(decision)

    predictions = [str(item) for item in model.predict(features)]
    matrix = np.zeros((len(predictions), len(classes)), dtype=float)
    class_index = {label: index for index, label in enumerate(classes)}
    for row_index, label in enumerate(predictions):
        matrix[row_index, class_index[label]] = 1.0
    return matrix


def normalize_model_name(value: str) -> str:
    raw_value = str(value or "").strip()
    return MODEL_ALIASES.get(raw_value.lower().replace("-", "_"), raw_value)


def short_model_name(model_name: str) -> str:
    if "SVM" in model_name or "支持向量机" in model_name:
        return "SVM"
    if "MLP" in model_name or "感知机" in model_name:
        return "MLP"
    if "随机森林" in model_name:
        return "随机森林"
    if "逻辑回归" in model_name:
        return "逻辑回归"
    if "KNN" in model_name or "K近邻" in model_name:
        return "KNN"
    if "决策树" in model_name:
        return "决策树"
    return model_name


def resolve_runtime_model(run_dir: Path, metadata: Dict, requested_name: str, explicit_model_path: Path | None) -> Tuple[str, Path]:
    if explicit_model_path is not None:
        model_path = explicit_model_path.resolve()
        if not model_path.exists():
            raise FileNotFoundError(f"Missing explicit model artifact: {model_path}")
        model_name = normalize_model_name(requested_name)
        if model_name in {"", "deployment", "best"}:
            model_name = str(metadata.get("deployment_model") or metadata.get("best_model") or "自定义模型")
        return model_name, model_path

    raw_name = str(requested_name or "deployment").strip().lower().replace("-", "_")
    if raw_name in {"", "deployment", "deployed"}:
        model_path = Path(str(metadata.get("deployment_model_path") or ""))
        if model_path.exists():
            return str(metadata.get("deployment_model") or metadata.get("best_model") or "部署模型"), model_path
        candidate = run_dir / "部署模型.joblib"
        if candidate.exists():
            return str(metadata.get("deployment_model") or metadata.get("best_model") or "部署模型"), candidate
        raw_name = "best"

    if raw_name in {"best", "auto"}:
        candidate = run_dir / "最佳模型.joblib"
        if not candidate.exists():
            raise FileNotFoundError(f"Missing best model artifact: {candidate}")
        return str(metadata.get("best_model") or ((metadata.get("metrics") or [{}])[0].get("model", "最佳模型"))), candidate

    model_name = normalize_model_name(requested_name)
    candidate = run_dir / f"模型_{safe_name(model_name)}.joblib"
    if not candidate.exists():
        raise FileNotFoundError(
            f"Missing model artifact for {model_name}: {candidate}. "
            "Please rerun scripts/run_scored_table_group_classification_experiment.py first."
        )
    return model_name, candidate


def safe_name(text: str) -> str:
    return (
        text.replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
    )


def build_metric_rows(metadata: Dict, selected_model_name: str) -> Tuple[Dict, List[Dict]]:
    metrics = metadata.get("metrics") or []
    selected_row = next(
        (item for item in metrics if str(item.get("model", "")) == selected_model_name),
        metrics[0] if metrics else {},
    )
    metric_rows = []
    for item in metrics:
        metric_rows.append(
            {
                "model": str(item.get("model", "")),
                "accuracy": to_float(item.get("accuracy"), 6),
                "macroPrecision": to_float(item.get("macro_precision"), 6),
                "macroRecall": to_float(item.get("macro_recall"), 6),
                "macroF1": to_float(item.get("macro_f1"), 6),
            }
        )

    best_model = {
        "name": str(selected_row.get("model", selected_model_name)),
        "shortName": short_model_name(str(selected_row.get("model", selected_model_name))),
        "isDeepLearning": "MLP" in str(selected_row.get("model", selected_model_name)),
        "accuracy": to_float(selected_row.get("accuracy"), 6),
        "macroPrecision": to_float(selected_row.get("macro_precision"), 6),
        "macroRecall": to_float(selected_row.get("macro_recall"), 6),
        "macroF1": to_float(selected_row.get("macro_f1"), 6),
    }
    return best_model, metric_rows


def build_score_payload(row: pd.Series, columns: Dict[str, str], digits: int = 2) -> Dict[str, float]:
    return {key: to_float(row[column], digits) for key, column in columns.items()}


def build_group_predictions(
    group_df: pd.DataFrame,
    probability_matrix: np.ndarray,
    classes: List[str],
) -> Dict[str, Dict]:
    groups: Dict[str, Dict] = {}
    order = np.argsort(probability_matrix, axis=1)[:, ::-1]

    for row_index, (_, row) in enumerate(group_df.iterrows()):
        primary_index = int(order[row_index, 0])
        secondary_index = int(order[row_index, 1]) if probability_matrix.shape[1] > 1 else primary_index
        group_id = str(row["桌组编号"])
        groups[group_id] = {
            "groupId": group_id,
            "zoneCode": str(row["区域编码"]),
            "zoneName": str(row["区域名称"]),
            "actualLabel": str(row["最终场景标签"]),
            "secondaryActualLabel": str(row["次优场景标签"]),
            "labelGap": to_float(row["主次分差"], 2),
            "labelConfidence": str(row["标签置信度"]),
            "labelReason": str(row["标签说明"]),
            "baseScores": build_score_payload(row, BASE_SCORE_COLUMNS),
            "modelPredictedLabel": classes[primary_index],
            "modelPredictedConfidence": to_float(probability_matrix[row_index, primary_index], 4),
            "modelSecondaryLabel": classes[secondary_index],
            "modelSecondaryConfidence": to_float(probability_matrix[row_index, secondary_index], 4),
        }
    return groups


def build_seat_runtime(seat_df: pd.DataFrame, groups: Dict[str, Dict]) -> Dict[str, Dict]:
    seats: Dict[str, Dict] = {}
    for _, row in seat_df.iterrows():
        seat_id = str(row["座位编号"])
        group_id = str(row["桌组编号"])
        group_runtime = groups[group_id]
        seats[seat_id] = {
            "seatId": seat_id,
            "groupId": group_id,
            "zoneCode": str(row["区域编码"]),
            "groupBaseLabel": str(row["桌组基础标签"]),
            "seatPrimaryLabel": str(row["推荐主标签"]),
            "seatSecondaryLabel": str(row["次优标签"]),
            "seatLabelGap": to_float(row["主次分差"], 2),
            "seatConfidenceLevel": str(row["推荐置信度"]),
            "seatReason": str(row["推荐说明"]),
            "featureFlags": {
                "hasPower": to_int(row["是否有插座"]),
                "nearWindow": to_int(row["是否靠窗"]),
                "isQuiet": to_int(row["是否安静"]),
                "nearRestroom": to_int(row["是否靠近卫生间"]),
                "nearPantry": to_int(row["是否靠近茶水间"]),
                "nearAC": to_int(row["是否靠近空调"]),
                "nearBookshelf": to_int(row["是否靠近书架"]),
                "isTable4": to_int(row["是否4人桌"]),
                "isTable8": to_int(row["是否8人桌"]),
                "nearCorridor": to_int(row["是否靠近通道"]),
                "sunlightYes": to_int(row["是否有日照"]),
                "sunlightNo": to_int(row["是否无日照"]),
            },
            "baseScores": build_score_payload(row, BASE_SCORE_COLUMNS),
            "adjustmentScores": build_score_payload(row, ADJUSTMENT_COLUMNS),
            "finalScores": build_score_payload(row, FINAL_SCORE_COLUMNS),
            "groupModel": {
                "predictedLabel": group_runtime["modelPredictedLabel"],
                "predictedConfidence": group_runtime["modelPredictedConfidence"],
                "secondaryLabel": group_runtime["modelSecondaryLabel"],
                "secondaryConfidence": group_runtime["modelSecondaryConfidence"],
            },
        }
    return seats


def build_payload(
    workbook_path: Path,
    run_dir: Path,
    metadata: Dict,
    selected_model_name: str,
    groups: Dict[str, Dict],
    seats: Dict[str, Dict],
) -> Dict:
    best_model, metric_rows = build_metric_rows(metadata, selected_model_name)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "path": str(workbook_path),
            "groupCount": len(groups),
            "seatCount": len(seats),
        },
        "experiment": {
            "runDir": str(run_dir),
            "runAt": parse_run_time(run_dir),
            "bestModel": best_model,
            "deploymentModel": best_model,
            "comparisonBestModel": str(metadata.get("best_model") or ((metadata.get("metrics") or [{}])[0].get("model", ""))),
            "featureColumns": list(metadata.get("feature_columns") or []),
            "labelColumn": str(metadata.get("label_column") or ""),
            "groupColumn": str(metadata.get("group_column") or ""),
            "metricRows": metric_rows,
        },
        "sceneProfiles": SCENE_PROFILES,
        "groups": groups,
        "seats": seats,
    }


def main() -> None:
    args = parse_args()
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(f"Scored workbook not found: {WORKBOOK_PATH}")

    run_dir = resolve_latest_run_dir()
    metadata_path = run_dir / "实验运行元数据.json"

    if not metadata_path.exists():
        raise FileNotFoundError(f"Missing experiment metadata: {metadata_path}")

    metadata = read_json(metadata_path)
    selected_model_name, model_path = resolve_runtime_model(
        run_dir=run_dir,
        metadata=metadata,
        requested_name=args.model_name,
        explicit_model_path=args.model_path,
    )
    runtime_model = joblib.load(model_path)
    classes = resolve_classes(runtime_model)

    group_df = pd.read_excel(WORKBOOK_PATH, sheet_name=GROUP_SHEET_NAME)
    seat_df = pd.read_excel(WORKBOOK_PATH, sheet_name=SEAT_SHEET_NAME)
    feature_columns = metadata.get("feature_columns") or []
    if not feature_columns:
        raise RuntimeError("Experiment metadata does not include feature_columns.")

    features = group_df[feature_columns].apply(pd.to_numeric, errors="raise").astype(float)
    probability_matrix = compute_probability_matrix(runtime_model, features, classes)
    groups = build_group_predictions(group_df, probability_matrix, classes)
    seats = build_seat_runtime(seat_df, groups)

    payload = build_payload(
        workbook_path=WORKBOOK_PATH,
        run_dir=run_dir,
        metadata=metadata,
        selected_model_name=selected_model_name,
        groups=groups,
        seats=seats,
    )
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Runtime data written to: {OUTPUT_PATH}")
    print(f"Latest run directory: {run_dir}")
    print(f"Runtime model: {payload['experiment']['bestModel']['name']}")
    print(f"Model artifact: {model_path}")
    print(f"Seat count: {payload['dataset']['seatCount']}")


if __name__ == "__main__":
    main()
