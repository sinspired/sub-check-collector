import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SubscriptionLink } from './types';

/**
 * YAML 配置文件更新器
 * 职责: 将收集到的订阅链接更新到 config.yaml 的 sub-urls 部分
 */
export class ConfigUpdater {
  private configPath: string;

  constructor(configPath: string = './config.yaml') {
    this.configPath = configPath;
  }

  /**
   * 更新 config.yaml 中的 sub-urls
   * @param links 订阅链接列表
   */
  async updateSubUrls(links: SubscriptionLink[]): Promise<void> {
    try {
      console.log('\n📝 开始更新 config.yaml...');

      // 1. 读取现有配置文件
      const fileContent = await fs.readFile(this.configPath, 'utf-8');

      // 2. 解析 YAML (保留注释)
      const config = yaml.load(fileContent) as any;

      if (!config) {
        throw new Error('配置文件解析失败');
      }

      // 3. 提取所有有效的订阅链接 URL
      const newUrls = this.extractValidUrls(links);

      // 4. 获取现有的 sub-urls 并清理非法 URL
      const rawExisting = config['sub-urls'] || [];
      const existingUrls = new Set<string>(rawExisting.map((url: string) => this.normalizeUrl(url)));
      const beforeCount = existingUrls.size;
      for (const url of existingUrls) {
        if (this.isNonSubscriptionUrl(url)) {
          existingUrls.delete(url);
        }
      }
      if (existingUrls.size < beforeCount) {
        console.log(`   🗑️  清理了 ${beforeCount - existingUrls.size} 个非法 URL`);
      }

      // 5. 合并链接(去重)
      const mergedUrls = this.mergeUrls(existingUrls, newUrls);

      // 6. 更新配置
      config['sub-urls'] = Array.from(mergedUrls);

      // 7. 保留注释的方式写回文件
      await this.writeConfigWithComments(fileContent, mergedUrls);

      console.log(`✅ 配置文件已更新`);
      console.log(`   - 原有链接: ${existingUrls.size} 个`);
      console.log(`   - 新增链接: ${mergedUrls.size - existingUrls.size} 个`);
      console.log(`   - 总计链接: ${mergedUrls.size} 个\n`);
    } catch (error) {
      console.error('❌ 更新配置文件失败:', error);
      throw error;
    }
  }

  /**
   * 从订阅链接中提取有效的 URL
   */
  private extractValidUrls(links: SubscriptionLink[]): Set<string> {
    const urls = new Set<string>();

    for (const link of links) {
      const url = link.url;

      // 排除非订阅 URL
      if (this.isNonSubscriptionUrl(url)) continue;

      if (this.isSubscriptionUrl(url, link.type)) {
        urls.add(this.normalizeUrl(url));
      }
    }

    return urls;
  }

  /**
   * 判断是否为订阅 URL
   */
  private isSubscriptionUrl(url: string, type?: string): boolean {
    const lower = url.toLowerCase();

    // 1. 订阅文件扩展名
    if (/\.(txt|yaml|yml|conf|json|v2ray|clash|ss|ssr|vmess|vless|trojan)$/i.test(lower)) {
      return true;
    }

    // 2. 订阅相关路径关键字
    if (/\/sub($|\/)|\/subscription($|\/)|\/subscribe($|\/)|\/nodes($|\/)/i.test(lower)) {
      return true;
    }

    // 3. raw.githubusercontent.com 或 gist.githubusercontent.com 上的订阅仓库
    if (lower.includes('raw.githubusercontent.com') || lower.includes('gist.githubusercontent.com')) {
      // 排除明显的非订阅路径
      if (!/\/(actions|workflows|releases|issues|pull)\//i.test(lower)) {
        return true;
      }
    }

    // 4. 已知订阅格式的 URL（通过链接类型推断）
    if (type && ['V2Ray', 'Clash', 'Shadowsocks', 'Hysteria', 'TUIC', 'WireGuard'].includes(type)) {
      return true;
    }

    return false;
  }

