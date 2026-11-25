// Gravação na porta própria do SADT (MariaDB, cliente f22_o2): a operação que ainda espera o contrato novo da tela
// (pedido do lote 02-09) fica desligada no banco COM o motivo (a tela fica em consulta) e a tentativa de gravar é
// recusada com 409 "modelo-pendente", sem escrever nada (nenhuma linha nem trilha). Digitar, liberar e retificar o
// resultado já gravam pelo contrato novo (05-SADT linha 10): ficam ligadas para a tela e fora das pendentes.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_SADT_NO_CONTRATO_NOVO, OPERACOES_SADT_PENDENTES } from '../operacoes.js';
import { PortaSadtPropria } from '../porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

describe.skipIf(SEM_BANCO)('liberação do exame no banco (pendência explícita)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9L');
    porta = new PortaSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('podeGravar diz o motivo; executar recusa 409 sem gravar', async () => {
    const c = contexto(m!);
    for (const op of Object.keys(OPERACOES_SADT_PENDENTES)) {
      const p = await porta.podeGravar(c, op);
      expect(p).toMatchObject({ pode: false, codigo: 'operacao-nao-liberada' });
      expect(p.motivo).toContain('contrato novo');
    }
    for (const op of ['sadt.registrarResultado', 'sadt.liberarExame', 'sadt.retificarResultado']) {
      expect(OPERACOES_SADT_PENDENTES[op]).toBeUndefined();
      expect(OPERACOES_SADT_NO_CONTRATO_NOVO[op]).toContain('/api/sadt/exames-pedidos/:exame/resultado');
      expect(await porta.podeGravar(c, op)).toEqual({ pode: true, codigo: null, motivo: null });
    }
    expect(await porta.podeGravar(c, 'sadt.inexistente')).toMatchObject({
      pode: false,
      codigo: 'operacao-desconhecida',
    });
    const antes = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.uma<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade LIKE ?', [
        'resultado%',
      ]),
    );
    const erro = await porta
      .executar(
        c,
        'sadt.lancarExame',
        { exames: [], responsavel: m!.base.profissional },
        { ...c, chaveIdempotencia: 't-s09lib-1' },
      )
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect((erro as ErroOperacao).problema).toMatchObject({ status: 409, codigo: 'modelo-pendente' });
    const depois = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.uma<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade LIKE ?', [
        'resultado%',
      ]),
    );
    // A tentativa recusada não escreve trilha de resultado (a contagem do cliente fica como estava).
    expect(Number(depois?.n)).toBe(Number(antes?.n));
  });
});
