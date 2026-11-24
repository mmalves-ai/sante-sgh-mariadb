// Contrato de efeito da manutenção do catálogo de exames (F3.5, 05-SADT linhas 1 a 3) contra o MariaDB real (cliente de
// teste, massa SINTÉTICA). Prova o que fica no banco: o exame incluído e alterado (trava pela versão), o exame de imagem
// só com modalidade, o setor e o material com um padrão só, o preparo, a lateralidade, o exame ligado sem ciclo, o
// analito no exame, a faixa de referência com nova versão (a anterior encerrada na véspera, nunca apagada, e as linhas
// de versão; a cobertura parcial de idade recusada e a completa aceita na mesma operação; nada retroativo), a fórmula
// conferida (a inválida, a autorreferente, a de analito fora do exame e a retroativa não gravam nada; a v2 encerra a v1
// na véspera), a recusa de código ou sigla duplicados, o desativado_em, a alteração que preserva os campos não
// enviados (exame e vínculo), a ficha com booleanos e decimais como tipos de JS e a trilha de cada gravação.
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
  const trilhas = async (entidade: string, id: number) =>
    Number(
      (
        await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
          entidade,
          id,
        ])
      )?.['n'],
    );
  const versaoDe = async (tabela: string, id: number) =>
    Number((await um(`SELECT versao FROM ${tabela} WHERE id = ?`, [id]))?.['versao']);
  let analito2 = 0;
  let analitoFora = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'CTG');
    porta = new PortaCatalogoSadtPropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-catalogo' }, async (e) => {
      const sql = `INSERT INTO analito (codigo, nome, tipo_resultado, ativo, criado_em, versao)
                   VALUES (?, ?, 'numerico', TRUE, NOW(3), 1)`;
      analito2 = await e.inserir(sql, [`${m?.marca}B`, 'HDL de teste']);
      analitoFora = await e.inserir(sql, [`${m?.marca}F`, 'Analito fora do exame']);
    });
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
    if (analito2)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-catalogo' }, (e) =>
        e.executar('DELETE FROM analito WHERE id IN (?, ?)', [analito2, analitoFora]),
      );
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

    // Código ou sigla duplicados: 422 e nada gravado.
    const antes = await um('SELECT COUNT(*) AS n FROM exame WHERE codigo = ? OR sigla = ?', [
      `CL${mm.marca}`,
      `L${mm.marca}`.slice(0, 10),
    ]);
    await expect(
      porta.salvarExame(c(), null, {
        ...exameBase,
        codigo: `CL${mm.marca}`,
        sigla: `X${mm.marca}`.slice(0, 10),
        nome: 'Duplicado',
        tipoServico: 'laboratorio',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    const depois = await um('SELECT COUNT(*) AS n FROM exame WHERE codigo = ? OR sigla = ?', [
      `CL${mm.marca}`,
      `L${mm.marca}`.slice(0, 10),
    ]);
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));

    // A alteração grava só o que veio: custo, limite de pedidos, laudo e nome popular continuam.
    await porta.salvarExame(c(), lab.id, {
      versao: 2,
      nomePopular: 'Colesterol',
      tipoResultado: 'laudo',
      limiteSolicitacoes: 2,
      periodoLimiteDias: 30,
      custoUnitario: 12.5,
    });
    await porta.salvarExame(c(), lab.id, { versao: 3, nome: 'Colesterol total (nome corrigido)' });
    const preservado = await um(
      `SELECT nome, nome_popular, tipo_resultado, limite_solicitacoes, periodo_limite_dias, custo_unitario,
              prazo_entrega_horas FROM exame WHERE id = ?`,
      [lab.id],
    );
    expect(preservado).toMatchObject({
      nome: 'Colesterol total (nome corrigido)',
      nome_popular: 'Colesterol',
      tipo_resultado: 'laudo',
      limite_solicitacoes: 2,
      periodo_limite_dias: 30,
      prazo_entrega_horas: 24,
    });
    expect(Number(preservado?.['custo_unitario'])).toBe(12.5);
    // A regra vale sobre o exame como fica: tirar só o período do limite é recusado.
    await expect(porta.salvarExame(c(), lab.id, { versao: 4, periodoLimiteDias: null })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'regra-catalogo',
    );

    // Desativar preenche desativado_em; reativar limpa.
    await porta.salvarExame(c(), img.id, { versao: 1, ativo: false });
    const des = await um('SELECT ativo, desativado_em FROM exame WHERE id = ?', [img.id]);
    expect(Number(des?.['ativo'])).toBe(0);
    expect(des?.['desativado_em']).not.toBeNull();
    await porta.salvarExame(c(), img.id, { versao: 2, ativo: true });
    expect(
      (await um('SELECT desativado_em FROM exame WHERE id = ?', [img.id]))?.['desativado_em'],
    ).toBeNull();
    const fichaLab = await porta.ficha(c(), lab.id);
    expect(fichaLab.exame).toMatchObject({ ativo: true, exigeLaudo: false, custoUnitario: 12.5 });
  });

  it('setor e material com um padrão só; preparo, lateralidade; inativar não apaga', async () => {
    const mm = m as MassaSadt;
    const [lab, img] = exames as [number, number];
    const s1 = await porta.salvarVinculo(c(), 'setor', lab, {
      setorDiagnosticoId: mm.setorLab,
      padrao: true,
      prazoEntregaHoras: 6,
      atendeFeriado: true,
      horarioEspecial: 'Domingo até 12h',
    });
    expect(await trilhas('exame_setor_executante', s1.id)).toBeGreaterThanOrEqual(1);
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
    // A inativação manda só id, versão e ativo: prazo, feriado e horário especial continuam.
    await porta.salvarVinculo(c(), 'setor', lab, {
      id: s1.id,
      versao: await versaoDe('exame_setor_executante', s1.id),
      ativo: false,
    });
    expect(await trilhas('exame_setor_executante', s1.id)).toBeGreaterThanOrEqual(2);
    const s1b = await um(
      `SELECT ativo, prazo_entrega_horas, atende_feriado, horario_especial, setor_diagnostico_id
         FROM exame_setor_executante WHERE id = ?`,
      [s1.id],
    );
    expect(s1b).toMatchObject({
      prazo_entrega_horas: 6,
      horario_especial: 'Domingo até 12h',
      setor_diagnostico_id: mm.setorLab,
    });
    expect(Number(s1b?.['ativo'])).toBe(0);
    expect(Number(s1b?.['atende_feriado'])).toBe(1);
    const ficha = await porta.ficha(c(), lab);
    expect(ficha.setores).toHaveLength(2);
    expect(ficha.setores.find((s) => Number(s['id']) === s1.id)?.['ativo']).toBe(false);
    // A ficha devolve booleanos e decimais como tipos de JS: a linha volta à API sem conversão (botão Inativar).
    expect(ficha.materiais[0]).toMatchObject({ conservacao: 'refrigerado', padrao: true, volumeMinimoMl: 2 });
    const mat0 = ficha.materiais[0] as Record<string, unknown>;
    await porta.salvarVinculo(c(), 'material', lab, { ...mat0, ativo: false });
    const matb = await um('SELECT ativo, inativado_em, volume_minimo_ml FROM exame_material WHERE id = ?', [
      Number(mat0['id']),
    ]);
    expect(Number(matb?.['ativo'])).toBe(0);
    expect(matb?.['inativado_em']).not.toBeNull();
    expect(Number(matb?.['volume_minimo_ml'])).toBe(2);
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
    const ea2 = await porta.salvarVinculo(c(), 'analito', lab, { analitoId: analito2, ordem: 2 });
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
    expect(await trilhas('faixa_referencia', f1.id)).toBeGreaterThanOrEqual(1);
    expect(await trilhas('faixa_referencia', f2.id)).toBeGreaterThanOrEqual(1);

    // Nada retroativo: a faixa que começaria ontem é recusada e nada se grava.
    const nAntes = (await todos('SELECT id FROM faixa_referencia WHERE exame_analito_id = ?', [ea.id]))
      .length;
    await expect(
      porta.novaFaixa(c(), ea.id, { ...faixa, vigenciaInicio: somaDias(hoje, -1) }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    // Cobertura parcial de idade (a em vigor vale para todas as idades; a nova só até 60 anos): recusada.
    const inicio3 = somaDias(hoje, 20);
    await expect(
      porta.novaFaixa(c(), ea.id, { ...faixa, idadeMaximaDias: 21900, vigenciaInicio: inicio3 }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    expect((await todos('SELECT id FROM faixa_referencia WHERE exame_analito_id = ?', [ea.id])).length).toBe(
      nAntes,
    );
    // A cobertura completa na mesma operação encerra a anterior na véspera.
    const f3 = await porta.novaFaixa(c(), ea.id, {
      faixas: [
        { ...faixa, idadeMaximaDias: 21900, vigenciaInicio: inicio3 },
        { ...faixa, idadeMinimaDias: 21901, referenciaMaxima: 210, vigenciaInicio: inicio3 },
      ],
    });
    expect(f3.ids).toHaveLength(2);
    expect(f3.encerradas).toEqual([f2.id]);
    const f2b = await um('SELECT vigencia_fim FROM faixa_referencia WHERE id = ?', [f2.id]);
    expect(new Date(f2b?.['vigencia_fim'] as Date).toISOString().slice(0, 10)).toBe(somaDias(inicio3, -1));

    await expect(
      porta.novaFormula(c(), ea.id, {
        descricao: 'Fórmula inválida',
        expressao: 'CT - HDL - X',
        vigenciaInicio: hoje,
        variaveis: [{ identificador: 'CT', descricao: 'Colesterol', fonte: 'digitado' }],
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    const formula = {
      descricao: 'Colesterol não HDL',
      expressao: 'CT - HDL',
      casasDecimais: 0,
      vigenciaInicio: hoje,
      variaveis: [
        { identificador: 'CT', descricao: 'Colesterol total', fonte: 'digitado' as const },
        { identificador: 'HDL', descricao: 'HDL', fonte: 'analito' as const, analitoId: analito2 },
      ],
    };
    // Recusadas sem gravar: a autorreferente, a de analito fora do exame, a retroativa e a de analito não calculado.
    const recusada = (corpo: unknown, eaId = ea.id) =>
      expect(porta.novaFormula(c(), eaId, corpo)).rejects.toSatisfy((e) => codigoDe(e) === 'regra-catalogo');
    await recusada({
      ...formula,
      variaveis: [formula.variaveis[0], { ...formula.variaveis[1], analitoId: mm.analito }],
    });
    await recusada({
      ...formula,
      variaveis: [formula.variaveis[0], { ...formula.variaveis[1], analitoId: analitoFora }],
    });
    await recusada({ ...formula, vigenciaInicio: somaDias(hoje, -1) });
    await recusada({ ...formula, expressao: 'CT', variaveis: [formula.variaveis[0]] }, ea2.id);
    const nf0 = await um('SELECT COUNT(*) AS n FROM formula_calculo WHERE exame_analito_id IN (?, ?)', [
      ea.id,
      ea2.id,
    ]);
    expect(Number(nf0?.['n'])).toBe(0);
    const fo = await porta.novaFormula(c(), ea.id, formula);
    const vars = await todos(
      'SELECT identificador, fonte, analito_id FROM variavel_formula WHERE formula_calculo_id = ? ORDER BY sequencia',
      [fo.id],
    );
    expect(vars.map((x) => `${x['identificador']}:${x['fonte']}`)).toEqual(['CT:digitado', 'HDL:analito']);
    expect(Number(vars[1]?.['analito_id'])).toBe(analito2);
    expect(await trilhas('formula_calculo', fo.id)).toBeGreaterThanOrEqual(1);
    // A v2 encerra a v1 na véspera; a v1 continua no banco.
    const inicioF2 = somaDias(hoje, 5);
    const fo2 = await porta.novaFormula(c(), ea.id, {
      ...formula,
      casasDecimais: 1,
      vigenciaInicio: inicioF2,
    });
    expect(fo2.encerradas).toEqual([fo.id]);
    const v1 = await um('SELECT vigencia_fim, expressao FROM formula_calculo WHERE id = ?', [fo.id]);
    expect(new Date(v1?.['vigencia_fim'] as Date).toISOString().slice(0, 10)).toBe(somaDias(inicioF2, -1));
    expect(v1?.['expressao']).toBe('CT - HDL');
    const nf = await um('SELECT COUNT(*) AS n FROM formula_calculo WHERE exame_analito_id = ?', [ea.id]);
    expect(Number(nf?.['n'])).toBe(2);
    const ficha = await porta.ficha(c(), lab);
    const a0 = ficha.analitos.find((a) => Number(a['id']) === ea.id);
    expect(a0?.faixas).toHaveLength(4);
    expect(a0?.formulas[0]?.variaveis).toHaveLength(2);
    expect(a0).toMatchObject({ calculado: true, obrigatorio: true });
    // As listas dos seletores da tela.
    const op = await porta.opcoes(c());
    expect(op['analitos']?.some((a) => a.id === analito2)).toBe(true);
  });
});
