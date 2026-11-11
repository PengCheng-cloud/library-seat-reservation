#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from build_matching_recommendation_pipeline import (
    DEMAND_FEATURE_COLUMNS,
    FEATURE_COLUMNS,
    LABEL_DISPLAY,
    LABEL_COLUMNS,
    aggregate_label_scores,
    calculate_scene_match_scores,
    build_cross_features,
    demand_label_weights,
    build_seat_profiles,
    predict_label_scores,
    read_seats,
)


ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT_ROOT = ROOT / "docs" / "需求座位匹配推荐实验_20260514"
MODEL_PATH = EXPERIMENT_ROOT / "模型" / "svm_matching_model.joblib"
FEATURE_COLUMNS_PATH = EXPERIMENT_ROOT / "模型" / "feature_columns.json"
LABEL_THRESHOLDS_PATH = EXPERIMENT_ROOT / "模型" / "label_thresholds.json"
RUNTIME_META_PATH = ROOT / "data" / "seat_matching_runtime.json"


FILTER_NEED_MAP = {
    "power_outlet": "need_power_outlet",
    "window": "need_window",
    "quiet": "need_quiet",
    "balanced_temperature": "need_balanced_temperature",
    "quiet_position": "need_away_corridor",
    "table_4": "need_table_4",
    "table_8": "need_table_8",
    "near_bookshelf": "need_bookshelf",
    "near_restroom": "need_restroom",
    "sunlight_yes": "need_sunlight",
}

NEED_LABELS = {
    "need_power_outlet": "有插座",
    "need_window": "靠窗",
    "need_quiet": "安静",
    "need_balanced_temperature": "温度均衡",
    "need_away_corridor": "避开通道",
    "need_table_4": "4人桌",
    "need_table_8": "多人桌",
    "need_bookshelf": "靠近书架",
    "need_restroom": "靠近卫生间",
    "need_sunlight": "采光",
}

MATCH_LABELS = list(LABEL_DISPLAY.values())

KEYWORD_RULES = [
    ("need_power_outlet", ["插座", "充电", "电脑", "笔记本", "平板", "设备", "写代码", "编程", "作业"], 1.0),
    ("need_window", ["靠窗", "窗边", "窗户", "临窗"], 1.0),
    ("need_quiet", ["安静", "专注", "自习", "学习", "考研", "复习", "备考", "沉浸", "刷题"], 0.95),
    ("need_balanced_temperature", ["空调别吹", "温度均衡", "不冷", "不热", "温度舒服", "舒适"], 0.85),
    ("need_away_corridor", ["避开通道", "不要通道", "少人走动", "不要太吵", "不想被打扰", "少干扰"], 1.0),
    ("need_table_4", ["4人桌", "四人桌", "小桌", "双人", "小组小桌"], 1.0),
    ("need_table_8", ["8人桌", "八人桌", "大桌", "多人桌", "结伴", "一起", "讨论", "小组讨论", "协作"], 1.0),
    ("need_bookshelf", ["书架", "找书", "查资料", "纸质书", "文献"], 0.8),
    ("need_restroom", ["卫生间", "洗手间", "厕所", "短时间", "临时停留"], 0.75),
    ("need_sunlight", ["采光", "阳光", "光照", "亮一点", "白天看书"], 0.85),
]


def read_request_payload() -> dict[str, Any]:
    raw_text = sys.stdin.read().strip()
    if not raw_text:
        return {}
    return json.loads(raw_text)


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def normalize_seat_ids(payload: dict[str, Any]) -> list[str]:
    raw_seat_ids = payload.get("seatIds") or []
    if isinstance(raw_seat_ids, str):
        raw_seat_ids = [item.strip() for item in raw_seat_ids.split(",")]
    return [str(item).strip() for item in raw_seat_ids if str(item).strip()]


def normalize_filters(payload: dict[str, Any]) -> list[str]:
    raw_filters = payload.get("filters") or []
    if isinstance(raw_filters, str):
        raw_filters = [item.strip() for item in raw_filters.split(",")]
    return [str(item).strip() for item in raw_filters if str(item).strip()]


