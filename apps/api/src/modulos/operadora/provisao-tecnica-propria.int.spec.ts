// Contrato de efeito da contabilidade regulatória da operadora (08-SGO L111, C3-026) contra o MariaDB real. Massa
// SINTÉTICA: a carteira da F1 (operadora ligada ao estabelecimento), um plano de contas próprio com a provisão da PEONA,
// a da PESL e a despesa, os períodos contábeis de 2031 e um ramo 8 do plano padrão da ANS (fonte "C3026").
// Prova o que fica no banco: as contas do plano padrão com grau e conta-mãe; o mapa por operadora com a recusa da conta
// já mapeada; a competência calculada com os itens (PEONA de 8,5% das contraprestações, PESL dos avisados), o
// recálculo que exclui os itens anteriores e segue a sequência, a base do sistema e o valor anterior na competência
// seguinte; a contabilização com o lançamento da variação; o balancete no padrão da ANS com as parcelas; o cancelamento
// e as recusas (versão antiga e situação). SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './infra/copia.spec-util.js';
import { PortaProvisaoTecnicaPropria } from './provisao-tecnica-propria.js';

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaProvisaoTecnicaPropria | null = null;
let op = 0;
const conta: Record<string, number> = {};
const FONTE = 'C3026';

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.provisao-tecnica' },
    correlacao: 'teste-c3026',
  });
const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c3026' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c3026' }, async (e) => {
    await e.executar(
      `DELETE p FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
        WHERE l.estabelecimento_id = ? AND l.historico LIKE 'Provisões técnicas da operadora%'`,
      [m.est],
    );
    await e.executar(
      "DELETE FROM lancamento_contabil WHERE estabelecimento_id = ? AND historico LIKE 'Provisões técnicas da operadora%'",
      [m.est],
    );
    await e.executar(
      'DELETE i FROM provisao_tecnica_item i JOIN provisao_tecnica_competencia p ON p.id = i.provisao_tecnica_competencia_id WHERE p.estabelecimento_id IN (?, ?)',
      [m.est, m.outroEst],
    );
    await e.executar('DELETE FROM provisao_tecnica_competencia WHERE estabelecimento_id IN (?, ?)', [
      m.est,
      m.outroEst,
    ]);
    await e.executar(
      `DELETE m FROM mapa_conta_balancete_ans m JOIN plano_contas_padrao_ans a ON a.id = m.plano_contas_padrao_ans_id
        WHERE a.versao_fonte = ?`,
      [FONTE],
    );
    for (let i = 0; i < 4; i++)
      await e.executar(
        `DELETE a FROM plano_contas_padrao_ans a LEFT JOIN plano_contas_padrao_ans f ON f.superior_plano_contas_padrao_ans_id = a.id
          WHERE a.versao_fonte = ? AND f.id IS NULL`,
        [FONTE],
      );
    await e.executar(
      "DELETE FROM periodo_contabil WHERE estabelecimento_id = ? AND competencia IN ('2031-02-01','2031-03-01')",
      [m.est],
    );
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  const cart = await montarCarteira(servico, sessao(massa), { registro: '430261', base: '3026' });
  op = cart.operadora;
  porta = new PortaProvisaoTecnicaPropria(nucleo, CLIENTE);
  const est = massa.est;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-c3026' }, async (e) => {
    const agora = new Date();
    let plano = (await e.uma<{ id: unknown }>("SELECT id FROM plano_contas WHERE codigo = 'C3026-PC'", []))
      ?.id;
    if (!plano)
      plano = await e.inserir(
        "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('C3026-PC', 'PLANO SINTETICO C3026', 'contabil', '9.9.99.999', 4, '2000-01-01', ?)",
        [agora],
      );
    for (const [cl, nome, nat, saldo] of [
      ['2.9.26.001', 'PEONA', 'passivo', 'credora'],
      ['2.9.26.002', 'PESL', 'passivo', 'credora'],
      ['4.9.26.001', 'DESPESA', 'despesa', 'devedora'],
    ] as const) {
      const ex = (
        await e.uma<{ id: unknown }>(
          'SELECT id FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = ?',
          [plano, cl],
        )
      )?.id;
      conta[nome] = Number(
        ex ??
          (await e.inserir(
            `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza, natureza_saldo, tipo, criado_em)
             VALUES (?, ?, ?, ?, 4, ?, ?, 'analitica', ?)`,
            [plano, cl, `C3026${cl.replace(/\./g, '')}`, `${nome} SINTETICA C3026`, nat, saldo, agora],
          )),
      );
    }
    for (const mes of ['02', '03'])
      await e.inserir(
        `INSERT INTO periodo_contabil (estabelecimento_id, competencia, exercicio, plano_contas_id, situacao, criado_em)
         VALUES (?, ?, 2031, ?, 'aberto', ?)`,
        [est, `2031-${mes}-01`, plano, agora],
      );
  });
}, 120_000);

afterAll(async () => {
  if (nucleo && massa) {
    await limpar(nucleo, massa);
    await limparMassa(nucleo, massa);
  }
  await nucleo?.encerrar();
});

