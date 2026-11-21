// Porta dos escores, da classificação de pacientes e dos índices de UTI (M45, etapa 2; ficha, seções 4, 5 e 7),
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (escores-porta-propria.ts), com as gravações pelo Executor e a
//     trilha na mesma transação (o sinal vital da aferição e o aviso da central na MESMA transação do escore);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Os pacientes da unidade e o relógio vêm da porta da enfermagem (M25).
import type { ConfiguracaoIndicesUti } from '@sgh/contratos';
import type {
  AvisoCentral,
  ClassificacaoRegistrada,
  NovaClassificacaoPaciente,
  CuidadoDecidido,
  DecisaoProfilaxiaRegistrada,
  NovaDecisaoProfilaxia,
  RetificacaoProfilaxia,
  EscalaEmFormulario,
  EscoreRegistrado,
  NovoEscore,
  NovoEstornoRegistro,
  OrigemEstorno,
  RegistroParaEstorno,
  IndiceUtiRegistrado,
  NovoIndiceUti,
  InternacaoParaEscore,
  ReavaliacaoRegistrada,
  NovaReavaliacao,
  RegraEscoreRegistrada,
  NovaRegraEscore,
  SinalVitalNovo,
  AdendoChecagemContencao,
  ChecagemContencao,
  ContencaoRegistrada,
  EncerramentoContencao,
  OrdemContencao,
  NovoAcionamentoTrr,
  AcionamentoTrrRegistrado,
  NovoEventoTrr,
  FichaPcr,
  InativacaoTrr,
  RetificacaoEventoTrr,
  VersaoPcrRegistrada,
  NovoEventoProtocoloInternado,
  InclusaoProtocoloInternado,
  ProtocoloInternadoRegistrado,
  CorrecaoCurativo,
  NovoCurativo,
  EncerramentoLesao,
  NovaFotoLesao,
  InativacaoLesao,
  LesaoRegistrada,
  NovaLesao,
  NovaVersaoLesao,
} from './tipos.js';
import type { ContencaoParaGravar } from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ESCORES = Symbol('PORTA_ESCORES');

export type ContextoEscores = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** O escore registrado numa transação só: o sinal vital (aferição), o escore, os cuidados, as reavaliações e os avisos. */
export interface RegistroDeEscore {
  /** Na aferição do NEWS2: os sinais vitais gravados antes; o primeiro vira a origem do escore. */
  readonly sinais: readonly SemHospital<SinalVitalNovo>[];
  /** O sinal vital de origem já gravado (a aferição pela tela dos sinais vitais do M25), quando não vêm `sinais`. */
  readonly escore: Omit<SemHospital<NovoEscore>, 'sinalVital'> & { readonly sinalVital?: number | null };
  readonly cuidados: readonly CuidadoDecidido[];
  /** A baixa das programadas da escala (Braden e Morse). */
  readonly cumprir: { readonly escala: string; readonly quando: string } | null;
  /** As reavaliações programadas na mesma gravação (o NEWS2 de 5 ou mais: mudança de quadro). */
  readonly programar: readonly (Omit<SemHospital<NovaReavaliacao>, 'chave'> & {
    readonly chave: (escore: number) => string;
  })[];
  /** Os avisos da central (o médico e o Time de Resposta Rápida pelos parâmetros da unidade). */
  readonly avisos: readonly ((escore: number) => Omit<AvisoCentral, 'hospital' | 'rede'>)[];
}

