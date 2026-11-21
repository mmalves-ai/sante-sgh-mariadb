// Porta da escala de plantão sobre o banco do cliente (MariaDB, pelo @sgh/nucleo; F2.2 lote 03-04). Leituras em
// transação somente leitura, sempre filtradas pelo estabelecimento da sessão e pelos registros não excluídos; as
// gravações de cada ação da tela numa operação própria do Executor (gravacao-por-acao.ts: `pessoas.escala.publicar`,
// `pessoas.troca.decidir`...), com só as tabelas da ação, a trilha, o outbox e a idempotência derivada da requisição
// na mesma transação, e a trava otimista pela coluna `versao`. Tabelas: regime_jornada,
// vigencia_regime_colaborador, vinculo_trabalho, escala, publicacao_escala, plantao, troca_plantao,
// acionamento_sobreaviso, dimensionamento_enfermagem, unidade_internacao, internacao e classificacao_paciente.
// Melhoria: o plantão é do colaborador (que é do cliente inteiro) e o vínculo é o ativo dele no estabelecimento, então
// a conferência na Rede (regra 7) lê os outros estabelecimentos do mesmo cliente pelo colaborador, sem cifra do CPF e
// sem banco "sem resposta"; os instantes ficam em UTC no banco e voltam no fuso do estabelecimento; a publicação e o
// cancelamento da escala ficam em publicacao_escala (número da publicação, motivo, usuário); o motivo do cancelamento
// do acionamento fica na observação; as violações de restrição viram mensagens de negócio (409) antes do banco.
// Melhoria: a cobertura mínima por turno é coluna da escala (cobertura_minima_manha/tarde/noite), gravada na criação e
// na alteração com a versão conferida; a publicação confere o furo contra ela.
// Pendências de modelo (pedidos em docs/obra/fatias/f22/saida/03-04.json): o alerta do conselho, a Rede não conferida, o registro do conselho e a tolerância
// de chegada no plantão, o prazo de chegada e o atendimento do acionamento, os detalhes do cálculo do dimensionamento,
// o tempo parcial, a folga padrão e o acordo do regime, e o histórico de eventos da escala além da publicação. Até o
// DDL, esses valores vão só na trilha da gravação (dados da linha) e voltam na leitura como nulo ou falso.
// O prazo de chegada do acionamento é lido como nulo: o atraso fica "não calculável", sem alerta falso.
// Melhoria: toda escrita passa por tx.incluir/alterar/excluir, linha a linha, com auditoria de coluna e versão (nada de
// UPDATE ou DELETE em massa); as vigências de regime ficam contíguas (a inclusão retroativa termina na véspera da
// seguinte, a anulação reabre a anterior e a mesma data reativa a linha anulada, por causa do UNIQUE).
import {
  type ContextoNucleo,
  erroConflitoVersao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  type AcaoGravacao,
  eventoDaTrilha,
  type ExtrasGravacao,
  gravarPorAcao,
} from './gravacao-por-acao.js';
import type { LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  type ContextoEscala,
  type GravadorEscala,
  type JanelaPlantoes,
  type PlantoesDaRede,
  type PortaEscala,
  soLiberados,
} from './porta-escala.js';
import {
  type DependenciaContada,
  type FiltroPlantaoNoInstante,
  type FiltroRegistrosEscala,
  type FiltroRegistrosTroca,
  type OpcaoDominioEscala,
  type OpcaoTempoParcial,
  type RegistroAcionamento,
  type RegistroDimensionamento,
  type RegistroEscala,
  type RegistroEventoEscala,
  type RegistroPlantao,
  type RegistroPlantaoNoInstante,
  type RegistroRegime,
  type RegistroTroca,
  type RegistroVigencia,
  type RegistroVigenciaHistorico,
  type CamposRegimeJornada,
  type ClassificacaoDoTurno,
  TETO_LEITURA_INSTANTE,
  type UnidadeInternacaoOcupada,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoEscala = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
export const num = (v: unknown): number => Number(v ?? 0);
export const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : texto(v).slice(0, 10);
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');
export const FUSO_PADRAO = 'America/Sao_Paulo';

// ── Instantes: UTC no banco, civil ("AAAA-MM-DDTHH:MM") no fuso do estabelecimento ─────────────────────────────

function partesNoFuso(t: number, fuso: string): Record<string, number> {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const r: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') r[p.type] = Number(p.value);
  return r;
}
function deslocamento(t: number, fuso: string): number {
  const p = partesNoFuso(t, fuso);
  return Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!) - t;
}
/** "AAAA-MM-DDTHH:MM" civil no fuso → instante UTC. */
export function utcDoCivil(civil: string, fuso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(civil);
  if (!m) throw recusa('entrada-invalida', `Instante inválido: use AAAA-MM-DDTHH:MM.`);
  const local = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const t1 = local - deslocamento(local, fuso);
  return new Date(local - deslocamento(t1, fuso));
}
/** Instante do banco (UTC) → "AAAA-MM-DDTHH:MM" no fuso. */
export function civilDoUtc(v: unknown, fuso: string): string {
  if (v === null || v === undefined) return '';
  const t = v instanceof Date ? v.getTime() : Date.parse(`${String(v).replace(' ', 'T').slice(0, 23)}Z`);
  const p = partesNoFuso(t, fuso);
  const d = (x: number | undefined) => String(x ?? 0).padStart(2, '0');
  return `${p['year']}-${d(p['month'])}-${d(p['day'])}T${d(p['hour'])}:${d(p['minute'])}`;
}
export const civilOuNulo = (v: unknown, fuso: string): string | null =>
  v === null || v === undefined ? null : civilDoUtc(v, fuso);

export async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

export function contextoDe(c: ContextoNucleo, rotulo: string): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || rotulo).slice(0, 64),
  };
}

// ── Vocabulário do ramo (sem tabela própria: as opções da tela de regimes) ──────────────────────────────────────

/** Tipo de jornada do regime ↔ tipo_regime do modelo. */
const JORNADAS: readonly (OpcaoDominioEscala & { readonly tipoRegime: string })[] = [
  { codigo: 1, nome: 'Normal', tipoRegime: 'semanal_fixa' },
  { codigo: 2, nome: 'Escalonada', tipoRegime: 'escala_revezamento' },
  { codigo: 3, nome: 'Horista, mensal', tipoRegime: 'outro' },
];
/** Contrato em tempo parcial (tabela oficial do eSocial), com o limite semanal. */
const PARCIAIS: readonly OpcaoTempoParcial[] = [
  { codigo: 0, nome: 'Não é contrato em tempo parcial', limiteSemanalHoras: null },
  { codigo: 1, nome: 'Limitado a 25 horas semanais', limiteSemanalHoras: 25 },
  { codigo: 2, nome: 'Limitado a 30 horas semanais', limiteSemanalHoras: 30 },
  { codigo: 3, nome: 'Limitado a 26 horas semanais', limiteSemanalHoras: 26 },
];
const FOLGAS: readonly OpcaoDominioEscala[] = [
  { codigo: 1, nome: 'Folga, por dias para folga conforme horário padrão' },
  { codigo: 3, nome: 'Folga, por troca de plantão' },
];

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** O vínculo de trabalho do colaborador no estabelecimento: o ativo, ou o mais recente. */
const vinculoDo = (colaborador: string, est: string) => `(SELECT v.id FROM vinculo_trabalho v
   WHERE v.colaborador_id = ${colaborador} AND v.estabelecimento_id = ${est} AND v.excluido_em IS NULL
   ORDER BY (v.situacao IN ('ativo','afastado')) DESC, v.data_admissao DESC, v.id DESC LIMIT 1)`;

const SQL_REGIME = `SELECT r.id, r.codigo, r.descricao, r.tipo_regime, r.jornada_diaria_minutos, r.carga_semanal_minutos,
  r.interjornada_minima_minutos, r.ativo, r.versao FROM regime_jornada r`;

