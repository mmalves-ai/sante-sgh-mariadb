// M58-F4 (regra 8): o verificador de contrato (forma do exemplo da especificação contra a resposta) e as respostas
// puras da fachada contra o contrato da versão 0.23.0 da API original.
import { CATALOGO_FACHADA, CONTRATO_SANTE_API, type FormaRespostaFachada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { quebrasDeContrato, recortarForma } from './contrato.js';
import { lerFiltroConvenios, responderConvenio, responderConvenios } from './convenios.js';

const forma = (id: string, status = '200'): FormaRespostaFachada => {
  const [metodo, caminho] = id.split(' ');
  const op = CONTRATO_SANTE_API.operacoes.find((o) => o.metodo === metodo && o.caminho === caminho);
  const f = op?.respostas[status];
  if (f === undefined) throw new Error(`sem exemplo ${status} para ${id}`);
  return f;
};

describe('verificador de contrato', () => {
  it('aceita chave a mais e nulo; recusa chave ausente, tipo trocado e lista', () => {
    const f = { total: 'number', itens: [{ codigo: 'number', nome: 'string' }], extra: 'null' };
    expect(
      quebrasDeContrato(f, { total: 1, itens: [{ codigo: 1, nome: null, x: 1 }], extra: 9, y: 0 }),
    ).toEqual([]);
    expect(quebrasDeContrato(f, { total: '1', itens: [{ nome: 'a' }] })).toEqual([
      '$.total: esperado number, veio string',
      '$.itens[0].codigo: ausente',
      '$.extra: ausente',
    ]);
    expect(quebrasDeContrato(f, { total: 1, itens: {}, extra: null })).toEqual([
      '$.itens: esperada lista, veio object',
    ]);
    expect(quebrasDeContrato(f, [])).toEqual(['$: esperado objeto, veio lista']);
    expect(quebrasDeContrato([], [1, 'a'])).toEqual([]);
    expect(recortarForma(f, ['total', 'nada'])).toEqual({ total: 'number' });
  });

  it('o contrato tem a forma da resposta de toda operação servida, sem valor de exemplo', () => {
    for (const o of CATALOGO_FACHADA.filter((x) => x.servidaPeloSante)) expect(forma(o.id)).toBeTruthy();
    // Só tipos: nenhum valor do exemplo (nome de pessoa ou convênio) entra no repositório.
    const folhas =
      JSON.stringify(CONTRATO_SANTE_API.operacoes.map((o) => o.respostas)).match(/:"[^"]*"/g) ?? [];
    expect(new Set(folhas.map((x) => x.slice(2, -1)))).toEqual(
      new Set(['string', 'number', 'boolean', 'null']),
    );
  });

  it('as respostas puras dos convênios satisfazem o contrato', () => {
    const linhas = [
      { cod: 10, nome: 'PARTICULAR', situacao: 'A', permiteAtend: 1 },
      { cod: 30, nome: 'CONVENIO SINTETICO DOIS', situacao: 'I', permiteAtend: 0 },
    ];
    expect(
      quebrasDeContrato(forma('GET /convenios'), responderConvenios(linhas, lerFiltroConvenios({}))),
    ).toEqual([]);
    expect(quebrasDeContrato(forma('GET /convenios/{codigo}'), responderConvenio(linhas[0]!))).toEqual([]);
  });
});
