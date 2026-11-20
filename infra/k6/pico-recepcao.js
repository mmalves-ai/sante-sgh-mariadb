// k6 do pico da recepção (M27; ficha, seção 10; cap-14 §14.2.7: o pico da manhã), rodado por
// `pnpm k6 -- pico-recepcao` contra a API local e a cópia de dev, com a carga do legado simulada pelo runner. A abertura
// do ambulatório: os guichês e as recepções entram juntos (subida em 20 s até USUARIOS, padrão 150) e ficam lendo a
// fila de senhas (chamar senha < 1 s, cap-14 §14.5), a fila de trabalho da recepção com as guias (p95 < 1 s, ficha do
// M27, seção 4) e o painel do supervisor, com pouco intervalo. As senhas e o dia são escolhidos DENTRO da API (rotas
// /api/carga, só em dev, só `n`). Só leitura.
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 150);
const SUBIDA = __ENV.SUBIDA || '20s';
const PATAMAR = __ENV.PATAMAR || '2m';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

const LIMITE_P95 = { 'senhas-fila': 1000, 'worklist-recepcao': 1000, 'senhas-supervisor': 1000 };
const JORNADAS = Object.keys(LIMITE_P95);

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    pico: {
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
    http_req_failed: ['rate<0.01'],
    ...Object.fromEntries(
      JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, [`p(95)<${LIMITE_P95[j]}`]]),
    ),
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_failed{jornada:${j}}`, ['rate<0.01']])),
    ...Object.fromEntries(JORNADAS.map((j) => [`sgh_linhas{jornada:${j}}`, ['count>0']])),
  },
};

function lerN(corpo) {
  try {
    return Number(JSON.parse(corpo).n) || 0;
  } catch {
    return 0;
  }
}

function ler(jornada, caminho) {
  const r = http.get(`${BASE}/api/carga/${caminho}`, {
    tags: { cenario: 'pico', jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function guiche() {
  const s = Math.floor(Math.random() * 1e6);
  ler('senhas-fila', `senhas/fila/${s}`);
  sleep(0.5 + Math.random());
  ler('worklist-recepcao', `worklist/recepcao/${s}`);
  sleep(0.5 + Math.random());
  if (s % 10 === 0) ler('senhas-supervisor', `senhas/supervisor/${s}`);
  sleep(1 + Math.random());
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
