// Contrato de efeito da manutenção do catálogo de exames (F3.5, 05-SADT linhas 1 a 3) contra o MariaDB real (cliente de
// teste, massa SINTÉTICA). Prova o que fica no banco: o exame incluído e alterado (trava pela versão), o exame de imagem
// só com modalidade, o setor e o material com um padrão só, o preparo, a lateralidade, o exame ligado sem ciclo, o
// analito no exame, a faixa de referência com nova versão (a anterior encerrada na véspera, nunca apagada, e as linhas
// de versão), a fórmula conferida (a inválida não grava nada), a inativação sem apagar e a trilha de cada gravação.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { type ContextoCatalogo, PortaCatalogoSadtPropria } from './catalogo-porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const somaDias = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const exameBase = {
  nomePopular: null,
  tipoResultado: 'numerico' as const,
  especialidadeDiagnosticaId: null,
  modalidadeImagemId: null,
  sexoId: null,
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  prazoEntregaHoras: 24,
  limiteSolicitacoes: null,
  periodoLimiteDias: null,
  custoUnitario: null,
  orientacaoGeral: null,
  exigeLaudo: false,
  ativo: true,
};

describe.skipIf(SEM_BANCO)(`catálogo de exames (MariaDB, cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let porta: PortaCatalogoSadtPropria;
  let m: MassaSadt | null = null;
  const exames: number[] = [];
  let n = 0;
  const c = (): ContextoCatalogo => ({
    cliente: CLIENTE,
    estabelecimento: m?.base.est ?? null,
    usuario: null,
    correlacao: 't-catalogo',
    chaveIdempotencia: `t-cat-${m?.marca}-${++n}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-catalogo' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-catalogo' }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'CTG');
    porta = new PortaCatalogoSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    if (exames.length)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-catalogo' }, async (e) => {
        const ids = exames.map(() => '?').join(',');
        const ea = `SELECT id FROM exame_analito WHERE exame_id IN (${ids})`;
        await e.executar(
          `DELETE FROM variavel_formula WHERE formula_calculo_id IN (SELECT id FROM formula_calculo WHERE exame_analito_id IN (${ea}))`,
          exames,
        );
        await e.executar(`DELETE FROM formula_calculo WHERE exame_analito_id IN (${ea})`, exames);
        await e.executar(
          `DELETE FROM faixa_referencia_versao WHERE faixa_referencia_id IN (SELECT id FROM faixa_referencia WHERE exame_analito_id IN (${ea}))`,
          exames,
        );
        await e.executar(`DELETE FROM faixa_referencia WHERE exame_analito_id IN (${ea})`, exames);
        for (const t of [
          'exame_analito',
          'exame_setor_executante',
          'exame_material',
          'exame_orientacao_preparo',
          'exame_lateralidade',
        ])
          await e.executar(`DELETE FROM ${t} WHERE exame_id IN (${ids})`, exames);
        await e.executar(
          `DELETE FROM exame_secundario WHERE exame_id IN (${ids}) OR secundario_exame_id IN (${ids})`,
          [...exames, ...exames],
        );
        await e.executar(`DELETE FROM orientacao_preparo WHERE codigo = ?`, [`P${m?.marca}`]);
        await e.executar(`DELETE FROM exame WHERE id IN (${ids})`, exames);
      });
    await limparMassaSadt(nucleo, m);
  }, 60_000);

  it('inclui e altera o exame (trava pela versão), imagem só com modalidade, e grava a trilha', async () => {
    const mm = m as MassaSadt;
    const lab = await porta.salvarExame(c(), null, {
      ...exameBase,
      codigo: `CL${mm.marca}`,
      sigla: `L${mm.marca}`.slice(0, 10),
      nome: 'Colesterol de teste',
      tipoServico: 'laboratorio',
    });
    exames.push(lab.id);
    expect(lab.versao).toBe(1);
    await expect(
      porta.salvarExame(c(), null, {
        ...exameBase,
        codigo: `CI${mm.marca}`,
        sigla: `I${mm.marca}`.slice(0, 10),
        nome: 'Imagem sem modalidade',
        tipoServico: 'imagem',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    const img = await porta.salvarExame(c(), null, {
      ...exameBase,
      codigo: `CI${mm.marca}`,
      sigla: `I${mm.marca}`.slice(0, 10),
      nome: 'Imagem de teste',
      tipoServico: 'imagem',
      modalidadeImagemId: mm.modalidade,
    });
    exames.push(img.id);
    const alt = await porta.salvarExame(c(), lab.id, {
      ...exameBase,
      versao: 1,
      codigo: `CL${mm.marca}`,
      sigla: `L${mm.marca}`.slice(0, 10),
      nome: 'Colesterol total de teste',
      tipoServico: 'laboratorio',
    });
    expect(alt.versao).toBe(2);
    await expect(
      porta.salvarExame(c(), lab.id, {
        ...exameBase,
        versao: 1,
        codigo: `CL${mm.marca}`,
        sigla: `L${mm.marca}`.slice(0, 10),
        nome: 'Versão velha',
        tipoServico: 'laboratorio',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'conflito-versao');
    const l = await um('SELECT nome, versao, ativo FROM exame WHERE id = ?', [lab.id]);
    expect(l).toMatchObject({ nome: 'Colesterol total de teste', versao: 2 });
    const t = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'exame' AND entidade_id = ?",
      [lab.id],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(2);
  });

  it('setor e material com um padrão só; preparo, lateralidade; inativar não apaga', async () => {
    const mm = m as MassaSadt;
    const [lab, img] = exames as [number, number];
    const s1 = await porta.salvarVinculo(c(), 'setor', lab, {
      setorDiagnosticoId: mm.setorLab,
      padrao: true,
    });
    await porta.salvarVinculo(c(), 'setor', lab, { setorDiagnosticoId: mm.setorImagem, padrao: true });
    const padroes = await todos(
      'SELECT setor_diagnostico_id FROM exame_setor_executante WHERE exame_id = ? AND padrao = TRUE',
      [lab],
    );
    expect(padroes.map((p) => Number(p['setor_diagnostico_id']))).toEqual([mm.setorImagem]);
    const mat = await um("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []);
    await porta.salvarVinculo(c(), 'material', lab, {
      materialBiologicoId: Number(mat?.['id']),
      padrao: true,
      conservacao: 'refrigerado',
      volumeMinimoMl: 2,
    });
    const prep = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-catalogo' }, (e) =>
      e.inserir(
        'INSERT INTO orientacao_preparo (codigo, descricao, texto, criado_em, versao) VALUES (?, ?, ?, NOW(3), 1)',
        [`P${mm.marca}`, 'Jejum de teste', 'Jejum de 12 horas (teste).'],
      ),
    );
    await porta.salvarVinculo(c(), 'preparo', lab, { orientacaoPreparoId: prep, publico: 'adulto' });
    await porta.salvarVinculo(c(), 'lateralidade', img, { lado: 'bilateral', multiplicadorCobranca: 1.5 });
    const v = await um('SELECT versao FROM exame_setor_executante WHERE id = ?', [s1.id]);
    await porta.salvarVinculo(c(), 'setor', lab, {
      id: s1.id,
      versao: Number(v?.['versao']),
      setorDiagnosticoId: mm.setorLab,
      ativo: false,
    });
    const ficha = await porta.ficha(c(), lab);
    expect(ficha.setores).toHaveLength(2);
    expect(ficha.setores.find((s) => Number(s['id']) === s1.id)?.['ativo']).toBeFalsy();
    expect(ficha.materiais[0]).toMatchObject({ conservacao: 'refrigerado', padrao: 1 });
    expect(ficha.preparos[0]).toMatchObject({ publico: 'adulto' });
    expect((await porta.ficha(c(), img)).lateralidades[0]).toMatchObject({ lado: 'bilateral' });
  });

  it('exame ligado: liga e recusa o ciclo', async () => {
    const [lab, img] = exames as [number, number];
    await porta.salvarVinculo(c(), 'ligado', lab, { secundarioExameId: img, tipoRelacao: 'correlacionado' });
    await expect(porta.salvarVinculo(c(), 'ligado', img, { secundarioExameId: lab })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'regra-catalogo',
    );
    const n2 = await um('SELECT COUNT(*) AS n FROM exame_secundario WHERE secundario_exame_id = ?', [lab]);
    expect(Number(n2?.['n'])).toBe(0);
  });

  it('faixa com versão: a nova encerra a anterior na véspera, nada é apagado; fórmula conferida', async () => {
    const mm = m as MassaSadt;
    const [lab] = exames as [number];
    const ea = await porta.salvarVinculo(c(), 'analito', lab, {
      analitoId: mm.analito,
      ordem: 1,
      calculado: true,
    });
    const h = await um('SELECT CURRENT_DATE AS hoje', []);
    const hoje = new Date(h?.['hoje'] as Date).toISOString().slice(0, 10);
    const faixa = { referenciaMinima: 0, referenciaMaxima: 190, criticoMaximo: 400, vigenciaInicio: hoje };
    const f1 = await porta.novaFaixa(c(), ea.id, faixa);
    await expect(porta.novaFaixa(c(), ea.id, { ...faixa, criticoMaximo: 100 })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'regra-catalogo',
    );
    const inicio2 = somaDias(hoje, 10);
    const f2 = await porta.novaFaixa(c(), ea.id, {
      ...faixa,
      referenciaMaxima: 200,
      vigenciaInicio: inicio2,
    });
    expect(f2.encerradas).toEqual([f1.id]);
    const linhas = await todos(
      'SELECT id, vigencia_fim, referencia_maxima FROM faixa_referencia WHERE exame_analito_id = ? ORDER BY id',
      [ea.id],
    );
    expect(linhas).toHaveLength(2);
    expect(new Date(linhas[0]?.['vigencia_fim'] as Date).toISOString().slice(0, 10)).toBe(
      somaDias(inicio2, -1),
    );
    expect(linhas[1]?.['vigencia_fim']).toBeNull();
    const versoes = await todos(
      `SELECT faixa_referencia_id, operacao, vigente_ate FROM faixa_referencia_versao
        WHERE faixa_referencia_id IN (?, ?) ORDER BY id`,
      [f1.id, f2.id],
    );
    expect(versoes.map((x) => x['operacao'])).toEqual(['inclusao', 'alteracao', 'inclusao']);
    expect(versoes[0]?.['vigente_ate']).not.toBeNull();

    await expect(
      porta.novaFormula(c(), ea.id, {
        descricao: 'Fórmula inválida',
        expressao: 'CT - HDL - X',
        vigenciaInicio: hoje,
        variaveis: [{ identificador: 'CT', descricao: 'Colesterol', fonte: 'digitado' }],
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    const fo = await porta.novaFormula(c(), ea.id, {
      descricao: 'Colesterol não HDL',
      expressao: 'CT - HDL',
      casasDecimais: 0,
      vigenciaInicio: hoje,
      variaveis: [
        { identificador: 'CT', descricao: 'Colesterol total', fonte: 'analito', analitoId: mm.analito },
        { identificador: 'HDL', descricao: 'HDL', fonte: 'digitado' },
      ],
    });
    const vars = await todos(
      'SELECT identificador, fonte FROM variavel_formula WHERE formula_calculo_id = ? ORDER BY sequencia',
      [fo.id],
    );
    expect(vars.map((x) => `${x['identificador']}:${x['fonte']}`)).toEqual(['CT:analito', 'HDL:digitado']);
    const nf = await um('SELECT COUNT(*) AS n FROM formula_calculo WHERE exame_analito_id = ?', [ea.id]);
    expect(Number(nf?.['n'])).toBe(1);
    const ficha = await porta.ficha(c(), lab);
    expect(ficha.analitos[0]?.faixas).toHaveLength(2);
    expect(ficha.analitos[0]?.formulas[0]?.variaveis).toHaveLength(2);
  });
});
