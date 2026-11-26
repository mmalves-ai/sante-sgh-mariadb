// Contrato de efeito do gasto de sala do ato cirúrgico (04-CC linha 100; F3.4, correção da fatia F3.4-5) no cliente
// f22_o3, com massa SINTÉTICA (estoque da massa de suprimentos "F22L0314" e o ato com códigos "C0400"; nenhuma pessoa
// real): a lista padrão (kit de outro estabelecimento recusado), o cirurgião da lista só da equipe do ato e gravado no
// gasto (o de fora recusado na tela, na gravação e na conferência), o OPME sem lote e o lote de outro estabelecimento
// recusados na gravação, o obrigatório do serviço ausente só com justificativa, a conferência com quem conferiu, o
// cancelamento do conferido só por quem confere, a reabertura e o cancelamento com motivo (nada apagado), duas
// primeiras gravações simultâneas com um gasto só, o ato cancelado e o débito sem conta aberta recusados.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENTE, SEM_BANCO } from '../suprimentos/massa-propria.spec-util.js';
import { desmontarAto, type Massa, montarAto, P } from './gasto-sala-ato.spec-util.js';
import { PortaGastoSalaPropria } from './gasto-sala-propria.js';

const nucleo = new NucleoProprio();
let m: Massa;
let porta: PortaGastoSalaPropria;
const ctx = (usuario = m.s.usuario) => ({ cliente: CLIENTE, hospital: m.hospital, usuario, correlacao: P });
const falha = (p: Promise<unknown>) =>
  p.then(
    () => ({ codigo: 'ok', campos: [] as string[], status: 0 }),
    (e: { problema?: { codigo?: string; campos?: string[]; status?: number } }) => ({
      codigo: e.problema?.codigo ?? String(e),
      campos: e.problema?.campos ?? [],
      status: e.problema?.status ?? 0,
    }),
  );
const ler = <T>(sql: string, p: unknown[]) =>
  nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
    l.consultar<T & Record<string, unknown>>(sql, p),
  );

