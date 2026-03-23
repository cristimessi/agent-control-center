const { AppDataSource, DEFAULT_AGENTS, DEFAULT_ALLOWED_SITES, DEFAULT_BLOCKED_SITES } = require('../database');

class AgentService {
  constructor() {
    this.repo = AppDataSource.getRepository(require('../entities/Agent'));
  }

  async getAll() {
    return this.repo.find();
  }

  async getByName(name) {
    return this.repo.findOneBy({ name });
  }

  async create(name) {
    const agent = this.repo.create({
      name,
      status: 'idle',
      currentActivity: null,
      runsToday: 0,
      commentsToday: 0,
      lastRun: null,
      ip: null,
      browserOpen: false,
      logs: [],
      customInstructions: '',
      visitedSubreddits: [],
      postedComments: [],
      allowedSites: [...DEFAULT_ALLOWED_SITES],
      blockedSites: [...DEFAULT_BLOCKED_SITES],
      runtimeMinutes: 10,
      pageTimeSeconds: 30,
      targetSubreddits: [],
      searchTopics: [],
      commentFrequency: 'medium',
      upvotesPerSession: 5,
      enabled: true,
    });
    return this.repo.save(agent);
  }

  async update(name, data) {
    await this.repo.update({ name }, data);
    return this.getByName(name);
  }

  async delete(name) {
    if (DEFAULT_AGENTS.includes(name)) {
      return false;
    }
    const result = await this.repo.delete({ name });
    return result.affected ? result.affected > 0 : false;
  }

  async addLog(name, log) {
    const agent = await this.getByName(name);
    if (agent) {
      agent.logs.push(log);
      if (agent.logs.length > 1000) {
        agent.logs = agent.logs.slice(-500);
      }
      await this.repo.save(agent);
    }
  }

  async addPostedComment(name, comment) {
    const agent = await this.getByName(name);
    if (agent) {
      agent.postedComments.push(comment);
      agent.commentsToday++;
      if (agent.postedComments.length > 500) {
        agent.postedComments = agent.postedComments.slice(-250);
      }
      await this.repo.save(agent);
    }
  }

  async addVisitedSubreddit(name, subreddit) {
    const agent = await this.getByName(name);
    if (agent && !agent.visitedSubreddits.includes(subreddit)) {
      agent.visitedSubreddits.push(subreddit);
      await this.repo.save(agent);
    }
  }

  async seedDefaults() {
    for (const name of DEFAULT_AGENTS) {
      const existing = await this.getByName(name);
      if (!existing) {
        await this.create(name);
      }
    }
  }
}

module.exports = { AgentService };
