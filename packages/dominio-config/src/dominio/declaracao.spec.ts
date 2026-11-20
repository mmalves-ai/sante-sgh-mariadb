// Regra 1 e regra 5 do M08: a declaração é a única fonte; sem opção do legado nem permissão nova, recusada;
// fonte oficial e sistema só para consulta. Declarações SINTÉTICAS (tabela fictícia TBSINTETICA).
import {
  type DeclaracaoDominio,
  type DeclaracaoPermissao,
  type DominioPublico,
  permissaoDoDominio,
  SUBITENS_DOMINIOS,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type ContextoDeclaracao,
  maximoInteiro,
  tamanhoDoTipo,
  type TabelaCatalogo,
  validarDeclaracao,
} from './declaracao.js';

const publico: DominioPublico = {
  modulo: 'cadastro',
  recurso: 'itemSintetico',
  rotulo: { singular: 'Item sintético', plural: 'Itens sintéticos' },
  subitem: 'demograficos',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
  opcoesLegado: { ler: [1], criar: [1], editar: [1], inativar: [1], exportar: [1] },
  origemOpcoes: 'tbopcoes',
  marco: 'M08',
};

const base: DeclaracaoDominio = {
  publico,
  grupo: 'cadastro',
  tabela: 'TBSINTETICA',
  chave: 'ID',
  colunas: [
    {
      coluna: 'ID',
      campo: 'codigo',
      rotulo: 'Código',
      tipo: 'inteiro',
      obrigatorio: true,
      editavel: false,
      naInclusao: false,
      naLista: true,
      codigo: 'generator',
    },
    {
      coluna: 'NOME',
      campo: 'nome',
      rotulo: 'Descrição',
      tipo: 'texto',
      maxBytes: 30,
      obrigatorio: true,
      editavel: true,
      naInclusao: true,
      naLista: true,
    },
    {
      coluna: 'ATIVO',
      campo: 'ativo',
      rotulo: 'Ativo',
      tipo: 'letra',
      maxBytes: 1,
      valores: [
        { valor: 'T', rotulo: 'Sim' },
        { valor: 'F', rotulo: 'Não' },
      ],
      obrigatorio: false,
      editavel: false,
      naInclusao: false,
      naLista: false,
      constanteNaInclusao: 'T',
    },
  ],
  descricao: 'nome',
  situacao: { coluna: 'ATIVO', ativo: 'T', inativo: 'F', evidencia: 'CHECK (ATIVO IN (T, F))' },
  unico: [['nome']],
  triggers: [{ nome: 'TRG_TBSINTETICA_BI', faz: 'ID por generator' }],
};

const tabela: TabelaCatalogo = {
  pk: ['ID'],
  colunas: [
    { nome: 'ID', tipo: 'SMALLINT', anulavel: false, padrao: null },
    { nome: 'NOME', tipo: 'VARCHAR(30)', anulavel: false, padrao: null },
    { nome: 'ATIVO', tipo: 'CHAR(1)', anulavel: true, padrao: "DEFAULT 'T'" },
  ],
};

function permissoes(
  d: DominioPublico,
  extra: Partial<DeclaracaoPermissao> = {},
): Map<string, DeclaracaoPermissao> {
  return new Map(
    d.acoes.map((a) => {
      const codigo = permissaoDoDominio(d, a);
      return [codigo, { codigo, descricao: 'x', opcoesLegado: [1], concessaoPorPerfil: null, ...extra }];
    }),
  );
}

function ctx(over: Partial<ContextoDeclaracao> = {}, d: DominioPublico = publico): ContextoDeclaracao {
  return {
    permissoes: permissoes(d),
    tabela: (n) => (n === 'TBSINTETICA' ? tabela : null),
    itensArvore: new Set(Object.values(SUBITENS_DOMINIOS)),
    destino: (n) => (n === 'TBSINTETICA' ? 'migrar-crud' : null),
    triggerGeraChave: () => true,
    ...over,
  };
}

const regras = (d: DeclaracaoDominio, c = ctx({}, d.publico)) => validarDeclaracao(d, c).map((p) => p.regra);

