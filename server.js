const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 🚀 Render Reverse Proxy Fix (Fixes ValidationError: 'X-Forwarded-For')
app.set('trust proxy', 1);

// 🔒 Security & CORS Middleware (Fixed for Preflight & Custom Headers)
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'user-email']
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Body Parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🗄️ MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vaagai_tuition';

mongoose.connect(MONGO_URI)
  .then(() => console.log('🎯 MongoDB Connected Successfully!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// 💳 Razorpay Setup (Render Environment Variables-ல் Live Keys கொடுத்தால் அதை எடுத்துக்கொள்ளும்)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_TXSfHBesNhHuXM',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'MohPsvfXDzD6YncfhPvufjkM'
});

// 📊 Schemas
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  contact: { type: String, default: 'N/A' },
  role: { type: String, enum: ['student', 'user', 'worker', 'admin'], default: 'student' },
  createdAt: { type: Date, default: Date.now }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  orderNo: { type: String, unique: true },
  email: { type: String, lowercase: true, trim: true },
  bookId: String,
  bookTitle: String,
  price: Number,
  shippingAddress: { name: String, phone: String, address: String, pincode: String },
  status: { type: String, default: 'PAID' },
  refundReason: { type: String, default: '' },
  paymentId: { type: String, default: '' },
  orderId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}));

const Quiz = mongoose.model('Quiz', new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  subject: { type: String, default: 'TNPSC' },
  category: { type: String, default: 'தமிழ்' },
  topic: { type: String, default: 'தமிழ்' },
  questionSet: { type: String, default: 'Model Test 1' },
  question: { type: String, required: true },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, required: true },
  status: { type: String, default: 'active' },
  rejectReason: { type: String, default: '' }
}, { strict: false, timestamps: true }));

const OnlineTest = mongoose.model('OnlineTest', new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  examType: { type: String, default: 'TNPSC' },
  title: { type: String, required: true },
  selectedTopics: [String],
  topic: { type: String, default: 'தமிழ்' },
  selectionType: { type: String, enum: ['random', 'selective'], default: 'random' },
  selectedQuestionIds: [mongoose.Schema.Types.Mixed],
  totalQuestions: { type: Number, default: 20 },
  durationMinutes: { type: Number, default: 15 },
  isFree: { type: Boolean, default: true },
  price: { type: Number, default: 0 },
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now }
}));

const CurrentAffairs = mongoose.model('CurrentAffairs', new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  date: String,
  category: String,
  title: String,
  description: String,
  tags: [String],
  qaList: [{ question: String, answer: String }],
  status: { type: String, default: 'active' },
  rejectReason: { type: String, default: '' }
}));

const PaidPdf = mongoose.model('PaidPdf', new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  examType: { type: String, required: true },
  title: String,
  questionPdfLink: String,
  answerPdfLink: { type: String, default: '' },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  rejectReason: { type: String, default: '' }
}));

const Slide = mongoose.model('Slide', new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  image: String,
  title: String,
  desc: String,
  expiryDate: { type: String, default: '' }
}));

