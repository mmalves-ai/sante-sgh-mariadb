// Leituras da linha de base de carga (k6) sobre o banco próprio do cliente (MariaDB, pelo @sgh/nucleo): as âncoras
// (o alvo sorteado dentro da API: paciente, horário, prescrição, competência) e as consultas que cada tela faz, sempre
// no estabelecimento da carga. Só contagens e ids saem daqui; nenhum valor de linha (nome, documento) sai da API.
// Melhoria: as âncoras vêm do próprio banco (último dia com movimento de cada área, local de estoque com mais saldo,
// unidade com mais internados), sem código fixo de local nem de setor; toda leitura filtra o estabelecimento e a
// exclusão lógica; o relatório pesado é cancelado pelo tempo máximo da consulta do núcleo.
import type { Leitor } from '@sgh/nucleo';

type Num = number | string | bigint | null;
const n = (v: Num | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const dia = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && v ? v.slice(0, 10) : null;
const somarDias = (d: string, k: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const contar = async (l: Leitor, sql: string, p: readonly unknown[]): Promise<number> =>
  n((await l.uma<{ n: Num }>(sql, p))?.n);
const ids = async (l: Leitor, sql: string, p: readonly unknown[]): Promise<number[]> =>
  (await l.consultar<{ id: Num }>(sql, p)).map((x) => n(x.id));
/** Alvo sorteado numa lista (o sorteio do k6 vira posição; lista vazia: null). */
export const sortear = <T>(lista: readonly T[], sorteio: number): T | null =>
  lista.length === 0 ? null : (lista[Math.abs(sorteio) % lista.length] ?? null);

// ---- Sessão e ficha ---------------------------------------------------------------------------------------------

/** O login: o usuário ativo sorteado, os estabelecimentos e os perfis vigentes dele (o que a entrada monta). */
export async function cargaLogin(l: Leitor, est: number, sorteio: number): Promise<number> {
  const total = await contar(
    l,
    "SELECT COUNT(*) AS n FROM usuario WHERE situacao = 'ativo' AND excluido_em IS NULL",
    [],
  );
  if (total === 0) return 0;
  const u = await l.uma<{ id: Num }>(
    "SELECT id FROM usuario WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id LIMIT 1 OFFSET ?",
    [Math.abs(sorteio) % total],
  );
  if (!u) return 0;
  const vinculos = await contar(
    l,
    `SELECT COUNT(*) AS n FROM usuario_estabelecimento
      WHERE usuario_id = ? AND excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
        AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [u.id],
  );
  const perfis = await contar(
    l,
    `SELECT COUNT(*) AS n FROM usuario_perfil
      WHERE usuario_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) AND excluido_em IS NULL
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [u.id, est],
  );
  return 1 + vinculos + perfis;
}

/** Faixa dos ids de paciente (o sorteio do k6 cai dentro dela). O cadastro do paciente é da rede inteira. */
export async function faixaPacientes(l: Leitor): Promise<{ min: number; max: number }> {
  const r = await l.uma<{ min: Num; max: Num }>(
    'SELECT MIN(id) AS min, MAX(id) AS max FROM paciente WHERE excluido_em IS NULL',
    [],
  );
  return { min: n(r?.min), max: n(r?.max) };
}

/** Abrir a ficha: o paciente com a pessoa, as alergias ativas e os últimos atendimentos no estabelecimento. */
export async function cargaAbrirFicha(
  l: Leitor,
  est: number,
  paciente: number,
): Promise<{ encontrado: boolean; itens: number }> {
  const p = await l.uma<{ id: Num }>(
    `SELECT p.id FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL AND f.excluido_em IS NULL`,
    [paciente],
  );
  if (!p) return { encontrado: false, itens: 0 };
  const alergias = await contar(
    l,
    'SELECT COUNT(*) AS n FROM alergia_paciente WHERE paciente_id = ? AND ativa = TRUE AND excluido_em IS NULL',
    [paciente],
  );
  const atendimentos = await contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM atendimento WHERE paciente_id = ? AND estabelecimento_id = ?
        AND excluido_em IS NULL ORDER BY entrada_em DESC LIMIT 50) t`,
    [paciente, est],
  );
  return { encontrado: true, itens: 1 + alergias + atendimentos };
}

// ---- Âncora geral, listas, painel e relatório -------------------------------------------------------------------

export interface AncoraCarga {
  /** Último dia com entrada de atendimento no estabelecimento (o dump de teste termina antes do relógio). */
  readonly dia: string | null;
}

export async function ancoraCarga(l: Leitor, est: number): Promise<AncoraCarga> {
  const r = await l.uma<{ d: unknown }>(
    'SELECT MAX(entrada_em) AS d FROM atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL',
    [est],
  );
  return { dia: dia(r?.d) };
}

/** As listas do dia: os atendimentos em andamento e os do último dia (a lista da recepção e a do pronto-socorro). */
export async function cargaListas(l: Leitor, est: number, a: AncoraCarga): Promise<number> {
  const abertos = await contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL
        AND situacao IN ('aberto','em_atendimento','em_observacao') LIMIT 2000) t`,
    [est],
  );
  if (!a.dia) return abertos;
  const doDia = await contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL
        AND entrada_em >= ? AND entrada_em < ? LIMIT 2000) t`,
    [est, a.dia, somarDias(a.dia, 1)],
  );
  return abertos + doDia;
}

/** O painel automático: a ocupação por unidade de internação (leitos ativos e internações ativas). */
export async function cargaPainel(l: Leitor, est: number): Promise<number> {
  const linhas = await l.consultar(
    `SELECT u.id, COUNT(DISTINCT lh.id) AS leitos, COUNT(DISTINCT i.id) AS internados
       FROM unidade_internacao u
       LEFT JOIN leito_hospitalar lh ON lh.unidade_internacao_id = u.id AND lh.ativo = TRUE AND lh.excluido_em IS NULL
       LEFT JOIN internacao i ON i.unidade_internacao_id = u.id AND i.situacao = 'ativa' AND i.excluido_em IS NULL
      WHERE u.estabelecimento_id = ? AND u.excluido_em IS NULL
      GROUP BY u.id`,
    [est],
  );
  return linhas.length;
}

/** O relatório operacional: atendimentos por dia e situação no mês da âncora. */
export async function cargaRelatorio(l: Leitor, est: number, a: AncoraCarga): Promise<number> {
  if (!a.dia) return 0;
  const inicio = `${a.dia.slice(0, 7)}-01`;
  const linhas = await l.consultar(
    `SELECT DATE(entrada_em) AS dia, situacao, COUNT(*) AS n FROM atendimento
      WHERE estabelecimento_id = ? AND excluido_em IS NULL AND entrada_em >= ? AND entrada_em < ?
      GROUP BY DATE(entrada_em), situacao`,
    [est, inicio, somarDias(a.dia, 1)],
    { teto: 2_000 },
  );
  return linhas.length;
}

/**
 * A consulta pesada: atendimentos por fonte pagadora, mês a mês, de 2020 ao mês corrente, com o tempo máximo curto.
 * O núcleo cancela a consulta que passa do tempo (ErroTempoEsgotado), e quem chama mede o cancelamento.
 */
export async function relatorioPesado(l: Leitor, est: number, tempoMaximoMs: number): Promise<number> {
  const linhas = await l.consultar(
    `SELECT a.fonte_pagadora_id, DATE_FORMAT(a.entrada_em, '%Y-%m') AS mes, COUNT(*) AS atendimentos,
            COUNT(DISTINCT a.paciente_id) AS pacientes
       FROM atendimento a
      WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.entrada_em >= '2020-01-01'
      GROUP BY a.fonte_pagadora_id, DATE_FORMAT(a.entrada_em, '%Y-%m')`,
    [est],
    { teto: 2_000, tempoMaximoMs },
  );
  return linhas.length;
}

// ---- Agenda e portal --------------------------------------------------------------------------------------------

export interface AncoraAgenda {
  /** Último dia com horário gerado; a janela das buscas vai de 30 dias antes até ele. */
  readonly dia: string | null;
  readonly agendas: readonly number[];
}

export async function ancoraAgenda(l: Leitor, est: number): Promise<AncoraAgenda> {
  const r = await l.uma<{ d: unknown }>(
    'SELECT MAX(data_referencia) AS d FROM horario_agenda WHERE estabelecimento_id = ? AND excluido_em IS NULL',
    [est],
  );
  const agendas = await ids(
    l,
    'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 500',
    [est],
  );
  return { dia: dia(r?.d), agendas };
}

/** A busca de vaga: horários livres com vaga na janela, de todas as agendas ou de uma. */
export async function cargaVagas(l: Leitor, est: number, a: AncoraAgenda, agenda: number | null): Promise<number> {
  if (!a.dia) return 0;
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT h.id FROM horario_agenda h
        WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.situacao = 'livre' AND h.vagas_ocupadas < h.vagas
          AND h.data_referencia BETWEEN ? AND ? AND (? IS NULL OR h.agenda_servico_id = ?)
        ORDER BY h.inicio_em LIMIT 200) t`,
    [est, somarDias(a.dia, -30), a.dia, agenda, agenda],
  );
}

