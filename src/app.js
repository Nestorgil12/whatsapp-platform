require('dotenv').config();

const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Database ─────────────────────────────────────────────────────────────────

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

// ─── Models ───────────────────────────────────────────────────────────────────

const Tenant = sequelize.define('Tenant', {
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
  },
  whatsapp_phone_id: {
    type: DataTypes.STRING,
    allowNull: false,
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
}, { tableName: 'tenants', underscored: true });

const Conversation = sequelize.define('Conversation', {
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
  },
}, {
  tableName: 'conversations',
  underscored: true,
  indexes: [{ unique: true, fields: ['tenant_id', 'whatsapp_number'] }],
});

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: () => uuidv4(),
    primaryKey: true,
  },
  conversation_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('user', 'assistant'),
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, { tableName: 'messages', underscored: true, timestamps: false });

Tenant.hasMany(Conversation, { foreignKey: 'tenant_id', onDelete: 'CASCADE' });
Conversation.belongsTo(Tenant, { foreignKey: 'tenant_id' });
Conversation.hasMany(Message, { foreignKey: 'conversation_id', onDelete: 'CASCADE' });
Message.belongsTo(Conversation, { foreignKey: 'conversation_id' });

// ─── Claude ───────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateReply(systemPrompt, history, userMessage) {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  return response.content[0].text;
}

async function sendWhatsAppMessage(phoneNumberId, accessToken, to, text) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
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

// GET /
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'WhatsApp Platform funcionando' });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /webhook/:tenantId — Verificación Meta
app.get('/webhook/:tenantId', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /webhook/:tenantId — Mensajes entrantes
app.post('/webhook/:tenantId', async (req, res) => {
  res.sendStatus(200);
  const { tenantId } = req.params;
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) return;
    const msg = value.messages[0];
    if (msg.type !== 'text') return;

    const userNumber = msg.from;
    const userText = msg.text.body;

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

    const reply = await generateReply(tenant.system_prompt, history, userText);

    await sendWhatsAppMessage(tenant.whatsapp_phone_id, tenant.api_key_whatsapp, userNumber, reply);

    await Message.create({ conversation_id: conversation.id, role: 'assistant', content: reply });
  } catch (err) {
    console.error(`[WEBHOOK][${tenantId}] Error:`, err.message);
  }
});

// POST /api/tenants — Crear tenant
app.post('/api/tenants', async (req, res) => {
  try {
    const { nombre, email, api_key_whatsapp, whatsapp_phone_id, system_prompt, plan } = req.body;
    if (!nombre || !email || !api_key_whatsapp || !whatsapp_phone_id) {
      return res.status(400).json({ error: 'nombre, email, api_key_whatsapp y whatsapp_phone_id son obligatorios' });
    }
    const tenant = await Tenant.create({ nombre, email, api_key_whatsapp, whatsapp_phone_id, system_prompt, plan });
    res.status(201).json({
      id: tenant.id,
      nombre: tenant.nombre,
      email: tenant.email,
      plan: tenant.plan,
      activo: tenant.activo,
      webhook_url: `/webhook/${tenant.id}`,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Email ya registrado' });
    }
    console.error('[TENANTS] Error:', err.message);
    res.status(500).json({ error: 'No se pudo crear el tenant' });
  }
});

// GET /api/tenants/:id/conversations — Listar conversaciones
app.get('/api/tenants/:id/conversations', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    const conversations = await Conversation.findAll({
      where: { tenant_id: req.params.id },
      order: [['updated_at', 'DESC']],
      attributes: ['id', 'whatsapp_number', 'created_at', 'updated_at'],
    });
    res.json({ tenant_id: req.params.id, total: conversations.length, conversations });
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron obtener las conversaciones' });
  }
});

// PUT /api/tenants/:id/config — Actualizar system_prompt y config
app.put('/api/tenants/:id/config', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    const allowed = ['system_prompt', 'plan', 'activo', 'nombre', 'api_key_whatsapp', 'whatsapp_phone_id'];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    }
    await tenant.update(updates);
    res.json({ id: tenant.id, nombre: tenant.nombre, plan: tenant.plan, activo: tenant.activo, system_prompt: tenant.system_prompt });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar la configuración' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Running on port ${PORT}`);
});

sequelize.authenticate()
  .then(() => {
    console.log('[DB] Conectado');
    return sequelize.sync({ alter: true });
  })
  .then(() => console.log('[DB] Modelos sincronizados'))
  .catch((err) => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
