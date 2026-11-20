// k6 do SADT (M26; ficha, seção 10: 2 mil exames por dia com picos de coleta e liberação; cap-14 §14.2.7 e §14.5),
// rodado por `pnpm k6 -- sadt` na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com a
// carga do legado simulada pelo runner ao mesmo tempo. Jornadas: os exames do setor (a receber, a liberar,
// liberados), a lista de coleta, o mapa de trabalho, a fila de liberação e o ciclo da vigia dos valores críticos
// (a consulta que a vigia repete para o aviso < 1 min da liberação feita em qualquer dos dois sistemas). O dia é o
// último de movimento do laboratório, escolhido DENTRO da API (a rota /api/carga/sadt existe só em dev e responde
// só `n`): nenhum dado de paciente passa pelo k6. A gravação não entra (na cópia compartilhada o executor de dev é
// só de leitura; D-K6-26).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const JORNADAS = ['sadt-setor', 'sadt-coleta', 'sadt-mapa', 'sadt-liberacao', 'sadt-vigia'];
/** Ficha do M26, seção 4: p95 < 1 s nas listas; a coleta < 800 ms; o ciclo da vigia < 1 s (cabe no 1 min do aviso). */
const LIMITE_P95 = { 'sadt-coleta': 800 };

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
// 20 telas do diagnóstico ao mesmo tempo (laboratório, coleta, imagem e recepção num turno de 2 mil exames por dia;
// D-K6-26); USUARIOS muda.
const USUARIOS = Number(__ENV.USUARIOS || 20);
const SUBIDA = __ENV.SUBIDA || '30s';
const PATAMAR = __ENV.PATAMAR || '2m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    laboratorio: {
      executor: 'ramping-vus',
      exec: 'laboratorio',
      startVUs: 0,
      stages: [
        { duration: SUBIDA, target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    // A vigia: um ciclo a cada 2 s durante todo o teste (o processo da API faz o mesmo sozinho).
    vigia: {
      executor: 'constant-arrival-rate',
      exec: 'vigia',
      rate: 1,
      timeUnit: '2s',
      duration: '2m40s',
      preAllocatedVUs: 2,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    ...Object.fromEntries(
      JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, [`p(95)<${LIMITE_P95[j] ?? 1000}`]]),
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

function abrir(parte, sorteio, cenario) {
  const jornada = `sadt-${parte}`;
  const r = http.get(`${BASE}/api/carga/sadt/${parte}/${sorteio}`, {
    tags: { cenario, jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function laboratorio() {
  // O técnico abre a lista do setor, a coleta e o mapa; o biomédico, a fila de liberação.
  const sorteio = Math.floor(Math.random() * 1e6);
  abrir('setor', sorteio, 'laboratorio');
  sleep(1 + Math.random() * 2);
  if (sorteio % 2 === 0) abrir('coleta', sorteio, 'laboratorio');
  else abrir('mapa', sorteio, 'laboratorio');
  sleep(2 + Math.random() * 3);
  abrir('liberacao', sorteio, 'laboratorio');
  sleep(3 + Math.random() * 3);
}

export function vigia() {
  abrir('vigia', 0, 'vigia');
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
