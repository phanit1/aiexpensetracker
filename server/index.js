import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: process.env.VERCEL ? 1 : 10, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const demoUsers = new Map();
const demoData = new Map();
const defaults = [
  ['Salary', 'income', 'Briefcase', '#10b981'], ['Freelance', 'income', 'Laptop', '#06b6d4'], ['Investments', 'income', 'TrendingUp', '#8b5cf6'], ['Gifts', 'income', 'Gift', '#f59e0b'], ['Other Income', 'income', 'CirclePlus', '#3b82f6'],
  ['Food & Dining', 'expense', 'Utensils', '#f97316'], ['Groceries', 'expense', 'ShoppingCart', '#eab308'], ['Rent', 'expense', 'House', '#ef476f'], ['Transportation', 'expense', 'Car', '#f97316'], ['Shopping', 'expense', 'ShoppingBag', '#8b5cf6'], ['Utilities', 'expense', 'Zap', '#ec4899'], ['Healthcare', 'expense', 'Heart', '#3b82f6'], ['Entertainment', 'expense', 'Film', '#a855f7'], ['Travel', 'expense', 'Plane', '#fb923c'], ['Education', 'expense', 'BookOpen', '#6366f1'], ['Personal Care', 'expense', 'Sparkles', '#d946ef'], ['Other Expense', 'expense', 'Ellipsis', '#64748b'],
];
const sample = (userId) => {
  const cats = defaults.map(([name, type, icon, color], i) => ({ id: `${userId}-c${i + 1}`, name, type, icon, color, is_default: true }));
  const tx = [
    ['Whole Foods', 'Groceries', -87.00, 0], ['Monthly salary', 'Salary', 5500, 1], ['Local market', 'Groceries', -60.32, 2], ['Dinner with friends', 'Food & Dining', -54.80, 3], ['iCloud', 'Personal Care', -2.99, 4], ['Apartment rent', 'Rent', -1800, 5], ['Coffee & pastry', 'Food & Dining', -12.50, 6], ['Design project', 'Freelance', 1250, 7], ['Electronics', 'Shopping', -175.14, 8], ['Metro card', 'Transportation', -32.00, 9], ['Yoga membership', 'Healthcare', -49.00, 10], ['Movie night', 'Entertainment', -26.50, 11], ['Power bill', 'Utilities', -82.40, 12], ['Weekend trip', 'Travel', -240, 13], ['Online course', 'Education', -59, 14], ['Birthday gift', 'Gifts', -40, 15], ['Pharmacy', 'Healthcare', -18.75, 16], ['Investment dividend', 'Investments', 180, 17], ['Lunch', 'Food & Dining', -24.60, 18], ['Market run', 'Groceries', -43.25, 19],
  ].map(([description, category, amount, n], i) => ({ id: `${userId}-t${i}`, user_id: userId, description, category, category_name: category, type: amount > 0 ? 'income' : 'expense', amount: Math.abs(amount), date: new Date(Date.now() - n * 86400000).toISOString().slice(0, 10), notes: '' }));
  return { categories: cats, transactions: tx, budgets: [], insights: [] };
};
app.use(cors()); app.use(express.json({ limit: '1mb' }));
let databaseInitialization;
app.use((_req, _res, next) => {
  databaseInitialization ||= initStandaloneSchema().then(seedDemoAccount);
  databaseInitialization.then(() => next()).catch(next);
});
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
};
async function seedCategories(userId) {
  if (pool) { const values = []; const rows = defaults.map((c, i) => { values.push(userId, ...c, true); return `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`; }); await pool.query(`insert into categories(user_id,name,type,icon,color,is_default) values ${rows.join(',')} on conflict(user_id,name,type) do nothing`, values); }
  else { if (!demoData.has(userId)) demoData.set(userId, sample(userId)); }
}
async function getData(userId) {
  if (!pool) { await seedCategories(userId); return demoData.get(userId); }
  await seedCategories(userId);
  const [c, t, b, i] = await Promise.all([
    pool.query('select id,name,type,icon,color,is_default from categories where user_id=$1 order by name', [userId]),
    pool.query('select t.id,t.type,t.amount,t.description,t.notes,t.transaction_date as date,t.category_id,c.name as category,c.color,c.icon from transactions t left join categories c on c.id=t.category_id where t.user_id=$1 order by t.transaction_date desc,t.created_at desc', [userId]),
    pool.query('select b.id,b.amount,b.period,b.category_id,c.name as category,c.color,c.icon from budgets b join categories c on c.id=b.category_id where b.user_id=$1 order by c.name', [userId]),
    pool.query('select id,kind,payload,created_at from insights where user_id=$1 order by created_at desc limit 30', [userId])]);
  return { categories: c.rows, transactions: t.rows.map(x => ({ ...x, amount: Number(x.amount), date: String(x.date).slice(0, 10) })), budgets: b.rows.map(x => ({ ...x, amount: Number(x.amount) })), insights: i.rows };
}
const apiInfo = (_req, res) => res.json({
  name: 'ExpenseAI API',
  status: 'ok',
  version: '1.0.0',
  storage: pool ? 'postgres' : 'in-memory demo',
  message: 'The backend is running. Open the Vite app to use ExpenseAI.',
  endpoints: {
    health: 'GET /api/health',
    signup: 'POST /api/auth/signup',
    login: 'POST /api/auth/login',
    accountData: 'GET /api/data (Bearer token required)',
    transactions: 'GET /api/data; POST /api/transactions; PUT/DELETE /api/transactions/:id',
    categories: 'POST /api/categories; PUT/DELETE /api/categories/:id',
    budgets: 'POST /api/budgets; DELETE /api/budgets/:id',
    insights: 'POST /api/insights',
  },
});
app.get('/', apiInfo);
app.get('/api', apiInfo);
app.get('/api/health', (_req, res) => res.json({ ok: true, storage: pool ? 'postgres' : 'demo', demoAccount: Boolean(pool && process.env.NODE_ENV !== 'production') }));
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, currency = 'USD' } = req.body; if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Enter your name, a valid email, and a password of at least 6 characters.' });
    if (pool) { const exists = await pool.query('select id from app_users where lower(email)=lower($1)', [email]); if (exists.rowCount) return res.status(409).json({ error: 'An account with this email already exists.' }); }
    else if (demoUsers.has(email.toLowerCase())) return res.status(409).json({ error: 'An account with this email already exists.' });
    const id = randomUUID(), passwordHash = await bcrypt.hash(password, 12);
    if (pool) { await pool.query('create table if not exists app_users (id uuid primary key, name text not null, email text unique not null, password_hash text not null, currency text not null default \'USD\', created_at timestamptz default now())'); await pool.query('insert into app_users(id,name,email,password_hash,currency) values($1,$2,$3,$4,$5)', [id, name, email.toLowerCase(), passwordHash, currency]); }
    else demoUsers.set(email.toLowerCase(), { id, name, email: email.toLowerCase(), passwordHash, currency });
    await seedCategories(id); const user = { id, name, email: email.toLowerCase(), currency }; res.status(201).json({ token: jwt.sign(user, JWT_SECRET, { expiresIn: '14d' }), user, data: await getData(id) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not create your account. Check your database configuration.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body; let account;
    if (pool) { const result = await pool.query('select * from app_users where lower(email)=lower($1)', [email]); account = result.rows[0]; } else account = demoUsers.get((email || '').toLowerCase());
    if (!account || !(await bcrypt.compare(password || '', account.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    await seedCategories(account.id); const user = { id: account.id, name: account.name, email: account.email, currency: account.currency || 'USD' }; res.json({ token: jwt.sign(user, JWT_SECRET, { expiresIn: '14d' }), user, data: await getData(user.id) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not sign in. Check your database configuration.' }); }
});
app.get('/api/data', auth, async (req, res) => { try { res.json(await getData(req.user.id)); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load your financial data.' }); } });
app.post('/api/transactions', auth, async (req, res) => {
  try {
    const { type, amount, category_id, category, description, notes = '', date } = req.body; if (!['income', 'expense'].includes(type) || !Number(amount) || Number(amount) <= 0 || !description || !date) return res.status(400).json({ error: 'Enter an amount, description, type and date.' });
    if (pool) { const r = await pool.query('insert into transactions(user_id,category_id,type,amount,description,notes,transaction_date) values($1,$2,$3,$4,$5,$6,$7) returning id', [req.user.id, category_id || null, type, amount, description, notes, date]); return res.status(201).json({ id: r.rows[0].id }); }
    const data = await getData(req.user.id); const cat = data.categories.find(c => c.id === category_id) || data.categories.find(c => c.name === category); const item = { id: randomUUID(), user_id: req.user.id, category_id: cat?.id, category: cat?.name || category, category_name: cat?.name || category, color: cat?.color, type, amount: Number(amount), description, notes, date }; data.transactions.unshift(item); res.status(201).json(item);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not save the transaction.' }); }
});
app.post('/api/transactions/import', auth, async (req, res) => {
  try {
    const rows = req.body?.transactions;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'Choose at least one transaction to import.' });
    if (rows.length > 1000) return res.status(413).json({ error: 'Import up to 1,000 transactions at a time.' });
    const memoryData = pool ? null : await getData(req.user.id);
    const categories = pool ? (await pool.query('select id,name,type,icon,color from categories where user_id=$1', [req.user.id])).rows : memoryData.categories;
    const categoryById = new Map(categories.map((category) => [String(category.id), category]));
    let skipped = 0, invalid = 0;
    const candidates = [];
    for (const row of rows) {
      const amount = Math.round(Number(row?.amount) * 100) / 100, date = String(row?.date || ''), description = String(row?.description || '').trim().slice(0, 180);
      const calendarDate = new Date(`${date}T00:00:00.000Z`);
      if (!['income', 'expense'].includes(row?.type) || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date || !description) { invalid += 1; continue; }
      const category = categoryById.get(String(row.category_id));
      const selected = category?.type === row.type ? category : categories.find((item) => item.type === row.type && item.name === (row.type === 'expense' ? 'Other Expense' : 'Other Income')) || categories.find((item) => item.type === row.type);
      if (!selected) { invalid += 1; continue; }
      candidates.push({ date, amount, type: row.type, description, notes: String(row.notes || 'Imported from statement').slice(0, 500), category: selected });
    }
    const duplicateKey = (item) => `${String(item.date).slice(0, 10)}|${Number(item.amount).toFixed(2)}|${item.type}|${String(item.description).trim().toLowerCase()}`;
    const dates = candidates.map((item) => item.date).sort();
    const existingRows = pool && dates.length ? (await pool.query('select transaction_date as date,amount,type,description from transactions where user_id=$1 and transaction_date between $2::date and $3::date', [req.user.id, dates[0], dates.at(-1)])).rows : memoryData?.transactions || [];
    const seen = new Set(existingRows.map(duplicateKey)), fresh = [];
    for (const item of candidates) {
      const key = duplicateKey(item);
      if (seen.has(key)) { skipped += 1; continue; }
      seen.add(key); fresh.push(item);
    }
    if (pool && fresh.length) {
      const values = [];
      const tuples = fresh.map((item, index) => {
        const offset = index * 7;
        values.push(req.user.id, item.category.id, item.type, item.amount, item.description, item.notes, item.date);
        return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`;
      });
      await pool.query(`insert into transactions(user_id,category_id,type,amount,description,notes,transaction_date) values ${tuples.join(',')}`, values);
    } else if (!pool) {
      for (const item of fresh) memoryData.transactions.unshift({ id: randomUUID(), user_id: req.user.id, category_id: item.category.id, category: item.category.name, category_name: item.category.name, color: item.category.color, icon: item.category.icon, type: item.type, amount: item.amount, description: item.description, notes: item.notes, date: item.date });
    }
    const imported = fresh.length;
    res.json({ imported, skipped, invalid });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not import this statement.' }); }
});
app.put('/api/transactions/:id', auth, async (req, res) => { try { const { type, amount, category_id, description, notes = '', date } = req.body; if (pool) { const r = await pool.query('update transactions set type=$1,amount=$2,category_id=$3,description=$4,notes=$5,transaction_date=$6 where id=$7 and user_id=$8 returning id', [type, amount, category_id || null, description, notes, date, req.params.id, req.user.id]); if (!r.rowCount) return res.sendStatus(404); } else { const t = (await getData(req.user.id)).transactions.find(x => x.id === req.params.id); if (!t) return res.sendStatus(404); Object.assign(t, { type, amount: Number(amount), category_id, category: (await getData(req.user.id)).categories.find(c => c.id === category_id)?.name, description, notes, date }); } res.json({ ok: true }); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not update the transaction.' }); } });
app.delete('/api/transactions/:id', auth, async (req, res) => { if (pool) { await pool.query('delete from transactions where id=$1 and user_id=$2', [req.params.id, req.user.id]); } else { const d = await getData(req.user.id); d.transactions = d.transactions.filter(t => t.id !== req.params.id); } res.sendStatus(204); });
app.post('/api/categories', auth, async (req, res) => { try { const { name, type, icon = 'Tag', color = '#8b5cf6' } = req.body; if (!name || !['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Enter a category name and type.' }); if (pool) { const r = await pool.query('insert into categories(user_id,name,type,icon,color) values($1,$2,$3,$4,$5) returning *', [req.user.id, name, type, icon, color]); return res.status(201).json(r.rows[0]); } const d = await getData(req.user.id); if (d.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type)) return res.status(409).json({ error: 'That category already exists.' }); const c = { id: randomUUID(), name, type, icon, color, is_default: false }; d.categories.push(c); res.status(201).json(c); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not create the category.' }); } });
app.put('/api/categories/:id', auth, async (req, res) => { try { const { name, icon = 'Tag', color = '#8b5cf6' } = req.body; if (!name) return res.status(400).json({ error: 'Enter a category name.' }); if (pool) { const r = await pool.query('update categories set name=$1,icon=$2,color=$3 where id=$4 and user_id=$5 and is_default=false returning *', [name, icon, color, req.params.id, req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'Custom category not found.' }); return res.json(r.rows[0]); } const d = await getData(req.user.id), c = d.categories.find(x => x.id === req.params.id); if (!c || c.is_default) return res.status(404).json({ error: 'Custom category not found.' }); if (d.categories.some(x => x.id !== c.id && x.type === c.type && x.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'That category already exists.' }); Object.assign(c, { name, icon, color }); for (const t of d.transactions) if (t.category_id === c.id) t.category = t.category_name = name; for (const b of d.budgets) if (b.category_id === c.id) b.category = name; res.json(c); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not update the category.' }); } });
app.delete('/api/categories/:id', auth, async (req, res) => { if (pool) await pool.query('delete from categories where id=$1 and user_id=$2 and is_default=false', [req.params.id, req.user.id]); else { const d = await getData(req.user.id); d.categories = d.categories.filter(c => c.id !== req.params.id || c.is_default); } res.sendStatus(204); });
app.post('/api/budgets', auth, async (req, res) => { try { const { category_id, category, amount, period = 'monthly' } = req.body; if (!Number(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a budget amount greater than zero.' }); if (pool) { const r = await pool.query('insert into budgets(user_id,category_id,amount,period) values($1,$2,$3,$4) on conflict(user_id,category_id,period) do update set amount=excluded.amount returning *', [req.user.id, category_id, amount, period]); return res.status(201).json(r.rows[0]); } const d = await getData(req.user.id), c = d.categories.find(x => x.id === category_id || x.name === category); if (!c) return res.status(404).json({ error: 'Category not found.' }); const old = d.budgets.find(x => x.category_id === c.id && x.period === period); if (old) old.amount = Number(amount); else d.budgets.push({ id: randomUUID(), category_id: c.id, category: c.name, amount: Number(amount), period, color: c.color }); res.status(201).json({ ok: true }); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not save the budget.' }); } });
app.delete('/api/budgets/:id', auth, async (req, res) => { if (pool) await pool.query('delete from budgets where id=$1 and user_id=$2', [req.params.id, req.user.id]); else { const d = await getData(req.user.id); d.budgets = d.budgets.filter(b => b.id !== req.params.id); } res.sendStatus(204); });
function localInsight(kind, transactions, currency) { const now = new Date(), month = now.getMonth(), year = now.getFullYear(), thisMonth = transactions.filter(t => { const d = new Date(`${t.date}T12:00:00`); return d.getMonth() === month && d.getFullYear() === year; }), income = thisMonth.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0), expense = thisMonth.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0), groups = {}; thisMonth.filter(t => t.type === 'expense').forEach(t => groups[t.category] = (groups[t.category] || 0) + t.amount); const top = Object.entries(groups).sort((a, b) => b[1] - a[1]); const savingsRate = income ? Math.round((income - expense) / income * 100) : 0; return kind === 'summary' ? { title: 'Your month at a glance', healthScore: Math.max(35, Math.min(99, Math.round(65 + savingsRate * .55))), income, expense, savingsRate, summary: income ? `You brought in ${currency} ${income.toFixed(2)} and spent ${currency} ${expense.toFixed(2)} this month. ${savingsRate >= 20 ? 'Your savings pace is looking healthy.' : 'A little more room in your budget could help you build a stronger savings cushion.'}` : 'Add a few transactions this month and your personalized financial summary will appear here.', recommendations: top.slice(0, 3).map(([category, amount]) => `Try a simple weekly limit for ${category}. A 10% reduction could free up ${currency} ${(amount * .1).toFixed(0)} this month.`) } : { tips: top.slice(0, 4).map(([category, amount], i) => ({ category, rank: i + 1, estimatedSavings: Math.round(amount * (i === 0 ? .15 : .1)), tip: `Set a weekly ${category} limit and plan purchases ahead. A small 10%–15% change could make a noticeable difference.` })), summary: 'Small, consistent changes to your top spending categories can create room for the things that matter to you.' }; }
app.post('/api/insights', auth, async (req, res) => {
  try {
    const { kind = 'summary' } = req.body; const data = await getData(req.user.id), filtered = Array.isArray(req.body.transactions) ? req.body.transactions : data.transactions; let payload;
    if (kind === 'analyzer') { const summary = localInsight('summary', filtered, req.user.currency || 'USD'); payload = { title: 'A pattern to consider', summary: summary.summary, recommendations: summary.recommendations }; } else payload = localInsight(kind, data.transactions, req.user.currency || 'USD');
    if (process.env.GEMINI_API_KEY) { try { const prompt = `You are a practical, kind personal finance coach. Analyze this user's ${kind} using ONLY their provided data. Currency ${req.user.currency || 'USD'}. Data: ${JSON.stringify(kind === 'analyzer' ? { transactions: filtered } : { transactions: data.transactions, categories: data.categories, budgets: data.budgets })}. Return valid JSON with ${kind === 'summary' ? 'title, healthScore (0-100), income (number), expense (number), savingsRate (number), summary (string), recommendations (array of 3 strings)' : kind === 'tips' ? 'tips (array of 4 objects with category, rank, estimatedSavings (number), tip), summary (string)' : 'title, summary (string), recommendations (array of 3 strings)'}. No markdown.`; const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: .5 } }) }); if (response.ok) { const json = await response.json(); payload = JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text || '{}'); } } catch (e) { console.error('Gemini insight fallback:', e.message); } }
    if (pool) { const r = await pool.query('insert into insights(user_id,kind,payload) values($1,$2,$3) returning id,created_at', [req.user.id, kind, payload]); payload = { ...payload, id: r.rows[0].id, kind, created_at: r.rows[0].created_at }; } else { const item = { id: randomUUID(), kind, payload, created_at: new Date().toISOString() }; data.insights.unshift(item); payload = { ...payload, ...item }; }
    res.json(payload);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not create an insight right now.' }); }
});
app.put('/api/profile', auth, async (req, res) => { if (pool) { await pool.query('update app_users set name=$1,currency=$2 where id=$3', [req.body.name, req.body.currency, req.user.id]); } else if (demoUsers.has(req.user.email)) { const u = demoUsers.get(req.user.email); u.name = req.body.name; u.currency = req.body.currency; } res.json({ ok: true }); });
const DEMO_EMAIL = 'demo@expenseai.app';
const DEMO_PASSWORD = 'ExpenseAI123!';
async function seedDemoAccount() {
  if (!pool || process.env.NODE_ENV === 'production' || process.env.VERCEL) return;
  const id = '00000000-0000-4000-8000-000000000001';
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  await pool.query('insert into app_users(id,name,email,password_hash,currency) values($1,$2,$3,$4,$5) on conflict(email) do nothing', [id, 'Alex Morgan', DEMO_EMAIL, passwordHash, 'USD']);
  const account = await pool.query('select id from app_users where email=$1', [DEMO_EMAIL]);
  const userId = account.rows[0].id;
  await seedCategories(userId);
  const existing = await pool.query('select count(*)::int as count from transactions where user_id=$1', [userId]);
  if (existing.rows[0].count === 0) {
    const demo = sample(userId);
    const actual = await pool.query('select id,name from categories where user_id=$1', [userId]);
    const ids = new Map(actual.rows.map((category) => [category.name, category.id]));
    for (const transaction of demo.transactions) {
      await pool.query('insert into transactions(user_id,category_id,type,amount,description,notes,transaction_date) values($1,$2,$3,$4,$5,$6,$7)', [userId, ids.get(transaction.category), transaction.type, transaction.amount, transaction.description, transaction.notes, transaction.date]);
    }
    for (const [name, amount] of [['Groceries', 500], ['Food & Dining', 450], ['Shopping', 250]]) {
      const categoryId = ids.get(name);
      if (categoryId) await pool.query("insert into budgets(user_id,category_id,amount,period) values($1,$2,$3,'monthly') on conflict(user_id,category_id,period) do nothing", [userId, categoryId, amount]);
    }
  }
  console.log(`Local sample account ready: ${DEMO_EMAIL}`);
}

async function initStandaloneSchema() {
  if (!pool) return;
  await pool.query(`create table if not exists app_users(id uuid primary key,name text not null,email text unique not null,password_hash text not null,currency text not null default 'USD',created_at timestamptz default now());
    create table if not exists categories(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_users(id) on delete cascade,name text not null,type text not null check(type in ('income','expense')),icon text not null default 'Tag',color text not null default '#8b5cf6',is_default boolean not null default false,created_at timestamptz default now(),unique(user_id,name,type));
    create table if not exists transactions(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_users(id) on delete cascade,category_id uuid references categories(id) on delete set null,type text not null check(type in ('income','expense')),amount numeric(12,2) not null check(amount>0),description text not null,notes text not null default '',transaction_date date not null default current_date,created_at timestamptz default now());
    create table if not exists budgets(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_users(id) on delete cascade,category_id uuid not null references categories(id) on delete cascade,amount numeric(12,2) not null check(amount>0),period text not null default 'monthly' check(period in ('weekly','monthly')),created_at timestamptz default now(),unique(user_id,category_id,period));
    create table if not exists insights(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_users(id) on delete cascade,kind text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz default now());
    create index if not exists transactions_user_date_idx on transactions(user_id,transaction_date desc);create index if not exists insights_user_created_idx on insights(user_id,created_at desc);`);
  // If these tables were created earlier with another auth provider's user
  // table as the owner FK, remove only those user_id constraints. The API now
  // authenticates against app_users; category and other relationship FKs stay.
  await pool.query(`do $$ declare item record; begin
    for item in select c.conrelid::regclass as table_name, c.conname
      from pg_constraint c
      where c.contype='f'
        and c.conrelid in ('public.categories'::regclass,'public.transactions'::regclass,'public.budgets'::regclass,'public.insights'::regclass)
        and c.confrelid <> 'public.app_users'::regclass
        and cardinality(c.conkey)=1
        and (select a.attname from pg_attribute a where a.attrelid=c.conrelid and a.attnum=c.conkey[1])='user_id'
    loop execute format('alter table %s drop constraint %I',item.table_name,item.conname); end loop;
  end $$;`);
  await pool.query('alter table public.app_users disable row level security; alter table public.categories disable row level security; alter table public.transactions disable row level security; alter table public.budgets disable row level security; alter table public.insights disable row level security;');
}
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); });
if (process.env.NODE_ENV === 'production') { const path = await import('node:path'); app.use(express.static(path.resolve('dist'))); app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html'))); }
if (!process.env.VERCEL) {
  databaseInitialization = initStandaloneSchema().then(seedDemoAccount);
  databaseInitialization.then(() => app.listen(PORT, () => console.log(`ExpenseAI API running on http://localhost:${PORT} (${pool ? 'Postgres' : 'demo storage'})`))).catch((error) => { console.error('Database initialization failed:', error.message); process.exit(1); });
}
export default app;
