// Contrato de efeito do fracionamento e unitarização de dose (C2-092, 05-SUP linha 11) na porta própria contra o
// MariaDB real (cliente de teste do lote; massa SINTÉTICA, nenhuma pessoa real): a regra do insumo gravada; a ordem
// executada baixa o lote de origem (unitarizacao_consumo), dá entrada às doses no mesmo local com o número do lote de
// origem e a validade da RDC 67/2007 (unitarizacao_entrada, custo do que saiu), grava a ordem, o item, uma etiqueta
// (tipo dose) e uma dose por unidade com o lote de origem; o rastreio vai da dose ao lote. Recusas (rendimento, lote de
// outro insumo, capela exigida, regra inativa, sem farmacêutico) e isolamento por estabelecimento. SGH_NUCLEO_SEM_BANCO=1
// pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import { type OrdemUnitarizacaoEntrada, PortaUnitarizacaoDosePropria } from './unitarizacao-dose.js';

const RODADA = Date.now().toString(36);
let k = 0;
const chave = () => `c2092-${RODADA}-${++k}`;
const ESTS = "SELECT id FROM estabelecimento WHERE codigo LIKE 'F22L0314%'";
const PESSOA = 'FARMACEUTICO SINTETICO C2092';

async function limparUnitarizacao(e: Escritor): Promise<void> {
  const ordens = `SELECT id FROM ordem_unitarizacao WHERE estabelecimento_id IN (${ESTS})`;
  for (const sql of [
    `DELETE FROM dose_unitarizada WHERE ordem_unitarizacao_id IN (${ordens})`,
    `DELETE FROM etiqueta_identificacao WHERE ordem_unitarizacao_id IN (${ordens})`,
    `DELETE FROM ordem_unitarizacao_item WHERE ordem_unitarizacao_id IN (${ordens})`,
    `DELETE FROM ordem_unitarizacao WHERE estabelecimento_id IN (${ESTS})`,
    "DELETE FROM regra_fracionamento_insumo WHERE origem_insumo_id IN (SELECT id FROM insumo WHERE codigo LIKE 'F22L0314%') OR resultante_insumo_id IN (SELECT id FROM insumo WHERE codigo LIKE 'F22L0314%')",
    `DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id IN (${ESTS})`,
  ])
    await e.executar(sql, []);
}

/** O farmacêutico sintético sai depois da massa (os movimentos do estoque apontam para ele). */
async function limparFarmaceutico(e: Escritor): Promise<void> {
  for (const sql of [
    `DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome = '${PESSOA}')`,
    `DELETE FROM pessoa_fisica WHERE nome = '${PESSOA}'`,
  ])
    await e.executar(sql, []);
}

