#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import random
import shutil
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from scipy.io import savemat
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    hamming_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.multioutput import MultiOutputClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC
from sklearn.tree import DecisionTreeClassifier


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SEAT_MASTER_PATH = DATA_DIR / "seat_master.json"
EXPERIMENT_ROOT = ROOT / "docs" / "需求座位匹配推荐实验_20260514"
DATASET_DIR = EXPERIMENT_ROOT / "数据集"
OUTPUT_DIR = EXPERIMENT_ROOT / "实验输出"
MODEL_DIR = EXPERIMENT_ROOT / "模型"
FIG_DIR = EXPERIMENT_ROOT / "图示输出"
RUNTIME_META_PATH = DATA_DIR / "seat_matching_runtime.json"
DESKTOP_DIR = ROOT.parent

RANDOM_SEED = 20260513
NEGATIVE_MULTIPLIER = 1.35
SPLIT_RATIO_EXPERIMENTS = OrderedDict(
    [
        ("8:2", 0.8),
        ("7:3", 0.7),
        ("6:4", 0.6),
    ]
)
MAX_POSITIVES_PER_DEMAND = 260
SINGLE_ALGORITHM_DIR = EXPERIMENT_ROOT / "单算法运行"


DEMAND_FEATURE_COLUMNS = [
    "need_power_outlet",
    "need_window",
    "need_quiet",
    "need_balanced_temperature",
    "need_away_corridor",
    "need_table_4",
    "need_table_8",
    "need_bookshelf",
    "need_restroom",
    "need_sunlight",
    "duration_hours_norm",
    "time_morning",
    "time_afternoon",
    "time_evening",
    "scene_focus",
    "scene_comfort",
    "scene_device",
    "scene_collab",
    "explicit_need_count_norm",
]

SEAT_FEATURE_COLUMNS = [
    "seat_has_power",
    "seat_window",
    "seat_quiet",
    "seat_balanced_temperature",
    "seat_away_corridor",
    "seat_table_4",
    "seat_table_8",
    "seat_bookshelf",
    "seat_restroom",
    "seat_sunlight",
    "seat_capacity_norm",
    "seat_seq_norm",
    "zone_north",
    "zone_west",
    "zone_east",
    "zone_south_inner",
    "zone_south_outer",
    "group_power_rate",
    "group_window_rate",
    "group_quiet_rate",
    "group_corridor_rate",
    "group_sunlight_rate",
    "zone_power_rate",
    "zone_window_rate",
    "zone_quiet_rate",
    "zone_corridor_rate",
    "zone_sunlight_rate",
]

CROSS_FEATURE_COLUMNS = [
    "match_power_outlet",
    "match_window",
    "match_quiet",
    "match_temperature",
    "match_away_corridor",
    "match_table_4",
    "match_table_8",
    "match_bookshelf",
    "match_restroom",
    "match_sunlight",
    "conflict_corridor",
    "conflict_restroom",
    "conflict_ac",
    "conflict_table_size",
    "long_study_comfort",
    "device_quiet_synergy",
    "window_sunlight_synergy",
    "collab_power_synergy",
    "score_focus_match",
    "score_comfort_match",
    "score_device_match",
    "score_collab_match",
    "weighted_match_ratio",
    "weighted_conflict_ratio",
]

MODEL_CROSS_FEATURE_COLUMNS = [
    column
    for column in CROSS_FEATURE_COLUMNS
    if column not in {"weighted_match_ratio", "weighted_conflict_ratio"}
]

FEATURE_COLUMNS = DEMAND_FEATURE_COLUMNS + SEAT_FEATURE_COLUMNS + MODEL_CROSS_FEATURE_COLUMNS
LABEL_COLUMNS = ["label_focus_match", "label_comfort_match", "label_device_match", "label_collab_match"]
LABEL_DISPLAY = OrderedDict(
    [
        ("label_focus_match", "深度专注匹配"),
        ("label_comfort_match", "舒适久学匹配"),
        ("label_device_match", "设备作业匹配"),
        ("label_collab_match", "开放协作匹配"),
    ]
)

FILTER_WEIGHTS = OrderedDict(
    [
        ("power_outlet", 16.0),
        ("window", 12.0),
        ("quiet", 18.0),
        ("balanced_temperature", 8.0),
        ("away_corridor", 14.0),
        ("table_4", 8.0),
        ("table_8", 13.0),
        ("bookshelf", 5.0),
        ("restroom", 4.0),
        ("sunlight", 7.0),
    ]
)


@dataclass(frozen=True)
class DemandTemplate:
    key: str
    label: str
    base_texts: tuple[str, ...]
    weights: dict[str, float]
    scene_flags: dict[str, int]


DEMAND_TEMPLATES = [
    DemandTemplate(
        key="focus",
        label="深度专注",
        base_texts=(
            "我想找一个安静一点、适合长时间自习的位置，最好避开通道。",
            "考研复习需要专注，不想被人走动打扰，最好有插座。",
            "下午想沉浸式学习，安静和少干扰最重要。",
        ),
        weights={"quiet": 1.0, "away_corridor": 1.0, "power_outlet": 0.55, "balanced_temperature": 0.45},
        scene_flags={"focus": 1, "comfort": 0, "device": 0, "collab": 0},
    ),
    DemandTemplate(
        key="comfort",
        label="舒适久学",
        base_texts=(
            "我想坐久一点，最好靠窗、有光照、环境安静。",
            "下午长时间看书，想要靠窗、采光好、温度舒服的位置。",
            "今天准备待三四个小时，希望座位舒适一点，有插座更好。",
        ),
        weights={"window": 1.0, "sunlight": 0.9, "quiet": 0.75, "power_outlet": 0.65, "balanced_temperature": 0.65},
        scene_flags={"focus": 0, "comfort": 1, "device": 0, "collab": 0},
    ),
    DemandTemplate(
        key="device",
        label="设备作业",
        base_texts=(
            "我要带电脑写作业，需要能充电，最好安静一些。",
            "笔记本要用很久，优先找有插座、桌面稳定的位置。",
            "晚上想写代码，需要插座和比较少干扰的位置。",
        ),
        weights={"power_outlet": 1.0, "quiet": 0.65, "away_corridor": 0.55, "balanced_temperature": 0.35},
        scene_flags={"focus": 0, "comfort": 0, "device": 1, "collab": 0},
    ),
    DemandTemplate(
        key="collab",
        label="开放协作",
        base_texts=(
            "我们几个人一起自习，想找多人桌，能讨论也能充电。",
            "小组讨论需要大一点的桌子，最好是八人桌。",
            "结伴学习，希望有多人桌，插座方便一些。",
        ),
        weights={"table_8": 1.0, "power_outlet": 0.65, "balanced_temperature": 0.45, "quiet": 0.25},
        scene_flags={"focus": 0, "comfort": 0, "device": 0, "collab": 1},
    ),
    DemandTemplate(
        key="reading",
        label="临窗阅读",
        base_texts=(
            "想看纸质书，最好靠窗、有采光，能靠近书架更好。",
            "上午想临窗阅读，希望光线好一点，不要太吵。",
            "找一个靠窗看书的位置，最好安静一些。",
        ),
        weights={"window": 1.0, "sunlight": 0.9, "bookshelf": 0.55, "quiet": 0.65},
        scene_flags={"focus": 0, "comfort": 1, "device": 0, "collab": 0},
    ),
    DemandTemplate(
        key="short",
        label="短时停留",
        base_texts=(
            "只坐一会儿，想找进出方便一点的位置。",
            "临时停留一小时，靠近卫生间也可以。",
            "短时间查资料，不需要特别安静。",
        ),
        weights={"restroom": 0.75, "bookshelf": 0.55, "quiet": 0.2, "away_corridor": 0.0},
        scene_flags={"focus": 0, "comfort": 0, "device": 0, "collab": 0},
    ),
    DemandTemplate(
        key="exam",
        label="备考冲刺",
        base_texts=(
            "备考刷题，需要非常安静、能充电、不要靠近通道。",
            "明天考试，今晚想找安静有插座的位置复习。",
            "冲刺学习，希望不被打扰，最好温度均衡。",
        ),
        weights={"quiet": 1.0, "power_outlet": 0.9, "away_corridor": 0.9, "balanced_temperature": 0.55, "window": 0.25},
        scene_flags={"focus": 1, "comfort": 0, "device": 1, "collab": 0},
    ),
    DemandTemplate(
        key="small_table",
        label="小桌自习",
        base_texts=(
            "我一个人自习，想要四人桌或小桌，安静一点。",
            "不想坐大桌，想找小一点的桌组。",
            "两个人一起学习，小桌就够了，最好有插座。",
        ),
        weights={"table_4": 1.0, "quiet": 0.65, "power_outlet": 0.45, "away_corridor": 0.45},
        scene_flags={"focus": 1, "comfort": 0, "device": 0, "collab": 0},
    ),
]


def ensure_dirs() -> None:
    for path in [DATASET_DIR, OUTPUT_DIR, MODEL_DIR, FIG_DIR, SINGLE_ALGORITHM_DIR]:
        path.mkdir(parents=True, exist_ok=True)
    for legacy_file in [OUTPUT_DIR / "train_size_metrics.csv"]:
        if legacy_file.exists():
            legacy_file.unlink()
    for pattern in ("*.png", "*.svg"):
        for figure in FIG_DIR.glob(pattern):
            figure.unlink()


def to_int(value: Any) -> int:
    return int(bool(value))


def stable_noise(text: str, scale: float = 1.0) -> float:
    value = sum((index + 1) * ord(char) for index, char in enumerate(text))
    return ((value % 1000) / 1000.0 - 0.5) * scale


def read_seats() -> list[dict[str, Any]]:
    payload = json.loads(SEAT_MASTER_PATH.read_text(encoding="utf-8"))
    return list(payload.get("seats", []))


