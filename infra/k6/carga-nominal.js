// k6 da carga nominal da Fase 2 (M27; ficha, seção 10 e 11; cap-14 §14.2.7 e §14.5), rodado por
// `pnpm k6 -- carga-nominal` na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com a carga do
// legado simulada pelo runner ao mesmo tempo (as operações-chave do outro sistema, medidas antes e durante). Até 400
// usuários somados, nos perfis da Fase 2, cada um na sua jornada: o médico (a fila de trabalho, o prontuário e a
// prescrição), a recepção (a fila de senhas, a fila de trabalho com as guias e a agenda), o diagnóstico (setor e
// liberação), a coordenação de leitos (o painel) e a entrada (login). Os limiares são os SLOs do cap-14 §14.5: login
// p95 < 2 s; abrir prontuário p95 < 1,5 s; prescrever p95 < 2 s; chamar senha (a fila do guichê) < 1 s; as filas de
// trabalho da página inicial (M27, seção 4): médico p95 < 1,5 s, recepção p95 < 1 s. Os pacientes, os médicos e as
// prescrições são sorteados DENTRO da API (rotas /api/carga, só em dev, respondem só `n`): nenhum dado de paciente
// passa pelo k6. Só leitura (na cópia compartilhada o executor de dev é só de leitura).
/* global __ENV, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');

const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 400);
const SUBIDA = __ENV.SUBIDA || '1m';
const PATAMAR = __ENV.PATAMAR || '3m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

/** A parcela de cada perfil nos 400 usuários (a Fase 2 inteira no ar ao mesmo tempo). */
const PERFIS = { medico: 0.35, recepcao: 0.3, diagnostico: 0.15, leitos: 0.1, entrada: 0.1 };
const vus = (p) => Math.max(1, Math.round(USUARIOS * PERFIS[p]));

/** SLOs do cap-14 §14.5 e da ficha do M27 (seção 4) por jornada (ms, p95). */
const LIMITE_P95 = {
  login: 2000,
  'worklist-medico': 1500,
  'prontuario-cabecalho': 1500,
  'prontuario-registro': 1500,
  'prescricao-leitura': 2000,
  'prescricao-verificar': 2000,
  'worklist-recepcao': 1000,
  'senhas-fila': 1000,
  'agenda-pauta': 1000,
  'sadt-setor': 1000,
  'sadt-liberacao': 1000,
  'leitos-painel': 1000,
};
const JORNADAS = Object.keys(LIMITE_P95);

const rampa = (alvo) => [
  { duration: SUBIDA, target: alvo },
  { duration: PATAMAR, target: alvo },
  { duration: '10s', target: 0 },
];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: Object.fromEntries(
    Object.keys(PERFIS).map((p) => [
      p,
      { executor: 'ramping-vus', exec: p, startVUs: 0, stages: rampa(vus(p)), gracefulRampDown: '10s' },
    ]),
  ),
  thresholds: {
    http_req_failed: ['rate<0.01'],
    ...Object.fromEntries(
      JORNADAS.map((j) => [`http_req_duration{jornada:${j}}`, [`p(95)<${LIMITE_P95[j]}`]]),
    ),
    ...Object.fromEntries(JORNADAS.map((j) => [`http_req_failed{jornada:${j}}`, ['rate<0.01']])),
    // Nenhuma jornada pode medir só leitura vazia.
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

function ler(jornada, caminho, cenario) {
  const r = http.get(`${BASE}/api/carga/${caminho}`, {
    tags: { cenario, jornada },
    responseType: 'text',
    timeout: '60s',
  });
  check(r, { [`${jornada} 200`]: (x) => x.status === 200 });
  if (r.status === 200) linhas.add(lerN(r.body), { jornada });
}

const sorteio = () => Math.floor(Math.random() * 1e6);

export function medico() {
  // A página inicial na fila do médico; abre o prontuário do paciente e a prescrição dele; volta à fila.
  const s = sorteio();
  ler('worklist-medico', `worklist/medico/${s}`, 'medico');
  sleep(2 + Math.random() * 3);
  ler('prontuario-cabecalho', `prontuario/cabecalho/${s}`, 'medico');
  sleep(1 + Math.random() * 2);
  ler('prontuario-registro', `prontuario/registro/${s}`, 'medico');
  sleep(3 + Math.random() * 3);
  ler('prescricao-leitura', `prescricao/leitura/${s}`, 'medico');
  sleep(2 + Math.random() * 3);
  ler('prescricao-verificar', `prescricao/verificar/${s}`, 'medico');
  sleep(4 + Math.random() * 4);
}

export function recepcao() {
  // O guichê: a fila de senhas, a página inicial da recepção (senhas e guias) e a pauta do dia da agenda.
  const s = sorteio();
  ler('senhas-fila', `senhas/fila/${s}`, 'recepcao');
  sleep(1 + Math.random() * 2);
  ler('worklist-recepcao', `worklist/recepcao/${s}`, 'recepcao');
  sleep(2 + Math.random() * 3);
  ler('agenda-pauta', `agenda/pauta/${s}`, 'recepcao');
  sleep(3 + Math.random() * 3);
}

export function diagnostico() {
  const s = sorteio();
  ler('sadt-setor', `sadt/setor/${s}`, 'diagnostico');
  sleep(2 + Math.random() * 3);
  ler('sadt-liberacao', `sadt/liberacao/${s}`, 'diagnostico');
  sleep(3 + Math.random() * 4);
}

export function leitos() {
  ler('leitos-painel', `leitos/painel/${sorteio()}`, 'leitos');
  sleep(5);
}

export function entrada() {
  if (__ITER === 0) ler('login', `login/${sorteio()}`, 'entrada');
  sleep(5 + Math.random() * 5);
  ler('login', `login/${sorteio()}`, 'entrada');
  sleep(10 + Math.random() * 10);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
