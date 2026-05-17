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

// Auth middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Health check
app.get('/api', (req, res) => {
  res.json({ status: 'online', bank: 'GBLESS Trust Bank', users: users.length });
});

// ========== AUTH ==========
app.post('/api/signup', (req, res) => {
  const { name, email, password, bankName, accountName, accountNumber } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
  
  const hashed = bcrypt.hashSync(password, 10);
  const newUser = {
    id: uid++,
    name, email, password: hashed,
    bankName: bankName || 'GBLESS Trust Bank',
    accountName: accountName || name,
    accountNumber: accountNumber || Math.floor(1000000000 + Math.random() * 9000000000).toString(),
    balance: 0
  };
  users.push(newUser);
  
  const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, name, email, bankName: newUser.bankName, accountName: newUser.accountName, accountNumber: newUser.accountNumber, balance: 0 } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, bankName: user.bankName, accountName: user.accountName, accountNumber: user.accountNumber, balance: user.balance } });
});

// ========== USER ==========
app.get('/api/user', authenticate, (req, res) => {
  const user = users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, name: user.name, email: user.email, bankName: user.bankName, accountName: user.accountName, accountNumber: user.accountNumber, balance: user.balance });
});

// ========== TRANSACTIONS ==========
app.get('/api/transactions', authenticate, (req, res) => {
  const userTx = transactions.filter(t => t.userId === req.userId).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
  res.json(userTx);
});

// ========== WITHDRAW ==========
app.post('/api/withdraw', authenticate, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const user = users.find(u => u.id === req.userId);
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  user.balance -= parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'withdrawal', amount: parseFloat(amount), description: 'Withdrawal', date: new Date().toISOString() });
  res.json({ balance: user.balance, message: 'Withdrawal successful' });
});

// ========== TRANSFER ==========
app.post('/api/transfer', authenticate, (req, res) => {
  const { toAccount, amount, bankName } = req.body;
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid transfer details' });
  
  const sender = users.find(u => u.id === req.userId);
  if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  sender.balance -= parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'transfer', amount: parseFloat(amount), description: `Transfer to ${toAccount}`, recipient: toAccount, bankName, date: new Date().toISOString() });
  
  const recipient = users.find(u => u.accountNumber === toAccount);
  if (recipient) {
    recipient.balance += parseFloat(amount);
    transactions.push({ id: tid++, userId: recipient.id, type: 'deposit', amount: parseFloat(amount), description: `Received from ${sender.name}`, date: new Date().toISOString() });
  }
  
  res.json({ balance: sender.balance, message: 'Transfer successful' });
});

// ========== LOAN ==========
app.post('/api/loan', authenticate, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum loan is $100' });
  if (amount > 50000) return res.status(400).json({ error: 'Maximum loan is $50,000' });
  
  const user = users.find(u => u.id === req.userId);
  user.balance += parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'deposit', amount: parseFloat(amount), description: 'Loan Approved', date: new Date().toISOString() });
  res.json({ balance: user.balance, message: 'Loan approved' });
});

// ========== ADMIN ==========
app.get('/api/admin/users', authenticate, (req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, bankName: u.bankName, accountName: u.accountName, accountNumber: u.accountNumber, balance: u.balance })));
});

app.post('/api/admin/generate', authenticate, (req, res) => {
  const { email, amount } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balance += parseFloat(amount);
  transactions.push({ id: tid++, userId: user.id, type: 'deposit', amount: parseFloat(amount), description: 'Admin generated funds', date: new Date().toISOString() });
  res.json({ balance: user.balance, message: 'Funds generated' });
});

app.listen(PORT, () => {
  console.log(`🏦 GBLESS Trust Bank running on port ${PORT}`);
});
