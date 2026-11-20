// k6 do M28 (ficha, seção 10: `pnpm k6 -- estoque-saida`): as leituras da tela de saída do almoxarifado com a carga
// somada, contra a API local e a cópia de dev (rotas /api/carga/estoque, só em AMBIENTE=dev, só contagens), com a
// carga do legado simulada pelo `pnpm k6`. Jornadas: o saldo do local (ao abrir a tela), os lotes do item escolhido
// (a cada item incluído), as saídas da competência e a fila das requisições (relida pela tela). A gravação não vai ao
// k6 (o k6 não grava na cópia; os documentos de estoque seguem desligados, D-MOTOR-28).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 20);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    almoxarifes: {
      executor: 'ramping-vus',
      exec: 'almoxarife',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Meta a propor (cap-14 §14.5 não fixa): p95 < 500 ms no saldo, nos lotes e nas requisições; < 1 s nas saídas.
    'http_req_duration{jornada:estoque-saldos}': ['p(95)<500'],
    'http_req_duration{jornada:estoque-lotes}': ['p(95)<500'],
    'http_req_duration{jornada:estoque-saidas}': ['p(95)<1000'],
    'http_req_duration{jornada:estoque-requisicoes}': ['p(95)<500'],
    'http_req_failed{jornada:estoque-saldos}': ['rate<0.01'],
    'http_req_failed{jornada:estoque-lotes}': ['rate<0.01'],
    'http_req_failed{jornada:estoque-saidas}': ['rate<0.01'],
    'http_req_failed{jornada:estoque-requisicoes}': ['rate<0.01'],
    'sgh_linhas{jornada:estoque-saldos}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'estoque-saida', jornada }, responseType: 'text' });

function jornada(parte) {
  const nome = `estoque-${parte}`;
  const r = http.get(`${BASE}/api/carga/estoque/${parte}/${Math.floor(Math.random() * 1e6)}`, tag(nome));
  check(r, { [`${nome} 200`]: (x) => x.status === 200 });
  if (r.status === 200) {
    try {
      linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada: nome });
    } catch {
      linhas.add(0, { jornada: nome });
    }
  }
}

export function almoxarife() {
  // Abre a tela (saldo do local), inclui dois itens (lotes), relê a lista de saídas; um em cada três abre a fila.
  jornada('saldos');
  jornada('lotes');
  jornada('lotes');
  jornada('saidas');
  if (Math.random() < 0.33) jornada('requisicoes');
  sleep(3 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
