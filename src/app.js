require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'EXISTE' : 'NO EXISTE');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
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
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection established');
    await sequelize.sync({ alter: true });
    console.log('[DB] Models synchronized');
    app.listen(PORT, () => {
      console.log(`[SERVER] Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[FATAL] Could not start server:', err.message);
    console.error('[FATAL] Stack trace:', err.stack);
    console.error('[FATAL] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    process.exit(1);
  }
}

start();
