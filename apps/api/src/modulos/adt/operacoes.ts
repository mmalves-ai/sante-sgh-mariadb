// Operações de gravação da internação, dos leitos, da higienização e do SAME (M21) sobre o banco do cliente, pelo
// Executor do @sgh/nucleo: cada uma declara as tabelas que grava; trilha, outbox e idempotência na mesma transação.
// As conferências sob a trava (leito livre, internação aberta, versão lida) ficam aqui; o vocabulário das telas
// (internação pelo id, leito pela chave bloco + acomodação + leito, carimbo de versão em texto) vem dos contratos.
// Melhoria: a internação abre o atendimento de internação e a ocupação do leito na mesma transação, com a unicidade
// da ocupação aberta por leito e por internação garantida pelo banco (colunas vigentes); o carimbo de versão é a
// coluna `versao` (trava otimista), não a data da última atualização.
// Melhoria: a alta grava a alta hospitalar (motivo, desfecho e destino pelo tipo de saída do motivo) e encerra a
// ocupação; o cancelamento da alta e a exclusão da internação guardam o retrato e o motivo (cancelamento_alta e
// cancelamento_internacao) em vez de apagar períodos e conta; a transferência grava a transferência de leito com
// o trecho anterior encerrado e o novo aberto.
// Melhoria: a pré-internação é o agendamento de internação (sem data sentinela: sem data, a data fica nula e a situação é
// "em_espera"); as trocas de convênio, clínica, especialidade e médico gravam a troca com o valor anterior e o novo.
// Melhoria: a alta pede a limpeza terminal do leito (regra em limpeza-da-alta.ts) e abre o período de higienização com a
// precaução herdada, na mesma transação; a liberação (pela ação ou pela etapa "liberado") é um caminho só, que encerra o
// período ligado à solicitação; a situação atual do leito (leito_hospitalar.situacao_leito_id) acompanha a ocupação e
// os períodos na mesma transação.
// Melhoria: os cadastros (caráter, categoria, modalidade, motivos) vêm pelo id escolhido ou, sem escolha, do único
// ativo que serve; nunca "o primeiro por id". A internação trava o paciente antes de conferir a internação aberta.
import {
  abrirContaDaEntrada,
  apurarContasDoAtendimento,
  cancelarContasDaEntrada,
  TABELAS_CONTA_ENTRADA,
} from '../faturamento/conta-entrada.js';
import {
  type CorrigirPreInternacaoEntrada,
  type ChaveLeito,
  type DarAltaEntrada,
  esquemaCorrigirPreInternacao,
  esquemaDarAlta,
  esquemaExcluirInternacao,
  esquemaExcluirMovimento,
  esquemaLiberarLeito,
  esquemaMovimentarProntuario,
  esquemaPreInternar,
  esquemaRegistrarGuia,
  esquemaSolicitarLimpeza,
  esquemaTrocarClinica,
  esquemaTrocarConvenio,
  esquemaTrocarEspecialidade,
  esquemaTrocarMedico,
  type ExcluirInternacaoEntrada,
  type MovimentarProntuarioEntrada,
  type PreInternarEntrada,
  dataHoraParaInstante,
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
import { conferirCadastroNaAbertura } from '../cadastro/campos-abertura.js';
import { recusarEntradaDeFalecido } from '@sgh/dominio-atendimento';
import { vidaDoPaciente } from '../cadastro/vida-do-paciente.js';
import { FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import {
  type CancelarAltaBancoEntrada,
  esquemaCancelarAltaBanco,
  esquemaInternarBanco,
  esquemaTransferirLeitoBanco,
  type InternarBancoEntrada,
  type TransferirLeitoBancoEntrada,
} from './esquemas.js';
import { limpezaDaAlta } from './limpeza-da-alta.js';
import {
  acessoTotalDe,
  exigirOperadorDaUnidade,
  gravarAcidenteDaAdmissao,
  gravarDiagnosticosDaAdmissao,
  marcarIndicadorAcidente,
  gravarGuiaNoHistorico,
  OPERACOES_REGISTROS_INTERNACAO,
} from './registros-internacao.js';
import {
  encerrarEquipeNoFimDoAtendimento,
  reabrirEquipeDoAtendimento,
  TABELAS_EQUIPE_ATENDIMENTO,
} from '../pep/equipe-fim-atendimento.js';

type Linha = Record<string, unknown>;
export const n = (v: unknown) => Number(v ?? 0);
export const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Carimbo de versão da tela (texto de 10 dígitos) a partir da coluna `versao`, e de volta. */
export const carimboVersao = (v: unknown) => String(n(v)).padStart(10, '0');
function versaoDoCarimbo(c: string): number {
  const v = Number(c);
  if (!Number.isInteger(v) || v < 1) throw recusa('versao-invalida', 'Releia a internação antes de salvar.');
  return v;
}

export function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
export function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}
const naoEncontrado = (titulo: string, detalhe: string) =>
  new ErroOperacao(404, 'registro-inexistente', titulo, detalhe);

/** Id de um registro de tabela de apoio; ausente = configuração do cliente incompleta. */
export async function apoio(tx: TxOperacao, sql: string, p: unknown[], falta: string): Promise<number> {
  const l = await tx.uma<{ id: unknown }>(sql, p);
  if (!l) throw recusa('configuracao-incompleta', `Falta cadastrar ${falta} no cliente.`);
  return n(l.id);
}

/**
 * Id de um cadastro: o informado na entrada (conferido contra o filtro) ou, sem escolha, o único que serve. Mais de um
 * sem escolha é recusa (nunca "o primeiro por id"); nenhum é configuração incompleta. `sqlTodos` termina no WHERE.
 */
export async function informadoOuUnico(
  tx: Pick<TxOperacao, 'uma' | 'consultar'>,
  sqlTodos: string,
  p: unknown[],
  informado: number | null | undefined,
  campo: string,
  nome: string,
): Promise<number> {
  if (informado !== undefined && informado !== null) {
    if (!(await tx.uma(`${sqlTodos} AND id = ?`, [...p, informado])))
      throw recusa(`${campo}-inexistente`, `${nome} escolhido não existe, está inativo ou não serve aqui.`, {
        campos: [campo],
      });
    return informado;
  }
  const ids = await tx.consultar(`${sqlTodos} ORDER BY id LIMIT 2`, p);
  if (ids.length === 1) return n(ids[0]?.['id']);
  if (ids.length === 0) throw recusa('configuracao-incompleta', `Falta cadastrar ${nome} no cliente.`);
  throw recusa(`${campo}-obrigatorio`, `Há mais de um cadastro de ${nome}: escolha um.`, { campos: [campo] });
}

/** Situação do cadastro de situações do leito pela situação base (a da ordem de exibição configurada). */
export const situacaoDoLeitoPorBase = (tx: Pick<TxOperacao, 'uma'>, base: string) =>
  apoio(
    tx as TxOperacao,
    'SELECT id FROM situacao_leito WHERE situacao_base = ? AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1',
    [base],
    `a situação de leito "${base}"`,
  );

/**
 * A situação atual do leito (leito_hospitalar.situacao_leito_id) na mesma transação: a do período aberto; sem período,
 * ocupado ou livre pela ocupação aberta. Quem chama declara `leito_hospitalar` nas tabelas da operação.
 */
export async function situarLeito(tx: TxOperacao, leito: number): Promise<void> {
  const p = await tx.uma(
    'SELECT situacao_leito_id FROM periodo_situacao_leito WHERE leito_hospitalar_id = ? AND data_hora_fim IS NULL',
    [leito],
  );
  let situacao: number;
  if (p) situacao = n(p['situacao_leito_id']);
  else {
    const ocupado = await tx.uma(
      "SELECT id FROM ocupacao_leito WHERE leito_hospitalar_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL AND excluido_em IS NULL",
      [leito],
    );
    situacao = await situacaoDoLeitoPorBase(tx, ocupado ? 'ocupado' : 'livre');
  }
  const l = await tx.uma('SELECT versao, situacao_leito_id FROM leito_hospitalar WHERE id = ?', [leito]);
  if (l && n(l['situacao_leito_id']) !== situacao)
    await tx.alterar('leito_hospitalar', leito, n(l['versao']), { situacao_leito_id: situacao });
}

/** A precaução guardada no retrato do período (dados), quando houver. */
export function precaucaoDosDados(dados: unknown): string | null {
  try {
    const d = typeof dados === 'string' ? JSON.parse(dados) : dados;
    const p = d && typeof d === 'object' ? (d as Record<string, unknown>)['precaucao'] : null;
    return typeof p === 'string' && p ? p : null;
  } catch {
    return null;
  }
}

export async function fusoDe(tx: Pick<TxOperacao, 'uma'>, est: number): Promise<string> {
  const l = await tx.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return l?.fuso_horario || FUSO_PADRAO;
}

/** Leito pela chave do mapa, no estabelecimento, travado para a gravação. */
export async function leitoDaChave(tx: TxOperacao, est: number, l: ChaveLeito): Promise<Linha> {
  const [x] = await tx.consultarParaAtualizar(
    `SELECT lh.id, lh.ativo, lh.unidade_internacao_id, lh.acomodacao_id, ac.categoria_acomodacao_id
       FROM leito_hospitalar lh
       JOIN acomodacao ac ON ac.id = lh.acomodacao_id
       LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
      WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL AND COALESCE(b.codigo, '') = ? AND ac.codigo = ?
        AND lh.codigo = ?`,
    [est, l.bloco, l.acomodacao, l.leito],
  );
  if (!x) throw naoEncontrado('Leito não encontrado', 'O leito não existe no mapa deste estabelecimento.');
  return x;
}

/** Confere que o leito aceita uma ocupação nova (ativo, sem ocupação aberta, sem bloqueio vigente, sem reserva alheia). */
async function exigirLeitoLivre(
  tx: TxOperacao,
  leito: Linha,
  pedidoNir: number | null,
): Promise<number | null> {
  if (!(leito['ativo'] === true || leito['ativo'] === 1))
    throw recusa('leito-inativo', 'O leito está inativo no mapa.', { campos: ['leito'] });
  const id = n(leito['id']);
  const ocupado = await tx.uma(
    "SELECT id FROM ocupacao_leito WHERE leito_hospitalar_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL AND excluido_em IS NULL",
    [id],
  );
  if (ocupado)
    throw recusa(
      'leito-ocupado',
      'Leito ocupado em outro terminal: escolha outro leito no mapa (o mapa já mostra a ocupação).',
      { campos: ['leito'] },
    );
  const estado = await tx.uma<{ base: string }>(
    `SELECT s.situacao_base AS base FROM periodo_situacao_leito p JOIN situacao_leito s ON s.id = p.situacao_leito_id
      WHERE p.leito_hospitalar_id = ? AND p.data_hora_fim IS NULL AND s.permite_ocupacao = FALSE LIMIT 1`,
    [id],
  );
  if (estado)
    throw recusa(
      'leito-bloqueado',
      'O leito está bloqueado, em higienização ou interditado: escolha outro leito.',
      {
        campos: ['leito'],
      },
    );
  const reserva = await tx.uma(
    "SELECT id, pedido_leito_id FROM reserva_leito WHERE leito_hospitalar_id = ? AND situacao IN ('ativa','confirmada') AND excluido_em IS NULL",
    [id],
  );
  if (!reserva) return null;
  if (pedidoNir === null || nn(reserva['pedido_leito_id']) !== pedidoNir)
    throw recusa('leito-reservado', 'O leito está reservado pelo NIR para outro paciente.', {
      campos: ['leito'],
    });
  return n(reserva['id']);
}

/** A internação do estabelecimento, travada, com a versão lida conferida. */
async function internacaoTravada(tx: TxOperacao, est: number, id: number, carimbo?: string): Promise<Linha> {
  const [i] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, paciente_id, atendimento_id, leito_hospitalar_id, acomodacao_id, unidade_internacao_id,
            data_hora_entrada, data_hora_alta, fonte_pagadora_id, especialidade_medica_id, modalidade_internacao_id,
            medico_assistente_profissional_id, medico_solicitante_profissional_id, motivo_saida_hospitalar_id
       FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!i) throw naoEncontrado('Internação não encontrada', 'A internação não existe neste estabelecimento.');
  if (carimbo !== undefined && n(i['versao']) !== versaoDoCarimbo(carimbo))
    throw new ErroOperacao(
      409,
      'conflito-versao',
      'Registro alterado',
      'A internação foi alterada desde a leitura. Releia e confira antes de salvar.',
      { colunas: ['versao'] },
    );
  return i;
}

