# AI 模型、地域与备用模型配置

更新：2026-10-23。配置文件为项目根目录 `D:\project\jianspace\.env`。不要修改前端代码或把密钥发到聊天。`.env.example` 是模板；运行中的后端读取 `.env`，保存后需重启 API，使用 Celery 时还需重启 worker。

## 最常用配置

```dotenv
DASHSCOPE_API_KEY=你自己的百炼服务端密钥
DASHSCOPE_API_BASE=https://dashscope.aliyuncs.com
DASHSCOPE_IMAGE_MODEL=qwen-image-2.0-pro
DASHSCOPE_IMAGE_FALLBACK_MODELS=qwen-image-2.0
ALLOW_AI_CALLS=true
# 可选：生图后增加一次视觉结构检查，会产生服务商 token 用量
AI_STRUCTURE_REVIEW_ENABLED=true
DASHSCOPE_VISION_MODEL=qwen3-vl-plus
```

顺序：`qwen-image-2.0-pro` → `qwen-image-2.0`。备用项为空表示只用主模型；多项用英文逗号分隔，主模型与备用模型去重后合计最多三个。不会并行生成多张，每个候选每次任务最多尝试一次，成功即停止。需使用账户实际可用的模型；本机后续配置修正及主模型真实验收记录见 `AI_LIVE_VALIDATION.md`，备用模型权限仍待真实验证。

## 地域改哪里

| 地域 | `DASHSCOPE_API_BASE` | 密钥 |
| --- | --- | --- |
| 华北 2（北京） | `https://dashscope.aliyuncs.com` | 北京地域的 API Key |
| 新加坡 | `https://dashscope-intl.aliyuncs.com` | 新加坡地域的 API Key |

上述旧域名官方仍支持。官方现建议使用百炼控制台给出的业务空间专属 **API Host**：北京为 `https://你的业务空间ID.cn-beijing.maas.aliyuncs.com`，新加坡为 `https://你的业务空间ID.ap-southeast-1.maas.aliyuncs.com`。用真实业务空间 ID 替换示例文字。填写 Host 即可，不要加 `/api/v1`、`/compatible-mode/v1` 或完整接口路径。

地域的 Host 和 Key 必须一起匹配；模型也必须在该地域/业务空间可调用。当前备用列表共用同一 Host 和同一 Key，不自动跨地域或切换其他厂商。

## 哪些模型可互为备用

当前适配器使用千问图像编辑的同步、多图请求格式，支持 `qwen-image-2.0-pro`、`qwen-image-2.0` 及其日期快照。可在控制台确认可用后填写例如 `qwen-image-2.0-pro-2026-06-22` 作为第二备用：

```dotenv
DASHSCOPE_IMAGE_FALLBACK_MODELS=qwen-image-2.0,qwen-image-2.0-pro-2026-06-22
```

日期快照的格式通过校验不代表你的账户一定有权限或免费额度；具体可用性以控制台和实际 API 返回为准。普通对话模型、视觉理解模型和其他图像协议不能直接混入列表。`DASHSCOPE_VISION_MODEL` 用于生图后的可选结构检查及独立的平面图识别，不能作为生图备用。

## 平面图识别

“平面图生成 3D”共用 `DASHSCOPE_VISION_MODEL`、Host 和 Key，需 `ALLOW_AI_CALLS=true`，无需启用生图后的结构检查。默认 `AI_PLAN_CREDITS=5` 是一次成功识别扣除的应用积分，服务商视觉 token 另计；一次最多调用一个视觉模型，不沿用生图备用列表或自动重试。输入总宽包含外墙厚度，结果仍是待量房复核的近似草稿。真实演示识别和操作步骤见 [3D_UPGRADE_DELIVERY.md](3D_UPGRADE_DELIVERY.md)。

## 小筑文本模型

`DASHSCOPE_TEXT_MODEL` 留空时，小筑只使用代码内的规则知识库回答，装修之外的日常问题会提示转人工，不产生模型费用。填写模型名（当前本地为 `qwen3.8-27b`）并保持 `ALLOW_AI_CALLS=true` 后，装修问题会把项目事实与检索到的知识条目注入提示词，非装修问题则按通用闲聊模式交给模型；天气不走模型，由 Open-Meteo 实时接口直接回答。调用使用百炼 OpenAI 兼容接口 `{API_BASE}/compatible-mode/v1/chat/completions`；`qwen3.8-27b` 在原生文本生成接口会返回 URL 错误。

文本模型调用失败、超时或返回空内容时，服务端自动退回规则回答，并在会话消息中标记 `mode=rules`，不会把失败伪装成 AI 成功。文本模型使用服务商 token，不扣应用积分；当前没有按用户或项目的文本调用预算上限，正式开放前应补上。

## 带蒙版局部改图