/** A pauta do dia de uma agenda sorteada: as marcações dos horários do último dia. */
export async function cargaPauta(l: Leitor, est: number, a: AncoraAgenda, sorteio: number): Promise<number> {
  const agenda = sortear(a.agendas, sorteio);
  if (!a.dia || agenda === null) return 0;
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
      WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND h.excluido_em IS NULL
        AND h.agenda_servico_id = ? AND h.data_referencia = ?`,
    [est, agenda, a.dia],
  );
}

export interface AlvoMarcacao {
  readonly horario: number;
  readonly agenda: number;
  /** Paciente de uma marcação da mesma agenda ("meus agendamentos" do portal); null sem marcação. */
  readonly paciente: number | null;
}

/** Os horários livres da janela que a marcação lê antes de gravar (até 500), com um paciente da agenda. */
export async function alvosMarcacao(l: Leitor, est: number, a: AncoraAgenda): Promise<AlvoMarcacao[]> {
  if (!a.dia) return [];
  const linhas = await l.consultar<{ id: Num; agenda: Num; paciente: Num }>(
    `SELECT h.id, h.agenda_servico_id AS agenda,
            (SELECT m.paciente_id FROM marcacao_horario m JOIN horario_agenda h2 ON h2.id = m.horario_agenda_id
              WHERE h2.agenda_servico_id = h.agenda_servico_id AND m.excluido_em IS NULL AND m.paciente_id IS NOT NULL
              ORDER BY m.id DESC LIMIT 1) AS paciente
       FROM horario_agenda h
      WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.situacao = 'livre'
        AND h.data_referencia BETWEEN ? AND ?
      ORDER BY h.id LIMIT 500`,
    [est, somarDias(a.dia, -30), a.dia],
  );
  return linhas.map((x) => ({ horario: n(x.id), agenda: n(x.agenda), paciente: x.paciente === null ? null : n(x.paciente) }));
}

/** As leituras da marcação antes de gravar: o horário, a agenda, as fontes pagadoras aceitas e a escala do dia. */
export async function cargaMarcacao(l: Leitor, est: number, alvo: AlvoMarcacao): Promise<number> {
  const h = await l.uma(
    `SELECT h.id FROM horario_agenda h JOIN agenda_servico s ON s.id = h.agenda_servico_id
      WHERE h.id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL AND s.excluido_em IS NULL`,
    [alvo.horario, est],
  );
  if (!h) return 0;
  const fontes = await contar(
    l,
    'SELECT COUNT(*) AS n FROM agenda_fonte_pagadora WHERE agenda_servico_id = ? AND excluido_em IS NULL',
    [alvo.agenda],
  );
  const escala = await contar(
    l,
    'SELECT COUNT(*) AS n FROM agenda_escala WHERE agenda_servico_id = ? AND ativo = TRUE',
    [alvo.agenda],
  );
  return 1 + fontes + escala;
}

/** A busca de horários do portal: só agendas com fonte pagadora que aceita marcação pela internet. */
export async function cargaHorariosPortal(l: Leitor, est: number, a: AncoraAgenda, sorteio: number): Promise<number> {
  if (!a.dia) return 0;
  const agenda = sorteio % 2 === 0 ? null : sortear(a.agendas, sorteio);
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT h.id FROM horario_agenda h
        WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.situacao = 'livre' AND h.vagas_ocupadas < h.vagas
          AND h.data_referencia BETWEEN ? AND ? AND (? IS NULL OR h.agenda_servico_id = ?)
          AND EXISTS (SELECT 1 FROM agenda_fonte_pagadora f WHERE f.agenda_servico_id = h.agenda_servico_id
                         AND f.aceita_marcacao_online = TRUE AND f.excluido_em IS NULL)
        ORDER BY h.inicio_em LIMIT 200) t`,
    [est, somarDias(a.dia, -30), a.dia, agenda, agenda],
  );
}

