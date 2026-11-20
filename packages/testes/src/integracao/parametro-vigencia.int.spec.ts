// Regra 8 do M08 na cópia (revisão): definir parâmetro relê COM TRAVA as vigentes do mesmo nível e alvo e
// confere que são as que o plano fecha; plano velho (outra definição no meio) é recusado, nada gravado. O
// índice único do 0016 guarda o caso sem vigente para travar. Transação desfeita; dados sintéticos.
import { gravarDefinicaoParametro, lerValoresParametro } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('vigência do parâmetro na cópia (regra 8; transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('plano velho recusado (conflito-concorrente); plano atual fecha a vigente e inclui a nova', async () => {
    const trilha = {
      rede: a.nucleo.rede,
      hospital: a.cod,
      usuario: 'SGH.M08',
      evento: 'config.parametro.definido',
      recurso: 'config.parametro',
      operacao: 'config.definirParametro',
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'SGH-TESTE:integracao',
      correlacao: 'integracao-m08',
    };
    const definir = (fechar: string[], valor: string) => ({
      rede: a.nucleo.rede,
      hospital: a.cod,
      fechar,
      nova: {
        chave: 'cadastro.itensPorPagina',
        nivel: 'estabelecimento' as const,
        alvo: a.cod,
        valor,
        vigenteDesde: '',
        vigenteAte: null,
        justificativa: 'definição sintética de teste',
        autor: 'SGH.M08',
      },
    });
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const primeira = await gravarDefinicaoParametro(e, definir([], '30'), trilha);
      let recusa = '';
      try {
        await gravarDefinicaoParametro(e, definir([], '40'), trilha);
      } catch (x) {
        recusa = (x as { codigo?: string }).codigo ?? 'outro';
      }
      await gravarDefinicaoParametro(e, definir([primeira.id], '50'), trilha);
      const v = (await lerValoresParametro(e, a.cod, 'cadastro.itensPorPagina')).filter(
        (x) => x.vigenteAte === null,
      );
      return { recusa, vigentes: v.map((x) => x.valor) };
    });
    expect(r).toEqual({ recusa: 'conflito-concorrente', vigentes: ['50'] });
    expect(
      await a.nucleo.lerSomente(ctx(a), (l) => lerValoresParametro(l, a.cod, 'cadastro.itensPorPagina')),
    ).toEqual([]);
    console.log(`[${a.cod}] vigência: plano velho ${r.recusa}; 1 vigente; desfeito`);
  });
});
