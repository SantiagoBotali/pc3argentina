require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

async function main() {
  const { init } = require('./database');
  const db = await init();
  global.__db = db;

  const app = express();
  const PORT = process.env.PORT || 3000;

  // Trust Railway/Vercel proxy for secure cookies
  app.set('trust proxy', 1);

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/productos', express.static(path.join(__dirname, 'productos')));
  app.use('/PC3logo.png', express.static(path.join(__dirname, 'PC3logo.png')));
  app.use('/PC3logo-whitevariant.png', express.static(path.join(__dirname, 'PC3logo-whitevariant.png')));

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Sessions
  const isProduction = process.env.NODE_ENV === 'production';
  app.use(session({
    secret: process.env.SESSION_SECRET || 'pc3_secret_dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  }));

  // Routes
  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/catalog'));

  app.listen(PORT, () => {
    console.log(`\n🚀 PC3 Catálogo corriendo en http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin`);
  });
}

main().catch(err => {
  console.error('Error iniciando servidor:', err);
  process.exit(1);
});
