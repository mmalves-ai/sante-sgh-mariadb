// Remuneração variável no MariaDB real (cliente f22_o5; massa SINTÉTICA com o prefixo "C2083", nenhuma pessoa real),
// F8, 07-FIN linha 157. Contrato de efeito:
//   - o mínimo garantido, o percentual do resultado e a meta (com as faixas) ficam nas tabelas próprias; regra que
//     cruza outra vigente e faixas sobrepostas são recusadas sem gravar;
//   - o valor apurado da meta corrigido marca `substituida_em` na linha anterior (as duas ficam);
//   - lançar na apuração grava um `lancamento_repasse` por crédito (complemento do mínimo, resultado, produtividade)
//     com o favorecido próprio e o evento da regra, um `desconto_custo_repasse` por custo do prestador, e soma os
//     totais da apuração; lançar de novo não duplica; a apuração aprovada recusa;
//   - encerrar grava `vigencia_fim`, não estende e não apaga.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRemuneracaoVariavelPropria } from './remuneracao-variavel-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2083';
const COMP = '2026-10-01';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  return e.inserir(ins, pi);
}

async function recusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
  return 'gravou';
}

describe.skipIf(SEM_BANCO)('remuneração variável do profissional (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRemuneracaoVariavelPropria;
  const ids = {
    est: 0,
    usuario: 0,
    prof: 0,
    evento: 0,
    indicador: 0,
    centro: 0,
    apuracao: 0,
    aprovada: 0,
    tipoDesconto: 0,
    minimo: 0,
    meta: 0,
  };
  const c = () => ({ cliente: CLIENTE, hospital: P, usuario: ids.usuario, correlacao: 't-c2083' });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2083' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const limpar = (e: Escritor) =>
    (async () => {
      const ap = 'SELECT id FROM apuracao_repasse WHERE estabelecimento_id = ?';
      // C2-093: o lançamento publica o fato contábil do repasse (estornos antes).
      await e.executar(
        'DELETE FROM fato_contabil WHERE estabelecimento_id = ? AND estornado_fato_contabil_id IS NOT NULL',
        [ids.est],
      );
      await e.executar('DELETE FROM fato_contabil WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(`DELETE FROM desconto_custo_repasse WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar(`DELETE FROM apuracao_repasse_item WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar('DELETE FROM apuracao_repasse WHERE estabelecimento_id = ?', [ids.est]);
      const meta = 'SELECT id FROM meta_produtividade_repasse WHERE estabelecimento_id = ?';
      await e.executar(
        `DELETE FROM apuracao_meta_produtividade WHERE meta_produtividade_repasse_id IN (${meta})`,
        [ids.est],
      );
      await e.executar(
        `DELETE FROM meta_produtividade_repasse_faixa WHERE meta_produtividade_repasse_id IN (${meta})`,
        [ids.est],
      );
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      await e.executar('DELETE FROM meta_produtividade_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM regra_repasse_minimo_garantido WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM regra_repasse_resultado WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM custo_profissional WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM favorecido_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE FROM apuracao_custo_centro WHERE apuracao_custo_id IN (SELECT id FROM apuracao_custo WHERE estabelecimento_id = ?)',
        [ids.est],
      );
      await e.executar('DELETE FROM apuracao_custo WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRemuneracaoVariavelPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2083' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c2083.analista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2083.analista', 'USUARIO SINTETICO C2083', agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`MEDICO SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`MEDICO SINTETICO ${P}`, agora],
      );
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids.evento = await garantir(
        e,
        'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-VAR`],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'REMUNERACAO VARIAVEL C2083', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.est, `${P}-VAR`, agora],
      );
      ids.indicador = await garantir(
        e,
        'SELECT id FROM indicador_produtividade WHERE codigo = ?',
        [`${P}-SAT`],
        "INSERT INTO indicador_produtividade (codigo, descricao, dimensao, unidade, criado_em) VALUES (?, 'SATISFACAO SINTETICA C2083', 'satisfacao', '%', ?)",
        [`${P}-SAT`, agora],
      );
      ids.centro = await garantir(
        e,
        'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-CC`],
        `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, sigla, vigencia_inicio, ativo, criado_em)
         VALUES (?, ?, 'CENTRO SINTETICO C2083', 'C83', '2025-01-01', TRUE, ?)`,
        [ids.est, `${P}-CC`, agora],
      );
      ids.tipoDesconto = await garantir(
        e,
        'SELECT id FROM tipo_desconto_repasse WHERE codigo = ?',
        [`${P}-SALA`],
        "INSERT INTO tipo_desconto_repasse (codigo, descricao, natureza, criado_em) VALUES (?, 'USO DE SALA C2083', 'custo', ?)",
        [`${P}-SALA`, agora],
      );
      // Custeio apurado da competência: margem do centro 50.000 − 30.000 = 20.000.
      const ac = await e.inserir(
        "INSERT INTO apuracao_custo (estabelecimento_id, competencia, situacao, criado_em) VALUES (?, ?, 'apurada', ?)",
        [ids.est, COMP, agora],
      );
      await e.inserir(
        `INSERT INTO apuracao_custo_centro (apuracao_custo_id, centro_custo_id, classe, custo_final, valor_receita, criado_em)
         VALUES (?, ?, 'produtivo', 30000, 50000, ?)`,
        [ac, ids.centro, agora],
      );
      const apuracao = (numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, iniciada_em, iniciada_por_usuario_id,
             valor_faturado, valor_bruto, valor_liquido, situacao, concluida_em, aprovada_em, criado_em)
           VALUES (?, ?, ?, 'producao', ?, ?, 8000, 6000, 6000, ?, ?, ?, ?)`,
          [
            ids.est,
            numero,
            COMP,
            agora,
            ids.usuario,
            situacao,
            agora,
            situacao === 'aprovada' ? agora : null,
            agora,
          ],
        );
      ids.apuracao = await apuracao(`${P}-1`, 'apurada');
      ids.aprovada = await apuracao(`${P}-2`, 'aprovada');
      for (const a of [ids.apuracao, ids.aprovada])
        await e.inserir(
          `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, competencia_producao,
             valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, 1, ?, ?, 8000, 75, 6000, ?)`,
          [a, ids.prof, COMP, agora],
        );
      await e.inserir(
        `INSERT INTO favorecido_repasse (estabelecimento_id, profissional_id, tipo_favorecido, percentual, vigencia_inicio, ativo, criado_em)
         VALUES (?, ?, 'proprio_profissional', 100, '2026-01-01', TRUE, ?)`,
        [ids.est, ids.prof, agora],
      );
      // Custo do prestador: 500 fixos por mês e 2% da produção cobrados uma única vez.
      await e.inserir(
        `INSERT INTO custo_profissional (estabelecimento_id, profissional_id, tipo_desconto_repasse_id, descricao, forma_calculo, valor, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, 'SALA', 'valor', 500, '2026-01-01', ?)`,
        [ids.est, ids.prof, ids.tipoDesconto, agora],
      );
      await e.inserir(
        `INSERT INTO custo_profissional (estabelecimento_id, profissional_id, tipo_desconto_repasse_id, descricao, forma_calculo, percentual, frequencia, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, 'ADESAO', 'percentual', 2, 'unica', '2026-01-01', ?)`,
        [ids.est, ids.prof, ids.tipoDesconto, agora],
      );
    });
  });

  afterAll(async () => {
    if (ids.est)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2083' }, async (e) => {
        await limpar(e);
        await e.executar('DELETE FROM indicador_produtividade WHERE codigo = ?', [`${P}-SAT`]);
      });
    await nucleo.encerrar();
  });

  it('grava as regras e recusa a que cruza outra vigente sem gravar', async () => {
    const m = await porta.incluirMinimo(c(), {
      profissional: ids.prof,
      valorMinimo: 10000,
      evento: ids.evento,
      inicio: '2026-01-01',
    });
    ids.minimo = m.id;
    const linha = await um(
      'SELECT valor_minimo, evento_repasse_id, complemento_automatico, vigencia_fim, criado_por FROM regra_repasse_minimo_garantido WHERE id = ?',
      [m.id],
    );
    expect(Number(linha?.['valor_minimo'])).toBe(10000);
    expect(Number(linha?.['evento_repasse_id'])).toBe(ids.evento);
    expect(Number(linha?.['criado_por'])).toBe(ids.usuario);
    expect(
      await recusa(
        porta.incluirMinimo(c(), {
          profissional: ids.prof,
          valorMinimo: 9000,
          evento: ids.evento,
          inicio: '2026-06-01',
        }),
      ),
    ).toBe('regra-violada');
    await porta.incluirResultado(c(), {
      profissional: ids.prof,
      centroCusto: ids.centro,
      evento: ids.evento,
      percentual: 10,
      inicio: '2026-01-01',
    });
    expect(
      await recusa(
        porta.incluirResultado(c(), {
          profissional: ids.prof,
          centroCusto: ids.centro,
          evento: ids.evento,
          percentual: 120,
          inicio: '2027-01-01',
        }),
      ),
    ).toBe('regra-violada');
    expect(
      (await contar('SELECT COUNT(*) AS n FROM regra_repasse_minimo_garantido WHERE estabelecimento_id = ?', [
        ids.est,
      ])) +
        (await contar('SELECT COUNT(*) AS n FROM regra_repasse_resultado WHERE estabelecimento_id = ?', [
          ids.est,
        ])),
    ).toBe(2);
  });

  it('meta com faixas: grava a meta e as faixas; faixas sobrepostas recusadas sem gravar', async () => {
    expect(
      await recusa(
        porta.incluirMeta(c(), {
          profissional: ids.prof,
          indicador: ids.indicador,
          evento: ids.evento,
          forma: 'percentual_producao',
          peso: 50,
          inicio: '2026-01-01',
          faixas: [
            { de: 80, ate: 95, premio: 5 },
            { de: 90, ate: null, premio: 10 },
          ],
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM meta_produtividade_repasse WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(0);
    const m = await porta.incluirMeta(c(), {
      profissional: ids.prof,
      indicador: ids.indicador,
      evento: ids.evento,
      forma: 'percentual_producao',
      peso: 50,
      inicio: '2026-01-01',
      faixas: [
        { de: 90, ate: null, premio: 10 },
        { de: 80, ate: 89.99, premio: 5 },
      ],
    });
    ids.meta = m.id;
    const f = await um(
      `SELECT COUNT(*) AS n, MIN(CASE WHEN sequencia = 1 THEN limite_inicial END) AS primeira
         FROM meta_produtividade_repasse_faixa WHERE meta_produtividade_repasse_id = ?`,
      [m.id],
    );
    expect(Number(f?.['n'])).toBe(2);
    expect(Number(f?.['primeira'])).toBe(80);
  });

  it('valor apurado corrigido: a anterior fica marcada como substituída', async () => {
    await porta.informarApurado(c(), ids.meta, { competencia: COMP, valor: 92 });
    await porta.informarApurado(c(), ids.meta, { competencia: COMP, valor: 85, observacao: 'revisado' });
    const r = await um(
      `SELECT COUNT(*) AS n, SUM(substituida_em IS NULL) AS vigentes,
              MAX(CASE WHEN substituida_em IS NULL THEN valor_apurado END) AS valor
         FROM apuracao_meta_produtividade WHERE meta_produtividade_repasse_id = ?`,
      [ids.meta],
    );
    expect([Number(r?.['n']), Number(r?.['vigentes']), Number(r?.['valor'])]).toEqual([2, 1, 85]);
    expect(await recusa(porta.informarApurado(c(), ids.meta, { competencia: '2026-10-15', valor: 1 }))).toBe(
      'regra-violada',
    );
  });

  it('simula sem gravar: complemento, resultado, produtividade e custos do prestador', async () => {
    const s = await porta.simular(c(), ids.apuracao, ids.prof);
    expect(s.profissionais).toHaveLength(1);
    const p = s.profissionais[0]!;
    expect(p.producao).toBe(6000);
    expect(p.itens.map((i) => [i.tipo, i.valor, i.lancado])).toEqual([
      ['complemento_minimo', 4000, false],
      ['resultado', 2000, false],
      ['produtividade', 150, false],
      ['custo', 500, false],
      ['custo', 120, false],
    ]);
    expect([p.credito, p.debito]).toEqual([6150, 620]);
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_repasse WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(0);
  });

  it('lança na apuração: créditos, descontos e totais; lançar de novo não duplica', async () => {
    const r = await porta.lancar(c(), ids.apuracao, null);
    expect([r.lancamentos, r.descontos, r.credito, r.debito]).toEqual([3, 2, 6150, 620]);
    const l = await um(
      `SELECT COUNT(*) AS n, SUM(valor) AS total, SUM(tipo_lancamento = 'apuracao' AND evento_repasse_id = ?
              AND favorecido_repasse_id IS NOT NULL AND valor_calculado AND situacao = 'aberto') AS conformes
         FROM lancamento_repasse WHERE apuracao_repasse_id = ? AND profissional_id = ?`,
      [ids.evento, ids.apuracao, ids.prof],
    );
    expect([Number(l?.['n']), Number(l?.['total']), Number(l?.['conformes'])]).toEqual([3, 6150, 3]);
    const d = await um(
      `SELECT COUNT(*) AS n, SUM(valor) AS total, SUM(tipo_desconto_repasse_id = ? AND custo_profissional_id IS NOT NULL) AS conformes
         FROM desconto_custo_repasse WHERE apuracao_repasse_id = ?`,
      [ids.tipoDesconto, ids.apuracao],
    );
    expect([Number(d?.['n']), Number(d?.['total']), Number(d?.['conformes'])]).toEqual([2, 620, 2]);
    const a = await um(
      'SELECT valor_bruto, valor_descontos, valor_liquido FROM apuracao_repasse WHERE id = ?',
      [ids.apuracao],
    );
    expect([
      Number(a?.['valor_bruto']),
      Number(a?.['valor_descontos']),
      Number(a?.['valor_liquido']),
    ]).toEqual([12150, 620, 11530]);
    const outra = await porta.lancar(c(), ids.apuracao, ids.prof);
    expect([outra.lancamentos, outra.descontos]).toEqual([0, 0]);
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_repasse WHERE apuracao_repasse_id = ?', [
        ids.apuracao,
      ]),
    ).toBe(3);
    const s = await porta.simular(c(), ids.apuracao, ids.prof);
    expect(s.profissionais[0]!.itens.every((i) => i.lancado)).toBe(true);
  });

  it('apuração aprovada recusa o lançamento sem gravar', async () => {
    expect(await recusa(porta.lancar(c(), ids.aprovada, null))).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_repasse WHERE apuracao_repasse_id = ?', [
        ids.aprovada,
      ]),
    ).toBe(0);
  });

  it('encerrar grava o fim, não estende e não apaga', async () => {
    const v = await um('SELECT versao FROM regra_repasse_minimo_garantido WHERE id = ?', [ids.minimo]);
    await porta.encerrar(c(), 'minimo', ids.minimo, { versao: Number(v?.['versao']), fim: '2026-12-31' });
    const v2 = await um('SELECT versao FROM regra_repasse_minimo_garantido WHERE id = ?', [ids.minimo]);
    expect(
      await recusa(
        porta.encerrar(c(), 'minimo', ids.minimo, { versao: Number(v2?.['versao']), fim: '2027-06-30' }),
      ),
    ).toBe('regra-violada');
    const r = await um('SELECT vigencia_fim, alterado_por FROM regra_repasse_minimo_garantido WHERE id = ?', [
      ids.minimo,
    ]);
    expect(
      String(
        r?.['vigencia_fim'] instanceof Date ? (r['vigencia_fim'] as Date).toISOString() : r?.['vigencia_fim'],
      ).slice(0, 10),
    ).toBe('2026-12-31');
    expect(Number(r?.['alterado_por'])).toBe(ids.usuario);
  });
});
