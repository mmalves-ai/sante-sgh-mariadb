// k6 da consulta pesada do catálogo de relatórios (M34; ficha, seção 11: "relatório grande cancelado pelo limite do
// adaptador, sem transação parada no banco"; cap-14 §14.2.7 e cap-10 §10.11), rodado por `pnpm k6 -- consulta-pesada`
// na imagem grafana/k6 com tag e digest, contra a API local e a cópia de dev, com a carga do legado simulada pelo
// runner ao mesmo tempo. Cinco telas pedem, sem parar, o relatório grande (o faturamento de seis anos e meio, mês a
// mês) com o tempo máximo de 3 s: toda resposta tem de vir CANCELADA (nunca o relatório inteiro) e em pouco mais que
// o limite; o runner confere pelo MON$ que nenhuma transação do novo passou do limite nem ficou parada. A rota
// /api/carga/relatorio-catalogo existe só em dev e responde só se cancelou e quanto durou.
/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const linhas = new Counter('sgh_linhas');
const canceladas = new Rate('sgh_canceladas');
// O tempo do executor (com a conexão em mãos); a espera pelo pool (4 conexões para 5 telas) fica na duração HTTP.
const executor = new Trend('sgh_executor_ms', true);
const espera = new Trend('sgh_espera_pool_ms', true);
const BASE = __ENV.BASE || 'http://127.0.0.1:3300';
const USUARIOS = Number(__ENV.USUARIOS || 5);
const PATAMAR = __ENV.PATAMAR || '1m';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE))
  throw new Error('BASE fora do loopback: recusado.');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    pesada: {
      executor: 'constant-vus',
      exec: 'pesada',
      vus: USUARIOS,
      duration: PATAMAR,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // O limite é 3 s; a última fatia em andamento termina antes de o executor cancelar (margem de 3 s). A duração
    // HTTP inclui a espera pelo pool (5 telas para 4 conexões): indicação, com teto folgado.
    sgh_executor_ms: ['p(95)<6000'],
    'http_req_duration{jornada:relatorio-pesado}': ['p(95)<12000'],
    'http_req_failed{jornada:relatorio-pesado}': ['rate<0.01'],
    'sgh_linhas{jornada:relatorio-pesado}': ['count>0'],
    sgh_canceladas: ['rate>0.99'],
  },
};

export function pesada() {
  const r = http.get(`${BASE}/api/carga/relatorio-catalogo`, { tags: { jornada: 'relatorio-pesado' } });
  const ok = check(r, { 'resposta 200': (x) => x.status === 200 });
  let cancelada = false;
  if (ok) {
    const b = r.json();
    cancelada = b && b.cancelada === true;
    linhas.add(b && typeof b.n === 'number' ? b.n : 0, { jornada: 'relatorio-pesado' });
    if (b && typeof b.ms === 'number') executor.add(b.ms);
    if (b && typeof b.esperaMs === 'number') espera.add(b.esperaMs);
  }
  canceladas.add(cancelada);
  sleep(0.5);
}

export function handleSummary(dados) {
  return { '/saida/resumo.json': JSON.stringify(dados) };
}
