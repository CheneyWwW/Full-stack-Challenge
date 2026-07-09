# 健康测评系统后端架构 Take-home

这是一个面向健康测评 funnel 的核心后端架构示例，包含可演示前端、Next.js API Routes、Prisma + PostgreSQL 数据模型、分步持久化、进度恢复、服务端健康评估、模拟订阅鉴权、支付回调闭环和自动化测试。

## 交付拆分

1. API 合同：定义专业的路径、方法、请求结构和响应结构。
2. 数据模型：使用 Prisma/PostgreSQL 建模 `User`、`Assessment`、`AssessmentStep`、`HealthResult`、`Subscription`、`PaymentEvent`。
3. 流程闭环：支持分步保存、进度恢复、提交计算、非会员脱敏、调用 `/pay` 后解锁完整结果。
4. 自动化质量：用 Vitest 覆盖算法边界、持久化恢复、乱序/重复/并发提交、鉴权差异和支付回调。
5. 交付说明：README 包含 API 文档、Schema 图、测试范围、部署方式和 AI 使用复盘。

## 快速启动

不配置数据库时，开发环境会使用内存 store，可以先跑通前端和 API 流程：

```bash
npm install
npm run dev
```

本地打开 `http://localhost:3000`，可以从头走完测评，先看到非会员脱敏结果，再点击模拟支付解锁完整结果。

如果要使用本地 PostgreSQL 持久化，请复制 `.env.example` 为 `.env`，把 `DATABASE_URL` 和 `DIRECT_URL` 从占位符改成真实本地连接串，然后运行：

```bash
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

本地开发如果没有配置 `DATABASE_URL`，服务会自动使用内存 store；配置 PostgreSQL 后会走 Prisma 持久化。线上交付必须配置真实 `DATABASE_URL` 和 `DIRECT_URL`。

一键质量验证：

```bash
npm run ci
```

## 本地调试记录

- 错误内容：PowerShell 中直接执行 `curl -X POST ...` 报 `Invoke-WebRequest` 参数错误；改用 `curl.exe` 后，`POST /api/v1/sessions` 返回 `INTERNAL_ERROR`，前端表现为选择后点击 Continue 无法继续。
- 排查过程：先确认 PowerShell 的 `curl` 是别名问题，再用 `curl.exe -i` 复现 500；检查 `.env` 后发现本地没有 `DATABASE_URL`，因此 Prisma 创建 session 时无法连接数据库。
- 修复方式：README 补充 PowerShell 可复制命令；后端在本地未配置 `DATABASE_URL` 时自动切换到内存 store；前端在 session 创建成功前禁用 Continue 并显示 `Starting...`。
- 使用工具：PowerShell、`curl.exe`、`Invoke-RestMethod`、`rg`、Next.js API 日志、Vitest、TypeScript typecheck。
- 最后结果：`POST /api/v1/sessions` 从 500 变为 `201 Created`；分步保存和进度恢复接口可用；`npm run typecheck` 与 `npm test -- tests/workflows.test.ts` 通过。

## 部署说明

推荐使用 Vercel + Supabase PostgreSQL。

```bash
npm run build
```

### Vercel 环境变量

在 Vercel Project Settings 中配置：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Supabase pooled PostgreSQL connection string，用于 Vercel 运行时连接数据库 |
| `DIRECT_URL` | Supabase direct PostgreSQL connection string，用于 Prisma migration |
| `NEXT_PUBLIC_APP_URL` | Vercel production URL，例如 `https://your-app.vercel.app` |

不要在 Vercel Production 配置 `TEST_DATABASE_URL`。它只用于本地测试或 CI，避免测试误连生产数据库。

`.env.example` 只提供占位符，不包含真实 Supabase 密码。真实连接串只放在本地 `.env` 或 Vercel 环境变量中。

### Supabase 初始化