const ans = (codigo: string, tipo: 'sintetica' | 'analitica') => ({
  codigo,
  descricao: `CONTA ANS SINTETICA ${codigo}`,
  tipo,
  natureza: tipo === 'analitica' ? ('credora' as const) : null,
  modalidades: null,
  vigenciaInicio: '2031-01-01',
  vigenciaFim: null,
  versaoFonte: FONTE,
});

describe.skipIf(!PODE)('contabilidade regulatória da operadora no banco (C3-026)', () => {
  it('plano padrão da ANS com grau e conta-mãe, e mapa das contas próprias por operadora', async () => {
    const c = contexto(massa!);
    for (const [cod, tipo] of [
      ['8', 'sintetica'],
      ['81', 'sintetica'],
      ['811', 'analitica'],
      ['812', 'analitica'],
    ] as const)
      await porta!.gravarContaPadrao(c, ans(cod, tipo), trilha('conta'));
    expect(await codigoDe(porta!.gravarContaPadrao(c, ans('8111', 'analitica'), trilha('conta')))).toBe(
      'superior-analitica',
    );
    expect(await codigoDe(porta!.gravarContaPadrao(c, ans('81', 'sintetica'), trilha('conta')))).toBe(
      'conta-repetida',
    );
    const linhas = await q(
      `SELECT a.codigo_conta_ans, a.grau, s.codigo_conta_ans AS sup FROM plano_contas_padrao_ans a
         LEFT JOIN plano_contas_padrao_ans s ON s.id = a.superior_plano_contas_padrao_ans_id
        WHERE a.versao_fonte = ? ORDER BY a.codigo_conta_ans`,
      [FONTE],
    );
    expect(linhas.map((r) => [r['codigo_conta_ans'], Number(r['grau']), r['sup']])).toEqual([
      ['8', 1, null],
      ['81', 2, '8'],
      ['811', 3, '81'],
      ['812', 3, '81'],
    ]);
    const mapa = (contaContabil: number, contaAns: string) => ({
      contaContabil,
      contaAns,
      duplicaValor: false,
      grupo: 'PROVISOES',
      subgrupo: null,
      paginaDiops: 3,
      linhaDiops: 12,
      vigenciaInicio: '2031-01-01',
      vigenciaFim: null,
    });
    await porta!.gravarMapa(c, op, mapa(conta['PEONA']!, '811'), trilha('mapa'));
    await porta!.gravarMapa(c, op, mapa(conta['PESL']!, '812'), trilha('mapa'));
    expect(await codigoDe(porta!.gravarMapa(c, op, mapa(conta['PEONA']!, '812'), trilha('mapa')))).toBe(
      'conta-ja-mapeada',
    );
    expect(await codigoDe(porta!.gravarMapa(c, op, mapa(conta['PESL']!, '81'), trilha('mapa')))).toBe(
      'conta-ans-sintetica',
    );
    const ms = await porta!.mapas(c, op);
    expect(ms.map((m) => [m.contaAns, m.contaContabil, m.paginaDiops])).toEqual([
      ['811', conta['PEONA'], 3],
      ['812', conta['PESL'], 3],
    ]);
    expect(await codigoDe(porta!.mapas(contexto(massa!, true), op))).toBe('nao-encontrado');
  });

  it('calcula, recalcula, contabiliza a variação, monta o balancete ANS e cancela', async () => {
    const c = contexto(massa!);
    const contas = { peona: conta['PEONA']!, pesl: conta['PESL']! };
    const fev = await porta!.calcular(
      c,
      {
        competencia: '2031-02-01',
        metodo: 'metodologia_ans',
        contas,
        base: { contraprestacoes: 120000, eventos: 90000, avisadosNaoPagos: 4321 },
        informados: [],
        notaTecnica: null,
        versao: null,
      },
      trilha('calculo'),
    );
    expect(fev.total).toBe('14521.00');
    const itens = (id: number) =>
      q(
        'SELECT sequencia, tipo_provisao, valor, valor_anterior, excluido_em IS NOT NULL AS excluido FROM provisao_tecnica_item WHERE provisao_tecnica_competencia_id = ? ORDER BY sequencia',
        [id],
      ).then((rs) =>
        rs.map((r) => [
          Number(r['sequencia']),
          r['tipo_provisao'],
          Number(r['valor']),
          r['valor_anterior'] === null ? null : Number(r['valor_anterior']),
          Number(r['excluido']),
        ]),
      );
    expect(await itens(fev.id)).toEqual([
      [1, 'peona', 10200, null, 0],
      [2, 'pesl', 4321, null, 0],
    ]);
    // Recálculo: versão antiga recusada; os itens anteriores ficam excluídos e a sequência segue.
    const recalc = {
      competencia: '2031-02-01',
      metodo: 'metodologia_ans' as const,
      contas,
      base: { contraprestacoes: 200000, eventos: 90000, avisadosNaoPagos: 4321 },
      informados: [],
      notaTecnica: null,
    };
    expect(await codigoDe(porta!.calcular(c, { ...recalc, versao: 9 }, trilha('calculo')))).toBe(
      'versao-desatualizada',
    );
    const fev2 = await porta!.calcular(c, { ...recalc, versao: 1 }, trilha('calculo'));
    expect(fev2.versao).toBe(2);
    expect(await itens(fev.id)).toEqual([
      [1, 'peona', 10200, null, 1],
      [2, 'pesl', 4321, null, 1],
      [3, 'peona', 17000, null, 0],
      [4, 'pesl', 4321, null, 0],
    ]);
    // Competência seguinte pela base do sistema (sem mensalidade nem guia na massa: zero) e o valor anterior.
    const mar = await porta!.calcular(
      c,
      {
        competencia: '2031-03-01',
        metodo: 'metodologia_ans',
        contas,
        base: null,
        informados: [],
        notaTecnica: null,
        versao: null,
      },
      trilha('calculo'),
    );
    expect(await itens(mar.id)).toEqual([
      [1, 'peona', 0, 17000, 0],
      [2, 'pesl', 0, 4321, 0],
    ]);
    // Contabilização de fevereiro: D despesa / C provisão, pela variação (sem anterior: o valor inteiro).
    const k = await porta!.contabilizar(
      c,
      fev.id,
      { versao: 2, contaDespesa: conta['DESPESA']!, contaReversao: null },
      trilha('contab'),
    );
    const partidas = await q(
      'SELECT lado, conta_contabil_id, valor FROM partida_contabil WHERE lancamento_contabil_id = ? ORDER BY sequencia',
      [k['lancamento']],
    );
    expect(partidas.map((p) => [p['lado'], Number(p['conta_contabil_id']), Number(p['valor'])])).toEqual([
      ['debito', conta['DESPESA'], 17000],
      ['credito', conta['PEONA'], 17000],
      ['debito', conta['DESPESA'], 4321],
      ['credito', conta['PESL'], 4321],
    ]);
    const [sit] = await q(
      'SELECT situacao, contabilizado_em IS NOT NULL AS ok FROM provisao_tecnica_competencia WHERE id = ?',
      [fev.id],
    );
    expect([sit?.['situacao'], Number(sit?.['ok'])]).toEqual(['contabilizada', 1]);
    expect(await codigoDe(porta!.calcular(c, { ...recalc, versao: 3 }, trilha('calculo')))).toBe(
      'situacao-nao-permite',
    );
    // Busca das contas contábeis da tela: só analíticas e ativas, pela classificação ou pela descrição.
    const achadas = await porta!.contasContabeis(c, '2.9.26');
    expect(achadas.map((x) => x.id)).toEqual(expect.arrayContaining([conta['PEONA'], conta['PESL']]));
    expect((await porta!.contasContabeis(c, 'DESPESA SINTETICA C3026')).map((x) => x.id)).toEqual([
      conta['DESPESA'],
    ]);
    // Balancete no padrão da ANS no fim de fevereiro: provisões no ramo 8; a despesa não mapeada fica de fora.
    const b = await porta!.balancete(c, op, '2031-02-28');
    const linha = (cod: string) => b.linhas.find((l) => l.codigo === cod)?.saldoCentavos;
    expect([linha('8'), linha('81'), linha('811'), linha('812')]).toEqual([
      -2132100, -2132100, -1700000, -432100,
    ]);
    expect(b.semMapa.some((s) => s.contaContabil === conta['DESPESA'] && s.saldoCentavos === 2132100)).toBe(
      true,
    );
    // Janeiro calculado depois de fevereiro contabilizado: a contabilização fora de ordem é recusada, sem lançamento.
    const jan = await porta!.calcular(
      c,
      { ...recalc, competencia: '2031-01-01', versao: null },
      trilha('calculo'),
    );
    const [antes] = await q(
      "SELECT COUNT(*) AS n FROM lancamento_contabil WHERE historico = 'Provisões técnicas da operadora 01/2031'",
    );
    expect(
      await codigoDe(
        porta!.contabilizar(
          c,
          jan.id,
          { versao: jan.versao, contaDespesa: conta['DESPESA']!, contaReversao: null },
          trilha('contab'),
        ),
      ),
    ).toBe('contabilizacao-fora-de-ordem');
    const [depois] = await q(
      "SELECT COUNT(*) AS n FROM lancamento_contabil WHERE historico = 'Provisões técnicas da operadora 01/2031'",
    );
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
    await porta!.cancelar(c, jan.id, { versao: jan.versao, motivo: 'Teste sintético' }, trilha('cancelar'));
    // Cancelamento de março; a contabilizada não cancela.
    await porta!.cancelar(c, mar.id, { versao: 1, motivo: 'Teste sintético' }, trilha('cancelar'));
    expect(await codigoDe(porta!.cancelar(c, fev.id, { versao: 3, motivo: 'x' }, trilha('cancelar')))).toBe(
      'situacao-nao-permite',
    );
    const lidas = await porta!.provisoes(c);
    expect(lidas.map((p) => [p.competencia, p.situacao, p.itens.length])).toEqual([
      ['2031-03-01', 'cancelada', 2],
      ['2031-02-01', 'contabilizada', 2],
      ['2031-01-01', 'cancelada', 2],
    ]);
    expect(lidas.slice(0, 2).map((p) => p.total)).toEqual([0, 21321]);
  });
});
