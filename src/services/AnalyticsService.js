const { AppDataSource } = require('../database');

class AnalyticsService {
  constructor() {
    this.runRepo = AppDataSource.getRepository(require('../entities/AgentRun'));
    this.commentRepo = AppDataSource.getRepository(require('../entities/PostedComment'));
    this.statsRepo = AppDataSource.getRepository(require('../entities/DailyStats'));
    this.Agent = require('../entities/Agent');
  }

  async getOverview() {
    const runs = await this.runRepo.count();
    const comments = await this.commentRepo.count();
    const successfulRuns = await this.runRepo.countBy({ status: 'completed' });
    const failedRuns = await this.runRepo.countBy({ status: 'error' });
    const agents = await AppDataSource.getRepository(this.Agent).count();
    const activeAgents = await AppDataSource.getRepository(this.Agent).countBy({ status: 'running' });

    return {
      totalRuns: runs,
      totalComments: comments,
      successfulRuns,
      failedRuns,
      successRate: runs > 0 ? Math.round((successfulRuns / runs) * 100) : 0,
      activeAgents,
      totalAgents: agents,
    };
  }

  async getAgentStats(agentName) {
    const runs = await this.runRepo.findBy({ agentName });
    const comments = await this.commentRepo.findBy({ agentName });

    const totalRuns = runs.length;
    const totalComments = comments.length;
    const successfulRuns = runs.filter(r => r.status === 'completed').length;
    const avgRuntime = runs.length > 0
      ? Math.round(runs.reduce((sum, r) => sum + r.durationMinutes, 0) / runs.length)
      : 0;

    const subredditCounts = {};
    for (const c of comments) {
      if (c.subreddit) {
        subredditCounts[c.subreddit] = (subredditCounts[c.subreddit] || 0) + 1;
      }
    }
    const topSubreddits = Object.entries(subredditCounts)
      .map(([subreddit, count]) => ({ subreddit, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      agentName,
      totalRuns,
      totalComments,
      successRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
      avgRuntimeMinutes: avgRuntime,
      topSubreddits,
    };
  }

  async getTopSubreddits(limit = 20) {
    const comments = await this.commentRepo.find();
    const subredditCounts = {};

    for (const c of comments) {
      if (c.subreddit) {
        if (!subredditCounts[c.subreddit]) {
          subredditCounts[c.subreddit] = { count: 0, agents: new Set() };
        }
        subredditCounts[c.subreddit].count++;
        subredditCounts[c.subreddit].agents.add(c.agentName);
      }
    }

    return Object.entries(subredditCounts)
      .map(([subreddit, data]) => ({
        subreddit,
        commentCount: data.count,
        uniqueAgents: data.agents.size,
      }))
      .sort((a, b) => b.commentCount - a.commentCount)
      .slice(0, limit);
  }

  async getDailyStats(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return this.statsRepo
      .createQueryBuilder('stats')
      .where('stats.createdAt >= :date', { date: startDate })
      .orderBy('stats.date', 'DESC')
      .getMany();
  }

  async recordRun(run) {
    const saved = await this.runRepo.save(run);
    await this.updateDailyStats(run.agentName);
    return saved;
  }

  async recordComment(comment) {
    const saved = await this.commentRepo.save(comment);
    await this.updateDailyStats(comment.agentName);
    return saved;
  }

  async updateDailyStats(agentName) {
    const today = new Date().toISOString().split('T')[0];
    let stats = await this.statsRepo.findOneBy({ date: today, agentName });

    const runs = await this.runRepo.findBy({ agentName, status: 'completed' });
    const comments = await this.commentRepo.findBy({ agentName });

    const subreddits = [...new Set(comments.map(c => c.subreddit).filter(Boolean))];

    if (!stats) {
      stats = this.statsRepo.create({
        date: today,
        agentName,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        totalComments: 0,
        totalUpvotes: 0,
        totalRuntimeMinutes: 0,
        subreddits,
      });
    }

    stats.totalRuns = runs.length;
    stats.successfulRuns = runs.filter(r => r.status === 'completed').length;
    stats.failedRuns = runs.filter(r => r.status === 'error').length;
    stats.totalComments = comments.length;
    stats.totalRuntimeMinutes = runs.reduce((sum, r) => sum + r.durationMinutes, 0);
    stats.subreddits = subreddits;

    await this.statsRepo.save(stats);
  }
}

module.exports = { AnalyticsService };
