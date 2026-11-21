// Porta da escala de plantão, fatia F2 (M52.2; ficha, seções 4 e 6): o que as telas de escala e de regimes leem e
// gravam, independente de onde (a API não escreve SQL; fronteira Nx). O colaborador, o profissional e a validade do
// conselho vêm da porta da gestão de pessoas (F1); aqui, os regimes, a escala, os plantões e o histórico da escala.
// Fatia F3 (M52.3): as trocas, o instante ("quem está de plantão agora"), os acionamentos do sobreaviso e o
// dimensionamento, com a classificação de pacientes só pela categoria e pelo total.
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-escala-propria.ts): leituras somente leitura filtradas
//     pelo estabelecimento da sessão; as gravações numa operação do Executor (trilha, outbox e idempotência juntas);
//     a Rede são os outros estabelecimentos do mesmo cliente (o colaborador é do cliente inteiro);
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import {
  type CamposRegimeJornada,
  type ClassificacaoDoTurno,
  type DadosDimensionamento,
  type DadosEventoEscala,
  type DadosMudancaPlantao,
  type DadosNovaEscala,
  type DadosNovaTroca,
  type DadosNovoAcionamento,
  type DadosNovoPlantao,
  type DependenciaContada,
  type EventoPeriodoPonto,
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
  type UnidadeInternacaoOcupada,
} from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_ESCALA = Symbol('PORTA_ESCALA');

export type ContextoEscala = ContextoPortaM18;

/** Janela de busca dos plantões: os que tocam [de, ate), com o início desde `inicioDesde` (24 h antes de `de`). */
export interface JanelaPlantoes {
  readonly de: string;
  readonly ate: string;
  readonly inicioDesde: string;
}

/** Os plantões da mesma pessoa nos outros estabelecimentos da Rede (regra 7): só os intervalos. */
export interface PlantoesDaRede {
  readonly intervalos: readonly { readonly inicio: string; readonly fim: string }[];
  readonly semResposta: number;
}

