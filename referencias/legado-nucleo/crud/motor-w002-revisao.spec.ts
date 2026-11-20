// Revisão do W0-02 (achados confirmados do corretor), no banco em memória e no banco por roteiro:
//   - excluir no domínio que inativa só no novo apaga a marca da SGH_CFG_DOMINIO_SITUACAO na mesma transação: o mesmo
//     par incluído de novo nasce ativo (e a inclusão de chave digitada limpa marca que tenha sobrado);
//   - a alteração (com o texto longo anterior) e a inativação (com o motivo) gravam o evento na SGH_CRUD_EVENTO;
//   - as filhas próprias em CASCADE (`exclusao.proprias`) são retratadas antes do DELETE; a "própria" sem CASCADE conta
//     como vínculo (recusa legível);
//   - a exclusão recusa item de sistema e a sentinela "não informado", como a inativação;
//   - a recusa com dependentes só oferece inativar o item ativo.
// Dados sintéticos.
import type { DeclaracaoDominio } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { inativarSoNoNovo } from '../../config/gravacao/dominio-situacao.js';
import { lerInativosSoNoNovo } from '../../config/repositorios/dominio-situacao.js';
import { declaracao, DECLARACOES, rotuloDaTabelaDeDominio } from '../../cadastros.js';
import { BancoRoteiro } from '../banco-roteiro.spec-util.js';
import type { ContextoOperacao } from '../operacao.js';
import { ErroOperacao } from '../erros-operacao.js';
import {
  itemDeSistemaNaExclusao,
  operacoesDoDominio,
  type OperacaoDominio,
} from '../gravacao/receita-generica.js';
import { conferirMapa, verificarDependencias } from './dependencias.js';
import { BancoMemoriaDominios } from './memoria.js';
import { itemDoDominio, listarDominio, usoDoItem } from './repositorio.js';

let n = 0;
const ctx = (hospital = 'aa'): ContextoOperacao => ({
  rede: 'rede-teste',
  hospital,
  traceId: 'teste-w002-revisao',
  usuarioLegado: 'SINT.ADMIN',
  idempotencyKey: `w002r-${++n}-chave`,
  reautenticadoEm: Date.now(),
});
const catalogo = { estado: () => 'especificada' as const };
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

const trilha = {
  rede: 'rede-teste',
  hospital: 'aa',
  usuario: 'SINT.ADMIN',
  evento: 'pep.caracteristicaDaDieta.inativadoNoNovo',
  recurso: 'pep.caracteristicaDaDieta',
  operacao: 'pep.inativarNoNovo',
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'teste',
};

