const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET_KEY = "suhel_ai_tech_super_secret_key";

// Vercel par hard-drive me save nahi kar sakte, isliye memoryStorage use karna zaroori hai
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ==========================================
// 💽 MONGODB CONNECTION & SCHEMAS
// ==========================================

// Vercel par process.env.MONGO_URI chalega, aur testing ke liye aapka direct link chalega
const mongoURI = process.env.MONGO_URI || "mongodb+srv://suhel:ttwKpbE7MzJJtxlE@m0.u5qynox.mongodb.net/exam_server_db?appName=M0";

mongoose.connect(mongoURI)
.then(() => console.log("✅ Cloud MongoDB Connected Successfully!"))
.catch((err) => console.log("❌ MongoDB Connection Error: ", err));


// --- 1. USER SCHEMA ---
const userSchema = new mongoose.Schema({
    role: { type: String, enum: ['Teacher', 'Student', 'Admin'], required: true },
    username: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    name: { type: String, required: true },
    dob: { type: String },
    status: { type: String, enum: ['Active', 'Blocked'], default: 'Active' }
}, { timestamps: true });

// --- 2. QUESTION BANK SCHEMA (Updated) ---
const questionSchema = new mongoose.Schema({
    subject: { type: String, default: "General" },
    type: { type: String, enum: ['mcq', 'numerical'], default: 'mcq' }, // NAYA
    text: { type: String, required: true },
    options: { type: [String] }, // MCQ ke liye zaroori, numerical ke liye khali
    correct_option: { type: String, required: true }, // MCQ: A,B,C,D | Numerical: 2.5
    time_limit: { type: Number, default: 0 }
});

// --- 3. EXAM CONFIGURATION SCHEMA (Updated) ---
const examSchema = new mongoose.Schema({
    title: { type: String, required: true },
    duration_minutes: { type: Number, required: true },
    start_time: { type: Date }, 
    end_time: { type: Date },   
    result_publish_time: { type: Date }, // NAYA: Result kis time dikhana hai
    marking_scheme: {
        correct: { type: Number, default: 4 },
        wrong: { type: Number, default: 1 },
        unattempted: { type: Number, default: 0 }
    },
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } 
});


// --- 4. RESULT SCHEMA ---
const resultSchema = new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    responses: [{
        question_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
        selected_option: { type: String }
    }],
    scorecard: {
        total_score: { type: Number, default: 0 },
        correct_count: { type: Number, default: 0 },
        wrong_count: { type: Number, default: 0 },
        skipped_count: { type: Number, default: 0 }
    },
    is_submitted: { type: Boolean, default: false } 
}, { timestamps: true });

// Export Models
const User = mongoose.model('User', userSchema);
const Question = mongoose.model('Question', questionSchema);
const Exam = mongoose.model('Exam', examSchema);
const Result = mongoose.model('Result', resultSchema);

// ==========================================
// 🛡️ AUTHENTICATION MIDDLEWARE
// ==========================================
// Ye function har protected route se pehle chalega security check karne ke liye
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (!token) return res.status(401).json({ success: false, message: "Access Denied. No token provided." });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid or Expired Token." });
        req.user = user; // Har request me user ka role aur username attach ho jayega
        next();
    });
};

// ==========================================
// 🛠️ AUTO-INITIALIZE DB (Agar DB khali hai)
// ==========================================
const initializeDB = async () => {
    try {
        const adminExists = await User.findOne({ username: 'admin@college.com' });
        if (!adminExists) {
            await User.create({
                role: 'Teacher', username: 'admin@college.com',
                password_hash: await bcrypt.hash('admin123', 10), name: 'Admin Teacher'
            });
            console.log("✅ Default Admin Created (admin@college.com / admin123)");
        }

        const studentExists = await User.findOne({ username: '2025CS001' });
        if (!studentExists) {
            await User.create({
                role: 'Student', username: '2025CS001', dob: '15082005',
                password_hash: await bcrypt.hash('15082005', 10), name: 'Suhel Ansari'
            });
            console.log("✅ Default Student Created (2025CS001 / 15082005)");
        }

        const qCount = await Question.countDocuments();
        if (qCount === 0) {
            await Question.insertMany([
                { subject: "CSE", text: "What is time complexity of binary search?", options: ["O(1)", "O(n)", "O(log n)", "O(n log n)"], correct_option: "C" },
                { subject: "CSE", text: "Which language is used in Flutter?", options: ["Java", "Dart", "Python", "C++"], correct_option: "B" }
            ]);
            console.log("✅ Sample Questions Inserted");
        }
    } catch (err) { console.error("DB Init Error: ", err); }
};

