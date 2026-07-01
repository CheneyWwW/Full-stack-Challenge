# Ad Intelligence Scorer

这是一个面向 `phone_case` 的广告图片评分项目。核心目标是建立一个可解释、可复现、可校准的评分闭环，而不是让模型直接给图片打 0-100 分。

核心设计：

- VLM 只判断离散 factor level，例如 `product_prominence: hero`。
- YAML 表负责把 level 转成 points。
- Python 代码确定性计算 raw points、0-100 score 和 per-factor attribution。

我选择 `phone_case`，因为强弱样本差异比较清楚：强广告通常有使用场景、产品突出度和明确卖点；弱图常见于 marketplace listing，容易出现孤立产品、画面拥挤、卖点不清。

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

第一阶段完成的是可运行 scaffold：

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

第二阶段完成的是初始真实 corpus：

- 收集并保存 40 张 phone case 图片到 `data/images/`
- 数据分布：20 张 `strong`，20 张 `weak`
- 数据切分：30 张 `train`，10 张 `holdout`
- 完成 `data/corpus_manifest.csv`：
  - 每张图包含 `source_url`、`brand`、`local_path`、`split`、`label`
- 完成 `data/labels/labels.csv`：
  - 每张图包含人工 label 和简短 rationale
- 当前数据集已经通过完整性检查：
  - 无 TODO
  - 无缺失图片
  - manifest 和 labels 一一对应

第三阶段完成的是 factor mining：

- 新增 `data/factor_mining.csv`
  - 每张图片按 7 个 factor 做人工 level 标注
  - level 使用 YAML 中的同一套离散值
- 新增 `scripts/summarize_factor_mining.py`
  - 统计 strong / weak 在每个 factor 上的分布
- 更新 `data/factors/phone_accessories_v0.yaml`
  - 将 seed evidence 替换成 corpus v0 的人工观察计数
  - 诚实标注弱分离 factor，例如 `product_prominence` 和 `material_and_detail`

第四阶段：VLM judgment 生成与失败案例处理：

- 新增 `scripts/generate_judgment_fixtures.py`
  - 从 `data/corpus_manifest.csv` 批量读取真实 corpus
  - 调用 VLM 只生成 factor-level judgments
  - 将结果缓存到 `fixtures/judgments/`，方便后续无 API key 复现
- 已完成 40 张真实 corpus 的 judgment fixtures
- 完成第一轮 v0 批量评分和校准：
  - `strong_mean`: 74.4
  - `weak_mean`: 63.0
  - `mean_gap`: 11.4
  - `pairwise_separation`: 0.665
  - `threshold_50_accuracy`: 0.525
- 修复一个批处理失败案例：
  - 现象：运行 VLM judgment 生成时，接口返回 `invalid_image_format`
  - 触发样本：`strong_case_011.jpg`
  - 根因：文件扩展名是 `.jpg`，但真实图片格式是 AVIF；原实现按文件名推断 MIME type，导致不支持的图片被直接上传
  - 修复：上传前用 Pillow 读取真实图片，统一转成 RGB JPEG data URL，并限制最长边，降低批量 judging 的格式风险
  - 经验：真实广告图片 corpus 不能只信文件扩展名，VLM batch 前需要做输入格式标准化
- 第一轮评分错误案例：
  - 证据来源：`outputs/predictions.csv` 提供 label / score / raw_points，`fixtures/judgments/*.json` 提供 VLM 输出的 factor levels 和 rationale。
  - `weak_case_012` / `weak_case_013`: 人工标签为 `weak`，但 v0 score = 100，raw_points = 42。两个 fixture 都输出 `hero`、`in_use`、`specific`、`clean`、`tactile`、`credible`、`high`，刚好对应当前 YAML 满分组合 `8+7+7+6+5+4+5=42`。rationale 中明确提到 being held / MagSafe feature / Apple logo，因此判断依据不是主观猜测，而是 VLM 将这些视觉线索映射成了高分 factor。
  - `weak_case_002`: 人工标签为 `weak`，但 v0 score = 89，raw_points = 34。fixture 输出 `hero`、`in_use`、`specific`、`clean`、`adequate`、`none`、`high`，其中 rationale 包含 “single dominant focal point”、“realistic use moment”、“travel or organization” 和 “clear subject boundaries”。这说明干净商品图被多个正向 factor 同时加分，需要加入 marketplace/listing 风格的惩罚或降低这些 factor 的单独影响。
  - `strong_case_011`: 人工标签为 `strong`，但 v0 score = 34，raw_points = -8。fixture 输出 `present`、`isolated`、`absent`、`busy`、`adequate`、`none`、`medium`，rationale 包含 “without a clear use context”、“No specific buyer benefit” 和 “no visible trust signals”。这说明 VLM 低估了偏 campaign 陈列的强样本，需要在后续校准中区分“品牌 campaign 陈列”和“普通电商 listing”。
  - `strong_case_001`: 人工标签为 `strong`，但 v0 score = 36，raw_points = -7。fixture 输出 `present`、`isolated`、`absent`、`busy`、`adequate`、`subtle`、`medium`，rationale 包含 “competes with other elements”、“without a clear use case” 和 “No specific buyer benefit”。这提示当前 factor 对广告来源/品牌语境没有利用，只看单图时会低估部分来自广告库的素材。
