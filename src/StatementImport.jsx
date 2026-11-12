import { useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, FileSpreadsheet, Trash2, Upload, X } from 'lucide-react';
import { parseStatement } from './statementParser.js';

const currencyText = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount || 0);

async function recognizeImage(source, onProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { logger: (message) => {
    if (message.status === 'recognizing text') onProgress(`Reading image text… ${Math.round((message.progress || 0) * 100)}%`);
  } });
  try { return (await worker.recognize(source)).data.text; }
  finally { await worker.terminate(); }
}

async function imageCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function fileAsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function mapGeminiTransactions(items, categories) {
  const parsed = items.flatMap((item, index) => {
    const date = String(item.date || ''), amount = Number(item.amount);
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    const type = item.type;
    const description = String(item.description || '').trim().slice(0, 180);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || !Number.isFinite(amount) || amount <= 0 || !['income', 'expense'].includes(type) || !description) return [];
    const category = categories.find((candidate) => candidate.type === type && candidate.name.toLowerCase() === String(item.category || '').trim().toLowerCase()) ||
      categories.find((candidate) => candidate.type === type && candidate.name === (type === 'expense' ? 'Other Expense' : 'Other Income')) || categories.find((candidate) => candidate.type === type);
    if (!category) return [];
    return [{ key: `gemini-${index}-${date}`, date, amount: Math.round(amount * 100) / 100, description, type, category_id: category.id, notes: 'Extracted from statement with Gemini' }];
  });
  if (!parsed.length) throw new Error('Gemini did not find valid transaction rows.');
  return parsed;
}

async function readStatement(file, password = '', onProgress = () => {}, forceOcr = false) {
  const extension = file.name.toLowerCase();
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isOleFile = signature.length >= 4 && signature[0] === 0xd0 && signature[1] === 0xcf && signature[2] === 0x11 && signature[3] === 0xe0;
  const isZip = signature.length >= 2 && signature[0] === 0x50 && signature[1] === 0x4b;
  const signatureText = new TextDecoder().decode(signature);
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tif|tiff|gif)$/i.test(extension) ||
    signature[0] === 0x89 && signatureText.slice(1, 4) === 'PNG' ||
    signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff ||
    signatureText.slice(0, 3) === 'GIF' || signatureText.slice(0, 2) === 'BM' ||
    signatureText.slice(0, 4) === 'RIFF' && signatureText.slice(8, 12) === 'WEBP' ||
    signature[0] === 0x49 && signature[1] === 0x49 && signature[2] === 0x2a && signature[3] === 0 ||
    signature[0] === 0x4d && signature[1] === 0x4d && signature[2] === 0 && signature[3] === 0x2a;
  const isSpreadsheet = /\.(xlsx?|xlsm|xlsb|ods)$/i.test(extension) || /application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.oasis\.opendocument\.spreadsheet)/i.test(file.type) || isOleFile || isZip;
  if (isSpreadsheet) {
    onProgress('Opening spreadsheet…');
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false, dateNF: 'yyyy-mm-dd' })).filter((text) => text.trim());
    if (!sheets.length) throw new Error('This spreadsheet has no readable rows.');
    const transactionSheet = sheets.find((text) => {
      const headerText = text.split(/\r?\n/).slice(0, 15).join(' ').toLowerCase();
      return /date/.test(headerText) && /description|details|merchant|payee|transaction|narrative|memo/.test(headerText) && /amount|debit|credit|withdraw|deposit|value/.test(headerText);
    });
    return transactionSheet || sheets[0];
  }
  if (isImage) {
    onProgress('Preparing image for text recognition…');
    return { text: await recognizeImage(await imageCanvas(file), onProgress), image: true };
  }
  const isPdf = /\.pdf$/i.test(extension) || file.type === 'application/pdf' || new TextDecoder().decode(signature.slice(0, 5)) === '%PDF-';
  if (!isPdf) {
    const text = await file.text();
    const controls = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
    if (controls > Math.max(4, text.length * 0.01)) throw new Error('This looks like a binary file type the importer cannot read yet. Export it as CSV, Excel, PDF, OFX, or QIF.');
    return text;
  }
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let pdfDocument;
  try {
    pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...(password ? { password } : {}) }).promise;
  } catch (error) {
    if (error.name === 'PasswordException') {
      const passwordError = new Error(password ? 'That password did not unlock the PDF. Check it and try again.' : 'This PDF is password protected. Enter its password to continue.');
      passwordError.name = 'PasswordException';
      throw passwordError;
    }
    throw error;
  }
  const pages = [];
  const positionedPages = [];
  let ocrWorker;
  let ocrPageNumber = 0;
  try {
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    onProgress(`Reading PDF page ${pageNumber} of ${pdfDocument.numPages}…`);
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = [];
    const positionedItems = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      positionedItems.push({ x: item.transform[4], y, width: item.width, text: item.str.trim() });
      let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push({ x: item.transform[4], text: item.str.trim() });
    }
    positionedPages.push(positionedItems);
    let pageText = lines.sort((a, b) => b.y - a.y).map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')).join('\n');
    if (forceOcr || pageText.replace(/\W/g, '').length < 120) {
      ocrPageNumber = pageNumber;
      onProgress(`Recognizing scanned page ${pageNumber} of ${pdfDocument.numPages}…`);
      ocrWorker ||= await (async () => {
        const { createWorker } = await import('tesseract.js');
        return createWorker('eng', 1, { logger: (message) => {
          if (message.status === 'recognizing text') onProgress(`Recognizing scanned page ${ocrPageNumber} of ${pdfDocument.numPages}… ${Math.round((message.progress || 0) * 100)}%`);
        } });
      })();
      const viewport = page.getViewport({ scale: Math.min(2.4, 3000 / page.getViewport({ scale: 1 }).width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pageText = (await ocrWorker.recognize(canvas)).data.text;
      canvas.width = 0; canvas.height = 0;
    }
    pages.push(pageText);
  }
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
    await pdfDocument.destroy();
  }
  return { text: pages.join('\n'), pdfPages: positionedPages };
}

