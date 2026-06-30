from adint.models import ImageJudgment
from adint.scorer import score_judgment
from adint.spec import load_spec


def test_fixture_scores_order_strong_above_weak():
    spec = load_spec("data/factors/phone_accessories_v0.yaml")

    strong = ImageJudgment.model_validate_json(
        open("fixtures/judgments/strong_phone_case_001.json", encoding="utf-8").read()
    )
    weak = ImageJudgment.model_validate_json(
        open("fixtures/judgments/weak_marketplace_case_001.json", encoding="utf-8").read()
    )

    assert score_judgment(strong, spec).score > score_judgment(weak, spec).score

