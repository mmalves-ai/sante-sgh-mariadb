// W0-02: o motor do CRUD genérico com os verbos novos, no banco em memória (o mesmo executor e a mesma receita):
//   - excluir o item nunca usado apaga a linha e grava o retrato (categoria protegida) e o evento (motivo, valor anterior);
//   - excluir o item referenciado (FK de entrada) recusa com 409 com-dependentes, a contagem e a amostra das chaves, e a
//     oferta de inativar; a referência lógica (sem FK, do mapa) também recusa; nada é apagado;
//   - a categoria regra de apoio à decisão ou formulário não aceita `excluir` (o motor nem monta a operação);
//   - reativar pela coluna de situação grava a letra de ativo, com motivo; o item ativo é recusado;
//   - o mapa de dependências tem formato conferido (justificativa obrigatória com a lista vazia).
// As declarações de teste partem das reais (hotelaria.area e a ligação área × profissional da higienização), com `excluir`.
import type { DeclaracaoDominio } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { declaracao, DECLARACOES, rotuloDaTabelaDeDominio } from '../../cadastros.js';
import { BancoRoteiro } from '../banco-roteiro.spec-util.js';
import type { ContextoOperacao } from '../operacao.js';
import { ErroOperacao } from '../erros-operacao.js';
import { exclusaoProibida, operacoesDoDominio, type OperacaoDominio } from '../gravacao/receita-generica.js';
import { conferirMapa, frasesDosDependentes, mapaDoDominio } from './dependencias.js';
import { BancoMemoriaDominios } from './memoria.js';
import { itemDoDominio, listarDominio, usoDoItem } from './repositorio.js';

let n = 0;
const ctx = (): ContextoOperacao => ({
  rede: 'rede-teste',
  hospital: 'aa',
  traceId: 'teste-w002',
  usuarioLegado: 'SINT.ADMIN',
  idempotencyKey: `w002-${++n}-chave`,
  reautenticadoEm: Date.now(),
});
const catalogo = { estado: () => 'especificada' as const };

const base = declaracao('hotelaria.area')!;
const alergia: DeclaracaoDominio = {
  ...base,
  publico: { ...base.publico, acoes: [...base.publico.acoes, 'excluir'], categoria: 'dominio' },
  exclusao: {
    referenciasLogicas: [],
    semReferenciasLogicas: 'teste: o levantamento da cópia não achou coluna que guarde a área sem FK',
  },
};

function banco(d: DeclaracaoDominio, extras = {}) {
  return new BancoMemoriaDominios(
    DECLARACOES.map((x) => (x.tabela === d.tabela ? d : x)),
    extras,
  );
}
const ops = (d: DeclaracaoDominio) =>
  Object.fromEntries(
    operacoesDoDominio(
      d,
      (tx, decl, c) => usoDoItem(tx, decl, c),
      (id) => declaracao(id),
      rotuloDaTabelaDeDominio,
    ).map((o) => [o.receita.nome, o]),
  ) as Record<string, OperacaoDominio>;

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    throw e;
  }
}