def minutes(value: str) -> int | None:
    if not value or not re.match(r"^\d{2}:\d{2}$", value):
        return None
    hour, minute = [int(item) for item in value.split(":")]
    return hour * 60 + minute


def infer_time_flags(payload: dict[str, Any], message: str) -> tuple[int, int, int]:
    start = str(payload.get("startTime") or "")
    start_minutes = minutes(start)
    if start_minutes is not None:
        if start_minutes < 12 * 60:
            return 1, 0, 0
        if start_minutes < 18 * 60:
            return 0, 1, 0
        return 0, 0, 1

    if any(word in message for word in ["早上", "上午", "清晨"]):
        return 1, 0, 0
    if any(word in message for word in ["下午", "午后"]):
        return 0, 1, 0
    if any(word in message for word in ["晚上", "夜间", "晚自习"]):
        return 0, 0, 1
    return 0, 1, 0


def infer_duration_norm(payload: dict[str, Any], message: str) -> float:
    start = minutes(str(payload.get("startTime") or ""))
    end = minutes(str(payload.get("endTime") or ""))
    if start is not None and end is not None and end > start:
        return max(0.25, min(1.0, (end - start) / 240.0))
    if any(word in message for word in ["长时间", "久", "坐久", "三小时", "四小时", "一下午", "一晚上"]):
        return 1.0
    if any(word in message for word in ["短时间", "一会", "临时"]):
        return 0.35
    return 0.65


def build_demand_vector(payload: dict[str, Any]) -> pd.Series:
    message = str(payload.get("message") or "")
    filters = normalize_filters(payload)
    scene_key = str(payload.get("sceneKey") or "")
    vector: dict[str, float] = {
        "need_power_outlet": 0.0,
        "need_window": 0.0,
        "need_quiet": 0.0,
        "need_balanced_temperature": 0.0,
        "need_away_corridor": 0.0,
        "need_table_4": 0.0,
        "need_table_8": 0.0,
        "need_bookshelf": 0.0,
        "need_restroom": 0.0,
        "need_sunlight": 0.0,
    }

    for filter_key in filters:
        need_key = FILTER_NEED_MAP.get(filter_key)
        if need_key:
            vector[need_key] = max(vector[need_key], 1.0)

    for need_key, keywords, weight in KEYWORD_RULES:
        if any(keyword in message for keyword in keywords):
            vector[need_key] = max(vector[need_key], weight)

    scene_flags = {
        "scene_focus": 0,
        "scene_comfort": 0,
        "scene_device": 0,
        "scene_collab": 0,
    }
    if scene_key == "sprint":
        scene_flags["scene_focus"] = 1
        vector["need_quiet"] = max(vector["need_quiet"], 0.9)
        vector["need_away_corridor"] = max(vector["need_away_corridor"], 0.8)
        vector["need_power_outlet"] = max(vector["need_power_outlet"], 0.55)
    elif scene_key == "window":
        scene_flags["scene_comfort"] = 1
        vector["need_window"] = max(vector["need_window"], 0.95)
        vector["need_sunlight"] = max(vector["need_sunlight"], 0.85)
        vector["need_quiet"] = max(vector["need_quiet"], 0.55)
    elif scene_key == "group":
        scene_flags["scene_collab"] = 1
        vector["need_table_8"] = max(vector["need_table_8"], 0.95)
        vector["need_power_outlet"] = max(vector["need_power_outlet"], 0.5)
    elif scene_key == "device":
        scene_flags["scene_device"] = 1
        vector["need_power_outlet"] = max(vector["need_power_outlet"], 1.0)
        vector["need_quiet"] = max(vector["need_quiet"], 0.55)

    if any(word in message for word in ["考研", "备考", "刷题", "冲刺"]):
        scene_flags["scene_focus"] = 1
        vector["need_quiet"] = max(vector["need_quiet"], 0.95)
        vector["need_away_corridor"] = max(vector["need_away_corridor"], 0.85)
    if any(word in message for word in ["电脑", "笔记本", "写代码", "设备", "作业"]):
        scene_flags["scene_device"] = 1
    if any(word in message for word in ["结伴", "一起", "讨论", "小组", "协作"]):
        scene_flags["scene_collab"] = 1
    if any(word in message for word in ["靠窗", "采光", "阳光", "看书", "阅读"]):
        scene_flags["scene_comfort"] = 1

    # Default intent: if the user says only a vague sentence, keep recommendation useful but not restrictive.
    if not any(value > 0.15 for value in vector.values()):
        vector["need_quiet"] = 0.35
        vector["need_power_outlet"] = 0.25
        vector["need_balanced_temperature"] = 0.25

    time_morning, time_afternoon, time_evening = infer_time_flags(payload, message)
    duration_norm = infer_duration_norm(payload, message)
    explicit_need_count = sum(1 for value in vector.values() if value > 0.15)
    result = {
        **vector,
        "duration_hours_norm": duration_norm,
        "time_morning": time_morning,
        "time_afternoon": time_afternoon,
        "time_evening": time_evening,
        **scene_flags,
        "explicit_need_count_norm": explicit_need_count / 10.0,
        "demand_id": "ONLINE_REQUEST",
        "demand_text": message,
        "scene_key": scene_key,
    }
    return pd.Series(result)


