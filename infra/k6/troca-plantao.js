// k6 da troca de plantão (M27; ficha, seção 10; cap-14 §14.2.7): na passagem do turno, os médicos que chegam abrem
// juntos a página inicial (a fila "Meus pacientes") e os prontuários e as prescrições dos pacientes dela — o pico
// curto de leitura assistencial. Rodado por `pnpm k6 -- troca-plantao` contra a API local e a cópia de dev, com a
// carga do legado simulada pelo runner. Subida em 15 s até USUARIOS (padrão 120), patamar curto e descida: a fila do
// médico p95 < 1,5 s (ficha do M27, seção 4), abrir o prontuário p95 < 1,5 s e a prescrição p95 < 2 s (cap-14 §14.5).
// Os médicos, os pacientes e as prescrições são sorteados DENTRO da API (rotas /api/carga, só em dev, só `n`).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 120);
const SUBIDA = __ENV.SUBIDA || '15s';
const PATAMAR = __ENV.PATAMAR || '1m';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

const LIMITE_P95 = {
  'worklist-medico': 1500,
  'prontuario-cabecalho': 1500,
  'prontuario-lista': 1500,
  'prescricao-lista': 2000,
};
const JORNADAS = Object.keys(LIMITE_P95);

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    plantao: {
      executor: 'ramping-vus',
      exec: 'plantonista',
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
    tags: { cenario: 'plantao', jornada },
    responseType: 'text',
    timeout: '60s',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function plantonista() {
  const s = Math.floor(Math.random() * 1e6);
  ler('worklist-medico', `worklist/medico/${s}`);
  sleep(1 + Math.random());
  // Os pacientes da fila, um atrás do outro: a lista de registros e o cabeçalho; a prescrição do atendimento.
  for (let k = 0; k < 3; k++) {
    ler('prontuario-lista', `prontuario/lista/${s + k}`);
    ler('prontuario-cabecalho', `prontuario/cabecalho/${s + k}`);
    ler('prescricao-lista', `prescricao/lista/${s + k}`);
    sleep(1 + Math.random() * 2);
  }
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
