# 墙门高度修复与完整功能回归

本轮针对“3D 预览时部分墙和门突然变矮”完成修复，并对当前已实现的功能进行自动化回归与主要浏览器流程验收。结果为：后端 **186 passed**、前端 **81 passed**，TypeScript 严格检查、Vite 生产构建、Python Ruff F 检查通过。接口审计覆盖 OpenAPI 中全部 **58/58 个业务接口操作**，每个操作至少获得一次 2xx 响应。

这表示当前测试范围内通过，不代表每个交互分支、外部服务、真实设备或原开发蓝图的全部商业功能均已验收。

## 根因与修复

旧俯览逻辑会把朝向相机的墙体压到 **0.55 m**，还把共享隔墙纳入裁切。门窗又沿用裁切后的墙高，因此视角切换、旋转和模式变化时会出现墙门一起缩短。门窗高度也曾受到墙段最低高度的二次限制。

现在的行为：

- “透明外墙”只降低朝向相机的外墙透明度，墙体实体几何保持原尺寸；室内共享隔墙保持完整高度和不透明。
- “完整墙”恢复全部墙体的不透明显示。两个入口分别位于工作区和放大后的 3D 工具栏，状态同步。
- 门框、门扇、窗框和玻璃始终依据场景中的洞口高度、离地高度生成，不随俯览状态缩放。
- 庭院/露台与室内交界处按住宅外墙处理；只有室外房间引用的墙不误当成室内隔墙。庭院本来较矮的围墙仍按其自身尺寸生成。
- 上层庭院/露台的墙不再错误截断下层挑空墙；真正上下层重叠的室内墙仍保留结构分段处理，避免穿模。
- 透明模式不改变实测数据、门窗参数、版本或导航碰撞。房间视角和漫游继续使用完整墙体。

已有项目刷新即可使用，不需要重设户型或删除设计数据。

![完整墙模式](../artifacts/full-regression/final-walls-full.png)

![只透明前侧外墙，保留完整门窗高度](../artifacts/full-regression/final-walls-transparent.png)

## 验证结果

| 层面 | 结果 | 范围与证据 |
| --- | --- | --- |
| 前端 Vitest | 81 passed / 12 文件 | 同源尺寸、编辑操作、导入解析、导航碰撞、楼梯、层间结构、渲染资源释放等；新增高度回归覆盖示例住宅及复式、Loft、别墅的多个相机方向 |
| 后端 pytest | 186 passed | 在原有 179 项基础上补充 7 项跨功能业务流程；使用独立临时数据库和文件存储 |
| 接口操作审计 | 58/58 | 按 HTTP 方法与 OpenAPI 路由模式统计 TestClient 响应，全部至少一次 2xx；不是代码分支覆盖率报告 |
| TypeScript / Vite | passed | 严格类型检查与生产打包成功 |
| Ruff F | passed | 未定义名称和无效/未使用导入检查 |
| 桌面浏览器 | 主要流程通过 | 1280×720，正常 UI 操作和实际 WebGL 渲染 |
| 手机模拟视口 | 主要流程通过 | 393×852，墙门高度、墙体切换和页面宽度；未替代真实手机 GPU 测试 |
| 最终主标签控制台 | 无 error | 最终检查返回空列表；不等同于全平台性能验收 |

自动化测试有一条现有的 Starlette/TestClient 与 httpx 适配弃用提示，不影响本轮结果。

原始结果：[接口操作审计](../artifacts/full-regression/api-operations.json)、[浏览器记录](../artifacts/full-regression/browser-audit.json)、[演示项目保存状态审计](../artifacts/full-regression/persisted-demo-audit.json)。接口审计仅记录路由和状态码，不记录请求体、密码或密钥。

## 功能覆盖清单