describe('revisão W0-02: excluir no domínio que inativa só no novo (o piloto característica × dieta)', () => {
  const d = declaracao('pep.caracteristicaDaDieta')!;

  it('declara a SGH_CFG_DOMINIO_SITUACAO no registro próprio do excluir e do incluir (chave digitada)', () => {
    const o = ops(d);
    expect(o['pep.excluirCaracteristicaDaDieta']!.receita.registrosSgh).toEqual([
      'SGH_HIST_EXCLUSAO',
      'SGH_CRUD_EVENTO',
      'SGH_CFG_DOMINIO_SITUACAO',
    ]);
    expect(o['pep.incluirCaracteristicaDaDieta']!.receita.registrosSgh).toEqual(['SGH_CFG_DOMINIO_SITUACAO']);
  });

  it('inativar só no novo, excluir e incluir o mesmo par: nasce ATIVO e a marca não fica órfã', async () => {
    const b = new BancoMemoriaDominios(DECLARACOES);
    const ex = b.criarExecutor(catalogo, 'ci');
    const o = ops(d);
    // Um par com dieta e característica ativas (a inclusão confere as duas referências).
    const dietas = (await b.ler('aa', (l) => listarDominio(l, declaracao('internacao.dieta')!))).itens.filter(
      (i) => i.ativo,
    );
    const caracts = (
      await b.ler('aa', (l) => listarDominio(l, declaracao('pep.caracteristicaDieta')!))
    ).itens.filter((i) => i.ativo);
    const dieta = dietas[0]!.codigo;
    const caracteristica = caracts[caracts.length - 1]!.codigo;
    const codigo = `${dieta}|${caracteristica}`;
    if (!(await b.ler('aa', (l) => itemDoDominio(l, d, codigo))))
      await ex.executar(
        o['pep.incluirCaracteristicaDaDieta']!,
        'aa',
        { dieta: Number(dieta), caracteristica: Number(caracteristica), ordem: '9' },
        ctx(),
      );
    const par = (await b.ler('aa', (l) => itemDoDominio(l, d, codigo)))!;
    // 1. Inativa só no novo.
    await b.escrever(
      'aa',
      (e) =>
        inativarSoNoNovo(e, d, { codigo: par.codigo, versao: par.versao, usuario: 'SINT.ADMIN' }, trilha),
      true,
    );
    const inativo = await b.ler('aa', (l) => itemDoDominio(l, d, par.codigo));
    expect(inativo?.ativo).toBe(false);
    // 2. Exclui com a versão que a tela vê (item inativo no novo): a versão confere com a marca.
    await ex.executar(
      o['pep.excluirCaracteristicaDaDieta']!,
      'aa',
      { codigo: par.codigo, versao: inativo!.versao, motivo: 'ligação cadastrada por engano' },
      ctx(),
    );
    expect(await b.ler('aa', (l) => itemDoDominio(l, d, par.codigo))).toBeNull();
    expect((await b.ler('aa', (l) => lerInativosSoNoNovo(l, d.tabela))).has(par.codigo)).toBe(false);
    // 3. Inclui o mesmo par: nasce ativo e altera sem a recusa "Item inativo não é alterado".
    await ex.executar(
      o['pep.incluirCaracteristicaDaDieta']!,
      'aa',
      { dieta: Number(dieta), caracteristica: Number(caracteristica), ordem: '1' },
      ctx(),
    );
    const novo = await b.ler('aa', (l) => itemDoDominio(l, d, par.codigo));
    expect(novo?.ativo).toBe(true);
    await ex.executar(
      o['pep.alterarCaracteristicaDaDieta']!,
      'aa',
      { codigo: par.codigo, versao: novo!.versao, valores: { ordem: '2' } },
      ctx(),
    );
    expect((await b.ler('aa', (l) => itemDoDominio(l, d, par.codigo)))?.valores['ordem']).toBe('2');
  });

  it('a marca gravada por outra pessoa depois da leitura sai junto (o DELETE da marca é incondicional)', async () => {
    const b = new BancoRoteiro()
      .quando(/FROM PRCARACT_TBDIETAS WHERE/, [
        { ID_TBDIETAS: 3, ID_PRCARACTDIE: 10, ORDEM: '1', SITUACAO: 'A' },
      ])
      .quando(/FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = \? AND CHAVE = \?/, [
        { D: '2026-11-18 09:00:00', A: 'OUTRA.PESSOA' },
      ]);
    const o = ops(d)['pep.excluirCaracteristicaDaDieta']!;
    const relido = { ID_TBDIETAS: 3, ID_PRCARACTDIE: 10, ORDEM: '1', SITUACAO: 'A' };
    // A versão vista ANTES da inativação (ativo) é conflito: a pessoa não viu o item inativo.
    const ativoNaTela = (await itemDoDominio(
      new BancoRoteiro().quando(/FROM PRCARACT_TBDIETAS/, [relido]).tx(),
      d,
      '3|10',
    ))!;
    expect(
      await codigoDe(
        o.conferir!(
          b.tx(),
          { codigo: '3|10', versao: ativoNaTela.versao, motivo: 'teste da marca' },
          ctx('pc'),
          relido,
        ),
      ),
    ).toBe('conflito-versao');
    const versaoInativa = JSON.stringify({ ...JSON.parse(ativoNaTela.versao), a: false });
    const e = { codigo: '3|10', versao: versaoInativa, motivo: 'teste da marca' };
    await o.conferir!(b.tx(), e, ctx('pc'), relido);
    const r = await o.gravar(b.tx(), e, ctx('pc'));
    await o.registrarSgh!(b.tx(), e, r, ctx('pc'));
    expect(b.de(/^DELETE FROM SGH_CFG_DOMINIO_SITUACAO/)[0]?.parametros).toEqual([
      'PRCARACT_TBDIETAS',
      '3|10',
    ]);
    const ev = b.de(/INSERT INTO SGH_CRUD_EVENTO/)[0]!;
    const anterior = JSON.parse(Buffer.from(ev.parametros[7] as Buffer).toString('ascii')) as Record<
      string,
      unknown
    >;
    expect(anterior).toMatchObject({ ativo: false, inativoSoNoNovo: { autor: 'OUTRA.PESSOA' } });
  });
});