def build_demands() -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    time_variants = [
        ("morning", "上午", 0.0),
        ("afternoon", "下午", 0.02),
        ("evening", "晚上", -0.01),
    ]
    duration_variants = [1.0, 2.0, 3.0, 4.0]
    serial = 1

    for template in DEMAND_TEMPLATES:
        for text_index, base_text in enumerate(template.base_texts):
            for time_key, time_label, time_adjustment in time_variants[:2 + (text_index % 2)]:
                duration = duration_variants[(text_index + len(rows)) % len(duration_variants)]
                weights = dict(template.weights)
                if duration >= 3:
                    weights["quiet"] = min(1.0, weights.get("quiet", 0) + 0.12)
                    weights["power_outlet"] = min(1.0, weights.get("power_outlet", 0) + 0.10)
                    weights["balanced_temperature"] = min(1.0, weights.get("balanced_temperature", 0) + 0.08)
                if time_key == "morning":
                    weights["sunlight"] = min(1.0, weights.get("sunlight", 0) + 0.10)
                if time_key == "evening":
                    weights["power_outlet"] = min(1.0, weights.get("power_outlet", 0) + 0.08)

                text = base_text
                if time_label not in text:
                    text = f"{time_label}{text}"
                if duration >= 3 and "长时间" not in text and "三四个小时" not in text:
                    text = f"{text} 预计会坐{int(duration)}小时左右。"

                rows.append(
                    {
                        "demand_id": f"REQ{serial:03d}",
                        "demand_text": text,
                        "scene_key": template.key,
                        "scene_label": template.label,
                        "time_period": time_key,
                        "duration_hours": duration,
                        "need_power_outlet": round(weights.get("power_outlet", 0.0), 3),
                        "need_window": round(weights.get("window", 0.0), 3),
                        "need_quiet": round(weights.get("quiet", 0.0), 3),
                        "need_balanced_temperature": round(weights.get("balanced_temperature", 0.0), 3),
                        "need_away_corridor": round(weights.get("away_corridor", 0.0), 3),
                        "need_table_4": round(weights.get("table_4", 0.0), 3),
                        "need_table_8": round(weights.get("table_8", 0.0), 3),
                        "need_bookshelf": round(weights.get("bookshelf", 0.0), 3),
                        "need_restroom": round(weights.get("restroom", 0.0), 3),
                        "need_sunlight": round(weights.get("sunlight", 0.0) + time_adjustment, 3),
                        "time_morning": 1 if time_key == "morning" else 0,
                        "time_afternoon": 1 if time_key == "afternoon" else 0,
                        "time_evening": 1 if time_key == "evening" else 0,
                        "scene_focus": template.scene_flags["focus"],
                        "scene_comfort": template.scene_flags["comfort"],
                        "scene_device": template.scene_flags["device"],
                        "scene_collab": template.scene_flags["collab"],
                    }
                )
                serial += 1

    demand_df = pd.DataFrame(rows)
    explicit_cols = [
        "need_power_outlet",
        "need_window",
        "need_quiet",
        "need_balanced_temperature",
        "need_away_corridor",
        "need_table_4",
        "need_table_8",
        "need_bookshelf",
        "need_restroom",
        "need_sunlight",
    ]
    demand_df["duration_hours_norm"] = (demand_df["duration_hours"] / 4.0).clip(0, 1)
    demand_df["explicit_need_count_norm"] = (
        (demand_df[explicit_cols] > 0.15).sum(axis=1) / len(explicit_cols)
    ).round(4)
    return demand_df