1. 创建 Supabase project，并复制 pooled connection string 和 direct connection string。
2. 在 Vercel 配置 `DATABASE_URL`、`DIRECT_URL`、`NEXT_PUBLIC_APP_URL`。
3. 执行生产迁移：

```bash
npm run db:deploy
```

4. 写入演示数据：

```bash
npm run db:seed
```

生产环境使用 `npm run db:deploy`，不使用 `npm run db:push`。`db:push` 只适合本地开发或测试数据库快速同步 schema。

交付信息：

- 线上演示地址：`https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app`
- GitHub 仓库：`https://github.com/CheneyWwW/Full-stack-Challenge`
- 未付费测试 sessionId：`demo_free_session`，用于查看 `LOCKED` 结果
- 已付费测试 sessionId：`demo_paid_session`，用于直接查看 `FULL` 结果
- 支付演示 sessionId：`demo_pay_session`，用于调用 `/pay` 演示 `LOCKED -> FULL`

`/pay` 演示：

```bash
curl -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'
```

部署后验收 checklist：

- 打开 Vercel URL，手动走完整 quiz funnel。
- 如果浏览器里已经保存过旧 session，点击页面顶部 `Start over` 可清除本地 session 并重新开始一次完整 funnel。
- `GET $BASE_URL/api/v1/sessions/demo_free_session/results` 返回 `LOCKED`。
- `GET $BASE_URL/api/v1/sessions/demo_paid_session/results` 返回 `FULL`。
- `GET $BASE_URL/api/v1/sessions/demo_pay_session/results` 首次返回 `LOCKED`。
- 调用上面的 `/pay` curl。
- 再次 `GET $BASE_URL/api/v1/sessions/demo_pay_session/results` 返回 `FULL`。

## API 文档

PowerShell 注意：Windows PowerShell 里的 `curl` 默认是 `Invoke-WebRequest` 别名，不是真正的 curl。要么写 `curl.exe`，要么直接使用 `Invoke-RestMethod`。

所有错误响应统一为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid assessment step payload",
    "details": {}
  }
}
```

### 创建 Session

`POST /api/v1/sessions`

PowerShell：

```powershell
$progress = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/sessions"
$sessionId = $progress.sessionId
$sessionId
```

curl.exe：

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/sessions"
```

响应示例：

```json
{
  "sessionId": "clx...",
  "assessmentStatus": "DRAFT",
  "currentStep": null,
  "nextStep": "GENDER",
  "completedSteps": [],
  "version": 0,
  "draft": {}
}
```

### 分步保存

`PATCH /api/v1/sessions/{sessionId}/assessment-steps/{stepKey}`

`stepKey` 支持：`gender`、`goals`、`body`、`activity`。

请求示例：

PowerShell：

```powershell
$body = @{
  version = $progress.version
  data = @{
    age = 35
    heightCm = 165
    weightKg = 73
    targetWeightKg = 64
  }
} | ConvertTo-Json -Depth 4

Invoke-RestMethod `
  -Method Patch `
  -Uri "http://localhost:3000/api/v1/sessions/$sessionId/assessment-steps/body" `
  -ContentType "application/json" `
  -Body $body
```

curl.exe：

```powershell
curl.exe -X PATCH "http://localhost:3000/api/v1/sessions/$sessionId/assessment-steps/body" `
  -H "Content-Type: application/json" `
  --data-raw "{`"version`":$($progress.version),`"data`":{`"age`":35,`"heightCm`":165,`"weightKg`":73,`"targetWeightKg`":64}}"
```

`version` 必须等于当前 progress 返回的 `version`。如果旧页面或并发请求携带过期 version，接口返回 `409 CONFLICT`，避免覆盖新数据。

#### Version 乐观锁

分步保存使用 `Assessment.version` 做乐观锁：

- 创建 session 时，`version` 初始值为 `0`。
- 每次 `PATCH /assessment-steps/{stepKey}` 成功后，`version + 1`。
- 前端每次 PATCH 都必须带上当前 progress 返回的 `version`。
- 如果请求里的 `version` 不是当前最新值，接口返回 `409 CONFLICT`，不会覆盖已有数据。
- assessment 提交为 `RESULT_READY` 后，不允许继续修改分步数据，继续 PATCH 会返回 `409 CONFLICT`。

