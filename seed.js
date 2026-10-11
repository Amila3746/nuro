const mongoose = require('mongoose');
require('dotenv').config();
const Product = require('./models/productsnuro');

const products = [
    {
        name: "NURO 'ESSENTIAL' HOODIE",
        price: 85,
        description: "Heavyweight 450GSM organic cotton. Oversized boxy fit in Midnight Black.",
        image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=800&auto=format&fit=crop",
        category: "Hoodies"
    },
    {
        name: "ARCHIVE GRAPHIC TEE",
        price: 45,
        description: "Vintage wash 100% cotton tee featuring screen-printed 'Nuro Archive' chest logo.",
        image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop",
        category: "T-Shirts"
    },
    {
        name: "TECH CARGO PANTS",
        price: 120,
        description: "Water-resistant nylon ripstop with adjustable toggle hems and 6-pocket utility.",
        image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?q=80&w=800&auto=format&fit=crop",
        category: "Bottoms"
    },
    {
        name: "STREET BEANIE",
        price: 30,
        description: "Double-layered ribbed knit with woven brand fold-over label.",
        image: "https://images.unsplash.com/photo-1576828831022-ae41d45653fe?q=80&w=800&auto=format&fit=crop",
        category: "Accessories"
    },
    {
        name: "NYLON COACH JACKET",
        price: 150,
        description: "Lightweight windbreaker with snap-front closure and hidden interior pocket.",
        image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?q=80&w=800&auto=format&fit=crop",
        category: "Outerwear"
    }
];

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("📡 Connected to MongoDB for seeding...");
        
        await Product.deleteMany({});
        console.log("🗑️ Old products cleared.");

        await Product.insertMany(products);
        console.log("💎 Success: 5 High-quality products added to NURO!");

        mongoose.connection.close();
    } catch (err) {
        console.error("❌ Seeding Error:", err);
    }
};

seedDB();