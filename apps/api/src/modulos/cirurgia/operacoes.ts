// Operações de gravação do centro cirúrgico (M18) sobre o banco do cliente, pelo Executor do @sgh/nucleo: cada uma
// declara as tabelas que grava; trilha, outbox e idempotência vão na mesma transação. As regras que não dependem do
// banco ficam no @sgh/dominio-cirurgia e no controlador; aqui ficam as conferências sob a transação (sala do
// estabelecimento, sala livre, versão do agendamento, motivo e tipo de pendência cadastrados).
// Melhoria: o pedido, a agenda e o cancelamento gravam a mesma linha (agendamento_cirurgico) com trava otimista pela
// versão e o histórico em reagendamento_cirurgico na mesma transação; a equipe vai a agendamento_cirurgico_equipe
// pela função cadastrada, e os procedimentos a agendamento_cirurgico_procedimento com um só principal (UNIQUE).
// Melhoria: a marcação trava a linha da sala (FOR UPDATE) antes de conferir o horário: duas marcações na mesma sala
// entram em fila e não gravam cirurgia dupla. As regras de horário (passado, mesmo horário, procedimento vedado na
// sala, duração mínima, conflito com preparo e limpeza dos dois lados) são as do @sgh/dominio-cirurgia, aplicadas aos
// dados relidos sob a trava.
// Melhoria: a mudança de estado traduz o estado da tela para a situação do modelo pelo domínio e confere, sob a
// transação, a situação e a versão que a tela viu e a transição permitida (realizado não volta a solicitado).
import {
  type AgendarCirurgiaEntrada,
  type CancelarCirurgiaEntrada,
  type DefinirSalaUsuarioEntrada,
  esquemaAgendarCirurgia,
  esquemaCancelarCirurgia,
  esquemaDefinirSalaUsuario,
  esquemaRemarcarCirurgia,
  esquemaRegistrarCirurgia,
  type RegistrarCirurgiaEntrada,
  type RemarcarCirurgiaEntrada,
} from '@sgh/contratos';
import {
  conferirHorarioNaSala,
  conferirParticipacao,
  conferirTempos,
  conferirTransicao,
  TECNICAS,
  type OcupacaoSala,
  type SalaDaAgenda,
  situacaoDoEstado,
} from '@sgh/dominio-cirurgia';
import {
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { civil, FUSO_PADRAO, horaDe, instante, n, nn, texto } from './banco-apoio.js';
import { conferirGradeNaTx } from './grade-sala-propria.js';
import type { GravadorSghCirurgia } from './porta.js';
import { conferirAlteracaoPedido } from './regras.js';

type Linha = Record<string, unknown>;

/** Situações gravadas no agendamento (CHECK do modelo). */
export const SITUACOES_AGENDAMENTO = [
  'solicitado',
  'em_analise',
  'reprovado',
  'agendado',
  'confirmado',
  'no_bloco',
  'em_andamento',
  'realizado',
  'suspenso',
  'cancelado',
] as const;
const OCUPA_SALA = "('agendado', 'confirmado', 'no_bloco', 'em_andamento', 'realizado')";

export const TABELAS_AGENDA = [
  'agendamento_cirurgico',
  'agendamento_cirurgico_procedimento',
  'agendamento_cirurgico_equipe',
  'reagendamento_cirurgico',
] as const;
export const TABELAS_GRAVACAO_DIRETA = [
  ...TABELAS_AGENDA,
  'pendencia_agendamento_cirurgico',
  'agendamento_cirurgico_versao',
  'ato_cirurgico',
];

function est(tx: TxOperacao): number {
  const e = tx.contexto.estabelecimento;
  if (e === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return e;
}
function usuario(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return u;
}
async function fusoDe(tx: TxOperacao): Promise<string> {
  const l = await tx.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est(tx)],
  );
  return l?.fuso_horario || FUSO_PADRAO;
}
async function agendamentoDe(tx: TxOperacao, id: number): Promise<Linha> {
  const l = await tx.uma(
    `SELECT id, versao, situacao, sala_cirurgica_id, inicio_previsto_em, duracao_prevista_minutos, tempo_limpeza_minutos,
            especialidade_medica_id, cirurgiao_profissional_id
       FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est(tx)],
  );
  if (!l)
    throw new ErroOperacao(
      404,
      'registro-inexistente',
      'Agendamento inexistente',
      'O agendamento não existe neste estabelecimento.',
    );
  return l;
}
/** O pedido do portal relido sob a transação (FOR UPDATE), conferida a conta; `exigir`: recusa se não houver. */
async function pedidoDoPortal(
  tx: TxOperacao,
  id: number,
  acesso: number,
  exigir = true,
): Promise<Linha | null> {
  const [a] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, sala_cirurgica_id, inicio_previsto_em, duracao_prevista_minutos, fonte_pagadora_id,
            observacao, paciente_informado, conta_portal_profissional_externo_id
       FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est(tx)],
    { teto: 1 },
  );
  if (a && nn(a['conta_portal_profissional_externo_id']) === acesso) return a;
  if (!exigir) return null;
  throw recusa('registro-inexistente', 'O pedido não existe ou não é desta conta.');
}
async function idPorCodigo(
  tx: TxOperacao,
  tabela: 'motivo_suspensao_cirurgia' | 'tipo_pendencia_cirurgica' | 'funcao_equipe_cirurgica',
  codigo: string,
  rotulo: string,
): Promise<number> {
  const l = await tx.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo = TRUE`, [
    codigo,
  ]);
  if (!l)
    throw recusa(
      `${tabela.replace(/_/g, '-')}-inexistente`,
      `${rotulo} "${codigo}" não está no cadastro do bloco: a carga dos códigos fixos (funções da equipe, tipos de pendência, motivos) precisa ter sido aplicada a este cliente.`,
    );
  return Number(l.id);
}
async function exigirSala(tx: TxOperacao, sala: number): Promise<void> {
  const s = await tx.uma(
    "SELECT id FROM sala_cirurgica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativa'",
    [sala, est(tx)],
  );
  if (!s)
    throw recusa('sala-inexistente', 'A sala cirúrgica não existe ou não está ativa neste estabelecimento.', {
      campos: ['sala'],
    });
}
/** Trava a linha da sala (FOR UPDATE) e lê o cadastro que a agenda confere: as marcações da mesma sala entram em fila. */
async function salaTravada(tx: TxOperacao, sala: number): Promise<SalaDaAgenda> {
  const [s] = await tx.consultarParaAtualizar(
    `SELECT id, tempo_preparo_minutos, tempo_minimo_minutos, intervalo_minimo_minutos FROM sala_cirurgica
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativa'`,
    [sala, est(tx)],
    { teto: 1 },
  );
  if (!s)
    throw recusa('sala-inexistente', 'A sala cirúrgica não existe ou não está ativa neste estabelecimento.', {
      campos: ['sala'],
    });
  const vedados = await tx.consultar(
    "SELECT procedimento_cirurgico_id FROM sala_cirurgica_procedimento WHERE sala_cirurgica_id = ? AND regra = 'vedado' AND excluido_em IS NULL",
    [sala],
  );
  return {
    id: sala,
    preparoMin: n(s['tempo_preparo_minutos']),
    duracaoMinimaMin: nn(s['tempo_minimo_minutos']),
    intervaloMinimoMin: nn(s['intervalo_minimo_minutos']),
    procedimentosVedados: vedados.map((x) => n(x['procedimento_cirurgico_id'])),
  };
}
/**
 * As cirurgias que ocupam a sala no entorno do horário (um dia antes e depois), no civil do estabelecimento. A sala já
 * está travada pela PRIMEIRA instrução da transação, então o instantâneo de leitura nasce depois da marcação
 * concorrente gravada e a vê.
 */
