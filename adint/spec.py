from __future__ import annotations

from pathlib import Path

import yaml

from .models import ScoreSpec


def load_spec(path: str | Path) -> ScoreSpec:
    spec_path = Path(path)
    with spec_path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    return ScoreSpec.model_validate(data)


def factor_prompt(spec: ScoreSpec) -> str:
    lines = [
        "Choose exactly one level for each factor.",
        "Return JSON only with this shape:",
        '{"factors":[{"key":"factor_key","level":"level_key","confidence":0.0,"rationale":"short reason"}]}',
        "",
        f"Category: {spec.category}",
        f"Spec version: {spec.version}",
    ]
    for factor in spec.factors:
        lines.append(f"\nFactor: {factor.key}")
        lines.append(f"Question: {factor.question}")
        for level in factor.levels:
            lines.append(f"- {level.key}: {level.desc}")
    return "\n".join(lines)

