const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fileUpload = require('express-fileupload');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kaly-ecommerce', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err));

// --- MODELS ---

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  category: { type: String, required: true },
  images: [String],
  stock: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  sizes: [String],
  colors: [String],
  createdAt: { type: Date, default: Date.now }
});

const promoSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discount: { type: Number, required: true },
  expiresAt: Date,
  active: { type: Boolean, default: true }
});

// Nouveau modèle pour les clients
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'customer' },
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const PromoCode = mongoose.model('PromoCode', promoSchema);
const User = mongoose.model('User', userSchema);

// Cloudinary Config
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- ROUTES ---

// Inscription des utilisateurs (Public)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // Vérifier si l'email existe déjà
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    const user = new User({
      fullName,
      email: email.toLowerCase(),
      password // Idéalement à hasher avec bcrypt plus tard
    });

    await user.save();
    res.status(201).json({ message: 'Compte créé avec succès !' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const { category, search, featured } = req.query;
    let query = {};
    if (category && category !== 'all') query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };
    if (featured) query.featured = true;
    
    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create product (Admin)
app.post('/api/products', async (req, res) => {
  try {
    if (req.headers.password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image to Cloudinary
app.post('/api/upload', async (req, res) => {
  try {
    if (req.headers.password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    if (!req.files || !req.files.image) return res.status(400).json({ error: 'Aucune image' });
    const file = req.files.image;
    const result = await cloudinary.uploader.upload(file.tempFilePath, { folder: 'kaly-products' });
    res.json({ url: result.secure_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'KALY Backend API is running! 🪡' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