const exigirAberta = (i: Linha) => {
  if (i['situacao'] === 'alta')
    throw recusa('internacao-com-alta', 'A internação já tem alta: nada a mudar no leito.');
  if (i['situacao'] === 'cancelada') throw recusa('internacao-cancelada', 'A internação foi excluída.');
};

/** Ocupação aberta da internação (travada). */
async function ocupacaoAberta(tx: TxOperacao, internacao: number): Promise<Linha | null> {
  const [o] = await tx.consultarParaAtualizar(
    "SELECT id, versao, leito_hospitalar_id FROM ocupacao_leito WHERE internacao_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL AND excluido_em IS NULL",
    [internacao],
  );
  return o ?? null;
}

/** Clínica da tela (M, C, N) → classificação da modalidade de internação, e de volta. */
export const CLASSIFICACAO_DA_CLINICA: Readonly<Record<string, string>> = {
  M: 'clinica',
  C: 'cirurgica',
  N: 'pediatrica',
};
export const clinicaDaClassificacao = (c: unknown) =>
  c === 'cirurgica' ? 'C' : c === 'pediatrica' ? 'N' : 'M';

const modalidadeDaClinica = (tx: TxOperacao, clinica: string, informada?: number) =>
  informadoOuUnico(
    tx,
    'SELECT id FROM modalidade_internacao WHERE classificacao = ? AND ativo = TRUE',
    [CLASSIFICACAO_DA_CLINICA[clinica] ?? 'clinica'],
    informada,
    'modalidade',
    `a modalidade de internação "${CLASSIFICACAO_DA_CLINICA[clinica] ?? 'clinica'}"`,
  );

async function exigirExiste(
  tx: TxOperacao,
  tabela: 'fonte_pagadora' | 'especialidade_medica' | 'profissional' | 'clinica_assistencial',
  id: number,
  campo: string,
  nome: string,
) {
  const sql = {
    fonte_pagadora:
      "SELECT id FROM fonte_pagadora WHERE id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
    especialidade_medica: 'SELECT id FROM especialidade_medica WHERE id = ? AND ativo = TRUE',
    clinica_assistencial: 'SELECT id FROM clinica_assistencial WHERE id = ? AND ativo = TRUE',
    profissional: "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
  }[tabela];
  if (!(await tx.uma(sql, [id])))
    throw recusa(`${campo}-inexistente`, `${nome} não existe ou está inativo.`, { campos: [campo] });
}

/**
 * Procedimento solicitado: a entrada declara a origem (SIGTAP ou item faturável do cliente). Sem a origem, o id que
 * existe nas duas tabelas é ambíguo e é recusado (nunca se escolhe uma das duas por ordem).
 */