def build_seat_profiles(seats: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for seat in seats:
        rows.append(
            {
                "seat_id": seat.get("seatId"),
                "zone_code": seat.get("zoneCode"),
                "zone_display_name": seat.get("zoneDisplayName"),
                "table_group_code": seat.get("tableGroupCode"),
                "zone_band": seat.get("zoneBand"),
                "seat_seq": int(seat.get("seatSeq") or 1),
                "seat_has_power": to_int(seat.get("hasPower")),
                "seat_window": to_int(seat.get("nearWindow")),
                "seat_quiet": 1 if seat.get("quietLevel") == "安静" else 0,
                "seat_balanced_temperature": 0 if seat.get("nearAC") else 1,
                "seat_away_corridor": 0 if seat.get("nearCorridor") else 1,
                "seat_table_4": 1 if str(seat.get("seatType")) == "4人桌" else 0,
                "seat_table_8": 1 if str(seat.get("seatType")) == "8人桌" else 0,
                "seat_bookshelf": to_int(seat.get("nearBookshelf")),
                "seat_restroom": to_int(seat.get("nearRestroom")),
                "seat_sunlight": 1 if seat.get("sunlight") == "有" else 0,
                "seat_capacity": int(seat.get("seatCapacity") or 4),
                "near_corridor_raw": to_int(seat.get("nearCorridor")),
                "near_restroom_raw": to_int(seat.get("nearRestroom")),
                "near_ac_raw": to_int(seat.get("nearAC")),
            }
        )

    frame = pd.DataFrame(rows)
    frame["seat_capacity_norm"] = (frame["seat_capacity"] / 8.0).clip(0, 1)
    max_seq = max(float(frame["seat_seq"].max()), 1.0)
    frame["seat_seq_norm"] = (frame["seat_seq"] / max_seq).clip(0, 1)
    for band in ["north", "west", "east", "south_inner", "south_outer"]:
        frame[f"zone_{band}"] = (frame["zone_band"] == band).astype(int)

    group_cols = [
        ("seat_has_power", "group_power_rate"),
        ("seat_window", "group_window_rate"),
        ("seat_quiet", "group_quiet_rate"),
        ("near_corridor_raw", "group_corridor_rate"),
        ("seat_sunlight", "group_sunlight_rate"),
    ]
    zone_cols = [
        ("seat_has_power", "zone_power_rate"),
        ("seat_window", "zone_window_rate"),
        ("seat_quiet", "zone_quiet_rate"),
        ("near_corridor_raw", "zone_corridor_rate"),
        ("seat_sunlight", "zone_sunlight_rate"),
    ]
    for source, target in group_cols:
        frame[target] = frame.groupby("table_group_code")[source].transform("mean").round(4)
    for source, target in zone_cols:
        frame[target] = frame.groupby("zone_code")[source].transform("mean").round(4)

    return frame


def demand_feature_row(demand: pd.Series) -> dict[str, float]:
    return {column: float(demand[column]) for column in DEMAND_FEATURE_COLUMNS}


def build_cross_features(demand: pd.Series, seat: pd.Series) -> dict[str, float]:
    need_sum = 0.0
    hit_sum = 0.0
    conflict_sum = 0.0

    def hit(need_col: str, seat_col: str, weight_key: str) -> float:
        nonlocal need_sum, hit_sum
        need = float(demand[need_col])
        value = float(seat[seat_col])
        weight = FILTER_WEIGHTS[weight_key]
        need_sum += need * weight
        hit_sum += need * value * weight
        return round(need * value, 5)

    result = {
        "match_power_outlet": hit("need_power_outlet", "seat_has_power", "power_outlet"),
        "match_window": hit("need_window", "seat_window", "window"),
        "match_quiet": hit("need_quiet", "seat_quiet", "quiet"),
        "match_temperature": hit("need_balanced_temperature", "seat_balanced_temperature", "balanced_temperature"),
        "match_away_corridor": hit("need_away_corridor", "seat_away_corridor", "away_corridor"),
        "match_table_4": hit("need_table_4", "seat_table_4", "table_4"),
        "match_table_8": hit("need_table_8", "seat_table_8", "table_8"),
        "match_bookshelf": hit("need_bookshelf", "seat_bookshelf", "bookshelf"),
        "match_restroom": hit("need_restroom", "seat_restroom", "restroom"),
        "match_sunlight": hit("need_sunlight", "seat_sunlight", "sunlight"),
    }

    conflict_corridor = float(demand["need_away_corridor"]) * float(seat["near_corridor_raw"])
    conflict_restroom = max(0.0, float(demand["need_quiet"]) - float(demand["need_restroom"])) * float(seat["near_restroom_raw"])
    conflict_ac = float(demand["need_balanced_temperature"]) * float(seat["near_ac_raw"])
    conflict_table_size = (
        float(demand["need_table_4"]) * float(seat["seat_table_8"]) +
        float(demand["need_table_8"]) * float(seat["seat_table_4"])
    )
    conflict_sum = (
        conflict_corridor * 14.0 +
        conflict_restroom * 7.0 +
        conflict_ac * 5.0 +
        conflict_table_size * 8.0
    )

    long_study = float(demand["duration_hours_norm"])
    result.update(
        {
            "conflict_corridor": round(conflict_corridor, 5),
            "conflict_restroom": round(conflict_restroom, 5),
            "conflict_ac": round(conflict_ac, 5),
            "conflict_table_size": round(conflict_table_size, 5),
            "long_study_comfort": round(
                long_study * (
                    0.38 * float(seat["seat_quiet"]) +
                    0.28 * float(seat["seat_has_power"]) +
                    0.20 * float(seat["seat_balanced_temperature"]) +
                    0.14 * float(seat["seat_away_corridor"])
                ),
                5,
            ),
            "device_quiet_synergy": round(
                float(demand["need_power_outlet"]) *
                float(demand["need_quiet"]) *
                float(seat["seat_has_power"]) *
                float(seat["seat_quiet"]),
                5,
            ),
            "window_sunlight_synergy": round(
                float(demand["need_window"]) *
                float(demand["need_sunlight"]) *
                float(seat["seat_window"]) *
                float(seat["seat_sunlight"]),
                5,
            ),
            "collab_power_synergy": round(
                float(demand["need_table_8"]) *
                float(demand["need_power_outlet"]) *
                float(seat["seat_table_8"]) *
                float(seat["seat_has_power"]),
                5,
            ),
            "weighted_match_ratio": round(hit_sum / max(need_sum, 1e-6), 5),
            "weighted_conflict_ratio": round(conflict_sum / max(need_sum, 1e-6), 5),
        }
    )
    return result


def calculate_match_score(demand: pd.Series, seat: pd.Series, cross: dict[str, float]) -> float:
    positive = (
        float(cross["weighted_match_ratio"]) * 72.0 +
        float(cross["long_study_comfort"]) * 12.0 +
        float(cross["device_quiet_synergy"]) * 6.0 +
        float(cross["window_sunlight_synergy"]) * 6.0 +
        float(cross["collab_power_synergy"]) * 5.0
    )
    penalty = float(cross["weighted_conflict_ratio"]) * 28.0
    scene_bonus = (
        float(demand["scene_focus"]) * float(seat["zone_north"]) * 3.0 +
        float(demand["scene_comfort"]) * (float(seat["zone_east"]) + float(seat["zone_south_outer"])) * 1.8 +
        float(demand["scene_device"]) * float(seat["group_power_rate"]) * 2.5 +
        float(demand["scene_collab"]) * float(seat["zone_south_inner"]) * 2.0
    )
    score = positive - penalty + scene_bonus + stable_noise(str(seat["seat_id"]) + str(demand["demand_id"]), scale=1.2)
    return round(max(0.0, min(100.0, score)), 4)


def calculate_scene_match_scores(demand: pd.Series, seat: pd.Series, cross: dict[str, float]) -> dict[str, float]:
    """Build weak multi-label scores with map-context ambiguity.

    The labels are intentionally not a direct copy of a single feature. Seats near
    boundaries, corridors, or mixed-function zones receive softer scores so the
    experiment resembles recommendation matching instead of exact rule lookup.
    """
    noise_key = f"{demand['demand_id']}_{seat['seat_id']}"
    spatial_noise = stable_noise(noise_key, scale=3.0)
    boundary_noise = stable_noise(f"boundary_{noise_key}", scale=1.6)
    zone_band = str(seat.get("zone_band") or "")

    quiet_need = float(demand["need_quiet"])
    power_need = float(demand["need_power_outlet"])
    window_need = float(demand["need_window"])
    sunlight_need = float(demand["need_sunlight"])
    table8_need = float(demand["need_table_8"])
    table4_need = float(demand["need_table_4"])
    duration = float(demand["duration_hours_norm"])

    north_bonus = 4.2 if zone_band == "north" else 0.0
    east_bonus = 2.4 if zone_band == "east" else 0.0
    south_inner_bonus = 3.0 if zone_band == "south_inner" else 0.0
    south_outer_bonus = 2.2 if zone_band == "south_outer" else 0.0
    west_penalty = 2.0 if zone_band == "west" else 0.0

    focus = (
        30.0 * float(cross["match_quiet"]) +
        20.0 * float(cross["match_away_corridor"]) +
        8.0 * float(cross["match_power_outlet"]) +
        13.0 * float(cross["long_study_comfort"]) +
        7.0 * float(seat["group_quiet_rate"]) +
        4.0 * float(demand["scene_focus"]) +
        north_bonus -
        16.0 * float(cross["conflict_corridor"]) -
        8.0 * float(cross["conflict_restroom"]) -
        west_penalty +
        spatial_noise
    )
    comfort = (
        24.0 * float(cross["match_window"]) +
        18.0 * float(cross["match_sunlight"]) +
        12.0 * float(cross["match_temperature"]) +
        10.0 * float(cross["match_quiet"]) +
        10.0 * duration * float(seat["seat_balanced_temperature"]) +
        4.0 * float(demand["scene_comfort"]) +
        east_bonus + south_outer_bonus -
        6.0 * float(cross["conflict_ac"]) +
        boundary_noise
    )
    device = (
        34.0 * float(cross["match_power_outlet"]) +
        9.0 * float(cross["match_quiet"]) +
        7.0 * float(cross["match_away_corridor"]) +
        7.0 * float(seat["group_power_rate"]) +
        5.0 * float(cross["device_quiet_synergy"]) +
        4.0 * float(demand["scene_device"]) -
        8.0 * float(cross["conflict_corridor"]) -
        4.0 * float(cross["conflict_ac"]) +
        stable_noise(f"device_{noise_key}", scale=4.2)
    )
    collab = (
        29.0 * float(cross["match_table_8"]) +
        8.0 * float(cross["match_power_outlet"]) +
        6.0 * float(cross["collab_power_synergy"]) +
        7.0 * float(seat["seat_capacity_norm"]) +
        4.0 * float(demand["scene_collab"]) +
        south_inner_bonus + south_outer_bonus -
        12.0 * float(cross["conflict_table_size"]) -
        4.0 * quiet_need * float(seat["near_corridor_raw"]) +
        stable_noise(f"collab_{noise_key}", scale=5.0)
    )

    # Weak demand priors: unrelated labels are still possible, but the threshold
    # will be higher later. This keeps multi-label overlap without making every
    # sample positive for every scene.
    focus += 8.0 * max(quiet_need, float(demand["scene_focus"])) + 2.0 * power_need
    comfort += 7.0 * max(window_need, sunlight_need, float(demand["scene_comfort"]))
    device += 8.0 * max(power_need, float(demand["scene_device"]))
    collab += 8.0 * max(table8_need, float(demand["scene_collab"])) + 2.0 * table4_need

    return {
        "score_focus_match": round(max(0.0, min(100.0, focus)), 4),
        "score_comfort_match": round(max(0.0, min(100.0, comfort)), 4),
        "score_device_match": round(max(0.0, min(100.0, device)), 4),
        "score_collab_match": round(max(0.0, min(100.0, collab)), 4),
    }


def demand_label_ratios(demand: pd.Series) -> dict[str, float]:
    focus_intent = max(float(demand["scene_focus"]), float(demand["need_quiet"]), float(demand["need_away_corridor"]))
    comfort_intent = max(float(demand["scene_comfort"]), float(demand["need_window"]), float(demand["need_sunlight"]), float(demand["need_balanced_temperature"]))
    device_intent = max(float(demand["scene_device"]), float(demand["need_power_outlet"]))
    collab_intent = max(float(demand["scene_collab"]), float(demand["need_table_8"]), float(demand["need_table_4"]) * 0.45)
    return {
        "label_focus_match": 0.08 + 0.16 * focus_intent,
        "label_comfort_match": 0.07 + 0.15 * comfort_intent,
        "label_device_match": 0.08 + 0.17 * device_intent,
        "label_collab_match": 0.06 + 0.16 * collab_intent,
    }


def apply_fuzzy_multilabels(demand_frame: pd.DataFrame, demand: pd.Series) -> pd.DataFrame:
    label_to_score = {
        "label_focus_match": "score_focus_match",
        "label_comfort_match": "score_comfort_match",
        "label_device_match": "score_device_match",
        "label_collab_match": "score_collab_match",
    }
    ratios = demand_label_ratios(demand)
    frame = demand_frame.copy()
    for label, score_col in label_to_score.items():
        ratio = max(0.045, min(0.26, ratios[label] + stable_noise(f"{demand['demand_id']}_{label}", scale=0.035)))
        threshold = frame[score_col].quantile(1 - ratio)
        raw_label = (frame[score_col] >= threshold).astype(int)

        margin = (frame[score_col] - threshold).abs()
        boundary = margin <= 2.0
        flip_mask = boundary & frame["sample_id"].map(lambda value: stable_noise(f"flip_{label}_{value}", scale=1.0) > 0.46)
        raw_label.loc[flip_mask] = 1 - raw_label.loc[flip_mask]

        # A few map-level exceptions avoid a perfectly linear threshold surface.
        if label == "label_focus_match":
            raw_label.loc[(frame["near_corridor_raw"] > 0) & (frame["score_focus_match"] < threshold + 5.0)] = 0
        if label == "label_comfort_match":
            raw_label.loc[(frame["seat_window"] > 0) & (frame["seat_sunlight"] > 0) & (frame["score_comfort_match"] > threshold - 2.5)] = 1
        if label == "label_device_match":
            raw_label.loc[(frame["seat_has_power"] <= 0) & (float(demand["need_power_outlet"]) > 0.55)] = 0
        if label == "label_collab_match":
            raw_label.loc[(frame["seat_table_4"] > 0) & (float(demand["need_table_8"]) > 0.6)] = 0
        frame[label] = raw_label.astype(int)

    frame["positive_label_count"] = frame[LABEL_COLUMNS].sum(axis=1)
    frame["is_recommended"] = (frame["positive_label_count"] > 0).astype(int)
    return frame


def build_matching_dataset(demands: pd.DataFrame, seats: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    seat_records = seats.to_dict("records")
    for _, demand in demands.iterrows():
        demand_features = demand_feature_row(demand)
        demand_rows: list[dict[str, Any]] = []
        for seat_record in seat_records:
            seat = pd.Series(seat_record)
            cross = build_cross_features(demand, seat)
            score = calculate_match_score(demand, seat, cross)
            scene_scores = calculate_scene_match_scores(demand, seat, cross)
            row = {
                "sample_id": f"{demand['demand_id']}_{seat_record['seat_id']}",
                "demand_id": demand["demand_id"],
                "demand_text": demand["demand_text"],
                "scene_key": demand["scene_key"],
                "scene_label": demand["scene_label"],
                "seat_id": seat_record["seat_id"],
                "zone_code": seat_record["zone_code"],
                "zone_display_name": seat_record["zone_display_name"],
                "table_group_code": seat_record["table_group_code"],
                "zone_band": seat_record["zone_band"],
                "near_corridor_raw": float(seat_record["near_corridor_raw"]),
                "near_restroom_raw": float(seat_record["near_restroom_raw"]),
                "near_ac_raw": float(seat_record["near_ac_raw"]),
                **demand_features,
                **{column: float(seat_record[column]) for column in SEAT_FEATURE_COLUMNS},
                **cross,
                **scene_scores,
                "match_score": score,
            }
            demand_rows.append(row)

        demand_frame = pd.DataFrame(demand_rows)
        demand_frame = apply_fuzzy_multilabels(demand_frame, demand)
        demand_frame["rank_in_demand"] = demand_frame["match_score"].rank(method="first", ascending=False).astype(int)
        rows.extend(demand_frame.to_dict("records"))

    return pd.DataFrame(rows)


def build_training_sample(dataset: pd.DataFrame, demand_ids: list[str] | None = None) -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    sampled_parts: list[pd.DataFrame] = []
    source = dataset[dataset["demand_id"].isin(demand_ids)].copy() if demand_ids else dataset
    for _, group in source.groupby("demand_id"):
        positives = group[group[LABEL_COLUMNS].sum(axis=1) > 0]
        negatives = group[group["is_recommended"] == 0]
        if len(positives) > MAX_POSITIVES_PER_DEMAND:
            chosen_positive_indices = rng.choice(positives.index.to_numpy(), size=MAX_POSITIVES_PER_DEMAND, replace=False)
            positives = positives.loc[chosen_positive_indices]
        negative_count = min(len(negatives), int(math.ceil(len(positives) * NEGATIVE_MULTIPLIER)))
        chosen_negative_indices = rng.choice(negatives.index.to_numpy(), size=negative_count, replace=False)
        sampled_parts.append(pd.concat([positives, negatives.loc[chosen_negative_indices]], ignore_index=False))
    sample = pd.concat(sampled_parts, ignore_index=True)
    return sample.sample(frac=1.0, random_state=RANDOM_SEED).reset_index(drop=True)


def model_specs() -> OrderedDict[str, Any]:
    return OrderedDict(
        [
            (
                "逻辑回归",
                OneVsRestClassifier(
                    Pipeline(
                        [
                            ("scaler", StandardScaler()),
                            ("model", LogisticRegression(max_iter=1800, class_weight="balanced")),
                        ]
                    )
                ),
            ),
            (
                "支持向量机 SVM",
                OneVsRestClassifier(
                    Pipeline(
                        [
                            ("scaler", StandardScaler()),
                            ("model", LinearSVC(C=0.85, class_weight="balanced", dual="auto", max_iter=5000)),
                        ]
                    )
                ),
            ),
            (
                "神经网络 MLP",
                Pipeline(
                    [
                        ("scaler", StandardScaler()),
                        (
                            "model",
                            MLPClassifier(
                                hidden_layer_sizes=(42, 18),
                                activation="relu",
                                alpha=0.002,
                                learning_rate_init=0.001,
                                early_stopping=True,
                                validation_fraction=0.15,
                                n_iter_no_change=14,
                                max_iter=360,
                                random_state=RANDOM_SEED,
                            ),
                        ),
                    ]
                ),
            ),
            (
                "随机森林",
                RandomForestClassifier(
                    n_estimators=180,
                    max_depth=14,
                    min_samples_leaf=4,
                    class_weight="balanced_subsample",
                    n_jobs=-1,
                    random_state=RANDOM_SEED,
                ),
            ),
            (
                "决策树",
                DecisionTreeClassifier(max_depth=10, min_samples_leaf=12, class_weight="balanced", random_state=RANDOM_SEED),
            ),
            (
                "K近邻 KNN(k=11)",
                Pipeline(
                    [
                        ("scaler", StandardScaler()),
                        ("model", KNeighborsClassifier(n_neighbors=11, weights="distance")),
                    ]
                ),
            ),
            ("高斯朴素贝叶斯", GaussianNB()),
        ]
    )


def wrap_model_for_multilabel(model_name: str, model: Any) -> Any:
    if model_name in {"随机森林", "决策树", "K近邻 KNN(k=11)", "高斯朴素贝叶斯"}:
        return MultiOutputClassifier(model)
    return model


def predict_label_scores(model: Any, X: pd.DataFrame) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(X)
        if isinstance(probabilities, list):
            return np.vstack([np.asarray(item)[:, 1] for item in probabilities]).T
        probabilities = np.asarray(probabilities)
        if probabilities.ndim == 3:
            return probabilities[:, :, 1]
        return probabilities
    if hasattr(model, "decision_function"):
        raw = np.asarray(model.decision_function(X), dtype=float)
        return 1.0 / (1.0 + np.exp(-raw))
    prediction = np.asarray(model.predict(X), dtype=float)
    return prediction


def demand_label_weights(demand: pd.Series) -> np.ndarray:
    weights = np.array(
        [
            max(float(demand.get("scene_focus", 0)), float(demand.get("need_quiet", 0)), float(demand.get("need_away_corridor", 0))),
            max(float(demand.get("scene_comfort", 0)), float(demand.get("need_window", 0)), float(demand.get("need_sunlight", 0)), float(demand.get("need_balanced_temperature", 0))),
            max(float(demand.get("scene_device", 0)), float(demand.get("need_power_outlet", 0))),
            max(float(demand.get("scene_collab", 0)), float(demand.get("need_table_8", 0)), float(demand.get("need_table_4", 0)) * 0.45),
        ],
        dtype=float,
    )
    if float(weights.sum()) <= 0:
        weights = np.ones(len(LABEL_COLUMNS), dtype=float)
    return weights / weights.sum()


def aggregate_label_scores(frame: pd.DataFrame, label_scores: np.ndarray) -> np.ndarray:
    values = []
    for row_index, (_, row) in enumerate(frame.iterrows()):
        values.append(float(np.dot(label_scores[row_index], demand_label_weights(row))))
    return np.asarray(values, dtype=float)


def optimize_label_thresholds(y_true: np.ndarray, scores: np.ndarray) -> np.ndarray:
    thresholds: list[float] = []
    candidates = np.linspace(0.18, 0.82, 33)
    for label_index in range(y_true.shape[1]):
        best_threshold = 0.5
        best_f1 = -1.0
        for threshold in candidates:
            prediction = (scores[:, label_index] >= threshold).astype(int)
            value = f1_score(y_true[:, label_index], prediction, zero_division=0)
            if value > best_f1:
                best_f1 = value
                best_threshold = float(threshold)
        thresholds.append(best_threshold)
    return np.asarray(thresholds, dtype=float)


def apply_label_thresholds(scores: np.ndarray, thresholds: np.ndarray) -> np.ndarray:
    return (scores >= thresholds.reshape(1, -1)).astype(int)


def split_sample_by_demand_ratio(sample: pd.DataFrame, train_ratio: float, seed_offset: int = 0) -> tuple[pd.DataFrame, pd.DataFrame, list[str], list[str]]:
    demand_ids = sorted(sample["demand_id"].unique().tolist())
    rng = np.random.default_rng(RANDOM_SEED + seed_offset)
    shuffled = demand_ids.copy()
    rng.shuffle(shuffled)
    train_count = int(round(len(shuffled) * train_ratio))
    train_count = max(1, min(len(shuffled) - 1, train_count))
    train_demands = sorted(shuffled[:train_count])
    test_demands = sorted(shuffled[train_count:])
    train_df = sample[sample["demand_id"].isin(train_demands)].reset_index(drop=True)
    test_df = sample[sample["demand_id"].isin(test_demands)].reset_index(drop=True)
    return train_df, test_df, train_demands, test_demands


def evaluate_models(training_sample: pd.DataFrame, full_dataset: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, Any]:
    train_df, test_df, train_demands, test_demands = split_sample_by_demand_ratio(training_sample, 0.8, 80)

    X_train = train_df[FEATURE_COLUMNS].astype(float)
    y_train = train_df[LABEL_COLUMNS].astype(int)
    X_test = test_df[FEATURE_COLUMNS].astype(float)
    y_test = test_df[LABEL_COLUMNS].astype(int)

    metrics: list[dict[str, Any]] = []
    models: dict[str, Any] = {}
    reports: dict[str, pd.DataFrame] = {}

    for model_name, raw_model in model_specs().items():
        model = wrap_model_for_multilabel(model_name, raw_model)
        started = time.perf_counter()
        model.fit(X_train, y_train)
        fit_time = time.perf_counter() - started

        predict_started = time.perf_counter()
        train_scores = predict_label_scores(model, X_train)
        thresholds = optimize_label_thresholds(y_train.to_numpy(dtype=int), train_scores)
        scores = predict_label_scores(model, X_test)
        predictions = apply_label_thresholds(scores, thresholds)
        predict_time = time.perf_counter() - predict_started
        y_test_array = y_test.to_numpy(dtype=int)

        metrics.append(
            {
                "model_name": model_name,
                "subset_accuracy": accuracy_score(y_test_array, predictions),
                "macro_precision": precision_score(y_test_array, predictions, average="macro", zero_division=0),
                "macro_recall": recall_score(y_test_array, predictions, average="macro", zero_division=0),
                "macro_f1": f1_score(y_test_array, predictions, average="macro", zero_division=0),
                "micro_f1": f1_score(y_test_array, predictions, average="micro", zero_division=0),
                "samples_f1": f1_score(y_test_array, predictions, average="samples", zero_division=0),
                "hamming_loss": hamming_loss(y_test_array, predictions),
                "roc_auc_micro": roc_auc_score(y_test_array, scores, average="micro"),
                "pr_auc_micro": average_precision_score(y_test_array, scores, average="micro"),
                "fit_time_sec": fit_time,
                "predict_time_sec": predict_time,
                "train_samples": len(train_df),
                "test_samples": len(test_df),
                "train_demand_count": train_df["demand_id"].nunique(),
                "test_demand_count": test_df["demand_id"].nunique(),
                "label_thresholds": json.dumps([round(float(item), 4) for item in thresholds], ensure_ascii=False),
            }
        )
        models[model_name] = model
        reports[model_name] = pd.DataFrame(
            classification_report(
                y_test_array,
                predictions,
                target_names=list(LABEL_DISPLAY.values()),
                output_dict=True,
                zero_division=0,
            )
        ).T

    metrics_df = pd.DataFrame(metrics).sort_values(["macro_f1", "micro_f1"], ascending=[False, False]).reset_index(drop=True)
    deployment_model = models["支持向量机 SVM"]
    joblib.dump(deployment_model, MODEL_DIR / "svm_matching_model.joblib")
    joblib.dump(models[metrics_df.iloc[0]["model_name"]], MODEL_DIR / "best_model.joblib")
    svm_thresholds = json.loads(metrics_df[metrics_df["model_name"] == "支持向量机 SVM"].iloc[0]["label_thresholds"])
    (MODEL_DIR / "label_thresholds.json").write_text(json.dumps(svm_thresholds, ensure_ascii=False, indent=2), encoding="utf-8")
    reports["支持向量机 SVM"].to_csv(OUTPUT_DIR / "classification_report_svm.csv", encoding="utf-8-sig")

    topn_df = evaluate_topn(deployment_model, full_dataset, test_demands)
    return metrics_df, topn_df, deployment_model


def evaluate_topn(model: Any, full_dataset: pd.DataFrame, demand_ids: list[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for demand_id in demand_ids:
        group = full_dataset[full_dataset["demand_id"] == demand_id].copy()
        strong_threshold = group["match_score"].quantile(0.86)
        group["topn_relevant"] = (
            ((group["positive_label_count"] >= 2) & (group["match_score"] >= strong_threshold)) |
            (group["positive_label_count"] >= 3)
        ).astype(int)
        label_scores = predict_label_scores(model, group[FEATURE_COLUMNS].astype(float))
        group["predicted_probability"] = aggregate_label_scores(group, label_scores)
        ranked = group.sort_values("predicted_probability", ascending=False)
        for k in [5, 10, 20]:
            topk = ranked.head(k)
            rows.append(
                {
                    "demand_id": demand_id,
                    "top_k": k,
                    "precision_at_k": float(topk["topn_relevant"].mean()),
                    "avg_probability": float(topk["predicted_probability"].mean()),
                    "positive_count_in_top_k": int(topk["topn_relevant"].sum()),
                }
            )
    return pd.DataFrame(rows)


def evaluate_split_ratio_experiments(all_training_sample: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []

    for split_label, train_ratio in SPLIT_RATIO_EXPERIMENTS.items():
        train_df, test_df, train_demands, test_demands = split_sample_by_demand_ratio(
            all_training_sample,
            train_ratio,
            int(train_ratio * 100),
        )
        X_train = train_df[FEATURE_COLUMNS].astype(float)
        y_train = train_df[LABEL_COLUMNS].astype(int)
        X_test = test_df[FEATURE_COLUMNS].astype(float)
        y_test = test_df[LABEL_COLUMNS].astype(int).to_numpy(dtype=int)

        for model_name, raw_model in model_specs().items():
            model = wrap_model_for_multilabel(model_name, raw_model)
            model.fit(X_train, y_train)
            train_scores = predict_label_scores(model, X_train)
            thresholds = optimize_label_thresholds(y_train.to_numpy(dtype=int), train_scores)
            scores = predict_label_scores(model, X_test)
            predictions = apply_label_thresholds(scores, thresholds)
            rows.append(
                {
                    "split_label": split_label,
                    "train_test_ratio": split_label,
                    "test_train_ratio": f"{split_label.split(':')[1]}:{split_label.split(':')[0]}",
                    "train_ratio": train_ratio,
                    "test_ratio": round(1 - train_ratio, 2),
                    "model_name": model_name,
                    "macro_f1": f1_score(y_test, predictions, average="macro", zero_division=0),
                    "micro_f1": f1_score(y_test, predictions, average="micro", zero_division=0),
                    "macro_precision": precision_score(y_test, predictions, average="macro", zero_division=0),
                    "macro_recall": recall_score(y_test, predictions, average="macro", zero_division=0),
                    "subset_accuracy": accuracy_score(y_test, predictions),
                    "train_samples": len(train_df),
                    "test_samples": len(test_df),
                    "train_demand_count": len(train_demands),
                    "test_demand_count": len(test_demands),
                }
            )
    return pd.DataFrame(rows)


def format_workbook(path: Path) -> None:
    workbook = load_workbook(path)
    header_fill = PatternFill("solid", fgColor="DDEBF7")
    header_font = Font(name="Microsoft YaHei", bold=True, color="1F4E79")
    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        for cell in sheet[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for column_cells in sheet.columns:
            column = column_cells[0].column_letter
            max_length = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column_cells[:200])
            sheet.column_dimensions[column].width = min(max(max_length + 2, 10), 32)
    workbook.save(path)


def write_excel_outputs(demands: pd.DataFrame, seat_profiles: pd.DataFrame, full_dataset: pd.DataFrame, training_sample: pd.DataFrame) -> None:
    features = training_sample[FEATURE_COLUMNS]
    labels = training_sample[LABEL_COLUMNS]
    features.to_excel(DATASET_DIR / "features.xlsx", index=False)
    labels.to_excel(DATASET_DIR / "labels.xlsx", index=False)
    demands.to_excel(DATASET_DIR / "demands.xlsx", index=False)
    seat_profiles.to_excel(DATASET_DIR / "seat_profiles.xlsx", index=False)
    training_sample.to_excel(DATASET_DIR / "training_samples.xlsx", index=False)

    # The full pair dataset is intentionally kept as CSV to avoid oversized Excel editing overhead.
    full_dataset.to_csv(DATASET_DIR / "request_seat_matching_dataset.csv", index=False, encoding="utf-8-sig")
    savemat(DATASET_DIR / "output.mat", {"X": features.to_numpy(dtype=float), "Y": labels.to_numpy(dtype=int)})

    summary_path = DATASET_DIR / "request_seat_matching_summary.xlsx"
    with pd.ExcelWriter(summary_path, engine="openpyxl") as writer:
        demands.to_excel(writer, sheet_name="需求画像", index=False)
        seat_profiles.head(500).to_excel(writer, sheet_name="座位画像示例", index=False)
        training_sample.head(2000).to_excel(writer, sheet_name="匹配样本示例", index=False)
        pd.DataFrame({"feature_name": FEATURE_COLUMNS}).to_excel(writer, sheet_name="特征字段", index=False)
        pd.DataFrame(
            [{"label_name": key, "display_name": value} for key, value in LABEL_DISPLAY.items()]
        ).to_excel(writer, sheet_name="标签字段", index=False)

    for workbook_path in [
        DATASET_DIR / "features.xlsx",
        DATASET_DIR / "labels.xlsx",
        DATASET_DIR / "demands.xlsx",
        DATASET_DIR / "seat_profiles.xlsx",
        DATASET_DIR / "training_samples.xlsx",
        summary_path,
    ]:
        format_workbook(workbook_path)


def configure_plot_style() -> None:
    plt.style.use("default")
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["axes.facecolor"] = "white"


def write_figures(metrics_df: pd.DataFrame, topn_df: pd.DataFrame, size_df: pd.DataFrame, model: Any, training_sample: pd.DataFrame) -> None:
    configure_plot_style()

    def annotate_bars(axis: Any, bars: Any, values: list[float], offset: float = 0.01) -> None:
        for bar, value in zip(bars, values):
            axis.text(
                bar.get_x() + bar.get_width() / 2,
                value + offset,
                f"{value:.4f}",
                ha="center",
                va="bottom",
                fontsize=9,
            )

    ordered = metrics_df.sort_values("macro_f1", ascending=False)
    fig, ax = plt.subplots(figsize=(10.8, 5.6), constrained_layout=True)
    colors = ["#24527a" if name == "支持向量机 SVM" else "#b7d4ea" for name in ordered["model_name"]]
    bars = ax.bar(ordered["model_name"], ordered["macro_f1"], color=colors)
    ax.set_ylim(0.0, 1.02)
    ax.set_ylabel("Macro-F1")
    ax.set_title("需求-座位多标签匹配模型 Macro-F1 对比")
    ax.grid(False)
    ax.tick_params(axis="x", rotation=20)
    annotate_bars(ax, bars, ordered["macro_f1"].tolist(), 0.012)
    fig.savefig(FIG_DIR / "01_多模型MacroF1对比图.png", dpi=300)
    plt.close(fig)

    subset_ordered = metrics_df.sort_values("subset_accuracy", ascending=False)
    fig, ax = plt.subplots(figsize=(10.8, 5.6), constrained_layout=True)
    bars = ax.bar(
        subset_ordered["model_name"],
        subset_ordered["subset_accuracy"],
        color=["#24527a" if name == "支持向量机 SVM" else "#c9dcec" for name in subset_ordered["model_name"]],
    )
    ax.set_ylim(0.0, 1.02)
    ax.set_ylabel("子集准确率")
    ax.set_title("需求-座位多标签匹配模型子集准确率对比")
    ax.grid(False)
    ax.tick_params(axis="x", rotation=20)
    annotate_bars(ax, bars, subset_ordered["subset_accuracy"].tolist(), 0.012)
    fig.savefig(FIG_DIR / "02_多模型子集准确率对比图.png", dpi=300)
    plt.close(fig)

    grouped = metrics_df.sort_values("macro_f1", ascending=False)
    x = np.arange(len(grouped))
    width = 0.34
    fig, ax = plt.subplots(figsize=(11.2, 5.8), constrained_layout=True)
    bars1 = ax.bar(x - width / 2, grouped["macro_precision"], width, label="宏平均精确率", color="#2f6f9f")
    bars2 = ax.bar(x + width / 2, grouped["macro_recall"], width, label="宏平均召回率", color="#b7d4ea")
    ax.set_ylim(0.0, 1.05)
    ax.set_ylabel("指标值")
    ax.set_title("多模型宏平均精确率与召回率对比")
    ax.set_xticks(x)
    ax.set_xticklabels(grouped["model_name"], rotation=20)
    ax.grid(False)
    ax.legend(frameon=False)
    annotate_bars(ax, bars1, grouped["macro_precision"].tolist(), 0.008)
    annotate_bars(ax, bars2, grouped["macro_recall"].tolist(), 0.008)
    fig.savefig(FIG_DIR / "03_多模型精确率召回率对比图.png", dpi=300)
    plt.close(fig)

    ratio_file_index = 4
    for split_label, _ in SPLIT_RATIO_EXPERIMENTS.items():
        ratio_group = size_df[size_df["split_label"] == split_label].sort_values("macro_f1", ascending=False)
        fig, ax = plt.subplots(figsize=(10.8, 5.6), constrained_layout=True)
        bars = ax.bar(
            ratio_group["model_name"],
            ratio_group["macro_f1"],
            color=["#24527a" if name == "支持向量机 SVM" else "#b7d4ea" for name in ratio_group["model_name"]],
        )
        ax.set_ylim(0.0, 1.02)
        ax.set_ylabel("Macro-F1")
        ax.set_title(f"训练集:测试集={split_label} 时多模型 Macro-F1 对比")
        ax.grid(False)
        ax.tick_params(axis="x", rotation=20)
        annotate_bars(ax, bars, ratio_group["macro_f1"].tolist(), 0.012)
        fig.savefig(FIG_DIR / f"{ratio_file_index:02d}_训练测试比例_{split_label.replace(':', '_')}_MacroF1对比图.png", dpi=300)
        plt.close(fig)
        ratio_file_index += 1

    fig, ax = plt.subplots(figsize=(10.6, 5.6), constrained_layout=True)
    for model_name, group in size_df.groupby("model_name"):
        line_group = group.copy()
        line_group["ratio_order"] = line_group["split_label"].map({label: index for index, label in enumerate(SPLIT_RATIO_EXPERIMENTS.keys())})
        line_group = line_group.sort_values("ratio_order")
        ax.plot(
            line_group["split_label"],
            line_group["macro_f1"],
            marker="o",
            linewidth=2.4 if model_name == "支持向量机 SVM" else 1.5,
            label=model_name,
        )
    ax.set_ylim(0.0, 1.02)
    ax.set_xlabel("训练集:测试集")
    ax.set_ylabel("Macro-F1")
    ax.set_title("8:2、7:3、6:4 划分下多模型 Macro-F1 变化")
    ax.grid(False)
    ax.legend(ncol=2, fontsize=8.5, frameon=False)
    fig.savefig(FIG_DIR / "07_训练测试比例_MacroF1趋势图.png", dpi=300)
    plt.close(fig)

    pivot = topn_df.groupby("top_k")["precision_at_k"].mean().reset_index()
    fig, ax = plt.subplots(figsize=(7.6, 5.2), constrained_layout=True)
    ax.plot(pivot["top_k"], pivot["precision_at_k"], marker="o", linewidth=2.2, color="#24527a")
    ax.set_ylim(0.0, 1.02)
    ax.set_xlabel("Top-K")
    ax.set_ylabel("平均 Precision@K")
    ax.set_title("SVM 在线推荐 Top-K 精度")
    ax.grid(False)
    for _, row in pivot.iterrows():
        ax.text(row["top_k"], row["precision_at_k"] + 0.025, f"{row['precision_at_k']:.3f}", ha="center")
    fig.savefig(FIG_DIR / "08_SVM_TopK推荐精度图.png", dpi=300)
    plt.close(fig)

    _, test_df, _, _ = split_sample_by_demand_ratio(training_sample, 0.8, 80)
    scores = predict_label_scores(model, test_df[FEATURE_COLUMNS].astype(float))
    try:
        thresholds = np.asarray(json.loads((MODEL_DIR / "label_thresholds.json").read_text(encoding="utf-8")), dtype=float)
    except Exception:
        thresholds = np.asarray([0.5] * len(LABEL_COLUMNS), dtype=float)
    predictions = apply_label_thresholds(scores, thresholds)
    y_true = test_df[LABEL_COLUMNS].astype(int).to_numpy()
    svm_report = pd.DataFrame(
        classification_report(
            y_true,
            predictions,
            target_names=list(LABEL_DISPLAY.values()),
            output_dict=True,
            zero_division=0,
        )
    ).T

    fig, axes = plt.subplots(2, 2, figsize=(8.8, 7.2), constrained_layout=True)
    for axis, label_index, label in zip(axes.flat, range(len(LABEL_COLUMNS)), LABEL_COLUMNS):
        cm = confusion_matrix(y_true[:, label_index], predictions[:, label_index], labels=[0, 1])
        im = axis.imshow(cm, cmap="Blues")
        axis.set_title(LABEL_DISPLAY[label])
        axis.set_xticks([0, 1])
        axis.set_yticks([0, 1])
        axis.set_xticklabels(["否", "是"])
        axis.set_yticklabels(["否", "是"])
        axis.set_xlabel("预测")
        axis.set_ylabel("真实")
        for i in range(2):
            for j in range(2):
                axis.text(j, i, str(cm[i, j]), ha="center", va="center", color="white" if cm[i, j] > cm.max() / 2 else "#222222")
    fig.colorbar(im, ax=axes.ravel().tolist(), fraction=0.026, pad=0.02)
    fig.suptitle("SVM 多标签匹配逐标签混淆矩阵", fontsize=15, fontweight="bold")
    fig.savefig(FIG_DIR / "09_SVM多标签匹配混淆矩阵.png", dpi=300)
    plt.close(fig)

    label_rows = svm_report.loc[list(LABEL_DISPLAY.values())].reset_index().rename(columns={"index": "label"})
    fig, ax = plt.subplots(figsize=(8.8, 5.2), constrained_layout=True)
    bars = ax.bar(label_rows["label"], label_rows["f1-score"], color="#24527a")
    ax.set_ylim(0.0, 1.02)
    ax.set_ylabel("F1-score")
    ax.set_title("SVM 逐标签 F1 值对比")
    ax.grid(False)
    ax.tick_params(axis="x", rotation=15)
    annotate_bars(ax, bars, label_rows["f1-score"].tolist(), 0.012)
    fig.savefig(FIG_DIR / "10_SVM逐标签F1对比图.png", dpi=300)
    plt.close(fig)

    heatmap_values = label_rows[["precision", "recall", "f1-score"]].to_numpy(dtype=float)
    fig, ax = plt.subplots(figsize=(7.8, 5.2), constrained_layout=True)
    image = ax.imshow(heatmap_values, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(3))
    ax.set_xticklabels(["Precision", "Recall", "F1"])
    ax.set_yticks(range(len(label_rows)))
    ax.set_yticklabels(label_rows["label"])
    ax.set_title("SVM 分类报告热力图")
    ax.grid(False)
    for row_index in range(heatmap_values.shape[0]):
        for col_index in range(heatmap_values.shape[1]):
            value = heatmap_values[row_index, col_index]
            ax.text(col_index, row_index, f"{value:.3f}", ha="center", va="center", color="white" if value > 0.72 else "#222222")
    fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
    fig.savefig(FIG_DIR / "11_SVM分类报告热力图.png", dpi=300)
    plt.close(fig)

    label_counts = training_sample[LABEL_COLUMNS].sum().rename(index=LABEL_DISPLAY).reset_index()
    label_counts.columns = ["label", "positive_count"]
    fig, ax = plt.subplots(figsize=(8.6, 5.2), constrained_layout=True)
    bars = ax.bar(label_counts["label"], label_counts["positive_count"], color="#2f6f9f")
    ax.set_ylabel("正样本数量")
    ax.set_title("训练样本多标签正样本分布")
    ax.grid(False)
    ax.tick_params(axis="x", rotation=15)
    for bar, value in zip(bars, label_counts["positive_count"].tolist()):
        ax.text(bar.get_x() + bar.get_width() / 2, value + max(label_counts["positive_count"]) * 0.018, str(int(value)), ha="center", va="bottom", fontsize=9)
    fig.savefig(FIG_DIR / "13_训练样本多标签正样本分布图.png", dpi=300)
    plt.close(fig)

    svm_split_rows = size_df[size_df["model_name"].astype(str).str.contains("SVM", case=False, na=False)].copy()
    svm_split_rows["ratio_order"] = svm_split_rows["split_label"].map({label: index for index, label in enumerate(SPLIT_RATIO_EXPERIMENTS.keys())})
    svm_split_rows = svm_split_rows.sort_values("ratio_order")
    fig, ax = plt.subplots(figsize=(8.4, 5.2), constrained_layout=True)
    bars_train = ax.bar(svm_split_rows["split_label"], svm_split_rows["train_samples"], label="训练样本", color="#24527a")
    bars_test = ax.bar(svm_split_rows["split_label"], svm_split_rows["test_samples"], bottom=svm_split_rows["train_samples"], label="测试样本", color="#b7d4ea")
    ax.set_xlabel("训练集:测试集")
    ax.set_ylabel("样本数量")
    ax.set_title("不同比例实验样本规模")
    ax.grid(False)
    ax.legend(frameon=False)
    totals = (svm_split_rows["train_samples"] + svm_split_rows["test_samples"]).tolist()
    for bar, total in zip(bars_test, totals):
        ax.text(bar.get_x() + bar.get_width() / 2, total + max(totals) * 0.015, str(int(total)), ha="center", va="bottom", fontsize=9)
    fig.savefig(FIG_DIR / "14_训练测试比例样本规模图.png", dpi=300)
    plt.close(fig)

    if {"fit_time_sec", "predict_time_sec"}.issubset(metrics_df.columns):
        runtime_rows = metrics_df.sort_values("macro_f1", ascending=False).copy()
        runtime_rows["total_time_sec"] = runtime_rows["fit_time_sec"] + runtime_rows["predict_time_sec"]
        fig, ax = plt.subplots(figsize=(10.6, 5.4), constrained_layout=True)
        colors = ["#24527a" if "SVM" in str(name).upper() else "#b7d4ea" for name in runtime_rows["model_name"]]
        bars = ax.bar(runtime_rows["model_name"], runtime_rows["total_time_sec"], color=colors)
        ax.set_ylabel("训练与预测耗时/秒")
        ax.set_title("多模型训练与预测耗时对比")
        ax.grid(False)
        ax.tick_params(axis="x", rotation=20)
        for bar, value in zip(bars, runtime_rows["total_time_sec"].tolist()):
            ax.text(bar.get_x() + bar.get_width() / 2, value + max(runtime_rows["total_time_sec"]) * 0.018, f"{value:.2f}", ha="center", va="bottom", fontsize=9)
        fig.savefig(FIG_DIR / "15_多模型训练预测耗时对比图.png", dpi=300)
        plt.close(fig)

    sample_demand_id = str(test_df["demand_id"].iloc[0])
    top_sample = test_df[test_df["demand_id"] == sample_demand_id].copy()
    if not top_sample.empty:
        sample_scores = predict_label_scores(model, top_sample[FEATURE_COLUMNS].astype(float))
        top_sample["predicted_match"] = aggregate_label_scores(top_sample, sample_scores)
        top_sample = top_sample.sort_values("predicted_match", ascending=False).head(10)
        fig, ax = plt.subplots(figsize=(10.2, 5.2), constrained_layout=True)
        bars = ax.bar(top_sample["seat_id"], top_sample["predicted_match"], color="#24527a")
        ax.set_ylim(0.0, 1.02)
        ax.set_xlabel("座位编号")
        ax.set_ylabel("预测匹配度")
        ax.set_title(f"SVM 推荐样例 Top-10 匹配度（{sample_demand_id}）")
        ax.grid(False)
        ax.tick_params(axis="x", rotation=20)
        annotate_bars(ax, bars, top_sample["predicted_match"].tolist(), 0.012)
        fig.savefig(FIG_DIR / "16_SVM推荐样例Top10匹配度图.png", dpi=300)
        plt.close(fig)


def write_runtime_metadata(metrics_df: pd.DataFrame, topn_df: pd.DataFrame, size_df: pd.DataFrame, demands: pd.DataFrame, seat_profiles: pd.DataFrame) -> None:
    svm_row = metrics_df[metrics_df["model_name"] == "支持向量机 SVM"].iloc[0].to_dict()
    best_row = metrics_df.iloc[0].to_dict()
    svm_thresholds = json.loads(str(svm_row.get("label_thresholds") or "[]"))
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "experimentRoot": str(EXPERIMENT_ROOT),
        "dataset": {
            "name": "需求-座位多标签匹配推荐数据集",
            "sampleUnit": "一次用户需求与一个候选座位构成一条匹配样本，一个样本可同时命中多个推荐标签",
            "demandCount": int(len(demands)),
            "seatCount": int(len(seat_profiles)),
            "featureCount": int(len(FEATURE_COLUMNS)),
            "labelCount": int(len(LABEL_COLUMNS)),
            "featureColumns": FEATURE_COLUMNS,
            "labelColumns": LABEL_COLUMNS,
            "labelDisplay": LABEL_DISPLAY,
        },
        "experiment": {
            "taskType": "需求-座位多标签匹配分类",
            "splitStrategy": "按需求编号分组划分训练集与测试集，主实验采用训练集:测试集=8:2，并补充 8:2、7:3、6:4 三档比例实验",
            "bestModel": {
                "name": str(best_row["model_name"]),
                "macroF1": round(float(best_row["macro_f1"]), 6),
                "microF1": round(float(best_row["micro_f1"]), 6),
                "precision": round(float(best_row["macro_precision"]), 6),
                "recall": round(float(best_row["macro_recall"]), 6),
                "rocAuc": round(float(best_row["roc_auc_micro"]), 6),
                "prAuc": round(float(best_row["pr_auc_micro"]), 6),
            },
            "deploymentModel": {
                "name": "支持向量机 SVM",
                "shortName": "SVM",
                "f1": round(float(svm_row["macro_f1"]), 6),
                "macroF1": round(float(svm_row["macro_f1"]), 6),
                "microF1": round(float(svm_row["micro_f1"]), 6),
                "precision": round(float(svm_row["macro_precision"]), 6),
                "recall": round(float(svm_row["macro_recall"]), 6),
                "rocAuc": round(float(svm_row["roc_auc_micro"]), 6),
                "prAuc": round(float(svm_row["pr_auc_micro"]), 6),
                "labelThresholds": svm_thresholds,
            },
            "deploymentReason": "在线推荐阶段需要对同一条自然语言需求与全部可预约候选座位进行批量多标签匹配预测，SVM 在结构化匹配特征上表现稳定、推理开销小，并已接入 /api/assistant/seat 实时排序链路。",
            "metricRows": metrics_df.to_dict("records"),
            "splitRatioRows": size_df.to_dict("records"),
            "topNMean": topn_df.groupby("top_k")["precision_at_k"].mean().round(6).to_dict(),
        },
    }
    RUNTIME_META_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "runtime_metadata.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (MODEL_DIR / "feature_columns.json").write_text(json.dumps(FEATURE_COLUMNS, ensure_ascii=False, indent=2), encoding="utf-8")


def write_summary(metrics_df: pd.DataFrame, topn_df: pd.DataFrame, size_df: pd.DataFrame, full_dataset: pd.DataFrame, training_sample: pd.DataFrame) -> None:
    topn_mean = topn_df.groupby("top_k")["precision_at_k"].mean()
    lines = [
        "需求-座位匹配推荐实验说明",
        "======================",
        "",
        "1. 样本定义",
        "本实验将推荐问题转化为需求-座位多标签匹配问题。每条样本由一条用户需求画像和一个候选座位画像拼接而成，同一样本可同时命中深度专注匹配、舒适久学匹配、设备作业匹配和开放协作匹配等标签。",
        "标签由座位地图位置、桌组/分区统计、偏好命中、冲突项和少量边界扰动共同生成，避免形成完全线性的硬规则标签。",
        "",
        "2. 数据规模",
        f"- 全量需求-座位组合样本数：{len(full_dataset)}",
        f"- 训练用均衡样本数：{len(training_sample)}",
        f"- 特征数量：{len(FEATURE_COLUMNS)}",
        f"- 标签数量：{len(LABEL_COLUMNS)}",
        "",
        "3. 模型对比结果",
    ]
    for _, row in metrics_df.iterrows():
        lines.append(
            f"- {row['model_name']}: Macro-F1={row['macro_f1']:.4f}, Micro-F1={row['micro_f1']:.4f}, "
            f"Macro-Precision={row['macro_precision']:.4f}, Macro-Recall={row['macro_recall']:.4f}"
        )
    lines.append("")
    lines.append("4. 训练集与测试集比例实验")
    svm_size_rows = size_df[size_df["model_name"] == "支持向量机 SVM"].copy()
    svm_size_rows["ratio_order"] = svm_size_rows["split_label"].map({label: index for index, label in enumerate(SPLIT_RATIO_EXPERIMENTS.keys())})
    svm_size_rows = svm_size_rows.sort_values("ratio_order")
    for _, row in svm_size_rows.iterrows():
        lines.append(
            f"- 训练集:测试集={row['split_label']}（测试集:训练集={row['test_train_ratio']}）: "
            f"SVM Macro-F1={row['macro_f1']:.4f}, Micro-F1={row['micro_f1']:.4f}, "
            f"训练需求数={int(row['train_demand_count'])}, 测试需求数={int(row['test_demand_count'])}"
        )
    lines.extend(
        [
            "",
            "5. SVM Top-N 推荐验证",
            *[f"- Precision@{int(k)}={value:.4f}" for k, value in topn_mean.items()],
            "",
            "6. 论文表述建议",
            "本文不再把座位编号作为分类类别，而是将一次用户需求与每个可预约座位组成匹配样本。SVM 输出四类匹配标签的概率，系统再根据当前需求侧权重聚合为综合匹配度，并按匹配度和预约规则输出 Top-N 推荐结果。",
        ]
    )
    (OUTPUT_DIR / "实验说明与论文口径.txt").write_text("\n".join(lines), encoding="utf-8")
    metrics_df.to_csv(OUTPUT_DIR / "model_metrics.csv", index=False, encoding="utf-8-sig")
    topn_df.to_csv(OUTPUT_DIR / "topn_metrics.csv", index=False, encoding="utf-8-sig")
    size_df.to_csv(OUTPUT_DIR / "split_ratio_metrics.csv", index=False, encoding="utf-8-sig")


def write_single_algorithm_runners() -> None:
    model_names = list(model_specs().keys())
    safe_names = {
        "逻辑回归": "01_逻辑回归",
        "支持向量机 SVM": "02_支持向量机SVM",
        "神经网络 MLP": "03_神经网络MLP",
        "随机森林": "04_随机森林",
        "决策树": "05_决策树",
        "K近邻 KNN(k=11)": "06_K近邻KNN",
        "高斯朴素贝叶斯": "07_高斯朴素贝叶斯",
    }
    for model_name in model_names:
        folder = SINGLE_ALGORITHM_DIR / safe_names[model_name]
        folder.mkdir(parents=True, exist_ok=True)
        script = f'''#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
import pandas as pd
from scipy.io import loadmat
from sklearn.metrics import accuracy_score, f1_score, hamming_loss, precision_score, recall_score

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from scripts.build_matching_recommendation_pipeline import (  # noqa: E402
    FEATURE_COLUMNS,
    LABEL_COLUMNS,
    apply_label_thresholds,
    format_workbook,
    model_specs,
    optimize_label_thresholds,
    predict_label_scores,
    split_sample_by_demand_ratio,
    wrap_model_for_multilabel,
)

MODEL_NAME = {model_name!r}
TRAIN_RATIO = 0.8
DATASET_DIR = REPO_ROOT / "docs" / "需求座位匹配推荐实验_20260514" / "数据集"
MAT_PATH = DATASET_DIR / "output.mat"
META_PATH = DATASET_DIR / "training_samples.xlsx"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    mat = loadmat(MAT_PATH)
    feature_frame = pd.DataFrame(mat["X"], columns=FEATURE_COLUMNS)
    label_frame = pd.DataFrame(mat["Y"], columns=LABEL_COLUMNS)
    meta_frame = pd.read_excel(META_PATH, usecols=["demand_id"])
    dataset = pd.concat([meta_frame, feature_frame, label_frame], axis=1)
    train_df, test_df, train_demands, test_demands = split_sample_by_demand_ratio(dataset, TRAIN_RATIO, 80)

    x_train = train_df[FEATURE_COLUMNS].astype(float)
    y_train = train_df[LABEL_COLUMNS].astype(int)
    x_test = test_df[FEATURE_COLUMNS].astype(float)
    y_test = test_df[LABEL_COLUMNS].astype(int).to_numpy()

    raw_model = model_specs()[MODEL_NAME]
    model = wrap_model_for_multilabel(MODEL_NAME, raw_model)
    started = time.perf_counter()
    model.fit(x_train, y_train)
    fit_time = time.perf_counter() - started

    predict_started = time.perf_counter()
    train_scores = predict_label_scores(model, x_train)
    thresholds = optimize_label_thresholds(y_train.to_numpy(), train_scores)
    scores = predict_label_scores(model, x_test)
    predictions = apply_label_thresholds(scores, thresholds)
    predict_time = time.perf_counter() - predict_started

    metrics = {{
        "model_name": MODEL_NAME,
        "train_test_ratio": "8:2",
        "test_train_ratio": "2:8",
        "train_samples": int(len(train_df)),
        "test_samples": int(len(test_df)),
        "train_demand_count": int(len(train_demands)),
        "test_demand_count": int(len(test_demands)),
        "subset_accuracy": float(accuracy_score(y_test, predictions)),
        "hamming_accuracy": float(1 - hamming_loss(y_test, predictions)),
        "macro_precision": float(precision_score(y_test, predictions, average="macro", zero_division=0)),
        "macro_recall": float(recall_score(y_test, predictions, average="macro", zero_division=0)),
        "macro_f1": float(f1_score(y_test, predictions, average="macro", zero_division=0)),
        "micro_f1": float(f1_score(y_test, predictions, average="micro", zero_division=0)),
        "fit_time_sec": float(fit_time),
        "predict_time_sec": float(predict_time),
        "thresholds": [float(item) for item in thresholds],
    }}

    pd.DataFrame([metrics]).to_csv(OUTPUT_DIR / "metrics.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame({{
        "sample_index": range(len(test_df)),
        **{{f"true_{{label}}": y_test[:, index] for index, label in enumerate(LABEL_COLUMNS)}},
        **{{f"pred_{{label}}": predictions[:, index] for index, label in enumerate(LABEL_COLUMNS)}},
    }}).to_csv(OUTPUT_DIR / "predictions.csv", index=False, encoding="utf-8-sig")
    with open(OUTPUT_DIR / "final_metrics.json", "w", encoding="utf-8") as file:
        json.dump(metrics, file, ensure_ascii=False, indent=2)
    joblib.dump(model, OUTPUT_DIR / "model.joblib")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
'''
        (folder / "run.py").write_text(script, encoding="utf-8")

    run_all = [
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "$OutputEncoding = [System.Text.Encoding]::UTF8",
        "$env:PYTHONIOENCODING = 'utf-8'",
        "$Root = Split-Path -Parent $MyInvocation.MyCommand.Path",
        "Get-ChildItem -Path $Root -Directory | Sort-Object Name | ForEach-Object {",
        "  $Script = Join-Path $_.FullName 'run.py'",
        "  if (Test-Path $Script) {",
        "    Write-Host \"Running $($_.Name)\"",
        "    python $Script",
        "  }",
        "}",
        "",
    ]
    (SINGLE_ALGORITHM_DIR / "run_all_algorithms.ps1").write_text("\n".join(run_all), encoding="utf-8")
    readme = [
        "# 单算法运行说明",
        "",
        "本目录用于演示同一个 `features.xlsx` / `labels.xlsx` / `output.mat` 数据集上的单算法训练过程。",
        "",
        "每个子目录对应一种算法，进入子目录后执行：",
        "",
        "```powershell",
        "python run.py",
        "```",
        "",
        "也可以在本目录执行：",
        "",
        "```powershell",
        ".\\run_all_algorithms.ps1",
        "```",
        "",
        "每个 `run.py` 会实际读取 `数据集/output.mat` 中的 `X` 和 `Y` 矩阵；同时读取 `training_samples.xlsx` 中的 `demand_id` 作为分组字段，避免同一条需求同时进入训练集和测试集。",
        "",
        "默认采用训练集:测试集=8:2（对应测试集:训练集=2:8），运行后会在各算法目录的 `output` 文件夹生成 `metrics.csv`、`final_metrics.json`、`predictions.csv` 和 `model.joblib`。",
        "",
    ]
    (SINGLE_ALGORITHM_DIR / "运行说明.md").write_text("\n".join(readme), encoding="utf-8")


def write_process_diagram() -> None:
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="920" viewBox="0 0 1800 920">
  <defs>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M2,2 L10,6 L2,10 Z" fill="#2b4d66"/>
    </marker>
    <style>
      .title{font:700 34px 'Microsoft YaHei',Arial;fill:#1f3342}
      .box{fill:#eaf3f8;stroke:#5d86a3;stroke-width:2;rx:10}
      .box2{fill:#fff6df;stroke:#c49336;stroke-width:2;rx:10}
      .box3{fill:#edf7ed;stroke:#6aa36f;stroke-width:2;rx:10}
      .text{font:600 22px 'Microsoft YaHei',Arial;fill:#1f3342}
      .note{font:18px 'Microsoft YaHei',Arial;fill:#405766}
      .line{stroke:#2b4d66;stroke-width:3;fill:none;marker-end:url(#arrow)}
    </style>
  </defs>
  <text x="900" y="62" text-anchor="middle" class="title">需求-座位匹配推荐流程结构图</text>
  <rect x="90" y="145" width="260" height="110" class="box"/>
  <text x="220" y="190" text-anchor="middle" class="text">用户自然语言需求</text>
  <text x="220" y="225" text-anchor="middle" class="note">安静/靠窗/插座/时段</text>
  <rect x="450" y="145" width="260" height="110" class="box"/>
  <text x="580" y="190" text-anchor="middle" class="text">关键词解析</text>
  <text x="580" y="225" text-anchor="middle" class="note">生成需求向量 Need(u)</text>
  <rect x="810" y="145" width="280" height="110" class="box2"/>
  <text x="950" y="190" text-anchor="middle" class="text">候选座位生成</text>
  <text x="950" y="225" text-anchor="middle" class="note">时间窗/状态/分区硬过滤</text>
  <rect x="1190" y="145" width="300" height="110" class="box3"/>
  <text x="1340" y="190" text-anchor="middle" class="text">批量构造匹配样本</text>
  <text x="1340" y="225" text-anchor="middle" class="note">Need(u)+Feature(s)+Cross</text>
  <rect x="1190" y="380" width="300" height="120" class="box3"/>
  <text x="1340" y="425" text-anchor="middle" class="text">SVM 多标签匹配分类</text>
  <text x="1340" y="460" text-anchor="middle" class="note">输出四类匹配标签概率</text>
  <rect x="810" y="380" width="280" height="120" class="box2"/>
  <text x="950" y="425" text-anchor="middle" class="text">Top-N 排序</text>
  <text x="950" y="460" text-anchor="middle" class="note">概率 + 偏好命中 + 规则</text>
  <rect x="450" y="380" width="260" height="120" class="box"/>
  <text x="580" y="425" text-anchor="middle" class="text">推荐结果解释</text>
  <text x="580" y="460" text-anchor="middle" class="note">匹配度/命中项/冲突项</text>
  <rect x="90" y="380" width="260" height="120" class="box"/>
  <text x="220" y="425" text-anchor="middle" class="text">承接预约流程</text>
  <text x="220" y="460" text-anchor="middle" class="note">选择座位并进入预校验</text>
  <path d="M350 200 L450 200" class="line"/>
  <path d="M710 200 L810 200" class="line"/>
  <path d="M1090 200 L1190 200" class="line"/>
  <path d="M1340 255 L1340 380" class="line"/>
  <path d="M1190 440 L1090 440" class="line"/>
  <path d="M810 440 L710 440" class="line"/>
  <path d="M450 440 L350 440" class="line"/>
  <rect x="420" y="640" width="960" height="120" fill="#f7f9fb" stroke="#a7b6c2" stroke-width="2" rx="12"/>
  <text x="900" y="688" text-anchor="middle" class="text">离线训练：features + labels → output.mat → 七种多标签算法对比 → 部署 SVM</text>
  <text x="900" y="728" text-anchor="middle" class="note">线上推荐只发起一次 AI 请求，后端对全部可预约候选座位进行一次批量预测</text>
</svg>
"""
    svg_path = DESKTOP_DIR / "需求座位匹配推荐流程结构图.svg"
    svg_path.write_text(svg, encoding="utf-8")
    (FIG_DIR / "12_需求座位匹配推荐流程结构图.svg").write_text(svg, encoding="utf-8")

    drawio_xml = """<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="drawio" version="26.0.0">
  <diagram name="需求-座位匹配推荐流程">
    <mxGraphModel dx="1800" dy="920" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1800" pageHeight="920" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="用户自然语言需求&#xa;安静/靠窗/插座/时段" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#eaf3f8;strokeColor=#5d86a3;" vertex="1" parent="1"><mxGeometry x="90" y="145" width="260" height="110" as="geometry"/></mxCell>
        <mxCell id="3" value="关键词解析&#xa;生成需求向量 Need(u)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#eaf3f8;strokeColor=#5d86a3;" vertex="1" parent="1"><mxGeometry x="450" y="145" width="260" height="110" as="geometry"/></mxCell>
        <mxCell id="4" value="候选座位生成&#xa;时间窗/状态/分区硬过滤" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff6df;strokeColor=#c49336;" vertex="1" parent="1"><mxGeometry x="810" y="145" width="280" height="110" as="geometry"/></mxCell>
        <mxCell id="5" value="批量构造匹配样本&#xa;Need(u)+Feature(s)+Cross" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#edf7ed;strokeColor=#6aa36f;" vertex="1" parent="1"><mxGeometry x="1190" y="145" width="300" height="110" as="geometry"/></mxCell>
        <mxCell id="6" value="SVM 多标签匹配分类&#xa;输出四类匹配标签概率" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#edf7ed;strokeColor=#6aa36f;" vertex="1" parent="1"><mxGeometry x="1190" y="380" width="300" height="120" as="geometry"/></mxCell>
        <mxCell id="7" value="Top-N 排序&#xa;概率 + 偏好命中 + 规则" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff6df;strokeColor=#c49336;" vertex="1" parent="1"><mxGeometry x="810" y="380" width="280" height="120" as="geometry"/></mxCell>
        <mxCell id="8" value="推荐结果解释&#xa;匹配度/命中项/冲突项" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#eaf3f8;strokeColor=#5d86a3;" vertex="1" parent="1"><mxGeometry x="450" y="380" width="260" height="120" as="geometry"/></mxCell>
        <mxCell id="9" value="承接预约流程&#xa;选择座位并进入预校验" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#eaf3f8;strokeColor=#5d86a3;" vertex="1" parent="1"><mxGeometry x="90" y="380" width="260" height="120" as="geometry"/></mxCell>
        <mxCell id="10" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="11" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="3" target="4"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="12" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="4" target="5"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="13" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="5" target="6"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="14" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="6" target="7"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="15" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="7" target="8"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="16" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="8" target="9"><mxGeometry relative="1" as="geometry"/></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""
    (DESKTOP_DIR / "需求座位匹配推荐流程结构图.drawio").write_text(drawio_xml, encoding="utf-8")

    try:
        import cairosvg  # type: ignore

        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(DESKTOP_DIR / "需求座位匹配推荐流程结构图.png"), output_width=1800, output_height=920)
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(FIG_DIR / "12_需求座位匹配推荐流程结构图.png"), output_width=1800, output_height=920)
    except Exception:
        shutil.copyfile(svg_path, FIG_DIR / "12_需求座位匹配推荐流程结构图.svg")


def main() -> None:
    ensure_dirs()
    seats = read_seats()
    demands = build_demands()
    seat_profiles = build_seat_profiles(seats)
    full_dataset = build_matching_dataset(demands, seat_profiles)
    training_sample = build_training_sample(full_dataset)

    write_excel_outputs(demands, seat_profiles, full_dataset, training_sample)
    metrics_df, topn_df, deployment_model = evaluate_models(training_sample, full_dataset)
    size_df = evaluate_split_ratio_experiments(training_sample)
    write_figures(metrics_df, topn_df, size_df, deployment_model, training_sample)
    write_runtime_metadata(metrics_df, topn_df, size_df, demands, seat_profiles)
    write_summary(metrics_df, topn_df, size_df, full_dataset, training_sample)
    write_process_diagram()
    write_single_algorithm_runners()

    print(f"Experiment root: {EXPERIMENT_ROOT}")
    print(f"Demands: {len(demands)} | Seats: {len(seat_profiles)} | Full pairs: {len(full_dataset)} | Training samples: {len(training_sample)}")
    print(metrics_df[["model_name", "macro_precision", "macro_recall", "macro_f1", "micro_f1", "subset_accuracy"]].to_string(index=False))
    print(f"Desktop diagram: {DESKTOP_DIR / '需求座位匹配推荐流程结构图.svg'}")


if __name__ == "__main__":
    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)
    main()
