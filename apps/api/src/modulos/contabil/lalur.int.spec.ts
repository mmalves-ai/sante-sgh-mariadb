// F7, 07-FIN linha 115 (C3-023): contrato de efeito do LALUR/LACS e da apuração e provisão do IRPJ e da CSLL contra o
// MariaDB real (massa SINTÉTICA "C3023", um estabelecimento próprio, exercício 2193 isolado; nenhuma pessoa real).
// A configuração grava as contas e alíquotas da provisão; as contas da parte B nascem com o saldo de abertura; a
// apuração trimestral abre só no trimestre civil; o ajuste da parte A com a parte B grava o lançamento ligado, e a baixa
// acima do saldo é recusada sem escrita. Apurar tira o lucro das partidas de resultado, compensa o prejuízo fiscal e a
// base negativa até 30% (ajuste de compensação e baixa na parte B) e grava as bases, o adicional e o valor a recolher;
// apurar de novo troca a compensação (nada duplica). Provisionar grava o lançamento contábil (despesa contra o tributo a
// recolher) e trava os ajustes; fechar grava a situação. No trimestre com prejuízo, o fechamento exige a conta e
// constitui o prejuízo do período na parte B.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CLIENTE,
  codigoDaGravacao,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from '../financeiro/aplicacao/massa-banco.spec-util.js';
import { detalheApuracaoLalur, OPERACOES_LALUR } from './lalur-propria.js';

