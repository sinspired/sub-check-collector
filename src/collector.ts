import { GitHubSearcher } from './github-searcher';
import { ReadmeParser } from './readme-parser';
import { LinkAggregator } from './link-aggregator';
import { ConfigUpdater } from './config-updater';
import { LinkValidator } from './link-validator';
import { Logger } from './logger';
import { Config, Repository } from './types';

export class SubscriptionCollector {
  private searcher: GitHubSearcher;
  private parser: ReadmeParser;
  private aggregator: LinkAggregator;
  private configUpdater: ConfigUpdater;
  private validator?: LinkValidator;
  private logger: Logger;
  private config: Config;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.searcher = new GitHubSearcher(config.githubToken);
    this.parser = new ReadmeParser();
    this.aggregator = new LinkAggregator();
    this.configUpdater = new ConfigUpdater(config.configYamlPath);

    if (config.validateLinks) {
      this.validator = new LinkValidator(
        config.linkValidationTimeout,
        config.linkValidationConcurrency,
        config.proxyUrl,
        config.maxDaysSinceSubUpdate,
        config.githubToken
      );
    }
  }

  async collect(): Promise<void> {
    console.log('\n🚀 开始收集订阅链接...\n');
    const startTime = Date.now();

    await this.logger.sessionStart('订阅链接收集');
    await this.logger.info('收集流程启动', {
      maxRepositories: this.config.maxRepositories,
      validateLinks: this.config.validateLinks,
    });

    try {
      console.log('📂 从头开始收集，不加载历史链接\n');

      await this.logger.info('开始多策略搜索 GitHub 仓库');
      const keywordGroups = this.config.keywordGroups || [this.config.searchKeywords];
      const repositories = await this.searcher.searchAll(
        keywordGroups,
        this.config.maxRepositories,
        this.config.minStars ?? 0,
        this.config.maxDaysSinceUpdate
      );

      await this.logger.success(`找到 ${repositories.length} 个仓库`, {
        count: repositories.length,
        repositories: repositories.map(r => r.fullName),
      });

      // 按更新时间排序（最新优先）
      repositories.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      console.log(`\n📦 准备处理 ${repositories.length} 个仓库（按更新时间排序）\n`);
      repositories.forEach((r, i) => {
        const date = r.updatedAt.toLocaleString('zh-CN');
        console.log(`   ${i + 1}. ${r.fullName} (更新: ${date})`);
      });
      console.log('');

      const CONCURRENCY = 5;
      const processRepo = async (repo: Repository, index: number) => {
        console.log(`\n[${index + 1}/${repositories.length}] 处理: ${repo.fullName}`);

        try {
          const readme = await this.searcher.getReadmeContent(repo.fullName);
          if (readme) {
            const links = this.parser.extractLinks(readme, repo.fullName);
            this.aggregator.addLinks(links);
          }

          if (this.config.exploreFileTree) {
            const subFiles = await this.searcher.getRepoFileTree(repo.fullName);
            if (subFiles.length > 0) {
              console.log(`   📂 发现 ${subFiles.length} 个订阅文件`);

              let filteredFiles = subFiles;
              if (this.config.maxDaysSinceSubUpdate) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - this.config.maxDaysSinceSubUpdate);
                filteredFiles = subFiles.filter(f => f.lastCommit >= cutoffDate);
                if (filteredFiles.length < subFiles.length) {
                  console.log(`   📅 过滤旧文件: ${subFiles.length} → ${filteredFiles.length}`);
                }
              }

              for (const file of filteredFiles.slice(0, 10)) {
                const content = await this.searcher.getFileContent(repo.fullName, file.name);
                if (content) {
                  const links = this.parser.extractLinks(content, `${repo.fullName}/${file.name}`);
                  if (links.length > 0) {
                    console.log(`   📝 ${file.name}: ${links.length} 个链接`);
                    this.aggregator.addLinks(links);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`⚠️  处理 ${repo.fullName} 时出错:`, error);
        }
      };

      // 并发处理
      for (let i = 0; i < repositories.length; i += CONCURRENCY) {
        const batch = repositories.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((repo, j) => processRepo(repo, i + j)));
      }

      await this.aggregator.saveToFile(this.config.outputFile);

      let linksToUpdate = this.aggregator.getAllLinks();
      if (this.config.validateLinks && this.validator) {
        console.log('\n🔐 链接验证已启用\n');
        linksToUpdate = await this.validator.validateLinks(linksToUpdate);
      }

      if (this.config.configYamlPath) {
        await this.configUpdater.backupConfig();
        await this.configUpdater.updateSubUrls(linksToUpdate);
      }

      const stats = this.aggregator.getStats();
      const elapsed = (Date.now() - startTime) / 1000;

      console.log('\n✨ 收集完成!\n');
      console.log(`📊 统计信息:`);
      console.log(`   - 总链接数: ${stats.total}`);
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`   - ${type}: ${count}`);
      }
      console.log(`   - 耗时: ${elapsed.toFixed(2)}s`);
      console.log(`   - 输出文件: ${this.config.outputFile}\n`);

      await this.logger.success('收集完成', {
        statistics: stats,
        duration: elapsed,
        outputFile: this.config.outputFile,
        validatedLinksCount: this.config.validateLinks ? linksToUpdate.length : undefined,
      });

      await this.logger.sessionEnd('订阅链接收集', elapsed);
    } catch (error) {
      console.error('\n❌ 收集过程出错:', error);
      await this.logger.error('收集过程失败', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return this.aggregator.getStats();
  }
}