def build_feature_flags(row: pd.Series) -> dict[str, int]:
    return {
        "hasPower": int(row["seat_has_power"]),
        "nearWindow": int(row["seat_window"]),
        "isQuiet": int(row["seat_quiet"]),
        "nearRestroom": int(row["near_restroom_raw"]),
        "nearAC": int(row["near_ac_raw"]),
        "nearBookshelf": int(row["seat_bookshelf"]),
        "isTable4": int(row["seat_table_4"]),
        "isTable8": int(row["seat_table_8"]),
        "nearCorridor": int(row["near_corridor_raw"]),
        "sunlightYes": int(row["seat_sunlight"]),
    }


def build_reason(demand: pd.Series, seat: pd.Series, probability: float, label_scores: dict[str, float], cross: dict[str, float]) -> str:
    hits: list[str] = []
    missing: list[str] = []
    for need_key, label in NEED_LABELS.items():
        if float(demand.get(need_key, 0)) <= 0.15:
            continue
        match_key = {
            "need_power_outlet": "match_power_outlet",
            "need_window": "match_window",
            "need_quiet": "match_quiet",
            "need_balanced_temperature": "match_temperature",
            "need_away_corridor": "match_away_corridor",
            "need_table_4": "match_table_4",
            "need_table_8": "match_table_8",
            "need_bookshelf": "match_bookshelf",
            "need_restroom": "match_restroom",
            "need_sunlight": "match_sunlight",
        }[need_key]
        if float(cross.get(match_key, 0)) > 0.2:
            hits.append(label)
        else:
            missing.append(label)

    hit_text = "、".join(hits[:4]) if hits else "综合需求"
    top_labels = "、".join(
        label for label, score in sorted(label_scores.items(), key=lambda item: item[1], reverse=True)[:2]
    )
    if missing:
        return f"SVM 多标签匹配模型判断该座位综合匹配度约{round(probability * 100)}%，主要命中{hit_text}，标签倾向为{top_labels}，未完全命中{ '、'.join(missing[:2]) }。"
    return f"SVM 多标签匹配模型判断该座位综合匹配度约{round(probability * 100)}%，主要命中{hit_text}，标签倾向为{top_labels}。"


def calibrate_online_match_probability(raw_probability: float, cross: dict[str, float]) -> float:
    """Convert model label evidence into the online ranking score shown to users.

    LinearSVC scores are useful for ranking but are not calibrated probabilities.
    The mini program therefore displays a comprehensive match score that combines
    the SVM multi-label evidence with explicit preference hits and conflict penalties.
    """
    match_ratio = float(cross.get("weighted_match_ratio", 0.0))
    conflict_ratio = float(cross.get("weighted_conflict_ratio", 0.0))
    long_study_comfort = float(cross.get("long_study_comfort", 0.0))
    score = (
        0.30 +
        0.50 * float(raw_probability) +
        0.16 * match_ratio +
        0.06 * long_study_comfort -
        0.15 * conflict_ratio
    )
    return float(max(0.08, min(0.96, score)))


