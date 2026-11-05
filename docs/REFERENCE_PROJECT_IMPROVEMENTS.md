# 参考 web_001 的项目体验完善

本轮参考项目为 `D:\web_001\interior-studio`。已将项目概览、设计步骤、工作台筛选/排序和复制、3D 顶视/自动环绕接入当前 `D:\project\jianspace` 工程。继续使用现有 React、FastAPI、数据库与权限/保存流程，无新增依赖或数据库迁移。

最终验证：**后端 188 项、前端 91 项测试通过**；**58/58 个业务接口操作**均获得至少一次 2xx 响应；严格类型检查、生产构建与 Ruff F 检查通过。桌面和手机模拟视口完成本轮新增功能验收。

## 参考来源与实现

| 参考项目文件 | 借鉴点 | 当前接入方式 |
| --- | --- | --- |
| `app/studio/projects/[id]/page.tsx` | 户型概览、资料状态、下一步提示、版本记录 | 新增项目概览页；数据来自当前草稿、后端实时校验、实际附件、不可变方案和任务 |
| `app/studio/page.tsx` | 项目操作与检索 | 增加项目统计、名称/说明搜索、尺寸状态筛选、名称/面积/更新排序、创建独立副本 |
| `components/studio/scene-3d.tsx` | 顶视、自动旋转、视角控制 | 接入现有 R3F 场景与完整墙门几何；在本层俯览、整栋剖面、建筑外观提供相机操作 |
| 项目页与编辑页的分步导航 | 从量房走向设计、版本和交付 | 增加四个可点击步骤，直接进入已有编辑器、版本比较与预算页面 |

参考目录仅用于阅读；交付代码和验收文件均保存在筑见目录。

## 使用入口

打开项目后默认进入“项目概览”，原空间编辑器位于左侧“空间设计”或“进入设计”。

- 顶部步骤：“核对尺寸 → 设计布局 → 比较版本 → 预算交付”，电脑和手机均可直接切换。
- 概览展示室内净面积、楼层、空间/门窗与家具数量；多层住宅支持切换户型预览楼层。
- 资料状态展示结构校验、尺寸来源、当前结构的方案、上传照片、已录装修报价和待询价家具。
- 后端未返回校验时显示检查中/失败，不把空问题列表当成校验通过；失败可重试。
- 点击具体问题进入实测与户型，选中相关门窗/家具并带入完整问题列表。修改后重新检查当前草稿。
- 当前结构方案按几何版本 ID 和实际楼层数据共同判断，避免草稿已改、ID 尚未更新时把旧结构方案标成当前结构。
- 照片明确选填，生成图和平面图不计作上传房间照片；未知报价仍单列，明确填写的 0 元保留。
- 概览中的下一步提示根据当前校验、确认和版本状态变化；仅提供操作入口，不代替确认或自动提交付费任务。

![项目概览](../artifacts/reference-improvements/overview-desktop.png)

工作台中，可组合使用名称/项目说明搜索、尺寸状态筛选和三种排序。没有匹配结果时可清除筛选。当前列表最多加载服务端允许的 100 个项目，尚未加入分页 UI。

点击项目卡片底部“复制项目”图标，填写副本名称，即可创建独立草稿。保留最新草稿的户型、家具、材质与报价；确认状态重置，照片、识别原图、版本、任务和分享链接不复制。仍需重新核对尺寸来源。

## 3D 查看改进

进入“空间设计 → 3D 空间”：

- **顶视**：从房屋上方查看布局，再点击恢复透视；墙和门窗保持场景原始尺寸。
- **自动旋转**：环绕观察模型；再次点击、手动拖动、重置、切换楼层/视角或页面进入后台时停止。默认为关闭，停止后恢复按需渲染。
- 顶视切到自动旋转时先恢复透视，避免在顶点原地旋转；房间视角与步行漫游沿用原有相机和导航。
- 手机工具栏可换行，全部按钮保留；光影、门控与资源说明面板通过 `ResizeObserver` 获取实际工具栏高度，显示在工具栏下方并限制高度。

