// k6 da linha de base de carga somada (M09, regra 15; cap-14 §14.2.7), rodado por `pnpm k6 -- carga-somada`
// na imagem grafana/k6 com tag e digest, contra a API local (127.0.0.1:3300) e a cópia de dev, nunca contra
// o sante-firebird nem nada externo (revisão do M35: limiares de login e de abrir a ficha nas metas do cap-14 §14.5;
// as metas das jornadas que gravam não são medidas aqui). Três cenários ao mesmo tempo: "carga nominal somada" (até USUARIOS
// usuários: login no início e, depois, abrir ficha e listas com tempo de leitura), "consulta pesada"
// (relatório de período) e "painéis automáticos" (atualização a cada 5 s). Só leitura: as rotas /api/carga
// existem só em dev e respondem só contagens. Cada resposta traz `n`, as linhas que a jornada achou na cópia
// (as janelas "do dia" são ancoradas na data mais recente da cópia): a métrica `sgh_linhas` soma por jornada
// e o limiar `count>0` reprova a rodada quando uma jornada só devolve busca vazia.
/* global __ENV, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const JORNADAS = ['login', 'ficha', 'listas', 'painel', 'relatorio'];

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 400);
const SUBIDA = __ENV.SUBIDA || '1m';
const PATAMAR = __ENV.PATAMAR || '3m';
const PAINEIS = Number(__ENV.PAINEIS || 20);

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    nominal: {
      executor: 'ramping-vus',
      exec: 'nominal',
      startVUs: 0,
      stages: [
        { duration: SUBIDA, target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    consulta_pesada: {
      executor: 'constant-vus',
      exec: 'pesada',
      vus: 2,
      duration: SUBIDA === '1m' && PATAMAR === '3m' ? '4m' : '1m',
    },
    paineis: {
      executor: 'constant-arrival-rate',
      exec: 'painel',
      rate: PAINEIS,
      timeUnit: '5s',
      duration: SUBIDA === '1m' && PATAMAR === '3m' ? '4m' : '1m',
      preAllocatedVUs: PAINEIS,
      maxVUs: PAINEIS * 2,
    },
  },
  thresholds: {
    // Só erro em massa reprova o cenário nominal inteiro.
    'http_req_failed{cenario:nominal}': ['rate<0.5'],
    // Revisão do M35: limiares ligados às metas do cap-14 §14.5 onde a jornada aproxima uma delas (login p95 < 2 s;
    // abrir a ficha como aproximação de abrir o prontuário, p95 < 1,5 s). As rotas são as de leitura de carga (só
    // contagens): chamar senha, prescrever, dispensar e fechar conta NÃO são medidos aqui (gravam; ficam para a
    // homologação, M36), e o relatório de prontidão os declara como metas não medidas.
    'http_req_duration{jornada:login}': ['p(95)<2000'],
    'http_req_duration{jornada:ficha}': ['p(95)<1500'],
    // Sem meta no §14.5: limites largos, só para o k6 resumir a submétrica.
    'http_req_duration{jornada:listas}': ['p(95)<600000'],
    'http_req_duration{jornada:painel}': ['p(95)<600000'],
    'http_req_duration{jornada:relatorio}': ['p(95)<600000'],
    // Falha por jornada: até 1% (antes, rate<=1 nunca reprovava).
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_failed{jornada:${j}}`, ['rate<0.01']])),
    // Nenhuma jornada pode medir só busca vazia (a linha de base não serviria para a liberação).
    ...Object.fromEntries(JORNADAS.map((j) => [`sgh_linhas{jornada:${j}}`, ['count>0']])),
  },
};

const tag = (cenario, jornada) => ({ tags: { cenario, jornada }, responseType: 'text' });

/** Soma as linhas devolvidas (`n` da resposta) na métrica da jornada. */
function contar(r, jornada) {
  if (r.status !== 200) return;
  linhas.add(lerN(r.body), { jornada });
}

function lerN(corpo) {
  try {
    return Number(JSON.parse(corpo).n) || 0;
  } catch {
    return 0;
  }
}

export function nominal() {
  if (__ITER === 0) {
    const r = http.get(`${BASE}/api/carga/login/${Math.floor(Math.random() * 1e6)}`, tag('nominal', 'login'));
    check(r, { 'login 200': (x) => x.status === 200 });
    contar(r, 'login');
    sleep(1);
  }
  const ficha = http.get(
    `${BASE}/api/carga/ficha/${Math.floor(Math.random() * 1e6)}`,
    tag('nominal', 'ficha'),
  );
  check(ficha, { 'ficha 200': (x) => x.status === 200 });
  contar(ficha, 'ficha');
  sleep(2 + Math.random() * 3);
  const listas = http.get(`${BASE}/api/carga/listas`, tag('nominal', 'listas'));
  check(listas, { 'listas 200': (x) => x.status === 200 });
  contar(listas, 'listas');
  sleep(3 + Math.random() * 5);
}

export function pesada() {
  const r = http.get(`${BASE}/api/carga/relatorio`, {
    ...tag('consulta_pesada', 'relatorio'),
    timeout: '60s',
  });
  check(r, { 'relatório 200': (x) => x.status === 200 });
  contar(r, 'relatorio');
  sleep(5);
}

export function painel() {
  const r = http.get(`${BASE}/api/carga/painel`, tag('paineis', 'painel'));
  check(r, { 'painel 200': (x) => x.status === 200 });
  contar(r, 'painel');
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
