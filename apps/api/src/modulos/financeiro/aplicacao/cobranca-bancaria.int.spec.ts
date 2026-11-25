// F7, 07-FIN linha 78: contrato de efeito da cobrança bancária com boleto contra o MariaDB real (massa SINTÉTICA
// "L0207"). Carteira: gravada com o leiaute de cobrança do banco; faixa inválida e carteira repetida recusadas.
// Emissão: o boleto fica com o nosso número da faixa, o código de barras e a linha digitável que se conferem, e a
// parcela guarda a carteira e o nosso número; segunda emissão e pagador sem documento recusados. Remessa: registra os
// emitidos (boletos ligados à remessa), o arquivo remontado confere com a impressão digital, remessa vazia recusada.
// Retorno: entrada confirmada registra; liquidação baixa a parcela e o título com o recebimento e o crédito na conta
// (data do crédito do banco); liquidação a menor deixa a parcela parcial; tarifas viram um débito na conta; o mesmo
// arquivo não entra duas vezes; a liquidação repetida não baixa de novo; a rejeição volta com o motivo na remessa.
// Cancelamento: o boleto registrado fica cancelado, a parcela é liberada e a próxima remessa leva a baixa.
import { randomUUID } from 'node:crypto';
import {
  lerRetornoCobranca240,
  linhaParaCodigoBarras,
  montarRetornoCobranca240,
  retornoCobrancaRecusado,
} from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arquivoDaRemessaCobranca,
  OPERACOES_COBRANCA_BANCARIA,
  retornoCobrancaSimulado,
} from '../cobranca-bancaria-propria.js';
import {
  CLIENTE,
  codigoDe,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const BANCO = 987;
const HOJE = new Date().toISOString().slice(0, 10);
const VENCE = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `c2031-${randomUUID()}` });
const PAGADOR = { pagadorDocumento: '11.222.333/0001-81', pagadorNome: 'OPERADORA SINTETICA C2031' };