describe('declaração do CRUD genérico (regra 1)', () => {
  it('declaração completa e coerente: nenhum problema', () => {
    expect(validarDeclaracao(base, ctx())).toEqual([]);
  });

  it('declaração sem opção do legado é recusada', () => {
    const d = {
      ...base,
      publico: {
        ...publico,
        opcoesLegado: { ler: [], criar: [1], editar: [1], inativar: [1], exportar: [1] },
      },
    };
    expect(regras(d)).toContain('opcoes-legado');
  });

  it('permissão sem opção legada nem concessão por perfil (permissão nova) é recusada', () => {
    const c = ctx({ permissoes: permissoes(publico, { opcoesLegado: [], concessaoPorPerfil: null }) });
    expect(validarDeclaracao(base, c).map((p) => p.regra)).toContain('permissao');
  });

  it('permissão nova concedida por perfil é aceita', () => {
    const c = ctx({
      permissoes: permissoes(publico, { opcoesLegado: [], concessaoPorPerfil: 'por-perfil' }),
    });
    expect(validarDeclaracao(base, c)).toEqual([]);
  });

  it('permissão ausente do catálogo é recusada', () => {
    expect(validarDeclaracao(base, ctx({ permissoes: new Map() })).map((p) => p.regra)).toContain(
      'permissao',
    );
  });

  it('sem a ação ler é recusada', () => {
    const d = { ...base, publico: { ...publico, acoes: ['criar', 'editar', 'inativar'] as const } };
    expect(regras(d)).toContain('acoes');
  });

  it('coluna fora do catálogo, tabela fora do catálogo e chave que não é a PK', () => {
    const d = {
      ...base,
      colunas: [...base.colunas, { ...base.colunas[1]!, coluna: 'NAO_EXISTE', campo: 'outro' }],
    };
    expect(regras(d)).toContain('catalogo');
    expect(regras({ ...base, tabela: 'TBOUTRA' }, ctx({ destino: () => 'migrar-crud' }))).toEqual([
      'catalogo',
    ]);
    expect(regras({ ...base, chave: 'NOME' })).toContain('chave');
  });

  it('M51.4: tabela sem PK no catálogo aceita a chave gerada pelo trigger com o índice único declarado', () => {
    const semPk = ctx({ tabela: (n) => (n === 'TBSINTETICA' ? { ...tabela, pk: [] } : null) });
    expect(regras(base, semPk)).not.toContain('chave');
    expect(regras({ ...base, unico: [] }, semPk)).toContain('chave');
    expect(regras(base, { ...semPk, triggerGeraChave: () => false })).toContain('chave');
  });
  it('tamanho maior que o da coluna e texto declarado em coluna numérica', () => {
    const d = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, maxBytes: 31 } : c)),
    };
    expect(regras(d)).toContain('tamanho');
    const sem = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, maxBytes: undefined } : c)),
    };
    expect(regras(sem as DeclaracaoDominio)).toContain('tamanho');
    const errado = {
      ...base,
      colunas: base.colunas.map((c) =>
        c.coluna === 'ID' ? { ...c, tipo: 'texto' as const, maxBytes: 2 } : c,
      ),
    };
    expect(regras(errado)).toContain('tipo');
  });

  it('inteiro acima do tipo e inteiro em coluna de texto', () => {
    const d = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'ID' ? { ...c, maximo: 99_999 } : c)),
    };
    expect(regras(d)).toContain('tamanho');
    const t = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, tipo: 'inteiro' as const } : c)),
    };
    expect(regras(t)).toContain('tipo');
  });

  it('letra sem valores vistos e referência sem fonte', () => {
    const d = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'ATIVO' ? { ...c, valores: [] } : c)),
    };
    expect(regras(d)).toContain('valores');
    const r = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, tipo: 'referencia' as const } : c)),
    };
    expect(regras(r)).toContain('referencia');
  });

  it('chave: estratégia ausente, editável, generator sem trigger e manual fora da inclusão', () => {
    const muda = (x: object) => ({
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'ID' ? { ...c, ...x } : c)),
    });
    expect(regras(muda({ codigo: undefined }) as DeclaracaoDominio)).toContain('chave');
    expect(regras(muda({ editavel: true }))).toContain('chave');
    expect(regras(base, ctx({ triggerGeraChave: () => false }))).toContain('chave');
    expect(regras(muda({ codigo: 'manual', naInclusao: false }))).toContain('chave');
    expect(regras({ ...base, colunas: base.colunas.filter((c) => c.coluna !== 'ID') })).toContain('chave');
  });

  it('NOT NULL sem valor na inclusão', () => {
    const d = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, naInclusao: false } : c)),
    };
    expect(regras(d)).toContain('inclusao');
  });

  it('descrição, unicidade, nome e campo repetido', () => {
    expect(regras({ ...base, descricao: 'outro' })).toContain('descricao');
    expect(regras({ ...base, unico: [['outro']] })).toContain('unico');
    const rep = { ...base, colunas: [...base.colunas, { ...base.colunas[1]!, coluna: 'ATIVO' }] };
    expect(regras(rep)).toContain('nome');
    const inval = {
      ...base,
      colunas: base.colunas.map((c) => (c.coluna === 'NOME' ? { ...c, campo: 'Nome!' } : c)),
    };
    expect(regras(inval)).toContain('nome');
  });

  it('editar sem campo editável, e inativar sem situação (e o contrário)', () => {
    const sem = { ...base, colunas: base.colunas.map((c) => ({ ...c, editavel: false })) };
    expect(regras(sem)).toContain('editar');
    const semSituacao: DeclaracaoDominio = { ...base, situacao: undefined } as unknown as DeclaracaoDominio;
    expect(regras(semSituacao)).toContain('situacao');
    const p2 = { ...publico, acoes: ['ler', 'criar', 'editar', 'exportar'] as const };
    expect(regras({ ...base, publico: p2 }, ctx({ permissoes: permissoes(p2) }, p2))).toContain('situacao');
  });

  it('situação com coluna inexistente, letras iguais e sem evidência', () => {
    expect(regras({ ...base, situacao: { ...base.situacao!, coluna: 'NAO' } })).toContain('situacao');
    expect(regras({ ...base, situacao: { ...base.situacao!, inativo: 'T' } })).toContain('situacao');
    expect(regras({ ...base, situacao: { ...base.situacao!, evidencia: '' } })).toContain('situacao');
  });

  it('subitem fora da árvore e tabela fora da matriz ou com outro destino', () => {
    expect(regras(base, ctx({ itensArvore: new Set() }))).toContain('arvore');
    expect(regras(base, ctx({ destino: () => null }))).toContain('matriz');
    expect(regras(base, ctx({ destino: () => 'migrar-movimento' }))).toContain('matriz');
  });
});