describe('revisão W0-02: o evento da alteração (texto longo anterior) e da inativação (motivo)', () => {
  it('alterar o texto longo grava o evento "alterado" com o texto anterior, na mesma transação', async () => {
    const d = declaracao('pep.caracteristicaDieta')!;
    const o = ops(d)['pep.alterarCaracteristicaDieta']!;
    expect(o.receita.registrosSgh).toEqual(['SGH_CRUD_EVENTO']);
    const linha = { ID_CARACTDIE: 4, DESCRICAO: 'CONSISTENCIA', TPRESP: 1, TIPO: '', ATIVO: 'T' };
    const b = new BancoRoteiro()
      .quando(/FROM PRCARACTDIE WHERE ID_CARACTDIE = \?/, [linha])
      .quando(/SELECT POSSIVEIS_RESPOSTAS FROM PRCARACTDIE/, [
        { POSSIVEIS_RESPOSTAS: Buffer.from('Sim\nN\xe3o\nParcial', 'latin1') },
      ]);
    const versao = (await itemDoDominio(b.tx(), d, '4'))!.versao;
    const e = { codigo: '4', versao, valores: { possiveisRespostas: null } };
    await o.conferir!(b.tx(), e, ctx('pc'), linha);
    await o.registrarSgh!(b.tx(), e, { codigo: '4' }, ctx('pc'));
    const ev = b.de(/INSERT INTO SGH_CRUD_EVENTO/)[0]!;
    expect(ev.parametros.slice(3, 7)).toEqual(['alterado', 'PRCARACTDIE', '4', '']);
    const anterior = JSON.parse(Buffer.from(ev.parametros[7] as Buffer).toString('ascii')) as Record<
      string,
      unknown
    >;
    expect(anterior).toMatchObject({ codigo: 4, ativo: true, possiveisRespostas: 'Sim\nNão\nParcial' });
  });

  it('inativar grava o evento "inativado" com o motivo e o valor anterior (no banco em memória também)', async () => {
    const d = declaracao('internacao.tipoLimpeza')!;
    const o = ops(d);
    expect(o['internacao.inativarTipoLimpeza']!.receita.registrosSgh).toEqual(['SGH_CRUD_EVENTO']);
    const linha = { ID: 2, NOME: 'LIMPEZA', TEMPO_PREVISTO: null, ATIVO: 'T' };
    const b = new BancoRoteiro().quando(/FROM CHTPLIMPEZA WHERE/, [linha]);
    const atual = (await itemDoDominio(b.tx(), d, '2'))!;
    const e = { codigo: '2', versao: atual.versao, motivo: 'não é mais usado no setor' };
    await o['internacao.inativarTipoLimpeza']!.conferir!(b.tx(), e, ctx('pc'), linha);
    await o['internacao.inativarTipoLimpeza']!.registrarSgh!(b.tx(), e, { codigo: '2' }, ctx('pc'));
    expect(b.de(/INSERT INTO SGH_CRUD_EVENTO/)[0]?.parametros.slice(3, 7)).toEqual([
      'inativado',
      d.tabela,
      '2',
      'não é mais usado no setor',
    ]);
    // Pelo executor no banco em memória: o motivo curto é recusado como entrada inválida.
    const m = new BancoMemoriaDominios(DECLARACOES);
    const ex = m.criarExecutor(catalogo, 'ci');
    const i = (await m.ler('aa', (l) => itemDoDominio(l, d, '2')))!;
    expect(
      await codigoDe(
        ex.executar(
          o['internacao.inativarTipoLimpeza']!,
          'aa',
          { codigo: '2', versao: i.versao, motivo: 'x' },
          ctx(),
        ),
      ),
    ).toBe('entrada-invalida');
    await ex.executar(
      o['internacao.inativarTipoLimpeza']!,
      'aa',
      { codigo: '2', versao: i.versao, motivo: 'não é mais usado' },
      ctx(),
    );
    expect((await m.ler('aa', (l) => itemDoDominio(l, d, '2')))?.ativo).toBe(false);
  });
});

