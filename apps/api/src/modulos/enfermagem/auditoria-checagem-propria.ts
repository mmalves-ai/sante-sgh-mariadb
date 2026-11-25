// Auditoria das checagens de enfermagem (09-AREA linha 86) no banco PRÓPRIO: abrir com o sorteio da amostra
// (auditoria_checagem, auditoria_checagem_auditor e auditoria_checagem_item), avaliar cada checagem da amostra,
// concluir com os totais e o resultado, cancelar com o motivo, e ler a lista e o detalhe. As regras são do domínio
// (sortearAmostra, conferirAbertura, conferirAvaliacao, concluirAuditoria, conferirCancelamentoAuditoria); aqui só a leitura, a
// trava das linhas e a gravação, dentro da operação do Executor (trilha, versão e idempotência na mesma transação).
// Nada é apagado: a auditoria cancelada fica no histórico com o motivo; a reavaliação de um item (antes da conclusão)
// sobe a versão e a trilha guarda o antes e o depois.
// Candidatas da amostra: as checagens já feitas no período (administrado, parcial, não administrado, adiado ou recusado
// pelo paciente; nem pendente, nem atrasado, nem suspenso), do estabelecimento, da unidade (setor da unidade, pela
// internação ativa ou pelo setor do atendimento) ou de um atendimento.
import { randomUUID } from 'node:crypto';
import {
  auditoresDaAbertura,
  concluirAuditoria,
  conferirAbertura,
  conferirAvaliacao,
  conferirCancelamentoAuditoria,
  type PapelAuditor,
  podeAvaliar,
  type ResultadoItemAuditoria,
  type SituacaoAuditoria,
  sortearAmostra,
} from '@sgh/dominio-enfermagem';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { civilDe, fusoDe, instanteDe } from './banco-apoio.js';
import type { AnotacaoGravacao } from './gravacao-direta.js';

export const TABELAS_AUDITORIA_CHECAGEM = [
  'auditoria_checagem',
  'auditoria_checagem_auditor',
  'auditoria_checagem_item',
] as const;

/** As categorias de situação que contam como checagem feita (a candidata da amostra). */
const CATEGORIAS_FEITAS = [
  'administrado',
  'administrado_parcial',
  'nao_administrado',
  'adiado',
  'recusado_paciente',
] as const;

export interface PedidoAbertura {
  /** Início e fim do período, em data e hora civis do estabelecimento (AAAA-MM-DDTHH:MM). */
  readonly inicio: string;
  readonly fim: string;
  readonly unidade: string | null;
  readonly atendimento: number | null;
  readonly tamanho: number;
  /** Semente do sorteio; sem ela, uma nova é gerada e gravada (o sorteio se refaz com ela). */
  readonly semente: string | null;
  readonly criterio: string | null;
  readonly auditores: readonly { readonly usuario: number; readonly papel: PapelAuditor }[];
  readonly observacao: string | null;
}

export interface AberturaFeita {
  readonly id: number;
  readonly candidatas: number;
  readonly amostra: readonly number[];
  readonly semente: string;
}

export interface PedidoAvaliacao {
  readonly resultado: ResultadoItemAuditoria;
  readonly motivo: number | null;
  readonly justificativa: string | null;
}

