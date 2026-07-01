"""
Evaluate calibration metrics and factor-level judge agreement.

This script compares:
- v0/v1 prediction separation metrics
- train/holdout behavior
- best threshold vs fixed threshold 50
- VLM factor judgments vs manual factor_mining labels

Run:
    python scripts/evaluate_calibration.py
    python scripts/evaluate_calibration.py --format table
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


FACTOR_COLUMNS = [
    "product_prominence",
    "use_case_context",
    "benefit_clarity",
    "visual_hierarchy",
    "material_and_detail",
    "brand_trust_signal",
    "contrast_and_legibility",
    "marketplace_listing_signal",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate calibration rigor.")
    parser.add_argument("--v0-predictions", type=Path, default=Path("outputs/predictions.csv"))
    parser.add_argument("--v1-predictions", type=Path, default=Path("outputs/predictions_v1.csv"))
    parser.add_argument("--factor-mining", type=Path, default=Path("data/factor_mining.csv"))
    parser.add_argument("--v0-fixtures", type=Path, default=Path("fixtures/judgments"))
    parser.add_argument("--v1-fixtures", type=Path, default=Path("fixtures/judgments_v1"))
    parser.add_argument("--format", choices=["json", "table"], default="json")
    args = parser.parse_args()

    payload = {
        "v0": {
            "metrics": prediction_metrics(read_csv(args.v0_predictions)),
            "judge_agreement": factor_agreement(args.factor_mining, args.v0_fixtures),
        },
        "v1": {
            "metrics": prediction_metrics(read_csv(args.v1_predictions)),
            "judge_agreement": factor_agreement(args.factor_mining, args.v1_fixtures),
        },
    }
    if args.format == "json":
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print_table_report(payload)


def read_csv(path: Path) -> list[dict[str, str]]:
    return list(csv.DictReader(path.open("r", encoding="utf-8-sig")))


def prediction_metrics(rows: list[dict[str, str]]) -> dict[str, dict]:
    train_rows = [row for row in rows if row.get("split") == "train"]
    holdout_rows = [row for row in rows if row.get("split") == "holdout"]
    return {
        "all": metrics_for_rows(rows),
        "train": metrics_for_rows(train_rows),
        "holdout": metrics_for_rows(holdout_rows),
        "_protocol": train_holdout_protocol(train_rows, holdout_rows),
    }


def metrics_for_rows(rows: list[dict[str, str]]) -> dict[str, float | int | None]:
    scored = [
        (row["label"], float(row["score"]))
        for row in rows
        if row.get("label") in {"strong", "weak"}
    ]
    strong = [score for label, score in scored if label == "strong"]
    weak = [score for label, score in scored if label == "weak"]
    if not scored or not strong or not weak:
        return empty_metrics(len(scored))

    best_threshold, best_accuracy = best_threshold_accuracy(scored)
    return {
        "n": len(scored),
        "strong_mean": round(sum(strong) / len(strong), 2),
        "weak_mean": round(sum(weak) / len(weak), 2),
        "mean_gap": round(sum(strong) / len(strong) - sum(weak) / len(weak), 2),
        "pairwise_separation": round(pairwise_separation(strong, weak), 3),
        "accuracy_at_50": round(threshold_accuracy(scored, 50), 3),
        "best_threshold": best_threshold,
        "best_threshold_accuracy": round(best_accuracy, 3),
    }


def train_holdout_protocol(
    train_rows: list[dict[str, str]],
    holdout_rows: list[dict[str, str]],
) -> dict[str, float | int | None]:
    train_scored = labeled_scores(train_rows)
    holdout_scored = labeled_scores(holdout_rows)
    if not train_scored or not holdout_scored:
        return {
            "train_selected_threshold": None,
            "train_accuracy_at_selected_threshold": None,
            "train_f1_at_selected_threshold": None,
            "holdout_accuracy_at_train_threshold": None,
            "holdout_precision_at_train_threshold": None,
            "holdout_recall_at_train_threshold": None,
            "holdout_f1_at_train_threshold": None,
            "holdout_false_positives": None,
            "holdout_false_negatives": None,
        }

    threshold, train_accuracy = best_threshold_accuracy(train_scored)
    train_classification = classification_metrics(train_scored, threshold)
    holdout_classification = classification_metrics(holdout_scored, threshold)
    return {
        "train_selected_threshold": threshold,
        "train_accuracy_at_selected_threshold": round(train_accuracy, 3),
        "train_f1_at_selected_threshold": train_classification["f1"],
        "holdout_accuracy_at_train_threshold": holdout_classification["accuracy"],
        "holdout_precision_at_train_threshold": holdout_classification["precision"],
        "holdout_recall_at_train_threshold": holdout_classification["recall"],
        "holdout_f1_at_train_threshold": holdout_classification["f1"],
        "holdout_false_positives": holdout_classification["false_positives"],
        "holdout_false_negatives": holdout_classification["false_negatives"],
    }


def labeled_scores(rows: list[dict[str, str]]) -> list[tuple[str, float]]:
    return [
        (row["label"], float(row["score"]))
        for row in rows
        if row.get("label") in {"strong", "weak"}
    ]


def empty_metrics(n: int) -> dict[str, float | int | None]:
    return {
        "n": n,
        "strong_mean": None,
        "weak_mean": None,
        "mean_gap": None,
        "pairwise_separation": None,
        "accuracy_at_50": None,
        "best_threshold": None,
        "best_threshold_accuracy": None,
    }


def threshold_accuracy(scored: list[tuple[str, float]], threshold: float) -> float:
    correct = sum(
        (label == "strong" and score >= threshold)
        or (label == "weak" and score < threshold)
        for label, score in scored
    )
    return correct / len(scored)


def classification_metrics(scored: list[tuple[str, float]], threshold: float) -> dict:
    true_positives = sum(
        label == "strong" and score >= threshold for label, score in scored
    )
    true_negatives = sum(label == "weak" and score < threshold for label, score in scored)
    false_positives = sum(label == "weak" and score >= threshold for label, score in scored)
    false_negatives = sum(label == "strong" and score < threshold for label, score in scored)

    precision = safe_divide(true_positives, true_positives + false_positives)
    recall = safe_divide(true_positives, true_positives + false_negatives)
    f1 = (
        safe_divide(2 * precision * recall, precision + recall)
        if precision is not None and recall is not None
        else None
    )
    return {
        "accuracy": round((true_positives + true_negatives) / len(scored), 3),
        "precision": round(precision, 3) if precision is not None else None,
        "recall": round(recall, 3) if recall is not None else None,
        "f1": round(f1, 3) if f1 is not None else None,
        "true_positives": true_positives,
        "true_negatives": true_negatives,
        "false_positives": false_positives,
        "false_negatives": false_negatives,
    }


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def best_threshold_accuracy(scored: list[tuple[str, float]]) -> tuple[int, float]:
    best_threshold = 50
    best_accuracy = -1.0
    for threshold in range(101):
        accuracy = threshold_accuracy(scored, threshold)
        if accuracy > best_accuracy:
            best_threshold = threshold
            best_accuracy = accuracy
    return best_threshold, best_accuracy


def pairwise_separation(strong: list[float], weak: list[float]) -> float:
    wins = 0.0
    total = 0
    for strong_score in strong:
        for weak_score in weak:
            total += 1
            if strong_score > weak_score:
                wins += 1
            elif strong_score == weak_score:
                wins += 0.5
    return wins / total


def factor_agreement(factor_mining_path: Path, fixtures_dir: Path) -> dict:
    rows = read_csv(factor_mining_path)
    totals = {factor: 0 for factor in FACTOR_COLUMNS}
    matches = {factor: 0 for factor in FACTOR_COLUMNS}

    for row in rows:
        image_id = row["image_id"]
        fixture_path = fixtures_dir / f"{image_id}.json"
        judgment = json.loads(fixture_path.read_text(encoding="utf-8"))
        judged_levels = {factor["key"]: factor["level"] for factor in judgment["factors"]}
        for factor in FACTOR_COLUMNS:
            if factor not in judged_levels:
                continue
            totals[factor] += 1
            if row[factor] == judged_levels[factor]:
                matches[factor] += 1

    by_factor = {}
    for factor in FACTOR_COLUMNS:
        total = totals[factor]
        by_factor[factor] = {
            "matches": matches[factor],
            "total": total,
            "agreement": round(matches[factor] / total, 3) if total else None,
        }

    total_matches = sum(matches.values())
    total = sum(totals.values())
    return {
        "manual_gold": str(factor_mining_path),
        "fixtures": str(fixtures_dir),
        "overall": {
            "matches": total_matches,
            "total": total,
            "agreement": round(total_matches / total, 3) if total else None,
        },
        "by_factor": by_factor,
    }


def print_table_report(payload: dict) -> None:
    print("\nCalibration Metrics")
    print_markdown_table(
        [
            "version",
            "split",
            "n",
            "strong_mean",
            "weak_mean",
            "gap",
            "pairwise",
            "acc@50",
            "best_threshold",
            "best_acc",
        ],
        [
            metric_row(version, split, metrics)
            for version, version_payload in payload.items()
            for split, metrics in version_payload["metrics"].items()
            if not split.startswith("_")
        ],
    )

    print("\nTrain -> Holdout Protocol")
    print_markdown_table(
        [
            "version",
            "train_selected_threshold",
            "train_acc",
            "train_f1",
            "holdout_acc",
            "holdout_precision",
            "holdout_recall",
            "holdout_f1",
            "holdout_fp",
            "holdout_fn",
        ],
        [
            protocol_row(version, version_payload["metrics"]["_protocol"])
            for version, version_payload in payload.items()
        ],
    )

    print("\nJudge Agreement: VLM factor levels vs manual factor_mining.csv")
    print_markdown_table(
        ["version", "factor", "matches", "total", "agreement"],
        [
            agreement_row(version, "overall", version_payload["judge_agreement"]["overall"])
            for version, version_payload in payload.items()
        ]
        + [
            agreement_row(version, factor, agreement)
            for version, version_payload in payload.items()
            for factor, agreement in version_payload["judge_agreement"]["by_factor"].items()
        ],
    )


def metric_row(version: str, split: str, metrics: dict) -> list[str]:
    return [
        version,
        split,
        format_value(metrics["n"]),
        format_value(metrics["strong_mean"]),
        format_value(metrics["weak_mean"]),
        format_value(metrics["mean_gap"]),
        format_value(metrics["pairwise_separation"]),
        format_value(metrics["accuracy_at_50"]),
        format_value(metrics["best_threshold"]),
        format_value(metrics["best_threshold_accuracy"]),
    ]


def agreement_row(version: str, factor: str, agreement: dict) -> list[str]:
    return [
        version,
        factor,
        format_value(agreement["matches"]),
        format_value(agreement["total"]),
        format_value(agreement["agreement"]),
    ]


def protocol_row(version: str, protocol: dict) -> list[str]:
    return [
        version,
        format_value(protocol["train_selected_threshold"]),
        format_value(protocol["train_accuracy_at_selected_threshold"]),
        format_value(protocol["train_f1_at_selected_threshold"]),
        format_value(protocol["holdout_accuracy_at_train_threshold"]),
        format_value(protocol["holdout_precision_at_train_threshold"]),
        format_value(protocol["holdout_recall_at_train_threshold"]),
        format_value(protocol["holdout_f1_at_train_threshold"]),
        format_value(protocol["holdout_false_positives"]),
        format_value(protocol["holdout_false_negatives"]),
    ]


def print_markdown_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print("| " + " | ".join(pad(value, widths[index]) for index, value in enumerate(headers)) + " |")
    print("| " + " | ".join("-" * widths[index] for index in range(len(headers))) + " |")
    for row in rows:
        print("| " + " | ".join(pad(value, widths[index]) for index, value in enumerate(row)) + " |")


def pad(value: str, width: int) -> str:
    return value + (" " * (width - len(value)))


def format_value(value) -> str:
    if value is None:
        return "-"
    return str(value)


if __name__ == "__main__":
    main()
