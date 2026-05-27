const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connecté'))
  .catch(err => console.log('❌ Erreur MongoDB:', err));

// --- SCHÉMAS ---
const productSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  category: String,
  image: String, // URL Cloudinary ou lien direct
  stock: { type: Number, default: 10 }
});

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'customer' }
});

const Product = mongoose.model('Product', productSchema);
const User = mongoose.model('User', userSchema);

// --- ROUTES PRODUITS (Ce qui manquait !) ---

// Récupérer tous les produits pour index.html
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ajouter un produit (Pour ton futur admin.html)
app.post('/api/products', async (req, res) => {
  try {
    if (req.headers.password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- ROUTES AUTHENTIFICATION ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();
    const user = new User({ fullName, email: normalizedEmail, password });
    await user.save();
    res.status(201).json({ message: 'Compte créé !' });
  } catch (error) {
    res.status(500).json({ error: "Email déjà utilisé" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    res.json({ user: { fullName: user.fullName, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- ROUTES ADMIN ---
app.get('/api/admin/users', async (req, res) => {
  try {
    if (req.headers.password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const users = await User.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send('KALY API RUNNING 🪡'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));
