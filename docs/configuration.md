<a id="model-config"></a>

# 模型与环境变量配置

完整模板见 [`.env.example`](../.env.example)。实际值写入仓库根目录的 `.env`，更改后重启服务。

后端从项目根目录读取 `.env`；系统环境变量优先。配置只在服务端使用，**不要把密钥改成 `VITE_*` 变量或放进前端源码**。

### 方案 A：Google Vertex AI

填写以下字段：

| 变量 | 用途 |
| --- | --- |
| `GCP_PROJECT_ID` | 你的 Google Cloud 项目 ID |
| `GCP_CLIENT_EMAIL` | 服务账号邮箱 |
| `GCP_PRIVATE_KEY` | 服务账号私钥，使用双引号包裹，保留 `\n` 换行转义 |
| `GCP_TOKEN_URI` | OAuth 令牌地址，通常保留模板值 |
| `VERTEX_LOCATION` | 模型调用区域 |
| `VERTEX_GEMINI_MODEL` | 创意与分镜模型 |
| `VERTEX_IMAGE_MODEL` | 分镜预览图模型 |
| `VERTEX_VEO_MODEL` | 视频生成模型 |

服务账号需要相应 API 权限，项目需开通所用服务与计费。模型名称、地区可用性和额度以自己的账号为准；模板中的名称是配置示例。

Vertex 凭证和三个模型字段齐全时，文本与图像优先使用 Vertex。Google Cloud TTS 复用该服务账号，通过 `TTS_ENABLED` 控制是否启用。

### 方案 B：OpenAI 兼容接口与自定义视频服务

没有配置 Vertex 时，可分别接入文本与图像服务：

| 能力 | 必填变量 | 接口约定 |
| --- | --- | --- |
| 文本 | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | 基础地址后追加 `/chat/completions` |
| 图像 | `IMAGE_BASE_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL` | 基础地址后追加 `/images/generations` |
| 视频网关 | `VIDEO_MODE=http`、`VIDEO_API_URL` | 按网关要求配置 `VIDEO_MODEL` 和 `VIDEO_API_KEY` |

基础地址填写到 API 根路径，例如以 `/v1` 结尾的服务地址，不要重复填写完整方法路径。不同服务的模型能力与请求字段可能不同，自定义视频网关适配见 [`src/server/providers/video.js`](../src/server/providers/video.js)。

异步视频任务还需配置 `VIDEO_STATUS_URL`，其中 `{id}` 会替换为任务 ID。

### 视频模式与本地合成

| `VIDEO_MODE` | 行为 |
| --- | --- |
| 留空 | 按 Vertex → 自定义视频接口 → Mock 的顺序选择 |
| `vertex` | 使用 Vertex 视频模型 |
| `http` | 使用自定义视频接口 |
| `manual` | 复制提示词到外部工具制作，再回传素材 |
| `mock` | 用占位视频验证流程，需要 FFmpeg 才能产出视频文件 |

FFmpeg 与字体配置示例（路径按本机安装位置修改）：

~~~dotenv
FFMPEG_PATH=C:/tools/ffmpeg/bin/ffmpeg.exe
SUBTITLE_FONT=C:/Windows/Fonts/msyh.ttc
~~~

Linux 字体路径示例：`/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`。FFmpeg 构建需支持 `libx264`、`aac` 和 `drawtext`。可先运行 `ffmpeg -version` 确认安装，再在工作台右上角查看环境状态。

配音相关参数包括 `TTS_ENABLED`、`TTS_VOICE`、`TTS_AMBIENT_VOLUME` 和 `TTS_VO_VOLUME`。其他可选参数以 [配置模板](../.env.example) 为准。

[返回中文首页](../README.md) · [English overview](../README.en.md)

## 创作资料与自动审核

品牌自身信息保存在 `config/business/brand-guide.json`；视觉风格、镜头、光照和制作规格独立存放于 `config/business/visual-design.json`。生成接口仍会合并读取两者，已有项目无需重新绑定。

自动审核使用 Vertex Gemini 视频理解，对合成后的实际成片进行统一检查。品牌与平台规则、项目补充要求和审核报告保存在本地。视频不超过 14 MB；没有可用视频模型时无法审核通过。生成前仍运行本地基础检查，旧版脚本审核标记不能代替成片审核。
