import * as fs from 'fs/promises';
import * as path from 'path';
import { SubscriptionLink } from './types';

export class LinkAggregator {
  private links: Map<string, SubscriptionLink> = new Map();

  private normalizeUrl(url: string): string {
    let normalized = url
      .toLowerCase()
      .replace(/[|`'"'\)>]+$/, '')
      .replace(/\/+$/, '')
      .replace(/^http:/, 'https:');

    // 去除 query 和 fragment
    try {
      const u = new URL(normalized);
      normalized = u.origin + u.pathname;
    } catch {
      normalized = normalized.replace(/[?#].*$/, '');
    }

    return normalized;
  }

  /**
   * 获取用于去重的基础 URL（去除扩展名等）
   * 用于判断同一文件的不同格式/编码是否重复
   */
  private getBaseUrl(url: string): string {
    const normalized = this.normalizeUrl(url);
    // 去除常见扩展名
    return normalized
      .replace(/\.(txt|yaml|yml|json|conf|v2ray|clash|ss|ssr|base64)$/i, '')
      // 统一 raw.githubusercontent.com 路径格式
      .replace(/\/raw\/refs\/heads\/[^/]+\//, '/raw/')
      .replace(/\/raw\/main\//, '/raw/')
      // 统一 github.com/raw 路径格式
      .replace(/\/github\.com\/[^/]+\/[^/]+\/raw\/refs\/heads\/[^/]+\//, '/raw/');
  }

  addLinks(newLinks: SubscriptionLink[]): void {
    for (const link of newLinks) {
      const key = this.normalizeUrl(link.url);
      const baseUrl = this.getBaseUrl(link.url);

      // 检查完全相同的 URL
      if (this.links.has(key)) {
        const existing = this.links.get(key)!;
        existing.foundAt = link.foundAt;
        continue;
      }

      // 检查同一基础 URL 的不同格式（如 all.yaml 和 v2ray.txt）
      let isDuplicate = false;
      for (const [existingKey, existingLink] of this.links) {
        if (this.getBaseUrl(existingLink.url) === baseUrl) {
          // 同一基础 URL，保留先出现的
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        this.links.set(key, link);
      }
    }
  }

  getGroupedLinks(): Record<string, SubscriptionLink[]> {
    const grouped: Record<string, SubscriptionLink[]> = {};

    for (const link of this.links.values()) {
      const type = link.type || '其他';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(link);
    }

    for (const type in grouped) {
      grouped[type].sort((a, b) => b.foundAt.getTime() - a.foundAt.getTime());
    }

    return grouped;
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};

    for (const link of this.links.values()) {
      const type = link.type || '其他';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total: this.links.size,
      byType,
    };
  }

  getAllLinks(): SubscriptionLink[] {
    return Array.from(this.links.values());
  }

  async saveToFile(filePath: string): Promise<void> {
    const grouped = this.getGroupedLinks();
    const stats = this.getStats();

    let content = '# V2Ray/Clash 订阅链接汇总\n\n';
    content += `> 最后更新: ${new Date().toLocaleString('zh-CN')}\n`;
    content += `> 总计: ${stats.total} 个链接\n\n`;

    content += '## 📊 统计\n\n';
    for (const [type, count] of Object.entries(stats.byType)) {
      content += `- ${type}: ${count} 个\n`;
    }
    content += '\n---\n\n';

    for (const [type, links] of Object.entries(grouped)) {
      content += `## ${type}\n\n`;

      for (const link of links) {
        content += `### ${link.source}\n\n`;
        if (link.description) {
          content += `**说明:** ${link.description}\n\n`;
        }
        content += `**链接:** ${link.url}\n\n`;
        content += `*发现时间: ${link.foundAt.toLocaleString('zh-CN')}*\n\n`;
        content += '---\n\n';
      }
    }

    // 附录: 排序后的纯链接列表
    const sortedUrls = Array.from(this.links.values())
      .map(l => l.url)
      .sort();
    content += '## 📎 纯链接列表\n\n';
    content += '```\n';
    for (const url of sortedUrls) {
      content += url + '\n';
    }
    content += '```\n';

    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

      // 备份旧文件
      try {
        await fs.access(filePath);
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await fs.copyFile(filePath, backupPath);
        console.log(`💾 已备份到: ${backupPath}`);
        await this.cleanupOldBackups(filePath);
      } catch {
        // 文件不存在，无需备份
      }

    // Atomic write: 先写临时文件再 rename
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
    console.log(`💾 已保存到: ${filePath}`);
  }

  async loadFromFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // 排除 badge 图片、非订阅文件扩展名
      const urlPattern = /https?:\/\/[^\s<>")]+\.(yaml|yml|txt|conf|json|v2ray|clash|ss|ssr|vmess|vless|trojan)(?:\?[^\s<>"]*)?/gi;
      const matches = content.matchAll(urlPattern);

      let loaded = 0;
      for (const match of matches) {
        const url = match[0].replace(/[`'"]+$/, '');
        const key = this.normalizeUrl(url);
        if (!this.links.has(key)) {
          this.links.set(key, {
            url,
            source: '历史记录',
            foundAt: new Date(),
          });
          loaded++;
        }
      }

      console.log(`📂 从文件加载了 ${loaded} 个链接`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('📂 输出文件不存在,将创建新文件');
      } else {
        console.error('❌ 加载文件失败:', error);
      }
    }
  }

  clear(): void {
    this.links.clear();
  }

  /**
   * 清理旧的备份文件，只保留最近 3 个
   */
  private async cleanupOldBackups(filePath: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath);
      const files = await fs.readdir(dir);
      const backupEntries = await Promise.all(
        files
          .filter(f => f.startsWith(`${baseName}.backup.`))
          .map(async f => {
            const stat = await fs.stat(path.join(dir, f));
            return { name: f, mtime: stat.mtimeMs };
          })
      );
      backupEntries.sort((a, b) => b.mtime - a.mtime);

      if (backupEntries.length > 3) {
        for (const old of backupEntries.slice(3)) {
          await fs.unlink(path.join(dir, old.name));
          console.log(`🗑️  已清理旧备份: ${old.name}`);
        }
      }
    } catch {
      // 忽略清理错误
    }
  }
}
