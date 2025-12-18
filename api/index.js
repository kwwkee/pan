// api/index.js - Vercel Serverless API для L1GA PASS
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Используем Vercel KV для хранения (временно используем in-memory)
// В продакшене лучше подключить Vercel KV или другую БД
let storage = {
    users: {},
    tasks: [],
    codes: {},
    shop: [],
    news: [],
    submissions: []
};

// === ПОЛЬЗОВАТЕЛИ ===

app.get('/api/user/:telegramId', (req, res) => {
    const user = storage.users[req.params.telegramId];
    
    if (!user) {
        return res.json({ exists: false });
    }
    
    res.json({ exists: true, user });
});

app.post('/api/user/create', (req, res) => {
    const { telegramId, nickname, firstName, lastName, username } = req.body;
    
    if (storage.users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    
    storage.users[telegramId] = {
        telegramId,
        nickname,
        firstName: firstName || '',
        lastName: lastName || '',
        username: username || '',
        balance: 0,
        purchases: [],
        createdAt: new Date().toISOString()
    };
    
    res.json({ success: true, user: storage.users[telegramId] });
});

app.post('/api/user/update', (req, res) => {
    const { telegramId, balance } = req.body;
    
    if (!storage.users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (balance !== undefined) storage.users[telegramId].balance = balance;
    
    res.json({ success: true, user: storage.users[telegramId] });
});

app.get('/api/users/all', (req, res) => {
    res.json({ users: storage.users });
});

// === ЗАДАНИЯ ===

app.get('/api/tasks', (req, res) => {
    res.json({ tasks: storage.tasks });
});

app.post('/api/task/create', (req, res) => {
    const { title, description, reward, category, icon } = req.body;
    
    const newTask = {
        id: `task_${Date.now()}`,
        title,
        description,
        reward,
        category,
        icon: icon || '🎮',
        createdAt: new Date().toISOString()
    };
    
    storage.tasks.push(newTask);
    res.json({ success: true, task: newTask });
});

app.delete('/api/task/:taskId', (req, res) => {
    storage.tasks = storage.tasks.filter(t => t.id !== req.params.taskId);
    res.json({ success: true });
});

// === ЗАДАНИЯ ПОЛЬЗОВАТЕЛЕЙ ===

app.get('/api/user/:telegramId/tasks', (req, res) => {
    const userTasks = storage[`user_tasks_${req.params.telegramId}`] || {};
    res.json({ tasks: userTasks });
});

app.post('/api/user/task/accept', (req, res) => {
    const { telegramId, taskId } = req.body;
    const key = `user_tasks_${telegramId}`;
    
    if (!storage[key]) storage[key] = {};
    
    storage[key][taskId] = {
        status: 'pending',
        acceptedAt: new Date().toISOString()
    };
    
    res.json({ success: true });
});

app.post('/api/user/task/submit', (req, res) => {
    const { telegramId, taskId, photo } = req.body;
    const key = `user_tasks_${telegramId}`;
    
    if (!storage[key]) storage[key] = {};
    
    storage[key][taskId] = {
        ...storage[key][taskId],
        status: 'checking',
        photo,
        submittedAt: new Date().toISOString()
    };
    
    // Добавляем в очередь на проверку
    storage.submissions.push({
        userId: telegramId,
        taskId,
        photo,
        userData: storage.users[telegramId],
        taskData: storage.tasks.find(t => t.id === taskId),
        submittedAt: new Date().toISOString()
    });
    
    res.json({ success: true });
});

// === ПРОВЕРКА ЗАДАНИЙ (АДМИН) ===

app.get('/api/submissions', (req, res) => {
    const pending = storage.submissions.filter(s => !s.approved && !s.rejected);
    res.json({ submissions: pending });
});

app.post('/api/submission/approve', (req, res) => {
    const { userId, taskId, reward } = req.body;
    const key = `user_tasks_${userId}`;
    
    // Обновляем статус задания
    if (storage[key] && storage[key][taskId]) {
        storage[key][taskId].status = 'completed';
    }
    
    // Начисляем награду
    if (storage.users[userId]) {
        storage.users[userId].balance += reward;
    }
    
    // Помечаем submission как одобренную
    const submission = storage.submissions.find(s => s.userId === userId && s.taskId === taskId);
    if (submission) {
        submission.approved = true;
        submission.approvedAt = new Date().toISOString();
    }
    
    res.json({ success: true });
});

app.post('/api/submission/reject', (req, res) => {
    const { userId, taskId } = req.body;
    const key = `user_tasks_${userId}`;
    
    // Возвращаем статус в pending
    if (storage[key] && storage[key][taskId]) {
        storage[key][taskId].status = 'pending';
    }
    
    // Помечаем submission как отклоненную
    const submission = storage.submissions.find(s => s.userId === userId && s.taskId === taskId);
    if (submission) {
        submission.rejected = true;
        submission.rejectedAt = new Date().toISOString();
    }
    
    res.json({ success: true });
});

// === ПРОМОКОДЫ ===

app.get('/api/codes', (req, res) => {
    res.json({ codes: storage.codes });
});

app.post('/api/code/create', (req, res) => {
    const { code, reward } = req.body;
    
    storage.codes[code.toUpperCase()] = {
        code: code.toUpperCase(),
        reward,
        used: [],
        createdAt: new Date().toISOString()
    };
    
    res.json({ success: true });
});

app.post('/api/code/activate', (req, res) => {
    const { code, telegramId } = req.body;
    const codeData = storage.codes[code.toUpperCase()];
    
    if (!codeData) {
        return res.json({ success: false, error: 'Неверный код' });
    }
    
    if (codeData.used.includes(telegramId)) {
        return res.json({ success: false, error: 'Код уже использован' });
    }
    
    // Начисляем награду
    if (storage.users[telegramId]) {
        storage.users[telegramId].balance += codeData.reward;
    }
    
    // Помечаем код как использованный
    codeData.used.push(telegramId);
    
    res.json({ success: true, reward: codeData.reward });
});

app.delete('/api/code/:code', (req, res) => {
    delete storage.codes[req.params.code.toUpperCase()];
    res.json({ success: true });
});

// === МАГАЗИН ===

app.get('/api/shop', (req, res) => {
    res.json({ items: storage.shop });
});

app.post('/api/shop/create', (req, res) => {
    const { title, description, price, icon } = req.body;
    
    const newItem = {
        id: `shop_${Date.now()}`,
        title,
        description,
        price,
        icon: icon || '🎁',
        createdAt: new Date().toISOString()
    };
    
    storage.shop.push(newItem);
    res.json({ success: true, item: newItem });
});

app.post('/api/shop/buy', (req, res) => {
    const { telegramId, itemId, price } = req.body;
    
    if (!storage.users[telegramId]) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (storage.users[telegramId].balance < price) {
        return res.json({ success: false, error: 'Недостаточно монет' });
    }
    
    storage.users[telegramId].balance -= price;
    storage.users[telegramId].purchases = storage.users[telegramId].purchases || [];
    storage.users[telegramId].purchases.push({
        itemId,
        purchasedAt: new Date().toISOString()
    });
    
    res.json({ success: true });
});

app.delete('/api/shop/:itemId', (req, res) => {
    storage.shop = storage.shop.filter(i => i.id !== req.params.itemId);
    res.json({ success: true });
});

// === НОВОСТИ ===

app.get('/api/news', (req, res) => {
    res.json({ news: storage.news });
});

app.post('/api/news/create', (req, res) => {
    const { title, content } = req.body;
    
    const newNews = {
        id: `news_${Date.now()}`,
        title,
        content,
        date: new Date().toISOString()
    };
    
    storage.news.push(newNews);
    res.json({ success: true, news: newNews });
});

app.delete('/api/news/:newsId', (req, res) => {
    storage.news = storage.news.filter(n => n.id !== req.params.newsId);
    res.json({ success: true });
});

// Health check
app.get('/api', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'L1GA PASS API Server',
        version: '1.0.0'
    });
});

// Export для Vercel
module.exports = app;
