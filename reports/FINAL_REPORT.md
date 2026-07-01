# Ad Intelligence 最终报告

## 1. 类目与假设

- 类目：手机壳 / phone accessories。
- 选择原因：手机壳广告里 strong / weak 的视觉差异比较容易观察。强广告通常有明确卖点、使用场景、品牌语境或 campaign copy；弱图常见于 marketplace listing、商品主图、拼图或孤立产品展示。
- strong creative：来自品牌官网、广告库或品牌 campaign，能在移动 feed 中快速表达产品、卖点和购买理由。
- weak creative：更像普通电商商品图，产品可能清楚，但缺少广告意图、具体利益点或清晰叙事。

## 2. Corpus

当前 corpus 使用 40 张公开图片：

| Split | Strong | Weak | Total | 用途 |
| --- | ---: | ---: | ---: | --- |
| Train / calibration | 15 | 15 | 30 | 调 factor、分析错误、选择 threshold |
| Holdout / test | 5 | 5 | 10 | 只报告固定方案结果，不用于调参 |
| Total | 20 | 20 | 40 | 完整评估集 |

所有图片都记录在 `data/corpus_manifest.csv` 这个 corpus 主索引表中，包含来源 URL、品牌/来源、`local_path`（本地图片路径）、`split`（train 或 holdout/test）和 `label`（人工 strong/weak 标签）。图片来自公开页面或公开广告/商品来源，包括 Meta Ad Library、品牌官网、Amazon、Taobao/Tmall、JD、eBay、1688 等。

## 3. 标注设计

我使用两层标注：

- 二分类标签：`strong` / `weak`，存放在 `data/labels/labels.csv` 这个人工标签表中，用于衡量最终分数是否能把强广告排在弱图前面。
- factor-level gold labels：人工标注每张图的离散 factor level，存放在 `data/factor_mining.csv` 这个人工 factor gold 表中，用于衡量 VLM judgment 是否和人工观察一致。

二分类标签能快速评估 score separation，factor gold labels 能检查模型是不是只会写合理解释，而是真的能落到可复核的 factor level。

## 4. Factor System

评分规则是 spec-as-data，而不是写死在代码中：

- v0：`data/factors/phone_accessories_v0.yaml`，保存 baseline factor、level、points 和 corpus evidence。
- v1：`data/factors/phone_accessories_v1.yaml`，在 v0 基础上加入 marketplace/listing 惩罚规则。

VLM 只负责输出离散 level，例如 `product_prominence=hero`。Python 代码根据 YAML points 做确定性计算，输出 0-100 分和 per-factor attribution；这里的 attribution 指每个 factor 贡献了多少 points，以及对应的 VLM rationale，方便追溯为什么一张图得高分或低分。

v1 的核心变化是新增 `marketplace_listing_signal`，用于判断图片是否真的有 campaign/ad idea，还是只是普通电商 listing / catalog shot。原因是 v0 错误分析发现：干净的 marketplace 商品图经常被 `product_prominence`、`use_case_context`、`visual_hierarchy`、`contrast_and_legibility` 等正向 factor 叠加加分，导致 weak 图被误判为高分。

## 5. Working Engine

当前项目可以用命令行完整复现评分和校准流程：

- `scripts/generate_judgment_fixtures.py`：调用 VLM，把真实图片转换成结构化 factor-level judgments。VLM 只输出 level、confidence 和 rationale，不直接输出最终分数。
- `fixtures/judgments/` 和 `fixtures/judgments_v1/`：缓存 v0/v1 的 VLM judgments，让评审者没有 API key 也能复现后续评分。
- `adint` CLI：提供 `score`、`batch`、`calibrate`、`validate-spec` 等命令，支持单图评分、批量评分、校准和 YAML spec 校验。
- `scripts/run_fixture_calibration.py`：无 API 复现脚本，读取 cached fixtures，重新生成 v0/v1 predictions 并运行 calibration audit。
- `scripts/export_report_tables.py`：把 calibration、confusion matrix、Judge Agreement 和 drift test 导出成 `reports/` 下的 Markdown / CSV 表格。

评分链路是：image -> VLM/fixture judgment -> YAML points lookup -> raw points -> 0-100 score -> per-factor attribution。这样可以保证模型判断和最终数学评分分离，也能解释每张图为什么得分高或低。

## 6. Calibration

严格协议：

- 在 `train` 上调整 factor 描述、points 和 threshold。
- 在 `holdout/test` 上只报告固定方案的结果。
- `holdout` 自己的 best threshold 只作为诊断，不作为调参依据。

