# Corpus Filling Guide

Fill the two CSV files from left to right. Do not leave `TODO` in rows you plan to commit as finished data.

## `data/corpus_manifest.csv`

- `image_id`: file stem, for example `strong_case_001`.
- `split`: use `train` for tuning, `holdout` for final evaluation. For 20 strong images, use 15 train and 5 holdout.
- `label`: `strong` or `weak`.
- `category`: use `phone_cases`.
- `source_url`: the public page where the image came from.
- `brand`: brand or marketplace seller, for example `OtterBox`, `Mous`, `CASETiFY`, `Spigen`, or `Unknown`.
- `local_path`: local image path, for example `data/images/strong_case_001.jpg`.
- `fixture_id`: same as `image_id`.
- `notes`: one short description of the image.

Example:

```csv
strong_case_001,train,strong,phone_cases,https://www.otterbox.com/,OtterBox,data/images/strong_case_001.jpg,strong_case_001,Hero ad; outdoor use context; clear durability benefit; product visible in hand
```

## `data/labels/labels.csv`

- `image_id`: must match `corpus_manifest.csv`.
- `label`: `strong` or `weak`.
- `labeler`: use `self`.
- `rationale`: why you assigned this label.
- `created_at`: use `2026-07-01`.

Example:

```csv
strong_case_001,strong,self,Outdoor hero creative with clear product visibility use context durability message and CTA,2026-07-01
```

## Strong Rationale Phrases

Use these as starting points and edit for the actual image:

- Clear product visibility with a real use context and benefit-led headline.
- Hero ad composition with readable copy and product shown in hand.
- Lifestyle creative that makes the phone case use case immediately clear.
- Product is prominent and the image communicates durability or protection.
- Clean visual hierarchy with product, benefit, and CTA arranged like an ad.

## Weak Rationale Phrases

Use later when you add weak examples:

- Marketplace listing image with isolated product and no use context.
- Product is visible but the image lacks a clear ad benefit.
- Catalog-style image with weak visual hierarchy.
- Cluttered product collage with too many competing details.
- Generic product shot that does not communicate why the buyer should care.

