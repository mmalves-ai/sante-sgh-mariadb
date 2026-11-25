// Remuneração variável por faixa e rateio da equipe no MariaDB real (cliente f22_o5; massa SINTÉTICA com o prefixo
// "C2106", nenhuma pessoa real), F8, 06-FAT linha 48. Contrato de efeito:
//   - equipe e membros gravados com as cotas; composição fora de 100% recusada sem gravar; recompor encerra os
//     vigentes no dia anterior e cria a nova composição (nada apagado);
//   - regra e faixas gravadas; regra que cruza outra vigente do mesmo beneficiário e indicador, e faixa de desconto
//     sem evento de desconto, recusadas sem gravar; encerrar grava `vigencia_fim` e não estende;
//   - lançar: um `lancamento_repasse` por parte (acréscimo com o evento da regra, desconto com o evento de desconto,
//     valor positivo, referente da regra), totais da apuração somados (acréscimo no bruto, desconto nos descontos);
//     lançar de novo não duplica; período trimestral só lança na competência que fecha; apuração aprovada recusa.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaVariavelFaixaPropria } from './variavel-faixa-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2106';

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

describe.skipIf(SEM_BANCO)('remuneração variável por faixa e equipe (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaVariavelFaixaPropria;
  const ids = {
    est: 0,
    usuario: 0,
    a: 0,
    b: 0,
    evento: 0,
    desconto: 0,
    jul: 0,
    set: 0,
    equipe: 0,
    r1: 0,
    r2: 0,
    r3: 0,
  };
  const c = () => ({ cliente: CLIENTE, hospital: P, usuario: ids.usuario, correlacao: 't-c2106' });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2106' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const limpar = async (e: Escritor) => {
    const ap = 'SELECT id FROM apuracao_repasse WHERE estabelecimento_id = ?';
    const rg = 'SELECT id FROM regra_repasse_variavel WHERE estabelecimento_id = ?';
    const eq = 'SELECT id FROM equipe_repasse_variavel WHERE estabelecimento_id = ?';
    await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(`DELETE FROM apuracao_repasse_item WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
    await e.executar('DELETE FROM apuracao_repasse WHERE estabelecimento_id = ?', [ids.est]);
    await limparTrilhaDaMassa(e, { ids: [ids.est] });
    await e.executar(`DELETE FROM regra_repasse_variavel_faixa WHERE regra_repasse_variavel_id IN (${rg})`, [
      ids.est,
    ]);
    await e.executar('DELETE FROM regra_repasse_variavel WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(
      `DELETE FROM equipe_repasse_variavel_membro WHERE equipe_repasse_variavel_id IN (${eq})`,
      [ids.est],
    );
    await e.executar('DELETE FROM equipe_repasse_variavel WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM favorecido_repasse WHERE estabelecimento_id = ?', [ids.est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaVariavelFaixaPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2106' }, async (e) => {
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
        ['c2106.analista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2106.analista', 'USUARIO SINTETICO C2106', agora],
      );
      const prof = async (s: string) => {
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [`MEDICO SINTETICO ${P} ${s}`],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [`MEDICO SINTETICO ${P} ${s}`, agora],
        );
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
      };
      ids.a = await prof('A');
      ids.b = await prof('B');
      const evento = (cod: string, natureza: string, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-${cod}`],
          `INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em)
           VALUES (?, ?, ?, ?, ?, '2026-01-01', ?)`,
          [ids.est, `${P}-${cod}`, `EVENTO ${cod} ${P}`, natureza, tipo, agora],
        );
      ids.evento = await evento('VAR', 'rendimento', 'credito');
      ids.desconto = await evento('DESC', 'desconto', 'debito');
      const apuracao = (numero: string, comp: string, situacao: string) =>
        e.inserir(
          `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, iniciada_em, iniciada_por_usuario_id,
             valor_faturado, valor_bruto, valor_liquido, situacao, concluida_em, aprovada_em, criado_em)
           VALUES (?, ?, ?, 'producao', ?, ?, 3000, 2000, 2000, ?, ?, ?, ?)`,
          [
            ids.est,
            numero,
            comp,
            agora,
            ids.usuario,
            situacao,
            agora,
            situacao === 'aprovada' ? agora : null,
            agora,
          ],
        );
      ids.jul = await apuracao(`${P}-JUL`, '2026-07-01', 'aprovada');
      ids.set = await apuracao(`${P}-SET`, '2026-09-01', 'apurada');
      const item = (
        ap: number,
        seq: number,
        prof: number,
        fat: number,
        glosa: number,
        rep: number,
        comp: string,
      ) =>
        e.inserir(
          `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, competencia_producao,
             valor_faturado, valor_glosa, percentual_repasse, valor_repasse, criado_em) VALUES (?, ?, ?, ?, ?, ?, 70, ?, ?)`,
          [ap, seq, prof, comp, fat, glosa, rep, agora],
        );
      // Julho: A com 2 itens (1.000 faturados, 700 de repasse cada). Setembro: A com 1 (2.000, glosa 200, repasse
      // 1.400) e B com 1 (1.000, repasse 600).
      await item(ids.jul, 1, ids.a, 1000, 0, 700, '2026-07-01');
      await item(ids.jul, 2, ids.a, 1000, 0, 700, '2026-07-01');
      await item(ids.set, 1, ids.a, 2000, 200, 1400, '2026-09-01');
      await item(ids.set, 2, ids.b, 1000, 0, 600, '2026-09-01');
      for (const p of [ids.a, ids.b])
        await e.inserir(
          `INSERT INTO favorecido_repasse (estabelecimento_id, profissional_id, tipo_favorecido, percentual, vigencia_inicio, ativo, criado_em)
           VALUES (?, ?, 'proprio_profissional', 100, '2026-01-01', TRUE, ?)`,
          [ids.est, p, agora],
        );
    });
  });

  afterAll(async () => {
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2106' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('grava a equipe com as cotas e recusa composição fora de 100% sem gravar', async () => {
    expect(
      await recusa(
        porta.incluirEquipe(c(), {
          codigo: `${P}-X`,
          nome: 'EQUIPE INVALIDA',
          inicio: '2026-01-01',
          membros: [
            { profissional: ids.a, cota: 60 },
            { profissional: ids.b, cota: 30 },
          ],
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM equipe_repasse_variavel WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(0);
    ids.equipe = (
      await porta.incluirEquipe(c(), {
        codigo: `${P}-EQ`,
        nome: 'EQUIPE SINTETICA C2106',
        inicio: '2026-01-01',
        membros: [
          { profissional: ids.a, cota: 60, chefe: true },
          { profissional: ids.b, cota: 40 },
        ],
      })
    ).id;
    const m = await um(
      `SELECT COUNT(*) AS n, SUM(cota_percentual) AS soma, SUM(chefe_equipe) AS chefes, MAX(criado_por) AS por
         FROM equipe_repasse_variavel_membro WHERE equipe_repasse_variavel_id = ?`,
      [ids.equipe],
    );
    expect(Number(m?.['n'])).toBe(2);
    expect(Number(m?.['soma'])).toBe(100);
    expect(Number(m?.['chefes'])).toBe(1);
    expect(Number(m?.['por'])).toBe(ids.usuario);
  });

  it('grava as regras com as faixas e recusa conflito e desconto sem evento', async () => {
    ids.r1 = (
      await porta.incluirRegra(c(), {
        codigo: `${P}-R1`,
        descricao: 'PROCEDIMENTOS NO TRIMESTRE',
        profissional: ids.a,
        indicador: 'quantidade_procedimentos',
        periodo: 'trimestral',
        evento: ids.evento,
        eventoDesconto: ids.desconto,
        inicio: '2026-01-01',
        faixas: [
          { de: 0, ate: 2, ajuste: 'desconto', valorFixo: 100 },
          { de: 3, ate: 10, percentual: 10 },
        ],
      })
    ).id;
    ids.r2 = (
      await porta.incluirRegra(c(), {
        codigo: `${P}-R2`,
        descricao: 'PRODUCAO DA EQUIPE',
        equipe: ids.equipe,
        indicador: 'valor_produzido',
        evento: ids.evento,
        eventoDesconto: ids.desconto,
        inicio: '2026-01-01',
        faixas: [
          { de: 0, ate: 1999.99, ajuste: 'desconto', valorFixo: 50 },
          { de: 2000, percentual: 5 },
        ],
      })
    ).id;
    ids.r3 = (
      await porta.incluirRegra(c(), {
        codigo: `${P}-R3`,
        descricao: 'RECEBIDO ABAIXO DA META',
        profissional: ids.b,
        indicador: 'valor_recebido',
        evento: ids.evento,
        eventoDesconto: ids.desconto,
        inicio: '2026-01-01',
        faixas: [{ de: 0, ate: 5000, ajuste: 'desconto', valorFixo: 30 }],
      })
    ).id;
    const f = await um(
      `SELECT COUNT(*) AS n, SUM(tipo_ajuste = 'desconto') AS descontos FROM regra_repasse_variavel_faixa
        WHERE regra_repasse_variavel_id IN (?, ?, ?)`,
      [ids.r1, ids.r2, ids.r3],
    );
    expect(Number(f?.['n'])).toBe(5);
    expect(Number(f?.['descontos'])).toBe(3);
    const r1 = await um(
      'SELECT periodo_apuracao, evento_desconto_repasse_id, criado_por FROM regra_repasse_variavel WHERE id = ?',
      [ids.r1],
    );
    expect(r1?.['periodo_apuracao']).toBe('trimestral');
    expect(Number(r1?.['evento_desconto_repasse_id'])).toBe(ids.desconto);
    expect(Number(r1?.['criado_por'])).toBe(ids.usuario);
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM regra_repasse_variavel WHERE estabelecimento_id = ?',
      [ids.est],
    );
    const base = {
      descricao: 'X',
      profissional: ids.a,
      indicador: 'quantidade_procedimentos',
      evento: ids.evento,
      inicio: '2026-06-01',
    };
    expect(
      await recusa(
        porta.incluirRegra(c(), { ...base, codigo: `${P}-DUP`, faixas: [{ de: 0, percentual: 1 }] }),
      ),
    ).toBe('regra-violada');
    expect(
      await recusa(
        porta.incluirRegra(c(), {
          ...base,
          codigo: `${P}-SEMDESC`,
          indicador: 'quantidade_cirurgias',
          faixas: [{ de: 0, ajuste: 'desconto', valorFixo: 10 }],
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM regra_repasse_variavel WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(antes);
  });

  it('simula: o trimestral não fecha em julho; em setembro mede, enquadra e rateia', async () => {
    const jul = await porta.simular(c(), ids.jul);
    const r1jul = jul.regras.find((r) => r.regra === ids.r1)!;
    expect(r1jul.fecha).toBe(false);
    expect(r1jul.partes).toEqual([]);
    const set = await porta.simular(c(), ids.set);
    const r1 = set.regras.find((r) => r.regra === ids.r1)!;
    expect(r1).toMatchObject({ fecha: true, medida: 3, faixa: 2, base: 2800, valor: 280 });
    const r2 = set.regras.find((r) => r.regra === ids.r2)!;
    expect(r2).toMatchObject({ medida: 3000, faixa: 2, base: 2000, valor: 100 });
    expect(r2.partes.map((p) => [p.profissional, p.valor])).toEqual([
      [ids.a, 60],
      [ids.b, 40],
    ]);
    const r3 = set.regras.find((r) => r.regra === ids.r3)!;
    expect(r3).toMatchObject({ medida: 1000, valor: -30 });
  });

  it('lança as partes com os eventos certos, soma os totais e não duplica', async () => {
    const r = await porta.lancar(c(), ids.set);
    expect(r).toMatchObject({ lancamentos: 4, credito: 380, debito: 30 });
    const l = await um(
      `SELECT COUNT(*) AS n, SUM(evento_repasse_id = ?) AS acrescimos, SUM(evento_repasse_id = ?) AS descontos,
              SUM(valor) AS total, MIN(valor) AS menor, SUM(tipo_lancamento = 'apuracao') AS apuracao
         FROM lancamento_repasse WHERE apuracao_repasse_id = ?`,
      [ids.evento, ids.desconto, ids.set],
    );
    expect(Number(l?.['n'])).toBe(4);
    expect(Number(l?.['acrescimos'])).toBe(3);
    expect(Number(l?.['descontos'])).toBe(1);
    expect(Number(l?.['total'])).toBe(410);
    expect(Number(l?.['menor'])).toBeGreaterThan(0);
    expect(Number(l?.['apuracao'])).toBe(4);
    const a = await um(
      'SELECT valor_bruto, valor_descontos, valor_liquido FROM apuracao_repasse WHERE id = ?',
      [ids.set],
    );
    expect([
      Number(a?.['valor_bruto']),
      Number(a?.['valor_descontos']),
      Number(a?.['valor_liquido']),
    ]).toEqual([2380, 30, 2350]);
    const deNovo = await porta.lancar(c(), ids.set);
    expect(deNovo.lancamentos).toBe(0);
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_repasse WHERE apuracao_repasse_id = ?', [ids.set]),
    ).toBe(4);
    expect(await recusa(porta.lancar(c(), ids.jul))).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_repasse WHERE apuracao_repasse_id = ?', [ids.jul]),
    ).toBe(0);
  });

  it('recompõe a equipe sem apagar e encerra a regra sem estender', async () => {
    const eq = await um('SELECT versao FROM equipe_repasse_variavel WHERE id = ?', [ids.equipe]);
    await porta.recomporEquipe(c(), ids.equipe, {
      versao: Number(eq?.['versao']),
      inicio: '2026-10-01',
      membros: [
        { profissional: ids.a, cota: 50, chefe: true },
        { profissional: ids.b, cota: 50 },
      ],
    });
    const m = await um(
      `SELECT COUNT(*) AS n, SUM(vigencia_fim = '2026-09-30') AS encerrados, SUM(vigencia_fim IS NULL) AS vigentes
         FROM equipe_repasse_variavel_membro WHERE equipe_repasse_variavel_id = ?`,
      [ids.equipe],
    );
    expect([Number(m?.['n']), Number(m?.['encerrados']), Number(m?.['vigentes'])]).toEqual([4, 2, 2]);
    const r3 = await um('SELECT versao FROM regra_repasse_variavel WHERE id = ?', [ids.r3]);
    await porta.encerrarRegra(c(), ids.r3, { versao: Number(r3?.['versao']), fim: '2026-12-31' });
    const fim = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM regra_repasse_variavel WHERE id = ?",
      [ids.r3],
    );
    expect(fim?.['fim']).toBe('2026-12-31');
    expect(
      await recusa(porta.encerrarRegra(c(), ids.r3, { versao: Number(fim?.['versao']), fim: '2027-06-30' })),
    ).toBe('regra-violada');
  });
});
