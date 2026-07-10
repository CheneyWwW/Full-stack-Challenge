# AI 使用复盘

本项目的重点不是让 AI 直接生成一个能跑的表单，而是用 AI 协助完成后端工程骨架、边界测试和交付文档。我的使用方式更接近“架构与测试搭档”，而不是简单代码生成器。

## Funnel 解析

在开始实现前，我先参考 BetterMe Pilates 类 quiz funnel，观察它的数据流和转化节点：

- 哪些步骤收集用户画像数据，例如性别、年龄、目标、身体数据、运动频率。
- 哪些数据需要在每一步后持久化，避免用户中断后丢失。
- 哪些结果可以免费展示，哪些字段应该在订阅后解锁。
- 支付前后结果页的差异如何支撑后端权限过滤。

AI 帮我把这个 funnel 拆成工程阶段：

1. Persistence：分步保存和进度恢复。
2. Core Logic：服务端健康算法和结果持久化。
3. Auth & Access：订阅鉴权、非会员脱敏、会员完整结果。
4. Testing：用自动化测试证明每个阶段是对的。

## 数据库建模

我让 AI 根据评分标准先列出候选实体，再人工收敛为当前结构：

- `User`
- `Assessment`
- `AssessmentStep`
- `HealthResult`
- `Subscription`
- `PaymentEvent`

AI 的价值在于快速枚举关系和状态字段，例如 assessment status、subscription status、payment event idempotency key。最终我保留了 `AssessmentStep` 独立表和 JSON data 字段，因为它更适合 quiz funnel 的分步保存和后续扩展。

## Mock 数据

AI 协助生成了一组健康测评 demo 数据，然后我人工检查目标体重、年龄、身高、体重是否落在业务允许范围内。最终 seed 固定了三个 session：

- `demo_free_session`：已完成测评但未付费，用于查看 `LOCKED`。
- `demo_paid_session`：已完成且已付费，用于查看 `FULL`。
- `demo_pay_session`：已完成但未付费，用于演示 `/pay` 后从 `LOCKED` 变 `FULL`。

这些数据写入 `prisma/seed.ts`，并通过同一套 workflow 创建，不直接绕过业务逻辑写死结果。

## 复杂逻辑

AI 帮我起草了健康评估算法的基本公式：

- BMI = weightKg / heightM²
- BMI 分类边界
- Mifflin-St Jeor BMR
- activity factor 推导 TDEE
- 不同目标对 dailyCalories 做调整
- 按 0.5kg/week 估算 targetDate 和 predictionCurve

我在此基础上补了业务安全约束：

- dailyCalories 最低 1200。
- 身高、体重、年龄必须是有限数字。
- 减重目标的 targetWeightKg 必须小于当前 weightKg。
- 增肌目标不能明显低于当前体重。
- 旧 goal/gender 值做兼容映射，避免前后端命名变化导致历史数据断裂。

## 测试用例与边界场景

AI 帮我枚举了大量边界与异常路径，我把它们整理成 Vitest 自动化测试：

- 健康算法单元测试：正常路径、BMI 边界、NaN/Infinity、非法枚举、跨字段规则。
- Persistence 集成测试：中断恢复、乱序提交、重复提交、旧 version 冲突。
- 数据污染测试：非法输入返回 400 后，再读取 progress，确认非法字段没有进入 draft。
- Submit 持久化测试：完整 assessment 生成 HealthResult，失败时不产生半更新。
- 订阅鉴权测试：非会员 response 全量 JSON 不出现 protected field key。
- 支付闭环测试：`/pay` 后数据库状态变 `ACTIVE`，再次读取结果从 `LOCKED` 变为 `FULL`。
- 幂等测试：重复 idempotencyKey 不重复创建 `PaymentEvent`。
- Session 隔离测试：支付 A 不会解锁 B。

AI 的帮助主要是提高测试场景的覆盖面，但每个测试都需要人工判断是否真的对业务有价值，避免只测 happy path。

## 被否决的一次 AI 方案

AI 曾建议把所有问卷字段直接放在 `Assessment` 大表里，例如：

- `gender`
- `primaryGoal`
- `focusAreas`
- `age`
- `heightCm`
- `weightKg`
- `targetWeightKg`
- `activityFrequency`

我否决了这个方案。

原因是评分标准明确关注扩展性、分步保存、进度恢复和状态一致性。大表方案虽然实现更快，但会带来几个问题：

- 新增 quiz step 需要频繁改表和 migration。
- 重复提交、乱序提交和 step 级审计不清楚。
- 很难表达“某一步已完成但整体 assessment 未提交”的状态。
- 未来如果加入更多行为数据、设备数据、偏好数据，大表会迅速膨胀。

最终我采用 `AssessmentStep` 独立表保存每一步数据，并用 `Assessment.version` 做乐观锁。这让系统更接近真实 quiz funnel 后端，而不是一次性提交表单。

## AI 协作效率总结

在 3 天节奏里，AI 最有价值的部分是：

- 快速把题目拆成工程阶段和验收清单。
- 帮助发现边界场景和异常路径。
- 起草算法和测试，再由我收敛规则。
- 根据评分标准检查 README、Schema 图、测试说明和 AI 复盘是否完整。

但核心判断仍然需要人工完成，例如数据库建模取舍、哪些字段应该受保护、哪些测试是真正证明闭环的测试，以及哪些 AI 建议会破坏长期扩展性。
