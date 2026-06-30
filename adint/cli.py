from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from dotenv import load_dotenv

from .judges import FixtureJudge, OpenAIVisionJudge
from .models import ScoreResult
from .scorer import score_judgment
from .spec import load_spec

DEFAULT_SPEC = Path("data/factors/phone_accessories_v0.yaml")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(
        prog="adint",
        description="Spec-as-data ad image scorer. VLM judges levels; table scores.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate-spec")
    validate_parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)

    score_parser = subparsers.add_parser("score")
    score_parser.add_argument("image", type=Path)
    score_parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    score_parser.add_argument("--provider", choices=["fixture", "openai"], default="fixture")
    score_parser.add_argument("--image-id", help="Defaults to the image filename stem.")
    score_parser.add_argument("--out", type=Path)

    batch_parser = subparsers.add_parser("batch")
    batch_parser.add_argument("--manifest", type=Path, default=Path("data/corpus_manifest.csv"))
    batch_parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    batch_parser.add_argument("--provider", choices=["fixture", "openai"], default="fixture")
    batch_parser.add_argument("--out", type=Path, default=Path("outputs/predictions.csv"))

    calibrate_parser = subparsers.add_parser("calibrate")
    calibrate_parser.add_argument("--manifest", type=Path, default=Path("data/corpus_manifest.csv"))
    calibrate_parser.add_argument("--predictions", type=Path, default=Path("outputs/predictions.csv"))

    args = parser.parse_args()

    if args.command == "validate-spec":
        spec = load_spec(args.spec)
        print(f"OK: {args.spec} ({spec.category}, {len(spec.factors)} factors)")
    elif args.command == "score":
        result = run_score(args.image, args.spec, args.provider, args.image_id)
        payload = result.model_dump(mode="json")
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(json.dumps(payload, indent=2))
    elif args.command == "batch":
        run_batch(args.manifest, args.spec, args.provider, args.out)
    elif args.command == "calibrate":
        run_calibrate(args.manifest, args.predictions)


def run_score(
    image_path: Path,
    spec_path: Path,
    provider: str,
    image_id: str | None,
) -> ScoreResult:
    spec = load_spec(spec_path)
    resolved_image_id = image_id or image_path.stem
    judge = FixtureJudge() if provider == "fixture" else OpenAIVisionJudge()
    judgment = judge.judge(image_path, spec, resolved_image_id)
    return score_judgment(judgment, spec)


def run_batch(manifest_path: Path, spec_path: Path, provider: str, out_path: Path) -> None:
    rows = list(csv.DictReader(manifest_path.open("r", encoding="utf-8-sig")))
    results = []
    for row in rows:
        image_id = row.get("fixture_id") or row["image_id"]
        image_path = Path(row["local_path"]) if row.get("local_path") else Path(image_id)
        result = run_score(image_path, spec_path, provider, image_id)
        results.append(
            {
                "image_id": row["image_id"],
                "fixture_id": image_id,
                "split": row.get("split", ""),
                "label": row.get("label", ""),
                "score": result.score,
                "raw_points": result.raw_points,
            }
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["image_id", "fixture_id", "split", "label", "score", "raw_points"],
        )
        writer.writeheader()
        writer.writerows(results)
    print(f"Wrote {len(results)} predictions to {out_path}")


def run_calibrate(manifest_path: Path, predictions_path: Path) -> None:
    manifest = {
        row["image_id"]: row
        for row in csv.DictReader(manifest_path.open("r", encoding="utf-8-sig"))
    }
    predictions = list(csv.DictReader(predictions_path.open("r", encoding="utf-8-sig")))
    scored = []
    for row in predictions:
        label = row.get("label") or manifest.get(row["image_id"], {}).get("label", "")
        if label not in {"strong", "weak"}:
            continue
        scored.append((row["image_id"], label, float(row["score"])))

    strong = [score for _, label, score in scored if label == "strong"]
    weak = [score for _, label, score in scored if label == "weak"]
    if not strong or not weak:
        raise ValueError("need at least one strong and one weak labeled image")

    pairwise = _pairwise_separation(strong, weak)
    threshold_accuracy = sum(
        (label == "strong" and score >= 50) or (label == "weak" and score < 50)
        for _, label, score in scored
    ) / len(scored)

    metrics = {
        "n": len(scored),
        "strong_mean": round(sum(strong) / len(strong), 2),
        "weak_mean": round(sum(weak) / len(weak), 2),
        "mean_gap": round(sum(strong) / len(strong) - sum(weak) / len(weak), 2),
        "pairwise_separation": round(pairwise, 3),
        "threshold_50_accuracy": round(threshold_accuracy, 3),
    }
    print(json.dumps(metrics, indent=2))


def _pairwise_separation(strong: list[float], weak: list[float]) -> float:
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

