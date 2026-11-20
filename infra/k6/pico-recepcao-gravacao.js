// k6 do pico da recepção COM GRAVAÇÃO (M39; ficha, seção 10 e critério do campo 11; cap-14 §14.2.7 e §14.5: chamar
// senha < 1 s ponta a ponta), rodado por `pnpm k6 -- pico-recepcao-gravacao` SÓ NA HOMOLOGAÇÃO (AMBIENTE=homolog, a
// cópia descartável com o outro sistema ao lado, DP-15), antes da liberação de cada setor. A abertura às 7 h: os
// guichês entram juntos (subida em SUBIDA até USUARIOS) e cada um, em rajada, emite a senha no balcão, chama a próxima
// da fila, cadastra o paciente que chegou (massa sintética: nome, CPF e nascimento gerados aqui) e abre o atendimento
// pela senha chamada, pelas rotas reais da API (sessão, CSRF e Idempotency-Key, como a tela). Cada jornada tem o limite
// p95 e o contador próprios. O runner recusa este cenário fora de AMBIENTE=homolog (na cópia de desenvolvimento
// compartilhada, gravar com COMMIT é proibido); o ensaio do próprio roteiro roda direto pelo k6 em Docker contra a API
// com a massa sintética em memória (BASE de loopback), sem banco. Só contagens no resumo.
/* global __ENV, __VU, __ITER, console */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const chamadas = new Counter('sgh_chamadas');
const cadastros = new Counter('sgh_cadastros');
const aberturas = new Counter('sgh_aberturas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 30);
const SUBIDA = __ENV.SUBIDA || '20s';
const PATAMAR = __ENV.PATAMAR || '2m';
const ESTABELECIMENTO = __ENV.ESTABELECIMENTO || 'pc';
// Contas de carga da homologação (uma por guichê, com o guichê, a inclusão do paciente e a abertura do atendimento):
// K6_LOGINS separados por vírgula; a senha vem do cofre.
const LOGINS = (__ENV.K6_LOGINS || '').split(',').filter(Boolean);
const SENHA = __ENV.K6_SENHA || '';
const RECEPCAO = Number(__ENV.RECEPCAO || 0);
const LOCAL = Number(__ENV.LOCAL || 0);
const GERADOR = Number(__ENV.GERADOR || 0);
const GUICHE_BASE = Number(__ENV.GUICHE_BASE || 50);
// A abertura do atendimento pela senha chamada: os campos fixos da homologação (convênio, profissional, especialidade,
// unidade, centro de custo, procedimento, caráter e o CID), em JSON; o paciente e a senha vêm da rajada.
const ATENDIMENTO = JSON.parse(__ENV.ATENDIMENTO || 'null');
// O CEP do cadastro sintético (precisa existir no cadastro de CEPs do banco da rodada).
const CEP = __ENV.CEP || '30130000';
if (!/^https?:\/\/(127\.0\.0\.1|localhost|[a-z0-9.-]+\.homologacao\.[a-z0-9.-]+)(:\d+)?$/.test(BASE))
  throw new Error('BASE fora do loopback e da homologação: recusado.');
if (LOGINS.length === 0 || !SENHA || !RECEPCAO || !LOCAL || !GERADOR || !ATENDIMENTO)
  throw new Error('Faltam K6_LOGINS, K6_SENHA, RECEPCAO, LOCAL, GERADOR ou ATENDIMENTO.');
// Uma conta por guichê: a mesma pessoa não abre dois guichês no mesmo local (o guichê ficaria fechado e a rajada
// mediria só recusas).
if (LOGINS.length < USUARIOS)
  throw new Error(`K6_LOGINS: uma conta de carga por guichê (${USUARIOS} guichês).`);

// Gravações do balcão (cadastro e abertura): p95 < 2 s, o limite das gravações do cap-14 §14.5 (prescrever, dispensar).
const LIMITE_P95 = {
  'senha-chamar': 1000,
  'senha-emitir': 1000,
  'paciente-cadastrar': 2000,
  'atendimento-abrir': 2000,
};
const JORNADAS = Object.keys(LIMITE_P95);

export const options = {
  // A sessão do guichê vale o turno inteiro (o k6 zera os cookies a cada iteração por padrão).
  noCookiesReset: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    abertura: {
      executor: 'ramping-vus',
      exec: 'guiche',
      startVUs: 0,
      stages: [
        { duration: SUBIDA, target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    ...Object.fromEntries(
      JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, [`p(95)<${LIMITE_P95[j]}`]]),
    ),
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_failed{jornada:${j}}`, ['rate<0.01']])),
    sgh_chamadas: ['count>0'],
    sgh_cadastros: ['count>0'],
    sgh_aberturas: ['count>0'],
  },
};

let sessao = null;

/** CPF sintético válido (os dois dígitos verificadores calculados), diferente por guichê, iteração e rodada. */
function cpfSintetico() {
  const base = String(
    100000000 + ((__VU * 7919 + __ITER * 104729 + Math.floor(Date.now() / 1000)) % 899999999),
  );
  const d = base.split('').map(Number);
  const dv = (xs) => {
    const s = xs.reduce((a, x, i) => a + x * (xs.length + 1 - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}

/** Nome sintético só com letras (o guichê e a iteração em letras). */
function nomeSintetico() {
  const letras = (n) => {
    let x = '';
    let v = n;
    do {
      x = String.fromCharCode(65 + (v % 26)) + x;
      v = Math.floor(v / 26);
    } while (v > 0);
    return x;
  };
  return `PACIENTE CARGA ${letras(__VU)} ${letras(__ITER)}`;
}

function csrf() {
  const c = http.cookieJar().cookiesForURL(BASE);
  return (c.sgh_csrf && c.sgh_csrf[0]) || '';
}

// Fila vazia (outro guichê levou a senha) e o guichê já aberto são desfechos válidos da disputa (409 sem gravação).
const ACEITA_409 = http.expectedStatuses(201, 409);

function gravar(jornada, caminho, corpo) {
  return http.post(`${BASE}${caminho}`, JSON.stringify(corpo), {
    tags: { cenario: 'pico-gravacao', jornada },
    ...(jornada === 'senha-chamar' || jornada === 'guiche-abrir' ? { responseCallback: ACEITA_409 } : {}),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-csrf': csrf(),
      'idempotency-key': `k6-${jornada}-${__VU}-${__ITER}-${Date.now()}`,
    },
  });
}

function entrar() {
  const login = LOGINS[(__VU - 1) % LOGINS.length];
  const r = http.post(
    `${BASE}/api/sessao`,
    JSON.stringify({ estabelecimento: ESTABELECIMENTO, login, senha: SENHA }),
    { headers: { 'content-type': 'application/json' }, tags: { jornada: 'login' } },
  );
  check(r, { 'login 201': (x) => x.status === 201 });
  const guiche = GUICHE_BASE + __VU;
  const a = gravar('guiche-abrir', '/api/recepcao/guiche/abrir', {
    recepcao: RECEPCAO,
    local: LOCAL,
    guiche,
  });
  check(a, { 'guichê aberto': (x) => x.status === 201 || x.status === 409 });
  sessao = { guiche };
}

export function guiche() {
  if (!sessao) entrar();
  const e = gravar('senha-emitir', '/api/recepcao/senhas', {
    gerador: GERADOR,
    prioridade: '2',
    origem: 'balcao',
  });
  check(e, { 'senha emitida': (x) => x.status === 201 });
  if (__ENV.DEPURAR && e.status !== 201) console.log(`emitir ${e.status} ${String(e.body).slice(0, 200)}`);
  sleep(0.2 + Math.random() * 0.5);
  const c = gravar('senha-chamar', '/api/recepcao/senhas/chamar', {
    recepcao: RECEPCAO,
    local: LOCAL,
    guiche: sessao.guiche,
    geradores: [GERADOR],
  });
  // Fila vazia (outro guichê levou a senha) é desfecho válido da disputa: 409 sem gravação.
  check(c, { 'chamada 201 ou fila vazia': (x) => x.status === 201 || x.status === 409 });
  if (c.status !== 201) {
    if (__ENV.DEPURAR) console.log(`chamar ${c.status} ${String(c.body).slice(0, 200)}`);
    sleep(0.5 + Math.random());
    return;
  }
  chamadas.add(1, { jornada: 'senha-chamar' });
  const senha = Number(c.json('resultado.senha'));
  // O paciente que chegou sem cadastro: a inclusão (massa sintética).
  const p = gravar('paciente-cadastrar', '/api/cadastros/pacientes', {
    nome: nomeSintetico(),
    nascimento: '1980-05-10',
    sexo: __ITER % 2 ? 'F' : 'M',
    cpf: cpfSintetico(),
    naturalidade: 'BELO HORIZONTE',
    ufNaturalidade: 'MG',
    cep: CEP,
  });
  check(p, { 'paciente cadastrado': (x) => x.status === 201 });
  if (__ENV.DEPURAR && p.status !== 201) console.log(`cadastrar ${p.status} ${String(p.body).slice(0, 200)}`);
  if (p.status !== 201) return;
  cadastros.add(1, { jornada: 'paciente-cadastrar' });
  // A abertura do atendimento pela senha chamada (o fluxo da senha no local do guichê).
  const a = gravar('atendimento-abrir', '/api/atendimento', {
    ...ATENDIMENTO,
    paciente: Number(p.json('idPaciente')),
    senha,
    local: LOCAL,
  });
  check(a, { 'atendimento aberto': (x) => x.status === 201 });
  if (__ENV.DEPURAR && a.status !== 201) console.log(`abrir ${a.status} ${String(a.body).slice(0, 200)}`);
  if (a.status === 201) aberturas.add(1, { jornada: 'atendimento-abrir' });
  sleep(0.5 + Math.random());
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
