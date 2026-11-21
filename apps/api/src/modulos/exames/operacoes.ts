// Operações de gravação da agenda de exames (M18) sobre o banco do cliente, pelo Executor do @sgh/nucleo: cada uma
// declara as tabelas que grava; trilha, outbox e idempotência vão na mesma transação. As regras de negócio que não
// dependem do banco (cobertura do exame, motor da grade) ficam no @sgh/dominio-agenda e no serviço; aqui ficam as
// conferências sob a trava (horário livre, agenda ativa, fonte pagadora aceita, paciente ativo).
// Melhoria: marcação, cancelamento e remarcação no modelo próprio (marcacao_horario, cancelamento_marcacao,
// horario_agenda com vagas), com número de negócio e trava otimista; a remarcação sempre libera o horário antigo
// (o "transferido" do sistema antigo deixava o horário ocupado sem marcação); a grade grava a geração
// (geracao_grade) e os horários ligados a ela, com a unicidade do horário garantida pelo banco.
// Melhoria: cancelar e remarcar pela agenda de exames só alcançam marcação de agenda de natureza exame (a permissão
// de exame não desfaz consulta); a geração confere todo horário da agenda nos instantes pedidos (inclusive os
// excluídos e os extras), reativa o excluído em vez de estourar a chave única, grava as vagas da escala e se a
// prévia incluiu os feriados.
import {
  type AgendarExameEntrada,
  type CancelarExameEntrada,
  type DefinirCoberturaExameEntrada,
  esquemaAgendarExame,
  esquemaAgendarExameSemProntuario,
  esquemaCancelarExame,
  esquemaDefinirCoberturaExame,
  esquemaGerarGradeExame,
  esquemaRemarcarExame,
  type GerarGradeExameEntrada,
  type RemarcarExameEntrada,
} from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Operacao,
  recusa,
  restricaoViolada,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { OPERACOES_EXAME_DESLIGADAS } from './esquemas.js';
import { instanteCivil, minutosDaHora, normalizarHora } from './relogio.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}
const naoEncontrado = (titulo: string, detalhe: string) =>
  new ErroOperacao(404, 'registro-inexistente', titulo, detalhe);

/** Fuso do estabelecimento (cadastro); padrão do país quando vazio. */
async function fusoDe(tx: TxOperacao, est: number): Promise<string> {
  const l = await tx.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return l?.fuso_horario || 'America/Sao_Paulo';
}

interface AgendaTravada {
  readonly id: number;
  readonly ativo: boolean;
  readonly duracao: number;
}

async function agendaDeExame(tx: TxOperacao, est: number, id: number): Promise<AgendaTravada> {
  const a = await tx.uma(
    `SELECT a.id, a.ativo, a.duracao_horario_minutos
       FROM agenda_servico a JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
      WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND ca.natureza = 'exame'`,
    [id, est],
  );
  if (!a) throw naoEncontrado('Agenda não encontrada', 'A agenda de exames não existe neste estabelecimento.');
  return { id: n(a['id']), ativo: verdadeiro(a['ativo']), duracao: n(a['duracao_horario_minutos']) };
}