export interface GravadorEscores {
  registrarEscore(r: RegistroDeEscore): Promise<{ id: number; sinais: number[]; avisos: number }>;
  programarReavaliacao(r: SemHospital<NovaReavaliacao>): Promise<number>;
  dispensarReavaliacao(d: {
    id: number;
    motivo: string;
    quando: string;
    usuario: string;
  }): Promise<{ paciente: number }>;
  publicarRegra(p: SemHospital<NovaRegraEscore>): Promise<{ id: number; versao: number }>;
  classificar(c: SemHospital<NovaClassificacaoPaciente>): Promise<number>;
  registrarIndice(x: SemHospital<NovoIndiceUti>): Promise<number>;
  /** W0-03: o estorno ou a invalidação (fato novo em aplicacao_escala; o original nunca muda). */
  estornarRegistro(r: SemHospital<NovoEstornoRegistro>): Promise<number>;
  /** W0-03, M1: a decisão do prescritor sobre a profilaxia de TEV sugerida (uma por escore; só inclusão). */
  decidirProfilaxia(d: SemHospital<NovaDecisaoProfilaxia>): Promise<number>;
  /** Revisão W0-03: a correção da decisão de profilaxia pelo autor (fato novo; a anulação reabre a pendência). */
  retificarProfilaxia(r: SemHospital<RetificacaoProfilaxia>): Promise<number>;
  /** W0-03, M5: a ordem de contenção (ou a renovação) e o aprazamento da checagem na mesma transação. */
  prescreverContencao(o: SemHospital<OrdemContencao>): Promise<number>;
  /** W0-03, M5: a checagem de um horário aprazado (uma por horário). */
  checarContencao(c: SemHospital<ChecagemContencao>): Promise<number>;
  /** Revisão W0-03: o adendo da checagem (só do autor; a original não muda). */
  adendoChecagemContencao(c: SemHospital<AdendoChecagemContencao>): Promise<number>;
  /** W0-03, M5: a retirada ou a inativação (uma por ordem). */
  encerrarContencao(x: SemHospital<EncerramentoContencao>): Promise<number>;
  /** W0-03, M5: os avisos da central (a ordem vencida); o repetido não é gravado de novo. */
  avisar(avisos: readonly Omit<AvisoCentral, 'hospital' | 'rede'>[]): Promise<number>;
  /** W0-03, M2: o acionamento do TRR (a hora do alerta vem do escore). */
  acionarTrr(a: SemHospital<NovoAcionamentoTrr>): Promise<{ id: number; alertaEm: string | null }>;
  /** W0-03, M2: a chegada ou o desfecho (um de cada). */
  eventoTrr(x: SemHospital<NovoEventoTrr>): Promise<number>;
  /** W0-03, M2: a ficha da PCR, por versão. */
  gravarFichaPcr(f: SemHospital<FichaPcr>): Promise<{ id: number; versao: number }>;
  /** Revisão W0-03: a retificação da chegada ou do desfecho (versão nova do autor, com o motivo). */
  retificarEventoTrr(
    x: SemHospital<RetificacaoEventoTrr>,
  ): Promise<{ id: number; trr: number; tipo: string }>;
  /** Revisão W0-03: a inativação do acionamento, do evento ou da ficha lançados errado (só do autor). */
  inativarTrr(x: SemHospital<InativacaoTrr>): Promise<{ id: number; paciente: number }>;
  /** W0-03, M4: a lesão nova com a versão 1 da ficha. */
  registrarLesao(r: SemHospital<NovaLesao>): Promise<{ id: number; versao: number; idVersao: number }>;
  /** W0-03, M4: a versão seguinte da ficha (só do autor; a da finalizada é a correção com a justificativa). */
  versaoLesao(v: SemHospital<NovaVersaoLesao>): Promise<{ id: number; versao: number; paciente: number }>;
  /** W0-03, M4: o curativo (a evolução). */
  curativoLesao(c: SemHospital<NovoCurativo>): Promise<{ id: number; paciente: number }>;
  /** W0-03, M4: a correção do curativo pelo autor (linha nova com o motivo). */
  corrigirCurativoLesao(
    c: SemHospital<CorrecaoCurativo>,
  ): Promise<{ id: number; lesao: number; paciente: number }>;
  /** W0-03, M4: a foto (a referência ao anexo de imagem do prontuário). */
  fotoLesao(f: SemHospital<NovaFotoLesao>): Promise<{ id: number; paciente: number }>;
  /** W0-03, M4: o encerramento do acompanhamento (desfecho e hora). */
  encerrarLesao(x: SemHospital<EncerramentoLesao>): Promise<{ id: number; paciente: number }>;
  /** W0-03, M4: a inativação do lançado errado (a lesão, um curativo ou uma foto; só do autor). */
  inativarLesao(x: SemHospital<InativacaoLesao>): Promise<{ id: number; paciente: number; lesao: number }>;
  /** W0-03, M3: a inclusão do internado num protocolo gerenciado (um aberto por tipo e atendimento). */
  incluirProtocoloInternado(p: SemHospital<InclusaoProtocoloInternado>): Promise<number>;
  /** W0-03, M3: a meta, o item do checklist, o encerramento ou a inativação por engano (um de cada). */
  eventoProtocoloInternado(x: SemHospital<NovoEventoProtocoloInternado>): Promise<number>;
  validarIndice(v: {
    id: number;
    validadoPor: string;
    vinculo: number;
    quando: string;
  }): Promise<{ paciente: number }>;
}

export interface VinculoAssistencial {
  readonly vinculo: number;
  readonly codigoCbo: string;
  readonly conselhoAtivo: boolean;
}

