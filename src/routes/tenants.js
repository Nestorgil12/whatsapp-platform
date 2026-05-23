const express = require('express');
const router = express.Router();
const { Tenant, Conversation, Message } = require('../models');

// POST /api/tenants — Crear un nuevo tenant
router.post('/', async (req, res) => {
  try {
    const { nombre, email, api_key_whatsapp, whatsapp_phone_id, system_prompt, plan } = req.body;

    if (!nombre || !email || !api_key_whatsapp || !whatsapp_phone_id) {
      return res.status(400).json({
        error: 'nombre, email, api_key_whatsapp y whatsapp_phone_id son obligatorios',
      });
    }

    const tenant = await Tenant.create({
      nombre,
      email,
      api_key_whatsapp,
      whatsapp_phone_id,
      system_prompt,
      plan,
    });

    console.log(`[TENANTS] Created tenant: ${tenant.id} (${tenant.email})`);

    res.status(201).json({
      id: tenant.id,
      nombre: tenant.nombre,
      email: tenant.email,
      whatsapp_phone_id: tenant.whatsapp_phone_id,
      plan: tenant.plan,
      activo: tenant.activo,
      webhook_url: `/webhook/${tenant.id}`,
      created_at: tenant.created_at,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('[TENANTS] Error creating tenant:', err.message);
    res.status(500).json({ error: 'Could not create tenant' });
  }
});

// GET /api/tenants/:id/conversations — Listar conversaciones de un tenant
router.get('/:id/conversations', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const conversations = await Conversation.findAll({
      where: { tenant_id: req.params.id },
      order: [['updated_at', 'DESC']],
      attributes: ['id', 'whatsapp_number', 'created_at', 'updated_at'],
    });

    res.json({ tenant_id: req.params.id, total: conversations.length, conversations });
  } catch (err) {
    console.error('[TENANTS] Error listing conversations:', err.message);
    res.status(500).json({ error: 'Could not retrieve conversations' });
  }
});

// GET /api/tenants/:id/conversations/:convId — Historial completo de una conversación
router.get('/:id/conversations/:convId', async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.convId, tenant_id: req.params.id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await Message.findAll({
      where: { conversation_id: req.params.convId },
      order: [['timestamp', 'ASC']],
      attributes: ['id', 'role', 'content', 'timestamp'],
    });

    res.json({
      conversation: {
        id: conversation.id,
        whatsapp_number: conversation.whatsapp_number,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      },
      total_messages: messages.length,
      messages,
    });
  } catch (err) {
    console.error('[TENANTS] Error fetching conversation:', err.message);
    res.status(500).json({ error: 'Could not retrieve conversation' });
  }
});

// PUT /api/tenants/:id/config — Actualizar configuración del agente
router.put('/:id/config', async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const allowedFields = ['system_prompt', 'plan', 'activo', 'nombre', 'api_key_whatsapp', 'whatsapp_phone_id'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await tenant.update(updates);
    console.log(`[TENANTS] Updated config for tenant: ${tenant.id}`);

    res.json({
      id: tenant.id,
      nombre: tenant.nombre,
      plan: tenant.plan,
      activo: tenant.activo,
      system_prompt: tenant.system_prompt,
      updated_at: tenant.updated_at,
    });
  } catch (err) {
    console.error('[TENANTS] Error updating config:', err.message);
    res.status(500).json({ error: 'Could not update tenant config' });
  }
});

module.exports = router;