describe('natureza (regra 5): fonte oficial e sistema só para consulta', () => {
  const consulta = (natureza: DominioPublico['natureza'], extra: Partial<DominioPublico> = {}) => {
    const p: DominioPublico = {
      ...publico,
      natureza,
      acoes: ['ler', 'exportar'],
      opcoesLegado: { ler: [1], exportar: [1] },
      motivoSomenteLeitura: 'motivo',
      ...extra,
    };
    const d = {
      ...base,
      publico: p,
      colunas: base.colunas.map((c) => ({ ...c, editavel: false })),
      situacao: undefined,
    } as unknown as DeclaracaoDominio;
    return {
      d,
      c: ctx(
        {
          permissoes: permissoes(p),
          destino: () => (natureza === 'carga-referencia' ? 'carga-referencia' : 'migrar-crud'),
        },
        p,
      ),
    };
  };
  it('carga-referencia só com ler/exportar é aceita; com escrita, recusada', () => {
    const { d, c } = consulta('carga-referencia');
    expect(validarDeclaracao(d, c)).toEqual([]);
    const p = {
      ...d.publico,
      acoes: ['ler', 'criar', 'exportar'] as const,
      opcoesLegado: { ler: [1], criar: [1], exportar: [1] },
    };
    expect(
      validarDeclaracao({ ...d, publico: p }, { ...c, permissoes: permissoes(p) }).map((x) => x.regra),
    ).toContain('natureza');
  });
  it('sistema sem motivo é recusada; editável sem incluir é recusada; destino errado de fonte oficial', () => {
    const { d, c } = consulta('sistema', {
      motivoSomenteLeitura: undefined,
    } as unknown as Partial<DominioPublico>);
    expect(validarDeclaracao(d, c).map((x) => x.regra)).toContain('natureza');
    const { d: d2, c: c2 } = consulta('editavel');
    expect(validarDeclaracao(d2, c2).map((x) => x.regra)).toContain('natureza');
    const { d: d3, c: c3 } = consulta('carga-referencia');
    expect(validarDeclaracao(d3, { ...c3, destino: () => 'migrar-crud' }).map((x) => x.regra)).toContain(
      'matriz',
    );
  });
});

describe('tipos do catálogo', () => {
  it('tamanho e máximo', () => {
    expect(tamanhoDoTipo('VARCHAR(30)')).toEqual({ base: 'VARCHAR', tamanho: 30, escala: null });
    expect(tamanhoDoTipo('NUMERIC(2,0)')).toEqual({ base: 'NUMERIC', tamanho: 2, escala: 0 });
    expect(tamanhoDoTipo('???')).toEqual({ base: '???', tamanho: null, escala: null });
    expect(maximoInteiro('SMALLINT')).toBe(32767);
    expect(maximoInteiro('INTEGER')).toBe(2147483647);
    expect(maximoInteiro('NUMERIC(1,0)')).toBe(9);
    expect(maximoInteiro('NUMERIC(9,2)')).toBeNull();
    expect(maximoInteiro('VARCHAR(2)')).toBeNull();
  });
});
