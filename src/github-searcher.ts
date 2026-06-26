import { Octokit } from '@octokit/rest';
import { Repository } from './types';

// 订阅协议前缀（用于 Code Search）
const SUBSCRIPTION_PROTOCOLS = ['vmess://', 'vless://', 'trojan://', 'ss://', 'ssr://', 'hysteria://', 'tuic://'];

// 已知的大型订阅聚合仓库（用于种子源）
const KNOWN_AGGREGATOR_REPOS: string[] = [];

// GitHub Topics 标签
const SEARCH_TOPICS = ['v2ray', 'clash', 'free-proxy', 'subscription', 'vmess', 'vless', 'proxy', 'vpn'];

export class GitHubSearcher {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit(
      token && token.trim() ? { auth: token.trim() } : {}
    );
  }

  private async checkRateLimit(resp: any): Promise<void> {
    const remaining = parseInt(resp.headers?.['x-ratelimit-remaining'] ?? '999', 10);
    if (remaining <= 2) {
      const resetTime = parseInt(resp.headers?.['x-ratelimit-reset'] ?? '0', 10);
      const waitMs = Math.max(resetTime * 1000 - Date.now() + 1000, 5000);
      console.log(`⏳ GitHub API 速率限制即将耗尽,等待 ${(waitMs / 1000).toFixed(0)} 秒...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async searchReposByQuery(query: string, maxResults: number): Promise<Repository[]> {
    const perPage = Math.min(100, maxResults);
    let page = 1;
    let repositories: Repository[] = [];

    while (repositories.length < maxResults) {
      const resp = await this.octokit.rest.search.repos({
        q: query,
        sort: 'updated',
        order: 'desc',
        per_page: perPage,
        page,
      });

      await this.checkRateLimit(resp);

      const items = resp.data.items || [];
      if (!items.length) break;

      repositories.push(...items.map((item) => ({
        fullName: item.full_name,
        url: item.html_url,
        description: item.description || undefined,
        stars: item.stargazers_count,
        updatedAt: new Date(item.updated_at),
      })));

      if (items.length < perPage) break;
      page += 1;
    }

    return repositories.slice(0, maxResults);
  }

  // 策略1: 多关键词轮询搜索
  async searchByKeywords(keywordGroups: string[][], perGroup: number): Promise<Repository[]> {
    const allRepos: Repository[] = [];
    const seen = new Set<string>();

    for (const keywords of keywordGroups) {
      const query = keywords.join(' ');
      console.log(`🔍 [关键词] 搜索: ${query}`);

      const repos = await this.searchReposByQuery(query, perGroup);
      for (const repo of repos) {
        if (!seen.has(repo.fullName)) {
          seen.add(repo.fullName);
          allRepos.push(repo);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ [关键词] 共发现 ${allRepos.length} 个仓库`);
    return allRepos;
  }

  // 策略2: GitHub Code Search（搜索文件内容中的订阅协议）
  async searchByCodeSearch(maxResults: number): Promise<Repository[]> {
    const allRepos: Repository[] = [];
    const seen = new Set<string>();

    for (const protocol of SUBSCRIPTION_PROTOCOLS) {
      console.log(`🔍 [Code Search] 搜索: ${protocol}`);
      try {
        const resp = await this.octokit.rest.search.code({
          q: `${protocol} filename:txt`,
          per_page: 100,
        });

        await this.checkRateLimit(resp);

        const items = resp.data.items || [];
        for (const item of items) {
          const repo = item.repository;
          if (!repo) continue;
          const fullName = repo.full_name;
          if (!seen.has(fullName)) {
            seen.add(fullName);
            allRepos.push({
              fullName,
              url: repo.html_url,
              description: repo.description || undefined,
              stars: repo.stargazers_count ?? 0,
              updatedAt: new Date(repo.updated_at ?? Date.now()),
            });
          }
        }

        console.log(`   📄 ${protocol}: 发现 ${items.length} 个文件, ${allRepos.length} 个新仓库`);
      } catch (error: any) {
        if (error.status === 403) {
          console.log(`   ⏳ Code Search 速率限制,跳过 ${protocol}`);
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          console.error(`   ❌ Code Search 失败: ${error.message}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ [Code Search] 共发现 ${allRepos.length} 个仓库`);
    return allRepos;
  }

  // 策略3: GitHub Topics 搜索
  async searchByTopics(maxResults: number): Promise<Repository[]> {
    const allRepos: Repository[] = [];
    const seen = new Set<string>();

    for (const topic of SEARCH_TOPICS) {
      console.log(`🔍 [Topics] 搜索: topic:${topic}`);
      try {
        const repos = await this.searchReposByQuery(`topic:${topic}`, Math.ceil(maxResults / SEARCH_TOPICS.length));
        for (const repo of repos) {
          if (!seen.has(repo.fullName)) {
            seen.add(repo.fullName);
            allRepos.push(repo);
          }
        }
      } catch (error: any) {
        console.error(`   ❌ Topics 搜索失败: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ [Topics] 共发现 ${allRepos.length} 个仓库`);
    return allRepos;
  }

  // 策略4: 已知聚合仓库（种子源）
  getAggregatorRepos(): Repository[] {
    console.log(`📋 [种子源] 加载 ${KNOWN_AGGREGATOR_REPOS.length} 个已知聚合仓库`);
    return KNOWN_AGGREGATOR_REPOS.map(fullName => ({
      fullName,
      url: `https://github.com/${fullName}`,
      description: '已知订阅聚合仓库',
      stars: 0,
      updatedAt: new Date(),
    }));
  }

  // 综合搜索：合并所有策略的结果
  async searchAll(
    keywordGroups: string[][],
    maxRepositories: number,
    minStars: number,
    maxDaysSinceUpdate?: number
  ): Promise<Repository[]> {
    const seen = new Set<string>();
    const allRepos: Repository[] = [];

    const addUnique = (repos: Repository[]) => {
      for (const repo of repos) {
        if (!seen.has(repo.fullName)) {
          seen.add(repo.fullName);
          allRepos.push(repo);
        }
      }
    };

    const perGroup = Math.ceil(maxRepositories / keywordGroups.length);

    // 验证 GitHub Token 有效性
    let keywordRepos: Repository[] = [];
    let tokenValid = true;
    try {
      const testResp = await this.octokit.rest.search.repos({
        q: 'test',
        per_page: 1,
      });
      if (testResp.status !== 200) tokenValid = false;
    } catch {
      tokenValid = false;
    }

    if (!tokenValid) {
      console.log('\n⚠️  GitHub Token 无效或过期，跳过关键词搜索（仅使用 Code Search 和 Topics）');
      console.log('   请检查 .env 中的 GITHUB_TOKEN 配置\n');
    }

    console.log('\n📡 启动多策略搜索...\n');

    const [codeResult, topicResult] = await Promise.allSettled([
      this.searchByCodeSearch(maxRepositories),
      this.searchByTopics(maxRepositories),
    ]);

    if (tokenValid) {
      try {
        keywordRepos = await this.searchByKeywords(keywordGroups, perGroup);
      } catch (e: any) {
        console.error('关键词搜索失败:', e?.message || e);
      }
    }

    const codeSearchRepos = codeResult.status === 'fulfilled' ? codeResult.value : [];
    const topicsRepos = topicResult.status === 'fulfilled' ? topicResult.value : [];
    const seedRepos = this.getAggregatorRepos();

    addUnique(keywordRepos);
    addUnique(codeSearchRepos);
    addUnique(topicsRepos);
    addUnique(seedRepos);

    console.log(`\n📊 搜索汇总: 关键词 ${keywordRepos.length} + Code Search ${codeSearchRepos.length} + Topics ${topicsRepos.length} + 种子源 ${seedRepos.length} = ${allRepos.length} 个不重复仓库\n`);

    // 过滤非订阅仓库
    let filtered = allRepos.filter(repo => !this.isNonSubscriptionRepo(repo));

    if (minStars > 0) {
      filtered = filtered.filter(repo => repo.stars >= minStars);
    }

    // 先按 updated_at 排序（GitHub 搜索返回的时间）
    filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // 只验证候选池（5 倍缓冲），避免验证大量不会入选的仓库
    const candidatePool = filtered.slice(0, Math.min(maxRepositories * 5, filtered.length));

    // 用 GitHub API 验证实际最后提交时间
    if (maxDaysSinceUpdate) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxDaysSinceUpdate);
      const before = candidatePool.length;

      console.log(`   🔍 验证 ${candidatePool.length} 个候选仓库的实际提交时间（共 ${filtered.length} 个）...`);

      const verifiedRepos: Repository[] = [];
      for (const repo of candidatePool) {
        const lastCommit = await this.getLastCommitDate(repo.fullName);
        if (lastCommit) {
          // API 成功，用实际提交时间判断
          if (lastCommit >= cutoffDate) {
            repo.updatedAt = lastCommit;
            verifiedRepos.push(repo);
          }
        } else {
          // API 失败，保留仓库（不误杀）
          verifiedRepos.push(repo);
        }
        await this.delay(100);
      }

      filtered = verifiedRepos;
      const filteredCount = before - filtered.length;
      if (filteredCount > 0) {
        console.log(`   📅 实际提交时间过滤: ${before} → ${filtered.length} (过滤了 ${filteredCount} 个)`);
      }
    }

    // 按更新时间排序（最新优先）
    filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // 限制数量
    filtered = filtered.slice(0, maxRepositories);

    console.log(`🎯 最终选择 ${filtered.length} 个仓库`);
    return filtered;
  }

  /**
   * 判断是否为非订阅仓库
   */
  private isNonSubscriptionRepo(repo: Repository): boolean {
    const text = `${repo.fullName} ${repo.description || ''}`.toLowerCase();
    const excludePatterns = [
      // 广告过滤/hosts
      /adblock/i,
      /easylist/i,
      /easyprivacy/i,
      /adguard/i,
      /anti-ad/i,
      /hosts$/i,
      /malware/i,
      /annoyance/i,
      /ublock/i,
      // GKD/自动化规则
      /gkd/i,
      /sub-converter/i,
      /subconverter/i,
      // 订阅转换工具
      /clash.*converter/i,
      /v2ray.*converter/i,
      // 代理工具（不是节点）
      /proxy.*checker/i,
      /proxy.*scanner/i,
      /proxy.*test/i,
      // 非代理/VPN 相关
      /adblock.*list/i,
      /filter.*list/i,
      /block.*list/i,
      // 编程语言/框架项目
      /\bphp\b/i,
      /\bpython\b/i,
      /\bnode\b.*module/i,
      /\bjava\b.*spring/i,
      /\bruby\b/i,
      /\bgolang\b/i,
      /solidity/i,
      /ethereum/i,
      /evm\b/i,
      /smart.?contract/i,
      // 商业/支付项目
      /stripe/i,
      /payment/i,
      /ecommerce/i,
      /shopify/i,
      // 个人配置/dotfiles
      /dotfiles/i,
      /dots$/i,
      /myconfig/i,
      // 教程/文档
      /tutorial/i,
      /course/i,
      /learning/i,
      // VPN 客户端源码（不是节点）
      /vpn.?client/i,
      /wireguard.?client/i,
    ];
    return excludePatterns.some(p => p.test(text));
  }

  /**
   * 获取仓库的最后提交时间
   */
  private async getLastCommitDate(fullName: string): Promise<Date | null> {
    try {
      const [owner, repo] = fullName.split('/');
      const commits = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 1,
      });

      if (commits.data.length > 0 && commits.data[0].commit.committer?.date) {
        return new Date(commits.data[0].commit.committer.date);
      }
      return null;
    } catch {
      return null;
    }
  }

  // 获取仓库的文件树（递归发现订阅文件）
  async getRepoFileTree(fullName: string): Promise<{ name: string; lastCommit: Date }[]> {
    try {
      const [owner, repo] = fullName.split('/');
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: '',
      });

      if (!Array.isArray(response.data)) return [];

      const subFiles: { name: string; lastCommit: Date }[] = [];
      const extensions = ['.txt', '.yaml', '.yml', '.json', '.conf', '.v2ray', '.clash'];

      for (const item of response.data) {
        if (item.type === 'file' && extensions.some(ext => item.name.endsWith(ext))) {
          // 获取文件的最后提交时间
          let lastCommit = new Date();
          try {
            const commits = await this.octokit.rest.repos.listCommits({
              owner,
              repo,
              path: item.name,
              per_page: 1,
            });
            if (commits.data.length > 0 && commits.data[0].commit.committer?.date) {
              lastCommit = new Date(commits.data[0].commit.committer.date);
            }
          } catch {
            // 获取提交信息失败，使用当前时间
          }

          subFiles.push({ name: item.name, lastCommit });
          await this.delay(100);
        }
      }

      return subFiles;
    } catch {
      return [];
    }
  }

  // 获取仓库中指定文件的内容
  async getFileContent(fullName: string, filePath: string): Promise<string | null> {
    try {
      const [owner, repo] = fullName.split('/');
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if (Array.isArray(response.data) || response.data.type !== 'file') return null;

      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      return content;
    } catch {
      return null;
    }
  }

  async getReadmeContent(fullName: string): Promise<string | null> {
    try {
      const [owner, repo] = fullName.split('/');
      const response = await this.octokit.rest.repos.getReadme({ owner, repo });
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    } catch (error: any) {
      if (error.status === 404) {
        console.warn(`⚠️  仓库 ${fullName} 没有 README`);
      }
      return null;
    }
  }

  private sortRepositories(repos: Repository[]): Repository[] {
    if (repos.length === 0) return repos;

    const maxStars = Math.max(...repos.map(r => r.stars));
    const minStars = Math.min(...repos.map(r => r.stars));
    const timestamps = repos.map(r => r.updatedAt.getTime());
    const maxTime = Math.max(...timestamps);
    const minTime = Math.min(...timestamps);

    const scored = repos.map(repo => {
      const normalizedStars = maxStars > minStars
        ? (repo.stars - minStars) / (maxStars - minStars) : 1;
      const normalizedTime = maxTime > minTime
        ? (repo.updatedAt.getTime() - minTime) / (maxTime - minTime) : 1;
      const score = (normalizedStars * 0.7) + (normalizedTime * 0.3);
      return { repo, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(item => item.repo);
  }
}
