// Contrato de efeito das regras do acordo aplicadas ao lançar o item na conta (06-FAT linha 1, passo 3) contra o MariaDB
// real. Massa SINTÉTICA com códigos "F3AC" (nenhuma pessoa real). As regras entram pela gravação real do acordo
// (GravadorRegrasAcordo) e o item pelo lançamento da conta (faturamento.lancarItem):
// - percentual por componente: o custo operacional sai a 80% e a memória guarda a regra aplicada;
// - isento: o item fica na conta com valor zero e o motivo na memória;
// - alto custo: o preço negociado substitui o da tabela e a autorização exigida volta como alerta;
// - teto que transfere: a conta fica com o limite e o excedente é lançado na conta da outra fonte do mesmo atendimento
//   (cada fonte cobra o seu), com a memória ligando os dois lados;
// - via de acesso: na cirurgia múltipla, o 2º procedimento da mesma via sai a 50% no honorário;
// - acordo: o desconto e o alto custo de um acordo encerrado antes da data do item não valem;
// - teto que bloqueia: o lançamento é recusado e nada fica gravado;
// - item sem regra: o valor da tabela, sem marca de acordo.
// No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { GravadorRegrasAcordo } from '../precos/regras-acordo-gravacao.js';
import type { ContextoFaturamento } from './porta.js';
import { PortaFaturamentoPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3AC';
const COD = {
  a: 83_780_001,
  b: 83_780_002,
  c: 83_780_003,
  d: 83_780_004,
  e: 83_780_005,
  f: 83_780_006,
} as const;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('regras do acordo aplicadas ao lançar o item na conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFaturamentoPropria;
  let gravador: GravadorRegrasAcordo;
  let c: ContextoFaturamento;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-f3ac',
    chaveIdempotencia: `f3ac-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f3ac' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    if (!ids['est']) return;
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids['est'], `${P}%`],
    );
    for (const { id } of contas) {
      await e.executar(
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
    if (ids['fonte']) {
      for (const t of [
        'regra_percentual_cobranca',
        'item_isento_cobranca',
        'teto_cobranca',
        'regra_via_acesso',
      ])
        await e.executar(`DELETE FROM ${t} WHERE fonte_pagadora_id = ?`, [ids['fonte']]);
      await e.executar(
        'DELETE r FROM item_alto_custo_contrato r JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
        [ids['fonte']],
      );
      await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids['fonte']]);
    }
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      const fonte = (cod: string) =>
        g(
          'fonte_pagadora',
          cod,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [cod, `OPERADORA SINTETICA ${cod}`, agora],
        );
      ids['fonte'] = await fonte(`${P}FP`);
      ids['outraFonte'] = await fonte(`${P}FX`);
      await limpar(e);
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 837_801, agora],
      );
      const pf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`${P.toLowerCase()}.fat`],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P.toLowerCase()}.fat`, `USUARIO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        `${P}G`,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [`${P}G`, `GRUPO ${P}`, agora],
      );
      ids['tabela'] = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [`${P}T`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id,
           criado_em) VALUES (?, ?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [ids['est'], `${P}T`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
      );
      let seq = 0;
      for (const [k, cod] of Object.entries(COD)) {
        seq += 1;
        ids[k] = await g(
          'item_faturavel',
          String(cod),
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [String(cod), `PROCEDIMENTO SINTETICO ${P} ${k}`, ids['grupo'], agora],
        );
        const pp2 = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids['tabela'], ids[k]],
          'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
          [ids['tabela'], seq, ids[k], agora],
        );
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [pp2],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
             valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
           VALUES (?, 'inclusao', ?, '2020-01-01', ?, ?, 0, 100, ?)`,
          // O procedimento f é de honorário (a via de acesso reduz o honorário).
          [pp2, agora, k === 'f' ? 100 : 0, k === 'f' ? 0 : 100, agora],
        );
      }
      ids['contrato'] = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO F3AC', '2025-01-01', 'vigente', 60, ?)`,
        [ids['est'], ids['fonte'], `${P}-1`, agora],
      );
      const eletivo = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['FAE'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', FALSE, ?)",
        ['FAE', 'CARATER SINTETICO FAE', agora],
      );
      ids['via'] = await g(
        'via_acesso_cirurgico',
        `${P}V`,
        'INSERT INTO via_acesso_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}V`, `VIA SINTETICA ${P}`, agora],
      );
      const at = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 11:00:00', ?)`,
        [ids['est'], `${P}-AT`, ids['paciente'], ids['categoria'], eletivo, ids['fonte'], ids['prof'], agora],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 11:00:00', ?)`,
        [ids['est'], `${P}-C`, at, ids['paciente'], ids['fonte'], ids['tipoConta'], ids['tabela'], agora],
      );
      // A conta da outra fonte no mesmo atendimento: recebe o excedente do teto que transfere.
      ids['contaOutra'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 11:00:00', ?)`,
        [ids['est'], `${P}-CX`, at, ids['paciente'], ids['outraFonte'], ids['tipoConta'], agora],
      );
      // Um acordo antigo, encerrado antes da data dos itens, com alto custo do item e: não pode valer.
      const velho = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           vigencia_fim, situacao, prazo_apresentacao_dias, criado_em)
         VALUES (?, ?, ?, 'ACORDO F3AC VELHO', '2020-01-01', '2024-12-31', 'encerrado', 60, ?)`,
        [ids['est'], ids['fonte'], `${P}-0`, agora],
      );
      await e.inserir(
        `INSERT INTO item_alto_custo_contrato (contrato_fonte_pagadora_id, item_faturavel_id, regra, valor_negociado,
           vigencia_inicio, criado_em) VALUES (?, ?, 'preco_negociado', 999, '2020-01-01', ?)`,
        [velho, ids['e'], agora],
      );
    });
    porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
    gravador = new GravadorRegrasAcordo(nucleo);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-f3ac',
      rede: 'rede-teste',
      hospital: `${P}A`,
    };
    // As regras pela gravação real do acordo.
    const base = { fonteId: ids['fonte'], vigenciaInicio: '2025-01-01' };
    await gravador.gravar('percentual', op(), {
      ...base,
      tabelaId: ids['tabela'],
      itemId: ids['a'],
      componente: 'custo_operacional',
      percentual: 80,
    });
    await gravador.gravar('isento', op(), { ...base, itemId: ids['b'], motivo: 'Incluso na diária F3AC' });
    await gravador.gravar('alto-custo', op(), {
      ...base,
      itemId: ids['c'],
      regra: 'preco_negociado',
      valorNegociado: 1500,
    });
    await gravador.gravar('alto-custo', op(), { ...base, itemId: ids['c'], regra: 'exige_autorizacao' });
    await gravador.gravar('teto', op(), {
      ...base,
      abrangencia: 'item',
      itemId: ids['a'],
      valorTeto: 200,
      acao: 'transferir_excedente',
      excedenteFonteId: ids['outraFonte'],
    });
    await gravador.gravar('teto', op(), {
      ...base,
      abrangencia: 'item',
      itemId: ids['d'],
      valorTeto: 50,
      acao: 'bloquear_lancamento',
    });
    for (const [ordem, percentual] of [
      [1, 100],
      [2, 50],
    ] as const)
      await gravador.gravar('via', op(), {
        ...base,
        descricao: `MESMA VIA ${P} ${ordem}`,
        viaId: ids['via'],
        ordem,
        percentual,
      });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']] });
    });
    await nucleo.encerrar();
  });

  const lancar = (codigo: number, quantidade = 1, via: { acesso: number; ordem: number } | null = null) =>
    porta.executar(
      c,
      'faturamento.lancarItem',
      {
        conta: ids['conta'],
        tipo: 3,
        codigo,
        quantidade,
        data: '2026-01-20',
        hora: '10:00',
        local: 0,
        ato: 0,
        ...(via ? { via } : {}),
      },
      op(),
    );
  const doItem = async (id: number) => {
    const [x] = await linhas(
      `SELECT i.valor_unitario, i.valor_custo_operacional, i.valor_total, m.dados
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
        WHERE i.id = ?`,
      [id],
    );
    const dados = typeof x!['dados'] === 'string' ? JSON.parse(String(x!['dados'])) : x!['dados'];
    return {
      unitario: Number(x!['valor_unitario']),
      custo: Number(x!['valor_custo_operacional']),
      total: Number(x!['valor_total']),
      acordo: (dados as { acordo: Record<string, unknown> | null }).acordo,
    };
  };

  it('percentual e teto que transfere: 80% no custo; passando do teto a conta fica com o limite', async () => {
    const r1 = await lancar(COD.a, 2);
    expect(r1.resultado).toMatchObject({ valor: 160 });
    const i1 = await doItem(Number(r1.resultado['id']));
    expect([i1.unitario, i1.custo, i1.total]).toEqual([80, 160, 160]);
    expect((i1.acordo?.['aplicadas'] as { tipo: string }[]).map((a) => a.tipo)).toEqual(['percentual']);

    const r2 = await lancar(COD.a, 1);
    expect(r2.resultado).toMatchObject({ valor: 40 });
    const i2 = await doItem(Number(r2.resultado['id']));
    expect(i2.total).toBe(40);
    // O excedente (40) foi lançado na conta da outra fonte do mesmo atendimento, com a memória dos dois lados.
    const destino = await linhas(
      `SELECT i.id, i.item_faturavel_id, i.valor_total, i.valor_custo_operacional, m.dados
         FROM conta_hospitalar_item i JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
        WHERE i.conta_hospitalar_id = ?`,
      [ids['contaOutra']],
    );
    expect(destino.map((d) => [Number(d['item_faturavel_id']), Number(d['valor_total'])])).toEqual([
      [ids['a'], 40],
    ]);
    expect(Number(destino[0]!['valor_custo_operacional'])).toBe(40);
    expect(i2.acordo?.['excedente']).toEqual({
      valor: 40,
      fonte: ids['outraFonte'],
      plano: null,
      conta: ids['contaOutra'],
      item: Number(destino[0]!['id']),
    });
    const dd = destino[0]!['dados'];
    expect((typeof dd === 'string' ? JSON.parse(dd) : dd).origem).toMatchObject({
      conta: ids['conta'],
      item: Number(r2.resultado['id']),
    });
    // O total cobrado de cada fonte: 160 + 40 na conta do acordo e 40 na da outra fonte.
    const outra = await linhas('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [ids['contaOutra']]);
    expect(Number(outra[0]!['valor_total'])).toBe(40);
  });

  it('isento: fica na conta com valor zero e o motivo na memória', async () => {
    const r = await lancar(COD.b, 3);
    const i = await doItem(Number(r.resultado['id']));
    expect(i.total).toBe(0);
    expect(i.acordo).toMatchObject({ isento: true });
    expect(JSON.stringify(i.acordo?.['aplicadas'])).toContain('Incluso na diária F3AC');
  });

  it('alto custo: preço negociado e autorização exigida como alerta', async () => {
    const r = await lancar(COD.c, 1);
    expect(r.resultado).toMatchObject({ valor: 1500, alertasAcordo: 'alto-custo-exige-autorizacao' });
    const i = await doItem(Number(r.resultado['id']));
    expect([i.unitario, i.total]).toEqual([1500, 1500]);
    expect(i.acordo).toMatchObject({ exigeAutorizacao: true });
  });

  it('teto que bloqueia recusa e não grava; item sem regra segue a tabela sem marca de acordo', async () => {
    await expect(lancar(COD.d, 1)).rejects.toThrow(/teto/);
    const d = await linhas(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND item_faturavel_id = ?',
      [ids['conta'], ids['d']],
    );
    expect(Number(d[0]!['n'])).toBe(0);
    const r = await lancar(COD.e, 1);
    const i = await doItem(Number(r.resultado['id']));
    expect([i.total, i.acordo]).toEqual([100, null]);
    const conta = await linhas('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [ids['conta']]);
    expect(Number(conta[0]!['valor_total'])).toBe(160 + 40 + 0 + 1500 + 100);
  });

  it('via de acesso: o 2º procedimento da mesma via sai a 50% no honorário; sem via, segue a tabela', async () => {
    const p1 = await lancar(COD.f, 1, { acesso: ids['via']!, ordem: 1 });
    const p2 = await lancar(COD.f, 1, { acesso: ids['via']!, ordem: 2 });
    const i1 = await doItem(Number(p1.resultado['id']));
    const i2 = await doItem(Number(p2.resultado['id']));
    expect([i1.total, i2.total]).toEqual([100, 50]);
    expect(JSON.stringify(i2.acordo?.['aplicadas'])).toContain('50%');
    const [h] = await linhas('SELECT valor_honorario FROM conta_hospitalar_item WHERE id = ?', [
      Number(p2.resultado['id']),
    ]);
    expect(Number(h!['valor_honorario'])).toBe(50);
    const sem = await lancar(COD.f, 1);
    expect((await doItem(Number(sem.resultado['id']))).total).toBe(100);
  });
});