完整表格见：

- `reports/CALIBRATION_TABLES.md`：GitHub 可直接阅读的 calibration 总表。
- `reports/calibration_metrics.csv`：v0/v1 的 all、train、holdout 指标表。
- `reports/train_holdout_protocol.csv`：train-selected threshold 在 holdout/test 上的 accuracy、precision、recall、F1、FP/FN。
- `reports/confusion_matrix.csv`：train-selected threshold 下的 train / holdout 混淆矩阵，用于直接查看 strong/weak 被判到哪一类。
- `reports/judge_agreement.csv`：VLM factor levels 与人工 factor gold labels 的一致率。

这些表格由 `scripts/evaluate_calibration.py` 和 `scripts/export_report_tables.py` 生成。它们读取 `outputs/predictions.csv` 和 `outputs/predictions_v1.csv` 中的逐样本分数，再结合 `data/labels/labels.csv` 的人工 strong/weak 标签，分别计算全量分离指标、train-selected threshold、holdout/test 分类指标、混淆矩阵和 Judge Agreement。

### 6.1 Before / After

表中 `Strong mean` 是 strong 样本平均分，`Weak mean` 是 weak 样本平均分，`Gap` 是两者差值，`Pairwise` 是随机 strong 样本分数高于随机 weak 样本的比例，`Acc @ 50` 是固定 50 阈值下的二分类准确率。

| Version | Split | Strong mean | Weak mean | Gap | Pairwise | Acc @ 50 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| v0 | all | 74.4 | 63.0 | 11.4 | 0.665 | 0.525 |
| v1 | all | 77.1 | 54.0 | 23.1 | 0.780 | 0.650 |
| v1 | holdout | 84.0 | 58.8 | 25.2 | 0.880 | 0.600 |

v1 相比 v0：

- `weak_mean` 从 63.0 降到 54.0。
- `mean_gap` 从 11.4 提升到 23.1。
- `pairwise_separation` 从 0.665 提升到 0.780。
- `accuracy_at_50` 从 0.525 提升到 0.650。

### 6.2 Train -> Holdout Protocol

这一组指标是 calibration 里最重要的部分，因为它检验的是“只用 train 做选择，然后把固定方案拿到 holdout/test 上看表现”。其中：

- `Train threshold`：只在 train/calibration split 上选出的最佳分数阈值。
- `Train acc` / `Train F1`：该阈值在 train 上的准确率和 F1，用于说明调参集表现。
- `Holdout acc`：固定同一个阈值后，在 holdout/test 上的总体准确率。
- `Holdout precision`：被系统判为 strong 的图片中，真正 strong 的比例；低 precision 代表 weak false positive 较多。
- `Holdout recall`：真实 strong 图片中，被系统找出来的比例；低 recall 代表 strong false negative 较多。
- `Holdout F1`：precision 和 recall 的平衡指标。
- `Holdout FP/FN`：FP 是 weak 被误判为 strong，FN 是 strong 被误判为 weak，用于定位错误类型。

| Version | Train threshold | Train acc | Train F1 | Holdout acc | Holdout precision | Holdout recall | Holdout F1 | Holdout FP | Holdout FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v0 | 69 | 0.667 | 0.643 | 0.800 | 0.800 | 0.800 | 0.800 | 1 | 1 |
| v1 | 54 | 0.800 | 0.800 | 0.700 | 0.625 | 1.000 | 0.769 | 3 | 0 |

解释：

- v0 在 train 上选出的 threshold 是 69；固定到 holdout/test 后，accuracy / precision / recall / F1 都是 0.800，错误为 1 个 FP 和 1 个 FN。
- v1 在 train 上选出的 threshold 是 54；固定到 holdout/test 后，recall 是 1.000，说明 strong 没有漏掉。
- v1 的 precision 是 0.625，说明仍有 3 张 weak 被判成 strong。这和错误案例中的 polished weak false positives 一致，是当前系统最主要的剩余问题。
- 这组结果说明：v1 明显改善了整体分数分离和 weak 平均分，但按照 train-selected threshold 做二分类时，holdout 上仍然需要继续降低 polished weak 的误报。

对应的 holdout/test 混淆矩阵如下，行是真实人工标签，列是系统预测标签：

| Version | Threshold | Actual label | Predicted weak | Predicted strong | Total |
| --- | ---: | --- | ---: | ---: | ---: |
| v0 | 69 | weak | 4 | 1 | 5 |
| v0 | 69 | strong | 1 | 4 | 5 |
| v1 | 54 | weak | 2 | 3 | 5 |
| v1 | 54 | strong | 0 | 5 | 5 |

