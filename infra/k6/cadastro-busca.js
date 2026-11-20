// k6 da busca de paciente (M11; ficha, seção 10 e critério de aceite: p95 < 500 ms), rodado por
// `pnpm k6 -- cadastro-busca` na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com
// a carga do legado simulada pelo runner ao mesmo tempo (carga somada). Quatro jornadas: busca por nome
// (duas palavras), por nome da mãe, por telefone (8 últimos dígitos) e por CPF. O termo é montado DENTRO da
// API a partir do paciente sorteado (a rota /api/carga/busca existe só em dev e responde só `n`): nenhum dado
// de paciente passa pelo k6. Limiar: p95 < 500 ms em cada jornada; nenhuma jornada só com busca vazia.
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const JORNADAS = ['busca-nome', 'busca-mae', 'busca-telefone', 'busca-cpf'];

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
    recepcao: {
      executor: 'ramping-vus',
      exec: 'recepcao',
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
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, ['p(95)<500']])),
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

function buscar(tipo) {
  const jornada = `busca-${tipo}`;
  const r = http.get(`${BASE}/api/carga/busca/${tipo}/${Math.floor(Math.random() * 1e6)}`, {
    tags: { cenario: 'recepcao', jornada },
    responseType: 'text',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

export function recepcao() {
  // A recepção busca, lê a lista e confere (tempo de leitura entre as buscas).
  buscar('nome');
  sleep(1 + Math.random() * 2);
  buscar('mae');
  sleep(1 + Math.random() * 2);
  buscar('telefone');
  sleep(1 + Math.random() * 2);
  buscar('cpf');
  sleep(2 + Math.random() * 3);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
