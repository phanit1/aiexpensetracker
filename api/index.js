import app from '../server/index.js';

export default function handler(req, res) {
  const apiPath = req.query?.__apiPath;
  if (typeof apiPath === 'string' && apiPath) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    query.delete('__apiPath');
    req.url = `/api/${apiPath}${query.size ? `?${query}` : ''}`;
  }
  return app(req, res);
}
