// Porta do índice de pacientes da Rede (M57, etapa 1): o que a fila, a decisão, o desfazer, o pareamento e o
// relatório de divergência leem e gravam, por estabelecimento (a API não escreve SQL; fronteira). Cada chamada recebe o
// contexto de UM estabelecimento; o cruzamento entre estabelecimentos é do serviço, em memória.
//   - `proprio`: o banco do cliente pelo @sgh/nucleo;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com estabelecimentos SINTÉTICOS em memória;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: tipos próprios (tipos-indice.ts), sem nome de tabela do sistema de origem.
import type { LinhaTrilha } from '@sgh/nucleo';
import type { CadastroRedeLido, CandidatoParaGravarRede, CandidatoRedeLido, ChavesProcuraRede, EscritaIndiceRede, FiltroFilaRede, ParNovo, ResultadoEscritasIndice, VinculoRedeLido } from './tipos-indice.js';

export const PORTA_REDE = Symbol('PORTA_REDE');

/** Contexto de um banco: a rede da sessão e o estabelecimento cujo banco é lido ou gravado. */
export interface ContextoRede {
  readonly rede: string;
  readonly hospital: string;
}

export interface EstabelecimentoRede {
  readonly codigo: string;
  readonly nome: string;
}

export interface AtendimentosRede {
  readonly atendimentos: number;
  readonly ultimoAtendimento: string | null;
  readonly internacoes: number;
  readonly ultimaInternacao: string | null;
}

export interface MarcaRede {
  readonly ultimoId: number;
  readonly ultimaAtualizacao: string | null;
  /** O ID do último alterado lido no carimbo `ultimaAtualizacao` (keyset; 0: nenhum). */
  readonly ultimoIdAlterado?: number;
}

/** O recorte da fila na contagem por faixa (o mesmo da página). */
export type RecorteFilaRede = Pick<
  FiltroFilaRede,
  'estabelecimentoRemoto' | 'estabelecimentosRemotos' | 'prontuarioLocal'
>;

/** As gravações de UM banco, na transação que a porta abre (com a trilha junto). */
export interface GravadorRede {
  escritas(ws: readonly EscritaIndiceRede[]): Promise<ResultadoEscritasIndice>;
  candidatos(
    cs: readonly CandidatoParaGravarRede[],
  ): Promise<{ novos: number; atualizados: number; mantidos: number }>;
  marca(m: MarcaRede, por: string): Promise<void>;
  /** Regra 5: CPF repetido no mesmo estabelecimento vai à fila de duplicidades do cadastro (M11). */
  duplicidadesLocais(pares: readonly ParNovo[]): Promise<number>;
}

export interface PortaRede {
  readonly destino: 'proprio' | 'memoria' | 'indisponivel';
  /** A rede desta hospedagem (a sessão tem de ser dela; regra 12). */
  redeConfigurada(): string | null;
  /** Os estabelecimentos configurados (ARQ-1), com o nome de exibição. */
  estabelecimentos(): readonly EstabelecimentoRede[];
  cadastrosPorIds(c: ContextoRede, ids: readonly number[]): Promise<CadastroRedeLido[]>;
  procurarCandidatos(c: ContextoRede, chaves: ChavesProcuraRede): Promise<number[]>;
  loteCadastros(
    c: ContextoRede,
    depoisDoId: number,
    tamanho: number,
  ): Promise<{ itens: CadastroRedeLido[]; ultimoId: number }>;
  /** Os alterados depois do cursor (carimbo, ID), em ordem de carimbo e ID. */
  cadastrosAlterados(
    c: ContextoRede,
    desde: Date,
    depoisDoId: number,
    tamanho: number,
  ): Promise<CadastroRedeLido[]>;
  fila(c: ContextoRede, f: FiltroFilaRede): Promise<{ itens: CandidatoRedeLido[]; total: number }>;
  filaPorFaixa(
    c: ContextoRede,
    situacao: CandidatoRedeLido['situacao'],
    recorte?: RecorteFilaRede,
  ): Promise<{ alta: number; media: number; baixa: number }>;
  candidato(c: ContextoRede, chave: string): Promise<CandidatoRedeLido | null>;
  /** `reaberto`: aberto por uma pessoa que desfez o vínculo (o automático não religa). */
  situacoes(
    c: ContextoRede,
    chaves: readonly string[],
  ): Promise<Map<string, CandidatoRedeLido['situacao'] | 'reaberto'>>;
  vinculo(c: ContextoRede, chave: string): Promise<VinculoRedeLido | null>;
  vinculosDoCadastro(c: ContextoRede, id: number): Promise<VinculoRedeLido[]>;
  pessoasDosCadastros(c: ContextoRede, ids: readonly number[]): Promise<Map<number, string>>;
  loteVinculos(
    c: ContextoRede,
    depoisDoId: number,
    tamanho: number,
  ): Promise<{ itens: VinculoRedeLido[]; ultimoId: number }>;
  marca(c: ContextoRede): Promise<MarcaRede | null>;
  /**
   * Etapa 2 (o aviso no cabeçalho do paciente): só contagens e as datas mais recentes de atendimentos e internações de UM
   * prontuário do banco do contexto (nenhum conteúdo clínico).
   */
  atendimentos(c: ContextoRede, prontuario: number): Promise<AtendimentosRede>;
  /**
   * Correção do M57.2 (D-TRILHA-REMOTA-57): o CPF (só dígitos, 11) do login no banco do contexto, para provar que o
   * mesmo login é a mesma pessoa nos dois estabelecimentos (cada banco tem o seu cadastro de usuários); null: login
   * inexistente ou sem CPF lá. Nunca sai da API (só a comparação).
   */
  cpfDoLogin(c: ContextoRede, login: string): Promise<string | null>;
  /** Uma transação no banco do contexto, com a linha da trilha gravada junto (null: sem trilha). */
  gravar<T>(c: ContextoRede, fn: (g: GravadorRede) => Promise<T>, trilha: LinhaTrilha | null): Promise<T>;
}

export const METODOS_PORTA_REDE = [
  'cadastrosPorIds',
  'procurarCandidatos',
  'loteCadastros',
  'cadastrosAlterados',
  'fila',
  'filaPorFaixa',
  'candidato',
  'situacoes',
  'vinculo',
  'vinculosDoCadastro',
  'pessoasDosCadastros',
  'loteVinculos',
  'marca',
  'atendimentos',
  'cpfDoLogin',
  'gravar',
] as const satisfies readonly (keyof PortaRede)[];
