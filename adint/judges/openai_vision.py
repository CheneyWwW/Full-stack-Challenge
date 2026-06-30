from __future__ import annotations

import base64
import json
import mimetypes
import os
from pathlib import Path

from openai import OpenAI

from adint.models import ImageJudgment, ScoreSpec
from adint.spec import factor_prompt

from .base import Judge


class OpenAIVisionJudge(Judge):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self.model = model or os.environ["AI_MODEL"]
        self.client = OpenAI(
            api_key=api_key or os.environ["AI_API_KEY"],
            base_url=base_url or os.environ.get("AI_ENDPOINT"),
        )

    def judge(self, image_path: Path, spec: ScoreSpec, image_id: str) -> ImageJudgment:
        if not image_path.exists():
            raise FileNotFoundError(f"image not found: {image_path}")

        prompt = factor_prompt(spec)
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict ad creative analyst. "
                        "Judge named factor levels only. Never output a numeric ad score."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": _data_url(image_path)},
                        },
                    ],
                },
            ],
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        data["image_id"] = image_id
        data["model"] = self.model
        data["raw_response"] = {"content": content}
        return ImageJudgment.model_validate(data)


def _data_url(image_path: Path) -> str:
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"

