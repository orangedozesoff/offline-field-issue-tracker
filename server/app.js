// Express wiring only: security middleware, JSON parsing, routes -> handlers, errors.
const express = require('express');
const cors = require('cors');
const { createHandlers } = require('./handlers');

function createApp({ repo, clientUrl }) {
  if (!clientUrl) throw new Error('CLIENT_URL is required (CORS never allows "*")');
  const origins = clientUrl.split(',').map((s) => s.trim()).filter(Boolean);
  const h = createHandlers(repo);

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-Role', 'X-Actor'],
  }));
  app.use(express.json({ limit: '10kb' }));

  // Adapts a handler to Express; any thrown error goes to the error middleware.
  const route = (fn) => async (req, res, next) => {
    try {
      const out = await fn({ params: req.params, query: req.query, headers: req.headers, body: req.body });
      res.status(out.status).json(out.body);
    } catch (err) {
      next(err);
    }
  };

  app.get('/', route(h.health));                        // health check
  app.get('/reports', route(h.listReports));            // list with filters
  app.get('/reports/:id', route(h.getReport));          // one report
  app.get('/reports/:id/events', route(h.listEvents));  // activity history
  app.post('/reports', route(h.createReport));          // idempotent create
  app.patch('/reports/:id', route(h.editReport));       // version-checked edit
  app.post('/reports/:id/status', route(h.changeStatus)); // workflow change

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
