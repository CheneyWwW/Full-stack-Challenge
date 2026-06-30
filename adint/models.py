from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class LevelSpec(BaseModel):
    key: str
    points: int
    desc: str


class FactorSpec(BaseModel):
    key: str
    question: str
    levels: list[LevelSpec]
    evidence: str

    @field_validator("levels")
    @classmethod
    def require_unique_levels(cls, levels: list[LevelSpec]) -> list[LevelSpec]:
        keys = [level.key for level in levels]
        if len(keys) != len(set(keys)):
            raise ValueError("factor levels must have unique keys")
        return levels


class ScoreSpec(BaseModel):
    version: str
    category: str
    factors: list[FactorSpec]

    @field_validator("factors")
    @classmethod
    def require_unique_factors(cls, factors: list[FactorSpec]) -> list[FactorSpec]:
        keys = [factor.key for factor in factors]
        if len(keys) != len(set(keys)):
            raise ValueError("factors must have unique keys")
        return factors


class FactorJudgment(BaseModel):
    key: str
    level: str
    confidence: float = Field(ge=0, le=1)
    rationale: str = ""


class ImageJudgment(BaseModel):
    image_id: str
    model: str
    factors: list[FactorJudgment]
    raw_response: dict[str, Any] | None = None


class FactorAttribution(BaseModel):
    key: str
    level: str
    points: int
    confidence: float
    rationale: str
    description: str


class ScoreResult(BaseModel):
    image_id: str
    category: str
    spec_version: str
    score: int
    raw_points: int
    min_points: int
    max_points: int
    attributions: list[FactorAttribution]

