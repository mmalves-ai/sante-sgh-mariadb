// F8, 07-FIN linhas 68 e 69: contrato de efeito do encontro de contas e da previsão e provisão de pagamentos contra o
// MariaDB real (massa SINTÉTICA "L0207").
// Encontro: o fornecedor da massa também é devedor (cliente financeiro com o mesmo CNPJ). A proposta de quem lança
// grava o cabeçalho (totais, saldo líquido, aguardando aprovação) e os itens com o valor compensado; quem propôs não
// efetiva; outra pessoa efetiva: a parcela a pagar ganha a baixa "encontro_contas" sem conta bancária, a parcela a
// receber tem o valor recebido aumentado, os títulos mudam de situação e o encontro fica efetivado. Parcela já em
// encontro pendente é recusada; cancelar exige motivo e guarda a linha.
// Previsão: mensal com fim gera as ocorrências; realizar pelo título grava a conciliação com a diferença; repetir é
// recusado. Provisão: nasce com saldo; reverter parte com motivo grava o ajuste; liquidar pelo título zera o saldo.
// Correção da revisão: a efetivação passa pela alçada do título a pagar (faixa de duas aprovações com uma só é
// recusada; quem aprovou o título não efetiva); o encontro efetivado se estorna com motivo (baixas estornadas, os dois
// lados voltam, nada se apaga); o título já conciliado e o de outro credor são recusados; a liquidação parcial grava
// diferença zero; a previsão se estende, a ocorrência se cancela e a previsão se encerra, com motivo.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-f8-cp-${randomUUID()}` });
const trilhaDo = (id: number) => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'titulo_pagar',
  entidadeId: id,
  correlacao: null,
});
const HOJE = new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('encontro de contas, previsão e provisão (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let cliente = 0;
  let contaPassivo = 0;
  let naturezaDespesa = 0;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f8-cp' }, (l) => l.consultar(sql, p));
  const executar = (nome: string, entrada: unknown, usuario = m.lanca) => {
    const c = m.ctx(usuario);
    return porta.executar(c, nome, entrada, op(c));
  };
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f8-cp' }, fn) as Promise<T>;
  const resultado = (r: unknown) => (r as { resultado: Record<string, unknown> }).resultado;
  /** Aprovação do título na alçada (pelo primeiro id de parcela, como a tela faz). */
  const aprovarTitulo = (parcela: number, usuario: number) =>
    porta.gravarSgh(op(m.ctx(usuario)), trilhaDo(0), (g) =>
      g.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
  const faixa = (valorDe: number, valorAte: number | null, aprovacoes: 1 | 2) =>
    porta.gravarSgh(op(m.ctx(m.lanca)), trilhaDo(0), (g) =>
      g.salvarFaixa({
        id: null,
        centroCusto: null,
        tipoCredor: null,
        valorDe,
        valorAte,
        aprovacoes,
        permissao: 'financeiro.tituloPagar.aprovar',
        vigenciaInicio: '2000-01-01',
        vigenciaFim: null,
        ativa: true,
        usuario: 'x',
      }),
    );

  /** Um título a receber do cliente financeiro (mesmo CNPJ do fornecedor), com uma parcela. */
  const tituloReceber = (valor: number, documento: string) =>
    escrever<number>(async (e) => {
      const agora = new Date();
      const tipoDoc = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'fatura'",
        [],
      );
      const nat = await e.uma<{ id: number }>(
        "SELECT id FROM natureza_financeira WHERE codigo = '9207.2.1'",
        [],
      );
      const t = await e.inserir(
        `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, cliente_financeiro_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, ?, 'cliente', ?, 'avulso', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.est,
          `${P}-R${documento}`,
          cliente,
          Number(tipoDoc?.id),
          documento,
          HOJE,
          HOJE,
          valor,
          valor,
          Number(nat?.id),
          agora,
        ],
      );
      return e.inserir(
        `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [t, HOJE, HOJE, valor, valor, agora],
      );
    });
  const parcelasPagarDo = async (titulo: number) =>
    (
      await consultar('SELECT id FROM parcela_pagar WHERE titulo_pagar_id = ? ORDER BY sequencia', [titulo])
    ).map((r) => Number(r['id']));

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    // A alçada: até 999,99 uma aprovação; de 1.000 em diante, duas.
    await faixa(0, 999.99, 1);
    await faixa(1000, null, 2);
    ({ cliente, contaPassivo, naturezaDespesa } = await escrever<{
      cliente: number;
      contaPassivo: number;
      naturezaDespesa: number;
    }>(async (e) => {
      const agora = new Date();
      const f = await e.uma<{ cnpj: string }>('SELECT cnpj FROM empresa_fornecedora WHERE id = ?', [
        m.fornecedor,
      ]);
      const c =
        (await e.uma<{ id: number }>('SELECT id FROM cliente_financeiro WHERE cnpj = ?', [f?.cnpj]))?.id ??
        (await e.inserir(
          "INSERT INTO cliente_financeiro (tipo_pessoa, cnpj, nome, criado_em) VALUES ('juridica', ?, 'CLIENTE SINTETICO L0207', ?)",
          [f?.cnpj, agora],
        ));
      let conta = (
        await e.uma<{ id: number }>(
          "SELECT id FROM conta_contabil WHERE ativo = TRUE AND excluido_em IS NULL AND natureza = 'passivo' ORDER BY id LIMIT 1",
          [],
        )
      )?.id;
      if (!conta) {
        if (!(await e.uma("SELECT id FROM plano_contas WHERE codigo = 'L0207-PC'", [])))
          await e.executar(
            "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('L0207-PC', 'PLANO SINTETICO L0207', 'contabil', '9.9.9.999', 4, '2000-01-01', ?)",
            [agora],
          );
        const plano = (
          await e.uma<{ id: number }>("SELECT id FROM plano_contas WHERE codigo = 'L0207-PC'", [])
        )?.id;
        conta = await e.inserir(
          `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza,
             natureza_saldo, tipo, criado_em) VALUES (?, '2.9.9.207', 'L0207P', 'PASSIVO SINTETICO L0207', 4, 'passivo', 'credora', 'analitica', ?)`,
          [Number(plano), agora],
        );
      }
      const nat = await e.uma<{ id: number }>(
        "SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'",
        [],
      );
      return { cliente: Number(c), contaPassivo: Number(conta), naturezaDespesa: Number(nat?.id) };
    }));
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await escrever(async (e) => {
      await e.executar(
        `DELETE c FROM conciliacao_previsao_realizado c JOIN titulo_pagar t ON t.id = c.titulo_pagar_id WHERE t.estabelecimento_id = ?`,
        [m.est],
      );
      await e.executar(
        'DELETE a FROM ajuste_provisao_passivo a JOIN provisao_passivo p ON p.id = a.provisao_passivo_id WHERE p.estabelecimento_id = ?',
        [m.est],
      );
      await e.executar('DELETE FROM provisao_passivo WHERE estabelecimento_id = ?', [m.est]);
      await e.executar(
        'DELETE o FROM parcela_previsao_financeira o JOIN previsao_financeira p ON p.id = o.previsao_financeira_id WHERE p.estabelecimento_id = ?',
        [m.est],
      );
      await e.executar('DELETE FROM previsao_financeira WHERE estabelecimento_id = ?', [m.est]);
      await e.executar(
        'DELETE i FROM encontro_contas_item i JOIN encontro_contas c ON c.id = i.encontro_contas_id WHERE c.estabelecimento_id = ?',
        [m.est],
      );
      await e.executar('DELETE FROM encontro_contas WHERE estabelecimento_id = ?', [m.est]);
    });
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await escrever(async (e) => {
      await e.executar(
        'DELETE c FROM cliente_financeiro c WHERE c.id = ? AND NOT EXISTS (SELECT 1 FROM titulo_receber t WHERE t.cliente_financeiro_id = c.id)',
        [cliente],
      );
      await e.executar(
        "DELETE c FROM conta_contabil c JOIN plano_contas p ON p.id = c.plano_contas_id WHERE p.codigo = 'L0207-PC' AND NOT EXISTS (SELECT 1 FROM provisao_passivo v WHERE v.conta_contabil_id = c.id)",
        [],
      );
      await e.executar(
        "DELETE p FROM plano_contas p WHERE p.codigo = 'L0207-PC' AND NOT EXISTS (SELECT 1 FROM conta_contabil c WHERE c.plano_contas_id = p.id)",
        [],
      );
    });
    await m.nucleo.encerrar();
  });

  it('propõe, recusa o proponente e a parcela repetida, efetiva por outra pessoa e baixa os dois lados', async () => {
    const t = resultado(await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_001, 500, 2)));
    const pagar = await parcelasPagarDo(Number(t['tituloPagar']));
    expect(pagar).toHaveLength(2);
    const receber = await tituloReceber(350, '920869001');
    const proposta = resultado(
      await executar('financeiro.proporEncontroContas', {
        fornecedor: m.fornecedor,
        data: HOJE,
        parcelasPagar: pagar,
        parcelasReceber: [receber],
      }),
    );
    expect(proposta).toMatchObject({ compensado: 350, saldoLiquido: -150, itens: 3 });
    const encontro = Number(proposta['encontro']);
    const [cab] = await consultar(
      'SELECT situacao, total_pagar, total_receber, saldo_liquido, empresa_fornecedora_id, cliente_financeiro_id FROM encontro_contas WHERE id = ?',
      [encontro],
    );
    expect(cab).toMatchObject({
      situacao: 'aguardando_aprovacao',
      empresa_fornecedora_id: m.fornecedor,
      cliente_financeiro_id: cliente,
    });
    expect([
      Number(cab?.['total_pagar']),
      Number(cab?.['total_receber']),
      Number(cab?.['saldo_liquido']),
    ]).toEqual([500, 350, -150]);
    // A mesma parcela noutro encontro enquanto este está pendente: recusa.
    expect(
      await codigoDaGravacao(
        executar('financeiro.proporEncontroContas', {
          fornecedor: m.fornecedor,
          data: HOJE,
          parcelasPagar: [pagar[0]],
          parcelasReceber: [receber],
        }),
      ),
    ).toBe('parcela-em-outro-encontro');
    expect(await codigoDaGravacao(executar('financeiro.efetivarEncontroContas', { encontro }, m.lanca))).toBe(
      'aprovador-igual-proponente',
    );
    // A alçada do título a pagar vale no encontro: sem aprovação não sai; quem aprovou o título não efetiva.
    expect(await codigoDaGravacao(executar('financeiro.efetivarEncontroContas', { encontro }, m.paga))).toBe(
      'sem-aprovacao',
    );
    await aprovarTitulo(pagar[0]!, m.aprova);
    expect(
      await codigoDaGravacao(executar('financeiro.efetivarEncontroContas', { encontro }, m.aprova)),
    ).toBe('segregacao-aprovou-paga');
    const ef = resultado(await executar('financeiro.efetivarEncontroContas', { encontro }, m.paga));
    expect(ef).toMatchObject({ situacao: 'efetivado', itens: 3 });
    const pp = await consultar(
      `SELECT p.saldo, p.valor_pago, p.situacao, b.forma_pagamento, b.conta_bancaria_id, b.valor_pago AS baixa
         FROM parcela_pagar p JOIN baixa_titulo b ON b.parcela_pagar_id = p.id WHERE p.id IN (?, ?) ORDER BY p.id`,
      pagar,
    );
    expect(
      pp.map((r) => [Number(r['saldo']), r['situacao'], r['forma_pagamento'], r['conta_bancaria_id']]),
    ).toEqual([
      [0, 'paga', 'encontro_contas', null],
      [150, 'parcial', 'encontro_contas', null],
    ]);
    const [pr] = await consultar(
      `SELECT p.saldo, p.situacao, t.situacao AS titulo, t.valor_recebido FROM parcela_receber p
         JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE p.id = ?`,
      [receber],
    );
    expect([Number(pr?.['saldo']), pr?.['situacao'], pr?.['titulo'], Number(pr?.['valor_recebido'])]).toEqual(
      [0, 'recebida', 'recebido', 350],
    );
    const [tp] = await consultar('SELECT situacao FROM titulo_pagar WHERE id = ?', [
      Number(t['tituloPagar']),
    ]);
    expect(tp?.['situacao']).toBe('pago_parcial');
    const [fim] = await consultar(
      'SELECT situacao, aprovado_por_usuario_id, efetivado_em IS NOT NULL AS ok, (SELECT COUNT(*) FROM encontro_contas_item WHERE encontro_contas_id = ? AND baixa_titulo_id IS NOT NULL) AS baixas FROM encontro_contas WHERE id = ?',
      [encontro, encontro],
    );
    expect([
      fim?.['situacao'],
      Number(fim?.['aprovado_por_usuario_id']),
      Number(fim?.['ok']),
      Number(fim?.['baixas']),
    ]).toEqual(['efetivado', m.paga, 1, 2]);
    // Efetivado não se cancela.
    expect(
      await codigoDaGravacao(
        executar('financeiro.cancelarEncontroContas', { encontro, motivo: 'erro de digitação' }),
      ),
    ).toBe('encontro-fechado');
    // Estorno do efetivado, com motivo: as baixas ficam estornadas, os dois lados voltam, nada se apaga.
    const est = resultado(
      await executar(
        'financeiro.estornarEncontroContas',
        { encontro, motivo: 'valor do parceiro contestado' },
        m.aprova,
      ),
    );
    expect(est).toMatchObject({ situacao: 'cancelado', estornado: true });
    const bx = await consultar(
      `SELECT p.saldo, p.valor_pago, p.situacao, b.situacao AS baixa, b.motivo_estorno IS NOT NULL AS motivo
         FROM parcela_pagar p JOIN baixa_titulo b ON b.parcela_pagar_id = p.id WHERE p.id IN (?, ?) ORDER BY p.id`,
      pagar,
    );
    expect(
      bx.map((r) => [
        Number(r['saldo']),
        Number(r['valor_pago']),
        r['situacao'],
        r['baixa'],
        Number(r['motivo']),
      ]),
    ).toEqual([
      [250, 0, 'aberta', 'estornada', 1],
      [250, 0, 'aberta', 'estornada', 1],
    ]);
    const [rv] = await consultar(
      `SELECT p.saldo, p.situacao, t.situacao AS titulo, t.valor_recebido FROM parcela_receber p
         JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE p.id = ?`,
      [receber],
    );
    expect([Number(rv?.['saldo']), rv?.['situacao'], rv?.['titulo'], Number(rv?.['valor_recebido'])]).toEqual(
      [350, 'aberta', 'aberto', 0],
    );
    const [tp2] = await consultar('SELECT situacao FROM titulo_pagar WHERE id = ?', [
      Number(t['tituloPagar']),
    ]);
    expect(tp2?.['situacao']).toBe('aberto');
    const [ce] = await consultar(
      'SELECT situacao, motivo, efetivado_em IS NOT NULL AS ok, (SELECT COUNT(*) FROM encontro_contas_item WHERE encontro_contas_id = ?) AS itens FROM encontro_contas WHERE id = ?',
      [encontro, encontro],
    );
    expect([ce?.['situacao'], ce?.['motivo'], Number(ce?.['ok']), Number(ce?.['itens'])]).toEqual([
      'cancelado',
      'Estorno: valor do parceiro contestado',
      1,
      3,
    ]);
    expect(
      await codigoDaGravacao(
        executar('financeiro.estornarEncontroContas', { encontro, motivo: 'de novo por engano' }, m.aprova),
      ),
    ).toBe('encontro-nao-efetivado');
  });

  it('título da faixa de duas aprovações com uma só: a efetivação do encontro é recusada e nada muda', async () => {
    const t = resultado(await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_005, 2_000)));
    const pagar = await parcelasPagarDo(Number(t['tituloPagar']));
    const receber = await tituloReceber(500, '920869005');
    const encontro = Number(
      resultado(
        await executar('financeiro.proporEncontroContas', {
          fornecedor: m.fornecedor,
          data: HOJE,
          parcelasPagar: pagar,
          parcelasReceber: [receber],
        }),
      )['encontro'],
    );
    await aprovarTitulo(pagar[0]!, m.aprova);
    expect(await codigoDaGravacao(executar('financeiro.efetivarEncontroContas', { encontro }, m.paga))).toBe(
      'sem-aprovacao',
    );
    const [c] = await consultar(
      'SELECT e.situacao, (SELECT COUNT(*) FROM baixa_titulo b WHERE b.parcela_pagar_id = ?) AS baixas FROM encontro_contas e WHERE e.id = ?',
      [pagar[0], encontro],
    );
    expect([c?.['situacao'], Number(c?.['baixas'])]).toEqual(['aguardando_aprovacao', 0]);
  });

  it('cancela a proposta pendente com motivo, a linha fica, e a parcela volta a poder entrar', async () => {
    const t = resultado(await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_002, 80)));
    const pagar = await parcelasPagarDo(Number(t['tituloPagar']));
    const receber = await tituloReceber(100, '920869002');
    const ent = { fornecedor: m.fornecedor, data: HOJE, parcelasPagar: pagar, parcelasReceber: [receber] };
    const encontro = Number(resultado(await executar('financeiro.proporEncontroContas', ent))['encontro']);
    await executar('financeiro.cancelarEncontroContas', {
      encontro,
      motivo: 'parceiro pediu pagamento à parte',
    });
    const [c] = await consultar('SELECT situacao, motivo FROM encontro_contas WHERE id = ?', [encontro]);
    expect(c).toMatchObject({ situacao: 'cancelado', motivo: 'parceiro pediu pagamento à parte' });
    const de_novo = resultado(await executar('financeiro.proporEncontroContas', ent));
    expect(de_novo).toMatchObject({ compensado: 80, saldoLiquido: 20 });
  });

  it('previsão mensal: gera as ocorrências, realiza pelo título com a diferença e recusa realizar de novo', async () => {
    const r = resultado(
      await executar('financeiro.criarPrevisaoFinanceira', {
        descricao: 'ALUGUEL SINTETICO L0207',
        tipo: 'despesa',
        natureza: naturezaDespesa,
        fornecedor: m.fornecedor,
        valor: 1000,
        periodicidade: 'mensal',
        diaVencimento: 10,
        dataInicio: '2026-11-01',
        dataFim: '2027-01-31',
        ajuste: 'postergar',
      }),
    );
    expect(r).toMatchObject({ ocorrencias: 3, total: 3000 });
    const oc = await consultar(
      'SELECT id, competencia, data_esperada, situacao FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? ORDER BY sequencia',
      [Number(r['previsao'])],
    );
    expect(
      oc.map((o) =>
        String(
          o['data_esperada'] instanceof Date
            ? (o['data_esperada'] as Date).toISOString().slice(0, 10)
            : o['data_esperada'],
        ),
      ),
    ).toEqual(['2026-11-10', '2026-12-10', '2027-01-11']);
    const t = resultado(await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_003, 1_050)));
    const ocorrencia = Number(oc[0]?.['id']);
    const real = resultado(
      await executar('financeiro.realizarPrevisaoFinanceira', {
        ocorrencia,
        tituloPagar: Number(t['tituloPagar']),
      }),
    );
    expect(real['diferenca']).toBe(50);
    const [c] = await consultar(
      `SELECT o.situacao, c.valor_previsto, c.valor_realizado, c.diferenca, c.usuario_id FROM parcela_previsao_financeira o
         JOIN conciliacao_previsao_realizado c ON c.parcela_previsao_financeira_id = o.id WHERE o.id = ?`,
      [ocorrencia],
    );
    expect([
      c?.['situacao'],
      Number(c?.['valor_previsto']),
      Number(c?.['valor_realizado']),
      Number(c?.['diferenca']),
      Number(c?.['usuario_id']),
    ]).toEqual(['realizada', 1000, 1050, 50, m.lanca]);
    expect(
      await codigoDaGravacao(
        executar('financeiro.realizarPrevisaoFinanceira', {
          ocorrencia,
          tituloPagar: Number(t['tituloPagar']),
        }),
      ),
    ).toBe('previsao-fechada');
    // O mesmo título não realiza outra ocorrência (o realizado contaria duas vezes).
    expect(
      await codigoDaGravacao(
        executar('financeiro.realizarPrevisaoFinanceira', {
          ocorrencia: Number(oc[1]?.['id']),
          tituloPagar: Number(t['tituloPagar']),
        }),
      ),
    ).toBe('titulo-ja-conciliado');
    // Cancelar a ocorrência que não vai acontecer: com motivo, a linha fica.
    await executar('financeiro.cancelarOcorrenciaPrevisao', {
      ocorrencia: Number(oc[2]?.['id']),
      motivo: 'contrato reajustado em janeiro',
    });
    const [can] = await consultar('SELECT situacao FROM parcela_previsao_financeira WHERE id = ?', [
      Number(oc[2]?.['id']),
    ]);
    expect(can?.['situacao']).toBe('cancelada');
    // A previsão com fim já gerado todo não se estende.
    expect(
      await codigoDaGravacao(
        executar('financeiro.estenderPrevisaoFinanceira', { previsao: Number(r['previsao']) }),
      ),
    ).toBe('sem-ocorrencia-nova');
  });

  it('previsão sem fim: 12 meses, estende mais 12 continuando a sequência, encerra cancelando as abertas adiante', async () => {
    const r = resultado(
      await executar('financeiro.criarPrevisaoFinanceira', {
        descricao: 'CONTRATO SINTETICO L0207',
        tipo: 'despesa',
        natureza: naturezaDespesa,
        valor: 300,
        periodicidade: 'mensal',
        diaVencimento: 5,
        dataInicio: '2026-12-01',
        ajuste: 'manter',
      }),
    );
    expect(r).toMatchObject({ ocorrencias: 12 });
    const previsao = Number(r['previsao']);
    const x = resultado(await executar('financeiro.estenderPrevisaoFinanceira', { previsao }));
    expect(x).toMatchObject({ ocorrencias: 12, ate: '2028-11-05' });
    const [q] = await consultar(
      'SELECT COUNT(*) AS n, MAX(sequencia) AS s FROM parcela_previsao_financeira WHERE previsao_financeira_id = ?',
      [previsao],
    );
    expect([Number(q?.['n']), Number(q?.['s'])]).toEqual([24, 24]);
    const enc = resultado(
      await executar('financeiro.encerrarPrevisaoFinanceira', {
        previsao,
        data: '2027-06-30',
        motivo: 'contrato rescindido',
      }),
    );
    expect(enc).toMatchObject({ canceladas: 17 });
    const [pv] = await consultar(
      "SELECT p.ativa, p.data_fim, (SELECT COUNT(*) FROM parcela_previsao_financeira o WHERE o.previsao_financeira_id = p.id AND o.situacao = 'aberta') AS abertas FROM previsao_financeira p WHERE p.id = ?",
      [previsao],
    );
    expect([Number(pv?.['ativa']), Number(pv?.['abertas'])]).toEqual([0, 7]);
    expect(await codigoDaGravacao(executar('financeiro.estenderPrevisaoFinanceira', { previsao }))).toBe(
      'previsao-encerrada',
    );
  });

  it('provisão de honorário: reverte parte com motivo (ajuste gravado) e liquida pelo título com conciliação', async () => {
    const competencia = `${HOJE.slice(0, 7)}-01`;
    expect(
      await codigoDaGravacao(
        executar('financeiro.provisionarPassivo', {
          tipo: 'honorario_medico',
          competencia,
          descricao: 'HONORARIO SINTETICO L0207',
          contaContabil: contaPassivo,
          valor: 5000,
        }),
      ),
    ).toBe('profissional-obrigatorio');
    const prof = (
      await consultar(
        "SELECT id FROM profissional WHERE excluido_em IS NULL AND situacao <> 'inativo' ORDER BY id DESC LIMIT 1",
        [],
      )
    )[0]?.['id'];
    const r = resultado(
      await executar('financeiro.provisionarPassivo', {
        tipo: 'honorario_medico',
        competencia,
        descricao: 'HONORARIO SINTETICO L0207',
        contaContabil: contaPassivo,
        profissional: Number(prof),
        valor: 5000,
      }),
    );
    const provisao = Number(r['provisao']);
    expect(
      await codigoDaGravacao(
        executar(
          'financeiro.reverterProvisaoPassivo',
          { provisao, valor: 6000, motivo: 'glosa da conta', data: HOJE },
          m.aprova,
        ),
      ),
    ).toBe('valor-acima-do-saldo');
    await executar(
      'financeiro.reverterProvisaoPassivo',
      { provisao, valor: 1000, motivo: 'glosa parcial da conta', data: HOJE },
      m.aprova,
    );
    const [a] = await consultar(
      'SELECT a.tipo, a.valor, a.motivo, p.saldo, p.situacao, p.valor_revertido FROM ajuste_provisao_passivo a JOIN provisao_passivo p ON p.id = a.provisao_passivo_id WHERE p.id = ?',
      [provisao],
    );
    expect([a?.['tipo'], Number(a?.['valor']), Number(a?.['saldo']), a?.['situacao']]).toEqual([
      'reversao_parcial',
      1000,
      4000,
      'parcial',
    ]);
    // Título de outro credor (o fornecedor) não liquida o honorário do profissional.
    const outro = resultado(
      await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_004, 4_000)),
    );
    expect(
      await codigoDaGravacao(
        executar('financeiro.liquidarProvisaoPassivo', {
          provisao,
          tituloPagar: Number(outro['tituloPagar']),
        }),
      ),
    ).toBe('credor-diferente');
    // Provisão de tributo do fornecedor (4.000), liquidada por dois títulos dele: parcial e depois acima do saldo.
    const provisao2 = Number(
      resultado(
        await executar('financeiro.provisionarPassivo', {
          tipo: 'tributo',
          competencia,
          descricao: 'TRIBUTO SINTETICO L0207',
          contaContabil: contaPassivo,
          fornecedor: m.fornecedor,
          valor: 4000,
        }),
      )['provisao'],
    );
    const doForn = async (documento: number, v: number) =>
      resultado(await executar('financeiro.criarTituloPagar', tituloDaMassa(m, documento, v)));
    // Título menor que o saldo: parcial, diferença zero, previsto = consumido.
    const t1 = await doForn(920_868_006, 1_500);
    const l1 = resultado(
      await executar('financeiro.liquidarProvisaoPassivo', {
        provisao: provisao2,
        tituloPagar: Number(t1['tituloPagar']),
      }),
    );
    expect(l1).toMatchObject({ saldo: 2500, situacao: 'parcial', diferenca: 0 });
    // Título maior que o saldo: fecha, diferença = realizado − saldo.
    const t2 = await doForn(920_868_007, 3_000);
    const l2 = resultado(
      await executar('financeiro.liquidarProvisaoPassivo', {
        provisao: provisao2,
        tituloPagar: Number(t2['tituloPagar']),
      }),
    );
    expect(l2).toMatchObject({ saldo: 0, situacao: 'liquidada', diferenca: 500 });
    const linhas = await consultar(
      'SELECT p.saldo, p.valor_baixado, p.titulo_pagar_id, c.titulo_pagar_id AS titulo, c.valor_previsto, c.valor_realizado, c.diferenca FROM provisao_passivo p JOIN conciliacao_previsao_realizado c ON c.provisao_passivo_id = p.id WHERE p.id = ? ORDER BY c.id',
      [provisao2],
    );
    expect(
      linhas.map((x) => [
        Number(x['saldo']),
        Number(x['valor_baixado']),
        Number(x['titulo_pagar_id']),
        Number(x['titulo']),
        Number(x['valor_previsto']),
        Number(x['valor_realizado']),
        Number(x['diferenca']),
      ]),
    ).toEqual([
      [0, 4000, Number(t1['tituloPagar']), Number(t1['tituloPagar']), 1500, 1500, 0],
      [0, 4000, Number(t1['tituloPagar']), Number(t2['tituloPagar']), 2500, 3000, 500],
    ]);
  });
});
