require('dotenv').config();

const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Database ────────────────────────────────────────────────────────────────

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

// ─── Models ──────────────────────────────────────────────────────────────────

const Tenant = sequelize.define('Tenant', {
  id: { type: DataTypes.UUID, defaultValue: () => uuidv4(), primaryKey: true },
  nombre: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  api_key_whatsapp: { type: DataTypes.TEXT, allowNull: false },
  whatsapp_phone_id: { type: DataTypes.STRING, allowNull: false },
  system_prompt: { type: DataTypes.TEXT, defaultValue: 'Eres un asistente virtual amable y servicial. Responde siempre en el idioma del usuario.' },
  plan: { type: DataTypes.ENUM('free', 'starter', 'pro', 'enterprise'), defaultValue: 'free' },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'tenants', underscored: true });

const Conversation = sequelize.define('Conversation', {
  id: { type: DataTypes.UUID, defaultValue: () => uuidv4(), primaryKey: true },
  tenant_id: { type: DataTypes.UUID, allowNull: false },
  whatsapp_number: { type: DataTypes.STRING, allowNull: false },
}, { tableName: 'conversations', underscored: true, indexes: [{ unique: true, fields: ['tenant_id', 'whatsapp_number'] }] });

const Message = sequelize.define('Message', {
  id: { type: DataTypes.UUID, defaultValue: () => uuidv4(), primaryKey: true },
  conversation_id: { type: DataTypes.UUID, allowNull: false },
  role: { type: DataTypes.ENUM('user', 'assistant'), allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'messages', underscored: true, timestamps: false });

Tenant.hasMany(Conversation, { foreignKey: 'tenant_id', onDelete: 'CASCADE' });
Conversation.belongsTo(Tenant, { foreignKey: 'tenant_id' });
Conversation.hasMany(Message, { foreignKey: 'conversation_id', onDelete: 'CASCADE' });
Message.belongsTo(Conversation, { foreignKey: 'conversation_id' });

// ─── Services ─────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateReply(systemPrompt, history, userMessage) {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  return response.content[0].text;
}

async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp API error ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Webhook routes
app.get('/webhook/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    console.warn(`[WEBHOOK][${tenantId}] Verify failed`);
    return res.sendStatus(403);
  }
  console.log(`[WEBHOOK][${tenantId}] Verified`);
  res.status(200).send(challenge);
});

app.post('/webhook/:tenantId', async (req, res) => {
  res.sendStatus(200);
  const { tenantId } = req.params;
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) return;
    const incomingMsg = value.messages[0];
    if (incomingMsg.type !== 'text') return;
    const userNumber = incomingMsg.from;
    const userText = incomingMsg.text.body;
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant || !tenant.activo) return;
    const [conversation] = await Conversation.findOrCreate({
      where: { tenant_id: tenantId, whatsapp_number: userNumber },
    });
    const history = await Message.findAll({
      where: { conversation_id: conversation.id },
      order: [['timestamp', 'ASC']],
      limit: 10,
    });
    await Message.create({ conversation_id: conversation.id, role: 'user', content: userText });
    const aiReply = await generateReply(tenant.system_prompt, history, userText);
    await sendTextMessage(tenant.whatsapp_phone_id, tenant.api_key_whatsapp, userNumber, aiReply);
    await Message.create({ conversation_id: conversation.id, role: 'assistant', content: aiReply });
    await conversation.update({ updated_at: new Date() });
  } catch (err) {
    console.error(`[WEBHOOK][${tenantId}] Error:`, err.message);
  }
});

// Tenant routes
app.post('/api/tenants', async (req, res) => {
  try {
    const { nombre, email, api_key_whatsapp, whatsapp_phone_id, system_prompt, plan } = req.body;
    if (!nombre || !email || !api_key_whatsapp || !whatsapp_phone_id) {
      return res.status(400).json({ error: 'nombre, email, api_key_whatsapp y whatsapp_phone_id son obligatorios' });
    }
    const tenant = await Tenant.create({ nombre, email, api_key_whatsapp, whatsapp_phone_id, system_prompt, plan });
    res.status(201).json({ id: tenant.id, nombre: tenant.nombre, email: tenant.email, whatsapp_phone_id: tenant.whatsapp_phone_id, plan: tenant.plan, activo: tenant.activo, webhook_url: `/webhook/${tenant.id}`, created_at: tenant.created_at });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Email already registered' });
    console.error('[TENANTS] Error:', err.message);
    res.status(500).json({ error: 'Could not create tenant' });
  }
});

app.get('/api/tenants/:id/conversations', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const conversations = await Conversation.findAll({ where: { tenant_id: req.params.id }, order: [['updated_at', 'DESC']], attributes: ['id', 'whatsapp_number', 'created_at', 'updated_at'] });
    res.json({ tenant_id: req.params.id, total: conversations.length, conversations });
  } catch (err) {
    res.status(500).json({ error: 'Could not retrieve conversations' });
  }
});

app.get('/api/tenants/:id/conversations/:convId', async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ where: { id: req.params.convId, tenant_id: req.params.id } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const messages = await Message.findAll({ where: { conversation_id: req.params.convId }, order: [['timestamp', 'ASC']], attributes: ['id', 'role', 'content', 'timestamp'] });
    res.json({ conversation: { id: conversation.id, whatsapp_number: conversation.whatsapp_number, created_at: conversation.created_at, updated_at: conversation.updated_at }, total_messages: messages.length, messages });
  } catch (err) {
    res.status(500).json({ error: 'Could not retrieve conversation' });
  }
});

app.put('/api/tenants/:id/config', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const allowedFields = ['system_prompt', 'plan', 'activo', 'nombre', 'api_key_whatsapp', 'whatsapp_phone_id'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
    await tenant.update(updates);
    res.json({ id: tenant.id, nombre: tenant.nombre, plan: tenant.plan, activo: tenant.activo, system_prompt: tenant.system_prompt, updated_at: tenant.updated_at });
  } catch (err) {
    res.status(500).json({ error: 'Could not update tenant config' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Running on port ${PORT}`));

sequelize.authenticate()
  .then(() => {
    console.log('[DB] Connection established');
    return sequelize.sync({ alter: true });
  })
  .then(() => console.log('[DB] Models synchronized'))
  .catch((err) => {
    console.error('[FATAL] Database error:', err.message);
    process.exit(1);
  });
