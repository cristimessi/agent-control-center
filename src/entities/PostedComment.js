const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'PostedComment',
  tableName: 'posted_comments',
  columns: {
    id: {
      primary: true,
      type: 'int',
      generated: true,
    },
    agentName: {
      type: 'varchar',
    },
    text: {
      type: 'text',
    },
    subreddit: {
      type: 'varchar',
      nullable: true,
    },
    postTitle: {
      type: 'varchar',
      nullable: true,
    },
    postUrl: {
      type: 'varchar',
      nullable: true,
    },
    success: {
      type: 'boolean',
      default: true,
    },
    createdAt: {
      type: 'datetime',
      createDate: true,
    },
  },
  relations: {
    agent: {
      target: 'Agent',
      type: 'many-to-one',
      joinColumn: {
        name: 'agentName',
        referencedColumnName: 'name',
      },
      onDelete: 'CASCADE',
    },
  },
});
