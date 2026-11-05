# 本次验证记录

最新参考项目体验完善：后端 **188 passed**、前端 **91 passed**，58/58个业务接口操作均有成功响应，严格类型检查、生产构建和 Ruff F 通过。正常页面验证概览/四步导航、筛选/排序、独立副本、刷新保存、错误定位与撤销、顶视/自动环绕及手机工具栏/光影面板避让；无新增付费 AI 调用。截图与原始记录见 [REFERENCE_PROJECT_IMPROVEMENTS.md](REFERENCE_PROJECT_IMPROVEMENTS.md)。以下是此前阶段记录。

最新墙门修复与全功能回归：后端 **186 passed**、前端 **81 passed**，严格类型检查、生产构建及 Ruff F 检查通过；OpenAPI **58/58 个业务接口操作**均至少一次 2xx。浏览器验收包括完整墙门高度、庭院外墙透明、一二层切换、门控、连续上下楼、量房/材质保存、家具与历史、布局/2D及3D比较、预算导出、照片/平面图上传、AI确认面板和分享撤销。新增项目全部为虚构数据，无付费 AI 调用；外部 AI/识别/SMTP 使用模拟响应做自动化测试。范围、截图及原始审计见 [FULL_REGRESSION.md](FULL_REGRESSION.md)。下文保留此前阶段记录。

最新渲染增强：前端 **74 passed**，类型检查与生产构建通过；新增两项 AO 释放回归测试。全部38个资源文件校验通过，浏览器检查光照、曝光、阴影、六次画质切换、高清漫游、手机默认流畅与1256×696 PNG下载，没有新增控制台 error。后端无变更，未重复运行全套。详见 [RENDERING_UPGRADE.md](RENDERING_UPGRADE.md)。

最新别墅外观与层间结构回归：后端 **179 passed**、前端 **72 passed**，类型检查、生产构建和 Ruff F 检查通过。浏览器检查四套样式、正侧背面结构、刷新保存、竖屏取景，以及 0→3.40→0 m 连续上下楼；本轮未发现新增控制台 error。演示项目结构哈希与模板一致。详见 [VILLA_EXTERIOR_FIX.md](VILLA_EXTERIOR_FIX.md)。下文为此前阶段记录。

前一轮 3D 升级回归：后端 **174 passed**、前端 **61 passed**，类型检查、生产构建和 Ruff F 检查通过；有一条现有 Starlette/httpx 弃用警告。实际浏览器完成别墅连续上下楼、门控、铺装保存、重复模式切换和一次正常页面真实平面图识别，详见 [3D_UPGRADE_DELIVERY.md](3D_UPGRADE_DELIVERY.md)。以下为此前分阶段记录。

