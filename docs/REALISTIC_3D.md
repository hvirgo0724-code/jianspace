# 写实三维参考预览

最新查看操作增加“顶视 / 自动旋转”，可在俯览、整栋剖面和建筑外观中使用；手动操作、模式/楼层切换、重置及页面进入后台会停止自动旋转。手机工具栏换行，浮动面板按实际工具栏高度避让，见 [参考项目改进交付](REFERENCE_PROJECT_IMPROVEMENTS.md)。

墙门高度修复：俯览现在仅透明朝向相机的外墙，不压低实体高度；门窗始终按原洞口尺寸渲染，室内隔墙保持完整，庭院矮墙保留原高。放大后的工具栏可切换透明/完整墙。详见 [完整功能回归](FULL_REGRESSION.md)。

最新渲染升级：N8AO/SMAA/ACES 后期、7个新增本地 PBR/HDR 文件、三套可调整光照与 PNG 导出、手机默认流畅及资源释放保护。实际画面和验收范围见 [渲染增强交付](RENDERING_UPGRADE.md)。

最新补充：别墅提供四套屋顶/立面组合，修复楼层断缝、Loft 重叠墙与退台缺口；手机竖屏完整取景，见 [别墅外观与楼层连接修复](VILLA_EXTERIOR_FIX.md)。

更新：2026-10-23。最新升级增加两款 CC0 家具、9种地面铺装、门控、大窗/落地窗、连续上下楼、别墅小院外观及平面图识别。完整说明与实际验收见 [3D_UPGRADE_DELIVERY.md](3D_UPGRADE_DELIVERY.md)。下文保留基础模型说明。

后续增加了完整顶面、通用吸顶灯、顶角线、门窗细节与第一人称漫游，支持沿门洞跨房间步行；操作、导航碰撞、性能和验收边界见 [第一人称漫游说明](WALKTHROUGH.md)。

## 本次变化

- 沙发：本地加载 Glam Velvet Sofa GLB，包含曲面、绒布法线、环境遮蔽、金属脚及 sheen 材质。
- 座椅：本地加载 Sheen Chair GLB，保留木框、曲面软垫与材质细节。
- 茶几、符合尺寸条件的低柜：使用 Poly Haven 的 1K glTF 模型、纹理与粗糙度资源。
- 床、高柜、书架与替代家具：参数化细化，包含倒角、床架、床垫、枕头、柔和被褥起伏、柜门、把手、底座和木纹。尺寸改变后仍可适配。
- 建筑：根据实测轮廓生成楼板、墙体、洞口、门框/门扇、玻璃/窗框、踢脚线；房间视角显示对应层高的顶面，固定设施按实际多边形挤出。
- 材质：1K 木地板颜色/法线/AO/粗糙度贴图，按约 1.7 m 材质尺度铺贴；家具木纹采用同一授权纹理的 UV 子区域；织物微纹理由本地代码生成。
- 光照：本地 HDR 环境、暖色主光/冷色补光、主光阴影和活动房间点光，使用 ACES 色调映射。最新已取消额外接触阴影通道以提高多层切换稳定性。
- 视图：全屋俯览、按相机方向透明前侧外墙、完整墙、房间内初始人眼高度视角、房间切换、重置相机、高清/流畅模式与家具尺寸标签。

## 尺寸依据

图形内部按 Three.js 的 X/Y/Z 米坐标显示，场景仍保存整数毫米。实际加载的模型会先计算完整世界包围盒，再按目标宽/高/深缩放并将底部放到地面；偏心原点不会改变摆放位置。参数化模型也使用规范化边界。

因此这些外部模型是造型参考，不能将缩放后的沙发视为原商品型号的真实规格。用户输入的家具尺寸仍独立用于碰撞、门扇和放置校验。页面、模型说明和授权页均说明了这个区别，示例报价也没有改成模型原商品价格。

床头柜会先按柜体识别，避免因名称含“床”而显示成床。宽深对调的高柜按长边布置立面，几何占地保持不变。

## 资源与授权

资源在 `apps/web/public/visuals/` 本地托管，页面不需要访问 Poly Haven/GitHub。资源总清单、文件大小、SHA-256、作者及来源见 `manifest.json`。应用工具栏的“模型来源与说明”提供可访问的作者/许可说明。

| 资源 | 作者 | 授权/来源 |
| --- | --- | --- |
| Glam Velvet Sofa | © 2021 Wayfair, LLC; Eric Chadwick | [CC BY 4.0，官方模型说明](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlamVelvetSofa) |
| Sheen Chair | © 2020 Wayfair, LLC; Eric Chadwick | [CC0，官方模型说明](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair) |
| Modern Coffee Table 02 | Amin | [Poly Haven / CC0](https://polyhaven.com/a/modern_coffee_table_02) |
| Modern Wooden Cabinet | Patrik Pangerl | [Poly Haven / CC0](https://polyhaven.com/a/modern_wooden_cabinet) |
| Sofa 03 | Fran Calvente | [Poly Haven / CC0](https://polyhaven.com/a/sofa_03) |
| Dining Table | Aron Łyczek | [Poly Haven / CC0](https://polyhaven.com/a/dining_table) |
| Wood Floor | Dimitrios Savva | [Poly Haven / CC0](https://polyhaven.com/a/wood_floor) |
| Studio Small 09 | Sergej Majboroda | [Poly Haven / CC0](https://polyhaven.com/a/studio_small_09) |

Glam 模型的本项目修改包括：按用户尺寸对齐与缩放、布料配色和光泽适配、去除模型附带灯光，使用本项目灯光。完整说明保留在 `public/visuals/licenses/` 与 `CREDITS.html`。

资源构建脚本：`scripts/fetch_visual_assets.py`。它只在开发时显式运行，使用带应用名称的 User-Agent 读取官方 API，并记录来源。Poly Haven 的 API 条款与资产授权分别见[官方 API 条款](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)和[资产授权](https://polyhaven.com/license)。

## 可靠性与性能

- GLB/glTF 按需加载、复用源几何并隔离实例材质，避免一个家具改色影响另一个项目。
- 高清模式最高 DPR 1.75、2048 主光阴影；流畅模式 DPR 1、1024 阴影。需求渲染使静止画面不持续刷新。
- 家具资源加载失败时显示细化的本地参数模型并明确提示；环境失败可使用基础灯光；3D 初始化异常时回到 2D。
- 资源完整性测试检查本地文件的 SHA-256，以及 glTF 引用的每个纹理/缓冲区均随项目存在，不依赖运行时外链。
- 本次新增几何适配、家具分类、墙洞保留、共享墙判断、室内相机与资源检查测试。浏览器实测涵盖桌面与 393 px 手机视口。

## 仍需区分的能力

当前是可交互的写实参考预览，不是照片级离线路径追踪渲染，也没有完整品牌商品目录、实测光照、施工节点或由照片重建真实房屋的能力。补充授权商品模型、材质库和更完整的照明设计后，可继续提升参考准确度。已有实测几何不会因模型资源、配色或观察角度变化而被重写。
