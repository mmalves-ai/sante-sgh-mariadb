// Contrato de efeito do fechamento da checagem do turno e do lote lido na administração (03-PEP L113), no MariaDB:
// a leitura que não confere só segue com a justificativa (administracao_lote_lido com o resultado); o turno fecha
// travando só os horários resolvidos (os pendentes seguem, com a justificativa de quem fecha); o horário fechado não
// muda até a reabertura com motivo; o fechamento reaberto fica no histórico; trilha na mesma transação.
// A leitura liga a dose ao produto e ao lote do estoque (GTIN do cadastro, código da embalagem, DataMatrix GS1 com a
// validade que desempata o lote); o pendente passado adiante volta no fechamento do turno seguinte; a composição de cada
// fechamento (travados e pendentes) e a justificativa ficam gravadas e sobrevivem à reabertura.
import { createHash, randomUUID } from 'node:crypto';
import { paragrafosDoRegistroTurno, turnoDoInstante } from '@sgh/dominio-enfermagem';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import { PortaDocumentosPropria } from '../pep/documentos-porta-propria.js';
import { ServicoDocumentos } from '../pep/documentos-servico.js';
import { fusoDe, instanteDe } from './banco-apoio.js';
import {
  CODIGO_TIPO_REGISTRO_TURNO,
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
  let h: number[] = [];
  /** Horários do turno anterior: hp fica pendente e é passado adiante; hq é administrado no turno dele. */
  let hp = 0;
  let hq = 0;
  let data = '';
  let turno: 'diurno' | 'noturno' = 'diurno';
  let dataAnterior = '';
  let turnoAnterior: 'diurno' | 'noturno' = 'noturno';
  const lotes = { ok: 0, bloqueado: 0, vencido: 0 };
  let insumoA = 0;
  let validadeOk = '';
  let validadeBloqueado = '';
  const GTIN_A = '7890000113001';
  const GTIN_B = '7890000113002';
  const CAIXA_A = '17890000113001';
  const gs1 = (validade: string, lote: string) =>
    `(01)${CAIXA_A}(17)${validade.slice(2, 4)}${validade.slice(5, 7)}${validade.slice(8, 10)}(10)${lote}`;
  let horaReal = '';
  /** Conta sem vínculo de profissional (o registro no prontuário precisa do autor). */
  let semVinculo = 0;

  const ctx = (est = m!.est, usuario = m!.usuario): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario,
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
            quantidade: situacao === 'A' ? 1 : 0,
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
      // O registro do turno no prontuário (C1-023): a ligação, o evento e o documento sintéticos deste teste.
      const fp = `fechamento_checagem_paciente fp JOIN fechamento_horario_checagem f ON f.id = fp.fechamento_horario_checagem_id AND f.${em}`;
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN ${fp} ON fp.documento_prontuario_id = ev.documento_prontuario_id`,
        ests,
      );
      await e.executar(`UPDATE ${fp} SET fp.documento_prontuario_id = NULL`, ests);
      await e.executar(
        `DELETE d FROM documento_prontuario d JOIN ${fp} ON d.entidade_origem = 'fechamento_checagem_paciente' AND d.entidade_origem_id = fp.id`,
        ests,
      );
      await e.executar(`DELETE fp FROM ${fp}`, ests);
      await e.executar(
        `DELETE x FROM fechamento_checagem_horario x JOIN fechamento_horario_checagem f ON f.id = x.fechamento_horario_checagem_id WHERE f.${em}`,
        ests,
      );
      await e.executar(`DELETE FROM lote_insumo WHERE ${em} AND numero_lote LIKE 'L0113-%'`, ests);
      await e.executar(
        "DELETE b FROM insumo_codigo_barras b JOIN insumo i ON i.id = b.insumo_id WHERE i.codigo LIKE 'L0113-%'",
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
    const civilAnterior = new Intl.DateTimeFormat('sv-SE', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(inicio - 30 * 60_000))
      .replace(' ', 'T');
    const ja = turnoDoInstante(civilAnterior);
    dataAnterior = ja.inicio.slice(0, 10);
    turnoAnterior = ja.nome;
    const ano = Number(data.slice(0, 4));
    validadeOk = `${ano + 2}-06-30`;
    validadeBloqueado = `${ano + 1}-03-31`;
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
      // O registro do turno vai ao prontuário (C1-023): o tipo de documento do registro de enfermagem e a situação
      // "lançado" vêm da migração 06_PEP/99_fechamento_checagem_cadastro (todo cliente nasce com eles); nada semeado aqui.
      semVinculo = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`${MARCA}.semvinculo`],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO SEM VINCULO', 'pessoa', TRUE, ?)",
        [`${MARCA}.semvinculo`, agora],
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
      h = [await novo(1), await novo(2), await novo(3), await novo(4), await novo(5)];
      hq = await novo(-40);
      hp = await novo(-30);
      // Estoque sintético: o insumo A (GTIN no cadastro e a caixa na embalagem) com o lote liberado e, com o mesmo
      // número e outra validade, o bloqueado; o lote vencido pela data; o insumo B só para a divergência.
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_insumo WHERE codigo = ?',
        [`${MARCA}-G`],
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GRUPO SINTETICO', 'medicamento', ?)",
        [`${MARCA}-G`, agora],
      );
      const um = await garantir(
        e,
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        [MARCA],
        "INSERT INTO unidade_medida (codigo, descricao, sigla, uso_estoque, criado_em) VALUES (?, 'UNIDADE SINTETICA', 'US', TRUE, ?)",
        [MARCA, agora],
      );
      const produto = (codigo: string, gtin: string) =>
        garantir(
          e,
          'SELECT id FROM insumo WHERE codigo = ?',
          [codigo],
          "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, codigo_gtin, criado_em) VALUES (?, 'PRODUTO SINTETICO', 'medicamento', ?, ?, ?, ?)",
          [codigo, grupo, um, gtin, agora],
        );
      insumoA = await produto(`${MARCA}-A`, GTIN_A);
      await produto(`${MARCA}-B`, GTIN_B);
      await e.inserir(
        "INSERT INTO insumo_codigo_barras (insumo_id, sequencia, codigo_barras, padrao, quantidade_representada, unidade_medida_id, criado_em) VALUES (?, 1, ?, 'datamatrix', 10, ?, ?)",
        [insumoA, CAIXA_A, um, agora],
      );
      const lote = (numero: string, validade: string, situacao: string) =>
        e.inserir(
          'INSERT INTO lote_insumo (estabelecimento_id, insumo_id, numero_lote, validade, situacao, motivo_bloqueio, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            m!.est,
            insumoA,
            numero,
            validade,
            situacao,
            situacao === 'bloqueado' ? 'Desvio de qualidade' : null,
            agora,
          ],
        );
      lotes.ok = await lote('L0113-OK', validadeOk, 'liberado');
      lotes.bloqueado = await lote('L0113-OK', validadeBloqueado, 'bloqueado');
      lotes.vencido = await lote('L0113-VENC', '2020-01-31', 'liberado');
    });
  });

  afterAll(async () => {
    await limparMinha();
    await limparMassa(nucleo, m);
    await nucleo?.encerrar();
  });

  const lido = (horario: number) =>
    uma(
      'SELECT sequencia, codigo_lido, meio_leitura, resultado, insumo_id, lote_insumo_id, justificativa, lido_por_usuario_id AS u FROM administracao_lote_lido WHERE horario_administracao_id = ?',
      [horario],
    );

  it('a leitura liga a dose ao produto e ao lote do estoque; a que não confere só segue com justificativa', async () => {
    const c = ctx();
    // Conforme pelo GTIN do cadastro e o lote liberado (a validade lida desempata o lote de mesmo número).
    await checar(c, h[0]!, 'A', { gtin: GTIN_A, lote: 'L0113-OK', validade: validadeOk });
    expect(await lido(h[0]!)).toMatchObject({
      sequencia: 1,
      codigo_lido: GTIN_A,
      meio_leitura: 'codigo_barras',
      resultado: 'conforme',
      insumo_id: insumoA,
      lote_insumo_id: lotes.ok,
      justificativa: null,
      u: m!.usuario,
    });
    // O que não confere é recusado sem a observação, e nada é gravado no horário.
    for (const [leitura, resultado] of [
      [{ codigoLido: gs1(validadeBloqueado, 'L0113-OK') }, 'lote bloqueado'],
      [{ gtin: GTIN_B, lote: 'L0113-OK', validade: validadeOk }, 'produto divergente'],
      [{ gtin: GTIN_A, lote: 'L0113-VENC' }, 'lote vencido'],
      [{ gtin: '7890000113999', lote: 'L0113-SEM-CADASTRO' }, 'nao identificado'],
    ] as const)
      await expect(checar(c, h[3]!, 'A', leitura)).rejects.toMatchObject({
        problema: { codigo: 'leitura-nao-conforme', detail: expect.stringContaining(`(${resultado})`) },
      });
    expect(await uma('SELECT versao FROM horario_administracao WHERE id = ?', [h[3]])).toMatchObject({
      versao: 1,
    });
    expect(
      await uma('SELECT COUNT(*) AS n FROM administracao_lote_lido WHERE horario_administracao_id = ?', [
        h[3],
      ]),
    ).toMatchObject({ n: 0 });
    // DataMatrix GS1 da caixa (código da embalagem): o lote e a validade vêm da própria etiqueta.
    await checar(c, h[3]!, 'A', { codigoLido: gs1(validadeOk, 'L0113-OK') });
    expect(await lido(h[3]!)).toMatchObject({
      meio_leitura: 'datamatrix',
      resultado: 'conforme',
      insumo_id: insumoA,
      lote_insumo_id: lotes.ok,
      justificativa: null,
    });
    // O lote vencido segue só com a justificativa, gravada com o resultado e o lote do estoque.
    await checar(c, h[4]!, 'A', {
      gtin: GTIN_A,
      lote: 'L0113-VENC',
      observacao: 'Única ampola disponível, liberada pela farmácia',
    });
    expect(await lido(h[4]!)).toMatchObject({
      resultado: 'lote_vencido',
      insumo_id: insumoA,
      lote_insumo_id: lotes.vencido,
      justificativa: 'Única ampola disponível, liberada pela farmácia',
    });
    // Sem leitura (não administrado com motivo): nenhum lote lido.
    await checar(c, h[1]!, 'N', { motivo: 'jejum', observacao: 'Em jejum para exame' });
    expect(
      await uma('SELECT COUNT(*) AS n FROM administracao_lote_lido WHERE horario_administracao_id = ?', [
        h[1],
      ]),
    ).toMatchObject({ n: 0 });
  });

  it('fecha travando só os resolvidos; o pendente exige justificativa, fica gravado e volta no turno seguinte', async () => {
    // O turno anterior fecha com hq administrado e hp pendente, passado adiante com a justificativa.
    await checar(ctx(), hq, 'A');
    const anterior = await fechar(ctx(), {
      data: dataAnterior,
      turno: turnoAnterior,
      justificativa: 'Paciente no centro de imagem, dose passada ao plantão seguinte',
    });
    expect(anterior).toMatchObject({ travados: 1, pendentes: [hp], pendentesAnteriores: [] });

    // O registro no prontuário precisa do autor de enfermagem: a conta sem vínculo de profissional e o profissional
    // sem ocupação de enfermagem são recusados, e nada do fechamento fica gravado (a transação volta inteira).
    const justificativa = 'Dose das 3 min passada ao próximo turno, paciente no exame';
    await expect(fechar(ctx(m!.est, semVinculo), { justificativa })).rejects.toMatchObject({
      problema: { codigo: 'sem-profissional' },
    });
    await expect(fechar(ctx(m!.est, m!.usuario2), { justificativa })).rejects.toMatchObject({
      problema: { codigo: 'autor-nao-e-da-enfermagem' },
    });
    expect(
      await uma(
        'SELECT COUNT(*) AS n FROM fechamento_horario_checagem WHERE estabelecimento_id = ? AND data_referencia = ? AND fechado_por_usuario_id IN (?, ?)',
        [m!.est, data, semVinculo, m!.usuario2],
      ),
    ).toMatchObject({ n: 0 });
    const c = ctx();
    await expect(fechar(c)).rejects.toMatchObject({ problema: { codigo: 'pendencias-sem-justificativa' } });
    const r = await fechar(c, {
      justificativa: 'Dose das 3 min passada ao próximo turno, paciente no exame',
    });
    expect(r).toMatchObject({
      travados: 4,
      pendentes: [hp, h[2]],
      pendentesAnteriores: [hp],
      administrados: 3,
      naoAdministrados: 1,
    });
    expect(
      await uma(
        'SELECT situacao, quantidade_horarios AS q, quantidade_pendentes AS qp, justificativa_pendencias AS j, fechado_por_usuario_id AS u, unidade_internacao_id IS NOT NULL AS comUnidade, atendimento_id FROM fechamento_horario_checagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao: 'fechado',
      q: 4,
      qp: 2,
      j: 'Dose das 3 min passada ao próximo turno, paciente no exame',
      u: m!.usuario,
      comUnidade: 1,
      atendimento_id: null,
    });
    expect(
      await uma(
        "SELECT CAST(SUM(papel = 'travado') AS SIGNED) AS t, CAST(SUM(papel = 'pendente') AS SIGNED) AS p, CAST(SUM(turno_anterior AND horario_administracao_id = ?) AS SIGNED) AS a FROM fechamento_checagem_horario WHERE fechamento_horario_checagem_id = ?",
        [hp, r.id],
      ),
    ).toMatchObject({ t: 4, p: 2, a: 1 });
    // O registro do turno vai ao prontuário do paciente: um documento por atendimento, lançado, autor = profissional.
    expect(anterior.documentos).toHaveLength(1);
    expect(r.documentos).toEqual([
      { atendimento: m!.atendimento, paciente: m!.paciente, documento: expect.any(Number) },
    ]);
    const doc = r.documentos[0]!.documento;
    expect(doc).not.toBe(anterior.documentos[0]!.documento);
    expect(
      await uma(
        'SELECT quantidade_administrados AS a, quantidade_nao_administrados AS n, quantidade_suspensos AS s, quantidade_pendentes AS p, atendimento_id AS at, paciente_id AS pa, documento_prontuario_id AS d FROM fechamento_checagem_paciente WHERE fechamento_horario_checagem_id = ?',
        [r.id],
      ),
    ).toMatchObject({ a: 3, n: 1, s: 0, p: 2, at: m!.atendimento, pa: m!.paciente, d: doc });
    expect(
      await uma(
        `SELECT d.entidade_origem AS o, d.paciente_id AS pa, d.atendimento_id AS at, d.profissional_id AS pr, d.estabelecimento_id AS e,
                d.titulo, sd.categoria AS sit, td.categoria AS cat, td.codigo AS tc, d.numero_versao AS v, d.excluido_em IS NULL AS vivo,
                JSON_LENGTH(JSON_EXTRACT(d.conteudo, '$.hash_conteudo')) AS temHash,
                (SELECT COUNT(*) FROM documento_prontuario_evento ev WHERE ev.documento_prontuario_id = d.id AND ev.acao = 'criacao') AS ev
           FROM documento_prontuario d
           JOIN situacao_documento_prontuario sd ON sd.id = d.situacao_documento_prontuario_id
           JOIN tipo_documento_clinico td ON td.id = d.tipo_documento_clinico_id
          WHERE d.id = ?`,
        [doc],
      ),
    ).toMatchObject({
      o: 'fechamento_checagem_paciente',
      pa: m!.paciente,
      at: m!.atendimento,
      pr: m!.profissional,
      e: m!.est,
      sit: 'lancado',
      cat: 'relatorio',
      tc: CODIGO_TIPO_REGISTRO_TURNO,
      v: 1,
      vivo: 1,
      temHash: 1,
      ev: 1,
    });
    expect(
      String((await uma('SELECT titulo FROM documento_prontuario WHERE id = ?', [doc]))?.['titulo'] ?? ''),
    ).toMatch(/^Registro de checagem do turno (diurno|noturno) de \d{2}\/\d{2}\/\d{4}$/);
    // O conteúdo inteiro fica no documento: a letra de cada horário no instante, a justificativa, e o hash se recalcula.
    const bruto = (await uma('SELECT conteudo FROM documento_prontuario WHERE id = ?', [doc]))?.['conteudo'];
    const gravado = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as {
      hash_conteudo: string;
      registro: Record<string, unknown>;
    };
    expect(createHash('sha256').update(JSON.stringify(gravado.registro)).digest('hex')).toBe(
      gravado.hash_conteudo,
    );
    expect(gravado.registro).toMatchObject({
      tipo: 'registro_checagem_turno',
      administrados: 3,
      nao_administrados: 1,
      justificativa_pendencias: justificativa,
      pendentes_de_turno_anterior: [hp],
    });
    const porHorario = new Map(
      (gravado.registro['horarios'] as { horario: number; letra: string; papel: string; item: string }[]).map(
        (x) => [x.horario, x],
      ),
    );
    expect(porHorario.get(h[1]!)).toMatchObject({
      letra: 'N',
      papel: 'travado',
      item: 'MEDICAMENTO SINTETICO',
    });
    expect(porHorario.get(hp)).toMatchObject({ letra: 'P', papel: 'pendente', turno_anterior: true });
    // A PEP abre o documento pelo próprio id: a prévia e o conteúdo da assinatura trazem os parágrafos do registro.
    const servico = new ServicoDocumentos(new PortaDocumentosPropria(nucleo, CLIENTE));
    const cd = {
      rede: 'rede-sintetica',
      hospital: MARCA,
      cliente: CLIENTE,
      estabelecimento: null,
      usuario: m!.usuario,
      correlacao: `${MARCA}-pep`,
    };
    const paragrafos = paragrafosDoRegistroTurno(gravado.registro)!;
    expect(paragrafos).toContain(`Justificativa das pendências: ${justificativa}`);
    expect(paragrafos.filter((x) => x.includes('MEDICAMENTO SINTETICO: não administrado'))).toHaveLength(1);
    const previa = await servico.previa(cd, doc, m!.login);
    expect(previa).toMatchObject({
      documento: doc,
      titulo: 'Registro de enfermagem do turno',
      hash: gravado.hash_conteudo,
    });
    expect(previa.paragrafos).toEqual(paragrafos);
    const lido = await servico.porta.documentoSgh(cd, doc);
    expect((await servico.conteudoParaAssinatura(cd, lido!)).conteudo.corpo).toEqual(paragrafos);
    for (const [x, esperado] of [
      [h[0]!, r.id],
      [h[1]!, r.id],
      [h[3]!, r.id],
      [h[4]!, r.id],
      [h[2]!, null],
      [hp, null],
      [hq, anterior.id],
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
    await expect(checar(ctx(), h[0]!, 'A', {}, 'A')).rejects.toMatchObject({
      problema: { codigo: 'horario-fechado' },
    });
  });

  it('reabre só com motivo; o fechamento fica no histórico com a composição, e o novo fechamento não a apaga', async () => {
    const lista = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-lista` }, (l) =>
      fechamentosDoDia(l, m!.est, UNIDADE, data),
    );
    const f = lista[0]!;
    expect(f).toMatchObject({
      situacao: 'fechado',
      horarios: 4,
      justificativaPendencias: 'Dose das 3 min passada ao próximo turno, paciente no exame',
    });
    expect([...f.travados].sort()).toEqual([h[0], h[1], h[3], h[4]].sort());
    expect(f.pendentes.map((x) => [x.horario, x.anterior, x.atendimento])).toEqual([
      [hp, true, m!.atendimento],
      [h[2], false, m!.atendimento],
    ]);
    expect(lista.map((x) => x.situacao)).toEqual(['fechado', 'fechado']);
    await expect(reabrir(ctx(), f.id, 'curto')).rejects.toMatchObject({
      problema: { codigo: 'reabertura-invalida' },
    });
    await expect(
      reabrir(ctx(m!.outroEst), f.id, 'Checagem lançada no paciente errado'),
    ).rejects.toMatchObject({
      problema: { codigo: 'fechamento-inexistente' },
    });
    expect(await reabrir(ctx(), f.id, 'Checagem lançada no paciente errado')).toEqual({
      id: f.id,
      horarios: 4,
    });
    expect(
      await uma(
        'SELECT situacao, reaberto_por_usuario_id AS u, motivo_reabertura AS mo, versao FROM fechamento_horario_checagem WHERE id = ?',
        [f.id],
      ),
    ).toMatchObject({
      situacao: 'reaberto',
      u: m!.usuario,
      mo: 'Checagem lançada no paciente errado',
      versao: 2,
    });
    // Destravado: volta a valer a regra da checagem (já checado), não a do fechamento.
    await expect(checar(ctx(), h[0]!, 'A', {}, 'A')).rejects.toMatchObject({
      problema: { codigo: 'horario-ja-checado' },
    });
    await expect(reabrir(ctx(), f.id, 'Segunda reabertura do mesmo')).rejects.toMatchObject({
      problema: { codigo: 'reabertura-invalida' },
    });
    // A dose passada adiante é dada; o novo fechamento do turno a trava junto com os demais.
    await checar(ctx(), hp, 'A');
    const novo = await fechar(ctx(), { justificativa: 'Fechamento refeito depois da correção' });
    expect(novo).toMatchObject({ travados: 5, pendentes: [h[2]] });
    const lidos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-lista2` }, (l) =>
      fechamentosDoDia(l, m!.est, UNIDADE, data),
    );
    expect(lidos.map((x) => x.situacao)).toEqual(['fechado', 'reaberto', 'fechado']);
    // Os dois conjuntos continuam no banco: o reaberto com os 4 de antes, o novo com os 5.
    expect([...lidos[1]!.travados].sort()).toEqual([h[0], h[1], h[3], h[4]].sort());
    expect([...lidos[0]!.travados].sort()).toEqual([h[0], h[1], h[3], h[4], hp].sort());
    // O documento do fechamento reaberto fica no prontuário (nunca apagado); o novo fechamento gera outro.
    expect(lidos[1]!.documentos).toEqual(f.documentos);
    expect(lidos[0]!.documentos).toEqual(novo.documentos);
    expect(novo.documentos[0]!.documento).not.toBe(f.documentos[0]!.documento);
    expect(
      await uma('SELECT COUNT(*) AS n FROM documento_prontuario WHERE id IN (?, ?) AND excluido_em IS NULL', [
        f.documentos[0]!.documento,
        novo.documentos[0]!.documento,
      ]),
    ).toMatchObject({ n: 2 });
    expect(
      await uma('SELECT fechamento_horario_checagem_id AS f FROM horario_administracao WHERE id = ?', [h[0]]),
    ).toMatchObject({ f: novo.id });
  });
});
