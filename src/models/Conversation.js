const { DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize) =>
  sequelize.define(
    'Conversation',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      whatsapp_number: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Número del usuario final en formato E.164, ej: 5491112345678',
      },
    },
    {
      tableName: 'conversations',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['tenant_id', 'whatsapp_number'],
        },
      ],
    }
  );
