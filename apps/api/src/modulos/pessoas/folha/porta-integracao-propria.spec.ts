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
import { OPERACAO_TITULOS_FOLHA } from './servico-integracao.js';

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

  it('de-para: lê as vigências do estabelecimento com os destinos, a classificação e o mês do vencimento', async () => {
    const { porta, chamadas } = dubleDe([
      {
        id: 4,
        vigencia_inicio: '2099-01-01',
        criado_em: '2099-01-02T10:00:00.000Z',
        login: 'ana',
        destino: 'liquido_mensal',
        empresa_fornecedora_id: 9001,
        dia_vencimento: 5,
        mes_vencimento: 'seguinte',
        grupo: '210',
        subgrupo: '01',
        item: '1',
      },
      {
        id: 4,
        vigencia_inicio: '2099-01-01',
        criado_em: '2099-01-02T10:00:00.000Z',
        login: 'ana',
        destino: 'outro',
        empresa_fornecedora_id: 9002,
        dia_vencimento: 10,
        mes_vencimento: 'mesmo',
        grupo: '210',
        subgrupo: '2',
        item: '1',
      },
    ]);
    expect(await porta.integracoes(c, 7)).toEqual([
      {
        id: 4,
        empresa: 7,
        inicio: '2099-01-01',
        destinos: [
          {
            destino: 'liquido-mensal',
            rotina: 4,
            credor: 9001,
            classificacao: { grupo: 210, subgrupo: 1, item: 1 },
            diaVencimento: 5,
            mesesDepois: 1,
            contaContabil: '',
          },
        ],
        criadoPor: 'ana',
        criadoEm: '2099-01-02T10:00:00.000Z',
      },
    ]);
    expect(chamadas[0]?.p).toEqual([7]);
    expect(await porta.integracoes(c, 8)).toEqual([]);
  });

  it('liberação: o de-para grava; o lançamento dos títulos é negado com o motivo', async () => {
    const { porta } = dubleDe([]);
    expect(await porta.podeGravar(c, 'gravarIntegracao')).toMatchObject({ pode: true });
    expect(await porta.podeGravar(c, OPERACAO_TITULOS_FOLHA)).toMatchObject({
      pode: false,
      codigo: 'modelo-pendente',
    });
  });

  it('operações ainda não ligadas: recusa 503 com a operação na mensagem (nunca vazio)', async () => {
    const { porta } = dubleDe([]);
    const chamadas: [keyof typeof SEM_MODELO_INTEGRACAO_FOLHA, () => Promise<unknown>][] = [
      ['retorno', () => porta.retorno()],
      ['lancamentos', () => porta.lancamentos()],
      ['lancamento', () => porta.lancamento()],
      ['lancamentoDaOrigem', () => porta.lancamentoDaOrigem()],
      ['titulosDoLancamento', () => porta.titulosDoLancamento()],
      ['chavesLancadas', () => porta.chavesLancadas()],
      ['custoPessoal', () => porta.custoPessoal()],
      ['executar', () => porta.executar()],
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
