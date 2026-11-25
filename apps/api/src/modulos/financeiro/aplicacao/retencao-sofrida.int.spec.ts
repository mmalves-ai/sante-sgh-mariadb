// F3.8, 07-FIN linha 109: contrato de efeito da retenção SOFRIDA no recebimento, contra o MariaDB real (massa
// SINTÉTICA "L0207"; nenhuma pessoa real). A sugestão sai da regra vigente no momento "recebimento" sobre o valor da
// fatura; registrar grava o tributo retido na parcela a receber, abate o saldo dela e o líquido do título; o mesmo
// tributo não entra duas vezes e a soma não passa do saldo; o retido igual ao saldo quita a parcela e o título. O saldo
// a compensar soma só os títulos vivos deste estabelecimento; compensar fecha a apuração "retido por tomadores" com os
// itens e zera o saldo; crédito de mês futuro não compensa; repetir não gera outra. O estorno exige motivo, é recusado
// depois da compensação, devolve o saldo e não apaga a linha. A compensação é cancelada com motivo (a apuração fica
// "cancelada", os itens ficam, o crédito volta ao saldo). Registrar e estornar só entram em período financeiro aberto e
// a data futura é recusada, sem gravar nada. A regra do ISS com município é sugerida e ligada quando o município do
// serviço (o do estabelecimento prestador, sem nota de serviço no título) é o da regra.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_CONTABIL_FISCAL } from '../contabil-fiscal-propria.js';
import {
  compensacoesSofridas,
  OPERACOES_RETENCAO_SOFRIDA,
  retencaoSofridaDoTitulo,
  saldoRetencaoSofrida,
} from '../retencao-sofrida-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-rs-${randomUUID()}` });

