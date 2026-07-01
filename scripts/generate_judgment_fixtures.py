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
    args = parser.parse_args()

    spec = load_spec(args.spec)
    judge = OpenAIVisionJudge()
    rows = list(csv.DictReader(args.manifest.open("r", encoding="utf-8-sig")))
    args.out_dir.mkdir(parents=True, exist_ok=True)

    processed = 0
    skipped = 0
    for row in rows:
        image_id = row.get("fixture_id") or row["image_id"]
        image_path = Path(row["local_path"])
        out_path = args.out_dir / f"{image_id}.json"

        if out_path.exists() and not args.overwrite:
            print(f"skip existing {out_path}")
            skipped += 1
            continue

        if args.limit is not None and processed >= args.limit:
            break

        print(f"judge {image_id}: {image_path}")
        judgment = judge.judge(image_path, spec, image_id)
        out_path.write_text(
            json.dumps(judgment.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        processed += 1
        time.sleep(args.sleep)

    print(f"processed={processed} skipped={skipped} out_dir={args.out_dir}")


if __name__ == "__main__":
    main()