/** "Meus agendamentos" do portal: as marcações do paciente no estabelecimento. */
export async function cargaMeusAgendamentos(l: Leitor, est: number, alvo: AlvoMarcacao): Promise<number> {
  if (alvo.paciente === null) return 0;
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT m.id FROM marcacao_horario m WHERE m.paciente_id = ? AND m.estabelecimento_id = ?
        AND m.excluido_em IS NULL ORDER BY m.marcado_em DESC LIMIT 100) t`,
    [alvo.paciente, est],
  );
}

// ---- Recepção (senhas e guias) ----------------------------------------------------------------------------------

export interface AncoraRecepcao {
  /** Último dia com senha emitida no estabelecimento. */
  readonly dia: string | null;
}

export async function ancoraRecepcao(l: Leitor, est: number): Promise<AncoraRecepcao> {
  const r = await l.uma<{ d: unknown }>(
    'SELECT MAX(data_referencia) AS d FROM senha_emitida WHERE estabelecimento_id = ? AND excluido_em IS NULL',
    [est],
  );
  return { dia: dia(r?.d) };
}

/** A fila do guichê: as senhas do dia ainda na fila e os guichês do estabelecimento em uso. */
export async function cargaFila(l: Leitor, est: number, a: AncoraRecepcao, sorteio: number): Promise<number> {
  if (!a.dia) return 0;
  void sorteio;
  const fila = await contar(
    l,
    `SELECT COUNT(*) AS n FROM senha_emitida WHERE estabelecimento_id = ? AND data_referencia = ?
        AND situacao IN ('aguardando','chamada','em_atendimento') AND excluido_em IS NULL`,
    [est, a.dia],
  );
  const guiches = await contar(
    l,
    `SELECT COUNT(DISTINCT guiche_recepcao_id) AS n FROM senha_emitida
      WHERE estabelecimento_id = ? AND data_referencia = ? AND guiche_recepcao_id IS NOT NULL AND excluido_em IS NULL`,
    [est, a.dia],
  );
  return fila + guiches;
}

/** O painel do supervisor: as senhas do dia por situação e por prioridade. */
export async function cargaSupervisor(l: Leitor, est: number, a: AncoraRecepcao): Promise<number> {
  if (!a.dia) return 0;
  const linhas = await l.consultar(
    `SELECT situacao, prioritaria, COUNT(*) AS n FROM senha_emitida
      WHERE estabelecimento_id = ? AND data_referencia = ? AND excluido_em IS NULL GROUP BY situacao, prioritaria`,
    [est, a.dia],
  );
  return linhas.length;
}

/** A estrutura do guichê: os guichês ativos dos pontos de recepção do estabelecimento. */
export async function cargaEstrutura(l: Leitor, est: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM guiche_recepcao g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
      WHERE p.estabelecimento_id = ? AND g.ativo = TRUE AND g.excluido_em IS NULL AND p.ativo = TRUE`,
    [est],
  );
}