async function unidadeDe(l: Leitor, est: number, codigo: string): Promise<{ id: number; setor: number }> {
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

/** Abre a auditoria: confere o pedido, sorteia a amostra das checagens feitas e grava auditoria, auditores e itens. */
export async function abrirAuditoriaTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  p: PedidoAbertura,
): Promise<AberturaFeita> {
  const responsavel = tx.contexto.usuario;
  if (!responsavel) throw recusa('sem-usuario', 'A auditoria precisa do usuário da sessão como responsável.');
  const fuso = await fusoDe(tx, est);
  const inicio = instanteDe(p.inicio, fuso);
  const fim = instanteDe(p.fim, fuso);
  const u = p.unidade ? await unidadeDe(tx, est, p.unidade) : null;
  if (p.atendimento !== null) {
    const a = await tx.uma('SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ?', [
      p.atendimento,
      est,
    ]);
    if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
  }
  const designados = p.auditores.map((a) => Number(a.usuario));
  if (designados.length) {
    const achados = await tx.consultar<{ id: number }>(
      `SELECT u.id FROM usuario u
        WHERE u.id IN (${designados.map(() => '?').join(', ')}) AND u.excluido_em IS NULL AND u.situacao = 'ativo'
          AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ?
                       AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURRENT_DATE
                       AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE))`,
      [...designados, est],
    );
    if (new Set(achados.map((x) => Number(x.id))).size !== new Set(designados).size)
      throw recusa(
        'auditor-inexistente',
        'Um dos auditores não é usuário ativo com vínculo vigente neste estabelecimento.',
      );
  }
  const linhas = await tx.consultar<{ id: number }>(
    `SELECT h.id
       FROM horario_administracao h
       JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
       JOIN atendimento a ON a.id = h.atendimento_id
       LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.situacao = 'ativa' AND i.excluido_em IS NULL
       LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
      WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.suspenso = FALSE
        AND sc.categoria IN (${CATEGORIAS_FEITAS.map(() => '?').join(', ')})
        AND h.previsto_em >= ? AND h.previsto_em <= ?
        ${u === null ? '' : 'AND COALESCE(ui.setor_funcional_id, a.setor_funcional_id) = ?'}
        ${p.atendimento === null ? '' : 'AND h.atendimento_id = ?'}`,
    [
      est,
      ...CATEGORIAS_FEITAS,
      inicio,
      fim,
      ...(u === null ? [] : [u.setor]),
      ...(p.atendimento === null ? [] : [p.atendimento]),
    ],
  );
  const candidatas = linhas.map((h) => Number(h.id));
  const agora = new Date();
  const problema = conferirAbertura({
    inicio,
    fim,
    tamanho: p.tamanho,
    candidatas: candidatas.length,
    responsavel,
    auditores: p.auditores,
    agora,
  });
  if (problema) throw recusa(problema.codigo, problema.mensagem);
  const semente = (p.semente ?? '').trim() || randomUUID();
  const amostra = sortearAmostra(candidatas, p.tamanho, semente);
  const criterio = [`sorteio:${semente}`, `candidatas:${candidatas.length}`, (p.criterio ?? '').trim()]
    .filter(Boolean)
    .join('; ')
    .slice(0, 500);
  const id = await tx.incluir('auditoria_checagem', {
    estabelecimento_id: est,
    responsavel_usuario_id: responsavel,
    setor_funcional_id: u?.setor ?? null,
    unidade_internacao_id: u?.id ?? null,
    atendimento_id: p.atendimento,
    periodo_inicio: inicio,
    periodo_fim: fim,
    criterio_amostra: criterio,
    tamanho_amostra: amostra.length,
    situacao: 'aberta',
    observacao: (p.observacao ?? '').trim() || null,
  });
  for (const a of auditoresDaAbertura(responsavel, p.auditores))
    await tx.incluir('auditoria_checagem_auditor', {
      auditoria_checagem_id: id,
      usuario_id: a.usuario,
      papel: a.papel,
    });
  let sequencia = 0;
  for (const h of amostra)
    await tx.incluir('auditoria_checagem_item', {
      auditoria_checagem_id: id,
      sequencia: ++sequencia,
      horario_administracao_id: h,
      resultado: 'pendente',
    });
  anotacao.dados = { candidatas: candidatas.length, amostra: amostra.length, semente };
  return { id, candidatas: candidatas.length, amostra, semente };
}

async function travarAuditoria(tx: TxOperacao, est: number, id: number) {
  const [a] = await tx.consultarParaAtualizar<Record<string, unknown>>(
    'SELECT id, versao, situacao, observacao FROM auditoria_checagem WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
  );
  if (!a) throw recusa('auditoria-inexistente', 'A auditoria não foi encontrada neste estabelecimento.');
  const auditores = await tx.consultar<{ usuario_id: number; papel: PapelAuditor }>(
    'SELECT usuario_id, papel FROM auditoria_checagem_auditor WHERE auditoria_checagem_id = ? AND excluido_em IS NULL',
    [id],
  );
  return {
    versao: Number(a['versao']),
    situacao: String(a['situacao']) as SituacaoAuditoria,
    observacao: a['observacao'] === null ? null : String(a['observacao']),
    auditores: auditores.map((x) => ({ usuario: Number(x.usuario_id), papel: x.papel })),
  };
}

function exigirAuditor(tx: TxOperacao, auditores: { usuario: number; papel: PapelAuditor }[]): number {
  const usuario = Number(tx.contexto.usuario);
  if (!podeAvaliar(auditores, usuario))
    throw recusa('nao-auditor', 'Só o responsável e os auditores designados avaliam esta auditoria.');
  return usuario;
}