async function ocupadasNaSala(
  tx: TxOperacao,
  sala: number,
  inicio: Date,
  fuso: string,
): Promise<OcupacaoSala[]> {
  const r = await tx.consultar(
    `SELECT id, inicio_previsto_em, duracao_prevista_minutos, tempo_limpeza_minutos FROM agendamento_cirurgico
      WHERE estabelecimento_id = ? AND sala_cirurgica_id = ? AND excluido_em IS NULL AND situacao IN ${OCUPA_SALA}
        AND inicio_previsto_em >= ? AND inicio_previsto_em < ?`,
    [est(tx), sala, new Date(inicio.getTime() - 86_400_000), new Date(inicio.getTime() + 86_400_000)],
  );
  return r.map((x) => ({
    id: n(x['id']),
    sala,
    inicio: civil(x['inicio_previsto_em'], fuso) ?? '',
    duracaoMin: n(x['duracao_prevista_minutos']),
    intervaloMin: n(x['tempo_limpeza_minutos']),
  }));
}
/** Aplica as regras de horário do domínio sob a trava da sala; recusa com o código e o campo da regra. */
async function conferirHorario(
  tx: TxOperacao,
  fuso: string,
  sala: SalaDaAgenda,
  p: {
    id: number;
    sala: number;
    inicio: Date;
    duracaoMin: number;
    limpezaMin: number;
    procedimentos: readonly number[];
    preparoMinimoMin: number;
    anterior: { sala: number; inicio: string } | null;
    excecao: boolean;
  },
): Promise<void> {
  const r = conferirHorarioNaSala(
    {
      id: p.id,
      sala: p.sala,
      inicio: civil(p.inicio, fuso) ?? '',
      duracaoMin: p.duracaoMin,
      limpezaMin: p.limpezaMin,
      procedimentos: p.procedimentos,
      preparoMinimoMin: p.preparoMinimoMin,
      agora: civil(new Date(), fuso) ?? '',
      anterior: p.anterior,
      excecao: p.excecao,
    },
    sala,
    await ocupadasNaSala(tx, p.sala, p.inicio, fuso),
  );
  if (r.recusa) throw recusa(r.recusa.codigo, r.recusa.mensagem, { campos: [r.recusa.campo] });
}
async function historico(
  tx: TxOperacao,
  id: number,
  operacao: 'inclusao' | 'alteracao' | 'exclusao',
  x: {
    antes?: Linha | null;
    sala?: number | null;
    inicio?: Date | null;
    duracao?: number | null;
    nova?: string;
    justificativa?: string | null;
    motivo?: number | null;
  },
): Promise<void> {
  await tx.incluir('reagendamento_cirurgico', {
    agendamento_cirurgico_id: id,
    operacao,
    ocorrido_em: new Date(),
    usuario_id: usuario(tx),
    anterior_sala_cirurgica_id: x.antes ? nn(x.antes['sala_cirurgica_id']) : null,
    inicio_anterior: x.antes ? (x.antes['inicio_previsto_em'] ?? null) : null,
    nova_sala_cirurgica_id: x.sala ?? null,
    inicio_novo: x.inicio ?? null,
    duracao_minutos: x.duracao ?? null,
    situacao_anterior: x.antes ? texto(x.antes['situacao']) : null,
    situacao_nova: x.nova ?? null,
    motivo_suspensao_cirurgia_id: x.motivo ?? null,
    justificativa: x.justificativa ?? null,
  });
}
async function incluirProcedimentos(
  tx: TxOperacao,
  id: number,
  principal: number,
  adicionais: readonly number[],
): Promise<void> {
  const atuais = await tx.consultar(
    'SELECT id, versao FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL',
    [id],
  );
  for (const a of atuais) await tx.excluir('agendamento_cirurgico_procedimento', n(a['id']), n(a['versao']));
  const seq = await tx.uma<{ s: number | null }>(
    'SELECT MAX(sequencia) AS s FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id = ?',
    [id],
  );
  let k = n(seq?.s);
  for (const [i, p] of [principal, ...adicionais].entries())
    await tx.incluir('agendamento_cirurgico_procedimento', {
      agendamento_cirurgico_id: id,
      sequencia: ++k,
      procedimento_cirurgico_id: p,
      principal: i === 0,
    });
}

