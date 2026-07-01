"""
Run a small VLM drift test on selected images.

The test repeats factor-level judging for the same image and records score
variance plus changed factor levels. This output is intended for reporting,
not for training or automatic calibration.

Run:
    python scripts/run_drift_test.py --runs 10
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from openai import APIError, APITimeoutError, RateLimitError

from adint.judges import OpenAIVisionJudge
from adint.models import ImageJudgment
from adint.scorer import score_judgment
from adint.spec import load_spec


DEFAULT_SPEC = Path("data/factors/phone_accessories_v1.yaml")
DEFAULT_MANIFEST = Path("data/corpus_manifest.csv")
DEFAULT_OUT = Path("outputs/drift_test.json")
DEFAULT_IMAGE_IDS = ["strong_case_003", "weak_case_002"]


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Run repeated VLM judgments for drift.")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--image-id", action="append", dest="image_ids")
    parser.add_argument("--sleep", type=float, default=2.0)
    parser.add_argument("--max-retries", type=int, default=4)
    parser.add_argument("--retry-sleep", type=float, default=60.0)
    args = parser.parse_args()

    spec = load_spec(args.spec)
    rows = {
        row.get("fixture_id") or row["image_id"]: row
        for row in csv.DictReader(args.manifest.open("r", encoding="utf-8-sig"))
    }
    image_ids = args.image_ids or DEFAULT_IMAGE_IDS
    judge = OpenAIVisionJudge()

    payload = {
        "spec": str(args.spec),
        "runs_per_image": args.runs,
        "images": [],
    }
    for image_id in image_ids:
        if image_id not in rows:
            raise ValueError(f"image_id not found in manifest: {image_id}")

        row = rows[image_id]
        image_path = Path(row["local_path"])
        run_payloads = []
        for run_index in range(args.runs):
            print(f"judge {image_id} run {run_index + 1}/{args.runs}: {image_path}")
            judgment = judge_with_retries(
                judge=judge,
                image_path=image_path,
                spec=spec,
                image_id=image_id,
                max_retries=args.max_retries,
                retry_sleep=args.retry_sleep,
            )
            result = score_judgment(judgment, spec)
            run_payloads.append(
                {
                    "run": run_index + 1,
                    "score": result.score,
                    "raw_points": result.raw_points,
                    "levels": {
                        factor.key: factor.level for factor in judgment.factors
                    },
                    "rationales": {
                        factor.key: factor.rationale for factor in judgment.factors
                    },
                }
            )
            time.sleep(args.sleep)

        payload["images"].append(summarize_image(row, run_payloads))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    print(f"wrote {args.out}")


def summarize_image(row: dict[str, str], runs: list[dict]) -> dict:
    scores = [run["score"] for run in runs]
    all_factor_keys = sorted({key for run in runs for key in run["levels"]})
    changed_factors = []
    level_counts = {}
    for factor_key in all_factor_keys:
        counts: dict[str, int] = defaultdict(int)
        for run in runs:
            counts[run["levels"][factor_key]] += 1
        level_counts[factor_key] = dict(sorted(counts.items()))
        if len(counts) > 1:
            changed_factors.append(factor_key)

    return {
        "image_id": row.get("fixture_id") or row["image_id"],
        "label": row.get("label"),
        "split": row.get("split"),
        "score_min": min(scores),
        "score_max": max(scores),
        "score_delta": max(scores) - min(scores),
        "changed_factors": changed_factors,
        "level_counts": level_counts,
        "runs": runs,
    }


def judge_with_retries(
    *,
    judge: OpenAIVisionJudge,
    image_path: Path,
    spec,
    image_id: str,
    max_retries: int,
    retry_sleep: float,
) -> ImageJudgment:
    attempts = max_retries + 1
    for attempt in range(1, attempts + 1):
        try:
            return judge.judge(image_path, spec, image_id)
        except (RateLimitError, APITimeoutError, APIError) as error:
            if attempt >= attempts:
                raise

            wait_seconds = retry_sleep * (2 ** (attempt - 1))
            print(
                f"retry {attempt}/{max_retries} after {type(error).__name__}; "
                f"sleeping {wait_seconds:.0f}s"
            )
            time.sleep(wait_seconds)

    raise RuntimeError(f"failed to judge image after retries: {image_id}")


if __name__ == "__main__":
    main()
