# 测试记录

记录日期：2026-07-09

## 一键运行

运行全部自动化测试：

```bash
npm test
```

按测试层级运行：

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

运行第一阶段 Persistence 相关 API 测试：

```bash
npm test -- tests/persistence-api.test.ts
npm test -- tests/integration/persistence-api.test.ts
```

运行第二阶段健康算法单元测试：

```bash
npm test -- tests/unit/health-calculator.test.ts
```

运行第二阶段 Prisma/PostgreSQL 持久化集成测试：

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_assessment_test?schema=public"
npm run db:push
npm test -- tests/integration/assessment-submit-result.test.ts
```

运行第三阶段订阅鉴权与支付闭环测试：

```bash
npm test -- tests/integration/result-access-payment.test.ts
```

运行完整 API funnel E2E：

```bash
npm run test:e2e
```

说明：如果没有设置 `TEST_DATABASE_URL` 或 `DATABASE_URL`，Prisma 集成测试会被标记为 skipped，避免误连非测试数据库。配置测试库后，该测试使用 `PrismaAssessmentStore` 和真实数据库表，不使用内存 store。

如果需要同时检查 TypeScript 类型：

```bash
npm run ci
```

最近一次本地结果：

- `npm run typecheck`：通过
- `npm test`：通过
- 测试文件：7 个通过，1 个因未配置测试数据库跳过
- 测试用例：96 个通过，7 个因未配置测试数据库跳过
- 第一阶段 API 测试文件：`tests/persistence-api.test.ts`，22 个用例通过
- 第一阶段补充校验文件：`tests/integration/persistence-api.test.ts`，11 个用例通过
- 第二阶段算法测试文件：`tests/unit/health-calculator.test.ts`，41 个用例通过
- 第二阶段 Prisma 集成测试文件：`tests/integration/assessment-submit-result.test.ts`，配置 `TEST_DATABASE_URL` 后运行
- 第三阶段访问控制测试文件：`tests/integration/result-access-payment.test.ts`，Memory API 用例通过；Prisma 数据库用例配置 `TEST_DATABASE_URL` 后运行
- API E2E 测试文件：`tests/e2e/full-funnel-flow.test.ts`，1 个完整 funnel 用例通过

## 覆盖的核心流程

本阶段测试聚焦用户匿名测评数据的保存与恢复，不覆盖结果计算、支付、会员鉴权等后续阶段。

已覆盖接口：

- `POST /api/v1/sessions`：创建匿名 session。
- `PATCH /api/v1/sessions/{sessionId}/assessment-steps/{stepKey}`：保存单个 quiz step。
- `GET /api/v1/sessions/{sessionId}/progress`：恢复已填写进度。

已覆盖核心流程：

- 创建匿名 session 后，初始 progress 为空，`nextStep` 为 `GENDER`。
- 前端每完成一步时，后端只保存当前 step 的增量数据。
- 用户中断后，通过 progress 接口恢复 `completedSteps`、`nextStep` 和合并后的 `draft`。
- 每次成功 PATCH 后，assessment `version` 递增。
- PATCH 请求必须携带当前 `version` 和当前 step 的 `data`。
- 缺少 `version`、缺少 `data`、未知 stepKey 会被拒绝。
- 数字字段传字符串、null、object、array 或畸形 JSON 会被拒绝，且不会污染 progress。
- 危险 sessionId 字符串不会被解析成其他资源。

## 分步保存与进度恢复场景

`tests/persistence-api.test.ts` 显式验证了这些场景：

- 保存 `GENDER` 后，`GET progress` 能恢复 `draft.gender`。
- 保存 `GOALS`、`BODY`、`ACTIVITY` 后，`GET progress` 能恢复完整 draft。
- 重复提交同一步相同数据时，`completedSteps` 不会重复。
- 重复提交同一步不同数据时，以后一次数据为准。
- 乱序提交可以保存，例如先提交 `BODY`，再提交 `GENDER`。
- 乱序提交后，`currentStep` 不会从较后的 step 倒退到较早的 step。
- 两次连续 PATCH 后，`version` 正确从 0 递增到 1，再递增到 2。

## Version 乐观锁覆盖

本阶段新增了 version 乐观锁，防止旧页面或并发请求覆盖较新的测评数据。

测试覆盖：

- 创建 session 后，初始 `version = 0`。
- 第一次 PATCH 成功后，响应中的 `version = 1`。
- 第二次 PATCH 使用最新 version 成功后，响应中的 `version = 2`。
- 使用旧 version 再次 PATCH 时，接口返回 `409 CONFLICT`。
- 旧 version 请求失败后，再次 `GET progress`，确认原有数据没有被覆盖。
- assessment 提交后状态为 `RESULT_READY`，继续 PATCH 返回 `409 CONFLICT`。

当前实现是乐观锁，不是数据库悲观锁。Prisma store 会在事务内检查当前 `Assessment.version` 和 status；内存 store 在测试中使用同样的业务规则，保证本地测试和生产逻辑一致。

## 显式验证的边界与异常

已覆盖的异常路径：

- 缺少 `sessionId` 时返回 400。
- 不存在的 `sessionId` 返回 404。
- 旧页面或并发请求携带旧 `version` 时返回 409。
- assessment 提交为 `RESULT_READY` 后继续 PATCH，返回 409。
- 非法输入返回 400，并且不会污染已保存 progress。

非法输入覆盖：

- `age = -1`
- `age = 200`
- `heightCm = 0`
- `heightCm = -180`
- `weightKg = 0`
- `weightKg = -60`
- `targetWeightKg > weightKg` 且 `primaryGoal = lose_weight`
- `gender = "alien"`
- `exerciseFrequency = "every_second"`

对“不会污染数据”的验证方式：

- 非法请求返回 400 后，再调用 `GET progress`。
- 断言对应 step 没有出现在 `completedSteps` 中。
- 断言非法字段没有进入 `draft`。
- 对目标体重大于当前体重的减重场景，保留已合法保存的 `GOALS`，但不保存非法 `BODY`。
- 对 malformed numeric payload，断言 `BODY` 不进入 `completedSteps`，`draft` 仍为空。

## 为什么选择这些场景

这些测试场景对应第一阶段最容易影响数据一致性的风险：

- 匿名 session 是后续所有测评数据的归属依据，必须先验证创建和空 progress。
- 分步保存是 funnel 中最高频的写入路径，必须验证每一步只保存自己的增量数据。
- 进度恢复直接影响用户中断后能否继续填写，需要验证 `completedSteps`、`nextStep` 和 `draft`。
- 重复提交常见于用户重复点击、网络重试或浏览器重放，需要保证不会产生重复 step。
- 乱序提交可能来自前端跳步、接口重试或延迟请求，需要保证恢复结果仍然稳定。
- version conflict 用来防止旧页面或并发请求覆盖新数据，是本阶段最关键的一致性保护。
- 非法输入不只要返回错误，还要验证没有部分写入，避免污染后续结果计算。

## 第二阶段 Core Logic 测试

第二阶段测试聚焦“服务端计算 + 结果持久化”，确保结果不是前端传入，也不是只停留在内存返回值中。

### 健康算法单元测试

测试文件：`tests/unit/health-calculator.test.ts`

覆盖内容：

- 正常男性用户：BMI、BMR、TDEE、dailyCalories、targetDate。
- 正常女性用户：BMI、BMI 分类、BMR、TDEE、dailyCalories、targetDate。
- `gender = other`，以及旧值 `non_binary`、`prefer_not_to_say`，会按 other 使用男女 BMR 平均值。
- 不同 `exerciseFrequency` 会产生不同 TDEE。
- `lose_weight` 会降低 dailyCalories，`gain_muscle` 会提高 dailyCalories。
- 旧 goal 映射：`maintain_health -> maintain`、`build_strength -> gain_muscle`、`improve_mobility -> improve_fitness`。
- BMI 分类边界：18.4、18.5、24.9、25.0、29.9、30.0。
- 非法输入：缺失、0、负数、超范围、字符串、NaN、Infinity。
- 跨字段规则：减重目标体重不能大于等于当前体重；增肌目标体重不能明显低于当前体重。
- dailyCalories 统一不低于 1200。
- targetWeightKg 等于当前体重时，targetDate 为当前日期，不产生负数时间。

### Submit 持久化集成测试

测试文件：`tests/integration/assessment-submit-result.test.ts`

该测试必须连接 PostgreSQL 测试库后才会执行。它验证：

- assessment 未填写完整时，`submitAssessment` 失败，并且不创建 `HealthResult`。
- assessment 完整时，submit 调用服务端健康算法并创建 `HealthResult`。
- `HealthResult.assessmentId` 正确关联当前 `Assessment`。
- 可以通过 `HealthResult -> Assessment -> User` 反查当前 sessionId。
- submit 成功后 `Assessment.status` 变为 `RESULT_READY`。
- 数据库中能查到 `bmi`、`dailyCalories`、`targetDate`、`bmr`、`tdee`、`summary`。
- 同一个 assessment 重复 submit 不会创建多个 `HealthResult`，依赖 `assessmentId` 唯一键和 upsert。
- 如果非法身体数据绕过前端直接进入数据库，submit 仍会拒绝，并且不会创建 result。
- submit 失败后 assessment 保持 `DRAFT`，`completedAt` 仍为空，避免半更新。
- submit 成功后，通过结果读取 workflow 能读取刚刚持久化的完整结果。

选择这些场景的原因：

- 算法是结果页、权限控制和付费价值的核心，必须用纯函数单元测试把公式和边界固定下来。
- 持久化测试需要真实 Prisma/PostgreSQL，因为只测 memory store 不能证明 `HealthResult.assessmentId`、唯一键、upsert 和数据库反查关系是正确的。
- submit 失败不应部分更新，否则用户可能看到 `RESULT_READY` 但没有 result，或者产生无法恢复的脏状态。

## 第三阶段 Auth & Access 测试

第三阶段测试聚焦“订阅鉴权 + 差异化返回 + `/pay` 支付闭环”。权限过滤发生在服务端，前端只消费已经过滤后的 response。

测试文件：`tests/integration/result-access-payment.test.ts`

覆盖内容：

- 已 submit 但未付费时，`GET result` 返回 `access = LOCKED`。
- LOCKED response 只包含 `bmi`、`bmiCategory`、安全版 `summary` 和 paywall message。
- LOCKED response 的全量 JSON 字符串中不出现 protected field key：`dailyCalories`、`targetDate`、`bmr`、`tdee`、`predictionCurve`、`weeklyPlan`。
- paywall 文案不直接暴露 protected field key，只使用用户可读的权益描述。
- `includeFull=true`、`debug=true`、`admin=true`、`subscriptionStatus=ACTIVE` 这些 query 参数不能绕过服务端权限过滤。
- 调用 `/pay` 后，再次 `GET result` 从 `LOCKED` 变为 `FULL`。
- FULL response 返回完整字段：`dailyCalories`、`targetDate`、`bmr`、`tdee`、`summary`、`predictionCurve`。
- 客户端在 `/pay` request body 中伪造 `subscriptionStatus = ACTIVE` 不会影响其他未付费 session 的真实权限。
- 异常路径：缺少 sessionId 返回 400，不存在 sessionId 返回 404，assessment 未 submit 时 GET result 或 `/pay` 返回 409。
- `/pay` 要求 `idempotencyKey`，缺失、空字符串、超长字符串、明显非法字符会返回 400。
- `/api/v1/payments/mock-callback` 与 `/pay` 共用同一个支付 workflow，并覆盖缺少 sessionId、缺少 idempotencyKey、不存在 session、未 submit、成功支付后返回 FULL。
- `amount` 和 `currency` 不是必填；如果传入非法值，例如 `amount = 0`、`amount = -1`、`amount = "abc"`、`currency = ""`、`currency = "XXX"`，接口返回 400。
- 同一个 session 重复使用相同 `idempotencyKey` 是幂等的；使用不同 `idempotencyKey` 会记录新支付事件，但 subscription 仍保持 `ACTIVE`。
- 已付费 session 和未付费 session 隔离：只支付 A 不会解锁 B，B 的 LOCKED response 仍不包含 protected fields。

Prisma/PostgreSQL 部分在配置 `TEST_DATABASE_URL` 后额外验证：

- `/pay` workflow 会真实写入 `User.subscriptionStatus = ACTIVE`。
- `Subscription.status = ACTIVE`，且 `activatedAt`、`currentPeriodEnd` 有值。
- `PaymentEvent` 被写入。
- 相同 `idempotencyKey` 重复调用时不重复创建 `PaymentEvent`。
- 不同 `idempotencyKey` 再次调用时当前策略是允许记录新事件，但 subscription 仍保持 `ACTIVE`。

## API E2E 测试

测试文件：`tests/e2e/full-funnel-flow.test.ts`

该测试不依赖浏览器，直接走 API route handler，覆盖：

- `POST /api/v1/sessions` 创建 session。
- 四次 `PATCH /assessment-steps/{stepKey}` 保存 gender、goals、body、activity。
- `GET /progress` 恢复完整 draft。
- `POST /assessment/submit` 生成服务端结果。
- submit 后 `GET /results` 返回 `LOCKED`，且不泄露 protected fields。
- `POST /pay` 激活订阅。
- 再次 `GET /results` 返回 `FULL`，并包含完整计划字段。

选择这些场景的原因：

- 结果页是付费拦截点，最重要的风险是非会员拿到完整计划字段，因此需要检查整个 JSON 字符串，而不是只看顶层字段。
- `/pay` 必须改变持久化状态，否则只是 mock response，无法证明闭环真实成立。
- 幂等支付能避免浏览器重试、网络重放或第三方回调重复导致重复事件或异常状态。

## 暂未覆盖及原因

- CI 中强制执行 PostgreSQL 集成测试：项目已经提供 Prisma 集成测试，但当前本地未配置测试数据库时会 skipped。CI 要强制执行，需要增加 PostgreSQL service 并设置 `TEST_DATABASE_URL`。
- 浏览器 E2E：当前已有 API 级 E2E；尚未用 Playwright 驱动真实浏览器关闭/重开页面。原因是本项目评分重点是后端接口、持久化和权限逻辑，浏览器自动化可以作为后续补充。
- 多设备恢复：当前 sessionId 保存在浏览器 `localStorage`，未覆盖跨设备或清缓存后的恢复。原因是需求允许基于简易 session 识别，当前实现不包含登录态或账号绑定。
- 严格数据库级并发写入冲突：已测试旧 `version` 返回 409，但没有用真实数据库并发事务模拟两个请求同时命中同一版本。原因同上，需要 PostgreSQL 集成测试环境。

## 手动接口检查

本地启动：

```powershell
npm run dev
```

创建 session：

```powershell
$progress = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/sessions"
$sessionId = $progress.sessionId
```

保存性别步骤：

```powershell
$genderBody = @{
  version = $progress.version
  data = @{ gender = "female" }
} | ConvertTo-Json -Depth 4

Invoke-RestMethod `
  -Method Patch `
  -Uri "http://localhost:3000/api/v1/sessions/$sessionId/assessment-steps/gender" `
  -ContentType "application/json" `
  -Body $genderBody
```

恢复进度：

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/sessions/$sessionId/progress"
```

预期结果：

- `completedSteps` 包含 `GENDER`。
- `nextStep` 返回 `GOALS`。
- `draft.gender` 返回 `female`。
- `version` 从 0 递增到 1。
