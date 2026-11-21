// Porta do balanço hídrico (M45, etapa 3; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (balanco-porta-propria.ts: balanco_hidrico_paciente,
//     balanco_lancamento e balanco_fechamento), com as gravações pelo Executor e a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): os internados e as checagens da enfermagem em memória, mais uma
//     checagem e os sinais SINTÉTICOS da janela anterior, com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { DominiosBalanco, FechamentoBalancoLido, LancamentoBalancoLido } from '@sgh/contratos';
import type {
  ChecagemParaBalanco,
  NovoFechamentoBalanco,
  Internado,
  NovoLancamentoBalanco,
  SinaisParaBalanco,
} from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_BALANCO = Symbol('PORTA_BALANCO');

export type ContextoBalanco = ContextoPortaM18;

/** Gravações numa transação com a trilha_auditoria junto. */
export interface GravadorBalanco {
  lancar(
    l: Omit<NovoLancamentoBalanco, 'hospital'> & { readonly janelaInicio: string },
  ): Promise<{ id: number; repetida: boolean }>;
  estornar(x: {
    readonly atendimento: number;
    readonly id: number;
    readonly motivo: string;
    readonly usuario: string;
    readonly janelaInicio: (horaReal: string) => string;
  }): Promise<number>;
  fechar(f: Omit<NovoFechamentoBalanco, 'hospital'>): Promise<{ id: number; importados: number[] }>;
}

export interface PortaBalanco extends PortaGravacaoM18<GravadorBalanco> {
  /** O relógio do banco do estabelecimento (AAAA-MM-DDTHH:mm:ss, hora local). */
  relogio(c: ContextoBalanco): Promise<string>;
  internado(c: ContextoBalanco, atendimento: number): Promise<Internado | null>;
  /** A entrada do atendimento (AAAA-MM-DDTHH:mm; nula sem a data): o lançamento de antes dela é recusado. */
  entrada(c: ContextoBalanco, atendimento: number): Promise<string | null>;
  dominios(c: ContextoBalanco): Promise<DominiosBalanco>;
  checagens(
    c: ContextoBalanco,
    o: { atendimento: number; de: string; ate: string },
  ): Promise<{ itens: ChecagemParaBalanco[]; cortada: boolean }>;
  lancamentos(
    c: ContextoBalanco,
    o: { atendimento: number; de: string; ate: string },
  ): Promise<{ itens: LancamentoBalancoLido[]; cortada: boolean }>;
  lancamento(
    c: ContextoBalanco,
    id: number,
  ): Promise<(LancamentoBalancoLido & { readonly atendimento: number }) | null>;
  origensLancadas(
    c: ContextoBalanco,
    o: { horarios: readonly number[]; sinais: readonly number[] },
  ): Promise<{ horarios: Set<number>; sinais: Set<number> }>;
  fechamentos(c: ContextoBalanco, atendimento: number): Promise<FechamentoBalancoLido[]>;
  sinais(c: ContextoBalanco, o: { paciente: number; de: string; ate: string }): Promise<SinaisParaBalanco>;
}

export const METODOS_PORTA_BALANCO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'internado',
  'entrada',
  'dominios',
  'checagens',
  'lancamentos',
  'lancamento',
  'origensLancadas',
  'fechamentos',
  'sinais',
]);
