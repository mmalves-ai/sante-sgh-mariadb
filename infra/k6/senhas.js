// k6 do M19 (ficha, seção 11: `pnpm k6 -- senhas`): o pico da manhã da recepção com a carga somada, contra a API
// local e a cópia de dev (rotas /api/carga/senhas, só em AMBIENTE=dev, só contagens), com a carga do legado simulada
// pelo `pnpm k6`. Jornadas: a fila do guichê (relida a cada 5 s pela tela: as senhas do dia da recepção e os guichês
// em uso), o painel do supervisor (a cada 15 s) e a estrutura do guichê. A chamada (UPDATE sem espera) não vai ao k6
// (o k6 não grava na cópia; medida na integração, com a corrida de dois guichês).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 40);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    guiches: {
      executor: 'ramping-vus',
      exec: 'guiche',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // p95 < 500 ms na fila do guichê e na estrutura; o painel do supervisor (todas as senhas do dia e os indicadores)
    // < 1 s; com a carga do legado simulada ao mesmo tempo.
    'http_req_duration{jornada:fila}': ['p(95)<500'],
    'http_req_duration{jornada:supervisor}': ['p(95)<1000'],
    'http_req_duration{jornada:estrutura}': ['p(95)<500'],
    'http_req_failed{jornada:fila}': ['rate<0.01'],
    'http_req_failed{jornada:supervisor}': ['rate<0.01'],
    'http_req_failed{jornada:estrutura}': ['rate<0.01'],
    'sgh_linhas{jornada:fila}': ['count>0'],
    'sgh_linhas{jornada:supervisor}': ['count>0'],
    'sgh_linhas{jornada:estrutura}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'senhas', jornada }, responseType: 'text' });

function contar(r, jornada) {
  if (r.status !== 200) return;
  try {
    linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada });
  } catch {
    linhas.add(0, { jornada });
  }
}

function jornada(nome) {
  const r = http.get(`${BASE}/api/carga/senhas/${nome}/${Math.floor(Math.random() * 1e6)}`, tag(nome));
  check(r, { [`${nome} 200`]: (x) => x.status === 200 });
  contar(r, nome);
}

export function guiche() {
  // A tela do guichê relê a fila a cada 5 s; um em cada dez abre o supervisor; a estrutura ao abrir a tela.
  if (Math.random() < 0.1) jornada('estrutura');
  jornada('fila');
  if (Math.random() < 0.1) jornada('supervisor');
  sleep(4 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
