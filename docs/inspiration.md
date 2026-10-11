# 爆款参考：导入、拆解与创意复用

入口：打开一个项目 → **广告创意 → 爆款参考**。

上传原视频即可自动拆解，无需先写脚本。当前支持 MP4 / MOV / WebM，最大 14 MB；可在导入弹窗替换已上传的视频。视频字节发送给已配置的 Vertex Gemini，模型识别画面、字幕、口播与声音。只有平台分享链接时，仍需上传原视频或补充至少 20 字文本；不会自动抓取平台页面，也未接入实时榜单。

## 完整流程

1. 在创作基础中选好已确认的品牌与活动事实，在投放需求中明确渠道、人群和场景。
2. 点击 **导入视频参考**，上传视频并填写标题、平台、行业。视频链接、补充脚本和热度快照可选；默认开启“保存后自动拆解”。
3. 在 **我的参考库** 中按平台、行业、发布日期和关键词筛选，查看推荐原因、统计日期与来源说明。
4. 查看自动识别脚本、分段画面/声音观察与爆款点。点击时间码可定位视频；爆款点区分实际观察依据和机制假设，不承诺效果因果。
5. 勾选希望参考的钩子、结构、产品呈现、CTA、视觉或声音。选择“生成新的参考方案”，或“基于某份已有创意生成参考版”，点击 **一键导入创作方案**。
6. 新方案自动选中并展示“参考创作指导”。点击“用此参考方案生成分镜”，模型把所选方法对应到具体镜头，记录来源时间段、中文改写说明及英文画面指令。未选的方法不会成为参考要求。
7. 首帧图与视频生成继续使用逐镜头的参考方向。原片仅用于观察，不直接复用原片画面、声音、竞品台词或权益。

原创意、分镜和成片均保留；导入的新方案会自动选中。已有分镜与当前方案不一致时，须重新生成分镜后才能继续生成视频。参考资料或项目需求变化后，需要重新拆解才能应用；已经生成的方案保留当时的参考快照，不会随参考库编辑悄悄变化。

如果默认 CTA 包含领券，但当前没有已确认的活动事实，本次生成会使用下载体验等通用引导；不会自动修改保存的 Brief。生成结果仍含未绑定活动事实的优惠文案时，会阻止写入新创意。

直接视频拆解需要 `.env` 中现有 Vertex Gemini 配置；文本拆解与创意改写可复用 Gemini 或 OpenAI 兼容接口。模型未配置、失败或返回无效结果时明确报错。带参考指导的分镜也不会以 Mock 冒充成功；未映射全部所选参考点时保留原分镜并提示重试。无需另外安装依赖。14 MB 上传上限为 base64 编码和文本指令预留请求空间。

## 热度与投放效果

| 信息 | 字段 | 口径 |
| --- | --- | --- |
| 内容热度 | 播放、点赞、评论、分享、收藏 | 导入时的计数快照 |
| 广告效果 | CTR、CVR、CPA | 仅“信息流广告”可填写；CTR/CVR 单位为 %，CPA 单位为元 |
| 来源 | 数据来源说明、统计日期 | 填写指标时需补充，用于判断数据来源和新鲜度 |

空值显示“未提供”，不会自动填成 0。CTR/CVR 的 1.5 表示 1.5%，不要求附加百分号。整数计数支持 `1.2万`、`12k` 等写法。

默认沿用项目渠道和品牌行业。需求匹配排序结合人群/场景关键词、发布时间，以及同平台、同行业、同内容类型的已导入样本互动量；不是平台官方热度榜，也不预测转化效果。同组样本少于 5 条、缺少热度或统计超过 30 天时会提示。按“点赞量”排序时应保持平台和行业口径一致。

结构示例与真实参考分开显示。内置示例没有虚构视频链接或热度；自己的测试数据请勾选“这是演示 / 测试数据”。

## CSV / JSON 批量导入

点击“下载 CSV 模板”获取列名，使用 UTF-8 保存文件。每次支持 1–100 条、最大 3 MB；一批中有任何无效记录都会整批拒绝，不会只写入前半部分。同平台重复链接会更新已有条目。影响视频身份的 URL 查询参数会保留，只忽略已知分享追踪参数和页面锚点。