/** As guias do dia aguardando autorização da operadora (montadas ou conferidas, sem autorização). */
export async function guiasAguardandoAutorizacao(l: Leitor, est: number, diaRef: string): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM guia_tiss WHERE estabelecimento_id = ? AND data_emissao = ?
        AND data_autorizacao IS NULL AND situacao IN ('montada','conferida') AND excluido_em IS NULL LIMIT 2000) t`,
    [est, diaRef],
  );
}

// ---- Preços e contratos -----------------------------------------------------------------------------------------

/** Os procedimentos com preço (ativos) das tabelas do estabelecimento ou da rede. */
export async function procedimentosComPreco(l: Leitor, est: number, teto: number): Promise<number[]> {
  return ids(
    l,
    `SELECT pp.id FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id
      WHERE pp.ativo = TRUE AND pp.excluido_em IS NULL AND t.excluido_em IS NULL
        AND (t.estabelecimento_id IS NULL OR t.estabelecimento_id = ?)
        AND EXISTS (SELECT 1 FROM preco_procedimento_valor v WHERE v.preco_procedimento_id = pp.id)
      ORDER BY pp.id LIMIT ?`,
    [est, teto],
  );
}

/** O valor vigente na data (a maior vigência até ela), como a consulta de preço da tela. */
export async function valorVigente(l: Leitor, procedimento: number, data: string): Promise<boolean> {
  const v = await l.uma(
    `SELECT valor_total FROM preco_procedimento_valor WHERE preco_procedimento_id = ? AND vigencia_inicio <= ?
      ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
    [procedimento, data],
  );
  return v !== null;
}

export async function contratosDoEstabelecimento(l: Leitor, est: number): Promise<number[]> {
  return ids(
    l,
    'SELECT id FROM contrato_fonte_pagadora WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 500',
    [est],
  );
}

