import { useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, FileSpreadsheet, Trash2, Upload, X } from 'lucide-react';
import { parseStatement } from './statementParser.js';

const currencyText = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount || 0);

async function readStatement(file, password = '') {
  if (!/\.pdf$/i.test(file.name)) return file.text();
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...(password ? { password } : {}) }).promise;
  } catch (error) {
    if (error.name === 'PasswordException') {
      const passwordError = new Error(password ? 'That password did not unlock the PDF. Check it and try again.' : 'This PDF is password protected. Enter its password to continue.');
      passwordError.name = 'PasswordException';
      throw passwordError;
    }
    throw error;
  }
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push({ x: item.transform[4], text: item.str.trim() });
    }
    pages.push(lines.sort((a, b) => b.y - a.y).map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')).join('\n'));
  }
  await document.destroy();
  return pages.join('\n');
}

export default function StatementImport({ close, auth, data, notify }) {
  const inputRef = useRef(null);
  const [statementType, setStatementType] = useState('bank');
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceText, setSourceText] = useState('');
  const [rows, setRows] = useState([]);
  const [filename, setFilename] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const categories = data?.categories || [];
  const currency = auth.user?.currency || 'USD';

  const loadFile = async (file, password = '') => {
    if (!file) return;
    if (!password) { setPasswordRequired(false); setPdfPassword(''); }
    setError(''); setResult(null); setRows([]); setFilename(file.name); setSourceFile(file);
    if (file.size > 5 * 1024 * 1024) { setError('This statement is over 5 MB. Export a smaller date range and try again.'); setSourceFile(null); return; }
    if (!/\.(csv|tsv|ofx|qfx|pdf)$/i.test(file.name)) {
      setError('Please upload a CSV, TSV, OFX, QFX, or PDF statement.');
      return;
    }
    try {
      const text = await readStatement(file, password);
      setSourceText(text);
      const parsed = parseStatement(text, file.name, statementType, categories);
      setRows(parsed);
      setPasswordRequired(false); setPdfPassword('');
    } catch (parseError) {
      if (parseError.name === 'PasswordException') setPasswordRequired(true);
      setError(parseError.message);
    }
  };

  const chooseStatementType = async (nextType) => {
    setStatementType(nextType);
    if (!sourceFile || !rows.length) return;
    try { setRows(parseStatement(sourceText, sourceFile.name, nextType, categories)); }
    catch (parseError) { setError(parseError.message); }
  };

  const updateRow = (key, field, value) => setRows((current) => current.map((row) => {
    if (row.key !== key) return row;
    if (field === 'type') {
      const category = categories.find((item) => item.type === value);
      return { ...row, type: value, category_id: category?.id || '' };
    }
    return { ...row, [field]: field === 'amount' ? Number(value) : value };
  }));

  const importRows = async () => {
    setBusy(true); setError('');
    try {
      const response = await auth.request('/transactions/import', {
        method: 'POST',
        body: JSON.stringify({ transactions: rows.map(({ key, ...row }) => row) }),
      });
      setResult(response);
      notify(response.imported + ' transaction(s) imported' + (response.skipped ? ' - ' + response.skipped + ' duplicate(s) skipped' : '') + (response.invalid ? ' - ' + response.invalid + ' invalid row(s) ignored' : '') + '.');
      if (response.imported > 0) close();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop statement-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="modal-card statement-modal" role="dialog" aria-modal="true" aria-labelledby="statement-title">
      <header className="modal-head">
        <div><span className="eyebrow">BRING YOUR MONEY INTO FOCUS</span><h2 id="statement-title">Import a bank statement</h2></div>
        <button className="icon-button modal-close" onClick={close} aria-label="Close"><X size={19}/></button>
      </header>
      <div className="statement-content">
        <p className="statement-intro">We will read the transactions, suggest categories, and let you review everything before it is added.</p>
        <div className="statement-type-toggle" role="group" aria-label="Statement type">
          <button className={statementType === 'bank' ? 'selected' : ''} onClick={() => chooseStatementType('bank')}><ArrowDownLeft size={15}/> Bank account</button>
          <button className={statementType === 'card' ? 'selected' : ''} onClick={() => chooseStatementType('card')}><ArrowUpRight size={15}/> Credit card</button>
        </div>
        <input ref={inputRef} className="statement-file-input" type="file" accept=".csv,.tsv,.ofx,.qfx,.pdf,text/csv,text/tab-separated-values,application/x-ofx,application/pdf" onChange={(event) => { loadFile(event.target.files?.[0]); event.target.value = ''; }}/>
        <button className={`statement-dropzone ${rows.length ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()}>
          <span className="statement-upload-icon">{rows.length ? <Check size={20}/> : <Upload size={20}/>}</span>
          <b>{filename || 'Choose a statement to get started'}</b>
          <span>{rows.length ? `${rows.length} transactions ready to review` : 'CSV, TSV, OFX, QFX, or PDF - up to 5 MB'}</span>
          <span className="statement-browse">Browse files <ArrowRight size={13}/></span>
        </button>
        {passwordRequired && <div className="statement-password-box">
          <label htmlFor="statement-pdf-password">PDF password</label>
          <div><input id="statement-pdf-password" type="password" autoComplete="off" value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sourceFile && loadFile(sourceFile, pdfPassword)} placeholder="Enter the password for this PDF"/><button className="button primary" disabled={!pdfPassword || busy} onClick={() => sourceFile && loadFile(sourceFile, pdfPassword)}>Unlock PDF</button></div>
          <small>The password is used only in this browser to open the file.</small>
        </div>}
        <p className="statement-privacy"><FileSpreadsheet size={14}/> Your file is read in this browser. Only the reviewed transactions are sent to your account.</p>
        {error && <div className="auth-error statement-error">{error}</div>}
        {rows.length > 0 && <>
          <div className="statement-review-heading"><div><span className="eyebrow">REVIEW BEFORE IMPORTING</span><b>{rows.length} rows found</b></div><button className="text-link" onClick={() => { setRows([]); setFilename(''); setResult(null); }}>Choose another file</button></div>
          <div className="statement-table-wrap"><table className="statement-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th><th>Category</th><th/></tr></thead><tbody>
            {rows.map((row) => <tr key={row.key}>
              <td><input aria-label="Transaction date" type="date" value={row.date} onChange={(event) => updateRow(row.key, 'date', event.target.value)}/></td>
              <td><input aria-label="Description" value={row.description} onChange={(event) => updateRow(row.key, 'description', event.target.value)}/></td>
              <td><input aria-label="Amount" type="number" min="0.01" step="0.01" value={row.amount} onChange={(event) => updateRow(row.key, 'amount', event.target.value)}/></td>
              <td><select aria-label="Transaction type" value={row.type} onChange={(event) => updateRow(row.key, 'type', event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></td>
              <td><select aria-label="Category" value={row.category_id} onChange={(event) => updateRow(row.key, 'category_id', event.target.value)}>{categories.filter((category) => category.type === row.type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>
              <td><button className="icon-button delete-icon" aria-label={`Remove ${row.description}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 size={14}/></button></td>
            </tr>)}
          </tbody></table></div>
          <p className="statement-dedupe-note">Existing transactions with the same date, amount, type, and description are skipped.</p>
        </>}
        {result && <div className="statement-result">Imported {result.imported} and skipped {result.skipped} duplicate transactions.</div>}
        <footer className="modal-footer statement-footer">
          <button className="button secondary" onClick={close}>Cancel</button>
          <button className="button primary" disabled={busy || !rows.length} onClick={importRows}>{busy ? 'Adding transactions...' : `Add ${rows.length} transactions`} <ArrowRight size={15}/></button>
        </footer>
      </div>
    </section>
  </div>;
}
