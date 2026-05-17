const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gbless-secret-key-2024';

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const db = new Database('bank.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    bankName TEXT,
    accountName TEXT,
    accountNumber TEXT UNIQUE,
    balance REAL DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    recipient TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users (id)
  );
`);

// Auth middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Generate account number
function genAccountNumber() {
  return 'GBL' + Date.now().toString().slice(-7) + Math.random().toString().slice(2, 4);
}

// ========== AUTH ROUTES ==========

// Signup
app.post('/api/signup', (req, res) => {
  try {
    const { name, email, password, bankName, accountName, accountNumber } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Email exists' });
    
    const hashed = bcrypt.hashSync(password, 10);
    const accNum = accountNumber || genAccountNumber();
    
    const result = db.prepare(
      'INSERT INTO users (name, email, password, bankName, accountName, accountNumber) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, email, hashed, bankName, accountName, accNum);
    
    const token = jwt.sign({ id: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      token,
      user: { id: result.lastInsertRowid, name, email, bankName, accountName, accountNumber: accNum, balance: 0 }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        bankName: user.bankName, accountName: user.accountName,
        accountNumber: user.accountNumber, balance: user.balance
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== USER ROUTES ==========
app.get('/api/user', authenticate, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id, name: user.name, email: user.email,
    bankName: user.bankName, accountName: user.accountName,
    accountNumber: user.accountNumber, balance: user.balance
  });
});

// ========== TRANSACTIONS ==========
app.get('/api/transactions', authenticate, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC LIMIT 20').all(req.userId);
  res.json(tx);
});

// Deposit
app.post('/api/deposit', authenticate, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, req.userId);
  db.prepare('INSERT INTO transactions (userId, type, amount, description) VALUES (?, ?, ?, ?)').run(req.userId, 'deposit', amount, description || 'Deposit');
  
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
  res.json({ balance: user.balance, message: 'Deposit successful' });
});

// Withdraw
app.post('/api/withdraw', authenticate, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.userId);
  db.prepare('INSERT INTO transactions (userId, type, amount, description) VALUES (?, ?, ?, ?)').run(req.userId, 'withdrawal', amount, description || 'Withdrawal');
  
  const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
  res.json({ balance: updated.balance, message: 'Withdrawal successful' });
});

// Transfer
app.post('/api/transfer', authenticate, (req, res) => {
  const { toAccount, amount, description, bankName } = req.body;
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid' });
  
  const sender = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  const recipient = db.prepare('SELECT * FROM users WHERE accountNumber = ?').get(toAccount);
  
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.userId);
  db.prepare('INSERT INTO transactions (userId, type, amount, description, recipient) VALUES (?, ?, ?, ?, ?)').run(req.userId, 'transfer', amount, description || `Transfer to ${toAccount}`, toAccount);
  
  if (recipient) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, recipient.id);
    db.prepare('INSERT INTO transactions (userId, type, amount, description, recipient) VALUES (?, ?, ?, ?, ?)').run(recipient.id, 'deposit', amount, `Received from ${sender.name}`, sender.accountNumber);
  }
  
  const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
  res.json({ balance: updated.balance, message: 'Transfer successful' });
});

// Admin - all users
app.get('/api/admin/users', authenticate, (req, res) => {
  const users = db.prepare('SELECT id, name, email, bankName, accountName, accountNumber, balance FROM users').all();
  res.json(users);
});

// Admin - simulate transfer
app.post('/api/admin/transfer', authenticate, (req, res) => {
  const { fromEmail, toEmail, amount } = req.body;
  
  const sender = db.prepare('SELECT * FROM users WHERE email = ?').get(fromEmail);
  const recipient = db.prepare('SELECT * FROM users WHERE email = ?').get(toEmail);
  
  if (!sender || !recipient) return res.status(404).json({ error: 'User not found' });
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, sender.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, recipient.id);
  
  res.json({ message: 'Transfer successful' });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`🏦 GBLESS Bank running on port ${PORT}`);
});