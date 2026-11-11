#!/usr/bin/env python3
"""Do the recommendation reasons describe what the SVM actually uses?

The Mini Program shows a reason next to each recommended seat, for example
"matches: power outlet, quiet". The reason is built from the preference-match
features (match_power_outlet, match_quiet, ...). It was never checked whether these
are the features that the model relies on. This script checks it.

The deployed model is a linear SVM per label (StandardScaler + LinearSVC). For a
linear model the contribution of every feature to a score is known exactly:

    contribution_j = w_j * (x_j - mean_j) / scale_j

so no approximation (SHAP, LIME, ...) is needed.

Three measurements on the held-out test requirements:

1. Global: permutation importance per feature group (drop of Macro-F1).
2. Local:  for the top-5 recommended seats of every test requirement, how much of
           the positive contribution comes from the features named in the reason.
3. Deletion test: remove the features named in the reason and see how much the
           score falls, compared with removing the same number of top-contributing
           features and of random features.

It also retrains the model without the four rule-score features (score_*_match),
because the training labels are derived from exactly these scores.

Run from the repository root (takes a few minutes):

    python scripts/explanation_faithfulness.py

The numbers are written to docs/explanation_faithfulness.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import f1_score

from build_matching_recommendation_pipeline import (
    FEATURE_COLUMNS,
    LABEL_COLUMNS,
    RANDOM_SEED,
    aggregate_label_scores,
    apply_label_thresholds,
    build_demands,
    build_matching_dataset,
    build_seat_profiles,
    build_training_sample,
    demand_label_weights,
    model_specs,
    optimize_label_thresholds,
    predict_label_scores,
    read_seats,
    split_sample_by_demand_ratio,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "docs" / "explanation_faithfulness.json"
SVM_NAME = "支持向量机 SVM"
TOP_K = 5

# The reason text can only mention these features (see build_reason in
# realtime_svm_predict.py): a need is "hit" if need > 0.15 and match > 0.2.
NEED_TO_MATCH = {
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
}

FEATURE_GROUPS = {
    "requirement (need_*, scene_*, time)": [c for c in FEATURE_COLUMNS if c.startswith(("need_", "scene_", "time_", "duration_", "explicit_"))],
    "seat properties (seat_*)": [c for c in FEATURE_COLUMNS if c.startswith("seat_")],
    "zone and table-group statistics": [c for c in FEATURE_COLUMNS if c.startswith(("zone_", "group_"))],
    "preference matches (match_*), named in the reason": [c for c in FEATURE_COLUMNS if c.startswith("match_")],
    "conflicts and synergies": [c for c in FEATURE_COLUMNS if c.startswith("conflict_") or c.endswith(("_synergy", "_comfort"))],
    "rule scores (score_*_match)": [c for c in FEATURE_COLUMNS if c.startswith("score_")],
}


def fit_svm(train_df: pd.DataFrame, columns: list[str]):
    model = clone(model_specs()[SVM_NAME])
    model.fit(train_df[columns].astype(float), train_df[LABEL_COLUMNS].astype(int))
    scores = predict_label_scores(model, train_df[columns].astype(float))
    thresholds = optimize_label_thresholds(train_df[LABEL_COLUMNS].to_numpy(dtype=int), scores)
    return model, thresholds


def macro_f1(model, thresholds, frame: pd.DataFrame, columns: list[str]) -> float:
    scores = predict_label_scores(model, frame[columns].astype(float))
    predictions = apply_label_thresholds(scores, thresholds)
    return float(f1_score(frame[LABEL_COLUMNS].to_numpy(dtype=int), predictions, average="macro", zero_division=0))


def linear_parts(model, columns: list[str]):
    """Weights of the per-label linear models in standardised feature space."""
    means, scales, weights, intercepts = [], [], [], []
    for estimator in model.estimators_:
        scaler = estimator.named_steps["scaler"]
        svm = estimator.named_steps["model"]
        means.append(scaler.mean_)
        scales.append(scaler.scale_)
        weights.append(svm.coef_.ravel())
        intercepts.append(float(svm.intercept_[0]))
    return np.array(means), np.array(scales), np.array(weights), np.array(intercepts)


def main() -> None:
    rng = np.random.default_rng(RANDOM_SEED)
    demands = build_demands()
    seat_profiles = build_seat_profiles(read_seats())
    full_dataset = build_matching_dataset(demands, seat_profiles)
    sample = build_training_sample(full_dataset)
    train_df, test_df, _, test_demands = split_sample_by_demand_ratio(sample, 0.8, 80)

    model, thresholds = fit_svm(train_df, FEATURE_COLUMNS)
    baseline = macro_f1(model, thresholds, test_df, FEATURE_COLUMNS)
    result: dict = {
        "train_samples": int(len(train_df)),
        "test_samples": int(len(test_df)),
        "test_requirements": len(test_demands),
        "macro_f1": round(baseline, 4),
    }

    # ---- 1. Global: permutation importance per feature group ----
    group_importance = {}
    for group_name, columns in FEATURE_GROUPS.items():
        drops = []
        for _ in range(5):
            permuted = test_df.copy()
            order = rng.permutation(len(permuted))
            permuted[columns] = permuted[columns].to_numpy()[order]
            drops.append(baseline - macro_f1(model, thresholds, permuted, FEATURE_COLUMNS))
        group_importance[group_name] = {"features": len(columns), "macro_f1_drop": round(float(np.mean(drops)), 4)}
    result["permutation_importance_by_group"] = group_importance

    # ---- Retrain without the rule scores ----
    without_scores = [c for c in FEATURE_COLUMNS if not c.startswith("score_")]
    model_ns, thresholds_ns = fit_svm(train_df, without_scores)
    result["macro_f1_without_rule_scores"] = round(macro_f1(model_ns, thresholds_ns, test_df, without_scores), 4)

    # ---- 2 and 3. Local: top-K seats of every test requirement ----
    def local_analysis(fitted_model, columns: list[str]) -> dict:
        means, scales, weights, _ = linear_parts(fitted_model, columns)
        column_index = {name: position for position, name in enumerate(columns)}
        cited_share, top1_cited, top3_overlap, cited_counts = [], [], [], []
        drop_cited, drop_top, drop_random = [], [], []
        top_feature_counter: dict[str, int] = {}

        for demand_id in test_demands:
            group = full_dataset[full_dataset["demand_id"] == demand_id]
            X = group[columns].astype(float)
            label_scores = predict_label_scores(fitted_model, X)
            aggregated = aggregate_label_scores(group, label_scores)
            top_positions = np.argsort(-aggregated)[:TOP_K]
            label_weights = demand_label_weights(group.iloc[0])

            for position in top_positions:
                row = group.iloc[position]
                x = X.iloc[position].to_numpy(dtype=float)
                # Contribution of every feature to the weighted sum of the label scores.
                per_label = weights * (x - means) / scales
                contribution = label_weights @ per_label

                cited = [
                    column_index[match]
                    for need, match in NEED_TO_MATCH.items()
                    if float(row[need]) > 0.15 and float(row[match]) > 0.2
                ]
                if not cited:
                    continue
                cited_counts.append(len(cited))

                positive = np.clip(contribution, 0, None)
                cited_share.append(float(positive[cited].sum() / positive.sum()) if positive.sum() > 0 else 0.0)
                ranking = np.argsort(-contribution)
                top1_cited.append(int(ranking[0] in cited))
                top3_overlap.append(len(set(ranking[:3]) & set(cited)) / 3)
                name = columns[int(ranking[0])]
                top_feature_counter[name] = top_feature_counter.get(name, 0) + 1

                # Deletion test: set features to the training mean (contribution 0) and
                # measure how much the shown score falls.
                def score_without(removed: list[int]) -> float:
                    changed = x.copy()
                    changed[removed] = means[0][removed]
                    frame = pd.DataFrame([changed], columns=columns)
                    return float(label_weights @ predict_label_scores(fitted_model, frame)[0])

                original = float(aggregated[position])
                k = len(cited)
                drop_cited.append(original - score_without(cited))
                drop_top.append(original - score_without([int(i) for i in ranking[:k]]))
                drop_random.append(original - score_without([int(i) for i in rng.choice(len(columns), size=k, replace=False)]))

        return {
            "seats_analysed": len(cited_share),
            "features_named_per_reason_mean": round(float(np.mean(cited_counts)), 2),
            "share_of_positive_contribution_from_named_features": round(float(np.mean(cited_share)), 4),
            "top_contributor_is_a_named_feature": round(float(np.mean(top1_cited)), 4),
            "top3_contributors_overlap_with_named_features": round(float(np.mean(top3_overlap)), 4),
            "most_frequent_top_contributors": dict(sorted(top_feature_counter.items(), key=lambda item: -item[1])[:5]),
            "score_drop_when_removing": {
                "named_features": round(float(np.mean(drop_cited)), 4),
                "same_number_of_top_contributors": round(float(np.mean(drop_top)), 4),
                "same_number_of_random_features": round(float(np.mean(drop_random)), 4),
            },
        }

    result["deployed_model"] = local_analysis(model, FEATURE_COLUMNS)
    result["model_without_rule_scores"] = local_analysis(model_ns, without_scores)

    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