### 字段约定

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 视频标题，最多 120 字 |
| `platform` | 是 | 见下方平台标识 |
| `industry` | 是 | 见下方行业标识 |
| `contentType` | 否 | `organic` 自然内容（默认）或 `ad` 信息流广告 |
| `sourceUrl` | 否 | 不含账号密码的 HTTPS 链接 |
| `creator`、`tags` | 否 | 创作者及人群/场景关键词 |
| `script` | 仅文本拆解时需要 | 至少 20 字，最多 24,000 字；已上传视频可留空，CSV 多行内容需要双引号包裹 |
| `views`、`likes`、`comments`、`shares`、`saves` | 否 | 非负整数；未知请留空 |
| `ctr`、`cvr`、`cpa` | 否 | 仅 `ad` 支持；CTR/CVR 范围 0–100 |
| `publishedAt` | 否 | `YYYY-MM-DD`，不能晚于今天 |
| `observedAt` | 有指标时 | 同上，表示指标统计日期 |
| `sourceNote` | 真实指标必填 | 数据来源与记录方式 |
| `isDemo` | 否 | `true` 表示示例数据，只进入结构示例；默认 `false` |

平台标识：`douyin`（抖音）、`xiaohongshu`（小红书）、`kuaishou`（快手）、`wechat`（微信视频号）、`bilibili`（哔哩哔哩）、`tiktok`。

行业标识：`mobility`（出行）、`travel`（旅游/本地生活）、`beauty`（美妆）、`food`（食品餐饮）、`ecommerce`（电商）、`education`（教育）、`games`（游戏）、`other`。

JSON 支持数组或 `{ "items": [...] }`，指标可以平铺，也可以放在 `metrics` 对象中。以下是没有虚构热度的演示记录：

```json
[
  {
    "title": "通勤出行脚本示例",
    "platform": "douyin",
    "industry": "mobility",
    "contentType": "organic",
    "script": "开头：下班走出写字楼。中段：在手机上输入终点，确认行程后发起叫车。结尾：核对车牌后上车。",
    "tags": "下班 通勤",
    "sourceNote": "产品流程演示，非真实视频。",
    "isDemo": true
  }
]
```

## 存储与接口

参考库保存在 `data/runtime/inspirations.json`，上传视频保存在 `data/runtime/media/reference-*`，拆解保存在项目的 `inspirationAnalyses`。创意 `inspiration` 保存所选方法、分段观察和来源的不可变快照；分镜保存同一快照，逐镜头 `referenceUse` 包含方法 ID、来源时段、改写说明与画面方向。创意包导出也包含这些字段。运行数据与视频沿用 `.gitignore` 规则，不提交到 GitHub。

| 接口 | 用途 |
| --- | --- |
| `GET /api/inspirations` | 查询参考；参数 `projectId`、`platform`、`industry`、`days`、`keyword`、`sort`、`mode` |
| `POST /api/inspirations` | 创建单条参考 |
| `POST /api/inspirations/import` | 批量导入 `{content, format}`；format 为 `csv` / `json` |
| `PATCH /api/inspirations/:referenceId` | 更新资料；内置结构示例只读 |
| `POST /api/inspirations/:referenceId/video` | multipart `file` 上传/替换原视频；服务器校验文件头、大小并记录哈希 |
| `POST /api/projects/:id/inspirations/:referenceId/analyze` | 结合项目拆解脚本 |
| `POST /api/projects/:id/inspirations/:referenceId/apply` | `{suggestionIds, targetConceptId?, selectAfterApply?}`，基于可选原创意生成参考版；界面传 `selectAfterApply:true` |

后续数据服务可以将结果映射到相同的导入字段，继续使用现有筛选、拆解和复用流程。当前没有自动同步任务。

Gemini 拆解请求额外携带 `responseSchema`，约束字段类型与建议编号；具体接口说明见 [Google Cloud 结构化输出文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)。保存前仍会校验原文引用、数据长度和建议编号；复用前重新核对项目上下文与事实 ID。

视频输入使用 Gemini 的 `inlineData`；参考 [Google Cloud 视频理解文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/video-understanding)。

专项检查：`node --test tests/inspirations.test.js tests/inspiration-routes.test.js tests/inspiration-video.test.js`。
