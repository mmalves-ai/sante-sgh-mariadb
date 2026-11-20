// Regra 4 do M08 na cópia: sem exclusão física; inativar preserva as referências — o item inativo some das
// escolhas (lista dos ativos) e continua legível nos registros antigos (item pela chave). Uso pelas FKs do
// catálogo RDB$: item em uso pede confirmação (409 em-uso sem ela); com ela, inativa. Tudo desfeito.
import { operacaoDoDominio } from '@sgh/contratos';
import {
  declaracao,
  ErroOperacao,
  itemDoDominio,
  listarDominio,
  operacao,
  referenciasDaTabela,
  usoDoItem,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { valoresDeInclusao } from '../massa/dominios.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const situacao = declaracao('internacao.situacaoHigienizacao')!;
const limpeza = declaracao('internacao.tipoLimpeza')!;

describe.skipIf(!PODE_ESCREVER)('inativar na cópia (regra 4; transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('item sem uso: inativa (letra F do CHECK); some das escolhas e continua legível; nada é excluído', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const inc = await a.executor.executar(
        operacao(operacaoDoDominio(limpeza.publico, 'incluir')),
        a.cod,
        await valoresDeInclusao(e, limpeza),
        ctxOperacao(a, 'SGH.M08'),
        { escritor: e },
      );
      const codigo = String(inc.resultado['codigo']);
      const antes = (await listarDominio(e, limpeza)).itens.length;
      expect((await usoDoItem(e, limpeza, codigo)).some((u) => u.usos)).toBe(false);
      const lido = await itemDoDominio(e, limpeza, codigo);
      await a.executor.executar(
        operacao(operacaoDoDominio(limpeza.publico, 'inativar')),
        a.cod,
        { codigo, versao: lido!.versao },
        ctxOperacao(a, 'SGH.M08'),
        { escritor: e },
      );
      const lista = await listarDominio(e, limpeza);
      expect(lista.itens.length).toBe(antes);
      expect(lista.itens.filter((i) => i.ativo).map((i) => i.codigo)).not.toContain(codigo);
      expect((await itemDoDominio(e, limpeza, codigo))?.ativo).toBe(false);
    });
  });

  it('item em uso (FK RESTRICT do catálogo): 409 em-uso sem confirmar; com a confirmação, inativa; situação de sistema nunca', async () => {
    const refs = await a.nucleo.lerSomente(ctx(a), (l) => referenciasDaTabela(l, situacao.tabela));
    expect(refs.length).toBeGreaterThan(0);
    let semConfirmar = '';
    let sistema = '';
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const inativar = (codigo: string, versao: string, confirmarEmUso = false) =>
        a.executor.executar(
          operacao(operacaoDoDominio(situacao.publico, 'inativar')),
          a.cod,
          { codigo, versao, ...(confirmarEmUso ? { confirmarEmUso: true } : {}) },
          ctxOperacao(a, 'SGH.M08'),
          { escritor: e },
        );
      // As situações 1 a 4 são do fluxo da Higienização (TRG_CHSITUACAO_BD): nunca inativadas.
      const protegida = (await listarDominio(e, situacao)).itens.find((i) => i.codigo === '1');
      expect(protegida).toBeDefined();
      try {
        await inativar('1', protegida!.versao, true);
      } catch (x) {
        sistema = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      // Item sintético A, usado pela situação anterior de um sintético B (FK do próprio CHSITUACAO).
      const incluir = async (anterior: number | null) =>
        String(
          (
            await a.executor.executar(
              operacao(operacaoDoDominio(situacao.publico, 'incluir')),
              a.cod,
              { ...(await valoresDeInclusao(e, situacao)), situacaoAnterior: anterior },
              ctxOperacao(a, 'SGH.M08'),
              { escritor: e },
            )
          ).resultado['codigo'],
        );
      const usado = await incluir(null);
      await incluir(Number(usado));
      expect((await usoDoItem(e, situacao, usado)).some((u) => u.usos)).toBe(true);
      const lido = await itemDoDominio(e, situacao, usado);
      try {
        await inativar(usado, lido!.versao);
      } catch (x) {
        semConfirmar = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      await inativar(usado, lido!.versao, true);
      expect((await itemDoDominio(e, situacao, usado))?.ativo).toBe(false);
    });
    expect(sistema).toBe('item-de-sistema');
    expect(semConfirmar).toBe('em-uso');
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => listarDominio(l, situacao));
    expect(depois.itens.every((i) => i.ativo)).toBe(true);
    console.log(
      `[${a.cod}] em uso: ${refs.length} FK(s) de uma coluna; sem confirmar ${semConfirmar}; situação de sistema ${sistema}; desfeito`,
    );
  });
});