/** Avalia uma checagem da amostra (ou refaz a avaliação, antes da conclusão). */
export async function avaliarItemTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  auditoria: number,
  item: number,
  p: PedidoAvaliacao,
): Promise<{ id: number; item: number; resultado: ResultadoItemAuditoria }> {
  const a = await travarAuditoria(tx, est, auditoria);
  const usuario = exigirAuditor(tx, a.auditores);
  const [it] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
    'SELECT id, versao FROM auditoria_checagem_item WHERE id = ? AND auditoria_checagem_id = ? AND excluido_em IS NULL',
    [item, auditoria],
  );
  if (!it) throw recusa('item-inexistente', 'A checagem não faz parte da amostra desta auditoria.');
  let exigeComplemento = false;
  if (p.motivo !== null) {
    const m = await tx.uma<{ exige_complemento: number }>(
      'SELECT exige_complemento FROM motivo_nao_conformidade_checagem WHERE id = ? AND ativo = TRUE',
      [p.motivo],
    );
    if (!m) throw recusa('motivo-inexistente', 'O motivo de não conformidade não existe ou está inativo.');
    exigeComplemento = Number(m.exige_complemento) === 1;
  }
  const problema = conferirAvaliacao({
    situacao: a.situacao,
    resultado: p.resultado,
    motivo: p.motivo,
    motivoExigeComplemento: exigeComplemento,
    justificativa: p.justificativa,
  });
  if (problema) throw recusa(problema.codigo, problema.mensagem);
  await tx.alterar('auditoria_checagem_item', item, Number(it.versao), {
    resultado: p.resultado,
    motivo_nao_conformidade_checagem_id: p.resultado === 'nao_conforme' ? p.motivo : null,
    justificativa: (p.justificativa ?? '').trim().slice(0, 2000) || null,
    auditor_usuario_id: usuario,
    auditado_em: new Date(),
  });
  if (a.situacao === 'aberta')
    await tx.alterar('auditoria_checagem', auditoria, a.versao, { situacao: 'em_andamento' });
  anotacao.motivo = p.resultado === 'conforme' ? null : (p.justificativa ?? '').trim() || null;
  anotacao.dados = { auditoria, item, resultado: p.resultado };
  return { id: auditoria, item, resultado: p.resultado };
}

/** Conclui: toda a amostra avaliada; grava os totais, o resultado e a hora. */
export async function concluirAuditoriaTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  auditoria: number,
): Promise<{
  id: number;
  resultado: string;
  totalAuditado: number;
  totalConforme: number;
  naoAplicaveis: number;
}> {
  const a = await travarAuditoria(tx, est, auditoria);
  exigirAuditor(tx, a.auditores);
  const itens = await tx.consultar<{ resultado: ResultadoItemAuditoria }>(
    'SELECT resultado FROM auditoria_checagem_item WHERE auditoria_checagem_id = ? AND excluido_em IS NULL',
    [auditoria],
  );
  const c = concluirAuditoria(
    a.situacao,
    itens.map((i) => i.resultado),
  );
  if (!c.ok) throw recusa(c.problema.codigo, c.problema.mensagem);
  await tx.alterar('auditoria_checagem', auditoria, a.versao, {
    situacao: 'concluida',
    resultado: c.resultado,
    total_auditado: c.totais.avaliados,
    total_conforme: c.totais.conformes,
    concluida_em: new Date(),
  });
  anotacao.dados = { resultado: c.resultado, ...c.totais };
  return {
    id: auditoria,
    resultado: c.resultado,
    totalAuditado: c.totais.avaliados,
    totalConforme: c.totais.conformes,
    naoAplicaveis: c.totais.naoAplicaveis,
  };
}

/** Cancela com o motivo (anotado na observação); a auditoria e as avaliações ficam no histórico. */
export async function cancelarAuditoriaTx(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  auditoria: number,
  motivo: string,
): Promise<{ id: number }> {
  const a = await travarAuditoria(tx, est, auditoria);
  exigirAuditor(tx, a.auditores);
  const problema = conferirCancelamentoAuditoria(a.situacao, motivo);
  if (problema) throw recusa(problema.codigo, problema.mensagem);
  const nota = `Cancelada: ${motivo.trim()}`;
  await tx.alterar('auditoria_checagem', auditoria, a.versao, {
    situacao: 'cancelada',
    observacao: a.observacao ? `${a.observacao}\n${nota}` : nota,
  });
  anotacao.motivo = motivo.trim();
  return { id: auditoria };
}

