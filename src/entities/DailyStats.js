const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'DailyStats',
  tableName: 'daily_stats',
  columns: {
    id: {
      primary: true,
      type: 'int',
      generated: true,
    },
    date: {
      type: 'varchar',
    },
    agentName: {
      type: 'varchar',
      nullable: true,
    },
    totalRuns: {
      type: 'int',
      default: 0,
    },
    successfulRuns: {
      type: 'int',
      default: 0,
    },
    failedRuns: {
      type: 'int',
      default: 0,
    },
    totalComments: {
      type: 'int',
      default: 0,
    },
    totalUpvotes: {
      type: 'int',
      default: 0,
    },
    totalRuntimeMinutes: {
      type: 'int',
      default: 0,
    },
    subreddits: {
      type: 'simple-json',
      default: '[]',
    },
    createdAt: {
      type: 'datetime',
      createDate: true,
    },
  },
  indices: [
    {
      name: 'IDX_DATE_AGENT',
      columns: ['date', 'agentName'],
      unique: true,
    },
  ],
});
