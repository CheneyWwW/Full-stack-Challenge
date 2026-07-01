"""Export calibration and drift results as GitHub-readable report tables."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from evaluate_calibration import factor_agreement, prediction_metrics, read_csv


REPORTS_DIR = Path("reports")
CALIBRATION_MD = REPORTS_DIR / "CALIBRATION_TABLES.md"
DRIFT_MD = REPORTS_DIR / "DRIFT_TEST_TABLE.md"


def main() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)

    v0_predictions = read_csv(Path("outputs/predictions.csv"))
    v1_predictions = read_csv(Path("outputs/predictions_v1.csv"))
    payload = {
        "v0": {
            "predictions": v0_predictions,
            "metrics": prediction_metrics(v0_predictions),
            "judge_agreement": factor_agreement(
                Path("data/factor_mining.csv"),
                Path("fixtures/judgments"),
            ),
        },
        "v1": {
            "predictions": v1_predictions,
            "metrics": prediction_metrics(v1_predictions),
            "judge_agreement": factor_agreement(
                Path("data/factor_mining.csv"),
                Path("fixtures/judgments_v1"),
            ),
        },
    }
    calibration_metrics = calibration_metric_rows(payload)
    protocol_rows = train_holdout_protocol_rows(payload)
    confusion_rows = confusion_matrix_rows(payload)
    agreement_rows = judge_agreement_rows(payload)

    write_csv(REPORTS_DIR / "calibration_metrics.csv", calibration_metrics)
    write_csv(REPORTS_DIR / "train_holdout_protocol.csv", protocol_rows)
    write_csv(REPORTS_DIR / "confusion_matrix.csv", confusion_rows)
    write_csv(REPORTS_DIR / "judge_agreement.csv", agreement_rows)
    CALIBRATION_MD.write_text(
        "\n\n".join(
            [
                "# Calibration Tables",
                "## Calibration Metrics",
                markdown_table(calibration_metrics),
                "## Train -> Holdout Protocol",
                markdown_table(protocol_rows),
                "## Confusion Matrix at Train-Selected Threshold",
                markdown_table(confusion_rows),
                "## Judge Agreement",
                markdown_table(agreement_rows),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    drift_path = Path("outputs/drift_test.json")
    if drift_path.exists():
        drift_payload = json.loads(drift_path.read_text(encoding="utf-8"))
        drift_summary = drift_summary_rows(drift_payload)
        drift_runs = drift_run_rows(drift_payload)
        write_csv(REPORTS_DIR / "drift_test_summary.csv", drift_summary)
        write_csv(REPORTS_DIR / "drift_test_runs.csv", drift_runs)
        DRIFT_MD.write_text(
            "\n\n".join(
                [
                    "# Drift Test Tables",
                    "## Summary",
                    markdown_table(drift_summary),
                    "## Runs",
                    markdown_table(drift_runs),
                ]
            )
            + "\n",
            encoding="utf-8",
        )
    else:
        DRIFT_MD.write_text(
            "# Drift Test Tables\n\n"
            "`outputs/drift_test.json` was not found. Run "
            "`python scripts/run_drift_test.py --runs 10 --sleep 3` first.\n",
            encoding="utf-8",
        )

    print(f"wrote {CALIBRATION_MD}")
    print(f"wrote {DRIFT_MD}")


def calibration_metric_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for version, version_payload in payload.items():
        for split, metrics in version_payload["metrics"].items():
            if split.startswith("_"):
                continue
            rows.append(
                {
                    "version": version,
                    "split": split,
                    "n": metrics["n"],
                    "strong_mean": metrics["strong_mean"],
                    "weak_mean": metrics["weak_mean"],
                    "mean_gap": metrics["mean_gap"],
                    "pairwise_separation": metrics["pairwise_separation"],
                    "accuracy_at_50": metrics["accuracy_at_50"],
                    "best_threshold": metrics["best_threshold"],
                    "best_threshold_accuracy": metrics["best_threshold_accuracy"],
                }
            )
    return rows


def train_holdout_protocol_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for version, version_payload in payload.items():
        protocol = version_payload["metrics"]["_protocol"]
        rows.append(
            {
                "version": version,
                "train_selected_threshold": protocol["train_selected_threshold"],
                "train_accuracy": protocol["train_accuracy_at_selected_threshold"],
                "train_f1": protocol["train_f1_at_selected_threshold"],
                "holdout_accuracy": protocol["holdout_accuracy_at_train_threshold"],
                "holdout_precision": protocol["holdout_precision_at_train_threshold"],
                "holdout_recall": protocol["holdout_recall_at_train_threshold"],
                "holdout_f1": protocol["holdout_f1_at_train_threshold"],
                "holdout_false_positives": protocol["holdout_false_positives"],
                "holdout_false_negatives": protocol["holdout_false_negatives"],
            }
        )
    return rows


def confusion_matrix_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for version, version_payload in payload.items():
        threshold = version_payload["metrics"]["_protocol"]["train_selected_threshold"]
        for split in ["train", "holdout"]:
            split_rows = [
                row for row in version_payload["predictions"] if row.get("split") == split
            ]
            matrix = confusion_matrix_for_rows(split_rows, threshold)
            for actual_label in ["weak", "strong"]:
                rows.append(
                    {
                        "version": version,
                        "split": split,
                        "threshold": threshold,
                        "actual_label": actual_label,
                        "predicted_weak": matrix[actual_label]["weak"],
                        "predicted_strong": matrix[actual_label]["strong"],
                        "total": sum(matrix[actual_label].values()),
                    }
                )
    return rows


def confusion_matrix_for_rows(
    rows: list[dict[str, str]],
    threshold: int | float | None,
) -> dict[str, dict[str, int]]:
    matrix = {
        "weak": {"weak": 0, "strong": 0},
        "strong": {"weak": 0, "strong": 0},
    }
    if threshold is None:
        return matrix
    for row in rows:
        label = row.get("label")
        if label not in matrix:
            continue
        predicted = "strong" if float(row["score"]) >= threshold else "weak"
        matrix[label][predicted] += 1
    return matrix


def judge_agreement_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for version, version_payload in payload.items():
        overall = version_payload["judge_agreement"]["overall"]
        rows.append(
            {
                "version": version,
                "factor": "overall",
                "matches": overall["matches"],
                "total": overall["total"],
                "agreement": overall["agreement"],
            }
        )
        for factor, agreement in version_payload["judge_agreement"]["by_factor"].items():
            if agreement["total"] == 0:
                continue
            rows.append(
                {
                    "version": version,
                    "factor": factor,
                    "matches": agreement["matches"],
                    "total": agreement["total"],
                    "agreement": agreement["agreement"],
                }
            )
    return rows


def drift_summary_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for image in payload["images"]:
        rows.append(
            {
                "image_id": image["image_id"],
                "label": image["label"],
                "split": image["split"],
                "runs": payload["runs_per_image"],
                "score_min": image["score_min"],
                "score_max": image["score_max"],
                "score_delta": image["score_delta"],
                "changed_factors": ", ".join(image["changed_factors"]) or "none",
                "marketplace_listing_signal_counts": format_counts(
                    image["level_counts"].get("marketplace_listing_signal", {})
                ),
            }
        )
    return rows


def drift_run_rows(payload: dict) -> list[dict[str, object]]:
    rows = []
    for image in payload["images"]:
        for run in image["runs"]:
            row = {
                "image_id": image["image_id"],
                "label": image["label"],
                "split": image["split"],
                "run": run["run"],
                "score": run["score"],
                "raw_points": run["raw_points"],
            }
            for factor, level in run["levels"].items():
                row[factor] = level
            rows.append(row)
    return rows


def format_counts(counts: dict[str, int]) -> str:
    return "; ".join(f"{level}:{count}" for level, count in sorted(counts.items()))


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {path}")


def markdown_table(rows: list[dict[str, object]]) -> str:
    if not rows:
        return "_No rows._"
    headers = list(rows[0].keys())
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(format_cell(row[header]) for header in headers) + " |")
    return "\n".join(lines)


def format_cell(value: object) -> str:
    if value is None:
        return ""
    return str(value).replace("|", "\\|")


if __name__ == "__main__":
    main()