def model_payload(meta: dict[str, Any]) -> dict[str, Any]:
    deployment = ((meta.get("experiment") or {}).get("deploymentModel") or {})
    return {
        "name": deployment.get("name") or "支持向量机 SVM",
        "shortName": deployment.get("shortName") or "SVM",
        "isDeepLearning": False,
        "macroF1": float(deployment.get("macroF1") or deployment.get("f1") or 0),
        "microF1": float(deployment.get("microF1") or deployment.get("f1") or 0),
        "macroPrecision": float(deployment.get("precision") or 0),
        "macroRecall": float(deployment.get("recall") or 0),
        "rocAucMicro": float(deployment.get("rocAuc") or 0),
        "prAucMicro": float(deployment.get("prAuc") or 0),
    }


def deep_learning_model_payload(meta: dict[str, Any]) -> dict[str, Any]:
    metric_rows = ((meta.get("experiment") or {}).get("metricRows") or [])
    row = next(
        (
            item for item in metric_rows
            if "MLP" in str(item.get("model_name") or item.get("model") or "")
            or "神经网络" in str(item.get("model_name") or item.get("model") or "")
        ),
        None,
    )
    if not row:
        return {}

    name = str(row.get("model_name") or row.get("model") or "神经网络 MLP")
    return {
        "name": name,
        "shortName": "MLP",
        "isDeepLearning": True,
        "macroF1": float(row.get("macro_f1") or row.get("macroF1") or 0),
        "microF1": float(row.get("micro_f1") or row.get("microF1") or 0),
        "macroPrecision": float(row.get("macro_precision") or row.get("macroPrecision") or 0),
        "macroRecall": float(row.get("macro_recall") or row.get("macroRecall") or 0),
        "rocAucMicro": float(row.get("roc_auc_micro") or row.get("rocAucMicro") or 0),
        "prAucMicro": float(row.get("pr_auc_micro") or row.get("prAucMicro") or 0),
    }


def build_empty_payload(started: float, started_at: str, seat_ids: list[str], meta: dict[str, Any]) -> dict[str, Any]:
    duration_ms = int(round((time.perf_counter() - started) * 1000))
    deployment = model_payload(meta)
    deep_learning = deep_learning_model_payload(meta)
    dataset = meta.get("dataset") or {}
    experiment = meta.get("experiment") or {}
    deployment_label = deployment.get("shortName") or deployment.get("name") or "模型"
    return {
        "available": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "name": dataset.get("name") or "需求-座位多标签匹配推荐数据集",
            "sampleCount": int(dataset.get("sampleCount") or 0),
            "demandCount": int(dataset.get("demandCount") or 0),
            "seatCount": int(dataset.get("seatCount") or 0),
            "groupCount": 0,
            "featureCount": len(FEATURE_COLUMNS),
            "labelCount": len(LABEL_COLUMNS),
        },
        "experiment": {
            "source": "需求座位匹配推荐实验_20260514",
            "taskType": experiment.get("taskType") or "需求-座位多标签匹配分类",
            "deploymentModel": deployment,
            "bestModel": deployment,
            "comparisonBestModel": ((experiment.get("bestModel") or {}).get("name")) or "",
            "deepLearningModel": deep_learning,
            "deploymentReason": experiment.get("deploymentReason") or "",
            "deepLearningNote": "神经网络 MLP 作为同一需求-座位匹配数据集上的深度学习对比模型。",
            "metricRows": experiment.get("metricRows") or [],
            "labelColumns": MATCH_LABELS,
        },
        "inference": {
            "realtime": True,
            "mode": "request_time_multilabel_matching_predict",
            "startedAt": started_at,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "durationMs": duration_ms,
            "requestedSeatCount": len(seat_ids),
            "predictedSeatCount": 0,
            "missingSeatCount": len(seat_ids),
            "missingSeatIds": seat_ids[:20],
            "processSteps": ["需求解析", "候选座位批量构造", f"{deployment_label} 多标签匹配预测", "Top-N 排序"],
        },
        "sceneProfiles": {},
        "groups": {},
        "seats": {},
    }


