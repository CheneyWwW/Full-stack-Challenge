# API 文档

本文档描述健康测评 quiz funnel 的核心后端 API。接口覆盖匿名 session、分步保存、进度恢复、服务端提交计算、结果鉴权和模拟支付闭环。

默认示例使用：

```bash
BASE_URL="https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app"
```

本地开发时可改为：

```bash
BASE_URL="http://localhost:3000"
```

## 通用约定

所有 JSON 请求都应携带：

```http
Content-Type: application/json
```

错误响应统一返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid assessment step payload",
    "details": {}
  }
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求成功 |
| `201` | 资源创建成功 |
| `400` | 请求参数或数据校验失败 |
| `404` | session 或资源不存在 |
| `409` | 状态冲突，例如旧 version、未提交就支付、已提交后继续修改 |
| `500` | 未预期服务端错误 |

## 创建 Session

`POST /api/v1/sessions`

创建匿名用户 session 和初始 assessment。

```bash
curl -X POST "$BASE_URL/api/v1/sessions"
```

响应示例：

```json
{
  "sessionId": "cmr...",
  "assessmentStatus": "DRAFT",
  "currentStep": null,
  "nextStep": "GENDER",
  "completedSteps": [],
  "version": 0,
  "draft": {}
}
```

## 分步保存

`PATCH /api/v1/sessions/{sessionId}/assessment-steps/{stepKey}`

用户每完成一步，前端调用该接口把当前 step 的增量数据同步到后端。

`stepKey` 支持：

| stepKey | 数据含义 |
| --- | --- |
| `gender` | 性别 |
| `goals` | 用户目标 |
| `body` | 年龄、身高、体重、目标体重 |
| `activity` | 运动频率 |

请求示例：

```bash
curl -X PATCH "$BASE_URL/api/v1/sessions/$SESSION_ID/assessment-steps/body" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 2,
    "data": {
      "age": 35,
      "heightCm": 165,
      "weightKg": 73,
      "targetWeightKg": 64
    }
  }'
```

成功响应返回最新 progress：

```json
{
  "sessionId": "cmr...",
  "assessmentStatus": "DRAFT",
  "currentStep": "BODY",
  "nextStep": "ACTIVITY",
  "completedSteps": ["GENDER", "GOALS", "BODY"],
  "version": 3,
  "draft": {
    "gender": "female",
    "goal": "lose_weight",
    "age": 35,
    "heightCm": 165,
    "weightKg": 73,
    "targetWeightKg": 64
  }
}
```

保存规则：

- 请求必须携带当前 `version` 和当前 step 的 `data`。
- 成功后 `Assessment.version + 1`。
- 同一步重复提交会覆盖该 step 的旧数据，`completedSteps` 不会重复。
- 支持乱序提交，但 `currentStep` 不会因为旧步骤提交而倒退。
- 如果请求 version 小于数据库当前 version，返回 `409 CONFLICT`。
- assessment 已提交为 `SUBMITTED` 或 `RESULT_READY` 后，不允许继续修改分步数据，返回 `409 CONFLICT`。

## 进度恢复

`GET /api/v1/sessions/{sessionId}/progress`

用户中途关闭页面后，前端可用该接口恢复已填写数据。

```bash
curl "$BASE_URL/api/v1/sessions/$SESSION_ID/progress"
```

返回内容包括：

- `sessionId`
- `assessmentStatus`
- `currentStep`
- `nextStep`
- `completedSteps`
- `version`
- `draft`

## 提交测评

`POST /api/v1/sessions/{sessionId}/assessment/submit`

提交完整 assessment，并由服务端计算健康评估结果。前端不提交也不能覆盖 `bmi`、`dailyCalories`、`targetDate` 等结果字段。

```bash
curl -X POST "$BASE_URL/api/v1/sessions/$SESSION_ID/assessment/submit"
```

提交前必须已完成：

- `gender`
- `goals`
- `body`
- `activity`

服务端会计算并持久化：

- `bmi`
- `bmiCategory`
- `bmr`
- `tdee`
- `dailyCalories`
- `targetDate`
- `weeksToTarget`
- `summary`
- `predictionCurve`

成功后 assessment 状态变为 `RESULT_READY`，并 upsert `HealthResult`。重复 submit 不会创建多个重复结果。

## 获取结果

`GET /api/v1/sessions/{sessionId}/results`

结果接口会在服务端根据 subscription status 做权限过滤。

### 未付费结果

未付费或非 `ACTIVE` 用户返回 `LOCKED`，只包含公开字段。

```bash
curl "$BASE_URL/api/v1/sessions/demo_free_session/results"
```

响应示例：

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

非会员响应的任意层级都不应出现这些 protected field key：

- `dailyCalories`
- `targetDate`
- `bmr`
- `tdee`
- `predictionCurve`
- `weeklyPlan`

### 已付费结果

`ACTIVE` 用户返回 `FULL`。

```bash
curl "$BASE_URL/api/v1/sessions/demo_paid_session/results"
```

响应包含完整计划字段：

- `bmi`
- `bmiCategory`
- `bmr`
- `tdee`
- `dailyCalories`
- `targetDate`
- `summary`
- `weeksToTarget`
- `predictionCurve`

权限过滤发生在服务端，`includeFull=true`、`debug=true`、`admin=true`、`subscriptionStatus=ACTIVE` 等 query 参数不会绕过过滤。

## 模拟支付

题目要求的快捷入口：

`POST /pay`

```bash
curl -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'
```

正式命名入口：

`POST /api/v1/payments/mock-callback`

```bash
curl -X POST "$BASE_URL/api/v1/payments/mock-callback" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'
```

两个入口共用同一个 `activateSubscription` workflow。

支付规则：

- `sessionId` 必填。
- `idempotencyKey` 必填，允许字母、数字、`.`、`_`、`:`、`-`，最长 128。
- assessment 必须已经 submit 并生成 `HealthResult`，否则返回 409。
- 成功后写入 `User.subscriptionStatus = ACTIVE`、`Subscription.status = ACTIVE`、`PaymentEvent`。
- 相同 `idempotencyKey` 重复调用是幂等的，不会重复创建 `PaymentEvent`。
- `amount` 和 `currency` 不是必填；如果传入非法值会返回 400。

## 线上闭环验收

```bash
BASE_URL="https://full-stack-challenge-enu3gg1cs-cheney-ww-w.vercel.app"

curl "$BASE_URL/api/v1/sessions/demo_pay_session/results"

curl -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo_pay_session","idempotencyKey":"demo_payment_001"}'

curl "$BASE_URL/api/v1/sessions/demo_pay_session/results"
```

预期：

- 第一次 result 返回 `access = LOCKED`。
- `/pay` 返回支付成功，数据库状态变为 `ACTIVE`。
- 第二次 result 返回 `access = FULL`，包含完整计划字段。