// ==========================================
// 🛠️ ONE-TIME SETUP ROUTE
// ==========================================
app.get('/api/setup', async (req, res) => {
    try {
        await initializeDB(); // Vercel ab iska wait karega
        res.send("<h1>✅ Database Setup Complete!</h1><p>Admin aur Student accounts ban gaye hain. Ab aap login page par ja sakte hain.</p>");
    } catch (error) {
        res.status(500).send("❌ Setup Failed: " + error.message);
    }
});


// ==========================================
// 🔑 COMMON ROUTE: LOGIN (MongoDB Connected)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user in MongoDB
        const user = await User.findOne({ username: username });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });

        if (user.role === 'Student' && user.status === 'Blocked') {
            return res.status(403).json({ success: false, message: "Account Blocked." });
        }

        // Compare Hashed Password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) return res.status(401).json({ success: false, message: "Invalid Password" });

        // Generate JWT using MongoDB's _id
        const token = jwt.sign({ user_id: user._id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '4h' });
        
        res.json({ success: true, token, role: user.role, name: user.name, message: "Login Successful" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error during login" });
    }
});


// ==========================================
// 👨‍🏫 TEACHER / ADMIN ROUTES (100% MongoDB Powered)
// ==========================================

// 1. Bulk Upload Students (Saves to MongoDB)
app.post('/api/teacher/students/bulk-upload', authenticateToken, upload.single('file'), async (req, res) => {
    if (req.user.role !== 'Teacher') return res.status(403).json({ message: "Teacher Access Only" });

    try {
        // Real app me yahan CSV parse hoga. Abhi hum mock array use kar rahe hain format dikhane ke liye:
        const parsedStudents = [ 
            { username: "2025CS010", name: "Aman Singh", dob: "25042006" },
            { username: "2025CS011", name: "Pooja Verma", dob: "10122005" }
        ];

        let uploadedCount = 0;
        for (let student of parsedStudents) {
            const hashedPassword = await bcrypt.hash(student.dob, 10);
            
            // Upsert: Agar student pehle se hai toh update, nahi toh naya create
            await User.findOneAndUpdate(
                { username: student.username },
                { role: 'Student', name: student.name, password_hash: hashedPassword, dob: student.dob, status: "Active" },
                { upsert: true, new: true }
            );
            uploadedCount++;
        }
        res.json({ success: true, message: `${uploadedCount} Students uploaded & saved to Database.` });
    } catch (error) {
        console.error("Bulk Upload Error:", error);
        res.status(500).json({ success: false, message: "Error uploading students" });
    }
});

// 2. Configure & Save New Exam in MongoDB
app.post('/api/teacher/exam/configure', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Teacher') return res.status(403).json({ message: "Teacher Access Only" });
    
    try {
        // Frontend se aane wala data (jaise title, marks, time)
       const { title, duration_minutes, pos_marks, neg_marks, start_time, end_time, result_publish_time } = req.body;

        const newExam = new Exam({
            title: title,
            duration_minutes: duration_minutes,
            start_time: start_time ? new Date(start_time) : null, 
            end_time: end_time ? new Date(end_time) : null,
            result_publish_time: result_publish_time ? new Date(result_publish_time) : null, // NAYA
            marking_scheme: {
                correct: pos_marks || 4,
                wrong: neg_marks || 1,
                unattempted: 0
            },
            created_by: req.user.user_id 
        });
           

        await newExam.save();
        res.json({ success: true, message: "Exam Configured & Saved to Database", exam_id: newExam._id });
    } catch (error) {
        console.error("Exam Config Error:", error);
        res.status(500).json({ success: false, message: "Failed to save exam" });
    }
});