async function procedimentoDe(
  tx: TxOperacao,
  id: number,
  origem: 'sigtap' | 'item' | undefined,
): Promise<{ sigtap: number | null; item: number | null }> {
  const sigtap =
    origem !== 'item' &&
    !!(await tx.uma('SELECT id FROM procedimento_sigtap WHERE id = ? AND ativo = TRUE', [id]));
  const item =
    origem !== 'sigtap' &&
    !!(await tx.uma('SELECT id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [id]));
  if (sigtap && item)
    throw recusa(
      'procedimento-ambiguo',
      'O código existe no SIGTAP e nos itens do hospital: informe a origem do procedimento.',
      {
        campos: ['procedimentoOrigem'],
      },
    );
  if (sigtap) return { sigtap: id, item: null };
  if (item) return { sigtap: null, item: id };
  throw recusa('procedimento-inexistente', 'O procedimento solicitado não existe no catálogo.', {
    campos: ['procedimento'],
  });
}

/** A internação nova; a unicidade da internação aberta por paciente (pedido de DDL do lote 03-01) vira mensagem. */
async function incluirInternacao(tx: TxOperacao, linha: Record<string, unknown>): Promise<number> {
  try {
    return await tx.incluir('internacao', linha);
  } catch (x) {
    const r = restricaoViolada(x);
    if (r?.tipo === 'unica' && r.nome === 'uq_internacao_paciente_vigente')
      throw recusa('paciente-internado', 'O paciente já tem uma internação aberta.', {
        campos: ['paciente'],
      });
    throw x;
  }
}

const TABELAS_INTERNAR = [
  'atendimento',
  'internacao',
  // F3.4 (04-INT 67 e 68): o diagnóstico de entrada, o acidente e a guia inicial nascem com a admissão.
  'diagnostico_internacao',
  'acidente_internacao',
  'guia_internacao',
  'ocupacao_leito',
  'reserva_leito',
  'pedido_leito',
  'leito_hospitalar',
  // F3.0: a conta do paciente nasce com a internação e recebe a diária do dia (mesma transação).
  ...TABELAS_CONTA_ENTRADA,
];

const internar = definirOperacao<InternarBancoEntrada, ResultadoOperacao>({
  nome: 'internacao.internar',
  tabelas: TABELAS_INTERNAR,
  entrada: esquemaInternarBanco,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    // A trava do paciente serializa duas admissões simultâneas da mesma pessoa (a conferência abaixo vale sob ela).
    const [pac] = await tx.consultarParaAtualizar(
      'SELECT id, situacao, falecido, data_hora_obito FROM paciente WHERE id = ? AND excluido_em IS NULL',
      [e.paciente],
    );
    if (!pac) throw naoEncontrado('Paciente não encontrado', 'O paciente não existe no cadastro.');
    // 02-CAD linha 13: o paciente com óbito registrado não é internado (regra do domínio).
    const vivo = recusarEntradaDeFalecido(vidaDoPaciente(pac), 'internacao');
    if (!vivo.ok) throw recusa(vivo.codigo, vivo.mensagem, { campos: ['paciente'] });
    if (pac['situacao'] !== 'ativo' && pac['situacao'] !== 'provisorio')
      throw recusa('paciente-inativo', 'O cadastro do paciente não está ativo.');
    const jaInternado = await tx.uma(
      "SELECT id FROM internacao WHERE paciente_id = ? AND situacao IN ('ativa','alta_medica') AND excluido_em IS NULL",
      [e.paciente],
    );
    if (jaInternado)
      throw recusa('paciente-internado', 'O paciente já tem uma internação aberta.', {
        campos: ['paciente'],
      });
    await exigirExiste(tx, 'fonte_pagadora', e.convenio, 'convenio', 'O convênio');
    // Regra de campo do cadastro (02-CAD linha 2): a admissão só grava com o cadastro completo no escopo da internação
    // (tipo "internacao" e convênio); recusada, nada da admissão fica no banco (nem atendimento, nem leito ocupado). O
    // cadastro provisório (paciente não identificado) não é barrado. A pré-internação não confere: é o preparo da
    // vaga, feito antes de o paciente chegar, e o cadastro é completado até a admissão, que é onde a regra vale.
    await conferirCadastroNaAbertura(tx, {
      estabelecimento: est,
      paciente: e.paciente,
      tipo: 'internacao',
      fontePagadora: e.convenio,
      usuario,
      provisorio: pac['situacao'] === 'provisorio',
    });
    await exigirExiste(tx, 'especialidade_medica', e.especialidade, 'especialidade', 'A especialidade');
    await exigirExiste(tx, 'profissional', e.medicoAssistente, 'medicoAssistente', 'O médico assistente');
    await exigirExiste(tx, 'profissional', e.medicoSolicitante, 'medicoSolicitante', 'O médico solicitante');
    const leito = await leitoDaChave(tx, est, e.leito);
    // F3.4 (04-INT 65): a unidade com operadores definidos só admite pelo usuário liberado nela.
    await exigirOperadorDaUnidade(
      tx,
      nn(leito['unidade_internacao_id']),
      usuario,
      'admitir',
      acessoTotalDe(ctx),
    );
    const reserva = await exigirLeitoLivre(tx, leito, e.solicitacaoNir ?? null);
    const urgencia = e.carater === 'urgencia';
    const carater = await informadoOuUnico(
      tx,
      'SELECT id FROM carater_admissao WHERE urgencia = ? AND ativo = TRUE',
      [urgencia],
      e.caraterAdmissao,
      'caraterAdmissao',
      `o caráter de admissão ${urgencia ? 'de urgência' : 'eletivo'}`,
    );
    const caraterTiss = await informadoOuUnico(
      tx,
      'SELECT id FROM carater_atendimento_tiss WHERE urgencia = ?',
      [urgencia],
      e.caraterTiss,
      'caraterTiss',
      'o caráter de atendimento da TISS',
    );
    const categoria = await informadoOuUnico(
      tx,
      "SELECT id FROM categoria_atendimento WHERE tipo_base = 'internacao' AND ativo = TRUE",
      [],
      e.categoriaAtendimento,
      'categoriaAtendimento',
      'a categoria de atendimento de internação',
    );
    const modalidade = await modalidadeDaClinica(tx, e.clinica, e.modalidade);
    const proc = await procedimentoDe(tx, e.procedimento, e.procedimentoOrigem);
    const agora = new Date();
    const numAt = await tx.proximoNumero('atendimento');
    const atendimento = await tx.incluir('atendimento', {
      estabelecimento_id: est,
      numero: numAt.formatado,
      paciente_id: e.paciente,
      categoria_atendimento_id: categoria,
      carater_atendimento_tiss_id: caraterTiss,
      fonte_pagadora_id: e.convenio,
      profissional_id: e.medicoAssistente,
      especialidade_medica_id: e.especialidade,
      solicitante_profissional_id: e.medicoSolicitante,
      pai_atendimento_id: e.atendimentoOrigem ?? null,
      cid_principal_termo_terminologia_id: e.cidPrincipal,
      cid_secundario_termo_terminologia_id: e.cidSecundario ?? null,
      responsavel_nome: e.responsavel?.nome ?? null,
      responsavel_telefone: e.responsavel?.telefone ?? null,
      acompanhante: e.responsavel !== undefined,
      situacao: 'em_atendimento',
      entrada_em: agora,
    });
    const numero = await tx.proximoNumero('internacao');
    const id = await incluirInternacao(tx, {
      estabelecimento_id: est,
      numero: numero.formatado,
      atendimento_id: atendimento,
      paciente_id: e.paciente,
      data_hora_entrada: agora,
      carater_admissao_id: carater,
      modalidade_internacao_id: modalidade,
      unidade_internacao_id: n(leito['unidade_internacao_id']),
      leito_hospitalar_id: n(leito['id']),
      acomodacao_id: n(leito['acomodacao_id']),
      especialidade_medica_id: e.especialidade,
      medico_assistente_profissional_id: e.medicoAssistente,
      medico_solicitante_profissional_id: e.medicoSolicitante,
      fonte_pagadora_id: e.convenio,
      numero_carteira: e.matricula ?? null,
      validade_carteira: e.validadeCarteira ?? null,
      numero_guia: e.guia ?? null,
      senha_autorizacao: e.senhaConvenio ?? null,
      diarias_autorizadas: e.diariasAutorizadas || null,
      pedido_leito_id: e.solicitacaoNir ?? null,
      cid_principal_termo_terminologia_id: e.cidPrincipal,
      cid_secundario_termo_terminologia_id: e.cidSecundario ?? null,
      procedimento_solicitado_procedimento_sigtap_id: proc.sigtap,
      procedimento_solicitado_item_faturavel_id: proc.item,
      tem_acompanhante: e.responsavel !== undefined,
      situacao: 'ativa',
      observacao: e.observacao ?? null,
    });
    await tx.incluir('ocupacao_leito', {
      estabelecimento_id: est,
      internacao_id: id,
      leito_hospitalar_id: n(leito['id']),
      unidade_internacao_id: n(leito['unidade_internacao_id']),
      acomodacao_id: n(leito['acomodacao_id']),
      data_hora_inicio: agora,
      tipo_movimento: 'admissao',
      medico_profissional_id: e.medicoAssistente,
      fonte_pagadora_id: e.convenio,
      registro_usuario_id: usuario,
      situacao: 'ativa',
    });
    // F3.4 (04-INT 67): o CID da admissão vira o diagnóstico de entrada (e o secundário), na lista da internação.
    await gravarDiagnosticosDaAdmissao(tx, id, e.cidPrincipal, e.cidSecundario, agora, e.medicoAssistente);
    // F3.4 (04-INT 67): o acidente informado na admissão (mesma transação) e o indicador de acidente da guia TISS no
    // atendimento (sem acidente, "não acidente").
    if (e.acidente) await gravarAcidenteDaAdmissao(tx, est, id, agora, e.acidente);
    await marcarIndicadorAcidente(tx, atendimento, e.acidente?.tipo);
    if (reserva !== null) {
      const r = await tx.uma('SELECT versao FROM reserva_leito WHERE id = ?', [reserva]);
      await tx.alterar('reserva_leito', reserva, n(r?.['versao']), {
        situacao: 'consumida',
        internacao_id: id,
      });
    }
    if (e.solicitacaoNir !== undefined)
      await concluirPedido(tx, est, e.solicitacaoNir, id, n(leito['id']), agora);
    await situarLeito(tx, n(leito['id']));
    // F3.0: a conta aberta na entrada (fonte pagadora, plano, tabela vigente, acomodação) e a diária do dia.
    // Sem tipo de conta da natureza, a internação acontece e a pendência volta para o faturista (alertaConta).
    const { conta, pendencia } = await abrirContaDaEntrada(tx, est, atendimento, {
      categoriaAcomodacao: nn(leito['categoria_acomodacao_id']),
    });
    if (conta !== null) await apurarContasDoAtendimento(tx, est, atendimento, agora);
    // F3.4 (04-INT 68): a guia informada na admissão é a inicial do histórico de autorizações; sem as diárias
    // autorizadas ela não tem período, e o histórico divergiria da operadora: a admissão recusa na hora.
    if (e.guia && !e.diariasAutorizadas)
      throw recusa('guia-sem-diarias', 'Informe as diárias autorizadas da guia.', {
        campos: ['diariasAutorizadas'],
      });
    if (e.guia && e.diariasAutorizadas)
      await gravarGuiaNoHistorico(tx, est, agora, {
        internacao: id,
        conta,
        guia: e.guia,
        senha: e.senhaConvenio,
        validadeDias: e.diariasAutorizadas,
      });
    return {
      internacao: id,
      numero: numero.formatado,
      ...(conta !== null ? { conta } : {}),
      ...(pendencia !== null ? { alertaConta: pendencia.codigo, alertaContaMotivo: pendencia.mensagem } : {}),
    };
  },
  eventos: (_e, r) => [{ tipo: 'internacao.internada', carga: { internacao: n(r['internacao']) } }],
  alvo: (_e, r) => ({ tabela: 'internacao', id: n(r['internacao']) }),
});

/** A solicitação de leito do NIR atendida pela internação ou transferência (estado "internado"). */
async function concluirPedido(
  tx: TxOperacao,
  est: number,
  pedido: number,
  internacao: number,
  leito: number,
  agora: Date,
) {
  const [p] = await tx.consultarParaAtualizar(
    'SELECT id, versao, data_hora_atendido FROM pedido_leito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [pedido, est],
  );
  if (!p) throw naoEncontrado('Solicitação não encontrada', 'A solicitação de leito do NIR não existe.');
  if (p['data_hora_atendido'] !== null)
    throw recusa('solicitacao-concluida', 'A solicitação de leito já foi atendida.');
  const situacao = await apoio(
    tx,
    "SELECT id FROM situacao_pedido_leito WHERE estado = 'internado' AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1",
    [],
    'a situação de pedido de leito "internado"',
  );
  await tx.alterar('pedido_leito', pedido, n(p['versao']), {
    internacao_id: internacao,
    leito_hospitalar_id: leito,
    data_hora_atendido: agora,
    situacao_pedido_leito_id: situacao,
    estado_situacao: 'internado',
  });
}

const transferirLeito = definirOperacao<TransferirLeitoBancoEntrada, ResultadoOperacao>({
  nome: 'internacao.transferir-leito',
  tabelas: [
    ...TABELAS_CONTA_ENTRADA,
    'internacao',
    'ocupacao_leito',
    'transferencia_leito',
    'reserva_leito',
    'pedido_leito',
    'leito_hospitalar',
  ],
  entrada: esquemaTransferirLeitoBanco,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const i = await internacaoTravada(tx, est, e.internacao, e.versao);
    exigirAberta(i);
    const destino = await leitoDaChave(tx, est, e.destino);
    await exigirOperadorDaUnidade(
      tx,
      nn(destino['unidade_internacao_id']),
      usuario,
      'transferir',
      acessoTotalDe(ctx),
    );
    if (n(destino['id']) === n(i['leito_hospitalar_id']))
      throw recusa('mesmo-leito', 'O destino é o leito atual: escolha outro leito.', { campos: ['destino'] });
    const reserva = await exigirLeitoLivre(tx, destino, e.solicitacaoNir ?? null);
    const motivo = await informadoOuUnico(
      tx,
      "SELECT id FROM motivo_troca_leito WHERE aplica_a IN ('internacao','ambos') AND ativo = TRUE",
      [],
      e.motivoTroca,
      'motivoTroca',
      'o motivo de troca de leito',
    );
    const agora = new Date();
    const atual = await ocupacaoAberta(tx, e.internacao);
    if (atual)
      await tx.alterar('ocupacao_leito', n(atual['id']), n(atual['versao']), {
        data_hora_fim: agora,
        situacao: 'encerrada',
      });
    const nova = await tx.incluir('ocupacao_leito', {
      estabelecimento_id: est,
      internacao_id: e.internacao,
      leito_hospitalar_id: n(destino['id']),
      unidade_internacao_id: n(destino['unidade_internacao_id']),
      acomodacao_id: n(destino['acomodacao_id']),
      data_hora_inicio: agora,
      tipo_movimento: 'transferencia',
      motivo_troca_leito_id: motivo,
      anterior_ocupacao_leito_id: atual ? n(atual['id']) : null,
      medico_profissional_id: nn(i['medico_assistente_profissional_id']),
      fonte_pagadora_id: nn(i['fonte_pagadora_id']),
      registro_usuario_id: usuario,
      situacao: 'ativa',
    });
    await tx.incluir('transferencia_leito', {
      estabelecimento_id: est,
      internacao_id: e.internacao,
      origem_leito_hospitalar_id: n(i['leito_hospitalar_id']),
      destino_leito_hospitalar_id: n(destino['id']),
      origem_ocupacao_leito_id: atual ? n(atual['id']) : null,
      destino_ocupacao_leito_id: nova,
      motivo_troca_leito_id: motivo,
      justificativa: e.justificativa ?? null,
      reserva_leito_id: reserva,
      transferido_em: agora,
      executado_por_usuario_id: usuario,
      situacao: 'efetivada',
    });
    const versao = await tx.alterar('internacao', e.internacao, n(i['versao']), {
      leito_hospitalar_id: n(destino['id']),
      acomodacao_id: n(destino['acomodacao_id']),
      unidade_internacao_id: n(destino['unidade_internacao_id']),
    });
    if (reserva !== null) {
      const r = await tx.uma('SELECT versao FROM reserva_leito WHERE id = ?', [reserva]);
      await tx.alterar('reserva_leito', reserva, n(r?.['versao']), {
        situacao: 'consumida',
        internacao_id: e.internacao,
      });
    }
    if (e.solicitacaoNir !== undefined)
      await concluirPedido(tx, est, e.solicitacaoNir, e.internacao, n(destino['id']), agora);
    if (nn(i['leito_hospitalar_id']) !== null) await situarLeito(tx, n(i['leito_hospitalar_id']));
    await situarLeito(tx, n(destino['id']));
    // F3.0: a troca de acomodação reapura as diárias (a do dia vai para a acomodação da virada; a antiga é estornada).
    await apurarContasDoAtendimento(tx, est, n(i['atendimento_id']));
    return { internacao: e.internacao, versao: carimboVersao(versao) };
  },
  eventos: (e) => [{ tipo: 'internacao.transferida', carga: { internacao: e.internacao } }],
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
});

