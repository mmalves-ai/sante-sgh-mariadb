// F7, 07-FIN linha 90: contrato de efeito da cobrança Pix sobre o título a receber contra o MariaDB real (massa
// SINTÉTICA "L0207", prestador simulado). Chave: gravada na forma canônica; inválida e repetida recusadas.
// Emissão: a cobrança fica ativa com o txid e o "copia e cola" de CRC conferível; segunda cobrança ativa e valor acima
// do saldo recusados. Retorno: o Pix vira o retorno, o crédito na conta e o recebimento que quita a parcela e o título;
// a cobrança fica concluída; a mesma notificação não baixa de novo; notificação inválida é recusada inteira; o pago a
// mais baixa só o saldo e guarda o excedente. Devolução: primeiro do excedente; o resto estorna o recebimento, baixa de
// novo só o que ficou e devolve o saldo à parcela; débito na conta; acima do disponível recusada. Cancelamento: a
// cobrança ativa fica removida e a parcela pode ganhar outra.
import { randomBytes, randomUUID } from 'node:crypto';
import { brCodeConfere } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operacoesCobrancaPix } from '../cobranca-pix-propria.js';
import { ProvedorPixSimulado } from '../pix-provedor.js';
import {
  CLIENTE,
  codigoDe,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const OPS = operacoesCobrancaPix(new ProvedorPixSimulado());
const HOJE = new Date().toISOString().slice(0, 10);
const VENCE = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const comChave = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `c2045-${randomUUID()}` });
const fimAFim = () =>
  `E12345678${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}${randomBytes(8).toString('hex').slice(0, 11)}`;

