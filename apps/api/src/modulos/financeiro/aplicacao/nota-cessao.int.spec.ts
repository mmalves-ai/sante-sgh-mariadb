// F8, 07-FIN linhas 70 e 79: contrato de efeito da nota de crédito e de débito com tributos e do portador com desconto e
// cessão de recebíveis contra o MariaDB real (massa SINTÉTICA "L0207").
// Nota: a recebida de crédito do fornecedor abate a parcela a pagar (desconto na parcela e no título, líquido menor),
// grava os tributos (destacado soma ao total, retido reduz o ajuste) e fica aplicada; a que abate mais que o saldo é
// recusada sem gravar nada; a de débito emitida ao cliente acresce a parcela a receber; a de crédito igual ao saldo
// quita a parcela e o título; cancelar exige motivo, desfaz o ajuste e guarda a nota; outro estabelecimento não vê a
// parcela.
// Cessão: portador com condição por vigência; cessão sem coobrigação tira a parcela da carteira no ato (recebida, com
// o portador); desconto com coobrigação deixa a parcela em aberto sob o portador até o sacado pagar (quita e encerra a
// operação) ou o hospital recomprar (volta à carteira); cancelar a operação sem desfecho devolve as parcelas.
// Dinheiro: a conta recebe a face e paga deságio, tarifas e IOF (tipos próprios); a baixa da parcela pela cessão é um
// recebimento de meio "cessao"; a recompra debita a conta; o cancelamento estorna os lançamentos e o recebimento.
// Nota sobre parcela cedida é recusada; período fechado recusa nota e cessão sem gravar.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cessaoDoTitulo,
  OPERACOES_NOTA_CESSAO,
  operacoesCessao,
  portadoresDoEstabelecimento,
} from '../nota-cessao-propria.js';
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

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-f8-nc-${randomUUID()}` });
const HOJE = new Date().toISOString().slice(0, 10);
const daqui = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('nota de crédito e débito, portador e cessão (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let cliente = 0;
  let pessoa = 0;
  let motivoCredito = 0;
  let motivoDebito = 0;
  let motivoCancel = 0;
  let tributoA = 0;
  let tributoB = 0;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f8-nc' }, (l) => l.consultar(sql, p));
  const um = async (sql: string, p: unknown[]) => (await consultar(sql, p))[0] ?? {};
  const executar = (nome: keyof typeof OPERACOES_NOTA_CESSAO, entrada: unknown, est?: number) => {
    const c = m.ctx(m.lanca, est);
    return m.nucleo
      .criarExecutor()
      .executar(OPERACOES_NOTA_CESSAO[nome] as never, CLIENTE, entrada, op(c))
      .then((r) => r.resultado as Record<string, unknown>);
  };
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f8-nc' }, fn) as Promise<T>;

  const limparProprio = () =>
    escrever(async (e) => {
      const q = [m.est, m.outroEst];
      await e.executar('DELETE FROM periodo_financeiro WHERE estabelecimento_id IN (?, ?)', q);
      await e.executar(
        'UPDATE movimento_bancario SET estornado_movimento_bancario_id = NULL WHERE estabelecimento_id IN (?, ?)',
        q,
      );
      await e.executar(
        'DELETE t FROM tributo_nota_credito_debito t JOIN nota_credito_debito n ON n.id = t.nota_credito_debito_id WHERE n.estabelecimento_id IN (?, ?)',
        q,
      );
      await e.executar('DELETE FROM nota_credito_debito WHERE estabelecimento_id IN (?, ?)', q);
      await e.executar(
        'DELETE i FROM operacao_cessao_recebivel_item i JOIN operacao_cessao_recebivel o ON o.id = i.operacao_cessao_recebivel_id WHERE o.estabelecimento_id IN (?, ?)',
        q,
      );
      await e.executar('DELETE FROM operacao_cessao_recebivel WHERE estabelecimento_id IN (?, ?)', q);
      await e.executar(
        'UPDATE parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id SET p.portador_titulo_id = NULL WHERE t.estabelecimento_id IN (?, ?)',
        q,
      );
      await e.executar(
        'DELETE c FROM condicao_portador c JOIN portador_titulo p ON p.id = c.portador_titulo_id WHERE p.estabelecimento_id IN (?, ?)',
        q,
      );
      await e.executar('DELETE FROM portador_titulo WHERE estabelecimento_id IN (?, ?)', q);
    });

  /** Parcela a pagar de um título do fornecedor da massa. */
  const parcelaPagar = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, documento, valor), op(c));
    const r = await um(
      `SELECT p.id FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
        WHERE t.estabelecimento_id = ? AND t.numero_documento = ? ORDER BY p.id DESC LIMIT 1`,
      [m.est, String(documento)],
    );
    return Number(r['id']);
  };
  /** Parcela a receber do cliente financeiro sintético. */
  const parcelaReceber = (documento: string, valor: number, vencimento = HOJE) =>
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
          `${P}-NC${documento}`,
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
        [t, vencimento, vencimento, valor, valor, agora],
      );
    });

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    ({ cliente, pessoa } = await escrever<{ cliente: number; pessoa: number }>(async (e) => {
      const f = await e.uma<{ cnpj: string; pessoa_juridica_id: number }>(
        'SELECT cnpj, pessoa_juridica_id FROM empresa_fornecedora WHERE id = ?',
        [m.fornecedor],
      );
      const c =
        (await e.uma<{ id: number }>('SELECT id FROM cliente_financeiro WHERE cnpj = ?', [f?.cnpj]))?.id ??
        (await e.inserir(
          "INSERT INTO cliente_financeiro (tipo_pessoa, cnpj, nome, criado_em) VALUES ('juridica', ?, 'CLIENTE SINTETICO L0207', ?)",
          [f?.cnpj, new Date()],
        ));
      const pj =
        f?.pessoa_juridica_id ??
        (await e.uma<{ id: number }>('SELECT id FROM pessoa_juridica ORDER BY id LIMIT 1', []))?.id;
      return { cliente: Number(c), pessoa: Number(pj) };
    }));
    motivoCredito = Number(
      (await um("SELECT id FROM motivo_nota_credito_debito WHERE codigo = 'bonificacao'", []))['id'],
    );
    motivoDebito = Number(
      (await um("SELECT id FROM motivo_nota_credito_debito WHERE codigo = 'multa_contratual'", []))['id'],
    );
    motivoCancel = Number(
      (await um("SELECT id FROM motivo_cancelamento_documento_fiscal WHERE codigo = 'erro_emissao'", []))[
        'id'
      ],
    );
    const trib = await consultar('SELECT id FROM tributo ORDER BY id LIMIT 2', []);
    tributoA = Number(trib[0]?.['id']);
    tributoB = Number(trib[1]?.['id']);
  });

  afterAll(async () => {
    if (!m) return;
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.encerrar?.();
  });

  it('nota de crédito do fornecedor com tributos abate a parcela e o título; cancelar desfaz e guarda a nota', async () => {
    const parcela = await parcelaPagar(70001, 1000);
    const antes = await um(
      'SELECT t.id, t.valor_liquido, t.valor_desconto FROM titulo_pagar t JOIN parcela_pagar p ON p.titulo_pagar_id = t.id WHERE p.id = ?',
      [parcela],
    );
    // Recusa: abate mais que o saldo; nada é gravado.
    expect(
      await codigoDaGravacao(
        executar('emitirNota', {
          lado: 'pagar',
          parcela,
          direcao: 'recebida',
          natureza: 'credito',
          motivo: motivoCredito,
          dataEmissao: HOJE,
          valorItens: 1500,
        }),
      ),
    ).toBe('nota-maior-que-saldo');
    expect(
      (await consultar('SELECT id FROM nota_credito_debito WHERE estabelecimento_id = ?', [m.est])).length,
    ).toBe(0);

    const r = await executar('emitirNota', {
      lado: 'pagar',
      parcela,
      direcao: 'recebida',
      natureza: 'credito',
      motivo: motivoCredito,
      dataEmissao: HOJE,
      valorItens: 200,
      valorDesconto: 20,
      tributos: [
        { tributo: tributoA, base: 180, aliquota: 5, retido: false },
        { tributo: tributoB, base: 180, aliquota: 1.5, retido: true },
      ],
    });
    // total = 200 - 20 + 9 = 189; ajuste = 189 - 2,70 = 186,30
    expect(r).toMatchObject({ efeito: 'abate', valorTotal: 189, valorAjuste: 186.3, situacao: 'aplicada' });
    const n = await um('SELECT * FROM nota_credito_debito WHERE id = ?', [r['nota']]);
    expect(n).toMatchObject({
      situacao: 'aplicada',
      efeito: 'abate',
      direcao: 'recebida',
      natureza: 'credito',
    });
    expect(Number(n['valor_impostos'])).toBe(9);
    expect(Number(n['parcela_pagar_id'])).toBe(parcela);
    expect(Number(n['titulo_pagar_id'])).toBe(Number(antes['id']));
    expect(Number(n['empresa_fornecedora_id'])).toBe(m.fornecedor);
    expect(n['aplicada_em']).not.toBeNull();
    const t = await consultar(
      'SELECT sequencia, retido, valor_tributo FROM tributo_nota_credito_debito WHERE nota_credito_debito_id = ? ORDER BY sequencia',
      [r['nota']],
    );
    expect(t.map((x) => [Number(x['sequencia']), Number(x['retido']), Number(x['valor_tributo'])])).toEqual([
      [1, 0, 9],
      [2, 1, 2.7],
    ]);
    const p = await um('SELECT saldo, valor_desconto, situacao FROM parcela_pagar WHERE id = ?', [parcela]);
    expect([Number(p['saldo']), Number(p['valor_desconto']), p['situacao']]).toEqual([
      813.7,
      186.3,
      'aberta',
    ]);
    const tt = await um('SELECT valor_liquido, valor_desconto FROM titulo_pagar WHERE id = ?', [antes['id']]);
    expect(Number(tt['valor_liquido'])).toBeCloseTo(Number(antes['valor_liquido']) - 186.3, 2);
    expect(Number(tt['valor_desconto'])).toBeCloseTo(Number(antes['valor_desconto']) + 186.3, 2);

    // Cancelar: motivo obrigatório; desfaz o ajuste e a nota fica, cancelada.
    const c = await executar('cancelarNota', {
      nota: r['nota'],
      motivoCancelamento: motivoCancel,
      observacao: 'erro de valor',
    });
    expect(c).toMatchObject({ situacao: 'cancelada', desfeito: true });
    const p2 = await um('SELECT saldo, valor_desconto FROM parcela_pagar WHERE id = ?', [parcela]);
    expect([Number(p2['saldo']), Number(p2['valor_desconto'])]).toEqual([1000, 0]);
    const n2 = await um(
      'SELECT situacao, cancelada_em, motivo_cancelamento_documento_fiscal_id FROM nota_credito_debito WHERE id = ?',
      [r['nota']],
    );
    expect(n2['situacao']).toBe('cancelada');
    expect(Number(n2['motivo_cancelamento_documento_fiscal_id'])).toBe(motivoCancel);
    expect(
      await codigoDaGravacao(
        executar('cancelarNota', {
          nota: r['nota'],
          motivoCancelamento: motivoCancel,
          observacao: 'de novo aqui',
        }),
      ),
    ).toBe('nota-cancelada');
    // Outro estabelecimento não alcança a parcela.
    expect(
      await codigoDaGravacao(
        executar(
          'emitirNota',
          {
            lado: 'pagar',
            parcela,
            direcao: 'recebida',
            natureza: 'credito',
            motivo: motivoCredito,
            dataEmissao: HOJE,
            valorItens: 10,
          },
          m.outroEst,
        ),
      ),
    ).toBe('parcela-inexistente');
  });

  it('nota de débito ao cliente acresce a parcela a receber; a de crédito igual ao saldo quita parcela e título', async () => {
    const parcela = await parcelaReceber('70002', 500);
    const r = await executar('emitirNota', {
      lado: 'receber',
      parcela,
      direcao: 'emitida',
      natureza: 'debito',
      motivo: motivoDebito,
      dataEmissao: HOJE,
      valorItens: 50,
    });
    expect(r).toMatchObject({ efeito: 'acresce', valorAjuste: 50 });
    const p = await um('SELECT saldo, valor_acrescimo, titulo_receber_id FROM parcela_receber WHERE id = ?', [
      parcela,
    ]);
    expect([Number(p['saldo']), Number(p['valor_acrescimo'])]).toEqual([550, 50]);
    const t = await um('SELECT valor_liquido, valor_acrescimo, situacao FROM titulo_receber WHERE id = ?', [
      p['titulo_receber_id'],
    ]);
    expect([Number(t['valor_liquido']), Number(t['valor_acrescimo']), t['situacao']]).toEqual([
      550,
      50,
      'aberto',
    ]);
    // Motivo só de débito numa nota de crédito: recusado.
    expect(
      await codigoDaGravacao(
        executar('emitirNota', {
          lado: 'receber',
          parcela,
          direcao: 'emitida',
          natureza: 'credito',
          motivo: motivoDebito,
          dataEmissao: HOJE,
          valorItens: 10,
        }),
      ),
    ).toBe('motivo-natureza');
    // Crédito emitido ao cliente igual ao saldo: a parcela e o título ficam quitados.
    await executar('emitirNota', {
      lado: 'receber',
      parcela,
      direcao: 'emitida',
      natureza: 'credito',
      motivo: motivoCredito,
      dataEmissao: HOJE,
      valorItens: 550,
    });
    const p2 = await um('SELECT saldo, situacao, quitada_em FROM parcela_receber WHERE id = ?', [parcela]);
    expect([Number(p2['saldo']), p2['situacao']]).toEqual([0, 'recebida']);
    expect(p2['quitada_em']).not.toBeNull();
    const t2 = await um('SELECT situacao, valor_liquido FROM titulo_receber WHERE id = ?', [
      p['titulo_receber_id'],
    ]);
    expect([t2['situacao'], Number(t2['valor_liquido'])]).toEqual(['recebido', 0]);
  });

  it('portador, cessão sem coobrigação, desconto com coobrigação (liquidar e recomprar) e cancelamento', async () => {
    // Portadores: cessionário e banco do desconto, com condição vigente (taxa 3% ao mês, limite 5.000).
    const cess = await executar('manterPortador', {
      codigo: 'CESS70',
      descricao: 'Cessionário sintético',
      tipo: 'cessao',
      pessoaJuridica: pessoa,
      contaBancaria: m.contaA,
      taxaDesconto: 3,
      limiteCredito: 5000,
      vigenciaInicio: '2026-01-01',
    });
    const desc = await executar('manterPortador', {
      codigo: 'DESC70',
      descricao: 'Banco do desconto sintético',
      tipo: 'cobranca_descontada',
      contaBancaria: m.contaA,
      taxaDesconto: 2,
      vigenciaInicio: '2026-01-01',
    });
    expect(
      await codigoDaGravacao(
        executar('manterPortador', {
          codigo: 'X',
          descricao: 'Banco sem conta',
          tipo: 'cobranca_simples',
          vigenciaInicio: HOJE,
        }),
      ),
    ).toBe('conta-obrigatoria');
    const cond = await um(
      'SELECT taxa_desconto, limite_credito FROM condicao_portador WHERE portador_titulo_id = ?',
      [cess['portador']],
    );
    expect([Number(cond['taxa_desconto']), Number(cond['limite_credito'])]).toEqual([3, 5000]);

    // Cessão sem coobrigação: a parcela sai da carteira no ato.
    const p1 = await parcelaReceber('70003', 1000, daqui(30));
    const o1 = await executar('contratarCessao', {
      portador: cess['portador'],
      tipo: 'cessao',
      comCoobrigacao: false,
      dataOperacao: HOJE,
      valorTarifas: 10,
      parcelas: [p1],
    });
    expect(o1).toMatchObject({ valorFace: 1000, valorDesagio: 30, valorLiquido: 960 });
    const op1 = await um(
      'SELECT situacao, portador_titulo_id, valor_liquido, com_coobrigacao FROM operacao_cessao_recebivel WHERE id = ?',
      [o1['operacao']],
    );
    expect([
      op1['situacao'],
      Number(op1['portador_titulo_id']),
      Number(op1['valor_liquido']),
      Number(op1['com_coobrigacao']),
    ]).toEqual(['contratada', Number(cess['portador']), 960, 0]);
    const pr1 = await um('SELECT saldo, situacao, portador_titulo_id FROM parcela_receber WHERE id = ?', [
      p1,
    ]);
    expect([Number(pr1['saldo']), pr1['situacao'], Number(pr1['portador_titulo_id'])]).toEqual([
      0,
      'recebida',
      Number(cess['portador']),
    ]);
    // Recusas: a mesma parcela de novo; o limite do portador.
    expect(
      await codigoDaGravacao(
        executar('contratarCessao', {
          portador: cess['portador'],
          tipo: 'cessao',
          comCoobrigacao: false,
          dataOperacao: HOJE,
          parcelas: [p1],
        }),
      ),
    ).toBe('parcela-ja-cedida');
    // Dinheiro da cessão: face em crédito, deságio e tarifas em débito (soma = líquido); a baixa é da cessão.
    const doc1 = `CES-${String(o1['numero'])}`;
    const movsDe = (doc: string) =>
      consultar(
        `SELECT m.natureza, m.valor, m.situacao, m.tipo_origem, t.codigo FROM movimento_bancario m
           JOIN tipo_lancamento_bancario t ON t.id = m.tipo_lancamento_bancario_id
          WHERE m.estabelecimento_id = ? AND m.numero_documento = ? ORDER BY m.id`,
        [m.est, doc],
      ).then((r) =>
        r.map((x) => [x['codigo'], x['natureza'], Number(x['valor']), x['situacao'], x['tipo_origem']]),
      );
    expect(await movsDe(doc1)).toEqual([
      ['cessao_face', 'credito', 1000, 'ativo', 'cessao_recebivel'],
      ['cessao_desagio', 'debito', 30, 'ativo', 'cessao_recebivel'],
      ['cessao_tarifas', 'debito', 10, 'ativo', 'cessao_recebivel'],
    ]);
    const opMov = await um(
      `SELECT o.movimento_bancario_id AS mov, m.valor FROM operacao_cessao_recebivel o
         JOIN movimento_bancario m ON m.id = o.movimento_bancario_id WHERE o.id = ?`,
      [o1['operacao']],
    );
    expect(Number(opMov['valor'])).toBe(1000);
    const rec1 = await um(
      'SELECT meio_baixa, valor_recebido, situacao, movimento_bancario_id FROM recebimento WHERE parcela_receber_id = ?',
      [p1],
    );
    expect([
      rec1['meio_baixa'],
      Number(rec1['valor_recebido']),
      rec1['situacao'],
      Number(rec1['movimento_bancario_id']),
    ]).toEqual(['cessao', 1000, 'efetivado', Number(opMov['mov'])]);
    const grande = await parcelaReceber('70004', 4500, daqui(20));
    expect(
      await codigoDaGravacao(
        executar('contratarCessao', {
          portador: cess['portador'],
          tipo: 'cessao',
          comCoobrigacao: true,
          dataOperacao: HOJE,
          parcelas: [grande],
        }),
      ),
    ).toBe('limite-portador');
    // Cancelar a cessão sem desfecho devolve a parcela à carteira, em aberto.
    const c1 = await executar('cancelarCessao', {
      operacao: o1['operacao'],
      motivo: 'contrato não assinado',
    });
    expect(c1).toMatchObject({ situacao: 'cancelada', devolvidas: 1 });
    const pr1b = await um('SELECT saldo, situacao, portador_titulo_id FROM parcela_receber WHERE id = ?', [
      p1,
    ]);
    expect([Number(pr1b['saldo']), pr1b['situacao'], pr1b['portador_titulo_id']]).toEqual([
      1000,
      'aberta',
      null,
    ]);
    const it1 = await um(
      'SELECT situacao FROM operacao_cessao_recebivel_item WHERE operacao_cessao_recebivel_id = ?',
      [o1['operacao']],
    );
    expect(it1['situacao']).toBe('devolvida');
    // O cancelamento estorna os três lançamentos (o original fica, marcado) e o recebimento da cessão.
    const mc = await movsDe(doc1);
    expect(mc.filter((x) => x[3] === 'estornado').length).toBe(3);
    expect(mc.filter((x) => x[4] === 'estorno').map((x) => [x[0], x[1], x[2]])).toEqual([
      ['cessao_face', 'debito', 1000],
      ['cessao_desagio', 'credito', 30],
      ['cessao_tarifas', 'credito', 10],
    ]);
    expect(
      (await um('SELECT situacao FROM recebimento WHERE parcela_receber_id = ?', [p1]))['situacao'],
    ).toBe('estornado');

    // Desconto com coobrigação: a parcela fica em aberto sob o portador; o sacado paga uma, o hospital recompra a outra.
    const p2 = await parcelaReceber('70005', 600, daqui(15));
    const p3 = await parcelaReceber('70006', 400, daqui(45));
    const o2 = await executar('contratarCessao', {
      portador: desc['portador'],
      tipo: 'desconto_duplicata',
      comCoobrigacao: true,
      dataOperacao: HOJE,
      parcelas: [p2, p3],
    });
    // 600 × 2% × 15/30 = 6; 400 × 2% × 45/30 = 12
    expect(o2).toMatchObject({ valorFace: 1000, valorDesagio: 18, valorLiquido: 982 });
    const pr2 = await um('SELECT saldo, situacao, portador_titulo_id FROM parcela_receber WHERE id = ?', [
      p2,
    ]);
    expect([Number(pr2['saldo']), pr2['situacao'], Number(pr2['portador_titulo_id'])]).toEqual([
      600,
      'aberta',
      Number(desc['portador']),
    ]);
    // C1-069: as leituras da tela. O portador mostra a condição vigente e o limite tomado; a operação traz os itens;
    // a ficha do título mostra com quem a parcela está e a operação; outro estabelecimento não vê nada.
    const ler = <T>(
      fn: (l: Parameters<Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]>[0]) => Promise<T>,
    ) => m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f8-nc-ler' }, fn) as Promise<T>;
    const ports = await ler((l) => portadoresDoEstabelecimento(l, m.est, HOJE));
    expect(
      ports
        .filter((x) => ['CESS70', 'DESC70'].includes(x.codigo))
        .map((x) => [x.codigo, x.tipo, x.taxaDesconto, x.limiteCredito, x.utilizado]),
    ).toEqual([
      ['CESS70', 'cessao', 3, 5000, 0],
      ['DESC70', 'cobranca_descontada', 2, null, 1000],
    ]);
    const ops = await ler((l) => operacoesCessao(l, m.est));
    const vista = ops.find((x) => x.operacao === Number(o2['operacao']));
    expect([vista?.tipo, vista?.situacao, vista?.valorLiquido, vista?.itens.map((i) => i.situacao)]).toEqual([
      'desconto_duplicata',
      'contratada',
      982,
      ['cedida', 'cedida'],
    ]);
    expect(ops.find((x) => x.operacao === Number(o1['operacao']))?.situacao).toBe('cancelada');
    const tituloP2 = Number(
      (await um('SELECT titulo_receber_id FROM parcela_receber WHERE id = ?', [p2]))['titulo_receber_id'],
    );
    const ficha = await ler((l) => cessaoDoTitulo(l, m.est, tituloP2));
    expect(
      ficha.map((x) => [x.parcela, x.saldo, x.portador, x.operacao?.numero, x.operacao?.situacaoItem]),
    ).toEqual([[p2, 600, 'Banco do desconto sintético', Number(o2['numero']), 'cedida']]);
    expect(await ler((l) => cessaoDoTitulo(l, m.outroEst, tituloP2))).toEqual([]);
    const tituloP1 = Number(
      (await um('SELECT titulo_receber_id FROM parcela_receber WHERE id = ?', [p1]))['titulo_receber_id'],
    );
    const fichaP1 = await ler((l) => cessaoDoTitulo(l, m.est, tituloP1));
    expect([
      fichaP1[0]?.portador,
      fichaP1[0]?.operacao?.situacao,
      fichaP1[0]?.operacao?.situacaoItem,
    ]).toEqual([null, 'cancelada', 'devolvida']);
    // Nota sobre parcela que está com o portador: recusada, nada gravado.
    expect(
      await codigoDaGravacao(
        executar('emitirNota', {
          lado: 'receber',
          parcela: p2,
          direcao: 'emitida',
          natureza: 'credito',
          motivo: motivoCredito,
          dataEmissao: HOJE,
          valorItens: 50,
        }),
      ),
    ).toBe('parcela-cedida');
    expect(
      (await consultar('SELECT id FROM nota_credito_debito WHERE parcela_receber_id = ?', [p2])).length,
    ).toBe(0);
    const doc2 = `CES-${String(o2['numero'])}`;
    expect((await movsDe(doc2)).map((x) => [x[0], x[1], x[2]])).toEqual([
      ['cessao_face', 'credito', 1000],
      ['cessao_desagio', 'debito', 18],
    ]);
    const itens = await consultar(
      'SELECT id, parcela_receber_id FROM operacao_cessao_recebivel_item WHERE operacao_cessao_recebivel_id = ? ORDER BY parcela_receber_id',
      [o2['operacao']],
    );
    const item = (p: number) => Number(itens.find((i) => Number(i['parcela_receber_id']) === p)?.['id']);
    await executar('desfechoCessao', { item: item(p2), acao: 'liquidar', data: HOJE });
    const pr2b = await um('SELECT saldo, situacao FROM parcela_receber WHERE id = ?', [p2]);
    expect([Number(pr2b['saldo']), pr2b['situacao']]).toEqual([0, 'recebida']);
    // O sacado pagou ao portador: baixa da cessão, sem movimento na conta (liquida o adiantamento do portador).
    const rec2 = await um(
      'SELECT meio_baixa, valor_recebido, movimento_bancario_id FROM recebimento WHERE parcela_receber_id = ?',
      [p2],
    );
    expect([rec2['meio_baixa'], Number(rec2['valor_recebido']), rec2['movimento_bancario_id']]).toEqual([
      'cessao',
      600,
      null,
    ]);
    const fim = await executar('desfechoCessao', {
      item: item(p3),
      acao: 'recomprar',
      data: HOJE,
      valorRecompra: 400,
    });
    expect(fim).toMatchObject({ situacao: 'recomprada', operacaoLiquidada: true });
    const pr3 = await um('SELECT saldo, situacao, portador_titulo_id FROM parcela_receber WHERE id = ?', [
      p3,
    ]);
    expect([Number(pr3['saldo']), pr3['situacao'], pr3['portador_titulo_id']]).toEqual([400, 'aberta', null]);
    const op2 = await um('SELECT situacao FROM operacao_cessao_recebivel WHERE id = ?', [o2['operacao']]);
    expect(op2['situacao']).toBe('liquidada');
    const it3 = await um(
      'SELECT situacao, recomprada_em, valor_recompra FROM operacao_cessao_recebivel_item WHERE id = ?',
      [item(p3)],
    );
    expect([it3['situacao'], Number(it3['valor_recompra'])]).toEqual(['recomprada', 400]);
    // A recompra é paga ao portador: débito na conta.
    expect((await movsDe(doc2)).map((x) => [x[0], x[1], x[2]])).toEqual([
      ['cessao_face', 'credito', 1000],
      ['cessao_desagio', 'debito', 18],
      ['cessao_recompra', 'debito', 400],
    ]);
    expect(
      await codigoDaGravacao(executar('desfechoCessao', { item: item(p3), acao: 'liquidar', data: HOJE })),
    ).toBe('operacao-nao-contratada');
  });

  it('período fechado recusa a nota e a cessão, sem gravar', async () => {
    const parcela = await parcelaPagar(70009, 500);
    const pr = await parcelaReceber('70010', 300, daqui(20));
    const port = await executar('manterPortador', {
      codigo: 'CESS79',
      descricao: 'Cessionário do período',
      tipo: 'cessao',
      pessoaJuridica: pessoa,
      contaBancaria: m.contaA,
      taxaDesconto: 1,
      vigenciaInicio: '2026-01-01',
    });
    const mesPassado = new Date();
    mesPassado.setUTCDate(1);
    mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);
    const competencia = mesPassado.toISOString().slice(0, 10);
    await escrever(async (e) => {
      await e.executar(
        "INSERT INTO periodo_financeiro (estabelecimento_id, competencia, situacao, fechado_em, criado_em) VALUES (?, ?, 'fechado', ?, ?)",
        [m.est, competencia, new Date(), new Date()],
      );
    });
    expect(
      await codigoDaGravacao(
        executar('emitirNota', {
          lado: 'pagar',
          parcela,
          direcao: 'recebida',
          natureza: 'credito',
          motivo: motivoCredito,
          dataEmissao: competencia,
          valorItens: 10,
        }),
      ),
    ).toBe('periodo-fechado');
    expect(
      await codigoDaGravacao(
        executar('contratarCessao', {
          portador: port['portador'],
          tipo: 'cessao',
          comCoobrigacao: false,
          dataOperacao: competencia,
          parcelas: [pr],
        }),
      ),
    ).toBe('periodo-fechado');
    expect(
      (await consultar('SELECT id FROM nota_credito_debito WHERE parcela_pagar_id = ?', [parcela])).length,
    ).toBe(0);
    expect(
      (await consultar('SELECT id FROM operacao_cessao_recebivel_item WHERE parcela_receber_id = ?', [pr]))
        .length,
    ).toBe(0);
    await escrever(async (e) => {
      await e.executar('DELETE FROM periodo_financeiro WHERE estabelecimento_id = ?', [m.est]);
    });
  });
});
