require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

async function createApp() {
  const { init } = require('./database');
  const db = await init();
  global.__db = db;

  const app = express();

  app.set('trust proxy', 1);

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/productos', express.static(path.join(__dirname, 'productos')));
  app.use('/PC3logo.png', express.static(path.join(__dirname, 'PC3logo.png')));
  app.use('/PC3logo-whitevariant.png', express.static(path.join(__dirname, 'PC3logo-whitevariant.png')));
  app.get('/logo-mayorista-negro.png', (req, res) => res.sendFile(path.join(__dirname, 'PC3 Logo Mayorista Negro.png')));
  app.get('/logo-mayorista-pro.png', (req, res) => res.sendFile(path.join(__dirname, 'PC3 Logo Mayorista PRO.png')));
  app.get('/logo-mayorista-pro-negro.png', (req, res) => res.sendFile(path.join(__dirname, 'PC3 Logo Mayorista PRO Negro.png')));

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Sessions — stored in PostgreSQL so they persist across deploys and serverless instances
  app.use(session({
    store: new pgSession({
      conString: process.env.DATABASE_URL,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'pc3_secret_dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  }));

  // Routes
  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/catalog'));

  return app;
}

// Local dev: start the server normally
// Vercel: export the app as a serverless handler
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp().then(app => {
    app.listen(PORT, () => {
      console.log(`\n🚀 PC3 Catálogo corriendo en http://localhost:${PORT}`);
      console.log(`   Admin: http://localhost:${PORT}/admin`);
    });
  }).catch(err => {
    console.error('Error iniciando servidor:', err);
    process.exit(1);
  });
} else {
  // Vercel serverless export
  let appPromise = null;
  module.exports = async (req, res) => {
    if (!appPromise) appPromise = createApp();
    const app = await appPromise;
    app(req, res);
  };
}
