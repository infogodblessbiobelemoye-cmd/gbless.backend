const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const SibApiV3Sdk = require('sib-api-v3-sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'gbless-secret-key-2024';

// Brevo Setup
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const transactionalEmailsApi = new SibApiV3Sdk.TransactionalEmailsApi();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

let users = [];
let transactions = [];
let chatMessages = [];
let withdrawalCodes = [];
let uid = 1;
let tid = 1;
let cid = 1;

function generateWithdrawalCodes() {
  return [
    { code: 'WTX-ALPHA-8821', name: 'Wire Transfer Authorization', used: false },
    { code: 'SWC-BRAVO-7743', name: 'Swift Clearance Certificate', used: false },
    { code: 'RTC-CHARLIE-6639', name: 'Release Transaction Confirmation', used: false },
    { code: 'VRC-DELTA-5512', name: 'Verification Release Code', used: false },
    { code: 'ATC-ECHO-4478', name: 'Authorization Transfer Clearance', used: false },
    { code: 'CSC-FOXTROT-3365', name: 'Central Security Clearance', used: false },
    { code: 'APC-GOLF-2291', name: 'Approval Processing Certificate', used: false }
  ];
}
withdrawalCodes = generateWithdrawalCodes();

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  const user = users.find(u => u.id === req.userId);
  if (!user || user.email !== 'admin@gbless.com') return res.status(403).json({ error: 'Admin only' });
  next();
}

async function sendEmail(to, subject, html) {
  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { name: 'GBLESS Trust Bank', email: 'infogodblessbiobelemoye@gmail.com' };
    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    await transactionalEmailsApi.sendTransacEmail(sendSmtpEmail);
    console.log('Email sent to:', to);
  } catch (e) {
    console.log('Email error:', e.message);
  }
}

// Health check
app.get('/api', (req, res) => {
  res.json({ status: 'online', bank: 'GBLESS Trust Bank', users: users.length });
});

// ========== SIGNUP ==========
app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
  
  const verificationPin = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedPassword = bcrypt.hashSync(password, 10);
  const hashedPin = bcrypt.hashSync(verificationPin, 10);
  
  const newUser = {
    id: uid++, name, email, password: hashedPassword,
    bankName: 'GBLESS Trust Bank', accountName: name,
    accountNumber: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
    balance: 0, pin: hashedPin, pinAttempts: 0, pinLocked: false,
    verified: false, verificationPin: hashedPin
  };
  users.push(newUser);
  
  sendEmail(email, 'GBLESS Trust Bank - Verification PIN', `
    <div style="background:#0d1117;color:#c9d1d9;padding:30px;font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1f6feb;">GBLESS TRUST BANK</h2><hr style="border-color:#21262d;">
      <h3 style="color:#f0f6fc;">Account Verification</h3>
      <p>Hello ${name},</p>
      <p>Your verification PIN is:</p>
      <div style="background:#161b22;padding:20px;border-radius:8px;margin:15px 0;text-align:center;">
        <h1 style="color:#1f6feb;font-size:36px;letter-spacing:10px;margin:0;">${verificationPin}</h1>
      </div>
      <p style="color:#8b949e;font-size:12px;">© 2024 GBLESS Trust Bank</p>
    </div>
  `);
  
  const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, name, email, accountNumber: newUser.accountNumber, balance: 0, verified: false } });
});

// ========== VERIFY ACCOUNT ==========
app.post('/api/verify-account', authenticate, (req, res) => {
  const { pin } = req.body;
  const user = users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.verified) return res.status(400).json({ error: 'Already verified' });
  if (!bcrypt.compareSync(pin, user.verificationPin)) return res.status(400).json({ error: 'Invalid PIN' });
  user.verified = true;
  res.json({ success: true, message: 'Account verified!' });
});

// ========== LOGIN ==========
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.verified) return res.status(403).json({ error: 'Account not verified. Check your email.' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, accountNumber: user.accountNumber, balance: user.balance } });
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

// ========== TRANSFER ==========
app.post('/api/transfer', authenticate, (req, res) => {
  const { toAccount, amount, bankName, pin } = req.body;
  const user = users.find(u => u.id === req.userId);
  if (!pin || !bcrypt.compareSync(pin, user.pin)) return res.status(400).json({ error: 'Invalid PIN' });
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid transfer' });
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  
  user.balance -= parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'transfer', amount: parseFloat(amount), description: `Transfer to ${toAccount}`, recipient: toAccount, bankName, date: new Date().toISOString() });
  
  const recipient = users.find(u => u.accountNumber === toAccount);
  if (recipient) {
    recipient.balance += parseFloat(amount);
    transactions.push({ id: tid++, userId: recipient.id, type: 'deposit', amount: parseFloat(amount), description: `Received from ${user.name}`, date: new Date().toISOString() });
  }
  
  sendEmail(user.email, 'GBLESS Trust Bank - Debit Alert', `
    <div style="background:#0d1117;color:#c9d1d9;padding:30px;font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1f6feb;">GBLESS TRUST BANK</h2><hr style="border-color:#21262d;">
      <h3 style="color:#f85149;">Debit Alert: -$${amount.toFixed(2)}</h3>
      <div style="background:#161b22;padding:15px;border-radius:8px;margin:15px 0;">
        <p><strong>To:</strong> ${bankName} - ${toAccount}</p>
        <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Balance:</strong> $${user.balance.toFixed(2)}</p>
      </div>
    </div>
  `);
  
  res.json({ balance: user.balance, message: 'Transfer successful' });
});