/** O contrato em abas: o contrato e as tabelas de preço ligadas a ele. */
export async function cargaContrato(l: Leitor, est: number, contrato: number): Promise<number> {
  const c = await l.uma(
    'SELECT id FROM contrato_fonte_pagadora WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [contrato, est],
  );
  if (!c) return 0;
  return (
    1 +
    (await contar(
      l,
      'SELECT COUNT(*) AS n FROM tabela_preco WHERE contrato_fonte_pagadora_id = ? AND excluido_em IS NULL',
      [contrato],
    ))
  );
}

// ---- Diagnóstico (laboratório) ----------------------------------------------------------------------------------

const DO_LABORATORIO = `FROM exame_item i
  JOIN requisicao_exame r ON r.id = i.requisicao_exame_id AND r.excluido_em IS NULL
  JOIN setor_diagnostico s ON s.id = i.setor_diagnostico_id AND s.tipo = 'laboratorio' AND s.excluido_em IS NULL
 WHERE r.estabelecimento_id = ? AND i.excluido_em IS NULL`;

/** Último dia com pedido do laboratório (ou com pedido ainda não coletado). */
export async function ultimoDiaDoLaboratorio(l: Leitor, est: number, pendente = false): Promise<string | null> {
  const r = await l.uma<{ d: unknown }>(
    `SELECT MAX(r.solicitado_em) AS d ${DO_LABORATORIO}${pendente ? " AND i.situacao IN ('solicitado','autorizado','agendado')" : ''}`,
    [est],
  );
  return dia(r?.d);
}

export const SITUACOES_SETOR = {
  todos: null,
  aReceber: ['solicitado', 'autorizado', 'agendado'],
  aLiberar: ['coletado', 'em_analise', 'resultado_digitado', 'revisado'],
  liberados: ['liberado', 'entregue'],
} as const;

/** Os exames do setor no dia, por situação (a lista da tela, até 2.000). */
export async function examesDoSetor(
  l: Leitor,
  est: number,
  diaRef: string,
  situacao: keyof typeof SITUACOES_SETOR,
): Promise<number> {
  const lista = SITUACOES_SETOR[situacao];
  const filtro = lista ? ` AND i.situacao IN (${lista.map(() => '?').join(',')})` : '';
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT i.id ${DO_LABORATORIO} AND r.solicitado_em >= ? AND r.solicitado_em < ?${filtro}
        LIMIT 2000) t`,
    [est, diaRef, somarDias(diaRef, 1), ...(lista ?? [])],
  );
}

/** A lista de coleta: as requisições do dia com exame a coletar (os grupos da tela). */
export async function listaDeColeta(l: Leitor, est: number, diaRef: string): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(DISTINCT r.id) AS n ${DO_LABORATORIO} AND r.solicitado_em >= ? AND r.solicitado_em < ?
        AND i.situacao IN ('solicitado','autorizado','agendado')`,
    [est, diaRef, somarDias(diaRef, 1)],
  );
}

/** O mapa de trabalho: os exames do dia agrupados pela bancada da amostra. */
export async function mapaDeTrabalho(l: Leitor, est: number, diaRef: string): Promise<number> {
  const linhas = await l.consultar(
    `SELECT ae.bancada_analitica_id AS bancada, COUNT(*) AS n ${DO_LABORATORIO.replace(
      ' WHERE',
      ' LEFT JOIN amostra_biologica_exame ae ON ae.exame_item_id = i.id AND ae.excluido_em IS NULL\n WHERE',
    )} AND r.solicitado_em >= ? AND r.solicitado_em < ? GROUP BY ae.bancada_analitica_id`,
    [est, diaRef, somarDias(diaRef, 1)],
  );
  return linhas.length;
}

/** A fila de liberação: os resultados digitados ou conferidos dos exames do dia. */
export async function filaDeLiberacao(l: Leitor, est: number, diaRef: string): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT re.id ${DO_LABORATORIO.replace(
      ' WHERE',
      ' JOIN resultado_exame re ON re.exame_item_id = i.id AND re.excluido_em IS NULL\n WHERE',
    )} AND r.solicitado_em >= ? AND r.solicitado_em < ? AND re.situacao IN ('digitado','conferido') LIMIT 2000) t`,
    [est, diaRef, somarDias(diaRef, 1)],
  );
}

/** O ciclo da vigia: os resultados críticos liberados desde o início do dia que ainda não têm aviso. */
export async function liberadosComCriticoSemAviso(l: Leitor, est: number, desde: string): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT re.id FROM resultado_exame re
        JOIN exame_item i ON i.id = re.exame_item_id AND i.excluido_em IS NULL
        JOIN requisicao_exame r ON r.id = i.requisicao_exame_id AND r.excluido_em IS NULL
       WHERE r.estabelecimento_id = ? AND re.excluido_em IS NULL AND re.situacao = 'liberado' AND re.critico = TRUE
         AND re.liberado_em >= ?
         AND NOT EXISTS (SELECT 1 FROM aviso_valor_critico a WHERE a.resultado_exame_id = re.id AND a.excluido_em IS NULL)
       LIMIT 500) t`,
    [est, desde],
  );
}