const SQL_ESCALA = `SELECT e.id, e.setor_funcional_id, s.nome AS setor, e.competencia, e.tipo, e.situacao, e.publicada_em,
  e.cobertura_minima_manha, e.cobertura_minima_tarde, e.cobertura_minima_noite,
  up.login AS publicada_por, e.motivo_cancelamento, e.alterado_em, ua.login AS alterado_por_login, e.versao,
  (SELECT COUNT(*) FROM plantao p WHERE p.escala_id = e.id AND p.situacao = 'previsto' AND p.excluido_em IS NULL) AS plantoes,
  (SELECT pe.motivo FROM publicacao_escala pe WHERE pe.escala_id = e.id AND pe.acao = 'publicacao'
    ORDER BY pe.numero_publicacao DESC LIMIT 1) AS justificativa_furo
  FROM escala e JOIN setor_funcional s ON s.id = e.setor_funcional_id
  LEFT JOIN usuario up ON up.id = e.publicada_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = e.alterado_por
  WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL`;

const SQL_PLANTAO = `SELECT p.id, p.escala_id, p.colaborador_id, p.profissional_id, p.tipo, p.inicio_em, p.fim_em, p.situacao,
  p.justificativa, p.motivo_cancelamento, p.versao, ${vinculoDo('p.colaborador_id', 'p.estabelecimento_id')} AS vinculo
  FROM plantao p WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.escala_id IS NOT NULL`;

