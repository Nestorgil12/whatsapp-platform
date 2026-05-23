require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason);
  process.exit(1);
});
const express = require('express');
const { sequelize } = require('./models');
const webhookRoutes = require('./routes/webhook');
const tenantRoutes = require('./routes/tenants');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/webhook', webhookRoutes);
app.use('/api/tenants', tenantRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
  });

  try {
    await sequelize.authenticate();
    console.log('[DB] Connection established');
    await sequelize.sync({ alter: true });
    console.log('[DB] Models synchronized');
  } catch (err) {
    console.error('[FATAL] Database connection failed:', err.message);
    process.exit(1);
  }
}

start();
