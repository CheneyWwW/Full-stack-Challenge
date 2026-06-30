from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from adint.models import ImageJudgment, ScoreSpec


class Judge(ABC):
    @abstractmethod
    def judge(self, image_path: Path, spec: ScoreSpec, image_id: str) -> ImageJudgment:
        """Return discrete factor levels. The judge must not calculate a score."""

