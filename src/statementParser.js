const cleanHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function parseDate(raw) {
  const value = String(raw || '').trim();
  const ofx = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const numeric = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    let [, first, second, year] = numeric;
    if (year.length === 2) year = `${Number(year) > 69 ? '19' : '20'}${year}`;
    let month = Number(first), day = Number(second);
    if (month > 12 && day <= 12) { month = Number(second); day = Number(first); }
    if (month > 12 || day > 31 || month < 1 || day < 1) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const named = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const parsedNamed = new Date(`${named[1]} ${named[2]}, ${named[3]} UTC`);
    if (!Number.isNaN(parsedNamed.getTime())) return parsedNamed.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseAmount(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  let value = String(raw).trim().replace(/[\s$£€₹]/g, '');
  const parenthesized = value.startsWith('(') && value.endsWith(')');
  value = value.replace(/[()]/g, '').replace(/[^\d.,+-]/g, '');
  if (value.includes(',') && value.includes('.')) {
    if (value.lastIndexOf(',') > value.lastIndexOf('.')) value = value.replace(/\./g, '').replace(',', '.');
    else value = value.replace(/,/g, '');
  }
  else if (value.includes(',')) {
    const tail = value.split(',').at(-1);
    value = tail.length <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return parenthesized ? -Math.abs(number) : number;
}

function inferCategory(description, type, categories) {
  const text = String(description).toLowerCase();
  const keywords = [
    ['Groceries', /grocery|groceries|supermarket|whole foods|trader joe|market|costco|walmart grocery/],
    ['Food & Dining', /restaurant|cafe|coffee|starbucks|dining|doordash|ubereats|uber eats|grubhub|mcdonald|lunch|dinner|bakery/],
    ['Rent', /rent|landlord|property management|mortgage/],
    ['Transportation', /uber|lyft|taxi|transit|metro|fuel|gas station|parking|shell|chevron/],
    ['Shopping', /amazon|shopping|target|clothing|electronics|ikea|etsy/],
    ['Utilities', /electric|utility|utilities|water bill|internet|phone bill|verizon|comcast|energy/],
    ['Healthcare', /pharmacy|medical|health|doctor|clinic|dental|cvs|walgreens/],
    ['Entertainment', /movie|cinema|netflix|spotify|concert|theatre|theater|hulu/],
    ['Travel', /airline|hotel|airbnb|flight|travel|booking\.com/],
    ['Education', /tuition|school|course|education|udemy|coursera/],
    ['Personal Care', /salon|personal care|barber|beauty/],
    ['Salary', /payroll|salary|paycheck|direct deposit/],
    ['Freelance', /freelance|client payment|invoice payment/],
    ['Investments', /dividend|investment|brokerage/],
    ['Gifts', /gift|birthday/],
  ];
  const matchedName = keywords.find(([name, pattern]) => name && pattern.test(text))?.[0];
  const match = categories.find((category) => category.type === type && (category.name === matchedName || category.name === 'Other Expense' && type === 'expense' || category.name === 'Other Income' && type === 'income'));
  return match?.id || categories.find((category) => category.type === type)?.id || '';
}

function normalizeRow({ date, description, amount, type, statementType, categories }, index) {
  const transactionDate = parseDate(date), value = parseAmount(amount);
  const detail = String(description || '').trim();
  if (!transactionDate || value == null || value === 0 || !detail) return null;
  const calendarDate = new Date(`${transactionDate}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== transactionDate) return null;
  const transactionType = type || (value < 0 ? 'income' : statementType === 'card' ? 'expense' : 'income');
  return {
    key: `${index}-${transactionDate}-${detail}`,
    date: transactionDate,
    description: detail.slice(0, 180),
    amount: Math.abs(value),
    type: transactionType,
    category_id: inferCategory(detail, transactionType, categories),
    notes: 'Imported from statement',
  };
}

function parseOfx(text, statementType, categories) {
  const rows = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  return rows.map((match, index) => {
    const block = match[1];
    const get = (tag) => block.match(new RegExp(`<${tag}>([^\\r\\n<]+)`, 'i'))?.[1]?.trim() || '';
    const description = [get('NAME'), get('MEMO')].filter(Boolean).join(' - ');
    return normalizeRow({ date: get('DTPOSTED'), description, amount: get('TRNAMT'), statementType, categories }, index);
  }).filter(Boolean);
}

function parsePdfText(text, statementType, categories) {
  const rows = [];
  const datePattern = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s+/;
  const amountPattern = /(?:\(?-?\$?\s*\d[\d,]*\.\d{2}\)?)/g;
  for (const line of text.split(/\r?\n/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;
    const remainder = line.slice(dateMatch[0].length).trim();
    const amounts = [...remainder.matchAll(amountPattern)];
    if (!amounts.length) continue;
    // PDF statement rows often append a running balance after the transaction amount.
    const amountMatch = amounts.length > 1 ? amounts.at(-2) : amounts.at(-1);
    const description = remainder.slice(0, amountMatch.index).replace(/[|•\s-]+$/g, '').trim();
    const amountText = amountMatch[0].replace(/\$/g, '').replace(/\s/g, '');
    const transaction = normalizeRow({ date: dateMatch[1], description, amount: amountText, statementType, categories }, rows.length);
    if (transaction) rows.push(transaction);
  }
  if (!rows.length) throw new Error('No readable transaction rows were found in this PDF. Scanned image statements need OCR; export the statement as CSV or use a text-based PDF.');
  return rows;
}

export function parseStatement(text, filename, statementType, categories) {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (/\.pdf$/i.test(filename)) return parsePdfText(cleaned, statementType, categories);
  if (/\.(ofx|qfx)$/i.test(filename) || /<OFX[\s>]/i.test(cleaned)) {
    const transactions = parseOfx(cleaned, statementType, categories);
    if (!transactions.length) throw new Error('No transactions were found in this OFX/QFX statement.');
    return transactions;
  }
  const firstLine = cleaned.split(/\r?\n/).slice(0, 5).join('\n');
  const delimiter = [',', ';', '\t'].map((candidate) => ({ candidate, count: (firstLine.match(new RegExp(candidate === '\t' ? '\\t' : `\\${candidate}`, 'g')) || []).length })).sort((a, b) => b.count - a.count)[0]?.candidate || ',';
  const rows = parseDelimited(cleaned, delimiter);
  const aliases = {
    date: new Set(['date', 'transactiondate', 'posteddate', 'postingdate', 'bookingdate', 'valuedate', 'processdate']),
    description: new Set(['description', 'transactiondescription', 'details', 'memo', 'name', 'payee', 'merchant', 'transaction', 'narrative']),
    amount: new Set(['amount', 'transactionamount', 'netamount', 'debitcreditamount', 'value']),
    debit: new Set(['debit', 'debits', 'debitamount', 'withdrawal', 'withdrawals', 'moneyout', 'paid']),
    credit: new Set(['credit', 'credits', 'creditamount', 'deposit', 'deposits', 'moneyin', 'received']),
    direction: new Set(['type', 'transactiontype', 'activity', 'debitcredit']),
  };
  let headerIndex = -1, columns = {};
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const headers = rows[i].map(cleanHeader), found = {};
    for (const [kind, choices] of Object.entries(aliases)) found[kind] = headers.findIndex((value) => choices.has(value));
    const hasAmount = found.amount >= 0 || found.debit >= 0 || found.credit >= 0;
    if (found.date >= 0 && found.description >= 0 && hasAmount) { headerIndex = i; columns = found; break; }
  }
  if (headerIndex < 0) throw new Error('Could not identify the date, description, and amount columns. Export a CSV with column headers or use OFX/QFX.');
  const parsed = [];
  for (const [index, row] of rows.slice(headerIndex + 1).entries()) {
    const get = (key) => columns[key] >= 0 ? row[columns[key]] : '';
    const debit = parseAmount(get('debit')), credit = parseAmount(get('credit'));
    let amount = get('amount'), type;
    if (columns.debit >= 0 && columns.credit >= 0) {
      if (debit != null && debit !== 0) { amount = debit; type = 'expense'; }
      else if (credit != null && credit !== 0) { amount = credit; type = 'income'; }
      else continue;
    } else if (columns.debit >= 0 && columns.amount < 0) { amount = debit; type = 'expense'; }
    else if (columns.credit >= 0 && columns.amount < 0) { amount = credit; type = statementType === 'card' ? 'expense' : 'income'; }
    if (columns.direction >= 0) {
      const direction = String(get('direction')).toLowerCase();
      if (/debit|withdraw|purchase|charge|expense|\bdr\b/.test(direction)) type = 'expense';
      if (/credit|deposit|refund|income|payment received|\bcr\b/.test(direction)) type = 'income';
    }
    const transaction = normalizeRow({ date: get('date'), description: get('description'), amount, type, statementType, categories }, index);
    if (transaction) parsed.push(transaction);
  }
  if (!parsed.length) throw new Error('The file was read, but no valid transactions were found. Check the date and amount columns.');
  return parsed;
}