async function exigirFonteAceita(tx: TxOperacao, agenda: number, fonte: number): Promise<void> {
  const f = await tx.uma('SELECT id, situacao FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [fonte]);
  if (!f) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
  if (f['situacao'] !== 'ativa')
    throw recusa('convenio-inativo', 'O convênio está suspenso ou inativo: não aceita marcação.', {
      campos: ['convenio'],
    });
  const aceitas = await tx.consultar<{ fonte_pagadora_id: number }>(
    'SELECT fonte_pagadora_id FROM agenda_fonte_pagadora WHERE agenda_servico_id = ? AND excluido_em IS NULL',
    [agenda],
  );
  if (aceitas.length > 0 && !aceitas.some((x) => n(x.fonte_pagadora_id) === fonte))
    throw recusa(
      'convenio-nao-aceito',
      'A agenda não atende este convênio: escolha outra agenda do mesmo exame ou outro convênio.',
      { campos: ['convenio'] },
    );
}

/** Id de um registro de tabela de apoio pelo critério; ausente = configuração do cliente incompleta. */
async function apoio(tx: TxOperacao, sql: string, p: unknown[], falta: string): Promise<number> {
  const l = await tx.uma<{ id: number }>(sql, p);
  if (!l) throw recusa('configuracao-incompleta', `Falta cadastrar ${falta} no cliente.`);
  return n(l.id);
}

const situacaoMarcacao = (tx: TxOperacao, significado: string) =>
  apoio(
    tx,
    'SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo = TRUE ORDER BY ordem, id LIMIT 1',
    [significado],
    `a situação de marcação "${significado}"`,
  );

interface Marcar {
  readonly agenda: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly convenio: number;
  readonly exame: number | null;
  readonly retorno: boolean;
  readonly observacao: string | null;
  readonly canal: string;
  readonly remarcada: number | null;
}

/** Marca o paciente no horário (sob a trava do horário); devolve o id da marcação. */
async function marcarNoHorario(tx: TxOperacao, ctx: ContextoOperacao, e: Marcar): Promise<number> {
  const est = estabelecimentoDe(ctx);
  const usuario = usuarioDe(ctx);
  const a = await agendaDeExame(tx, est, e.agenda);
  if (!a.ativo) throw recusa('agenda-inativa', 'A agenda de exames está inativa: não aceita marcação.');
  const inicio = instanteCivil(e.data, e.hora, await fusoDe(tx, est));
  if (inicio.getTime() <= Date.now())
    throw recusa('horario-passado', 'O horário já passou pelo relógio do servidor: escolha outro.');
  const [h] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, vagas, vagas_ocupadas FROM horario_agenda
      WHERE agenda_servico_id = ? AND inicio_em = ? AND tipo_horario = 'regular' AND excluido_em IS NULL`,
    [a.id, inicio],
  );
  if (!h) throw recusa('horario-inexistente', 'O horário não existe na grade da agenda de exames.');
  if (h['situacao'] !== 'livre' || n(h['vagas_ocupadas']) >= n(h['vagas']))
    throw recusa('horario-ocupado', 'O horário já foi ocupado em outro terminal: escolha outro.');
  await exigirFonteAceita(tx, a.id, e.convenio);
  const p = await tx.uma('SELECT id, situacao FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
  if (!p) throw naoEncontrado('Paciente não encontrado', 'O cadastro do paciente não existe.');
  if (!['ativo', 'provisorio'].includes(String(p['situacao'])))
    throw recusa('paciente-inativo', 'O cadastro do paciente está inativo, unificado ou em óbito.');
  if (e.exame !== null) {
    const x = await tx.uma('SELECT id FROM exame WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL', [e.exame]);
    if (!x) throw recusa('exame-inexistente', 'O exame não existe no catálogo ou está inativo.', { campos: ['exame'] });
  }
  const tipo = await apoio(
    tx,
    "SELECT id FROM tipo_marcacao WHERE natureza = 'exame' AND ativo = TRUE ORDER BY id LIMIT 1",
    [],
    'o tipo de marcação de exame',
  );
  const canal = await apoio(
    tx,
    'SELECT id FROM canal_marcacao WHERE codigo = ? AND ativo = TRUE',
    [e.canal],
    `o canal de marcação "${e.canal}"`,
  );
  const situacao = await situacaoMarcacao(tx, 'aguardando');
  const numero = await tx.proximoNumero('marcacao_horario');
  const id = await tx.incluir('marcacao_horario', {
    estabelecimento_id: est,
    numero: numero.formatado,
    horario_agenda_id: n(h['id']),
    paciente_id: e.paciente,
    tipo_marcacao_id: tipo,
    situacao_marcacao_id: situacao,
    canal_marcacao_id: canal,
    fonte_pagadora_id: e.convenio,
    remarcada_marcacao_horario_id: e.remarcada,
    duracao_minutos: a.duracao,
    retorno: e.retorno,
    encaixe: false,
    teleatendimento: false,
    observacao: e.observacao,
    marcado_em: new Date(),
    responsavel_usuario_id: usuario,
    origem: 'sistema',
  });
  if (e.exame !== null)
    await tx.incluir('marcacao_horario_item', {
      marcacao_horario_id: id,
      sequencia: 1,
      exame_id: e.exame,
      quantidade: 1,
      lateralidade: 'nao_se_aplica',
      situacao: 'marcado',
      origem: 'sistema',
    });
  const ocupadas = n(h['vagas_ocupadas']) + 1;
  await tx.alterar('horario_agenda', n(h['id']), n(h['versao']), {
    vagas_ocupadas: ocupadas,
    situacao: ocupadas >= n(h['vagas']) ? 'ocupado' : 'livre',
  });
  return id;
}

interface Desfazer {
  readonly marcacao: number;
  readonly motivo: string;
  readonly complemento: string | null;
  readonly solicitante: string;
  readonly nova: number | null;
}

/** Marcação travada para desfazer: a situação, o horário e o paciente. */
async function marcacaoTravada(tx: TxOperacao, est: number, id: number): Promise<Linha> {
  // Só marcação de agenda de exame: a permissão de exame não alcança consulta, procedimento nem sessão.
  const [m] = await tx.consultarParaAtualizar(
    `SELECT m.id, m.versao, m.horario_agenda_id, m.paciente_id, m.fonte_pagadora_id, m.observacao,
            m.retorno, m.chegada_em, m.atendido_em, s.significado
       FROM marcacao_horario m
       JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
       JOIN horario_agenda h ON h.id = m.horario_agenda_id
       JOIN agenda_servico a ON a.id = h.agenda_servico_id
       JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
      WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL AND ca.natureza = 'exame'`,
    [id, est],
  );
  if (!m) throw naoEncontrado('Marcação não encontrada', 'A marcação não existe mais.');
  if (m['significado'] === 'cancelada') throw recusa('ja-cancelada', 'A marcação já foi cancelada.');
  if (m['atendido_em'] !== null || ['realizada', 'em_atendimento'].includes(String(m['significado'])))
    throw recusa('ja-atendido', 'O exame já foi atendido: a marcação não pode mais ser desfeita.');
  if (m['chegada_em'] !== null || m['significado'] === 'chegou')
    throw recusa(
      'paciente-com-senha',
      'O paciente já fez o check-in: cancelar agora exige o perfil de supervisor da recepção.',
    );
  return m;
}

/** Cancela a marcação travada e libera o horário; devolve o id do cancelamento. */
async function desfazerMarcacao(tx: TxOperacao, ctx: ContextoOperacao, m: Linha, d: Desfazer): Promise<number> {
  const est = estabelecimentoDe(ctx);
  const motivo = await apoio(
    tx,
    'SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ? AND ativo = TRUE',
    [d.motivo],
    `o motivo de cancelamento "${d.motivo}"`,
  );
  const cancelada = await situacaoMarcacao(tx, 'cancelada');
  const id = await tx.incluir('cancelamento_marcacao', {
    estabelecimento_id: est,
    marcacao_horario_id: n(m['id']),
    motivo_cancelamento_operacao_id: motivo,
    complemento: d.complemento,
    solicitante: d.solicitante,
    cancelado_em: new Date(),
    responsavel_usuario_id: usuarioDe(ctx),
    horario_liberado: true,
    nova_marcacao_horario_id: d.nova,
    origem: 'sistema',
  });
  await tx.alterar('marcacao_horario', n(m['id']), n(m['versao']), { situacao_marcacao_id: cancelada });
  const [h] = await tx.consultarParaAtualizar(
    'SELECT id, versao, vagas_ocupadas FROM horario_agenda WHERE id = ?',
    [n(m['horario_agenda_id'])],
  );
  if (h)
    await tx.alterar('horario_agenda', n(h['id']), n(h['versao']), {
      vagas_ocupadas: Math.max(0, n(h['vagas_ocupadas']) - 1),
      situacao: 'livre',
    });
  return id;
}

const TABELAS_MARCACAO = ['marcacao_horario', 'marcacao_horario_item', 'horario_agenda'] as const;
const TABELAS_CANCELAMENTO = ['cancelamento_marcacao', 'marcacao_horario', 'horario_agenda'] as const;

export const agendarExame = definirOperacao<AgendarExameEntrada, ResultadoOperacao>({
  nome: 'agenda.agendar_exame',
  tabelas: TABELAS_MARCACAO,
  entrada: esquemaAgendarExame,
  async gravar(tx, e, ctx) {
    const id = await marcarNoHorario(tx, ctx, {
      agenda: e.agenda,
      data: e.data,
      hora: e.hora,
      paciente: e.paciente,
      convenio: e.convenio,
      exame: e.exame,
      retorno: e.retorno,
      observacao: e.observacao ?? null,
      canal: e.canal,
      remarcada: null,
    });
    return { marcacao: id, agenda: e.agenda };
  },
  eventos: (e, r) => [{ tipo: 'agenda.exame.marcado', carga: { marcacao: r['marcacao'] ?? null, agenda: e.agenda } }],
  alvo: (_e, r) => ({ tabela: 'marcacao_horario', id: n(r['marcacao']) }),
});

export const cancelarExame = definirOperacao<CancelarExameEntrada, ResultadoOperacao>({
  nome: 'agenda.cancelar_exame',
  tabelas: TABELAS_CANCELAMENTO,
  acao: 'alteracao',
  entrada: esquemaCancelarExame,
  async gravar(tx, e, ctx) {
    const m = await marcacaoTravada(tx, estabelecimentoDe(ctx), e.marcacao);
    const cancelamento = await desfazerMarcacao(tx, ctx, m, {
      marcacao: e.marcacao,
      motivo: e.motivo,
      complemento: e.complemento ?? null,
      solicitante: e.solicitante,
      nova: null,
    });
    return { marcacao: e.marcacao, cancelamento };
  },
  eventos: (e) => [{ tipo: 'agenda.exame.cancelado', carga: { marcacao: e.marcacao } }],
  alvo: (e) => ({ tabela: 'marcacao_horario', id: e.marcacao }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const remarcarExame = definirOperacao<RemarcarExameEntrada, ResultadoOperacao>({
  nome: 'agenda.remarcar_exame',
  tabelas: [...new Set([...TABELAS_MARCACAO, ...TABELAS_CANCELAMENTO])],
  acao: 'alteracao',
  entrada: esquemaRemarcarExame,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const m = await marcacaoTravada(tx, est, e.marcacao);
    const [atual] = await tx.consultar(
      'SELECT agenda_servico_id, inicio_em FROM horario_agenda WHERE id = ?',
      [n(m['horario_agenda_id'])],
    );
    const destino = instanteCivil(e.destino.data, e.destino.hora, await fusoDe(tx, est));
    if (
      atual &&
      n(atual['agenda_servico_id']) === e.destino.agenda &&
      new Date(atual['inicio_em'] as Date).getTime() === destino.getTime()
    )
      throw recusa('mesmo-horario', 'O horário novo é o mesmo da marcação.');
    const nova = await marcarNoHorario(tx, ctx, {
      agenda: e.destino.agenda,
      data: e.destino.data,
      hora: e.destino.hora,
      paciente: n(m['paciente_id']),
      convenio: e.convenio ?? n(m['fonte_pagadora_id']),
      exame: await exameDaMarcacao(tx, e.marcacao),
      retorno: verdadeiro(m['retorno']),
      observacao: e.observacao ?? (m['observacao'] as string | null),
      canal: e.canal,
      remarcada: e.marcacao,
    });
    await desfazerMarcacao(tx, ctx, m, {
      marcacao: e.marcacao,
      motivo: e.motivo,
      complemento: e.complemento ?? null,
      solicitante: 'paciente',
      nova,
    });
    return { marcacao: nova, anterior: e.marcacao };
  },
  eventos: (e, r) => [
    { tipo: 'agenda.exame.remarcado', carga: { marcacao: r['marcacao'] ?? null, anterior: e.marcacao } },
  ],
  alvo: (_e, r) => ({ tabela: 'marcacao_horario', id: n(r['marcacao']) }),
});

async function exameDaMarcacao(tx: TxOperacao, marcacao: number): Promise<number | null> {
  const l = await tx.uma(
    'SELECT exame_id FROM marcacao_horario_item WHERE marcacao_horario_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 1',
    [marcacao],
  );
  return l && l['exame_id'] !== null ? n(l['exame_id']) : null;
}

/**
 * Vagas de cada horário pela escala vigente no dia (dia da semana, faixa e vigência); 1 quando o horário veio de uma
 * faixa informada na hora, fora da escala.
 */
async function vagasDaEscala(
  tx: TxOperacao,
  agenda: number,
  de: string,
  ate: string,
): Promise<(data: string, hora: string) => number> {
  const linhas = await tx.consultar(
    `SELECT dia_semana, TIME_FORMAT(hora_inicio, '%H:%i') AS inicio, TIME_FORMAT(hora_fim, '%H:%i') AS fim,
            vagas_por_horario, vigencia_inicio, vigencia_fim
       FROM agenda_escala
      WHERE agenda_servico_id = ? AND ativo = TRUE AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [agenda, ate, de],
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null ? null : String(v).slice(0, 10));
  return (data, horaInformada) => {
    const hora = normalizarHora(horaInformada);
    const semana = new Date(`${data}T00:00:00Z`).getUTCDay() + 1;
    const l = linhas.find(
      (x) =>
        n(x['dia_semana']) === semana &&
        String(x['inicio']) <= hora &&
        hora < String(x['fim']) &&
        (iso(x['vigencia_inicio']) ?? '') <= data &&
        (x['vigencia_fim'] === null || (iso(x['vigencia_fim']) ?? '') >= data),
    );
    return l ? Math.max(1, n(l['vagas_por_horario'])) : 1;
  };
}

