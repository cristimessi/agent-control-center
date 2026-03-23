require('reflect-metadata');
const { DataSource } = require('typeorm');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: config.databasePath,
  synchronize: true,
  logging: false,
  entities: [
    require('./entities/Agent'),
    require('./entities/AgentRun'),
    require('./entities/PostedComment'),
    require('./entities/Schedule'),
    require('./entities/DailyStats'),
  ],
});

async function initializeDatabase() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

const DEFAULT_AGENTS = ['dale', 'marcus', 'julie', 'ethan', 'harrison', 'victor', 'diana', 'leo'];

const DEFAULT_ALLOWED_SITES = [
  'reddit.com', 'old.reddit.com',
  'wikipedia.org', 'github.com', 'news.ycombinator.com',
  'theverge.com', 'wired.com', 'reuters.com', 'bbc.com',
  'atlasobscura.com', 'waitbutwhy.com'
];

const DEFAULT_BLOCKED_SITES = [
  'facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com',
  'youtube.com'
];

module.exports = {
  AppDataSource,
  initializeDatabase,
  DEFAULT_AGENTS,
  DEFAULT_ALLOWED_SITES,
  DEFAULT_BLOCKED_SITES
};