// ========== WITHDRAW ==========
app.post('/api/withdraw', authenticate, (req, res) => {
  const { amount, bankName, accountName, accountNumber, pin, withdrawalCode } = req.body;
  const user = users.find(u => u.id === req.userId);
  
  if (!pin || !bcrypt.compareSync(pin, user.pin)) return res.status(400).json({ error: 'Invalid PIN' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds' });
  if (!bankName || !accountName || !accountNumber) return res.status(400).json({ error: 'Missing bank details' });
  
  if (!withdrawalCode) {
    return res.status(403).json({ error: 'AUTHORIZATION REQUIRED', message: 'Contact customer care for withdrawal code.', action: 'contact_support' });
  }
  
  const code = withdrawalCodes.find(c => c.code === withdrawalCode && !c.used);
  if (!code) return res.status(403).json({ error: 'Invalid or used code' });
  
  code.used = true;
  user.balance -= parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'withdrawal', amount: parseFloat(amount), description: `Withdrawal to ${bankName}`, date: new Date().toISOString() });
  
  sendEmail(user.email, 'GBLESS Trust Bank - Withdrawal Confirmed', `
    <div style="background:#0d1117;color:#c9d1d9;padding:30px;font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1f6feb;">GBLESS TRUST BANK</h2><hr style="border-color:#21262d;">
      <h3 style="color:#f85149;">Withdrawal: -$${amount.toFixed(2)}</h3>
      <div style="background:#161b22;padding:15px;border-radius:8px;margin:15px 0;">
        <p><strong>To:</strong> ${bankName} - ${accountNumber}</p>
        <p><strong>Account:</strong> ${accountName}</p>
        <p><strong>Balance:</strong> $${user.balance.toFixed(2)}</p>
      </div>
    </div>
  `);
  
  res.json({ balance: user.balance, message: 'Withdrawal successful' });
});

// ========== LOAN ==========
app.post('/api/loan', authenticate, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum $100' });
  if (amount > 50000) return res.status(400).json({ error: 'Maximum $50,000' });
  const user = users.find(u => u.id === req.userId);
  user.balance += parseFloat(amount);
  transactions.push({ id: tid++, userId: req.userId, type: 'deposit', amount: parseFloat(amount), description: 'Loan Approved', date: new Date().toISOString() });
  res.json({ balance: user.balance, message: 'Loan approved' });
});

// ========== CHAT ==========
app.get('/api/chat', authenticate, (req, res) => {
  const userChats = chatMessages.filter(m => m.userId === req.userId || m.toUserId === req.userId);
  res.json(userChats);
});

app.post('/api/chat', authenticate, (req, res) => {
  const { message } = req.body;
  const user = users.find(u => u.id === req.userId);
  chatMessages.push({ id: cid++, userId: req.userId, name: user.name, message, isAdmin: false, date: new Date().toISOString() });
  res.json({ success: true });
});

app.get('/api/admin/chat', authenticate, adminOnly, (req, res) => {
  res.json(chatMessages);
});

app.post('/api/admin/chat/reply', authenticate, adminOnly, (req, res) => {
  const { userId, message } = req.body;
  chatMessages.push({ id: cid++, userId: parseInt(userId), toUserId: parseInt(userId), name: 'Customer Care', message, isAdmin: true, date: new Date().toISOString() });
  res.json({ success: true });
});

// ========== ADMIN ==========
app.get('/api/admin/users', authenticate, adminOnly, (req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, accountNumber: u.accountNumber, balance: u.balance, verified: u.verified })));
});

app.post('/api/admin/generate', authenticate, adminOnly, (req, res) => {
  const { email, amount } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balance += parseFloat(amount);
  transactions.push({ id: tid++, userId: user.id, type: 'deposit', amount: parseFloat(amount), description: 'Corporate Payment', date: new Date().toISOString() });
  
  sendEmail(user.email, 'GBLESS Trust Bank - Credit Alert', `
    <div style="background:#0d1117;color:#c9d1d9;padding:30px;font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1f6feb;">GBLESS TRUST BANK</h2><hr style="border-color:#21262d;">
      <h3 style="color:#3fb950;">Credit Alert: +$${amount.toFixed(2)}</h3>
      <div style="background:#161b22;padding:15px;border-radius:8px;margin:15px 0;">
        <p><strong>Sender:</strong> Corporate Payment</p>
        <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Balance:</strong> $${user.balance.toFixed(2)}</p>
      </div>
    </div>
  `);
  
  res.json({ balance: user.balance, message: 'Funds generated' });
});

app.get('/api/admin/codes', authenticate, adminOnly, (req, res) => {
  res.json(withdrawalCodes);
});

app.post('/api/admin/codes/reset', authenticate, adminOnly, (req, res) => {
  withdrawalCodes = generateWithdrawalCodes();
  res.json({ codes: withdrawalCodes, message: 'Codes reset' });
});

app.listen(PORT, () => {
  console.log(`🏦 GBLESS Trust Bank running on port ${PORT}`);
});
