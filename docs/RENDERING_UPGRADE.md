# 光影、材质与后期渲染增强

本轮把渲染扩展接入现有 Web 项目，改善物体接地、房间转角、屋瓦/灰泥表面、地面高光与室内外环境光。户型、尺寸、楼层和家具数据保持原有来源；所有浏览器验收继续使用明确标记的别墅演示项目。

## 使用入口

进入“3D 空间”，点击工具栏 **光影**：

- 选择“自然日光 / 傍晚暖阳 / 柔和阴天”。自然光和阴天使用低对比天空 HDR，暖阳使用另一套环境光；室内使用住宅 HDR。
- 调整“太阳方向”0—360°，观察直射光与投影方向；“画面曝光”0.60—1.50 用于整体亮度调整。
- 在高清模式勾选/取消“接触阴影”，对比墙角、家具脚与地面接触部位；“恢复光影”回到默认预设、方向和曝光。
- “导出当前画面”生成当前画布分辨率的 PNG，随后点击“下载 PNG 图像”。导出包括材质和后期效果，不含操作面板。它是当前画面的快照，需要新角度时重新导出。

光影设置属于当前预览会话，不修改量房结果，也不写入已保存设计的结构。第一人称先暂停再导出；AI“以此视角装修”的原入口继续使用当前画布与相机。

## 实际接入的扩展与资源

| 工具 / 扩展 | 实际版本或资源 | 用途 |
| --- | --- | --- |
| React Three Postprocessing | 3.2.2 | 管理高清后期管线 |
| postprocessing | 6.39.5 | 半浮点颜色缓冲、ACES 色调映射、SMAA 抗锯齿 |
| N8AO | 2.0.1 | 基于屏幕深度的接触阴影，世界尺度半径 0.55 m、半分辨率与深度感知上采样 |
| Three.js / Drei | 保留既有渲染框架 | HDR 环境、物理材质、太阳光和阴影 |
| Poly Haven 官方 API | 7 个新增本地文件，共 6,153,534 字节 | 两套材质细节与三套 HDR；下载时校验官方 MD5，清单记录 SHA-256、作者和来源 |
| 插件管理检索 | 查询 3D 渲染及 Blender | 本轮未发现可直接使用的 Blender 集成，因此通过项目内渲染扩展实施；没有安装同名的 Render 托管服务 |
| 浏览器 / Vitest / TypeScript / Vite | 实际验收 | 画面、交互、导出、资源生命周期和构建检查 |

