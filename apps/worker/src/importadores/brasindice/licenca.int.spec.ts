// Brasíndice só com contrato de dados (ficha do M13, regra 9; DP-36), na cópia e na transação desfeita: com o
// importador ligado e SEM o pré-requisito `contrato`, o lote é recusado ("sem-contrato") e nada é gravado nos
// itens nem nas edições da tabela de mat/med. Nada fica na cópia.
import { aplicarLoteLiberacao, edicaoNoBanco, lerCargaCatalogo } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargaAprovada, codigos, criarNucleo, dependencias, PODE_ESCREVER } from '../integracao.spec-util.js';
import { publicarCarga } from '../publicador.js';

describe.skipIf(!PODE_ESCREVER)('licença do Brasíndice (cópia, transação desfeita)', () => {
  const nucleo = PODE_ESCREVER ? criarNucleo() : null;
  const hospital = codigos[0] as string;
  beforeAll(async () => {
    await nucleo?.verificarSchema(hospital);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('carga recusada sem licença; nenhuma linha oficial nem de convênio tocada', async () => {
    if (!nucleo) return;
    await nucleo.desfazendoNaCopia({ rede: nucleo.rede, hospital, traceId: 'int-m13-licenca' }, async (e) => {
      // Contagem pelo @sgh/legado (só ele conhece o banco): itens da tabela 99 e a edição mais nova.
      const contar = async () => {
        const r = await edicaoNoBanco(e, 'brasindice');
        return { linhas: r.linhas, ultima: r.ultima };
      };
      const antes = await contar();
      await aplicarLoteLiberacao(
        e,
        {
          hospital,
          tipo: 'recurso',
          chave: 'catalogo.brasindice.responsavel',
          planejar: () => [{ escopo: 'hospital', valor: '*', ligada: true, antes: null }],
          justificativa: 'SGH M13: integração',
          autor: 'SGH.M13',
        },
        {
          rede: nucleo.rede,
          hospital,
          usuario: 'SGH.M13',
          evento: 'config.liberacao.alterada',
          recurso: 'config.liberacao',
          operacao: 'int',
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: null,
          correlacao: 'int-m13',
        },
      );
      const id = await cargaAprovada(e, hospital, nucleo.rede, 'brasindice', '9999', [
        {
          entidade: 'apresentacao',
          chave: 'codigo=99999998',
          comparacao: 'novo',
          depois: { codigo: '99999998', nome: 'ITEM SGH M13', laboratorio: 0, pmc: 1, pfb: 1 },
        },
      ]);
      const carga = await lerCargaCatalogo(e, hospital, id);
      if (!carga) throw new Error('carga não gravada');
      const r = await publicarCarga(dependencias(nucleo, e, hospital), carga);
      expect(r.situacao).toBe('falhou');
      expect(r.motivo).toContain('sem-contrato');
      expect(await contar()).toEqual(antes);
    });
  }, 120_000);
});
