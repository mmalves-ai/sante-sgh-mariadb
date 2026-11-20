// Porta da manipulação (M46, etapa 4; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `legado`: as leituras READ ONLY (os itens validados a manipular, as ordens, as capelas e os grupos); a abertura e a
//     conferência numa transação SGH_ com a SGH_TRILHA junto (a ordem relida e travada na MESMA transação); a baixa do
//     insumo pelo EXECUTOR do M04 (suprimentos.registrarSaida com o bloco `manipulacao`, a ordem ligada no registro
//     próprio da mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O insumo, o saldo, os lotes, os locais e os centros de custo vêm da porta do estoque (M28).
import type { CapelaManipulacao, ItemAManipular, OrdemManipulacao } from '@sgh/contratos';
import type { ConferenciaManipulacaoSgh, OrdemManipulacaoSgh } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_MANIPULACAO = Symbol('PORTA_MANIPULACAO');

type SemHospital<T> = Omit<T, 'hospital'>;

export interface AvaliacaoDoItem {
  readonly id: number;
  readonly estado: string;
  readonly decisao: string | null;
  readonly reg: number;
  readonly produto: number | null;
}

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorManipulacao {
  /** A ordem relida na transação (travada até o fim), ou null. */
  ordem(id: number): Promise<OrdemManipulacao | null>;
  ordemPelaChave(chave: string): Promise<OrdemManipulacao | null>;
  avaliacao(itemPrescrito: number): Promise<AvaliacaoDoItem | null>;
  ordemEmCurso(itemPrescrito: number): Promise<boolean>;
  abrir(o: SemHospital<OrdemManipulacaoSgh>): Promise<{ id: number; versao: number; repetida: boolean }>;
  conferir(c: SemHospital<ConferenciaManipulacaoSgh>): Promise<{ versao: number }>;
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
  'vinculos',
]);
