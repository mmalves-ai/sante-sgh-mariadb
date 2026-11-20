// Porta da notificação compulsória (M48, etapa 4; ADR 0031): as leituras do outro sistema (cadastro de CID notificável,
// atendimentos com CID, óbitos, resultados reagentes, paciente, unidade, modelos e perguntas da ficha) e das SGH_ (a
// declaração de óbito do M23, os casos e os gatilhos de exame do 0484), e as gravações só do novo (SGH_QUA_AGRAVO_*)
// numa transação SGH_ com a SGH_TRILHA junto. Duas implementações: sobre o núcleo do legado (a cópia) e em memória
// (dev/ci e os testes; dados sintéticos).
import type {
  AtendimentoComCidLido,
  AtendimentoParaAgravo,
  CasoAgravoSgh,
  CasoAgravoSghLido,
  CidNotificavelLido,
  ExameParaAgravo,
  FiltroCasosAgravoSgh,
  GatilhoExameSghLido,
  ObitoComCidLido,
  PacienteAgravoLido,
  ResultadoCandidatoLido,
  UnidadeAgravoLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_AGRAVO = Symbol('PORTA_AGRAVO');

export type ContextoAgravo = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (as regras puras conferidas antes, na API). */
export interface GravadorAgravo {
  abrirCaso(c: SemHospital<CasoAgravoSgh>): Promise<{ id: number }>;
  registrarNotificacao(r: {
    readonly id: number;
    readonly versao: number;
    readonly autoridade: 'SMS' | 'SES' | 'MS';
    readonly canal: string;
    readonly numero: string | null;
    readonly notificadoEm: string;
    readonly recebidoPor: string | null;
    readonly observacao: string | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  descartarCaso(r: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly justificativa: string;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  configurarGatilhoExame(g: {
    readonly id: number | null;
    readonly versao: number | null;
    readonly padrao: string;
    readonly exceto: string | null;
    readonly cid: string;
    readonly ativo: boolean;
    readonly usuario: string;
  }): Promise<{ id: number; versao: number; criado: boolean }>;
}

type C = ContextoAgravo;

export interface PortaAgravo extends PortaGravacaoM18<GravadorAgravo> {
  /** O relógio do banco do estabelecimento (instante local `AAAA-MM-DDTHH:mm:ss`). */
  relogio(c: C): Promise<string>;
  cidsNotificaveis(c: C): Promise<CidNotificavelLido[]>;
  cidDoCadastro(c: C, cid: string): Promise<{ cid: string; nome: string; codigoCadastro: number } | null>;
  atendimentosComCid(c: C, desde: string): Promise<{ itens: AtendimentoComCidLido[]; cortado: boolean }>;
  obitos(c: C, desde: string): Promise<ObitoComCidLido[]>;
  resultados(
    c: C,
    desde: string,
    padroes: readonly string[],
    termos: readonly string[],
  ): Promise<{ itens: ResultadoCandidatoLido[]; cortado: boolean }>;
  atendimento(c: C, id: number): Promise<AtendimentoParaAgravo | null>;
  declaracaoObito(c: C, atendimento: number): Promise<string | null>;
  exame(c: C, id: number): Promise<ExameParaAgravo | null>;
  pacientes(c: C, ids: readonly number[]): Promise<Map<number, PacienteAgravoLido>>;
  unidades(c: C): Promise<Map<number, UnidadeAgravoLida>>;
  modelosFicha(c: C): Promise<{ id: number; nome: string }[]>;
  perguntasFicha(c: C, modelo: number): Promise<{ codigo: number; subcodigo: number; texto: string }[]>;
  caso(c: C, id: number): Promise<CasoAgravoSghLido | null>;
  casos(c: C, f: FiltroCasosAgravoSgh): Promise<{ itens: CasoAgravoSghLido[]; total: number }>;
  casosDesde(
    c: C,
    desde: string,
  ): Promise<
    {
      origem: string;
      atendimento: number | null;
      exame: number | null;
      paciente: number;
      cid: string;
      situacao: string;
      gatilhoEm: string;
    }[]
  >;
  contagem(
    c: C,
    agora: string,
    inicioDoMes: string,
  ): Promise<{ abertos: number; imediatosAbertos: number; vencidos: number; notificadosNoMes: number }>;
  gatilhosExame(c: C): Promise<GatilhoExameSghLido[]>;
}

/** Os métodos da porta (a porta indisponível recusa todos). */
export const METODOS_PORTA_AGRAVO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'cidsNotificaveis',
  'cidDoCadastro',
  'atendimentosComCid',
  'obitos',
  'resultados',
  'atendimento',
  'declaracaoObito',
  'exame',
  'pacientes',
  'unidades',
  'modelosFicha',
  'perguntasFicha',
  'caso',
  'casos',
  'casosDesde',
  'contagem',
  'gatilhosExame',
]);