![顶视布局](../artifacts/reference-improvements/top-view.png)

## 同步修复的复制问题

原复制接口会保留 `layout.planSource.assetId`，该附件属于原项目。副本随后保存时会因附件归属检查失败而被拒绝。现已移除副本中的原图关联，并继续清除测量附件引用，保留可编辑的识别几何并要求重新确认。

副本名称在服务端校验长度、去除两端空格并拒绝空白名称；无效请求不创建项目。对应集成测试覆盖上传虚构图纸、关联来源、复制、副本再次保存及原项目完全保持的流程。

本地 API 已在无排队/运行任务的情况下重启加载修复，仍使用 8000 端口。页面刷新即可使用本轮更新。

## 验收结果与证据

| 检查 | 结果 |
| --- | --- |
| 前端 Vitest | 14 个文件，91 passed；新增 10 项工作流/版本判断/相机测试 |
| 后端 pytest | 188 passed；新增 2 项副本关联和名称校验集成测试 |
| HTTP 操作审计 | 58/58，各有至少一次 2xx；不代表全部分支覆盖率 |
| TypeScript / Vite / Ruff F | 全部通过 |
| 工作台正常 UI | 尺寸状态筛选、面积排序、无匹配提示、清除筛选、独立副本创建通过 |
| 概览与步骤 | 原项目 4 个方案、1 张上传照片、1 个报价房间、1 件待询价；四个步骤均可进入对应页面 |
| 保存与问题定位 | 副本客厅宽 4200→4300 mm，刷新保持 37.50 m²；暂改为 1000 mm 检出 4 项错误，点击定位窗洞属性，撤销恢复无错误 |
| 3D | 实际顶视渲染；两张相隔时间的截图显示自动环绕；切换房间视角后恢复俯览，旋转状态为关闭 |
| 手机模拟视口 | 393×852：页面 clientWidth 与 scrollWidth 同为约394（设备像素换算）；工具栏右边界378.6以内，光影面板 top121 > 工具栏 bottom111.2 |
| 控制台 | 最终主页面 error 列表为空 |
| 数据和费用 | 原项目37.00 m²，副本37.50 m²；副本附件/版本/任务均0；积分85可用、0冻结，无付费AI调用 |

新增副本为“参考改进验收 · 虚构副本”，保留未确认状态。修改和冲突测试仅使用该副本。原项目“全功能回归 · 虚构测试”继续明确标记演示来源。没有发送邮件或创建新分享。

原始证据：[API 审计](../artifacts/reference-improvements/api-operations.json)、[保存状态](../artifacts/reference-improvements/persistence-audit.json)、[浏览器验收](../artifacts/reference-improvements/browser-audit.json)。

其他截图：[工作台筛选](../artifacts/reference-improvements/dashboard-filtered.png)、[概览错误状态](../artifacts/reference-improvements/overview-errors.png)、[环绕开始](../artifacts/reference-improvements/orbit-start.png)、[环绕后续](../artifacts/reference-improvements/orbit-later.png)、[手机概览](../artifacts/reference-improvements/overview-mobile.png)、[手机顶视](../artifacts/reference-improvements/top-view-mobile.png)、[手机光影面板](../artifacts/reference-improvements/mobile-lighting.png)。

复验命令：

```powershell
cd D:\project\jianspace
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q -p scripts.function_audit_plugin --function-audit-output=artifacts/reference-improvements/api-operations.json
npm.cmd test
npm.cmd run build
.\.venv\Scripts\ruff.exe check apps/api scripts/function_audit_plugin.py --select F
```

当前改进未新增 AI 服务，也未重新验收真实付费模型、外部邮件、部署或真机性能。此前墙门修复与更广的功能验收见 [FULL_REGRESSION.md](FULL_REGRESSION.md)，仍未实现的范围见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。
