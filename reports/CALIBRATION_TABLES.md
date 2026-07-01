# Calibration Tables

## Calibration Metrics

| version | split | n | strong_mean | weak_mean | mean_gap | pairwise_separation | accuracy_at_50 | best_threshold | best_threshold_accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0 | all | 40 | 74.4 | 63.0 | 11.4 | 0.665 | 0.525 | 69 | 0.7 |
| v0 | train | 30 | 70.6 | 63.6 | 7.0 | 0.602 | 0.533 | 69 | 0.667 |
| v0 | holdout | 10 | 85.8 | 61.2 | 24.6 | 0.84 | 0.5 | 79 | 0.9 |
| v1 | all | 40 | 77.1 | 54.0 | 23.1 | 0.78 | 0.65 | 59 | 0.825 |
| v1 | train | 30 | 74.8 | 52.4 | 22.4 | 0.753 | 0.667 | 54 | 0.8 |
| v1 | holdout | 10 | 84.0 | 58.8 | 25.2 | 0.88 | 0.6 | 59 | 0.9 |

## Train -> Holdout Protocol

| version | train_selected_threshold | train_accuracy | train_f1 | holdout_accuracy | holdout_precision | holdout_recall | holdout_f1 | holdout_false_positives | holdout_false_negatives |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0 | 69 | 0.667 | 0.643 | 0.8 | 0.8 | 0.8 | 0.8 | 1 | 1 |
| v1 | 54 | 0.8 | 0.8 | 0.7 | 0.625 | 1.0 | 0.769 | 3 | 0 |

## Confusion Matrix at Train-Selected Threshold

| version | split | threshold | actual_label | predicted_weak | predicted_strong | total |
| --- | --- | --- | --- | --- | --- | --- |
| v0 | train | 69 | weak | 11 | 4 | 15 |
| v0 | train | 69 | strong | 6 | 9 | 15 |
| v0 | holdout | 69 | weak | 4 | 1 | 5 |
| v0 | holdout | 69 | strong | 1 | 4 | 5 |
| v1 | train | 54 | weak | 12 | 3 | 15 |
| v1 | train | 54 | strong | 3 | 12 | 15 |
| v1 | holdout | 54 | weak | 2 | 3 | 5 |
| v1 | holdout | 54 | strong | 0 | 5 | 5 |

## Judge Agreement

| version | factor | matches | total | agreement |
| --- | --- | --- | --- | --- |
| v0 | overall | 196 | 280 | 0.7 |
| v0 | product_prominence | 32 | 40 | 0.8 |
| v0 | use_case_context | 35 | 40 | 0.875 |
| v0 | benefit_clarity | 25 | 40 | 0.625 |
| v0 | visual_hierarchy | 31 | 40 | 0.775 |
| v0 | material_and_detail | 24 | 40 | 0.6 |
| v0 | brand_trust_signal | 18 | 40 | 0.45 |
| v0 | contrast_and_legibility | 31 | 40 | 0.775 |
| v1 | overall | 227 | 320 | 0.709 |
| v1 | product_prominence | 32 | 40 | 0.8 |
| v1 | use_case_context | 34 | 40 | 0.85 |
| v1 | benefit_clarity | 27 | 40 | 0.675 |
| v1 | visual_hierarchy | 30 | 40 | 0.75 |
| v1 | material_and_detail | 27 | 40 | 0.675 |
| v1 | brand_trust_signal | 17 | 40 | 0.425 |
| v1 | contrast_and_legibility | 31 | 40 | 0.775 |
| v1 | marketplace_listing_signal | 29 | 40 | 0.725 |