describe.skipIf(SEM_BANCO)('cobrança Pix com retorno, baixa automática e devolução (MariaDB)', () => {
  let m: MassaFinanceiro;
  let documento = 0;
  let chave = 0;
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2045' }, fn) as Promise<T>;
  const uma = (sql: string, p: unknown[]) => ler<Record<string, unknown> | null>((l) => l.uma(sql, p));
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2045' }, fn) as Promise<T>;
  const executar = (nome: keyof typeof OPS, entrada: unknown) =>
    m.nucleo
      .criarExecutor()
      .executar(OPS[nome] as never, CLIENTE, entrada, comChave(m.ctx(m.paga)))
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
          `C2045-${documento}`,
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
  const notificacao = (txid: string, valor: number, e2e = fimAFim()) => ({
    notificacao: {
      pix: [
        {
          endToEndId: e2e,
          txid,
          valor: valor.toFixed(2),
          horario: new Date().toISOString(),
          pagador: { cnpj: '11222333000181', nome: 'OPERADORA SINTETICA C2045' },
        },
      ],
    },
  });
  const cobrancaDe = (id: number) => uma('SELECT * FROM cobranca_pix WHERE id = ?', [id]);
  const parcelaDe = (id: number) =>
    uma(
      `SELECT p.saldo, p.situacao, p.valor_recebido, t.situacao AS titulo_situacao, t.valor_recebido AS titulo_recebido
         FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE p.id = ?`,
      [id],
    );
  const limparProprio = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2045' }, async (e) => {
      const ests = [m.est, m.outroEst];
      const daCobranca = `SELECT id FROM cobranca_pix WHERE estabelecimento_id IN (?, ?)`;
      await e.executar(`DELETE FROM devolucao_pix WHERE cobranca_pix_id IN (${daCobranca})`, ests);
      await e.executar(`DELETE FROM retorno_pix WHERE cobranca_pix_id IN (${daCobranca})`, ests);
      await e.executar('DELETE FROM cobranca_pix WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `DELETE k FROM chave_pix_conta k JOIN conta_bancaria b ON b.id = k.conta_bancaria_id
          WHERE b.estabelecimento_id IN (?, ?)`,
        ests,
      );
    });

  beforeAll(async () => {
    m = await montarMassa();
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    m = await montarMassa();
    const doc = await uma('SELECT MAX(numero_documento) AS n FROM titulo_receber', []);
    documento = 45_000_000 + (Number(doc?.['n']) % 1000) * 1000;
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.encerrar?.();
  }, 120_000);

  it('chave: grava na forma canônica; recusa a inválida e a repetida', async () => {
    const aleatoria = randomUUID().toUpperCase();
    expect(
      await codigo(
        executar('financeiro.manterChavePix', {
          acao: 'incluir',
          conta: m.contaA,
          tipo: 'cpf',
          chave: '123',
        }),
      ),
    ).toBe('chave-invalida');
    const r = await executar('financeiro.manterChavePix', {
      acao: 'incluir',
      conta: m.contaA,
      tipo: 'aleatoria',
      chave: aleatoria,
    });
    chave = Number(r['chave']);
    const k = await uma('SELECT chave, ativa, padrao, sequencia FROM chave_pix_conta WHERE id = ?', [chave]);
    expect(k).toMatchObject({ chave: aleatoria.toLowerCase(), sequencia: 1 });
    expect(Number(k?.['ativa'])).toBe(1);
    expect(Number(k?.['padrao'])).toBe(1);
    expect(
      await codigo(
        executar('financeiro.manterChavePix', {
          acao: 'incluir',
          conta: m.contaA,
          tipo: 'aleatoria',
          chave: aleatoria,
        }),
      ),
    ).toBe('chave-repetida');
  });

  it('emissão, retorno com baixa automática, notificação repetida e inválida', async () => {
    const p = await parcela(100);
    expect(await codigo(executar('financeiro.emitirCobrancaPix', { parcela: p, chave, valor: 100.01 }))).toBe(
      'valor-acima-saldo',
    );
    const r = await executar('financeiro.emitirCobrancaPix', { parcela: p, chave });
    const cob = Number(r['cobranca']);
    const c = await cobrancaDe(cob);
    expect(c).toMatchObject({ situacao: 'ativa', modalidade: 'imediata', modulo_origem: 'contas_a_receber' });
    expect(Number(c?.['valor'])).toBe(100);
    expect(String(c?.['txid'])).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(brCodeConfere(String(c?.['pix_copia_cola']))).toBe(true);
    expect(await codigo(executar('financeiro.emitirCobrancaPix', { parcela: p, chave }))).toBe(
      'cobranca-ativa',
    );

    expect(
      await codigo(executar('financeiro.processarRetornoPix', { notificacao: { pix: [{ txid: 'x' }] } })),
    ).toBe('notificacao-invalida');
    expect(
      Number((await uma('SELECT COUNT(*) AS n FROM retorno_pix WHERE cobranca_pix_id = ?', [cob]))?.['n']),
    ).toBe(0);

    const n = notificacao(String(c?.['txid']), 100);
    const ret = await executar('financeiro.processarRetornoPix', n);
    expect(ret).toMatchObject({
      recebidos: 1,
      baixados: 1,
      totalBaixado: 100,
      repetidos: 0,
      naoLocalizados: 0,
    });
    const rp = await uma('SELECT * FROM retorno_pix WHERE cobranca_pix_id = ?', [cob]);
    expect(rp).toMatchObject({ situacao: 'baixado', sequencia: 1, pagador_cnpj: '11222333000181' });
    expect(Number(rp?.['baixa_automatica'])).toBe(1);
    const rec = await uma('SELECT * FROM recebimento WHERE id = ?', [rp?.['recebimento_id']]);
    expect(rec).toMatchObject({ meio_baixa: 'pix', situacao: 'efetivado', parcela_receber_id: p });
    expect(Number(rec?.['valor_recebido'])).toBe(100);
    const mov = await uma('SELECT natureza, tipo_origem, valor FROM movimento_bancario WHERE id = ?', [
      rp?.['movimento_bancario_id'],
    ]);
    expect(mov).toMatchObject({ natureza: 'credito', tipo_origem: 'baixa_titulo' });
    expect(Number(mov?.['valor'])).toBe(100);
    const pa = await parcelaDe(p);
    expect(pa).toMatchObject({ situacao: 'recebida', titulo_situacao: 'recebido' });
    expect(Number(pa?.['saldo'])).toBe(0);
    const c2 = await cobrancaDe(cob);
    expect(c2).toMatchObject({
      situacao: 'concluida',
      identificador_fim_a_fim: n.notificacao.pix[0]?.endToEndId,
    });
    expect(Number(c2?.['recebimento_id'])).toBe(Number(rec?.['id']));

    const outra = await executar('financeiro.processarRetornoPix', n);
    expect(outra).toMatchObject({ repetidos: 1, baixados: 0 });
    expect(
      Number((await uma('SELECT COUNT(*) AS n FROM recebimento WHERE parcela_receber_id = ?', [p]))?.['n']),
    ).toBe(1);
  });

  it('pago a mais: baixa o saldo e guarda o excedente; devolução do excedente e depois da baixa', async () => {
    const p = await parcela(80);
    const cob = Number((await executar('financeiro.emitirCobrancaPix', { parcela: p, chave }))['cobranca']);
    const txid = String((await cobrancaDe(cob))?.['txid']);
    const ret = await executar('financeiro.processarRetornoPix', notificacao(txid, 100));
    expect(ret).toMatchObject({ baixados: 1, paraDevolucao: 1, totalBaixado: 80, totalExcedente: 20 });
    const rp = await uma(
      'SELECT id, recebimento_id, mensagem_erro FROM retorno_pix WHERE cobranca_pix_id = ?',
      [cob],
    );
    expect(String(rp?.['mensagem_erro'])).toContain('20.00');
    const retorno = Number(rp?.['id']);
    const recAntigo = Number(rp?.['recebimento_id']);

    expect(await codigo(executar('financeiro.devolverPix', { retorno, valor: 100.01, motivo: 'SL02' }))).toBe(
      'valor-acima-disponivel',
    );
    const d = await executar('financeiro.devolverPix', { retorno, valor: 30, motivo: 'SL02' });
    expect(d).toMatchObject({ doExcedente: 20, reverteBaixa: 10, situacao: 'devolvida' });
    expect(
      await uma('SELECT situacao, motivo_estorno IS NOT NULL AS motivo FROM recebimento WHERE id = ?', [
        recAntigo,
      ]),
    ).toMatchObject({ situacao: 'estornado', motivo: 1 });
    const recNovo = await uma('SELECT valor_recebido, meio_baixa, situacao FROM recebimento WHERE id = ?', [
      d['recebimentoNovo'],
    ]);
    expect(recNovo).toMatchObject({ meio_baixa: 'pix', situacao: 'efetivado' });
    expect(Number(recNovo?.['valor_recebido'])).toBe(70);
    const pa = await parcelaDe(p);
    expect(pa).toMatchObject({ situacao: 'parcial', titulo_situacao: 'recebido_parcial' });
    expect(Number(pa?.['saldo'])).toBe(10);
    expect(Number(pa?.['valor_recebido'])).toBe(70);
    expect(Number(pa?.['titulo_recebido'])).toBe(70);
    const dv = await uma('SELECT * FROM devolucao_pix WHERE id = ?', [d['devolucao']]);
    expect(dv).toMatchObject({ situacao: 'devolvida', motivo_codigo: 'SL02', sequencia: 1 });
    expect(Number(dv?.['valor'])).toBe(30);
    expect(String(dv?.['end_to_end_id'])).toHaveLength(32);
    const deb = await uma('SELECT natureza, tipo_origem, valor FROM movimento_bancario WHERE id = ?', [
      d['movimento'],
    ]);
    expect(deb).toMatchObject({ natureza: 'debito', tipo_origem: 'estorno' });
    expect(Number(deb?.['valor'])).toBe(30);
    const rp2 = await uma('SELECT situacao, valor_devolvido, recebimento_id FROM retorno_pix WHERE id = ?', [
      retorno,
    ]);
    expect(rp2).toMatchObject({ situacao: 'devolvido_parcial' });
    expect(Number(rp2?.['valor_devolvido'])).toBe(30);
    expect(Number(rp2?.['recebimento_id'])).toBe(Number(d['recebimentoNovo']));

    // O resto inteiro: a baixa sai toda, a parcela volta aberta e a cobrança fica devolvida.
    const tudo = await executar('financeiro.devolverPix', { retorno, valor: 70, motivo: 'MD06' });
    expect(tudo).toMatchObject({ doExcedente: 0, reverteBaixa: 70, recebimentoNovo: null });
    const pa2 = await parcelaDe(p);
    expect(pa2).toMatchObject({ situacao: 'aberta', titulo_situacao: 'aberto' });
    expect(Number(pa2?.['saldo'])).toBe(80);
    expect(await cobrancaDe(cob)).toMatchObject({ situacao: 'devolvida' });
    expect(await uma('SELECT situacao FROM retorno_pix WHERE id = ?', [retorno])).toMatchObject({
      situacao: 'devolvido',
    });
    expect(
      Number((await uma('SELECT COUNT(*) AS n FROM devolucao_pix WHERE cobranca_pix_id = ?', [cob]))?.['n']),
    ).toBe(2);
  });

  it('cancelamento: a cobrança ativa fica removida e a parcela ganha outra', async () => {
    const p = await parcela(50);
    const cob = Number(
      (await executar('financeiro.emitirCobrancaPix', { parcela: p, chave, valor: 20 }))['cobranca'],
    );
    await executar('financeiro.cancelarCobrancaPix', { cobranca: cob, motivo: 'Valor combinado mudou' });
    const c = await cobrancaDe(cob);
    expect(c).toMatchObject({ situacao: 'removida_usuario' });
    expect(String(c?.['descricao'])).toContain('Valor combinado mudou');
    expect(
      await codigo(executar('financeiro.cancelarCobrancaPix', { cobranca: cob, motivo: 'de novo' })),
    ).toBe('cobranca-nao-ativa');
    const nova = await executar('financeiro.emitirCobrancaPix', { parcela: p, chave });
    expect(Number(nova['valor'])).toBe(50);
  });
});