// ---- Estoque e farmácia -----------------------------------------------------------------------------------------

export interface AncoraEstoque {
  /** O local com mais itens em saldo (o almoxarifado central, na prática). */
  readonly local: number | null;
  /** Mês da última movimentação do local (AAAA-MM). */
  readonly mes: string | null;
  /** Insumos com lote no local (até 200), para a leitura dos lotes. */
  readonly insumos: readonly number[];
}

export async function ancoraEstoque(l: Leitor, est: number): Promise<AncoraEstoque> {
  const r = await l.uma<{ local: Num; d: unknown }>(
    `SELECT local_estoque_id AS local, MAX(ultima_movimentacao_em) AS d FROM saldo_estoque
      WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY local_estoque_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [est],
  );
  if (!r) return { local: null, mes: null, insumos: [] };
  const local = n(r.local);
  const insumos = await ids(
    l,
    `SELECT DISTINCT li.insumo_id AS id FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
      WHERE sl.local_estoque_id = ? AND sl.excluido_em IS NULL AND li.excluido_em IS NULL ORDER BY li.insumo_id LIMIT 200`,
    [local],
  );
  return { local, mes: dia(r.d)?.slice(0, 7) ?? null, insumos };
}

export async function saldosDoLocal(l: Leitor, est: number, local: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM saldo_estoque WHERE estabelecimento_id = ? AND local_estoque_id = ?
        AND excluido_em IS NULL LIMIT 5000) t`,
    [est, local],
  );
}

/** Os lotes do insumo no local, com saldo e na validade (a escolha do lote na saída). */
export async function lotesDoLocal(l: Leitor, local: number, insumo: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
      WHERE sl.local_estoque_id = ? AND li.insumo_id = ? AND sl.quantidade > 0 AND sl.bloqueado = FALSE
        AND sl.excluido_em IS NULL AND li.excluido_em IS NULL AND li.situacao = 'liberado'
        AND (li.validade IS NULL OR li.validade >= CURRENT_DATE)`,
    [local, insumo],
  );
}

/** As saídas do local na competência (documentos de saída). */
export async function saidasDaCompetencia(l: Leitor, est: number, local: number, mes: string): Promise<number> {
  const inicio = `${mes}-01`;
  const fim = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM documento_estoque WHERE estabelecimento_id = ? AND origem_local_estoque_id = ?
        AND tipo IN ('saida_setor','saida_paciente','transferencia') AND movimentado_em >= ? AND movimentado_em < ?
        AND excluido_em IS NULL LIMIT 2000) t`,
    [est, local, inicio, fim],
  );
}

/** A fila das requisições pendentes ao local. */
export async function requisicoesPendentes(l: Leitor, est: number, local: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM requisicao_material WHERE estabelecimento_id = ? AND atendente_local_estoque_id = ?
        AND situacao IN ('solicitada','autorizada','em_separacao','atendida_parcial') AND excluido_em IS NULL LIMIT 2000) t`,
    [est, local],
  );
}

export interface AncoraFarmacia {
  /** A unidade de internação com mais internados. */
  readonly unidade: number | null;
  /** Último horário de administração previsto do estabelecimento (fim da janela). */
  readonly fim: Date | null;
}

export async function ancoraFarmacia(l: Leitor, est: number): Promise<AncoraFarmacia> {
  const u = await l.uma<{ unidade: Num }>(
    `SELECT unidade_internacao_id AS unidade FROM internacao WHERE estabelecimento_id = ? AND situacao = 'ativa'
        AND excluido_em IS NULL GROUP BY unidade_internacao_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [est],
  );
  const h = await l.uma<{ fim: unknown }>(
    'SELECT MAX(previsto_em) AS fim FROM horario_administracao WHERE estabelecimento_id = ? AND excluido_em IS NULL',
    [est],
  );
  const fim = h?.fim instanceof Date ? h.fim : typeof h?.fim === 'string' ? new Date(`${h.fim.replace(' ', 'T')}Z`) : null;
  return { unidade: u ? n(u.unidade) : null, fim };
}

