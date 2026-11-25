// Fechamento da checagem do turno no banco PRÓPRIO (03-PEP L113): fechar (fechamento_horario_checagem, com os horários
// resolvidos travados por horario_administracao.fechamento_horario_checagem_id), reabrir com motivo e ler os
// fechamentos do dia da unidade. As regras são do domínio (conferirFechamentoChecagem, conferirReabertura); aqui só a leitura,
// a trava das linhas e a gravação, dentro da operação do Executor (trilha e idempotência na mesma transação, pela
// gravação direta da porta própria). Nada é apagado: a correção é a reabertura, que fica no histórico.
// Escopo: os horários do setor da unidade (a internação ativa na unidade ou, sem internação, o atendimento do setor,
// como a observação do pronto-socorro), no turno pedido; com o atendimento, só os horários daquele paciente.
// O pendente passado adiante por um fechamento (até 24 h antes do turno) entra no fechamento seguinte: ainda pendente,
// volta a ser listado e justificado; resolvido depois, é travado por ele. A composição de cada fechamento (travados e
// pendentes) fica em fechamento_checagem_horario, que nunca se apaga; a justificativa e a quantidade de pendentes, no
// próprio fechamento.
// Registro no prontuário (C1-023): cada fechamento gera, por atendimento da composição, um documento do prontuário
// (documento_prontuario, lançado e à espera da assinatura do enfermeiro, autor = profissional da sessão) com o resumo do
// turno do paciente (registrosDoTurno, no domínio); a ligação fica em fechamento_checagem_paciente. A reabertura não
// apaga o documento: ele fica no histórico e o novo fechamento gera outro.
import { createHash } from 'node:crypto';
import {
  conferirAutorRegistroTurno,
  conferirFechamentoChecagem,
  conferirReabertura,
  RecusaRegistroTurno,
  registrosDoTurno,
  resumirFechamento,
  turnoDoDia,
} from '@sgh/dominio-enfermagem';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { documentoProntuario, sessao, TABELAS_DOCUMENTO } from '../pep/documentos-propria-operacoes.js';
import type { AnotacaoGravacao } from './gravacao-direta.js';
import { civilDe, fusoDe, instanteDe } from './banco-apoio.js';
import { letraDaSituacao } from './operacoes.js';

export const TABELAS_FECHAMENTO = [
  'fechamento_horario_checagem',
  'fechamento_checagem_horario',
  'fechamento_checagem_paciente',
  'horario_administracao',
  ...TABELAS_DOCUMENTO,
] as const;

/** O tipo de documento do registro de enfermagem do turno (migração 06_PEP/99_fechamento_checagem_cadastro). */
export const CODIGO_TIPO_REGISTRO_TURNO = 'registro_enfermagem_turno';

/** Quanto antes do turno o pendente passado adiante ainda é procurado. */
const ARRASTE_MS = 24 * 3_600_000;

export interface PedidoFechamento {
  readonly unidade: string;
  readonly data: string;
  readonly turno: 'diurno' | 'noturno';
  readonly atendimento: number | null;
  readonly justificativa: string | null;
}

export interface FechamentoFeito {
  readonly id: number;
  readonly travados: number;
  readonly pendentes: readonly number[];
  readonly administrados: number;
  readonly naoAdministrados: number;
  readonly suspensos: number;
  readonly pendentesAnteriores: readonly number[];
  /** Os documentos do prontuário gerados, um por atendimento da composição. */
  readonly documentos: readonly DocumentoDoFechamento[];
}

export interface DocumentoDoFechamento {
  readonly atendimento: number;
  readonly paciente: number;
  readonly documento: number;
}

export interface HorarioDoFechamento {
  readonly horario: number;
  readonly atendimento: number;
  readonly previsto: string;
  readonly anterior: boolean;
}

