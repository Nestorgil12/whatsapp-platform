const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * @param {string} systemPrompt  - Personalidad del agente del tenant
 * @param {Array}  history       - Array de { role, content } de la BD
 * @param {string} userMessage   - Mensaje nuevo del usuario
 * @returns {string} Respuesta generada por Claude
 */
async function generateReply(systemPrompt, history, userMessage) {
  // Construir el array de mensajes: historial previo + mensaje actual
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

module.exports = { generateReply };