export interface PortaEscores extends PortaGravacaoM18<GravadorEscores> {
  regras(c: ContextoEscores): Promise<RegraEscoreRegistrada[]>;
  escores(c: ContextoEscores, pacientes: readonly number[], desde: string): Promise<EscoreRegistrado[]>;
  /** O último escore de cada escala de cada paciente desde a hora (sem o teto de linhas do histórico). */
  ultimosEscores(
    c: ContextoEscores,
    pacientes: readonly number[],
    desde: string,
  ): Promise<EscoreRegistrado[]>;
  reavaliacoes(
    c: ContextoEscores,
    pacientes: readonly number[],
    desde: string,
  ): Promise<ReavaliacaoRegistrada[]>;
  escalasEmFormulario(
    c: ContextoEscores,
    pacientes: readonly number[],
    desde: string,
  ): Promise<EscalaEmFormulario[]>;
  internacoes(c: ContextoEscores, regs: readonly number[]): Promise<InternacaoParaEscore[]>;
  classificacoes(
    c: ContextoEscores,
    unidade: string,
    data: string,
    turno: string,
  ): Promise<ClassificacaoRegistrada[]>;
  configuracaoIndices(c: ContextoEscores): Promise<Omit<ConfiguracaoIndicesUti, 'impressao'>>;
  indicesDoPaciente(c: ContextoEscores, paciente: number): Promise<IndiceUtiRegistrado[]>;
  apachesDoPeriodo(c: ContextoEscores, de: string, ate: string): Promise<IndiceUtiRegistrado[]>;
  vinculo(c: ContextoEscores, login: string): Promise<VinculoAssistencial | null>;
  /** W0-03: o registro a estornar (paciente, autor, escala e gatilho vêm do banco). */
  registroParaEstorno(
    c: ContextoEscores,
    origem: OrigemEstorno,
    id: number,
  ): Promise<RegistroParaEstorno | null>;
  /** W0-03, M1: as decisões de profilaxia de TEV dos escores. */
  decisoesProfilaxia(c: ContextoEscores, escores: readonly number[]): Promise<DecisaoProfilaxiaRegistrada[]>;
  /** W0-03, M5: as ordens de contenção (dos atendimentos, da unidade ou do estabelecimento) que começaram na janela. */
  contencoes(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; unidade?: string; desde: string; ate?: string; abertas?: boolean },
  ): Promise<ContencaoRegistrada[]>;
  /** W0-03, M5: a ordem para conferir uma gravação. */
  contencao(c: ContextoEscores, id: number): Promise<ContencaoParaGravar | null>;
  /** W0-03, M2: os acionamentos do TRR (pela hora do acionamento). */
  acionamentosTrr(
    c: ContextoEscores,
    f: { unidade?: string; desde: string; ate?: string },
  ): Promise<AcionamentoTrrRegistrado[]>;
  /** W0-03, M2: os escores que já acionaram o time. */
  escoresComTrr(c: ContextoEscores, escores: readonly number[]): Promise<Set<number>>;
  /** W0-03, M2: as versões das fichas de PCR (dos atendimentos ou pela hora do colapso). */
  versoesPcr(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; unidade?: string; desde?: string; ate?: string },
  ): Promise<VersaoPcrRegistrada[]>;
  /** Revisão W0-03: os acionamentos ligados aos escores (o aviso do estorno do escore). */
  acionamentosDosEscores(
    c: ContextoEscores,
    escores: readonly number[],
  ): Promise<{ escore: number; trr: number; acionadoEm: string; inativo: boolean }[]>;
  /** W0-03, M2: o censo do período por unidade (os pacientes-dia), para o indicador da PCR fora da UTI. */
  censo(
    c: ContextoEscores,
    de: string,
    ate: string,
  ): Promise<{ porSetor: { setor: string; pacientesDia: number }[]; diasFechados: number }>;
  /** W0-03, M3: os protocolos do internado (dos atendimentos, abertos pelo alerta dos escores, ou incluídos no período). */
  protocolosInternados(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; escores?: readonly number[]; desde?: string; ate?: string },
  ): Promise<ProtocoloInternadoRegistrado[]>;
  /** W0-03, M3: uma inclusão, com os eventos. */
  protocoloInternado(c: ContextoEscores, id: number): Promise<ProtocoloInternadoRegistrado | null>;
  /** W0-03, M4: as lesões (pelo id, dos atendimentos, ou identificadas no período), com tudo o que têm. */
  lesoes(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; desde?: string; ate?: string },
  ): Promise<LesaoRegistrada[]>;
  /** W0-03, M4: os pacientes internados no período (datas AAAA-MM-DD), o denominador da incidência por paciente. */
  pacientesInternados(c: ContextoEscores, de: string, ate: string): Promise<number>;
  /** W0-03, M4: a lesão de um curativo (null se não existe). */
  lesaoDoCurativo(c: ContextoEscores, curativo: number): Promise<number | null>;
  /** W0-03, M5: os pacientes-dia da unidade no período (o censo diário fechado), para o indicador. */
  pacientesDia(
    c: ContextoEscores,
    unidade: string,
    de: string,
    ate: string,
  ): Promise<{ pacientesDia: number; diasFechados: number }>;
}

export const METODOS_PORTA_ESCORES: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'regras',
  'escores',
  'ultimosEscores',
  'reavaliacoes',
  'escalasEmFormulario',
  'internacoes',
  'classificacoes',
  'configuracaoIndices',
  'indicesDoPaciente',
  'apachesDoPeriodo',
  'vinculo',
  'registroParaEstorno',
  'decisoesProfilaxia',
  'contencoes',
  'contencao',
  'pacientesDia',
  'acionamentosTrr',
  'escoresComTrr',
  'versoesPcr',
  'acionamentosDosEscores',
  'censo',
  'protocolosInternados',
  'protocoloInternado',
  'lesoes',
  'pacientesInternados',
  'lesaoDoCurativo',
]);