describe('revisão W0-02: as filhas próprias (exclusao.proprias)', () => {
  const base = declaracao('hotelaria.area')!;
  const comProprias = (regra: string): [DeclaracaoDominio, BancoRoteiro] => {
    const d: DeclaracaoDominio = {
      ...base,
      publico: { ...base.publico, acoes: [...base.publico.acoes, 'excluir'], categoria: 'cadastro-mestre' },
      exclusao: {
        referenciasLogicas: [],
        semReferenciasLogicas: 'teste',
        proprias: ['CHAREA_FILHA.ID_CHAREA'],
      },
    };
    const linha = { ID: 7, NOME: 'AREA', ID_CHCRITICIDADE: 1, SIGLA: null, ATIVO: 'T' };
    const b: BancoRoteiro = new BancoRoteiro()
      .quando(/FROM CHAREA WHERE ID = \?/, (): Record<string, unknown>[] =>
        b.de(/^DELETE FROM CHAREA/).length > 0 ? [] : [linha],
      )
      .quando(/RDB\$REF_CONSTRAINTS/, [
        { NOME: 'FK_FILHA', FILHA: 'CHAREA_FILHA', COLUNA: 'ID_CHAREA', MAE: 'ID', REGRA: regra, POS: 0 },
      ])
      .quando(/'PRIMARY KEY'/, [{ C: 'ID' }])
      .quando(/SELECT COUNT\(\*\) N FROM "CHAREA_FILHA"/, [{ N: 2 }])
      .quando(/SELECT FIRST 5 "ID" FROM "CHAREA_FILHA"/, [{ ID: 70 }, { ID: 71 }])
      .quando(/SELECT \* FROM CHAREA_FILHA WHERE ID_CHAREA = \?/, [
        { ID: 70, ID_CHAREA: 7, OBS: 'a' },
        { ID: 71, ID_CHAREA: 7, OBS: 'b' },
      ]);
    return [d, b];
  };

  it('FK própria em CASCADE: não conta como vínculo e as filhas vão ao retrato antes do DELETE', async () => {
    const [d, b] = comProprias('CASCADE');
    const o = ops(d)['hotelaria.excluirArea']!;
    expect(o.receita.registrosSgh).toEqual(['SGH_HIST_EXCLUSAO', 'SGH_CRUD_EVENTO']);
    const linha = { ID: 7, NOME: 'AREA', ID_CHCRITICIDADE: 1, SIGLA: null, ATIVO: 'T' };
    const versao = (await itemDoDominio(b.tx(), d, '7'))!.versao;
    const e = { codigo: '7', versao, motivo: 'teste das filhas' };
    await o.conferir!(b.tx(), e, ctx('pc'), linha);
    const r = await o.gravar(b.tx(), e, ctx('pc'));
    // O retrato das filhas é lido ANTES do DELETE.
    const ordem = b.chamadas.map((c) => c.sql.replace(/\s+/g, ' '));
    const iFilhas = ordem.findIndex((s) => /SELECT \* FROM CHAREA_FILHA/.test(s));
    const iDelete = ordem.findIndex((s) => /^DELETE FROM CHAREA /.test(s));
    expect(iFilhas).toBeGreaterThanOrEqual(0);
    expect(iFilhas).toBeLessThan(iDelete);
    await o.registrarSgh!(b.tx(), e, r, ctx('pc'));
    const retratos = b.de(/INSERT INTO SGH_HIST_EXCLUSAO/);
    expect(retratos.map((x) => [x.parametros[2], x.parametros[3]])).toEqual([
      ['CHAREA', '7'],
      ['CHAREA_FILHA', '70'],
      ['CHAREA_FILHA', '71'],
    ]);
  });

  it('FK "própria" sem CASCADE conta como vínculo: recusa legível com a lista, nada apagado', async () => {
    const [d, b] = comProprias('RESTRICT');
    const o = ops(d)['hotelaria.excluirArea']!;
    const linha = { ID: 7, NOME: 'AREA', ID_CHCRITICIDADE: 1, SIGLA: null, ATIVO: 'T' };
    const versao = (await itemDoDominio(b.tx(), d, '7'))!.versao;
    await expect(
      o.conferir!(b.tx(), { codigo: '7', versao, motivo: 'teste restrict' }, ctx('pc'), linha),
    ).rejects.toMatchObject({ problema: { codigo: 'com-dependentes' } });
    expect(b.de(/^DELETE/)).toHaveLength(0);
    const v = await verificarDependencias(b.tx(), {
      mapa: { tabela: 'CHAREA', chave: ['ID'], referenciasLogicas: [], proprias: ['CHAREA_FILHA.ID_CHAREA'] },
      linha,
      chave: [7],
    });
    expect(v.map((x) => [x.tabela, x.regra, x.quantidade])).toEqual([['CHAREA_FILHA', 'RESTRICT', 2]]);
  });

  it('o formato da própria é conferido (TABELA.COLUNA[+COLUNA])', () => {
    expect(
      conferirMapa({
        tabela: 'CHAREA',
        chave: ['ID'],
        referenciasLogicas: [],
        semReferenciasLogicas: 'teste',
        proprias: ['SEM_COLUNA', 'OK.A+B'],
      }),
    ).toEqual(['própria inválida (SEM_COLUNA): use TABELA.COLUNA[+COLUNA]']);
  });
});