  /**
   * 规范化 URL，用于去重
   */
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
   * 判断是否为非订阅 URL
   */
  private isNonSubscriptionUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return [
      // 图片
      /\.svg$/i,
      /\.png$/i,
      /\.jpg$/i,
      /\.jpeg$/i,
      /\.gif$/i,
      /\.webp$/i,
      // 压缩包
      /\.zip$/i,
      /\.tar\.gz$/i,
      /\.tgz$/i,
      /\.rar$/i,
      /\.7z$/i,
      // 可执行文件
      /\.exe$/i,
      /\.msi$/i,
      /\.dmg$/i,
      // 徽章/二维码
      /qrserver/i,
      /quickchart/i,
      /badge/i,
      /shields\.io/i,
      /img\.shields/i,
      // GitHub actions
      /actions\/workflows/i,
      // 其他
      /translate\.yandex/i,
      /blacklist/i,
      /whitelist/i,
    ].some(p => p.test(lower));
  }

  /**
   * 合并新旧链接
   */
  private mergeUrls(existingUrls: Set<string>, newUrls: Set<string>): Set<string> {
    const merged = new Set<string>(existingUrls);

    // 添加新链接
    for (const url of newUrls) {
      merged.add(url);
    }

    return merged;
  }

  /**
   * 保留注释的方式写回配置文件
   * 使用正则表达式替换 sub-urls 部分,保留注释
   */
  private async writeConfigWithComments(
    originalContent: string,
    newUrls: Set<string>
  ): Promise<void> {
    // 构建新的 sub-urls 部分
    const urlsLines = Array.from(newUrls)
      .sort() // 排序
      .map((url) => `  - "${url}"`)
      .join('\n');

    // 改进的正则表达式:
    // 1. 匹配 sub-urls: 前面的所有注释行 (# 开头的行)
    // 2. 匹配 sub-urls: 这一行
    // 3. 匹配所有以空格或tab开头的内容行(包括注释的示例链接)
    // 但只替换非注释的链接部分

    const lines = originalContent.split('\n');
    const newLines: string[] = [];
    let inSubUrls = false;
    let subUrlsStartIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检测 sub-urls: 这一行 (排除注释行)
      if (line.trim() === 'sub-urls:' && !line.trim().startsWith('#')) {
        inSubUrls = true;
        subUrlsStartIndex = newLines.length;
        newLines.push(line);
        continue;
      }

      // 如果在 sub-urls 部分
      if (inSubUrls) {
        // 检查是否到达下一个顶级配置项(不以空格/tab/# 开头的行)
        if (line.length > 0 && !line.match(/^[\s#]/)) {
          // 遇到下一个配置项,退出 sub-urls 部分
          inSubUrls = false;
          // 在这里插入新的 URLs
          newLines.push(urlsLines);
          newLines.push(line);
        } else {
          // 保留注释行和空行,忽略实际的URL行
          if (line.trim().startsWith('#') || line.trim() === '') {
            newLines.push(line);
          }
          // 忽略旧的URL行(以 - 开头)
        }
      } else {
        newLines.push(line);
      }
    }

    // 如果文件末尾就是 sub-urls 部分,添加 URLs
    if (inSubUrls) {
      newLines.push(urlsLines);
    }

    const updatedContent = newLines.join('\n');

    // 写回文件
    await fs.writeFile(this.configPath, updatedContent, 'utf-8');
  }

  /**
   * 备份配置文件
   */
  async backupConfig(): Promise<string> {
    const backupPath = `${this.configPath}.backup.${Date.now()}`;
    await fs.copyFile(this.configPath, backupPath);
    console.log(`💾 配置文件已备份: ${backupPath}`);
    await this.cleanupOldBackups();
    return backupPath;
  }

  /**
   * 清理旧的备份文件，只保留最近 3 个
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      const baseName = path.basename(this.configPath);
      const files = await fs.readdir(dir);
      const backups = files
        .filter(f => f.startsWith(`${baseName}.backup.`))
        .sort()
        .reverse();

      if (backups.length > 3) {
        for (const old of backups.slice(3)) {
          await fs.unlink(path.join(dir, old));
          console.log(`🗑️  已清理旧备份: ${old}`);
        }
      }
    } catch {
      // 忽略清理错误
    }
  }
}