N8AO 和后期管线用法参考：[N8AO 官方文档](https://react-postprocessing.docs.pmnd.rs/passes/n8ao)、[EffectComposer 官方文档](https://react-postprocessing.docs.pmnd.rs/effect-composer)。只有高清模式启用该管线，并且仅进行一次最终色调映射；不增加景深模糊或帧累积拖影。

新增资源来自 Poly Haven，遵循其 [CC0 许可](https://polyhaven.com/license)，随项目本地托管，运行页面不请求素材网站：

| 资源 | 作者 | 用法 |
| --- | --- | --- |
| [Roof Tiles 14](https://polyhaven.com/a/roof_tiles_14) | Rob Tuytel | 1K 法线、粗糙度；四坡屋顶的颜色仍由外观样式决定 |
| [Plastered Wall 02](https://polyhaven.com/a/plastered_wall_02) | Charlotte Baglioni | 1K 法线、粗糙度；增加灰泥表面细节，保持设计墙色 |
| [Kloppenheim 06 Pure Sky](https://polyhaven.com/a/kloppenheim_06_puresky) | Greg Zaal、Jarod Guest | 自然日光/阴天的 1K HDR 环境 |
| [Kiara 1 Dawn](https://polyhaven.com/a/kiara_1_dawn) | Greg Zaal | 暖阳的 1K HDR 环境 |
| [Lebombo](https://polyhaven.com/a/lebombo) | Greg Zaal | 室内住宅的 1K HDR 环境 |

地面增加材质清漆层，区分石材与木地板的反射；立面 UV 按实体宽高计算尺度，切换光照不会重复放大纹理。太阳的阴影目标现在对准建筑中心；室内顶面参与投影，避免太阳直接穿过顶棚照亮房间。已有玻璃、金属与布料材质继续保留。

## 流畅模式、降级与资源释放

手机窄屏首次进入默认采用流畅模式，1 倍像素比与 1024 阴影图，保留 HDR、材质和基础阴影；用户可以手动切换高清。高清最高像素比 1.75，2048 阴影图，并启用 N8AO/SMAA/ACES。画布继续按需渲染，静止时不持续刷新。

设备不支持浮点颜色缓冲时，自动使用基础渲染；后期组件初始化失败时隔离该组件，保留基础场景。该降级路径已有代码保护，尚未在完整低端设备矩阵中验收。

当前 N8AO 版本继承的释放方法未完整清理自有显存资源。本项目补充去重、幂等清理：释放 AO 自有缓冲、贴图及材质，不遍历或销毁借用的场景/相机；未来上游提供完整释放实现时保留其实现。两项回归测试覆盖重复释放、共享引用和上游兼容，浏览器实际切换高清/流畅六次后仍正常渲染。

## 验收证据

- 前端 **74 项测试通过**；TypeScript 严格检查、生产构建通过。后端没有变更，沿用上一轮179项基线，本轮未重复执行后端全套。
- 官方资源清单中 **38 个文件**全部通过大小与 SHA-256 校验，未发现重复路径；新增7个文件约5.87 MiB。审计在 `artifacts/render-enhancement/asset-audit.json`。
- 桌面1280×720：室内/外观、三套光照、方向0°/125°、曝光调到1.50、恢复默认、接触阴影开关、反复切换画质均有实际页面检查。
- 第一人称高清状态下 W 行走并暂停，位置更新到 X 1.87 / Y 1.57 / 标高0.00 m，增强管线保持启用。
- 导出按钮生成并下载 **1256×696 PNG**，通过图片文件检查与视觉检查确认内容非空，带当前后期效果。文件：`artifacts/render-enhancement/interior-export.png`。
- 手机393×852模拟视口：默认流畅，手动切换高清可用；面板与下载入口可访问，内容宽度等于视口宽度，无横向溢出；临时视口已恢复。
- 最终浏览器检查没有新增控制台 error。GPU 驱动曾对后期着色器循环中的梯度指令报告一条 warning；画面成功渲染，未当作无警告或全硬件兼容验收。

![日光与设置面板](../artifacts/render-enhancement/daylight-final.png)

![暖阳与不同太阳方向](../artifacts/render-enhancement/golden-final.png)

![直接导出的室内 PNG](../artifacts/render-enhancement/interior-export.png)

## 维护入口

- `apps/web/src/components/visuals/Lighting3D.tsx`：光照预设、曝光、太阳目标与 HDR。
- `RenderEffects3D.tsx`、`aoResources.ts`：后期效果及 AO 资源释放；路径同上。
- `pbrTextures.ts`、`Exterior3D.tsx`、`SurfaceMaterial.tsx`：PBR 细节、立面纹理尺度与地面高光；路径同上。
- `apps/web/src/components/Scene3D.tsx`：光影面板、画质策略、降级与 PNG 快照。
- `scripts/fetch_render_assets.py`：手动更新本轮资源，并保留原资源清单。原 `fetch_visual_assets.py` 也已调整为保留其他脚本管理的清单条目。
- `apps/web/public/visuals/CREDITS.html`、`manifest.json`：页面授权说明、完整来源与哈希。

本轮属于实时栅格化渲染增强。没有接入离线路径追踪、Blender 云渲染或 AI 任意网格生成；也没有验证真实手机帧率、所有 GPU 或照片级质量。光照预设用于视觉参考，不代表真实日照、照度或施工计算。本轮无需额外 API Key，也没有消耗 AI 模型额度。
