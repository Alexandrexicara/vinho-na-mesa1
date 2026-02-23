const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify(
        {
          interviews: [],
          ads: [],
          viewIndex: {},
          artistIndex: {}
        },
        null,
        2
      ),
      'utf-8'
    );
  }
}

function readStore() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      interviews: Array.isArray(parsed.interviews) ? parsed.interviews : [],
      ads: Array.isArray(parsed.ads) ? parsed.ads : [],
      viewIndex: parsed.viewIndex && typeof parsed.viewIndex === 'object' ? parsed.viewIndex : {},
      artistIndex: parsed.artistIndex && typeof parsed.artistIndex === 'object' ? parsed.artistIndex : {}
    };
  } catch {
    return { interviews: [], ads: [], viewIndex: {}, artistIndex: {} };
  }
}

function writeStore(store) {
  ensureDirs();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function randomToken(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function publicUrlFor(filename) {
  return `${BASE_URL}/uploads/${encodeURIComponent(filename)}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Rota para servir o viewer.html como página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Rota de exemplo para API
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Vinho na Mesa API is running' });
});

// Rota de login administrativo
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  
  // Senha padrão para administrador (você pode alterar conforme necessário)
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (password === ADMIN_PASSWORD) {
    // Em uma implementação real, aqui geraríamos um token JWT
    res.json({ 
      ok: true, 
      token: 'admin-token-' + Date.now(),
      message: 'Login realizado com sucesso' 
    });
  } else {
    res.status(401).json({ 
      ok: false, 
      error: 'Senha incorreta' 
    });
  }
});

// Middleware para verificar token de administrador
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token não fornecido' });
  }
  
  // Em uma implementação real, aqui validaríamos o token JWT
  if (token.startsWith('admin-token-')) {
    next(); // Token válido
  } else {
    res.status(403).json({ ok: false, error: 'Token inválido' });
  }
};

// Rota protegida para listar entrevistas (exemplo)
app.get('/api/admin/interviews', verifyAdminToken, (req, res) => {
  const store = readStore();
  res.json({ ok: true, data: store.interviews, message: 'Lista de entrevistas' });
});

// Lista pública (para viewer.html)
app.get('/api/interviews/public', (req, res) => {
  const store = readStore();
  const published = store.interviews
    .filter(i => i && i.viewToken && (i.status === 'published' || (i.questions && i.questions.length > 0)))
    .map(i => ({
      _id: i._id,
      title: i.title,
      interviewerName: i.interviewerName,
      artistName: i.artistName,
      thumbnailUrl: i.thumbnailUrl,
      viewCount: Number.isFinite(i.viewCount) ? i.viewCount : 0,
      viewToken: i.viewToken,
      status: i.status,
      questionsCount: (i.questions || []).length,
      answersCount: (i.answers || []).length,
      createdAt: i.createdAt
    }));
  res.json({ ok: true, data: published });
});

// Rota para criar entrevistas
app.post('/api/interviews', verifyAdminToken, (req, res) => {
  const { title, interviewerName, artistEmail, artistName } = req.body;
  
  const store = readStore();
  const inviteToken = randomToken('invite');
  const viewToken = randomToken('view');
  const newInterview = {
    _id: 'int-' + Date.now(),
    title: title || 'Vinho na Mesa',
    interviewerName: interviewerName || 'Entrevistador',
    artistEmail: artistEmail || '',
    artistName: artistName || '',
    status: 'draft',
    thumbnailUrl: '',
    questions: [],
    answers: [],
    inviteToken,
    viewToken,
    viewCount: 0,
    createdAt: new Date().toISOString()
  };
  store.interviews.unshift(newInterview);
  store.artistIndex[inviteToken] = newInterview._id;
  store.viewIndex[viewToken] = newInterview._id;
  writeStore(store);
  
  res.json({ 
    ok: true, 
    interview: newInterview,
    message: 'Entrevista criada com sucesso' 
  });
});

// Rota para obter uma entrevista específica
app.get('/api/interviews/:id', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  
  res.json({ 
    ok: true, 
    interview: interview,
    message: 'Entrevista encontrada' 
  });
});

// Rota para atualizar status da entrevista
app.put('/api/interviews/:id/status', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const store = readStore();
  const idx = store.interviews.findIndex(i => i._id === id);
  if (idx === -1) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  store.interviews[idx].status = status;
  store.interviews[idx].updatedAt = new Date().toISOString();
  const updatedInterview = store.interviews[idx];
  writeStore(store);
  
  res.json({ 
    ok: true, 
    interview: updatedInterview,
    message: 'Status atualizado com sucesso' 
  });
});

// Rota para gerar link de convite
app.post('/api/interviews/:id/invite', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  if (!interview.inviteToken) {
    interview.inviteToken = randomToken('invite');
    store.artistIndex[interview.inviteToken] = interview._id;
    writeStore(store);
  }
  const inviteLink = `${BASE_URL}/artist.html?token=${interview.inviteToken}`;
  
  res.json({ 
    ok: true, 
    link: inviteLink,
    token: interview.inviteToken,
    message: 'Link de convite gerado com sucesso' 
  });
});

// Rota para gerar link de visualização
app.post('/api/interviews/:id/viewer-link', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  if (!interview.viewToken) {
    interview.viewToken = randomToken('view');
    store.viewIndex[interview.viewToken] = interview._id;
    writeStore(store);
  }
  const viewLink = `${BASE_URL}/viewer1.html?token=${interview.viewToken}`;
  
  res.json({ 
    ok: true, 
    link: viewLink,
    token: interview.viewToken,
    message: 'Link de visualização gerado com sucesso' 
  });
});

// Rota para deletar todas as mídias de uma entrevista
app.delete('/api/interviews/:id/media', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  interview.questions = [];
  interview.answers = [];
  interview.finalVideoUrl = '';
  interview.updatedAt = new Date().toISOString();
  writeStore(store);
  res.json({ 
    ok: true, 
    message: 'Todas as mídias foram deletadas com sucesso' 
  });
});

// Rota para obter entrevista por token (usado pelo artista)
app.get('/api/interviews/by-token/:token', (req, res) => {
  const { token } = req.params;
  
  const store = readStore();
  const interviewId = store.artistIndex[token];
  const interview = store.interviews.find(i => i._id === interviewId);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  
  res.json({ 
    ok: true, 
    interview: interview,
    message: 'Entrevista encontrada' 
  });
});

// Rota para obter entrevista por token de visualização (viewer)
app.get('/api/interviews/by-view-token/:token', (req, res) => {
  const { token } = req.params;
  const store = readStore();
  const interviewId = store.viewIndex[token];
  const interview = store.interviews.find(i => i._id === interviewId);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  // Permitir visualização mesmo que não publicada para criar curiosidade
  // Mas só incrementa viewCount se estiver publicada
  if (interview.status === 'published') {
    interview.viewCount = Number.isFinite(interview.viewCount) ? interview.viewCount + 1 : 1;
    interview.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  res.json({ ok: true, interview });
});

// Rota para upload de thumbnail
app.post('/api/interviews/:id/thumbnail', verifyAdminToken, upload.single('thumbnail'), (req, res) => {
  const { id } = req.params;
  
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Arquivo não enviado' });
  }

  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }

  const thumbnailUrl = publicUrlFor(req.file.filename);
  interview.thumbnailUrl = thumbnailUrl;
  interview.updatedAt = new Date().toISOString();
  writeStore(store);
  
  res.json({ 
    ok: true, 
    thumbnailUrl: thumbnailUrl,
    message: 'Thumbnail enviado com sucesso' 
  });
});

// Upload de pergunta (admin)
app.post('/api/interviews/:id/questions', verifyAdminToken, upload.single('video'), (req, res) => {
  const { id } = req.params;
  const order = Number(req.body.order);
  if (!req.file) return res.status(400).json({ ok: false, error: 'Arquivo não enviado' });
  if (!Number.isFinite(order) || order <= 0) return res.status(400).json({ ok: false, error: 'Order inválido' });

  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });

  const url = publicUrlFor(req.file.filename);
  const q = {
    _id: 'q-' + Date.now(),
    order,
    url,
    createdAt: new Date().toISOString()
  };

  interview.questions = Array.isArray(interview.questions) ? interview.questions : [];
  const existingIdx = interview.questions.findIndex(x => x.order === order);
  if (existingIdx >= 0) interview.questions[existingIdx] = q;
  else interview.questions.push(q);
  interview.questions.sort((a, b) => a.order - b.order);
  interview.updatedAt = new Date().toISOString();
  writeStore(store);

  res.json({ ok: true, question: q });
});

// Rota para unificar vídeos (stitch)
app.post('/api/interviews/:id/stitch', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  // Em uma implementação real, aqui processaríamos os vídeos com ffmpeg
  res.json({ 
    ok: true, 
    message: 'Vídeos unificados com sucesso! O vídeo final está disponível no link: ' + 
             `${BASE_URL}/final-video-${id}.webm`
  });
});

// Rota para adicionar respostas (usado pelo artista)
app.post('/api/interviews/:id/answers', upload.single('video'), (req, res) => {
  const { id } = req.params;
  const questionOrder = Number(req.body.questionOrder);
  if (!req.file) return res.status(400).json({ ok: false, error: 'Arquivo não enviado' });

  const store = readStore();
  const interview = store.interviews.find(i => i._id === id);
  if (!interview) return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });

  const url = publicUrlFor(req.file.filename);
  const answer = {
    _id: 'a-' + Date.now(),
    url,
    questionOrder: Number.isFinite(questionOrder) ? questionOrder : undefined,
    createdAt: new Date().toISOString()
  };

  interview.answers = Array.isArray(interview.answers) ? interview.answers : [];
  interview.answers.push(answer);
  interview.updatedAt = new Date().toISOString();
  writeStore(store);

  res.json({ ok: true, answer, message: 'Resposta enviada com sucesso' });
});

// Ads (para o viewer1.html)
app.get('/api/ads', (req, res) => {
  const store = readStore();
  res.json({ ok: true, data: store.ads });
});

// Middleware para servir arquivos estáticos como fallback
app.use((req, res, next) => {
  // Se a requisição espera JSON mas não encontrou a rota, retorna 404 em JSON
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(404).json({ ok: false, error: 'Endpoint não encontrado' });
  }
  
  // Para outras requisições, serve o arquivo estático ou retorna 404
  next();
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`Senha administrativa padrão: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
});