// W0-01: o carregador único do catálogo de operações junta os arquivos por prefixo e recusa nome repetido entre
// arquivos e operação gravada no arquivo de outro prefixo (testes negativos).
import { describe, expect, it } from 'vitest';
import { catalogoUnico, juntarFatiasCatalogo, prefixoDoArquivoCatalogo } from './fatias.js';

const op = (nome: string, estado: unknown = 'especificada') => ({
  nome,
  modulo: nome.split('.')[0],
  grupo: nome.split('.')[0],
  descricao: 'teste',
  tabelas_gravadas: [{ tabela: 'TBX', acao: 'INSERT' }],
  triggers: [],
  o_que_o_novo_nao_faz: [],
  origem_especificacao: 'perfil-passivo',
  arquivo_origem: null,
  cenarios_assinatura: ['minimo'],
  estado,
});
const fatia = (arquivo: string, ...ops: unknown[]) => ({ arquivo, dados: { formato: 1, operacoes: ops } });

describe('carregador do catálogo por prefixo (W0-01)', () => {
  it('junta os arquivos e devolve as operações na ordem do nome, validadas pelo esquema', () => {
    const cat = juntarFatiasCatalogo([
      fatia('cadastro.yaml', op('cadastro.zeta'), op('cadastro.alfa', { pc: 'verde' })),
      fatia('agenda.yaml', op('agenda.marcar')),
      { arquivo: 'pep.yaml', dados: { formato: 1, operacoes: null } },
    ]);
    expect(cat.operacoes.map((o) => o.nome)).toEqual(['agenda.marcar', 'cadastro.alfa', 'cadastro.zeta']);
    expect(cat.operacoes[1]?.estado).toEqual({ pc: 'verde' });
    expect(cat.operacoes[0]?.tabelas_efeito).toEqual([]);
  });

  it('recusa o mesmo nome em dois arquivos', () => {
    expect(() =>
      juntarFatiasCatalogo([
        fatia('cadastro.yaml', op('cadastro.alfa')),
        fatia('agenda.yaml', op('agenda.marcar'), { ...op('cadastro.alfa'), modulo: 'cadastro' }),
      ]),
    ).toThrow(/cadastro\.alfa: nome repetido \(cadastro\.yaml e agenda\.yaml\)/);
  });

  it('recusa o mesmo nome repetido dentro do arquivo', () => {
    expect(() =>
      juntarFatiasCatalogo([fatia('agenda.yaml', op('agenda.marcar'), op('agenda.marcar'))]),
    ).toThrow(/nome repetido/);
  });

  it('recusa operação gravada no arquivo de outro prefixo', () => {
    expect(() => juntarFatiasCatalogo([fatia('agenda.yaml', op('cadastro.alfa'))])).toThrow(
      /agenda\.yaml: cadastro\.alfa fora do arquivo do seu prefixo \(vai em cadastro\.yaml\)/,
    );
  });

  it('recusa arquivo fora da regra do nome, arquivo repetido e arquivo fora do formato', () => {
    expect(() => juntarFatiasCatalogo([fatia('Cadastro.yaml', op('cadastro.alfa'))])).toThrow(
      /fora da regra/,
    );
    expect(() =>
      juntarFatiasCatalogo([
        fatia('cadastro.yaml', op('cadastro.alfa')),
        fatia('cadastro.yaml', op('cadastro.beta')),
      ]),
    ).toThrow(/arquivo repetido/);
    expect(() =>
      juntarFatiasCatalogo([{ arquivo: 'cadastro.yaml', dados: { formato: 2, operacoes: [] } }]),
    ).toThrow(/fora do formato/);
  });

  it('as regras do esquema continuam valendo no catálogo junto (estado conferida sem conferência)', () => {
    expect(() =>
      juntarFatiasCatalogo([fatia('cadastro.yaml', op('cadastro.alfa', { pc: 'conferida' }))]),
    ).toThrow(/sem registro de conferência/);
  });

  it('erro do esquema diz o arquivo, a operação e o campo, nunca a posição na lista juntada (revisão)', () => {
    let msg = '';
    try {
      juntarFatiasCatalogo([
        fatia('agenda.yaml', ...Array.from({ length: 5 }, (_, i) => op(`agenda.marcar${i}`))),
        fatia('same.yaml', op('same.incluirSetor', { pc: 'verdao' })),
      ]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/same\.yaml: same\.incluirSetor: estado/);
    expect(msg).not.toMatch(/operacoes|\b5\b/);
    // Regra transversal (superRefine) também sai com arquivo e operação.
    expect(() =>
      juntarFatiasCatalogo([
        fatia('agenda.yaml', op('agenda.marcar')),
        fatia('cadastro.yaml', op('cadastro.alfa', { pc: 'conferida' })),
      ]),
    ).toThrow(/cadastro\.yaml: cadastro\.alfa: conferencias estado conferida\/liberada sem registro/);
  });

  it('prefixo do arquivo e catálogo de texto único', () => {
    expect(prefixoDoArquivoCatalogo('docs/operacoes/catalogo/cadastro.yaml')).toBe('cadastro');
    expect(prefixoDoArquivoCatalogo('cadastro.yml')).toBeNull();
    expect(
      catalogoUnico({ formato: 1, operacoes: [op('pep.bb'), op('agenda.aa')] }).operacoes.map((o) => o.nome),
    ).toEqual(['agenda.aa', 'pep.bb']);
  });
});