export const gerarGradeExame = definirOperacao<GerarGradeExameEntrada, ResultadoOperacao>({
  nome: 'agenda.gerar_grade_exame',
  tabelas: ['geracao_grade', 'horario_agenda'],
  entrada: esquemaGerarGradeExame,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const a = await agendaDeExame(tx, est, e.agenda);
    if (!a.ativo) throw recusa('agenda-inativa', 'A agenda de exames está inativa: não aceita geração.');
    const fuso = await fusoDe(tx, est);
    const duracao = minutosDaHora(e.duracao);
    const agora = Date.now();
    const horarios = e.horarios.map((h) => {
      const inicio = instanteCivil(h.data, h.hora, fuso);
      return { data: h.data, hora: h.hora, inicio, fim: new Date(inicio.getTime() + duracao * 60_000) };
    });
    if (horarios.some((h) => h.inicio.getTime() <= agora))
      throw recusa('previa-desatualizada', 'Um horário da prévia já passou: refaça a prévia.');
    // Todo horário da agenda nos instantes pedidos, de qualquer tipo e mesmo excluído: a chave única
    // (agenda, início, posição) vale para todos. Ativo na posição 0 (regular ou extra) = a prévia ficou velha;
    // excluído na posição 0 = reativado por esta geração (o histórico da linha fica na trilha).
    const ocupados = await tx.consultarParaAtualizar(
      `SELECT id, versao, inicio_em, excluido_em FROM horario_agenda
        WHERE agenda_servico_id = ? AND encaixe_ordem = 0
          AND inicio_em IN (${horarios.map(() => '?').join(', ')})`,
      [a.id, ...horarios.map((h) => h.inicio)],
    );
    if (ocupados.some((o) => o['excluido_em'] === null))
      throw recusa(
        'previa-desatualizada',
        'A agenda mudou desde a prévia (um horário apareceu em outro terminal): refaça a prévia.',
      );
    const excluidos = new Map(ocupados.map((o) => [new Date(o['inicio_em'] as Date).getTime(), o]));
    const vagasDe = await vagasDaEscala(tx, a.id, e.de, e.ate);
    const agoraData = new Date(agora);
    const geracao = await tx.incluir('geracao_grade', {
      estabelecimento_id: est,
      agenda_servico_id: a.id,
      periodo_inicio: e.de,
      periodo_fim: e.ate,
      duracao_horario_minutos: duracao,
      inclui_feriados: e.incluirFeriados ?? false,
      sobrepoe_existentes: false,
      situacao: 'concluida',
      solicitada_em: agoraData,
      responsavel_usuario_id: usuario,
      processada_em: agoraData,
      horarios_gerados: horarios.length,
      origem: 'sistema',
    });
    try {
      for (const h of horarios) {
        const valores = {
          geracao_grade_id: geracao,
          data_referencia: h.data,
          fim_em: h.fim,
          tipo_horario: 'regular',
          situacao: 'livre',
          vagas: vagasDe(h.data, h.hora),
          vagas_ocupadas: 0,
          bloqueio_agenda_id: null,
          teleatendimento: false,
        };
        const velho = excluidos.get(h.inicio.getTime());
        if (velho) await tx.alterar('horario_agenda', n(velho['id']), n(velho['versao']), { ...valores, excluido_em: null, excluido_por: null });
        else
          await tx.incluir('horario_agenda', {
            ...valores,
            estabelecimento_id: est,
            agenda_servico_id: a.id,
            inicio_em: h.inicio,
            encaixe_ordem: 0,
            origem: 'sistema',
          });
      }
    } catch (x) {
      if (restricaoViolada(x)?.tipo === 'unica')
        throw recusa(
          'previa-desatualizada',
          'A agenda mudou desde a prévia (um horário apareceu em outro terminal): refaça a prévia.',
        );
      throw x;
    }
    return { agenda: a.id, horarios: horarios.length, geracao };
  },
  eventos: (e, r) => [
    { tipo: 'agenda.exame.grade_gerada', carga: { agenda: e.agenda, horarios: r['horarios'] ?? 0 } },
  ],
  alvo: (_e, r) => ({ tabela: 'geracao_grade', id: n(r['geracao']) }),
});

