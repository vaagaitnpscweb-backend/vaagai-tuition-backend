const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

// Limit increased to 50MB for uploading large files
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Local MongoDB Connection URL
const MONGO_URI = 'mongodb://localhost:27017/vaagai_tuition';

mongoose.connect(MONGO_URI)
  .then(() => console.log('🎯 MongoDB Connected Successfully to LOCALHOST for WFH System!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Razorpay Instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_TCtg24wJm0gqRH',       
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'WYEppsdiln4ZRRypVdqzWCCw' 
});

// ==========================================
// SCHEMAS WITH STATUS & REJECT CONTROLS
// ==========================================

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  contact: { type: String, default: 'N/A' }, 
  role: { type: String, enum: ['user', 'worker', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  orderNo: { type: String, unique: true }, 
  bookId: String, 
  bookTitle: String, 
  price: Number,
  shippingAddress: { name: String, phone: String, address: String, pincode: String },
  status: { type: String, default: 'PAID via UPI' }, 
  createdAt: { type: Date, default: Date.now }
}));

const Quiz = mongoose.model('Quiz', new mongoose.Schema({
  id: Number, category: String, question: String, options: [String], correctAnswer: String,
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  rejectReason: { type: String, default: '' }
}));

const CurrentAffairs = mongoose.model('CurrentAffairs', new mongoose.Schema({
  id: Number, date: String, category: String, title: String, description: String, tags: [String],
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  rejectReason: { type: String, default: '' }
}));

// Paid & Free PDF Schema
const PaidPdf = mongoose.model('PaidPdf', new mongoose.Schema({
  id: Number, 
  examType: { type: String, enum: ['RRB', 'TNPSC', 'SI', 'PC'] }, 
  title: String,
  questionPdfLink: String, 
  answerPdfLink: String, 
  isFree: { type: Boolean, default: false }, 
  price: { type: Number, default: 0 },       
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Approved' },
  rejectReason: { type: String, default: '' }
}));

// Banner Slide Schema
const Slide = mongoose.model('Slide', new mongoose.Schema({
  id: Number,
  image: String,
  title: String,
  desc: String,
  expiryDate: { type: String, default: '' }
}));

