// Porta da nutrição, do mapa de dietas e do serviço social (M45, etapa 5; ficha, seções 4 a 7): o que a fila de pacientes
// a triar, a triagem, a terapia nutricional (EMTN), o mapa de dietas com a etiqueta e a refeição do acompanhante e o
// serviço social leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo, com a trilha, o outbox e
//     a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com internados, prescrições, agenda e alergias sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { LinhaTrilha } from '@sgh/nucleo';
import type {
  AvaliacaoNptLida,
  RegistroCorrigivel,
  RiscoSocial,
  TipoRegistroSocial,
  VolumeBalanco,
} from '@sgh/contratos';
import type {
  AcompanhamentoTerapiaParaGravar,
  AcompanhamentoTerapiaRegistrado,
  AcompanhanteAnterior,
  AdendoSocialParaGravar,
  AlteracaoHotelaria,
  AlteracaoHotelariaRegistrada,
  AlteracaoRefeicaoAcompanhante,
  AvaliacaoNptParaGravar,
  AvaliacaoSocialParaGravar,
  BarreiraAltaRegistrada,
  ChecagemDieta,
  CirurgiaDaJanela,
  CorrecaoParaGravar,
  CorrecaoRegistrada,
  DietaEnteral,
  ExameDaJanela,
  InternadoNutricao,
  ItemDietaMapa,
  MapaDietaParaGravar,
  MetaTerapiaParaGravar,
  MetaTerapiaRegistrada,
  RefeicaoAcompanhanteParaGravar,
  RefeicaoAcompanhanteRegistrada,
  RefeicaoDoCadastro,
  RegistroSocialRegistrado,
  RetratoMapa,
  TriagemParaGravar,
  TriagemRegistrada,
  UnidadeInternacaoNutricao,
} from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_NUTRICAO = Symbol('PORTA_NUTRICAO');

export type ContextoNutricao = ContextoPortaM18;

/** Gravações diretas da porta, numa operação do executor (trilha, outbox e idempotência na mesma transação). */
export interface GravadorNutricao {
  triar(t: TriagemParaGravar): Promise<number>;
  registrarMeta(m: MetaTerapiaParaGravar): Promise<number>;
  registrarAcompanhamento(a: AcompanhamentoTerapiaParaGravar): Promise<number>;
  fecharMapa(m: MapaDietaParaGravar): Promise<number>;
  registrarAcompanhante(a: RefeicaoAcompanhanteParaGravar): Promise<number>;
  encerrarAcompanhante(a: { id: number; motivo: string; usuario: string }): Promise<number>;
  registrarSocial(a: AvaliacaoSocialParaGravar): Promise<{ id: number; barreira: number | null }>;
  /** Evento próprio a mais na trilha da operação (vai nos dados da trilha, na mesma transação). */
  registrarEvento(linha: LinhaTrilha): Promise<void>;
  // W0-05: a correção (retificação, estorno, nova versão e encerramento), a avaliação da NPT, o adendo social e a
  // alteração da refeição do acompanhante com o log.
  corrigir(x: CorrecaoParaGravar): Promise<number>;
  avaliarNpt(x: AvaliacaoNptParaGravar): Promise<number>;
  adendoSocial(x: AdendoSocialParaGravar): Promise<number>;
  /** Devolve a refeição como estava, relida na transação (com a linha travada). */
  alterarAcompanhante(x: AlteracaoRefeicaoAcompanhante): Promise<AcompanhanteAnterior>;
  registrarAlteracao(x: AlteracaoHotelaria): Promise<number>;
}

export interface VinculoDoLogin {
  readonly vinculo: number;
  readonly cbo: string;
  readonly ativo: boolean;
}

