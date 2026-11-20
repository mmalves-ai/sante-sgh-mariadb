// k6 do M17 (ficha, seção 11: `pnpm k6 -- agenda`): busca de vaga e marcação com a carga somada, contra a API local
// e a cópia de dev (rotas /api/carga/agenda, só em AMBIENTE=dev, só contagens), com a carga do legado simulada pelo
// `pnpm k6`. Jornadas: a busca de vaga (a consulta da tela), as leituras da marcação (as da receita antes de
// gravar) e a pauta do dia. A gravação da marcação não vai ao k6 (o k6 não grava na cópia; medida na integração).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 60);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    callcenter: {
      executor: 'ramping-vus',
      exec: 'callcenter',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // p95 < 500 ms por jornada (como as buscas do M11 e do M12), com a carga do legado simulada ao mesmo tempo.
    'http_req_duration{jornada:vagas}': ['p(95)<500'],
    'http_req_duration{jornada:marcacao}': ['p(95)<500'],
    'http_req_duration{jornada:pauta}': ['p(95)<500'],
    'http_req_failed{jornada:vagas}': ['rate<0.01'],
    'http_req_failed{jornada:marcacao}': ['rate<0.01'],
    'http_req_failed{jornada:pauta}': ['rate<0.01'],
    'sgh_linhas{jornada:vagas}': ['count>0'],
    'sgh_linhas{jornada:marcacao}': ['count>0'],
    'sgh_linhas{jornada:pauta}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'agenda', jornada }, responseType: 'text' });

function contar(r, jornada) {
  if (r.status !== 200) return;
  try {
    linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada });
  } catch {
    linhas.add(0, { jornada });
  }
}

function jornada(nome) {
  const r = http.get(`${BASE}/api/carga/agenda/${nome}/${Math.floor(Math.random() * 1e6)}`, tag(nome));
  check(r, { [`${nome} 200`]: (x) => x.status === 200 });
  contar(r, nome);
}

export function callcenter() {
  jornada('vagas');
  sleep(0.5 + Math.random());
  jornada('marcacao');
  sleep(0.5 + Math.random());
  if (Math.random() < 0.3) jornada('pauta');
  sleep(1 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