/**
 * A limpeza pedida pela alta: a solicitação terminal (motivo "alta", com o atendimento e a alta), o local e o período
 * "higienizacao" do leito ligado a ela, com a precaução herdada do período aberto (encerrado aqui) ou do isolamento
 * ativo da internação. A regra (tipo, prioridade, precaução) é a de limpeza-da-alta.ts.
 */
async function pedirLimpezaDaAlta(
  tx: TxOperacao,
  est: number,
  usuario: number,
  x: { leito: number; internacao: number; atendimento: number; alta: number },
): Promise<number> {
  const agora = new Date();
  const [aberto] = await tx.consultarParaAtualizar(
    'SELECT id, versao, dados, isolamento_paciente_id FROM periodo_situacao_leito WHERE leito_hospitalar_id = ? AND data_hora_fim IS NULL',
    [x.leito],
  );
  const iso = await tx.uma(
    `SELECT ip.id, tp.codigo FROM isolamento_paciente ip JOIN tipo_precaucao tp ON tp.id = ip.tipo_precaucao_id
      WHERE ip.internacao_id = ? AND ip.situacao = 'ativo' AND ip.excluido_em IS NULL ORDER BY ip.data_hora_inicio DESC LIMIT 1`,
    [x.internacao],
  );
  const regra = limpezaDaAlta({
    precaucaoAberta: aberto ? precaucaoDosDados(aberto['dados']) : null,
    isolamento: iso ? { codigo: texto(iso['codigo']) } : null,
  });
  const modalidade = await apoio(
    tx,
    'SELECT id FROM modalidade_limpeza WHERE tipo = ? AND ativo = TRUE ORDER BY padrao DESC, id LIMIT 1',
    [regra.tipo],
    'o tipo de limpeza terminal',
  );
  const situacao = await situacaoLimpeza(tx, 'solicitada');
  const numero = await tx.proximoNumero('solicitacao_limpeza');
  const id = await tx.incluir('solicitacao_limpeza', {
    estabelecimento_id: est,
    numero: numero.valor,
    motivo_geracao: regra.motivoGeracao,
    atendimento_id: x.atendimento,
    alta_hospitalar_id: x.alta,
    modalidade_limpeza_id: modalidade,
    prioridade: regra.prioridade,
    situacao_limpeza_id: situacao,
    solicitante_usuario_id: usuario,
    solicitada_em: agora,
  });
  await tx.incluir('solicitacao_limpeza_local', {
    solicitacao_limpeza_id: id,
    sequencia: 1,
    leito_hospitalar_id: x.leito,
    inclui_acomodacao: false,
    situacao_limpeza_id: situacao,
  });
  if (aberto)
    await tx.alterar('periodo_situacao_leito', n(aberto['id']), n(aberto['versao']), {
      data_hora_fim: agora,
      operacao: 'alteracao',
      ocorrido_em: agora,
      usuario_id: usuario,
    });
  await tx.incluir('periodo_situacao_leito', {
    leito_hospitalar_id: x.leito,
    situacao_leito_id: await situacaoDoLeitoPorBase(tx, 'higienizacao'),
    data_hora_inicio: agora,
    solicitacao_limpeza_id: id,
    isolamento_paciente_id: iso ? n(iso['id']) : nn(aberto?.['isolamento_paciente_id']),
    operacao: 'inclusao',
    dados: JSON.stringify({ estado: 'higienizacao', motivo: null, precaucao: regra.precaucao }),
    ocorrido_em: agora,
    usuario_id: usuario,
  });
  await situarLeito(tx, x.leito);
  return id;
}

/** Destino da alta hospitalar pelo tipo de saída do motivo. */
const DESTINO_DO_TIPO_SAIDA: Readonly<Record<string, string>> = {
  alta: 'domicilio',
  transferencia: 'transferencia_externa',
  obito: 'obito',
  evasao: 'outro',
  a_pedido: 'domicilio',
  administrativa: 'outro',
  permanencia: 'outro',
};

const darAlta = definirOperacao<DarAltaEntrada, ResultadoOperacao>({
  nome: 'internacao.dar-alta',
  tabelas: [
    ...TABELAS_EQUIPE_ATENDIMENTO,
    ...TABELAS_CONTA_ENTRADA,
    'internacao',
    'ocupacao_leito',
    'alta_hospitalar',
    'alta_medica',
    'atendimento',
    'solicitacao_limpeza',
    'solicitacao_limpeza_local',
    'periodo_situacao_leito',
    'leito_hospitalar',
  ],
  entrada: esquemaDarAlta,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const i = await internacaoTravada(tx, est, e.internacao, e.versao);
    exigirAberta(i);
    await exigirOperadorDaUnidade(tx, nn(i['unidade_internacao_id']), usuario, 'darAlta', acessoTotalDe(ctx));
    const m = await tx.uma(
      'SELECT id, tipo_saida, desfecho_internacao_id FROM motivo_saida_hospitalar WHERE id = ? AND ativo = TRUE',
      [e.motivo],
    );
    if (!m)
      throw recusa('motivo-inexistente', 'O motivo da alta não existe ou está inativo.', {
        campos: ['motivo'],
      });
    if (m['desfecho_internacao_id'] === null)
      throw recusa(
        'configuracao-incompleta',
        'O motivo da alta não tem o desfecho da internação cadastrado.',
      );
    if (m['tipo_saida'] === 'obito')
      throw recusa(
        'obito-exige-declaracao',
        'A alta por óbito exige a declaração de óbito: registre-a pela tela do óbito.',
      );
    await exigirExiste(tx, 'profissional', e.medicoAlta, 'medicoAlta', 'O médico da alta');
    const agora = new Date();
    let altaEm = agora;
    if (e.horaSaida) {
      const fuso = await fusoDe(tx, est);
      altaEm = new Date(dataHoraParaInstante(relogioNoFuso(fuso, agora).hoje, e.horaSaida, fuso));
      if (altaEm.getTime() > agora.getTime())
        throw recusa('hora-futura', 'A hora de saída ainda não chegou.', { campos: ['horaSaida'] });
      if (altaEm.getTime() < new Date(i['data_hora_entrada'] as Date).getTime())
        throw recusa('hora-antes-da-entrada', 'A hora de saída é anterior à entrada.', {
          campos: ['horaSaida'],
        });
    }
    const medica = await tx.uma(
      "SELECT id, versao FROM alta_medica WHERE internacao_id = ? AND situacao IN ('prevista','programada') AND excluido_em IS NULL ORDER BY id DESC LIMIT 1",
      [e.internacao],
    );
    const alta = await tx.incluir('alta_hospitalar', {
      internacao_id: e.internacao,
      alta_medica_id: medica ? n(medica['id']) : null,
      alta_em: altaEm,
      motivo_saida_hospitalar_id: e.motivo,
      desfecho_internacao_id: n(m['desfecho_internacao_id']),
      destino: DESTINO_DO_TIPO_SAIDA[texto(m['tipo_saida'])] ?? 'outro',
      medico_profissional_id: e.medicoAlta,
      liberada_em: agora,
      liberada_por_usuario_id: usuario,
      ocupacao_encerrada: true,
      situacao: 'confirmada',
    });
    if (medica)
      await tx.alterar('alta_medica', n(medica['id']), n(medica['versao']), {
        situacao: 'efetivada',
        alta_medica_em: altaEm,
        motivo_saida_hospitalar_id: e.motivo,
        saida_leito_em: altaEm,
      });
    const o = await ocupacaoAberta(tx, e.internacao);
    if (o)
      await tx.alterar('ocupacao_leito', n(o['id']), n(o['versao']), {
        data_hora_fim: altaEm,
        situacao: 'encerrada',
      });
    const versao = await tx.alterar('internacao', e.internacao, n(i['versao']), {
      situacao: 'alta',
      data_hora_alta: altaEm,
      motivo_saida_hospitalar_id: e.motivo,
      desfecho_internacao_id: n(m['desfecho_internacao_id']),
    });
    const at = await tx.uma('SELECT versao FROM atendimento WHERE id = ?', [n(i['atendimento_id'])]);
    if (at)
      await tx.alterar('atendimento', n(i['atendimento_id']), n(at['versao']), {
        situacao: 'encerrado',
        saida_em: altaEm,
        desfecho: m['tipo_saida'] === 'transferencia' ? 'transferencia' : 'alta',
        alta_profissional_id: e.medicoAlta,
      });
    // 03-PEP L94: a alta encerra a equipe assistencial do atendimento (vigentes saem com o motivo; nada apagado).
    // Pelo instante do registro (a hora da saída informada pode ser anterior à inclusão de um membro).
    await encerrarEquipeNoFimDoAtendimento(tx, n(i['atendimento_id']), agora);
    // A saída pede a limpeza terminal do leito e o deixa em higienização até a liberação (mesma transação).
    const leito = nn(i['leito_hospitalar_id']);
    const solicitacao =
      leito === null
        ? null
        : await pedirLimpezaDaAlta(tx, est, usuario, {
            leito,
            internacao: e.internacao,
            atendimento: n(i['atendimento_id']),
            alta,
          });
    // F3.0: a alta fecha a contagem das diárias (e estorna a do dia que deixou de ser devida).
    await apurarContasDoAtendimento(tx, est, n(i['atendimento_id']), altaEm);
    return { internacao: e.internacao, alta, solicitacao, versao: carimboVersao(versao) };
  },
  eventos: (e, r) => [
    { tipo: 'internacao.alta', carga: { internacao: e.internacao } },
    ...(r['solicitacao']
      ? [{ tipo: 'hotelaria.limpeza_solicitada', carga: { solicitacao: n(r['solicitacao']) } }]
      : []),
  ],
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
});