export const definirCoberturaExame = definirOperacao<DefinirCoberturaExameEntrada, ResultadoOperacao>({
  nome: 'agenda.definir_cobertura_exame',
  tabelas: ['agenda_fonte_pagadora'],
  entrada: esquemaDefinirCoberturaExame,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const a = await agendaDeExame(tx, est, e.agenda);
    const linhas = await tx.consultarParaAtualizar(
      'SELECT id, versao, fonte_pagadora_id, excluido_em FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?',
      [a.id],
    );
    const vigentes = linhas.filter((l) => l['excluido_em'] === null);
    const desta = linhas.find((l) => n(l['fonte_pagadora_id']) === e.convenio);
    if (e.acao === 'incluir') {
      const f = await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [e.convenio]);
      if (!f) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
      if (desta && desta['excluido_em'] === null) throw recusa('ja-coberto', 'O convênio já está na agenda.');
      const id = desta
        ? (await tx.alterar('agenda_fonte_pagadora', n(desta['id']), n(desta['versao']), {
            excluido_em: null,
            excluido_por: null,
          }),
          n(desta['id']))
        : await tx.incluir('agenda_fonte_pagadora', {
            agenda_servico_id: a.id,
            fonte_pagadora_id: e.convenio,
            aceita_marcacao_online: false,
          });
      return { agenda: a.id, convenio: e.convenio, registro: id };
    }
    if (!desta || desta['excluido_em'] !== null) throw recusa('nao-coberto', 'O convênio não está na agenda.');
    if (vigentes.length === 1 && !e.confirmarAceitarTodos)
      throw recusa(
        'ultima-linha',
        'É o último convênio da agenda: sem nenhum, a agenda passa a aceitar TODOS os convênios. Confirme para seguir.',
      );
    await tx.alterar('agenda_fonte_pagadora', n(desta['id']), n(desta['versao']), {
      excluido_em: new Date(),
      excluido_por: ctx.usuario,
    });
    return { agenda: a.id, convenio: e.convenio, registro: n(desta['id']) };
  },
  alvo: (_e, r) => ({ tabela: 'agenda_fonte_pagadora', id: n(r['registro']) }),
});

