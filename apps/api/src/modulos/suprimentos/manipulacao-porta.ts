// Porta da manipulação (M46, etapa 4), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (manipulacao-porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O insumo, o saldo, os lotes, os locais e os centros de custo vêm da porta do estoque (M28).
// Melhoria: a ordem nova e a conferência são tipos de negócio do módulo (sem o tipo do sistema de origem).
import type {
  CapelaManipulacao,
  ItemAManipular,
  OrdemManipulacao,
  SituacaoManipulacao,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_MANIPULACAO = Symbol('PORTA_MANIPULACAO');

/** A ordem de manipulação a abrir. */
export interface NovaOrdemManipulacao {
  readonly itemPrescrito: number;
  readonly avaliacao: number;
  /** O atendimento do paciente. */
  readonly reg: number;
  readonly produto: number | null;
  readonly capela: number;
  readonly grupo: number | null;
  readonly insumo: number;
  readonly local: number;
  readonly loteInsumo: string;
  readonly validadeInsumo: string;
  readonly quantidade: number;
  readonly dose: string | null;
  readonly validadeSobra: string | null;
  /** AAAA-MM-DDTHH:mm (o preparo). */
  readonly em: string;
  readonly usuario: string;
  readonly chave: string;
}

/** A dupla conferência da ordem. */
export interface ConferenciaDaManipulacao {
  readonly ordem: number;
  readonly versaoVista: number;
  readonly situacao: SituacaoManipulacao;
  readonly observacao: string | null;
  /** AAAA-MM-DDTHH:mm */
  readonly em: string;
  readonly usuario: string;
}

export interface AvaliacaoDoItem {
  readonly id: number;
  readonly estado: string;
  readonly decisao: string | null;
  readonly reg: number;
  readonly produto: number | null;
}

/** Gravações diretas, numa transação com a trilha junto; as leituras aqui são da mesma transação. */
export interface GravadorManipulacao {
  /** A ordem relida na transação (travada até o fim), ou null. */
  ordem(id: number): Promise<OrdemManipulacao | null>;
  ordemPelaChave(chave: string): Promise<OrdemManipulacao | null>;
  avaliacao(itemPrescrito: number): Promise<AvaliacaoDoItem | null>;
  ordemEmCurso(itemPrescrito: number): Promise<boolean>;
  abrir(o: NovaOrdemManipulacao): Promise<{ id: number; versao: number; repetida: boolean }>;
  conferir(c: ConferenciaDaManipulacao): Promise<{ versao: number }>;
}

export interface PortaManipulacao extends PortaGravacaoM18<GravadorManipulacao> {
  itensAManipular(c: ContextoPortaM18, desde: string): Promise<{ itens: ItemAManipular[]; cortada: boolean }>;
  avaliacao(c: ContextoPortaM18, itemPrescrito: number): Promise<AvaliacaoDoItem | null>;
  ordens(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: OrdemManipulacao[]; cortada: boolean }>;
  ordem(c: ContextoPortaM18, id: number): Promise<OrdemManipulacao | null>;
  capelas(c: ContextoPortaM18): Promise<CapelaManipulacao[]>;
  /** Hoje e a hora (HHMM) no fuso do estabelecimento: a manipulação não depende do centro cirúrgico (ADR 0002). */
  relogio(c: ContextoPortaM18): Promise<{ hoje: string; hhmm: string }>;
  /** Os vínculos profissionais do login (o CBO): a dupla conferência é do farmacêutico (revisão do M46.4). */
  vinculos(c: ContextoPortaM18, login: string): Promise<{ vinculo: number; cbo: string; ativo: boolean }[]>;
}

export const METODOS_PORTA_MANIPULACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'itensAManipular',
  'avaliacao',
  'ordens',
  'ordem',
  'capelas',
  'relogio',
  'vinculos',
]);
