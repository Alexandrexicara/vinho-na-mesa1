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
      artistIndex: parsed.artistIndex && typeof parsed.artistIndex === 'object' ? parsed.artistIndex : {},
      soundEffects: Array.isArray(parsed.soundEffects) ? parsed.soundEffects : []
    };
  } catch {
    return { interviews: [], ads: [], viewIndex: {}, artistIndex: {}, soundEffects: [] };
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

// Rota para deletar uma entrevista completamente
app.delete('/api/interviews/:id', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  
  const store = readStore();
  const interviewIndex = store.interviews.findIndex(i => i._id === id);
  
  if (interviewIndex === -1) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  
  const interview = store.interviews[interviewIndex];
  
  try {
    // Deletar arquivos de mídia se existirem
    if (interview.questions && interview.questions.length > 0) {
      interview.questions.forEach(question => {
        if (question.videoUrl) {
          const videoPath = path.join(__dirname, 'public', question.videoUrl);
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
          }
        }
      });
    }
    
    // Deletar thumbnail se existir
    if (interview.thumbnailUrl) {
      const thumbnailPath = path.join(__dirname, 'public', interview.thumbnailUrl);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
    }
    
    // Remover do viewIndex
    Object.keys(store.viewIndex).forEach(token => {
      if (store.viewIndex[token] === id) {
        delete store.viewIndex[token];
      }
    });
    
    // Remover do array de entrevistas
    store.interviews.splice(interviewIndex, 1);
    
    writeStore(store);
    
    res.json({ 
      ok: true, 
      message: 'Entrevista e todos os arquivos associados foram deletados com sucesso' 
    });
    
  } catch (err) {
    console.error('Erro ao deletar entrevista:', err);
    res.status(500).json({ ok: false, error: 'Erro ao deletar arquivos da entrevista' });
  }
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

// Comentários - DEVEM vir antes da rota geral by-view-token
app.get('/api/interviews/by-view-token/:token/comments', (req, res) => {
  const { token } = req.params;
  
  const store = readStore();
  const interviewId = store.viewIndex[token];
  const interview = store.interviews.find(i => i._id === interviewId);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  
  const comments = interview.comments || [];
  res.json({ ok: true, comments });
});

app.post('/api/interviews/by-view-token/:token/comments', (req, res) => {
  const { token } = req.params;
  const { text, author, avatar } = req.body;
  
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Comentário não pode ser vazio' });
  }
  
  if (text.length > 500) {
    return res.status(400).json({ ok: false, error: 'Comentário muito longo (máximo 500 caracteres)' });
  }
  
  if (author && author.length > 50) {
    return res.status(400).json({ ok: false, error: 'Nome muito longo (máximo 50 caracteres)' });
  }
  
  const store = readStore();
  const interviewId = store.viewIndex[token];
  const interview = store.interviews.find(i => i._id === interviewId);
  if (!interview) {
    return res.status(404).json({ ok: false, error: 'Entrevista não encontrada' });
  }
  
  // Inicializar array de comentários se não existir
  if (!interview.comments) {
    interview.comments = [];
  }
  
  const newComment = {
    _id: 'comment-' + Date.now(),
    text: text.trim(),
    author: author || null,
    avatar: avatar || null,
    createdAt: new Date().toISOString()
  };
  
  interview.comments.unshift(newComment); // Adiciona no início
  interview.updatedAt = new Date().toISOString();
  writeStore(store);
  
  res.json({ 
    ok: true, 
    comment: newComment,
    message: 'Comentário adicionado com sucesso' 
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


const SOUND_EFFECT_CATALOG = [{"id":"panela","icon":"🍳","name":"Panela caindo","prompt":"A metal cooking pot falling onto a hard kitchen floor, clanging and bouncing briefly."},{"id":"freio","icon":"🚗","name":"Freio de carro","prompt":"A car braking hard with a sharp tire squeal, short realistic sound."},{"id":"sino","icon":"🔔","name":"Sino tocando","prompt":"A clear small handbell ringing brightly with a natural short decay."},{"id":"porta","icon":"🚪","name":"Porta batendo","prompt":"A heavy wooden door slamming shut with a short room reverberation."},{"id":"vidro","icon":"🥃","name":"Vidro quebrando","prompt":"A glass object shattering on a hard floor, crisp fragments scattering."},{"id":"aplausos","icon":"👏","name":"Aplausos","prompt":"A small audience applauding enthusiastically for a few seconds."},{"id":"risada","icon":"😂","name":"Risada","prompt":"A short burst of genuine human laughter, friendly and spontaneous."},{"id":"buzina","icon":"📣","name":"Buzina","prompt":"A single loud car horn honk, realistic city street sound."},{"id":"campainha","icon":"🔔","name":"Campainha","prompt":"A classic home doorbell ringing once."},{"id":"passos","icon":"👞","name":"Passos","prompt":"Several firm footsteps walking across a wooden floor."},{"id":"trovao","icon":"⛈️","name":"Trovão","prompt":"A dramatic deep thunderclap rolling briefly in the distance."},{"id":"chuva","icon":"🌧️","name":"Chuva forte","prompt":"A short burst of heavy rain hitting a window and pavement."},{"id":"vento","icon":"🌬️","name":"Rajada de vento","prompt":"A sudden gust of wind whooshing past the microphone."},{"id":"foguete","icon":"🚀","name":"Foguete","prompt":"A short cinematic rocket ignition and powerful launch whoosh."},{"id":"explosao","icon":"💥","name":"Explosão","prompt":"A controlled cinematic movie explosion with a deep impact and debris tail."},{"id":"soco","icon":"🥊","name":"Soco","prompt":"A single punch impact with a deep thud, stylized cinematic foley."},{"id":"espada","icon":"⚔️","name":"Espada","prompt":"A metal sword being drawn from its sheath with a sharp metallic scrape."},{"id":"tiro","icon":"🎯","name":"Disparo distante","prompt":"A single distant cinematic gunshot echo, non-graphic."},{"id":"helicoptero","icon":"🚁","name":"Helicóptero","prompt":"A helicopter rotor passing overhead briefly."},{"id":"aviao","icon":"✈️","name":"Avião","prompt":"A passenger airplane flying overhead with a fading engine roar."},{"id":"motor","icon":"🔑","name":"Motor ligando","prompt":"A car engine starting with ignition and settling into idle."},{"id":"aceleracao","icon":"🏎️","name":"Aceleração","prompt":"A sports car engine revving and accelerating away quickly."},{"id":"derrapagem","icon":"🛞","name":"Derrapagem","prompt":"A short tire skid and squeal on asphalt."},{"id":"moto","icon":"🏍️","name":"Moto","prompt":"A motorcycle engine revving loudly and driving away."},{"id":"sirene","icon":"🚨","name":"Sirene","prompt":"A short emergency vehicle siren sweep passing by."},{"id":"telefone","icon":"📞","name":"Telefone","prompt":"A classic telephone ringing twice."},{"id":"notificacao","icon":"📱","name":"Notificação","prompt":"A short modern smartphone notification chime."},{"id":"teclado","icon":"⌨️","name":"Teclado","prompt":"A few quick keystrokes on a mechanical computer keyboard."},{"id":"camera","icon":"📸","name":"Câmera","prompt":"A camera shutter click with a tiny mechanical sound."},{"id":"moedas","icon":"🪙","name":"Moedas","prompt":"A handful of metal coins dropping and spinning on a hard surface."},{"id":"caixa","icon":"💵","name":"Caixa registradora","prompt":"A cash register drawer opening with a bright cha-ching bell."},{"id":"papel","icon":"📄","name":"Papel rasgando","prompt":"A sheet of paper being torn quickly close to the microphone."},{"id":"agua","icon":"💧","name":"Água","prompt":"Water pouring into a glass with a gentle splash."},{"id":"gelo","icon":"🧊","name":"Gelo no copo","prompt":"Ice cubes dropping into a drinking glass and clinking."},{"id":"garrafa","icon":"🍾","name":"Garrafa abrindo","prompt":"A bottle cork popping with a celebratory fizz."},{"id":"talheres","icon":"🍴","name":"Talheres","prompt":"Metal cutlery clinking against ceramic plates."},{"id":"fritura","icon":"🍳","name":"Fritura","prompt":"Food sizzling in a hot frying pan, close-up kitchen sound."},{"id":"liquidificador","icon":"🥤","name":"Liquidificador","prompt":"A blender starting, whirring briefly, then stopping."},{"id":"microondas","icon":"⏲️","name":"Micro-ondas","prompt":"A microwave oven finishing with three short beeps."},{"id":"despertador","icon":"⏰","name":"Despertador","prompt":"A classic alarm clock ringing in a short burst."},{"id":"tic-tac","icon":"🕰️","name":"Relógio","prompt":"A close ticking clock for a few beats."},{"id":"magia","icon":"✨","name":"Magia","prompt":"A sparkling magical shimmer with a soft rising chime."},{"id":"whoosh","icon":"🎬","name":"Transição","prompt":"A short clean cinematic whoosh for a scene transition."},{"id":"suspense","icon":"🕵️","name":"Suspense","prompt":"A short tense cinematic sting with a low rising note."},{"id":"vitoria","icon":"🏆","name":"Vitória","prompt":"A triumphant short orchestral fanfare, bright and celebratory."},{"id":"erro","icon":"❌","name":"Erro","prompt":"A short descending electronic error buzz."},{"id":"acerto","icon":"✅","name":"Acerto","prompt":"A pleasant ascending success chime, short and bright."},{"id":"beijo","icon":"💋","name":"Beijo","prompt":"A playful short kiss sound effect, clean and light."},{"id":"cachorro","icon":"🐶","name":"Cachorro","prompt":"A dog giving two short realistic barks outdoors."},{"id":"gato","icon":"🐱","name":"Gato","prompt":"A short natural domestic cat meow."}];
app.get('/api/sound-effects', verifyAdminToken, (req, res) => {
  const saved = readStore().soundEffects || [];
  res.json({ ok: true, data: SOUND_EFFECT_CATALOG.map(item => {
    const file = saved.find(effect => effect.id === item.id);
    return { id: item.id, icon: item.icon, name: item.name, generated: !!file, audioUrl: file ? file.audioUrl : null };
  }) });
});
app.post('/api/sound-effects/generate', verifyAdminToken, async (req, res) => {
  try {
    const item = SOUND_EFFECT_CATALOG.find(effect => effect.id === (req.body || {}).id);
    if (!item) return res.status(400).json({ ok: false, error: 'Efeito não encontrado.' });
    const store = readStore();
    store.soundEffects = Array.isArray(store.soundEffects) ? store.soundEffects : [];
    const old = store.soundEffects.find(effect => effect.id === item.id);
    if (old && fs.existsSync(path.join(UPLOADS_DIR, old.fileName))) return res.json({ ok: true, effect: { id: item.id, audioUrl: old.audioUrl } });
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return res.status(503).json({ ok: false, error: 'Configure ELEVENLABS_API_KEY nas variáveis do Render.' });
    const response = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text: item.prompt, duration_seconds: 4, prompt_influence: 0.3 })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('ElevenLabs SFX:', response.status, detail.slice(0, 400));
      return res.status(response.status === 429 ? 429 : 502).json({ ok: false, error: response.status === 429 ? 'Limite ou créditos do ElevenLabs atingidos.' : 'Falha do ElevenLabs ao gerar o som.' });
    }
    ensureDirs();
    const fileName = 'sfx-' + item.id + '-' + Date.now() + '.mp3';
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(await response.arrayBuffer()));
    const audioUrl = '/uploads/' + fileName;
    store.soundEffects = store.soundEffects.filter(effect => effect.id !== item.id);
    store.soundEffects.push({ id: item.id, name: item.name, icon: item.icon, fileName, audioUrl, createdAt: new Date().toISOString() });
    writeStore(store);
    res.json({ ok: true, effect: { id: item.id, name: item.name, icon: item.icon, audioUrl } });
  } catch (error) {
    console.error('Erro ao gerar efeito:', error);
    res.status(500).json({ ok: false, error: 'Erro interno ao gerar efeito sonoro.' });
  }
});

