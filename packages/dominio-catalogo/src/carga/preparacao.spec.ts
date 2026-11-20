import { definicaoCatalogo, type DefinicaoCatalogo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { arquivoBaseCep, arquivoTbProcedimento, arquivoTuss } from '../sinteticos.js';
import { itemDoLote, type LeituraDoBanco, prepararCarga } from './preparacao.js';

const def = (c: string) => definicaoCatalogo(c) as DefinicaoCatalogo;
const banco = (
  atuais: Record<string, Record<string, Record<string, string | number | null>>>,
  ultima: string | null = null,
): LeituraDoBanco => ({
  atuais: async (e, chaves) =>
    new Map(chaves.filter((k) => atuais[e]?.[k]).map((k) => [k, atuais[e]?.[k] ?? {}])),
  existentes: async (e) => Object.keys(atuais[e] ?? {}),
  edicao: async () => ({ ultima, versoesTiss: ['4.02.00'] }),
});

describe('preparação da carga (três passos)', () => {
  it('SIGTAP: competência do arquivo, alterado em lote e removido na fonte', async () => {
    const t = arquivoTbProcedimento([
      { codigo: '0301010072', nome: 'CONSULTA', competencia: '201312', valorSh: 1, valorSp: 2 },
      { codigo: '0301010080', nome: 'OUTRA', competencia: '201312' },
    ]);
    const r = await prepararCarga(
      def('sigtap'),
      [{ nome: 'tb_procedimento.txt', conteudo: t }],
      null,
      banco(
        {
          procedimento: {
            'codigo=0301010072': {
              codigo: '0301010072',
              nome: 'CONSULTA',
              valorSh: 0.5,
              valorSa: 0,
              valorSp: 2,
            },
            'codigo=0301010099': { codigo: '0301010099', nome: 'SAIU' },
          },
        },
        '201311',
      ),
      { tamanhoLote: 1 },
    );
    expect(r.edicao).toBe('201312');
    expect(r.errosArquivo).toEqual([]);
    expect(r.totais).toMatchObject({ linhas: 2, validas: 2, erros: 0, novos: 1, alterados: 1, removidos: 1 });
    // O procedimento novo não é incluído pela carga (semInclusao); o existente é publicado na competência.
    expect(r.aPublicar).toHaveLength(1);
    expect(r.lotes).toBe(1);
    expect(r.linhas.find((l) => l.comparacao === 'novo')?.motivos[0]).toContain('não incluído');
    const alt = r.aPublicar.find((x) => x.acao === 'alterar');
    expect(alt).toEqual({
      entidade: 'procedimento',
      acao: 'alterar',
      chave: { codigo: '0301010072' },
      valores: { valorSh: 1 },
      antes: { valorSh: 0.5 },
    });
  });
  it('competência anterior à do banco: recusada, nada a publicar', async () => {
    const t = arquivoTbProcedimento([{ codigo: '0301010072', nome: 'X', competencia: '201301' }]);
    const r = await prepararCarga(
      def('sigtap'),
      [{ nome: 'tb_procedimento.txt', conteudo: t }],
      null,
      banco({}, '201311'),
    );
    expect(r.decisaoEdicao.ok).toBe(false);
    expect(r.aPublicar).toEqual([]);
  });
  it('TUSS em versão inexistente (DP-37) e arquivo de outro catálogo', async () => {
    const r = await prepararCarga(
      def('tuss'),
      [{ nome: 'TUSS38.csv', conteudo: arquivoTuss([{ codigo: '9001', nome: 'X' }]) }],
      '4.03.00',
      banco({}),
    );
    expect(r.errosArquivo[0]).toContain('4.03.00');
    const x = await prepararCarga(def('tuss'), [{ nome: 'outro.csv', conteudo: 'a' }], '4.02.00', banco({}));
    expect(x.errosArquivo[0]).toContain('não é um arquivo oficial');
  });
  it('CEP: removidos só da UF do arquivo', async () => {
    const t = arquivoBaseCep([{ cep: '99990001', uf: 'ZZ', cidade: 'X', logradouro: 'R', bairro: 'B' }], []);
    const r = await prepararCarga(def('cep'), [{ nome: 'base.txt', conteudo: t }], null, {
      atuais: async () => new Map(),
      existentes: async (_e, escopo) => (escopo.get('uf')?.has('ZZ') ? ['cep=99990002'] : []),
      edicao: async () => ({ ultima: null, versoesTiss: [] }),
    });
    expect(r.totais).toMatchObject({ novos: 1, removidos: 1 });
  });
  it('lista nacional de agravos: o CID notificável que falta no arquivo volta a 0 (alteração, nunca exclusão)', async () => {
    const pedidas: string[][] = [];
    const atuais: Record<string, Record<string, string | number>> = {
      'codigo=A90': { codigo: 'A90', periodicidade: 0 },
      'codigo=A010': { codigo: 'A010', periodicidade: 1 },
      'codigo=B24': { codigo: 'B24', periodicidade: 2 },
    };
    const r = await prepararCarga(
      def('agravos'),
      [{ nome: 'AGRAVOS_CID.csv', conteudo: 'cid;periodicidade\nA90;1\nB24;2' }],
      null,
      {
        atuais: async (_e, chaves) => {
          pedidas.push([...chaves]);
          return new Map(chaves.filter((k) => atuais[k]).map((k) => [k, atuais[k] ?? {}]));
        },
        // Só os notificáveis do cadastro (o filtro das chaves existentes da entidade).
        existentes: async () => ['codigo=A010', 'codigo=B24'],
        edicao: async () => ({ ultima: null, versoesTiss: [] }),
      },
    );
    expect(r.errosArquivo).toEqual([]);
    expect(r.totais).toMatchObject({ novos: 0, alterados: 2, iguais: 1, removidos: 0 });
    expect(pedidas[1]).toEqual(['codigo=A010']);
    const saiu = r.linhas.find((l) => l.chave === 'codigo=A010');
    expect(saiu).toMatchObject({ comparacao: 'alterado', publicar: true, depois: { periodicidade: 0 } });
    expect(saiu?.motivos[0]).toContain('saiu da lista');
    expect(r.aPublicar).toEqual(
      expect.arrayContaining([
        {
          entidade: 'cidAgravo',
          acao: 'alterar',
          chave: { codigo: 'A90' },
          valores: { periodicidade: 1 },
          antes: { periodicidade: 0 },
        },
        {
          entidade: 'cidAgravo',
          acao: 'alterar',
          chave: { codigo: 'A010' },
          valores: { periodicidade: 0 },
          antes: { periodicidade: 1 },
        },
      ]),
    );
    expect(r.aPublicar).toHaveLength(2);
  });
  it('item do lote de inclusão', () => {
    expect(
      itemDoLote({
        entidade: 'cbo',
        linha: 1,
        chave: 'codigo=225125',
        resultado: 'valida',
        comparacao: 'novo',
        antes: null,
        depois: { codigo: '225125', nome: 'X' },
        motivos: [],
        publicar: true,
      }),
    ).toEqual({
      entidade: 'cbo',
      acao: 'incluir',
      chave: { codigo: '225125' },
      valores: { codigo: '225125', nome: 'X' },
    });
  });
});
