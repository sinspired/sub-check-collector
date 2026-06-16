import { Octokit } from '@octokit/rest';
import { Repository } from './types';

export class GitHubSearcher {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit(
      token && token.trim() ? { auth: token } : {}
    );
  }

  async searchRepositories(
    keywords: string[],
    maxResults: number = 30,
    minStars: number = 0,
    maxDaysSinceUpdate?: number
  ): Promise<Repository[]> {
    try {
      const baseQuery = keywords.join(' ');
      const targetPool = Math.min(maxResults * 3, 3000);

      console.log(`🔍 搜索关键字: ${baseQuery}`);
      if (minStars > 0) console.log(`   最低 star: ${minStars}`);
      if (maxDaysSinceUpdate) console.log(`   最大更新天数: ${maxDaysSinceUpdate} 天`);

      const rawItems = await this.fetchByCursor(baseQuery, targetPool);

      // 去重
      const seen = new Set<string>();
      const unique = rawItems.filter(item => {
        if (seen.has(item.full_name)) return false;
        seen.add(item.full_name);
        return true;
      });
      console.log(`✅ 去重后候选: ${unique.length} 个 (原始 ${rawItems.length} 个)`);

      let repositories: Repository[] = unique.map(item => ({
        fullName: item.full_name,
        url: item.html_url,
        description: item.description || undefined,
        stars: item.stargazers_count,
        updatedAt: new Date(item.updated_at),
      }));

      if (minStars > 0) {
        const before = repositories.length;
        repositories = repositories.filter(r => r.stars >= minStars);
        console.log(`   ⭐ star 过滤: ${before} → ${repositories.length}`);
      }

      if (maxDaysSinceUpdate) {
        const before = repositories.length;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxDaysSinceUpdate);
        repositories = repositories.filter(r => r.updatedAt >= cutoff);
        console.log(`   📅 时间过滤: ${before} → ${repositories.length}`);
      }

      repositories = this.sortRepositories(repositories).slice(0, maxResults);
      console.log(`🎯 最终返回 ${repositories.length} 个仓库`);
      return repositories;

    } catch (error) {
      console.error('❌ GitHub 搜索失败:', error);
      throw error;
    }
  }

  /**
   * 日期游标分页
   *
   * 每轮:
   *   1. 用 updated:<cursor 限定时间窗口（每轮是独立查询，有独立的 1000 条空间）
   *   2. 在该时间窗内翻最多 10 页（100 条/页 = 1000 条上限）
   *   3. 取本轮最旧结果的 updated_at 作为下一轮游标
   *
   * 关键点:
   *   - updated: 而非 pushed:（与 sort=updated 对齐）
   *   - < 而非 <=（GitHub 搜索只支持 < / >）
   *   - 游标不推进时立即退出（防死循环）
   */
  private async fetchByCursor(query: string, target: number): Promise<any[]> {
    const perPage = 100;
    const items: any[] = [];
    // 第一轮无日期限制，后续轮次设置游标
    let cursor: string | null = null;
    let prevCursor = '';

    for (let round = 1; items.length < target; round++) {
      const q = cursor ? `${query} updated:<${cursor}` : query;

      console.log(
        `   📄 [游标] 第 ${round} 轮 ${cursor ? `updated:<${cursor}` : '无限制'}，已抓 ${items.length} 条`
      );

      // 在当前时间窗内做页码分页，最多 1000 条
      const roundItems: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const resp = await this.octokit.rest.search.repos({
          q,
          sort: 'updated',
          order: 'desc',
          per_page: perPage,
          page,
        });

        const batch = resp.data.items;
        if (!batch.length) break;

        roundItems.push(...batch);
        console.log(`      📃 第 ${page} 页 +${batch.length} 条`);

        if (batch.length < perPage) break; // 已是最后一页
        if (roundItems.length >= 1000) break; // 触顶，下一轮用游标继续
      }

      if (!roundItems.length) {
        console.log(`   ✅ 无更多数据，停止抓取`);
        break;
      }

      items.push(...roundItems);
      console.log(`   ✅ 本轮 +${roundItems.length} 条，累计 ${items.length} 条`);

      // 推进游标：取本轮最旧结果的日期（精确到天，exclusive）
      const oldestDate = roundItems[roundItems.length - 1].updated_at as string;
      // 只取日期部分，GitHub 搜索仅支持 YYYY-MM-DD
      cursor = oldestDate.split('T')[0];

      // 防死循环：游标未推进（同一天超过 1000 条时会发生）
      if (cursor === prevCursor) {
        console.log(`   ⚠️  游标卡在 ${cursor}（该日结果超 1000 条），停止抓取`);
        break;
      }
      prevCursor = cursor;

      // 本轮不足 1000 条，说明该时间窗已穷尽
      if (roundItems.length < 1000) {
        console.log(`   ✅ 本轮结果 < 1000，数据已穷尽`);
        break;
      }

      // 避免触发速率限制
      await new Promise(r => setTimeout(r, 2000));
    }

    return items;
  }

  private sortRepositories(repos: Repository[]): Repository[] {
    if (repos.length === 0) return repos;

    const maxStars = Math.max(...repos.map(r => r.stars));
    const minStars = Math.min(...repos.map(r => r.stars));
    const timestamps = repos.map(r => r.updatedAt.getTime());
    const maxTime = Math.max(...timestamps);
    const minTime = Math.min(...timestamps);

    return repos
      .map(repo => {
        const nStars = maxStars > minStars
          ? (repo.stars - minStars) / (maxStars - minStars) : 1;
        const nTime = maxTime > minTime
          ? (repo.updatedAt.getTime() - minTime) / (maxTime - minTime) : 1;
        return { repo, score: nStars * 0.7 + nTime * 0.3 };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.repo);
  }

  async getReadmeContent(fullName: string): Promise<string | null> {
    try {
      const [owner, repo] = fullName.split('/');
      const response = await this.octokit.rest.repos.getReadme({ owner, repo });
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    } catch (error: any) {
      if (error.status === 404) {
        console.warn(`⚠️  仓库 ${fullName} 没有 README`);
        return null;
      }
      console.error(`❌ 获取 ${fullName} README 失败:`, error.message);
      return null;
    }
  }
}