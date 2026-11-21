// Integração da porta PRÓPRIA dos custos contra o MariaDB real (cliente f22_o2 da onda 2). Contrato de efeito:
// classificar o centro (classe, ordem, critério e unidade no próprio centro; a observação só na trilha, a do cadastro
// fica; versão, trilha e idempotência da operação), gravar o mesmo não grava, a versão velha é recusada; lançar a
// estatística (o manual substitui só o manual anterior; a coletada fica; a apurada é recusada; a observação vai à
// trilha; a mesma sequência dá o mesmo na porta de memória), a referência vale nas competências
// seguintes; outro estabelecimento não vê nada; as fontes agregadas; a coleta (substitui só a coletada anterior) e a
// apuração (linhas por centro, substituição pela versão lida e aprovação) gravadas e relidas.
// Massa SINTÉTICA (centros e domínios fictícios), limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { ESTATISTICAS_CUSTO, TIPOS_DADO_ESTATISTICA } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaCustosMemoria } from './porta-memoria.js';
import { codigoEstatisticaNoBanco, PortaCustosPropria } from './porta-propria.js';
import type { ContextoCustos, TrilhaCustos } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'f2203a';
const EST_B = 'f2203b';
const REFERENCIA =
  ESTATISTICAS_CUSTO.find((e) => e.tipoDado === TIPOS_DADO_ESTATISTICA.referencia)?.codigo ?? 'areaM2';
