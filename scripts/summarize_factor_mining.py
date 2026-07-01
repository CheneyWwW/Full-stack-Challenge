"""
Summarize manual factor mining counts by strong/weak label.

Run:
    python scripts/summarize_factor_mining.py
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path


FACTOR_COLUMNS = [
    "product_prominence",
    "use_case_context",
    "benefit_clarity",
    "visual_hierarchy",
    "material_and_detail",
    "brand_trust_signal",
    "contrast_and_legibility",
]

POSITIVE_LEVELS = {
    "product_prominence": {"hero"},
    "use_case_context": {"in_use", "contextual"},
    "benefit_clarity": {"specific"},
    "visual_hierarchy": {"clean"},
    "material_and_detail": {"tactile"},
    "brand_trust_signal": {"credible", "subtle"},
    "contrast_and_legibility": {"high"},
}


def main() -> None:
    path = Path("data/factor_mining.csv")
    rows = list(csv.DictReader(path.open("r", encoding="utf-8")))
    by_label: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_label[row["label"]].append(row)

    print(f"Rows: {len(rows)}")
    print(f"Labels: {', '.join(f'{label}={len(items)}' for label, items in sorted(by_label.items()))}")
    print()

    for factor in FACTOR_COLUMNS:
        print(factor)
        for label in ["strong", "weak"]:
            items = by_label[label]
            levels = Counter(row[factor] for row in items)
            positive = sum(
                1 for row in items if row[factor] in POSITIVE_LEVELS[factor]
            )
            level_text = ", ".join(f"{key}:{value}" for key, value in sorted(levels.items()))
            print(f"  {label}: positive={positive}/{len(items)} | {level_text}")
        print()


if __name__ == "__main__":
    main()

