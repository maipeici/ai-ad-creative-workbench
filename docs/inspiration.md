# 爆款参考：导入、拆解与创意复用

入口：打开一个项目 → **广告创意 → 爆款参考**。

当前版本基于自己导入的资料建立参考库。链接用于溯源，不会自动抓取、下载、识别原视频，也没有接入平台实时榜单。拆解基于你提供的脚本、口播或字幕；只有链接时，先补充至少 20 字文本。

## 完整流程

1. 在品牌与素材中选好已确认事实，在投放需求中明确渠道、人群和场景。
2. 点击 **导入视频参考**，填写标题、平台、行业，粘贴视频链接和脚本。可选填写创作者、关键词、发布日期及热度快照。
3. 在 **我的参考库** 中按平台、行业、发布日期和关键词筛选，查看推荐原因、统计日期与来源说明。
4. 点击 **拆解脚本**，查看每个段落的作用、原文依据和可迁移的方法。没有时间标注的内容不会被当作有准确时码的实测片段。
5. 勾选希望复用的开场钩子、内容结构、产品呈现或 CTA 建议，点击 **一键复用到广告创意**。
6. 系统追加一份适配当前品牌的创意，并保留参考来源和所选方法。在创意列表选择新方案，即可继续现有分镜流程。

已有创意、已选方案、分镜和成片会保留。只有项目尚未选择创意时，新方案才会自动选中。参考资料或项目需求发生变化后，需要重新拆解才能继续复用。

如果默认 CTA 包含领券，但当前没有已确认的活动事实，本次生成会使用下载体验等通用引导；不会自动修改保存的 Brief。生成结果仍含未绑定活动事实的优惠文案时，会阻止写入新创意。

拆解和复用需要 `.env` 中配置可用的文本模型，复用现有 Vertex AI Gemini 或 OpenAI 兼容接口。模型未配置、失败或返回无效结果时会明确报错，不会用 Mock 结果冒充真实分析。无需另外安装依赖。

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
| `script` | 拆解时需要 | 至少 20 字，最多 24,000 字；CSV 多行内容需要双引号包裹 |
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

参考库保存在 `data/runtime/inspirations.json`，拆解保存在对应项目的 `inspirationAnalyses` 字段，来源记录保存在新创意的 `inspiration` 字段。运行数据沿用 `.gitignore` 规则，不提交到 GitHub。

| 接口 | 用途 |
| --- | --- |
| `GET /api/inspirations` | 查询参考；参数 `projectId`、`platform`、`industry`、`days`、`keyword`、`sort`、`mode` |
| `POST /api/inspirations` | 创建单条参考 |
| `POST /api/inspirations/import` | 批量导入 `{content, format}`；format 为 `csv` / `json` |
| `PATCH /api/inspirations/:referenceId` | 更新资料；内置结构示例只读 |
| `POST /api/projects/:id/inspirations/:referenceId/analyze` | 结合项目拆解脚本 |
| `POST /api/projects/:id/inspirations/:referenceId/apply` | 传入 `{suggestionIds}`，追加新创意 |

后续数据服务可以将结果映射到相同的导入字段，继续使用现有筛选、拆解和复用流程。当前没有自动同步任务。

Gemini 拆解请求额外携带 `responseSchema`，约束字段类型与建议编号；具体接口说明见 [Google Cloud 结构化输出文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)。保存前仍会校验原文引用、数据长度和建议编号；复用前重新核对项目上下文与事实 ID。

专项检查：`node --test tests/inspirations.test.js tests/inspiration-routes.test.js`。
