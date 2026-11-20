// k6 da prescrição (M24; ficha, seção 10; cap-14 §14.5: prescrever p95 < 2 s), rodado por `pnpm k6 -- prescricao`
// na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com a carga do legado simulada pelo
// runner ao mesmo tempo. Jornadas: a lista das prescrições do atendimento, a busca do item prescritível (p95 <
// 200 ms) e a prescrição aberta com itens,
// horários e prova e as verificações de apoio à decisão com os horários previstos que o "Assinar" faz antes de
// gravar. A prescrição é sorteada DENTRO da API (a rota /api/carga/prescricao existe só em dev e
// responde só `n`): nenhum dado de paciente passa pelo k6. A gravação não entra (na cópia compartilhada o executor
// de dev é só de leitura).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const JORNADAS = ['prescricao-lista', 'prescricao-leitura', 'prescricao-verificar', 'prescricao-busca'];
/** Ficha do M24, seção 4: a busca do item prescritível com p95 < 200 ms (as demais jornadas, < 2 s). */
const LIMITE_P95 = { 'prescricao-busca': 200 };

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 60);
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
      JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, [`p(95)<${LIMITE_P95[j] ?? 2000}`]]),
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
  const jornada = `prescricao-${parte}`;
  const r = http.get(`${BASE}/api/carga/prescricao/${parte}/${sorteio}`, {
    tags: { cenario: 'assistencia', jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function assistencia() {
  // O prescritor abre as prescrições do atendimento, abre a vigente e confere itens e horários.
  const sorteio = Math.floor(Math.random() * 1e6);
  abrir('lista', sorteio);
  sleep(1 + Math.random() * 2);
  // A busca do item a incluir (uma tecla depois da outra: três termos).
  for (let k = 0; k < 3; k++) abrir('busca', sorteio + k);
  sleep(2 + Math.random() * 3);
  abrir('leitura', sorteio);
  sleep(3 + Math.random() * 3);
  // Antes de assinar: as verificações de apoio à decisão e os horários previstos (sem gravar).
  abrir('verificar', sorteio);
  sleep(3 + Math.random() * 3);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