describe.skipIf(SEM_BANCO)('cobrança bancária com boleto (MariaDB)', () => {
  let m: MassaFinanceiro;
  let banco = 0;
  let carteira = 0;
  let documento = 0;
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2031' }, fn) as Promise<T>;
  const uma = (sql: string, p: unknown[]) => ler<Record<string, unknown> | null>((l) => l.uma(sql, p));
  const varias = (sql: string, p: unknown[]) =>
    ler<Record<string, unknown>[]>((l) => l.consultar(sql, p, { teto: 500 }));
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2031' }, fn) as Promise<T>;
  const executar = (nome: keyof typeof OPERACOES_COBRANCA_BANCARIA, entrada: unknown) =>
    m.nucleo
      .criarExecutor()
      .executar(OPERACOES_COBRANCA_BANCARIA[nome] as never, CLIENTE, entrada, op(m.ctx(m.paga)))
      .then((r) => r.resultado as Record<string, unknown>);
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return codigoDe(e);
    }
  };
  /** Um título a receber da operadora, avulso, com uma parcela; devolve o id da parcela. */
  const parcela = (valor: number) =>
    escrever<number>(async (e) => {
      documento += 1;
      const agora = new Date();
      const tipoDoc = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'fatura'",
        [],
      );
      const natureza = await e.uma<{ id: number }>(
        'SELECT id FROM natureza_financeira ORDER BY id LIMIT 1',
        [],
      );
      const t = await e.inserir(
        `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, ?, 'fonte_pagadora', ?, 'avulso', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.est,
          `C2031-${documento}`,
          m.convenio,
          Number(tipoDoc?.id),
          documento,
          HOJE,
          HOJE,
          valor,
          valor,
          Number(natureza?.id),
          agora,
        ],
      );
      return e.inserir(
        `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor, saldo,
           percentual_multa, percentual_juros_mes, criado_em) VALUES (?, 1, ?, ?, ?, ?, 2, 1, ?)`,
        [t, VENCE, VENCE, valor, valor, agora],
      );
    });
  const limparProprio = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2031' }, async (e) => {
      const ests = [m.est, m.outroEst];
      await e.executar(
        `DELETE i FROM retorno_cobranca_item i JOIN retorno_cobranca r ON r.id = i.retorno_cobranca_id
          WHERE r.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar('DELETE FROM retorno_cobranca WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `DELETE i FROM remessa_cobranca_item i JOIN remessa_cobranca r ON r.id = i.remessa_cobranca_id
          WHERE r.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar(
        'UPDATE boleto SET remessa_cobranca_id = NULL WHERE estabelecimento_id IN (?, ?)',
        ests,
      );
      await e.executar('DELETE FROM remessa_cobranca WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM boleto WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `UPDATE parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
            SET p.carteira_cobranca_id = NULL WHERE t.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar('DELETE FROM carteira_cobranca WHERE estabelecimento_id IN (?, ?)', ests);
    });
  const codigoDoBanco = (valor: string | null) =>
    escrever((e) => e.executar('UPDATE banco SET codigo_compensacao = ? WHERE id = ?', [valor, banco]));

  beforeAll(async () => {
    m = await montarMassa();
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    m = await montarMassa();
    banco = Number((await uma('SELECT banco_id FROM conta_bancaria WHERE id = ?', [m.contaA]))?.['banco_id']);
    await codigoDoBanco(String(BANCO));
    const doc = await uma('SELECT MAX(numero_documento) AS n FROM titulo_receber', []);
    documento = 31_000_000 + (Number(doc?.['n']) % 1000) * 1000;
    await escrever(async (e) => {
      const ja = await e.uma("SELECT id FROM leiaute_bancario WHERE codigo = 'C2031-COB240'", []);
      if (!ja)
        await e.inserir(
          `INSERT INTO leiaute_bancario (banco_id, codigo, descricao, servico, padrao, versao_leiaute, criado_em)
           VALUES (?, 'C2031-COB240', 'COBRANCA CNAB240 SINTETICO', 'cobranca', 'cnab240', '10.7', ?)`,
          [banco, new Date()],
        );
    });
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await codigoDoBanco(null);
    await m.nucleo.encerrar?.();
  }, 120_000);

  it('carteira: grava com o leiaute de cobrança do banco; recusa faixa inválida e carteira repetida', async () => {
    const dados = {
      acao: 'incluir',
      conta: m.contaA,
      descricao: 'Carteira sintética C2031',
      codigoCarteira: '9',
      codigoBeneficiario: '123456',
      nossoNumeroInicial: 100,
      nossoNumeroFinal: 199,
      diasCompensacao: 1,
      valorTarifa: 2.5,
      localPagamento: null,
    };
    expect(
      await codigo(executar('financeiro.manterCarteiraCobranca', { ...dados, nossoNumeroFinal: 50 })),
    ).toBe('carteira-faixa');
    carteira = Number((await executar('financeiro.manterCarteiraCobranca', dados))['carteira']);
    const c = await uma(
      `SELECT c.nosso_numero_atual, c.ativo, l.servico FROM carteira_cobranca c
         JOIN leiaute_bancario l ON l.id = c.remessa_leiaute_bancario_id WHERE c.id = ?`,
      [carteira],
    );
    expect(c).toMatchObject({ nosso_numero_atual: 100, servico: 'cobranca' });
    expect(await codigo(executar('financeiro.manterCarteiraCobranca', dados))).toBe('carteira-repetida');
  });

  let pA = 0;
  let pB = 0;
  it('emissão: nosso número da faixa, código e linha que se conferem, parcela ligada; recusas na hora', async () => {
    pA = await parcela(100);
    pB = await parcela(50);
    expect(await codigo(executar('financeiro.emitirBoletos', { carteira, parcelas: [pA] }))).toBe(
      'pagador-sem-documento',
    );
    const r = await executar('financeiro.emitirBoletos', { carteira, parcelas: [pA, pB], ...PAGADOR });
    expect(r['quantidade']).toBe(2);
    expect(r['parcelasValor']).toEqual([100, 50]);
    expect(r['total']).toBe(150);
    const boletos = await varias(
      'SELECT nosso_numero, codigo_barras, linha_digitavel, situacao, valor, pagador_documento FROM boleto WHERE carteira_cobranca_id = ? ORDER BY id',
      [carteira],
    );
    expect(boletos.map((b) => String(b['nosso_numero']).slice(0, 11))).toEqual([
      '00000000100',
      '00000000101',
    ]);
    for (const b of boletos) {
      expect(linhaParaCodigoBarras(String(b['linha_digitavel']))).toBe(b['codigo_barras']);
      expect(b).toMatchObject({ situacao: 'emitido', pagador_documento: '11222333000181' });
    }
    const p = await uma(
      'SELECT carteira_cobranca_id, nosso_numero, codigo_barras FROM parcela_receber WHERE id = ?',
      [pA],
    );
    expect(p).toMatchObject({ carteira_cobranca_id: carteira, nosso_numero: boletos[0]?.['nosso_numero'] });
    expect(
      (await uma('SELECT nosso_numero_atual FROM carteira_cobranca WHERE id = ?', [carteira]))?.[
        'nosso_numero_atual'
      ],
    ).toBe(101);
    expect(await codigo(executar('financeiro.emitirBoletos', { carteira, parcelas: [pA], ...PAGADOR }))).toBe(
      'boleto-ja-emitido',
    );
  });

  it('remessa: registra os emitidos, arquivo remontado confere; remessa vazia recusada', async () => {
    const r = await executar('financeiro.gerarRemessaCobranca', {
      carteira,
      mensagem: 'Pagamento sintético',
    });
    expect(r).toMatchObject({ registros: 2, baixas: 0, total: 150, sequencia: 1 });
    const remessa = Number(r['remessa']);
    expect(
      await varias(
        'SELECT instrucao, valor_titulo FROM remessa_cobranca_item WHERE remessa_cobranca_id = ? ORDER BY sequencia',
        [remessa],
      ),
    ).toEqual(
      [
        { instrucao: 'registro', valor_titulo: '100.00' },
        { instrucao: 'registro', valor_titulo: '50.00' },
      ].map((x) => expect.objectContaining({ instrucao: x.instrucao })),
    );
    expect(
      Number((await uma('SELECT COUNT(*) AS n FROM boleto WHERE remessa_cobranca_id = ?', [remessa]))?.['n']),
    ).toBe(2);
    const arq = await ler<Awaited<ReturnType<typeof arquivoDaRemessaCobranca>>>((l) =>
      arquivoDaRemessaCobranca(l, m.est, remessa),
    );
    expect(arq?.conferido).toBe(true);
    expect(arq?.conteudo).toBe(r['conteudo']);
    expect(await codigo(executar('financeiro.gerarRemessaCobranca', { carteira }))).toBe('remessa-vazia');
  });

  it('retorno: confirma, liquida (inteiro e a menor), lança tarifa; não entra duas vezes nem baixa de novo', async () => {
    const nossos = (
      await varias('SELECT nosso_numero FROM boleto WHERE carteira_cobranca_id = ? ORDER BY id', [carteira])
    ).map((b) => String(b['nosso_numero']));
    const [nA, nB] = nossos as [string, string];
    const simulado = await ler<string | null>((l) => retornoCobrancaSimulado(l, m.est, carteira));
    const lidoSim = lerRetornoCobranca240(simulado ?? '', BANCO);
    expect(retornoCobrancaRecusado(lidoSim) ? [] : lidoSim.linhas.map((x) => x.codigo)).toEqual([
      '02',
      '06',
      '02',
      '06',
    ]);
    const arquivo = montarRetornoCobranca240(BANCO, 1, HOJE, [
      { codigo: '02', nossoNumero: nA, valorTitulo: 100, tarifa: 1.5 },
      {
        codigo: '06',
        nossoNumero: nA,
        valorTitulo: 100,
        valorPago: 102,
        encargos: 2,
        tarifa: 2.5,
        dataOcorrencia: HOJE,
        dataCredito: HOJE,
      },
      { codigo: '06', nossoNumero: nB, valorTitulo: 50, valorPago: 30, dataOcorrencia: HOJE },
      { codigo: '06', nossoNumero: '999999999999', valorTitulo: 5, valorPago: 5, dataOcorrencia: HOJE },
    ]);
    expect(
      await codigo(
        executar('financeiro.processarRetornoCobranca', {
          carteira,
          nomeArquivo: 'x.ret',
          conteudo: arquivo.replace(/^987/, '001'),
        }),
      ),
    ).toBe('banco-diferente');
    const r = await executar('financeiro.processarRetornoCobranca', {
      carteira,
      nomeArquivo: 'ret-1.ret',
      conteudo: arquivo,
    });
    expect(r).toMatchObject({
      liquidados: 2,
      confirmados: 1,
      naoLocalizados: 1,
      totalLiquidado: 132,
      parcelasLiquidadas: [102, 30],
      totalTarifas: 4,
      parcelasTarifa: [1.5, 2.5],
    });
    const pa = await uma(
      'SELECT saldo, situacao, valor_recebido, valor_juros FROM parcela_receber WHERE id = ?',
      [pA],
    );
    expect(pa).toMatchObject({
      saldo: '0.00',
      situacao: 'recebida',
      valor_recebido: '100.00',
      valor_juros: '2.00',
    });
    const pb = await uma('SELECT saldo, situacao, valor_recebido FROM parcela_receber WHERE id = ?', [pB]);
    expect(pb).toMatchObject({ saldo: '20.00', situacao: 'parcial', valor_recebido: '30.00' });
    const titulos = await varias(
      'SELECT t.situacao, t.valor_recebido FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id WHERE p.id IN (?, ?) ORDER BY p.id',
      [pA, pB],
    );
    expect(titulos).toEqual([
      expect.objectContaining({ situacao: 'recebido', valor_recebido: '100.00' }),
      expect.objectContaining({ situacao: 'recebido_parcial', valor_recebido: '30.00' }),
    ]);
    const recebimentos = await varias(
      `SELECT r.valor_recebido, r.meio_baixa, r.conta_bancaria_id, m.natureza, m.valor FROM recebimento r
         JOIN movimento_bancario m ON m.id = r.movimento_bancario_id WHERE r.parcela_receber_id IN (?, ?) ORDER BY r.id`,
      [pA, pB],
    );
    expect(recebimentos).toEqual([
      expect.objectContaining({
        valor_recebido: '102.00',
        meio_baixa: 'retorno_bancario',
        conta_bancaria_id: m.contaA,
        natureza: 'credito',
        valor: '102.00',
      }),
      expect.objectContaining({
        valor_recebido: '30.00',
        meio_baixa: 'retorno_bancario',
        natureza: 'credito',
        valor: '30.00',
      }),
    ]);
    const tarifa = await uma(
      "SELECT valor, natureza, historico FROM movimento_bancario WHERE id = ? AND tipo_origem = 'tarifa'",
      [r['movimentoTarifa']],
    );
    expect(tarifa).toMatchObject({ valor: '4.00', natureza: 'debito' });
    expect(String(tarifa?.['historico'])).toContain('1.50 + 2.50');
    const ret = await uma(
      'SELECT situacao, quantidade_registros, valor_total, valor_tarifas FROM retorno_cobranca WHERE id = ?',
      [r['retorno']],
    );
    expect(ret).toMatchObject({
      situacao: 'processado_com_erros',
      quantidade_registros: 4,
      valor_total: '132.00',
      valor_tarifas: '4.00',
    });
    expect(
      (
        await varias('SELECT situacao FROM boleto WHERE carteira_cobranca_id = ? ORDER BY id', [carteira])
      ).map((b) => b['situacao']),
    ).toEqual(['pago', 'pago']);
    expect(
      await codigo(
        executar('financeiro.processarRetornoCobranca', {
          carteira,
          nomeArquivo: 'ret-1.ret',
          conteudo: arquivo,
        }),
      ),
    ).toBe('retorno-ja-importado');
    const repetida = montarRetornoCobranca240(BANCO, 2, HOJE, [
      { codigo: '06', nossoNumero: nA, valorTitulo: 100, valorPago: 100, dataOcorrencia: HOJE },
    ]);
    const r2 = await executar('financeiro.processarRetornoCobranca', {
      carteira,
      nomeArquivo: 'ret-2.ret',
      conteudo: repetida,
    });
    expect(r2).toMatchObject({ liquidados: 0, recebimentos: [] });
    expect(
      Number((await uma('SELECT COUNT(*) AS n FROM recebimento WHERE parcela_receber_id = ?', [pA]))?.['n']),
    ).toBe(1);
  });

  it('cancelamento leva a baixa na remessa seguinte; rejeição volta com o motivo na remessa', async () => {
    const pC = await parcela(70);
    const pD = await parcela(80);
    await executar('financeiro.emitirBoletos', { carteira, parcelas: [pC, pD], ...PAGADOR });
    const rem = await executar('financeiro.gerarRemessaCobranca', { carteira });
    expect(rem).toMatchObject({ registros: 2, baixas: 0 });
    const [bC, bD] = await varias(
      'SELECT id, nosso_numero FROM boleto WHERE carteira_cobranca_id = ? AND valor IN (70, 80) ORDER BY valor',
      [carteira],
    );
    const rejeicao = montarRetornoCobranca240(BANCO, 3, HOJE, [
      { codigo: '03', nossoNumero: String(bD?.['nosso_numero']), valorTitulo: 80, motivos: '46' },
    ]);
    await executar('financeiro.processarRetornoCobranca', {
      carteira,
      nomeArquivo: 'ret-3.ret',
      conteudo: rejeicao,
    });
    expect((await uma('SELECT situacao FROM boleto WHERE id = ?', [bD?.['id']]))?.['situacao']).toBe(
      'rejeitado',
    );
    const item = await uma(
      'SELECT rejeitado, motivo_rejeicao FROM remessa_cobranca_item WHERE boleto_id = ?',
      [bD?.['id']],
    );
    expect(item).toMatchObject({ rejeitado: 1 });
    expect(String(item?.['motivo_rejeicao'])).toContain('46');
    expect(await codigo(executar('financeiro.cancelarBoleto', { boleto: bC?.['id'], motivo: 'x' }))).not.toBe(
      'gravou',
    );
    await executar('financeiro.cancelarBoleto', {
      boleto: Number(bC?.['id']),
      motivo: 'Pagador pediu outra forma',
    });
    expect(
      await uma('SELECT situacao, data_cancelamento IS NOT NULL AS dc FROM boleto WHERE id = ?', [
        bC?.['id'],
      ]),
    ).toMatchObject({ situacao: 'cancelado', dc: 1 });
    expect(
      await uma('SELECT nosso_numero, carteira_cobranca_id FROM parcela_receber WHERE id = ?', [pC]),
    ).toMatchObject({ nosso_numero: null, carteira_cobranca_id: null });
    const baixa = await executar('financeiro.gerarRemessaCobranca', { carteira });
    expect(baixa).toMatchObject({ registros: 0, baixas: 1, total: 0 });
    expect(
      await uma('SELECT instrucao, boleto_id FROM remessa_cobranca_item WHERE remessa_cobranca_id = ?', [
        baixa['remessa'],
      ]),
    ).toMatchObject({ instrucao: 'baixa', boleto_id: bC?.['id'] });
    // O boleto rejeitado e cancelado não vai à baixa (nunca foi registrado no banco); a parcela volta a aceitar boleto.
    await executar('financeiro.cancelarBoleto', {
      boleto: Number(bD?.['id']),
      motivo: 'Documento do pagador errado',
    });
    expect(await codigo(executar('financeiro.gerarRemessaCobranca', { carteira }))).toBe('remessa-vazia');
    expect(
      (await executar('financeiro.emitirBoletos', { carteira, parcelas: [pD], ...PAGADOR }))['quantidade'],
    ).toBe(1);
  });
});
