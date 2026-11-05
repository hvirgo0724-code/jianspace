# 筑见 JianSpace

> **每一寸真实，都有理想的模样。**

筑见是一款以实测尺寸为根基、融合 AI 能力的全链路家装设计平台。从量房、户型编辑、2D/3D 可视化，到 AI 效果图生成、布局求解、预算清单、材料匹配和装修避坑审查——一个项目，贯穿从毛坯到理想家的全部环节。

当前版本 **0.2.0**。

---

## 核心能力

### 📐 实测驱动的 2D / 3D 设计

- 毫米级实测录入，支持 mm / cm / m 自动换算
- 从 **11 种户型模板** 快速起步（含独栋花园别墅、三居室、Loft）
- 从平面图 **AI 识别生成户型**（视觉模型识别墙/门/窗/房间）
- **同一份场景** 驱动 2D 编辑与 3D 渲染，两个视图始终一致
- 规则布局求解器，一次输出最多三个通过硬约束校验的方案

### 🎨 写实 3D 预览与漫游

- 授权家具模型、PBR 木纹、布料材质、环境光、接触阴影
- 全屋俯览、房间视角、可跨门洞行走的 **第一人称漫游**（WASD / 摇杆）
- 别墅外观四套风格切换：**现代平顶、北欧双坡、地中海四坡、新中式深檐**
- 9 种分房间地面铺装、落地窗/全景大窗、整栋剖面
- **N8AO 接触阴影 + SMAA + ACES** 后期处理，日光/暖阳/阴天三种光照预设
- PNG 导出与手机高清/流畅双档

### 🤖 AI 效果图与局部改图

- 选择房间照片或 3D 视角参考 → AI 生成装修效果图
- **12 种风格预设**（原木自然、现代简约、奶油柔光、侘寂极简、中古复古、北欧清新、奶油法式、法式复古、现代轻奢、工业风、日式原木、现代中式）
- 画笔蒙版局部改图，未涂抹区域逐像素保持原图
- 六项视觉结构检查 + 尺寸来源标注（演示 / 实测）
- 多模型备用切换（百炼图像编辑 API）
- **极简三步骤快速出图**：上传毛坯房 → 选风格 → 一键生成，30 秒拿到效果图

### 🏠 家具家电库（48 款 / 8 类）

- 分类搜索、精确尺寸调整、旋转锁定、离地高度编辑
- 包含冰箱、洗衣机、空调、电视、餐厨柜体、卫浴、灯饰、绿植
- 壁挂和台面物品带默认离地高度

### 📋 预算清单与导出

- 材料、人工、水电、预留金分项计算
- 区分已知价格与待询价项
- 一键导出 PDF / JSON / UTF-8 BOM CSV
- 受控分享（默认 72 小时有效，可撤销）

### 🧱 装修避坑审查

> 面向装修消费者的 AI 批判审查引擎，帮助在签合同前发现隐形陷阱

- 入口：项目工作台侧边栏「装修避坑审查」（`/projects/:id/review`）
- 上传合同 / 报价单 / 设计说明（PDF / TXT / MD / CSV），或直接粘贴文字
- **本地知识库**：18 条规则覆盖卫生死角、过度装修、合同陷阱、增项预测四类
- **大模型批判分析**：由百炼文本模型补充语义级陷阱，返回结构化条目与原文依据
- **跨文档交叉核查**：合同与报价单金额差异 ≥15%、设计说明有而报价单缺项、合同缺总价
- **增项预测**：按坑位条目给出预估影响金额，汇总为预计增项总额
- 在线报告 + 可下载 PDF（含评分、分项统计与逐条建议）
- 审查结果可关联预算清单条目（`budgetItemIds`）

> 未配置或密钥失效时自动降级为纯本地规则，并在报告中标注原因。

### 🪨 材料清单自动匹配

> AI 风格效果图反推装修材料建议

- 入口：项目工作台侧边栏「材料清单」（`/projects/:id/materials`）
- 按套内面积（可自动从房间轮廓求和）与风格生成地面 / 墙面 / 柜体 / 卫浴 / 灯具清单
- 输出 **三档预算**（经济 / 标准 / 高档），含各档单价、管理费比例与合计
- 上传 AI 效果图，视觉模型反推可见表面材料（材质、颜色、工艺、置信度）
- 每项材料给出三档替代方案建议，可导出 CSV

### 🏘️ 本地 AI 户型识别

> 支持 GPU 加速的本地推理，无需依赖外部 API

- **YOLOv8** 检测墙 / 门 / 窗 / 房间，检测框按图像比例映射为毫米坐标，
  洞口自动吸附到最近墙体并计算偏移
- **ControlNet** 轮廓 / 深度约束生成，保持户型结构不变只换风格
- 三种后端可在 `/api/recognition/backend` 查看，按 `LOCAL_RECOGNITION_BACKEND` 切换
- 未安装可选依赖时返回明确安装指引，不影响云端识别与其余功能

### 💬 小筑 · 家装管家