const SQL_TROCA = `SELECT t.*, p.versao AS versao_plantao, pc.versao AS versao_colega, uc.login AS pedido_por,
  ua.login AS alterado_por_login, ud.login AS decisor, ur.login AS colega_login,
  ${vinculoDo('t.solicitante_colaborador_id', 't.estabelecimento_id')} AS vinculo,
  ${vinculoDo('t.colega_colaborador_id', 't.estabelecimento_id')} AS vinculo_colega
  FROM troca_plantao t JOIN plantao p ON p.id = t.plantao_id
  LEFT JOIN plantao pc ON pc.id = t.colega_plantao_id
  LEFT JOIN usuario uc ON uc.id = t.criado_por
  LEFT JOIN usuario ua ON ua.id = t.alterado_por
  LEFT JOIN usuario ud ON ud.id = t.decisor_usuario_id
  LEFT JOIN colaborador cc ON cc.id = t.colega_colaborador_id
  LEFT JOIN usuario ur ON ur.id = cc.usuario_id
  WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

const SQL_ACIONAMENTO = `SELECT a.id, a.plantao_id, a.situacao, a.chamado_em, a.motivo, a.chegada_em, a.observacao, a.versao,
  u.login AS acionado_por, ua.login AS alterado_por_login
  FROM acionamento_sobreaviso a JOIN plantao p ON p.id = a.plantao_id
  LEFT JOIN usuario u ON u.id = a.acionado_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = a.alterado_por
  WHERE p.estabelecimento_id = ? AND a.excluido_em IS NULL`;

const SQL_VIGENCIA = `SELECT g.id, g.colaborador_id, g.regime_jornada_id, g.vigencia_inicio, g.operacao, g.motivo, g.ocorrido_em,
  g.alterado_em, uc.login AS por, ua.login AS alterado_por_login
  FROM vigencia_regime_colaborador g
  LEFT JOIN usuario uc ON uc.id = g.usuario_id
  LEFT JOIN usuario ua ON ua.id = g.alterado_por`;

/** Situação do acionamento no modelo ↔ estado da tela. */
const ESTADO_ACIONAMENTO: Readonly<Record<string, string>> = {
  acionado: 'acionado',
  compareceu: 'chegou',
  nao_compareceu: 'nao_compareceu',
  cancelado: 'cancelado',
};

/** Uma operação do Executor por ação da tela (evento auditável), com só as tabelas que a ação grava. */
export const ACOES_ESCALA: Readonly<Record<string, AcaoGravacao>> = {
  'pessoas.regime.gravado': { nome: 'pessoas.regime.gravar', tabelas: ['regime_jornada'] },
  'pessoas.regime.atribuido': { nome: 'pessoas.regime.atribuir', tabelas: ['vigencia_regime_colaborador'] },
  'pessoas.regime.vigencia_anulada': {
    nome: 'pessoas.regime.anular_vigencia',
    tabelas: ['vigencia_regime_colaborador'],
  },
  'pessoas.escala.criada': { nome: 'pessoas.escala.criar', tabelas: ['escala'] },
  'pessoas.escala.publicada': { nome: 'pessoas.escala.publicar', tabelas: ['escala', 'publicacao_escala'] },
  'pessoas.escala.cancelada': {
    nome: 'pessoas.escala.cancelar',
    tabelas: ['escala', 'plantao', 'publicacao_escala'],
  },
  'pessoas.escala.excluida': { nome: 'pessoas.escala.excluir', tabelas: ['escala', 'plantao'] },
  'pessoas.plantao.gravado': { nome: 'pessoas.plantao.gravar', tabelas: ['plantao', 'escala'] },
  'pessoas.troca.pedida': { nome: 'pessoas.troca.pedir', tabelas: ['troca_plantao'] },
  'pessoas.troca.respondida': { nome: 'pessoas.troca.responder', tabelas: ['troca_plantao'] },
  'pessoas.troca.decidida': {
    nome: 'pessoas.troca.decidir',
    tabelas: ['troca_plantao', 'plantao', 'escala'],
  },
  'pessoas.sobreaviso.acionado': { nome: 'pessoas.sobreaviso.acionar', tabelas: ['acionamento_sobreaviso'] },
  'pessoas.dimensionamento.calculado': {
    nome: 'pessoas.dimensionamento.calcular',
    tabelas: ['dimensionamento_enfermagem'],
  },
};

/** A cobertura mínima por turno nas colunas da escala. */
const colunasCobertura = (c: { readonly manha: number; readonly tarde: number; readonly noite: number }) => ({
  cobertura_minima_manha: c.manha,
  cobertura_minima_tarde: c.tarde,
  cobertura_minima_noite: c.noite,
});

// ── Mapeamentos ─────────────────────────────────────────────────────────────────────────────────────────────

function regimeDe(r: Linha): RegistroRegime {
  const tipo = texto(r['tipo_regime']);
  const limite = Math.round(num(r['carga_semanal_minutos']) / 60);
  const parcial =
    tipo === 'tempo_parcial' ? (PARCIAIS.find((x) => x.limiteSemanalHoras === limite)?.codigo ?? 0) : 0;
  return {
    id: num(r['id']),
    codigo: texto(r['codigo']),
    nome: texto(r['descricao']),
    jornada: JORNADAS.find((j) => j.tipoRegime === tipo)?.codigo ?? 1,
    contratoParcial: parcial,
    folgaPadrao: null,
    minutosPlantao: num(r['jornada_diaria_minutos']),
    descansoMinimoMin: num(r['interjornada_minima_minutos']),
    limiteSemanalHoras: limite,
    acordo: null,
    ativo: r['ativo'] === true || r['ativo'] === 1 || r['ativo'] === '1',
    versao: num(r['versao']),
  };
}

function colunasDoRegime(r: CamposRegimeJornada): Record<string, unknown> {
  if (!(r.limiteSemanalHoras > 0 && r.limiteSemanalHoras <= 72))
    throw recusa('entrada-invalida', 'O limite semanal do regime fica entre 1 e 72 horas.');
  return {
    codigo: r.codigo,
    descricao: r.nome,
    tipo_regime:
      r.contratoParcial > 0
        ? 'tempo_parcial'
        : (JORNADAS.find((j) => j.codigo === r.jornada)?.tipoRegime ?? 'outro'),
    jornada_diaria_minutos: r.minutosPlantao,
    carga_semanal_minutos: Math.round(r.limiteSemanalHoras * 60),
    interjornada_minima_minutos: r.descansoMinimoMin,
    ativo: r.ativo,
  };
}

function escalaDe(r: Linha, fuso: string): RegistroEscala {
  const situacao = texto(r['situacao']);
  const cancelada = situacao === 'cancelada';
  return {
    id: num(r['id']),
    unidade: num(r['setor_funcional_id']),
    setor: texto(r['setor']),
    competencia: dataIso(r['competencia']).slice(0, 7),
    tipo: texto(r['tipo']),
    estado: situacao,
    cobertura: {
      manha: num(r['cobertura_minima_manha']),
      tarde: num(r['cobertura_minima_tarde']),
      noite: num(r['cobertura_minima_noite']),
    },
    justificativaFuro: textoOuNulo(r['justificativa_furo']),
    publicadaEm: civilOuNulo(r['publicada_em'], fuso),
    publicadaPor: textoOuNulo(r['publicada_por']),
    canceladaEm: cancelada ? civilOuNulo(r['alterado_em'], fuso) : null,
    canceladaPor: cancelada ? textoOuNulo(r['alterado_por_login']) : null,
    motivoCancelamento: textoOuNulo(r['motivo_cancelamento']),
    versao: num(r['versao']),
    plantoes: num(r['plantoes']),
  };
}

function plantaoDe(r: Linha, fuso: string): RegistroPlantao {
  const situacao = texto(r['situacao']);
  return {
    id: num(r['id']),
    escala: num(r['escala_id']),
    vinculo: num(r['vinculo']),
    pessoa: num(r['colaborador_id']),
    profissional: numOuNulo(r['profissional_id']),
    registro: null,
    tipo: texto(r['tipo']),
    inicio: civilDoUtc(r['inicio_em'], fuso),
    fim: civilDoUtc(r['fim_em'], fuso),
    chegadaMin: null,
    situacao,
    alertaConselho: null,
    redeNaoConferida: false,
    motivo: textoOuNulo(situacao === 'cancelado' ? r['motivo_cancelamento'] : r['justificativa']),
    versao: num(r['versao']),
  };
}

function trocaDe(r: Linha, fuso: string): RegistroTroca {
  const estado = texto(r['situacao']);
  const cancelada = estado === 'cancelada';
  return {
    id: num(r['id']),
    tipo: texto(r['tipo']),
    estado,
    plantao: num(r['plantao_id']),
    versaoPlantao: num(r['versao_plantao']),
    vinculo: num(r['vinculo']),
    vinculoColega: num(r['vinculo_colega']),
    plantaoColega: numOuNulo(r['colega_plantao_id']),
    versaoColega: numOuNulo(r['versao_colega']),
    motivo: texto(r['motivo']),
    pedidoPor: texto(r['pedido_por']),
    pedidoEm: civilDoUtc(r['solicitado_em'], fuso),
    respostaPor: r['respondido_em'] ? textoOuNulo(r['colega_login']) : null,
    respostaEm: civilOuNulo(r['respondido_em'], fuso),
    confirmacao: estado === 'recusada' ? textoOuNulo(r['motivo_recusa']) : null,
    decisaoPor: cancelada ? textoOuNulo(r['alterado_por_login']) : textoOuNulo(r['decisor']),
    decisaoEm: civilOuNulo(cancelada ? r['cancelado_em'] : r['decidido_em'], fuso),
    motivoDecisao: textoOuNulo(cancelada ? r['motivo_cancelamento'] : r['motivo_decisao']),
    versao: num(r['versao']),
  };
}

function acionamentoDe(r: Linha, fuso: string): RegistroAcionamento {
  const situacao = ESTADO_ACIONAMENTO[texto(r['situacao'])] ?? texto(r['situacao']);
  const encerrado = situacao !== 'acionado';
  return {
    id: num(r['id']),
    plantao: num(r['plantao_id']),
    situacao,
    acionadoEm: civilDoUtc(r['chamado_em'], fuso),
    acionadoPor: texto(r['acionado_por']),
    motivo: texto(r['motivo']),
    // Pendência de modelo: o atendimento e o prazo de chegada do acionamento (pedido 03-04). Sem o prazo, o atraso
    // não é calculável: nulo, nunca o horário do chamado (que marcaria toda chegada como atrasada).
    atendimento: null,
    prazoChegada: null,
    chegouEm: civilOuNulo(r['chegada_em'], fuso),
    encerradoPor: encerrado ? textoOuNulo(r['alterado_por_login']) : null,
    motivoCancelamento: situacao === 'cancelado' ? textoOuNulo(r['observacao']) : null,
    versao: num(r['versao']),
  };
}

function historicoDe(r: Linha, vinculo: number, fuso: string): RegistroVigenciaHistorico {
  const anulada = texto(r['operacao']) === 'exclusao';
  return {
    id: num(r['id']),
    vinculo,
    regime: num(r['regime_jornada_id']),
    desde: dataIso(r['vigencia_inicio']),
    por: texto(r['por']),
    em: civilDoUtc(r['ocorrido_em'], fuso),
    anulada: anulada
      ? {
          por: texto(r['alterado_por_login']),
          em: civilDoUtc(r['alterado_em'] ?? r['ocorrido_em'], fuso),
          motivo: texto(r['motivo']),
        }
      : null,
  };
}

function dimensionamentoDe(r: Linha, fuso: string): RegistroDimensionamento {
  return {
    id: num(r['id']),
    unidade: num(r['setor_funcional_id']),
    setor: texto(r['setor']),
    data: dataIso(r['data_referencia']),
    turno: texto(r['turno']),
    fonte: texto(r['fonte']),
    unidadeInternacao: textoOuNulo(r['unidade_codigo']),
    pacientes: {
      minimos: num(r['pacientes_cuidado_minimo']),
      intermediarios: num(r['pacientes_cuidado_intermediario']),
      altaDependencia: num(r['pacientes_alta_dependencia']),
      semiIntensivos: num(r['pacientes_semi_intensivo']),
      intensivos: num(r['pacientes_intensivo']),
    },
    // Pendência de modelo: as parcelas do cálculo (NAS, KM, não classificados, categoria prevalente, cobertura sugerida).
    nasSoma: 0,
    nasPacientes: 0,
    naoClassificados: null,
    jornadaSemanalHoras: num(r['jornada_semanal_horas']),
    ist: num(r['indice_seguranca_tecnica']),
    totalHoras: num(r['total_horas_enfermagem']),
    km: 0,
    quantitativo: num(r['quantidade_profissionais_calculada']),
    totalProfissionais: num(r['quantidade_profissionais_calculada']),
    enfermeiros: num(r['quantidade_enfermeiros']),
    tecnicos: num(r['quantidade_tecnicos']),
    percentualEnfermeiros: num(r['percentual_enfermeiros']),
    categoriaPrevalente: null,
    coberturaSugerida: 0,
    parcelas: [],
    calculadoPor: texto(r['calculado_por']),
    calculadoEm: civilDoUtc(r['criado_em'], fuso),
  };
}

// ── Leituras comuns (no leitor da consulta ou na transação da gravação) ────────────────────────────────────────

const leitura = {
  async escala(l: Leitor, est: number, fuso: string, id: number) {
    const r = await l.uma(`${SQL_ESCALA} AND e.id = ?`, [est, id]);
    return r ? escalaDe(r, fuso) : null;
  },
  async plantao(l: Leitor, est: number, fuso: string, id: number) {
    const r = await l.uma(`${SQL_PLANTAO} AND p.id = ?`, [est, id]);
    return r ? plantaoDe(r, fuso) : null;
  },
  async plantoesDaEscala(l: Leitor, est: number, fuso: string, escala: number) {
    return (await l.consultar(`${SQL_PLANTAO} AND p.escala_id = ? ORDER BY p.id`, [est, escala])).map((r) =>
      plantaoDe(r, fuso),
    );
  },
  async plantoesDaPessoa(l: Leitor, est: number, fuso: string, pessoa: number, j: JanelaPlantoes) {
    return (
      await l.consultar(
        `${SQL_PLANTAO} AND p.colaborador_id = ? AND p.situacao = 'previsto'
           AND p.inicio_em >= ? AND p.inicio_em < ? AND p.fim_em > ? ORDER BY p.inicio_em, p.id`,
        [est, pessoa, utcDoCivil(j.inicioDesde, fuso), utcDoCivil(j.ate, fuso), utcDoCivil(j.de, fuso)],
      )
    ).map((r) => plantaoDe(r, fuso));
  },
  async regime(l: Leitor, id: number) {
    const r = await l.uma(`${SQL_REGIME} WHERE r.id = ?`, [id]);
    return r ? regimeDe(r) : null;
  },
  async troca(l: Leitor, est: number, fuso: string, id: number) {
    const r = await l.uma(`${SQL_TROCA} AND t.id = ?`, [est, id]);
    return r ? trocaDe(r, fuso) : null;
  },
  async emTrocaAberta(l: Leitor, est: number, ids: readonly number[]) {
    if (ids.length === 0) return new Set<number>();
    const r = await l.consultar(
      `SELECT t.plantao_id, t.colega_plantao_id FROM troca_plantao t
        WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao IN ('pedida','aceita')
          AND (t.plantao_id IN (${marcas(ids.length)}) OR t.colega_plantao_id IN (${marcas(ids.length)}))`,
      [est, ...ids, ...ids],
    );
    const s = new Set<number>();
    for (const x of r)
      for (const p of [numOuNulo(x['plantao_id']), numOuNulo(x['colega_plantao_id'])])
        if (p !== null && ids.includes(p)) s.add(p);
    return s;
  },
  async acionamento(l: Leitor, est: number, fuso: string, id: number) {
    const r = await l.uma(`${SQL_ACIONAMENTO} AND a.id = ?`, [est, id]);
    return r ? acionamentoDe(r, fuso) : null;
  },
  async acionamentos(l: Leitor, est: number, fuso: string, ids: readonly number[]) {
    if (ids.length === 0) return [];
    return (
      await l.consultar(`${SQL_ACIONAMENTO} AND a.plantao_id IN (${marcas(ids.length)}) ORDER BY a.id DESC`, [
        est,
        ...ids,
      ])
    ).map((r) => acionamentoDe(r, fuso));
  },
  /** O colaborador do vínculo de trabalho do estabelecimento (null: o vínculo não é deste estabelecimento). */
  async colaboradorDoVinculo(l: Leitor, est: number, vinculo: number): Promise<number | null> {
    const r = await l.uma(
      'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [vinculo, est],
    );
    return r ? num(r['colaborador_id']) : null;
  },
  async historico(l: Leitor, est: number, fuso: string, vinculo: number) {
    const col = await leitura.colaboradorDoVinculo(l, est, vinculo);
    if (col === null) return [];
    return (
      await l.consultar(`${SQL_VIGENCIA} WHERE g.colaborador_id = ? ORDER BY g.vigencia_inicio, g.id`, [col])
    ).map((r) => historicoDe(r, vinculo, fuso));
  },
  async dependencias(l: Leitor, est: number, escala: number): Promise<DependenciaContada[]> {
    const r = await l.uma(
      `SELECT
         (SELECT COUNT(*) FROM troca_plantao t JOIN plantao p ON p.id = t.plantao_id
           WHERE p.escala_id = ? AND t.excluido_em IS NULL)
         + (SELECT COUNT(*) FROM troca_plantao t JOIN plantao p ON p.id = t.colega_plantao_id
           WHERE p.escala_id = ? AND t.excluido_em IS NULL) AS trocas,
         (SELECT COUNT(*) FROM acionamento_sobreaviso a JOIN plantao p ON p.id = a.plantao_id
           WHERE p.escala_id = ? AND a.excluido_em IS NULL) AS acionamentos
       FROM escala e WHERE e.id = ? AND e.estabelecimento_id = ?`,
      [escala, escala, escala, escala, est],
    );
    const d: DependenciaContada[] = [];
    if (num(r?.['trocas']) > 0)
      d.push({
        grupo: 'Trocas de plantão',
        tabela: 'troca_plantao',
        coluna: 'plantao_id',
        quantidade: num(r?.['trocas']),
      });
    if (num(r?.['acionamentos']) > 0)
      d.push({
        grupo: 'Acionamentos do sobreaviso',
        tabela: 'acionamento_sobreaviso',
        coluna: 'plantao_id',
        quantidade: num(r?.['acionamentos']),
      });
    return d;
  },
};

// ── Gravador sobre a transação da operação ─────────────────────────────────────────────────────────────────

type Extras = ExtrasGravacao;

/** Véspera de uma data ISO. */
function vespera(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  usuario: number,
  fuso: string,
  x: Extras,
): GravadorEscala {
  const agora = () => new Date();
  const pendente = (alvo: string, id: number, campos: Record<string, unknown>) => {
    const v = Object.fromEntries(
      Object.entries(campos).filter(([, y]) => y !== null && y !== undefined && y !== false),
    );
    if (Object.keys(v).length > 0) x.pendentes.push({ alvo, id, ...v });
  };
  const exigirEscala = async (id: number) => {
    const e = await leitura.escala(tx, est, fuso, id);
    if (!e) throw recusa('escala-inexistente', 'A escala não existe neste estabelecimento.');
    return e;
  };
  const exigirPlantao = async (id: number, versao?: number) => {
    const p = await leitura.plantao(tx, est, fuso, id);
    if (!p) throw recusa('plantao-inexistente', 'O plantão não existe neste estabelecimento.');
    if (versao !== undefined && p.versao !== versao) throw erroConflitoVersao(['versao']);
    return p;
  };
  const exigirColaborador = async (vinculo: number) => {
    const c = await leitura.colaboradorDoVinculo(tx, est, vinculo);
    if (c === null) throw recusa('vinculo-inexistente', 'O vínculo de trabalho não é deste estabelecimento.');
    return c;
  };
  const exigirTroca = async (id: number, versao: number, estados: readonly string[]) => {
    const t = await leitura.troca(tx, est, fuso, id);
    if (!t || t.versao !== versao || !estados.includes(t.estado))
      throw erroConflitoVersao(['versao', 'situacao']);
    return t;
  };
  const exigirAcionamento = async (id: number, versao: number) => {
    const a = await leitura.acionamento(tx, est, fuso, id);
    if (!a || a.versao !== versao || a.situacao !== 'acionado')
      throw erroConflitoVersao(['versao', 'situacao']);
    return a;
  };
  const publicacao = async (escala: number, acao: string, motivo: string | null) => {
    const n = await tx.uma(
      'SELECT COALESCE(MAX(numero_publicacao), 0) + 1 AS n FROM publicacao_escala WHERE escala_id = ?',
      [escala],
    );
    await tx.incluir('publicacao_escala', {
      escala_id: escala,
      operacao: acao === 'cancelamento' ? 'alteracao' : 'inclusao',
      acao,
      numero_publicacao: num(n?.['n']),
      motivo,
      ocorrido_em: agora(),
      usuario_id: usuario,
    });
  };
  return {
    escala: (id) => leitura.escala(tx, est, fuso, id),
    plantao: (id) => leitura.plantao(tx, est, fuso, id),
    plantoesDaEscala: (id) => leitura.plantoesDaEscala(tx, est, fuso, id),
    plantoesDaPessoa: (p, j) => leitura.plantoesDaPessoa(tx, est, fuso, p, j),
    async travarPessoa(pessoa) {
      await tx.consultarParaAtualizar('SELECT id FROM colaborador WHERE id = ?', [pessoa]);
    },
    regime: (id) => leitura.regime(tx, id),
    async incluirRegime(r) {
      if (await tx.uma('SELECT id FROM regime_jornada WHERE codigo = ?', [r.codigo]))
        throw recusa('regime-existente', 'Já existe regime com esta sigla.');
      const id = await tx.incluir('regime_jornada', colunasDoRegime(r));
      pendente('regime_jornada', id, {
        contratoParcial: r.contratoParcial || null,
        folgaPadrao: r.folgaPadrao,
        acordo: r.acordo,
      });
      return id;
    },
    async alterarRegime(r) {
      if (await tx.uma('SELECT id FROM regime_jornada WHERE codigo = ? AND id <> ?', [r.codigo, r.id]))
        throw recusa('regime-existente', 'Já existe regime com esta sigla.');
      await tx.alterar('regime_jornada', r.id, r.versao, colunasDoRegime(r));
      pendente('regime_jornada', r.id, {
        contratoParcial: r.contratoParcial || null,
        folgaPadrao: r.folgaPadrao,
        acordo: r.acordo,
      });
    },
    async atribuirRegime(a) {
      const col = await exigirColaborador(a.vinculo);
      const linhas = await tx.consultarParaAtualizar(
        `SELECT id, vigencia_inicio, vigencia_fim, operacao, versao FROM vigencia_regime_colaborador
          WHERE colaborador_id = ? ORDER BY vigencia_inicio`,
        [col],
      );
      const validas = linhas
        .filter((l) => texto(l['operacao']) !== 'exclusao')
        .map((l) => ({
          id: num(l['id']),
          inicio: dataIso(l['vigencia_inicio']),
          fim: l['vigencia_fim'] === null ? null : dataIso(l['vigencia_fim']),
          versao: num(l['versao']),
        }));
      if (validas.some((v) => v.inicio === a.desde))
        throw recusa('vigencia-repetida', 'O colaborador já tem regime registrado a partir desta data.');
      // A anterior (válida) termina na véspera da nova; a nova termina na véspera da seguinte (inclusão retroativa).
      const anterior = [...validas].reverse().find((v) => v.inicio < a.desde) ?? null;
      const seguinte = validas.find((v) => v.inicio > a.desde) ?? null;
      const fim = seguinte ? vespera(seguinte.inicio) : null;
      if (anterior && (anterior.fim === null || anterior.fim >= a.desde))
        await tx.alterar('vigencia_regime_colaborador', anterior.id, anterior.versao, {
          vigencia_fim: vespera(a.desde),
        });
      // A mesma data de uma vigência anulada: o UNIQUE (colaborador, início) vale também para as anuladas, então a
      // linha anulada é reativada com o regime novo (a trilha guarda a anulação e a reativação).
      const anulada = linhas.find(
        (l) => texto(l['operacao']) === 'exclusao' && dataIso(l['vigencia_inicio']) === a.desde,
      );
      if (anulada) {
        await tx.alterar('vigencia_regime_colaborador', num(anulada['id']), num(anulada['versao']), {
          regime_jornada_id: a.regime,
          vigencia_fim: fim,
          operacao: 'inclusao',
          motivo: null,
          ocorrido_em: agora(),
          usuario_id: usuario,
        });
        return num(anulada['id']);
      }
      return tx.incluir('vigencia_regime_colaborador', {
        colaborador_id: col,
        regime_jornada_id: a.regime,
        vigencia_inicio: a.desde,
        vigencia_fim: fim,
        operacao: 'inclusao',
        ocorrido_em: agora(),
        usuario_id: usuario,
      });
    },
    async incluirEscala(s) {
      const setor = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
        s.unidade,
        est,
      ]);
      if (!setor) throw recusa('setor-inexistente', 'O setor da escala não é deste estabelecimento.');
      const competencia = `${s.competencia}-01`;
      const existe = await tx.uma(
        'SELECT id FROM escala WHERE setor_funcional_id = ? AND competencia = ? AND tipo = ? AND escala_anestesia = FALSE AND excluido_em IS NULL',
        [s.unidade, competencia, s.tipo],
      );
      if (existe)
        throw recusa(
          'escala-existente',
          'Já existe escala deste tipo para a unidade, o setor e a competência.',
        );
      const id = await tx.incluir('escala', {
        estabelecimento_id: est,
        setor_funcional_id: s.unidade,
        competencia,
        periodo_inicio: competencia,
        periodo_fim: ultimoDia(s.competencia),
        tipo: s.tipo,
        situacao: 'rascunho',
        ...colunasCobertura(s.cobertura),
      });
      return id;
    },
    async alterarCobertura(c) {
      const e = await exigirEscala(c.id);
      if (e.versao !== c.versao) throw erroConflitoVersao(['versao']);
      await tx.alterar('escala', c.id, c.versao, colunasCobertura(c.cobertura));
    },
    async tocarEscala(t) {
      // A mudança num plantão sobe a versão da escala (quem a abriu antes relê): tx.alterar auditado, na versão lida.
      const e = await tx.consultarParaAtualizar(
        'SELECT versao, situacao FROM escala WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [t.id, est],
      );
      const l = e[0];
      if (!l || texto(l['situacao']) !== t.estado) throw erroConflitoVersao(['situacao']);
      await tx.alterar('escala', t.id, num(l['versao']), { alterado_em: agora() });
    },
    async publicarEscala(p) {
      const e = await exigirEscala(p.id);
      if (e.estado !== 'rascunho' || e.versao !== p.versao) throw erroConflitoVersao(['versao', 'situacao']);
      await tx.alterar('escala', p.id, p.versao, {
        situacao: 'publicada',
        publicada_em: agora(),
        publicada_por_usuario_id: usuario,
      });
      await publicacao(p.id, 'publicacao', p.justificativaFuro);
    },
    async incluirPlantao(p) {
      const e = await tx.uma(
        'SELECT setor_funcional_id FROM escala WHERE id = ? AND estabelecimento_id = ?',
        [p.escala, est],
      );
      if (!e) throw recusa('escala-inexistente', 'A escala não existe neste estabelecimento.');
      const id = await tx.incluir('plantao', {
        estabelecimento_id: est,
        escala_id: p.escala,
        setor_funcional_id: num(e['setor_funcional_id']),
        colaborador_id: p.pessoa,
        profissional_id: p.profissional,
        tipo: p.tipo,
        inicio_em: utcDoCivil(p.inicio, fuso),
        fim_em: utcDoCivil(p.fim, fuso),
        situacao: 'previsto',
        justificativa: p.motivo,
      });
      pendente('plantao', id, {
        registro: p.registro,
        chegadaMin: p.chegadaMin,
        alertaConselho: p.alertaConselho,
        redeNaoConferida: p.redeNaoConferida,
      });
      return id;
    },
    async alterarPlantao(m) {
      const p = await exigirPlantao(m.id, m.versao);
      if (p.situacao !== 'previsto') throw erroConflitoVersao(['situacao']);
      await tx.alterar('plantao', m.id, m.versao, {
        tipo: m.tipo,
        inicio_em: utcDoCivil(m.inicio, fuso),
        fim_em: utcDoCivil(m.fim, fuso),
        justificativa: m.motivo,
      });
      pendente('plantao', m.id, {
        registro: m.registro,
        chegadaMin: m.chegadaMin,
        alertaConselho: m.alertaConselho,
        redeNaoConferida: m.redeNaoConferida,
      });
    },
    async cancelarPlantao(c) {
      const p = await exigirPlantao(c.id, c.versao);
      if (p.situacao !== 'previsto') throw erroConflitoVersao(['situacao']);
      await tx.alterar('plantao', c.id, c.versao, {
        situacao: 'cancelado',
        motivo_cancelamento: c.motivo ?? 'Cancelado na escala',
      });
    },
    async evento(ev) {
      x.pendentes.push({
        alvo: 'evento_escala',
        escala: ev.escala,
        plantao: ev.plantao,
        acao: ev.acao,
        descricao: ev.descricao,
        motivo: ev.motivo,
      });
      return 0;
    },
    async outbox(ev) {
      x.eventos.push({ tipo: ev.tipo, carga: { ...ev.carga, chaveNegocio: ev.chave } });
      return ev.chave;
    },
    troca: (id) => leitura.troca(tx, est, fuso, id),
    plantoesEmTrocaAberta: (ids) => leitura.emTrocaAberta(tx, est, ids),
    async incluirTroca(t) {
      const p = await exigirPlantao(t.plantao, t.versaoPlantao);
      if (t.plantaoColega !== null) await exigirPlantao(t.plantaoColega, t.versaoColega ?? undefined);
      const abertas = await leitura.emTrocaAberta(
        tx,
        est,
        t.plantaoColega === null ? [p.id] : [p.id, t.plantaoColega],
      );
      if (abertas.size > 0) throw recusa('troca-aberta', 'O plantão já está em uma troca aberta.');
      return tx.incluir('troca_plantao', {
        estabelecimento_id: est,
        tipo: t.tipo,
        plantao_id: t.plantao,
        solicitante_colaborador_id: await exigirColaborador(t.vinculo),
        colega_colaborador_id: await exigirColaborador(t.vinculoColega),
        colega_plantao_id: t.plantaoColega,
        motivo: t.motivo,
        situacao: 'pedida',
        solicitado_em: agora(),
      });
    },
    async responderTroca(r) {
      await exigirTroca(r.id, r.versao, ['pedida']);
      await tx.alterar('troca_plantao', r.id, r.versao, {
        situacao: r.estado,
        respondido_em: agora(),
        motivo_recusa: r.estado === 'recusada' ? r.confirmacao : null,
      });
      if (r.estado === 'aceita' && r.confirmacao) x.dados['confirmacao'] = r.confirmacao;
    },
    async decidirTroca(d) {
      await exigirTroca(d.id, d.versao, ['aceita']);
      await tx.alterar('troca_plantao', d.id, d.versao, {
        situacao: d.estado,
        decidido_em: agora(),
        decisor_usuario_id: usuario,
        motivo_decisao: d.motivo,
      });
    },
    async cancelarTroca(c) {
      await exigirTroca(c.id, c.versao, ['pedida', 'aceita']);
      await tx.alterar('troca_plantao', c.id, c.versao, {
        situacao: 'cancelada',
        cancelado_em: agora(),
        motivo_cancelamento: c.motivo,
      });
    },
    async transferirPlantao(t) {
      const p = await exigirPlantao(t.id, t.versao);
      if (p.situacao !== 'previsto') throw erroConflitoVersao(['situacao']);
      await tx.alterar('plantao', t.id, t.versao, {
        colaborador_id: t.pessoa,
        profissional_id: t.profissional,
        justificativa: t.motivo,
      });
      pendente('plantao', t.id, {
        registro: t.registro,
        alertaConselho: t.alertaConselho,
        redeNaoConferida: t.redeNaoConferida,
      });
    },
    acionamento: (id) => leitura.acionamento(tx, est, fuso, id),
    acionamentosDosPlantoes: (ids) => leitura.acionamentos(tx, est, fuso, ids),
    async incluirAcionamento(a) {
      const p = await tx.uma(
        'SELECT colaborador_id, setor_funcional_id FROM plantao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [a.plantao, est],
      );
      if (!p || p['colaborador_id'] === null)
        throw recusa('plantao-inexistente', 'O plantão de sobreaviso não existe neste estabelecimento.');
      const s = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM acionamento_sobreaviso WHERE plantao_id = ?',
        [a.plantao],
      );
      const id = await tx.incluir('acionamento_sobreaviso', {
        plantao_id: a.plantao,
        sequencia: num(s?.['n']),
        colaborador_id: num(p['colaborador_id']),
        acionado_por_usuario_id: usuario,
        chamado_em: utcDoCivil(a.acionadoEm, fuso),
        motivo: a.motivo,
        setor_funcional_id: num(p['setor_funcional_id']),
        situacao: 'acionado',
      });
      pendente('acionamento_sobreaviso', id, { prazoChegada: a.prazoChegada, atendimento: a.atendimento });
      return id;
    },
    async registrarChegada(c) {
      await exigirAcionamento(c.id, c.versao);
      await tx.alterar('acionamento_sobreaviso', c.id, c.versao, {
        situacao: 'compareceu',
        chegada_em: utcDoCivil(c.chegouEm, fuso),
      });
    },
    async cancelarAcionamento(c) {
      await exigirAcionamento(c.id, c.versao);
      await tx.alterar('acionamento_sobreaviso', c.id, c.versao, {
        situacao: 'cancelado',
        observacao: c.motivo,
      });
    },
    async incluirDimensionamento(d) {
      const ui = d.unidadeInternacao
        ? await tx.uma('SELECT id FROM unidade_internacao WHERE codigo = ? AND estabelecimento_id = ?', [
            d.unidadeInternacao,
            est,
          ])
        : null;
      const id = await tx.incluir('dimensionamento_enfermagem', {
        estabelecimento_id: est,
        setor_funcional_id: d.unidade,
        unidade_internacao_id: ui ? num(ui['id']) : null,
        data_referencia: d.data,
        turno: d.turno,
        fonte: d.fonte,
        jornada_semanal_horas: d.jornadaSemanalHoras,
        indice_seguranca_tecnica: d.ist > 1 ? d.ist / 100 : d.ist,
        pacientes_cuidado_minimo: d.pacientes.minimos,
        pacientes_cuidado_intermediario: d.pacientes.intermediarios,
        pacientes_alta_dependencia: d.pacientes.altaDependencia,
        pacientes_semi_intensivo: d.pacientes.semiIntensivos,
        pacientes_intensivo: d.pacientes.intensivos,
        total_horas_enfermagem: d.totalHoras,
        quantidade_profissionais_calculada: d.quantitativo,
        percentual_enfermeiros: d.percentualEnfermeiros,
        quantidade_enfermeiros: d.enfermeiros,
        quantidade_tecnicos: d.tecnicos,
        situacao: 'calculado',
      });
      pendente('dimensionamento_enfermagem', id, {
        nasSoma: d.nasSoma,
        nasPacientes: d.nasPacientes,
        naoClassificados: d.naoClassificados,
        km: d.km,
        categoriaPrevalente: d.categoriaPrevalente,
        coberturaSugerida: d.coberturaSugerida,
        parcelas: d.parcelas.length > 0 ? d.parcelas : null,
      });
      return id;
    },
    dependenciasEscala: (id) => leitura.dependencias(tx, est, id),
    async excluirEscalaRascunho(e) {
      const atual = await exigirEscala(e.id);
      if (atual.estado !== 'rascunho' || atual.versao !== e.versao)
        throw erroConflitoVersao(['versao', 'situacao']);
      const deps = await leitura.dependencias(tx, est, e.id);
      if (deps.length > 0)
        throw recusa(
          'escala-com-vinculos',
          `A escala tem registros ligados e não pode ser excluída (${deps.map((d) => `${d.grupo}: ${d.quantidade}`).join('; ')}).`,
        );
      const plantoes = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM plantao WHERE escala_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.id, est],
      );
      x.dados['retrato'] = { escala: e.id, plantoes: plantoes.map((p) => num(p['id'])), motivo: e.motivo };
      // Cada plantão do rascunho sai pela exclusão auditada (linha, versão e retrato), um a um.
      for (const p of plantoes) await tx.excluir('plantao', num(p['id']), num(p['versao']));
      await tx.excluir('escala', e.id, e.versao);
      return { retratos: 1 + plantoes.length, plantoes: plantoes.length };
    },
    async cancelarEscala(c) {
      const atual = await exigirEscala(c.id);
      if (atual.estado !== 'publicada' || atual.versao !== c.versao)
        throw erroConflitoVersao(['versao', 'situacao']);
      await tx.alterar('escala', c.id, c.versao, { situacao: 'cancelada', motivo_cancelamento: c.motivo });
      // Cada plantão previsto é cancelado pela alteração auditada (coluna e versão), um a um.
      const previstos = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM plantao
          WHERE escala_id = ? AND estabelecimento_id = ? AND situacao = 'previsto' AND excluido_em IS NULL`,
        [c.id, est],
      );
      for (const p of previstos)
        await tx.alterar('plantao', num(p['id']), num(p['versao']), {
          situacao: 'cancelado',
          motivo_cancelamento: c.motivo,
        });
      await publicacao(c.id, 'cancelamento', c.motivo);
      return previstos.length;
    },
    historicoVigencias: (v) => leitura.historico(tx, est, fuso, v),
    async anularVigencia(a) {
      const g = await tx.uma(
        `SELECT g.versao, g.colaborador_id, g.vigencia_inicio, g.vigencia_fim FROM vigencia_regime_colaborador g
           JOIN vinculo_trabalho v ON v.colaborador_id = g.colaborador_id
          WHERE g.id = ? AND v.estabelecimento_id = ? AND g.operacao <> 'exclusao' LIMIT 1`,
        [a.id, est],
      );
      if (!g) throw erroConflitoVersao(['operacao']);
      // O regime volta a ser o da vigência anterior: ela é reaberta até o fim da anulada (sem buraco no período).
      const anterior = (
        await tx.consultarParaAtualizar(
          `SELECT id, versao FROM vigencia_regime_colaborador
            WHERE colaborador_id = ? AND vigencia_inicio < ? AND operacao <> 'exclusao'
            ORDER BY vigencia_inicio DESC LIMIT 1`,
          [num(g['colaborador_id']), dataIso(g['vigencia_inicio'])],
        )
      )[0];
      await tx.alterar('vigencia_regime_colaborador', a.id, num(g['versao']), {
        operacao: 'exclusao',
        motivo: a.motivo,
      });
      if (anterior)
        await tx.alterar('vigencia_regime_colaborador', num(anterior['id']), num(anterior['versao']), {
          vigencia_fim: g['vigencia_fim'] === null ? null : dataIso(g['vigencia_fim']),
        });
    },
    // O ponto do vínculo é lido pela porta do ponto (a escala não o duplica).
    eventosPeriodo: async () => null,
  };
}

