// F3.8, 07-FIN linha 89: contrato de efeito do cartão de débito e crédito contra o MariaDB real (massa SINTÉTICA
// "L0207"; nenhuma pessoa real).
// Cadastro: a administradora e a taxa com vigência; a taxa nova encerra na véspera a que valia e as duas ficam no banco.
// Recebimento: a venda em 3 parcelas grava UMA transação (bruto, taxa, líquido) e três parcelas a receber, líquidas e
// com a data prevista; o mesmo comprovante não entra duas vezes e a venda sem taxa vigente é recusada.
// Fluxo de caixa: as parcelas previstas entram como entrada projetada; a baixa lança UM crédito na conta, marca a
// parcela como recebida (com a diferença para o previsto) e ela sai do projetado; baixar de novo é recusado; com todas
// recebidas a transação fica conciliada. Outro estabelecimento não enxerga as parcelas.
import { randomUUID } from 'node:crypto';
import type { Executor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comCartaoNoFluxo,
  OPERACOES_CARTAO,
  opcoesCartao,
  planoDoCartao,
  recebiveisCartao,
  taxasDaAdministradora,
} from '../cartao-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const HOJE = dia(0);
const n = (v: unknown) => Number(v);
const BANDEIRA = 'L0207-BAND-F3807';

describe.skipIf(SEM_BANCO)('cartão: taxa com vigência, recebíveis, fluxo e baixa (MariaDB)', () => {
  let m: MassaFinanceiro;
  let executor: Executor;
  let bandeira = 0;
  let administradora = 0;
  let parcelas: number[] = [];
  let transacao = 0;
  const consultar = (sql: string, p: unknown[] = []) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f38-07' }, (l) => l.consultar(sql, p));
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f38-07' }, fn) as Promise<T>;
  const rodar = (
    op: keyof typeof OPERACOES_CARTAO,
    entrada: unknown,
    o: { chave?: string; est?: number } = {},
  ) =>
    executor.executar(OPERACOES_CARTAO[op] as never, CLIENTE, entrada, {
      ...m.ctx(m.lanca, o.est ?? m.est),
      chaveIdempotencia: o.chave ?? `t-f38-07-${randomUUID()}`,
    });
  const limparCartao = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f38-07' }, async (e) => {
      const ests = [m.est, m.outroEst];
      await e.executar(
        `DELETE p FROM parcela_recebivel_cartao p JOIN transacao_cartao t ON t.id = p.transacao_cartao_id
          WHERE t.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar('DELETE FROM transacao_cartao WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM taxa_administradora WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM administradora_cartao WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM bandeira_cartao WHERE codigo = ?', [BANDEIRA]);
    });

  beforeAll(async () => {
    m = await montarMassa();
    executor = m.nucleo.criarExecutor();
    await limparCartao();
    bandeira = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f38-07' }, (e) =>
      e.inserir(
        "INSERT INTO bandeira_cartao (codigo, descricao, modalidade, criado_em) VALUES (?, 'BANDEIRA SINTETICA L0207', 'credito_debito', NOW(3))",
        [BANDEIRA],
      ),
    );
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparCartao();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('cadastro: a taxa nova encerra na véspera a que valia e nada é apagado', async () => {
    const a = await rodar('financeiro.gravarAdministradoraCartao', {
      nome: 'ADMINISTRADORA SINTETICA L0207',
      diasParaPagamento: 30,
      contaBancaria: m.contaA,
      permiteParcelamento: true,
    });
    administradora = n(a.resultado['administradora']);
    expect(administradora).toBeGreaterThan(0);
    expect(
      await codigoDaGravacao(
        rodar('financeiro.gravarAdministradoraCartao', { nome: 'ADMINISTRADORA SINTETICA L0207' }),
      ),
    ).toBe('administradora-cartao-repetida');
    const credito = {
      administradora,
      bandeira: null,
      modalidade: 'credito',
      parcelaInicial: 1,
      parcelaFinal: 12,
      tipo: 'percentual',
      percentual: 3,
      diasRepasse: 30,
    };
    const antiga = await rodar('financeiro.gravarTaxaAdministradora', {
      ...credito,
      vigenciaInicio: '2026-01-01',
    });
    expect(antiga.resultado['encerradas']).toBe(0);
    await rodar('financeiro.gravarTaxaAdministradora', {
      administradora,
      bandeira,
      modalidade: 'debito',
      tipo: 'valor',
      valor: 0.5,
      diasRepasse: 1,
      vigenciaInicio: '2026-01-01',
    });
    // Débito não tem faixa de parcelas.
    expect(
      await codigoDaGravacao(
        rodar('financeiro.gravarTaxaAdministradora', {
          ...credito,
          modalidade: 'debito',
          vigenciaInicio: HOJE,
        }),
      ),
    ).toBe('parcelas-cartao-a-vista');
    const nova = await rodar('financeiro.gravarTaxaAdministradora', {
      ...credito,
      percentual: 2.5,
      vigenciaInicio: HOJE,
    });
    expect(nova.resultado['encerradas']).toBe(1);
    expect(
      await codigoDaGravacao(
        rodar('financeiro.gravarTaxaAdministradora', { ...credito, percentual: 2, vigenciaInicio: HOJE }),
      ),
    ).toBe('taxa-cartao-vigencia-posterior');

    const noBanco = await consultar(
      `SELECT id, modalidade, tipo_taxa, percentual_taxa, valor_taxa, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
              DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, criado_por
         FROM taxa_administradora WHERE administradora_cartao_id = ? ORDER BY id`,
      [administradora],
    );
    expect(
      noBanco.map((t) => [t['modalidade'], t['tipo_taxa'], n(t['percentual_taxa']), t['inicio'], t['fim']]),
    ).toEqual([
      ['credito', 'percentual', 3, '2026-01-01', dia(-1)],
      ['debito', 'valor_fixo', 0, '2026-01-01', null],
      ['credito', 'percentual', 2.5, HOJE, null],
    ]);
    expect(n(noBanco[1]?.['valor_taxa'])).toBe(0.5);
    expect(noBanco.every((t) => n(t['criado_por']) === m.lanca)).toBe(true);
    // A leitura da tela: as que valem hoje primeiro, a encerrada depois, no histórico.
    const lidas = await ler<Awaited<ReturnType<typeof taxasDaAdministradora>>>((l) =>
      taxasDaAdministradora(l, m.est, administradora, HOJE),
    );
    expect(lidas.map((t) => t.vigente)).toEqual([true, true, false]);
    const opcoes = await ler<Awaited<ReturnType<typeof opcoesCartao>>>((l) => opcoesCartao(l, m.est, true));
    expect(opcoes.administradoras.map((x) => x.id)).toEqual([administradora]);
    expect(opcoes.bandeiras.some((b) => b.id === bandeira)).toBe(true);
    // A trilha da gravação nasce na mesma transação.
    const trilha = await consultar(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'taxa_administradora' AND entidade_id = ?",
      [String(nova.resultado['taxa'])],
    );
    expect(n(trilha[0]?.['q'])).toBeGreaterThanOrEqual(1);
  });

  it('recebimento em 3 parcelas: uma transação e três parcelas a receber, líquidas e com a data prevista', async () => {
    const venda = {
      administradora,
      bandeira,
      modalidade: 'credito',
      parcelas: 3,
      valor: 1000,
      dataVenda: HOJE,
      nsu: 'NSU-L0207-1',
      autorizacao: 'AUT-L0207-1',
      finalCartao: '1234',
    };
    // A prévia que a tela mostra é a mesma conta que vai ao banco.
    const previa = await ler<Awaited<ReturnType<typeof planoDoCartao>>>((l) =>
      planoDoCartao(l, m.est, { ...venda, modalidade: 'credito' }),
    );
    expect([previa.bruto, previa.taxaTotal, previa.liquido]).toEqual([1000, 25, 975]);
    const chave = `t-f38-07-${randomUUID()}`;
    const r = await rodar('financeiro.registrarRecebimentoCartao', venda, { chave });
    transacao = n(r.resultado['transacao']);
    expect(r.resultado).toMatchObject({ parcelas: 3, bruto: 1000, taxa: 25, liquido: 975 });
    const de_novo = await rodar('financeiro.registrarRecebimentoCartao', venda, { chave });
    expect(de_novo.repetida).toBe(true);
    expect(await codigoDaGravacao(rodar('financeiro.registrarRecebimentoCartao', venda))).toBe(
      'transacao-cartao-repetida',
    );
    expect(
      await codigoDaGravacao(
        rodar('financeiro.registrarRecebimentoCartao', {
          ...venda,
          modalidade: 'pre_pago',
          parcelas: 1,
          nsu: 'NSU-L0207-2',
        }),
      ),
    ).toBe('taxa-cartao-ausente');

    const [t] = await consultar(
      `SELECT tipo_cartao, modalidade, quantidade_parcelas, valor_bruto, valor_taxa, valor_liquido, percentual_taxa,
              situacao, modulo_origem, final_cartao, operador_usuario_id
         FROM transacao_cartao WHERE id = ?`,
      [transacao],
    );
    expect(t).toMatchObject({
      tipo_cartao: 'credito',
      modalidade: 'parcelado_estabelecimento',
      quantidade_parcelas: 3,
      situacao: 'autorizada',
      modulo_origem: 'financeiro',
      final_cartao: '1234',
    });
    expect([n(t?.['valor_bruto']), n(t?.['valor_taxa']), n(t?.['valor_liquido'])]).toEqual([1000, 25, 975]);
    expect(n(t?.['percentual_taxa'])).toBe(2.5);
    expect(n(t?.['operador_usuario_id'])).toBe(m.lanca);
    const ps = await consultar(
      `SELECT id, sequencia, DATE_FORMAT(data_prevista, '%Y-%m-%d') AS prevista, valor_bruto, valor_taxa, valor_liquido,
              situacao FROM parcela_recebivel_cartao WHERE transacao_cartao_id = ? ORDER BY sequencia`,
      [transacao],
    );
    parcelas = ps.map((p) => n(p['id']));
    expect(
      ps.map((p) => [
        n(p['sequencia']),
        p['prevista'],
        n(p['valor_bruto']),
        n(p['valor_taxa']),
        n(p['valor_liquido']),
        p['situacao'],
      ]),
    ).toEqual([
      [1, dia(30), 333.34, 8.34, 325, 'prevista'],
      [2, dia(60), 333.33, 8.33, 325, 'prevista'],
      [3, dia(90), 333.33, 8.33, 325, 'prevista'],
    ]);
    const total = await consultar('SELECT COUNT(*) AS q FROM transacao_cartao WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    expect(n(total[0]?.['q'])).toBe(1);
  });

  it('fluxo de caixa projetado e baixa: o crédito vira um movimento e a parcela sai do projetado', async () => {
    const porta = comCartaoNoFluxo(new PortaFinanceiroPropria(m.nucleo), m.nucleo);
    const fluxo = async () =>
      (await porta.lancamentosFluxo(m.ctx(m.lanca) as never, HOJE, dia(100))).map((x) => [
        x.data,
        x.valor,
        x.sentido,
        x.origem,
        x.realizado,
      ]);
    expect(await fluxo()).toEqual([
      [dia(30), 325, 'entrada', 'receber', false],
      [dia(60), 325, 'entrada', 'receber', false],
      [dia(90), 325, 'entrada', 'receber', false],
    ]);
    const [p1, p2, p3] = parcelas as [number, number, number];
    // Outro estabelecimento não enxerga a parcela.
    expect(
      await codigoDaGravacao(
        rodar(
          'financeiro.baixarRecebiveisCartao',
          { parcelas: [p1], conta: m.contaOutroEst, dataCredito: HOJE },
          { est: m.outroEst },
        ),
      ),
    ).toBe('recebivel-cartao-inexistente');
    expect(
      await codigoDaGravacao(
        rodar('financeiro.baixarRecebiveisCartao', {
          parcelas: [p1],
          conta: m.contaOutroEst,
          dataCredito: HOJE,
        }),
      ),
    ).toBe('conta-inexistente');
    const b = await rodar('financeiro.baixarRecebiveisCartao', {
      parcelas: [p1],
      conta: m.contaA,
      dataCredito: HOJE,
      valorCreditado: 324.5,
    });
    expect(b.resultado).toMatchObject({
      parcelas: 1,
      previsto: 325,
      creditado: 324.5,
      diferenca: -0.5,
      transacoesConciliadas: 0,
    });
    const movimento = n(b.resultado['movimento']);
    const [mov] = await consultar(
      `SELECT conta_bancaria_id, natureza, valor, DATE_FORMAT(data_movimento, '%Y-%m-%d') AS data, situacao
         FROM movimento_bancario WHERE id = ?`,
      [movimento],
    );
    expect(mov).toMatchObject({
      conta_bancaria_id: m.contaA,
      natureza: 'credito',
      data: HOJE,
      situacao: 'ativo',
    });
    expect(n(mov?.['valor'])).toBe(324.5);
    const [baixada] = await consultar(
      `SELECT situacao, valor_recebido, movimento_bancario_id, DATE_FORMAT(recebida_em, '%Y-%m-%d') AS em, valor_liquido
         FROM parcela_recebivel_cartao WHERE id = ?`,
      [p1],
    );
    expect(baixada).toMatchObject({ situacao: 'recebida', movimento_bancario_id: movimento, em: HOJE });
    expect([n(baixada?.['valor_recebido']), n(baixada?.['valor_liquido'])]).toEqual([324.5, 325]);
    expect(
      await codigoDaGravacao(
        rodar('financeiro.baixarRecebiveisCartao', {
          parcelas: [p1, p2],
          conta: m.contaA,
          dataCredito: HOJE,
        }),
      ),
    ).toBe('recebivel-cartao-ja-baixado');
    // O realizado entra pelo movimento da conta; o projetado fica só com o que falta.
    expect(await fluxo()).toEqual([
      [HOJE, 324.5, 'entrada', 'movimento', true],
      [dia(60), 325, 'entrada', 'receber', false],
      [dia(90), 325, 'entrada', 'receber', false],
    ]);
    const resto = await rodar('financeiro.baixarRecebiveisCartao', {
      parcelas: [p2, p3],
      conta: m.contaA,
      dataCredito: HOJE,
    });
    expect(resto.resultado).toMatchObject({
      parcelas: 2,
      creditado: 650,
      diferenca: 0,
      transacoesConciliadas: 1,
    });
    const [t] = await consultar('SELECT situacao FROM transacao_cartao WHERE id = ?', [transacao]);
    expect(t?.['situacao']).toBe('conciliada');
    const lista = await ler<Awaited<ReturnType<typeof recebiveisCartao>>>((l) =>
      recebiveisCartao(l, m.est, { de: HOJE, ate: dia(100), situacao: null, administradora }),
    );
    expect(lista.map((x) => [x.sequencia, x.de, x.situacao, x.valorRecebido, x.contaSugerida])).toEqual([
      [1, 3, 'recebida', 324.5, m.contaA],
      [2, 3, 'recebida', 325, m.contaA],
      [3, 3, 'recebida', 325, m.contaA],
    ]);
    const doOutro = await ler<Awaited<ReturnType<typeof recebiveisCartao>>>((l) =>
      recebiveisCartao(l, m.outroEst, { de: HOJE, ate: dia(100), situacao: null, administradora: null }),
    );
    expect(doOutro).toEqual([]);
    // Nada foi apagado: as três parcelas e a transação seguem no banco.
    const q = await consultar(
      'SELECT COUNT(*) AS q FROM parcela_recebivel_cartao WHERE transacao_cartao_id = ? AND excluido_em IS NULL',
      [transacao],
    );
    expect(n(q[0]?.['q'])).toBe(3);
  });
});
