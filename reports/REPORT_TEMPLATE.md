# Ad Intelligence Report

## 1. Category And Assumptions

- Category:
- Why this category:
- What counts as a strong creative:
- What counts as a weak creative:

## 2. Corpus

| Split | Strong | Weak | Total | Source types |
| --- | ---: | ---: | ---: | --- |
| Train |  |  |  |  |
| Holdout |  |  |  |  |

Data rules:
- Public sources only.
- Every image has a source URL in `data/corpus_manifest.csv`.
- Images are used only for this evaluation.

## 3. Labeling Design

Describe your labels: binary strong/weak, pairwise preference, per-factor goldens, or a combination.

Why this design is good enough for a 24-hour loop:

## 4. Factor Mining

Method used:
- VLM-assisted tags:
- Manual grouping:
- Clustering or spreadsheet analysis:

Final factors:

| Factor | Why kept | Evidence | Change after calibration |
| --- | --- | --- | --- |
|  |  |  |  |

Factors dropped:

## 5. Calibration

| Version | Holdout N | Strong mean | Weak mean | Gap | Pairwise separation | Accuracy @ 50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v0 before tuning |  |  |  |  |  |  |
| v1 after tuning |  |  |  |  |  |  |

What improved:

What did not improve:

## 6. Error Cases

### Error Case 1

- Image:
- Expected:
- Actual:
- Why it failed:
- Fix:

### Error Case 2

- Image:
- Expected:
- Actual:
- Why it failed:
- Fix:

### Error Case 3

- Image:
- Expected:
- Actual:
- Why it failed:
- Fix:

## 7. Drift And Determinism

Run the same image 10 times. Record factor-level variance, not just score variance.

| Image | Runs | Score min | Score max | Changed factors | Interpretation |
| --- | ---: | ---: | ---: | --- | --- |
|  |  |  |  |  |  |

Product recommendation:

## 8. From Deficit To Fix

How the agent would turn low-scoring factors into a better generation brief:

How to verify better without grading your own homework:

## 9. AI Tool Usage

What AI helped with:

What I overrode:

What I am suspicious of:

## 10. With One More Week

- 

