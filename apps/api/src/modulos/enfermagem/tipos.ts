// Tipos de negócio da enfermagem (beira-leito, balanço hídrico, escores e indicadores, contenção, lesão de pele, Time de
// Resposta Rápida, protocolo gerenciado do internado e agência transfusional): o que as portas leem e gravam, sem
// nome de tabela nem de coluna e sem o estabelecimento (que vem do contexto da sessão).
// Melhoria: os registros de gravação não carregam mais o código do estabelecimento (o ContextoNucleo da sessão é a
// única fonte); horas em texto local AAAA-MM-DDTHH:mm[:ss] no fuso do estabelecimento; booleanos e estados nomeados.
// Pendência de contrato (pedido da onda): as situações do horário seguem os códigos de uma letra do contrato
// `SITUACOES_CHECAGEM` das telas (P, A, N, S...); a porta própria traduz das categorias de `situacao_checagem`.
import type {
  FaixaGlicemiaLida,
  FatorRh,
  GrupoAbo,
  RegistrarImunoHematologiaEntrada,
  SentidoBalanco,
  TipagemSanguinea,
  TipoFechamentoBalanco,
} from '@sgh/contratos';

// ── Beira-leito (linha do tempo, checagem, sinais vitais, plantão e aparelhos) ─────────────────────────────────

export interface Internado {
  readonly paciente: number;
  readonly atendimento: number;
  /** Número do prontuário. */
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  /** Código da unidade de internação. */
  readonly unidade: string;
  readonly alergia: boolean;
}

export type TipoHorario =
  | 'medicamento'
  | 'material'
  | 'solucao'
  | 'cuidado'
  | 'glicemia'
  | 'dieta'
  | 'hemoterapia'
  | 'ventilacao'
  | 'outro';

export interface HorarioEnfermagem {
  readonly id: number;
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  /** AAAA-MM-DDTHH:mm:ss (hora local do estabelecimento). */
  readonly previsto: string;
  /** Código da situação no vocabulário do contrato das telas (P, A, N, S...). */
  readonly situacao: string;
  readonly checadoEm: string | null;
  /** Ocupação (id) do profissional que checou. */
  readonly cboChecagem: number | null;
  readonly quantidade: number | null;
  readonly tipo: TipoHorario;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  readonly produto: number | null;
  readonly barras: string | null;
  readonly seNecessario: boolean;
  readonly altaVigilancia: boolean;
  readonly antimicrobiano: boolean;
  readonly duplaMarcada: boolean;
  readonly hemocomponente: boolean;
  readonly infusao: {
    readonly solucao: number;
    readonly velocidadeMlH: number | null;
    readonly ajustavel: boolean;
  } | null;
  readonly faixasGlicemia: readonly FaixaGlicemiaLida[];
  /** A faixa da escala do horário (o horário da faixa ligado ao horário do cuidado da glicemia). */
  readonly faixa: number | null;
  readonly procedimento: number | null;
  readonly aprazamento: number | null;
  readonly numDoses: number | null;
  readonly observacaoMedica: string | null;
}

export interface UnidadeComInternados {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}

export interface VinculoEnfermagem {
  /** Id da ocupação (CBO) do profissional. */
  readonly cbo: number;
  /** Código CBO (6 dígitos). */
  readonly codigo: string;
}

export interface RegraHorario {
  readonly id: number;
  readonly tipoAtendimento: string;
  readonly horarioInicial: string | null;
  readonly considerar: number | null;
  readonly padrao: boolean;
  /** Grade por número de doses (horas "HH:mm" na ordem do cadastro). */
  readonly grade: ReadonlyMap<number, readonly string[]>;
}

export interface AtoChecagem {
  readonly id: number;
  readonly horario: number;
  readonly tipo: 'checagem' | 'estorno';
  readonly situacao: string;
  readonly horaReal: string;
  readonly gravadoEm: string;
  readonly usuario: string;
  readonly quantidade: number | null;
  readonly motivo: string | null;
  readonly observacao: string | null;
  readonly pulseiraLida: boolean;
  readonly motivoSemPulseira: string | null;
  readonly gtin: string | null;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly conferente: string | null;
  readonly dispositivo: string | null;
  readonly origemOffline: boolean;
  readonly avisos: string | null;
}