/** A fila da dispensação: as doses da unidade na janela de 12 h (horários dos internados da unidade). */
export async function filaDaUnidade(l: Leitor, est: number, unidade: number, inicio: Date, fim: Date): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT h.id FROM horario_administracao h
        JOIN internacao i ON i.atendimento_id = h.atendimento_id AND i.situacao = 'ativa' AND i.excluido_em IS NULL
       WHERE h.estabelecimento_id = ? AND i.unidade_internacao_id = ? AND h.previsto_em >= ? AND h.previsto_em < ?
         AND h.excluido_em IS NULL AND h.suspenso = FALSE LIMIT 5000) t`,
    [est, unidade, inicio, fim],
  );
}

/** A entrega ao setor: as dispensações separadas à espera da entrega. */
export async function entregasPendentes(l: Leitor, est: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM dispensacao WHERE estabelecimento_id = ? AND situacao IN ('separada','dispensada')
        AND excluido_em IS NULL LIMIT 2000) t`,
    [est],
  );
}

/** Os controlados: os itens dispensados de insumo da lista de controle especial nos 7 dias. */
export async function movimentosControlados(l: Leitor, est: number, inicio: Date, fim: Date): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT di.id FROM dispensacao_item di
        JOIN dispensacao d ON d.id = di.dispensacao_id AND d.excluido_em IS NULL
        JOIN insumo s ON s.id = di.insumo_id AND s.lista_controle_especial_id IS NOT NULL
       WHERE d.estabelecimento_id = ? AND d.dispensado_em >= ? AND d.dispensado_em < ? AND di.excluido_em IS NULL
       LIMIT 5000) t`,
    [est, inicio, fim],
  );
}

// ---- Prescrição, enfermagem e prontuário ------------------------------------------------------------------------

export interface PrescricaoRecente {
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: number;
}

export async function prescricoesRecentes(l: Leitor, est: number, teto: number): Promise<PrescricaoRecente[]> {
  const linhas = await l.consultar<{ id: Num; atendimento: Num; paciente: Num }>(
    `SELECT id, atendimento_id AS atendimento, paciente_id AS paciente FROM prescricao
      WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY prescrito_em DESC, id DESC LIMIT ?`,
    [est, teto],
  );
  return linhas.map((x) => ({ prescricao: n(x.id), atendimento: n(x.atendimento), paciente: n(x.paciente) }));
}

/** As prescrições do atendimento (a lista da tela). */
export async function prescricoesDoAtendimento(l: Leitor, est: number, atendimento: number): Promise<number> {
  return contar(
    l,
    'SELECT COUNT(*) AS n FROM prescricao WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [atendimento, est],
  );
}

/** A prescrição aberta: os itens e os horários de cada item. */
export async function leituraDaPrescricao(l: Leitor, est: number, prescricao: number): Promise<number> {
  const itens = await contar(
    l,
    'SELECT COUNT(*) AS n FROM prescricao_item WHERE prescricao_id = ? AND excluido_em IS NULL',
    [prescricao],
  );
  const horarios = await contar(
    l,
    'SELECT COUNT(*) AS n FROM horario_administracao WHERE prescricao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [prescricao, est],
  );
  return itens + horarios;
}

export interface AncoraHorario {
  readonly horario: number;
  readonly previsto: Date;
  readonly atendimento: number;
}

/** O primeiro horário da prescrição (a janela da beira do leito gira em torno dele). */
export async function ancoraDaPrescricao(l: Leitor, est: number, prescricao: number): Promise<AncoraHorario | null> {
  const r = await l.uma<{ id: Num; previsto: unknown; atendimento: Num }>(
    `SELECT id, previsto_em AS previsto, atendimento_id AS atendimento FROM horario_administracao
      WHERE prescricao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY previsto_em, id LIMIT 1`,
    [prescricao, est],
  );
  if (!r) return null;
  const previsto =
    r.previsto instanceof Date ? r.previsto : new Date(`${String(r.previsto).replace(' ', 'T')}Z`);
  return { horario: n(r.id), previsto, atendimento: n(r.atendimento) };
}

/** A releitura antes de checar: a situação atual do horário. */
export async function situacaoDoHorario(l: Leitor, est: number, horario: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM horario_administracao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [horario, est],
  );
}

/** O histórico do horário (eventos de checagem e aprazamento). */
export async function historicoDoHorario(l: Leitor, horario: number): Promise<number> {
  return contar(
    l,
    'SELECT COUNT(*) AS n FROM (SELECT id FROM horario_administracao_evento WHERE horario_administracao_id = ? LIMIT 50) t',
    [horario],
  );
}

/** Os horários do paciente na janela (o tablet: até 300). */
export async function horariosDoAtendimento(
  l: Leitor,
  est: number,
  atendimento: number,
  inicio: Date,
  fim: Date,
): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM horario_administracao WHERE atendimento_id = ? AND estabelecimento_id = ?
        AND previsto_em >= ? AND previsto_em < ? AND excluido_em IS NULL LIMIT 300) t`,
    [atendimento, est, inicio, fim],
  );
}

