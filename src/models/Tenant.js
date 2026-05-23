const { DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize) =>
  sequelize.define(
    'Tenant',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      api_key_whatsapp: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Permanent token de acceso de Meta para este tenant',
      },
      whatsapp_phone_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Phone Number ID del número de WhatsApp Business de Meta',
      },
      system_prompt: {
        type: DataTypes.TEXT,
        defaultValue: 'Eres un asistente virtual amable y servicial. Responde siempre en el idioma del usuario.',
      },
      plan: {
        type: DataTypes.ENUM('free', 'starter', 'pro', 'enterprise'),
        defaultValue: 'free',
      },
      activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: 'tenants',
      underscored: true,
    }
  );
