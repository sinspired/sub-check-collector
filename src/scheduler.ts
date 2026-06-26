import * as schedule from 'node-schedule';
import { SubscriptionCollector } from './collector';
import { Logger } from './logger';
import { Config } from './types';

export class TaskScheduler {
  private collector: SubscriptionCollector;
  private logger: Logger;
  private config: Config;
  private job?: schedule.Job;
  private isRunning = false;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.collector = new SubscriptionCollector(config, logger);
  }

  start(): void {
    console.log(`⏰ 调度器启动`);
    console.log(`   规则: ${this.config.scheduleInterval}`);
    console.log(`   下次执行: ${this.getNextRunTime()}\n`);

    this.job = schedule.scheduleJob(this.config.scheduleInterval, async () => {
      if (this.isRunning) {
        console.log(`⏭️  上一次任务仍在执行,跳过本次触发`);
        return;
      }

      this.isRunning = true;
      console.log(`\n⏰ [${new Date().toLocaleString('zh-CN')}] 定时任务触发\n`);
      try {
        await this.collector.collect();
      } catch (error) {
        console.error('❌ 定时任务执行失败:', error);
      } finally {
        this.isRunning = false;
      }
    });

    if (!this.job) {
      console.error(`❌ 无效的 cron 表达式: ${this.config.scheduleInterval}`);
    }
  }

  async runOnce(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️  任务正在执行中,请稍候...');
      return;
    }

    this.isRunning = true;
    console.log('🔥 手动执行一次收集任务\n');
    try {
      await this.collector.collect();
    } finally {
      this.isRunning = false;
    }
  }

  stop(): void {
    if (this.job) {
      this.job.cancel();
      this.job = undefined;
      console.log('⏸️  调度器已停止');
    }
  }

  private getNextRunTime(): string {
    try {
      const tempJob = schedule.scheduleJob(this.config.scheduleInterval, () => {});
      if (!tempJob) return '未知 (无效的 cron 表达式)';
      const nextRun = tempJob.nextInvocation();
      tempJob.cancel();
      return nextRun ? new Date(nextRun).toLocaleString('zh-CN') : '未知';
    } catch (e: any) {
      return `未知 (${e?.message || '解析失败'})`;
    }
  }
}
