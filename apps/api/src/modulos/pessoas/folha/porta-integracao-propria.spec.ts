// Porta própria da integração da folha com dublê do núcleo: parâmetros das consultas, mapeamento e as recusas
// explícitas das operações ainda sem modelo (nunca vazio).
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { METODOS_PORTA_INTEGRACAO_FOLHA } from './porta-integracao.js';
import {
  erroSemModelo,
  type NucleoIntegracaoFolha,
  PortaIntegracaoFolhaPropria,
  SEM_MODELO_INTEGRACAO_FOLHA,
} from './porta-integracao-propria.js';
import { ROTINAS_INTEGRACAO_FOLHA } from './apoio-folha.js';

const c = { cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3'), estabelecimento: 7, usuario: 3, correlacao: 'teste' };

function dubleDe(linhas: Record<string, unknown>[]) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const nucleo = {
    lerSomente: async (_ctx: unknown, fn: (l: unknown) => Promise<unknown>) =>
      fn({
        cliente: (process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3'),
        consultar: async (sql: string, p: readonly unknown[] = []) => (chamadas.push({ sql, p }), linhas),
        uma: async (sql: string, p: readonly unknown[] = []) => (
          chamadas.push({ sql, p }),
          linhas[0] ?? null
        ),
      }),
  } as unknown as NucleoIntegracaoFolha;
  return { porta: new PortaIntegracaoFolhaPropria(nucleo), chamadas };
}

describe('porta própria da integração da folha (dublê)', () => {
  it('implementa todos os métodos da porta', () => {
    const { porta } = dubleDe([]);
    for (const m of METODOS_PORTA_INTEGRACAO_FOLHA) expect(typeof (porta as never)[m]).toBe('function');
    expect(porta.destino).toBe('banco');
  });

  it('rotinas: o catálogo fixo do produto', async () => {
    const { porta } = dubleDe([]);
    expect(await porta.rotinas()).toEqual(ROTINAS_INTEGRACAO_FOLHA);
  });

  it('classificações: códigos do plano gerencial viram números', async () => {
    const { porta } = dubleDe([{ grupo: '200', subgrupo: '1', item: '3', nome: 'SALARIOS' }]);
    expect(await porta.classificacoes(c)).toEqual([{ grupo: 200, subgrupo: 1, item: 3, nome: 'SALARIOS' }]);
  });

  it('credores: por códigos, por termo e sem filtro suficiente não consulta', async () => {
    const d = dubleDe([{ id: 9, razao_social: 'FORNECEDOR SINTETICO' }]);
    expect(await d.porta.credores(c, { codigos: [9] })).toEqual([
      { codigo: 9, nome: 'FORNECEDOR SINTETICO' },
    ]);
    expect(d.chamadas[0]!.p).toEqual([9]);
    await d.porta.credores(c, { termo: 'forn' });
    expect(d.chamadas[1]!.p).toEqual([0, '%forn%']);
    expect(await d.porta.credores(c, { termo: 'f' })).toEqual([]);
    expect(d.chamadas).toHaveLength(2);
  });

  it('títulos manuais: filtra pelo estabelecimento da sessão e conta', async () => {
    const d = dubleDe([{ n: 2 }]);
    const n = await d.porta.titulosManuais(c, {
      empresa: 1,
      credor: 9,
      grupo: 200,
      subgrupo: 1,
      item: 3,
      de: '2099-08-01',
      ate: '2099-08-31',
    });
    expect(n).toBe(2);
    expect(d.chamadas[0]!.p).toEqual([7, 9, 200, 1, 3, '2099-08-01', '2099-08-31']);
    expect(d.chamadas[0]!.sql).toContain('p.vencimento BETWEEN ? AND ?');
    expect(d.chamadas[0]!.sql).not.toContain('data_emissao');
  });

  it('sem estabelecimento na sessão: recusa', async () => {
    const { porta } = dubleDe([]);
    await expect(porta.classificacoes({ ...c, estabelecimento: null })).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('operações sem modelo: liberação negada e recusa 503 com a operação na mensagem', async () => {
    const { porta } = dubleDe([]);
    expect(await porta.podeGravar()).toMatchObject({ pode: false, codigo: 'modelo-pendente' });
    const chamadas: [keyof typeof SEM_MODELO_INTEGRACAO_FOLHA, () => Promise<unknown>][] = [
      ['integracoes', () => porta.integracoes()],
      ['retorno', () => porta.retorno()],
      ['lancamentos', () => porta.lancamentos()],
      ['lancamento', () => porta.lancamento()],
      ['lancamentoDaOrigem', () => porta.lancamentoDaOrigem()],
      ['titulosDoLancamento', () => porta.titulosDoLancamento()],
      ['chavesLancadas', () => porta.chavesLancadas()],
      ['custoPessoal', () => porta.custoPessoal()],
      ['executar', () => porta.executar()],
      ['gravarSgh', () => porta.gravarSgh(c, {}, async () => 1)],
    ];
    for (const [op, fn] of chamadas) {
      const e = await fn().then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(ErroOperacao);
      expect((e as ErroOperacao).problema).toMatchObject({ status: 503, codigo: 'modelo-pendente' });
      expect((e as ErroOperacao).problema.detail).toBe(erroSemModelo(op).problema.detail);
    }
  });
});