const ANO = 2193;
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-c3023-${randomUUID()}` });

describe.skipIf(SEM_BANCO)('LALUR/LACS, apuração e provisão do IRPJ e da CSLL (MariaDB)', () => {
  let m: MassaFinanceiro;
  let est = 0;
  let plano = 0;
  const conta: Record<string, number> = {};
  const b: Record<string, number> = {};
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c3023' }, fn) as Promise<T>;
  const consultar = (sql: string, p: unknown[]) => ler<Record<string, unknown>[]>((l) => l.consultar(sql, p));
  const executar = (nome: keyof typeof OPERACOES_LALUR, entrada: unknown) =>
    m.nucleo
      .criarExecutor()
      .executar(OPERACOES_LALUR[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, est)))
      .then((r) => r.resultado as Record<string, unknown>);
  const versao = async (id: number) =>
    Number((await consultar('SELECT versao FROM apuracao_irpj_csll WHERE id = ?', [id]))[0]?.['versao']);
  const contagem = async (sql: string, p: unknown[]) => Number((await consultar(sql, p))[0]?.['n']);

  async function limpar(e: Escritor): Promise<void> {
    await e.executar(
      'DELETE m FROM movimento_lalur_parte_b m JOIN saldo_lalur_parte_b s ON s.id = m.saldo_lalur_parte_b_id WHERE s.estabelecimento_id = ?',
      [est],
    );
    await e.executar(
      'DELETE a FROM ajuste_lalur a JOIN apuracao_irpj_csll x ON x.id = a.apuracao_irpj_csll_id WHERE x.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM apuracao_irpj_csll WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM saldo_lalur_parte_b WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM configuracao_provisao_irpj_csll WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE p FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id WHERE l.estabelecimento_id = ?',
      [est],
    );
    await e.executar(
      'DELETE FROM lancamento_contabil WHERE estabelecimento_id = ? AND estornado_lancamento_contabil_id IS NOT NULL',
      [est],
    );
    await e.executar('DELETE FROM lancamento_contabil WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM periodo_contabil WHERE estabelecimento_id = ?', [est]);
    await limparTrilhaDaMassa(e, { ids: [est] });
  }

  beforeAll(async () => {
    m = await montarMassa();
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c3023' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      est = await g(
        "SELECT id FROM estabelecimento WHERE codigo = 'C3023A'",
        [],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        ['C3023A', 'ESTAB C3023A SINTETICO', 'ESTAB C3023A SINTETICO', agora],
      );
      await limpar(e);
      plano = await g(
        "SELECT id FROM plano_contas WHERE codigo = 'C3023'",
        [],
        "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('C3023', 'PLANO SINTETICO C3023', 'contabil', '9.9', 2, '2193-01-01', ?)",
        [agora],
      );
      for (const [cl, desc, nat, saldo] of [
        ['1.1', 'CAIXA', 'ativo', 'devedora'],
        ['2.8', 'CSLL A RECOLHER', 'passivo', 'credora'],
        ['2.9', 'IRPJ A RECOLHER', 'passivo', 'credora'],
        ['4.1', 'RECEITA DE SERVICOS', 'receita', 'credora'],
        ['5.1', 'DESPESAS GERAIS', 'despesa', 'devedora'],
        ['5.8', 'DESPESA DE CSLL', 'despesa', 'devedora'],
        ['5.9', 'DESPESA DE IRPJ', 'despesa', 'devedora'],
      ] as const)
        conta[cl] = await g(
          'SELECT id FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = ?',
          [plano, cl],
          `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza, natureza_saldo, tipo, criado_em)
           VALUES (?, ?, ?, ?, 2, ?, ?, 'analitica', ?)`,
          [plano, cl, `C3023${cl.replace('.', '')}`, desc, nat, saldo, agora],
        );
      const periodo: Record<string, number> = {};
      for (const mes of ['01', '02', '03'])
        periodo[mes] = await e.inserir(
          `INSERT INTO periodo_contabil (estabelecimento_id, competencia, exercicio, plano_contas_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, 'aberto', ?)`,
          [est, `${ANO}-${mes}-01`, ANO, plano, agora],
        );
      let numero = 0;
      const lancar = async (mes: string, debito: string, credito: string, valor: number) => {
        const l = await e.inserir(
          `INSERT INTO lancamento_contabil (estabelecimento_id, numero, periodo_contabil_id, data_lancamento, tipo, historico, valor_total, criado_em)
           VALUES (?, ?, ?, ?, 'manual', 'LANCAMENTO SINTETICO C3023', ?, ?)`,
          [est, 900000 + ++numero, periodo[mes], `${ANO}-${mes}-15`, valor, agora],
        );
        for (const [seq, lado, c] of [
          [1, 'debito', debito],
          [2, 'credito', credito],
        ] as const)
          await e.inserir(
            'INSERT INTO partida_contabil (lancamento_contabil_id, sequencia, lado, conta_contabil_id, valor, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [l, seq, lado, conta[c], valor, agora],
          );
      };
      await lancar('02', '1.1', '4.1', 500000);
      await lancar('03', '5.1', '1.1', 300000);
    });
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c3023' }, (e) => limpar(e));
    await m.nucleo.encerrar();
  });

  it('configuração, parte B, ajustes, apuração com compensação de 30%, provisão e fechamento', async () => {
    await executar('salvarConfiguracao', {
      estabelecimento: est,
      irpjDebito: conta['5.9'],
      irpjCredito: conta['2.9'],
      csllDebito: conta['5.8'],
      csllCredito: conta['2.8'],
    });
    for (const [codigo, tributo, saldo] of [
      ['PF', 'irpj', 100000],
      ['BN', 'csll', 50000],
      ['PROV', 'ambos', 0],
    ] as const)
      b[codigo] = Number(
        (
          await executar('incluirContaParteB', {
            estabelecimento: est,
            codigo,
            descricao: `CONTA ${codigo} SINTETICA`,
            tributo,
            natureza: 'devedor',
            saldoInicial: saldo,
            dataSaldoInicial: `${ANO}-01-01`,
          })
        )['conta'],
      );
    expect(
      await codigoDaGravacao(
        executar('abrirApuracao', {
          estabelecimento: est,
          forma: 'trimestral',
          inicio: `${ANO}-02-01`,
          fim: `${ANO}-04-30`,
        }),
      ),
    ).toBe('periodo-invalido');
    const ap = Number(
      (
        await executar('abrirApuracao', {
          estabelecimento: est,
          forma: 'trimestral',
          inicio: `${ANO}-01-01`,
          fim: `${ANO}-03-31`,
        })
      )['apuracao'],
    );
    const ajuste = (x: Record<string, unknown>) =>
      executar('incluirAjuste', { apuracao: ap, data: `${ANO}-03-31`, ...x });
    const r1 = await ajuste({
      tipo: 'adicao',
      descricao: 'PROVISAO INDEDUTIVEL SINTETICA',
      valor: 20000,
      codigoTabelaDinamica: '93',
      parteB: { conta: b['PROV'], efeito: 'constitui' },
    });
    expect(r1['movimento']).toBeTruthy();
    await ajuste({ tipo: 'exclusao', descricao: 'EXCLUSAO SINTETICA', valor: 10000, csll: false });
    expect(
      await codigoDaGravacao(
        ajuste({
          tipo: 'exclusao',
          descricao: 'BAIXA ACIMA',
          valor: 30000,
          parteB: { conta: b['PROV'], efeito: 'baixa' },
        }),
      ),
    ).toBe('baixa-acima-do-saldo');
    expect(
      await contagem('SELECT COUNT(*) AS n FROM ajuste_lalur WHERE apuracao_irpj_csll_id = ?', [ap]),
    ).toBe(2);

    const apurar = async () =>
      executar('apurar', {
        apuracao: ap,
        versao: await versao(ap),
        contaPrejuizo: b['PF'],
        contaBaseNegativa: b['BN'],
      });
    const r = await apurar();
    expect(r['lucroAntes']).toBe(200000_00);
    expect(r['compensacaoPrejuizo']).toBe(63000_00);
    expect(r['compensacaoBaseNegativa']).toBe(50000_00);
    expect(r['irpjRecolher']).toBe(30750_00);
    expect(r['csllRecolher']).toBe(15300_00);
    await apurar();
    const [a] = await consultar('SELECT * FROM apuracao_irpj_csll WHERE id = ?', [ap]);
    expect(a?.['situacao']).toBe('apurada');
    expect(Number(a?.['base_irpj'])).toBe(147000);
    expect(Number(a?.['valor_adicional_irpj'])).toBe(8700);
    expect(Number(a?.['base_csll'])).toBe(170000);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM ajuste_lalur WHERE apuracao_irpj_csll_id = ? AND tipo = 'compensacao_prejuizo' AND excluido_em IS NULL",
        [ap],
      ),
    ).toBe(2);
    const movs = await consultar(
      `SELECT s.codigo, m.natureza, m.valor FROM movimento_lalur_parte_b m JOIN saldo_lalur_parte_b s ON s.id = m.saldo_lalur_parte_b_id
        WHERE s.estabelecimento_id = ? AND m.excluido_em IS NULL ORDER BY s.codigo`,
      [est],
    );
    expect(movs.map((x) => `${String(x['codigo'])}:${String(x['natureza'])}:${Number(x['valor'])}`)).toEqual([
      'BN:credito:50000',
      'PF:credito:63000',
      'PROV:debito:20000',
    ]);

    const p = await executar('provisionar', { apuracao: ap, versao: await versao(ap) });
    const partidas = await consultar(
      `SELECT c.classificacao, p.lado, p.valor FROM partida_contabil p JOIN conta_contabil c ON c.id = p.conta_contabil_id
        WHERE p.lancamento_contabil_id = ? ORDER BY p.sequencia`,
      [p['lancamento']],
    );
    expect(
      partidas.map((x) => `${String(x['lado'])}:${String(x['classificacao'])}:${Number(x['valor'])}`),
    ).toEqual(['debito:5.9:30750', 'credito:2.9:30750', 'debito:5.8:15300', 'credito:2.8:15300']);
    const [prov] = await consultar(
      'SELECT situacao, provisao_lancamento_contabil_id AS l FROM apuracao_irpj_csll WHERE id = ?',
      [ap],
    );
    expect(prov?.['situacao']).toBe('provisionada');
    expect(Number(prov?.['l'])).toBe(Number(p['lancamento']));
    expect(await codigoDaGravacao(ajuste({ tipo: 'adicao', descricao: 'TARDE', valor: 1 }))).toBe(
      'apuracao-travada',
    );

    // Estorno da provisão: sem justificativa recusa sem escrita; com ela, o lançamento de estorno ligado à provisão
    // com os lados trocados, a apuração volta a apurada (ajustes reabertos) e um segundo estorno é recusado.
    const lancs = async () =>
      contagem('SELECT COUNT(*) AS n FROM lancamento_contabil WHERE estornado_lancamento_contabil_id = ?', [
        p['lancamento'],
      ]);
    expect(
      await codigoDaGravacao(
        executar('estornarProvisao', { apuracao: ap, versao: await versao(ap), justificativa: '' }),
      ),
    ).toBeTruthy();
    expect(await lancs()).toBe(0);
    const est1 = await executar('estornarProvisao', {
      apuracao: ap,
      versao: await versao(ap),
      justificativa: 'Provisão refeita após revisão',
    });
    const inversas = await consultar(
      `SELECT c.classificacao, p.lado, p.valor FROM partida_contabil p JOIN conta_contabil c ON c.id = p.conta_contabil_id
        WHERE p.lancamento_contabil_id = ? ORDER BY p.sequencia`,
      [est1['estorno']],
    );
    expect(
      inversas.map((x) => `${String(x['lado'])}:${String(x['classificacao'])}:${Number(x['valor'])}`),
    ).toEqual(['credito:5.9:30750', 'debito:2.9:30750', 'credito:5.8:15300', 'debito:2.8:15300']);
    expect(await lancs()).toBe(1);
    const [voltou] = await consultar(
      'SELECT situacao, provisao_lancamento_contabil_id AS l FROM apuracao_irpj_csll WHERE id = ?',
      [ap],
    );
    expect(voltou?.['situacao']).toBe('apurada');
    expect(voltou?.['l']).toBeNull();
    expect(
      await codigoDaGravacao(
        executar('estornarProvisao', {
          apuracao: ap,
          versao: await versao(ap),
          justificativa: 'De novo, por engano',
        }),
      ),
    ).toBe('apuracao-nao-provisionada');
    const p2 = await executar('provisionar', { apuracao: ap, versao: await versao(ap) });
    expect(Number(p2['lancamento'])).not.toBe(Number(p['lancamento']));

    await executar('fechar', { apuracao: ap, versao: await versao(ap) });
    const d = await ler((l) => detalheApuracaoLalur(l, ap));
    expect(d?.apuracao.situacao).toBe('fechada');
    expect(d?.ecf.linhas.filter((x) => x.startsWith('|M300|'))).toHaveLength(3);
    expect(d?.ecf.linhas.filter((x) => x.startsWith('|M350|'))).toHaveLength(2);
    expect(
      d?.ecf.linhas.some((x) => x.startsWith('|M500|PF|I|100000,00|D|63000,00|C|0,00|D|37000,00|D|')),
    ).toBe(true);
  }, 120_000);

  it('trimestre com prejuízo: fechamento exige a conta e constitui o prejuízo na parte B', async () => {
    const ap = Number(
      (
        await executar('abrirApuracao', {
          estabelecimento: est,
          forma: 'trimestral',
          inicio: `${ANO}-04-01`,
          fim: `${ANO}-06-30`,
        })
      )['apuracao'],
    );
    await executar('incluirAjuste', {
      apuracao: ap,
      tipo: 'exclusao',
      descricao: 'EXCLUSAO SINTETICA 2',
      data: `${ANO}-06-30`,
      valor: 5000,
    });
    const r = await executar('apurar', { apuracao: ap, versao: await versao(ap), contaPrejuizo: b['PF'] });
    expect(r['irpjRecolher']).toBe(0);
    expect(await codigoDaGravacao(executar('fechar', { apuracao: ap, versao: await versao(ap) }))).toBe(
      'sem-conta-parte-b',
    );
    const f = await executar('fechar', {
      apuracao: ap,
      versao: await versao(ap),
      contaPrejuizo: b['PF'],
      contaBaseNegativa: b['BN'],
    });
    expect(f['prejuizo']).toBe(5000_00);
    const [s] = await consultar(
      `SELECT SUM(CASE WHEN m.natureza = 'debito' THEN m.valor ELSE -m.valor END) AS liquido FROM movimento_lalur_parte_b m
        WHERE m.saldo_lalur_parte_b_id = ? AND m.excluido_em IS NULL`,
      [b['PF']],
    );
    expect(Number(s?.['liquido'])).toBe(-58000);
  }, 120_000);
});