- 新增 focal-like calibration 诊断：
  - `scripts/tune_factor_weights.py` 使用类似 focal loss 的目标函数，默认给 `weak` 样本更高权重，用来重点观察 false positive weak cases。
  - 该脚本只输出建议权重变化，不自动改 YAML；原因是当前样本量小，直接优化 points 容易过拟合。
  - 第一轮诊断显示：仅靠调整现有 7 个 factor 的 points 不能稳定解决 weak 高分问题，更合理的下一步是新增或强化 `marketplace/listing` 风格惩罚 factor。
- 第五阶段 v1 首轮修复记录：
  - 新增 `data/factors/phone_accessories_v1.yaml`
  - 在 v0 的 7 个 factor 基础上增加 `marketplace_listing_signal`
  - v1 judgments 单独保存到 `fixtures/judgments_v1/`，避免覆盖 v0 baseline
  - CLI 新增 `--fixture-dir`，可以分别评估 v0 和 v1
  - v1 全量 40 张结果：
    - `strong_mean`: 77.75
    - `weak_mean`: 60.15
    - `mean_gap`: 17.6
    - `pairwise_separation`: 0.700
    - `threshold_50_accuracy`: 0.650
  - 相比 v0 的变化：
    - `weak_mean`: 63.0 -> 60.15，下降 2.85
    - `mean_gap`: 11.4 -> 17.6，提升 6.2
    - `threshold_50_accuracy`: 0.525 -> 0.650，提升 0.125
    - `pairwise_separation`: 0.665 -> 0.700，略有提升
  - v1 有效的部分：
    - 12/20 weak 被 `marketplace_listing_signal` 判为 `generic_listing`
    - 17/20 strong 被判为 `campaign_like`
    - 整体上说明新增 factor 方向有效，能扩大 strong / weak 的平均分差
  - v1 首轮错误分析：
    - 证据来源：`outputs/predictions_v1.csv` 提供 v1 score / raw_points，`fixtures/judgments_v1/*.json` 提供新增 factor 的 level 和 rationale。以下结论都来自这两个文件，不是主观看图猜测。
    - 主要失败模式：整体指标改善，但最重要的 weak false positives 没有被修掉，说明新增 factor 方向有效但边界不够严格。
    - 证据表：

      | Case | Label | v0 score | v1 score | v1 raw | `marketplace_listing_signal` | VLM rationale evidence |
      | --- | --- | ---: | ---: | ---: | --- | --- |
      | `weak_case_012` | weak | 100 | 100 | 46 | `campaign_like` | “clear campaign intent with a lifestyle presentation” |
      | `weak_case_013` | weak | 100 | 100 | 46 | `campaign_like` | “branded scene and clear product presentation” |
      | `weak_case_002` | weak | 89 | 96 | 42 | `campaign_like` | “campaign intent with a clear presentation” |
      | `weak_case_016` | weak | 78 | 100 | 46 | `campaign_like` | “clear campaign intent with a lifestyle presentation” |
      | `strong_case_011` | strong | 34 | 29 | -18 | `generic_listing` | “resembles a generic product listing rather than a campaign” |

    - 从证据表推导出的结论：
      - `weak_case_012` / `weak_case_013` / `weak_case_016` 都是人工 `weak`，但 v1 仍为 100，且新增 factor 都给了 `campaign_like`，说明 VLM 把 lifestyle-looking / hand-held product shot 当成 campaign。
      - `weak_case_002` 从 89 升到 96，且新增 factor rationale 只说 “clear presentation”，说明原定义没有把普通商品展示和真正广告创意区分开。
      - `strong_case_011` 从 34 降到 29，且新增 factor 给了 `generic_listing`，说明它是一个边界 false negative：人工标成 strong，但单图视觉上更像 product display。
  - 修复动作：
    - 已收紧 `marketplace_listing_signal` 的 `campaign_like` 定义：必须有明确 ad copy / benefit claim / brand-owned campaign context / launch-editorial presentation / benefit-linked lifestyle story。
    - 已明确排除：单纯手持、MagSafe ring、Apple/device logo、clean background、professionally photographed product shot。
    - 已扩大 `generic_listing` 定义：包含 generic hero image、compatibility/feature demo、product-page lifestyle shot with little narrative。
    - 下一步必须用 `--overwrite` 重新生成 `fixtures/judgments_v1/`，否则仍然会使用旧 prompt 产生的 judgment。
  - 缓存与限流说明：
    - 当前 v0 的 40 张 judgments 已完整缓存于 `fixtures/judgments/`。
    - v1 首轮的 40 张 judgments 已完整缓存于 `fixtures/judgments_v1/`，并用于上述 v1 指标和错误分析。
    - 在收紧 `marketplace_listing_signal` 后，我尝试用 `--overwrite` 重新生成 v1 judgments，但 GitHub Models 返回 rate limit，因此本次提交保留 v1 首轮缓存结果、错误分析、已收紧的 v1 spec，以及可续跑的脚本能力。
    - `scripts/generate_judgment_fixtures.py` 已支持 `--start-at`、`--max-retries` 和 `--retry-sleep`；当 API quota 恢复后，可以从失败样本继续覆盖生成，而不需要从头开始。
    - 因此当前提交的评分结果是可复现的 fixture-based baseline；收紧后的 v1 spec 是下一轮 calibration step，不把未完成重跑伪装成已经完成的提升。