export interface AuditoriaResumo {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly unidade: string | null;
  readonly atendimento: number | null;
  readonly responsavel: string;
  readonly situacao: SituacaoAuditoria;
  readonly resultado: string | null;
  readonly tamanho: number;
  readonly avaliados: number;
  readonly totalAuditado: number | null;
  readonly totalConforme: number | null;
  readonly criadoEm: string;
}

/** As auditorias do estabelecimento, das mais novas, com o andamento da avaliação. */
export async function listarAuditorias(
  l: Leitor,
  est: number,
  situacao: SituacaoAuditoria | null,
  id: number | null = null,
): Promise<AuditoriaResumo[]> {
  const fuso = await fusoDe(l, est);
  const isoLocal = (v: unknown): string | null => civilDe(v, fuso);
  const filtros = [situacao ? 'AND ac.situacao = ?' : '', id === null ? '' : 'AND ac.id = ?'].join(' ');
  const linhas = await l.consultar<Record<string, unknown>>(
    `SELECT ac.id, ac.periodo_inicio, ac.periodo_fim, ui.codigo AS unidade, ac.atendimento_id, us.login,
            ac.situacao, ac.resultado, ac.tamanho_amostra, ac.total_auditado, ac.total_conforme, ac.criado_em,
            (SELECT COUNT(*) FROM auditoria_checagem_item it
              WHERE it.auditoria_checagem_id = ac.id AND it.resultado <> 'pendente' AND it.excluido_em IS NULL) AS avaliados
       FROM auditoria_checagem ac
       JOIN usuario us ON us.id = ac.responsavel_usuario_id
       LEFT JOIN unidade_internacao ui ON ui.id = ac.unidade_internacao_id
      WHERE ac.estabelecimento_id = ? AND ac.excluido_em IS NULL ${filtros}
      ORDER BY ac.criado_em DESC, ac.id DESC LIMIT 100`,
    [est, ...(situacao ? [situacao] : []), ...(id === null ? [] : [id])],
  );
  return linhas.map((a) => ({
    id: Number(a['id']),
    inicio: isoLocal(a['periodo_inicio'])!,
    fim: isoLocal(a['periodo_fim'])!,
    unidade: a['unidade'] === null ? null : String(a['unidade']),
    atendimento: a['atendimento_id'] === null ? null : Number(a['atendimento_id']),
    responsavel: String(a['login']),
    situacao: String(a['situacao']) as SituacaoAuditoria,
    resultado: a['resultado'] === null ? null : String(a['resultado']),
    tamanho: Number(a['tamanho_amostra'] ?? 0),
    avaliados: Number(a['avaliados']),
    totalAuditado: a['total_auditado'] === null ? null : Number(a['total_auditado']),
    totalConforme: a['total_conforme'] === null ? null : Number(a['total_conforme']),
    criadoEm: isoLocal(a['criado_em'])!,
  }));
}

export interface AuditoriaDetalhe extends AuditoriaResumo {
  readonly criterio: string | null;
  readonly observacao: string | null;
  readonly concluidaEm: string | null;
  readonly auditores: readonly { usuario: number; login: string; nome: string; papel: PapelAuditor }[];
  readonly itens: readonly {
    id: number;
    sequencia: number;
    horario: number;
    atendimento: number;
    paciente: string;
    previsto: string;
    checadoEm: string | null;
    situacaoChecagem: string;
    checadoPor: string | null;
    resultado: ResultadoItemAuditoria;
    motivo: number | null;
    motivoDescricao: string | null;
    justificativa: string | null;
    auditor: string | null;
    auditadoEm: string | null;
  }[];
}

