// k6 do painel de leitos ao vivo (M16; ficha, seção 11: "consultas do vigia ao Firebird por ciclo iguais com 1 e
// com 50 telas"), rodado por `pnpm k6 -- painel-leitos` na imagem grafana/k6 com tag e digest, contra a API local e
// a cópia de dev, com a carga do legado simulada pelo runner ao mesmo tempo. Fase 1 (40 s): uma tela escuta o
// vigia e relê o painel; fase 2: 50 telas (USUARIOS). Um medidor lê as contagens do vigia a cada 5 s (só números:
// ciclos, consultas do último ciclo, telas). Nenhum dado de paciente passa pelo k6.
/* global __ENV, __VU */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const consultasCiclo = new Trend('sgh_consultas_ciclo');
const telas = new Trend('sgh_telas');

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 50);
const FASE1 = 40;
const PATAMAR = __ENV.PATAMAR || '60s';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    uma: { executor: 'constant-vus', exec: 'tela', vus: 1, duration: `${FASE1}s` },
    cinquenta: {
      executor: 'constant-vus',
      exec: 'tela',
      vus: USUARIOS,
      duration: PATAMAR,
      startTime: `${FASE1 + 5}s`,
    },
    medidor: { executor: 'constant-vus', exec: 'medidorUma', vus: 1, duration: `${FASE1 + 5}s` },
    medidor50: {
      executor: 'constant-vus',
      exec: 'medidorCinquenta',
      vus: 1,
      duration: PATAMAR,
      startTime: `${FASE1 + 20}s`,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{jornada:leitos-painel}': ['p(95)<1500'],
    'sgh_consultas_ciclo{jornada:vigia-uma}': ['max<=1'],
    'sgh_consultas_ciclo{jornada:vigia-cinquenta}': ['max<=1'],
    'sgh_telas{jornada:vigia-cinquenta}': [`max>=${USUARIOS}`],
    'sgh_linhas{jornada:leitos-painel}': ['count>0'],
    'sgh_linhas{jornada:vigia-uma}': ['count>0'],
    'sgh_linhas{jornada:vigia-cinquenta}': ['count>0'],
  },
};

function json(r) {
  try {
    return JSON.parse(r.body);
  } catch {
    return {};
  }
}

let assinou = false;

export function tela() {
  // A tela abre o canal de eventos uma vez e relê o painel a cada aviso (aqui, a cada 1 a 3 s).
  if (!assinou) {
    http.get(`${BASE}/api/carga/leitos/assinar/${__VU}`, { tags: { jornada: 'leitos-assinar' } });
    assinou = true;
  }
  const r = http.get(`${BASE}/api/carga/leitos/painel/${__VU}`, { tags: { jornada: 'leitos-painel' } });
  check(r, { 'leitos-painel 200': (x) => x.status === 200 });
  if (r.status === 200) linhas.add(Number(json(r).n) || 0, { jornada: 'leitos-painel' });
  sleep(1 + Math.random() * 2);
}

function medir(jornada) {
  const r = http.get(`${BASE}/api/carga/leitos/vigia`, { tags: { jornada } });
  if (r.status === 200) {
    const v = json(r);
    linhas.add(Number(v.ciclos) || 0, { jornada });
    if (Number(v.ciclos) > 0) consultasCiclo.add(Number(v.consultasUltimoCiclo) || 0, { jornada });
    telas.add(Number(v.telas) || 0, { jornada });
  }
  sleep(5);
}

export function medidorUma() {
  medir('vigia-uma');
}

export function medidorCinquenta() {
  medir('vigia-cinquenta');
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