/** A linha do tempo do turno: os horários dos internados da unidade do paciente na janela (até 2.000). */
export async function horariosDaUnidadeDoAtendimento(
  l: Leitor,
  est: number,
  atendimento: number,
  inicio: Date,
  fim: Date,
): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT h.id FROM horario_administracao h
        JOIN internacao i ON i.atendimento_id = h.atendimento_id AND i.situacao = 'ativa' AND i.excluido_em IS NULL
       WHERE h.estabelecimento_id = ? AND h.previsto_em >= ? AND h.previsto_em < ? AND h.excluido_em IS NULL
         AND i.unidade_internacao_id = (SELECT i2.unidade_internacao_id FROM internacao i2
                                         WHERE i2.atendimento_id = ? AND i2.excluido_em IS NULL ORDER BY i2.id DESC LIMIT 1)
       LIMIT 2000) t`,
    [est, inicio, fim, atendimento],
  );
}

/** Pacientes com registro assistencial recente no estabelecimento (o alvo do prontuário). */
export async function pacientesComRegistros(l: Leitor, est: number, teto: number): Promise<number[]> {
  return ids(
    l,
    `SELECT paciente_id AS id FROM registro_assistencial WHERE estabelecimento_id = ? AND excluido_em IS NULL
      GROUP BY paciente_id ORDER BY MAX(data_hora_clinica) DESC LIMIT ?`,
    [est, teto],
  );
}

/** A lista dos registros do paciente (até 200, do mais novo). */
export async function registrosDoPaciente(l: Leitor, est: number, paciente: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM (SELECT id FROM registro_assistencial WHERE paciente_id = ? AND estabelecimento_id = ?
        AND excluido_em IS NULL ORDER BY data_hora_clinica DESC LIMIT 200) t`,
    [paciente, est],
  );
}

/** O registro mais novo aberto: as respostas dele (os campos do documento). */
export async function registroMaisNovo(l: Leitor, est: number, paciente: number): Promise<number> {
  const r = await l.uma<{ id: Num }>(
    `SELECT id FROM registro_assistencial WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
      ORDER BY data_hora_clinica DESC, id DESC LIMIT 1`,
    [paciente, est],
  );
  if (!r) return 0;
  return contar(
    l,
    'SELECT COUNT(*) AS n FROM registro_assistencial_resposta WHERE registro_assistencial_id = ? AND excluido_em IS NULL',
    [r.id],
  );
}

/** O cabeçalho do prontuário: alergias ativas e atendimentos do paciente. */
export async function cabecalhoDoPaciente(l: Leitor, est: number, paciente: number): Promise<number> {
  const r = await cargaAbrirFicha(l, est, paciente);
  return r.encontrado ? r.itens - 1 : 0;
}

// ---- Leitos -----------------------------------------------------------------------------------------------------

/** O painel de leitos: os leitos ocupados do estabelecimento (situação que conta como ocupado ou internação ativa). */
export async function leitosOcupados(l: Leitor, est: number): Promise<number> {
  return contar(
    l,
    `SELECT COUNT(*) AS n FROM leito_hospitalar lh LEFT JOIN situacao_leito s ON s.id = lh.situacao_leito_id
      WHERE lh.estabelecimento_id = ? AND lh.ativo = TRUE AND lh.excluido_em IS NULL
        AND (s.conta_como_ocupado = TRUE OR EXISTS (SELECT 1 FROM internacao i WHERE i.leito_hospitalar_id = lh.id
                                                     AND i.situacao = 'ativa' AND i.excluido_em IS NULL))`,
    [est],
  );
}