const cancelarAlta = definirOperacao<CancelarAltaBancoEntrada, ResultadoOperacao>({
  nome: 'internacao.cancelar-alta',
  tabelas: [
    ...TABELAS_EQUIPE_ATENDIMENTO,
    ...TABELAS_CONTA_ENTRADA,
    'internacao',
    'ocupacao_leito',
    'alta_hospitalar',
    'cancelamento_alta',
    'atendimento',
    'solicitacao_limpeza',
    'solicitacao_limpeza_local',
    'periodo_situacao_leito',
    'leito_hospitalar',
  ],
  entrada: esquemaCancelarAltaBanco,
  critica: false,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const i = await internacaoTravada(tx, est, e.internacao);
    if (i['situacao'] !== 'alta') throw recusa('sem-alta', 'A internação não tem alta a cancelar.');
    const [alta] = await tx.consultarParaAtualizar(
      "SELECT id, versao, alta_em, motivo_saida_hospitalar_id, destino FROM alta_hospitalar WHERE internacao_id = ? AND situacao = 'confirmada' AND excluido_em IS NULL ORDER BY id DESC LIMIT 1",
      [e.internacao],
    );
    if (!alta) throw recusa('sem-alta', 'A internação não tem alta confirmada a cancelar.');
    const motivo = await informadoOuUnico(
      tx,
      'SELECT id FROM motivo_cancelamento_alta WHERE ativo = TRUE',
      [],
      e.motivoCancelamento,
      'motivoCancelamento',
      'o motivo de cancelamento de alta',
    );
    const leito = n(i['leito_hospitalar_id']);
    const ocupado = await tx.uma(
      "SELECT id FROM ocupacao_leito WHERE leito_hospitalar_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL AND excluido_em IS NULL",
      [leito],
    );
    if (ocupado)
      throw recusa(
        'leito-ocupado',
        'O leito da alta já foi ocupado: transfira depois de cancelar por outro leito livre.',
      );
    const agora = new Date();
    await tx.incluir('cancelamento_alta', {
      alta_hospitalar_id: n(alta['id']),
      internacao_id: e.internacao,
      motivo_cancelamento_alta_id: motivo,
      justificativa: e.justificativa,
      escopo: 'alta_hospitalar',
      cancelado_em: agora,
      cancelado_por_usuario_id: usuario,
      dados_alta: JSON.stringify({
        altaEm: alta['alta_em'],
        motivo: nn(alta['motivo_saida_hospitalar_id']),
        destino: texto(alta['destino']),
      }),
      ocupacao_reaberta: true,
    });
    await tx.alterar('alta_hospitalar', n(alta['id']), n(alta['versao']), { situacao: 'cancelada' });
    // A limpeza pedida por esta alta e ainda não liberada é cancelada; o período de higienização dela se encerra.
    const limpezas = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM solicitacao_limpeza WHERE alta_hospitalar_id = ? AND concluida_em IS NULL AND cancelada_em IS NULL AND excluido_em IS NULL',
      [n(alta['id'])],
    );
    for (const l of limpezas) {
      await tx.alterar('solicitacao_limpeza', n(l['id']), n(l['versao']), {
        situacao_limpeza_id: await situacaoLimpeza(tx, 'cancelada'),
        cancelada_em: agora,
        cancelamento_usuario_id: usuario,
        motivo_cancelamento: 'Alta cancelada',
      });
      await encerrarPeriodoDaLimpeza(tx, n(l['id']), usuario, agora);
    }
    await tx.incluir('ocupacao_leito', {
      estabelecimento_id: est,
      internacao_id: e.internacao,
      leito_hospitalar_id: leito,
      unidade_internacao_id: n(i['unidade_internacao_id']),
      acomodacao_id: n(i['acomodacao_id']),
      data_hora_inicio: agora,
      tipo_movimento: 'retorno',
      registro_usuario_id: usuario,
      situacao: 'ativa',
    });
    const versao = await tx.alterar('internacao', e.internacao, n(i['versao']), {
      situacao: 'ativa',
      data_hora_alta: null,
      motivo_saida_hospitalar_id: null,
      desfecho_internacao_id: null,
    });
    const at = await tx.uma('SELECT versao FROM atendimento WHERE id = ?', [n(i['atendimento_id'])]);
    if (at)
      await tx.alterar('atendimento', n(i['atendimento_id']), n(at['versao']), {
        situacao: 'em_atendimento',
        saida_em: null,
        desfecho: null,
      });
    // 03-PEP L94: com a alta desfeita, a equipe volta a valer (quem saiu junto volta como participação nova).
    await reabrirEquipeDoAtendimento(tx, n(i['atendimento_id']), new Date());
    await situarLeito(tx, leito);
    // F3.0: a alta cancelada reabre a contagem das diárias.
    await apurarContasDoAtendimento(tx, estabelecimentoDe(ctx), n(i['atendimento_id']));
    return { internacao: e.internacao, versao: carimboVersao(versao) };
  },
  eventos: (e) => [{ tipo: 'internacao.alta_cancelada', carga: { internacao: e.internacao } }],
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