- 工作台右下角浮窗 AI 助手
- 装修知识问答、预算区间建议、设计与施工问题
- 回答带来源、意图标签和页面动作（跳到预算清单 / 空间设计）
- 天气按城市实时查询（Open-Meteo，无需密钥）
- 知识不足时可提交转人工工单

---

## 立即运行

环境：Node.js 22+、Python 3.12、SQLite（开发）/ PostgreSQL 17（生产）。

```powershell
cd D:\project\jianspace
.\scripts\dev.ps1
```

浏览器访问 **http://127.0.0.1:5180**；接口文档 **http://127.0.0.1:8000/docs**。

### 首次安装

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/api/requirements.lock.txt
npm.cmd ci
Copy-Item -LiteralPath .env.example -Destination .env
```

### Docker 一键部署

```powershell
.\scripts\docker-deploy.ps1
# 访问 http://127.0.0.1:8080
```

一键启动 PostgreSQL、Redis、API、Celery Worker、Nginx。

### 接入 AI 效果图

在 `.env` 中配置阿里云百炼 API：

```dotenv
DASHSCOPE_API_KEY=你的密钥
DASHSCOPE_IMAGE_MODEL=qwen-image-2.0-pro
ALLOW_AI_CALLS=true
AI_IMAGE_CREDITS=10
AI_INPAINT_CREDITS=8
DASHSCOPE_TEXT_MODEL=qwen3.8-27b   # 可选：小筑文本模型
WEATHER_DEFAULT_CITY=上海           # 可选：小筑天气查询
```

### 启用本地 GPU 识别

两个可选能力相互独立，未安装时接口会返回安装指引而不是崩溃。

```powershell
# 本地 YOLOv8 户型识别
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install ultralytics

# ControlNet 结构约束生成
pip install diffusers transformers accelerate

