# V2Ray/Clash 订阅链接自动收集器

自动从 GitHub 搜索并收集 V2Ray、Clash 等代理订阅链接的工具。

## 特性

- **多策略搜索**: 3 种搜索策略并行，覆盖更多仓库
  - 关键词轮询（7 组关键词自动轮换）
  - Code Search（搜索文件内容中的 vmess://, vless:// 等协议）
  - Topics 搜索（按 GitHub 标签分类搜索）
- **双重时间过滤**:
  - 仓库级：用 GitHub API 检查实际最后提交时间（排除 star/fork 等非代码活动）
  - 文件级：对 raw.githubusercontent.com 链接用 GitHub API 检查文件最后提交时间
- **非订阅仓库过滤**: 自动排除广告过滤列表、GKD 规则、代理工具、编程项目等非订阅仓库
- **智能去重**: URL 规范化去重 + 同一基础 URL 不同格式去重（如 all.yaml 和 v2ray.txt）
- **协议分类**: 自动识别 V2Ray、Clash、Shadowsocks、Hysteria、TUIC、WireGuard 等协议
- **链接验证**: HTTP GET 校验内容有效性（支持 base64 编码检测）+ 过滤过期/无效链接
- **代理支持**: 支持 HTTP/HTTPS 代理（通过 PROXY_URL 配置）
- **文件树探索**: 可选遍历仓库根目录查找 .txt/.yaml/.json 等订阅文件
- **并发处理**: 仓库并发处理（5 并发），大幅提升收集速度
- **自动更新 config.yaml**: 收集到的链接自动更新到 config.yaml 的 sub-urls
- **备份自动清理**: backup 文件只保留最近 3 个，自动清理旧备份
- **定时执行**: 支持 cron 定时任务
- **日志记录**: 控制台 + 文件日志

## 快速开始

### Windows

```cmd
start.bat once       # 立即执行一次
start.bat schedule   # 启动定时任务
```

### Linux/macOS

```bash
chmod +x start.sh
./start.sh once
```

### 手动配置

```bash
npm install
cp .env.example .env
# 编辑 .env 配置参数
npm run build
npm run once
```

## 配置说明

编辑 `.env` 文件：

```env
# GitHub Token (可选但推荐，提高 API 限额到 5000次/小时)
GITHUB_TOKEN=your_token_here

# 搜索关键字 (逗号分隔，用于关键词搜索策略)
SEARCH_KEYWORDS=free,v2ray,subscription,vless

# 多组搜索关键词 (可选，| 分隔各组，, 分隔组内关键词)
# 不配置则使用默认 7 组关键词
# KEYWORD_GROUPS=free,v2ray,subscription|vmess,free,nodes|clash,proxy,subscription

# 最大搜索仓库数
MAX_REPOSITORIES=50

# 仓库最大更新天数 (超过此天数未提交代码的仓库将被忽略)
# 会用 GitHub API 检查实际最后提交时间，而非仓库活动时间
MAX_DAYS_SINCE_UPDATE=60

# 代理地址 (用于链接验证等网络请求)
# 如 Clash 默认端口: http://127.0.0.1:7890
PROXY_URL=http://127.0.0.1:7890

# 订阅文件最大更新天数 (文件级过滤)
# 对 raw.githubusercontent.com 链接用 GitHub API 检查文件最后提交时间
# 对其他链接用 HTTP Last-Modified 头检查
MAX_DAYS_SINCE_SUB_UPDATE=3

# 是否遍历仓库根目录查找订阅文件 (true/false)
# 开启后会额外读取仓库中的 .txt/.yaml/.json 等订阅文件
EXPLORE_FILE_TREE=false

# 是否验证链接有效性 (true/false)
VALIDATE_LINKS=true

# 链接验证超时时间 (毫秒)
LINK_VALIDATION_TIMEOUT=10000

# 链接验证并发数
LINK_VALIDATION_CONCURRENCY=50
```

## 搜索策略

| 策略 | 说明 | 开销 |
|------|------|------|
| 关键词轮询 | 7 组关键词独立搜索 | 中（每组 1 次 API 调用） |
| Code Search | 搜索文件内容中的 vmess://, vless:// 等 | 低（每个协议 1 次） |
| Topics 搜索 | 按 v2ray, clash, free-proxy 等标签搜索 | 低（每个 topic 1 次） |

所有策略并行执行，结果合并去重后统一过滤和排序。全量收集后按更新时间排序，取最新的 N 个仓库。

## 链接验证

启用 `VALIDATE_LINKS=true` 后，程序会：

1. 对每个链接发 HTTP GET 请求（通过代理）
2. 检查响应头 `Last-Modified` 判断文件新鲜度
3. 对 raw.githubusercontent.com 链接，用 GitHub API 检查文件实际最后提交时间
4. 检查响应体是否包含有效的订阅数据（vmess://, vless://, base64 等）
5. 过滤掉过期、无效或非订阅内容的链接

## 项目结构

```
src/
  types.ts              # 类型定义
  config.ts             # 配置加载
  github-searcher.ts    # GitHub 搜索（多策略 + 实际提交时间验证）
  readme-parser.ts      # URL 提取 + 非订阅 URL 过滤 + 协议分类
  link-aggregator.ts    # 去重（O(n) baseUrlMap）、排序、持久化
  link-validator.ts     # 链接验证 + GitHub API 文件新鲜度检查
  config-updater.ts     # config.yaml 更新（自动清理旧备份）
  proxy-agent.ts        # 代理 agent 封装
  collector.ts          # 主流程协调（5 并发处理）
  scheduler.ts          # 定时调度
  logger.ts             # 日志模块
  index.ts              # 入口
```

## 故障排查

**GitHub API 限制**: 配置 `GITHUB_TOKEN`，程序会自动检测速率限制并等待重试

**搜索结果少**: 检查 `MAX_DAYS_SINCE_UPDATE` 是否过小，或调整 `KEYWORD_GROUPS`

**链接验证慢**: 调大 `LINK_VALIDATION_CONCURRENCY`（如 50）或减小 `LINK_VALIDATION_TIMEOUT`

**代理连接失败**: 检查 `PROXY_URL` 是否正确，确认代理服务已启动

## 免责声明

本工具仅用于学习和研究目的。使用者需遵守当地法律法规。

## License

MIT
