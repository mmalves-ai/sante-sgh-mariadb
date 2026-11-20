// k6 do M50, etapa 2 (ficha, seções 10 e 11: `pnpm k6 -- portal-agenda`): a busca de horários e a marcação pelo portal
// do paciente EM RAJADA (o pico de quando o hospital abre a agenda do mês), somada à carga do legado simulada pelo
// `pnpm k6`, contra a API local e a cópia de dev (rotas /api/carga/portal, só em AMBIENTE=dev, só contagens).
// Jornadas: a busca de horários (as agendas oferecidas, teto 200), "meus agendamentos" e as leituras da marcação pelo
// portal (as da receita do M17 antes de gravar). A gravação não vai ao k6 (o k6 não grava na cópia; o tempo da gravação
// pelo portal é o da marcação do M17 na integração e, com a carga de verdade, na homologação).
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
    // Os pacientes chegam aos poucos e, de repente, a rajada (três vezes mais) por 30 s; depois volta.
    pacientes: {
      executor: 'ramping-vus',
      exec: 'paciente',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: USUARIOS * 3 },
        { duration: '30s', target: USUARIOS * 3 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{jornada:portal-horarios}': ['p(95)<500'],
    'http_req_duration{jornada:portal-agendamentos}': ['p(95)<500'],
    // A meta proposta pela ficha do M50 para a marcação com a carga somada (regra comum 8).
    'http_req_duration{jornada:portal-marcacao}': ['p(95)<1000'],
    'http_req_failed{jornada:portal-horarios}': ['rate<0.01'],
    'http_req_failed{jornada:portal-agendamentos}': ['rate<0.01'],
    'http_req_failed{jornada:portal-marcacao}': ['rate<0.01'],
    'sgh_linhas{jornada:portal-horarios}': ['count>0'],
    'sgh_linhas{jornada:portal-agendamentos}': ['count>0'],
    'sgh_linhas{jornada:portal-marcacao}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'portal-agenda', jornada }, responseType: 'text' });

function contar(r, jornada) {
  if (r.status !== 200) return;
  try {
    linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada });
  } catch {
    linhas.add(0, { jornada });
  }
}

function jornada(nome, rota) {
  const r = http.get(`${BASE}/api/carga/portal/${rota}/${Math.floor(Math.random() * 1e6)}`, tag(nome));
  check(r, { [`${nome} 200`]: (x) => x.status === 200 });
  contar(r, nome);
}

export function paciente() {
  if (Math.random() < 0.4) jornada('portal-agendamentos', 'agendamentos');
  jornada('portal-horarios', 'horarios');
  sleep(0.3 + Math.random());
  jornada('portal-marcacao', 'marcacao');
  sleep(1 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
