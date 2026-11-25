import type { ItemAtualErp, ResultadoRetornoErp, SituacaoLoteErp } from '@sgh/dominio-integracao';
import { describe, expect, it } from 'vitest';
import {
  adaptadorErpSimuladoWorker,
  type FonteFilaErp,
  importarRetornoErp,
  type LoteParaEnvioErp,
  processarFilaErp,
} from './fila.js';

function memoria() {
  const lotes = new Map<
    number,
    { situacao: SituacaoLoteErp; versao: number; protocolo: string | null; itens: ItemAtualErp[] }
  >();
  lotes.set(1, {
    situacao: 'gerado',
    versao: 1,
    protocolo: null,
    itens: [
      { sequencia: 1, situacao: 'pendente', chaveExterna: null, valor: 10 },
      { sequencia: 2, situacao: 'pendente', chaveExterna: null, valor: 5 },
    ],
  });
  const gravacoes: ResultadoRetornoErp[] = [];
  const fonte: FonteFilaErp = {
    lotesParaEnviar: async () =>
      [...lotes.entries()]
        .filter(([, l]) => l.situacao === 'gerado')
        .map(([id, l]): LoteParaEnvioErp => ({
          id,
          numero: `ERP-${id}`,
          tipo: 'pagar',
          versao: l.versao,
          itens: l.itens.map((i) => ({
            sequencia: i.sequencia,
            cpfCnpj: i.sequencia === 1 ? '12345678000199' : null,
            valor: i.valor,
            conteudo: {},
          })),
        })),
    registrarEnvio: async (_h, id, versao, protocolo) => {
      const l = lotes.get(id)!;
      if (l.versao !== versao) throw new Error('conflito');
      Object.assign(l, { situacao: 'enviado', protocolo, versao: versao + 1 });
      return l.versao;
    },
    itensAtuais: async (_h, id) => ({ situacao: lotes.get(id)!.situacao, itens: lotes.get(id)!.itens }),
    gravarRetorno: async (_h, id, _v, r) => {
      const l = lotes.get(id)!;
      gravacoes.push(r);
      for (const m of r.mudancas) {
        const i = l.itens.findIndex((x) => x.sequencia === m.sequencia);
        l.itens[i] = { ...l.itens[i]!, situacao: m.situacao, chaveExterna: m.chaveExterna };
      }
      l.situacao = r.situacaoLote;
      l.versao++;
    },
  };
  return { lotes, gravacoes, fonte };
}

describe('job da fila com o ERP', () => {
  it('envia o lote gerado pelo simulador e importa o retorno; o segundo ciclo não reenvia', async () => {
    const m = memoria();
    expect(await processarFilaErp(m.fonte, adaptadorErpSimuladoWorker, 'h')).toEqual({
      enviados: 1,
      falhas: 0,
      itensAlterados: 2,
      rejeitados: 1,
    });
    const l = m.lotes.get(1)!;
    expect(l).toMatchObject({ situacao: 'processado_com_erro', protocolo: 'SIM-ERP-1' });
    expect(l.itens.map((i) => [i.situacao, i.chaveExterna])).toEqual([
      ['exportado', 'SIM-ERP-1-1'],
      ['rejeitado', null],
    ]);
    expect(await processarFilaErp(m.fonte, adaptadorErpSimuladoWorker, 'h')).toMatchObject({ enviados: 0 });
  });

  it('falha do adaptador deixa o lote gerado e conta a falha', async () => {
    const m = memoria();
    const r = await processarFilaErp(m.fonte, { enviar: () => Promise.reject(new Error('fora do ar')) }, 'h');
    expect(r).toMatchObject({ enviados: 0, falhas: 1 });
    expect(m.lotes.get(1)!.situacao).toBe('gerado');
  });

  it('retorno avulso repetido não grava de novo (idempotente)', async () => {
    const m = memoria();
    await processarFilaErp(m.fonte, adaptadorErpSimuladoWorker, 'h');
    const antes = m.gravacoes.length;
    const ret = [{ sequencia: 2, aceito: true, chaveExterna: 'ERP-9', mensagem: null }];
    expect((await importarRetornoErp(m.fonte, 'h', 1, m.lotes.get(1)!.versao, ret)).situacaoLote).toBe(
      'processado',
    );
    expect((await importarRetornoErp(m.fonte, 'h', 1, m.lotes.get(1)!.versao, ret)).repetidos).toBe(1);
    expect(m.gravacoes.length).toBe(antes + 1);
  });
});
