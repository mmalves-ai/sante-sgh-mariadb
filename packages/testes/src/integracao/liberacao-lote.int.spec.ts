// POL-3 e DP-4 na cópia (SGH_CFG_LIBERACAO e SGH_CFG_PREREQUISITO, transação desfeita): a mesma chave de
// RECURSO para uma lista de setores, grupos ou pessoas numa ação só (um lote), reversível (cada linha volta
// ao estado de antes); pré-requisito registrado com situação, validade e a referência da evidência; a trilha
// do lote na mesma transação. A regra de ligar (pré-requisito) é a do @sgh/dominio-config.
import { recursoDesligado } from '@sgh/contratos';
import { chaveLibera, decidirChave, planejarLote, reverterLote } from '@sgh/dominio-config';
import {
  aplicarLoteLiberacao,
  gravarPrerequisito,
  lerChavesLiberacao,
  lerLote,
  lerPrerequisitos,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  contar,
  ctx,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('liberação em lote e pré-requisito na cópia (POL-3, DP-4)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const trilha = () => ({
    rede: a.nucleo.rede,
    hospital: a.cod,
    usuario: 'SGH.M08',
    evento: 'config.liberacao.alterada',
    recurso: 'config.liberacao',
    operacao: 'config.aplicarLiberacao',
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: 'SGH-TESTE:integracao',
    correlacao: 'integracao-m08',
  });

  it('lote de 3 setores numa ação; reverter volta ao de antes; pré-requisito libera o ligar', async () => {
    const esocial = recursoDesligado('pessoas.esocial')!;
    const contarNaCopia = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => ({
        chaves: (await lerChavesLiberacao(l, a.cod, { incluirHerdadas: true })).length,
        prereqs: (await lerPrerequisitos(l, a.cod)).length,
      }));
    const naCopia = await contarNaCopia();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o teste parte do "sem decisão" na própria transação.
      for (const chave of ['licitacao', 'pessoas.esocial'])
        await partirSemDecisao(e, { rede: a.nucleo.rede, hospital: a.cod, chave });
      const trilhaAntes = await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ?', [a.cod]);
      // Ligar sem o pré-requisito: recusado pela regra (nada gravado).
      expect(
        decidirChave(true, esocial.prerequisitos, await lerPrerequisitos(e, a.cod), new Date()).permitido,
      ).toBe(false);
      const lote = (escopo: 'hospital' | 'setor' | 'pessoa', valores: string[], ligar: boolean) =>
        aplicarLoteLiberacao(
          e,
          {
            hospital: a.cod,
            tipo: 'recurso',
            chave: 'licitacao',
            planejar: (estado) => planejarLote(estado.chaves, escopo, valores, ligar),
            justificativa: 'lote sintético de liberação',
            autor: 'SGH.M08',
          },
          trilha(),
        );
      const l1 = await lote('setor', ['10', '11', '12'], true);
      const ligadas = (await lerChavesLiberacao(e, a.cod)).filter((c) => c.chave === 'licitacao' && c.ligada);
      const doLote = await lerLote(e, a.cod, l1.lote);
      const volta = reverterLote(
        doLote.map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada, antes: c.ligadaAntes })),
      );
      await aplicarLoteLiberacao(
        e,
        {
          hospital: a.cod,
          tipo: 'recurso',
          chave: 'licitacao',
          planejar: () => volta,
          justificativa: 'reversão sintética do lote',
          autor: 'SGH.M08',
        },
        trilha(),
      );
      // As linhas que herdam só vêm com incluirHerdadas (M61: a leitura comum as deixa de fora).
      const doTeste = (c: { chave: string; escopo: string; valor: string }) =>
        c.chave === 'licitacao' &&
        ((c.escopo === 'setor' && ['10', '11', '12'].includes(c.valor)) ||
          (c.escopo === 'pessoa' && c.valor === 'SGH.UM'));
      const depois = (await lerChavesLiberacao(e, a.cod, { incluirHerdadas: true })).filter(doTeste);
      // Estabelecimento ligado (lote '*'), lote que DESLIGA o setor 10 e a pessoa SGH.UM, revertido: o setor e a
      // pessoa voltam a herdar (LIGADA nula, 0016) e continuam liberados pela chave mais ampla.
      await lote('hospital', ['*'], true);
      const l3 = await lote('pessoa', ['SGH.UM'], false);
      const l4 = await lote('setor', ['10'], false);
      const bloqueado = chaveLibera(
        (await lerChavesLiberacao(e, a.cod)).filter((c) => c.chave === 'licitacao'),
        'SGH.DOIS',
        undefined,
        '10',
      );
      for (const l of [l4, l3]) {
        const linhas = await lerLote(e, a.cod, l.lote);
        await aplicarLoteLiberacao(
          e,
          {
            hospital: a.cod,
            tipo: 'recurso',
            chave: 'licitacao',
            planejar: () =>
              reverterLote(
                linhas.map((c) => ({
                  escopo: c.escopo,
                  valor: c.valor,
                  ligada: c.ligada,
                  antes: c.ligadaAntes,
                })),
              ),
            justificativa: 'reversão sintética do lote',
            autor: 'SGH.M08',
          },
          trilha(),
        );
      }
      const final = (await lerChavesLiberacao(e, a.cod, { incluirHerdadas: true })).filter(
        (c) => c.chave === 'licitacao',
      );
      const herdam = final.filter((c) => doTeste(c) && c.ligada === null).length;
      const liberados = [
        chaveLibera(final, 'SGH.DOIS', undefined, '10'),
        chaveLibera(final, 'SGH.UM', undefined, undefined),
      ];
      await gravarPrerequisito(
        e,
        {
          hospital: a.cod,
          recurso: 'pessoas.esocial',
          tipo: 'certificado',
          situacao: 'cumprido',
          validade: '2099-12-31',
          evidencia: 'protocolo sintético',
          autor: 'SGH.M08',
        },
        { ...trilha(), evento: 'config.prerequisito.registrado' },
      );
      const liga = decidirChave(
        true,
        esocial.prerequisitos,
        (await lerPrerequisitos(e, a.cod)).filter((p) => p.recurso === 'pessoas.esocial'),
        new Date(),
      );
      const trilhaDepois = await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ?', [a.cod]);
      return {
        lote: l1,
        ligadas: ligadas.length,
        doLote: doLote.length,
        depois: depois.map((c) => c.ligada),
        bloqueado,
        herdam,
        liberados,
        liga: liga.permitido,
        trilha: trilhaDepois - trilhaAntes,
      };
    });
    expect(r.lote.alteradas).toBe(3);
    expect(r.ligadas).toBe(3);
    expect(r.doLote).toBe(3);
    // Linha criada pelo lote volta a HERDAR (nula), não desligada.
    expect(r.depois).toEqual([null, null, null]);
    expect(r.bloqueado).toBe(false);
    expect(r.herdam).toBe(4);
    expect(r.liberados).toEqual([true, true]);
    expect(r.liga).toBe(true);
    // 2 lotes de setor + estabelecimento + pessoa + setor + 2 reversões + pré-requisito.
    expect(r.trilha).toBe(8);
    // Desfeito: a cópia ficou como estava.
    expect(await contarNaCopia()).toEqual(naCopia);
    console.log(
      `[${a.cod}] lote ${r.lote.alteradas} setores, revertido (herda); estabelecimento + pessoa + setor revertidos (herdam ${r.herdam}); pré-requisito liberou o ligar; trilha +${r.trilha}; desfeito`,
    );
  });
});