// 3. Generate Merit List (Analytics Dashboard)
app.get('/api/teacher/analytics/merit-list', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Teacher') return res.status(403).json({ message: "Teacher Access Only" });

    try {
        // MongoDB se sabhi submitted results fetch karein, aur student ka naam sath me layein (populate)
        const results = await Result.find({ is_submitted: true })
            .populate('student_id', 'name username') // Fetch student name & roll no
            .sort({ 'scorecard.total_score': -1 });  // Sort by highest score (Descending)

        // Data ko clean format me frontend ke liye bhejein
        const meritList = results.map((result, index) => ({
            rank: index + 1,
            roll_no: result.student_id.username,
            name: result.student_id.name,
            score: result.scorecard.total_score,
            correct: result.scorecard.correct_count,
            wrong: result.scorecard.wrong_count
        }));

        res.json({ success: true, meritList: meritList });
    } catch (error) {
        console.error("Merit List Error:", error);
        res.status(500).json({ success: false, message: "Failed to generate Merit List" });
    }
});

// 4. View Live Proctoring Logs (Dummy for now, normally requires Socket.io)
app.get('/api/teacher/proctoring/logs', authenticateToken, (req, res) => {
    if (req.user.role !== 'Teacher') return res.status(403).json({ message: "Teacher Access Only" });
    res.json({ success: true, logs: [] });
});
// 5. Add New Question to Bank
app.post('/api/teacher/questions/add', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Teacher') return res.status(403).json({ message: "Teacher Access Only" });
    try {
        const { type, text, options, correct_option, time_limit } = req.body;
        const newQuestion = new Question({ type, text, options, correct_option, time_limit });
        await newQuestion.save();
        res.json({ success: true, message: "Question saved successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error saving question" });
    }
});
// 6. Get Dashboard Real-time Stats
app.get('/api/teacher/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const totalStudents = await User.countDocuments({ role: 'Student' });
        const completedExams = await Result.countDocuments({ is_submitted: true });
        const activeExams = await Exam.countDocuments({ is_active: true });
        
        res.json({
            success: true,
            totalStudents,
            completedExams,
            activeExams
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Stats fetch failed" });
    }
});


// ==========================================
// 🎓 STUDENT ROUTES (Real Evaluation Engine)
// ==========================================

// 1. Fetch Exam Questions (Correct Answer Removed for Security)
app.get('/api/student/exam/questions', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') return res.status(403).json({ message: "Student Access Only" });
    try {
        const questions = await Question.find({}, '-correct_option');
        const formattedQuestions = questions.map(q => ({ id: q._id, text: q.text, options: q.options }));
        res.json({ success: true, questions: formattedQuestions });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to load questions" });
    }
});