// ==========================================
// API AUTHENTICATION MIDDLEWARE
// ==========================================
const verifyAdminOrWorker = async (req, res, next) => {
  const userEmail = req.headers['user-email'] || req.query.email; 

  if (!userEmail) {
    return res.status(401).json({ success: false, message: "Access Denied! Please login first." });
  }

  try {
    const user = await User.findOne({ email: userEmail });
    if (user && (user.role === 'admin' || user.role === 'worker' || user.email === 'abcdanand970@gmail.com')) {
      next();
    } else {
      res.status(403).json({ success: false, message: "You do not have permission to access this data!" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Error verifying security checks!" });
  }
};

// ==========================================
// ADMIN SPECIAL LOGIN ROUTE
// ==========================================
app.post('/api/admin/login', (req, res) => {
  const { userId, password } = req.body;

  const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vaagai@2026';

  if (userId === ADMIN_USER_ID && password === ADMIN_PASSWORD) {
    const adminUser = {
      name: 'Super Admin (Anand)',
      email: 'abcdanand970@gmail.com',
      role: 'admin'
    };
    return res.json({
      success: true,
      message: 'Admin login completed successfully!',
      user: adminUser
    });
  } else {
    return res.status(401).json({
      success: false,
      message: 'Invalid User ID or Password!'
    });
  }
});

// ==========================================
// HOME SLIDER API ROUTES
// ==========================================

app.get('/api/home/slides', async (req, res) => {
  try {
    const allSlides = await Slide.find().sort({ id: 1 });
    const today = new Date().toISOString().split('T')[0];

    const validSlides = allSlides.filter(slide => {
      if (!slide.expiryDate) return true; 
      return slide.expiryDate >= today;   
    });

    res.json({ success: true, slides: validSlides });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching slides" });
  }
});

app.post('/api/admin/update-slides', verifyAdminOrWorker, async (req, res) => {
  const { slides } = req.body;
  if (!Array.isArray(slides) || slides.length > 10) {
    return res.status(400).json({ success: false, message: "Maximum 10 slides allowed!" });
  }
  try {
    await Slide.deleteMany({}); 
    await Slide.insertMany(slides); 
    res.json({ success: true, message: "Slides updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// API ROUTES (ADMIN, MANAGE PDFS & PAYMENTS)
// ==========================================

app.get('/api/admin/users', verifyAdminOrWorker, async (req, res) => {
  try {
    const users = await User.find({}, 'name email contact role createdAt').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching user details!" });
  }
});

app.get('/api/admin/orders', verifyAdminOrWorker, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    const totalRevenue = orders.reduce((sum, order) => sum + (order.price || 0), 0);

    res.json({ 
      success: true, 
      orders, 
      totalOrders: orders.length, 
      totalRevenue 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching payment details!" });
  }
});

// Edit Approved Live PDF Details (Title, Price, Free Status)
app.put('/api/admin/edit-pdf', verifyAdminOrWorker, async (req, res) => {
  const { id, title, price, isFree } = req.body;
  try {
    const updatedPdf = await PaidPdf.findOneAndUpdate(
      { id: Number(id) },
      { 
        title, 
        price: isFree ? 0 : Number(price), 
        isFree: Boolean(isFree) 
      },
      { new: true }
    );
    if (!updatedPdf) return res.status(404).json({ success: false, message: "PDF not found!" });
    res.json({ success: true, message: "PDF details updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating PDF details!" });
  }
});

// Delete PDF Material permanently
app.delete('/api/admin/delete-pdf/:id', verifyAdminOrWorker, async (req, res) => {
  try {
    const deleted = await PaidPdf.findOneAndDelete({ id: Number(req.params.id) });
    if (!deleted) return res.status(404).json({ success: false, message: "PDF not found!" });
    res.json({ success: true, message: "PDF deleted successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting PDF!" });
  }
});

// 🌟 Fetch ALL PDFs (Pending & Approved) for Admin Management
app.get('/api/admin/all-pdfs', verifyAdminOrWorker, async (req, res) => {
  try {
    const pdfs = await PaidPdf.find({}).sort({ id: -1 }); // { status: 'Approved' } தூக்கப்பட்டு அனைத்து PDF-களும் காட்டப்படும்
    res.json({ success: true, pdfs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching PDFs!" });
  }
});

app.post('/api/payment/create-order', async (req, res) => {
  const targetAmount = req.body.amount || req.body.price || 5;
  const parsedAmount = Math.round(Number(targetAmount) * 100);

  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid payment amount!" });
  }

  const options = {
    amount: parsedAmount, 
    currency: "INR",
    receipt: `receipt_order_${Math.floor(10000 + Math.random() * 90000)}`
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json({ success: true, orderId: order.id, amount: order.amount });
  } catch (err) {
    console.error("❌ Razorpay Order Creation Error:", err);
    res.status(500).json({ success: false, message: "Could not create Razorpay order!" });
  }
});

app.post('/api/payment/success', async (req, res) => {
  const { email, bookId, bookTitle, price, orderNo, shippingAddress } = req.body;
  try {
    const newOrder = new Order({
      orderNo,
      bookId,
      bookTitle,
      price,
      shippingAddress,
      status: `PAID via Razorpay - Digital (${email})` 
    });
    await newOrder.save();
    res.json({ success: true, message: "Order saved successfully in the database!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error saving order details!" });
  }
});

app.get('/api/user/purchased-pdfs', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email parameter required!" });
  }
  try {
    const orders = await Order.find({ status: { $regex: email, $options: 'i' } });
    const purchasedIds = orders.map(o => Number(o.bookId));
    res.json({ success: true, purchasedIds });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching purchased files!" });
  }
});

app.put('/api/admin/approve-item', verifyAdminOrWorker, async (req, res) => {
  const { type, id } = req.body;
  try {
    const updateData = { status: 'Approved', rejectReason: '' };
    if (type === 'quiz') {
      await Quiz.findOneAndUpdate({ id }, updateData);
    } 
    else if (type === 'ca' || type === 'news') { 
      await CurrentAffairs.findOneAndUpdate({ id }, updateData);
    } 
    else if (type === 'pdf') {
      await PaidPdf.findOneAndUpdate({ id }, updateData);
    }
    res.json({ success: true, message: 'Data successfully approved and published live!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/reject-item', verifyAdminOrWorker, async (req, res) => {
  const { type, id, reason } = req.body;
  try {
    const updateData = { status: 'Rejected', rejectReason: reason || 'No reason specified' };
    
    if (type === 'quiz') {
      await Quiz.findOneAndUpdate({ id }, updateData);
    } 
    else if (type === 'ca' || type === 'news') { 
      await CurrentAffairs.findOneAndUpdate({ id }, updateData);
    } 
    else if (type === 'pdf') {
      await PaidPdf.findOneAndUpdate({ id }, updateData);
    }
    res.json({ success: true, message: 'Data rejected successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// CLIENT DATA SIDE ROUTES
// ==========================================

app.get('/api/quiz/questions', async (req, res) => {
  try {
    const questions = await Quiz.find({ status: 'Approved' }).sort({ id: 1 });
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching questions!" });
  }
});

app.get('/api/ca/all', async (req, res) => {
  try {
    const news = await CurrentAffairs.find({ status: 'Approved' }).sort({ _id: -1 });
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching current affairs!" });
  }
});

app.get('/api/paid-pdfs/client/:examType', async (req, res) => {
  try {
    const pdfs = await PaidPdf.find({ examType: req.params.examType, status: 'Approved' }).sort({ _id: -1 });
    res.json({ success: true, pdfs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching PDF details!" });
  }
});

app.get('/api/admin/pending-items', verifyAdminOrWorker, async (req, res) => {
  try {
    const pendingQuizzes = await Quiz.find({ status: 'Pending' });
    const pendingNews = await CurrentAffairs.find({ status: 'Pending' });
    const pendingPdfs = await PaidPdf.find({ status: 'Pending' });
    res.json({ success: true, quizzes: pendingQuizzes, news: pendingNews, pdfs: pendingPdfs });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ==========================================
// WORKER BULK UPLOAD ROUTES
// ==========================================

app.post('/api/quiz/bulk-upload', async (req, res) => {
  const { questionsList } = req.body;
  if (!questionsList || !Array.isArray(questionsList)) {
    return res.status(400).json({ success: false, message: 'Data format is invalid!' });
  }
  try {
    let currentTotal = await Quiz.countDocuments({});
    const formatted = questionsList.map((q, index) => ({
      id: Number(currentTotal + index + 1), 
      category: q.category || 'General Knowledge', 
      question: q.question || '',
      options: [q.option1 || '', q.option2 || '', q.option3 || '', q.option4 || ''], 
      correctAnswer: q.correctAnswer || '', 
      status: 'Pending',
      rejectReason: ''
    }));
    await Quiz.insertMany(formatted);
    res.json({ success: true, message: 'Quiz Uploaded by Worker! Waiting for Admin approval.' });
  } catch(e) { 
    console.error("❌ Bulk Upload Error:", e);
    res.status(500).json({ success: false, error: e.message }); 
  }
});

app.post('/api/ca/bulk-upload', async (req, res) => {
  const { newsList } = req.body;
  try {
    let currentTotal = await CurrentAffairs.countDocuments();
    const formatted = newsList.map((item, index) => ({
      id: currentTotal + index + 1, date: item.date, category: item.category,
      title: item.title, description: item.description, tags: item.tags ? item.tags.split(';') : [], 
      status: 'Pending', rejectReason: ''
    }));
    await CurrentAffairs.insertMany(formatted);
    res.json({ success: true, message: 'News Uploaded by Worker! Waiting for Admin approval.' });
  } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/paid-pdfs/worker-upload', async (req, res) => {
  const { examType, title, questionPdfLink, answerPdfLink, isFree, price } = req.body;
  try {
    let currentTotal = await PaidPdf.countDocuments();
    const newPdf = new PaidPdf({ 
      id: currentTotal + 1, 
      examType, 
      title, 
      questionPdfLink, 
      answerPdfLink, 
      isFree: isFree || false,
      price: isFree ? 0 : (price || 0),
      status: 'Approved', // 🌟 அட்மினிலிருந்து அப்லோடு செய்யப்படும் PDF-கள் நேரடியாக லைவ் ஆகும்
      rejectReason: ''
    });
    await newPdf.save();
    res.json({ success: true, message: 'Exam Material Uploaded Successfully!' });
  } catch(e) { res.status(500).json({ success: false }); }
});

// ==========================================
// AUTHENTICATION ROUTES (STUDENTS SIGNUP / SIGNIN)
// ==========================================

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, contact, password } = req.body; 
  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, message: "This email is already registered!" });
    }
    
    user = new User({ name, email, contact, password });
    await user.save();
    
    const userResponse = { name: user.name, email: user.email, contact: user.contact, role: user.role };
    res.json({ success: true, message: "Account created successfully!", user: userResponse });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error signing up!" });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body; 
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found! Please sign up." });
    }

    if (user.password !== password) {
      return res.status(400).json({ success: false, message: "Incorrect password!" });
    }

    const userResponse = { name: user.name, email: user.email, contact: user.contact, role: user.role };
    res.json({ success: true, message: "Logged in successfully!", user: userResponse });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error logging in!" });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 Vaagai Tuition Backend Server + Local MongoDB + Razorpay Ready!');
});

app.listen(PORT, () => console.log(`✅ Server running successfully on port ${PORT}...`));