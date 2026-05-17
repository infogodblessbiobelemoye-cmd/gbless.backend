const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'gbless-secret-key-2024';

app.use(cors());
app.use(express.json());

let users = [];
let transactions = [];
let uid = 1;
let tid = 1;

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

// Health check
app.get('/api', (req, res) => {
  res.json({ status: 'online', users: users.length, transactions: transactions.length });
});

// Signup
app.post('/api/signup', (req, res) => {
  const { name, email, password, bankName, accountName, accountNumber } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
  
  const hashed = bcrypt.hashSync(password, 10);
  const newUser = {
    id: uid++,
    name,
    email,
    password: hashed,
    bankName: bankName || 'GBLESS Bank',
    accountName: accountName || name,
    accountNumber: accountNumber || Math.floor(1000000000 + Math.random() * 9000000000).toString(),
    balance: 0
  };
  
  users.push(newUser);
  const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token,
    user: {
      id: newUser.id, name: newUser.name, email: newUser.email,
      bankName: newUser.bankName, accountName: newUser.accountName,
      accountNumber: newUser.accountNumber, balance: newUser.balance
    }
  });
});

// Login
app.post('/api/login', (req, res) => {
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
});

// Get user
app.get('/api/user', auth, (req, res) => {
  const user = users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id, name: user.name, email: user.email,
    bankName: user.bankName, accountName: user.accountName,
    accountNumber: user.accountNumber, balance: user.balance
  });
});

// Get transactions
app.get('/api/transactions', auth, (req, res) => {
  const tx = transactions
    .filter(t => t.userId === req.userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);
  res.json(tx);
});

// Deposit
app.post('/api/deposit', auth, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const user = users.find(u => u.id === req.userId);
  user.balance += amount;
  
  transactions.push({
    id: tid++, userId: req.userId, type: 'deposit',
    amount, description: 'Funds Added', date: new Date().toISOString()
  });
  
  res.json({ balance: user.balance, message: 'Deposit successful' });
});

// Withdraw
app.post('/api/withdraw', auth, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const user = users.find(u => u.id === req.userId);
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  user.balance -= amount;
  
  transactions.push({
    id: tid++, userId: req.userId, type: 'withdrawal',
    amount, description: 'Funds Withdrawn', date: new Date().toISOString()
  });
  
  res.json({ balance: user.balance, message: 'Withdrawal successful' });
});

// Transfer
app.post('/api/transfer', auth, (req, res) => {
  const { toAccount, amount } = req.body;
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid' });
  
  const sender = users.find(u => u.id === req.userId);
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  sender.balance -= amount;
  
  transactions.push({
    id: tid++, userId: req.userId, type: 'transfer',
    amount, description: 'Transfer to ' + toAccount,
    recipient: toAccount, date: new Date().toISOString()
  });
  
  const recipient = users.find(u => u.accountNumber === toAccount);
  if (recipient) {
    recipient.balance += amount;
    transactions.push({
      id: tid++, userId: recipient.id, type: 'deposit',
      amount, description: 'Received from ' + sender.name,
      date: new Date().toISOString()
    });
  }
  
  res.json({ balance: sender.balance, message: 'Transfer successful' });
});

// Admin - Get all users
app.get('/api/admin/users', auth, (req, res) => {
  const list = users.map(u => ({
    id: u.id, name: u.name, email: u.email,
    bankName: u.bankName, accountName: u.accountName,
    accountNumber: u.accountNumber, balance: u.balance
  }));
  res.json(list);
});

// Admin - Generate funds (add money from nowhere)
app.post('/api/admin/generate', auth, (req, res) => {
  const { email, amount } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  user.balance += amount;
  
  transactions.push({
    id: tid++, userId: user.id, type: 'deposit',
    amount, description: 'Admin generated funds',
    date: new Date().toISOString()
  });
  
  res.json({ message: 'Funds generated', balance: user.balance });
});

app.listen(PORT, () => {
  console.log('GBLESS Bank running on port ' + PORT);
});