export interface FechamentoLido {
  readonly id: number;
  readonly atendimento: number | null;
  readonly inicio: string;
  readonly fim: string;
  readonly horarios: number;
  readonly situacao: 'fechado' | 'reaberto';
  readonly fechadoEm: string;
  readonly fechadoPor: string | null;
  readonly reabertoEm: string | null;
  readonly motivoReabertura: string | null;
  readonly justificativaPendencias: string | null;
  /** O fechamento é de um turno anterior ao pedido (os pendentes dele chegaram a este turno). */
  readonly anterior: boolean;
  /** A composição gravada: os horários que o fechamento travou e os pendentes que ele passou adiante. */
  readonly travados: readonly number[];
  readonly pendentes: readonly HorarioDoFechamento[];
  /** Os documentos do prontuário do registro do turno, por atendimento. */
  readonly documentos: readonly DocumentoDoFechamento[];
}

async function unidadeDoEstabelecimento(
  l: Leitor,
  est: number,
  codigo: string,
): Promise<{ id: number; setor: number }> {
  const u = await l.uma<{ id: number; setor_funcional_id: number | null }>(
    'SELECT id, setor_funcional_id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
    [est, codigo],
  );
  if (!u) throw recusa('unidade-inexistente', 'A unidade não é deste estabelecimento.');
  if (u.setor_funcional_id === null)
    throw recusa(
      'cadastro-incompleto',
      'A unidade não tem o setor no cadastro: peça o ajuste ao administrador.',
    );
  return { id: Number(u.id), setor: Number(u.setor_funcional_id) };
}

async function janelaDe(l: Leitor, est: number, data: string, turno: 'diurno' | 'noturno') {
  const j = turnoDoDia(data, turno);
  const fuso = await fusoDe(l, est);
  return { inicio: instanteDe(j.inicio, fuso), fim: instanteDe(j.fim, fuso) };
}

