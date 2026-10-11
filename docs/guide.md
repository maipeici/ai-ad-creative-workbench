# 工作台操作指南 / Workbench guide

[中文 README](../README.md) · [English README](../README.en.md) · [从新建项目到成片的操作实录](walkthrough.md)

## 打开导览

首页点击“90 秒了解流程”，或在任意阶段点击顶部“操作指南”。默认按自己的阅读速度逐步浏览，也可以点击“自动演示”，每步停留 7.5 秒。

- 气泡依次解释环节用途、需要做的操作和预期产出，粉色描边标出当前讲解区域。
- 支持上一步、下一步、暂停、阶段跳转和底部步骤选择；完成后可重播。
- 键盘左右方向键切换步骤，Esc 退出。切到其他标签页时自动暂停。
- 窄屏采用上下布局，长说明可滚动，翻页与播放按钮保持可见。
- 导览使用内存中的固定示例，退出后回到原工作台；不创建项目、不修改现有内容、不提交生成任务，也不模拟审核通过。
- 成片阶段展示随仓库附带的压缩历史样片，仅用于理解预览与下载界面，不代表当前示例已经完成审核或生成。

## 90 秒视频章节

https://github.com/user-attachments/assets/14ff8fe4-a855-4626-a5ac-5ae34d96caf6

| 时间 | 章节 / Chapter | 了解什么 |
| --- | --- | --- |
| 00:00 | 流程总览 / Overview | 六个阶段如何协作 |
| 00:07.5 | 品牌信息 / Brand | 产品定位、Logo、品牌色与事实 |
| 00:15 | 营销活动 / Campaigns | 权益、有效期与适用条件 |
| 00:22.5 | 素材资源 / Assets | 人物、场景与官方素材复用 |
| 00:30 | 视觉设计 / Visual design | 风格、镜头和光照 |
| 00:37.5 | 合规边界 / Compliance | 表达规则与素材使用边界 |
| 00:45 | 投放需求 / Brief | 渠道、人群、场景、目标与 CTA |
| 00:52.5 | 广告创意 / Concepts | 选择创意和开场钩子 |
| 01:00 | 分镜规划 / Storyboard | 共享上下文与镜头拆分 |
| 01:07.5 | 视频制作 / Production | 批量生成镜头并合成成片 |
| 01:15 | 自动审核 / Automatic review | 实际视频统一审核，通过后同页打包下载 |
| 01:22.5 | 开始创作 / Start creating | 回到工作台创建自己的项目 |

[下载历史版 MP4](../assets/demos/workbench-guide.mp4)（录制于流程调整前，当前顺序以工作台内导览为准）

## English quick guide

Choose “90 秒了解流程” on the home screen or “操作指南” in the top bar. The tour uses the real phase components with an isolated in-memory example. Each bubble explains the purpose, the next action, and the expected output. It starts in manual mode; autoplay spends 7.5 seconds on each step. You can pause, jump to a chapter, replay, or exit at any time. Arrow keys switch steps and Escape closes the tour. Playback pauses when the tab is hidden.

The tour does not create or edit saved projects, submit generation jobs, or fabricate an approval. The included sample ad is a historical preview, separate from the illustrated brief. Actual generation requires the corresponding model configuration, and video assembly requires FFmpeg.

## 维护演示内容

导览说明位于 src/client/demo/tour-steps.ts；固定项目位于 src/client/demo/demo-project.ts；只读界面位于 src/client/components/GuidedTour.tsx。视频与封面位于 assets/demos/；导览样片位于 assets/public/demo/。

更新导览界面或文案后，应重新录制 12 个步骤，核对气泡与页面一致，再更新本页的导览视频。中英文 README 顶部展示的是另行录制的完整生成流程，维护时应从新项目实际操作到成片交付，详见 [操作实录](walkthrough.md)。两类视频均保留仓库内 MP4 作为备用下载。