export interface PortaNutricao extends PortaGravacaoM18<GravadorNutricao> {
  /** O relógio do banco ("AAAA-MM-DDTHH:MM" e "AAAA-MM-DD"). */
  relogio(c: ContextoNutricao): Promise<{ agora: string; hoje: string }>;
  vinculos(c: ContextoNutricao, login: string): Promise<VinculoDoLogin[]>;
  /** Quantos cadastros de profissional estão ligados ao login (conta compartilhada acima do limite). */
  cadastrosDoLogin(c: ContextoNutricao, login: string): Promise<number>;
  internados(
    c: ContextoNutricao,
    unidade: string | null,
  ): Promise<{ itens: InternadoNutricao[]; cortada: boolean }>;
  internacao(c: ContextoNutricao, reg: number): Promise<(InternadoNutricao & { aberta: boolean }) | null>;
  triagens(c: ContextoNutricao, regs: readonly number[]): Promise<TriagemRegistrada[]>;
  comMeta(c: ContextoNutricao, regs: readonly number[]): Promise<Set<number>>;
  dietasEnterais(c: ContextoNutricao, atendimento: number, desde: string): Promise<DietaEnteral[]>;
  checagens(c: ContextoNutricao, itens: readonly number[], desde: string): Promise<ChecagemDieta[]>;
  primeiraAdministrada(c: ContextoNutricao, itens: readonly number[]): Promise<string | null>;
  terapia(
    c: ContextoNutricao,
    reg: number,
  ): Promise<{ metas: MetaTerapiaRegistrada[]; acompanhamentos: AcompanhamentoTerapiaRegistrado[] }>;
  meta(c: ContextoNutricao, id: number): Promise<(MetaTerapiaRegistrada & { reg: number }) | null>;
  fichas(c: ContextoNutricao, paciente: number): Promise<{ quantidade: number; ultima: string | null }>;
  sociais(c: ContextoNutricao, reg: number): Promise<RegistroSocialRegistrado[]>;
  ultimosSociais(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, { risco: RiscoSocial; tipo: TipoRegistroSocial; em: string }>>;
  barreirasSociais(c: ContextoNutricao, regs: readonly number[]): Promise<Map<number, number>>;
  barreiras(c: ContextoNutricao, regs: readonly number[]): Promise<BarreiraAltaRegistrada[]>;
  unidades(c: ContextoNutricao): Promise<UnidadeInternacaoNutricao[]>;
  refeicoes(c: ContextoNutricao): Promise<RefeicaoDoCadastro[]>;
  itensDieta(
    c: ContextoNutricao,
    atendimentos: readonly number[],
    servirEm: string,
  ): Promise<ItemDietaMapa[]>;
  alergiasAlimentares(c: ContextoNutricao, pacientes: readonly number[]): Promise<Map<number, string[]>>;
  cirurgias(c: ContextoNutricao, de: string, ate: string): Promise<CirurgiaDaJanela[]>;
  exames(c: ContextoNutricao, pronts: readonly number[], de: string, ate: string): Promise<ExameDaJanela[]>;
  acompanhantesVigentes(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, RefeicaoAcompanhanteRegistrada>>;
  acompanhantes(c: ContextoNutricao, reg: number): Promise<RefeicaoAcompanhanteRegistrada[]>;
  acompanhante(c: ContextoNutricao, id: number): Promise<RefeicaoAcompanhanteRegistrada | null>;
  retrato(c: ContextoNutricao, unidade: string, refeicao: number, data: string): Promise<RetratoMapa | null>;
  // ── W0-05 ──
  /** As correções que inativam os registros e a versão que cada um substitui. */
  correcoes(
    c: ContextoNutricao,
    registro: RegistroCorrigivel,
    ids: readonly number[],
  ): Promise<{ inativa: Map<number, CorrecaoRegistrada>; substitui: Map<number, number> }>;
  /** A internação do registro clínico (null se não existe). */
  internacaoDoRegistro(c: ContextoNutricao, registro: RegistroCorrigivel, id: number): Promise<number | null>;
  avaliacoesNpt(c: ContextoNutricao, reg: number): Promise<AvaliacaoNptLida[]>;
  /** O volume da parenteral por dia lido do balanço hídrico do atendimento desde o instante. */
  balancoParenteral(c: ContextoNutricao, atendimento: number, desde: string): Promise<VolumeBalanco[]>;
  /** O log das alterações da refeição do acompanhante. */
  alteracoesAcompanhante(
    c: ContextoNutricao,
    ids: readonly number[],
  ): Promise<AlteracaoHotelariaRegistrada[]>;
}

export const METODOS_PORTA_NUTRICAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'vinculos',
  'cadastrosDoLogin',
  'internados',
  'internacao',
  'triagens',
  'comMeta',
  'dietasEnterais',
  'checagens',
  'primeiraAdministrada',
  'terapia',
  'meta',
  'fichas',
  'sociais',
  'ultimosSociais',
  'barreirasSociais',
  'barreiras',
  'unidades',
  'refeicoes',
  'itensDieta',
  'alergiasAlimentares',
  'cirurgias',
  'exames',
  'acompanhantesVigentes',
  'acompanhantes',
  'acompanhante',
  'retrato',
  'correcoes',
  'internacaoDoRegistro',
  'avaliacoesNpt',
  'balancoParenteral',
  'alteracoesAcompanhante',
]);