describe('revisão W0-02: item de sistema e sentinela na exclusão; a oferta de inativar só para o ativo', () => {
  const base = declaracao('internacao.tipoLimpeza')!;
  const d: DeclaracaoDominio = {
    ...base,
    publico: { ...base.publico, acoes: [...base.publico.acoes, 'excluir'], categoria: 'dominio' },
    situacao: { ...base.situacao!, protegidas: { codigos: [1], evidencia: 'teste' } },
    exclusao: { referenciasLogicas: [], semReferenciasLogicas: 'teste' },
  };

  it('o código protegido e a descrição "não informado" são recusados como item de sistema', async () => {
    expect(itemDeSistemaNaExclusao(d, '1', null)).toMatch(/Item de sistema/);
    const sentinela = { ID: 9, NOME: 'NÃO INFORMADO', TEMPO_PREVISTO: null, ATIVO: 'T' };
    expect(itemDeSistemaNaExclusao(d, '9', sentinela)).toMatch(/não informado/);
    expect(itemDeSistemaNaExclusao(d, '9', { ...sentinela, NOME: 'LIMPEZA' })).toBeNull();
    const o = ops(d)['internacao.excluirTipoLimpeza']!;
    const b = new BancoRoteiro().quando(/FROM CHTPLIMPEZA WHERE/, [sentinela]);
    await expect(
      o.conferir!(b.tx(), { codigo: '9', versao: 'x', motivo: 'teste sentinela' }, ctx('pc'), sentinela),
    ).rejects.toMatchObject({ problema: { codigo: 'item-de-sistema', status: 409 } });
    expect(b.de(/^DELETE/)).toHaveLength(0);
  });

  it('com dependentes: o item inativo não recebe a oferta de inativar (podeInativar falso)', async () => {
    const inativo = { ID: 5, NOME: 'LIMPEZA', TEMPO_PREVISTO: null, ATIVO: 'F' };
    const b = new BancoRoteiro()
      .quando(/FROM CHTPLIMPEZA WHERE/, [inativo])
      .quando(/RDB\$REF_CONSTRAINTS/, [
        { NOME: 'FK_X', FILHA: 'TBUSO', COLUNA: 'ID_TP', MAE: 'ID', REGRA: 'RESTRICT', POS: 0 },
      ])
      .quando(/SELECT COUNT\(\*\) N FROM "TBUSO"/, [{ N: 1 }]);
    const versao = (await itemDoDominio(b.tx(), d, '5'))!.versao;
    const o = ops(d)['internacao.excluirTipoLimpeza']!;
    await expect(
      o.conferir!(b.tx(), { codigo: '5', versao, motivo: 'teste inativo' }, ctx('pc'), inativo),
    ).rejects.toMatchObject({ problema: { codigo: 'com-dependentes', podeInativar: false } });
    const ativo = { ...inativo, ATIVO: 'T' };
    const b2 = new BancoRoteiro()
      .quando(/FROM CHTPLIMPEZA WHERE/, [ativo])
      .quando(/RDB\$REF_CONSTRAINTS/, [
        { NOME: 'FK_X', FILHA: 'TBUSO', COLUNA: 'ID_TP', MAE: 'ID', REGRA: 'RESTRICT', POS: 0 },
      ])
      .quando(/SELECT COUNT\(\*\) N FROM "TBUSO"/, [{ N: 1 }]);
    const v2 = (await itemDoDominio(b2.tx(), d, '5'))!.versao;
    await expect(
      o.conferir!(b2.tx(), { codigo: '5', versao: v2, motivo: 'teste ativo' }, ctx('pc'), ativo),
    ).rejects.toMatchObject({ problema: { codigo: 'com-dependentes', podeInativar: true } });
  });
});