/** A auditoria com os auditores e a amostra, cada checagem com o paciente, a situação e quem checou. */
export async function lerAuditoria(l: Leitor, est: number, id: number): Promise<AuditoriaDetalhe> {
  const [base] = await listarAuditorias(l, est, null, id);
  const fuso = await fusoDe(l, est);
  const isoLocal = (v: unknown): string | null => civilDe(v, fuso);
  const cab = await l.uma<Record<string, unknown>>(
    'SELECT criterio_amostra, observacao, concluida_em FROM auditoria_checagem WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
  );
  if (!cab || !base)
    throw recusa('auditoria-inexistente', 'A auditoria não foi encontrada neste estabelecimento.');
  const auditores = await l.consultar<Record<string, unknown>>(
    `SELECT aa.usuario_id, us.login, COALESCE(us.nome_social, us.nome) AS nome, aa.papel
       FROM auditoria_checagem_auditor aa JOIN usuario us ON us.id = aa.usuario_id
      WHERE aa.auditoria_checagem_id = ? AND aa.excluido_em IS NULL ORDER BY aa.id`,
    [id],
  );
  const itens = await l.consultar<Record<string, unknown>>(
    `SELECT it.id, it.sequencia, it.horario_administracao_id, h.atendimento_id,
            CASE WHEN p.usa_nome_social AND p.nome_social IS NOT NULL THEN p.nome_social ELSE pf.nome END AS paciente,
            h.previsto_em, COALESCE(h.administrado_em, h.situacao_checagem_em) AS checado_em, sc.descricao AS situacao,
            COALESCE(pr.nome_exibicao, ppf.nome) AS checado_por, it.resultado, it.motivo_nao_conformidade_checagem_id,
            mn.descricao AS motivo, it.justificativa, au.login AS auditor, it.auditado_em
       FROM auditoria_checagem_item it
       JOIN horario_administracao h ON h.id = it.horario_administracao_id
       JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
       JOIN atendimento a ON a.id = h.atendimento_id
       JOIN paciente p ON p.id = a.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN profissional pr ON pr.id = h.administrado_por_profissional_id
       LEFT JOIN pessoa_fisica ppf ON ppf.id = pr.pessoa_fisica_id
       LEFT JOIN motivo_nao_conformidade_checagem mn ON mn.id = it.motivo_nao_conformidade_checagem_id
       LEFT JOIN usuario au ON au.id = it.auditor_usuario_id
      WHERE it.auditoria_checagem_id = ? AND it.excluido_em IS NULL
      ORDER BY it.sequencia`,
    [id],
  );
  return {
    ...base,
    criterio: cab['criterio_amostra'] === null ? null : String(cab['criterio_amostra']),
    observacao: cab['observacao'] === null ? null : String(cab['observacao']),
    concluidaEm: isoLocal(cab['concluida_em']),
    auditores: auditores.map((x) => ({
      usuario: Number(x['usuario_id']),
      login: String(x['login']),
      nome: String(x['nome']),
      papel: String(x['papel']) as PapelAuditor,
    })),
    itens: itens.map((x) => ({
      id: Number(x['id']),
      sequencia: Number(x['sequencia']),
      horario: Number(x['horario_administracao_id']),
      atendimento: Number(x['atendimento_id']),
      paciente: String(x['paciente'] ?? ''),
      previsto: isoLocal(x['previsto_em'])!,
      checadoEm: isoLocal(x['checado_em']),
      situacaoChecagem: String(x['situacao']),
      checadoPor: x['checado_por'] === null ? null : String(x['checado_por']),
      resultado: String(x['resultado']) as ResultadoItemAuditoria,
      motivo:
        x['motivo_nao_conformidade_checagem_id'] === null
          ? null
          : Number(x['motivo_nao_conformidade_checagem_id']),
      motivoDescricao: x['motivo'] === null ? null : String(x['motivo']),
      justificativa: x['justificativa'] === null ? null : String(x['justificativa']),
      auditor: x['auditor'] === null ? null : String(x['auditor']),
      auditadoEm: isoLocal(x['auditado_em']),
    })),
  };
}

/** Apoio da tela: as unidades do estabelecimento, os motivos de não conformidade ativos e os usuários com vínculo. */
export async function apoioAuditoria(l: Leitor, est: number) {
  const unidades = await l.consultar<Record<string, unknown>>(
    'SELECT codigo, descricao FROM unidade_internacao WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao',
    [est],
  );
  const motivos = await l.consultar<Record<string, unknown>>(
    'SELECT id, codigo, descricao, exige_complemento FROM motivo_nao_conformidade_checagem WHERE ativo = TRUE ORDER BY descricao',
  );
  const usuarios = await l.consultar<Record<string, unknown>>(
    `SELECT u.id, u.login, COALESCE(u.nome_social, u.nome) AS nome FROM usuario u
      WHERE u.excluido_em IS NULL AND u.situacao = 'ativo'
        AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ?
                     AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURRENT_DATE
                     AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE))
      ORDER BY nome LIMIT 500`,
    [est],
  );
  return {
    unidades: unidades.map((u) => ({ codigo: String(u['codigo']), descricao: String(u['descricao']) })),
    motivos: motivos.map((m) => ({
      id: Number(m['id']),
      codigo: String(m['codigo']),
      descricao: String(m['descricao']),
      exigeComplemento: Number(m['exige_complemento']) === 1,
    })),
    usuarios: usuarios.map((u) => ({
      id: Number(u['id']),
      login: String(u['login']),
      nome: String(u['nome']),
    })),
  };
}
