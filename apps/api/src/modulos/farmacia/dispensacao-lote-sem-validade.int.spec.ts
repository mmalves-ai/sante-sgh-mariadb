// Lote migrado sem validade na dispensação ao paciente (recusas da carga, fase 2, decisão D1) no gravador da farmácia
// pela porta própria contra o MariaDB real (cliente de teste da massa de suprimentos, SGH_CLIENTE_TESTE; massa
// SINTÉTICA "F22L0314", nenhuma pessoa real): a dispensação ambulatorial e a dispensação por horário (a dose da
// prescrição do internado) do antimicrobiano com o lote de origem 'migracao' e validade nula são recusadas com
// `lote-sem-validade` (nunca "vencido" nem "validade diferente"), sem dispensação, receita nem baixa de saldo, e o
// horário segue sem dispensação. A perda do controlado (ajuste físico, não uso em paciente) usa o lote migrado sem
// validade: documento de baixa com movimento de perda, saldo do lote baixado e a validade segue nula.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from '../suprimentos/massa-propria.spec-util.js';
import { PortaFarmaciaPropria } from './porta-propria.js';

const NOME = 'SINTETICO RLSVF';
/** Os cadastros do horário (códigos curtos: o caráter TISS tem 10 posições). */
const PREFIXO_HORARIO = 'RLSVH';
/** O controlado da perda (nome fixo para a limpeza achar o documento e os movimentos dele). */
const NOME_CONTROLADO = 'CONTROLADO SINTETICO RLSVF';
/** A lista de controle especial criada pelo teste quando o cliente não tem a A1 (apagada no fim). */
const FONTE_LISTA = 'teste-rlsvf';