describe.skipIf(SEM_BANCO)('gasto de sala do ato cirúrgico (04-CC linha 100): contrato de efeito', () => {
  beforeAll(async () => {
    m = await montarAto(nucleo);
    porta = new PortaGastoSalaPropria(nucleo, CLIENTE);
  }, 180_000);

  afterAll(async () => {
    if (!m) return;
    await desmontarAto(nucleo, m);
  }, 180_000);

  it('lista padrão: o serviço com o obrigatório; o kit de outro estabelecimento é recusado', async () => {
    const linha = (o: Record<string, unknown>) => ({
      procedimento: m.procedimento,
      cirurgiao: null,
      tipoAnestesia: null,
      insumo: null,
      kit: null,
      quantidade: 2,
      obrigatorio: false,
      ...o,
    });
    expect((await falha(porta.incluirLinhaLista(ctx(), linha({ kit: m.kitOutroEst })))).codigo).toBe(
      'registro-inexistente',
    );
    await porta.incluirLinhaLista(ctx(), linha({ insumo: m.s.insumo, obrigatorio: true }));
    // A lista do cirurgião de fora da equipe não tem o obrigatório do serviço.
    await porta.incluirLinhaLista(
      ctx(),
      linha({ cirurgiao: m.outro, insumo: m.s.insumoOpme, quantidade: 1 }),
    );
    const l = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lista_material_procedimento WHERE estabelecimento_id = ? AND ativo',
      [m.s.estA],
    );
    expect(Number(l[0]!.n)).toBe(2);
  });

  it('cirurgião de fora da equipe não troca a lista na tela nem na gravação', async () => {
    expect(await falha(porta.lerDoAto(ctx(), m.ato, m.outro))).toMatchObject({
      codigo: 'regra-violada',
      campos: ['cirurgiao'],
    });
    const tela = await porta.lerDoAto(ctx(), m.ato, null);
    expect(tela.cirurgiaoLista).toBe(m.cirurgiao);
    expect(tela.sugestao.map((x) => [x.insumo, x.obrigatorio])).toEqual([[m.s.insumo, true]]);
    expect(
      await falha(
        porta.gravarDoAto(ctx(), m.ato, {
          local: m.s.localA,
          cirurgiao: m.outro,
          itens: [{ insumo: m.s.insumoOpme, quantidade: 1, lote: null }],
        }),
      ),
    ).toMatchObject({ codigo: 'regra-violada', campos: ['cirurgiao'] });
  });

  it('OPME sem lote e lote de outro estabelecimento são recusados na gravação; nada grava', async () => {
    const base = { local: m.s.localA, justificativas: [{ insumo: m.s.insumo, motivo: 'nao usado no ato' }] };
    expect(
      await falha(
        porta.gravarDoAto(ctx(), m.ato, { ...base, itens: [{ insumo: m.s.insumoOpme, quantidade: 1 }] }),
      ),
    ).toMatchObject({ codigo: 'regra-violada', campos: ['itens.0.lote'] });
    expect(
      await falha(
        porta.gravarDoAto(ctx(), m.ato, {
          local: m.s.localA,
          itens: [{ insumo: m.s.insumo, quantidade: 2, lote: m.loteOutroEst }],
        }),
      ),
    ).toMatchObject({ codigo: 'regra-violada', campos: ['itens.0.lote'] });
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM consumo_cirurgia WHERE ato_cirurgico_id = ?',
      [m.ato],
    );
    expect(Number(n[0]!.n)).toBe(0);
  });

  it('o obrigatório ausente só com justificativa; grava o cirurgião da equipe e o motivo', async () => {
    const itens = [{ insumo: m.s.insumo, quantidade: 1, lote: m.s.lote, faturar: false }];
    // Sem o obrigatório do serviço e sem justificativa: recusado.
    expect(
      await falha(
        porta.gravarDoAto(ctx(), m.ato, {
          local: m.s.localA,
          itens: [{ insumo: m.s.insumoOpme, quantidade: 1, lote: null, implantePermanente: false }],
        }),
      ),
    ).toMatchObject({ codigo: 'regra-violada' });
    const r = await porta.gravarDoAto(ctx(), m.ato, { local: m.s.localA, itens });
    const [g] = await ler<{ situacao: string; cirurgiao_profissional_id: number }>(
      'SELECT situacao, cirurgiao_profissional_id FROM consumo_cirurgia WHERE id = ?',
      [r.id],
    );
    expect(g).toMatchObject({ situacao: 'aberta' });
    expect(Number(g!.cirurgiao_profissional_id)).toBe(m.cirurgiao);
    // Troca os itens: o anterior fica excluído (nunca apagado) e o obrigatório tirado entra com justificativa.
    const tela = await porta.lerDoAto(ctx(), m.ato, null);
    await porta.gravarDoAto(ctx(), m.ato, {
      local: m.s.localA,
      versao: tela.gasto!.versao,
      itens: [],
      justificativas: [{ insumo: m.s.insumo, motivo: 'paciente com alergia ao material' }],
    });
    const it = await ler<{ vivos: number; todos: number }>(
      'SELECT SUM(excluido_em IS NULL) AS vivos, COUNT(*) AS todos FROM consumo_cirurgia_item WHERE consumo_cirurgia_id = ?',
      [r.id],
    );
    expect([Number(it[0]!.vivos), Number(it[0]!.todos)]).toEqual([0, 1]);
    const mot = await ler<{ tipo: string; insumo_id: number }>(
      'SELECT tipo, insumo_id FROM consumo_cirurgia_motivo WHERE consumo_cirurgia_id = ?',
      [r.id],
    );
    expect(mot.map((x) => [x.tipo, Number(x.insumo_id)])).toEqual([['item_nao_usado', m.s.insumo]]);
    // Volta ao item usado para seguir à conferência.
    const t2 = await porta.lerDoAto(ctx(), m.ato, null);
    await porta.gravarDoAto(ctx(), m.ato, { local: m.s.localA, versao: t2.gasto!.versao, itens });
  });

  it('confere pelo cirurgião gravado; o pedido não traz cirurgião; o conferido só se cancela por quem confere', async () => {
    const t = await porta.lerDoAto(ctx(), m.ato, null);
    expect(t.pendencias).toEqual([]);
    expect(
      (
        await falha(
          (async () => porta.conferir(ctx(), m.ato, { versao: t.gasto!.versao, cirurgiao: m.outro }))(),
        )
      ).status,
    ).toBe(400);
    await porta.conferir(ctx(m.s.usuario2), m.ato, { versao: t.gasto!.versao });
    const [g] = await ler<{ situacao: string; conferido_por_usuario_id: number; conferido_em: Date | null }>(
      'SELECT situacao, conferido_por_usuario_id, conferido_em FROM consumo_cirurgia WHERE id = ?',
      [t.gasto!.id],
    );
    expect(g!.situacao).toBe('conferida');
    expect(Number(g!.conferido_por_usuario_id)).toBe(m.s.usuario2);
    expect(g!.conferido_em).not.toBeNull();
    const v = (await porta.lerDoAto(ctx(), m.ato, null)).gasto!.versao;
    expect(
      await falha(
        porta.mudarComMotivo(ctx(), m.ato, 'cancelar', { versao: v, motivo: 'lancado errado' }, false),
      ),
    ).toMatchObject({ status: 403 });
    // Débito sem conta aberta do atendimento: recusado, e o gasto segue conferido.
    expect(await falha(porta.debitar(ctx(), m.ato, { versao: v }))).toMatchObject({
      codigo: 'regra-violada',
      campos: ['conta'],
    });
    await porta.mudarComMotivo(ctx(), m.ato, 'reabrir', { versao: v, motivo: 'faltou um fio' }, true);
    const v2 = (await porta.lerDoAto(ctx(), m.ato, null)).gasto!.versao;
    await porta.mudarComMotivo(
      ctx(),
      m.ato,
      'cancelar',
      { versao: v2, motivo: 'ato registrado em duplicidade' },
      false,
    );
    const [c] = await ler<{ situacao: string; conferido_em: Date | null }>(
      'SELECT situacao, conferido_em FROM consumo_cirurgia WHERE id = ?',
      [t.gasto!.id],
    );
    expect(c).toMatchObject({ situacao: 'cancelada', conferido_em: null });
    const mot = await ler<{ tipo: string }>(
      "SELECT tipo FROM consumo_cirurgia_motivo WHERE consumo_cirurgia_id = ? AND tipo <> 'item_nao_usado' ORDER BY id",
      [t.gasto!.id],
    );
    expect(mot.map((x) => x.tipo)).toEqual(['reabertura', 'cancelamento']);
  });

  it('duas primeiras gravações ao mesmo tempo deixam um gasto só; o ato cancelado é recusado', async () => {
    const corpo = { local: m.s.localA, itens: [{ insumo: m.s.insumo, quantidade: 1, lote: m.s.lote }] };
    const rs = await Promise.all([
      falha(porta.gravarDoAto(ctx(), m.atoConcorrente, corpo)),
      falha(porta.gravarDoAto(ctx(), m.atoConcorrente, corpo)),
    ]);
    expect(rs.map((r) => r.codigo).sort()).toEqual(['ok', 'regra-violada']);
    const n = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM consumo_cirurgia WHERE ato_cirurgico_id = ? AND situacao <> 'cancelada'",
      [m.atoConcorrente],
    );
    expect(Number(n[0]!.n)).toBe(1);
    expect(await falha(porta.gravarDoAto(ctx(), m.atoCancelado, corpo))).toMatchObject({
      codigo: 'regra-violada',
      campos: ['ato'],
    });
  });
  it('débito com conta aberta: saída do estoque, item faturável na conta com memória, o outro ao setor', async () => {
    const saldoDe = async (insumo: number) =>
      Number(
        (
          await ler<{ q: number }>(
            'SELECT quantidade AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
            [m.s.localA, insumo],
          )
        )[0]!.q,
      );
    const antes = [await saldoDe(m.s.insumo), await saldoDe(m.insumoSetor)];
    // O gasto mistura o item do setor (primeiro) e o faturável (segundo): cada grupo sai num documento próprio, e o
    // vínculo item → movimento tem de seguir o produto, não a posição no gasto.
    const r = await porta.gravarDoAto(ctx(), m.atoDebito, {
      local: m.s.localA,
      itens: [
        { insumo: m.insumoSetor, quantidade: 1, lote: null, faturar: false },
        { insumo: m.s.insumo, quantidade: 2, lote: m.s.lote, faturar: true },
      ],
    });
    const t = await porta.lerDoAto(ctx(), m.atoDebito, null);
    await porta.conferir(ctx(m.s.usuario2), m.atoDebito, { versao: t.gasto!.versao });
    const v = (await porta.lerDoAto(ctx(), m.atoDebito, null)).gasto!.versao;
    expect(await porta.debitar(ctx(), m.atoDebito, { versao: v })).toMatchObject({ id: r.id, itensConta: 1 });
    const [g] = await ler<{ situacao: string; conta_hospitalar_id: number; debitado_em: Date | null }>(
      'SELECT situacao, conta_hospitalar_id, debitado_em FROM consumo_cirurgia WHERE id = ?',
      [r.id],
    );
    expect(g!.situacao).toBe('debitada');
    expect(Number(g!.conta_hospitalar_id)).toBe(m.conta);
    expect(g!.debitado_em).not.toBeNull();
    // Cada item do gasto aponta o movimento do próprio produto; só o faturável aponta o item da conta.
    const itens = await ler<{
      insumo_id: number;
      quantidade: number;
      mov_insumo: number;
      mov_qtd: number;
      mov_atendimento: number | null;
      doc_atendimento: number | null;
      conta_item: number | null;
      ci_conta: number | null;
      ci_faturavel: number | null;
      ci_quantidade: number | null;
      ci_movimento: number | null;
      ci_lote: number | null;
      ci_situacao: string | null;
      memorias: number;
    }>(
      `SELECT i.insumo_id, i.quantidade, m.insumo_id AS mov_insumo, m.quantidade_estoque AS mov_qtd,
              m.atendimento_id AS mov_atendimento, d.atendimento_id AS doc_atendimento, i.conta_hospitalar_item_id AS conta_item,
              ci.conta_hospitalar_id AS ci_conta, ci.item_faturavel_id AS ci_faturavel, ci.quantidade AS ci_quantidade,
              ci.movimento_estoque_id AS ci_movimento, ci.lote_insumo_id AS ci_lote, ci.situacao AS ci_situacao,
              (SELECT COUNT(*) FROM conta_hospitalar_item_memoria x WHERE x.conta_hospitalar_item_id = ci.id) AS memorias
         FROM consumo_cirurgia_item i
         JOIN movimento_estoque m ON m.id = i.movimento_estoque_id
         JOIN documento_estoque d ON d.id = m.documento_estoque_id
         LEFT JOIN conta_hospitalar_item ci ON ci.id = i.conta_hospitalar_item_id
        WHERE i.consumo_cirurgia_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
      [r.id],
    );
    expect(itens).toHaveLength(2);
    const [setor, fat] = itens;
    expect(Number(setor!.mov_insumo)).toBe(m.insumoSetor);
    expect(Number(setor!.mov_qtd)).toBe(1);
    expect(setor!.doc_atendimento).toBeNull();
    expect(setor!.conta_item).toBeNull();
    expect(Number(fat!.mov_insumo)).toBe(m.s.insumo);
    expect(Number(fat!.mov_qtd)).toBe(2);
    expect(Number(fat!.doc_atendimento)).toBe(Number(fat!.mov_atendimento));
    expect(fat!.conta_item).not.toBeNull();
    expect([
      Number(fat!.ci_conta),
      Number(fat!.ci_faturavel),
      Number(fat!.ci_quantidade),
      Number(fat!.ci_lote),
      fat!.ci_situacao,
      Number(fat!.memorias),
    ]).toEqual([m.conta, m.faturavel, 2, m.s.lote, 'lancado', 1]);
    // O item da conta e o movimento se apontam.
    const [mv] = await ler<{ conta_hospitalar_item_id: number }>(
      'SELECT conta_hospitalar_item_id FROM movimento_estoque WHERE id = ?',
      [Number(fat!.ci_movimento)],
    );
    expect(Number(mv!.conta_hospitalar_item_id)).toBe(Number(fat!.conta_item));
    // O saldo do local baixou o consumido.
    expect([await saldoDe(m.s.insumo), await saldoDe(m.insumoSetor)]).toEqual([antes[0]! - 2, antes[1]! - 1]);
    // Debitado não muda: novo débito, reabertura e cancelamento recusados (o estorno é na conta e no estoque).
    const v2 = (await porta.lerDoAto(ctx(), m.atoDebito, null)).gasto!.versao;
    expect((await falha(porta.debitar(ctx(), m.atoDebito, { versao: v2 }))).codigo).not.toBe('ok');
    expect(
      (
        await falha(
          porta.mudarComMotivo(
            ctx(),
            m.atoDebito,
            'cancelar',
            { versao: v2, motivo: 'tentativa depois' },
            true,
          ),
        )
      ).codigo,
    ).not.toBe('ok');
  });
});
