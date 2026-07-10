# Health Assessment Quiz Funnel

[![CI](https://github.com/CheneyWwW/Full-stack-Challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/CheneyWwW/Full-stack-Challenge/actions/workflows/ci.yml)

一个面向健康测评 quiz funnel 的核心后端架构示例。项目重点不是表单本身，而是用 Next.js API Routes、TypeScript、Prisma/PostgreSQL、服务端健康评估算法、订阅鉴权和自动化测试，证明一个完整健康测评系统的工程骨架可以稳定运转。

## 交付信息

- 线上演示地址：`https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app`
- GitHub 仓库：`https://github.com/CheneyWwW/Full-stack-Challenge`
- 未付费测试 sessionId：`demo_free_session`，用于查看 `LOCKED` 结果。
- 已付费测试 sessionId：`demo_paid_session`，用于直接查看 `FULL` 结果。
- 支付演示 sessionId：`demo_pay_session`，用于调用 `/pay` 演示 `LOCKED -> FULL`。
- 数据库 Schema 图：[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- API 文档：[API.md](./API.md)
- AI 使用复盘：[AI_USAGE_REVIEW.md](./AI_USAGE_REVIEW.md)
- 测试记录：[TEST_REPORT.md](./TEST_REPORT.md)

部署后手动验收：

```bash
BASE_URL="https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app"

curl "$BASE_URL/api/v1/sessions/demo_free_session/results"
curl "$BASE_URL/api/v1/sessions/demo_paid_session/results"
curl "$BASE_URL/api/v1/sessions/demo_pay_session/results"

curl -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'

curl "$BASE_URL/api/v1/sessions/demo_pay_session/results"
```

预期结果：

- `demo_free_session` 返回 `access = LOCKED`，只包含 BMI、BMI 分类、summary 和 paywall 文案。
- `demo_paid_session` 返回 `access = FULL`，包含 dailyCalories、targetDate、bmr、tdee、predictionCurve。
- `demo_pay_session` 首次返回 `LOCKED`，调用 `/pay` 后再次读取变为 `FULL`。

如果浏览器里已经保存过旧 session，页面顶部的 `Start over` 会清除本地 session 并重新开始完整 funnel。

## /pay 调用方式

`demo_pay_session` 是已完成测评但未付费的测试 session，可用于演示结果页从 `LOCKED` 变为 `FULL`。

```bash
BASE_URL="https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app"

curl -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'
```

同一个 `idempotencyKey` 可以重复调用，不会重复创建支付事件。完整 API 说明见 [API.md](./API.md)。

## 技术栈

- Frontend：Next.js App Router、React、TypeScript
- Backend：Next.js API Routes、TypeScript
- Database：Prisma + PostgreSQL，线上可接 Supabase
- Validation：Zod + domain validation
- Testing：Vitest
- CI：GitHub Actions + PostgreSQL service
- Deployment：Vercel + Supabase PostgreSQL

## 核心能力

- 匿名 session 创建：用随机 sessionId 或 demo sessionId 识别用户。
- 分步保存：每完成一步，前端调用后端保存增量数据。
- 进度恢复：用户中断后重新进入，可通过 progress 接口恢复已填写数据。
- Version 乐观锁：每次成功 PATCH 后 `Assessment.version + 1`，旧页面或并发请求携带旧 version 会返回 409。
- 服务端健康算法：提交完整测评后在服务端计算 BMI、BMI 分类、BMR、TDEE、dailyCalories、targetDate、predictionCurve。
- 结果持久化：`HealthResult` 与当前 assessment 关联，结果不是前端传入。
- 权限过滤：未付费用户只拿到脱敏结果，完整计划字段只对 `ACTIVE` 用户返回。
- 模拟支付闭环：`/pay` 和 `/api/v1/payments/mock-callback` 共用同一个订阅激活 workflow。
- 支付幂等：`PaymentEvent.providerEventId` 唯一，重复 idempotencyKey 不重复创建事件。

## 快速启动

安装依赖：

```bash
npm install
```

不配置数据库时，本地开发会自动使用 memory store，适合快速体验页面和 API：

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

使用 PostgreSQL 持久化：

```bash
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

`.env` 示例：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
DIRECT_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

`TEST_DATABASE_URL` 只用于本地测试或 CI，不要配置到 Vercel Production。

## API 文档

完整接口说明、请求/响应示例、错误格式和 `/pay` 可重放调用方式见 [API.md](./API.md)。

## 数据库设计

完整图和字段说明见 [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)。

```mermaid
erDiagram
  User ||--|| Assessment : owns
  User ||--o| Subscription : has
  User ||--o{ PaymentEvent : receives
  Assessment ||--o{ AssessmentStep : stores
  Assessment ||--o| HealthResult : produces
```

核心取舍：

- `AssessmentStep.data` 使用 JSON，方便后续新增 quiz step，不需要频繁改大表。
- `Assessment.version` 支撑乐观锁和状态一致性。
- `HealthResult.assessmentId` 唯一，重复 submit 不会创建多个结果。
- `PaymentEvent.providerEventId` 唯一，保证支付回调幂等。
- `Subscription` 与 `User.subscriptionStatus` 同步，用于快速判断当前结果访问权限。

## 测试与质量保障

一键运行全部测试：

```bash
npm test
```

按层级运行：

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

类型检查 + 测试：

```bash
npm run ci
```

CI 状态：

- GitHub Actions workflow：[CI](https://github.com/CheneyWwW/Full-stack-Challenge/actions/workflows/ci.yml)
- 最近一次已确认通过：[fix completed funnel restore and restart](https://github.com/CheneyWwW/Full-stack-Challenge/actions/runs/29035340959)
- CI 使用 Node.js 20 和 PostgreSQL 16 service，执行 `npm ci`、`npx prisma generate`、`npx prisma db push`、`npm run typecheck`、`npm test`、`npm run build`。

测试覆盖范围：

- 健康算法单元测试：BMI、BMI 分类、BMR、TDEE、dailyCalories、targetDate、predictionCurve。
- 算法边界：缺失、0、负数、超范围、字符串、NaN、Infinity、非法 gender/goal/exerciseFrequency、跨字段目标体重规则。
- 分步保存与进度恢复：创建 session、保存四类 step、中断恢复、重复提交、乱序提交。
- 状态一致性：version 乐观锁、旧 version 返回 409、已提交后禁止继续 PATCH。
- 非法输入：接口能挡住非法数值注入和越界输入，并验证非法请求不会污染 progress。
- 结果持久化：完整 assessment submit 后创建 `HealthResult` 并关联 `Assessment`。
- 订阅鉴权：非会员 `LOCKED` 与会员 `FULL` 差异化返回。
- 防泄露：非会员 response 的全量 JSON 中不出现 `dailyCalories`、`targetDate`、`bmr`、`tdee`、`predictionCurve`、`weeklyPlan`。
- 支付闭环：`/pay` 后数据库状态变 `ACTIVE`，再次读取结果从 `LOCKED` 变为 `FULL`。
- 支付异常：缺少 sessionId、未知 sessionId、未 submit、缺少/非法 idempotencyKey、非法 amount/currency。
- 支付幂等：相同 idempotencyKey 不重复创建 `PaymentEvent`。
- Session 隔离：只支付 session A 不会解锁 session B。

Prisma/PostgreSQL 集成测试只认 `TEST_DATABASE_URL`。如果未设置，数据库集成测试会 skipped，不会 fallback 到 `DATABASE_URL`，避免误连生产库。GitHub Actions 已配置 PostgreSQL service，因此 CI 会运行数据库集成测试。

详细测试记录见 [TEST_REPORT.md](./TEST_REPORT.md)。

## 部署

推荐：Vercel + Supabase PostgreSQL。

Vercel 环境变量：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Supabase pooled PostgreSQL connection string，用于运行时连接数据库 |
| `DIRECT_URL` | Supabase direct PostgreSQL connection string，用于 Prisma migration |
| `NEXT_PUBLIC_APP_URL` | Vercel production URL |

不要在 Vercel Production 配置 `TEST_DATABASE_URL`。

生产迁移和 seed：

```bash
npm run db:deploy
npm run db:seed
```

生产环境使用 `db:deploy`，不要使用 `db:push` 或 `migrate dev`。

## 项目结构

```text
app/
  api/v1/...        Next.js API routes
  pay/route.ts      题目要求的 /pay wrapper
  page.tsx          可演示 quiz funnel
src/domain/         类型、校验、健康算法
src/server/         store 接口、Prisma/memory store、workflow
prisma/             schema、migration、seed
tests/              Vitest 单元/集成/E2E 测试
.github/workflows/  GitHub Actions CI
```

## AI 使用复盘

完整复盘见 [AI_USAGE_REVIEW.md](./AI_USAGE_REVIEW.md)。其中包括：

- 如何用 AI 拆解 BetterMe 类 quiz funnel 的数据流。
- 如何用 AI 协助数据库建模、Mock 数据、健康算法和边界测试。
- 如何把 AI 生成的测试场景转成 Vitest 自动化用例。
- 一次明确否决 AI 方案的例子：没有采用把所有问卷字段塞进 `Assessment` 大表的方案，而是使用 `AssessmentStep` 独立表来支持扩展、恢复和审计。

## 已知限制

- 当前 sessionId 存在浏览器 `localStorage`，没有账号体系；跨设备恢复不在本次范围内。
- 本地没有配置 `TEST_DATABASE_URL` 时，Prisma 数据库集成测试会 skipped；CI 会用临时 PostgreSQL 跑完整数据库测试。
- UI 只做基础可演示体验，评分重点在后端、数据库、权限闭环和测试证明。

## 调试记录

### PowerShell curl 与本地 session 创建失败

- 现象：PowerShell 里直接执行 `curl -X POST ...` 会走 `Invoke-WebRequest` 别名；改用 `curl.exe` 后，早期本地 `POST /api/v1/sessions` 曾返回 500。
- 原因：本地没有配置 `DATABASE_URL` 时直接走 Prisma，会因为无法连接数据库导致 session 创建失败。
- 修复：本地未配置 `DATABASE_URL` 时自动使用 memory store；README 明确 PowerShell 使用 `curl.exe` 或 `Invoke-RestMethod`。
- 结果：未配置数据库也能本地跑通 funnel；配置 PostgreSQL 后走 Prisma 持久化。

### 完成一次 funnel 后无法重新开始

- 现象：完整走完一次 funnel 后刷新页面，界面恢复到 `ACTIVITY 4/4`，没有自动进入结果页，也没有明显入口重新开始。
- 原因：浏览器 `localStorage` 保留旧 `health-session-id`；页面只恢复 progress，没有在已完成 session 上继续读取 `GET /results`。
- 修复：恢复到已完成 session 时自动请求结果页；顶部增加 `Start over`，点击后清除旧 sessionId 并创建新的匿名 session。
- 结果：完成后刷新会恢复到 `LOCKED/FULL` 结果页；点击 `Start over` 可以从 `PROFILE 1/4` 重新开始。
