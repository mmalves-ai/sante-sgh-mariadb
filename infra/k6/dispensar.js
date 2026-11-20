// k6 do M29 (ficha, seção 10: `pnpm k6 -- dispensar`): as leituras da farmácia com a carga somada, contra a API local
// e a cópia de dev (rotas /api/carga/farmacia, só em AMBIENTE=dev, só contagens), com a carga do legado simulada pelo
// `pnpm k6`. Jornadas: a fila de dispensação da unidade (ao abrir e a cada aviso), a entrega ao setor e os movimentos
// dos controlados. A gravação não vai ao k6 (o k6 não grava na cópia; a dispensação segue desligada, D-MOTOR-28): o
// tempo da confirmação com a baixa de estoque é medido na integração na cópia (D-K6-29).
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
// As telas da farmácia central e das satélites ao mesmo tempo (D-K6-29: 8; o `pnpm k6` passa USUARIOS).
const USUARIOS = Number(__ENV.USUARIOS || 8);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    farmaceuticos: {
      executor: 'ramping-vus',
      exec: 'farmaceutico',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USUARIOS },
        { duration: PATAMAR, target: USUARIOS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Ficha do M29, seção 11 (cap-14 §14.5): p95 < 2 s com a carga somada. As metas da seção 4 (a fila < 1 s, a entrega
    // < 500 ms, os controlados < 2 s) são da consulta sozinha, medidas fora do k6 (evidências §3; D-K6-29).
    'http_req_duration{jornada:farmacia-fila}': ['p(95)<2000'],
    'http_req_duration{jornada:farmacia-entregas}': ['p(95)<2000'],
    'http_req_duration{jornada:farmacia-controlados}': ['p(95)<2000'],
    'http_req_failed{jornada:farmacia-fila}': ['rate<0.01'],
    'http_req_failed{jornada:farmacia-entregas}': ['rate<0.01'],
    'http_req_failed{jornada:farmacia-controlados}': ['rate<0.01'],
    // As linhas devolvidas por jornada (o resumo do `pnpm k6` confere que nenhuma jornada mediu busca vazia).
    'sgh_linhas{jornada:farmacia-fila}': ['count>0'],
    'sgh_linhas{jornada:farmacia-entregas}': ['count>0'],
    'sgh_linhas{jornada:farmacia-controlados}': ['count>0'],
  },
};

const tag = (jornada) => ({ tags: { cenario: 'dispensar', jornada }, responseType: 'text' });

function jornada(parte) {
  const nome = `farmacia-${parte}`;
  const r = http.get(`${BASE}/api/carga/farmacia/${parte}/${Math.floor(Math.random() * 1e6)}`, tag(nome));
  check(r, { [`${nome} 200`]: (x) => x.status === 200 });
  if (r.status === 200) {
    try {
      linhas.add(Number(JSON.parse(r.body).n) || 0, { jornada: nome });
    } catch {
      linhas.add(0, { jornada: nome });
    }
  }
}

export function farmaceutico() {
  // Abre a fila, relê a fila (o aviso de prescrição nova), olha as entregas; um em cada quatro abre os controlados.
  jornada('fila');
  jornada('fila');
  jornada('entregas');
  if (Math.random() < 0.25) jornada('controlados');
  sleep(3 + Math.random() * 2);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