describe.skipIf(SEM_BANCO)('fracionamento e unitarização de dose na porta própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let porta: PortaUnitarizacaoDosePropria;
  const ids: Record<string, number> = {};
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2092' }, (l) => l.consultar<T>(sql, p));
  const um = async (sql: string, p: unknown[]) => (await ler<Record<string, unknown>>(sql, p))[0]!;
  const ordem = (extra: Partial<OrdemUnitarizacaoEntrada> = {}): OrdemUnitarizacaoEntrada => ({
    regra: ids.regra!,
    tipo: 'fracionamento',
    local: m.localA,
    lote: m.lote,
    capela: null,
    quantidadeOrigem: 2,
    doses: 7,
    perda: 1,
    rupturaLacre: true,
    percentualEstabilidade: null,
    observacao: null,
    ...extra,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-limpa' }, limparUnitarizacao);
    await limparMassa(nucleo, null);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-limpa' }, limparFarmaceutico);
    m = await montarMassa(nucleo);
    porta = new PortaUnitarizacaoDosePropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-massa' }, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      ids.dose = await x('insumo', {
        codigo: `${m.marca}DOSE`,
        nome: 'DOSE SINTETICA C2092',
        tipo: 'material',
        grupo_insumo_id: m.grupo,
        estoque_unidade_medida_id: m.unidade,
        situacao: 'ativo',
      });
      const pessoa = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        PESSOA,
        new Date(),
      ]);
      ids.profissional = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pessoa, new Date()],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [m.usuario, m.estA, ids.profissional, new Date()],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-limpa' }, limparUnitarizacao);
    await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-limpa' }, limparFarmaceutico);
    await nucleo.encerrar?.();
  });

  it('grava a regra do insumo, altera pela mesma origem e dose, e inativa sem apagar', async () => {
    const c = contexto(m, m.estA, 't-c2092');
    const regra = {
      origem: m.insumo,
      resultante: ids.dose!,
      quantidadeOrigem: 1,
      rendimento: 4,
      unidade: m.unidade,
      validadeHoras: null,
      exigeCapela: true,
      reaproveitaSobra: true,
    };
    expect(await codigoDe(porta.salvarRegra(c, { ...regra, resultante: m.insumo }, chave()))).toBe(
      'insumos-iguais',
    );
    const r = await porta.salvarRegra(c, regra, chave());
    ids.regra = r.id;
    const r2 = await porta.salvarRegra(c, { ...regra, exigeCapela: false }, chave());
    expect(r2.id).toBe(r.id);
    const g = await um('SELECT * FROM regra_fracionamento_insumo WHERE id = ?', [r.id]);
    expect(g).toMatchObject({ origem_insumo_id: m.insumo, resultante_insumo_id: ids.dose, versao: 2 });
    expect(Number(g['exige_capela'])).toBe(0);
    expect(Number(g['rendimento'])).toBe(4);
    await porta.ativarRegra(c, r.id, { ativa: false, versaoVista: 2 }, chave());
    expect(await codigoDe(porta.executarOrdem(c, ordem(), chave()))).toBe('regra-inativa');
    expect(await codigoDe(porta.ativarRegra(c, r.id, { ativa: true, versaoVista: 2 }, chave()))).toBe(
      'regra-mudou',
    );
    await porta.ativarRegra(c, r.id, { ativa: true, versaoVista: 3 }, chave());
    expect(
      Number((await um('SELECT ativo FROM regra_fracionamento_insumo WHERE id = ?', [r.id]))['ativo']),
    ).toBe(1);
  });

  it('executa a ordem: baixa o lote de origem, entra as doses com o lote e a validade nova, etiqueta cada dose', async () => {
    const c = contexto(m, m.estA, 't-c2092');
    const k1 = chave();
    const r = await porta.executarOrdem(c, ordem(), k1);
    expect(r.doses).toHaveLength(7);
    const o = await um('SELECT * FROM ordem_unitarizacao WHERE id = ?', [r.id]);
    expect(o).toMatchObject({
      estabelecimento_id: m.estA,
      numero: r.numero,
      tipo: 'fracionamento',
      local_estoque_id: m.localA,
      regra_fracionamento_insumo_id: ids.regra,
      farmaceutico_profissional_id: ids.profissional,
      situacao: 'concluida',
    });
    expect(Number(o['percentual_estabilidade'])).toBe(25);
    expect(Number(o['ruptura_lacre'])).toBe(1);
    const it1 = await um('SELECT * FROM ordem_unitarizacao_item WHERE ordem_unitarizacao_id = ?', [r.id]);
    expect(it1).toMatchObject({
      sequencia: 1,
      origem_insumo_id: m.insumo,
      origem_lote_insumo_id: m.lote,
      resultante_insumo_id: ids.dose,
      resultante_lote_insumo_id: r.loteDoses,
      movimento_estoque_id: r.movimentoSaida,
    });
    expect(Number(it1['quantidade_origem'])).toBe(2);
    expect(Number(it1['quantidade_produzida'])).toBe(7);
    expect(Number(it1['quantidade_perda'])).toBe(1);
    // Nada sobrou (7 doses + 1 de perda = 8 previstas): nenhuma sobra registrada.
    expect(Number(it1['quantidade_sobra'])).toBe(0);
    expect(it1['validade_sobra']).toBeNull();
    expect(r.sobra).toBe(0);

    // O lote das doses leva o número do lote de origem e a validade nova (nunca além da original).
    const lo = await um(
      "SELECT numero_lote, DATE_FORMAT(validade, '%Y-%m-%d') AS v FROM lote_insumo WHERE id = ?",
      [m.lote],
    );
    const ld = await um(
      "SELECT insumo_id, numero_lote, DATE_FORMAT(validade, '%Y-%m-%d') AS v, DATE_FORMAT(validade_original, '%Y-%m-%d') AS vo FROM lote_insumo WHERE id = ?",
      [r.loteDoses],
    );
    expect(ld).toMatchObject({
      insumo_id: ids.dose,
      numero_lote: lo['numero_lote'],
      v: r.validadeDose,
      vo: lo['v'],
    });
    expect(r.validadeDose <= String(lo['v'])).toBe(true);

    // A baixa do lote de origem e a entrada das doses pelo motor do estoque (custo do que saiu: 2 × 2,50 = 5).
    const movs = await ler<Record<string, unknown>>(
      `SELECT me.id, me.natureza, me.insumo_id, me.quantidade, me.valor_total, ml.lote_insumo_id, t.codigo
         FROM movimento_estoque me JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
         JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
        WHERE me.id IN (?, ?) ORDER BY me.id`,
      [r.movimentoSaida, r.movimentoEntrada],
    );
    expect(
      movs.map((x) => [x['codigo'], x['insumo_id'], Number(x['quantidade']), x['lote_insumo_id']]),
    ).toEqual([
      ['unitarizacao_consumo', m.insumo, 2, m.lote],
      ['unitarizacao_entrada', ids.dose, 7, r.loteDoses],
    ]);
    expect(Number(movs[0]!['valor_total'])).toBe(5);
    expect(Number(movs[1]!['valor_total'])).toBe(5);
    const so = await um(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
      [m.localA, m.lote],
    );
    expect(Number(so['quantidade'])).toBe(8);
    const sd = await um(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
      [m.localA, r.loteDoses],
    );
    expect(Number(sd['quantidade'])).toBe(7);

    // Uma etiqueta (tipo dose) e uma dose por unidade, as duas com o lote: a da etiqueta, o das doses; a da dose, o de origem.
    const doses = await ler<Record<string, unknown>>(
      `SELECT d.identificador, d.origem_lote_insumo_id, d.insumo_id, d.situacao, d.responsavel_profissional_id,
              DATE_FORMAT(d.validade_nova, '%Y-%m-%d') AS vn, e.tipo, e.lote_insumo_id, e.ordem_unitarizacao_id,
              e.identificador AS etq, e.movimento_estoque_id
         FROM dose_unitarizada d JOIN etiqueta_identificacao e ON e.id = d.etiqueta_identificacao_id
        WHERE d.ordem_unitarizacao_id = ? ORDER BY d.id`,
      [r.id],
    );
    expect(doses).toHaveLength(7);
    for (const d of doses) {
      expect(d).toMatchObject({
        origem_lote_insumo_id: m.lote,
        insumo_id: ids.dose,
        situacao: 'disponivel',
        responsavel_profissional_id: ids.profissional,
        vn: r.validadeDose,
        tipo: 'dose',
        lote_insumo_id: r.loteDoses,
        ordem_unitarizacao_id: r.id,
        movimento_estoque_id: r.movimentoEntrada,
      });
      expect(d['etq']).toBe(d['identificador']);
    }
    expect(new Set(doses.map((d) => d['identificador'])).size).toBe(7);
    expect(r.doses[0]!.linhas[2]).toContain(String(lo['numero_lote']));

    // A mesma chave devolve a mesma ordem, sem gravar de novo.
    const repetida = await porta.executarOrdem(c, ordem(), k1);
    expect(repetida.id).toBe(r.id);
    expect(
      await ler('SELECT id FROM ordem_unitarizacao WHERE estabelecimento_id = ?', [m.estA]),
    ).toHaveLength(1);

    // O rastreio: da dose ao lote de origem, com as irmãs da mesma ordem.
    const rs = await porta.rastrear(c, r.doses[3]!.identificador.toLowerCase());
    expect(rs.dose).toMatchObject({ identificador: r.doses[3]!.identificador, validadeNova: r.validadeDose });
    expect(rs.ordem).toMatchObject({ id: r.id, numero: r.numero, farmaceutico: PESSOA, rupturaLacre: true });
    expect(rs.loteOrigem).toMatchObject({ id: m.lote, numero: lo['numero_lote'], validade: lo['v'] });
    expect(rs.irmas).toHaveLength(7);
    expect(await codigoDe(porta.rastrear(contexto(m, m.estB, 't-c2092'), r.doses[0]!.identificador))).toBe(
      'dose-inexistente',
    );
  });

  it('a sobra do que foi aberto: descarte na perda sem reaproveitamento, registrada com validade com ele', async () => {
    const c = contexto(m, m.estA, 't-c2092');
    const reaproveita = (v: boolean) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-massa' }, (e) =>
        e.executar('UPDATE regra_fracionamento_insumo SET reaproveita_sobra = ? WHERE id = ?', [
          v,
          ids.regra,
        ]),
      );
    const saldoOrigem = async () =>
      Number(
        (
          await um('SELECT quantidade FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ?', [
            m.lote,
            m.localA,
          ])
        )['quantidade'],
      );
    const item = (ordemId: number) =>
      um(
        `SELECT quantidade_produzida, quantidade_perda, quantidade_sobra,
                DATE_FORMAT(validade_sobra, '%Y-%m-%d') AS vs, DATE_FORMAT(validade_resultante, '%Y-%m-%d') AS vr
           FROM ordem_unitarizacao_item WHERE ordem_unitarizacao_id = ?`,
        [ordemId],
      );
    try {
      // Sem reaproveitamento: 6 doses de 8 sem perda deixam 2 sem destino e nada é gravado.
      await reaproveita(false);
      const s0 = await saldoOrigem();
      expect(await codigoDe(porta.executarOrdem(c, ordem({ doses: 6, perda: 0 }), chave()))).toBe(
        'sobra-sem-destino',
      );
      expect(await saldoOrigem()).toBe(s0);
      // Lançada a sobra como perda (descarte), a ordem grava: perda 2, sobra 0.
      const d = await porta.executarOrdem(c, ordem({ doses: 6, perda: 2 }), chave());
      expect(d.sobra).toBe(0);
      const i1 = await item(d.id);
      expect(Number(i1['quantidade_produzida'])).toBe(6);
      expect(Number(i1['quantidade_perda'])).toBe(2);
      expect(Number(i1['quantidade_sobra'])).toBe(0);
      expect(i1['vs']).toBeNull();
      expect(await saldoOrigem()).toBe(s0 - 2);
      // Com reaproveitamento: 5 doses + 1 de perda deixam 2 de sobra, registradas com a validade da embalagem aberta.
      await reaproveita(true);
      const r = await porta.executarOrdem(c, ordem({ doses: 5, perda: 1 }), chave());
      expect(r.sobra).toBe(2);
      expect(r.validadeSobra).toBe(r.validadeDose);
      const i2 = await item(r.id);
      expect(Number(i2['quantidade_produzida'])).toBe(5);
      expect(Number(i2['quantidade_perda'])).toBe(1);
      expect(Number(i2['quantidade_sobra'])).toBe(2);
      expect(i2['vs']).toBe(i2['vr']);
      expect(await saldoOrigem()).toBe(s0 - 4);
    } finally {
      await reaproveita(true);
    }
  });

  it('recusa rendimento acima, lote de outro insumo, capela exigida, sem farmacêutico e outro estabelecimento', async () => {
    const c = contexto(m, m.estA, 't-c2092');
    const antes = (await ler('SELECT id FROM dose_unitarizada WHERE estabelecimento_id = ?', [m.estA]))
      .length;
    expect(await codigoDe(porta.executarOrdem(c, ordem({ doses: 8, perda: 1 }), chave()))).toBe(
      'rendimento-acima',
    );
    expect(await codigoDe(porta.executarOrdem(c, ordem({ lote: m.loteSuspeito }), chave()))).toBe(
      'lote-origem-obrigatorio',
    );
    expect(await codigoDe(porta.executarOrdem(c, ordem({ quantidadeOrigem: 9, doses: 30 }), chave()))).toBe(
      'saldo-insuficiente',
    );
    // A reserva da separação (C1-118): o lote ou o item do local reservado para uma requisição não abre ordem.
    const reservar = (tabela: 'saldo_lote' | 'saldo_estoque', q: number) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-massa' }, (e) =>
        tabela === 'saldo_lote'
          ? e.executar(
              'UPDATE saldo_lote SET quantidade_reservada = ? WHERE local_estoque_id = ? AND lote_insumo_id = ?',
              [q, m.localA, m.lote],
            )
          : e.executar(
              'UPDATE saldo_estoque SET quantidade_reservada = ? WHERE local_estoque_id = ? AND insumo_id = ?',
              [q, m.localA, m.insumo],
            ),
      );
    const fisico = await ler(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
      [m.localA, m.lote],
    );
    const total = Number(fisico[0]?.['quantidade']);
    await reservar('saldo_lote', total - 1);
    expect(await codigoDe(porta.executarOrdem(c, ordem(), chave()))).toBe('saldo-insuficiente');
    await reservar('saldo_lote', 0);
    const doItem = await ler(
      'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA, m.insumo],
    );
    await reservar('saldo_estoque', Number(doItem[0]?.['quantidade']) - 1);
    expect(await codigoDe(porta.executarOrdem(c, ordem(), chave()))).toBe('saldo-insuficiente');
    await reservar('saldo_estoque', 0);
    expect(
      Number(
        (
          await ler('SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?', [
            m.localA,
            m.lote,
          ])
        )[0]?.['quantidade'],
      ),
    ).toBe(total);
    expect(await codigoDe(porta.executarOrdem(c, ordem({ percentualEstabilidade: 60 }), chave()))).toBe(
      'estabilidade-sem-justificativa',
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-massa' }, (e) =>
      e.executar('UPDATE regra_fracionamento_insumo SET exige_capela = TRUE WHERE id = ?', [ids.regra]),
    );
    expect(await codigoDe(porta.executarOrdem(c, ordem(), chave()))).toBe('capela-obrigatoria');
    expect(await codigoDe(porta.executarOrdem(contexto(m, m.estB, 't-c2092'), ordem(), chave()))).toBe(
      'local-inexistente',
    );
    expect(
      await codigoDe(
        porta.executarOrdem(contexto(m, m.estB, 't-c2092'), ordem({ local: m.localB }), chave()),
      ),
    ).toBe('lote-origem-obrigatorio');
    // Com a capela: grava; sem vínculo de profissional no estabelecimento, a ordem pede o farmacêutico.
    const r = await porta.executarOrdem(
      c,
      ordem({ capela: m.capelaA, quantidadeOrigem: 1, doses: 4, perda: 0 }),
      chave(),
    );
    expect(
      (await um('SELECT capela_manipulacao_id FROM ordem_unitarizacao WHERE id = ?', [r.id]))[
        'capela_manipulacao_id'
      ],
    ).toBe(m.capelaA);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2092-massa' }, (e) =>
      e.executar('DELETE FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?', [
        m.usuario,
        m.estA,
      ]),
    );
    expect(
      await codigoDe(
        porta.executarOrdem(
          c,
          ordem({ capela: m.capelaA, quantidadeOrigem: 1, doses: 4, perda: 0 }),
          chave(),
        ),
      ),
    ).toBe('sem-farmaceutico');
    expect((await ler('SELECT id FROM dose_unitarizada WHERE estabelecimento_id = ?', [m.estA])).length).toBe(
      antes + 4,
    );
  });
});
