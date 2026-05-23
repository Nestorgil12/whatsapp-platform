const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Envía un mensaje de texto a un número de WhatsApp vía Meta Graph API.
 * @param {string} phoneNumberId  - Phone Number ID del tenant en Meta
 * @param {string} accessToken    - Token de acceso permanente del tenant
 * @param {string} to             - Número destino en formato E.164
 * @param {string} text           - Texto a enviar
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      `WhatsApp API error ${res.status}: ${JSON.stringify(errorData)}`
    );
  }

  return res.json();
}

module.exports = { sendTextMessage };