v1 没有漏掉 strong，但把 3/5 的 holdout weak 误判成 strong。因此下一步不是继续提高 recall，而是针对 polished weak listing 降低 false positives。

### 6.3 Judge Agreement

| Version | Manual factors | Matches | Total | Agreement |
| --- | ---: | ---: | ---: | ---: |
| v0 | 7 | 196 | 280 | 0.700 |
| v1 | 8 | 227 | 320 | 0.709 |

`marketplace_listing_signal` 单项 agreement 是 29/40 = 0.725。这个结果说明新增 factor 方向有效，但还不完美，尤其在 polished product shot 和真实 campaign visual 的边界上仍有主观性。

## 7. 错误案例分析

下面的error记录了每个 case 的期望、实际、证据、失败原因和下一步修复方向。提交到仓库中的汇总证据来自 `reports/*.csv` 表格和 `fixtures/judgments*.json` 这些 VLM judgment 缓存；逐样本 score / raw_points 可通过运行 `scripts/run_fixture_calibration.py` 这个无 API 复现脚本重新生成到 `outputs/predictions.csv` 和 `outputs/predictions_v1.csv`。

### Error Case 1: `weak_case_002`，v1 成功修复的 weak false positive

- 人工标签：`weak`
- v0 分数：89
- v1 分数：49
- v1 判断：`marketplace_listing_signal=generic_listing`
- 证据：v1 rationale 将它描述为 marketplace listing / catalog shot / sales-page asset。
- 失败原因：v0 中它被 `hero`、`clean`、`high contrast` 等 factor 同时加分。问题不是商品不可见，而是它太像干净商品主图，缺少 campaign idea。
- 修复效果：v1 新增 listing 惩罚后，分数从 89 降到 49，已经低于 train-selected threshold=54。
- 后续动作：保留 `marketplace_listing_signal`，并继续用类似样本验证它是否稳定识别 listing 风格。

### Error Case 2: `weak_case_012`，v1 仍然过高的 polished weak 图

- 人工标签：`weak`
- v0 分数：100
- v1 分数：96
- v1 判断：`marketplace_listing_signal=ambiguous`
- 证据：fixture 中 VLM 给出 `hero`、`in_use`、`specific`、`clean`、`tactile`、`credible`、`high`。rationale 提到手持场景、MagSafe feature、Apple logo、清晰主体边界，同时也承认它 “lacks clear ad copy or narrative context”。
- 失败原因：v1 已经不再把它当成 `campaign_like`，但其他正向 factor 叠加太强，仍然把分数推到 96。也就是说，单个 listing factor 的 -10 惩罚不足以抵消 polished product shot 的多个正向信号。
- 修复方向：加入 interaction penalty，例如当 `marketplace_listing_signal` 不是 `campaign_like`，且 benefit 主要来自 MagSafe/Apple logo/手持展示时，降低 `benefit_clarity`、`brand_trust_signal` 或 `use_case_context` 的叠加收益。

### Error Case 3: `weak_case_013`，同类 polished weak failure

- 人工标签：`weak`
- v0 分数：100
- v1 分数：96
- v1 判断：`marketplace_listing_signal=ambiguous`
- 证据：`fixtures/judgments_v1/weak_case_013.json` 中的 rationale 为 polished but lacks explicit ad copy or narrative。也就是说模型已经知道它缺少明确广告文案/叙事，但 score 仍然很高。
- 失败原因：当前 factor table 更像加法模型，每个正向 factor 独立加分。对于高质量商品图，只要主体清楚、手持、质感好、对比强，就会获得接近广告图的分数。
- 修复方向：把 `campaign_like` 从普通加分项升级为 gating / cap 机制。例如：如果没有 campaign intent，则最终分数上限限制在某个范围，除非同时出现明确 benefit claim 和品牌 campaign context。

### Error Case 4: `weak_case_016`，marketplace penalty 不足

- 人工标签：`weak`
- v0 分数：78
- v1 分数：96
- v1 判断：`marketplace_listing_signal=ambiguous`
- 证据：v1 rationale 指出它 polished but lacks clear campaign context。
- 失败原因：它有手持、质感、清晰视觉层级，所以多个正向 factor 被触发；但缺少广告叙事。v1 的 `ambiguous=0` 只是停止额外加分，没有主动拉低这类样本。
- 修复方向：把 `ambiguous` 从 0 调成轻微负分，或增加 “polished listing without campaign context” 的单独 penalty level。