日期：2026-10-22—23。基础流程与漫游验证于 22 日完成，家具家电扩展、户型/楼层支持及三项目标改进于 23 日完成本地验证；随后分别完成历史脚本及正常页面的真实 AI 验收。最新改进与范围见 `PRIORITY_TWO_DELIVERY.md`。实现版本：0.1.0。运行环境：Windows、Python 3.12、Node.js 24。

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 后端 pytest | 153 passed | 先前 64 项保持通过；新增 14 项任务生命周期、51 项视觉检查、24 项尺寸来源/相机/提示预算/复核工作流测试；所有自动测试隔离真实密钥和付费开关 |
| 前端 Vitest | 50 passed | 先前 40 项保持通过；新增 10 项参考顺序、UTF-8 字节、异常审查状态、人工/自动意见隔离、差异再调整、积分/模型消息及自由摘要冲突测试 |
| TypeScript + Vite | passed | strict、noUnusedLocals、noUnusedParameters；3D 按需分包，无构建失败 |
| Ruff F 检查 | passed | Python 未定义名称、无效与未使用导入检查 |
| SQLite Alembic | passed | 在独立新库执行初始迁移，不修改体验项目数据库 |
| PostgreSQL 迁移 SQL | generated | 离线编译为 `schema.postgresql.sql`；不是 PostgreSQL 在线测试 |
| 浏览器窄屏 | 手动通过主流程 | 393 px 视口：创建体验项目、4000→4500 mm 修改、38.50 m² 面积、校验、确认、3 个布局、版本比较、3D |
| 浏览器桌面 | 手动通过主流程 | 1280×720：编辑器、PDF 任务完成/下载入口、实测确认、方案冻结保存、3D 实际渲染 |
| 写实 3D 预览 | 手动通过参考流程 | 全屋俯览、客厅/卧室视角、房间与属性联动、高清/流畅、相机重置、2200×900×900 mm 沙发标签、作者授权说明；393×852 窄屏工具栏与房间画面 |
| 第一人称漫游 | 手动通过参考流程 | 键盘 W 行走、拖动环顾/俯视、平滑步进、转身、床边碰撞滑动、Esc 暂停、放大；客厅绕开门扇穿门进入卧室；393×852 模拟视口下自动放大、房间跳转和摇杆移动 |
| 家具家电目录 | 手动通过参考流程 | 48 款、8 类；冰箱搜索 2 款、家电筛选 13 款；添加并布置 10 件物品，3D 渲染、壁挂与台面高度、空调宽度 900→1000 mm 后保留造型、场景校验、预算 10 件待询价、保存/刷新/返回项目保持内容；393×852 模拟视口验证空调搜索、分类交集空结果和清空恢复，页面无横向溢出 |
| 户型与两层住宅 | 手动通过参考流程 | 新建三室一厅 93.76 m² 与 Loft 83.96 m²、场景校验、楼层切换、整栋剖面、夹层添加并保存床头柜、预算 6 件的楼层归属；夹层漫游 0.9 m 后暂停；393×852 模拟视口下 3D 楼层选择与剖面无横向溢出，模板卡片选择通过 |
| 编辑与结构参数 | 手动通过参考流程 | 独立虚构项目中复制家具、分别报价、多选对齐和整组位移、四向尺寸提示、画布平移及适应视图；墙厚 200→250 mm 后面积 20→19.90 m²，恢复后校验通过；Loft 修改楼梯终点触发平台错误，恢复后校验和 3D 重建通过 |
| 家庭布局与装修预算 | 手动通过参考流程 | 3 人、儿童/长者/收纳、900 mm 通道及 100 元家具预算形成 84 分评估，显示床位与超预算提示；虚构材料人工与水电报价得已知金额 3550、预留 355、预计 3905 元，家具增加 300 元后总额 4235 元；4 项未知报价保留待询价；浏览器 CSV 任务完成并提供下载入口 |
| AI 尺寸引导 | 页面、模拟接口与演示数据真实任务通过 | 4000×5000×2800 mm 演示来源与纯 3D 相机参考；尺寸平面/参考/结构指令与可选视觉检查，保存原始快照并保持场景；真实房屋仍待验收 |
| 新功能窄屏 | 模拟视口通过 | 393×852 下预算与 AI 引导页面无横向溢出；未进行真实手机测试 |
| 多模型与地域配置 | 模拟接口通过 | 27 项新增测试全使用模拟响应，覆盖配置校验、明确拒绝切换、停止条件与单次结算；真实主模型调用见下行，真实备用切换及余量未验收 |
| 历史脚本主模型接口 | 单次开发验收通过；几何差异待调整 | 修正混用协议的备用配置，主 Pro + 备用 2.0；仅主模型真实调用，合成参考 + 虚构平面返回 1312×800 JPEG。结果新增门洞，浏览器保存差异并标待调整；该次调用没有确认尺寸或扣应用积分，见 AI_LIVE_VALIDATION.md；后续正常页面结果见下行 |
| 正常页面真实生成与视觉检查 | 成功；结果保留待调整 | 任务 e0e2fee8-6757-422b-b92c-4c6ae21ab434，一次 Pro 生图 + 一次 qwen3-vl-plus 检查；视角差异触发待调整，人工不确定项保留；100→90 分、冻结 0、各一条 reserve/charge；场景完全不变；原始参考及差异摘要带回新确认面板，未再次提交 |
| 任务异常链 | 模拟服务商与本地集成通过 | 并发同幂等键、排队/运行取消、晚到结果、心跳租约恢复、超时、配置前置检查、元数据/对象写入及清理失败；未故意制造真实外部故障或消耗备用额度 |
| 新复核页面窄屏 | 模拟视口通过 | 393×852 下图片、来源、六项依据、演示提示及纵向摘要，无横向溢出；默认视口已恢复，未进行真机测试 |

测试期间保留一条 Starlette 关于 TestClient/httpx 未来适配方式的弃用提示，未影响测试结果。

本次 3D 截图：`artifacts/realistic-3d-overview.png`、`artifacts/realistic-3d-bedroom.png`、`artifacts/realistic-3d-dimensions.png` 和 `artifacts/realistic-3d-mobile.png`。早期开发截图为 `artifacts/desktop-3d.png`。浏览器中的演示数据只是测试户型，不能理解为已核实某套真实住宅。窄屏验证使用桌面浏览器视口模拟，未测量真实手机 GPU 性能。

第一人称截图：`artifacts/walkthrough-desktop.png`、`artifacts/walkthrough-doorway.png` 和 `artifacts/walkthrough-mobile.png`；行为与实现说明见 `WALKTHROUGH.md`。移动不会写入户型或生成设计版本。

目录扩展截图：`artifacts/catalog-appliances.png`、`artifacts/catalog-mobile.png`；说明见 `FURNITURE_CATALOG.md`。单独创建“家具家电体验间 · 演示”进行验证，其 4000×5000×2800 mm 房间为虚构数据，保留未确认状态。新增物品全部使用通用参考尺寸、价格为空。目录扩展后重新执行了后端测试，并修复了自动保存成功后工作副本查询缓存未同步的问题。

尚未验证：真实房屋实拍与尺寸的 AI 全流程、服务商实际计费、真实备用模型切换、SMTP 实发、Docker、PostgreSQL/Redis/S3 联调、收费支付、并发压测、全套真机矩阵。原开发文档的全部性能和商业验收指标尚未完成。

历史户型截图：`artifacts/home-three-bedroom-plan.png`、`artifacts/home-three-bedroom-3d.png`、`artifacts/home-loft-section.png`、`artifacts/home-loft-mobile.png`。当时跨层使用选择器；最新已支持直跑楼梯连续上下楼，见 `3D_UPGRADE_DELIVERY.md`。

早期三项目标截图：`artifacts/improved-editor.png`、`artifacts/improved-distance-guides.png`、`artifacts/improved-stair-editor.png`、`artifacts/improved-layout-review.png`、`artifacts/improved-budget-final.png`、`artifacts/improved-budget-mobile.png`、`artifacts/improved-ai-mobile.png`。当时“三项目标验收 · 虚构数据”的尺寸未确认，后续按用户选择以演示来源明确确认，未标成实测。所有输入报价均为测试值。早期范围见 `THREE_GOALS_DELIVERY.md`，最新流程及证据见 `PRIORITY_TWO_DELIVERY.md` 和 `artifacts/priority-two-*.png`。
