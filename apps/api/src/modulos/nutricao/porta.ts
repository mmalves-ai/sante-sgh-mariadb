// Porta da nutrição, do mapa de dietas e do serviço social (M45, etapa 5; ficha, seções 4 a 7): o que a fila de pacientes
// a triar, a triagem, a terapia nutricional (EMTN), o mapa de dietas com a etiqueta e a refeição do acompanhante e o
// serviço social leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY pelos repositórios de @sgh/legado e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com internados, prescrições, agenda e alergias sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AcompanhamentoTerapiaSgh,
  AcompanhanteSghLido,
  AdendoSocialSgh,
  AcompanhanteAnterior,
  AlteracaoAcompanhanteSgh,
  AlteracaoHotSgh,
  AlteracaoHotSghLida,
  AvaliacaoNptSgh,
  AvaliacaoSocialSgh,
  CorrecaoNutricaoSgh,
  CorrecaoSghLida,
  BarreiraLida,
  ChecagemDietaLida,
  CirurgiaDaJanelaLida,
  DietaAcompanhanteSgh,
  DietaEnteralSghLida,
  ExameDaJanelaLido,
  InternadoNutricaoLido,
  ItemDietaMapaLido,
  LinhaTrilha,
  MapaDietaSgh,
  MetaTerapiaSgh,
  MetaTerapiaSghLida,
  AcompanhamentoSghLido,
  RefeicaoDoCadastro,
  RegistroSocialSghLido,
  RetratoMapaLido,
  TriagemNutricionalSgh,
  TriagemSghLida,
  UnidadeInternacaoLida,
} from '@sgh/legado';
import type {
  AvaliacaoNptLida,
  RegistroCorrigivel,
  RiscoSocial,
  TipoRegistroSocial,
  VolumeBalanco,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_NUTRICAO = Symbol('PORTA_NUTRICAO');

export type ContextoNutricao = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorNutricao {
  triar(t: Omit<TriagemNutricionalSgh, 'hospital'>): Promise<number>;
  registrarMeta(m: Omit<MetaTerapiaSgh, 'hospital'>): Promise<number>;
  registrarAcompanhamento(a: Omit<AcompanhamentoTerapiaSgh, 'hospital'>): Promise<number>;
  fecharMapa(m: Omit<MapaDietaSgh, 'hospital'>): Promise<number>;
  registrarAcompanhante(a: Omit<DietaAcompanhanteSgh, 'hospital'>): Promise<number>;
  encerrarAcompanhante(a: { id: number; motivo: string; usuario: string }): Promise<number>;
  registrarSocial(a: Omit<AvaliacaoSocialSgh, 'hospital'>): Promise<{ id: number; barreira: number | null }>;
  /** Evento próprio a mais na SGH_TRILHA, na mesma transação. */
  registrarEvento(linha: LinhaTrilha): Promise<void>;
  // W0-05: a correção (retificação, estorno, nova versão e encerramento), a avaliação da NPT, o adendo social e a
  // alteração da refeição do acompanhante com o log.
  corrigir(x: Omit<CorrecaoNutricaoSgh, 'hospital'>): Promise<number>;
  avaliarNpt(x: Omit<AvaliacaoNptSgh, 'hospital'>): Promise<number>;
  adendoSocial(x: Omit<AdendoSocialSgh, 'hospital'>): Promise<number>;
  /** Devolve a refeição como estava, relida na transação (com a linha travada). */
  alterarAcompanhante(x: Omit<AlteracaoAcompanhanteSgh, 'hospital'>): Promise<AcompanhanteAnterior>;
  registrarAlteracao(x: Omit<AlteracaoHotSgh, 'hospital'>): Promise<number>;
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
  ): Promise<{ itens: InternadoNutricaoLido[]; cortada: boolean }>;
  internacao(c: ContextoNutricao, reg: number): Promise<(InternadoNutricaoLido & { aberta: boolean }) | null>;
  triagens(c: ContextoNutricao, regs: readonly number[]): Promise<TriagemSghLida[]>;
  comMeta(c: ContextoNutricao, regs: readonly number[]): Promise<Set<number>>;
  dietasEnterais(c: ContextoNutricao, atendimento: number, desde: string): Promise<DietaEnteralSghLida[]>;
  checagens(c: ContextoNutricao, itens: readonly number[], desde: string): Promise<ChecagemDietaLida[]>;
  primeiraAdministrada(c: ContextoNutricao, itens: readonly number[]): Promise<string | null>;
  terapia(
    c: ContextoNutricao,
    reg: number,
  ): Promise<{ metas: MetaTerapiaSghLida[]; acompanhamentos: AcompanhamentoSghLido[] }>;
  meta(c: ContextoNutricao, id: number): Promise<(MetaTerapiaSghLida & { reg: number }) | null>;
  fichas(c: ContextoNutricao, paciente: number): Promise<{ quantidade: number; ultima: string | null }>;
  sociais(c: ContextoNutricao, reg: number): Promise<RegistroSocialSghLido[]>;
  ultimosSociais(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, { risco: RiscoSocial; tipo: TipoRegistroSocial; em: string }>>;
  barreirasSociais(c: ContextoNutricao, regs: readonly number[]): Promise<Map<number, number>>;
  barreiras(c: ContextoNutricao, regs: readonly number[]): Promise<BarreiraLida[]>;
  unidades(c: ContextoNutricao): Promise<UnidadeInternacaoLida[]>;
  refeicoes(c: ContextoNutricao): Promise<RefeicaoDoCadastro[]>;
  itensDieta(
    c: ContextoNutricao,
    atendimentos: readonly number[],
    servirEm: string,
  ): Promise<ItemDietaMapaLido[]>;
  alergiasAlimentares(c: ContextoNutricao, pacientes: readonly number[]): Promise<Map<number, string[]>>;
  cirurgias(c: ContextoNutricao, de: string, ate: string): Promise<CirurgiaDaJanelaLida[]>;
  exames(
    c: ContextoNutricao,
    pronts: readonly number[],
    de: string,
    ate: string,
  ): Promise<ExameDaJanelaLido[]>;
  acompanhantesVigentes(
    c: ContextoNutricao,
    regs: readonly number[],
  ): Promise<Map<number, AcompanhanteSghLido>>;
  acompanhantes(c: ContextoNutricao, reg: number): Promise<AcompanhanteSghLido[]>;
  acompanhante(c: ContextoNutricao, id: number): Promise<AcompanhanteSghLido | null>;
  retrato(
    c: ContextoNutricao,
    unidade: string,
    refeicao: number,
    data: string,
  ): Promise<RetratoMapaLido | null>;
  // ── W0-05 ──
  /** As correções que inativam os registros e a versão que cada um substitui. */
  correcoes(
    c: ContextoNutricao,
    registro: RegistroCorrigivel,
    ids: readonly number[],
  ): Promise<{ inativa: Map<number, CorrecaoSghLida>; substitui: Map<number, number> }>;
  /** A internação do registro clínico (null se não existe). */
  internacaoDoRegistro(c: ContextoNutricao, registro: RegistroCorrigivel, id: number): Promise<number | null>;
  avaliacoesNpt(c: ContextoNutricao, reg: number): Promise<AvaliacaoNptLida[]>;
  /** O volume da parenteral por dia lido do balanço hídrico do atendimento desde o instante. */
  balancoParenteral(c: ContextoNutricao, atendimento: number, desde: string): Promise<VolumeBalanco[]>;
  /** O log das alterações da refeição do acompanhante. */
  alteracoesAcompanhante(c: ContextoNutricao, ids: readonly number[]): Promise<AlteracaoHotSghLida[]>;
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
