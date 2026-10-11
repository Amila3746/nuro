const express  = require('express');
const mongoose = require('mongoose');
const multer   = require('multer');
const path     = require('path');
const cors     = require('cors');
const fs       = require('fs');
require('dotenv').config();

// ── Optional: sharp for image compression  (npm install sharp) ───────────────
let sharp = null;
try { sharp = require('sharp'); console.log('🖼  Sharp image compression enabled'); }
catch { console.log('ℹ️   sharp not installed — images stored as-is'); }

// ── Optional: Twilio SMS  (npm install twilio) ───────────────────────────────
// Set TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, OWNER_PHONE in .env
let twilioClient = null;
try {
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
        const twilio = require('twilio');
        twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
        console.log('📱 Twilio SMS enabled');
    }
} catch { console.log('ℹ️   Twilio not installed — SMS disabled'); }

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── Admin password ────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nuro2026';
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ── Uploads dir ───────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Created uploads directory');
}

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nuro_clothing')
    .then(() => console.log('✅ NURO Database Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// ── SCHEMAS ───────────────────────────────────────────────────────────────────
const productSchema = new mongoose.Schema({
    name:        { type: String,            required: true },
    price:       { type: Number,            required: true },
    description: { type: String,            required: true },
    category:    { type: String,            required: true },
    image:       { type: String,            required: true },
    images:      { type: [String],          default: []   },
    sizes:       { type: [String],          default: ['OS']},
    stock:       { type: Map, of: Number,   default: {}   },
    colors:      { type: Array,             default: []   }, // [{name:'Black', hex:'#000'}]
    views:       { type: Number,            default: 0    }
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
    customerName:  { type: String,  required: true },
    customerPhone: { type: String,  required: true },
    address:       { type: String,  required: true },
    items:         { type: Array,   required: true },
    total:         { type: Number,  required: true },
    discountCode:  { type: String,  default: null  },
    status:        { type: String,  default: 'Pending', enum: ['Pending','Shipped'] },
    createdAt:     { type: Date,    default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// ── MULTER — memory storage so sharp can process before saving ────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/jpeg|jpg|png|webp|gif/i.test(path.extname(file.originalname))) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    }
});

// Helper: compress + save one image
async function processImage(buffer, originalName) {
    const suffix   = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = `nuro-${suffix}.webp`;
    const destPath = path.join(uploadDir, filename);

    if (sharp) {
        await sharp(buffer)
            .resize(1200, 1600, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(destPath);
    } else {
        // fallback: save as-is with original extension
        const ext      = path.extname(originalName);
        const fallback = `nuro-${suffix}${ext}`;
        fs.writeFileSync(path.join(uploadDir, fallback), buffer);
        return `/uploads/${fallback}`;
    }
    return `/uploads/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ _id: -1 });
        res.json(products.map(p => ({
            ...p.toObject(),
            stock: p.stock ? Object.fromEntries(p.stock) : {}
        })));
    } catch (err) { res.status(500).json({ error: 'Failed to fetch products' }); }
});

// Track views (called by storefront when preview modal opens)
app.post('/products/:id/view', async (req, res) => {
    try { await Product.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }); res.json({ ok: true }); }
    catch { res.json({ ok: false }); }
});

// Related products by category
app.get('/products/:id/related', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.json([]);
        const related = await Product.find({ category: product.category, _id: { $ne: product._id } })
            .limit(3).sort({ _id: -1 });
        res.json(related.map(p => ({ ...p.toObject(), stock: p.stock ? Object.fromEntries(p.stock) : {} })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload new product (admin only)
app.post('/api/upload', adminAuth, upload.array('images', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0)
            return res.status(400).json({ error: 'At least one image is required' });

        const imagePaths = await Promise.all(
            req.files.map(f => processImage(f.buffer, f.originalname))
        );

        const sizeArray = req.body.sizes
            ? req.body.sizes.split(',').map(s => s.trim()).filter(Boolean)
            : ['OS'];

        let stockMap = {};
        if (req.body.stock) { try { stockMap = JSON.parse(req.body.stock); } catch {} }
        let colors = [];
        if (req.body.colors) { try { colors = JSON.parse(req.body.colors); } catch {} }

        const newProduct = new Product({
            name: req.body.name, price: req.body.price,
            description: req.body.description, category: req.body.category,
            sizes: sizeArray, image: imagePaths[0], images: imagePaths,
            stock: stockMap, colors
        });
        await newProduct.save();
        res.status(201).json({ ...newProduct.toObject(), stock: Object.fromEntries(newProduct.stock) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edit product metadata
app.patch('/api/products/:id', adminAuth, async (req, res) => {
    try {
        const { name, price, category, description, stock, colors } = req.body;
        const update = {};
        if (name        !== undefined) update.name        = name;
        if (price       !== undefined) update.price       = Number(price);
        if (category    !== undefined) update.category    = category;
        if (description !== undefined) update.description = description;
        if (stock       !== undefined) update.stock       = stock;
        if (colors      !== undefined) update.colors      = colors;

        const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!product) return res.status(404).json({ error: 'Not found' });
        res.json({ ...product.toObject(), stock: product.stock ? Object.fromEntries(product.stock) : {} });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete product
app.delete('/api/products/:id', adminAuth, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Not found' });
        const imgs = product.images?.length ? product.images : (product.image ? [product.image] : []);
        imgs.forEach(img => {
            const fp = path.join(__dirname, 'public', img);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        });
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/place-order', async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        await newOrder.save();

        // ── Auto-decrement stock per ordered item ────────────
        for (const item of req.body.items) {
            try {
                const product = await Product.findById(item.id);
                if (product && product.stock?.get(item.size) !== undefined) {
                    const cur = product.stock.get(item.size) || 0;
                    product.stock.set(item.size, Math.max(0, cur - 1));
                    await product.save();
                }
            } catch (e) { console.error('Stock decrement error:', e.message); }
        }

        // ── SMS: notify store owner ──────────────────────────
        if (twilioClient && process.env.OWNER_PHONE) {
            const itemList = req.body.items.map(i => `${i.name} (${i.size})`).join(', ');
            await twilioClient.messages.create({
                body: `🛍 NEW NURO ORDER\n👤 ${req.body.customerName}\n📞 ${req.body.customerPhone}\n📦 ${req.body.address}\nITEMS: ${itemList}\n💰 $${Number(req.body.total).toFixed(2)}`,
                from: process.env.TWILIO_FROM,
                to:   process.env.OWNER_PHONE
            }).catch(e => console.error('Owner SMS:', e.message));
        }

        // ── SMS: confirm to customer ─────────────────────────
        if (twilioClient && req.body.customerPhone) {
            await twilioClient.messages.create({
                body: `Hi ${req.body.customerName}! 🖤 Your NURO order is confirmed. We'll contact you with shipping info soon. Thank you!`,
                from: process.env.TWILIO_FROM,
                to:   req.body.customerPhone
            }).catch(e => console.error('Customer SMS:', e.message));
        }

        res.status(201).json({ message: 'Order placed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Checkout failed.' });
    }
});