class RuntimeContext:
    """Everything that does not depend on the request.

    Loading it takes most of the time of a prediction (Python imports, the model
    file, the profiles of all seats). The worker mode (--serve) therefore builds it
    once and keeps it in memory for all following requests.
    """

    def __init__(self) -> None:
        self.meta = read_json(RUNTIME_META_PATH, {})
        self.seat_profiles = build_seat_profiles(read_seats())
        self.model = joblib.load(MODEL_PATH)
        self.feature_columns = read_json(FEATURE_COLUMNS_PATH, FEATURE_COLUMNS)
        self.linear_parts = extract_linear_parts(self.model)


def extract_linear_parts(model: Any) -> dict[str, np.ndarray] | None:
    """Scaler statistics and weights of the per-label linear SVMs, or None for other models."""
    try:
        means, scales, weights = [], [], []
        for estimator in model.estimators_:
            means.append(estimator.named_steps["scaler"].mean_)
            scales.append(estimator.named_steps["scaler"].scale_)
            weights.append(estimator.named_steps["model"].coef_.ravel())
        return {"means": np.array(means), "scales": np.array(scales), "weights": np.array(weights)}
    except (AttributeError, KeyError):
        return None


def build_model_evidence(context: RuntimeContext, demand: pd.Series, feature_values: np.ndarray, top_n: int = 3) -> list[dict[str, Any]]:
    """The features that raise the score of this seat most, computed from the model itself.

    For a linear model the contribution of feature j is w_j * (x_j - mean_j) / scale_j.
    The contributions of the four labels are combined with the same label weights that
    the ranking uses. Unlike `seatReason`, this is what the SVM actually relies on
    (see docs/recommendation.md).
    """
    parts = context.linear_parts
    if parts is None:
        return []
    per_label = parts["weights"] * (feature_values - parts["means"]) / parts["scales"]
    contribution = demand_label_weights(demand) @ per_label
    positive_total = float(np.clip(contribution, 0, None).sum())
    if positive_total <= 0:
        return []
    evidence = []
    for position in np.argsort(-contribution)[:top_n]:
        if contribution[position] <= 0:
            break
        evidence.append(
            {
                "feature": context.feature_columns[int(position)],
                "share": round(float(contribution[position]) / positive_total, 4),
            }
        )
    return evidence


