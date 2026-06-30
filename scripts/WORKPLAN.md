# 24-Hour Workplan

## Hour 0-1: Commit The Scaffold

- Create private GitHub repo.
- Commit this scaffold as the first commit only when you are ready to start the 24-hour clock.
- Copy `.env.example` to `.env` if you will use live VLM judging.

## Hour 1-4: Build The Corpus

- Pick 40-60 images for `phone_accessories`.
- Strong examples: Meta Ad Library, TikTok Creative Center, brand websites, Instagram posts that are public.
- Weak examples: bare marketplace listings, cluttered product collages, low-context catalog images.
- Save source URL, brand, local path, label, and notes in `data/corpus_manifest.csv`.
- Keep 25-30% as `holdout`.

## Hour 4-7: Mine Factors

- Make a spreadsheet view of image IDs vs visual tags.
- Use a VLM to propose tags, but manually merge them into judge-able factors.
- Update `data/factors/phone_accessories_v0.yaml`.
- Write one evidence line per factor.

## Hour 7-11: Run Judging

- Run live judging for the corpus, or cache JSON responses as fixtures.
- Fix descriptions that cause ambiguous or inconsistent levels.
- Keep raw/cached judgments committed.

## Hour 11-15: Calibrate

- Score train images.
- Tune points and possibly drop factors.
- Run holdout only after you decide the tuned table.
- Report before/after, including failures.

## Hour 15-19: Error Analysis And Frontier

- Analyze at least three error cases.
- Run drift: same image 10 times, same model, temperature 0.
- Sketch the deficit-to-generation-brief agent.

## Hour 19-24: README, Repo Hygiene, Final Push

- Make the README self-contained.
- Verify no-key fixture path works.
- Push private repo and invite the requested collaborators.
- Optional: record a short screen recording.

