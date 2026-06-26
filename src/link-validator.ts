import axios, { AxiosError } from 'axios';
import { Octokit } from '@octokit/rest';
import { SubscriptionLink } from './types';
import { getProxyAgents } from './proxy-agent';

interface ValidationResult {
  link: SubscriptionLink;
  isValid: boolean;
  isExpired: boolean;
  error?: string;
}

export class LinkValidator {
  private timeout: number;
  private concurrency: number;
  private proxyUrl?: string;
  private maxDaysSinceSubUpdate?: number;
  private proxyAgents: ReturnType<typeof getProxyAgents>;
  private octokit?: Octokit;

  constructor(timeout: number = 10000, concurrency: number = 10, proxyUrl?: string, maxDaysSinceSubUpdate?: number, githubToken?: string) {
    this.timeout = timeout;
    this.concurrency = concurrency;
    this.proxyUrl = proxyUrl;
    this.maxDaysSinceSubUpdate = maxDaysSinceSubUpdate;
    this.proxyAgents = getProxyAgents(proxyUrl);
    if (githubToken) {
      this.octokit = new Octokit({ auth: githubToken });
    }
  }

  private isDateExpired(lastModified: string, maxDays: number): boolean {
    try {
      const fileDate = new Date(lastModified);
      if (isNaN(fileDate.getTime())) return false;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxDays);
      return fileDate < cutoffDate;
    } catch {
      return false;
    }
  }

  /**
   * 通过 GitHub API 检查文件最后提交时间
   * 仅支持 raw.githubusercontent.com 链接
   */
  private async getFileLastCommitDate(url: string): Promise<Date | null> {
    if (!this.octokit) return null;

    try {
      // 解析 URL，支持两种格式:
      // https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
      // https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/{path}
      const match = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)/);
      if (!match) return null;

      const [, owner, repo, rest] = match;
      let branch: string;
      let filePath: string;

      if (rest.startsWith('refs/')) {
        // 格式: refs/heads/main/path/to/file.txt
        const parts = rest.split('/');
        branch = parts.slice(0, 3).join('/'); // refs/heads/main
        filePath = parts.slice(3).join('/');
      } else {
        // 格式: main/path/to/file.txt
        const slashIndex = rest.indexOf('/');
        if (slashIndex === -1) return null;
        branch = rest.substring(0, slashIndex);
        filePath = rest.substring(slashIndex + 1);
      }

      const commits = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        path: filePath,
        sha: branch,
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

  private isContentValid(content: string): boolean {
    if (!content || content.trim().length === 0) return false;

    const text = content.trim();

    // 检查是否为有效的 base64 编码订阅（整个内容是 base64）
    if (this.isValidBase64Subscription(text)) return true;

    // 检查明文协议前缀
    const validPatterns = [
      /vmess:\/\//i,
      /vless:\/\//i,
      /trojan:\/\//i,
      /ss:\/\//i,
      /ssr:\/\//i,
      /hysteria:\/\//i,
      /tuic:\/\//i,
      /wg:\/\//i,
      /wireguard:\/\//i,
    ];

    return validPatterns.some(p => p.test(text));
  }

  private isValidBase64Subscription(text: string): boolean {
    // base64 订阅通常是纯 base64 字符串（可能有换行）
    const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
    if (!base64Regex.test(text)) return false;

    // 去除空白后尝试解码
    const cleaned = text.replace(/\s/g, '');
    if (cleaned.length < 20) return false;

    try {
      const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
      // 解码后应包含有效的协议前缀
      return /vmess:\/\//i.test(decoded) ||
        /vless:\/\//i.test(decoded) ||
        /trojan:\/\//i.test(decoded) ||
        /ss:\/\//i.test(decoded) ||
        /ssr:\/\//i.test(decoded);
    } catch {
      return false;
    }
  }

  private async validateSingleLink(link: SubscriptionLink): Promise<ValidationResult> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    try {
      // 单次 GET 请求：同时获取响应头（Last-Modified）和响应体（内容校验）
      const response = await axios.get(link.url, {
        timeout: this.timeout,
        validateStatus: () => true,
        headers,
        maxRedirects: 5,
        ...this.proxyAgents,
      });

      // HTTP 429 速率限制
      if (response.status === 429) {
        const retryAfter = response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000)));
        return { link, isValid: false, isExpired: false, error: 'HTTP 429 (已重试)' };
      }

      // 非 2xx 响应
      if (response.status < 200 || response.status >= 400) {
        return { link, isValid: false, isExpired: false, error: `HTTP ${response.status}` };
      }

      // 检查新鲜度
      // 优先级: GitHub API 文件提交时间 > HTTP Last-Modified > 默认不认为过期
      const maxDays = this.maxDaysSinceSubUpdate ?? 30;
      let isExpired = false;

      // 1. 对 raw.githubusercontent.com 链接，用 GitHub API 检查文件最后提交时间
      if (link.url.includes('raw.githubusercontent.com')) {
        const fileCommitDate = await this.getFileLastCommitDate(link.url);
        if (fileCommitDate) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - maxDays);
          isExpired = fileCommitDate < cutoffDate;
        }
      }

      // 2. 如果 GitHub API 没有返回结果，用 HTTP Last-Modified 检查
      if (!isExpired) {
        const lastModified = response.headers['last-modified'];
        if (lastModified) {
          isExpired = this.isDateExpired(lastModified, maxDays);
        }
      }

      // 校验内容有效性
      const content = typeof response.data === 'string' ? response.data : '';
      const isValid = this.isContentValid(content);

      return {
        link,
        isValid,
        isExpired,
        error: isValid ? undefined : '内容无效',
      };
    } catch (error: any) {
      let errorMsg = '访问失败';

      if (error?.code === 'ECONNABORTED') {
        errorMsg = '超时';
      } else if (error?.response) {
        errorMsg = `HTTP ${error.response.status}`;
      } else if (error?.code === 'ENOTFOUND') {
        errorMsg = '域名无法解析';
      } else if (error?.code === 'ECONNREFUSED') {
        errorMsg = '连接被拒绝';
      } else if (error?.message) {
        errorMsg = error.message.substring(0, 50);
      }

      return { link, isValid: false, isExpired: false, error: errorMsg };
    }
  }

  async validateLinks(links: SubscriptionLink[]): Promise<SubscriptionLink[]> {
    console.log(`\n🔍 开始验证 ${links.length} 个链接...`);
    console.log(`   超时设置: ${this.timeout / 1000} 秒`);
    console.log(`   并发数: ${this.concurrency}`);
    if (this.proxyUrl) {
      console.log(`   代理: ${this.proxyUrl}`);
    }
    if (this.maxDaysSinceSubUpdate) {
      console.log(`   订阅文件最大更新天数: ${this.maxDaysSinceSubUpdate} 天`);
    }
    console.log('');

    const startTime = Date.now();
    const results: ValidationResult[] = [];
    let completed = 0;

    for (let i = 0; i < links.length; i += this.concurrency) {
      const batch = links.slice(i, i + this.concurrency);
      const batchPromises = batch.map((link) => this.validateSingleLink(link));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      completed += batch.length;
      batchResults.forEach((result, index) => {
        const globalIndex = i + index + 1;
        const progress = `[${globalIndex}/${links.length}]`;
        const shortUrl = result.link.url.substring(0, 60);

        if (result.isExpired) {
          console.log(`${progress} ⏰ ${shortUrl}... (过期)`);
        } else if (result.isValid) {
          console.log(`${progress} ✅ ${shortUrl}...`);
        } else {
          const errorIcon = this.getErrorIcon(result.error || '');
          console.log(`${progress} ${errorIcon} ${shortUrl}... (${result.error})`);
        }
      });

      const percentage = ((completed / links.length) * 100).toFixed(1);
      console.log(`   进度: ${completed}/${links.length} (${percentage}%)\n`);

      // 批次间延迟，避免突发流量
      if (i + this.concurrency < links.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const validLinks = results.filter((r) => r.isValid && !r.isExpired).map((r) => r.link);
    const expiredCount = results.filter((r) => r.isExpired).length;
    const invalidCount = results.filter((r) => !r.isValid && !r.isExpired).length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n📊 验证完成:`);
    console.log(`   ✅ 有效链接: ${validLinks.length} 个`);
    console.log(`   ❌ 无效链接: ${invalidCount} 个`);
    if (expiredCount > 0) {
      console.log(`   ⏰ 过期链接: ${expiredCount} 个`);
    }
    console.log(`   📈 有效率: ${((validLinks.length / links.length) * 100).toFixed(1)}%`);
    console.log(`   ⏱️  总耗时: ${elapsed}s\n`);

    const errorResults = results.filter((r) => !r.isValid && !r.isExpired && r.error);
    if (errorResults.length > 0) {
      const errorStats = this.getErrorStatistics(errorResults);
      console.log(`📋 失败原因统计:`);
      for (const [error, count] of Object.entries(errorStats)) {
        console.log(`   ${this.getErrorIcon(error)} ${error}: ${count} 个`);
      }
      console.log('');
    }

    return validLinks;
  }

  private getErrorIcon(error: string): string {
    if (error.includes('超时')) return '⏱️';
    if (error.includes('域名')) return '🔍';
    if (error.includes('拒绝')) return '🚫';
    if (error.includes('HTTP')) return '❌';
    return '⚠️';
  }

  private getErrorStatistics(results: ValidationResult[]): Record<string, number> {
    const stats: Record<string, number> = {};
    results
      .filter((r) => r.error)
      .forEach((r) => {
        const error = r.error!;
        stats[error] = (stats[error] || 0) + 1;
      });
    return stats;
  }
}