describe('revisão W0-02: o texto longo também na inclusão', () => {
  it('o INSERT leva o BLOB (CP1252) e a prova relê os bytes; ausente, NULL', async () => {
    const d = declaracao('pep.caracteristicaDieta')!;
    const o = ops(d)['pep.incluirCaracteristicaDieta']!;
    expect(Object.keys(o.receita.passos[0]!.colunas)).toContain('POSSIVEIS_RESPOSTAS');
    const texto = 'Sim\nNão\nÀs vezes';
    const b = new BancoRoteiro()
      .quando(/FROM PRCARACTDIE ORDER BY/, [])
      .quando(/INSERT INTO PRCARACTDIE/, { ID_CARACTDIE: 31 })
      .quando(/FROM PRCARACTDIE WHERE ID_CARACTDIE = \?/, [
        { ID_CARACTDIE: 31, DESCRICAO: 'TEXTURA', TPRESP: 1, TIPO: '', ATIVO: 'T' },
      ])
      .quando(/SELECT POSSIVEIS_RESPOSTAS FROM PRCARACTDIE/, () => {
        const ins = b.de(/INSERT INTO PRCARACTDIE/)[0]!;
        const i = ins.sql
          .split('(')[1]!
          .split(')')[0]!
          .split(',')
          .map((x) => x.trim())
          .indexOf('POSSIVEIS_RESPOSTAS');
        return [{ POSSIVEIS_RESPOSTAS: ins.parametros[i] }];
      });
    const e = { descricao: 'TEXTURA', tipoResposta: 1, possiveisRespostas: texto };
    const r = await o.gravar(b.tx(), e as never, ctx('pc'));
    const ins = b.de(/INSERT INTO PRCARACTDIE/)[0]!;
    expect(ins.parametros.some((p) => Buffer.isBuffer(p) && p.equals(Buffer.from(texto, 'latin1')))).toBe(
      true,
    );
    await o.provar(b.tx(), e as never, r, ctx('pc'));
  });
});