还未完成：

- regenerate v1 judgments after tightened marketplace/listing definition
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
   VLM 只输出结构化 levels、confidence 和 rationale，不输出最终分数。使用 `scripts/generate_judgment_fixtures.py` 将 judgments 缓存到 `fixtures/judgments/`，保证无 key 复现。

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

批量生成真实 corpus 的 VLM judgment fixtures：

```powershell
.\.venv\Scripts\python.exe scripts\generate_judgment_fixtures.py --limit 2
.\.venv\Scripts\python.exe scripts\generate_judgment_fixtures.py
```

生成后，用 fixture 路径批量评分和校准：

```powershell
.\.venv\Scripts\python.exe -m adint batch --provider fixture
.\.venv\Scripts\python.exe -m adint calibrate
```

查看 focal-like 权重调整建议：

```powershell
.\.venv\Scripts\python.exe scripts\tune_factor_weights.py
.\.venv\Scripts\python.exe scripts\tune_factor_weights.py --weak-alpha 5 --l2 0.001 --max-adjust 10
```

运行 v1 marketplace/listing 修复实验：

```powershell
.\.venv\Scripts\python.exe -m adint validate-spec --spec data\factors\phone_accessories_v1.yaml

.\.venv\Scripts\python.exe scripts\generate_judgment_fixtures.py `
  --spec data\factors\phone_accessories_v1.yaml `
  --out-dir fixtures\judgments_v1 `
  --limit 2

.\.venv\Scripts\python.exe scripts\generate_judgment_fixtures.py `
  --spec data\factors\phone_accessories_v1.yaml `
  --out-dir fixtures\judgments_v1 `
  --overwrite

.\.venv\Scripts\python.exe -m adint batch `
  --spec data\factors\phone_accessories_v1.yaml `
  --provider fixture `
  --fixture-dir fixtures\judgments_v1 `
  --out outputs\predictions_v1.csv

.\.venv\Scripts\python.exe -m adint calibrate --predictions outputs\predictions_v1.csv
```

注意：如果 `marketplace_listing_signal` 的文字定义发生变化，必须用 `--overwrite` 重新生成 `fixtures/judgments_v1/`，否则评分仍然基于旧 prompt 产生的 judgment。

如果生成中途遇到 GitHub Models rate limit，可以从失败的样本继续。例如失败在 `weak_case_003`：

```powershell
.\.venv\Scripts\python.exe scripts\generate_judgment_fixtures.py `
  --spec data\factors\phone_accessories_v1.yaml `
  --out-dir fixtures\judgments_v1 `
  --overwrite `
  --start-at weak_case_003 `
  --sleep 3 `
  --max-retries 6 `
  --retry-sleep 90
```

这里必须保留 `--overwrite`，因为 `fixtures/judgments_v1/` 中失败点之后可能还是旧 prompt 生成的文件。

## Repository Map

- `adint/`：CLI、judge provider、spec loading、scoring
- `data/factors/phone_accessories_v0.yaml`：v0 factor table
- `data/factors/phone_accessories_v1.yaml`：v1 factor table with marketplace/listing penalty
- `data/factor_mining.csv`：人工 factor mining 结果
- `data/corpus_manifest.csv`：图片来源、split、label
- `data/labels/labels.csv`：标签和标注理由
- `fixtures/judgments/`：缓存 judgments
- `fixtures/judgments_v1/`：v1 judgment cache after regeneration
- `reports/REPORT_TEMPLATE.md`：最终报告模板
- `scripts/WORKPLAN.md`：24 小时计划
- `scripts/generate_judgment_fixtures.py`：批量生成 VLM judgment fixtures
- `scripts/tune_factor_weights.py`：focal-like calibration 权重诊断
- `tests/`：评分逻辑测试

## 当前数据来源

当前 corpus 来自公开页面和公开广告/商品来源，包括：

- CASETiFY 官网
- OtterBox 官网
- PITAKA 官网
- KAPAVER 官网
- Meta Ad Library
- Amazon
- Taobao / Tmall
- JD
- eBay
- 1688

部分 Meta Ad Library 样本没有保留具体广告 URL，因此 manifest 中使用官方广告库首页并在 notes 中说明 provenance 限制。
