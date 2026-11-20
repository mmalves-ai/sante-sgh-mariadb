// Um responsável por catálogo de cada vez (ficha do M13, regra 3), na cópia e na transação desfeita: com a chave
// `catalogo.cbo.responsavel` desligada (M61: a liberação full pode tê-la ligado na cópia, então o teste a DESLIGA na
// própria transação), o publicador recusa o lote e a carga fica "falhou" com o motivo; ligada, o mesmo lote é publicado
// e a carga fica "publicada". Nada fica na cópia.
import { planejarLote } from '@sgh/dominio-config';
import { aplicarLoteLiberacao, consultarCatalogo, lerCargaCatalogo } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargaAprovada, codigos, criarNucleo, dependencias, PODE_ESCREVER } from './integracao.spec-util.js';
import { publicarCarga } from './publicador.js';

describe.skipIf(!PODE_ESCREVER)('responsável pelo catálogo (cópia, transação desfeita)', () => {
  const nucleo = PODE_ESCREVER ? criarNucleo() : null;
  const hospital = codigos[0] as string;
  beforeAll(async () => {
    await nucleo?.verificarSchema(hospital);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('com o responsável externo o lote é recusado; ligado, publicado', async () => {
    if (!nucleo) return;
    await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital, traceId: 'int-m13-responsavel' },
      async (e) => {
        const linhas = [
          {
            entidade: 'ocupacao',
            chave: 'codigo=32766',
            comparacao: 'novo' as const,
            depois: { codigo: '32766', nome: 'OCUPACAO SGH M13' },
          },
        ];
        const trilhaInt = {
          rede: nucleo.rede,
          hospital,
          usuario: 'SGH.M13',
          evento: 'config.liberacao.alterada',
          recurso: 'config.liberacao',
          operacao: 'int',
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'integracao-m13',
          correlacao: 'int-m13-responsavel-desliga',
        };
        await aplicarLoteLiberacao(
          e,
          {
            hospital,
            tipo: 'recurso',
            chave: 'catalogo.cbo.responsavel',
            planejar: ({ chaves }) => planejarLote(chaves, 'hospital', ['*'], false),
            justificativa: 'SGH M13: integração (desligada na transação desfeita)',
            autor: 'SGH.M13',
          },
          trilhaInt,
        );
        const id = await cargaAprovada(e, hospital, nucleo.rede, 'cbo', null, linhas);
        const d = dependencias(nucleo, e, hospital);
        const carga = await lerCargaCatalogo(e, hospital, id);
        if (!carga) throw new Error('carga não gravada');
        const recusa = await publicarCarga(d, carga);
        expect(recusa).toMatchObject({ situacao: 'falhou' });
        expect(recusa.motivo).toContain('responsavel-externo');
        expect((await lerCargaCatalogo(e, hospital, id))?.situacao).toBe('falhou');
        // Fora da janela, nada acontece.
        const fora = await publicarCarga({ ...d, agoraMinutos: () => 12 * 60 }, carga);
        expect(fora.situacao).toBe('aguardando-janela');
        // Ligado no estabelecimento: a carga nova é publicada.
        await aplicarLoteLiberacao(
          e,
          {
            hospital,
            tipo: 'recurso',
            chave: 'catalogo.cbo.responsavel',
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
        const id2 = await cargaAprovada(e, hospital, nucleo.rede, 'cbo', null, linhas);
        const carga2 = await lerCargaCatalogo(e, hospital, id2);
        if (!carga2) throw new Error('carga não gravada');
        expect(await publicarCarga(d, carga2)).toMatchObject({ situacao: 'publicada', lotes: 1 });
        const r = await consultarCatalogo(e, 'ocupacao', { busca: '32766', pagina: 0, porPagina: 5 });
        expect(r?.itens.some((i) => String(i['codigo']) === '32766')).toBe(true);
      },
    );
  }, 120_000);
});
