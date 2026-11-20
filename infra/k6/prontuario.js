// k6 do prontuário ao vivo (M15; ficha, seção 10 e critério de aceite: p95 < 1,5 s para abrir o prontuário com
// a carga somada), rodado por `pnpm k6 -- prontuario` na imagem grafana/k6 com tag e digest, contra a API local
// e a cópia de dev, com a carga do legado simulada pelo runner ao mesmo tempo. Duas jornadas: abrir a lista dos
// registros do paciente e abrir o registro mais novo na aba "como emitido". O paciente é escolhido DENTRO da API
// (a rota /api/carga/prontuario existe só em dev e responde só `n`): nenhum dado de paciente passa pelo k6.
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
// M23 (regra 19): mais o cabeçalho fixo e a linha do tempo do prontuário de uso diário.
const JORNADAS = ['prontuario-lista', 'prontuario-registro', 'prontuario-cabecalho'];

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
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, ['p(95)<1500']])),
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
  const jornada = `prontuario-${parte}`;
  const r = http.get(`${BASE}/api/carga/prontuario/${parte}/${sorteio}`, {
    tags: { cenario: 'assistencia', jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function assistencia() {
  // O profissional abre o prontuário, lê a lista, abre o registro mais novo e lê (tempo de leitura).
  const sorteio = Math.floor(Math.random() * 1e6);
  abrir('cabecalho', sorteio);
  sleep(1 + Math.random() * 2);
  abrir('lista', sorteio);
  sleep(2 + Math.random() * 3);
  abrir('registro', sorteio);
  sleep(5 + Math.random() * 5);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