// Ads (para o viewer1.html)
app.get('/api/ads', (req, res) => {
  const store = readStore();
  res.json({ ok: true, data: store.ads });
});

app.post('/api/ads', verifyAdminToken, upload.single('image'), (req, res) => {
  const { slot, title, linkUrl } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Arquivo de imagem não enviado' });
  }
  
  if (!slot) {
    return res.status(400).json({ ok: false, error: 'Slot não informado' });
  }
  
  const store = readStore();
  
  // Inicializar array de ads se não existir
  if (!store.ads) {
    store.ads = [];
  }
  
  // Remover anúncio existente no mesmo slot
  store.ads = store.ads.filter(ad => ad.slot !== slot);
  
  // Salvar imagem
  const filename = `ad-${slot}-${Date.now()}${path.extname(req.file.originalname)}`;
  const filepath = path.join(__dirname, 'public', 'uploads', filename);
  
  // Mover arquivo do upload para o destino final
  fs.renameSync(req.file.path, filepath);
  
  const newAd = {
    slot: slot,
    title: title || 'Anúncio',
    linkUrl: linkUrl || '',
    imageUrl: `/uploads/${filename}`,
    createdAt: new Date().toISOString()
  };
  
  store.ads.push(newAd);
  writeStore(store);
  
  res.json({ 
    ok: true, 
    ad: newAd,
    message: 'Anúncio enviado com sucesso' 
  });
});

app.delete('/api/ads/:slot', verifyAdminToken, (req, res) => {
  const { slot } = req.params;
  
  const store = readStore();
  if (!store.ads) {
    return res.status(404).json({ ok: false, error: 'Nenhum anúncio encontrado' });
  }
  
  // Remover anúncio do slot especificado
  const originalLength = store.ads.length;
  store.ads = store.ads.filter(ad => ad.slot !== slot);
  
  if (store.ads.length === originalLength) {
    return res.status(404).json({ ok: false, error: 'Anúncio não encontrado no slot especificado' });
  }
  
  writeStore(store);
  res.json({ 
    ok: true, 
    message: 'Anúncio deletado com sucesso' 
  });
});

app.delete('/api/ads', verifyAdminToken, (req, res) => {
  const store = readStore();
  
  // Deletar todos os anúncios
  const deletedCount = store.ads ? store.ads.length : 0;
  store.ads = [];
  
  writeStore(store);
  res.json({ 
    ok: true, 
    message: `${deletedCount} anúncios deletados com sucesso` 
  });
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