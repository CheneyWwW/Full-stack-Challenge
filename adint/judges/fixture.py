from __future__ import annotations

import json
from pathlib import Path

from adint.models import ImageJudgment, ScoreSpec

from .base import Judge


class FixtureJudge(Judge):
    def __init__(self, fixture_dir: str | Path = "fixtures/judgments") -> None:
        self.fixture_dir = Path(fixture_dir)

    def judge(self, image_path: Path, spec: ScoreSpec, image_id: str) -> ImageJudgment:
        fixture_path = self.fixture_dir / f"{image_id}.json"
        if not fixture_path.exists():
            raise FileNotFoundError(
                f"fixture not found for '{image_id}': {fixture_path}. "
                "Pass --image-id to match one of the committed fixtures."
            )
        with fixture_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return ImageJudgment.model_validate(data)