app.get('/admin/orders', adminAuth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch orders' }); }
});

app.get('/track', async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) return res.status(400).json({ error: 'Phone required' });
        const orders = await Order.find({ customerPhone: phone }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) { res.status(500).json({ error: 'Lookup failed' }); }
});

app.patch('/admin/orders/:id', adminAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findByIdAndUpdate(
            req.params.id, { status }, { new: true, runValidators: true }
        );
        // SMS customer on ship
        if (status === 'Shipped' && twilioClient && order?.customerPhone) {
            await twilioClient.messages.create({
                body: `📦 ${order.customerName}, your NURO order has shipped! Thank you for supporting us. 🖤`,
                from: process.env.TWILIO_FROM, to: order.customerPhone
            }).catch(e => console.error('Shipped SMS:', e.message));
        }
        res.json(order);
    } catch (err) { res.status(500).json({ error: 'Status update failed' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/analytics', adminAuth, async (req, res) => {
    try {
        const [orders, products] = await Promise.all([
            Order.find().sort({ createdAt: -1 }),
            Product.find()
        ]);

        // Revenue per day — last 30 days
        const revenue = {};
        for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            revenue[d.toISOString().slice(0, 10)] = 0;
        }
        orders.forEach(o => {
            const key = new Date(o.createdAt).toISOString().slice(0, 10);
            if (revenue[key] !== undefined) revenue[key] += o.total;
        });

        // Top products by sales
        const itemCounts = {};
        orders.forEach(o => o.items.forEach(i => {
            itemCounts[i.name] = (itemCounts[i.name] || 0) + 1;
        }));
        const topProducts = Object.entries(itemCounts)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        // Top by views
        const topViewed = [...products]
            .sort((a, b) => (b.views||0) - (a.views||0)).slice(0, 5)
            .map(p => ({ name: p.name, views: p.views || 0 }));

        // Size breakdown
        const sizeCounts = {};
        orders.forEach(o => o.items.forEach(i => {
            sizeCounts[i.size] = (sizeCounts[i.size] || 0) + 1;
        }));

        // Category breakdown
        const catRevenue = {};
        orders.forEach(o => o.items.forEach(i => {
            catRevenue[i.category || 'Other'] = (catRevenue[i.category || 'Other'] || 0) + Number(i.price);
        }));

        res.json({
            totalRevenue:  orders.reduce((s, o) => s + o.total, 0),
            totalOrders:   orders.length,
            totalProducts: products.length,
            pendingOrders: orders.filter(o => o.status === 'Pending').length,
            avgOrderValue: orders.length ? orders.reduce((s,o)=>s+o.total,0)/orders.length : 0,
            revenue, topProducts, topViewed, sizeCounts, catRevenue
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin login ───────────────────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ token: ADMIN_PASSWORD });
    else res.status(401).json({ error: 'Wrong password' });
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 1034;
app.listen(PORT, () => console.log(`
    🚀 NURO BACKEND ACTIVE
    🔗 http://localhost:${PORT}
    🔐 Admin password: ${ADMIN_PASSWORD}

    ── Install new deps ──────────────────
    npm install sharp          (image compression)
    npm install twilio         (SMS — optional)
`));