// 2. Real Auto-Save Route (Saves directly to MongoDB)
app.post('/api/student/exam/auto-save', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') return res.status(403).json({ message: "Student Access Only" });

    const { question_id, selected_option } = req.body;
    const student_id = req.user.user_id;

    try {
        // Find an active (unsubmitted) result for this student
        let result = await Result.findOne({ student_id: student_id, is_submitted: false });

        // If no active result exists, create one and link it to a Mock Exam
        if (!result) {
            let activeExam = await Exam.findOne(); // Fetch any active exam
            if (!activeExam) activeExam = await Exam.create({ title: "B.Tech Mid-Term", duration_minutes: 60 });
            
            result = new Result({ student_id: student_id, exam_id: activeExam._id, responses: [] });
        }

        // Check if question is already answered, then update option
        const existingIndex = result.responses.findIndex(r => r.question_id.toString() === question_id);
        if (existingIndex > -1) {
            result.responses[existingIndex].selected_option = selected_option;
        } else {
            result.responses.push({ question_id, selected_option }); // Push new answer
        }

        await result.save(); // Save to DB!
        res.json({ success: true, message: "Answer auto-saved securely." });
    } catch (error) {
        console.error("Auto-save error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 3. Real Submit & Auto-Evaluate Logic
app.post('/api/student/exam/submit', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') return res.status(403).json({ message: "Student Access Only" });

    const student_id = req.user.user_id;

    try {
        // 1. Fetch Student's Saved Answers from DB
        let result = await Result.findOne({ student_id: student_id, is_submitted: false });
        if (!result) return res.status(400).json({ success: false, message: "No active exam found to submit." });

        // 2. Fetch Marking Scheme (+4, -1 rules)
        const exam = await Exam.findById(result.exam_id);
        const posMarks = exam ? exam.marking_scheme.correct : 4;
        const negMarks = exam ? exam.marking_scheme.wrong : 1;

        let marks = 0, correct = 0, wrong = 0;

      // 3. Check each response (Smart Evaluation for Numerical)
        for (let response of result.responses) {
            const question = await Question.findById(response.question_id);
            if (question) {
                let isCorrect = false;

                if (question.type === 'numerical') {
                    // Smart Check: 2.500 ko 2.5 ke barabar check karega
                    if (parseFloat(question.correct_option) === parseFloat(response.selected_option)) {
                        isCorrect = true;
                    }
                } else {
                    // MCQ Check: A, B, C, D strictly match
                    if (question.correct_option.trim().toUpperCase() === response.selected_option.trim().toUpperCase()) {
                        isCorrect = true;
                    }
                }

                if (isCorrect) {
                    marks += posMarks;
                    correct++;
                } else {
                    marks -= negMarks;
                    wrong++;
                }
            }
        }

        const totalQuestions = await Question.countDocuments();

        // 4. Generate Final Scorecard & Lock Exam
        result.scorecard = {
            total_score: marks,
            correct_count: correct,
            wrong_count: wrong,
            skipped_count: totalQuestions - (correct + wrong)
        };
        result.is_submitted = true; // Paper Locked!
        await result.save();

        // 5. Check if Result Publish Time is set in the future
        let showResultNow = true;
        let publishTimeMsg = "Available Now";
        if (exam.result_publish_time && new Date() < new Date(exam.result_publish_time)) {
            showResultNow = false;
            publishTimeMsg = new Date(exam.result_publish_time).toLocaleString();
        }

        res.json({
            success: true,
            message: "Exam Evaluated Successfully",
            show_result_now: showResultNow,
            publish_time_msg: publishTimeMsg,
            scorecard: showResultNow ? result.scorecard : null // Agar time nahi hua toh null bhejo
        });

    } catch (error) {
        console.error("Evaluation error:", error);
        res.status(500).json({ success: false, message: "Error evaluating exam" });
    }
});

// 4. Fetch Answer Key & Question Paper (Only after submission)
app.get('/api/student/exam/answer-key', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') return res.status(403).json({ message: "Student Access Only" });

    try {
        const student_id = req.user.user_id;
        
        // Check if student has actually submitted the exam
        const result = await Result.findOne({ student_id: student_id, is_submitted: true });
        if (!result) {
            return res.status(403).json({ success: false, message: "Answer Key available only after submission." });
        }

        const exam = await Exam.findById(result.exam_id);
        
        // Check if Result Time has arrived (Teacher setting)
        if (exam.result_publish_time && new Date() < new Date(exam.result_publish_time)) {
            return res.status(403).json({ success: false, message: "Answer Key is locked until Result Publish Time." });
        }

        // Fetch all questions
        const questions = await Question.find({});
        
        // Combine Questions with Student's Responses
        const answerKeyData = questions.map((q, index) => {
            const studentResponse = result.responses.find(r => r.question_id.toString() === q._id.toString());
            const selectedOpt = studentResponse ? studentResponse.selected_option : 'Not Attempted';
            
            let isCorrect = false;
            if (q.type === 'numerical') {
                isCorrect = parseFloat(q.correct_option) === parseFloat(selectedOpt);
            } else {
                isCorrect = q.correct_option === selectedOpt;
            }

            return {
                q_num: index + 1,
                text: q.text,
                options: q.options,
                correct_answer: q.correct_option,
                student_answer: selectedOpt,
                is_correct: isCorrect,
                type: q.type
            };
        });

        res.json({ success: true, answerKey: answerKeyData, examTitle: exam.title });

    } catch (error) {
        console.error("Answer Key Error:", error);
        res.status(500).json({ success: false, message: "Error loading Answer Key" });
    }
});

// ==========================================
// 🚀 SERVER START
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Unified Exam Server running on port ${PORT}`);
});

// VERCEL KE LIYE YE LINE SABSE ZAROORI HAI 👇
module.exports = app;