/** Fecha a checagem do turno (do setor da unidade ou de um paciente): grava o fechamento e trava os resolvidos. */
export async function fecharChecagemTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  p: PedidoFechamento,
): Promise<FechamentoFeito> {
  const u = await unidadeDoEstabelecimento(tx, est, p.unidade);
  const { inicio, fim } = await janelaDe(tx, est, p.data, p.turno);
  const linhas = await tx.consultarParaAtualizar<Record<string, unknown>>(
    `SELECT h.id, h.versao, h.suspenso, h.atendimento_id, a.paciente_id, h.situacao_checagem_id, sc.categoria, f.situacao AS fechamento,
            h.previsto_em < ? AS anterior, h.previsto_em, pi.descricao AS item,
            EXISTS (SELECT 1 FROM fechamento_checagem_horario fc
                     WHERE fc.horario_administracao_id = h.id AND fc.papel = 'pendente') AS passou_pendente
       FROM horario_administracao h
       JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
       JOIN atendimento a ON a.id = h.atendimento_id
       LEFT JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
       LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.situacao = 'ativa' AND i.excluido_em IS NULL
       LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
       LEFT JOIN fechamento_horario_checagem f ON f.id = h.fechamento_horario_checagem_id
      WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.previsto_em >= ? AND h.previsto_em < ?
        AND COALESCE(ui.setor_funcional_id, a.setor_funcional_id) = ?
        ${p.atendimento === null ? '' : 'AND h.atendimento_id = ?'}
      ORDER BY h.previsto_em, h.id`,
    [
      inicio,
      est,
      new Date(inicio.getTime() - ARRASTE_MS),
      fim,
      u.setor,
      ...(p.atendimento === null ? [] : [p.atendimento]),
    ],
  );
  const versao = new Map(linhas.map((h) => [Number(h['id']), Number(h['versao'])]));
  const situacao = new Map(linhas.map((h) => [Number(h['id']), Number(h['situacao_checagem_id'])]));
  const anteriores = new Set(linhas.filter((h) => Number(h['anterior']) === 1).map((h) => Number(h['id'])));
  const letra = new Map(linhas.map((h) => [Number(h['id']), letraDaSituacao(h['categoria'], h['suspenso'])]));
  const fuso = await fusoDe(tx, est);
  const doPaciente = new Map(
    linhas.map((h) => [
      Number(h['id']),
      {
        atendimento: Number(h['atendimento_id']),
        paciente: Number(h['paciente_id']),
        previsto: civilDe(h['previsto_em'], fuso)?.slice(0, 16) ?? null,
        item: h['item'] === null || h['item'] === undefined ? null : String(h['item']),
      },
    ]),
  );
  const r = resumirFechamento(
    linhas.map((h) => ({
      id: Number(h['id']),
      letra: letra.get(Number(h['id']))!,
      travado: h['fechamento'] === 'fechado',
      anterior: Number(h['anterior']) === 1,
      passouPendente: Number(h['passou_pendente']) === 1,
    })),
  );
  const problema = conferirFechamentoChecagem(r, p.justificativa);
  if (problema) throw recusa(problema.codigo, problema.mensagem);
  const agora = new Date();
  const id = await tx.incluir('fechamento_horario_checagem', {
    estabelecimento_id: est,
    setor_funcional_id: u.setor,
    unidade_internacao_id: u.id,
    atendimento_id: p.atendimento,
    data_referencia: p.data,
    periodo_inicio: inicio,
    periodo_fim: fim,
    fechado_em: agora,
    fechado_por_usuario_id: tx.contexto.usuario,
    quantidade_horarios: r.aTravar.length,
    quantidade_pendentes: r.pendentes.length,
    justificativa_pendencias: r.pendentes.length > 0 ? (p.justificativa ?? '').trim().slice(0, 500) : null,
    situacao: 'fechado',
  });
  const compor = (h: number, papel: 'travado' | 'pendente') =>
    tx.incluir('fechamento_checagem_horario', {
      fechamento_horario_checagem_id: id,
      horario_administracao_id: h,
      papel,
      situacao_checagem_id: situacao.get(h)!,
      turno_anterior: anteriores.has(h),
    });
  for (const h of r.aTravar) {
    await compor(h, 'travado');
    await tx.alterar('horario_administracao', h, versao.get(h)!, { fechamento_horario_checagem_id: id });
  }
  for (const h of r.pendentes) await compor(h, 'pendente');
  const documentos = await registrarNoProntuario(
    tx,
    est,
    fuso,
    id,
    p,
    fim,
    [
      ...r.aTravar.map((h) => ({ h, papel: 'travado' as const })),
      ...r.pendentes.map((h) => ({ h, papel: 'pendente' as const })),
    ].map(({ h, papel }) => ({
      id: h,
      ...doPaciente.get(h)!,
      letra: letra.get(h)!,
      papel,
      anterior: anteriores.has(h),
    })),
  );
  anotacao.motivo = r.pendentes.length > 0 ? (p.justificativa ?? '').trim() : null;
  anotacao.dados = {
    travados: r.aTravar.length,
    pendentes: r.pendentes,
    unidade: p.unidade,
    turno: p.turno,
    documentos: documentos.map((d) => d.documento),
  };
  return {
    id,
    travados: r.aTravar.length,
    pendentes: r.pendentes,
    administrados: r.administrados,
    naoAdministrados: r.naoAdministrados,
    suspensos: r.suspensos,
    pendentesAnteriores: r.pendentesAnteriores,
    documentos,
  };
}

/**
 * Grava o registro do turno no prontuário de cada paciente da composição: a linha de fechamento_checagem_paciente e o
 * documento do prontuário (lançado, autor = profissional da sessão, hash do conteúdo calculado pelo domínio).
 */
