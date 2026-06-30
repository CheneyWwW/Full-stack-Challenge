# Ad Intelligence Scorer

这是一个面向 `phone_accessories` 的广告图片评分项目。核心目标是建立一个可解释、可复现、可校准的评分闭环，而不是让模型直接给图片打 0-100 分。

核心设计：

- VLM 只判断离散 factor level，例如 `product_prominence: hero`。
- YAML 表负责把 level 转成 points。
- Python 代码确定性计算 raw points、0-100 score 和 per-factor attribution。

我选择 `phone_accessories`，因为强弱样本差异比较清楚：强广告通常有使用场景、产品突出度和明确卖点；弱图常见于 marketplace listing，容易出现孤立产品、画面拥挤、卖点不清。

## Quickstart

无 API key 运行 fixture 示例：

```powershell
py -m venv .venv; .\.venv\Scripts\python.exe -m pip install -e '.[dev]'
.\.venv\Scripts\python.exe -m adint score fixture://strong --image-id strong_phone_case_001
```

批量评分、校准和测试：

```powershell
.\.venv\Scripts\python.exe -m adint batch --provider fixture
.\.venv\Scripts\python.exe -m adint calibrate
.\.venv\Scripts\python.exe -m adint validate-spec
.\.venv\Scripts\python.exe -m pytest
```

## 本次提交完成了什么

当前提交完成的是可运行 scaffold：

- CLI：`score`、`batch`、`calibrate`、`validate-spec`
- YAML factor table：`data/factors/phone_accessories_v0.yaml`
- 确定性评分逻辑：level -> points -> normalized score
- Attribution 输出：每个 factor 的 level、points、rationale
- Judge providers：
  - `fixture`：读取缓存 judgments
  - `openai`：调用 OpenAI-compatible VLM，只输出 factor levels
- Starter data files：`corpus_manifest.csv`、`labels.csv`
- Fixture judgments：无 API key 可复现
- Test：验证 strong fixture 分数高于 weak fixture
- Report template 和 24 小时 workplan

还未完成：

- 真实 40-80 张图片 corpus
- corpus-backed factor evidence
- train / holdout calibration
- drift test
- final report 和 error analysis

## 工作流程

1. **收集 corpus**  
   收集 40-80 张公开图片，记录到 `data/corpus_manifest.csv`。每张图保留 `source_url`、`label`、`split`、`brand`、`local_path` 和备注。保留约 25-30% 作为 holdout。

2. **先标注，再调分**  
   标签写入 `data/labels/labels.csv`。第一版使用 `strong` / `weak` 二分类，必要时为模糊样本补充 pairwise preference。

3. **挖掘 factors**  
   当前 YAML 是 seed spec。真实数据收集后，比较 strong / weak 的视觉差异，并把 evidence 写进 YAML，例如 `use context: 19/30 strong vs 6/30 weak`。

4. **VLM 判断 levels**  
   VLM 只输出结构化 levels、confidence 和 rationale，不输出最终分数。judgments 缓存到 `fixtures/judgments/`，保证无 key 复现。

5. **确定性评分**  
   代码读取 YAML 和 judgments，查表得到 points，汇总并 normalize 到 0-100，同时输出 attribution。

6. **校准和错误分析**  
   在 train 上调 points 和描述，在 holdout 上报告结果。最终报告至少包含 before/after metrics、3 个 error cases、drift 结果和下一步计划。

## VLM 选择

默认选择：

```env
AI_ENDPOINT=https://models.github.ai/inference
AI_MODEL=openai/gpt-4o-mini
AI_API_KEY=your_token_here
```

选择 `gpt-4o-mini` 的原因：

- 支持图片输入
- 成本和速度适合 40-80 张图的批量 judging
- 对 factor-level JSON 输出足够稳定

如果时间允许，我会用更强的 VLM 抽样复核 ambiguous/error cases，而不是全量替换 primary judge。

## Live Scoring

复制 `.env.example` 为 `.env` 后，可以对真实图片评分：

```powershell
.\.venv\Scripts\python.exe -m adint score data\images\my_ad.jpg --provider openai --image-id my_ad
```

## Repository Map

- `adint/`：CLI、judge provider、spec loading、scoring
- `data/factors/phone_accessories_v0.yaml`：factor table
- `data/corpus_manifest.csv`：图片来源、split、label
- `data/labels/labels.csv`：标签和标注理由
- `fixtures/judgments/`：缓存 judgments
- `reports/REPORT_TEMPLATE.md`：最终报告模板
- `scripts/WORKPLAN.md`：24 小时计划
- `tests/`：评分逻辑测试