const excluirInternacao = definirOperacao<ExcluirInternacaoEntrada, ResultadoOperacao>({
  nome: 'internacao.excluir-internacao',
  tabelas: [
    'internacao',
    'ocupacao_leito',
    'cancelamento_internacao',
    'atendimento',
    'leito_hospitalar',
    ...TABELAS_CONTA_ENTRADA,
  ],
  entrada: esquemaExcluirInternacao,
  critica: true,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const i = await internacaoTravada(tx, est, e.internacao);
    if (i['situacao'] === 'cancelada') throw recusa('internacao-cancelada', 'A internação já foi excluída.');
    const motivo = await informadoOuUnico(
      tx,
      'SELECT id FROM motivo_cancelamento_internacao WHERE ativo = TRUE',
      [],
      e.motivo,
      'motivo',
      'o motivo de exclusão de internação',
    );
    const agora = new Date();
    await tx.incluir('cancelamento_internacao', {
      internacao_id: e.internacao,
      motivo_cancelamento_internacao_id: motivo,
      justificativa: e.justificativa,
      cancelado_em: agora,
      cancelado_por_usuario_id: usuario,
      leito_hospitalar_id: nn(i['leito_hospitalar_id']),
      dados_internacao: JSON.stringify({
        situacao: texto(i['situacao']),
        entrada: i['data_hora_entrada'],
        alta: i['data_hora_alta'],
        leito: nn(i['leito_hospitalar_id']),
        convenio: nn(i['fonte_pagadora_id']),
      }),
    });
    const ocupacoes = await tx.consultarParaAtualizar(
      "SELECT id, versao FROM ocupacao_leito WHERE internacao_id = ? AND situacao <> 'cancelada' AND excluido_em IS NULL",
      [e.internacao],
    );
    for (const o of ocupacoes)
      await tx.alterar('ocupacao_leito', n(o['id']), n(o['versao']), {
        situacao: 'cancelada',
        data_hora_fim: agora,
      });
    await tx.alterar('internacao', e.internacao, n(i['versao']), {
      situacao: 'cancelada',
      data_hora_cancelamento: agora,
      motivo_cancelamento_internacao_id: motivo,
    });
    const at = await tx.uma('SELECT versao FROM atendimento WHERE id = ?', [n(i['atendimento_id'])]);
    if (at)
      await tx.alterar('atendimento', n(i['atendimento_id']), n(at['versao']), { situacao: 'cancelado' });
    if (nn(i['leito_hospitalar_id']) !== null) await situarLeito(tx, n(i['leito_hospitalar_id']));
    // F3.0: a internação excluída não deve diária nem taxa (nem a de abertura): os automáticos são estornados com o
    // motivo "cancelamento" e a conta é cancelada (conta com lançamento manual recusa: passa pelo faturamento).
    await cancelarContasDaEntrada(tx, estabelecimentoDe(ctx), n(i['atendimento_id']));
    return { internacao: e.internacao };
  },
  eventos: (e) => [{ tipo: 'internacao.excluida', carga: { internacao: e.internacao } }],
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

/** Data e hora previstas da pré-internação no fuso do estabelecimento; sem data, a lista de espera. */
async function previsaoDe(tx: TxOperacao, est: number, data: string | undefined, hora: string | undefined) {
  // Sem data: a fila de espera, com a data nula (nunca uma sentinela).
  if (!data) return { previsto: null as Date | null, situacao: 'em_espera' };
  const fuso = await fusoDe(tx, est);
  return { previsto: new Date(dataHoraParaInstante(data, hora ?? '07:00', fuso)), situacao: 'solicitado' };
}

/** O procedimento previsto pelo código: o item faturável do cliente ou, senão, o da tabela do SUS; sem casamento, 422. */
async function procedimentoPrevisto(tx: TxOperacao, codigo: number) {
  const item = await tx.uma(
    'SELECT id FROM item_faturavel WHERE codigo = ? AND excluido_em IS NULL LIMIT 1',
    [String(codigo)],
  );
  if (item) return { item: n(item['id']), sigtap: null };
  const sus = await tx.uma('SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? LIMIT 1', [
    String(codigo).padStart(10, '0'),
  ]);
  if (sus) return { item: null, sigtap: n(sus['id']) };
  throw semCasamento('procedimento-inexistente', 'O procedimento não existe no cadastro.', 'procedimento');
}

/** Dado informado sem correspondência no cadastro: 422, nunca gravado nulo em silêncio. */
const semCasamento = (codigo: string, texto: string, campo: string) =>
  new ErroOperacao(422, codigo, 'Dado sem correspondência', texto, { campos: [campo] });

const SITUACOES_PRE_PENDENTES = [
  'solicitado',
  'aguardando_autorizacao',
  'autorizado',
  'confirmado',
  'em_espera',
];

const preInternar = definirOperacao<PreInternarEntrada, ResultadoOperacao>({
  nome: 'internacao.pre-internar',
  tabelas: ['agendamento_internacao'],
  entrada: esquemaPreInternar,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const pac = await tx.uma(
      'SELECT id, situacao, falecido, data_hora_obito FROM paciente WHERE id = ? AND excluido_em IS NULL',
      [e.paciente],
    );
    if (!pac) throw naoEncontrado('Paciente não encontrado', 'O paciente não existe no cadastro.');
    // 02-CAD linha 13: o paciente com óbito registrado não recebe pré-internação (regra do domínio).
    const vivo = recusarEntradaDeFalecido(vidaDoPaciente(pac), 'pre-internacao');
    if (!vivo.ok) throw recusa(vivo.codigo, vivo.mensagem, { campos: ['paciente'] });
    const pendente = await tx.uma(
      `SELECT id FROM agendamento_internacao WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL
          AND situacao IN (${SITUACOES_PRE_PENDENTES.map(() => '?').join(', ')})`,
      [est, e.paciente, ...SITUACOES_PRE_PENDENTES],
    );
    if (pendente)
      throw recusa(
        'pre-internacao-pendente',
        'O paciente já tem uma pré-internação pendente: corrija a data dela.',
      );
    await exigirExiste(tx, 'fonte_pagadora', e.convenio, 'convenio', 'O convênio');
    await exigirExiste(tx, 'especialidade_medica', e.especialidade, 'especialidade', 'A especialidade');
    await exigirExiste(tx, 'profissional', e.medicoSolicitante, 'medicoSolicitante', 'O médico solicitante');
    const urgencia = e.carater === 'urgencia';
    const carater = await apoio(
      tx,
      'SELECT id FROM carater_admissao WHERE urgencia = ? AND ativo = TRUE ORDER BY id LIMIT 1',
      [urgencia],
      `o caráter de admissão ${urgencia ? 'de urgência' : 'eletivo'}`,
    );
    await exigirExiste(tx, 'clinica_assistencial', e.clinica, 'clinica', 'A clínica');
    const plano = await tx.uma<{ id: unknown }>(
      'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND (codigo = ? OR UPPER(descricao) = ?) AND excluido_em IS NULL LIMIT 1',
      [e.convenio, e.plano, e.plano],
    );
    if (!plano) throw semCasamento('plano-inexistente', 'O plano não existe neste convênio.', 'plano');
    const cid = e.cid
      ? await tx.uma<{ id: unknown }>(
          "SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id WHERE REPLACE(t.codigo_termo, '.', '') = ? AND tt.codigo = 'cid10' LIMIT 1",
          [e.cid.replace('.', '').toUpperCase()],
        )
      : null;
    if (e.cid && !cid) throw semCasamento('cid-inexistente', 'O CID não existe na CID-10.', 'cid');
    const proc = e.procedimento === undefined ? null : await procedimentoPrevisto(tx, e.procedimento);
    if (e.cirurgia !== undefined) {
      const cir = await tx.uma(
        'SELECT id FROM agendamento_cirurgico WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.cirurgia, e.paciente, est],
      );
      if (!cir)
        throw recusa('cirurgia-inexistente', 'A cirurgia agendada não é deste paciente.', {
          campos: ['cirurgia'],
        });
    }
    let unidade: number | null = null;
    let categoria: number | null = null;
    if (e.acomodacao) {
      const a = await tx.uma(
        `SELECT ac.unidade_internacao_id, ac.categoria_acomodacao_id FROM acomodacao ac
           LEFT JOIN bloco_internacao b ON b.id = ac.bloco_internacao_id
          WHERE ac.estabelecimento_id = ? AND COALESCE(b.codigo, '') = ? AND ac.codigo = ? AND ac.excluido_em IS NULL`,
        [est, e.acomodacao.bloco, e.acomodacao.acomodacao],
      );
      if (!a)
        throw recusa('acomodacao-inexistente', 'A acomodação não existe neste estabelecimento.', {
          campos: ['acomodacao'],
        });
      unidade = n(a['unidade_internacao_id']);
      categoria = n(a['categoria_acomodacao_id']);
    }
    const p = await previsaoDe(tx, est, e.dataPrevista, e.horaPrevista);
    const numero = await tx.proximoNumero('agendamento_internacao');
    const id = await tx.incluir('agendamento_internacao', {
      estabelecimento_id: est,
      numero: numero.formatado,
      paciente_id: e.paciente,
      solicitado_em: new Date(),
      previsto_para: p.previsto,
      dias_previstos: e.diariasPrevistas,
      carater_admissao_id: carater,
      categoria_acomodacao_id: categoria,
      unidade_internacao_id: unidade,
      especialidade_medica_id: e.especialidade,
      clinica_assistencial_id: e.clinica,
      item_faturavel_id: proc?.item ?? null,
      procedimento_sigtap_id: proc?.sigtap ?? null,
      agendamento_cirurgico_id: e.cirurgia ?? null,
      medico_profissional_id: e.medicoAssistente ?? e.medicoSolicitante,
      solicitante_profissional_id: e.medicoSolicitante,
      fonte_pagadora_id: e.convenio,
      plano_fonte_pagadora_id: n(plano.id),
      numero_carteira: e.matricula ?? null,
      carteira_validade: e.validadeCarteira ?? null,
      senha_autorizacao: e.senhaConvenio ?? null,
      cid_termo_terminologia_id: cid ? n(cid.id) : null,
      situacao: p.situacao,
      observacao: e.observacao ?? null,
    });
    return { preInternacao: id, numero: numero.formatado };
  },
  alvo: (_e, r) => ({ tabela: 'agendamento_internacao', id: n(r['preInternacao']) }),
});

const corrigirPreInternacao = definirOperacao<CorrigirPreInternacaoEntrada, ResultadoOperacao>({
  nome: 'internacao.corrigir-pre-internacao',
  tabelas: ['agendamento_internacao'],
  entrada: esquemaCorrigirPreInternacao,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [a] = await tx.consultarParaAtualizar(
      `SELECT id, versao, previsto_para, situacao FROM agendamento_internacao
        WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL
          AND situacao IN (${SITUACOES_PRE_PENDENTES.map(() => '?').join(', ')})
        ORDER BY id DESC LIMIT 1`,
      [est, e.paciente, ...SITUACOES_PRE_PENDENTES],
    );
    if (!a)
      throw naoEncontrado('Pré-internação não encontrada', 'O paciente não tem pré-internação pendente.');
    if (n(a['versao']) !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Registro alterado',
        'A pré-internação mudou desde a leitura.',
        { colunas: ['versao'] },
      );
    // A hora prevista original fica quando só a data muda (sem hora, a da rotina).
    const fuso = await fusoDe(tx, est);
    const horaLida =
      a['previsto_para'] === null
        ? undefined
        : relogioNoFuso(fuso, new Date(a['previsto_para'] as Date)).hora;
    const p = await previsaoDe(tx, est, e.dataPrevista, horaLida);
    await tx.alterar('agendamento_internacao', n(a['id']), e.versao, {
      previsto_para: p.previsto,
      situacao:
        p.situacao === 'em_espera'
          ? 'em_espera'
          : a['situacao'] === 'em_espera'
            ? 'solicitado'
            : a['situacao'],
    });
    return { preInternacao: n(a['id']) };
  },
  alvo: (_e, r) => ({ tabela: 'agendamento_internacao', id: n(r['preInternacao']) }),
});

