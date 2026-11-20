// Regra 9 do M08 na cópia: a chave de liberação por estabelecimento, setor, grupo e pessoa vale SEM nova
// implantação — o executor lê SGH_CFG_LIBERACAO a cada gravação; em PRODUÇÃO só grava operação `liberada` e
// com a chave ligada; recolher é desligar a chave do estabelecimento. Executor de produção montado sobre a
// transação desfeita da cópia (catálogo dublê: `liberada`); nada fica gravado.
import { operacaoDoDominio } from '@sgh/contratos';
import { planejarLote } from '@sgh/dominio-config';
import {
  aplicarLoteLiberacao,
  declaracao,
  ErroOperacao,
  Executor,
  lerChavesLiberacao,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { valoresDeInclusao } from '../massa/dominios.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

const religiao = declaracao('cadastro.religiao')!;
const NOME_OP = operacaoDoDominio(religiao.publico, 'incluir');

describe.skipIf(!PODE_ESCREVER)('chaves de liberação na cópia (regra 9; transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const producao = (estado: 'liberada' | 'verde') =>
    new Executor({
      ambiente: 'producao',
      catalogo: { estado: () => estado },
      schema: { bloqueada: () => false },
      ler: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
      escrever: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
    });

  const trilha = (hospital: string, rede: string) => ({
    rede,
    hospital,
    usuario: 'SGH.M08',
    evento: 'config.liberacao.alterada',
    recurso: 'config.liberacao',
    operacao: 'config.aplicarLiberacao',
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: 'SGH-TESTE:integracao',
    correlacao: 'integracao-m08',
  });

  it('produção: sem chave não grava; com a chave da pessoa ligada grava; estabelecimento desligado recolhe; não liberada nunca', async () => {
    const desfechos: string[] = [];
    const naCopia = (await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod))).filter(
      (c) => c.chave === NOME_OP,
    );
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o teste parte do "sem chave" na própria transação.
      await partirSemDecisao(e, { rede: a.nucleo.rede, hospital: a.cod, chave: NOME_OP, tipo: 'operacao' });
      const ex = producao('liberada');
      const tentar = async (rotulo: string, extra: Partial<ReturnType<typeof ctxOperacao>> = {}) => {
        try {
          await ex.executar(
            operacao(NOME_OP),
            a.cod,
            await valoresDeInclusao(e, religiao),
            { ...ctxOperacao(a, 'SGH.M08'), ...extra },
            { escritor: e },
          );
          desfechos.push(`${rotulo}:gravou`);
        } catch (x) {
          desfechos.push(`${rotulo}:${x instanceof ErroOperacao ? x.problema.codigo : 'outro'}`);
        }
      };
      await tentar('sem-chave');
      const lote = (escopo: 'hospital' | 'pessoa' | 'setor', valor: string, ligada: boolean) =>
        aplicarLoteLiberacao(
          e,
          {
            hospital: a.cod,
            tipo: 'operacao',
            chave: NOME_OP,
            planejar: (estado) => planejarLote(estado.chaves, escopo, [valor], ligada),
            justificativa: 'teste de integração sintético',
            autor: 'SGH.M08',
          },
          trilha(a.cod, a.nucleo.rede),
        );
      await lote('pessoa', 'SGH.M08', true);
      await tentar('pessoa-ligada');
      await tentar('outra-pessoa', { usuarioLegado: 'SGH.OUTRA' });
      await lote('setor', '10', true);
      await tentar('setor-ligado', { usuarioLegado: 'SGH.OUTRA', setor: '10' });
      await lote('hospital', '*', false);
      await tentar('recolhido');
      try {
        await producao('verde').executar(
          operacao(NOME_OP),
          a.cod,
          await valoresDeInclusao(e, religiao),
          ctxOperacao(a, 'SGH.M08'),
          { escritor: e },
        );
        desfechos.push('verde:gravou');
      } catch (x) {
        desfechos.push(`verde:${x instanceof ErroOperacao ? x.problema.codigo : 'outro'}`);
      }
      expect((await lerChavesLiberacao(e, a.cod)).filter((c) => c.chave === NOME_OP)).toHaveLength(3);
    });
    expect(desfechos).toEqual([
      'sem-chave:operacao-nao-liberada',
      'pessoa-ligada:gravou',
      'outra-pessoa:operacao-nao-liberada',
      'setor-ligado:gravou',
      'recolhido:operacao-nao-liberada',
      'verde:operacao-nao-liberada',
    ]);
    expect(
      (await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod))).filter(
        (c) => c.chave === NOME_OP,
      ),
    ).toEqual(naCopia);
    console.log(`[${a.cod}] liberação: ${desfechos.join(', ')}; desfeito`);
  });
});
