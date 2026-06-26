import { SubscriptionLink } from './types';

/**
 * README 解析器
 * 职责: 从 README 内容中提取订阅链接
 */
export class ReadmeParser {
  // 常见的订阅链接模式
  private readonly URL_PATTERNS = [
    // raw.githubusercontent.com 链接
    /https?:\/\/raw\.githubusercontent\.com\/[^\s<>")]+/gi,
    // GitHub blob 链接
    /https?:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/blob\/[^\s<>")]+/gi,
    // 其他常见订阅域名
    /https?:\/\/[^\s<>"]+\.(yaml|yml|txt|conf|json|v2ray|clash)/gi,
  ];

  // 订阅类型关键字映射
  private readonly TYPE_KEYWORDS: Record<string, string[]> = {
    V2Ray: ['v2ray', 'vmess', 'vless', 'trojan', 'xray'],
    Clash: ['clash', 'clash.yaml', 'clash.yml', 'mihomo'],
    Shadowsocks: ['shadowsocks', 'shadowsocksr', 'ss', 'ssr'],
    Hysteria: ['hysteria', 'hy2'],
    TUIC: ['tuic'],
    WireGuard: ['wireguard', 'wg'],
    订阅链接: ['订阅', 'subscription', 'sub'],
  };

  /**
   * 从 README 内容中提取订阅链接
   * @param content README 内容
   * @param source 来源仓库名称
   */
  extractLinks(content: string, source: string): SubscriptionLink[] {
    const links: SubscriptionLink[] = [];
    const foundUrls = new Set<string>();

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';

      for (const pattern of this.URL_PATTERNS) {
        const matches = line.matchAll(pattern);

        for (const match of matches) {
          let url = match[0].trim();

          // 清理末尾的特殊字符: | ` ' " ) > 等
          url = url.replace(/[|`'"'\)>]+$/, '');

          // 跳过明显的非订阅文件
          if (this.isNonSubscriptionUrl(url)) continue;

          // 使用规范化后的 URL 去重
          const normalizedUrl = this.normalizeUrl(url);
          if (foundUrls.has(normalizedUrl)) continue;
          foundUrls.add(normalizedUrl);

          const type = this.inferType(line, prevLine);
          const description = this.extractDescription(line, prevLine);

          links.push({
            url,
            type,
            source,
            description,
            foundAt: new Date(),
          });
        }
      }
    }

    console.log(`📝 从 ${source} 提取到 ${links.length} 个链接`);
    return links;
  }

  /**
   * 推断订阅类型
   */
  private inferType(currentLine: string, previousLine: string): string | undefined {
    const context = (previousLine + ' ' + currentLine).toLowerCase();

    for (const [type, keywords] of Object.entries(this.TYPE_KEYWORDS)) {
      if (keywords.some((keyword) => context.includes(keyword.toLowerCase()))) {
        return type;
      }
    }

    // 从 URL 路径中推断类型
    const urlMatch = currentLine.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      const urlPath = urlMatch[0].toLowerCase();
      if (/\/ss\//i.test(urlPath) || /shadowsocks/i.test(urlPath)) return 'Shadowsocks';
      if (/\/clash/i.test(urlPath) || /mihomo/i.test(urlPath)) return 'Clash';
      if (/\/v2ray|\/vmess|\/vless|\/trojan/i.test(urlPath)) return 'V2Ray';
      if (/\/hysteria|\/hy2/i.test(urlPath)) return 'Hysteria';
      if (/\/tuic/i.test(urlPath)) return 'TUIC';
      if (/\/wireguard|\/wg/i.test(urlPath)) return 'WireGuard';
      if (/\/ssr/i.test(urlPath)) return 'Shadowsocks';
    }

    return undefined;
  }

  /**
   * 提取描述信息
   */
  private extractDescription(currentLine: string, previousLine: string): string | undefined {
    // 尝试从当前行或上一行提取描述
    const context = previousLine + ' ' + currentLine;

    // 移除 URL 和 Markdown 语法
    let description = context
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/[#*`\[\]()]/g, '')
      .trim();

    // 限制长度
    if (description.length > 100) {
      description = description.substring(0, 97) + '...';
    }

    return description || undefined;
  }

  /**
   * 判断是否为非订阅文件 URL
   */
  private isNonSubscriptionUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const excludePatterns = [
      // 黑白名单、CIDR
      /blacklist/i,
      /whitelist/i,
      /cidr/i,
      // 图片
      /\.svg$/i,
      /\.png$/i,
      /\.jpg$/i,
      /\.gif$/i,
      // GitHub actions
      /actions\/workflows/i,
      // 徽章
      /badge/i,
      /shields\.io/i,
      /img\.shields/i,
      // QR 码
      /qrserver/i,
      /quickchart/i,
      // 翻译
      /translate\.yandex/i,
      // 广告过滤列表
      /adblock/i,
      /easylist/i,
      /easyprivacy/i,
      /adguard/i,
      /anti-ad/i,
      /hosts$/i,
      /hosts\.txt/i,
      /malware/i,
      /annoyance/i,
      // GKD/自动化规则
      /gkd/i,
      // 订阅转换/代理工具（不是节点）
      /sub-converter/i,
      /subconverter/i,
      // 脚本/代码文件
      /\.js$/i,
      /\.py$/i,
      /\.sh$/i,
      /\.bat$/i,
      /\.ps1$/i,
      // 配置文件模板（不是实际订阅）
      /template/i,
      /example/i,
      // 目录链接（以 / 结尾）
      /\/$/,
      // LICENSE/CHANGELOG 文件
      /\/license(\/|$)/i,
      /\/changelog(\/|$)/i,
      /\/readme(\/|$)/i,
      // 非订阅文件
      /\.md$/i,
      /\.html$/i,
      /\.css$/i,
    ];
    return excludePatterns.some(p => p.test(lowerUrl));
  }

  /**
   * 规范化 URL 用于去重
   * - 转小写
   * - 去除尾部斜杠
   * - 去除 query 参数和 fragment
   */
  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // 只保留 pathname，去除 query 和 hash
      return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, '');
    } catch {
      return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  }

  /**
   * 验证 URL 是否有效
   */
  isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