def build_realtime_runtime(payload: dict[str, Any], context: RuntimeContext | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    seat_ids = normalize_seat_ids(payload)
    requested = set(seat_ids)

    if context is None:
        context = RuntimeContext()
    meta = context.meta
    seat_profiles = context.seat_profiles
    if seat_ids:
        seat_profiles = seat_profiles[seat_profiles["seat_id"].astype(str).isin(requested)].copy()
        order = {seat_id: index for index, seat_id in enumerate(seat_ids)}
        seat_profiles["_order"] = seat_profiles["seat_id"].astype(str).map(order)
        seat_profiles = seat_profiles.sort_values("_order").drop(columns=["_order"])

    if seat_profiles.empty:
        return build_empty_payload(started, started_at, seat_ids, meta)

    demand = build_demand_vector(payload)
    model = context.model
    feature_columns = context.feature_columns
    label_thresholds = np.asarray(
        ((meta.get("experiment") or {}).get("deploymentModel") or {}).get("labelThresholds")
        or read_json(LABEL_THRESHOLDS_PATH, [0.5] * len(LABEL_COLUMNS)),
        dtype=float,
    )

    feature_rows: list[dict[str, float]] = []
    cross_rows: list[dict[str, float]] = []
    for _, seat in seat_profiles.iterrows():
        cross = build_cross_features(demand, seat)
        scene_scores = calculate_scene_match_scores(demand, seat, cross)
        cross = {**cross, **scene_scores}
        cross_rows.append(cross)
        row = {
            **{column: float(demand[column]) for column in DEMAND_FEATURE_COLUMNS},
            **{column: float(seat[column]) for column in feature_columns if column in seat.index},
            **cross,
        }
        feature_rows.append({column: float(row.get(column, 0.0)) for column in feature_columns})

    feature_frame = pd.DataFrame(feature_rows, columns=feature_columns).astype(float)
    label_probability_matrix = predict_label_scores(model, feature_frame)
    probabilities = aggregate_label_scores(
        pd.DataFrame([{**demand.to_dict(), **seat.to_dict()} for _, seat in seat_profiles.iterrows()]),
        label_probability_matrix,
    )
    predictions = (label_probability_matrix >= label_thresholds.reshape(1, -1)).astype(int)

    deployment = model_payload(meta)
    deep_learning = deep_learning_model_payload(meta)
    dataset_meta = meta.get("dataset") or {}
    experiment_meta = meta.get("experiment") or {}
    seats_payload: dict[str, Any] = {}
    groups: dict[str, Any] = {}

    for index, (_, seat) in enumerate(seat_profiles.iterrows()):
        seat_id = str(seat["seat_id"])
        group_id = str(seat["table_group_code"])
        zone_code = str(seat["zone_code"])
        raw_probability = float(probabilities[index])
        label_score_values = {
            display: round(float(label_probability_matrix[index, label_index]), 6)
            for label_index, display in enumerate(MATCH_LABELS)
        }
        predicted_labels = [
            display
            for label_index, display in enumerate(MATCH_LABELS)
            if int(predictions[index, label_index]) == 1
        ]
        if not predicted_labels:
            predicted_labels = [max(label_score_values.items(), key=lambda item: item[1])[0]]
        cross = cross_rows[index]
        probability = calibrate_online_match_probability(raw_probability, cross)
        matching_label = "适合推荐" if probability >= 0.52 else "不优先推荐"
        confidence_level = "高" if probability >= 0.85 else ("中" if probability >= 0.65 else "低")

        seats_payload[seat_id] = {
            "seatId": seat_id,
            "groupId": group_id,
            "zoneCode": zone_code,
            "matchingProbability": round(probability, 6),
            "matchingPercent": int(round(probability * 100)),
            "matchingLabel": matching_label,
            "seatPrimaryLabel": matching_label,
            "seatSecondaryLabel": "候选座位",
            "seatLabelGap": round(abs(probability - 0.5), 4),
            "seatConfidenceLevel": confidence_level,
            "seatReason": build_reason(demand, seat, probability, label_score_values, cross),
            "modelEvidence": build_model_evidence(context, demand, feature_frame.iloc[index].to_numpy(dtype=float)),
            "actualLabels": [],
            "predictedLabels": predicted_labels,
            "labelScores": label_score_values,
            "featureFlags": build_feature_flags(seat),
            "matchingDetails": {
                "modelProbability": round(raw_probability, 6),
                "weightedMatchRatio": round(float(cross.get("weighted_match_ratio", 0)), 6),
                "weightedConflictRatio": round(float(cross.get("weighted_conflict_ratio", 0)), 6),
                "longStudyComfort": round(float(cross.get("long_study_comfort", 0)), 6),
            },
            "baseScores": {
                "focus": label_score_values["深度专注匹配"],
                "comfort": label_score_values["舒适久学匹配"],
                "device": label_score_values["设备作业匹配"],
                "collab": label_score_values["开放协作匹配"],
            },
            "adjustmentScores": {"focus": 0, "comfort": 0, "device": 0, "collab": 0},
            "finalScores": {
                "focus": label_score_values["深度专注匹配"],
                "comfort": label_score_values["舒适久学匹配"],
                "device": label_score_values["设备作业匹配"],
                "collab": label_score_values["开放协作匹配"],
            },
            "groupModel": {
                "predictedLabel": predicted_labels[0],
                "predictedConfidence": round(probability, 6),
                "secondaryLabel": predicted_labels[1] if len(predicted_labels) > 1 else matching_label,
                "secondaryConfidence": round(float(sorted(label_score_values.values(), reverse=True)[1]), 6),
            },
        }

        if group_id not in groups:
            groups[group_id] = {
                "groupId": group_id,
                "zoneCode": zone_code,
                "seatCount": 0,
                "probabilitySum": 0.0,
            }
        groups[group_id]["seatCount"] += 1
        groups[group_id]["probabilitySum"] += probability

    for group in groups.values():
        average_probability = group["probabilitySum"] / max(int(group["seatCount"]), 1)
        group["modelPredictedLabel"] = "需求匹配型" if average_probability >= 0.52 else "候选补充型"
        group["modelPredictedConfidence"] = round(average_probability, 6)
        group["modelSecondaryLabel"] = "候选座位"
        group["modelSecondaryConfidence"] = round(1 - average_probability, 6)
        group["baseScores"] = {
            "focus": round(average_probability, 6),
            "comfort": round(average_probability, 6),
            "device": round(average_probability, 6),
            "collab": round(average_probability, 6),
        }
        del group["probabilitySum"]

    missing_seat_ids = [seat_id for seat_id in seat_ids if seat_id not in seats_payload]
    duration_ms = int(round((time.perf_counter() - started) * 1000))
    deployment_label = deployment.get("shortName") or deployment.get("name") or "模型"
    return {
        "available": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "name": dataset_meta.get("name") or "需求-座位多标签匹配推荐数据集",
            "path": str(EXPERIMENT_ROOT / "数据集" / "request_seat_matching_dataset.csv"),
            "sampleCount": int(dataset_meta.get("sampleCount") or 0),
            "demandCount": int(dataset_meta.get("demandCount") or 0),
            "seatCount": int(dataset_meta.get("seatCount") or len(seats_payload)),
            "groupCount": int(len(groups)),
            "featureCount": int(len(feature_columns)),
            "labelCount": len(LABEL_COLUMNS),
        },
        "experiment": {
            "source": "需求座位匹配推荐实验_20260514",
            "taskType": experiment_meta.get("taskType") or "需求-座位多标签匹配分类",
            "runDir": str(EXPERIMENT_ROOT),
            "runAt": "2026-05-14",
            "bestModel": experiment_meta.get("bestModel") or deployment,
            "deploymentModel": deployment,
            "comparisonBestModel": ((experiment_meta.get("bestModel") or {}).get("name")) or "",
            "deepLearningModel": deep_learning,
            "deploymentReason": experiment_meta.get("deploymentReason") or "",
            "deepLearningNote": "神经网络 MLP 作为同一需求-座位匹配数据集上的深度学习对比模型。",
            "featureColumns": feature_columns,
            "labelColumns": MATCH_LABELS,
            "metricRows": experiment_meta.get("metricRows") or [],
        },
        "inference": {
            "realtime": True,
            "mode": "request_time_multilabel_matching_predict",
            "startedAt": started_at,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "durationMs": duration_ms,
            "requestedSeatCount": len(seat_ids),
            "predictedSeatCount": len(seats_payload),
            "missingSeatCount": len(missing_seat_ids),
            "missingSeatIds": missing_seat_ids[:20],
            "processSteps": ["需求解析", "候选座位批量构造", f"{deployment_label} 多标签匹配预测", "Top-N 排序"],
            "neuralModelUsed": False,
        },
        "sceneProfiles": {},
        "groups": groups,
        "seats": seats_payload,
    }


def serve() -> None:
    """Worker mode: load the model once, then answer one request per input line.

    Input line:  {"id": <any>, "payload": {...}}          (UTF-8 JSON)
    Output line: {"id": <same>, "result": {...}}  or  {"id": <same>, "error": "..."}
    The first output line is {"ready": true}. Output is ASCII-only JSON, so it does not
    depend on the console encoding of the platform.
    """

    def write(message: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(message, ensure_ascii=True, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    context = RuntimeContext()
    write({"ready": True})
    for raw_line in sys.stdin.buffer:
        line = raw_line.decode("utf-8").strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            write({"id": request_id, "result": build_realtime_runtime(request.get("payload") or {}, context)})
        except Exception as error:  # the worker must survive a bad request
            write({"id": request_id, "error": f"{type(error).__name__}: {error}"})


def main() -> None:
    if "--serve" in sys.argv[1:]:
        serve()
        return
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    payload = build_realtime_runtime(read_request_payload())
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