function ultimoDia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a!, m!, 0));
  return d.toISOString().slice(0, 10);
}

export class PortaEscalaPropria implements PortaEscala {
  readonly destino = 'banco' as const;
  /** A cobertura mínima por turno fica nas colunas da escala: a publicação confere o furo. */
  readonly coberturaRegistrada = true;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEscala,
    private readonly opcoes: { readonly liberados?: ReadonlySet<string> | null } = {},
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoEscala, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c, 'pessoas-escala'), async (l) =>
      fn(l, est, await fusoDe(l, est)),
    );
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────────────────

  /** A escala não tem operação de tela pelo Executor genérico: grava pelas ações da própria tela (gravarSgh). */
  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'A escala grava pelas ações da própria tela.');
  }

  async gravarSgh<T>(
    c: ContextoEscala,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorEscala) => Promise<T>,
  ): Promise<T> {
    const evento = eventoDaTrilha(trilha);
    const acao = evento !== null ? ACOES_ESCALA[evento] : undefined;
    if (!acao)
      throw new ErroOperacao(
        500,
        'acao-desconhecida',
        'Ação sem operação',
        `A ação ${evento ?? '(sem evento)'} da escala não tem operação declarada.`,
      );
    return gravarPorAcao(this.executor, c, 'pessoas-escala', acao, trilha, (tx, est, usuario, fuso, x) =>
      fn(gravadorSobre(tx, est, usuario, fuso, x)),
    );
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────

  async tiposJornada(): Promise<OpcaoDominioEscala[]> {
    return JORNADAS.map(({ codigo, nome }) => ({ codigo, nome }));
  }
  async temposParciais(): Promise<OpcaoTempoParcial[]> {
    return [...PARCIAIS];
  }
  async tiposTrabalhoFolga(): Promise<OpcaoDominioEscala[]> {
    return [...FOLGAS];
  }
  /** Regimes de jornada: cadastro do cliente inteiro (a tabela não tem estabelecimento). */
  regimes(c: ContextoEscala): Promise<RegistroRegime[]> {
    return this.ler(c, async (l) =>
      (await l.consultar(`${SQL_REGIME} ORDER BY r.codigo, r.id`)).map(regimeDe),
    );
  }
  regime(c: ContextoEscala, id: number): Promise<RegistroRegime | null> {
    return this.ler(c, (l) => leitura.regime(l, id));
  }
  vigencias(c: ContextoEscala, vinculos: readonly number[]): Promise<RegistroVigencia[]> {
    if (vinculos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT v.id AS vinculo, g.regime_jornada_id, g.vigencia_inicio, u.login AS por
           FROM vinculo_trabalho v JOIN vigencia_regime_colaborador g ON g.colaborador_id = v.colaborador_id
           LEFT JOIN usuario u ON u.id = g.usuario_id
          WHERE v.id IN (${marcas(vinculos.length)}) AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            AND g.operacao <> 'exclusao'
          ORDER BY v.id, g.vigencia_inicio`,
        [...vinculos, est],
      );
      return r.map((x) => ({
        vinculo: num(x['vinculo']),
        regime: num(x['regime_jornada_id']),
        desde: dataIso(x['vigencia_inicio']),
        por: texto(x['por']),
      }));
    });
  }
  escalas(c: ContextoEscala, f: FiltroRegistrosEscala): Promise<RegistroEscala[]> {
    return this.ler(c, async (l, est, fuso) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      if (f.competencia) {
        cond.push('e.competencia = ?');
        p.push(`${f.competencia}-01`);
      }
      if (f.unidade !== undefined) {
        cond.push('e.setor_funcional_id = ?');
        p.push(f.unidade);
      }
      if (f.tipo) {
        cond.push('e.tipo = ?');
        p.push(f.tipo);
      }
      if (f.estado) {
        cond.push('e.situacao = ?');
        p.push(f.estado);
      }
      const sql = `${SQL_ESCALA}${cond.map((x) => ` AND ${x}`).join('')} ORDER BY e.competencia DESC, e.id DESC LIMIT 200`;
      return (await l.consultar(sql, p)).map((r) => escalaDe(r, fuso));
    });
  }
  escala(c: ContextoEscala, id: number) {
    return this.ler(c, (l, est, fuso) => leitura.escala(l, est, fuso, id));
  }
  plantoesDaEscala(c: ContextoEscala, escala: number) {
    return this.ler(c, (l, est, fuso) => leitura.plantoesDaEscala(l, est, fuso, escala));
  }
  plantoesDaPessoa(c: ContextoEscala, pessoa: number, j: JanelaPlantoes) {
    return this.ler(c, (l, est, fuso) => leitura.plantoesDaPessoa(l, est, fuso, pessoa, j));
  }
  /** O histórico da escala: as publicações e o cancelamento (os demais eventos ficam na trilha; pedido 03-04). */
  eventos(c: ContextoEscala, escala: number): Promise<RegistroEventoEscala[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT pe.id, pe.acao, pe.numero_publicacao, pe.motivo, pe.ocorrido_em, u.login AS por
             FROM publicacao_escala pe JOIN escala e ON e.id = pe.escala_id
             LEFT JOIN usuario u ON u.id = pe.usuario_id
            WHERE pe.escala_id = ? AND e.estabelecimento_id = ? ORDER BY pe.id DESC`,
          [escala, est],
        )
      ).map((r) => ({
        id: num(r['id']),
        plantao: null,
        acao: texto(r['acao']) === 'cancelamento' ? 'cancelada' : 'publicada',
        descricao:
          texto(r['acao']) === 'cancelamento'
            ? 'Escala cancelada'
            : `Publicação ${num(r['numero_publicacao'])}`,
        motivo: textoOuNulo(r['motivo']),
        por: texto(r['por']),
        em: civilDoUtc(r['ocorrido_em'], fuso),
      })),
    );
  }
  /**
   * Regra 7: os plantões do mesmo colaborador nos OUTROS estabelecimentos do cliente (dado da rede inteira: o
   * colaborador é do cliente). Só os estabelecimentos dentro de `liberados` (HS-1) e que `liberado` aceitar entram.
   */
  plantoesNaRede(
    c: ContextoEscala,
    vinculo: number,
    j: JanelaPlantoes,
    liberado?: (estabelecimento: string) => Promise<boolean>,
  ): Promise<PlantoesDaRede> {
    return this.ler(c, async (l, est, fuso) => {
      const col = await leitura.colaboradorDoVinculo(l, est, vinculo);
      if (col === null) return { intervalos: [], semResposta: 0 };
      const r = await l.consultar(
        `SELECT p.inicio_em, p.fim_em, x.codigo FROM plantao p JOIN estabelecimento x ON x.id = p.estabelecimento_id
          WHERE p.colaborador_id = ? AND p.estabelecimento_id <> ? AND p.situacao = 'previsto' AND p.excluido_em IS NULL
            AND p.inicio_em >= ? AND p.inicio_em < ? AND p.fim_em > ?`,
        [col, est, utcDoCivil(j.inicioDesde, fuso), utcDoCivil(j.ate, fuso), utcDoCivil(j.de, fuso)],
      );
      const codigos = [...new Set(r.map((x) => texto(x['codigo'])))].filter(
        (x) => !this.opcoes.liberados || this.opcoes.liberados.has(x),
      );
      const ok = new Set(await soLiberados(codigos, liberado));
      return {
        intervalos: r
          .filter((x) => ok.has(texto(x['codigo'])))
          .map((x) => ({ inicio: civilDoUtc(x['inicio_em'], fuso), fim: civilDoUtc(x['fim_em'], fuso) })),
        semResposta: 0,
      };
    });
  }
  plantao(c: ContextoEscala, id: number) {
    return this.ler(c, (l, est, fuso) => leitura.plantao(l, est, fuso, id));
  }
  trocas(c: ContextoEscala, f: FiltroRegistrosTroca): Promise<RegistroTroca[]> {
    return this.ler(c, async (l, est, fuso) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      if (f.estado) {
        cond.push('t.situacao = ?');
        p.push(f.estado);
      }
      if (f.escala !== undefined) {
        cond.push('(p.escala_id = ? OR pc.escala_id = ?)');
        p.push(f.escala, f.escala);
      }
      if (f.vinculos) {
        if (f.vinculos.length === 0) return [];
        const m = marcas(f.vinculos.length);
        cond.push(
          `(t.solicitante_colaborador_id IN (SELECT colaborador_id FROM vinculo_trabalho WHERE id IN (${m}))
            OR t.colega_colaborador_id IN (SELECT colaborador_id FROM vinculo_trabalho WHERE id IN (${m})))`,
        );
        p.push(...f.vinculos, ...f.vinculos);
      }
      const sql = `${SQL_TROCA}${cond.map((x) => ` AND ${x}`).join('')} ORDER BY t.id DESC LIMIT 200`;
      return (await l.consultar(sql, p)).map((r) => trocaDe(r, fuso));
    });
  }
  troca(c: ContextoEscala, id: number) {
    return this.ler(c, (l, est, fuso) => leitura.troca(l, est, fuso, id));
  }
  plantoesEmTrocaAberta(c: ContextoEscala, ids: readonly number[]) {
    return this.ler(c, (l, est) => leitura.emTrocaAberta(l, est, ids));
  }
  plantoesNoInstante(
    c: ContextoEscala,
    instante: string,
    inicioDesde: string,
    f: FiltroPlantaoNoInstante,
  ): Promise<RegistroPlantaoNoInstante[]> {
    return this.ler(c, async (l, est, fuso) => {
      const cond: string[] = [];
      const t = utcDoCivil(instante, fuso);
      const p: unknown[] = [est, utcDoCivil(inicioDesde, fuso), t, t];
      if (f.unidade !== undefined) {
        cond.push('e.setor_funcional_id = ?');
        p.push(f.unidade);
      }
      if (f.setor) {
        cond.push('UPPER(s.nome) LIKE ?');
        p.push(`%${f.setor.toUpperCase()}%`);
      }
      if (f.tipo) {
        cond.push('p.tipo = ?');
        p.push(f.tipo);
      }
      const r = await l.consultar(
        `SELECT p.id, p.escala_id, e.setor_funcional_id, s.nome AS setor, e.tipo AS tipo_escala, p.colaborador_id,
                col.nome, p.profissional_id, p.tipo, p.inicio_em, p.fim_em, p.situacao,
                ${vinculoDo('p.colaborador_id', 'p.estabelecimento_id')} AS vinculo
           FROM plantao p JOIN escala e ON e.id = p.escala_id JOIN setor_funcional s ON s.id = e.setor_funcional_id
           LEFT JOIN colaborador col ON col.id = p.colaborador_id
          WHERE p.estabelecimento_id = ? AND e.situacao = 'publicada' AND p.situacao = 'previsto'
            AND p.excluido_em IS NULL AND e.excluido_em IS NULL
            AND p.inicio_em >= ? AND p.inicio_em <= ? AND p.fim_em > ?${cond.map((x) => ` AND ${x}`).join('')}
          ORDER BY p.inicio_em, p.id LIMIT ${TETO_LEITURA_INSTANTE}`,
        p,
      );
      return r.map((x) => ({
        id: num(x['id']),
        escala: num(x['escala_id']),
        unidade: num(x['setor_funcional_id']),
        setor: texto(x['setor']),
        tipoEscala: texto(x['tipo_escala']),
        vinculo: num(x['vinculo']),
        nome: texto(x['nome']) || `Vínculo ${num(x['vinculo'])}`,
        profissional: numOuNulo(x['profissional_id']),
        registro: null,
        tipo: texto(x['tipo']),
        inicio: civilDoUtc(x['inicio_em'], fuso),
        fim: civilDoUtc(x['fim_em'], fuso),
        chegadaMin: null,
        situacao: texto(x['situacao']),
      }));
    });
  }
  acionamentos(c: ContextoEscala, ids: readonly number[]) {
    return this.ler(c, (l, est, fuso) => leitura.acionamentos(l, est, fuso, ids));
  }
  acionamento(c: ContextoEscala, id: number) {
    return this.ler(c, (l, est, fuso) => leitura.acionamento(l, est, fuso, id));
  }
  dimensionamentos(c: ContextoEscala, f: { readonly unidade?: number }): Promise<RegistroDimensionamento[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [est];
      if (f.unidade !== undefined) p.push(f.unidade);
      return (
        await l.consultar(
          `SELECT d.*, s.nome AS setor, ui.codigo AS unidade_codigo, u.login AS calculado_por
             FROM dimensionamento_enfermagem d LEFT JOIN setor_funcional s ON s.id = d.setor_funcional_id
             LEFT JOIN unidade_internacao ui ON ui.id = d.unidade_internacao_id
             LEFT JOIN usuario u ON u.id = d.criado_por
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL${f.unidade !== undefined ? ' AND d.setor_funcional_id = ?' : ''}
            ORDER BY d.id DESC LIMIT 100`,
          p,
        )
      ).map((r) => dimensionamentoDe(r, fuso));
    });
  }
  /** As unidades de internação com a contagem de internados (só a contagem; nada do paciente). */
  unidadesInternacao(c: ContextoEscala): Promise<UnidadeInternacaoOcupada[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ui.codigo, ui.descricao,
                  (SELECT COUNT(*) FROM internacao i WHERE i.unidade_internacao_id = ui.id
                     AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL) AS internados
             FROM unidade_internacao ui WHERE ui.estabelecimento_id = ? AND ui.ativo = TRUE
            ORDER BY ui.descricao, ui.id`,
          [est],
        )
      ).map((r) => ({
        unidade: texto(r['codigo']),
        nome: texto(r['descricao']),
        internados: num(r['internados']),
      })),
    );
  }
  classificacoesDoTurno(
    c: ContextoEscala,
    unidadeInternacao: string,
    data: string,
    turno: string,
  ): Promise<ClassificacaoDoTurno[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT cp.paciente_id, cp.instrumento, cp.categoria, cp.total
             FROM classificacao_paciente cp JOIN unidade_internacao ui ON ui.id = cp.unidade_internacao_id
            WHERE cp.estabelecimento_id = ? AND ui.codigo = ? AND cp.data_referencia = ? AND cp.turno = ?
              AND cp.situacao = 'valida' AND cp.excluido_em IS NULL`,
          [est, unidadeInternacao, data, turno],
        )
      ).map((r) => ({
        paciente: num(r['paciente_id']),
        instrumento: texto(r['instrumento']) === 'nas' ? ('nas' as const) : ('fugulin' as const),
        categoria: texto(r['categoria']),
        total: num(r['total']),
      })),
    );
  }
  dependenciasEscala(c: ContextoEscala, escala: number) {
    return this.ler(c, (l, est) => leitura.dependencias(l, est, escala));
  }
  historicoVigencias(c: ContextoEscala, vinculo: number) {
    return this.ler(c, (l, est, fuso) => leitura.historico(l, est, fuso, vinculo));
  }
  vigencia(c: ContextoEscala, id: number): Promise<RegistroVigenciaHistorico | null> {
    return this.ler(c, async (l, est, fuso) => {
      const v = await l.uma(
        `SELECT v.id AS vinculo FROM vigencia_regime_colaborador g
           JOIN vinculo_trabalho v ON v.colaborador_id = g.colaborador_id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
          WHERE g.id = ? ORDER BY (v.situacao IN ('ativo','afastado')) DESC, v.id DESC LIMIT 1`,
        [est, id],
      );
      if (!v) return null;
      return (await leitura.historico(l, est, fuso, num(v['vinculo']))).find((x) => x.id === id) ?? null;
    });
  }
}
