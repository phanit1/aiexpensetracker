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

function parseDate(raw, dayFirst = false) {
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
    if (dayFirst || month > 12 && day <= 12) { month = Number(second); day = Number(first); }
    if (month > 12 || day > 31 || month < 1 || day < 1) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const named = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const parsedNamed = new Date(`${named[1]} ${named[2]}, ${named[3]} UTC`);
    if (!Number.isNaN(parsedNamed.getTime())) return parsedNamed.toISOString().slice(0, 10);
  }
  const dayFirstNamed = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dayFirstNamed) {
    const parsedNamed = new Date(`${dayFirstNamed[2]} ${dayFirstNamed[1]}, ${dayFirstNamed[3]} UTC`);
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

function normalizeRow({ date, description, amount, type, statementType, categories, dayFirst = false, categoryHint = '' }, index) {
  const transactionDate = parseDate(date, dayFirst), value = parseAmount(amount);
  const detail = String(description || '').trim();
  if (!transactionDate || value == null || value === 0 || !detail) return null;
  const calendarDate = new Date(`${transactionDate}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== transactionDate) return null;
  const transactionType = type || (statementType === 'card' ? (value < 0 ? 'income' : 'expense') : (value < 0 ? 'expense' : 'income'));
  return {
    key: `${index}-${transactionDate}-${detail}`,
    date: transactionDate,
    description: detail.slice(0, 180),
    amount: Math.abs(value),
    type: transactionType,
    category_id: categories.find((category) => category.type === transactionType && category.name.toLowerCase() === String(categoryHint).trim().toLowerCase())?.id || inferCategory(detail, transactionType, categories),
    notes: 'Imported from statement',
  };
}

function parseOfx(text, statementType, categories) {
  const rows = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>|<\/OFX>|$)/gi)];
  return rows.map((match, index) => {
    const block = match[1];
    const get = (tag) => block.match(new RegExp(`<${tag}>([^\\r\\n<]+)`, 'i'))?.[1]?.trim() || '';
    const description = [get('NAME'), get('MEMO')].filter(Boolean).join(' - ');
    return normalizeRow({ date: get('DTPOSTED'), description, amount: get('TRNAMT'), statementType, categories }, index);
  }).filter(Boolean);
}

function parseQif(text, statementType, categories) {
  const records = text.split(/\^\s*(?:\r?\n|$)/).map((block) => block.trim()).filter(Boolean);
  const rows = [];
  for (const [index, block] of records.entries()) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const key = line[0];
      if ('DTPMLN'.includes(key) && line.length > 1) fields[key] = (fields[key] || []).concat(line.slice(1).trim());
    }
    const date = fields.D?.[0];
    const amount = fields.T?.[0];
    const description = [fields.P?.[0], fields.M?.[0]].filter(Boolean).join(' - ');
    const hint = fields.L?.[0]?.replace(/^\[|\]$/g, '');
    const item = normalizeRow({ date, amount, description, statementType, categories, categoryHint: hint }, index);
    if (item) rows.push(item);
  }
  return rows;
}

function parseMt940(text, statementType, categories) {
  const starts = [...text.matchAll(/:61:/g)];
  return starts.map((start, index) => {
    const block = text.slice(start.index, starts[index + 1]?.index ?? text.length);
    const match = block.match(/^:61:(\d{6})(?:\d{4})?([RC]?[CD])(?:[A-Z])?([\d,]+)/);
    if (!match) return null;
    const [, stamp, indicator, rawAmount] = match;
    const yy = Number(stamp.slice(0, 2)), year = yy > 69 ? `19${stamp.slice(0, 2)}` : `20${stamp.slice(0, 2)}`;
    const date = `${year}-${stamp.slice(2,4)}-${stamp.slice(4,6)}`;
    const info = block.match(/:86:([\s\S]*?)(?=\r?\n:\d{2}[A-Z]?:|$)/)?.[1] || '';
    const amount = rawAmount.includes(',') ? rawAmount.replace(',', '.') : rawAmount;
    const type = indicator.endsWith('C') ? 'income' : 'expense';
    const description = info.replace(/[?+]/g, ' ').replace(/\s+/g, ' ').trim() || 'Bank transaction';
    return normalizeRow({ date, description, amount, type, statementType, categories }, index);
  }).filter(Boolean);
}

function xmlValues(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, 'gi');
  return [...block.matchAll(pattern)].map((match) => match[1].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim()).filter(Boolean);
}

function parseCamtXml(text, statementType, categories) {
  const entries = [...text.matchAll(/<(?:(?:[\w.-]+):)?Ntry\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?Ntry\s*>/gi)];
  return entries.map((match, index) => {
    const block = match[1], amount = xmlValues(block, 'Amt')[0], direction = xmlValues(block, 'CdtDbtInd')[0]?.toUpperCase();
    const booking = xmlValues(block, 'BookgDt')[0] || xmlValues(block, 'ValDt')[0] || block;
    const date = xmlValues(booking, 'Dt')[0] || xmlValues(booking, 'DtTm')[0] || xmlValues(block, 'BookgDt')[0] || '';
    const description = [...xmlValues(block, 'Ustrd'), ...xmlValues(block, 'AddtlNtryInf')].join(' ').replace(/\s+/g, ' ').trim();
    const type = direction === 'CRDT' ? 'income' : direction === 'DBIT' ? 'expense' : undefined;
    return normalizeRow({ date, description, amount, type, statementType, categories }, index);
  }).filter(Boolean);
}

function recordsToCsv(records) {
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const encode = (value) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [headers.map(encode).join(','), ...records.map((record) => headers.map((key) => encode(record[key])).join(','))].join('\n');
}

function jsonRecords(text) {
  const parsed = JSON.parse(text);
  const preferred = [parsed, parsed?.transactions, parsed?.records, parsed?.entries, parsed?.statement?.transactions, parsed?.data?.transactions, parsed?.data?.records, parsed?.data];
  const records = preferred.find((value) => Array.isArray(value) && value.some((row) => row && typeof row === 'object' && !Array.isArray(row)));
  if (!records) throw new Error('Could not find a transaction list in this JSON file.');
  return recordsToCsv(records);
}

function htmlTables(text) {
  if (typeof DOMParser === 'undefined') throw new Error('HTML statement parsing is available in the browser.');
  const document = new DOMParser().parseFromString(text, 'text/html');
  const encode = (value) => { const text = value.trim(); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const tables = [...document.querySelectorAll('table')].map((table) => [...table.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th,td')].map((cell) => encode(cell.textContent || ''))).filter((row) => row.length));
  const best = tables.sort((a,b) => b.length-a.length)[0];
  if (!best?.length) throw new Error('No transaction table was found in this HTML statement.');
  return best.map((row) => row.join(',')).join('\n');
}

function parsePdfText(text, statementType, categories, dayFirst = false) {
  const rows = [];
  const datePattern = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+/;
  const amountPattern = /(?:\(?[-+]?[$€£₹]?\s*\d[\d,]*(?:\.\d{1,2})?\)?)/g;
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
    const transaction = normalizeRow({ date: dateMatch[1], description, amount: amountText, statementType, categories, dayFirst }, rows.length);
    if (transaction) rows.push(transaction);
  }
  if (!rows.length) throw new Error('No transaction rows could be recognized. Try a clearer scan or export the statement as CSV, OFX, or QFX.');
  return rows;
}

function parseIciciPdfPages(pdfPages, categories) {
  if (!Array.isArray(pdfPages) || !pdfPages.length) return [];
  const allItems = pdfPages.flat();
  const combined = allItems.map((item) => item.text.toLowerCase()).join(' ');
  if (!/transaction/.test(combined) || !/remarks/.test(combined) || !/withdrawal/.test(combined) || !/deposit/.test(combined) || !/balance/.test(combined)) return [];
  const headerFor = (word) => allItems.find((item) => item.text.toLowerCase().includes(word));
  const withdrawalHeader = headerFor('withdrawal'), depositHeader = headerFor('deposit'), balanceHeader = headerFor('balance');
  if (![withdrawalHeader?.x, depositHeader?.x, balanceHeader?.x].every(Number.isFinite)) return [];
  const withdrawalX = withdrawalHeader.x, depositX = depositHeader.x, balanceX = balanceHeader.x;
  const debitCreditBoundary = (withdrawalX + (withdrawalHeader.width || 0) / 2 + depositX + (depositHeader.width || 0) / 2) / 2;
  const output = [];
  for (const page of pdfPages) {
    const anchors = page.filter((item) => item.x >= 40 && item.x < 110 && /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(item.text.trim()) && parseDate(item.text.trim(), true)).sort((a,b) => b.y-a.y);
    for (let index=0; index<anchors.length; index++) {
      const anchor=anchors[index], nextY=anchors[index+1]?.y ?? anchor.y-46;
      const amounts=page.filter((item)=>Math.abs(item.y-anchor.y)<=2 && item.x>=withdrawalX-12 && item.x<balanceX).map((item)=>({center:item.x+(item.width||0)/2,value:parseAmount(item.text)})).filter((item)=>item.value!=null && item.value!==0).sort((a,b)=>a.center-b.center);
      const debit=amounts.find((item)=>item.center<debitCreditBoundary)?.value;
      const credit=amounts.find((item)=>item.center>=debitCreditBoundary)?.value;
      const type=debit!=null?'expense':credit!=null?'income':null;
      const amount=Math.abs(debit ?? credit ?? 0);
      if (!type || !amount) continue;
      const description=page.filter((item)=>item.x>=170 && item.x<withdrawalX-5 && item.y<anchor.y+2 && item.y>nextY+1).sort((a,b)=>b.y-a.y||a.x-b.x).map((item)=>item.text.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      const row=normalizeRow({date:anchor.text.trim(),description,amount,type,statementType:'bank',categories,dayFirst:true},output.length);
      if(row) output.push(row);
    }
  }
  return output;
}

export function parseStatement(text, filename, statementType, categories, options = {}) {
  let cleaned = text.replace(/^\uFEFF/, '').trim();
  if (options.pdfPages) {
    const positionedRows = parseIciciPdfPages(options.pdfPages, categories);
    if (positionedRows.length) return positionedRows;
  }
  if (/\.pdf$/i.test(filename) || options.pdf || options.ocr) return parsePdfText(cleaned, statementType, categories, options.dayFirst);
  if (/\.qif$/i.test(filename) || /^!Type:/im.test(cleaned)) {
    const transactions = parseQif(cleaned, statementType, categories);
    if (!transactions.length) throw new Error('No transactions were found in this QIF statement.');
    return transactions;
  }
  if (/^:20:.*\r?\n:25:.*\r?\n[\s\S]*:61:/m.test(cleaned)) {
    const transactions = parseMt940(cleaned, statementType, categories);
    if (!transactions.length) throw new Error('No transactions were found in this MT940 statement.');
    return transactions;
  }
  if (/\.json$/i.test(filename) || /^[\[{]/.test(cleaned)) cleaned = jsonRecords(cleaned);
  else if (/\.html?$/i.test(filename) || /<html[\s>]|<table[\s>]/i.test(cleaned)) cleaned = htmlTables(cleaned);
  if (/\.xml$/i.test(filename) || /<(?:(?:[\w.-]+):)?Document\b|<(?:(?:[\w.-]+):)?Ntry\b/i.test(cleaned)) {
    const transactions = parseCamtXml(cleaned, statementType, categories);
    if (transactions.length) return transactions;
  }
  if (/\.(ofx|qfx|ofc)$/i.test(filename) || /<OFX[\s>]/i.test(cleaned)) {
    const transactions = parseOfx(cleaned, statementType, categories);
    if (!transactions.length) throw new Error('No transactions were found in this OFX/QFX statement.');
    return transactions;
  }
  const firstLine = cleaned.split(/\r?\n/).slice(0, 5).join('\n');
  const delimiter = [',', ';', '\t'].map((candidate) => ({ candidate, count: (firstLine.match(new RegExp(candidate === '\t' ? '\\t' : `\\${candidate}`, 'g')) || []).length })).sort((a, b) => b.count - a.count)[0]?.candidate || ',';
  const rows = parseDelimited(cleaned, delimiter);
  const aliases = {
    date: new Set(['date', 'transactiondate', 'transactiondatetime', 'transactiondt', 'txndate', 'posteddate', 'postingdate', 'bookingdate', 'valuedate', 'processdate', 'bookeddate', 'valuedatetime']),
    description: new Set(['description', 'transactiondescription', 'transactionremarks', 'transactiondetails', 'details', 'memo', 'name', 'payee', 'merchant', 'transaction', 'narrative', 'remarks', 'particulars', 'counterparty', 'counterpartyname', 'beneficiary', 'reference']),
    amount: new Set(['amount', 'transactionamount', 'netamount', 'debitcreditamount', 'amountdrcr', 'value', 'localamount', 'originalamount']),
    debit: new Set(['debit', 'debits', 'debitamount', 'debitamountinr', 'withdrawal', 'withdrawals', 'withdrawalamount', 'withdrawalamountinr', 'moneyout', 'paid', 'outflow', 'charge', 'charges']),
    credit: new Set(['credit', 'credits', 'creditamount', 'creditamountinr', 'deposit', 'deposits', 'depositamount', 'depositamountinr', 'moneyin', 'received', 'inflow']),
    direction: new Set(['type', 'transactiontype', 'activity', 'debitcredit', 'drcr', 'direction']),
    category: new Set(['category', 'transactioncategory', 'spendcategory']),
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
  const headerText = rows[headerIndex].map(cleanHeader).join('|');
  const dayFirst = options.dayFirst ?? (/transactionremarks|withdrawalamountinr|depositamountinr/.test(headerText));
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
    const transaction = normalizeRow({ date: get('date'), description: get('description'), amount, type, statementType, categories, dayFirst, categoryHint: get('category') }, index);
    if (transaction) parsed.push(transaction);
  }
  if (!parsed.length) throw new Error('The file was read, but no valid transactions were found. Check the date and amount columns.');
  return parsed;
}
