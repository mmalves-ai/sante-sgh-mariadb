// k6 da enfermagem beira-leito (M25; ficha, seções 4 e 10, regra 16; cap-14 §14.5), rodado por `pnpm k6 -- checagem`
// na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com a carga do legado simulada pelo
// runner ao mesmo tempo. Jornadas da beira do leito sobre a prescrição REAL sorteada DENTRO da API (a rota
// /api/carga/enfermagem existe só em dev e responde só `n`; nenhum dado de paciente passa pelo k6): a linha do
// tempo do turno da unidade (p95 < 1 s), os horários do paciente no tablet (p95 < 500 ms), a releitura do horário
// antes de checar (p95 < 100 ms) e o histórico do horário (p95 < 300 ms). A checagem (gravação) é medida no teste de
// integração na cópia, em transação desfeita (o executor de dev da cópia compartilhada é só de leitura; D-K6-25).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const LIMITE_P95 = {
  'enfermagem-turno': 1000,
  'enfermagem-paciente': 500,
  'enfermagem-releitura': 100,
  'enfermagem-historico': 300,
};
const JORNADAS = Object.keys(LIMITE_P95);

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
// 20 aparelhos ao mesmo tempo: a beira do leito das unidades-piloto de um estabelecimento (D-K6-25).
const USUARIOS = Number(__ENV.USUARIOS || 20);
const SUBIDA = __ENV.SUBIDA || '30s';
const PATAMAR = __ENV.PATAMAR || '2m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    assistencia: {
      executor: 'ramping-vus',
      exec: 'assistencia',
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

function abrir(parte, sorteio) {
  const jornada = `enfermagem-${parte}`;
  const r = http.get(`${BASE}/api/carga/enfermagem/${parte}/${sorteio}`, {
    tags: { cenario: 'assistencia', jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function assistencia() {
  // A enfermagem abre a linha do tempo do turno, o paciente no tablet, relê o horário antes de checar e o histórico.
  const sorteio = Math.floor(Math.random() * 1e6);
  abrir('turno', sorteio);
  sleep(2 + Math.random() * 3);
  abrir('paciente', sorteio);
  sleep(1 + Math.random() * 2);
  abrir('releitura', sorteio);
  sleep(1 + Math.random() * 2);
  abrir('historico', sorteio);
  sleep(2 + Math.random() * 3);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