# .env 启用本地识别
LOCAL_RECOGNITION_BACKEND=yolov8
LOCAL_INFERENCE_DEVICE=cuda
YOLOV8_WEIGHTS=yolov8n-floorplan.pt
CONTROLNET_MODEL=diffusers/controlnet-canny-sdxl-1.0
CONTROLNET_BASE_MODEL=stabilityai/stable-diffusion-xl-base-1.0
```

> YOLOv8 需要自备户型专用权重（类别名须包含 wall / door / window / room）。
> 检测框按图像比例换算为毫米坐标，洞口自动吸附到最近墙体。

> 避坑审查与材料反推依赖 `DASHSCOPE_API_KEY` 与 `DASHSCOPE_TEXT_MODEL` /
> `DASHSCOPE_VISION_MODEL`；密钥无效时会自动降级为本地规则并提示原因。

---

## 技术栈

| 层 | 选型 | 目的 |
| --- | --- | --- |
| 前端 Web | React 19 / TypeScript / Vite | 独立浏览器应用，严格类型 |
| 状态与请求 | Zustand / TanStack Query | 场景历史、异步任务、服务端状态 |
| 2D 编辑 | React Konva | 毫米坐标、家具拖动、房间绘制 |
| 3D 渲染 | Three.js / React Three Fiber / Drei | 同源几何、真实洞口分段墙、尺寸化家具 |
| 3D 后处理 | postprocessing（N8AO/SMAA/ACES） | 接触阴影、抗锯齿、色调映射 |
| 后端 API | FastAPI / Pydantic | 验证、权限、统一错误 |
| 数据层 | SQLAlchemy / Alembic | 开发 SQLite，部署 PostgreSQL + JSONB |
| 几何引擎 | Shapely / JSON Schema | 轮廓、净边界、墙面对齐、碰撞与门扇校验 |
| 异步任务 | 开发数据库调度器；部署 Celery / Redis | 持久队列、取消、幂等、中断恢复 |
| 生图 | 阿里云百炼 Qwen 图像编辑适配器 | 付费真实调用，多模型备用切换 |
| 本地识别 | YOLOv8 检测框→mm 映射 + SDXL ControlNet（可选） | 户型识别与结构约束生成 |
| 避坑审查 | 本地知识库 + 百炼文本模型 + 跨文档金额核查 | 合同陷阱、卫生死角、增项预测 |
| 材料匹配 | 百炼视觉模型 + 三档单价模型 | 效果图反推材料、用量与预算档位 |
| 小筑助手 | qwen3.8-27b + 知识库 + Open-Meteo | 装修问答、天气查询、闲聊模式 |
| 导出 | ReportLab / JSON / UTF-8 BOM CSV | 中文 PDF 方案、可恢复场景、清单 |

---

## 代码结构

```
jianspace/
├── apps/
│   ├── web/                    # 前端应用（React 19 + Vite）
│   │   ├── src/
│   │   │   ├── components/     # UI、场景、助手、审查、材料与快速出图组件
│   │   │   │   └── visuals/    # 3D 可视化（建筑、灯光、材质、后处理）
│   │   │   ├── Workspace.tsx   # 工作台、场景编辑与布局求解
│   │   │   └── api.ts / store.ts / scene.ts
│   │   └── package.json
│   └── api/
│       ├── interior/           # 后端 FastAPI 应用
│       │   ├── routes/         # auth / projects / assets / jobs / collaboration / account / assistant / review
│       │   ├── providers.py    # 百炼图像编辑与文本模型调用
│       │   ├── recognition.py  # 户型识别（云端视觉 / YOLOv8 毫米坐标映射）
│       │   ├── controlnet.py   # ControlNet 结构约束生成适配器
│       │   ├── review.py       # 避坑审查引擎 + 跨文档核查 + 材料清单 + PDF 报告
│       │   ├── models.py       # SQLAlchemy 数据模型
│       │   ├── catalog.py      # 家具家电目录 + 12 种风格预设
│       │   ├── templates.py    # 11 种户型模板
│       │   ├── exports.py      # PDF / JSON / CSV 导出
│       │   ├── assistant.py    # 小筑家装管家 prompt
│       │   ├── config.py       # Settings（环境变量）
│       │   └── main.py         # FastAPI 入口
│       ├── migrations/         # Alembic 迁移
│       └── tests/              # 后端测试
├── packages/
│   ├── scene/                  # 场景 Schema、参考场景、量房模板
│   └── catalog/                # 家具家电目录定义
├── docs/                       # 项目文档
├── infra/                      # Dockerfile、Nginx 配置
├── scripts/                    # dev.ps1 / docker-deploy / 备份 / 运维
├── data/                       # SQLite 数据库、资产文件
├── compose.yaml                # Docker Compose
├── .env.example                # 环境变量模板
└── README.md
```

---

## 推荐体验路径

1. **首页** → "开启设计体验" 创建本地体验账户和两空间示例
2. **工作台** → "新建项目" 选三居室 / Loft / 别墅模板，或"上传平面图"启动 AI 识别
3. **实测与户型** → 输入房间净宽、进深、层高（mm/cm/m 自动换算）
4. **场景对象与门窗** → 选择墙/洞口，输入门窗偏移、宽高、开向
5. **照片** → 上传毛坯/房间照片，标注房间、方向、拍摄位置
6. **校验场景** → 确认尺寸来源（实测/演示），结构冻结
7. **家具家电库** → 按分类/搜索添加，2D 拖动旋转，3D 漫游检查
8. **生成布局** → 规则求解器最多输出三个方案，不依赖外部 AI
9. **方案比较** → 并排检查、评论、载入草稿继续修改
10. **保存方案** → 冻结版本；"预算清单" 区分已知价格与待询价项
11. **AI 效果图** → 照片页或 3D 视角 → 选风格 → 生成 → 结构复核
12. **局部改图** → 画笔涂抹可修改区域 → 提交 → 未涂抹区域像素保持
13. **三步快速出图** → 工作台侧边栏「三步快速出图」：上传照片 → 选风格 → 生成
14. **材料清单** → 工作台侧边栏「材料清单」：面积与风格 → 三档预算与用量 → 上传效果图反推材料 → 导出 CSV
15. **小筑助手** → 右下角浮窗问装修问题、预算、天气
16. **装修避坑** → 工作台侧边栏「装修避坑审查」：上传合同/报价单/设计说明 → 规则+大模型+跨文档核查 → 报告 PDF
17. **导出 & 分享** → PDF / JSON / CSV，分享链接默认 72h

---

## 开发与测试

```powershell
# 完整检查
.\scripts\check.ps1

# 或分别执行
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q
npm.cmd test
npm.cmd run build
.\.venv\Scripts\ruff.exe check apps/api scripts --select F
```

当前后端 **240 项**、前端 **103 项** 测试通过。

---

## 数据与安全

- 整数毫米、右手系 Z 向上；2D 屏幕 Y 取反，Three.js 映射为 `[x/1000, z/1000, -y/1000]`
- `structureHash` 覆盖场景格式、单位、坐标系与 `floors`；配色或家具改变不使实测失效
- 会话使用 Cookie + CSRF Token，请求体 ≤ 17MB
- 私有照片和 3D 资产仅对授权成员可见
- 注册账户需邮箱验证；体验账户本地创建，100 测试积分
- 自助注销：邮箱确认，数据立即失效、物理清理由运维命令回收

---

## 部署

### Docker Compose（推荐生产部署）

```powershell
.\scripts\docker-deploy.ps1
```

自动构建 API / Web 镜像、启动 PostgreSQL + Redis + Celery Worker + Nginx。访问 **http://127.0.0.1:8080**。

详细说明见 [README-DOCKER.md](README-DOCKER.md)。

### 本地开发

SQLite + 数据库调度器 + 私有文件存储，见 `.\scripts\dev.ps1`。

### 备份

```powershell
.\.venv\Scripts\python.exe scripts/backup.py --output backups --label before-upgrade
```

复制数据库与 `data/assets/`，写入 SHA-256 manifest。

---

## License

私有项目，版权所有。
