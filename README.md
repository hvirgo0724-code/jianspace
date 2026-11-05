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
- **9+ 种风格预设**（侘寂极简、奶油法式、法式复古、现代轻奢、工业风、日式原木、北欧、现代简约、现代中式）
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

- 上传设计图纸 + 合同报价单 → AI 批判性分析
- **卫生死角检测**：吊顶内积水区、厨房操作死角、淋浴房边缘发霉区
- **过度装修审查**：吊顶层数超标、墙面造型面积占比过高、石材铺贴不必要
- **合同隐形陷阱**：增项条款模糊、材料品牌未标注、工期违约金缺失
- **跨文档交叉核查**：设计图、报价单、合同三文档信息对比
- **增项预测**：根据行业数据预测装修过程中可能出现的增项
- 输出在线审查报告 + 可下载 PDF
- 关联预算清单中的可疑项，直接在预算页标注

### 🪨 材料清单自动匹配

> AI 风格效果图反推装修材料建议

- 从 AI 效果图自动提取墙面、地面、柜体、灯具的视觉特征
- 匹配对应的材料品类与主流品牌型号
- 提供 **三档预算建议**（经济 / 标准 / 高配）
- 可关联购买链接，一键跳转建材电商
- 支持输出完整的施工材料清单 PDF

### 🏘️ 本地 AI 户型识别

> 支持 GPU 加速的本地推理，无需依赖外部 API

- **YOLOv8** 自动识别户型结构（墙 / 门 / 窗 / 房间分区）
- **ControlNet** 轮廓/深度约束生成，保证效果图与原始户型结构一致
- **Stable Diffusion XL** 本地 GPU 推理
- 三种预设风格：现代简约、北欧风格、现代中式
- 适合部署在有 GPU 的私有服务器场景，保护户型隐私

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
cd d:\web_002\web\jianspace
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

在有 CUDA GPU 的服务器上：

```powershell
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install ultralytics diffusers transformers accelerate

# .env.docker 启用本地识别
echo "LOCAL_RECOGNITION_BACKEND=yolov8" >> .env.docker
echo "LOCAL_INFERENCE_DEVICE=cuda" >> .env.docker
```

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
| 本地识别 | YOLOv8 + SD XL + ControlNet（可选） | 户型识别与风格化生成 |
| 避坑审查 | 多模态 LLM + 本地知识库 + 联网搜索 | 合同陷阱、卫生死角、过度装修检测 |
| 材料匹配 | AI 风格分析 + 建材数据库 | 风格效果图反推材料建议、预算档位 |
| 小筑助手 | qwen3.8-27b + 知识库 + Open-Meteo | 装修问答、天气查询、闲聊模式 |
| 导出 | ReportLab / JSON / UTF-8 BOM CSV | 中文 PDF 方案、可恢复场景、清单 |

---

## 代码结构

```
jianspace/
├── apps/
│   ├── web/                    # 前端应用（React 19 + Vite）
│   │   ├── src/
│   │   │   ├── components/     # UI、场景、3D、助手等组件
│   │   │   ├── visuals/        # 3D 可视化（建筑、灯光、材质、后处理）
│   │   │   └── workspace/      # 工作台、场景编辑、布局求解
│   │   └── package.json
│   └── api/
│       ├── interior/           # 后端 FastAPI 应用
│       │   ├── routes/         # auth / projects / assets / jobs / collaboration / account / assistant
│       │   ├── providers/      # AI 提供商（百炼图像编辑等）
│       │   ├── recognition/    # 户型识别（视觉模型 / YOLOv8 本地）
│       │   ├── review/         # 装修避坑审查 + 材料匹配
│       │   ├── models.py       # SQLAlchemy 数据模型
│       │   ├── catalog.py      # 家具家电目录 + 风格预设（前后端共享）
│       │   ├── templates.py    # 11 种户型模板
│       │   ├── materials.py    # 材料清单生成
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
13. **极简快速出图** → 首页/照片页一键：上传毛坯房 → 选风格 → 30 秒拿到效果图
14. **材料清单** → AI 风格效果图 → 自动匹配材料 → 三档预算 → 施工清单 PDF
15. **小筑助手** → 右下角浮窗问装修问题、预算、天气
16. **装修避坑** → 上传合同报价单 → AI 批判分析 → 在线报告 + PDF → 关联预算可疑项
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

当前后端 **222 项**、前端 **103 项** 测试通过，**75/75 接口操作** 成功响应。

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