describe.skipIf(SEM_BANCO)('lote sem validade na dispensação da farmácia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let porta: PortaFarmaciaPropria;
  const ids: Record<string, number> = {};
  const ctxE = { cliente: CLIENTE, correlacao: 't-rlsvf' };
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente(ctxE, (l) => l.consultar<T>(sql, p));
  const limparProprio = () =>
    nucleo.escrever(ctxE, async (e) => {
      // A perda do controlado: conferência, movimentos e documento de baixa (o documento sai depois dos itens).
      const insC = `SELECT id FROM insumo WHERE nome = '${NOME_CONTROLADO}'`;
      const docs = (
        await e.consultar<{ id: unknown }>(
          `SELECT DISTINCT documento_estoque_id AS id FROM documento_estoque_item WHERE insumo_id IN (${insC})`,
          [],
        )
      ).map((d) => Number(d.id));
      for (const sql of [
        `DELETE FROM conferencia_controlado WHERE lote_insumo_id IN (SELECT id FROM lote_insumo WHERE insumo_id IN (${insC}))`,
        `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE insumo_id IN (${insC})`,
        `DELETE FROM movimento_lote WHERE movimento_estoque_id IN (SELECT id FROM movimento_estoque WHERE insumo_id IN (${insC}))`,
        `DELETE FROM movimento_estoque WHERE insumo_id IN (${insC})`,
        `DELETE FROM documento_estoque_item WHERE insumo_id IN (${insC})`,
      ])
        await e.executar(sql, []);
      if (docs.length)
        await e.executar(
          `DELETE FROM documento_estoque WHERE id IN (${docs.map(() => '?').join(', ')})`,
          docs,
        );
      const atds = `SELECT a.id FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
        JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome LIKE '%${NOME}'`;
      const cods = (t: string) => `DELETE FROM ${t} WHERE codigo LIKE '${PREFIXO_HORARIO}%'`;
      for (const sql of [
        `DELETE FROM horario_administracao WHERE atendimento_id IN (${atds})`,
        `DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.atendimento_id IN (${atds})`,
        `DELETE FROM prescricao WHERE atendimento_id IN (${atds})`,
        `DELETE FROM atendimento WHERE id IN (SELECT id FROM (${atds}) x)`,
        cods('item_prescritivel'),
        cods('tipo_item_prescricao'),
        cods('situacao_checagem'),
        cods('setor_funcional'),
        cods('categoria_atendimento'),
        cods('tipo_movimento_estoque'),
        cods('fonte_pagadora'),
        `DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE '${PREFIXO_HORARIO}%'`,
        `DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
        `DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
        `DELETE FROM pessoa_fisica WHERE nome LIKE '%${NOME}'`,
      ])
        await e.executar(sql, []);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await limparProprio();
    m = await montarMassa(nucleo);
    porta = new PortaFarmaciaPropria(nucleo);
    await nucleo.escrever(ctxE, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      ids.item = await x('insumo', {
        codigo: `${m.marca}RLAX`,
        nome: 'ANTIMICROBIANO SINTETICO RLSVF',
        tipo: 'medicamento',
        grupo_insumo_id: m.grupo,
        estoque_unidade_medida_id: m.unidade,
        situacao: 'ativo',
        controla_lote: true,
        controla_validade: true,
        antimicrobiano: true,
      });
      ids.lote = await x('lote_insumo', {
        estabelecimento_id: m.estA,
        insumo_id: ids.item,
        numero_lote: `${m.marca}SVF`,
        validade: null,
        situacao: 'liberado',
        origem: 'migracao',
      });
      await x('saldo_lote', {
        estabelecimento_id: m.estA,
        local_estoque_id: m.localA,
        lote_insumo_id: ids.lote,
        quantidade: 5,
        competencia: '2026-11-01',
      });
      // O controlado da lista A1 com o lote migrado sem validade (5 no local A), para a perda.
      const a1 = await e.uma<{ id: unknown }>(
        "SELECT id FROM lista_controle_especial WHERE codigo_lista = 'A1' ORDER BY id LIMIT 1",
        [],
      );
      const lista = a1
        ? Number(a1.id)
        : await x('lista_controle_especial', {
            codigo_lista: 'A1',
            descricao: 'LISTA SINTETICA RLSVF',
            versao_fonte: FONTE_LISTA,
          });
      if (
        !(await e.uma(
          "SELECT id FROM tipo_movimento_estoque WHERE natureza = 'perda' AND sentido = 'saida' AND ativo LIMIT 1",
          [],
        ))
      )
        await x('tipo_movimento_estoque', {
          codigo: `${PREFIXO_HORARIO}PD`,
          descricao: 'PERDA SINTETICA RLSVF',
          natureza: 'perda',
          sentido: 'saida',
        });
      ids.controlado = await x('insumo', {
        codigo: `${m.marca}RLCX`,
        nome: NOME_CONTROLADO,
        tipo: 'medicamento',
        grupo_insumo_id: m.grupo,
        estoque_unidade_medida_id: m.unidade,
        situacao: 'ativo',
        controla_lote: true,
        controla_validade: true,
        lista_controle_especial_id: lista,
      });
      ids.loteControlado = await x('lote_insumo', {
        estabelecimento_id: m.estA,
        insumo_id: ids.controlado,
        numero_lote: `${m.marca}SVC`,
        validade: null,
        situacao: 'liberado',
        origem: 'migracao',
      });
      await x('saldo_estoque', {
        estabelecimento_id: m.estA,
        local_estoque_id: m.localA,
        insumo_id: ids.controlado,
        quantidade: 5,
        custo_medio: 1,
      });
      await x('saldo_lote', {
        estabelecimento_id: m.estA,
        local_estoque_id: m.localA,
        lote_insumo_id: ids.loteControlado,
        quantidade: 5,
        competencia: '2026-11-01',
      });
      const pessoa = (nome: string) => x('pessoa_fisica', { nome: `${nome} ${NOME}` });
      ids.paciente = await x('paciente', {
        pessoa_fisica_id: await pessoa('PACIENTE'),
        numero_prontuario: 927_000_000 + (Date.now() % 900_000),
      });
      ids.medico = await x('profissional', {
        pessoa_fisica_id: await pessoa('MEDICO'),
        tipo: 'corpo_clinico',
      });
      // A internação com setor e a prescrição do antimicrobiano com um horário de dose pendente.
      const H = PREFIXO_HORARIO;
      ids.setor = await x('setor_funcional', {
        estabelecimento_id: m.estA,
        codigo: `${H}SF`,
        nome: 'SETOR SINTETICO RLSVH',
        tipo: 'assistencial',
      });
      ids.atendimento = await x('atendimento', {
        estabelecimento_id: m.estA,
        numero: `${H}-${Date.now() % 1e6}`,
        paciente_id: ids.paciente,
        categoria_atendimento_id: await x('categoria_atendimento', {
          codigo: `${H}CA`,
          descricao: 'CATEGORIA SINTETICA',
          tipo_base: 'internacao',
        }),
        carater_atendimento_tiss_id: await x('carater_atendimento_tiss', {
          codigo_tiss: `${H}C`,
          descricao: 'CARATER SINTETICO',
          versao_fonte: 'teste',
        }),
        fonte_pagadora_id: await x('fonte_pagadora', {
          codigo: `${H}FP`,
          nome: 'OPERADORA SINTETICA',
          tipo: 'operadora',
          situacao: 'ativa',
        }),
        profissional_id: ids.medico,
        setor_funcional_id: ids.setor,
        entrada_em: new Date(),
      });
      const tipoItem = await x('tipo_item_prescricao', {
        codigo: `${H}MED`,
        descricao: 'MEDICAMENTO SINTETICO',
        categoria: 'medicamento',
      });
      ids.prescricao = await x('prescricao', {
        estabelecimento_id: m.estA,
        numero: 927_000_000 + (Date.now() % 900_000),
        paciente_id: ids.paciente,
        atendimento_id: ids.atendimento,
        prescritor_profissional_id: ids.medico,
        situacao: 'vigente',
        prescrito_em: new Date(Date.now() - 3_600_000),
        vigencia_inicio_em: new Date(Date.now() - 3_600_000),
        vigencia_fim_em: new Date(Date.now() + 23 * 3_600_000),
      });
      const item = await x('prescricao_item', {
        prescricao_id: ids.prescricao,
        sequencia: 1,
        tipo_item_prescricao_id: tipoItem,
        item_prescritivel_id: await x('item_prescritivel', {
          codigo: `${H}IP`,
          descricao: 'ANTIMICROBIANO SINTETICO RLSVH',
          tipo_item_prescricao_id: tipoItem,
          insumo_id: ids.item,
        }),
        quantidade: 1,
        inicio_em: new Date(Date.now() - 3_600_000),
        lancamento_profissional_id: ids.medico,
        situacao: 'ativo',
      });
      ids.horario = await x('horario_administracao', {
        estabelecimento_id: m.estA,
        atendimento_id: ids.atendimento,
        prescricao_id: ids.prescricao,
        prescricao_item_id: item,
        previsto_em: new Date(Date.now() + 3_600_000),
        situacao_checagem_id: await x('situacao_checagem', {
          codigo: `${H}P`,
          descricao: 'PENDENTE SINTETICA',
          categoria: 'pendente',
        }),
      });
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparProprio();
    await limparMassa(nucleo, m);
    await nucleo.escrever(ctxE, (e) =>
      e.executar('DELETE FROM lista_controle_especial WHERE versao_fonte = ?', [FONTE_LISTA]),
    );
    await nucleo.encerrar();
  });

  it('dispensação ambulatorial: o lote sem validade é recusado com "lote sem validade"; nada gravado', async () => {
    const ctx = contexto(m, m.estA, 't-rlsvf');
    const hoje = (await porta.relogio(ctx)).hoje;
    const falha = await porta
      .gravarSgh(ctx, null, (g) =>
        g.dispensarAmbulatorial({
          paciente: ids.paciente!,
          item: ids.item!,
          lote: `${m.marca}SVF`,
          validade: '2027-12-31',
          quantidade: 1,
          receitaNumero: 'RX-RLSVF-1',
          receitaData: hoje,
          prescritor: ids.medico!,
          autor: 'rlsvf.farma',
          hoje,
        }),
      )
      .then(
        () => null,
        (e: { problema?: Record<string, unknown> }) => e.problema ?? {},
      );
    expect(falha).toMatchObject({ codigo: 'lote-sem-validade', campos: ['lote'] });
    expect(String(falha?.['detail'])).toMatch(/sem validade \(não informada na origem\)/);
    expect(String(falha?.['detail'])).not.toMatch(/vencid/i);
    const [d] = await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM dispensacao WHERE paciente_id = ?', [
      ids.paciente,
    ]);
    expect(Number(d?.n)).toBe(0);
    const [s] = await ler<{ q: unknown }>('SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ?', [
      ids.lote,
    ]);
    expect(Number(s?.q)).toBe(5);
  });

  it('dispensação por horário: a dose com o lote sem validade é recusada com "lote sem validade"; nada gravado', async () => {
    const ctx = contexto(m, m.estA, 't-rlsvh');
    // A operação da tela (o Executor confere a entrada pelo mesmo Zod e grava pelo gravador da farmácia).
    const falha = await porta
      .executar(
        ctx,
        'suprimentos.dispensarHorario',
        {
          atendimento: ids.atendimento,
          local: m.localA,
          centroCusto: m.centroCusto,
          doses: [
            {
              horario: ids.horario,
              lotes: [{ lote: `${m.marca}SVF`, validade: '2027-12-31', quantidade: 1 }],
            },
          ],
        },
        { ...ctx, chaveIdempotencia: `rlsvh-${Date.now()}` },
      )
      .then(
        () => null,
        (e: { problema?: Record<string, unknown> }) => e.problema ?? {},
      );
    expect(falha).toMatchObject({ codigo: 'lote-sem-validade', campos: ['lotes'] });
    expect(String(falha?.['detail'])).toMatch(/sem validade \(não informada na origem\)/);
    expect(String(falha?.['detail'])).not.toMatch(/vencid/i);
    const [d] = await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM dispensacao WHERE atendimento_id = ?', [
      ids.atendimento,
    ]);
    expect(Number(d?.n)).toBe(0);
    const [h] = await ler<{ d: unknown }>(
      'SELECT dispensacao_id AS d FROM horario_administracao WHERE id = ?',
      [ids.horario],
    );
    expect(h?.d ?? null).toBeNull();
    const [s] = await ler<{ q: unknown }>('SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ?', [
      ids.lote,
    ]);
    expect(Number(s?.q)).toBe(5);
  });

  it('perda do controlado (D1: ajuste físico): o lote migrado sem validade é aceito; baixa de perda e validade nula', async () => {
    const ctx = contexto(m, m.estA, 't-rlsvp');
    const r = await porta.executar(
      ctx,
      'suprimentos.registrarPerdaControlado',
      {
        item: ids.controlado,
        local: m.localA,
        centroCusto: m.centroCusto,
        lote: `${m.marca}SVC`,
        // A validade digitada não é conferida: o lote migrado não tem validade para comparar.
        validade: '2027-12-31',
        quantidade: 2,
        motivo: 'Ampola quebrada na bancada (texto sintético)',
        testemunha: 'F22L0314.RECONTA',
      },
      { ...ctx, chaveIdempotencia: `rlsvp-${Date.now()}`, reautenticadoEm: Date.now() },
    );
    const doc = Number(r.resultado['id']);
    expect(doc).toBeGreaterThan(0);
    const [s] = await ler<{ q: unknown }>(
      'SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ?',
      [ids.loteControlado, m.localA],
    );
    expect(Number(s?.q)).toBe(3);
    const [d] = await ler<{ tipo: unknown; situacao: unknown; natureza: unknown }>(
      `SELECT d.tipo, d.situacao, t.natureza FROM documento_estoque d
         JOIN tipo_movimento_estoque t ON t.id = d.tipo_movimento_estoque_id WHERE d.id = ?`,
      [doc],
    );
    expect(d).toMatchObject({ tipo: 'baixa', situacao: 'concluido', natureza: 'perda' });
    // O movimento de perda do item e a linha do documento com o lote (validade nula, nunca inventada).
    const movs = await ler<{ q: unknown; natureza: unknown; sentido: unknown }>(
      `SELECT me.quantidade AS q, t.natureza, me.natureza AS sentido FROM movimento_estoque me
         JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
        WHERE me.documento_estoque_id = ? AND me.insumo_id = ?`,
      [doc, ids.controlado],
    );
    expect(movs.map((x) => [Number(x.q), x.natureza, x.sentido])).toEqual([[2, 'perda', 'saida']]);
    const linhas = await ler<{ lote: unknown; q: unknown; v: unknown }>(
      `SELECT lote_insumo_id AS lote, quantidade AS q, data_validade AS v FROM documento_estoque_item
        WHERE documento_estoque_id = ?`,
      [doc],
    );
    expect(linhas.map((x) => [Number(x.lote), Number(x.q), x.v ?? null])).toEqual([
      [ids.loteControlado, 2, null],
    ]);
    const [l] = await ler<{ v: unknown }>('SELECT validade AS v FROM lote_insumo WHERE id = ?', [
      ids.loteControlado,
    ]);
    expect(l?.v ?? null).toBeNull();
  });
});