describe('W0-02: excluir no motor do CRUD genérico', () => {
  it('monta excluir só no domínio que a declara, crítica e com os dois cenários', () => {
    const o = ops(alergia)['hotelaria.excluirArea'];
    expect(o).toBeDefined();
    expect(o!.receita.critica).toBe(true);
    expect(o!.receita.passos.map((p) => p.acao)).toEqual(['DELETE']);
    expect(o!.receita.registrosSgh).toEqual(['SGH_HIST_EXCLUSAO', 'SGH_CRUD_EVENTO']);
    expect(o!.receita.cenarios.map((c) => c.nome)).toEqual(['nunca-usado', 'recusa-com-dependentes']);
    expect(ops(base)['hotelaria.excluirArea']).toBeUndefined();
  });

  it('o item nunca usado é apagado; o retrato e o evento vão na mesma transação', async () => {
    const b = banco(alergia);
    const ex = b.criarExecutor(catalogo, 'ci');
    const o = ops(alergia);
    const r = await ex.executar(
      o['hotelaria.incluirArea']!,
      'aa',
      { nome: 'AREA SINTETICA W002', criticidade: 1 },
      ctx(),
    );
    const codigo = String(r.resultado['codigo']);
    const item = await b.ler('aa', (l) => itemDoDominio(l, alergia, codigo));
    const r2 = await ex.executar(
      o['hotelaria.excluirArea']!,
      'aa',
      { codigo, versao: item!.versao, motivo: 'cadastrado por engano' },
      ctx(),
    );
    expect(r2.resultado['codigo']).toBe(codigo);
    expect(await b.ler('aa', (l) => itemDoDominio(l, alergia, codigo))).toBeNull();
  });

  it('o item referenciado por FK recusa com 409 com-dependentes, a contagem, a amostra e a oferta de inativar', async () => {
    const b = banco(alergia);
    const ex = b.criarExecutor(catalogo, 'ci');
    const item = await b.ler('aa', (l) => itemDoDominio(l, alergia, '1'));
    let erro: ErroOperacao | null = null;
    try {
      await ex.executar(
        ops(alergia)['hotelaria.excluirArea']!,
        'aa',
        { codigo: '1', versao: item!.versao, motivo: 'tentativa com vínculo' },
        ctx(),
      );
    } catch (e) {
      erro = e as ErroOperacao;
    }
    expect(erro?.problema.codigo).toBe('com-dependentes');
    expect(erro?.problema.status).toBe(409);
    expect(erro?.problema.podeInativar).toBe(true);
    const dep = erro?.problema.dependentes ?? [];
    expect(dep.length).toBeGreaterThan(0);
    expect(dep[0]).toMatchObject({ origem: 'fk', rotulo: 'Profissionais por área' });
    expect(dep[0]!.quantidade).toBeGreaterThan(0);
    expect(dep[0]!.amostra.length).toBeGreaterThan(0);
    expect(erro?.problema.detail).toMatch(/registros? em Profissionais por área \(amostra: /);
    expect(await b.ler('aa', (l) => itemDoDominio(l, alergia, '1'))).not.toBeNull();
  });

  it('a referência só lógica (mapa, sem FK) também recusa', async () => {
    const comLogica: DeclaracaoDominio = {
      ...alergia,
      exclusao: {
        referenciasLogicas: [
          {
            tabela: 'HTALERGIA_TESTE',
            colunas: ['ID_TBALERGIA'],
            evidencia: 'teste',
            rotulo: 'Histórico de teste',
          },
        ],
      },
    };
    const b = banco(comLogica, {
      HTALERGIA_TESTE: { chave: 'ID', linhas: [] },
    });
    const ex = b.criarExecutor(catalogo, 'ci');
    const o = ops(comLogica);
    // O item novo não tem FK de entrada (a ligação sintética aponta para 1 a 3): só a referência lógica pesa.
    const r = await ex.executar(
      o['hotelaria.incluirArea']!,
      'aa',
      { nome: 'AREA LOGICA W002', criticidade: 1 },
      ctx(),
    );
    const codigo = String(r.resultado['codigo']);
    await b.escrever(
      'aa',
      (e) => e.executar('INSERT INTO HTALERGIA_TESTE (ID, ID_TBALERGIA) VALUES (?, ?)', [7, Number(codigo)]),
      true,
    );
    const item = await b.ler('aa', (l) => itemDoDominio(l, comLogica, codigo));
    let erro: ErroOperacao | null = null;
    try {
      await ex.executar(
        o['hotelaria.excluirArea']!,
        'aa',
        { codigo, versao: item!.versao, motivo: 'tentativa lógica' },
        ctx(),
      );
    } catch (e) {
      erro = e as ErroOperacao;
    }
    expect(erro?.problema.codigo).toBe('com-dependentes');
    expect(erro?.problema.dependentes).toEqual([
      { rotulo: 'Histórico de teste', quantidade: 1, amostra: ['7'], origem: 'logica' },
    ]);
  });

  it('regra de apoio à decisão e formulário não aceitam excluir (o motor recusa montar)', () => {
    for (const categoria of ['regra-apoio-decisao', 'formulario'] as const) {
      const d: DeclaracaoDominio = { ...alergia, publico: { ...alergia.publico, categoria } };
      expect(exclusaoProibida(d)).toMatch(/nova versão/);
      expect(() => ops(d)).toThrow(/não se exclui/);
    }
    expect(exclusaoProibida(alergia)).toBeNull();
  });

  it('o motivo é obrigatório (entrada inválida sem ele)', async () => {
    const b = banco(alergia);
    const ex = b.criarExecutor(catalogo, 'ci');
    const item = await b.ler('aa', (l) => itemDoDominio(l, alergia, '3'));
    expect(
      await codigoDe(
        ex.executar(
          ops(alergia)['hotelaria.excluirArea']!,
          'aa',
          { codigo: '3', versao: item!.versao, motivo: '' },
          ctx(),
        ),
      ),
    ).toBe('entrada-invalida');
  });
});

describe('W0-02: reativar pela coluna de situação', () => {
  it('inativa e reativa (letra de ativo), com motivo; o ativo é recusado', async () => {
    const d = declaracao('internacao.tipoLimpeza')!;
    const b = banco(d);
    const ex = b.criarExecutor(catalogo, 'ci');
    const o = ops(d);
    expect(o['internacao.reativarTipoLimpeza']?.receita.registrosSgh).toEqual(['SGH_CRUD_EVENTO']);
    const ativo = await b.ler('aa', (l) => itemDoDominio(l, d, '2'));
    expect(
      await codigoDe(
        ex.executar(
          o['internacao.reativarTipoLimpeza']!,
          'aa',
          { codigo: '2', versao: ativo!.versao, motivo: 'ja estava ativo' },
          ctx(),
        ),
      ),
    ).toBe('ja-ativo');
    await ex.executar(
      o['internacao.inativarTipoLimpeza']!,
      'aa',
      { codigo: '2', versao: ativo!.versao },
      ctx(),
    );
    const inativo = (await b.ler('aa', (l) => listarDominio(l, d))).itens.find((i) => i.codigo === '2')!;
    expect(inativo.ativo).toBe(false);
    await ex.executar(
      o['internacao.reativarTipoLimpeza']!,
      'aa',
      { codigo: '2', versao: inativo.versao, motivo: 'voltou a ser usado' },
      ctx(),
    );
    expect((await b.ler('aa', (l) => itemDoDominio(l, d, '2')))?.ativo).toBe(true);
  });
});

describe('W0-02: o mapa de dependências (formato)', () => {
  it('a lista vazia exige a justificativa; colunas na quantidade da chave; evidência', () => {
    expect(conferirMapa(mapaDoDominio(alergia))).toEqual([]);
    expect(conferirMapa({ ...mapaDoDominio(alergia), semReferenciasLogicas: undefined } as never)).toEqual([
      'lista de referências lógicas vazia sem a justificativa (semReferenciasLogicas)',
    ]);
    expect(
      conferirMapa({
        tabela: 'TBALERGIA',
        chave: ['ID'],
        referenciasLogicas: [{ tabela: 'X', colunas: ['A', 'B'], evidencia: '' }],
      }),
    ).toEqual(['X.A+B: 2 coluna(s) para a chave de 1', 'X.A+B: sem evidência']);
  });

  it('a frase da recusa diz quantos e quais, com a amostra', () => {
    expect(
      frasesDosDependentes(
        [
          {
            tabela: 'T',
            colunas: ['C'],
            origem: 'fk',
            quantidade: 3,
            amostra: ['1', '2', '3'],
            rotulo: 'Pacientes',
          },
          { tabela: 'U', colunas: ['C'], origem: 'logica', quantidade: 1, amostra: [], rotulo: 'Histórico' },
        ],
        'Este item',
        'Inative em vez disso.',
      ),
    ).toBe(
      'Este item tem 4 registros dependentes: 3 registros em Pacientes (amostra: 1, 2, 3); 1 registro em Histórico. Inative em vez disso.',
    );
  });
});

describe('W0-02: portão gêmeo (parte física) — todo domínio com excluir traz o mapa de dependências', () => {
  it('a lista de referências lógicas (mesmo vazia, com justificativa) e a categoria da matriz', () => {
    const comExcluir = DECLARACOES.filter((d) => d.publico.acoes.includes('excluir'));
    for (const d of comExcluir) {
      const id = `${d.publico.modulo}.${d.publico.recurso}`;
      expect(d.exclusao, `${id}: sem o mapa de dependências (exclusao)`).toBeDefined();
      expect(conferirMapa(mapaDoDominio(d)), id).toEqual([]);
      expect(d.publico.categoria, `${id}: sem a categoria da matriz`).toBeDefined();
    }
    // Quem declarar `excluir` sem o mapa reprova (a regra pega a declaração de teste sem `exclusao`).
    const semMapa: DeclaracaoDominio = { ...alergia, exclusao: undefined } as never;
    expect(conferirMapa(mapaDoDominio(semMapa))).toEqual([
      'lista de referências lógicas vazia sem a justificativa (semReferenciasLogicas)',
    ]);
  });
});

describe('W0-02: os passos do excluir, do reativar e do texto longo sobre o banco por roteiro', () => {
  const ctxR = { ...ctx(), hospital: 'pc' };
  const dExc = alergia;
  const nomeExc = 'hotelaria.excluirArea';
  const linhaArea = { ID: 7, NOME: 'AREA', ID_CHCRITICIDADE: 1, SIGLA: null, ATIVO: 'T' };
  const versaoDe = async (b: BancoRoteiro) => (await itemDoDominio(b.tx(), dExc, '7'))!.versao;

  function roteiro(): BancoRoteiro {
    return new BancoRoteiro()
      .quando(/FROM CHAREA WHERE ID = \?/, [linhaArea])
      .quando(/SELECT \* FROM CHAREA WHERE ID = \?/, [linhaArea])
      .quando(/RDB\$EXCEPTIONS/, [{ M: 'Exclusão não permitida! Dados de sistema.' }]);
  }

  it('o gatilho que recusa o DELETE: a mensagem do catálogo das exceções, sem retrato', async () => {
    const b = roteiro().quando(/^DELETE FROM CHAREA/, () => {
      throw Object.assign(new Error('exception 5\n-E_GERAL_SISTEMA\n-Dados de sistema'), {
        gdscode: 335544517,
      });
    });
    const o = ops(dExc)[nomeExc]!;
    const e = { codigo: '7', versao: await versaoDe(b), motivo: 'teste do gatilho' };
    await o.conferir!(b.tx(), e, ctxR, linhaArea);
    await expect(o.gravar(b.tx(), e, ctxR)).rejects.toMatchObject({
      problema: { codigo: 'recusa-do-gatilho', detail: 'Exclusão não permitida! Dados de sistema.' },
    });
    expect(b.de(/INSERT INTO SGH_HIST_EXCLUSAO/)).toHaveLength(0);
  });

  it('erro que não é exceção de gatilho segue como está; sem a linha, registro-inexistente', async () => {
    const b = roteiro().quando(/^DELETE FROM CHAREA/, () => {
      throw new Error('conexão perdida');
    });
    const o = ops(dExc)[nomeExc]!;
    const e = { codigo: '7', versao: await versaoDe(b), motivo: 'teste do erro' };
    await o.conferir!(b.tx(), e, ctxR, linhaArea);
    await expect(o.gravar(b.tx(), e, ctxR)).rejects.toThrow('conexão perdida');
    const vazio = new BancoRoteiro();
    await expect(o.conferir!(vazio.tx(), e, ctxR, null)).rejects.toMatchObject({
      problema: { codigo: 'registro-inexistente' },
    });
  });

  it('o vínculo lógico criado durante a exclusão (recontagem antes do COMMIT) recusa: vinculo-concorrente', async () => {
    const dLog: DeclaracaoDominio = {
      ...dExc,
      exclusao: { referenciasLogicas: [{ tabela: 'HTAREA', colunas: ['ID_CHAREA'], evidencia: 'teste' }] },
    };
    let contagens = 0;
    const b = roteiro()
      .quando(/SELECT COUNT\(\*\) N FROM "HTAREA"/, () => [{ N: contagens++ === 0 ? 0 : 1 }])
      .quando(/FROM CHAREA WHERE ID = \?/, () => (b.de(/^DELETE FROM CHAREA/).length > 0 ? [] : [linhaArea]));
    const o = ops(dLog)[nomeExc]!;
    const e = { codigo: '7', versao: await versaoDe(roteiro()), motivo: 'teste da recontagem' };
    await o.conferir!(b.tx(), e, ctxR, linhaArea);
    const r = await o.gravar(b.tx(), e, ctxR);
    await expect(o.provar(b.tx(), e, r, ctxR)).rejects.toMatchObject({
      problema: { codigo: 'vinculo-concorrente' },
    });
    // O retrato e o evento (gravados depois, no passo SGH_) levam a linha lida e o motivo.
    await o.registrarSgh!(b.tx(), e, r, ctxR);
    expect(b.de(/INSERT INTO SGH_HIST_EXCLUSAO/)).toHaveLength(1);
    expect(b.de(/INSERT INTO SGH_CRUD_EVENTO/)[0]?.parametros.slice(3, 7)).toEqual([
      'excluido',
      'CHAREA',
      '7',
      'teste da recontagem',
    ]);
  });

  it('categoria sem proteção não retrata; agenda-rascunho só grava o evento', async () => {
    const d: DeclaracaoDominio = { ...dExc, publico: { ...dExc.publico, categoria: 'agenda-rascunho' } };
    expect(ops(d)[nomeExc]!.receita.registrosSgh).toEqual(['SGH_CRUD_EVENTO']);
    const marcada: DeclaracaoDominio = { ...d, exclusao: { ...d.exclusao!, protegida: true } };
    expect(ops(marcada)[nomeExc]!.receita.registrosSgh).toEqual(['SGH_HIST_EXCLUSAO', 'SGH_CRUD_EVENTO']);
  });

  it('texto longo editável: UPDATE só do BLOB (CP1252 ou UTF-8 pelo catálogo), prova pelos bytes relidos', async () => {
    const base = declaracao('sadt.metodo')!;
    const d: DeclaracaoDominio = {
      ...base,
      publico: { ...base.publico, acoes: [...base.publico.acoes, 'editar'] },
      textosLongos: (base.textosLongos ?? []).map((t) => ({ ...t, editavel: true })),
    };
    const o = ops(d)['sadt.alterarMetodo']!;
    expect(o.receita.cenarios.map((c) => c.nome)).toContain('texto-longo');
    const texto = 'Ação ' + 'é'.repeat(70_000);
    for (const utf8 of [false, true]) {
      const esperado = utf8 ? Buffer.from(texto, 'utf8') : null;
      const b = new BancoRoteiro()
        .quando(/RDB\$RELATION_FIELDS/, [
          { C: 'DESCR', CS: utf8 ? 4 : 0 },
          { C: 'OUTRA', CS: 4 },
        ])
        .quando(/FROM SIMETODO WHERE COD = \?/, [{ COD: 1, NOME: 'M', ATIVO: 'T' }])
        .quando(/SELECT DESCR FROM SIMETODO/, () => [{ DESCR: b.de(/^UPDATE SIMETODO/)[0]?.parametros[0] }]);
      const e = { codigo: '1', versao: 'x', valores: { descr: texto } };
      await o.gravar(b.tx(), e as never, ctxR);
      const upd = b.de(/^UPDATE SIMETODO SET DESCR = \? WHERE COD = \?/)[0]!;
      const bytes = upd.parametros[0] as Buffer;
      expect(bytes.length).toBeGreaterThan(65_535);
      if (esperado) expect(bytes.equals(esperado)).toBe(true);
      await o.provar(b.tx(), e as never, { codigo: '1' }, ctxR);
    }
    // Vazio grava NULL e a prova confere NULL.
    const b = new BancoRoteiro()
      .quando(/FROM SIMETODO WHERE COD = \?/, [{ COD: 1, NOME: 'M', ATIVO: 'T' }])
      .quando(/SELECT DESCR FROM SIMETODO/, [{ DESCR: null }]);
    await o.gravar(b.tx(), { codigo: '1', versao: 'x', valores: { descr: '' } } as never, ctxR);
    expect(b.de(/^UPDATE SIMETODO/)[0]?.parametros[0]).toBeNull();
    await o.provar(
      b.tx(),
      { codigo: '1', versao: 'x', valores: { descr: '' } } as never,
      { codigo: '1' },
      ctxR,
    );
  });
});