/** Construída e desligada (esquemas.ts): recusa sem gravar, com o motivo. */
export const agendarExameSemProntuario = definirOperacao<unknown, ResultadoOperacao>({
  nome: 'agenda.agendar_exame_sem_prontuario',
  tabelas: ['marcacao_horario'],
  entrada: esquemaAgendarExameSemProntuario,
  async gravar() {
    throw recusa(
      'operacao-nao-liberada',
      `Operação desligada: ${OPERACOES_EXAME_DESLIGADAS['agenda.agendarExameSemProntuario'] ?? ''}.`,
    );
  },
  alvo: () => ({ tabela: 'marcacao_horario', id: null }),
});

// biome-ignore lint/suspicious/noExplicitAny: o mapa junta operações de entradas diferentes
/** Operação de cada ação da tela (o nome da tela é o da permissão e da liberação; o da operação vai à trilha). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o mapa junta operações de entradas diferentes
export const OPERACOES_EXAME: Readonly<Record<string, Operacao<any, ResultadoOperacao>>> = {
  'agenda.agendarExame': agendarExame,
  'agenda.agendarExameSemProntuario': agendarExameSemProntuario,
  'agenda.cancelarExame': cancelarExame,
  'agenda.remarcarExame': remarcarExame,
  'agenda.gerarGradeExame': gerarGradeExame,
  'agenda.definirCoberturaExame': definirCoberturaExame,
};