### Error Case 5: `strong_case_011`，边界 strong false negative

- 人工标签：`strong`
- v0 分数：34
- v1 分数：29
- v1 判断：`marketplace_listing_signal=generic_listing`
- 证据：fixture 中 VLM 输出 `present`、`isolated`、`absent`、`busy`、`none`、`medium`，并解释为 product display without campaign context。
- 失败原因：从来源/人工意图看它被标成 strong，但单图视觉确实更像商品结构展示，不像完整 campaign creative。模型只看图片，不知道来源上下文，因此把它判成 listing-like 是合理但和人工标签冲突的边界样本。
- 修复方向：这类样本需要更清晰的 labeling rule。如果 strong 主要来自“来源是品牌/广告库”，但视觉本身弱，应降为 `ambiguous` 或增加 pairwise preference 标签，而不是强行要求 scorer 给高分。

## 8. Drift And Determinism

Drift test 实现在 `scripts/run_drift_test.py`，用于对同一张图重复调用 VLM，检查 factor level 和 score 是否稳定。表格见：

- `reports/DRIFT_TEST_TABLE.md`：GitHub 可直接阅读的 drift summary 和 run-level 表格。
- `reports/drift_test_summary.csv`：每张测试图的分数范围和 changed factors。
- `reports/drift_test_runs.csv`：每一次重复运行的 factor levels 明细。

当前运行结果：

| Image | Runs | Score min | Score max | Changed factors |
| --- | ---: | ---: | ---: | --- |
| `strong_case_003` | 10 | 100 | 100 | none |
| `weak_case_002` | 10 | 29 | 49 | `contrast_and_legibility`, `product_prominence`, `visual_hierarchy` |

结论：

- 明确 strong 样本稳定，score 没有漂移。
- 边界 weak 样本的核心 listing 判断稳定，`marketplace_listing_signal=generic_listing` 10/10 一致。
- 分数波动来自 `product_prominence`、`visual_hierarchy`、`contrast_and_legibility` 这类视觉边界 factor；其中 run 1 更保守，给出 `present` / `busy` / `medium`，其余 9 次给出 `hero` / `clean` / `high`。

产品建议：缓存 VLM judgments，pin model / temperature，并对接近阈值或 changed factors 的样本做复核，避免用户看到分数来回跳。

## 9. From Deficit To Fix

生成 agent 不应该直接看到最终分数，而应该消费 per-factor attribution。低分 factor 转成具体 brief 修改：

- `benefit_clarity=absent`：增加一个明确 buyer benefit，例如 drop protection、MagSafe strength、slim profile。
- `marketplace_listing_signal=generic_listing`：把普通商品陈列改成 campaign idea，例如 launch banner、benefit-linked lifestyle scene、brand-owned copy。
- `visual_hierarchy=busy`：减少装饰元素，明确 product -> benefit copy -> CTA 的视觉顺序。
- `contrast_and_legibility=medium/low`：提高移动 feed 下的主体边界和文字可读性。

验证方式必须和生成分离：先用 scorer 预测 improvement，再用人工 pairwise、另一个 pinned VLM judge 或后续 A/B 数据验证 improvement。不能让同一个生成 agent 给自己的图打分。

## 10. AI 工具使用

AI 工具主要用于：

- 搭建 Python CLI 和 spec-as-data 结构。
- 帮助整理 factor spec 初稿。
- 协助总结错误案例和 README/report。

人工保留决策的部分：

- strong/weak 标签。
- `marketplace_listing_signal` 的人工 gold labels。
- 是否接受 YAML 修改。
- 错误案例的最终解释。

我不完全信任 VLM 的地方：

- 它容易把 Apple logo、MagSafe 圆环、手持商品图和干净商品摄影当成强广告信号。
- 因此 v1 明确把这些写成 `campaign_like` 的排除条件，并用 fixtures 固化复现。

## 11. With One More Week

- 扩到 400+ 张图片，并拆出独立 train / validation / test。
- 加 pairwise preference 标签，避免只靠 binary strong/weak。
- 给主要指标加 bootstrap confidence interval，避免 10 张 holdout 被单个样本影响过大。
- 做 factor ablation，确认哪些 factor 真有增益，哪些只是噪声。
- 扩大 drift test 到更多边界样本和至少两个 VLM provider。
- 把 deficit-to-fix agent 做成真实命令，并用人工 pairwise 或离线 A/B 数据验证生成图是否真的更好。