// 🔐 Admin/Worker Verification Middleware
const verifyAdminOrWorker = async (req, res, next) => {
  const userEmail = (req.headers['user-email'] || req.query.email || '').trim().toLowerCase();

  if (!userEmail) {
    return res.status(401).json({ success: false, message: "Access Denied! Please login first." });
  }

  try {
    const adminEmailEnv = (process.env.ADMIN_EMAIL || 'abcdanand970@gmail.com').toLowerCase();
    const workerEmailEnv = (process.env.WORKER_EMAIL || 'worker@vaagai.com').toLowerCase();

    if (userEmail === adminEmailEnv || userEmail === workerEmailEnv) {
      return next();
    }
    const user = await User.findOne({ email: userEmail });
    if (user && (user.role === 'admin' || user.role === 'worker')) {
      return next();
    }
    return res.status(403).json({ success: false, message: "You do not have permission to access this data!" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error verifying security checks!" });
  }
};

// 🔑 Admin Login
app.post('/api/admin/login', (req, res) => {
  const { userId, password } = req.body;
  const adminIdEnv = process.env.ADMIN_USER_ID || 'admin';
  const adminPassEnv = process.env.ADMIN_PASSWORD || 'vaagai@2026';
  const workerIdEnv = process.env.WORKER_USER_ID || 'work';
  const workerPassEnv = process.env.WORKER_PASSWORD || 'work@2026';

  if (userId === adminIdEnv && password === adminPassEnv) {
    return res.json({
      success: true,
      message: 'Master Admin login success!',
      user: { name: 'Anand Sakkaravarthi', email: process.env.ADMIN_EMAIL || 'abcdanand970@gmail.com', role: 'admin' }
    });
  }

  if (userId === workerIdEnv && password === workerPassEnv) {
    return res.json({
      success: true,
      message: 'Worker login success!',
      user: { name: 'Vaagai Worker', email: process.env.WORKER_EMAIL || 'worker@vaagai.com', role: 'worker' }
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid User ID or Password!'
  });
});

// 👥 Users Management
app.get('/api/admin/users', verifyAdminOrWorker, async (req, res) => {
  try {
    const users = await User.find({}, 'name email contact role createdAt').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching user details!" });
  }
});

app.post('/api/admin/save-user', verifyAdminOrWorker, async (req, res) => {
  const { id, name, email, contact, role } = req.body;
  try {
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address!" });
    }

    let finalRole = role || 'student';
    const adminEmailEnv = (process.env.ADMIN_EMAIL || 'abcdanand970@gmail.com').toLowerCase();
    if (cleanEmail === adminEmailEnv) {
      finalRole = 'admin';
    }

    let user;
    if (id && mongoose.isValidObjectId(id)) {
      const existingUser = await User.findById(id);
      if (existingUser && existingUser.email === adminEmailEnv && cleanEmail !== adminEmailEnv) {
        return res.status(400).json({ success: false, message: "Master Admin email cannot be changed!" });
      }
      user = await User.findByIdAndUpdate(
        id,
        { name, email: cleanEmail, contact: contact || 'N/A', role: finalRole },
        { new: true }
      );
    } else {
      user = await User.findOne({ email: cleanEmail });
      if (user) {
        if (user.email === adminEmailEnv && cleanEmail !== adminEmailEnv) {
          return res.status(400).json({ success: false, message: "Master Admin email cannot be changed!" });
        }
        user.name = name;
        user.contact = contact || 'N/A';
        user.role = finalRole;
        await user.save();
      } else {
        const hashedPassword = await bcrypt.hash('User@123', 10);
        user = new User({
          name,
          email: cleanEmail,
          contact: contact || 'N/A',
          role: finalRole,
          password: hashedPassword
        });
        await user.save();
      }
    }
    res.json({ success: true, message: "User saved/updated successfully!", user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/delete-user', verifyAdminOrWorker, async (req, res) => {
  const { email } = req.body;
  try {
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const adminEmailEnv = (process.env.ADMIN_EMAIL || 'abcdanand970@gmail.com').toLowerCase();
    if (cleanEmail === adminEmailEnv) {
      return res.status(403).json({ success: false, message: "Master Admin user cannot be deleted!" });
    }
    await User.findOneAndDelete({ email: cleanEmail });
    res.json({ success: true, message: "User deleted successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting user!" });
  }
});

// 📝 Quiz Management
app.get('/api/quiz/questions', async (req, res) => {
  try {
    const questions = await Quiz.find({ status: { $regex: /^active$/i } }).sort({ _id: -1 });
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching questions!" });
  }
});

app.post('/api/quiz/add', verifyAdminOrWorker, async (req, res) => {
  const { subject, topic, category, questionSet, question, options, correctAnswer, status } = req.body;
  try {
    const last = await Quiz.findOne().sort({ _id: -1 });
    const nextId = (last && Number(last.id)) ? Number(last.id) + 1 : Date.now();

    const resolvedTopic = topic || category || 'தமிழ்';

    const newQuiz = new Quiz({
      id: nextId,
      subject: subject || 'TNPSC',
      category: resolvedTopic,
      topic: resolvedTopic,
      questionSet: questionSet || 'Topic Test',
      question: question ? question.trim() : 'Untitled Question',
      options: Array.isArray(options) ? options : [],
      correctAnswer: correctAnswer ? correctAnswer.trim() : '',
      status: status || 'active'
    });

    await newQuiz.save();
    return res.json({ success: true, message: "Question added successfully!", quiz: newQuiz });
  } catch (err) {
    console.error("Quiz Add Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/edit-item', verifyAdminOrWorker, async (req, res) => {
  const { type, id, question, options, correctAnswer, status, subject, topic, questionSet } = req.body;
  try {
    if (type === 'quiz') {
      const updatePayload = {};
      if (question) updatePayload.question = question.trim();
      if (options) updatePayload.options = options;
      if (correctAnswer) updatePayload.correctAnswer = correctAnswer.trim();
      if (status) updatePayload.status = status;
      if (subject) updatePayload.subject = subject;
      if (questionSet) updatePayload.questionSet = questionSet;
      if (topic) {
        updatePayload.topic = topic;
        updatePayload.category = topic;
      }

      const query = mongoose.isValidObjectId(id) 
        ? { $or: [{ _id: id }, { id: id }, { id: Number(id) || null }] } 
        : { id: isNaN(id) ? id : Number(id) };

      const updatedQuiz = await Quiz.findOneAndUpdate(query, updatePayload, { new: true });
      if (!updatedQuiz) {
        return res.status(404).json({ success: false, message: "Quiz item not found!" });
      }
    }
    return res.json({ success: true, message: "Item updated successfully!" });
  } catch (err) {
    console.error("Quiz Edit Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/reject-item', verifyAdminOrWorker, async (req, res) => {
  const { type, id, reason } = req.body;
  try {
    if (type === 'quiz') {
      const query = mongoose.isValidObjectId(id) 
        ? { $or: [{ _id: id }, { id: id }, { id: Number(id) || null }] } 
        : { id: isNaN(id) ? id : Number(id) };

      const updatedQuiz = await Quiz.findOneAndUpdate(
        query,
        { status: 'Rejected', rejectReason: reason || 'Deleted by Admin' },
        { new: true }
      );
      if (!updatedQuiz) {
        return res.status(404).json({ success: false, message: "Quiz item not found!" });
      }
    }
    return res.json({ success: true, message: 'Item marked as Rejected successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 📋 Online Tests
app.get('/api/admin/all-tests', verifyAdminOrWorker, async (req, res) => {
  try {
    const tests = await OnlineTest.find({}).sort({ _id: -1 });
    res.json({ success: true, tests });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching online tests!" });
  }
});

app.post('/api/admin/add-test', verifyAdminOrWorker, async (req, res) => {
  const { examType, title, selectedTopics, selectionType, selectedQuestionIds, totalQuestions, durationMinutes, isFree, price, startTime, endTime } = req.body;
  try {
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Test title is required!" });
    }
    if (Number(totalQuestions) < 1) {
      return res.status(400).json({ success: false, message: "Total questions must be at least 1!" });
    }
    if (Number(durationMinutes) < 1) {
      return res.status(400).json({ success: false, message: "Duration must be at least 1 minute!" });
    }
    const testPrice = Number(price);
    if (!isFree && (!Number.isFinite(testPrice) || testPrice < 0)) {
      return res.status(400).json({ success: false, message: "Invalid test price!" });
    }

    const last = await OnlineTest.findOne().sort({ _id: -1 });
    const nextId = (last && Number(last.id)) ? Number(last.id) + 1 : Date.now();

    const validStartTime = startTime && startTime.trim() !== '' ? new Date(startTime) : null;
    const validEndTime = endTime && endTime.trim() !== '' ? new Date(endTime) : null;

    const newTest = new OnlineTest({
      id: nextId,
      examType: examType || 'TNPSC',
      title: title.trim(),
      selectedTopics: selectedTopics && selectedTopics.length > 0 ? selectedTopics : ['தமிழ்'],
      topic: selectedTopics?.[0] || 'தமிழ்',
      selectionType: selectionType || 'random',
      selectedQuestionIds: selectedQuestionIds || [],
      totalQuestions: Number(totalQuestions) || 20,
      durationMinutes: Number(durationMinutes) || 15,
      isFree: Boolean(isFree),
      price: isFree ? 0 : testPrice,
      startTime: validStartTime,
      endTime: validEndTime,
      status: 'active'
    });

    await newTest.save();
    return res.json({ success: true, message: "Online Test created successfully!", test: newTest });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/edit-test', verifyAdminOrWorker, async (req, res) => {
  const { id, examType, title, selectedTopics, selectionType, selectedQuestionIds, totalQuestions, durationMinutes, isFree, price, startTime, endTime, status } = req.body;
  try {
    const updatePayload = {};
    if (examType) updatePayload.examType = examType;
    if (title) updatePayload.title = title.trim();
    if (selectedTopics) {
      updatePayload.selectedTopics = selectedTopics;
      updatePayload.topic = selectedTopics[0];
    }
    if (selectionType) updatePayload.selectionType = selectionType;
    if (selectedQuestionIds) updatePayload.selectedQuestionIds = selectedQuestionIds;
    if (totalQuestions !== undefined) updatePayload.totalQuestions = Number(totalQuestions);
    if (durationMinutes !== undefined) updatePayload.durationMinutes = Number(durationMinutes);
    if (isFree !== undefined) updatePayload.isFree = Boolean(isFree);
    if (price !== undefined) updatePayload.price = isFree ? 0 : Number(price);

    updatePayload.startTime = startTime && startTime.trim() !== '' ? new Date(startTime) : null;
    updatePayload.endTime = endTime && endTime.trim() !== '' ? new Date(endTime) : null;
    if (status) updatePayload.status = status;

    const query = mongoose.isValidObjectId(id) 
      ? { $or: [{ _id: id }, { id: id }, { id: Number(id) || null }] } 
      : { id: isNaN(id) ? id : Number(id) };

    const updatedTest = await OnlineTest.findOneAndUpdate(query, updatePayload, { new: true });
    if (!updatedTest) {
      return res.status(404).json({ success: false, message: "Online test not found!" });
    }

    return res.json({ success: true, message: "Test details updated successfully!" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/delete-test/:id', verifyAdminOrWorker, async (req, res) => {
  try {
    const targetId = req.params.id;
    const query = mongoose.isValidObjectId(targetId) 
      ? { $or: [{ _id: targetId }, { id: targetId }, { id: Number(targetId) || null }] } 
      : { id: isNaN(targetId) ? targetId : Number(targetId) };

    const deletedTest = await OnlineTest.findOneAndDelete(query);
    if (!deletedTest) {
      return res.status(404).json({ success: false, message: "Online test not found!" });
    }
    return res.json({ success: true, message: "Online Test deleted successfully!" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error deleting online test!" });
  }
});

// 🖼️ Slides
app.get('/api/home/slides', async (req, res) => {
  try {
    const allSlides = await Slide.find().sort({ _id: 1 });
    const today = new Date().toISOString().split('T')[0];

    const validSlides = allSlides.filter(slide => {
      if (!slide.image || slide.image.trim() === '') return false;
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
    const validSlidesToSave = slides.filter(s => s.image && s.image.trim() !== '');
    if (validSlidesToSave.length > 0) {
      await Slide.insertMany(validSlidesToSave);
    }
    res.json({ success: true, message: "Slides updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 📄 PDFs
app.get('/api/admin/all-pdfs', verifyAdminOrWorker, async (req, res) => {
  try {
    const pdfs = await PaidPdf.find({}).sort({ _id: -1 });
    res.json({ success: true, pdfs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching PDFs!" });
  }
});

app.get('/api/paid-pdfs/client/:examType', async (req, res) => {
  const { examType } = req.params;
  try {
    const regex = new RegExp(`^${examType}$`, 'i');
    const pdfs = await PaidPdf.find({
      examType: { $regex: regex },
      status: { $regex: /^active$/i }
    }).sort({ _id: -1 });

    res.json({ success: true, pdfs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching exam materials!" });
  }
});

app.post('/api/paid-pdfs/worker-upload', verifyAdminOrWorker, async (req, res) => {
  const { examType, title, questionPdfLink, answerPdfLink, isFree, price, status } = req.body;
  try {
    const last = await PaidPdf.findOne().sort({ _id: -1 });
    const nextId = (last && Number(last.id)) ? Number(last.id) + 1 : Date.now();

    const newPdf = new PaidPdf({
      id: nextId,
      examType,
      title: title ? title.trim() : '',
      questionPdfLink: questionPdfLink ? questionPdfLink.trim() : '',
      answerPdfLink: answerPdfLink ? answerPdfLink.trim() : '',
      isFree: isFree || false,
      price: isFree ? 0 : (price || 0),
      status: status || 'active',
      rejectReason: ''
    });
    await newPdf.save();
    res.json({ success: true, message: 'Exam Material Saved Successfully!' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/edit-pdf', verifyAdminOrWorker, async (req, res) => {
  const { id, title, examType, questionPdfLink, answerPdfLink, price, isFree, status } = req.body;
  try {
    const updateFields = {};
    if (title) updateFields.title = title.trim();
    if (examType) updateFields.examType = examType.trim();
    if (questionPdfLink) updateFields.questionPdfLink = questionPdfLink.trim();
    if (answerPdfLink !== undefined) updateFields.answerPdfLink = answerPdfLink.trim();
    if (price !== undefined) updateFields.price = isFree ? 0 : Number(price);
    if (isFree !== undefined) updateFields.isFree = Boolean(isFree);
    if (status) updateFields.status = status;

    const query = mongoose.isValidObjectId(id) 
      ? { $or: [{ _id: id }, { id: id }, { id: Number(id) || null }] } 
      : { id: isNaN(id) ? id : Number(id) };

    const updatedPdf = await PaidPdf.findOneAndUpdate(query, updateFields, { new: true });
    if (!updatedPdf) return res.status(404).json({ success: false, message: "PDF not found!" });
    res.json({ success: true, message: "PDF details updated successfully!", updatedPdf });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/delete-pdf/:id', verifyAdminOrWorker, async (req, res) => {
  try {
    const targetId = req.params.id;
    const query = mongoose.isValidObjectId(targetId) 
      ? { $or: [{ _id: targetId }, { id: targetId }, { id: Number(targetId) || null }] } 
      : { id: isNaN(targetId) ? targetId : Number(targetId) };

    const deletedPdf = await PaidPdf.findOneAndDelete(query);
    if (!deletedPdf) {
      return res.status(404).json({ success: false, message: "PDF not found!" });
    }
    res.json({ success: true, message: "PDF deleted successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting PDF!" });
  }
});

// 📰 Current Affairs
app.post('/api/ca/add-direct', verifyAdminOrWorker, async (req, res) => {
  const { date, category, title, description, tags } = req.body;
  try {
    const last = await CurrentAffairs.findOne().sort({ _id: -1 });
    const nextId = (last && Number(last.id)) ? Number(last.id) + 1 : Date.now();

    const newCa = new CurrentAffairs({
      id: nextId,
      date,
      category,
      title: title ? title.trim() : '',
      description: description ? description.trim() : '',
      tags: typeof tags === 'string' ? tags.split(';').map(t => t.trim()).filter(Boolean) : (Array.isArray(tags) ? tags : []),
      status: 'active'
    });
    await newCa.save();
    res.json({ success: true, message: "Current Affairs published successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/edit-ca', verifyAdminOrWorker, async (req, res) => {
  const { id, date, category, title, description, tags } = req.body;
  try {
    const updatePayload = {};
    if (date) updatePayload.date = date;
    if (category) updatePayload.category = category;
    if (title) updatePayload.title = title.trim();
    if (description) updatePayload.description = description.trim();
    if (tags !== undefined) {
      updatePayload.tags = typeof tags === 'string' ? tags.split(';').map(t => t.trim()).filter(Boolean) : (Array.isArray(tags) ? tags : []);
    }

    const query = mongoose.isValidObjectId(id) 
      ? { $or: [{ _id: id }, { id: id }, { id: Number(id) || null }] } 
      : { id: isNaN(id) ? id : Number(id) };

    const updatedCa = await CurrentAffairs.findOneAndUpdate(query, updatePayload, { new: true });
    if (!updatedCa) {
      return res.status(404).json({ success: false, message: "Current affairs item not found!" });
    }
    res.json({ success: true, message: "Current Affairs updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/delete-ca/:id', verifyAdminOrWorker, async (req, res) => {
  try {
    const targetId = req.params.id;
    const query = mongoose.isValidObjectId(targetId) 
      ? { $or: [{ _id: targetId }, { id: targetId }, { id: Number(targetId) || null }] } 
      : { id: isNaN(targetId) ? targetId : Number(targetId) };

    const deletedCa = await CurrentAffairs.findOneAndDelete(query);
    if (!deletedCa) {
      return res.status(404).json({ success: false, message: "Current affairs item not found!" });
    }
    res.json({ success: true, message: "Current Affairs deleted successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting current affairs!" });
  }
});

app.get('/api/ca/all', async (req, res) => {
  try {
    const news = await CurrentAffairs.find({ status: { $regex: /^(active|approved)$/i } }).sort({ _id: -1 });
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching current affairs!" });
  }
});

// 🎯 User Purchased PDFs API
app.get('/api/user/purchased-pdfs', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, message: "Email parameter required!" });
  }

  try {
    const userOrders = await Order.find({
      $or: [
        { email: email },
        { "shippingAddress.phone": email.split('@')[0] }
      ],
      status: { $not: /REFUNDED/i }
    }).sort({ createdAt: -1 });

    const purchasedIds = userOrders.map(o => o.bookId).filter(Boolean);

    const pdfDetails = await PaidPdf.find({
      $or: [
        { id: { $in: purchasedIds.map(Number).filter(n => !isNaN(n)) } },
        { _id: { $in: purchasedIds.filter(id => mongoose.isValidObjectId(id)) } }
      ]
    });

    const enrichedPurchases = userOrders.map(order => {
      const match = pdfDetails.find(p => String(p.id) === String(order.bookId) || String(p._id) === String(order.bookId));
      return {
        _id: order._id,
        orderNo: order.orderNo,
        title: order.bookTitle,
        price: order.price,
        questionPdfLink: match ? match.questionPdfLink : '',
        answerPdfLink: match ? match.answerPdfLink : '',
        date: order.createdAt
      };
    });

    res.json({
      success: true,
      purchasedIds,
      purchasedPdfs: enrichedPurchases,
      orders: userOrders
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching purchases!" });
  }
});

// 💳 Payment APIs
app.post('/api/payment/create-order', async (req, res) => {
  const targetAmount = req.body.amount || req.body.price || 5;
  const parsedAmount = Math.round(Number(targetAmount) * 100);

  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid payment amount!" });
  }

  const options = {
    amount: parsedAmount,
    currency: "INR",
    receipt: `rcpt_${Date.now()}`
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json({ success: true, orderId: order.id, amount: order.amount });
  } catch (err) {
    console.error("Razorpay Order Creation Error:", err);
    res.status(500).json({ success: false, message: "Could not create Razorpay order!" });
  }
});

app.post('/api/payment/success', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    email,
    bookId,
    bookTitle,
    price,
    orderNo,
    shippingAddress
  } = req.body;

  try {
    if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const secret = process.env.RAZORPAY_KEY_SECRET || 'WYEppsdiln4ZRRypVdqzWCCw';
      const sign = crypto
        .createHmac('sha256', secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (sign !== razorpay_signature) {
        return res.status(400).json({ success: false, message: "Invalid payment signature!" });
      }
    }

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const generatedOrderNo = orderNo || `ORD-${Date.now()}`;

    if (razorpay_payment_id) {
      const existing = await Order.findOne({ paymentId: razorpay_payment_id });
      if (existing) {
        return res.json({ success: true, message: "Order already recorded!", order: existing });
      }
    }

    const newOrder = new Order({
      orderNo: generatedOrderNo,
      email: cleanEmail,
      bookId: bookId ? String(bookId) : '',
      bookTitle: bookTitle || 'Study Material / Plan',
      price: Number(price) || 0,
      shippingAddress: shippingAddress || {},
      paymentId: razorpay_payment_id || `DIRECT-${Date.now()}`,
      orderId: razorpay_order_id || generatedOrderNo,
      status: 'PAID'
    });

    await newOrder.save();
    res.json({ success: true, message: "Order processed and saved successfully!", order: newOrder });
  } catch (err) {
    console.error("Order save error:", err);
    res.status(500).json({ success: false, message: "Error saving order details!" });
  }
});

app.post('/api/admin/refund-order', verifyAdminOrWorker, async (req, res) => {
  const { orderId, orderNo, reason } = req.body;
  try {
    const query = mongoose.isValidObjectId(orderId) 
      ? { $or: [{ _id: orderId }, { orderNo }] } 
      : { orderNo };

    const updated = await Order.findOneAndUpdate(
      query,
      {
        status: 'REFUNDED',
        refundReason: reason || 'Refund processed by administrator'
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Order not found!" });
    res.json({ success: true, message: "Payment refunded and marked successfully!", order: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/orders', verifyAdminOrWorker, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    const totalRevenue = orders
      .filter(o => !o.status?.includes('REFUNDED'))
      .reduce((sum, order) => sum + (order.price || 0), 0);

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

// 🔐 Auth APIs
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, contact, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields are required!" });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters!" });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: cleanEmail });
    if (user) {
      return res.status(400).json({ success: false, message: "This email is already registered!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user = new User({ name: name.trim(), email: cleanEmail, contact: contact ? contact.trim() : 'N/A', password: hashedPassword });
    await user.save();

    const userResponse = { name: user.name, email: user.email, contact: user.contact, role: user.role };
    res.json({ success: true, message: "Account created successfully!", user: userResponse });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error signing up!" });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required!" });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Incorrect password!" });
    }

    const userResponse = { name: user.name, email: user.email, contact: user.contact, role: user.role };
    res.json({ success: true, message: "Logged in successfully!", user: userResponse });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error logging in!" });
  }
});

// 🏠 Home Route
app.get('/', (req, res) => {
  res.send('🚀 Vaagai Tuition Backend Server Running Successfully!');
});

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "API endpoint not found!" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(500).json({ success: false, message: "Internal Server Error!" });
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}...`));
