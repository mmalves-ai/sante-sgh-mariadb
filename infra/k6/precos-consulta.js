// k6 do M12 (ficha, seção 11: `pnpm k6 -- precos-consulta`, meta p95 < 500 ms): a consulta de valor vigente
// (maior DATA ≤ data-base, a mesma leitura da tela) e o contrato em abas, contra a API local e a cópia de dev
// (rotas /api/carga, só em AMBIENTE=dev, só contagens), com a carga do legado simulada pelo `pnpm k6`.
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 50);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    faturamento: {
      executor: 'ramping-vus',
      exec: 'faturamento',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Meta da ficha do M12: consulta de valor vigente com p95 < 500 ms.
    'http_req_duration{jornada:preco}': ['p(95)<500'],
    'http_req_duration{jornada:contrato}': ['p(95)<500'],
    'http_req_failed{jornada:preco}': ['rate<0.01'],
    'http_req_failed{jornada:contrato}': ['rate<0.01'],
    'sgh_linhas{jornada:preco}': ['count>0'],
    'sgh_linhas{jornada:contrato}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'faturamento', jornada }, responseType: 'text' });

function contar(r, jornada) {
  if (r.status !== 200) return;
  try {
    linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada });
  } catch {
    linhas.add(0, { jornada });
  }
}

export function faturamento() {
  const p = http.get(`${BASE}/api/carga/preco/${Math.floor(Math.random() * 1e6)}`, tag('preco'));
  check(p, { 'preço 200': (x) => x.status === 200 });
  contar(p, 'preco');
  sleep(0.5 + Math.random());
  const c = http.get(`${BASE}/api/carga/contrato/${Math.floor(Math.random() * 1e6)}`, tag('contrato'));
  check(c, { 'contrato 200': (x) => x.status === 200 });
  contar(c, 'contrato');
  sleep(1 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
