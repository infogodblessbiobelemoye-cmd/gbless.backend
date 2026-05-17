const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gbless-secret-key-2024';

app.use(cors());
app.use(express.json());

// Simple in-memory storage (will persist during runtime)
let users = [];
let transactions = [];
let userIdCounter = 1;
let txIdCounter = 1;

// Generate account number
function genAccountNumber() {
  return 'GBL' + Date.now().toString().slice(-7) + Math.random().toString().slice(2, 4);
}

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

// ========== AUTH ROUTES ==========
app.post('/api/signup', (req, res) => {
  try {
    const { name, email, password, bankName, accountName, accountNumber } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email exists' });
    }
    
    const hashed = bcrypt.hashSync(password, 10);
    const accNum = accountNumber || genAccountNumber();
    
    const newUser = {
      id: userIdCounter++,
      name, email, password: hashed,
      bankName: bankName || 'GBLESS Bank',
      accountName: accountName || name,
      accountNumber: accNum,
      balance: 0
    };
    
    users.push(newUser);
    
    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      token,
      user: {
        id: newUser.id, name, email,
        bankName: newUser.bankName,
        accountName: newUser.accountName,
        accountNumber: accNum,
        balance: 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    
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
  const user = users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id, name: user.name, email: user.email,
    bankName: user.bankName, accountName: user.accountName,
    accountNumber: user.accountNumber, balance: user.balance
  });
});

// ========== TRANSACTIONS ==========
app.get('/api/transactions', authenticate, (req, res) => {
  const userTx = transactions
    .filter(t => t.userId === req.userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);
  res.json(userTx);
});

// Deposit
app.post('/api/deposit', authenticate, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const user = users.find(u => u.id === req.userId);
  user.balance += amount;
  
  transactions.push({
    id: txIdCounter++,
    userId: req.userId,
    type: 'deposit',
    amount,
    description: description || 'Deposit',
    date: new Date().toISOString()
  });
  
  res.json({ balance: user.balance, message: 'Deposit successful' });
});

// Withdraw
app.post('/api/withdraw', authenticate, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const user = users.find(u => u.id === req.userId);
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  user.balance -= amount;
  
  transactions.push({
    id: txIdCounter++,
    userId: req.userId,
    type: 'withdrawal',
    amount,
    description: description || 'Withdrawal',
    date: new Date().toISOString()
  });
  
  res.json({ balance: user.balance, message: 'Withdrawal successful' });
});

// Transfer
app.post('/api/transfer', authenticate, (req, res) => {
  const { toAccount, amount, description } = req.body;
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid' });
  
  const sender = users.find(u => u.id === req.userId);
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  sender.balance -= amount;
  
  transactions.push({
    id: txIdCounter++,
    userId: req.userId,
    type: 'transfer',
    amount,
    description: description || `Transfer to ${toAccount}`,
    recipient: toAccount,
    date: new Date().toISOString()
  });
  
  const recipient = users.find(u => u.accountNumber === toAccount);
  if (recipient) {
    recipient.balance += amount;
    transactions.push({
      id: txIdCounter++,
      userId: recipient.id,
      type: 'deposit',
      amount,
      description: `Received from ${sender.name}`,
      date: new Date().toISOString()
    });
  }
  
  res.json({ balance: sender.balance, message: 'Transfer successful' });
});

// Admin
app.get('/api/admin/users', authenticate, (req, res) => {
  const userList = users.map(u => ({
    id: u.id, name: u.name, email: u.email,
    bankName: u.bankName, accountName: u.accountName,
    accountNumber: u.accountNumber, balance: u.balance
  }));
  res.json(userList);
});

app.post('/api/admin/transfer', authenticate, (req, res) => {
  const { fromEmail, toEmail, amount } = req.body;
  
  const sender = users.find(u => u.email === fromEmail);
  const recipient = users.find(u => u.email === toEmail);
  
  if (!sender || !recipient) return res.status(404).json({ error: 'User not found' });
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  sender.balance -= amount;
  recipient.balance += amount;
  
  res.json({ message: 'Transfer successful' });
});

// Health check
app.get('/api', (req, res) => {
  res.json({ status: 'online', users: users.length, transactions: transactions.length });
});

app.listen(PORT, () => {
  console.log(`🏦 GBLESS Bank running on port ${PORT}`);
});
