// Regra 12 da ficha do M09 (telemetria.int.spec.ts): consulta ao banco do cliente de teste da onda (f22_o3) com CPF
// sintético como parâmetro; nada do CPF no rastro OpenTelemetry nem no log pino (com a redação ligada). A consulta só
// conta linhas (COUNT), nenhuma linha de pessoa sai do banco. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Melhoria: o rastro é o do @sgh/nucleo sobre o MariaDB do cliente (db.namespace = o cliente), sem driver de outro banco.
import { Writable } from 'node:stream';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NucleoProprio } from '@sgh/nucleo';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from './logger.js';

const CLIENTE = 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
// CPF sintético (dígitos verificadores válidos, nenhum titular real conhecido) e nome fictício.
const CPF = '52998224725';

describe.skipIf(SEM_BANCO)('rastro e log sem dado pessoal (MariaDB, cliente f22_o3)', () => {
  const exportador = new InMemorySpanExporter();
  let nucleo: NucleoProprio;
  let saida = '';
  const destino = new Writable({
    write(pedaco, _cod, pronto) {
      saida += String(pedaco);
      pronto();
    },
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exportador)] }),
    );
    nucleo = new NucleoProprio();
  });
  afterAll(async () => {
    await nucleo?.encerrar();
    trace.disable();
  });

  it('consulta parametrizada com CPF sintético: span sem o valor; log redigido', async () => {
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'telemetria' }, (l) =>
      l.consultar('SELECT COUNT(*) AS n FROM estabelecimento WHERE ? IS NOT NULL', [CPF]),
    );
    expect(Number(linhas[0]?.['n'])).toBeGreaterThanOrEqual(0);
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
    const consulta = spans.find((s) => String(s.attributes['db.query.text']).includes('FROM estabelecimento'));
    expect(consulta?.attributes).toMatchObject({
      'db.system.name': 'mariadb',
      'db.namespace': CLIENTE,
      'db.operation.name': 'SELECT',
      'db.query.parameter_count': 1,
      'db.query.text': 'SELECT COUNT(*) AS n FROM estabelecimento WHERE ? IS NOT NULL',
    });
    const tudoDoRastro = JSON.stringify(
      spans.map((s) => ({ n: s.name, a: s.attributes, e: s.events, st: s.status })),
    );
    expect(tudoDoRastro).not.toContain(CPF);
    expect(saida).not.toContain(CPF);
    expect(saida).not.toMatch(/Fictício|99999-0000|evolução fictícia/);
    expect(saida).toContain('[oculto]');
  });
});
