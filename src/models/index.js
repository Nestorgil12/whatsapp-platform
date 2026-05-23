const { Sequelize } = require('sequelize');

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
      logging: false,
    })
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
      }
    );

const Tenant = require('./Tenant')(sequelize);
const Conversation = require('./Conversation')(sequelize);
const Message = require('./Message')(sequelize);

// Associations
Tenant.hasMany(Conversation, { foreignKey: 'tenant_id', onDelete: 'CASCADE' });
Conversation.belongsTo(Tenant, { foreignKey: 'tenant_id' });

Conversation.hasMany(Message, { foreignKey: 'conversation_id', onDelete: 'CASCADE' });
Message.belongsTo(Conversation, { foreignKey: 'conversation_id' });

module.exports = { sequelize, Tenant, Conversation, Message };
