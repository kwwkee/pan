// server.js - API сервер для L1GA PASS
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({limit: '50mb'}));

// База данных (JSON файлы)
const DB_PATH = path.join(__dirname, 'data');

// Создаём папку data если её нет
if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH);
}

// Вспомогательные функции
function readDB(filename) {
    const filePath = path.join(DB_PATH, filename);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeDB(filename, data) {
    const filePath = path.join(DB_PATH, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// === ПОЛЬЗОВАТЕЛИ ===

app.get('/api/user/:telegramId', (req, res) => {
    const users = readDB('users.json') || {};
    const user = users[req.params.telegramId];
    
    if (!user) {
        return res.json({ exists: false });
    }
    
    res.json({ exists: true, user });
});

app.post('/api/user/create', (req, res) => {
    const { telegramId, nickname, firstName, lastName, username } = req.body;
    const users = readDB('users.json') || {};
    
    if (users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    
    users[telegramId] = {
        telegramId,
        nickname,
        firstName: firstName || '',
        lastName: lastName || '',
        username: username || '',
        balance: 0,
        purchases: [],
        createdAt: new Date().toISOString()
    };
    
    writeDB('users.json', users);
    res.json({ success: true, user: users[telegramId] });
});

app.post('/api/user/update', (req, res) => {
    const { telegramId, balance } = req.body;
    const users = readDB('users.json') || {};
    
    if (!users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (balance !== undefined) users[telegramId].balance = balance;
    
    writeDB('users.json', users);
    res.json({ success: true, user: users[telegramId] });
});

app.get('/api/users/all', (req, res) => {
    const users = readDB('users.json') || {};
    res.json({ users });
});

// === ЗАДАНИЯ ===

app.get('/api/tasks', (req, res) => {
    const tasks = readDB('tasks.json') || [];
    res.json({ tasks });
});

app.post('/api/task/create', (req, res) => {
    const { title, description, reward, category, icon } = req.body;
    const tasks = readDB('tasks.json') || [];
    
    const newTask = {
        id: `task_${Date.now()}`,
        title,
        description,
        reward,
        category,
        icon: icon || '🎮',
        createdAt: new Date().toISOString()
    };
    
    tasks.push(newTask);
    writeDB('tasks.json', tasks);
    res.json({ success: true, task: newTask });
});

app.delete('/api/task/:taskId', (req, res) => {
    const tasks = readDB('tasks.json') || [];
    const filtered = tasks.filter(t => t.id !== req.params.taskId);
    writeDB('tasks.json', filtered);
    res.json({ success: true });
});

// === ЗАДАНИЯ ПОЛЬЗОВАТЕЛЕЙ ===

app.get('/api/user/:telegramId/tasks', (req, res) => {
    const userTasks = readDB(`user_tasks_${req.params.telegramId}.json`) || {};
    res.json({ tasks: userTasks });
});

app.post('/api/user/task/accept', (req, res) => {
    const { telegramId, taskId } = req.body;
    const userTasks = readDB(`user_tasks_${telegramId}.json`) || {};
    
    userTasks[taskId] = {
        status: 'pending',
        acceptedAt: new Date().toISOString()
    };
    
    writeDB(`user_tasks_${telegramId}.json`, userTasks);
    res.json({ success: true });
});

app.post('/api/user/task/submit', (req, res) => {
    const { telegramId, taskId, photo } = req.body;
    const userTasks = readDB(`user_tasks_${telegramId}.json`) || {};
    
    userTasks[taskId] = {
        ...userTasks[taskId],
        status: 'checking',
        photo,
        submittedAt: new Date().toISOString()
    };
    
    writeDB(`user_tasks_${telegramId}.json`, userTasks);
    
    // Добавляем в очередь на проверку
    const submissions = readDB('submissions.json') || [];
    const users = readDB('users.json') || {};
    const tasks = readDB('tasks.json') || [];
    
    submissions.push({
        userId: telegramId,
        taskId,
        photo,
        userData: users[telegramId],
        taskData: tasks.find(t => t.id === taskId),
        submittedAt: new Date().toISOString()
    });
    
    writeDB('submissions.json', submissions);
    res.json({ success: true });
});

// === ПРОВЕРКА ЗАДАНИЙ (АДМИН) ===

app.get('/api/submissions', (req, res) => {
    const submissions = readDB('submissions.json') || [];
    const pending = submissions.filter(s => !s.approved && !s.rejected);
    res.json({ submissions: pending });
});

app.post('/api/submission/approve', (req, res) => {
    const { userId, taskId, reward } = req.body;
    
    // Обновляем статус задания
    const userTasks = readDB(`user_tasks_${userId}.json`) || {};
    if (userTasks[taskId]) {
        userTasks[taskId].status = 'completed';
        writeDB(`user_tasks_${userId}.json`, userTasks);
    }
    
    // Начисляем награду
    const users = readDB('users.json') || {};
    if (users[userId]) {
        users[userId].balance += reward;
        writeDB('users.json', users);
    }
    
    // Помечаем submission как одобренную
    const submissions = readDB('submissions.json') || [];
    const submission = submissions.find(s => s.userId === userId && s.taskId === taskId);
    if (submission) {
        submission.approved = true;
        submission.approvedAt = new Date().toISOString();
        writeDB('submissions.json', submissions);
    }
    
    res.json({ success: true });
});

app.post('/api/submission/reject', (req, res) => {
    const { userId, taskId } = req.body;
    
    // Возвращаем статус в pending
    const userTasks = readDB(`user_tasks_${userId}.json`) || {};
    if (userTasks[taskId]) {
        userTasks[taskId].status = 'pending';
        writeDB(`user_tasks_${userId}.json`, userTasks);
    }
    
    // Помечаем submission как отклоненную
    const submissions = readDB('submissions.json') || [];
    const submission = submissions.find(s => s.userId === userId && s.taskId === taskId);
    if (submission) {
        submission.rejected = true;
        submission.rejectedAt = new Date().toISOString();
        writeDB('submissions.json', submissions);
    }
    
    res.json({ success: true });
});

// === ПРОМОКОДЫ ===

app.get('/api/codes', (req, res) => {
    const codes = readDB('codes.json') || {};
    res.json({ codes });
});

app.post('/api/code/create', (req, res) => {
    const { code, reward } = req.body;
    const codes = readDB('codes.json') || {};
    
    codes[code.toUpperCase()] = {
        code: code.toUpperCase(),
        reward,
        used: [],
        createdAt: new Date().toISOString()
    };
    
    writeDB('codes.json', codes);
    res.json({ success: true });
});

app.post('/api/code/activate', (req, res) => {
    const { code, telegramId } = req.body;
    const codes = readDB('codes.json') || {};
    const codeData = codes[code.toUpperCase()];
    
    if (!codeData) {
        return res.json({ success: false, error: 'Неверный код' });
    }
    
    if (codeData.used.includes(telegramId)) {
        return res.json({ success: false, error: 'Код уже использован' });
    }
    
    // Начисляем награду
    const users = readDB('users.json') || {};
    if (users[telegramId]) {
        users[telegramId].balance += codeData.reward;
        writeDB('users.json', users);
    }
    
    // Помечаем код как использованный
    codeData.used.push(telegramId);
    codes[code.toUpperCase()] = codeData;
    writeDB('codes.json', codes);
    
    res.json({ success: true, reward: codeData.reward });
});

app.delete('/api/code/:code', (req, res) => {
    const codes = readDB('codes.json') || {};
    delete codes[req.params.code.toUpperCase()];
    writeDB('codes.json', codes);
    res.json({ success: true });
});

// === МАГАЗИН ===

app.get('/api/shop', (req, res) => {
    const items = readDB('shop.json') || [];
    res.json({ items });
});

app.post('/api/shop/create', (req, res) => {
    const { title, description, price, icon } = req.body;
    const items = readDB('shop.json') || [];
    
    const newItem = {
        id: `shop_${Date.now()}`,
        title,
        description,
        price,
        icon: icon || '🎁',
        createdAt: new Date().toISOString()
    };
    
    items.push(newItem);
    writeDB('shop.json', items);
    res.json({ success: true, item: newItem });
});

app.post('/api/shop/buy', (req, res) => {
    const { telegramId, itemId, price } = req.body;
    const users = readDB('users.json') || {};
    
    if (!users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (users[telegramId].balance < price) {
        return res.json({ success: false, error: 'Недостаточно монет' });
    }
    
    users[telegramId].balance -= price;
    users[telegramId].purchases = users[telegramId].purchases || [];
    users[telegramId].purchases.push({
        itemId,
        purchasedAt: new Date().toISOString()
    });
    
    writeDB('users.json', users);
    res.json({ success: true });
});

app.delete('/api/shop/:itemId', (req, res) => {
    const items = readDB('shop.json') || [];
    const filtered = items.filter(i => i.id !== req.params.itemId);
    writeDB('shop.json', filtered);
    res.json({ success: true });
});

// === НОВОСТИ ===

app.get('/api/news', (req, res) => {
    const news = readDB('news.json') || [];
    res.json({ news });
});

app.post('/api/news/create', (req, res) => {
    const { title, content } = req.body;
    const news = readDB('news.json') || [];
    
    const newNews = {
        id: `news_${Date.now()}`,
        title,
        content,
        date: new Date().toISOString()
    };
    
    news.push(newNews);
    writeDB('news.json', news);
    res.json({ success: true, news: newNews });
});

app.delete('/api/news/:newsId', (req, res) => {
    const news = readDB('news.json') || [];
    const filtered = news.filter(n => n.id !== req.params.newsId);
    writeDB('news.json', filtered);
    res.json({ success: true });
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'L1GA PASS API Server',
        version: '1.0.0'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 API сервер запущен на порту ${PORT}`);
});