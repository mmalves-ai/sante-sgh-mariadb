// Valor fixo mensal e mínimo garantido na apuração do repasse, no MariaDB real (cliente f22_o5; massa SINTÉTICA com o
// prefixo "C2100", nenhuma pessoa real), F8, 06-FAT linha 47. Contrato de efeito:
//   - o valor fixo fica em `regra_repasse_valor_fixo` (descrição, valor, evento, dia, vigência, autor); outro vigente com
//     a mesma descrição no período e valor zero são recusados sem gravar;
//   - lançar na apuração grava o fixo inteiro e o complemento do mínimo (mínimo − produção, sem contar o fixo) em
//     `lancamento_repasse`, com o favorecido próprio e o evento da regra, e soma os totais da apuração;
//   - outra apuração da mesma competência não lança o fixo de novo (um por competência); o complemento é da apuração;
//   - encerrar o fixo grava `vigencia_fim` (nada apagado) e a competência seguinte não o recebe.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRemuneracaoVariavelPropria } from './remuneracao-variavel-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2100';
const COMP = '2026-10-01';
const PROXIMA = '2026-11-01';

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

describe.skipIf(SEM_BANCO)('valor fixo mensal e mínimo garantido na apuração (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRemuneracaoVariavelPropria;
  const ids = { est: 0, usuario: 0, prof: 0, evento: 0, ap1: 0, ap2: 0, apProx: 0, fixo: 0 };
  const c = () => ({ cliente: CLIENTE, hospital: P, usuario: ids.usuario, correlacao: 't-c2100' });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2100' }, (l) => l.uma(sql, p));
  const limpar = (e: Escritor) =>
    (async () => {
      const ap = 'SELECT id FROM apuracao_repasse WHERE estabelecimento_id = ?';
      await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(`DELETE FROM desconto_custo_repasse WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar(`DELETE FROM apuracao_repasse_item WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar('DELETE FROM apuracao_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      await e.executar('DELETE FROM regra_repasse_valor_fixo WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM regra_repasse_minimo_garantido WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM favorecido_repasse WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRemuneracaoVariavelPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2100' }, async (e) => {
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
        ['c2100.analista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2100.analista', 'USUARIO SINTETICO C2100', agora],
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
        [ids.est, `${P}-FIX`],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'VALOR FIXO C2100', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.est, `${P}-FIX`, agora],
      );
      const apuracao = (numero: string, comp: string) =>
        e.inserir(
          `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, iniciada_em, iniciada_por_usuario_id,
             valor_faturado, valor_bruto, valor_liquido, situacao, concluida_em, criado_em)
           VALUES (?, ?, ?, 'producao', ?, ?, 8000, 6000, 6000, 'apurada', ?, ?)`,
          [ids.est, numero, comp, agora, ids.usuario, agora, agora],
        );
      ids.ap1 = await apuracao(`${P}-1`, COMP);
      ids.ap2 = await apuracao(`${P}-2`, COMP);
      ids.apProx = await apuracao(`${P}-3`, PROXIMA);
      for (const a of [ids.ap1, ids.ap2, ids.apProx])
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
    });
  });

  afterAll(async () => {
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2100' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('grava o valor fixo e o mínimo; recusa o fixo que cruza outro e o valor zero sem gravar', async () => {
    const f = await porta.incluirFixo(c(), {
      profissional: ids.prof,
      descricao: 'COORDENACAO',
      valorMensal: 3000,
      evento: ids.evento,
      diaPagamento: 10,
      inicio: '2026-01-01',
    });
    ids.fixo = f.id;
    const linha = await um(
      `SELECT descricao, valor_mensal, evento_repasse_id, dia_pagamento, lancamento_automatico, ativo, criado_por
         FROM regra_repasse_valor_fixo WHERE id = ?`,
      [f.id],
    );
    expect(linha?.['descricao']).toBe('COORDENACAO');
    expect(Number(linha?.['valor_mensal'])).toBe(3000);
    expect(Number(linha?.['evento_repasse_id'])).toBe(ids.evento);
    expect(Number(linha?.['dia_pagamento'])).toBe(10);
    expect(Number(linha?.['lancamento_automatico'])).toBe(1);
    expect(Number(linha?.['criado_por'])).toBe(ids.usuario);
    expect(
      await recusa(
        porta.incluirFixo(c(), {
          profissional: ids.prof,
          descricao: 'COORDENACAO',
          valorMensal: 2000,
          evento: ids.evento,
          inicio: '2026-06-01',
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await recusa(
        // A entrada inválida é recusada antes da transação (lança na hora, sem promessa).
        (async () =>
          porta.incluirFixo(c(), {
            profissional: ids.prof,
            descricao: 'PLANTAO SOBREAVISO',
            valorMensal: 0,
            evento: ids.evento,
            inicio: '2026-01-01',
          }))(),
      ),
    ).toBe('entrada-invalida');
    await porta.incluirMinimo(c(), {
      profissional: ids.prof,
      valorMinimo: 10000,
      evento: ids.evento,
      inicio: '2026-01-01',
    });
    const n = await um('SELECT COUNT(*) AS n FROM regra_repasse_valor_fixo WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    expect(Number(n?.['n'])).toBe(1);
    const painel = await porta.painel(c(), ids.prof);
    expect(painel.fixos.map((x) => x.valorMensal)).toEqual([3000]);
  });

  it('simula: o fixo inteiro e o mínimo completando só a produção (10.000 − 6.000)', async () => {
    const s = await porta.simular(c(), ids.ap1, ids.prof);
    const itens = s.profissionais[0]?.itens ?? [];
    expect(itens.map((i) => [i.tipo, i.valor]).sort()).toEqual([
      ['complemento_minimo', 4000],
      ['valor_fixo', 3000],
    ]);
  });

  it('lança na apuração com o favorecido e o evento; outra apuração da competência não repete o fixo', async () => {
    const r = await porta.lancar(c(), ids.ap1, ids.prof);
    expect(r.lancamentos).toBe(2);
    expect(r.credito).toBe(7000);
    const l = await um(
      `SELECT COUNT(*) AS n, SUM(valor) AS total, MIN(evento_repasse_id) AS ev, MIN(favorecido_repasse_id) AS fav
         FROM lancamento_repasse WHERE apuracao_repasse_id = ? AND tipo_lancamento = 'apuracao'`,
      [ids.ap1],
    );
    expect(Number(l?.['n'])).toBe(2);
    expect(Number(l?.['total'])).toBe(7000);
    expect(Number(l?.['ev'])).toBe(ids.evento);
    expect(Number(l?.['fav'])).toBeGreaterThan(0);
    const a = await um('SELECT valor_bruto, valor_liquido FROM apuracao_repasse WHERE id = ?', [ids.ap1]);
    expect(Number(a?.['valor_bruto'])).toBe(13000);
    expect(Number(a?.['valor_liquido'])).toBe(13000);
    expect((await porta.lancar(c(), ids.ap1, ids.prof)).lancamentos).toBe(0);
    const r2 = await porta.lancar(c(), ids.ap2, ids.prof);
    expect(r2.lancamentos).toBe(1);
    const fixos = await um(
      `SELECT COUNT(*) AS n FROM lancamento_repasse
        WHERE estabelecimento_id = ? AND competencia = ? AND referente LIKE 'Valor fixo mensal %'`,
      [ids.est, COMP],
    );
    expect(Number(fixos?.['n'])).toBe(1);
  });

  it('encerrar o fixo grava o fim sem apagar; a competência seguinte não o recebe', async () => {
    const v = await um('SELECT versao FROM regra_repasse_valor_fixo WHERE id = ?', [ids.fixo]);
    await porta.encerrar(c(), 'fixo', ids.fixo, { versao: Number(v?.['versao']), fim: '2026-10-31' });
    const r = await um('SELECT vigencia_fim, alterado_por FROM regra_repasse_valor_fixo WHERE id = ?', [
      ids.fixo,
    ]);
    const fim = r?.['vigencia_fim'];
    expect(String(fim instanceof Date ? fim.toISOString() : fim).slice(0, 10)).toBe('2026-10-31');
    expect(Number(r?.['alterado_por'])).toBe(ids.usuario);
    const s = await porta.simular(c(), ids.apProx, ids.prof);
    expect((s.profissionais[0]?.itens ?? []).map((i) => i.tipo)).toEqual(['complemento_minimo']);
  });
});
