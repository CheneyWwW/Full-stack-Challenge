from __future__ import annotations

from .models import FactorAttribution, ImageJudgment, ScoreResult, ScoreSpec


def score_judgment(judgment: ImageJudgment, spec: ScoreSpec) -> ScoreResult:
    factor_specs = {factor.key: factor for factor in spec.factors}
    judgments = {factor.key: factor for factor in judgment.factors}

    min_points = sum(min(level.points for level in factor.levels) for factor in spec.factors)
    max_points = sum(max(level.points for level in factor.levels) for factor in spec.factors)

    attributions: list[FactorAttribution] = []
    raw_points = 0

    for factor in spec.factors:
        if factor.key not in judgments:
            raise ValueError(f"missing judgment for factor: {factor.key}")

        factor_judgment = judgments[factor.key]
        levels = {level.key: level for level in factor.levels}
        if factor_judgment.level not in levels:
            raise ValueError(
                f"unknown level '{factor_judgment.level}' for factor '{factor.key}'"
            )

        level = levels[factor_judgment.level]
        raw_points += level.points
        attributions.append(
            FactorAttribution(
                key=factor.key,
                level=level.key,
                points=level.points,
                confidence=factor_judgment.confidence,
                rationale=factor_judgment.rationale,
                description=level.desc,
            )
        )

    score = normalize_score(raw_points, min_points, max_points)
    return ScoreResult(
        image_id=judgment.image_id,
        category=spec.category,
        spec_version=spec.version,
        score=score,
        raw_points=raw_points,
        min_points=min_points,
        max_points=max_points,
        attributions=attributions,
    )


def normalize_score(raw_points: int, min_points: int, max_points: int) -> int:
    if max_points <= min_points:
        raise ValueError("spec must have a non-zero score range")
    normalized = 100 * (raw_points - min_points) / (max_points - min_points)
    return max(0, min(100, round(normalized)))