### 进度恢复

`GET /api/v1/sessions/{sessionId}/progress`

返回内容包括：已完成步骤、下一步、合并后的 draft 数据、当前版本号。

PowerShell：

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/sessions/$sessionId/progress"
```

### 提交测评

`POST /api/v1/sessions/{sessionId}/assessment/submit`

提交后服务端会计算并持久化：

- BMI
- BMI 分类
- BMR
- TDEE
- 建议每日摄入量
- 目标预测日期
- 结果摘要
- 按周生成的体重预测曲线

这些字段全部由服务端 `calculateHealthResult` 生成，前端不会提交也不能覆盖 `bmi`、`dailyCalories`、`targetDate` 等结果字段。

### 获取结果

`GET /api/v1/sessions/{sessionId}/results`

非会员只返回 `LOCKED` 预览数据。服务端只暴露 `bmi`、`bmiCategory`、`summary` 和 paywall 文案，不返回完整计划字段：

```json
{
  "access": "LOCKED",
  "requiresPayment": true,
  "subscriptionStatus": "FREE",
  "result": {
    "bmi": 26.81,
    "bmiCategory": "overweight",
    "summary": "Your BMI is 26.81 (overweight). Upgrade to unlock your complete personalized plan."
  },
  "paywall": {
    "message": "Upgrade to unlock your complete personalized plan.",
    "unlocks": [
      "personalized calorie target",
      "target timeline",
      "progress forecast",
      "weekly action plan"
    ]
  }
}
```

会员会返回 `FULL` 结果，包含 `bmr`、`tdee`、`dailyCalories`、`targetDate`、`summary`、`weeksToTarget`、`predictionCurve`。权限过滤发生在服务端，前端不能通过 query/body 伪造会员状态。

### 模拟支付回调

题目要求的快捷接口：

```powershell
$payBody = @{
  sessionId = "demo_free_session"
  idempotencyKey = "manual_demo_free_session"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/pay" `
  -ContentType "application/json" `
  -Body $payBody
```

正式命名接口：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/v1/payments/mock-callback" `
  -ContentType "application/json" `
  -Body $payBody
```

`/pay` 和 `/api/v1/payments/mock-callback` 共用同一个 `activateSubscription` workflow，避免两套支付逻辑。

支付接口要求 `sessionId` 和 `idempotencyKey`。只有 assessment 已提交并生成 `HealthResult` 后才允许支付，否则返回 `409 CONFLICT`。`amount` 和 `currency` 不是必填字段；如果请求体传入了这些字段，后端会校验非法值并返回 400。

回调会把 `User.subscriptionStatus` 和 `Subscription.status` 改为 `ACTIVE`，写入 `activatedAt`、`currentPeriodEnd`，并创建 `PaymentEvent`。重复提交相同 `idempotencyKey` 是幂等的，不会重复创建事件。

## 数据模型

```mermaid
erDiagram
  User ||--|| Assessment : owns
  User ||--o| Subscription : has
  User ||--o{ PaymentEvent : receives
  Assessment ||--o{ AssessmentStep : stores
  Assessment ||--o| HealthResult : produces

  User {
    string id PK
    enum subscriptionStatus
    datetime createdAt
    datetime updatedAt
  }

  Assessment {
    string id PK
    string userId FK
    enum status
    enum currentStep
    int version
    datetime completedAt
  }

  AssessmentStep {
    string id PK
    string assessmentId FK
    enum stepKey
    json data
    int position
    int version
  }

  HealthResult {
    string id PK
    string assessmentId FK
    float bmi
    string bmiCategory
    float bmr
    float tdee
    int dailyCalories
    datetime targetDate
    string summary
    int weeksToTarget
    json predictionCurve
  }

  Subscription {
    string id PK
    string userId FK
    enum status
    string provider
    datetime activatedAt
    datetime currentPeriodEnd
  }

  PaymentEvent {
    string id PK
    string userId FK
    string providerEventId UK
    string eventType
    json rawPayload
  }
```

设计取舍：

- `AssessmentStep.data` 使用 JSONB，便于后续新增问卷步骤，避免频繁修改大表结构。
- `Assessment.version` 和 `AssessmentStep.version` 用于支持重复提交、恢复和并发更新的可观察性；分步保存会检查 `Assessment.version`，旧版本请求返回 409。
- `PaymentEvent.providerEventId` 唯一，保证支付回调幂等。
- `HealthResult.bmr`、`tdee`、`summary` 是 nullable 新增字段，避免迁移破坏历史结果；新提交会写入完整值。
- `HealthResult.predictionCurve` 是受保护字段，非会员接口不会返回。

## 测试覆盖

运行测试：

```bash
npm test
```

按测试层级运行：

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

运行真实 Prisma/PostgreSQL 持久化集成测试：

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_assessment_test?schema=public"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:DIRECT_URL=$env:TEST_DATABASE_URL
npm run db:push
npm test -- tests/integration/assessment-submit-result.test.ts
```

运行订阅鉴权和 `/pay` 闭环测试：

```bash
npm test -- tests/integration/result-access-payment.test.ts
```

运行完整 API funnel E2E：

```bash
npm run test:e2e
```

Prisma 数据库断言只读取 `TEST_DATABASE_URL`。如果没有设置 `TEST_DATABASE_URL`，相关集成测试会被 Vitest 标记为 skipped；测试不会 fallback 到 `DATABASE_URL`，避免误连 Supabase production 数据库。配置测试库后会使用 `PrismaAssessmentStore`、真实 `HealthResult`、`Subscription` 和 `PaymentEvent` 表验证持久化。

当前覆盖范围：

- 健康评估算法：BMI、BMI 分类、BMR、TDEE、摄入量、目标日期、结果摘要、预测曲线。
- 算法边界：缺失字段、非数字注入、NaN/Infinity、身高/体重/年龄越界、非法 gender/goal/exerciseFrequency、目标体重过激、目标体重与目标类型矛盾。
- 第二阶段 Core Logic：完整 assessment submit 后调用服务端算法，`HealthResult` 落库并通过 `assessmentId` 关联当前 assessment；重复 submit 不创建多条结果；submit 失败不创建 result 且 assessment 保持 `DRAFT`。
- 第三阶段 Auth & Access：未付费结果返回 `LOCKED` 且只包含公开字段；全量 JSON 中不出现受保护字段 key；`/pay` 后数据库状态变 `ACTIVE`，结果再次读取变为 `FULL`。
- 第一阶段 Persistence：创建匿名 session、分步保存 quiz answers、中断后 progress 恢复、重复提交同一步、乱序提交、未知 sessionId、非法输入拒绝、version conflict / optimistic locking。
- 数据一致性：非法输入返回 400 后不会写入对应 step；旧 `version` 返回 409，避免旧页面或并发请求覆盖新数据；已提交为 `RESULT_READY` 的 assessment 不允许继续修改分步数据。
- 数据验证：缺少 `version`、缺少 `data`、非法 stepKey、数字字段传字符串/null/object/array、畸形 JSON、危险 sessionId 都有显式测试。
- 鉴权差异：非会员拿不到完整计划字段，且 `includeFull/debug/admin/subscriptionStatus=ACTIVE` 等 query 参数不能绕过服务端过滤。
- 支付闭环：`/pay` 和 `/api/v1/payments/mock-callback` 都会校验 `sessionId`、`idempotencyKey` 和结果状态；成功后状态变为 `ACTIVE`，结果从 `LOCKED` 变 `FULL`。
- 支付输入校验：非法 `amount`、`currency` 会返回 400，但这两个字段不是必填。
- 幂等性：重复使用相同 `idempotencyKey` 不会重复创建同一 `PaymentEvent`；不同 `idempotencyKey` 会记录新事件但订阅状态保持 `ACTIVE`。
- Session 隔离：只支付 session A 不会解锁 session B，B 仍返回 `LOCKED` 且不包含受保护字段。
- API E2E：`tests/e2e/full-funnel-flow.test.ts` 覆盖创建 session、四步保存、progress 恢复、submit、LOCKED result、/pay、FULL result。

测试记录见 `TEST_REPORT.md`。该文档说明了如何运行测试、覆盖了哪些 Persistence 和 Core Logic 场景、显式验证了哪些边界、为什么选择这些测试，以及暂未覆盖的内容。

暂未覆盖：

- 本地未配置 `TEST_DATABASE_URL` 时，Prisma/PostgreSQL 集成测试会跳过；GitHub Actions CI 已配置 PostgreSQL service，并设置 `DATABASE_URL`、`DIRECT_URL` 和 `TEST_DATABASE_URL` 指向 CI 临时测试库，因此 CI 会运行数据库集成测试。
- 浏览器端 E2E：当前已有 API 级 E2E；尚未用 Playwright 自动验证关闭页面后重新进入的浏览器恢复流程。原因是后端评分重点优先验证接口、持久化和权限逻辑。
- 多设备恢复：当前 sessionId 存在浏览器 `localStorage`，没有账号体系；跨设备或清缓存后的恢复暂未覆盖。

## CI

CI 接入建议执行内容：

```bash
npm ci
npx prisma generate
npx prisma db push
npm run typecheck
npm test
npm run build
```

## 核心目录

- `app/`：Next.js App Router 前端和 API routes。
- `src/domain/`：类型、输入校验、健康评估算法。
- `src/server/`：Store 接口、Prisma store、Memory store、业务 workflow、HTTP 错误处理。
- `prisma/schema.prisma`：PostgreSQL 数据模型。
- `prisma/migrations/0001_init/migration.sql`：初始化迁移 SQL。
- `tests/`：Vitest 自动化测试。

## AI 使用复盘

我把 AI 和 Codex skills 当成架构、流程和测试搭档，而不是只当代码生成器：

- Funnel 解析：先使用 `funnel-analysis` skill 拆解 BetterMe Pilates 类健康测评项目的完整链路，不只看首屏，而是分析录入节奏、信任建立、结果页拦截、付费触发和恢复路径，再把这些观察转成当前项目的测评步骤、结果预览和模拟支付闭环。
- 项目流程设计：使用 `using-superpowers` skill 帮我把评分标准拆成工程执行清单，明确 API 设计、数据建模、分步持久化、订阅鉴权、测试覆盖、README 交付说明这些验收点，避免只做一个能跑的 demo。
- 数据建模：先让 AI 根据评分标准列出实体关系，再人工收敛为 `User -> Assessment -> AssessmentStep -> HealthResult` 和 `User -> Subscription/PaymentEvent`。最终保留 step JSONB，是为了兼顾问卷扩展性和分步恢复。
- Mock 数据：用 AI 生成了一组减重用户数据，再人工检查目标体重是否安全，最后固定成 `demo_free_session` 和 `demo_paid_session`。
- 复杂逻辑：健康算法由 AI 起草 BMI、Mifflin-St Jeor、活动系数、目标曲线，我人工加了安全下限和目标体重合理性约束。
- 测试用例：AI 帮我枚举边界场景，包括非数字注入、越界、重复支付、非会员字段泄露。我把这些变成 Vitest 用例，而不是只靠本地点页面。
- 否决的一次方案：AI 曾建议把所有问卷字段直接放在 `Assessment` 大表里。我否决了，因为评分标准强调扩展性和分步保存；大表方案会让新增步骤、重复提交版本、乱序恢复和审计都变差。因此最终使用 `AssessmentStep` 独立表保存每一步数据。
