// Correções do M13: item novo que esta carga não inclui (mat/med TUSS), pares cujo código referenciado não
// existe no banco nem entra na carga (SIGTAP, CID-O) e a ordem de publicação (o código antes do par).
import { definicaoCatalogo, type DefinicaoCatalogo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { compararEdicao } from '../comparacao.js';
import { arquivoRelacaoCid, arquivoTbProcedimento } from '../sinteticos.js';
import type { ItemValidado } from '../validacao.js';
import { type LeituraDoBanco, ordemDePublicacao, prepararCarga } from './preparacao.js';

const def = (c: string) => definicaoCatalogo(c) as DefinicaoCatalogo;
const item = (
  entidade: string,
  linha: number,
  chave: Record<string, string>,
  extra: Record<string, string> = {},
): ItemValidado => ({
  entidade,
  linha,
  chave: Object.entries(chave)
    .map(([k, v]) => `${k}=${v}`)
    .join(';'),
  resultado: 'valida',
  campos: { ...chave, ...extra },
  motivos: [],
});

describe('itens que esta carga não inclui', () => {
  it('mat/med TUSS novo: "não incluído" e fora da publicação (o lote nunca é recusado por ele)', () => {
    const r = compararEdicao(
      def('tuss'),
      [item('materialTuss', 1, { codigo: '90000001' }, { nome: 'NOVO' })],
      new Map(),
    );
    expect(r.itens[0]).toMatchObject({ comparacao: 'novo', publicar: false });
    expect(r.itens[0]?.motivos.join(' ')).toContain('não incluído');
  });

  it('SIGTAP: par de procedimento novo ou de CID inexistente não é incluído; o par conhecido é', async () => {
    const banco: LeituraDoBanco = {
      atuais: async (e, chaves) =>
        new Map(
          chaves
            .filter((k) => e === 'procedimento' && k === 'codigo=0301010072')
            .map((k) => [k, { codigo: '0301010072', nome: 'CONSULTA' }]),
        ),
      existentes: async () => [],
      edicao: async () => ({ ultima: '201311', versoesTiss: [] }),
      referencias: async (tabela, codigos) =>
        new Set(codigos.filter((x) => (tabela === 'cid10' ? x === 'A000' : x === '0301010072'))),
    };
    const r = await prepararCarga(
      def('sigtap'),
      [
        {
          nome: 'tb_procedimento.txt',
          conteudo: arquivoTbProcedimento([
            { codigo: '0301010072', nome: 'CONSULTA', competencia: '201312' },
            { codigo: '0301010099', nome: 'NOVO', competencia: '201312' },
          ]),
        },
        {
          nome: 'rl_procedimento_cid.txt',
          conteudo: arquivoRelacaoCid(
            [
              { procedimento: '0301010072', cid: 'A000' },
              { procedimento: '0301010099', cid: 'A000' },
              { procedimento: '0301010072', cid: 'Z999' },
            ],
            '201312',
          ),
        },
      ],
      null,
      banco,
    );
    expect(r.errosArquivo).toEqual([]);
    const pares = r.linhas.filter((l) => l.entidade === 'procedimentoCid');
    expect(pares.map((p) => [p.chave, p.publicar])).toEqual([
      ['procedimento=0301010072;cid=A000', true],
      ['procedimento=0301010099;cid=A000', false],
      ['procedimento=0301010072;cid=Z999', false],
    ]);
    expect(pares[1]?.motivos.join(' ')).toContain(
      'procedimento 0301010099 não existe no banco nem entra nesta carga',
    );
    expect(pares[2]?.motivos.join(' ')).toContain('CID Z999');
    expect(r.aPublicar.map((i) => i.entidade)).toEqual(['procedimento', 'procedimentoCid']);
  });

  it('CID-O: morfologia nova da mesma carga satisfaz o par; a ordem põe o CID-10 antes do par', () => {
    const itens = [
      item('cidMorfologia', 1_000_001, { cid: 'A000', morfologia: 'M90009' }),
      item('cidMorfologia', 1_000_002, { cid: 'A000', morfologia: 'M99999' }),
      item('cid10', 1, { codigo: 'M90009' }, { nome: 'MORF NOVA' }),
    ];
    const r = compararEdicao(def('cid'), itens, new Map(), {
      referencias: new Map([['cid10', new Set(['A000'])]]),
    });
    expect(r.itens.map((i) => [i.chave, i.publicar])).toEqual([
      ['cid=A000;morfologia=M90009', true],
      ['cid=A000;morfologia=M99999', false],
      ['codigo=M90009', true],
    ]);
    expect(
      ordemDePublicacao(
        def('cid'),
        r.itens.filter((i) => i.publicar),
      ).map((i) => i.entidade),
    ).toEqual(['cid10', 'cidMorfologia']);
  });
});