const LANCAMENTO =
  ESTATISTICAS_CUSTO.find((e) => e.tipoDado === TIPOS_DADO_ESTATISTICA.lancamento)?.codigo ?? 'pacienteDia';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('porta própria dos custos contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCustosPropria;
  let estA = 0;
  let estB = 0;
  let unidade = 0;
  let centroUti = 0;
  let centroLav = 0;
  const correlacao = `f22-0203c-${Date.now()}`;
  let ctxA: ContextoCustos;
  let ctxB: ContextoCustos;

  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0203-conta' }, (l) => l.uma<T>(sql, p));
  /** Ajuste direto da massa sintética (o que a porta ainda não grava: a coletada e a apuração). */
  const escrever = (sql: string, p: readonly unknown[]): Promise<number> =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-ajuste' }, async (e) => {
      if (/^\s*INSERT/i.test(sql)) return e.inserir(sql, [...p]);
      await e.executar(sql, [...p]);
      return 0;
    });
  const trilha = (entidade: string, id: number | null): TrilhaCustos => ({
    estabelecimento: estA,
    usuario: null,
    acao: 'operacao',
    entidade,
    entidadeId: id,
    dadosDepois: { evento: 'teste' },
    correlacao,
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar(
          `DELETE s FROM estatistica_centro_mes s JOIN centro_custo c ON c.id = s.centro_custo_id
            WHERE c.estabelecimento_id = ? AND c.codigo LIKE 'F2203%'`,
          [est],
        );
        await e.executar(
          `DELETE x FROM apuracao_custo_centro x JOIN apuracao_custo a ON a.id = x.apuracao_custo_id
            WHERE a.estabelecimento_id = ? AND a.competencia IN ('2026-04-01', '2026-05-01')`,
          [est],
        );
        await e.executar(
          "UPDATE apuracao_custo SET substituida_por_apuracao_custo_id = NULL WHERE estabelecimento_id = ? AND competencia IN ('2026-04-01', '2026-05-01')",
          [est],
        );
        await e.executar(
          "DELETE FROM apuracao_custo WHERE estabelecimento_id = ? AND competencia IN ('2026-04-01', '2026-05-01')",
          [est],
        );
        await e.executar(
          "DELETE FROM coleta_estatistica_custo WHERE estabelecimento_id = ? AND competencia = '2026-04-01'",
          [est],
        );
        await e.executar("DELETE FROM centro_custo WHERE estabelecimento_id = ? AND codigo LIKE 'F2203%'", [
          est,
        ]);
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-massa' }, async (e) => {
      const agora = new Date();
      // Os mesmos estabelecimentos fictícios da integração da contratualização (o A com o CNES de teste).
      const est = (codigo: string, cnes: string | null) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, cnes, agora],
        );
      estA = await est(EST_A, '9020301');
      estB = await est(EST_B, null);
      for (const [i, classe] of ['produtivo', 'auxiliar', 'administrativo', 'externo'].entries())
        await garantir(
          e,
          'SELECT id FROM classificacao_centro_custo WHERE codigo = ?',
          [classe],
          'INSERT INTO classificacao_centro_custo (codigo, descricao, classe, ordem, criado_em) VALUES (?, ?, ?, ?, ?)',
          [classe, `Centro ${classe}`, classe, i + 1, agora],
        );
      for (const x of ESTATISTICAS_CUSTO)
        await garantir(
          e,
          'SELECT id FROM tipo_dado_estatistico WHERE codigo = ?',
          [codigoEstatisticaNoBanco(x.codigo)],
          `INSERT INTO tipo_dado_estatistico (codigo, descricao, unidade_medida, fator, direcionador_rateio, criado_em)
           VALUES (?, ?, ?, 1, TRUE, ?)`,
          [codigoEstatisticaNoBanco(x.codigo), x.rotulo, x.unidade.slice(0, 20), agora],
        );
      unidade = await garantir(
        e,
        'SELECT id FROM unidade_mensuracao_custo WHERE codigo = ?',
        ['F2203_DIA'],
        `INSERT INTO unidade_mensuracao_custo (codigo, descricao, categoria, fator_ponderacao, codigo_programa_nacional, criado_em)
         VALUES ('F2203_DIA', 'Paciente-dia (teste)', 'producao', 1, '99', ?)`,
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM grupo_exportacao_custo WHERE codigo = ?',
        ['F2203'],
        "INSERT INTO grupo_exportacao_custo (codigo, nome, destino, criado_em) VALUES ('F2203', 'Grupo de teste', 'proprio', ?)",
        [agora],
      );
    });
    porta = new PortaCustosPropria(nucleo, CLIENTE);
    ctxA = { rede: 'teste', hospital: EST_A, estabelecimento: estA, usuario: null, correlacao };
    ctxB = { rede: 'teste', hospital: EST_B, estabelecimento: estB, usuario: null, correlacao };
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-massa' }, async (e) => {
      const agora = new Date();
      const centro = (codigo: string, nome: string, ativo: boolean) =>
        e.inserir(
          `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, sigla, vigencia_inicio, ativo, codigo_externo, criado_em)
           VALUES (?, ?, ?, ?, '2025-01-01', ?, ?, ?)`,
          [estA, codigo, nome, codigo.slice(-3), ativo, `EXT-${codigo}`, agora],
        );
      centroUti = await centro('F2203101', 'UTI FICTICIA', true);
      centroLav = await centro('F2203202', 'LAVANDERIA FICTICIA', true);
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('lê os centros do estabelecimento (sem classificação) e os domínios de custos', async () => {
    const cs = await porta.centros(ctxA);
    const uti = cs.find((c) => c.id === centroUti);
    expect(uti).toMatchObject({
      nome: 'UTI FICTICIA',
      ativo: true,
      classificacao: null,
      produtivoCadastro: null,
    });
    expect(uti?.codigo).toBe(centroUti);
    const d = await porta.dominios(ctxA);
    expect(d.tiposDado.map((t) => t.id)).toEqual([1, 2]);
    expect(d.unidades.some((u) => u.codigo === unidade)).toBe(true);
    expect(d.gruposExportacao.some((g) => g.nome === 'Grupo de teste')).toBe(true);
    const cod = await porta.codigosExportacao(ctxA);
    expect(cod.centros.find((c) => c.id === centroUti)?.codigoApurasus).toBe('EXT-F2203101');
    expect(cod.unidades.find((u) => u.codigo === unidade)?.codigoApurasus).toBe('99');
  });

  it('classifica o centro: versão, trilha e idempotência; o mesmo não grava; a versão velha é recusada', async () => {
    const x = {
      centro: centroLav,
      classe: 'auxiliar' as const,
      ordemRateio: 3,
      criterio: LANCAMENTO,
      unidadeMensuracao: unidade,
      observacao: 'Reparte por paciente-dia',
      versao: null,
    };
    await escrever("UPDATE centro_custo SET observacao = 'Nota do cadastro' WHERE id = ?", [centroLav]);
    const r = await porta.classificar(ctxA, x, 'teste', trilha('centro_custo', centroLav));
    expect(r?.mudou).toBe(true);
    expect(r?.depois.classificacao).toMatchObject({
      classe: 'auxiliar',
      ordemRateio: 3,
      criterio: LANCAMENTO,
      unidadeMensuracao: unidade,
      observacao: null,
      versao: 2,
    });
    // A observação da classificação vai à trilha; a do cadastro do centro não muda.
    expect((await ler('SELECT observacao FROM centro_custo WHERE id = ?', [centroLav]))?.['observacao']).toBe(
      'Nota do cadastro',
    );
    const mot = await ler(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'centro_custo' AND entidade_id = ? AND correlacao = ? ORDER BY id DESC LIMIT 1",
      [centroLav, correlacao],
    );
    expect(mot?.['motivo']).toBe('Reparte por paciente-dia');
    const linha = await ler(
      `SELECT c.versao, cl.classe, td.codigo AS criterio FROM centro_custo c
         JOIN classificacao_centro_custo cl ON cl.id = c.classificacao_centro_custo_id
         JOIN tipo_dado_estatistico td ON td.id = c.criterio_tipo_dado_estatistico_id WHERE c.id = ?`,
      [centroLav],
    );
    expect(linha).toMatchObject({
      versao: 2,
      classe: 'auxiliar',
      criterio: codigoEstatisticaNoBanco(LANCAMENTO),
    });
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'centro_custo' AND entidade_id = ? AND correlacao = ?",
      [centroLav, correlacao],
    );
    expect(Number(t?.['n'])).toBe(1);
    const i = await ler(
      "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'custos.classificar-centro' AND estabelecimento_id = ?",
      [estA],
    );
    expect(Number(i?.['n'])).toBeGreaterThanOrEqual(1);
    const igual = await porta.classificar(
      ctxA,
      { ...x, observacao: null, versao: 2 },
      'teste',
      trilha('centro_custo', centroLav),
    );
    expect(igual?.mudou).toBe(false);
    expect((await ler('SELECT versao FROM centro_custo WHERE id = ?', [centroLav]))?.['versao']).toBe(2);
    await expect(
      porta.classificar(
        ctxA,
        { ...x, classe: 'produtivo', versao: 1 },
        'teste',
        trilha('centro_custo', centroLav),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
    await expect(
      porta.classificar(ctxA, { ...x, versao: null }, 'teste', trilha('centro_custo', centroLav)),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
  });

  it('lança a estatística: uma linha por competência; o novo lançamento substitui; a referência vale depois', async () => {
    const base = { competencia: '2026-03', centro: centroUti, codigo: LANCAMENTO, tipoDado: 1 as const };
    const a = await porta.lancar(
      ctxA,
      { ...base, cent: 12_345, observacao: 'Censo conferido' },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    expect(a.substituidas).toBe(0);
    expect(a.registro).toMatchObject({
      competencia: '2026-03',
      centro: centroUti,
      codigo: LANCAMENTO,
      cent: 12_345,
      origem: 'manual',
    });
    const b = await porta.lancar(
      ctxA,
      { ...base, cent: 13_000, observacao: null },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    expect(b.substituidas).toBe(1);
    expect(b.registro.id).toBe(a.registro.id);
    const n = await ler(
      `SELECT COUNT(*) AS n, MAX(quantidade) AS q, MAX(versao) AS v FROM estatistica_centro_mes
        WHERE centro_custo_id = ? AND competencia = '2026-03-01'`,
      [centroUti],
    );
    expect(Number(n?.['n'])).toBe(1);
    expect(Number(n?.['q'])).toBe(130);
    expect(Number(n?.['v'])).toBe(2);
    const motivo = await ler(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'estatistica_centro_mes' AND entidade_id = ? AND correlacao = ? ORDER BY id LIMIT 1",
      [a.registro.id, correlacao],
    );
    expect(motivo?.['motivo']).toBe('Censo conferido');
    await porta.lancar(
      ctxA,
      {
        competencia: '2026-01',
        centro: centroLav,
        codigo: REFERENCIA,
        tipoDado: 2,
        cent: 25_000,
        observacao: null,
      },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    const m = await porta.estatisticas(ctxA, '2026-03');
    expect(m.truncado).toBe(false);
    expect(m.registros.map((r) => [r.centro, r.codigo, r.competencia]).sort()).toEqual(
      [
        [centroLav, REFERENCIA, '2026-01'],
        [centroUti, LANCAMENTO, '2026-03'],
      ].sort(),
    );
    expect(m.registros.find((r) => r.codigo === REFERENCIA)?.tipoDado).toBe(2);
    expect((await porta.estatisticas(ctxA, '2026-02')).registros.map((r) => r.codigo)).toEqual([REFERENCIA]);
  });

  it('o manual substitui só o manual: a coletada fica; a linha apurada é recusada', async () => {
    const base = { competencia: '2026-05', centro: centroUti, codigo: LANCAMENTO, tipoDado: 1 as const };
    const tipo = await ler('SELECT id FROM tipo_dado_estatistico WHERE codigo = ?', [
      codigoEstatisticaNoBanco(LANCAMENTO),
    ]);
    await escrever(
      `INSERT INTO estatistica_centro_mes (centro_custo_id, tipo_dado_estatistico_id, competencia, quantidade, forma_coleta, criado_em)
       VALUES (?, ?, '2026-05-01', 77, 'automatica', NOW(3))`,
      [centroUti, tipo?.['id']],
    );
    const a = await porta.lancar(
      ctxA,
      { ...base, cent: 5_000, observacao: null },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    expect(a.substituidas).toBe(0);
    const formas = await ler(
      `SELECT GROUP_CONCAT(CONCAT(forma_coleta, ':', CAST(quantidade AS UNSIGNED)) ORDER BY forma_coleta) AS f FROM estatistica_centro_mes
        WHERE centro_custo_id = ? AND competencia = '2026-05-01' AND excluido_em IS NULL`,
      [centroUti],
    );
    expect(formas?.['f']).toBe('automatica:77,manual:50');
    const apuracao = await escrever(
      "INSERT INTO apuracao_custo (estabelecimento_id, competencia, criado_em) VALUES (?, '2026-05-01', NOW(3))",
      [estA],
    );
    await escrever('UPDATE estatistica_centro_mes SET apuracao_custo_id = ? WHERE id = ?', [
      apuracao,
      a.registro.id,
    ]);
    await expect(
      porta.lancar(
        ctxA,
        { ...base, cent: 6_000, observacao: null },
        'teste',
        trilha('estatistica_centro_mes', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'estatistica-apurada' } });
    expect(
      Number(
        (await ler('SELECT quantidade FROM estatistica_centro_mes WHERE id = ?', [a.registro.id]))?.[
          'quantidade'
        ],
      ),
    ).toBe(50);
    await escrever('UPDATE estatistica_centro_mes SET apuracao_custo_id = NULL WHERE id = ?', [
      a.registro.id,
    ]);
    await escrever('DELETE FROM apuracao_custo WHERE id = ?', [apuracao]);
  });

  it('paridade memória × própria: a mesma sequência de lançamentos manuais dá o mesmo resultado', async () => {
    const memoria = new PortaCustosMemoria();
    const centroMem = (await memoria.centros(ctxA))[0]!.id;
    const seq = async (p: PortaCustosPropria | PortaCustosMemoria, centro: number) => {
      const base = {
        competencia: '2026-06',
        centro,
        codigo: LANCAMENTO,
        tipoDado: 1 as const,
        observacao: null,
      };
      const um = await p.lancar(
        ctxA,
        { ...base, cent: 1_000 },
        'teste',
        trilha('estatistica_centro_mes', null),
      );
      const dois = await p.lancar(
        ctxA,
        { ...base, cent: 2_000 },
        'teste',
        trilha('estatistica_centro_mes', null),
      );
      const m = (await p.estatisticas(ctxA, '2026-06')).registros.filter(
        (r) => r.centro === centro && r.codigo === LANCAMENTO,
      );
      return {
        substituidas: [um.substituidas, dois.substituidas],
        vigentes: m.map((r) => [r.origem, r.cent]),
      };
    };
    expect(await seq(porta, centroUti)).toEqual(await seq(memoria, centroMem));
    expect(await seq(memoria, centroMem)).toMatchObject({
      substituidas: [1, 1],
      vigentes: [['manual', 2_000]],
    });
  });

  it('outro estabelecimento não vê o centro nem as estatísticas; lançar no centro de outro é recusado', async () => {
    expect(await porta.centro(ctxB, centroUti)).toBeNull();
    expect((await porta.centros(ctxB)).some((c) => c.id === centroUti)).toBe(false);
    expect((await porta.estatisticas(ctxB, '2026-03')).registros).toEqual([]);
    await expect(
      porta.lancar(
        ctxB,
        {
          competencia: '2026-03',
          centro: centroUti,
          codigo: LANCAMENTO,
          tipoDado: 1,
          cent: 1,
          observacao: null,
        },
        'teste',
        trilha('estatistica_centro_mes', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'centro-inexistente' } });
  });

  it('fontes agregadas no banco: a forma completa, sem movimento no estabelecimento fictício', async () => {
    const f = await porta.fontes(ctxA, { inicio: '2026-04-01', fim: '2026-04-30', seguinte: '2026-05-01' });
    expect(f).toEqual({
      censo: { grupos: [], diasFechados: 0 },
      internacoes: [],
      cirurgias: [],
      exames: [],
      requisicoes: [],
      colaboradores: [],
      leitos: [],
    });
    const k = await porta.fontesCusteio(ctxA, {
      ano: 2026,
      mes: 4,
      inicio: '2026-04-01',
      fim: '2026-04-30',
      competencia: '2026-04',
      limiteLinhaCentavos: 1_000_000,
    });
    expect(k).toEqual({
      materiais: [],
      atipicas: [],
      devolucoes: [],
      devolucoesAtipicas: [],
      despesas: [],
      pessoal: [],
      itensConta: [],
      contasFechadas: 0,
      truncado: false,
    });
  });

  it('coleta: o registro e as linhas coletadas; a nova coleta substitui só a coletada; a manual fica', async () => {
    const manual = await porta.lancar(
      ctxA,
      {
        competencia: '2026-04',
        centro: centroLav,
        codigo: LANCAMENTO,
        cent: 700,
        tipoDado: 1,
        observacao: null,
      },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    const linhas = [
      {
        centro: centroUti,
        codigo: LANCAMENTO,
        cent: 3_050,
        fonte: 'censo',
        estimada: true,
        tipoDado: 1 as const,
      },
      {
        centro: centroLav,
        codigo: LANCAMENTO,
        cent: 1_200,
        fonte: 'censo',
        estimada: false,
        tipoDado: 1 as const,
      },
    ];
    const g1 = await porta.gravarColeta(
      ctxA,
      { competencia: '2026-04', linhas, resumo: '{"fontes":[]}', duracaoMs: 12 },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    expect(g1).toMatchObject({ gravadas: 2, substituidas: 0 });
    const g2 = await porta.gravarColeta(
      ctxA,
      { competencia: '2026-04', linhas, resumo: '{"fontes":[]}', duracaoMs: 9 },
      'teste',
      trilha('estatistica_centro_mes', null),
    );
    expect(g2).toMatchObject({ gravadas: 2, substituidas: 2 });
    const u = await porta.ultimaColeta(ctxA, '2026-04');
    expect(u).toMatchObject({ id: g2.id, competencia: '2026-04', linhas: 2, duracaoMs: 9 });
    expect(JSON.parse(u!.resumo)).toEqual({ fontes: [] });
    const { registros } = await porta.estatisticas(ctxA, '2026-04');
    const daUti = registros.filter((r) => r.centro === centroUti && r.codigo === LANCAMENTO);
    expect(daUti).toEqual([
      expect.objectContaining({ cent: 3_050, origem: 'coletada', estimada: true, idColeta: g2.id }),
    ]);
    const daLav = registros
      .filter((r) => r.centro === centroLav && r.codigo === LANCAMENTO)
      .map((r) => [r.origem, r.cent]);
    expect(daLav.sort()).toEqual([
      ['coletada', 1_200],
      ['manual', 700],
    ]);
    expect(manual.registro.origem).toBe('manual');
    expect(await porta.ultimaColeta(ctxB, '2026-04')).toBeNull();
    await expect(
      porta.gravarColeta(
        ctxB,
        { competencia: '2026-04', linhas, resumo: '{}', duracaoMs: 1 },
        'teste',
        trilha('estatistica_centro_mes', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'centro-inexistente' } });
  });

  it('apuração: grava e relê as linhas; a vigente só é substituída pela versão lida; aprovar fecha', async () => {
    const linha = (centro: number, classe: string, custoFinal: number) => ({
      centro,
      codigo: 0,
      nome: '',
      classe,
      ordemRateio: classe === 'produtivo' ? null : 1,
      criterio: classe === 'produtivo' ? null : LANCAMENTO,
      pessoal: 10_000,
      materiais: 2_500,
      despesas: 1_000,
      despesasGerais: 0,
      diretoTotal: 13_500,
      recebidoTotal: classe === 'produtivo' ? 13_500 : 0,
      recebidos: classe === 'produtivo' ? ([[centroLav, 13_500]] as const) : [],
      repassado: classe === 'produtivo' ? 0 : 13_500,
      naoRateado: 0,
      custoFinal,
      baseCriterioCent: 3_050,
      producaoCodigo: LANCAMENTO,
      producaoCent: 3_050,
      custoUnitario: 88_525,
      receita: 0,
    });
    const entrada = (substitui: { id: number; versao: number } | null) => ({
      competencia: '2026-04',
      substitui,
      rotuloParcial: null,
      limiteLinha: 1_000_000,
      custoProdutivos: 27_000,
      totais: '{"direto":27000}',
      completude: '{"ok":true}',
      pendencias: '[]',
      impressao: 'a'.repeat(64),
      justificativa: substitui ? 'refeita no teste' : null,
      duracaoMs: 30,
      linhas: [linha(centroUti, 'produtivo', 27_000), linha(centroLav, 'auxiliar', 0)],
      contas: [],
    });
    const a1 = await porta.gravarApuracao(ctxA, entrada(null), 'teste', trilha('apuracao_custo', null));
    expect(a1.substituida).toBeNull();
    expect(a1.apuracao).toMatchObject({
      competencia: '2026-04',
      situacao: 'apurada',
      custoProdutivos: 27_000,
      duracaoMs: 30,
    });
    const ls = await porta.linhasApuracao(ctxA, a1.apuracao.id);
    expect(ls.find((x) => x.centro === centroUti)).toMatchObject({
      classe: 'produtivo',
      pessoal: 10_000,
      custoFinal: 27_000,
      recebidoTotal: 13_500,
      baseCriterioCent: 3_050,
      custoUnitario: 88_525,
      nome: 'UTI FICTICIA',
    });
    expect(JSON.parse(ls.find((x) => x.centro === centroUti)!.recebidos)).toEqual([[centroLav, 13_500]]);
    expect(ls.find((x) => x.centro === centroLav)?.criterio).toBe(LANCAMENTO);
    await expect(
      porta.gravarApuracao(ctxA, entrada(null), 'teste', trilha('apuracao_custo', null)),
    ).rejects.toMatchObject({
      problema: { codigo: 'desatualizado' },
    });
    const a2 = await porta.gravarApuracao(
      ctxA,
      entrada({ id: a1.apuracao.id, versao: a1.apuracao.versao }),
      'teste',
      trilha('apuracao_custo', null),
    );
    expect(a2.substituida).toBe(a1.apuracao.id);
    const lista = await porta.apuracoes(ctxA, '2026-04');
    expect(lista.map((x) => [x.id, x.situacao])).toEqual([
      [a2.apuracao.id, 'apurada'],
      [a1.apuracao.id, 'substituida'],
    ]);
    const ap = await porta.aprovarApuracao(
      ctxA,
      a2.apuracao.id,
      a2.apuracao.versao,
      'teste',
      trilha('apuracao_custo', a2.apuracao.id),
    );
    expect(ap?.depois).toMatchObject({ situacao: 'aprovada', justificativa: 'refeita no teste' });
    expect(ap?.depois.aprovadaEm).not.toBeNull();
    await expect(
      porta.aprovarApuracao(
        ctxA,
        a2.apuracao.id,
        a2.apuracao.versao,
        'teste',
        trilha('apuracao_custo', a2.apuracao.id),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
    expect(await porta.contasApuracao(ctxA, a2.apuracao.id, { negativas: false, pagina: 1 })).toEqual({
      total: 0,
      contas: [],
    });
    expect(await porta.resultadoAgrupado(ctxA, a2.apuracao.id, 'convenio')).toEqual([]);
    expect(await porta.apuracao(ctxB, a2.apuracao.id)).toBeNull();
    expect(await porta.apuracoes(ctxB, '2026-04')).toEqual([]);
    const nomes = await porta.nomesConvenios(ctxA, [999_999_999]);
    expect(nomes.size).toBe(0);
  });
});