局部改图沿用生图主模型与备用链，一次请求发送底图、黑白蒙版和局部要求，成功时结算 `AI_INPAINT_CREDITS`（默认 8）。供应商没有原生 mask 参数时，服务端在返回后按蒙版合成：蒙版外直接使用底图像素，因此存储结果的蒙版外差异恒为 0；蒙版内采用模型输出（尺寸不一致时缩放到底图尺寸）。蒙版必须为 PNG 且与底图同尺寸，覆盖率限制在 0.2%–85%，蒙版作为私有资产保存并关联底图和任务。

该实现保证“区域外不变”由服务端强制，不代表模型一定正确理解蒙版；接缝、光照、透视和区域内容仍需人工复核。结果不是尺寸依据，也不会修改实测场景。若需要供应商原生 mask 编辑或羽化接缝，应先在供应商文档与实测中确认能力，再替换当前适配层。

## 生图后的结构检查

`AI_STRUCTURE_REVIEW_ENABLED` 默认是 `false`。设为 `true` 并重启 API/worker 后，每次带尺寸引导的生图最多额外请求一次视觉模型，比较尺寸平面、原始参考和结果图中的墙、门、窗、相机视角、家具及比例。当前默认使用支持 JSON 输出的 `qwen3-vl-plus`，沿用同一地域 Host 和 Key；配置检查会拒绝不支持该输出方式的型号。

视觉检查与生图分别产生服务商用量。当前应用对一次成功任务仍只结算 `AI_IMAGE_CREDITS`（默认 10）一次，不额外扣第二笔应用积分。检查失败或信息不足会保留待人工复核，不把检查失败当作一致，也不会自动重生图或重试视觉请求。

自动检查是视觉提示，不能验证毫米尺寸或保证识别正确。发现差异时结果保持“待调整”；保存人工意见不能抹掉自动记录的高风险。原始场景几何不会根据效果图改变。用户可点击“根据差异重新调整”打开下一次确认页面，自行编辑并提交新任务。

## 什么时候自动切换

| 服务商返回 | 行为 |
| --- | --- |
| HTTP 403 + `AllocationQuota.FreeTierOnly` | 免费额度用尽且用完即停，尝试下一模型 |
| HTTP 429 + `Throttling.RateQuota` / `Throttling.AllocationQuota` | 明确限流，尝试下一模型 |
| 成功 | 保存图片、实际模型和尝试记录，停止后续调用 |
| 全部候选明确不可用 | 任务失败，释放预留的应用积分 |
| 密钥错误、账户欠费、权限/模型错误、内容拒绝 | 停止并显示错误，修正后再提交 |
| 网络超时、5xx、结果格式异常、已生成后的下载失败 | 不自动重生图；先核对百炼调用记录，避免重复计费 |

切换由明确的 API 拒绝触发，不预先读取或预测账户免费额度。每次新任务从主模型开始。没有修改百炼控制台设置，也没有自动开通、充值或创建密钥。

## 免费额度和计费

如果你的目的是优先使用免费额度，请在百炼控制台为**每个候选模型**提前开启“免费额度用完即停”。已认证账户如果没有开启，免费额度耗尽可能直接转按量计费，此时 API 成功返回，程序不会触发切换。新加坡等其他地域不能假定有北京地域的免费额度。

同一主体的主账号/RAM 用户共享对应额度；创建更多 Key 不等于新增免费额度。模型之间可能有独立额度，但是否赠送、余量、到期与权限均以当前控制台为准。备用模型同样可能收费，切换不保证免费，也不能解决账户欠费。不同模型效果、速度和服务商单价可能不同。

项目中的应用积分与阿里云账单是两套记录：切换不会重复扣应用积分，一次成功任务按确认的额度扣一次，全部失败释放；服务商账单仍以百炼记录为准。

## 本机检查

```powershell
cd D:\project\jianspace
.\.venv\Scripts\python.exe scripts\check_ai_config.py
```

输出配置是否存在、启用状态、模型顺序、API Host、结构检查开关/模型和配置错误，不打印 Key、不发送请求，也不验证实际余量和模型权限。真实生成需要另外验收。

新增切换测试使用模拟 HTTP 响应，覆盖额度/限流、顺序去重、成功后停止、全部失败释放、成功只结算一次、鉴权/欠费/内容拒绝/超时/下载失败时停止。测试不会继承本机 `.env` 中的付费开关或密钥。后续已进行一次主模型真实接口验收，结果与严格几何限制见 [AI_LIVE_VALIDATION.md](AI_LIVE_VALIDATION.md)。

参考：[图像编辑 API 与地域](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)、[视觉理解](https://help.aliyun.com/zh/model-studio/vision)、[JSON 输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)、[免费额度与用完即停](https://help.aliyun.com/zh/model-studio/new-free-quota)、[限流规则](https://help.aliyun.com/zh/model-studio/rate-limit)。