async function registrarNoProntuario(
  tx: TxOperacao,
  est: number,
  fuso: string,
  fechamento: number,
  p: PedidoFechamento,
  fim: Date,
  horarios: Parameters<typeof registrosDoTurno>[0],
): Promise<DocumentoDoFechamento[]> {
  let registros: ReturnType<typeof registrosDoTurno>;
  try {
    registros = registrosDoTurno(horarios, {
      data: p.data,
      turno: p.turno,
      unidade: p.unidade,
      justificativa: p.justificativa,
    });
  } catch (e) {
    if (e instanceof RecusaRegistroTurno) throw recusa(e.codigo, e.message);
    throw e;
  }
  if (registros.length === 0) return [];
  const s = await sessao(tx, { id: est, fuso }, null, false);
  if (s.profissional === null)
    throw recusa(
      'sem-profissional',
      'A conta da sessão não tem vínculo de profissional vigente neste estabelecimento: o registro do turno no prontuário precisa do autor.',
    );
  // O autor do registro de enfermagem é da enfermagem (ocupações do profissional, regra do domínio).
  const cbos = await tx.consultar<{ c: string }>(
    `SELECT o.codigo_cbo AS c FROM profissional_ocupacao po JOIN ocupacao_cbo o ON o.id = po.ocupacao_cbo_id
      WHERE po.profissional_id = ? AND po.ativo = TRUE AND po.excluido_em IS NULL`,
    [s.profissional],
  );
  try {
    conferirAutorRegistroTurno(cbos.map((x) => String(x.c)));
  } catch (e) {
    if (e instanceof RecusaRegistroTurno) throw recusa(e.codigo, e.message);
    throw e;
  }
  const agora = new Date();
  const referencia = fim.getTime() < agora.getTime() ? fim : agora;
  const feitos: DocumentoDoFechamento[] = [];
  for (const g of registros) {
    const linha = await tx.incluir('fechamento_checagem_paciente', {
      fechamento_horario_checagem_id: fechamento,
      atendimento_id: g.atendimento,
      paciente_id: g.paciente,
      quantidade_administrados: g.administrados,
      quantidade_nao_administrados: g.naoAdministrados,
      quantidade_suspensos: g.suspensos,
      quantidade_pendentes: g.pendentes.length,
    });
    const documento = await documentoProntuario(tx, s, {
      categoria: 'relatorio',
      paciente: g.paciente,
      atendimento: g.atendimento,
      tabela: 'fechamento_checagem_paciente',
      id: linha,
      titulo: g.titulo,
      referencia,
      hash: createHash('sha256').update(JSON.stringify(g.conteudo)).digest('hex'),
      comoSuporte: false,
      codigoTipo: CODIGO_TIPO_REGISTRO_TURNO,
      // O conteúdo vai inteiro ao documento: a prévia e a assinatura o leem, e o hash se recalcula a partir dele.
      estruturado: g.conteudo,
    });
    await tx.alterar('fechamento_checagem_paciente', linha, 1, { documento_prontuario_id: documento });
    feitos.push({ atendimento: g.atendimento, paciente: g.paciente, documento });
  }
  return feitos;
}

/** Reabre o fechamento vigente com o motivo: os horários deixam de estar travados; o fechamento fica no histórico. */
export async function reabrirChecagemTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  id: number,
  motivo: string,
): Promise<{ id: number; horarios: number }> {
  const [f] = await tx.consultarParaAtualizar<Record<string, unknown>>(
    'SELECT id, versao, situacao, quantidade_horarios FROM fechamento_horario_checagem WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
  );
  if (!f) throw recusa('fechamento-inexistente', 'O fechamento não foi encontrado neste estabelecimento.');
  const problema = conferirReabertura(String(f['situacao']), motivo);
  if (problema) throw recusa('reabertura-invalida', problema);
  await tx.alterar('fechamento_horario_checagem', id, Number(f['versao']), {
    situacao: 'reaberto',
    reaberto_em: new Date(),
    reaberto_por_usuario_id: tx.contexto.usuario,
    motivo_reabertura: motivo.trim().slice(0, 500),
  });
  anotacao.motivo = motivo.trim();
  return { id, horarios: Number(f['quantidade_horarios']) };
}

const isoLocal = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '').replace(' ', 'T');

/**
 * Os fechamentos (vigentes e reabertos) do dia da unidade e do dia anterior (o turno noturno de ontem passa pendentes
 * ao diurno de hoje), do mais novo para o mais antigo, com a composição gravada.
 */