type Troca = { internacao: number; versao: string } & Record<string, unknown>;

/** Troca de um dado da internação, com a linha da troca (valor anterior e novo). */
function troca(
  nome: string,
  esquema: Operacao<Troca, ResultadoOperacao>['entrada'],
  dado: string,
  aplicar: (tx: TxOperacao, i: Linha, e: Troca) => Promise<{ internacao: Linha; troca: Linha }>,
) {
  return definirOperacao<Troca, ResultadoOperacao>({
    nome,
    tabelas: ['internacao', 'troca_internacao'],
    entrada: esquema,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const usuario = usuarioDe(ctx);
      const i = await internacaoTravada(tx, est, e.internacao, e.versao);
      exigirAberta(i);
      const tipo = await apoio(
        tx,
        'SELECT id FROM tipo_troca_internacao WHERE dado_trocado = ? AND ativo = TRUE ORDER BY id LIMIT 1',
        [dado],
        `o tipo de troca "${dado}"`,
      );
      const t = await aplicar(tx, i, e);
      await tx.incluir('troca_internacao', {
        internacao_id: e.internacao,
        operacao: 'alteracao',
        tipo_troca_internacao_id: tipo,
        ...t.troca,
        ocorrido_em: new Date(),
        usuario_id: usuario,
      });
      const versao = await tx.alterar('internacao', e.internacao, n(i['versao']), t.internacao);
      return { internacao: e.internacao, versao: carimboVersao(versao) };
    },
    alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
  });
}

const trocarConvenio = troca(
  'internacao.trocar-convenio',
  esquemaTrocarConvenio as never,
  'fonte_pagadora',
  async (tx, i, e) => {
    const novo = n(e['convenio']);
    await exigirExiste(tx, 'fonte_pagadora', novo, 'convenio', 'O convênio');
    if (novo === n(i['fonte_pagadora_id'])) throw recusa('mesmo-valor', 'O convênio novo é o atual.');
    return {
      internacao: { fonte_pagadora_id: novo, plano_fonte_pagadora_id: null },
      troca: { anterior_fonte_pagadora_id: nn(i['fonte_pagadora_id']), nova_fonte_pagadora_id: novo },
    };
  },
);
const trocarEspecialidade = troca(
  'internacao.trocar-especialidade',
  esquemaTrocarEspecialidade as never,
  'especialidade',
  async (tx, i, e) => {
    const nova = n(e['especialidade']);
    await exigirExiste(tx, 'especialidade_medica', nova, 'especialidade', 'A especialidade');
    if (nova === n(i['especialidade_medica_id']))
      throw recusa('mesmo-valor', 'A especialidade nova é a atual.');
    return {
      internacao: { especialidade_medica_id: nova },
      troca: {
        anterior_especialidade_medica_id: nn(i['especialidade_medica_id']),
        nova_especialidade_medica_id: nova,
      },
    };
  },
);
const trocarClinica = troca(
  'internacao.trocar-clinica',
  esquemaTrocarClinica as never,
  'modalidade',
  async (tx, i, e) => {
    const nova = await modalidadeDaClinica(tx, texto(e['clinica']));
    if (nova === n(i['modalidade_internacao_id'])) throw recusa('mesmo-valor', 'A clínica nova é a atual.');
    return {
      internacao: { modalidade_internacao_id: nova },
      troca: {
        dados: JSON.stringify({
          modalidadeAnterior: nn(i['modalidade_internacao_id']),
          modalidadeNova: nova,
        }),
      },
    };
  },
);
const trocarMedico = troca(
  'internacao.trocar-medico',
  esquemaTrocarMedico as never,
  'profissional_responsavel',
  async (tx, i, e) => {
    const novo = n(e['medico']);
    await exigirExiste(tx, 'profissional', novo, 'medico', 'O médico');
    const coluna =
      e['tipo'] === 'A' ? 'medico_assistente_profissional_id' : 'medico_solicitante_profissional_id';
    if (novo === n(i[coluna])) throw recusa('mesmo-valor', 'O médico novo é o atual.');
    return {
      internacao: { [coluna]: novo },
      troca:
        e['tipo'] === 'A'
          ? { anterior_profissional_id: nn(i[coluna]), novo_profissional_id: novo }
          : { dados: JSON.stringify({ solicitanteAnterior: nn(i[coluna]), solicitanteNovo: novo }) },
    };
  },
);

const registrarGuia = definirOperacao<
  {
    internacao: number;
    conta: number;
    guia: string;
    senha?: string | undefined;
    validadeDias: number;
    inicio?: string | undefined;
    autorizador?: string | undefined;
    observacao?: string | undefined;
  },
  ResultadoOperacao
>({
  nome: 'internacao.registrar-guia',
  // F3.4 (04-INT 68): cada guia (inicial ou prorrogação) entra no histórico; a internação guarda a vigente.
  tabelas: ['internacao', 'guia_internacao'],
  entrada: esquemaRegistrarGuia as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const i = await internacaoTravada(tx, est, e.internacao);
    if (i['situacao'] === 'cancelada') throw recusa('internacao-cancelada', 'A internação foi excluída.');
    const nova = await gravarGuiaNoHistorico(tx, est, i['data_hora_entrada'] as Date, {
      internacao: e.internacao,
      conta: e.conta,
      guia: e.guia,
      senha: e.senha,
      validadeDias: e.validadeDias,
      inicio: e.inicio,
      autorizador: e.autorizador,
      observacao: e.observacao,
    });
    const versao = await tx.alterar('internacao', e.internacao, n(i['versao']), {
      numero_guia: e.guia,
      senha_autorizacao: e.senha ?? null,
      // O retrato guarda a guia vigente e o TOTAL autorizado (soma do histórico), nunca só a última.
      diarias_autorizadas: nova.diariasTotais,
    });
    return { internacao: e.internacao, versao: carimboVersao(versao) };
  },
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
});

// ── Higienização ─────────────────────────────────────────────────────────────────────────────────

/** Etapa da tela → etapa do cadastro de situações da limpeza. */
export const ETAPA_DA_SITUACAO: Readonly<Record<string, string>> = {
  solicitado: 'solicitada',
  atribuido: 'aguardando',
  emExecucao: 'em_higienizacao',
  pausado: 'em_higienizacao',
  reprovado: 'em_higienizacao',
  concluido: 'pos_higienizacao',
  inspecionado: 'pos_higienizacao',
  liberado: 'liberada',
  cancelado: 'cancelada',
};
export const situacaoLimpeza = (tx: Pick<TxOperacao, 'uma'>, etapa: string) =>
  apoio(
    tx as TxOperacao,
    'SELECT id FROM situacao_limpeza WHERE etapa = ? AND ativo = TRUE ORDER BY ordem LIMIT 1',
    [etapa],
    `a situação de limpeza "${etapa}"`,
  );

const solicitarLimpeza = definirOperacao<
  {
    leito: ChaveLeito;
    tipoLimpeza: number;
    origem: 'alta' | 'manual' | 'qrcode';
    precaucao?: string | undefined;
    observacao?: string | undefined;
  },
  ResultadoOperacao