type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações da F2 numa transação (operação do Executor), com as releituras dentro dela (o estabelecimento vem do contexto). */
export interface GravadorEscala {
  escala(id: number): Promise<RegistroEscala | null>;
  plantao(id: number): Promise<RegistroPlantao | null>;
  plantoesDaEscala(escala: number): Promise<RegistroPlantao[]>;
  plantoesDaPessoa(pessoa: number, janela: JanelaPlantoes): Promise<RegistroPlantao[]>;
  /** Trava os vínculos da pessoa até o fim da transação (inclusões simultâneas da mesma pessoa). */
  travarPessoa(pessoa: number): Promise<void>;
  regime(id: number): Promise<RegistroRegime | null>;
  incluirRegime(r: CamposRegimeJornada & { readonly por: string }): Promise<number>;
  alterarRegime(
    r: CamposRegimeJornada & { readonly id: number; readonly versao: number; readonly por: string },
  ): Promise<void>;
  atribuirRegime(a: {
    readonly vinculo: number;
    readonly regime: number;
    readonly desde: string;
    readonly por: string;
  }): Promise<number>;
  incluirEscala(s: SemHospital<DadosNovaEscala>): Promise<number>;
  alterarCobertura(c: {
    readonly id: number;
    readonly versao: number;
    readonly cobertura: { readonly manha: number; readonly tarde: number; readonly noite: number };
    readonly por: string;
  }): Promise<void>;
  tocarEscala(t: { readonly id: number; readonly estado: string; readonly por: string }): Promise<void>;
  publicarEscala(p: {
    readonly id: number;
    readonly versao: number;
    readonly justificativaFuro: string | null;
    readonly por: string;
  }): Promise<void>;
  incluirPlantao(p: SemHospital<DadosNovoPlantao>): Promise<number>;
  alterarPlantao(m: SemHospital<DadosMudancaPlantao>): Promise<void>;
  cancelarPlantao(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string | null;
    readonly por: string;
  }): Promise<void>;
  evento(ev: SemHospital<DadosEventoEscala>): Promise<number>;
  /** Evento na integracao_mensagem, na mesma transação (a F3 consome a publicação e as mudanças). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
  // ── F3 (M52.3): troca, acionamento e dimensionamento ──
  troca(id: number): Promise<RegistroTroca | null>;
  plantoesEmTrocaAberta(plantoes: readonly number[]): Promise<Set<number>>;
  incluirTroca(t: SemHospital<DadosNovaTroca>): Promise<number>;
  responderTroca(r: {
    readonly id: number;
    readonly versao: number;
    readonly estado: 'aceita' | 'recusada';
    readonly confirmacao: string | null;
    readonly por: string;
  }): Promise<void>;
  decidirTroca(d: {
    readonly id: number;
    readonly versao: number;
    readonly estado: 'aprovada' | 'reprovada';
    readonly motivo: string | null;
    readonly por: string;
  }): Promise<void>;
  cancelarTroca(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  /** Na aprovação da troca: o plantão passa ao novo colaborador, com a versão lida. */
  transferirPlantao(t: {
    readonly id: number;
    readonly versao: number;
    readonly vinculo: number;
    readonly pessoa: number;
    readonly profissional: number | null;
    readonly registro: number | null;
    readonly alertaConselho: string | null;
    readonly redeNaoConferida: boolean;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  acionamento(id: number): Promise<RegistroAcionamento | null>;
  acionamentosDosPlantoes(plantoes: readonly number[]): Promise<RegistroAcionamento[]>;
  incluirAcionamento(a: SemHospital<DadosNovoAcionamento>): Promise<number>;
  registrarChegada(c: {
    readonly id: number;
    readonly versao: number;
    readonly chegouEm: string;
    readonly por: string;
  }): Promise<void>;
  cancelarAcionamento(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  incluirDimensionamento(d: SemHospital<DadosDimensionamento>): Promise<number>;
  // ── W0-06 (programa CRUD completo) ──
  /** As dependências (não próprias) da escala, contadas na transação (mapa de dependências da gestão de pessoas). */
  dependenciasEscala(escala: number): Promise<DependenciaContada[]>;
  /** Exclui o rascunho (versão lida) sem vínculo, com o retrato de cada linha antes do DELETE. */
  excluirEscalaRascunho(x: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<{ retratos: number; plantoes: number }>;
  /** Cancela a publicada (versão lida) com motivo; devolve os plantões previstos cancelados. */
  cancelarEscala(x: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<number>;
  historicoVigencias(vinculo: number): Promise<RegistroVigenciaHistorico[]>;
  anularVigencia(a: { readonly id: number; readonly motivo: string; readonly por: string }): Promise<void>;
  /**
   * Revisão W0-06: os eventos de período do ponto do vínculo lidos na MESMA transação (depois de travar a pessoa,
   * a mesma trava do fechamento). `null`: a porta não tem o ponto (memória); o serviço lê pela porta do ponto.
   */
  eventosPeriodo(vinculo: number): Promise<EventoPeriodoPonto[] | null>;
}

export interface PortaEscala extends PortaGravacaoM18<GravadorEscala> {
  /**
   * A porta grava e lê a cobertura mínima por turno. Falso no banco até o DDL (pedido 03-04): a criação com cobertura
   * e a alteração respondem 409, e a publicação avisa que a conferência de furo não foi feita.
   */
  readonly coberturaRegistrada: boolean;
  tiposJornada(c: ContextoEscala): Promise<OpcaoDominioEscala[]>;
  temposParciais(c: ContextoEscala): Promise<OpcaoTempoParcial[]>;
  tiposTrabalhoFolga(c: ContextoEscala): Promise<OpcaoDominioEscala[]>;
  regimes(c: ContextoEscala): Promise<RegistroRegime[]>;
  regime(c: ContextoEscala, id: number): Promise<RegistroRegime | null>;
  vigencias(c: ContextoEscala, vinculos: readonly number[]): Promise<RegistroVigencia[]>;
  escalas(c: ContextoEscala, f: FiltroRegistrosEscala): Promise<RegistroEscala[]>;
  escala(c: ContextoEscala, id: number): Promise<RegistroEscala | null>;
  plantoesDaEscala(c: ContextoEscala, escala: number): Promise<RegistroPlantao[]>;
  plantoesDaPessoa(c: ContextoEscala, pessoa: number, janela: JanelaPlantoes): Promise<RegistroPlantao[]>;
  eventos(c: ContextoEscala, escala: number): Promise<RegistroEventoEscala[]>;
  /**
   * Regra 7: os plantões da pessoa do vínculo nos OUTROS estabelecimentos da Rede (pelo HMAC do CPF). Só os que a porta
   * conhece (HS-1, no núcleo) e que `liberado` aceitar são consultados (D-ESCALA-REDE-52): um estabelecimento fora disso
   * não é lido nem conta como sem resposta.
   */
  plantoesNaRede(
    c: ContextoEscala,
    vinculo: number,
    janela: JanelaPlantoes,
    liberado?: (estabelecimento: string) => Promise<boolean>,
  ): Promise<PlantoesDaRede>;
  // ── F3 (M52.3) ──
  plantao(c: ContextoEscala, id: number): Promise<RegistroPlantao | null>;
  trocas(c: ContextoEscala, f: FiltroRegistrosTroca): Promise<RegistroTroca[]>;
  troca(c: ContextoEscala, id: number): Promise<RegistroTroca | null>;
  plantoesEmTrocaAberta(c: ContextoEscala, plantoes: readonly number[]): Promise<Set<number>>;
  /** Os plantões previstos da escala publicada em curso no instante (o início nas 24 h antes; regra 10). */
  plantoesNoInstante(
    c: ContextoEscala,
    instante: string,
    inicioDesde: string,
    f: FiltroPlantaoNoInstante,
  ): Promise<RegistroPlantaoNoInstante[]>;
  acionamentos(c: ContextoEscala, plantoes: readonly number[]): Promise<RegistroAcionamento[]>;
  acionamento(c: ContextoEscala, id: number): Promise<RegistroAcionamento | null>;
  dimensionamentos(c: ContextoEscala, f: { readonly unidade?: number }): Promise<RegistroDimensionamento[]>;
  /** As unidades de internação com a contagem de internados (só a contagem; nada do paciente). */
  unidadesInternacao(c: ContextoEscala): Promise<UnidadeInternacaoOcupada[]>;
  /** A classificação de pacientes do turno (M45), para o dimensionamento: só a categoria e o total. */
  classificacoesDoTurno(
    c: ContextoEscala,
    unidadeInternacao: string,
    data: string,
    turno: string,
  ): Promise<readonly Pick<ClassificacaoDoTurno, 'paciente' | 'instrumento' | 'categoria' | 'total'>[]>;
  // ── W0-06 ──
  dependenciasEscala(c: ContextoEscala, escala: number): Promise<DependenciaContada[]>;
  /** Todas as vigências do vínculo, as anuladas inclusive (o histórico da tela). */
  historicoVigencias(c: ContextoEscala, vinculo: number): Promise<RegistroVigenciaHistorico[]>;
  vigencia(c: ContextoEscala, id: number): Promise<RegistroVigenciaHistorico | null>;
}

/** D-ESCALA-REDE-52: dos outros estabelecimentos, só os liberados (falha fechada: erro na conferência = não liberado). */
export async function soLiberados(
  lista: readonly string[],
  liberado?: (estabelecimento: string) => Promise<boolean>,
): Promise<readonly string[]> {
  if (!liberado) return lista;
  const ok = await Promise.all(lista.map((h) => liberado(h).catch(() => false)));
  return lista.filter((_h, i) => ok[i]);
}

export const METODOS_PORTA_ESCALA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'tiposJornada',
  'temposParciais',
  'tiposTrabalhoFolga',
  'regimes',
  'regime',
  'vigencias',
  'escalas',
  'escala',
  'plantoesDaEscala',
  'plantoesDaPessoa',
  'eventos',
  'plantoesNaRede',
  'plantao',
  'trocas',
  'troca',
  'plantoesEmTrocaAberta',
  'plantoesNoInstante',
  'acionamentos',
  'acionamento',
  'dimensionamentos',
  'unidadesInternacao',
  'classificacoesDoTurno',
  'dependenciasEscala',
  'historicoVigencias',
  'vigencia',
]);
