// Porta da notificação compulsória (M48, etapa 4): o cadastro de CID notificável, os atendimentos com CID, os óbitos, os
// resultados reagentes, o paciente, a unidade, os modelos e perguntas da ficha, os casos e os gatilhos de exame, com as
// gravações numa transação com a trilha junto. Três implementações: a própria sobre o MariaDB do cliente
// (porta-agravo-propria.ts), em memória (dev/ci e os testes; dados sintéticos) e a indisponível (503).
import type {
  AtendimentoComCid,
  AtendimentoParaAgravo,
  CasoAgravoNovo,
  CasoAgravoRegistrado,
  CidNotificavelCadastro,
  ExameParaAgravo,
  FiltroCasosAgravo,
  GatilhoExameRegistrado,
  ObitoComCid,
  PacienteDoAgravo,
  ResultadoCandidato,
  UnidadeDoAgravo,
} from './tipos.js';
import { type ContextoPortaM18, type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';

export const PORTA_AGRAVO = Symbol('PORTA_AGRAVO');

export type ContextoAgravo = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (as regras puras conferidas antes, na API). */
export interface GravadorAgravo {
  abrirCaso(c: SemHospital<CasoAgravoNovo>): Promise<{ id: number }>;
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
  cidsNotificaveis(c: C): Promise<CidNotificavelCadastro[]>;
  cidDoCadastro(c: C, cid: string): Promise<{ cid: string; nome: string; codigoCadastro: number } | null>;
  atendimentosComCid(c: C, desde: string): Promise<{ itens: AtendimentoComCid[]; cortado: boolean }>;
  obitos(c: C, desde: string): Promise<ObitoComCid[]>;
  resultados(
    c: C,
    desde: string,
    padroes: readonly string[],
    termos: readonly string[],
  ): Promise<{ itens: ResultadoCandidato[]; cortado: boolean }>;
  atendimento(c: C, id: number): Promise<AtendimentoParaAgravo | null>;
  declaracaoObito(c: C, atendimento: number): Promise<string | null>;
  exame(c: C, id: number): Promise<ExameParaAgravo | null>;
  pacientes(c: C, ids: readonly number[]): Promise<Map<number, PacienteDoAgravo>>;
  unidades(c: C): Promise<Map<number, UnidadeDoAgravo>>;
  modelosFicha(c: C): Promise<{ id: number; nome: string }[]>;
  perguntasFicha(c: C, modelo: number): Promise<{ codigo: number; subcodigo: number; texto: string }[]>;
  caso(c: C, id: number): Promise<CasoAgravoRegistrado | null>;
  casos(c: C, f: FiltroCasosAgravo): Promise<{ itens: CasoAgravoRegistrado[]; total: number }>;
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
  gatilhosExame(c: C): Promise<GatilhoExameRegistrado[]>;
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

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAgravoIndisponivel(): PortaAgravo {
  return portaIndisponivel<PortaAgravo>(METODOS_PORTA_AGRAVO);
}
