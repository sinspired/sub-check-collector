# 快速开始指南

## 1. 安装依赖

```bash
npm install
```

## 2. 配置 (可选)

创建 `.env` 文件 (参考 `.env.example`):

```bash
# 可选: 配置 GitHub Token 以提高 API 限制
GITHUB_TOKEN=your_token_here

# 自定义搜索关键字
SEARCH_KEYWORDS=free,v2ray
```

> **提示**: 不配置也能运行,但 GitHub Token 可以大幅提高 API 速率限制

## 3. 运行

### 立即执行一次 (推荐)

```bash
npm run once
```

### 启动定时任务

```bash
npm start
```

## 4. 查看结果

生成的订阅链接保存在:
- **Markdown 文件**: `output/subscriptions.md` (完整的链接汇总,包含统计和分类)
- **config.yaml**: 自动更新 `sub-urls` 部分 (原文件会自动备份)

## 示例输出

```
🚀 开始收集订阅链接...

📡 启动多策略搜索...

🔍 [Code Search] 搜索: vmess://
🔍 [Topics] 搜索: topic:v2ray
🔍 [关键词] 搜索: free v2ray subscription
...

📊 搜索汇总: 关键词 40 + Code Search 231 + Topics 35 + 种子源 0 = 297 个不重复仓库

   🔍 验证 250 个候选仓库的实际提交时间（共 287 个）...
   📅 实际提交时间过滤: 250 → 63 (过滤了 187 个)
🎯 最终选择 50 个仓库

📦 准备处理 50 个仓库（按更新时间排序）

[1/50] 处理: hproxy-com/free-proxy-list
📝 从 hproxy-com/free-proxy-list 提取到 4 个链接
...

💾 已保存到: ./output/subscriptions.md
💾 配置文件已备份: ./config.yaml.backup.xxx

📝 开始更新 config.yaml...
✅ 配置文件已更新
   - 原有链接: 1176 个
   - 新增链接: 443 个
   - 总计链接: 1619 个

✨ 收集完成!
📊 统计信息:
   - 总链接数: 1122
   - V2Ray: 387
   - Shadowsocks: 47
   - Clash: 57
   - Hysteria: 5
   - 订阅链接: 133
   - 耗时: ~200s
```

## 常见问题

### Q: GitHub API 限制怎么办?

A: 配置 `GITHUB_TOKEN`:
1. 访问 https://github.com/settings/tokens
2. 生成新 token (需要 `public_repo` 权限)
3. 添加到 `.env` 文件

### Q: 如何自定义搜索关键字?

A: 在 `.env` 中修改:
```env
SEARCH_KEYWORDS=free,clash,节点
```

### Q: 如何修改定时规则?

A: 在 `.env` 中配置 cron 表达式:
```env
SCHEDULE_INTERVAL=0 */6 * * *  # 每 6 小时执行
```

### Q: 如何禁用 config.yaml 自动更新?

A: 在 `.env` 中设置:
```env
CONFIG_YAML_PATH=
```
或者删除这一行配置即可。

## 项目结构

```
.
├── src/               # 源代码
├── output/            # 输出目录
│   └── subscriptions.md  # 订阅链接汇总
├── config.yaml        # 自动更新的配置文件
├── config.yaml.backup.* # 自动备份文件
├── .env              # 环境配置
└── README.md         # 完整文档
```
