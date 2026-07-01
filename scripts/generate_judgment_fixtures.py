"""
Generate cached VLM factor judgments for the corpus.

Run:
    python scripts/generate_judgment_fixtures.py --limit 2
    python scripts/generate_judgment_fixtures.py

The model judges factor levels only. Scores are still calculated later by
the deterministic scorer.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import APIError, APITimeoutError, RateLimitError

from adint.judges import OpenAIVisionJudge
from adint.spec import load_spec


DEFAULT_MANIFEST = Path("data/corpus_manifest.csv")
DEFAULT_SPEC = Path("data/factors/phone_accessories_v0.yaml")
DEFAULT_OUT_DIR = Path("fixtures/judgments")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Cache VLM factor-level judgments as fixture JSON files."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--limit", type=int, help="Only process the first N matching rows.")
    parser.add_argument(
        "--start-at",
        help="Skip rows until this image_id/fixture_id, then process from there.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Regenerate existing fixture files.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        help="Seconds to wait between requests.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=4,
        help="Retries per image for rate limit or transient API errors.",
    )
    parser.add_argument(
        "--retry-sleep",
        type=float,
        default=60.0,
        help="Initial seconds to wait after a rate limit or transient API error.",
    )
    args = parser.parse_args()

    spec = load_spec(args.spec)
    judge = OpenAIVisionJudge()
    rows = list(csv.DictReader(args.manifest.open("r", encoding="utf-8-sig")))
    args.out_dir.mkdir(parents=True, exist_ok=True)

    processed = 0
    skipped = 0
    reached_start = args.start_at is None
    for row in rows:
        image_id = row.get("fixture_id") or row["image_id"]
        if not reached_start:
            if args.start_at in {image_id, row["image_id"]}:
                reached_start = True
            else:
                skipped += 1
                continue

        image_path = Path(row["local_path"])
        out_path = args.out_dir / f"{image_id}.json"

        if out_path.exists() and not args.overwrite:
            print(f"skip existing {out_path}")
            skipped += 1
            continue

        if args.limit is not None and processed >= args.limit:
            break

        print(f"judge {image_id}: {image_path}")
        judgment = judge_with_retries(
            judge=judge,
            image_path=image_path,
            spec=spec,
            image_id=image_id,
            max_retries=args.max_retries,
            retry_sleep=args.retry_sleep,
        )
        tmp_path = out_path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(judgment.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(out_path)
        processed += 1
        time.sleep(args.sleep)

    print(f"processed={processed} skipped={skipped} out_dir={args.out_dir}")


def judge_with_retries(
    *,
    judge: OpenAIVisionJudge,
    image_path: Path,
    spec,
    image_id: str,
    max_retries: int,
    retry_sleep: float,
):
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
