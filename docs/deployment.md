<a id="deployment"></a>

# 部署与运行

### 本地开发

~~~bash
npm run dev
~~~

- 页面地址：**http://localhost:5173**
- 后端地址：**http://localhost:8787**
- Vite 将 `/api` 和 `/media` 请求代理到后端。
- 开发时若修改后端 `PORT`，也要同步调整 [`config/vite.config.ts`](../config/vite.config.ts) 中的代理地址。

### 在服务器上运行

当前是 **Node.js 服务 + 本地文件存储** 的单实例应用，需要可持续写入的磁盘。前端构建后由同一个 Express 服务托管，单独上传 `dist/` 不能运行完整工作台。

1. 在服务器安装 Node.js、FFmpeg 和中文字体。
2. 获取代码并运行 `npm ci`；构建需要开发依赖，不要在构建前省略它们。
3. 从 `.env.example` 创建 `.env`，填写该环境的模型配置、字体路径和端口。
4. 执行 `npm run build`，再执行 `npm start`。
5. 打开服务器对应端口，确认首页、创建项目、保存和环境状态正常。
6. 使用服务管理器保持进程运行，并为 `data/runtime/` 设置持久化与备份。

<details>
<summary>Linux 常驻服务示例（systemd）</summary>

以下假设项目已放在 `/opt/ai-ad-creative-workbench`，并完成依赖安装、配置和构建。先建立专用运行用户并授权项目目录：

~~~bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ai-workbench
sudo chown -R ai-workbench:ai-workbench /opt/ai-ad-creative-workbench
sudo chmod 600 /opt/ai-ad-creative-workbench/.env
~~~

创建 `/etc/systemd/system/ai-ad-workbench.service`：

~~~ini
[Unit]
Description=AI Ad Creative Workbench
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ai-workbench
WorkingDirectory=/opt/ai-ad-creative-workbench
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/ai-ad-creative-workbench/src/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
~~~

`ExecStart` 中的 Node 路径应替换为 `command -v node` 的实际输出。服务会读取项目根目录的 `.env`。

~~~bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-ad-workbench
sudo systemctl status ai-ad-workbench
~~~

更新代码并重新构建后，执行 `sudo systemctl restart ai-ad-workbench`。查看日志使用 `sudo journalctl -u ai-ad-workbench -n 100 --no-pager`。

</details>

**网络访问范围：** 当前没有账号登录、成员权限或租户隔离，适合个人或受控内部环境。对外提供访问前，需要配置认证入口、HTTPS 和网络访问限制，并保护会触发模型计费的接口。采用上述 systemd 示例时，也应通过防火墙限制后端端口。

### 数据与密钥怎么保存

| 路径 | 内容 | Git 状态 |
| --- | --- | --- |
| `.env` | 本机密钥、模型与服务配置 | 已忽略 |
| `.env.example` | 无真实凭证的配置模板 | 随代码提交 |
| `data/seed/` | 默认素材预设与待确认的活动事实模板 | 随代码提交 |
| `data/runtime/projects.json` | 项目、分镜、审核与生成记录 | 已忽略 |
| `data/runtime/assets.json` | 本地素材目录与引用信息 | 已忽略 |
| `data/runtime/product-facts.json` | 本地确认和修改的产品事实 | 已忽略 |
| `data/runtime/media/` | 上传素材与生成的图片、音频、视频 | 已忽略 |
| `config/business/` | 品牌规范、渠道与检查规则 | 随代码提交 |
| `assets/` | 页面图标和 README 截图 | 随代码提交 |
| `.local/` | 本地启动日志与迁移备份 | 已忽略 |

首次启动仅在运行文件缺失时从 `data/seed/` 初始化素材和事实，并创建空项目列表。后续启动不会用默认数据覆盖本地修改。

备份时保存整个 `data/runtime/`，单独妥善保存 `.env`，并保存自行调整的 `config/business/`。只有项目 JSON 而没有媒体文件，无法完整恢复成片和上传素材。

### 从旧目录结构升级

更新代码前先停止服务并备份旧版整个 `data/`。更新代码后，在首次启动前，将备份中的 `projects.json`、`assets.json`、`product-facts.json` 和 `media/` 放入 `data/runtime/`。将自定义品牌、渠道和检查规则放入 `config/business/`，保留根目录的 `.env`。

不要用默认数据覆盖已有运行文件。若两个位置都已有数据，先对照项目与媒体内容再合并。更新完成后使用 `scripts/start-workbench.cmd` 或 `npm start` 启动。

<a id="faq"></a>

## 常见问题

**启动后为什么没有截图中的项目和成片？**

项目与媒体文件存放在本地，并已加入 Git 忽略规则。新安装后创建项目并上传自己的素材即可；README 截图仅用于展示实际产品界面。

**为什么显示“视频合成待配置”？**

服务没有检测到可用的 FFmpeg。安装后设置 `FFMPEG_PATH` 并重启；已有成片仍可预览和下载，新的叠加与合成需要完成配置。

**为什么生成结果标记为 Mock 或 mock-fallback？**

未配置模型时会使用 Mock；文本模型调用失败时也会回退到演示结果。检查模型字段、权限、网络与服务日志，不要将演示结果误认为真实模型产出。

**为什么模型配置看起来齐全，但调用仍失败？**

界面的配置状态不等于远端服务已通过验证。还需检查账号权限、模型和地区可用性、额度，以及基础地址是否重复包含方法路径。

**修改代码后页面没有更新？**

使用 `npm start` 时先重新运行 `npm run build`。修改 `.env` 或后端代码后重启服务。Windows 启动入口检测到已有服务时会直接打开页面，需要先停止已有进程再启动才能重新构建。

**能否直接用于多人在线投放？**

当前提供素材创作流程，没有多人权限管理、广告账户连接与效果数据闭环。规则校验也不能替代品牌、业务和渠道的最终审核。扩展到正式团队环境前，需要补齐认证、存储、任务调度与运营流程。


[返回中文首页](../README.md) · [模型配置](configuration.md)