| 功能 | 自动化回归 | 本轮浏览器验收 |
| --- | --- | --- |
| 注册、登录、会话、CSRF、退出、密码恢复 | 注册/登录/恢复全链路，令牌重复使用及会话失效；模拟 SMTP | 沿用本地体验账户，不发送邮件 |
| 项目管理 | 创建、元数据修订、复制、归档/恢复、软删除与访问控制 | 新建独立“全功能回归 · 虚构测试” |
| 户型、量房与校验 | 11 个模板、引用/单位/拓扑、量测批次及替代记录、版本冲突 | 客厅宽 4000→4200 mm，总面积 36→37 m²；明确以演示来源确认 |
| 编辑、家具和材质 | 尺寸/摆放/碰撞、编辑与历史、导入解析、保存 | 冰箱搜索与添加、撤销/重做，切换浅白石材，刷新后保持 |
| 3D 墙门和多层 | 几何与视图独立、完整洞口高度、共享墙、庭院边界、挑空墙、楼梯与门扇碰撞 | 别墅一二层、透明/完整墙、门关闭再打开、连续上下楼 0→3.40→0 m |
| 布局生成与比较 | 硬约束、锁定、结构保持、家庭需求评估 | 规则布局成功生成 3 个方案；2D/3D 对比，载入草稿并保存版本 |
| 版本、评论、审批和成员权限 | 固定版本、viewer 限制、评论/审批、移除成员及越权拒绝 | 保存“完整回归 · 演示版本”，共 4 个版本 |
| 预算与导出 | 有效预算、报价未知项、JSON/CSV/PDF 任务及权限 | 材料/人工报价；CSV 实际下载，PDF 任务成功并出现下载入口 |
| 分享 | 到期、撤销、项目删除立即撤销访问、固定版本隔离 | 打开只读分享页；撤销后刷新显示失效 |
| 照片与平面图 | 媒体校验、私有访问、识别响应/失败、近似结构校验 | 上传虚构 3D 渲染图作为照片测试附件并关联客厅；上传虚构平面图，识别入口可用 |
| AI 生图、复核和备用模型 | 模拟提供商成功/失败、限流/额度切换、复核和来源等原有测试 | 确认面板验证尺寸、演示标记、模型顺序和积分，未提交付费任务 |
| 任务、积分和幂等 | 并发幂等、取消、租约、超时、晚到结果、存储失败、冻结/结算/释放 | 布局及两个导出任务均成功且费用为零；账户仍为 85 可用、0 冻结 |

本轮照片附件是已生成的虚构房间渲染图，不是真实住宅实拍；平面图也是演示素材。新增项目的场景校验无错误或警告，保存状态为 4200×5000×2800 mm 客厅、5 件家具、石材地面和 `basis=demo`。生成的分享已撤销，模拟视口已恢复。

![两套方案的正常高度 3D 比较](../artifacts/full-regression/compare-3d.png)

其他证据：[二层完整墙门](../artifacts/full-regression/upper-full.png)、[窄屏墙体](../artifacts/full-regression/mobile-walls.png)、[AI 提交前确认](../artifacts/full-regression/ai-preflight.png)、[实际下载的预算 CSV](../artifacts/full-regression/budget.csv)。

## 复验命令与维护入口

在 `D:\project\jianspace` 执行：

```powershell
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q -p scripts.function_audit_plugin
npm.cmd test
npm.cmd run build
.\.venv\Scripts\ruff.exe check apps/api scripts/function_audit_plugin.py --select F
```

后端测试配置会隔离真实密钥并禁用付费 AI。不要把真实 AI 付费配置注入测试。浏览器复验：打开已有项目 → 3D 空间 → 透明外墙/完整墙 → 旋转观察 → 切换楼层/房间/漫游 → 门控 → 楼梯上下行。

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/components/visuals/wallPreview.ts` | 统一墙体预览与原始门窗尺寸计算 |
| `apps/web/src/components/visuals/Architecture3D.tsx` | 完整墙、门窗、透明材质和饰条渲染 |
| `apps/web/src/components/visuals/sceneMath.ts` | 基于室内房间关系判断前侧外墙 |
| `apps/web/src/components/visuals/buildingEnvelope.ts` | 真正结构重叠的墙高分段；排除上层室外墙的干扰 |
| `apps/web/src/components/Scene3D.tsx`、`apps/web/src/Workspace.tsx` | 墙体显示入口与状态同步 |
| `apps/web/src/components/visuals/wallPreview.test.ts` | 相机方向、完整门高、共享墙、庭院边界与挑空回归 |
| `apps/api/tests/test_functional_regression.py` | 新增的跨功能业务流程回归 |
| `scripts/function_audit_plugin.py` | 可选的 pytest 接口操作审计插件 |

## 尚未在本轮实测的边界

真实 AI 生图/平面图识别、服务商实际额度切换及外部账单本轮未调用，以上自动化结果使用模拟响应。历史真实调用见 [此前验收](PRIORITY_TWO_DELIVERY.md)与 [3D 升级交付](3D_UPGRADE_DELIVERY.md)，不作为本轮重新验收。

SMTP 实发、Docker 部署、PostgreSQL/Redis/S3 联调、收费支付、并发压测、真机与全部浏览器组合仍需专项验收。任意 CAD 墙网、PDF/DWG 识别、复杂楼梯和完整施工计量等未实现范围见 [实现状态](IMPLEMENTATION_STATUS.md)。
