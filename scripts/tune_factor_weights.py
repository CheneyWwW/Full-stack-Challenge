"""
Suggest YAML point changes with a focal-like calibration loss.

This does not rewrite the factor YAML automatically. It reads cached VLM
judgments, treats factor levels as fixed, and searches for integer point values
that reduce hard mistakes on the training split.

Run:
    python scripts/tune_factor_weights.py
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path

from adint.models import ImageJudgment, ScoreSpec
from adint.spec import load_spec


DEFAULT_MANIFEST = Path("data/corpus_manifest.csv")
DEFAULT_SPEC = Path("data/factors/phone_accessories_v0.yaml")
DEFAULT_FIXTURES = Path("fixtures/judgments")


@dataclass(frozen=True)
class Sample:
    image_id: str
    split: str
    label: str
    levels: dict[str, str]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Suggest factor point changes using focal-like calibration."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--train-split", default="train")
    parser.add_argument("--gamma", type=float, default=2.0)
    parser.add_argument(
        "--weak-alpha",
        type=float,
        default=2.0,
        help="Extra weight for weak samples, useful for reducing false positives.",
    )
    parser.add_argument("--strong-alpha", type=float, default=1.0)
    parser.add_argument("--temperature", type=float, default=12.0)
    parser.add_argument("--max-adjust", type=int, default=6)
    parser.add_argument("--rounds", type=int, default=4)
    parser.add_argument("--l2", type=float, default=0.01)
    args = parser.parse_args()

    spec = load_spec(args.spec)
    samples = load_samples(args.manifest, args.fixtures_dir)
    train = [sample for sample in samples if sample.split == args.train_split]
    holdout = [sample for sample in samples if sample.split != args.train_split]
    if not train:
        raise ValueError(f"no training samples found for split={args.train_split!r}")

    base_weights = weights_from_spec(spec)
    tuned_weights = tune_weights(
        spec=spec,
        samples=train,
        base_weights=base_weights,
        gamma=args.gamma,
        weak_alpha=args.weak_alpha,
        strong_alpha=args.strong_alpha,
        temperature=args.temperature,
        max_adjust=args.max_adjust,
        rounds=args.rounds,
        l2=args.l2,
    )

    payload = {
        "loss": {
            "type": "focal_like_binary_cross_entropy",
            "gamma": args.gamma,
            "weak_alpha": args.weak_alpha,
            "strong_alpha": args.strong_alpha,
            "temperature": args.temperature,
            "l2_to_original_points": args.l2,
        },
        "baseline": {
            "train": metrics(train, spec, base_weights),
            "holdout": metrics(holdout, spec, base_weights) if holdout else None,
        },
        "tuned": {
            "train": metrics(train, spec, tuned_weights),
            "holdout": metrics(holdout, spec, tuned_weights) if holdout else None,
        },
        "suggested_changes": suggested_changes(spec, base_weights, tuned_weights),
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def load_samples(manifest_path: Path, fixtures_dir: Path) -> list[Sample]:
    rows = list(csv.DictReader(manifest_path.open("r", encoding="utf-8-sig")))
    samples: list[Sample] = []
    for row in rows:
        label = row.get("label", "")
        if label not in {"strong", "weak"}:
            continue

        fixture_id = row.get("fixture_id") or row["image_id"]
        fixture_path = fixtures_dir / f"{fixture_id}.json"
        judgment = ImageJudgment.model_validate_json(
            fixture_path.read_text(encoding="utf-8")
        )
        samples.append(
            Sample(
                image_id=row["image_id"],
                split=row.get("split", ""),
                label=label,
                levels={factor.key: factor.level for factor in judgment.factors},
            )
        )
    return samples


def weights_from_spec(spec: ScoreSpec) -> dict[tuple[str, str], int]:
    return {
        (factor.key, level.key): level.points
        for factor in spec.factors
        for level in factor.levels
    }


def tune_weights(
    *,
    spec: ScoreSpec,
    samples: list[Sample],
    base_weights: dict[tuple[str, str], int],
    gamma: float,
    weak_alpha: float,
    strong_alpha: float,
    temperature: float,
    max_adjust: int,
    rounds: int,
    l2: float,
) -> dict[tuple[str, str], int]:
    weights = dict(base_weights)
    best_loss = objective(
        samples,
        spec,
        weights,
        base_weights,
        gamma,
        weak_alpha,
        strong_alpha,
        temperature,
        l2,
    )

    for _ in range(rounds):
        improved = False
        for key in sorted(weights):
            current = weights[key]
            lower = base_weights[key] - max_adjust
            upper = base_weights[key] + max_adjust
            local_best_value = current
            local_best_loss = best_loss
            for candidate in range(lower, upper + 1):
                trial = dict(weights)
                trial[key] = candidate
                if not preserves_factor_order(spec, trial):
                    continue
                trial_loss = objective(
                    samples,
                    spec,
                    trial,
                    base_weights,
                    gamma,
                    weak_alpha,
                    strong_alpha,
                    temperature,
                    l2,
                )
                if trial_loss < local_best_loss:
                    local_best_loss = trial_loss
                    local_best_value = candidate

            if local_best_value != current:
                weights[key] = local_best_value
                best_loss = local_best_loss
                improved = True

        if not improved:
            break

    return weights


def objective(
    samples: list[Sample],
    spec: ScoreSpec,
    weights: dict[tuple[str, str], int],
    base_weights: dict[tuple[str, str], int],
    gamma: float,
    weak_alpha: float,
    strong_alpha: float,
    temperature: float,
    l2: float,
) -> float:
    total = 0.0
    for sample in samples:
        score = score_sample(sample, spec, weights)
        probability = sigmoid((score - 50.0) / temperature)
        if sample.label == "strong":
            pt = probability
            alpha = strong_alpha
        else:
            pt = 1.0 - probability
            alpha = weak_alpha

        pt = min(max(pt, 1e-8), 1.0 - 1e-8)
        total += alpha * ((1.0 - pt) ** gamma) * (-math.log(pt))

    total /= len(samples)
    total += l2 * sum((weights[key] - base_weights[key]) ** 2 for key in weights)
    return total


def score_sample(
    sample: Sample,
    spec: ScoreSpec,
    weights: dict[tuple[str, str], int],
) -> int:
    raw_points = sum(weights[(factor, level)] for factor, level in sample.levels.items())
    min_points, max_points = score_range(spec, weights)
    normalized = 100 * (raw_points - min_points) / (max_points - min_points)
    return max(0, min(100, round(normalized)))


def score_range(
    spec: ScoreSpec,
    weights: dict[tuple[str, str], int],
) -> tuple[int, int]:
    min_points = sum(
        min(weights[(factor.key, level.key)] for level in factor.levels)
        for factor in spec.factors
    )
    max_points = sum(
        max(weights[(factor.key, level.key)] for level in factor.levels)
        for factor in spec.factors
    )
    return min_points, max_points


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def preserves_factor_order(
    spec: ScoreSpec,
    weights: dict[tuple[str, str], int],
) -> bool:
    for factor in spec.factors:
        ordered = [weights[(factor.key, level.key)] for level in factor.levels]
        for left, right in zip(ordered, ordered[1:]):
            if left < right:
                return False
    return True


def metrics(
    samples: list[Sample],
    spec: ScoreSpec,
    weights: dict[tuple[str, str], int],
) -> dict[str, float | int | None]:
    if not samples:
        return {
            "n": 0,
            "strong_mean": None,
            "weak_mean": None,
            "mean_gap": None,
            "pairwise_separation": None,
            "threshold_50_accuracy": None,
        }

    scored = [
        (sample.label, score_sample(sample, spec, weights))
        for sample in samples
        if sample.label in {"strong", "weak"}
    ]
    strong = [score for label, score in scored if label == "strong"]
    weak = [score for label, score in scored if label == "weak"]
    correct = sum(
        (label == "strong" and score >= 50) or (label == "weak" and score < 50)
        for label, score in scored
    )
    return {
        "n": len(scored),
        "strong_mean": round(sum(strong) / len(strong), 2) if strong else None,
        "weak_mean": round(sum(weak) / len(weak), 2) if weak else None,
        "mean_gap": round(sum(strong) / len(strong) - sum(weak) / len(weak), 2)
        if strong and weak
        else None,
        "pairwise_separation": round(pairwise_separation(strong, weak), 3)
        if strong and weak
        else None,
        "threshold_50_accuracy": round(correct / len(scored), 3) if scored else None,
    }


def pairwise_separation(strong: list[int], weak: list[int]) -> float:
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


def suggested_changes(
    spec: ScoreSpec,
    base_weights: dict[tuple[str, str], int],
    tuned_weights: dict[tuple[str, str], int],
) -> list[dict[str, int | str]]:
    changes = []
    for factor in spec.factors:
        for level in factor.levels:
            key = (factor.key, level.key)
            before = base_weights[key]
            after = tuned_weights[key]
            if before != after:
                changes.append(
                    {
                        "factor": factor.key,
                        "level": level.key,
                        "before": before,
                        "after": after,
                        "delta": after - before,
                    }
                )
    return changes


if __name__ == "__main__":
    main()
