// Contrato de efeito do fechamento da checagem do turno e do lote lido na administração (03-PEP L113), no MariaDB:
// a leitura que não confere só segue com a justificativa (administracao_lote_lido com o resultado); o turno fecha
// travando só os horários resolvidos (os pendentes seguem, com a justificativa de quem fecha); o horário fechado não
// muda até a reabertura com motivo; o fechamento reaberto fica no histórico; trilha na mesma transação.
import { randomUUID } from 'node:crypto';
import { turnoDoInstante } from '@sgh/dominio-enfermagem';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import { fusoDe, instanteDe } from './banco-apoio.js';
import {
  fechamentosDoDia,
  fecharChecagemTx,
  type PedidoFechamento,
  reabrirChecagemTx,
  TABELAS_FECHAMENTO,
} from './fechamento-checagem-propria.js';
import {
  CLIENTE,
  garantir,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const MARCA = 'L0113';
const UNIDADE = 'L0113U';

describe.skipIf(SEM_BANCO)('fechamento da checagem do turno e lote lido (03-PEP L113, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaEnfermagem | null = null;
  let enf: PortaEnfermagemPropria;
  let ocupacao = 0;
  let item = 0;
  let prescricao = 0;
  let h: [number, number, number] = [0, 0, 0];
  let data = '';
  let turno: 'diurno' | 'noturno' = 'diurno';
  let horaReal = '';

  const ctx = (est = m!.est): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario: m!.usuario,
    correlacao: `t-${MARCA}-${randomUUID().slice(0, 8)}`,
  });
  const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-${MARCA}-${randomUUID()}` });
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-confere` }, (l) => l.uma(sql, p));
  const fechar = (c: ContextoNucleo, p: Partial<PedidoFechamento> = {}) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.fechar-checagem-turno',
      TABELAS_FECHAMENTO,
      (f: { id: number }) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'fechamento_horario_checagem',
        entidadeId: f.id,
      }),
      (tx, est, an) =>
        fecharChecagemTx(tx, est, an, {
          unidade: UNIDADE,
          data,
          turno,
          atendimento: null,
          justificativa: null,
          ...p,
        }),
    );
  const reabrir = (c: ContextoNucleo, id: number, motivo: string) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.reabrir-checagem-turno',
      TABELAS_FECHAMENTO,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'fechamento_horario_checagem',
        entidadeId: id,
      },
      (tx, est, an) => reabrirChecagemTx(tx, est, an, id, motivo),
    );
  const checar = (
    c: ContextoNucleo,
    horario: number,
    situacao: 'A' | 'N',
    sgh: Record<string, unknown> = {},
    situacaoLida = 'P',
  ) =>
    enf.executar(
      c,
      'enfermagem.checarAdministracao',
      {
        prescricao,
        atendimento: m!.atendimento,
        paciente: m!.paciente,
        cbo: ocupacao,
        marcacoes: [
          {
            horario,
            item,
            situacaoLida,
            situacao,
            quantidade: situacao === 'A' ? 1 : null,
            justificativa: null,
            papel: 'principal',
          },
        ],
        sgh: {
          horaReal,
          pulseiraLida: true,
          motivoSemPulseira: null,
          gtin: null,
          lote: null,
          validade: null,
          conferente: null,
          dispositivo: null,
          origemOffline: false,
          avisos: [],
          motivo: null,
          observacao: null,
          ...sgh,
        },
        glicemia: null,
      },
      op(c),
    );

  async function limparMinha(): Promise<void> {
    if (!m) return;
    const ests = [m.est, m.outroEst];
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
      const em = 'estabelecimento_id IN (?, ?)';
      await e.executar(
        `DELETE x FROM administracao_lote_lido x JOIN horario_administracao h ON h.id = x.horario_administracao_id WHERE h.${em}`,
        ests,
      );
      await e.executar(
        `DELETE x FROM administracao_dupla_checagem x JOIN horario_administracao h ON h.id = x.horario_administracao_id WHERE h.${em}`,
        ests,
      );
      await e.executar(
        `UPDATE horario_administracao SET fechamento_horario_checagem_id = NULL WHERE ${em}`,
        ests,
      );
      await e.executar(`DELETE FROM fechamento_horario_checagem WHERE ${em}`, ests);
      await e.executar(`DELETE FROM unidade_internacao WHERE ${em} AND codigo = ?`, [...ests, UNIDADE]);
      for (const sql of sqlLimparTrilha(ests)) await e.executar(sql);
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo, MARCA, false);
    await limparMinha();
    enf = new PortaEnfermagemPropria(nucleo);
    const fuso = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-fuso` }, (l) =>
      fusoDe(l, m!.est),
    );
    const civilAgora = new Intl.DateTimeFormat('sv-SE', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date())
      .replace(' ', 'T');
    horaReal = civilAgora;
    const j = turnoDoInstante(civilAgora);
    data = j.inicio.slice(0, 10);
    turno = j.nome;
    const inicio = instanteDe(j.inicio, fuso).getTime();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo2` }, async (e) => {
      const agora = new Date();
      const setor = Number(
        (
          await e.uma<{ s: number }>('SELECT setor_funcional_id AS s FROM atendimento WHERE id = ?', [
            m!.atendimento,
          ])
        )?.s,
      );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [m!.est, `${MARCA}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UNIDADE SINTETICA', 'internacao', ?)",
        [m!.est, `${MARCA}-UA`, agora],
      );
      await e.inserir(
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, intensiva, setor_funcional_id, criado_em) VALUES (?, ?, ?, 'UNIDADE SINTETICA', 'uti_adulto', TRUE, ?, ?)",
        [m!.est, ua, UNIDADE, setor, agora],
      );
      const cbo = await garantir(
        e,
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '223505'",
        [],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('223505', 'Enfermeiro', TRUE, ?)",
        [agora],
      );
      ocupacao = await garantir(
        e,
        'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
        [m!.profissional, cbo],
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, FALSE, ?)',
        [m!.profissional, cbo, agora],
      );
      for (const [codigo, categoria] of [
        [`${MARCA}-PEND`, 'pendente'],
        [`${MARCA}-ADM`, 'administrado'],
        [`${MARCA}-NADM`, 'nao_administrado'],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM situacao_checagem WHERE codigo = ?',
          [codigo],
          'INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, categoria, categoria, agora],
        );
      const pendente = Number(
        (
          await e.uma<{ id: number }>(
            "SELECT id FROM situacao_checagem WHERE categoria = 'pendente' AND ativo AND processo_enfermagem = 'administracao' ORDER BY ordem IS NULL, ordem, id LIMIT 1",
          )
        )?.id,
      );
      const tipo = await garantir(
        e,
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        [`${MARCA}-MED`],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento', 'medicamento', ?)",
        [`${MARCA}-MED`, agora],
      );
      prescricao = await e.inserir(
        "INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em) VALUES (?, 113, ?, ?, ?, 'vigente', ?, ?, ?, ?)",
        [
          m!.est,
          m!.paciente,
          m!.atendimento,
          m!.profissional,
          agora,
          new Date(inicio - 3_600_000),
          new Date(inicio + 24 * 3_600_000),
          agora,
        ],
      );
      item = await e.inserir(
        "INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, descricao, quantidade, inicio_em, lancamento_profissional_id, criado_em) VALUES (?, 1, ?, 'MEDICAMENTO SINTETICO', 1, ?, ?, ?)",
        [prescricao, tipo, agora, m!.profissional, agora],
      );
      const novo = (min: number) =>
        e.inserir(
          'INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, previsto_em, situacao_checagem_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [m!.est, m!.atendimento, prescricao, item, new Date(inicio + min * 60_000), pendente, agora],
        );
      h = [await novo(1), await novo(2), await novo(3)];
    });
  });

  afterAll(async () => {
    await limparMinha();
    await limparMassa(nucleo, m);
    await nucleo?.encerrar();
  });

  it('a leitura que não confere só segue com justificativa; grava o lote lido com o resultado', async () => {
    const c = ctx();
    const leitura = { gtin: '7890000113001', lote: 'L0113-SEM-CADASTRO', validade: '2020-01-31' };
    await expect(checar(c, h[0], 'A', leitura)).rejects.toMatchObject({
      problema: { codigo: 'leitura-nao-conforme' },
    });
    expect(await uma('SELECT versao FROM horario_administracao WHERE id = ?', [h[0]])).toMatchObject({
      versao: 1,
    });
    await checar(c, h[0], 'A', {
      ...leitura,
      observacao: 'Lote da farmácia satélite, conferido pela farmácia',
    });
    expect(
      await uma(
        'SELECT sequencia, codigo_lido, meio_leitura, resultado, lote_insumo_id, justificativa, lido_por_usuario_id AS u FROM administracao_lote_lido WHERE horario_administracao_id = ?',
        [h[0]],
      ),
    ).toMatchObject({
      sequencia: 1,
      codigo_lido: leitura.gtin,
      meio_leitura: 'codigo_barras',
      resultado: 'lote_vencido',
      lote_insumo_id: null,
      justificativa: 'Lote da farmácia satélite, conferido pela farmácia',
      u: m!.usuario,
    });
    // Sem leitura (não administrado com motivo): nenhum lote lido.
    await checar(c, h[1], 'N', { motivo: 'Paciente em jejum para exame' });
    expect(
      await uma('SELECT COUNT(*) AS n FROM administracao_lote_lido WHERE horario_administracao_id = ?', [
        h[1],
      ]),
    ).toMatchObject({ n: 0 });
  });

  it('fecha travando só os resolvidos; o pendente exige justificativa e segue livre', async () => {
    const c = ctx();
    await expect(fechar(c)).rejects.toMatchObject({ problema: { codigo: 'pendencias-sem-justificativa' } });
    expect(
      await uma('SELECT COUNT(*) AS n FROM fechamento_horario_checagem WHERE estabelecimento_id = ?', [
        m!.est,
      ]),
    ).toMatchObject({ n: 0 });
    const r = await fechar(c, {
      justificativa: 'Dose das 3 min passada ao próximo turno, paciente no exame',
    });
    expect(r).toMatchObject({ travados: 2, pendentes: [h[2]], administrados: 1, naoAdministrados: 1 });
    expect(
      await uma(
        'SELECT situacao, quantidade_horarios AS q, fechado_por_usuario_id AS u, unidade_internacao_id IS NOT NULL AS comUnidade, atendimento_id FROM fechamento_horario_checagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({ situacao: 'fechado', q: 2, u: m!.usuario, comUnidade: 1, atendimento_id: null });
    for (const [x, esperado] of [
      [h[0], r.id],
      [h[1], r.id],
      [h[2], null],
    ] as const)
      expect(
        await uma('SELECT fechamento_horario_checagem_id AS f FROM horario_administracao WHERE id = ?', [x]),
      ).toMatchObject({ f: esperado });
    expect(
      await uma(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ? AND entidade = 'fechamento_horario_checagem'",
        [c.correlacao],
      ),
    ).toMatchObject({ n: 1 });
    // Nada novo para travar: recusa, sem segundo fechamento.
    await expect(
      fechar(ctx(), { justificativa: 'Tentativa de fechar de novo o turno' }),
    ).rejects.toMatchObject({
      problema: { codigo: 'turno-sem-horarios' },
    });
    // O horário do turno fechado não muda; o pendente continua checável depois do fechamento.
    await expect(checar(ctx(), h[0], 'A', {}, 'A')).rejects.toMatchObject({
      problema: { codigo: 'horario-fechado' },
    });
  });

  it('reabre só com motivo, no próprio estabelecimento; o fechamento fica no histórico e destrava', async () => {
    const [f] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-lista` }, (l) =>
      fechamentosDoDia(l, m!.est, UNIDADE, data),
    );
    expect(f).toMatchObject({ situacao: 'fechado', horarios: 2 });
    await expect(reabrir(ctx(), f!.id, 'curto')).rejects.toMatchObject({
      problema: { codigo: 'reabertura-invalida' },
    });
    await expect(
      reabrir(ctx(m!.outroEst), f!.id, 'Checagem lançada no paciente errado'),
    ).rejects.toMatchObject({
      problema: { codigo: 'fechamento-inexistente' },
    });
    expect(await reabrir(ctx(), f!.id, 'Checagem lançada no paciente errado')).toEqual({
      id: f!.id,
      horarios: 2,
    });
    expect(
      await uma(
        'SELECT situacao, reaberto_por_usuario_id AS u, motivo_reabertura AS mo, versao FROM fechamento_horario_checagem WHERE id = ?',
        [f!.id],
      ),
    ).toMatchObject({
      situacao: 'reaberto',
      u: m!.usuario,
      mo: 'Checagem lançada no paciente errado',
      versao: 2,
    });
    // Destravado: volta a valer a regra da checagem (já checado), não a do fechamento.
    await expect(checar(ctx(), h[0], 'A', {}, 'A')).rejects.toMatchObject({
      problema: { codigo: 'horario-ja-checado' },
    });
    await expect(reabrir(ctx(), f!.id, 'Segunda reabertura do mesmo')).rejects.toMatchObject({
      problema: { codigo: 'reabertura-invalida' },
    });
    const lidos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-lista2` }, (l) =>
      fechamentosDoDia(l, m!.est, UNIDADE, data),
    );
    expect(lidos.map((x) => x.situacao)).toEqual(['reaberto']);
  });
});