// ── Gravação direta (solicitação, andamento, pendência, revisão da ligação) ───────────────────────────────────

const SITUACAO_PENDENCIA: Readonly<Record<string, string>> = {
  pendente: 'aberta',
  aberta: 'aberta',
  resolvida: 'resolvida',
  dispensada: 'dispensada',
  cancelada: 'cancelada',
  em_andamento: 'em_andamento',
};

/** O que a gravação direta escreveu por último (a trilha usa a tabela real, nunca o nome vindo da tela). */
export interface EscritaDireta {
  tabela: 'agendamento_cirurgico' | 'pendencia_agendamento_cirurgico' | 'ato_cirurgico';
  id: number;
}

export function gravadorCirurgia(
  tx: TxOperacao,
  escrita: { ultima: EscritaDireta | null } = { ultima: null },
): GravadorSghCirurgia {
  const anotar = (tabela: EscritaDireta['tabela'], id: number) => {
    escrita.ultima = { tabela, id };
    return id;
  };
  return {
    async solicitar(r) {
      if (!r.portal && r.idPaciente === null)
        throw recusa('paciente-obrigatorio', 'Informe o paciente do pedido.', { campos: ['paciente'] });
      if (r.cirurgiao === null)
        throw recusa('cirurgiao-obrigatorio', 'Informe o cirurgião do pedido.', { campos: ['cirurgiao'] });
      await exigirSala(tx, r.sala);
      const fuso = await fusoDe(tx);
      const inicio = instante(`${r.data} ${horaDe(r.hora)}`, fuso);
      const numero = await tx.proximoNumero('agendamento_cirurgico');
      const id = await tx.incluir('agendamento_cirurgico', {
        estabelecimento_id: est(tx),
        numero: numero.formatado,
        paciente_id: r.idPaciente,
        atendimento_id: r.reg > 0 ? r.reg : null,
        sala_cirurgica_id: r.sala,
        cirurgiao_profissional_id: r.cirurgiao,
        carater_cirurgia_id: r.carater,
        tipo_anestesia_id: r.anestesia > 0 ? r.anestesia : null,
        tipo_cobertura: 'convenio',
        fonte_pagadora_id: r.convenio,
        solicitado_em: new Date(),
        inicio_previsto_em: inicio,
        duracao_prevista_minutos: r.duracaoMin,
        situacao: 'solicitado',
        observacao: r.observacao,
        ...(r.portal
          ? {
              canal_solicitacao: 'portal',
              conta_portal_profissional_externo_id: r.portal.acesso,
              paciente_informado: r.portal.paciente,
              nascimento_informado: r.portal.nascimento,
            }
          : {}),
      });
      await incluirProcedimentos(tx, id, r.procedimento, []);
      await historico(tx, id, 'inclusao', {
        sala: r.sala,
        inicio,
        duracao: r.duracaoMin,
        nova: 'solicitado',
      });
      return anotar('agendamento_cirurgico', id);
    },
    async retirarPedidoPortal(r) {
      const a = (await pedidoDoPortal(tx, r.id, r.acesso)) as Linha;
      if (texto(a['situacao']) !== 'solicitado')
        throw recusa('solicitacao-encerrada', 'O pedido já foi confirmado, cancelado ou suspenso.');
      await tx.alterar('agendamento_cirurgico', r.id, n(a['versao']), {
        situacao: 'cancelado',
        cancelado_em: new Date(),
        observacao: r.complemento ?? a['observacao'] ?? null,
      });
      await historico(tx, r.id, 'exclusao', { antes: a, nova: 'cancelado', justificativa: r.complemento });
      anotar('agendamento_cirurgico', r.id);
    },
    async alterarPedidoPortal(r) {
      const a = await pedidoDoPortal(tx, r.id, r.acesso, false);
      const guardadas = n(
        (
          await tx.uma<{ q: number }>(
            'SELECT COUNT(*) AS q FROM agendamento_cirurgico_versao WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL',
            [r.id],
          )
        )?.q,
      );
      conferirAlteracaoPedido(
        a
          ? {
              acesso: nn(a['conta_portal_profissional_externo_id']),
              estado: texto(a['situacao']),
              agendamento: null,
              versao: guardadas + 1,
            }
          : null,
        r,
      );
      const atual = a as Linha;
      await exigirSala(tx, r.sala);
      const fuso = await fusoDe(tx);
      const procAtual = await tx.uma<{ id: number; versao: number; p: number }>(
        `SELECT id, versao, procedimento_cirurgico_id AS p FROM agendamento_cirurgico_procedimento
          WHERE agendamento_cirurgico_id = ? AND principal = TRUE AND excluido_em IS NULL LIMIT 1`,
        [r.id],
      );
      await tx.incluir('agendamento_cirurgico_versao', {
        agendamento_cirurgico_id: r.id,
        numero_versao: guardadas + 1,
        dados: JSON.stringify({
          sala: nn(atual['sala_cirurgica_id']),
          inicio: civil(atual['inicio_previsto_em'], fuso),
          duracaoMin: nn(atual['duracao_prevista_minutos']),
          procedimento: nn(procAtual?.p),
          convenio: nn(atual['fonte_pagadora_id']),
          observacao: atual['observacao'] ?? null,
          paciente: atual['paciente_informado'] ?? null,
        }),
        motivo: r.motivo.trim(),
        substituida_em: new Date(),
      });
      const inicioNovo = instante(`${r.data} ${horaDe(r.hora)}`, fuso);
      await tx.alterar('agendamento_cirurgico', r.id, n(atual['versao']), {
        sala_cirurgica_id: r.sala,
        inicio_previsto_em: inicioNovo,
        duracao_prevista_minutos: r.duracaoMin,
        fonte_pagadora_id: r.convenio,
        cirurgiao_profissional_id: r.cirurgiao,
        carater_cirurgia_id: r.carater,
        tipo_anestesia_id: r.anestesia > 0 ? r.anestesia : null,
        observacao: r.observacao,
        paciente_informado: r.paciente,
        nascimento_informado: r.nascimento,
      });
      if (procAtual && n(procAtual.p) !== r.procedimento)
        await tx.alterar('agendamento_cirurgico_procedimento', n(procAtual.id), n(procAtual.versao), {
          procedimento_cirurgico_id: r.procedimento,
        });
      else if (!procAtual) await incluirProcedimentos(tx, r.id, r.procedimento, []);
      await historico(tx, r.id, 'alteracao', {
        antes: atual,
        sala: r.sala,
        inicio: inicioNovo,
        duracao: r.duracaoMin,
        nova: 'solicitado',
        justificativa: r.motivo.trim(),
      });
      anotar('agendamento_cirurgico', r.id);
      return guardadas + 2;
    },
    async mudarEstado(r) {
      const nova = situacaoDoEstado(r.estado);
      const a = await agendamentoDe(tx, r.id);
      anotar('agendamento_cirurgico', r.id);
      if (r.visto?.versao != null && r.visto.versao !== n(a['versao'])) throw erroConflitoVersao(['versao']);
      const conferencia = conferirTransicao(texto(a['situacao']), r.estado, r.visto?.estado ?? null);
      if (conferencia === 'estado-mudou') throw erroConflitoVersao(['situacao']);
      if (conferencia !== null)
        throw recusa(
          'estado-invalido',
          `O agendamento está em "${texto(a['situacao'])}" e não pode ir a "${r.estado}".`,
        );
      if (texto(a['situacao']) === nova) return;
      const cancela = nova === 'cancelado' || nova === 'suspenso';
      const motivo =
        cancela && r.motivo ? await idPorCodigo(tx, 'motivo_suspensao_cirurgia', r.motivo, 'O motivo') : null;
      await tx.alterar('agendamento_cirurgico', r.id, n(a['versao']), {
        situacao: nova,
        ...(cancela ? { cancelado_em: new Date(), motivo_suspensao_cirurgia_id: motivo } : {}),
      });
      await historico(tx, r.id, cancela ? 'exclusao' : 'alteracao', {
        antes: a,
        sala: nn(a['sala_cirurgica_id']),
        inicio: (a['inicio_previsto_em'] as Date | null) ?? null,
        nova,
        justificativa: r.complemento ?? null,
        motivo,
      });
    },
    async gravarPendencia(r) {
      await agendamentoDe(tx, r.idEstado);
      const tipo = await idPorCodigo(tx, 'tipo_pendencia_cirurgica', r.tipo, 'O tipo de pendência');
      const situacao = SITUACAO_PENDENCIA[r.situacao];
      if (!situacao)
        throw recusa('situacao-invalida', `A situação "${r.situacao}" não vale para a pendência.`);
      const resolvida = situacao === 'resolvida' || situacao === 'dispensada';
      const atual = await tx.uma(
        `SELECT id, versao FROM pendencia_agendamento_cirurgico
          WHERE agendamento_cirurgico_id = ? AND tipo_pendencia_cirurgica_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
        [r.idEstado, tipo],
      );
      const valores = {
        situacao,
        descricao: r.observacao,
        resolvida_em: resolvida ? new Date() : null,
        resolvida_por_usuario_id: resolvida ? usuario(tx) : null,
      };
      if (atual) {
        await tx.alterar('pendencia_agendamento_cirurgico', n(atual['id']), n(atual['versao']), valores);
        return anotar('pendencia_agendamento_cirurgico', n(atual['id']));
      }
      const seq = await tx.uma<{ s: number | null }>(
        'SELECT MAX(sequencia) AS s FROM pendencia_agendamento_cirurgico WHERE agendamento_cirurgico_id = ?',
        [r.idEstado],
      );
      const id = await tx.incluir('pendencia_agendamento_cirurgico', {
        agendamento_cirurgico_id: r.idEstado,
        sequencia: n(seq?.s) + 1,
        tipo_pendencia_cirurgica_id: tipo,
        aberta_em: new Date(),
        ...valores,
      });
      return anotar('pendencia_agendamento_cirurgico', id);
    },
    async gravarLigacao(r) {
      const ato = await tx.uma(
        'SELECT id, versao FROM ato_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.idCccadcir, est(tx)],
      );
      if (!ato)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Ato inexistente',
          'O ato cirúrgico não existe neste estabelecimento.',
        );
      if (r.idCcagenda !== null) await agendamentoDe(tx, r.idCcagenda);
      await tx.alterar('ato_cirurgico', r.idCccadcir, n(ato['versao']), {
        agendamento_cirurgico_id: r.idCcagenda,
      });
      anotar('ato_cirurgico', r.idCccadcir);
    },
  };
}

// ── Operações do Executor ──────────────────────────────────────────────────────────────────────────────────

const agendar = definirOperacao<AgendarCirurgiaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.agendar-cirurgia',
  tabelas: [...TABELAS_AGENDA],
  entrada: esquemaAgendarCirurgia as never,
  async gravar(tx, e) {
    // A trava da sala é a primeira instrução: o instantâneo da transação nasce depois dela (ver ocupadasNaSala).
    const sala = await salaTravada(tx, e.sala);
    const fuso = await fusoDe(tx);
    const inicio = instante(`${e.data} ${horaDe(e.hora)}`, fuso);
    // 04-CC linha 92: a sala tem de estar aberta na grade (faixa, feriado e reserva) para a cirurgia inteira.
    await conferirGradeNaTx(tx, fuso, {
      sala: e.sala,
      inicio,
      duracaoMin: e.duracaoMin,
      especialidade: e.especialidade > 0 ? e.especialidade : null,
      cirurgiao: e.equipe.cirurgiao.id,
      excecao: !!e.excecao,
    });
    await conferirHorario(tx, fuso, sala, {
      id: e.solicitacao ?? 0,
      sala: e.sala,
      inicio,
      duracaoMin: e.duracaoMin,
      limpezaMin: e.intervaloMin ?? 0,
      procedimentos: [e.procedimento, ...e.procedimentosAdicionais],
      preparoMinimoMin: e.preparoMinimoMin ?? 0,
      anterior: null,
      excecao: !!e.excecao,
    });
    const cirurgiao = e.equipe.cirurgiao.id;
    const valores = {
      sala_cirurgica_id: e.sala,
      inicio_previsto_em: inicio,
      duracao_prevista_minutos: e.duracaoMin,
      tempo_limpeza_minutos: e.intervaloMin ?? 0,
      paciente_id: e.paciente,
      atendimento_id: e.reg > 0 ? e.reg : null,
      regime_paciente: e.atendimento === 'E' ? 'externo' : 'internado',
      especialidade_medica_id: e.especialidade > 0 ? e.especialidade : null,
      fonte_pagadora_id: e.convenio,
      tipo_cobertura: 'convenio',
      tipo_anestesia_id: e.anestesia > 0 ? e.anestesia : null,
      cirurgiao_profissional_id: cirurgiao,
      carater_cirurgia_id: e.carater,
      reserva_uti: e.recursos.includes('cti'),
      observacao: e.observacao ?? null,
      situacao: 'agendado',
    };
    let id: number;
    let antes: Linha | null = null;
    if (e.solicitacao) {
      antes = await agendamentoDe(tx, e.solicitacao);
      if (!['solicitado', 'em_analise', 'suspenso'].includes(texto(antes['situacao'])))
        throw recusa('solicitacao-encerrada', 'O pedido já foi agendado, cancelado ou reprovado.');
      await tx.alterar('agendamento_cirurgico', e.solicitacao, n(antes['versao']), valores);
      id = e.solicitacao;
    } else {
      const numero = await tx.proximoNumero('agendamento_cirurgico');
      id = await tx.incluir('agendamento_cirurgico', {
        ...valores,
        estabelecimento_id: est(tx),
        numero: numero.formatado,
        solicitado_em: new Date(),
      });
    }
    await incluirProcedimentos(tx, id, e.procedimento, e.procedimentosAdicionais);
    const membros = Object.entries({
      ...e.equipe,
      ...(e.pediatra ? { pediatra: { id: e.pediatra, cod: 0 } } : {}),
    }).filter((x): x is [string, { id: number; cod: number }] => !!x[1]);
    let seq = n(
      (
        await tx.uma<{ s: number | null }>(
          'SELECT MAX(sequencia) AS s FROM agendamento_cirurgico_equipe WHERE agendamento_cirurgico_id = ?',
          [id],
        )
      )?.s,
    );
    for (const [funcao, p] of membros)
      await tx.incluir('agendamento_cirurgico_equipe', {
        agendamento_cirurgico_id: id,
        sequencia: ++seq,
        profissional_id: p.id,
        funcao_equipe_cirurgica_id: await idPorCodigo(
          tx,
          'funcao_equipe_cirurgica',
          funcao,
          'A função da equipe',
        ),
      });
    await historico(tx, id, antes ? 'alteracao' : 'inclusao', {
      antes,
      sala: e.sala,
      inicio,
      duracao: e.duracaoMin,
      nova: 'agendado',
      justificativa: e.excecao ? `Exceção de urgência: ${e.excecao.motivo}` : null,
    });
    return { agendamento: id } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'agendamento_cirurgico', id: n((r as Linha)['agendamento']) }),
});

const remarcar = definirOperacao<RemarcarCirurgiaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.remarcar-cirurgia',
  tabelas: ['agendamento_cirurgico', 'reagendamento_cirurgico'],
  entrada: esquemaRemarcarCirurgia as never,
  async gravar(tx, e) {
    // A trava da sala de destino é a primeira instrução: o instantâneo nasce depois dela (ver ocupadasNaSala).
    const sala = await salaTravada(tx, e.sala);
    const a = await agendamentoDe(tx, e.agendamento);
    const fuso = await fusoDe(tx);
    const visto = civil(a['inicio_previsto_em'], fuso);
    if (n(a['sala_cirurgica_id']) !== e.lido.sala || visto !== `${e.lido.data} ${horaDe(e.lido.hora)}`)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Agendamento mudou',
        'O agendamento mudou desde que a tela foi aberta: atualize e confira.',
      );
    if (!['agendado', 'confirmado'].includes(texto(a['situacao'])))
      throw recusa('agendamento-encerrado', 'Só se remarca cirurgia agendada ou confirmada.');
    const inicio = instante(`${e.data} ${horaDe(e.hora)}`, fuso);
    const duracao = e.duracaoMin ?? n(a['duracao_prevista_minutos']);
    const procs = await tx.consultar(
      'SELECT procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL',
      [e.agendamento],
    );
    await conferirGradeNaTx(tx, fuso, {
      sala: e.sala,
      inicio,
      duracaoMin: duracao,
      especialidade: nn(a['especialidade_medica_id']),
      cirurgiao: nn(a['cirurgiao_profissional_id']),
      excecao: !!e.excecao,
    });
    await conferirHorario(tx, fuso, sala, {
      id: e.agendamento,
      sala: e.sala,
      inicio,
      duracaoMin: duracao,
      limpezaMin: n(a['tempo_limpeza_minutos']),
      procedimentos: procs.map((x) => n(x['procedimento_cirurgico_id'])),
      preparoMinimoMin: e.preparoMinimoMin,
      anterior: { sala: n(a['sala_cirurgica_id']), inicio: visto ?? '' },
      excecao: !!e.excecao,
    });
    await tx.alterar('agendamento_cirurgico', e.agendamento, n(a['versao']), {
      sala_cirurgica_id: e.sala,
      inicio_previsto_em: inicio,
      duracao_prevista_minutos: duracao,
    });
    await historico(tx, e.agendamento, 'alteracao', {
      antes: a,
      sala: e.sala,
      inicio,
      duracao,
      nova: texto(a['situacao']),
      justificativa: e.justificativa,
    });
    return { agendamento: e.agendamento } as ResultadoOperacao;
  },
  alvo: (e) => ({ tabela: 'agendamento_cirurgico', id: e.agendamento }),
});

const cancelar = definirOperacao<CancelarCirurgiaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.cancelar-cirurgia',
  tabelas: ['agendamento_cirurgico', 'reagendamento_cirurgico'],
  entrada: esquemaCancelarCirurgia as never,
  async gravar(tx, e) {
    const a = await agendamentoDe(tx, e.agendamento);
    if (['cancelado', 'realizado', 'reprovado'].includes(texto(a['situacao'])))
      throw recusa('agendamento-encerrado', 'A cirurgia já foi cancelada, realizada ou reprovada.');
    const motivo = await idPorCodigo(tx, 'motivo_suspensao_cirurgia', e.motivo, 'O motivo');
    const nova = e.suspender ? 'suspenso' : 'cancelado';
    await tx.alterar('agendamento_cirurgico', e.agendamento, n(a['versao']), {
      situacao: nova,
      cancelado_em: new Date(),
      motivo_suspensao_cirurgia_id: motivo,
    });
    await historico(tx, e.agendamento, 'exclusao', {
      antes: a,
      nova,
      motivo,
      justificativa: [e.solicitante, e.complemento].filter(Boolean).join(': ') || null,
    });
    return { agendamento: e.agendamento } as ResultadoOperacao;
  },
  alvo: (e) => ({ tabela: 'agendamento_cirurgico', id: e.agendamento }),
});

const definirSalaUsuario = definirOperacao<DefinirSalaUsuarioEntrada, ResultadoOperacao>({
  nome: 'cirurgia.definir-sala-usuario',
  tabelas: ['permissao_sala_usuario'],
  entrada: esquemaDefinirSalaUsuario as never,
  async gravar(tx, e) {
    await exigirSala(tx, e.sala);
    const u = await tx.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
      e.usuario,
    ]);
    if (!u) throw recusa('usuario-inexistente', 'O usuário não existe.', { campos: ['usuario'] });
    const atual = await tx.uma(
      'SELECT id, versao FROM permissao_sala_usuario WHERE sala_cirurgica_id = ? AND usuario_id = ? AND excluido_em IS NULL',
      [e.sala, u.id],
    );
    if (e.acao === 'incluir') {
      if (atual) return { permissao: n(atual['id']) } as ResultadoOperacao;
      return {
        permissao: await tx.incluir('permissao_sala_usuario', {
          sala_cirurgica_id: e.sala,
          usuario_id: Number(u.id),
        }),
      } as ResultadoOperacao;
    }
    if (!atual) throw recusa('usuario-fora-da-sala', 'O usuário não está entre os permitidos da sala.');
    await tx.excluir('permissao_sala_usuario', n(atual['id']), n(atual['versao']));
    return { permissao: n(atual['id']) } as ResultadoOperacao;
  },
  alvo: (e) => ({ tabela: 'sala_cirurgica', id: e.sala }),
});

// ── cirurgia.registrarCirurgia ─────────────────────────────────────────────────────────────────────────────

/** Funções da equipe do registro (contrato) → código da função no cadastro. */
const FUNCOES_REGISTRO = [
  'cirurgiao',
  'auxiliar1',
  'auxiliar2',
  'auxiliar3',
  'instrumentador',
  'anestesista',
  'pediatra',
  'circulante',
] as const;
const PORTE_CODIGO: Readonly<Record<string, string>> = { P: 'pequeno', M: 'medio', G: 'grande' };
const CONTAMINACAO_CLASSE: Readonly<Record<string, string>> = {
  L: 'limpa',
  P: 'potencialmente_contaminada',
  C: 'contaminada',
};
const DISPOSITIVOS = ['tubo', 'antimicrobiano', 'sonda', 'cateter', 'puncao'] as const;
export const TABELAS_REGISTRO_ATO = [
  'ato_cirurgico',
  'ato_cirurgico_procedimento',
  'ato_cirurgico_dispositivo',
  'participante_cirurgia',
] as const;

const registrar = definirOperacao<RegistrarCirurgiaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.registrar-cirurgia',
  tabelas: [...TABELAS_REGISTRO_ATO],
  entrada: esquemaRegistrarCirurgia as never,
  async gravar(tx, e) {
    await exigirSala(tx, e.sala);
    const t = conferirTempos({
      inicio: e.inicio,
      fim: e.fim,
      inicioAnestesia: e.inicioAnestesia,
      fimAnestesia: e.fimAnestesia,
    });
    const mi = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    // O término antes do início só vale virando a meia-noite (6 h ou mais de diferença).
    if (e.fim === e.inicio || (mi(e.fim) < mi(e.inicio) && mi(e.inicio) - mi(e.fim) < 360))
      throw recusa('tempos-invalidos', 'O término tem de vir depois do início.', { campos: ['fim'] });
    if (t.problemas.length > 0)
      throw recusa('tempos-invalidos', t.problemas[0]?.texto ?? 'Tempos inválidos.');
    const atendimento = await tx.uma(
      'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.reg, est(tx)],
    );
    if (!atendimento)
      throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
    if (e.agendamento !== null) {
      const a =
        (
          await tx.consultarParaAtualizar(
            'SELECT id, atendimento_id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.agendamento, est(tx)],
          )
        )[0] ?? null;
      if (!a) throw recusa('agendamento-inexistente', 'O agendamento informado não existe.');
      if (a['atendimento_id'] !== null && n(a['atendimento_id']) !== e.reg)
        throw recusa('agendamento-de-outra-internacao', 'O agendamento é de outra internação.');
      const ja = await tx.uma(
        "SELECT id FROM ato_cirurgico WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'",
        [e.agendamento],
      );
      if (ja) throw recusa('agendamento-ja-registrado', 'O agendamento já tem a cirurgia registrada.');
    }
    const fuso = await fusoDe(tx);
    // As horas são do dia do ato; as que vêm depois da incisão e são menores viram o dia seguinte (meia-noite).
    const base = instante(`${e.data} ${e.inicio}`, fuso);
    const hora = (h: string | null, depois: boolean) => {
      if (h === null) return null;
      const d = instante(`${e.data} ${horaDe(h)}`, fuso);
      return depois && d.getTime() < base.getTime() ? new Date(d.getTime() + 86_400_000) : d;
    };
    const fim = hora(e.fim, true) as Date;
    const porte = await tx.uma<{ id: number }>(
      'SELECT id FROM porte_cirurgico WHERE sigla = ? OR codigo = ? ORDER BY sigla = ? DESC LIMIT 1',
      [e.porte, PORTE_CODIGO[e.porte], e.porte],
    );
    if (!porte)
      throw recusa('cadastro-inexistente', 'O porte cirúrgico não está cadastrado.', { campos: ['porte'] });
    const contaminacao = await tx.uma<{ id: number }>(
      'SELECT id FROM classe_contaminacao_cirurgica WHERE classe = ?',
      [CONTAMINACAO_CLASSE[e.potencialContaminacao]],
    );
    if (!contaminacao)
      throw recusa('cadastro-inexistente', 'A classe de contaminação não está cadastrada.', {
        campos: ['potencialContaminacao'],
      });
    let asa: number | null = null;
    if (e.extensao.asa !== null) {
      const c = await tx.uma<{ id: number }>('SELECT id FROM classificacao_asa WHERE classe = ?', [
        e.extensao.asa,
      ]);
      if (!c) throw recusa('cadastro-inexistente', `A classe ASA ${e.extensao.asa} não está cadastrada.`);
      asa = n(c.id);
    }
    const pressao = e.pressao ? e.pressao.split(/[x/]/).map(Number) : null;
    const numero = await tx.proximoNumero('ato_cirurgico');
    const id = await tx.incluir('ato_cirurgico', {
      estabelecimento_id: est(tx),
      numero: numero.formatado,
      agendamento_cirurgico_id: e.agendamento,
      atendimento_id: e.reg,
      paciente_id: n(atendimento['paciente_id']),
      sala_cirurgica_id: e.sala,
      carater_cirurgia_id: e.carater,
      tipo_anestesia_id: e.tipoAnestesia > 0 ? e.tipoAnestesia : null,
      classe_contaminacao_cirurgica_id: n(contaminacao.id),
      porte_cirurgico_id: n(porte.id),
      fonte_pagadora_id: e.convenio > 0 ? e.convenio : null,
      codigo_cid10_pre_operatorio: e.cid10,
      entrada_sala_em: hora(e.extensao.entradaSala, false) ?? base,
      inicio_anestesia_em: hora(e.inicioAnestesia, false),
      inicio_cirurgia_em: hora(e.extensao.incisao, false) ?? base,
      fim_cirurgia_em: fim,
      fim_anestesia_em: hora(e.fimAnestesia, true),
      saida_sala_em: hora(e.extensao.saidaSala, true) ?? fim,
      supuracao: e.supuracao,
      classificacao_asa_id: asa,
      pressao_sistolica: pressao ? pressao[0] : null,
      pressao_diastolica: pressao ? pressao[1] : null,
      frequencia_cardiaca: e.pulso,
      situacao: 'realizado',
      observacao: e.extensao.observacao,
    });
    // Participação de cada função: horas dentro do tempo do paciente na sala e o percentual (padrão da função).
    const salaEntrada = e.extensao.entradaSala ?? e.inicio;
    const salaSaida = e.extensao.saidaSala ?? e.fim;
    const inicioSala = hora(e.extensao.entradaSala, false) ?? base;
    const participacao = new Map<
      string,
      { entrada: Date | null; saida: Date | null; percentual: number | null }
    >();
    for (const f of FUNCOES_REGISTRO) {
      const informado = e.participacao?.[f] ?? { entrada: null, saida: null, percentual: null };
      const r = conferirParticipacao(f, informado, { entrada: salaEntrada, saida: salaSaida });
      if (!r.ok) throw recusa('participacao-invalida', r.texto, { campos: [`participacao.${f}.${r.campo}`] });
      const emData = (m: number | null) => (m === null ? null : new Date(inicioSala.getTime() + m * 60_000));
      participacao.set(f, {
        entrada: emData(r.valor.entradaMin),
        saida: emData(r.valor.saidaMin),
        percentual: r.valor.percentual,
      });
    }
    const funcoes = new Map<string, number>();
    let participante = 0;
    for (const [i, p] of e.procedimentos.entries()) {
      const proc = await tx.incluir('ato_cirurgico_procedimento', {
        ato_cirurgico_id: id,
        sequencia: i + 1,
        procedimento_cirurgico_id: p.procedimento,
        especialidade_medica_id: p.especialidade > 0 ? p.especialidade : null,
        principal: i === 0,
        tecnica: TECNICAS.find((x) => x.codigo === p.tecnica)?.rotulo ?? null,
      });
      for (const f of FUNCOES_REGISTRO) {
        const pr = p.equipe[f];
        if (!pr) continue;
        if (!funcoes.has(f))
          funcoes.set(f, await idPorCodigo(tx, 'funcao_equipe_cirurgica', f, 'A função da equipe'));
        await tx.incluir('participante_cirurgia', {
          ato_cirurgico_id: id,
          sequencia: ++participante,
          profissional_id: pr.id,
          funcao_equipe_cirurgica_id: funcoes.get(f),
          ato_cirurgico_procedimento_id: proc,
          principal: i === 0 && f === 'cirurgiao',
          entrada_em: participacao.get(f)?.entrada ?? null,
          saida_em: participacao.get(f)?.saida ?? null,
          percentual_participacao: participacao.get(f)?.percentual ?? null,
        });
      }
    }
    for (const d of DISPOSITIVOS) {
      const u = e.usos[d];
      if (u.usado)
        await tx.incluir('ato_cirurgico_dispositivo', {
          ato_cirurgico_id: id,
          dispositivo: d,
          descricao: u.descricao,
        });
    }
    return { cirurgia: id, procedimentos: e.procedimentos.length } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'ato_cirurgico', id: Number(r['cirurgia']) }),
});

/** Operações da tela → operação do Executor. */
export const OPERACOES_CIRURGIA: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = Object.freeze(
  {
    'cirurgia.agendarCirurgia': agendar as unknown as Operacao<never, ResultadoOperacao>,
    'cirurgia.remarcarCirurgia': remarcar as unknown as Operacao<never, ResultadoOperacao>,
    'cirurgia.cancelarCirurgia': cancelar as unknown as Operacao<never, ResultadoOperacao>,
    'cirurgia.definirSalaUsuario': definirSalaUsuario as unknown as Operacao<never, ResultadoOperacao>,
    'cirurgia.registrarCirurgia': registrar as unknown as Operacao<never, ResultadoOperacao>,
  },
);
