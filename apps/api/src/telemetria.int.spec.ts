// Regra 12 da ficha do M09 (telemetria.int.spec.ts): consulta à cópia com CPF sintético como parâmetro;
// nada do CPF no rastro OpenTelemetry nem no log pino (com a redação ligada). A consulta só conta linhas
// (COUNT), nenhuma linha de paciente sai do banco.
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ambienteEfetivo, caminhoArquivoAmbiente, lerConfiguracaoNucleo, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from './logger.js';

const raiz = resolve(import.meta.dirname, '../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
// CPF sintético (dígitos verificadores válidos, nenhum titular real conhecido) e nome fictício.
const CPF = '52998224725';
const exportador = new InMemorySpanExporter();
let nucleo: NucleoLegado;
let saida = '';
const destino = new Writable({
  write(pedaco, _cod, pronto) {
    saida += String(pedaco);
    pronto();
  },
});

beforeAll(() => {
  if ((env['AMBIENTE'] ?? 'dev') !== 'dev') throw new Error('Integração só em AMBIENTE=dev.');
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exportador)] }),
  );
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '1' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
});
afterAll(async () => {
  await nucleo?.encerrar();
  trace.disable();
});

describe('rastro e log sem dado pessoal', () => {
  it('consulta parametrizada com CPF sintético: span sem o valor; log redigido', async () => {
    const [cod] = nucleo.estabelecimentos.map((e) => e.codigo);
    const ctx = { rede: nucleo.rede, hospital: cod!, traceId: 'telemetria' };
    // Consulta neutra (tabela de sistema), com o CPF sintético como parâmetro: a API não conhece o SPDATA
    // (fronteira: só @sgh/legado monta SQL de tabela do legado).
    const linhas = await nucleo.consultar(
      ctx,
      'SELECT COUNT(*) N FROM RDB$DATABASE WHERE CAST(? AS VARCHAR(20)) IS NOT NULL',
      [CPF],
    );
    expect(typeof linhas[0]?.['N']).toBe('number');
    const log = pino(opcoesLogger('api', 'info'), destino);
    log.info(
      {
        cpf: CPF,
        nome: 'Paciente Fictício',
        telefone: '(22) 99999-0000',
        texto: 'evolução fictícia',
        linhas: linhas.length,
      },
      `consulta por CPF ${CPF} concluída`,
    );
    log.warn({ paciente: { CPF: CPF, prontuario: 1 } }, 'aviso');
    log.error(new Error(`falha com ${CPF}`));
    const spans = exportador.getFinishedSpans();
    const consulta = spans.find((s) => String(s.attributes['db.query.text']).includes('RDB$DATABASE'));
    expect(consulta?.attributes).toMatchObject({
      'db.system.name': 'firebird',
      'db.operation.name': 'SELECT',
      'db.query.parameter_count': 1,
      // Sem literais: até o tamanho do VARCHAR vira ?.
      'db.query.text': 'SELECT COUNT(*) N FROM RDB$DATABASE WHERE CAST(? AS VARCHAR(?)) IS NOT NULL',
    });
    const tudoDoRastro = JSON.stringify(
      spans.map((s) => ({ n: s.name, a: s.attributes, e: s.events, st: s.status })),
    );
    expect(tudoDoRastro).not.toContain(CPF);
    expect(saida).not.toContain(CPF);
    expect(saida).not.toMatch(/Fictício|99999-0000|evolução fictícia/);
    expect(saida).toContain('[oculto]');
    console.log(
      `[${cod}] ${spans.length} span(s) de consulta; 0 ocorrência do CPF sintético no rastro e no log (${saida.split('\n').filter(Boolean).length} linhas de log)`,
    );
  });
});
