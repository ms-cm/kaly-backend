const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();

/* ─── MIDDLEWARE ──────────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/' }));

/* ─── MONGODB ─────────────────────────────────────── */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kaly-ecommerce', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err));

/* ─── CLOUDINARY ──────────────────────────────────── */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ═══════════════════════════════════════════════════
   MODELS
═══════════════════════════════════════════════════ */

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: String,
  price:       { type: Number, required: true },
  category:    { type: String, required: true },
  images:      [String],
  stock:       { type: Number, default: 0 },
  featured:    { type: Boolean, default: false },
  sizes:       [String],
  colors:      [String],
  createdAt:   { type: Date, default: Date.now }
});

const promoSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, uppercase: true },
  discount:  { type: Number, required: true },
  expiresAt: Date,
  active:    { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  fullName:  { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  phone:     { type: String, default: '' },
  role:      { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const Product   = mongoose.model('Product',   productSchema);
const PromoCode = mongoose.model('PromoCode', promoSchema);
const User      = mongoose.model('User',      userSchema);

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */

// Admin password check (header-based)
function isAdmin(req) {
  return req.headers['password'] === process.env.ADMIN_PASSWORD;
}

// JWT auth middleware for users
function authUser(req, res, next) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'kaly_secret_key');
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

/* ═══════════════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════════════ */

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body;

    if (!fullName || !email || !password)
      return res.status(400).json({ message: 'Tous les champs sont requis' });

    if (password.length < 6)
      return res.status(400).json({ message: 'Mot de passe trop court (min 6 caracteres)' });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(400).json({ message: 'Un compte existe deja avec cet email' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ fullName, email: email.toLowerCase(), password: hashed, phone: phone || '' });
    await user.save();

    res.status(201).json({ message: 'Compte cree avec succes' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'kaly_secret_key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id:       user._id,
        name:     user.fullName,
        email:    user.email,
        role:     user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get current user profile
app.get('/api/auth/me', authUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Update own profile (name + phone)
app.put('/api/auth/me', authUser, async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fullName, phone },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Change own password
app.post('/api/auth/change-password', authUser, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Nouveau mot de passe trop court (min 6)' });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Mot de passe mis a jour' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Delete own account (client self-delete)
app.delete('/api/auth/me', authUser, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    res.json({ message: 'Compte supprime avec succes' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


/* ═══════════════════════════════════════════════════
   PRODUCT ROUTES
═══════════════════════════════════════════════════ */

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const { category, search, featured } = req.query;
    let query = {};
    if (category && category !== 'all') query.category = category;
    if (search)   query.name = { $regex: search, $options: 'i' };
    if (featured) query.featured = true;
    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit non trouve' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Similar products
app.get('/api/products/:id/similar', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit non trouve' });
    const similar = await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(6);
    res.json(similar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create product (Admin)
app.post('/api/products', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update product (Admin)
app.put('/api/products/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product (Admin)
app.delete('/api/products/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Produit supprime' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   UPLOAD ROUTE (Cloudinary)
═══════════════════════════════════════════════════ */

app.post('/api/upload', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    if (!req.files || !req.files.image)
      return res.status(400).json({ error: 'Aucune image fournie' });

    const file   = req.files.image;
    const result = await cloudinary.uploader.upload(file.tempFilePath, {
      folder:         'kaly-products',
      transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }]
    });

    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete image from Cloudinary (Admin)
app.delete('/api/upload/:public_id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    await cloudinary.uploader.destroy(req.params.public_id);
    res.json({ message: 'Image supprimee' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   PROMO ROUTES
═══════════════════════════════════════════════════ */

// Validate promo code (public)
app.get('/api/promo/:code', async (req, res) => {
  try {
    const promo = await PromoCode.findOne({ code: req.params.code.toUpperCase(), active: true });
    if (!promo) return res.status(404).json({ error: 'Code promo invalide' });
    if (promo.expiresAt && promo.expiresAt < new Date())
      return res.status(400).json({ error: 'Code promo expire' });
    res.json({ discount: promo.discount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all promos (Admin)
app.get('/api/promos', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const promos = await PromoCode.find().sort({ createdAt: -1 });
    res.json(promos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create promo (Admin)
app.post('/api/promo', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const promo = new PromoCode(req.body);
    await promo.save();
    res.status(201).json(promo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle promo active/inactive (Admin)
app.patch('/api/promo/:id/toggle', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const promo = await PromoCode.findById(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promo non trouvee' });
    promo.active = !promo.active;
    await promo.save();
    res.json(promo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete promo (Admin)
app.delete('/api/promo/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    await PromoCode.findByIdAndDelete(req.params.id);
    res.json({ message: 'Promo supprimee' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN STATS
═══════════════════════════════════════════════════ */

app.get('/api/admin/stats', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const [totalProducts, totalUsers, totalPromos, lowStock, featured, categories] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments(),
      PromoCode.countDocuments({ active: true }),
      Product.countDocuments({ stock: { $lte: 5 } }),
      Product.countDocuments({ featured: true }),
      Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
    ]);
    res.json({ totalProducts, totalUsers, totalPromos, lowStock, featured, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users (Admin)
app.get('/api/admin/users', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user (Admin)
app.delete('/api/admin/users/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorise' });
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Client supprime' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── HEALTH ──────────────────────────────────────── */
app.get('/', (req, res) => res.json({ message: 'KALY Backend API is running! 🪡' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('🚀 Server running on port ' + PORT));
                                                                                                       