export interface EventoInfusao {
  readonly id: number;
  readonly horario: number;
  readonly evento: string;
  readonly velocidadeMlH: number | null;
  readonly volumeInfundidoMl: number | null;
  readonly horaReal: string;
  readonly usuario: string;
}

export interface SinalVitalRegistrado {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly horario: number | null;
  readonly tipo: string;
  readonly valor: number;
  readonly unidade: string;
  readonly metodo: string | null;
  readonly foraDaFaixa: boolean;
  readonly horaReal: string;
  readonly versao: number;
  readonly anterior: number | null;
  readonly justificativa: string | null;
  readonly usuario: string;
}

export interface SinalParaRetificar {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly horario: number | null;
  readonly tipo: string;
  readonly unidade: string;
  readonly metodo: string | null;
  readonly horaReal: string;
  readonly versao: number;
  readonly substituido: boolean;
}

/** Sinal vital a gravar (o estabelecimento e o usuário da trilha vêm do contexto). */
export interface SinalVitalNovo {
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly horario: number | null;
  readonly tipo: string;
  readonly valor: number;
  readonly unidade: string;
  readonly metodo: string | null;
  readonly foraDaFaixa: boolean;
  readonly horaReal: string;
  readonly origemOffline: boolean;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface AprazamentoRegistrado {
  readonly horario: number;
  readonly acao: string;
  readonly proposto: string;
  readonly confirmado: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export type TipoConflito = 'suspenso' | 'jaChecado' | 'mudou';

export interface ConflitoSincronizacao {
  readonly id: number;
  readonly horario: number;
  readonly paciente: number;
  readonly chave: string;
  readonly tipo: TipoConflito;
  readonly situacaoEncontrada: string;
  readonly desfechoTentado: string;
  readonly horaReal: string;
  readonly dispositivo: string | null;
  readonly usuario: string;
  readonly registradoEm: string;
  readonly resolucao: string | null;
  readonly resolvidoPor: string | null;
  readonly resolvidoEm: string | null;
  readonly observacao: string | null;
}

export interface PendenciaPlantao {
  readonly tipo: string;
  readonly descricao: string;
  readonly horario: number | null;
}

export interface NotaPlantao {
  readonly atendimento: number;
  readonly paciente: number;
  readonly situacao: string | null;
  readonly historia: string | null;
  readonly avaliacao: string | null;
  readonly recomendacao: string | null;
  readonly pendencias: readonly PendenciaPlantao[];
}

export interface PassagemPlantao {
  readonly id: number;
  readonly unidade: string;
  readonly turno: 'diurno' | 'noturno';
  readonly data: string;
  readonly passadoPor: string;
  readonly recebedor: string;
  readonly situacao: 'aguardandoAceite' | 'aceita' | 'recusada' | 'cancelada';
  readonly passadoEm: string;
  readonly respondidoEm: string | null;
  readonly observacao: string | null;
  /** O cancelamento por quem passou, antes do aceite (a passagem continua legível). */
  readonly cancelamento: { readonly motivo: string; readonly por: string; readonly em: string } | null;
  readonly notas: {
    readonly atendimento: number;
    readonly paciente: number;
    readonly situacao: string | null;
    readonly historia: string | null;
    readonly avaliacao: string | null;
    readonly recomendacao: string | null;
    readonly pendencias: PendenciaPlantao[];
  }[];
}

export type TipoAparelho = 'tablet' | 'coletor' | 'celular';

export interface VersaoAparelho {
  readonly versao: number;
  readonly nome: string;
  readonly unidade: string;
  readonly ativo: boolean;
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

export interface AparelhoBeiraLeito {
  readonly id: number;
  readonly nome: string;
  readonly unidade: string;
  readonly tipo: TipoAparelho;
  readonly ativo: boolean;
  readonly ultimoSincronismo: string | null;
  readonly cadastradoPor: string;
  /** Os valores anteriores (a mais antiga primeiro), com o motivo, quem e quando. */
  readonly versoes?: readonly VersaoAparelho[];
}

export interface EventoHistoricoHorario {
  readonly quando: string;
  /** historico: mudança de situação do horário; extrato: aprazamento ou conferência. */
  readonly origem: 'historico' | 'extrato';
  readonly situacao: string;
  readonly aprazamento: number | null;
  readonly cbo: number | null;
  readonly justificativa: string | null;
}

export interface ExtrasContingencia {
  readonly alergias: ReadonlyMap<number, readonly string[]>;
  readonly problemas: readonly { paciente: number; descricao: string; cid: string | null }[];
  readonly justificativas: readonly { prescricao: number; texto: string }[];
  readonly amostras: readonly { atendimento: number; codigo: string; estado: string }[];
  readonly limpezas: readonly { leito: string; etapa: string; prazo: string | null }[];
  /** Pacientes pedidos que passaram do teto: alergias, problemas e amostras deles não foram lidos. */
  readonly naoLidos: readonly number[];
}

/** Atendimento da consulta de enfermagem (a receita do enfermeiro e a SAE leem o cabeçalho). */
export interface AtendimentoDaConsulta {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly tipo: string;
  readonly entrada: string | null;
  readonly vinculoDoAtendimento: number | null;
  readonly cboDoAtendimento: string | null;
  readonly ativo: boolean;
}

/** A baixa de estoque do horário (dose integrada ao estoque ou dispensada pela farmácia). */
export interface BaixaDeEstoque {
  readonly integracoes: number;
  readonly dispensacoes: number;
}

// ── Balanço hídrico ───────────────────────────────────────────────────────────────────────────────────────

export interface ChecagemParaBalanco {
  readonly horario: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  readonly checadoEm: string | null;
  readonly horaReal: string | null;
  readonly quantidade: number | null;
  readonly volumeInfundidoMl: number | null;
}

export interface SinaisParaBalanco {
  /** A diurese vigente (sem retificação posterior) no intervalo. */
  readonly diurese: readonly { readonly id: number; readonly valor: number; readonly horaReal: string }[];
  readonly temperaturaMaxima: number | null;
  readonly peso: { readonly valor: number; readonly quando: string } | null;
}

export interface NovoLancamentoBalanco {
  readonly paciente: number;
  readonly atendimento: number;
  readonly sentido: SentidoBalanco;
  readonly grupo: number | null;
  readonly via: string | null;
  readonly tipoEliminacao: number | null;
  readonly intensidade: number | null;
  readonly aspecto: string | null;
  readonly estimado: boolean;
  readonly volumeMl: number;
  readonly horaReal: string;
  readonly descricao: string | null;
  readonly origemOffline: boolean;
  readonly usuario: string;
  /** A chave do ato (Idempotency-Key + posição): o mesmo pedido reenviado devolve o lançamento já gravado. */
  readonly chave: string | null;
}

export interface PendenteDoFechamento {
  readonly origem: 'checagem' | 'sinal';
  readonly referencia: number;
  readonly sentido: SentidoBalanco;
  readonly grupo: number | null;
  readonly via: string | null;
  readonly tipoEliminacao: number | null;
  readonly volumeMl: number;
  readonly horaReal: string;
  readonly descricao: string;
}

export interface NovoFechamentoBalanco {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly horaCorte: string;
  readonly tipo: TipoFechamentoBalanco;
  readonly inicio: string;
  readonly fim: string;
  /** O fim entra no cálculo (o parcial até o minuto de agora)? Sem a marca, [inicio, fim). */
  readonly fimInclusivo?: boolean;
  /** Os ids dos lançamentos vigentes que a tela viu (relidos na transação: se mudaram, recusa). */
  readonly lancamentosVistos: readonly number[];
  readonly pendentes: readonly PendenteDoFechamento[];
  readonly ganhosMl: number;
  readonly perdasMl: number;
  readonly insensiveisMl: number;
  readonly saldoMl: number;
  readonly diureseMl: number;
  readonly pesoKg: number | null;
  readonly temperaturaMaxima: number | null;
  readonly debitoUrinario: number | null;
  readonly oliguria: boolean;
  readonly formula: string;
  readonly lancamentos: number;
  readonly parcelas: string;
  readonly usuario: string;
}

// ── Agência transfusional ─────────────────────────────────────────────────────────────────────────────────

export type NovaImunoHematologia = RegistrarImunoHematologiaEntrada & {
  /** Tipagem interpretada pelo domínio (só no aboRh; null quando inconclusiva). */
  readonly tipagem: TipagemSanguinea | null;
  readonly usuario: string;
  readonly chave: string | null;
};

export interface RecebimentoBolsa {
  readonly numero: string;
  readonly hemocomponente: string;
  readonly tipagem: { readonly abo: GrupoAbo; readonly rh: FatorRh };
  readonly volumeMl: number;
  readonly validade: string;
  readonly origem: string;
  readonly local: number;
  readonly irradiada: boolean;
  readonly leucorreduzida: boolean;
  readonly temperaturaC: number;
  readonly inspecaoOk: boolean;
  /** Situação de entrada decidida pelo domínio (quarentena ou liberada). */
  readonly situacao: 'quarentena' | 'liberada';
  readonly usuario: string;
  readonly chave: string | null;
}

export interface NovoMovimentoBolsa {
  readonly bolsa: number;
  readonly acao: import('@sgh/contratos').AcaoBolsa;
  readonly requisicao: number | null;
  readonly motivoCadastro: number | null;
  readonly motivo: string | null;
  /** Na liberação da bolsa com a inspeção reprovada na chegada: a reinspeção aprovada. */
  readonly inspecaoConferida?: boolean | undefined;
  readonly versao: number;
  readonly agora: string;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface CorrecaoBolsa {
  readonly bolsa: number;
  readonly numero?: string | undefined;
  readonly tipagem?: { readonly abo: GrupoAbo; readonly rh: FatorRh } | undefined;
  readonly validade?: string | undefined;
  readonly volumeMl?: number | undefined;
  readonly versao: number;
  readonly motivo: string;
  readonly usuario: string;
}

// ── Escores, reavaliações, classificação de pacientes e índices da UTI ─────────────────────────────────────

export type AlertaReavaliado = 'sem-alerta' | 'encerrado' | 'mantido';
export type OrigemEstorno = 'escore' | 'classificacao' | 'indiceUti';

export interface EstornoRegistrado {
  readonly tipo: 'estorno' | 'invalidacao';
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
  readonly alerta: AlertaReavaliado | null;
  readonly escoreMantem: number | null;
}

export interface NovoEstornoRegistro {
  readonly origem: OrigemEstorno;
  readonly id: number;
  readonly paciente: number;
  readonly tipo: 'estorno' | 'invalidacao';
  readonly motivo: string;
  readonly alerta: AlertaReavaliado | null;
  readonly escoreMantem: number | null;
  readonly usuario: string;
}

/** O registro a estornar (o paciente e o autor vêm do banco, nunca do pedido). */
export interface RegistroParaEstorno {
  readonly id: number;
  readonly paciente: number;
  readonly usuario: string;
  readonly escala: string | null;
  readonly gatilho: string | null;
  readonly quando: string;
  readonly estornado: boolean;
}

export interface AvisoCentral {
  readonly login: string;
  readonly tipo: string;
  readonly gravidade: 'grave' | 'atencao' | 'informacao';
  readonly modulo: string;
  readonly evento: string;
  readonly titulo: string;
  readonly link: string | null;
  readonly objetoTabela: string | null;
  readonly objetoChave: string;
}

export interface ClassificacaoRegistrada {
  readonly id: number;
  readonly paciente: number;
  /** Internação (id). */
  readonly reg: number;
  readonly instrumento: 'fugulin' | 'nas';
  readonly itens: Record<string, number | string>;
  readonly total: number;
  readonly categoria: string;
  readonly horas24h: number;
  readonly usuario: string;
  readonly criadoEm: string;
  readonly data: string;
  readonly turno: string;
  readonly estorno?: EstornoRegistrado | null;
}

export interface NovaClassificacaoPaciente {
  readonly paciente: number;
  readonly reg: number;
  readonly atendimento: number | null;
  readonly unidade: string;
  readonly data: string;
  readonly turno: 'diurno' | 'noturno';
  readonly instrumento: 'fugulin' | 'nas';
  readonly versao: number;
  readonly itens: Readonly<Record<string, number | string>>;
  readonly total: number;
  readonly categoria: string;
  readonly horas24h: number;
  readonly usuario: string;
}

export interface CuidadoDecidido {
  readonly codigo: string;
  readonly decisao: 'aceito' | 'recusado';
  readonly motivo?: string | null | undefined;
}

export interface HistoricoProfilaxia {
  readonly decisao: 'prescrita' | 'nao-prescrita' | 'anulada';
  readonly motivo: string | null;
  readonly justificativa: string | null;
  readonly usuario: string;
  readonly em: string;
}

export interface DecisaoProfilaxiaRegistrada {
  readonly escore: number;
  /** A decisão vigente (a da última retificação, ou a original). */
  readonly decisao: 'prescrita' | 'nao-prescrita';
  readonly motivo: string | null;
  readonly usuario: string;
  readonly em: string;
  readonly anulada?: boolean;
  readonly historico?: readonly HistoricoProfilaxia[];
}

export interface NovaDecisaoProfilaxia {
  readonly escore: number;
  readonly paciente: number;
  readonly decisao: 'prescrita' | 'nao-prescrita';
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface RetificacaoProfilaxia {
  readonly escore: number;
  readonly paciente: number;
  readonly decisao: 'prescrita' | 'nao-prescrita' | 'anulada';
  readonly motivo: string | null;
  readonly justificativa: string;
  readonly usuario: string;
}

export interface EscalaEmFormulario {
  readonly registro: number;
  readonly paciente: number;
  readonly modelo: string;
  readonly escala: 'braden' | 'morse';
  readonly quando: string | null;
  readonly total: number | null;
  readonly faixaFormulario: string | null;
}

export interface EscoreRegistrado {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number | null;
  readonly atendimento: number | null;
  readonly unidade: string | null;
  readonly escala: string;
  readonly versaoRegra: number;
  readonly itens: Record<string, number>;
  readonly total: number;
  readonly faixa: string;
  readonly gatilho: string;
  readonly suspeitaInfeccao: boolean;
  readonly origem: 'afericao' | 'tela';
  readonly aferidoEm: string;
  readonly usuario: string;
  readonly estorno?: EstornoRegistrado | null;
}

export interface NovoEscore {
  readonly paciente: number;
  readonly reg: number | null;
  readonly atendimento: number | null;
  readonly unidade: string | null;
  readonly escala: string;
  readonly versaoRegra: number;
  readonly itens: Readonly<Record<string, number>>;
  readonly total: number;
  readonly faixa: string;
  readonly gatilho: string;
  readonly suspeitaInfeccao: boolean;
  readonly origem: 'afericao' | 'tela';
  readonly sinalVital: number | null;
  readonly aferidoEm: string;
  readonly usuario: string;
}

export interface IndiceUtiRegistrado {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number | null;
  readonly indice: 'apache2' | 'sofa';
  readonly variaveis: unknown;
  readonly pontuacao: number;
  readonly categoria: number | null;
  readonly tipoAdmissao: string | null;
  readonly mortalidade: number | null;
  readonly impressaoConfig: string;
  readonly coletadoEm: string;
  readonly registradoPor: string;
  readonly situacao: 'registrado' | 'validado';
  readonly validadoPor: string | null;
  readonly validadoEm: string | null;
  readonly estorno?: EstornoRegistrado | null;
}

export interface NovoIndiceUti {
  readonly paciente: number;
  readonly reg: number | null;
  readonly atendimento: number | null;
  readonly unidade: string | null;
  readonly indice: 'apache2' | 'sofa';
  readonly variaveis: unknown;
  readonly pontuacao: number;
  readonly categoria: number | null;
  readonly tipoAdmissao: string | null;
  readonly mortalidade: number | null;
  readonly impressaoConfig: string;
  readonly coletadoEm: string;
  readonly usuario: string;
}

export interface InternacaoParaEscore {
  readonly reg: number;
  readonly entrada: string | null;
  readonly alta: string | null;
  /** Grupo do motivo de alta (null: ainda internado). */
  readonly motivoAlta: number | null;
}

export interface ReavaliacaoRegistrada {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number | null;
  readonly escala: 'braden' | 'morse';
  readonly motivo: 'admissao' | 'diaria' | 'mudanca-quadro';
  readonly devidaEm: string;
  readonly prazoEm: string;
  readonly situacao: 'pendente' | 'cumprida' | 'dispensada';
  readonly cumpridaEm: string | null;
  readonly cumpridaPor: 'escore' | 'formulario' | null;
  readonly escore?: number | null;
}

export interface NovaReavaliacao {
  readonly paciente: number;
  readonly reg: number | null;
  readonly unidade: string | null;
  readonly escala: 'braden' | 'morse';
  readonly motivo: 'admissao' | 'diaria' | 'mudanca-quadro';
  readonly chave: string;
  readonly devidaEm: string;
  readonly prazoEm: string;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface RegraEscoreRegistrada {
  readonly id: number;
  readonly escala: string;
  readonly versao: number;
  readonly faixas: unknown;
  readonly impressao: string;
  readonly notas: string;
  readonly autor: string;
  readonly publicadoEm: string;
}

export interface NovaRegraEscore {
  readonly escala: string;
  readonly faixas: unknown;
  readonly impressao: string;
  readonly notas: string;
  readonly autor: string;
}

// ── Contenção mecânica ────────────────────────────────────────────────────────────────────────────────────

export interface AdendoChecagemLido {
  readonly achados: Readonly<Record<string, string>>;
  readonly alterado: boolean;
  readonly observacao: string | null;
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

export interface HorarioContencao {
  readonly id: number;
  readonly previsto: string;
  readonly checagem: {
    readonly achados: Readonly<Record<string, string>>;
    readonly alterado: boolean;
    readonly observacao: string | null;
    readonly usuario: string;
    readonly feitaEm: string;
    readonly adendos?: readonly AdendoChecagemLido[];
  } | null;
}

export interface ContencaoRegistrada {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly motivo: string;
  readonly justificativa: string;
  readonly tipo: string;
  readonly membros: string[];
  readonly prazoHoras: number;
  readonly intervaloMinutos: number;
  readonly inicio: string;
  readonly anterior: number | null;
  readonly renovadaPor: number | null;
  /** O início da renovação vigente (corte dos horários desta ordem). */
  readonly renovadaEm?: string | null;
  readonly prescritor: string;
  readonly criadoEm: string;
  readonly encerramento: {
    readonly tipo: 'retirada' | 'inativacao';
    readonly motivo: string;
    readonly usuario: string;
    readonly em: string;
  } | null;
  readonly horarios: HorarioContencao[];
}

/** A ordem lida para conferir uma gravação (o encerramento e a renovação vêm junto). */
export interface ContencaoParaGravar {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly inicio: string;
  readonly prazoHoras: number;
  readonly intervaloMinutos: number;
  readonly prescritor: string;
  readonly encerramento: { readonly tipo: 'retirada' | 'inativacao'; readonly em: string } | null;
  readonly renovadaPor: number | null;
  readonly renovadaEm: string | null;
}

export interface OrdemContencao {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly motivo: string;
  readonly justificativa: string;
  readonly tipo: string;
  readonly membros: readonly string[];
  readonly prazoHoras: number;
  readonly intervaloMinutos: number;
  /** AAAA-MM-DDTHH:mm (o relógio do estabelecimento). */
  readonly inicio: string;
  /** Os horários da checagem periódica (AAAA-MM-DDTHH:mm), calculados pela regra da ordem. */
  readonly horarios: readonly string[];
  /** A renovação: a ordem anterior (ativa ou vencida, sem retirada nem outra renovação, do mesmo atendimento). */
  readonly anterior: number | null;
  readonly prescritor: string;
}

export interface ChecagemContencao {
  readonly contencao: number;
  /** O horário aprazado (AAAA-MM-DDTHH:mm). */
  readonly previsto: string;
  readonly achados: Readonly<Record<string, 'normal' | 'alterado'>>;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface AdendoChecagemContencao extends ChecagemContencao {
  readonly motivo: string;
}

export interface EncerramentoContencao {
  readonly contencao: number;
  readonly tipo: 'retirada' | 'inativacao';
  readonly motivo: string;
  readonly usuario: string;
}

// ── Time de Resposta Rápida e parada cardiorrespiratória ─────────────────────────────────────────────────

/** A janela do alerta aberto: o escore com gatilho de TRR das últimas 12 horas. */
export const HORAS_JANELA_ALERTA_TRR = 12;

export interface InativacaoTrrLida {
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

export interface EventoTrrRegistrado {
  readonly id: number;
  readonly tipo: 'chegada' | 'desfecho';
  readonly seq: number;
  readonly em: string;
  readonly desfecho: string | null;
  readonly usuario: string;
  readonly motivo: string | null;
  readonly anterior: number | null;
  readonly inativacao: InativacaoTrrLida | null;
  /** O registro vigente do tipo (o de maior sequência, se não inativado). */
  readonly vigente: boolean;
}

/** Marca o vigente de cada tipo: o de maior sequência, se não inativado. */
export function comVigencia(lista: readonly EventoTrrRegistrado[]): EventoTrrRegistrado[] {
  const ultimo = new Map<string, EventoTrrRegistrado>();
  for (const v of lista) {
    const u = ultimo.get(v.tipo);
    if (!u || v.seq > u.seq) ultimo.set(v.tipo, v);
  }
  return lista.map((v) => ({ ...v, vigente: ultimo.get(v.tipo) === v && v.inativacao === null }));
}

export interface AcionamentoTrrRegistrado {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly origem: 'escore' | 'manual';
  readonly escore: number | null;
  readonly alertaEm: string | null;
  readonly acionadoEm: string;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly chegadaEm: string | null;
  readonly desfecho: string | null;
  readonly inativacao?: InativacaoTrrLida | null;
  readonly escoreEstornado?: boolean;
  readonly eventos?: readonly EventoTrrRegistrado[];
}

export interface NovoAcionamentoTrr {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly escore: number | null;
  readonly acionadoEm: string;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface NovoEventoTrr {
  readonly trr: number;
  readonly tipo: 'chegada' | 'desfecho';
  readonly em: string;
  readonly desfecho: string | null;
  readonly usuario: string;
}

export interface FichaPcr {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly trr: number | null;
  readonly anterior: number | null;
  readonly motivo?: string | null;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly colapsoEm: string;
  /** Os campos Utstein em JSON (até 2.000 caracteres). */
  readonly dados: string;
  readonly autor: string;
}

export interface InativacaoTrr {
  readonly origem: 'trr' | 'evento' | 'pcr';
  readonly id: number;
  readonly motivo: string;
  readonly usuario: string;
}

export interface RetificacaoEventoTrr {
  readonly evento: number;
  readonly em: string | null;
  readonly desfecho: string | null;
  readonly motivo: string;
  readonly usuario: string;
  /** O relógio do estabelecimento (a hora corrigida não pode ser do futuro). */
  readonly agora: string;
}

export interface VersaoPcrRegistrada {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly trr: number | null;
  readonly anterior: number | null;
  readonly versao: number;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly colapsoEm: string;
  readonly dados: string;
  readonly autor: string;
  readonly criadoEm: string;
  readonly motivo?: string | null;
  readonly inativacao?: InativacaoTrrLida | null;
}

// ── Protocolo gerenciado do internado ────────────────────────────────────────────────────────────────────

export interface EventoProtocoloInternadoRegistrado {
  readonly id: number;
  readonly tipo: 'meta' | 'checklist' | 'encerramento' | 'inativacao';
  readonly codigo: string;
  readonly situacao: string;
  readonly quando: string | null;
  readonly prazoEm: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

export interface ProtocoloInternadoRegistrado {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly local: 'internacao' | 'uti';
  readonly tipo: 'sepse' | 'avc' | 'tev';
  readonly gerenciado: number;
  readonly origem: 'news2' | 'suspeita';
  readonly escore: number | null;
  readonly criterios: string[];
  readonly observacao: string | null;
  readonly reconhecidoEm: string;
  readonly incluidoEm: string;
  readonly incluidoPor: string;
  readonly eventos: EventoProtocoloInternadoRegistrado[];
}

export interface InclusaoProtocoloInternado {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly local: 'internacao' | 'uti';
  readonly tipo: 'sepse' | 'avc' | 'tev';
  /** A versão publicada da definição do protocolo gerenciado. */
  readonly gerenciado: number;
  readonly origem: 'news2' | 'suspeita';
  readonly escore: number | null;
  readonly criterios: readonly string[];
  readonly observacao: string | null;
  /** O tempo zero (AAAA-MM-DDTHH:mm): a hora do alerta do NEWS2 ou a do reconhecimento. */
  readonly reconhecidoEm: string;
  readonly autor: string;
  readonly vinculo: number;
}

export interface NovoEventoProtocoloInternado {
  readonly protocolo: number;
  readonly tipoEvento: 'meta' | 'checklist' | 'encerramento' | 'inativacao';
  readonly codigo: string;
  readonly situacao: string;
  readonly ocorridoEm: string | null;
  readonly prazoEm: string | null;
  readonly motivo: string | null;
  readonly por: string;
}

// ── Lesão de pele ─────────────────────────────────────────────────────────────────────────────────────────

/** Os campos da ficha que os indicadores filtram (fora do JSON). */
export interface ColunasLesao {
  readonly tipo: string;
  readonly regiao: string;
  readonly estagio: string | null;
  readonly presenteNaAdmissao: boolean;
  /** AAAA-MM-DDTHH:mm. */
  readonly identificadaEm: string;
}

export interface VersaoLesaoRegistrada {
  readonly id: number;
  readonly versao: number;
  readonly anterior: number | null;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly dados: string;
  readonly motivo: string | null;
  readonly autor: string;
  readonly criadoEm: string;
}

export interface CurativoRegistrado {
  readonly id: number;
  readonly anterior: number | null;
  readonly realizadoEm: string;
  readonly dados: string;
  readonly motivo: string | null;
  readonly autor: string;
  readonly criadoEm: string;
}

export interface FotoLesaoRegistrada {
  readonly id: number;
  readonly curativo: number | null;
  readonly anexo: number;
  readonly tiradaEm: string;
  readonly usuario: string;
}

export interface EventoLesaoRegistrado {
  readonly origem: 'lesao' | 'curativo' | 'foto';
  readonly registro: number;
  readonly tipo: 'encerramento' | 'inativacao';
  readonly desfecho: string | null;
  readonly em: string;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly criadoEm: string;
}

export interface LesaoRegistrada {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly autor: string;
  readonly criadoEm: string;
  /** Todas as versões, da mais nova para a mais antiga (a primeira é a vigente). */
  readonly versoes: readonly VersaoLesaoRegistrada[];
  readonly curativos: readonly CurativoRegistrado[];
  readonly fotos: readonly FotoLesaoRegistrada[];
  readonly eventos: readonly EventoLesaoRegistrado[];
}

export interface NovaLesao {
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly colunas: ColunasLesao;
  /** A ficha em JSON (até 2.000 caracteres). */
  readonly dados: string;
  readonly autor: string;
}

export interface NovaVersaoLesao {
  readonly lesao: number;
  /** A versão que o autor tinha aberta (a vigente; outra é recusada como desatualizada). */
  readonly anterior: number;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly colunas: ColunasLesao;
  readonly dados: string;
  /** A justificativa da correção da ficha finalizada (obrigatória nela; proibida no rascunho). */
  readonly motivo: string | null;
  readonly autor: string;
}

export interface NovoCurativo {
  readonly lesao: number;
  readonly realizadoEm: string;
  readonly estagio: string | null;
  readonly dados: string;
  readonly autor: string;
}

export interface CorrecaoCurativo extends Omit<NovoCurativo, 'lesao'> {
  readonly anterior: number;
  readonly motivo: string;
}

export interface NovaFotoLesao {
  readonly lesao: number;
  readonly curativo: number | null;
  /** O anexo do prontuário (já gravado pela operação própria dele). */
  readonly anexo: number;
  readonly tiradaEm: string;
  readonly usuario: string;
}

export interface EncerramentoLesao {
  readonly lesao: number;
  readonly desfecho: 'cicatrizada' | 'alta' | 'transferido' | 'obito';
  readonly em: string;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface InativacaoLesao {
  readonly origem: 'lesao' | 'curativo' | 'foto';
  readonly id: number;
  readonly motivo: string;
  readonly usuario: string;
}
