# WhatsApp AI Platform

Multi-tenant SaaS platform for WhatsApp AI agents powered by Claude.

## Architecture

Each tenant maps to one WhatsApp Business number and has its own Claude agent with a custom `system_prompt`. All tenants share the same server instance; their data is isolated by `tenant_id`.

```
Meta WhatsApp → POST /webhook/:tenantId → Claude API → POST back to WhatsApp
```

## Requirements

- Node.js 18+
- PostgreSQL 14+
- Anthropic API key
- Meta WhatsApp Business App

---

## Setup

### 1. Clone & install

```bash
git clone <repo>
cd whatsapp-platform
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description |
|---|---|
| `DB_*` | PostgreSQL connection details |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `WHATSAPP_VERIFY_TOKEN` | Any random string — used to verify the webhook in Meta |
| `JWT_SECRET` | Secret for JWT tokens |

### 3. Create the database

```sql
CREATE DATABASE whatsapp_platform;
```

### 4. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

On first start, Sequelize will auto-create all tables.

---

## API Reference

### Create a tenant

```bash
POST /api/tenants
Content-Type: application/json

{
  "nombre": "Mi Tienda",
  "email": "admin@mitienda.com",
  "api_key_whatsapp": "EAAxxxxxxxx",
  "whatsapp_phone_id": "123456789",
  "system_prompt": "Eres un asistente de ventas amable para Mi Tienda...",
  "plan": "starter"
}
```

Response includes `webhook_url: /webhook/<tenant_id>` — use that URL in Meta.

---

### Update agent config

```bash
PUT /api/tenants/:id/config
Content-Type: application/json

{
  "system_prompt": "Nuevo prompt...",
  "plan": "pro",
  "activo": true
}
```

---

### List conversations

```bash
GET /api/tenants/:id/conversations
```

---

### Get conversation history

```bash
GET /api/tenants/:id/conversations/:convId
```

---

## Configuring the Meta Webhook

1. Go to your [Meta App Dashboard](https://developers.facebook.com/apps/)
2. Select your app → **WhatsApp → Configuration**
3. Set **Callback URL**: `https://yourdomain.com/webhook/<tenantId>`
4. Set **Verify Token**: the value of `WHATSAPP_VERIFY_TOKEN` in your `.env`
5. Subscribe to the **messages** field
6. Click **Verify and Save**

> Each tenant gets their own webhook URL. You can use the same verify token for all tenants or customize the logic in `routes/webhook.js`.

---

## Deployment with ngrok (local testing)

```bash
# Install ngrok, then:
ngrok http 3000
# Use the https URL as your webhook callback in Meta
```

---

## Scaling notes

- For production, run behind a reverse proxy (nginx/Caddy) with TLS.
- Add a Redis-based queue (BullMQ) to process messages asynchronously if load increases.
- The `sequelize.sync({ alter: true })` in app.js is safe for development; replace with proper migrations in production.
