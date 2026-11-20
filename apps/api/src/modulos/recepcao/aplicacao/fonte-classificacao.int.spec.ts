// M44, regra 6, sobre a cópia (transação DESFEITA): com a classificação externa ligada no estabelecimento, ligar a
// própria desliga a externa no mesmo pedido e antes dela (SGH_CFG_LIBERACAO relida com trava, trilha junto); depois,
// ligar a externa é recusado. Nada fica gravado. Só contagens.
import { CHAVE_CLASSIFICACAO_EXTERNA, CHAVE_LIBERACAO_CLASSIFICACAO } from '@sgh/contratos';
import { planejarLote } from '@sgh/dominio-config';
import { aplicarLoteLiberacao, lerChavesLiberacao, somenteSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { aplicarFonteUnicaDeCor } from '../../config/fonte-de-cor.js';

describe.skipIf(!PODE_ESCREVER)('regra 6 na cópia: uma fonte de cor (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('ligar a própria desliga a externa no mesmo pedido; a externa depois é recusada', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m44-r6' }, async (e0) => {
      const e = somenteSgh(e0);
      const trilha = {
        rede: a.nucleo.rede,
        hospital: a.cod,
        usuario: 'SGH.M44',
        evento: 'config.liberacao.alterada',
        recurso: 'config.liberacao',
        operacao: 'config.aplicarLiberacao',
        chaveNaturalAlvo: null,
        resultado: 'sucesso' as const,
        estacao: 'SGH-TESTE:integracao',
        correlacao: 'integracao-m44-r6',
      };
      const lote = (
        chave: string,
        ligar: boolean,
        planejar?: Parameters<typeof aplicarLoteLiberacao>[1]['planejar'],
      ) =>
        aplicarLoteLiberacao(
          e,
          {
            hospital: a.cod,
            tipo: 'recurso',
            chave,
            planejar: planejar ?? ((s) => planejarLote(s.chaves, 'hospital', ['*'], ligar)),
            justificativa: 'teste de integração sintético da regra 6',
            autor: 'SGH.M44',
          },
          trilha,
        );
      await lote(CHAVE_LIBERACAO_CLASSIFICACAO, false);
      await lote(CHAVE_CLASSIFICACAO_EXTERNA, true);
      const fonte = {
        chaves: () => lerChavesLiberacao(e, a.cod),
        desligarExterna: (planejar: Parameters<typeof aplicarLoteLiberacao>[1]['planejar']) =>
          lote(CHAVE_CLASSIFICACAO_EXTERNA, false, planejar),
      };
      const pedido = { chave: CHAVE_LIBERACAO_CLASSIFICACAO, escopo: 'hospital' as const, valores: ['*'] };
      const desligadas = await aplicarFonteUnicaDeCor(fonte, pedido);
      await lote(CHAVE_LIBERACAO_CLASSIFICACAO, true);
      const chaves = await lerChavesLiberacao(e, a.cod);
      const estado = (k: string) => chaves.find((c) => c.chave === k && c.escopo === 'hospital')?.ligada;
      let recusa = '';
      try {
        await aplicarFonteUnicaDeCor(fonte, { ...pedido, chave: CHAVE_CLASSIFICACAO_EXTERNA });
      } catch (x) {
        recusa = x instanceof ErroProblema ? String(x.extras.codigo ?? x.titulo) : 'erro';
      }
      return {
        desligadas,
        propria: estado(CHAVE_LIBERACAO_CLASSIFICACAO),
        externa: estado(CHAVE_CLASSIFICACAO_EXTERNA),
        recusa,
      };
    });
    console.log(`[${a.cod}] regra 6: ${JSON.stringify(r)}`);
    expect(r.desligadas).toBe(1);
    expect(r.propria).toBe(true);
    expect(r.externa).toBe(false);
    expect(r.recusa).toMatch(/fonte-de-cor-unica|Uma fonte de cor/);
    // Depois do ROLLBACK, nada ficou.
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m44-r6' }, (l) =>
      lerChavesLiberacao(l, a.cod),
    );
    expect(depois.some((c) => c.justificativa === 'teste de integração sintético da regra 6')).toBe(false);
  });
});