export async function fechamentosDoDia(
  l: Leitor,
  est: number,
  unidade: string,
  data: string,
  turno: 'diurno' | 'noturno' | null = null,
): Promise<FechamentoLido[]> {
  const u = await unidadeDoEstabelecimento(l, est, unidade);
  const inicioTurno = turno ? (await janelaDe(l, est, data, turno)).inicio : new Date(0);
  const linhas = await l.consultar<Record<string, unknown>>(
    `SELECT f.id, f.atendimento_id, f.periodo_inicio, f.periodo_fim, f.quantidade_horarios, f.situacao, f.fechado_em,
            us.login, f.reaberto_em, f.motivo_reabertura, f.justificativa_pendencias, f.periodo_fim <= ? AS anterior
       FROM fechamento_horario_checagem f LEFT JOIN usuario us ON us.id = f.fechado_por_usuario_id
      WHERE f.estabelecimento_id = ? AND f.setor_funcional_id = ? AND f.excluido_em IS NULL
        AND f.data_referencia BETWEEN ? - INTERVAL 1 DAY AND ?
      ORDER BY f.fechado_em DESC, f.id DESC LIMIT 50`,
    [inicioTurno, est, u.setor, data, data],
  );
  const ids = linhas.map((f) => Number(f['id']));
  const composicao = ids.length
    ? await l.consultar<Record<string, unknown>>(
        `SELECT fc.fechamento_horario_checagem_id AS f, fc.horario_administracao_id AS h, fc.papel, fc.turno_anterior,
                ha.atendimento_id, ha.previsto_em
           FROM fechamento_checagem_horario fc JOIN horario_administracao ha ON ha.id = fc.horario_administracao_id
          WHERE fc.fechamento_horario_checagem_id IN (${ids.map(() => '?').join(', ')})
          ORDER BY ha.previsto_em, fc.horario_administracao_id`,
        ids,
      )
    : [];
  const docs = ids.length
    ? await l.consultar<Record<string, unknown>>(
        `SELECT fp.fechamento_horario_checagem_id AS f, fp.atendimento_id, fp.paciente_id, fp.documento_prontuario_id
           FROM fechamento_checagem_paciente fp
          WHERE fp.fechamento_horario_checagem_id IN (${ids.map(() => '?').join(', ')})
            AND fp.documento_prontuario_id IS NOT NULL
          ORDER BY fp.atendimento_id`,
        ids,
      )
    : [];
  const doFechamento = (id: number, papel: string) =>
    composicao.filter((c) => Number(c['f']) === id && c['papel'] === papel);
  return linhas.map((f) => ({
    id: Number(f['id']),
    atendimento: f['atendimento_id'] === null ? null : Number(f['atendimento_id']),
    inicio: isoLocal(f['periodo_inicio']),
    fim: isoLocal(f['periodo_fim']),
    horarios: Number(f['quantidade_horarios']),
    situacao: f['situacao'] === 'reaberto' ? 'reaberto' : 'fechado',
    fechadoEm: isoLocal(f['fechado_em']),
    fechadoPor: f['login'] === null ? null : String(f['login']),
    reabertoEm: f['reaberto_em'] === null ? null : isoLocal(f['reaberto_em']),
    motivoReabertura: f['motivo_reabertura'] === null ? null : String(f['motivo_reabertura']),
    justificativaPendencias:
      f['justificativa_pendencias'] === null ? null : String(f['justificativa_pendencias']),
    anterior: Number(f['anterior']) === 1,
    travados: doFechamento(Number(f['id']), 'travado').map((c) => Number(c['h'])),
    pendentes: doFechamento(Number(f['id']), 'pendente').map((c) => ({
      horario: Number(c['h']),
      atendimento: Number(c['atendimento_id']),
      previsto: isoLocal(c['previsto_em']),
      anterior: Number(c['turno_anterior']) === 1,
    })),
    documentos: docs
      .filter((d) => Number(d['f']) === Number(f['id']))
      .map((d) => ({
        atendimento: Number(d['atendimento_id']),
        paciente: Number(d['paciente_id']),
        documento: Number(d['documento_prontuario_id']),
      })),
  }));
}
