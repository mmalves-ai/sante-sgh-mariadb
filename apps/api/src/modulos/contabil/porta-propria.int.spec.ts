// Integração da porta PRÓPRIA da contabilidade contra o MariaDB real (cliente f22_o4 da onda 4). Massa SINTÉTICA
// (plano "F2204", contas, evento e fato fictícios), limpa no fim. Contrato de efeito de cada gravação: linhas, versão,
// trilha e idempotência; e as recusas (conta repetida, versão velha, período encerrado, outro estabelecimento, fato
// com situação mudada, versão de regra concorrente, arquivo SPED sem armazém, plano da rede, período bloqueado, conta sem lançamento manual, chave idempotente
// reaproveitada com outro pedido). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { ContextoContabil, GravadorContabil } from './porta.js';
import { chaveDoLancamento, PortaContabilPropria } from './porta-propria.js';
import type { LancamentoParaGravar } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const COMPETENCIA = '2026-03';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo']);
    throw e;
  }
};

describe.skipIf(SEM_BANCO)('porta própria da contabilidade contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContabilPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let plano = 0;
  let evento = 0;
  let fato = 0;
  let ctxA: ContextoContabil;
  let ctxB: ContextoContabil;
  let ctxARede: ContextoContabil;
  let ctxBRede: ContextoContabil;
  const correlacao = `f22-0401-${Date.now()}`;

  const uma = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0401-conta' }, (l) => l.uma<T>(sql, p));
  const contar = async (sql: string, p: readonly unknown[]) => Number((await uma(sql, p))?.['n'] ?? 0);
  const trilha = (entidade: string): TrilhaDaGravacao => ({
    estabelecimento: estA,
    usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste' },
    correlacao,
  });
  const gravar = <T>(c: ContextoContabil, fn: (g: GravadorContabil) => Promise<T>, pedido: unknown = null) =>
    porta.gravar(c, { operacao: 'contabil.teste', pedido }, trilha('fato_contabil'), fn);
  const escrever = (sql: string, p: unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0401-ajuste' }, (e) => e.executar(sql, p));
  const lancamento = (
    chave: string,
    debito: string,
    credito: string,
    centavos: number,
    extra: Partial<LancamentoParaGravar> = {},
  ) =>
    ({
      chave,
      tipo: 'manual',
      empresa: estA,
      data: `${COMPETENCIA}-10`,
      competencia: COMPETENCIA,
      historico: 'Lançamento sintético de teste',
      partidas: [
        { lado: 'D', conta: debito, valorCentavos: centavos, historico: 'débito', centroCusto: null },
        { lado: 'C', conta: credito, valorCentavos: centavos, historico: 'crédito', centroCusto: null },
      ],
      fatoId: null,
      regraId: null,
      regra: null,
      estornaId: null,
      justificativa: null,
      ...extra,
    }) as LancamentoParaGravar;

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0401-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar(
          'UPDATE partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id SET p.conciliacao_conta_contabil_id = NULL WHERE l.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM conciliacao_conta_contabil WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'UPDATE fato_contabil SET lancamento_contabil_id = NULL, situacao = ? WHERE estabelecimento_id = ?',
          ['pendente', est],
        );
        await e.executar(
          'DELETE p FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id WHERE l.estabelecimento_id = ?',
          [est],
        );
        await e.executar(
          'DELETE FROM lancamento_contabil WHERE estabelecimento_id = ? AND estornado_lancamento_contabil_id IS NOT NULL',
          [est],
        );
        await e.executar('DELETE FROM lancamento_contabil WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM fato_contabil WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM periodo_contabil WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM versao_regra_contabil WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM arquivo_sped_contabil WHERE estabelecimento_id = ? ORDER BY id DESC', [
          est,
        ]);
        await e.executar(
          "DELETE FROM arquivo WHERE estabelecimento_id = ? AND entidade = 'arquivo_sped_contabil'",
          [est],
        );
      }
      const p = await e.uma<{ id: number }>("SELECT id FROM plano_contas WHERE codigo = 'F2204'");
      if (p) {
        await e.executar('DELETE FROM conta_contabil WHERE plano_contas_id = ? AND nivel >= 3', [p.id]);
        await e.executar('DELETE FROM conta_contabil WHERE plano_contas_id = ? AND nivel = 2', [p.id]);
        await e.executar('DELETE FROM conta_contabil WHERE plano_contas_id = ?', [p.id]);
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0401-massa' }, async (e) => {
      const agora = new Date();
      const est = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `Hospital fictício ${cod}`, `Hospital fictício ${cod} (teste)`, agora],
        );
      estA = await est('f2204a');
      estB = await est('f2204b');
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['teste.f2204'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em, versao) VALUES (?, ?, 'servico', ?, 1)",
        ['teste.f2204', 'Conta de serviço do teste do lote 04-01', agora],
      );
      plano = await garantir(
        e,
        "SELECT id FROM plano_contas WHERE codigo = 'F2204'",
        [],
        "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('F2204', 'Plano sintético do lote 04-01', 'contabil', '9.9.9', 3, '2000-01-01', ?)",
        [agora],
      );
      evento = await garantir(
        e,
        "SELECT id FROM evento_contabil WHERE codigo = 'receitaConta'",
        [],
        "INSERT INTO evento_contabil (codigo, descricao, modulo, criado_em) VALUES ('receitaConta', 'Receita da conta fechada (teste)', 'faturamento', ?)",
        [agora],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0401-massa' }, async (e) => {
      const agora = new Date();
      // O período liga o estabelecimento ao plano sintético (o plano do estabelecimento é o do período mais recente).
      for (const est of [estA, estB])
        await e.inserir(
          "INSERT INTO periodo_contabil (estabelecimento_id, competencia, exercicio, plano_contas_id, situacao, criado_em) VALUES (?, '2026-02-01', 2026, ?, 'aberto', ?)",
          [est, plano, agora],
        );
      const conta = (
        classificacao: string,
        nivel: number,
        pai: number | null,
        natureza: string,
        saldo: string,
        tipo: string,
      ) =>
        e.inserir(
          `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, conta_pai_id, nivel, natureza,
             natureza_saldo, tipo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            plano,
            classificacao,
            classificacao.replace(/\./g, ''),
            `Conta ${classificacao}`,
            pai,
            nivel,
            natureza,
            saldo,
            tipo,
            agora,
          ],
        );
      const ativo = await conta('1', 1, null, 'ativo', 'devedora', 'sintetica');
      const ativo11 = await conta('1.1', 2, ativo, 'ativo', 'devedora', 'sintetica');
      await conta('1.1.1', 3, ativo11, 'ativo', 'devedora', 'analitica');
      const receita = await conta('3', 1, null, 'receita', 'credora', 'sintetica');
      const receita31 = await conta('3.1', 2, receita, 'receita', 'credora', 'sintetica');
      await conta('3.1.1', 3, receita31, 'receita', 'credora', 'analitica');
      fato = await e.inserir(
        `INSERT INTO fato_contabil (estabelecimento_id, evento_contabil_id, entidade_origem, entidade_origem_id, data_fato, competencia,
           valor, impressao, situacao, criado_em) VALUES (?, ?, 'conta_hospitalar', 990401, '2026-03-05', '2026-03-01', 150.25, ?, 'pendente', ?)`,
        [estA, evento, 'a'.repeat(64), agora],
      );
    });
    porta = new PortaContabilPropria(nucleo);
    const base = { cliente: CLIENTE, usuario, correlacao, rede: 'f22' };
    ctxA = { ...base, estabelecimento: estA, hospital: 'f2204a' };
    ctxB = { ...base, estabelecimento: estB, hospital: 'f2204b' };
    ctxARede = { ...ctxA, gravaPlanoDaRede: true };
    ctxBRede = { ...ctxB, gravaPlanoDaRede: true };
  }, 180_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('plano: inclui a conta com nível e superior, recusa repetida, altera com a versão e recusa a versão velha', async () => {
    expect(await porta.empresas(ctxA)).toEqual([estA]);
    const trilhas0 = await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [
      estA,
    ]);
    const nova = {
      empresa: estA,
      codigo: '1.1.2',
      nome: 'Bancos (teste)',
      grupo: 'ativo' as const,
      tipo: 'analitica' as const,
      natureza: 'devedora' as const,
      referencialTipo: null,
      referencialConta: null,
      contaExportacao: null,
      exigeCentroCusto: false,
      ativa: true,
    };
    // O plano F2204 é usado pelos períodos de A e de B: sem a permissão do plano da rede, nenhum dos dois grava nele.
    expect(await codigo(gravar(ctxA, (g) => g.incluirConta({ conta: nova, usuario: 'x' })))).toBe(
      'plano-da-rede',
    );
    const incluida = await porta.gravar(
      ctxARede,
      { operacao: 'contabil.incluirConta', pedido: nova },
      (r: { id: number; versao: number }) => ({ ...trilha('conta_contabil'), entidadeId: r.id }),
      (g) => g.incluirConta({ conta: nova, usuario: 'x' }),
    );
    expect(incluida).toEqual({ id: expect.any(Number), versao: 1 });
    const linha = await uma(
      "SELECT c.id, c.nivel, c.versao, c.natureza, p.classificacao AS pai FROM conta_contabil c JOIN conta_contabil p ON p.id = c.conta_pai_id WHERE c.plano_contas_id = ? AND c.classificacao = '1.1.2'",
      [plano],
    );
    expect([
      Number(linha?.['id']),
      Number(linha?.['nivel']),
      Number(linha?.['versao']),
      linha?.['natureza'],
      linha?.['pai'],
    ]).toEqual([incluida.id, 3, 1, 'ativo', '1.1']);
    expect(
      await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [estA]),
    ).toBe(trilhas0 + 1);
    // A trilha aponta a tabela gravada e o id da conta incluída.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'conta_contabil' AND entidade_id = ?",
        [estA, incluida.id],
      ),
    ).toBe(1);
    expect(await codigo(gravar(ctxARede, (g) => g.incluirConta({ conta: nova, usuario: 'x' })))).toBe(
      'conta-ja-existe',
    );
    expect(
      await codigo(
        gravar(ctxBRede, (g) => g.incluirConta({ conta: { ...nova, codigo: '1.1.3' }, usuario: 'x' })),
      ),
    ).toBe('outro-estabelecimento');
    const depois = { ...nova, nome: 'Bancos conta movimento' };
    // B (empresa = B) não altera, sem a permissão da rede, a conta do plano que A também usa.
    expect(
      await codigo(
        gravar(ctxB, (g) =>
          g.alterarConta({ empresa: estB, codigo: '1.1.2', versao: 1, depois, usuario: 'x' }),
        ),
      ),
    ).toBe('plano-da-rede');
    expect(
      await codigo(
        gravar(ctxARede, (g) =>
          g.alterarConta({ empresa: estA, codigo: '1.1.2', versao: 7, depois, usuario: 'x' }),
        ),
      ),
    ).toBe('conflito-versao');
    const r = await gravar(ctxARede, (g) =>
      g.alterarConta({ empresa: estA, codigo: '1.1.2', versao: 1, depois, usuario: 'x' }),
    );
    expect([r.antes.nome, r.versao]).toEqual(['Bancos (teste)', 2]);
    const plano1 = await porta.plano(ctxA, estA);
    expect(plano1.find((c) => c.codigo === '1.1.2')?.nome).toBe('Bancos conta movimento');
    expect(await porta.plano(ctxB, estA)).toEqual([]);
  });

  it('idempotência: a mesma chave com o mesmo pedido devolve o gravado; com outro pedido, recusa', async () => {
    const ctx = { ...ctxARede, chaveIdempotencia: `f22-0401-idem-${Date.now()}:1` };
    const conta = {
      empresa: estA,
      codigo: '1.1.3',
      nome: 'Caixa (teste)',
      grupo: 'ativo' as const,
      tipo: 'analitica' as const,
      natureza: 'devedora' as const,
      referencialTipo: null,
      referencialConta: null,
      contaExportacao: null,
      exigeCentroCusto: false,
      ativa: true,
    };
    const incluir = (pedido: unknown) =>
      porta.gravar(ctx, { operacao: 'contabil.incluirConta', pedido }, trilha('conta_contabil'), (g) =>
        g.incluirConta({ conta, usuario: 'x' }),
      );
    const primeira = await incluir(conta);
    expect(await incluir(conta)).toEqual(primeira);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = '1.1.3'",
        [plano],
      ),
    ).toBe(1);
    expect(await codigo(incluir({ ...conta, nome: 'Outro pedido' }))).toBe('idempotencia-divergente');
  });

  it('lançamento: linhas, número, chave idempotente, estorno, razão, somas e outro estabelecimento sem nada', async () => {
    const r = await gravar(ctxA, (g) =>
      g.gravarLancamento(lancamento('t0401-a', '1.1.1', '3.1.1', 15025), 'x'),
    );
    expect(r.repetido).toBe(false);
    const l = await uma(
      "SELECT l.numero, l.valor_total, l.versao, l.situacao, l.chave_idempotencia, DATE_FORMAT(p.competencia, '%Y-%m') AS comp FROM lancamento_contabil l JOIN periodo_contabil p ON p.id = l.periodo_contabil_id WHERE l.id = ?",
      [r.id],
    );
    expect(Number(l?.['numero'])).toBeGreaterThan(0);
    // Parcelas impressas: 150,25 a débito = 150,25 a crédito.
    expect([Number(l?.['valor_total']), Number(l?.['versao']), l?.['situacao'], l?.['comp']]).toEqual([
      150.25,
      1,
      'ativo',
      COMPETENCIA,
    ]);
    expect(l?.['chave_idempotencia']).toBe(chaveDoLancamento(estA, 't0401-a'));
    expect(
      await contar('SELECT COUNT(*) AS n FROM partida_contabil WHERE lancamento_contabil_id = ?', [r.id]),
    ).toBe(2);
    expect(
      await gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-a', '1.1.1', '3.1.1', 15025), 'x')),
    ).toEqual({
      id: r.id,
      repetido: true,
    });
    expect(
      await codigo(gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-x', '1.1', '3.1.1', 100), 'x'))),
    ).toBe('conta-inexistente');
    const det = await porta.lancamento(ctxA, r.id);
    expect(det?.partidas.map((p) => [p.lado, p.conta, p.valorCentavos])).toEqual([
      ['D', '1.1.1', 15025],
      ['C', '3.1.1', 15025],
    ]);
    const est = await gravar(ctxA, (g) =>
      g.gravarLancamento(
        lancamento('t0401-e', '3.1.1', '1.1.1', 15025, {
          tipo: 'estorno',
          estornaId: r.id,
          justificativa: 'teste',
        }),
        'x',
      ),
    );
    expect((await uma('SELECT situacao FROM lancamento_contabil WHERE id = ?', [r.id]))?.['situacao']).toBe(
      'estornado',
    );
    expect((await porta.lancamento(ctxA, r.id))?.estornadoPor).toBe(est.id);
    const lista = await porta.lancamentos(ctxA, { empresa: estA, competencia: COMPETENCIA }, 1, 50);
    expect(lista.total).toBe(2);
    const razao = await porta.razao(
      ctxA,
      { empresa: estA, conta: '1.1.1', de: `${COMPETENCIA}-01`, ate: `${COMPETENCIA}-31` },
      100,
    );
    expect([razao.totais.debitos, razao.totais.creditos, razao.movimentos.length]).toEqual([15025, 15025, 2]);
    const somas = await porta.somas(ctxA, { empresa: estA, de: null, ate: `${COMPETENCIA}-31` }, 100);
    expect(somas.itens.find((s) => s.conta === '3.1.1')).toMatchObject({ debitos: 15025, creditos: 15025 });
    expect(
      (await porta.movimentoPorCompetencia(ctxA, estA)).find((m) => m.competencia === COMPETENCIA)
        ?.lancamentos,
    ).toBe(2);
    expect((await porta.lancamentos(ctxB, { empresa: estB }, 1, 50)).total).toBe(0);
    expect((await porta.lancamentos(ctxB, { empresa: estA }, 1, 50)).total).toBe(0);
    expect(await porta.lancamento(ctxB, r.id)).toBeNull();
    // Conta que não aceita lançamento manual: recusada no manual.
    await escrever(
      "UPDATE conta_contabil SET aceita_lancamento_manual = FALSE WHERE plano_contas_id = ? AND classificacao = '1.1.1'",
      [plano],
    );
    expect(
      await codigo(
        gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-m', '1.1.1', '3.1.1', 100), 'x')),
      ),
    ).toBe('conta-sem-lancamento-manual');
    await escrever(
      "UPDATE conta_contabil SET aceita_lancamento_manual = TRUE WHERE plano_contas_id = ? AND classificacao = '1.1.1'",
      [plano],
    );
    // Bloqueio diário e período bloqueado: recusados; a observação do período avisa.
    const comp = [estA, `${COMPETENCIA}-01`];
    await escrever(
      `UPDATE periodo_contabil SET bloqueado_ate = '${COMPETENCIA}-12' WHERE estabelecimento_id = ? AND competencia = ?`,
      comp,
    );
    expect(
      await codigo(
        gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-b', '1.1.1', '3.1.1', 100), 'x')),
      ),
    ).toBe('data-bloqueada');
    expect((await porta.periodos(ctxA, estA)).find((p) => p.competencia === COMPETENCIA)?.observacao).toBe(
      'Lançamentos bloqueados até 12/03/2026.',
    );
    await escrever(
      "UPDATE periodo_contabil SET bloqueado_ate = NULL, situacao = 'bloqueado' WHERE estabelecimento_id = ? AND competencia = ?",
      comp,
    );
    expect(
      await codigo(
        gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-b', '1.1.1', '3.1.1', 100), 'x')),
      ),
    ).toBe('periodo-bloqueado');
    await escrever(
      "UPDATE periodo_contabil SET situacao = 'aberto' WHERE estabelecimento_id = ? AND competencia = ?",
      comp,
    );
    expect((await porta.lancamentos(ctxA, { empresa: estA, competencia: COMPETENCIA }, 1, 50)).total).toBe(2);
  });

  it('conciliação: concilia as partidas da conta, recusa o que o domínio recusa e desfaz com justificativa', async () => {
    const pend = await porta.pendentesConciliacao(ctxA, estA, '1.1.1', null, 50);
    expect(pend.length).toBe(2);
    const ids = pend.map((p) => p.id);
    expect(
      await codigo(
        gravar(ctxA, (g) =>
          g.conciliar({
            empresa: estA,
            conta: '1.1.1',
            partidas: ids,
            observacao: null,
            usuario: 'x',
            conferir: () => ['Não fecha.'],
          }),
        ),
      ),
    ).toBe('conciliacao-recusada');
    const r = await gravar(ctxA, (g) =>
      g.conciliar({
        empresa: estA,
        conta: '1.1.1',
        partidas: ids,
        observacao: 'ok',
        usuario: 'x',
        conferir: (a) => (a.length === 2 ? [] : ['falta']),
      }),
    );
    expect(r.valor).toBe(15025);
    expect(
      await contar('SELECT COUNT(*) AS n FROM partida_contabil WHERE conciliacao_conta_contabil_id = ?', [
        r.id,
      ]),
    ).toBe(2);
    expect((await porta.conciliacoes(ctxA, estA, '1.1.1', 10))[0]).toMatchObject({
      id: r.id,
      situacao: 'ativa',
      partidas: 2,
    });
    const d = await gravar(ctxA, (g) =>
      g.desfazerConciliacao({ empresa: estA, id: r.id, justificativa: 'conferência refeita', usuario: 'x' }),
    );
    expect([d.situacao, d.partidas]).toEqual(['desfeita', 0]);
    expect((await porta.pendentesConciliacao(ctxA, estA, '1.1.1', null, 50)).length).toBe(2);
  });

  it('fato: lista, marca a situação só se ainda for a lida e conta no período', async () => {
    const f = await porta.fatos(ctxA, { empresa: estA, competencia: COMPETENCIA }, 1, 20);
    expect(f.total).toBe(1);
    expect(f.itens[0]).toMatchObject({
      idFato: fato,
      tabela: 'conta_hospitalar',
      tipo: 'receitaConta',
      origem: 3,
      valorCentavos: 15025,
      situacao: 'pendente',
    });
    expect(
      await gravar(ctxA, (g) =>
        g.marcarSituacao({
          idFato: fato,
          situacao: 'ignorado',
          motivo: 'teste',
          regraId: null,
          situacaoLida: 'pendente',
        }),
      ),
    ).toBe(true);
    expect(
      await gravar(ctxA, (g) =>
        g.marcarSituacao({
          idFato: fato,
          situacao: 'semRegra',
          motivo: null,
          regraId: null,
          situacaoLida: 'pendente',
        }),
      ),
    ).toBe(false);
    expect(
      await codigo(
        gravar(ctxA, (g) =>
          g.marcarSituacao({ idFato: fato, situacao: 'contabilizado', motivo: null, regraId: null }),
        ),
      ),
    ).toBe('fato-sem-lancamento');
    const row = await uma('SELECT situacao, versao FROM fato_contabil WHERE id = ?', [fato]);
    expect([row?.['situacao'], Number(row?.['versao'])]).toEqual(['ignorado', 2]);
    expect(await porta.fatosDoPeriodo(ctxA, estA, COMPETENCIA)).toEqual({ ignorado: 1 });
    expect((await porta.fontes(ctxA)).find((x) => x.tabela === 'conta_hospitalar')?.fatosGravados).toBe(1);
    const leitura = await porta.paraContabilizar(ctxA, estA, ['ignorado'], COMPETENCIA, 10);
    expect([leitura.candidatos.length, leitura.restam]).toEqual([1, false]);
  });

  it('período: encerra com os números, recusa lançar no encerrado e reabre com justificativa', async () => {
    let lidos: unknown = null;
    const d = await gravar(ctxA, (g) =>
      g.encerrarPeriodo({
        empresa: estA,
        competencia: COMPETENCIA,
        observacao: null,
        usuario: 'x',
        conferir: (x) => {
          lidos = x;
          return [];
        },
      }),
    );
    expect([d.lancamentos, d.debitos, d.creditos]).toEqual([2, 30050, 30050]);
    expect(lidos).not.toBeNull();
    expect((await porta.periodos(ctxA, estA)).find((p) => p.competencia === COMPETENCIA)?.situacao).toBe(
      'encerrado',
    );
    expect(
      await codigo(
        gravar(ctxA, (g) => g.gravarLancamento(lancamento('t0401-f', '1.1.1', '3.1.1', 100), 'x')),
      ),
    ).toBe('periodo-encerrado');
    const antes = await gravar(ctxA, (g) =>
      g.reabrirPeriodo({
        empresa: estA,
        competencia: COMPETENCIA,
        justificativa: 'ajuste de teste',
        usuario: 'x',
        conferir: () => null,
      }),
    );
    expect(antes.situacao).toBe('encerrado');
    const p = await uma(
      "SELECT situacao, justificativa_reabertura, versao FROM periodo_contabil WHERE estabelecimento_id = ? AND competencia = '2026-03-01'",
      [estA],
    );
    expect([p?.['situacao'], p?.['justificativa_reabertura'], Number(p?.['versao'])]).toEqual([
      'aberto',
      'ajuste de teste',
      3,
    ]);
  });

  it('fato contabilizado: o lançamento automático vem na mesma transação; sair de contabilizado exige estornar', async () => {
    const auto = lancamento('t0401-auto', '1.1.1', '3.1.1', 15025, { tipo: 'automatico', fatoId: fato });
    const r = await gravar(ctxA, async (g) => {
      expect(
        await g.marcarSituacao({
          idFato: fato,
          situacao: 'contabilizado',
          motivo: null,
          regraId: null,
          situacaoLida: 'ignorado',
        }),
      ).toBe(true);
      return g.gravarLancamento(auto, 'x');
    });
    const f = await uma(
      'SELECT situacao, lancamento_contabil_id, contabilizado_em FROM fato_contabil WHERE id = ?',
      [fato],
    );
    expect([
      f?.['situacao'],
      Number(f?.['lancamento_contabil_id']),
      f?.['contabilizado_em'] !== null,
    ]).toEqual(['contabilizado', r.id, true]);
    expect(
      await codigo(
        gravar(ctxA, (g) =>
          g.marcarSituacao({
            idFato: fato,
            situacao: 'semRegra',
            motivo: null,
            regraId: null,
            situacaoLida: 'contabilizado',
          }),
        ),
      ),
    ).toBe('fato-com-lancamento');
    expect((await uma('SELECT situacao FROM fato_contabil WHERE id = ?', [fato]))?.['situacao']).toBe(
      'contabilizado',
    );
    await gravar(ctxA, async (g) => {
      await g.marcarSituacao({
        idFato: fato,
        situacao: 'pendente',
        motivo: null,
        regraId: null,
        situacaoLida: 'contabilizado',
      });
      return g.gravarLancamento(
        lancamento('t0401-auto-e', '3.1.1', '1.1.1', 15025, {
          tipo: 'estorno',
          estornaId: r.id,
          justificativa: 'regra trocada',
        }),
        'x',
      );
    });
    expect((await uma('SELECT situacao FROM fato_contabil WHERE id = ?', [fato]))?.['situacao']).toBe(
      'pendente',
    );
  });

  it('apoio: hoje, referenciais da Receita e de-para do estabelecimento', async () => {
    expect(await porta.hoje(ctxA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ref = await porta.referencias(ctxA);
    expect(ref.origens.length).toBeGreaterThan(0);
    expect(Array.isArray(ref.tiposPlanoReferencial)).toBe(true);
    expect(Array.isArray(await porta.dePara(ctxA, estA))).toBe(true);
    expect(await porta.dePara(ctxB, estA)).toEqual([]);
  });

  it('regras: publica a versão (só inclusão), lista com filtro, recusa a versão repetida e outro estabelecimento não vê', async () => {
    const regra = {
      empresa: estA,
      origem: 3,
      tipoFato: 'receitaConta',
      versao: 1,
      nome: 'Receita f2204',
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      prioridade: 100,
      condicoes: [],
      partidas: [
        {
          lado: 'D',
          conta: { modo: 'fixa', conta: '1.1.1' },
          valor: { base: 'valorFato' },
          historico: 'Receita {documento}',
          centroCusto: 'nenhum',
        },
        {
          lado: 'C',
          conta: { modo: 'fixa', conta: '3.1.1' },
          valor: { base: 'valorFato' },
          historico: 'Receita {documento}',
          centroCusto: 'nenhum',
        },
      ],
    };
    const pedido = (versao: number) => ({
      regra: { ...regra, versao } as never,
      conteudo: JSON.stringify({ ...regra, versao }),
      impressao: String(versao).repeat(64).slice(0, 64),
      justificativa: 'Regra sintética do teste',
      usuario: 'teste',
    });
    const r1 = await gravar(ctxA, (g) => g.publicarRegra(pedido(1)));
    expect(r1.versao).toBe(1);
    expect(await codigo(gravar(ctxA, (g) => g.publicarRegra(pedido(1))))).toBe('versao-concorrente');
    await gravar(ctxA, (g) => g.publicarRegra(pedido(2)));
    const lidas = await porta.regras(ctxA, estA, { tipoFato: 'receitaConta' });
    expect(lidas.map((x) => x.regra.versao)).toEqual([1, 2]);
    expect(lidas[0]).toMatchObject({
      id: r1.id,
      impressao: '1'.repeat(64),
      justificativa: 'Regra sintética do teste',
    });
    expect(lidas[0]?.publicadaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await porta.regras(ctxA, estA, { origem: 1 })).toEqual([]);
    expect(await porta.regras(ctxB, estA, {})).toEqual([]);
    expect(await codigo(gravar(ctxB, (g) => g.publicarRegra(pedido(3))))).toBe('outro-estabelecimento');
    expect(
      await contar('SELECT COUNT(*) AS n FROM versao_regra_contabil WHERE estabelecimento_id = ?', [estA]),
    ).toBe(2);
  });

  it('arquivo SPED: sem armazém recusa com 503; com armazém guarda, numera, substitui e lê o conteúdo cifrado', async () => {
    const novo = (substituta: boolean) => ({
      empresa: estA,
      tipo: 'ecd' as const,
      exercicio: 2026,
      leiaute: '9.00',
      substituta,
      nomeArquivo: 'ecd-2026.txt',
      conteudoCifrado: `cifrado-${substituta ? 's' : 'o'}`,
      tamanho: 10,
      linhas: 3,
      hash: 'b'.repeat(64),
      parametros: '{"exercicio":2026}',
      usuario: 'teste',
    });
    expect(await codigo(gravar(ctxA, (g) => g.gravarArquivoSped(novo(false))))).toBe('armazem-indisponivel');
    const objetos = new Map<string, Uint8Array>();
    const comArmazem = new PortaContabilPropria(nucleo, {
      guardar: (k, b) => {
        if (objetos.has(k)) return Promise.reject(new Error('sobrescrita'));
        objetos.set(k, b);
        return Promise.resolve();
      },
      ler: (k) => Promise.resolve(objetos.get(k) ?? null),
    });
    const g2 = <T>(fn: (g: GravadorContabil) => Promise<T>) =>
      comArmazem.gravar(
        ctxA,
        { operacao: 'contabil.teste', pedido: null },
        trilha('arquivo_sped_contabil'),
        fn,
      );
    expect(await codigo(g2((g) => g.gravarArquivoSped(novo(true))))).toBe('sem-arquivo-substituido');
    const a1 = await g2((g) => g.gravarArquivoSped(novo(false)));
    expect(a1).toMatchObject({ numero: 1, substituidos: 0 });
    const a2 = await g2((g) => g.gravarArquivoSped(novo(false)));
    expect(a2).toMatchObject({ numero: 2, substituidos: 1 });
    const lista = await comArmazem.arquivosSped(ctxA, estA, 10);
    expect(lista.map((x) => [x.numero, x.situacao])).toEqual([
      [2, 'gerado'],
      [1, 'substituido'],
    ]);
    expect(lista[0]).toMatchObject({
      leiaute: '9.00',
      linhas: 3,
      hash: 'b'.repeat(64),
      parametros: '{"exercicio":2026}',
    });
    const lido = await comArmazem.conteudoSped(ctxA, estA, a2.id);
    expect(lido?.conteudoCifrado).toBe('cifrado-o');
    expect(await codigo(porta.conteudoSped(ctxA, estA, a2.id))).toBe('armazem-indisponivel');
    expect(await comArmazem.conteudoSped(ctxB, estA, a2.id)).toBeNull();
    const a3 = await g2((g) => g.gravarArquivoSped(novo(true)));
    expect(a3).toMatchObject({ numero: 3, substituidos: 1 });
    expect(objetos.size).toBe(3);
  });

  it('empresa do SPED lida do estabelecimento', async () => {
    expect((await porta.empresaSped(ctxA, estA))?.nome).toBe('Hospital fictício f2204a (teste)');
    expect(await porta.empresaSped(ctxB, estA)).toBeNull();
  });
});