export default function StatementImport({ close, auth, data, notify }) {
  const inputRef = useRef(null);
  const [statementType, setStatementType] = useState('bank');
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceText, setSourceText] = useState('');
  const [sourcePdfPages, setSourcePdfPages] = useState(null);
  const [sourceIsImage, setSourceIsImage] = useState(false);
  const [extractionMethod, setExtractionMethod] = useState('');
  const [rows, setRows] = useState([]);
  const [filename, setFilename] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const categories = data?.categories || [];
  const currency = auth.user?.currency || 'USD';

  const loadFile = async (file, password = '') => {
    if (!file) return;
    if (!password) { setPasswordRequired(false); setPdfPassword(''); }
    setError(''); setResult(null); setRows([]); setFilename(file.name); setSourceFile(file); setSourcePdfPages(null);
    if (file.size > 20 * 1024 * 1024) { setError('This statement is over 20 MB. Export a smaller date range and try again.'); setSourceFile(null); return; }
    try {
      setProcessing(true); setProgress('Reading statement…');
      let extracted = await readStatement(file, password, setProgress);
      let text = typeof extracted === 'string' ? extracted : extracted.text;
      const pdfPages = typeof extracted === 'string' ? null : extracted.pdfPages;
      const isPdf = Array.isArray(pdfPages);
      const isImage = Boolean(extracted?.image) || file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tif|tiff|gif)$/i.test(file.name);
      setSourcePdfPages(pdfPages);
      setSourceIsImage(isImage);
      setSourceText(text);
      let parsed, geminiError;
      try {
        setProgress('Gemini is reading transaction rows…');
        const geminiImageType = file.type || (/\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : /\.gif$/i.test(file.name) ? 'image/gif' : 'image/png');
        const canSendDocument = !password && file.size <= 2_500_000 && (isPdf || isImage && /^image\/(png|jpeg|webp|gif)$/i.test(geminiImageType));
        const geminiResult = await auth.request('/statements/extract', { method: 'POST', body: JSON.stringify({
          fileName: file.name,
          mimeType: isPdf ? 'application/pdf' : isImage ? geminiImageType : 'text/plain',
          ...(canSendDocument ? { inlineBase64: await fileAsBase64(file) } : { text }),
          statementType,
          categories: categories.map(({ name, type }) => ({ name, type })),
        }) });
        parsed = mapGeminiTransactions(geminiResult.transactions || [], categories);
        setExtractionMethod('Gemini AI');
      } catch (error) {
        geminiError = error;
        setProgress('Using the local statement parser…');
        try { parsed = parseStatement(text, file.name, statementType, categories, { ocr: isImage, pdf: isPdf, pdfPages }); }
        catch (initialError) {
          if (!isPdf || initialError.name === 'PasswordException') throw initialError;
          setProgress('Text extraction was incomplete. Trying OCR on each PDF page…');
          extracted = await readStatement(file, password, setProgress, true);
          text = extracted.text;
          setSourcePdfPages(extracted.pdfPages);
          setSourceText(text);
          parsed = parseStatement(text, file.name, statementType, categories, { pdf: true, pdfPages: extracted.pdfPages });
        }
        setExtractionMethod('Local parser');
        if (geminiError?.message && !/not configured/i.test(geminiError.message)) console.warn('Gemini extraction unavailable; used local parser:', geminiError.message);
      }
      setRows(parsed);
      setPasswordRequired(false); setPdfPassword('');
    } catch (parseError) {
      if (parseError.name === 'PasswordException') setPasswordRequired(true);
      setError(parseError.message);
    } finally { setProcessing(false); setProgress(''); }
  };

  const chooseStatementType = async (nextType) => {
    setStatementType(nextType);
    if (!sourceFile || !rows.length) return;
    try { setRows(parseStatement(sourceText, sourceFile.name, nextType, categories, { ocr: sourceIsImage, pdf: Boolean(sourcePdfPages), pdfPages: sourcePdfPages })); }
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
        <input ref={inputRef} className="statement-file-input" type="file" accept=".csv,.tsv,.ofx,.ofc,.qfx,.qif,.mt940,.sta,.dat,.pdf,.xls,.xlsx,.xlsm,.xlsb,.ods,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif,.json,.xml,.txt,.html,.htm,*/*" onChange={(event) => { loadFile(event.target.files?.[0]); event.target.value = ''; }}/>
        <button className={`statement-dropzone ${rows.length ? 'has-file' : ''}`} disabled={processing} onClick={() => inputRef.current?.click()}>
          <span className="statement-upload-icon">{processing ? <span className="loading-spinner"/> : rows.length ? <Check size={20}/> : <Upload size={20}/>}</span>
          <b>{filename || 'Choose a statement to get started'}</b>
          <span>{processing ? progress : rows.length ? `${rows.length} transactions ready to review` : 'CSV, Excel, PDF, QIF, OFX, XML, HTML, or image statement - up to 20 MB'}</span>
          {!processing && <span className="statement-browse">Browse files <ArrowRight size={13}/></span>}
        </button>
        {passwordRequired && <div className="statement-password-box">
          <label htmlFor="statement-pdf-password">PDF password</label>
          <div><input id="statement-pdf-password" type="password" autoComplete="off" value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sourceFile && loadFile(sourceFile, pdfPassword)} placeholder="Enter the password for this PDF"/><button className="button primary" disabled={!pdfPassword || busy} onClick={() => sourceFile && loadFile(sourceFile, pdfPassword)}>Unlock PDF</button></div>
          <small>The password is used only in this browser to open the file.</small>
        </div>}
        <p className="statement-privacy"><FileSpreadsheet size={14}/> Gemini may process your statement content for extraction. Only transactions you review and import are saved to your account.</p>
        {error && <div className="auth-error statement-error">{error}</div>}
        {rows.length > 0 && <>
          <div className="statement-review-heading"><div><span className="eyebrow">REVIEW BEFORE IMPORTING · {extractionMethod}</span><b>{rows.length} rows found</b></div><button className="text-link" onClick={() => { setRows([]); setFilename(''); setResult(null); setExtractionMethod(''); }}>Choose another file</button></div>
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
