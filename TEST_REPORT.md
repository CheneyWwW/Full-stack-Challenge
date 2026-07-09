# 测试情况记录

记录日期：2026-07-09

## 结论

当前已经有自动化测试用例，能证明核心后端流程不是只靠手动点击验证。现阶段最重要的测试已覆盖：健康评估算法、非法输入拦截、分步保存、进度恢复、非会员脱敏、支付后解锁完整结果。

建议保留现有 Vitest 自动化测试；如果要上线给评审在线跑，建议额外补一个 API smoke check 脚本，用来对部署后的 URL 做端到端接口巡检。

## 一键运行

```bash
npm run ci
```

等价于：

```bash
npm run typecheck
npm test
```

最近一次运行结果：

- `npm run typecheck`：通过
- `npm test`：通过
- 测试文件：2 个通过
- 测试用例：11 个通过

## 已有测试用例

### `tests/health.test.ts`

覆盖健康评估算法与边界：

- 正常计算 BMI、BMI 分类、建议摄入量、目标日期、预测曲线。
- 缺失必填身体数据时拒绝计算。
- 拦截非数字注入，例如字符串身高。
- 拦截年龄、身高、体重越界。
- 拦截不安全或矛盾的目标体重。
- 保证建议摄入量不低于安全下限。

### `tests/workflows.test.ts`

覆盖关键业务流程：

- 分步保存后可以恢复已填写进度。
- 中断恢复时返回 `completedSteps`、`nextStep` 和合并后的 `draft`。
- 支持乱序提交、重复提交和并发更新。
- 非法 payload 会在保存边界被拒绝。
- 非会员结果只返回脱敏预览，不返回 `predictionCurve`、`dailyCalories`、`targetDate`。
- 调用支付回调后，结果从 preview 变成 full。
- 重复支付回调保持幂等。

## 验收点对照

| 验收点 | 当前状态 | 证据 |
| --- | --- | --- |
| 健康评估算法单元测试 | 已完成 | `tests/health.test.ts` |
| 极端 / 缺失 / 非法数值覆盖 | 已完成 | `tests/health.test.ts`、`tests/workflows.test.ts` |
| 分步保存 + 进度恢复 | 已完成 | `tests/workflows.test.ts` |
| 乱序 / 重复 / 并发提交 | 已完成 | `tests/workflows.test.ts` |
| 非会员脱敏 vs 会员完整 | 已完成 | `tests/workflows.test.ts` |
| `/pay` 后状态变更与结果解锁 | 已完成 | `tests/workflows.test.ts` |
| 一键运行测试 | 已完成 | `npm run ci` |
| CI 自动运行 | 本地已准备命令，远端 workflow 暂未提交 | 当前 GitHub token 缺少 `workflow` scope |

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

分步保存：

```powershell
$body = @{ gender = "female" } | ConvertTo-Json
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://localhost:3000/api/v1/sessions/$sessionId/assessment-steps/gender" `
  -ContentType "application/json" `
  -Body $body
```

进度恢复：

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/sessions/$sessionId/progress"
```

预期结果：

- `completedSteps` 包含 `GENDER`
- `nextStep` 返回 `GOALS`
- `draft.gender` 返回 `female`

## 是否还需要新增测试或检查脚本

需要，但分优先级：

1. 已完成：核心逻辑和关键流程的 Vitest 自动化测试。
2. 建议补充：部署后 API smoke check 脚本，传入线上 URL，自动跑一遍创建 session、分步保存、提交、结果预览、支付、完整结果。
3. 可选增强：Playwright 浏览器 E2E，验证真实用户从首页一路填到支付弹窗。
4. 可选增强：真实 PostgreSQL 集成测试，验证 Prisma 事务、唯一键和数据库级持久化。

当前交付最低要求已经由 Vitest 覆盖；如果时间允许，优先补 API smoke check，因为它最适合评审在线验收。