>({
  nome: 'hotelaria.solicitar-limpeza',
  tabelas: ['solicitacao_limpeza', 'solicitacao_limpeza_local', 'periodo_situacao_leito', 'leito_hospitalar'],
  entrada: esquemaSolicitarLimpeza as never,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const leito = await leitoDaChave(tx, est, e.leito);
    const aberta = await tx.uma(
      `SELECT s.id FROM solicitacao_limpeza s JOIN solicitacao_limpeza_local l ON l.solicitacao_limpeza_id = s.id
        WHERE l.leito_hospitalar_id = ? AND s.concluida_em IS NULL AND s.cancelada_em IS NULL AND s.excluido_em IS NULL`,
      [n(leito['id'])],
    );
    if (aberta)
      throw recusa('limpeza-aberta', 'O leito já tem uma limpeza pedida e não liberada.', {
        campos: ['leito'],
      });
    if (!(await tx.uma('SELECT id FROM modalidade_limpeza WHERE id = ? AND ativo = TRUE', [e.tipoLimpeza])))
      throw recusa('tipo-limpeza-inexistente', 'O tipo de limpeza não existe ou está inativo.', {
        campos: ['tipoLimpeza'],
      });
    const situacao = await situacaoLimpeza(tx, 'solicitada');
    const numero = await tx.proximoNumero('solicitacao_limpeza');
    const id = await tx.incluir('solicitacao_limpeza', {
      estabelecimento_id: est,
      numero: numero.valor,
      motivo_geracao: e.precaucao ? 'isolamento' : 'manual',
      modalidade_limpeza_id: e.tipoLimpeza,
      prioridade: e.precaucao ? 'alta' : 'normal',
      situacao_limpeza_id: situacao,
      solicitante_usuario_id: usuario,
      solicitada_em: new Date(),
      observacao: e.observacao ?? null,
    });
    await tx.incluir('solicitacao_limpeza_local', {
      solicitacao_limpeza_id: id,
      sequencia: 1,
      leito_hospitalar_id: n(leito['id']),
      inclui_acomodacao: false,
      situacao_limpeza_id: situacao,
    });
    // Leito vazio e sem outro estado: fica em higienização até a liberação (o ocupado recebe a limpeza concorrente).
    const leitoId = n(leito['id']);
    const ocupado = await tx.uma(
      "SELECT id FROM ocupacao_leito WHERE leito_hospitalar_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL AND excluido_em IS NULL",
      [leitoId],
    );
    const periodo = await tx.uma(
      'SELECT id FROM periodo_situacao_leito WHERE leito_hospitalar_id = ? AND data_hora_fim IS NULL',
      [leitoId],
    );
    if (!ocupado && !periodo) {
      const agora = new Date();
      await tx.incluir('periodo_situacao_leito', {
        leito_hospitalar_id: leitoId,
        situacao_leito_id: await situacaoDoLeitoPorBase(tx, 'higienizacao'),
        data_hora_inicio: agora,
        solicitacao_limpeza_id: id,
        operacao: 'inclusao',
        dados: JSON.stringify({ estado: 'higienizacao', motivo: null, precaucao: e.precaucao ?? null }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      await situarLeito(tx, leitoId);
    }
    return { solicitacao: id };
  },
  eventos: (_e, r) => [{ tipo: 'hotelaria.limpeza_solicitada', carga: { solicitacao: n(r['solicitacao']) } }],
  alvo: (_e, r) => ({ tabela: 'solicitacao_limpeza', id: n(r['solicitacao']) }),
});

export async function limpezaTravada(tx: TxOperacao, est: number, id: number): Promise<Linha> {
  const [s] = await tx.consultarParaAtualizar(
    'SELECT id, versao, concluida_em, cancelada_em, inicio_higienizacao_em, fim_higienizacao_em FROM solicitacao_limpeza WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
  );
  if (!s) throw naoEncontrado('Solicitação não encontrada', 'A solicitação de limpeza não existe.');
  if (s['concluida_em'] !== null || s['cancelada_em'] !== null)
    throw recusa('limpeza-encerrada', 'A limpeza já foi liberada ou cancelada.');
  return s;
}

/** Encerra o período de situação do leito ligado à solicitação de limpeza, se houver (sem recusa quando não há). */
async function encerrarPeriodoDaLimpeza(
  tx: TxOperacao,
  solicitacao: number,
  usuario: number,
  agora: Date,
): Promise<number[]> {
  const periodos = await tx.consultarParaAtualizar(
    'SELECT id, versao, leito_hospitalar_id FROM periodo_situacao_leito WHERE solicitacao_limpeza_id = ? AND data_hora_fim IS NULL',
    [solicitacao],
  );
  for (const p of periodos)
    await tx.alterar('periodo_situacao_leito', n(p['id']), n(p['versao']), {
      data_hora_fim: agora,
      operacao: 'alteracao',
      ocorrido_em: agora,
      usuario_id: usuario,
    });
  return periodos.map((p) => n(p['leito_hospitalar_id']));
}

/**
 * A liberação do leito (um caminho só: a ação "Liberar leito" e a etapa "liberado" da higienização): a solicitação
 * liberada, os locais liberados, o período de higienização ligado encerrado e a situação atual do leito refeita.
 * `s` é a solicitação já travada; `extras` são colunas da etapa (profissional, observação) gravadas junto.
 */
export async function liberarSolicitacao(
  tx: TxOperacao,
  solicitacao: number,
  s: Linha,
  usuario: number,
  extras: Record<string, unknown> = {},
): Promise<void> {
  const agora = new Date();
  const liberada = await situacaoLimpeza(tx, 'liberada');
  await tx.alterar('solicitacao_limpeza', solicitacao, n(s['versao']), {
    ...extras,
    situacao_limpeza_id: liberada,
    concluida_em: agora,
    ...(s['inicio_higienizacao_em'] !== null &&
    s['fim_higienizacao_em'] === null &&
    extras['fim_higienizacao_em'] === undefined
      ? { fim_higienizacao_em: agora }
      : {}),
  });
  const locais = await tx.consultar(
    'SELECT id, versao, leito_hospitalar_id FROM solicitacao_limpeza_local WHERE solicitacao_limpeza_id = ? AND excluido_em IS NULL',
    [solicitacao],
  );
  const leitos = new Set<number>();
  for (const l of locais) {
    await tx.alterar('solicitacao_limpeza_local', n(l['id']), n(l['versao']), {
      situacao_limpeza_id: liberada,
    });
    if (l['leito_hospitalar_id'] !== null) leitos.add(n(l['leito_hospitalar_id']));
  }
  for (const leito of await encerrarPeriodoDaLimpeza(tx, solicitacao, usuario, agora)) leitos.add(leito);
  for (const leito of leitos) await situarLeito(tx, leito);
}

const liberarLeito = definirOperacao<{ solicitacao: number }, ResultadoOperacao>({
  nome: 'hotelaria.liberar-leito',
  tabelas: ['solicitacao_limpeza', 'solicitacao_limpeza_local', 'periodo_situacao_leito', 'leito_hospitalar'],
  entrada: esquemaLiberarLeito,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const s = await limpezaTravada(tx, est, e.solicitacao);
    await liberarSolicitacao(tx, e.solicitacao, s, usuario);
    return { solicitacao: e.solicitacao };
  },
  eventos: (e) => [{ tipo: 'hotelaria.leito_liberado', carga: { solicitacao: e.solicitacao } }],
  alvo: (e) => ({ tabela: 'solicitacao_limpeza', id: e.solicitacao }),
});

// ── SAME ─────────────────────────────────────────────────────────────────────────────────────────

/** Volume do prontuário do paciente do atendimento ("conta") no estabelecimento (o mais recente aberto). */
export async function volumeDaConta(
  tx: Pick<TxOperacao, 'uma'>,
  est: number,
  conta: number,
): Promise<Linha | null> {
  return tx.uma(
    `SELECT v.id, v.paciente_id, a.id AS atendimento FROM atendimento a
       JOIN volume_prontuario v ON v.paciente_id = a.paciente_id AND v.estabelecimento_id = a.estabelecimento_id
      WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND v.excluido_em IS NULL
        AND v.situacao IN ('aberto','encerrado','arquivado','emprestado')
      ORDER BY v.numero_volume DESC LIMIT 1`,
    [conta, est],
  );
}

const movimentarProntuario = definirOperacao<MovimentarProntuarioEntrada, ResultadoOperacao>({
  nome: 'same.movimentar-prontuario',
  tabelas: ['movimento_prontuario'],
  entrada: esquemaMovimentarProntuario,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const v = await volumeDaConta(tx, est, e.conta);
    if (!v)
      throw recusa(
        'sem-volume',
        'O paciente do atendimento não tem volume de prontuário neste estabelecimento.',
      );
    const op = await apoio(
      tx,
      'SELECT id FROM operacao_movimento_prontuario WHERE codigo = ? AND ativo = TRUE',
      [String(e.operacao)],
      `a operação de movimento de prontuário ${e.operacao}`,
    );
    for (const s of [e.setorOrigem, e.setorDestino])
      if (
        !(await tx.uma(
          'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [s, est],
        ))
      )
        throw recusa('setor-inexistente', 'O setor não existe neste estabelecimento.', {
          campos: ['setorDestino'],
        });
    const fuso = await fusoDe(tx, est);
    const id = await tx.incluir('movimento_prontuario', {
      estabelecimento_id: est,
      volume_prontuario_id: n(v['id']),
      paciente_id: n(v['paciente_id']),
      atendimento_id: e.conta,
      operacao_movimento_prontuario_id: op,
      movimentado_em: new Date(),
      movimentado_por_usuario_id: usuario,
      saida_setor_funcional_id: e.setorOrigem,
      destino_setor_funcional_id: e.setorOrigem === e.setorDestino ? null : e.setorDestino,
      responsavel_nome: e.responsavel,
      previsao_retorno: e.prazoDevolucao ? instanteCivil(e.prazoDevolucao, '2359', fuso) : null,
      observacao:
        [
          e.observacao,
          e.protocolo ? `Protocolo ${e.protocolo}` : null,
          e.avalComissao ? `Aval ${e.avalComissao}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    });
    return { movimento: id };
  },
  alvo: (_e, r) => ({ tabela: 'movimento_prontuario', id: n(r['movimento']) }),
});

const excluirMovimento = definirOperacao<{ movimento: number; motivo: string }, ResultadoOperacao>({
  nome: 'same.excluir-movimento',
  tabelas: ['movimento_prontuario'],
  entrada: esquemaExcluirMovimento,
  acao: 'exclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [m] = await tx.consultarParaAtualizar(
      'SELECT id, versao, volume_prontuario_id FROM movimento_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.movimento, est],
    );
    if (!m) throw naoEncontrado('Movimento não encontrado', 'O movimento do SAME não existe.');
    const ultimo = await tx.uma(
      'SELECT id FROM movimento_prontuario WHERE volume_prontuario_id = ? AND excluido_em IS NULL ORDER BY movimentado_em DESC, id DESC LIMIT 1',
      [n(m['volume_prontuario_id'])],
    );
    if (n(ultimo?.['id']) !== e.movimento)
      throw recusa('movimento-nao-ultimo', 'Só o último movimento do volume pode ser excluído.');
    await tx.excluir('movimento_prontuario', e.movimento, n(m['versao']));
    return { movimento: e.movimento };
  },
  alvo: (e) => ({ tabela: 'movimento_prontuario', id: e.movimento }),
  trilha: (e) => ({ motivo: e.motivo }),
});

/** As operações da internação pelo nome da tela. */
export const OPERACOES_ADT_BANCO: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'internacao.internar': internar as never,
  'internacao.preInternar': preInternar as never,
  'internacao.corrigirPreInternacao': corrigirPreInternacao as never,
  'internacao.trocarConvenio': trocarConvenio as never,
  'internacao.trocarClinica': trocarClinica as never,
  'internacao.trocarEspecialidade': trocarEspecialidade as never,
  'internacao.trocarMedico': trocarMedico as never,
  'internacao.registrarGuia': registrarGuia as never,
  'internacao.darAlta': darAlta as never,
  'internacao.transferirLeito': transferirLeito as never,
  'internacao.cancelarAlta': cancelarAlta as never,
  'internacao.excluirInternacao': excluirInternacao as never,
  'hotelaria.solicitarLimpeza': solicitarLimpeza as never,
  'hotelaria.liberarLeito': liberarLeito as never,
  'same.movimentarProntuario': movimentarProntuario as never,
  'same.excluirMovimento': excluirMovimento as never,
  ...OPERACOES_REGISTROS_INTERNACAO,
};