describe.skipIf(SEM_BANCO)('retenção sofrida no recebimento e saldo a compensar (MariaDB)', () => {
  let m: MassaFinanceiro;
  let outroTributo = 0;
  let vivo = 0;
  let pequeno = 0;
  let doPeriodo = 0;
  let doIss = 0;
  let iss = 0;
  let issCriado = false;
  const escrever = (fn: Parameters<typeof m.nucleo.escrever>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'ajuste-rs-109' }, fn);
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'rs-109' }, (l) => l.consultar(sql, p));
  const ler = <T>(fn: Parameters<typeof m.nucleo.lerSomente<T>>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'rs-109' }, fn);
  const executar = (nome: keyof typeof OPERACOES_RETENCAO_SOFRIDA, entrada: unknown, est?: number) =>
    m.nucleo
      .criarExecutor()
      .executar(OPERACOES_RETENCAO_SOFRIDA[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, est)));
  const item = (tributo: number, valor: number, base = 2000, aliquota = 1.5) => ({
    tributo,
    base,
    aliquota,
    valor,
  });
  const registrar = (titulo: number, itens: unknown[], data = '2026-10-10') =>
    executar('financeiro.manterRetencaoSofrida', { acao: 'registrar', titulo, data, itens });
  const limparRegras = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-rs-109' }, async (e) => {
      await e.executar(
        `UPDATE retencao_titulo r JOIN regra_retencao g ON g.id = r.regra_retencao_id SET r.regra_retencao_id = NULL
          WHERE g.estabelecimento_id IN (?, ?) AND g.momento = 'recebimento'`,
        [m.est, m.outroEst],
      );
      await e.executar(
        "DELETE FROM regra_retencao WHERE estabelecimento_id IN (?, ?) AND momento = 'recebimento'",
        [m.est, m.outroEst],
      );
    });
  const estado = async (titulo: number) => {
    const [t] = await consultar(
      'SELECT situacao, valor_impostos, valor_liquido FROM titulo_receber WHERE id = ?',
      [titulo],
    );
    const [p] = await consultar(
      "SELECT saldo, situacao, DATE_FORMAT(quitada_em, '%Y-%m-%d') AS quitada FROM parcela_receber WHERE titulo_receber_id = ?",
      [titulo],
    );
    return {
      titulo: String(t?.['situacao']),
      impostos: Number(t?.['valor_impostos']),
      liquido: Number(t?.['valor_liquido']),
      saldo: Number(p?.['saldo']),
      parcela: String(p?.['situacao']),
      quitada: p?.['quitada'] ?? null,
    };
  };

  beforeAll(async () => {
    m = await montarMassa();
    await limparRegras();
    ({ outroTributo, vivo, pequeno, doPeriodo, doIss, iss, issCriado } = await m.nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-rs-109' },
      async (e) => {
        const agora = new Date();
        const um = async (sql: string, p: unknown[] = []) =>
          Number((await e.uma<{ id: number }>(sql, p))?.id);
        const outro =
          (await um('SELECT id FROM tributo WHERE codigo = ?', [`${P}-COFINS`])) ||
          (await e.inserir(
            `INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
             VALUES (?, 'COFINS SINTETICA L0207', 'federal', 'mensal', 'ambos', ?)`,
            [`${P}-COFINS`, agora],
          ));
        const natureza =
          (await um("SELECT id FROM natureza_financeira WHERE codigo = '9207.2.1'")) ||
          (await um("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'"));
        const tipoDoc = await um("SELECT id FROM tipo_documento_financeiro WHERE codigo = 'fatura'");
        const titulo = async (est: number, doc: string, valor: number, situacao: string, retido: number) => {
          const t = await e.inserir(
            `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
               tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
               situacao, cancelado_em, motivo_cancelamento, natureza_financeira_id, criado_em)
             VALUES (?, ?, 'fonte_pagadora', ?, 'avulso', ?, ?, '2026-10-05', '2026-10-05', ?, ?, ?, ?, ?, ?, ?)`,
            [
              est,
              `${P}-${doc}`,
              m.convenio,
              tipoDoc,
              doc,
              valor,
              valor,
              situacao,
              situacao === 'cancelado' ? agora : null,
              situacao === 'cancelado' ? 'CANCELAMENTO SINTETICO' : null,
              natureza,
              agora,
            ],
          );
          const p = await e.inserir(
            `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
             VALUES (?, 1, '2026-10-30', '2026-10-30', ?, ?, ?)`,
            [t, valor, valor, agora],
          );
          // O cancelado e o do outro estabelecimento já trazem retenção sofrida: ficam fora do saldo e da compensação.
          if (retido > 0)
            await e.inserir(
              `INSERT INTO retencao_titulo (parcela_receber_id, sequencia, tributo_id, momento, competencia, data_fato_gerador,
                 base_calculo, aliquota, valor_retido, criado_em)
               VALUES (?, 1, ?, 'recebimento', '2026-10-01', '2026-10-05', ?, 1.5, ?, ?)`,
              [p, m.tributo, valor, retido, agora],
            );
          return t;
        };
        const vivo = await titulo(m.est, 'RS1', 2000, 'aberto', 0);
        const pequeno = await titulo(m.est, 'RS4', 100, 'aberto', 0);
        await titulo(m.est, 'RS2', 400, 'cancelado', 6);
        await titulo(m.outroEst, 'RS3', 1000, 'aberto', 15);
        const doPeriodo = await titulo(m.est, 'RS5', 500, 'aberto', 0);
        const doIss = await titulo(m.est, 'RS6', 1000, 'aberto', 0);
        // A regra do ISS é reconhecida pela sigla: usa o tributo do cliente ou cria um (apagado no fim).
        const issExistente = await um("SELECT id FROM tributo WHERE codigo = 'ISS'");
        const iss =
          issExistente ||
          (await e.inserir(
            `INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
             VALUES ('ISS', 'ISS SINTETICO L0207', 'municipal', 'mensal', 'ambos', ?)`,
            [agora],
          ));
        return { outroTributo: outro, vivo, pequeno, doPeriodo, doIss, iss, issCriado: !issExistente };
      },
    ));
    // A regra do recebimento: 1,5% sobre o valor da fatura (a do pagamento, se houver, não vale aqui).
    await m.nucleo.criarExecutor().executar(
      OPERACOES_CONTABIL_FISCAL['financeiro.manterRegraRetencao'] as never,
      CLIENTE,
      {
        acao: 'incluir',
        tributo: m.tributo,
        descricao: 'RETIDO PELO TOMADOR SINTETICO',
        momento: 'recebimento',
        participante: 'pessoa_juridica',
        municipio: null,
        percentualBase: 100,
        aliquota: 1.5,
        faixaInicio: null,
        faixaFim: null,
        deducao: 0,
        minimo: 0,
        maximo: null,
        codigoReceita: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
      op(m.ctx(m.lanca)),
    );
  });

  afterAll(async () => {
    if (!m) return;
    await limparRegras();
    await escrever(async (e) => {
      await e.executar('UPDATE estabelecimento SET municipio_ibge_id = NULL WHERE id = ?', [m.est]);
    });
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    if (issCriado)
      await escrever(async (e) => {
        await e.executar("DELETE FROM tributo WHERE id = ? AND descricao = 'ISS SINTETICO L0207'", [iss]);
      });
    await m.nucleo.encerrar();
  });

  it('sugere pela regra do recebimento, grava o retido na parcela e abate o saldo e o líquido do título', async () => {
    const antes = await ler((l) => retencaoSofridaDoTitulo(l, m.est, vivo, '2026-10-10'));
    expect(antes?.emAberto).toBe(true);
    expect(antes?.saldoParcela).toBe(2000);
    expect(antes?.sugestoes.map((s) => [s.tributoId, s.base, s.aliquota, s.valor, s.dispensada])).toEqual([
      [m.tributo, 2000, 1.5, 30, false],
    ]);
    // Outro estabelecimento não enxerga o título.
    expect(await ler((l) => retencaoSofridaDoTitulo(l, m.outroEst, vivo, '2026-10-10'))).toBeNull();
    expect(
      await codigoDaGravacao(
        executar(
          'financeiro.manterRetencaoSofrida',
          { acao: 'registrar', titulo: vivo, data: '2026-10-10', itens: [item(m.tributo, 30)] },
          m.outroEst,
        ),
      ),
    ).toBe('titulo-inexistente');

    const r = await registrar(vivo, [item(m.tributo, 30)]);
    expect(r.resultado).toMatchObject({ acao: 'registrar', retencoes: 1, valor: 30, saldo: 1970 });
    const linhas = await consultar(
      `SELECT r.tributo_id, r.momento, DATE_FORMAT(r.competencia, '%Y-%m-%d') AS competencia, r.base_calculo, r.aliquota,
              r.valor_retido, r.regra_retencao_id, r.parcela_pagar_id
         FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ?`,
      [vivo],
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      momento: 'recebimento',
      competencia: '2026-10-01',
      parcela_pagar_id: null,
    });
    expect(Number(linhas[0]?.['tributo_id'])).toBe(m.tributo);
    expect(Number(linhas[0]?.['valor_retido'])).toBe(30);
    expect(Number(linhas[0]?.['regra_retencao_id'])).toBeGreaterThan(0);
    expect(await estado(vivo)).toEqual({
      titulo: 'aberto',
      impostos: 30,
      liquido: 1970,
      saldo: 1970,
      parcela: 'aberta',
      quitada: null,
    });
    // A sugestão some depois de registrada (o tributo já está na parcela).
    const depois = await ler((l) => retencaoSofridaDoTitulo(l, m.est, vivo, '2026-10-10'));
    expect(depois?.sugestoes).toEqual([]);
    expect(depois?.retencoes.map((x) => [x.tributoId, x.valor, x.compensada])).toEqual([
      [m.tributo, 30, false],
    ]);
  });

  it('recusa o tributo repetido na parcela e a soma acima do saldo, sem gravar nada', async () => {
    expect(await codigoDaGravacao(registrar(vivo, [item(m.tributo, 30)]))).toBe('tributo-ja-retido');
    expect(await codigoDaGravacao(registrar(vivo, [item(outroTributo, 1970.01, 2000, 99)]))).toBe(
      'retido-maior-que-saldo',
    );
    expect((await estado(vivo)).saldo).toBe(1970);
    const [n] = await consultar(
      'SELECT COUNT(*) AS n FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ?',
      [vivo],
    );
    expect(Number(n?.['n'])).toBe(1);
  });

  it('o estorno exige motivo, devolve o saldo e mantém a linha com o motivo', async () => {
    await registrar(vivo, [item(outroTributo, 60, 2000, 3)]);
    expect((await estado(vivo)).saldo).toBe(1910);
    const [ret] = await consultar(
      'SELECT r.id FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ? AND r.tributo_id = ?',
      [vivo, outroTributo],
    );
    const estornar = (motivo: string) =>
      executar('financeiro.manterRetencaoSofrida', {
        acao: 'estornar',
        titulo: vivo,
        retencao: Number(ret?.['id']),
        motivo,
      });
    expect(await codigoDaGravacao(estornar('oi'))).toBe('sem-motivo');
    await estornar('RETIDO INFORMADO ERRADO');
    const [linha] = await consultar(
      'SELECT excluido_em, excluido_por, motivo_estorno, valor_retido FROM retencao_titulo WHERE id = ?',
      [ret?.['id']],
    );
    expect(linha?.['excluido_em']).not.toBeNull();
    expect(Number(linha?.['excluido_por'])).toBe(m.lanca);
    expect(linha?.['motivo_estorno']).toBe('RETIDO INFORMADO ERRADO');
    expect(Number(linha?.['valor_retido'])).toBe(60);
    expect(await estado(vivo)).toMatchObject({ titulo: 'aberto', impostos: 30, liquido: 1970, saldo: 1970 });
    expect(await codigoDaGravacao(estornar('DE NOVO, POR ENGANO'))).toBe('nao-encontrado');
  });

  it('saldo a compensar só dos títulos vivos do estabelecimento; compensar fecha a apuração e zera o saldo', async () => {
    const saldo = () => ler((l) => saldoRetencaoSofrida(l, m.est));
    expect((await saldo()).filter((s) => s.aCompensar > 0)).toEqual([
      {
        tributo: `${P}-IRRF`,
        tributoId: m.tributo,
        retido: 30,
        compensado: 0,
        aCompensar: 30,
        desde: '2026-10',
        creditos: [{ competencia: '2026-10', valor: 30 }],
      },
    ]);
    const compensar = (competencia: string, est?: number) =>
      executar('financeiro.compensarRetencaoSofrida', { competencia, tributo: m.tributo }, est);
    // Crédito de outubro não compensa tributo de setembro.
    expect(await codigoDaGravacao(compensar('2026-09'))).toBe('sem-credito');
    const r = await compensar('2026-10');
    expect(r.resultado).toMatchObject({ retencoes: 1, valor: 30 });
    const [a] = await consultar(
      `SELECT sentido, situacao, valor_total, valor_base_total, DATE_FORMAT(competencia_fim, '%Y-%m-%d') AS fim,
              fechador_usuario_id,
              (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id AND i.parcela_receber_id IS NOT NULL) AS itens
         FROM apuracao_retencao a WHERE estabelecimento_id = ? AND tributo_id = ?`,
      [m.est, m.tributo],
    );
    expect(a).toMatchObject({ sentido: 'retido_por_tomadores', situacao: 'fechada', fim: '2026-10-01' });
    expect(Number(a?.['valor_total'])).toBe(30);
    expect(Number(a?.['valor_base_total'])).toBe(2000);
    expect(Number(a?.['itens'])).toBe(1);
    expect(Number(a?.['fechador_usuario_id'])).toBe(m.lanca);
    expect((await saldo()).map((s) => [s.tributoId, s.retido, s.compensado, s.aCompensar, s.desde])).toEqual([
      [m.tributo, 30, 30, 0, null],
    ]);
    // Repetir não gera outra apuração; o outro estabelecimento compensa só o dele.
    expect(await codigoDaGravacao(compensar('2026-10'))).toBe('sem-credito');
    expect((await compensar('2026-10', m.outroEst)).resultado).toMatchObject({ retencoes: 1, valor: 15 });
    const [n] = await consultar(
      'SELECT COUNT(*) AS n FROM apuracao_retencao WHERE estabelecimento_id IN (?, ?)',
      [m.est, m.outroEst],
    );
    expect(Number(n?.['n'])).toBe(2);
    // A retenção compensada não pode mais ser estornada.
    const [ret] = await consultar(
      'SELECT r.id FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ? AND r.excluido_em IS NULL',
      [vivo],
    );
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterRetencaoSofrida', {
          acao: 'estornar',
          titulo: vivo,
          retencao: Number(ret?.['id']),
          motivo: 'TENTATIVA DEPOIS DA COMPENSACAO',
        }),
      ),
    ).toBe('retencao-compensada');
  });

  it('a compensação é cancelada com motivo: a apuração fica cancelada, os itens ficam e o crédito volta ao saldo', async () => {
    const vivas = await ler((l) => compensacoesSofridas(l, m.est));
    expect(vivas.map((c) => [c.tributoId, c.competencia, c.valor, c.retencoes])).toEqual([
      [m.tributo, '2026-10', 30, 1],
    ]);
    const apuracao = vivas[0]?.id ?? 0;
    const cancelar = (motivo: string, est?: number) =>
      executar('financeiro.cancelarCompensacaoSofrida', { apuracao, motivo }, est);
    expect(await codigoDaGravacao(cancelar('oi'))).toBe('sem-motivo');
    expect(await codigoDaGravacao(cancelar('COMPETENCIA ERRADA', m.outroEst))).toBe('nao-encontrado');
    const [antes] = await consultar('SELECT situacao FROM apuracao_retencao WHERE id = ?', [apuracao]);
    expect(antes?.['situacao']).toBe('fechada');

    const r = await cancelar('COMPETENCIA ERRADA NO FILTRO');
    expect(r.resultado).toMatchObject({ apuracao, retencoes: 1, valor: 30 });
    const [a] = await consultar(
      `SELECT situacao, cancelado_em, cancelado_por, motivo_cancelamento, excluido_em, valor_total,
              (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id AND i.excluido_em IS NULL) AS itens
         FROM apuracao_retencao a WHERE id = ?`,
      [apuracao],
    );
    expect(a).toMatchObject({
      situacao: 'cancelada',
      motivo_cancelamento: 'COMPETENCIA ERRADA NO FILTRO',
      excluido_em: null,
    });
    expect(a?.['cancelado_em']).not.toBeNull();
    expect(Number(a?.['cancelado_por'])).toBe(m.lanca);
    expect(Number(a?.['valor_total'])).toBe(30);
    expect(Number(a?.['itens'])).toBe(1);
    // O crédito voltou ao saldo, a retenção deixou de estar compensada e a lista das vivas ficou vazia.
    expect(
      (await ler((l) => saldoRetencaoSofrida(l, m.est))).map((s) => [
        s.tributoId,
        s.retido,
        s.compensado,
        s.aCompensar,
        s.desde,
      ]),
    ).toEqual([[m.tributo, 30, 0, 30, '2026-10']]);
    expect(
      (await ler((l) => retencaoSofridaDoTitulo(l, m.est, vivo, '2026-10-10')))?.retencoes.map(
        (x) => x.compensada,
      ),
    ).toEqual([false]);
    expect(await ler((l) => compensacoesSofridas(l, m.est))).toEqual([]);
    expect(await codigoDaGravacao(cancelar('DE NOVO, POR ENGANO'))).toBe('compensacao-cancelada');
    // O mesmo crédito compensa de novo, em outra apuração (a cancelada continua gravada).
    const de_novo = await executar('financeiro.compensarRetencaoSofrida', {
      competencia: '2026-11',
      tributo: m.tributo,
    });
    expect(de_novo.resultado).toMatchObject({ retencoes: 1, valor: 30 });
    const linhas = await consultar(
      'SELECT situacao, numero FROM apuracao_retencao WHERE estabelecimento_id = ? AND tributo_id = ? ORDER BY id',
      [m.est, m.tributo],
    );
    expect(linhas.map((x) => x['situacao'])).toEqual(['cancelada', 'fechada']);
    expect(new Set(linhas.map((x) => x['numero'])).size).toBe(2);
  });

  it('período financeiro fechado e data futura: registrar e estornar são recusados sem gravar nada', async () => {
    const fechar = (competencia: string) =>
      escrever(async (e) => {
        await e.executar(
          "INSERT INTO periodo_financeiro (estabelecimento_id, competencia, situacao, fechado_em, criado_em) VALUES (?, ?, 'fechado', ?, ?)",
          [m.est, competencia, new Date(), new Date()],
        );
      });
    const vivas = async () =>
      Number(
        (
          await consultar(
            'SELECT COUNT(*) AS n FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ? AND r.excluido_em IS NULL',
            [doPeriodo],
          )
        )[0]?.['n'],
      );
    const intacto = {
      titulo: 'aberto',
      impostos: 0,
      liquido: 500,
      saldo: 500,
      parcela: 'aberta',
      quitada: null,
    };
    try {
      await fechar('2026-08-01');
      // Agosto está fechado: nem a data do mês fechado nem a de mês anterior a ele entram.
      expect(await codigoDaGravacao(registrar(doPeriodo, [item(m.tributo, 7.5, 500)], '2026-08-20'))).toBe(
        'periodo-fechado',
      );
      expect(await codigoDaGravacao(registrar(doPeriodo, [item(m.tributo, 7.5, 500)], '2026-07-31'))).toBe(
        'periodo-fechado',
      );
      expect(await codigoDaGravacao(registrar(doPeriodo, [item(m.tributo, 7.5, 500)], '2099-01-01'))).toBe(
        'data-futura',
      );
      expect(await estado(doPeriodo)).toEqual(intacto);
      expect(await vivas()).toBe(0);
      // Em setembro (aberto) entra; fechado setembro, o estorno é recusado e nada muda.
      await registrar(doPeriodo, [item(m.tributo, 7.5, 500)], '2026-09-10');
      expect(await estado(doPeriodo)).toMatchObject({ impostos: 7.5, liquido: 492.5, saldo: 492.5 });
      await fechar('2026-09-01');
      const [ret] = await consultar(
        'SELECT r.id FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id WHERE p.titulo_receber_id = ? AND r.excluido_em IS NULL',
        [doPeriodo],
      );
      const estornar = () =>
        executar('financeiro.manterRetencaoSofrida', {
          acao: 'estornar',
          titulo: doPeriodo,
          retencao: Number(ret?.['id']),
          motivo: 'ESTORNO EM MES FECHADO',
        });
      expect(await codigoDaGravacao(estornar())).toBe('periodo-fechado');
      expect(await vivas()).toBe(1);
      expect(await estado(doPeriodo)).toMatchObject({ impostos: 7.5, liquido: 492.5, saldo: 492.5 });
      // Reaberto o período, o estorno entra.
      await escrever(async (e) => {
        await e.executar('DELETE FROM periodo_financeiro WHERE estabelecimento_id = ?', [m.est]);
      });
      await estornar();
      expect(await vivas()).toBe(0);
      expect(await estado(doPeriodo)).toEqual(intacto);
    } finally {
      await escrever(async (e) => {
        await e.executar('DELETE FROM periodo_financeiro WHERE estabelecimento_id = ?', [m.est]);
      });
    }
  });

  it('a regra do ISS com município é sugerida e ligada quando o município do serviço é o da regra', async () => {
    const municipios = (await consultar('SELECT id FROM municipio_ibge ORDER BY id LIMIT 2', [])).map((x) =>
      Number(x['id']),
    );
    const [daRegra, outro] = [municipios[0] ?? 0, municipios[1] ?? 0];
    expect(outro).toBeGreaterThan(0);
    const doEstabelecimento = (municipio: number | null) =>
      escrever(async (e) => {
        await e.executar('UPDATE estabelecimento SET municipio_ibge_id = ? WHERE id = ?', [municipio, m.est]);
      });
    await m.nucleo.criarExecutor().executar(
      OPERACOES_CONTABIL_FISCAL['financeiro.manterRegraRetencao'] as never,
      CLIENTE,
      {
        acao: 'incluir',
        tributo: iss,
        descricao: 'ISS RETIDO PELO TOMADOR SINTETICO',
        momento: 'recebimento',
        participante: 'pessoa_juridica',
        municipio: daRegra,
        percentualBase: 100,
        aliquota: 2,
        faixaInicio: null,
        faixaFim: null,
        deducao: 0,
        minimo: 0,
        maximo: null,
        codigoReceita: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
      op(m.ctx(m.lanca)),
    );
    const [regra] = await consultar(
      "SELECT id FROM regra_retencao WHERE estabelecimento_id = ? AND tributo_id = ? AND municipio_ibge_id = ? AND momento = 'recebimento'",
      [m.est, iss, daRegra],
    );
    expect(Number(regra?.['id'])).toBeGreaterThan(0);
    const sugestaoIss = async () =>
      (await ler((l) => retencaoSofridaDoTitulo(l, m.est, doIss, '2026-10-10')))?.sugestoes
        .filter((s) => s.tributoId === iss)
        .map((s) => [s.regra, s.base, s.aliquota, s.valor, s.dispensada]);
    // Sem município conhecido e com o serviço em outro município, a regra não vale.
    await doEstabelecimento(null);
    expect(await sugestaoIss()).toEqual([]);
    await doEstabelecimento(outro);
    expect(await sugestaoIss()).toEqual([]);
    // No município da regra, o ISS é sugerido; o tributo fora da sugestão continua na lista dos que podem entrar.
    await doEstabelecimento(daRegra);
    expect(await sugestaoIss()).toEqual([[Number(regra?.['id']), 1000, 2, 20, false]]);
    const ficha = await ler((l) => retencaoSofridaDoTitulo(l, m.est, doIss, '2026-10-10'));
    expect(ficha?.municipio).toBe(daRegra);
    expect(ficha?.tributos.map((x) => x.id)).toEqual(expect.arrayContaining([iss, m.tributo, outroTributo]));

    await registrar(doIss, [item(iss, 20, 1000, 2)]);
    const [linha] = await consultar(
      `SELECT r.regra_retencao_id, r.valor_retido FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id
        WHERE p.titulo_receber_id = ? AND r.tributo_id = ? AND r.excluido_em IS NULL`,
      [doIss, iss],
    );
    expect(Number(linha?.['regra_retencao_id'])).toBe(Number(regra?.['id']));
    expect(Number(linha?.['valor_retido'])).toBe(20);
    expect(await estado(doIss)).toMatchObject({ impostos: 20, liquido: 980, saldo: 980 });
    // Tributo fora da regra (o tomador reteve sem regra cadastrada): entra sem regra ligada.
    await registrar(doIss, [item(outroTributo, 30, 1000, 3)]);
    const [semRegra] = await consultar(
      `SELECT r.regra_retencao_id FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id
        WHERE p.titulo_receber_id = ? AND r.tributo_id = ? AND r.excluido_em IS NULL`,
      [doIss, outroTributo],
    );
    expect(semRegra?.['regra_retencao_id']).toBeNull();
    expect((await estado(doIss)).saldo).toBe(950);
  });

  it('o retido igual ao saldo quita a parcela e o título, na data do recebimento', async () => {
    await registrar(pequeno, [item(outroTributo, 100, 100, 100)], '2026-11-03');
    expect(await estado(pequeno)).toEqual({
      titulo: 'recebido',
      impostos: 100,
      liquido: 0,
      saldo: 0,
      parcela: 'recebida',
      quitada: '2026-11-03',
    });
    expect(await codigoDaGravacao(registrar(pequeno, [item(m.tributo, 1, 100, 1)]))).toBe(
      'titulo-ja-baixado',
    );
  });
});
