const express = require('express');
const router = express.Router();
const { Tenant, Conversation, Message } = require('../models');
const { generateReply } = require('../services/claudeService');
const { sendTextMessage } = require('../services/whatsappService');

// GET /webhook/:tenantId — Verificación del webhook de Meta
router.get('/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') {
    console.warn(`[WEBHOOK][${tenantId}] Verify failed: mode=${mode}`);
    return res.sendStatus(403);
  }

  if (token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    console.warn(`[WEBHOOK][${tenantId}] Verify failed: token mismatch`);
    return res.sendStatus(403);
  }

  console.log(`[WEBHOOK][${tenantId}] Verified successfully`);
  res.status(200).send(challenge);
});

// POST /webhook/:tenantId — Mensajes entrantes de WhatsApp
router.post('/:tenantId', async (req, res) => {
  // Responder 200 inmediatamente para que Meta no reintente
  res.sendStatus(200);

  const { tenantId } = req.params;

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Ignorar eventos que no sean mensajes (status: delivered, read, etc.)
    if (!value?.messages?.length) return;

    const incomingMsg = value.messages[0];

    // Solo procesar mensajes de texto
    if (incomingMsg.type !== 'text') {
      console.log(`[WEBHOOK][${tenantId}] Ignoring non-text message type: ${incomingMsg.type}`);
      return;
    }

    const userNumber = incomingMsg.from;
    const userText = incomingMsg.text.body;

    console.log(`[WEBHOOK][${tenantId}] Message from ${userNumber}: "${userText}"`);

    // Obtener el tenant y validar que esté activo
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      console.error(`[WEBHOOK][${tenantId}] Tenant not found`);
      return;
    }
    if (!tenant.activo) {
      console.warn(`[WEBHOOK][${tenantId}] Tenant is inactive, dropping message`);
      return;
    }

    // Buscar o crear la conversación para este número de usuario
    const [conversation] = await Conversation.findOrCreate({
      where: { tenant_id: tenantId, whatsapp_number: userNumber },
    });

    // Recuperar los últimos 10 mensajes como historial para Claude
    const history = await Message.findAll({
      where: { conversation_id: conversation.id },
      order: [['timestamp', 'ASC']],
      limit: 10,
    });

    // Guardar el mensaje del usuario en la BD
    await Message.create({
      conversation_id: conversation.id,
      role: 'user',
      content: userText,
    });

    // Llamar a Claude con el system_prompt del tenant y el historial
    const aiReply = await generateReply(tenant.system_prompt, history, userText);

    console.log(`[WEBHOOK][${tenantId}] Claude reply to ${userNumber}: "${aiReply}"`);

    // Enviar la respuesta por WhatsApp
    await sendTextMessage(
      tenant.whatsapp_phone_id,
      tenant.api_key_whatsapp,
      userNumber,
      aiReply
    );

    // Guardar la respuesta del asistente en la BD
    await Message.create({
      conversation_id: conversation.id,
      role: 'assistant',
      content: aiReply,
    });

    // Actualizar timestamp de la conversación
    await conversation.update({ updated_at: new Date() });

  } catch (err) {
    console.error(`[WEBHOOK][${tenantId}] Error processing message:`, err.message);
  }
});

module.exports = router;
