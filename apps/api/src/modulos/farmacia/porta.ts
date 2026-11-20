// Porta da farmácia hospitalar e da farmácia clínica (M29): o que as telas leem e gravam, independente de onde (a API
// não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas
//     suprimentos.dispensarHorario, confirmarEntrega, devolverDose e as P2, com a trilha na mesma transação); as só do
//     novo (avaliação, intervenção, conferência do controlado, livro, farmácia ambulatorial) em transação SGH_ com a
//     SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): unidades, internados, horários, doses e controlados SINTÉTICOS,
//     com as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AchadoAvaliacao,
  ClasseMedicamento,
  DecisaoAvaliacao,
  LivroMontado,
  TipoIntervencao,
} from '@sgh/contratos/regras-suprimentos';
import type {
  AvaliacaoSghLida,
  ControladoLido,
  DoseDispensadaRepo,
  DoseFilaLida,
  EntregaRepo,
  IntervencaoRepo,
  ItemEstoqueFarmacia,
  MovimentoControladoRepo,
  TriagemSgh,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_FARMACIA = Symbol('PORTA_FARMACIA');

export type ContextoFarmacia = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
export interface GravadorSghFarmacia {
  triar(t: { itens: readonly TriagemSgh[] }): Promise<{ novos: number }>;
  decidir(d: {
    item: number;
    decisao: DecisaoAvaliacao;
    justificativa: string;
    farmaceutico: string;
    triagem: TriagemSgh;
  }): Promise<{ id: number }>;
  intervir(i: { item: number; tipo: TipoIntervencao; texto: string; autor: string }): Promise<{
    id: number;
    prescritor: string | null;
  }>;
  responder(r: {
    id: number;
    resposta: 'aceita' | 'recusada';
    justificativa: string;
    respondente: string;
  }): Promise<void>;
  conferirControlado(c: {
    item: number;
    documento: { tipo: 'saida' | 'devolucao' | 'perda'; id: number };
    lote: string | null;
    quantidadeDocumento: number;
    quantidadeContada: number;
    justificativa: string;
    conferente: string;
    reautenticadoEm: number | null;
    agora: number;
  }): Promise<{ id: number }>;
  fecharLivro(f: {
    livro: LivroMontado;
    usuario: string;
    responsavelTecnico: boolean;
    chaveOficialLigada: boolean;
  }): Promise<{ id: number; hash: string; guardaAte: string }>;
  dispensarAmbulatorial(d: {
    paciente: number;
    item: number;
    lote: string;
    validade: string;
    quantidade: number;
    receitaNumero: string | null;
    receitaData: string | null;
    prescritor: number | null;
    autor: string;
    hoje: string;
  }): Promise<{ id: number }>;
  escriturarSngpc(s: {
    inicio: string;
    fim: string;
    autor: string;
  }): Promise<{ lote: number; dispensacoes: number }>;
}

export interface UnidadeLida {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}

export interface ParametrosIntegracaoLidos {
  readonly centros: readonly {
    centroCusto: number;
    nome: string;
    tipoPrescricao: number;
    tipoIntegracao: number;
    momento: number;
    tipoEnvio: number;
  }[];
  readonly horarios: readonly { codigo: string; valor: number }[];
  readonly validacaoFarmaceutica: boolean;
  readonly tipos: readonly { id: number; nome: string; ativo: boolean }[];
}

export interface DoseDaSaida {
  readonly dose: number;
  readonly item: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly barras: string | null;
  readonly lote: string | null;
  readonly validade: string | null;
}

export interface PortaFarmacia extends PortaGravacaoM18<GravadorSghFarmacia> {
  relogio(c: ContextoFarmacia): Promise<{ agora: Date; hoje: string }>;
  unidades(c: ContextoFarmacia): Promise<UnidadeLida[]>;
  filaDaUnidade(
    c: ContextoFarmacia,
    o: { unidade: string; inicio: Date; fim: Date },
  ): Promise<{ doses: DoseFilaLida[]; cortada: boolean }>;
  itens(c: ContextoFarmacia, codigos: readonly number[]): Promise<Map<number, ItemEstoqueFarmacia>>;
  avaliacoes(c: ContextoFarmacia, itens: readonly number[]): Promise<Map<number, AvaliacaoSghLida>>;
  itensPrescritos(
    c: ContextoFarmacia,
    lancamentos: readonly number[],
  ): Promise<Map<number, { alergiaJustificada: boolean; produto: number | null }>>;
  dosesDoAtendimento(c: ContextoFarmacia, reg: number, desde: Date): Promise<DoseDispensadaRepo[]>;
  situacoes(
    c: ContextoFarmacia,
    horarios: readonly number[],
  ): Promise<Map<number, { situacao: string; em: string | null }>>;
  entregas(c: ContextoFarmacia, o: { situacao: number; centroCusto?: number }): Promise<EntregaRepo[]>;
  dosesDaSaida(c: ContextoFarmacia, saida: number): Promise<DoseDaSaida[]>;
  leitos(
    c: ContextoFarmacia,
    regs: readonly number[],
  ): Promise<Map<number, { leito: string; iniciais: string }>>;
  aceites(
    c: ContextoFarmacia,
    controles: readonly number[],
  ): Promise<Map<number, { autor: string; em: string; modo: string }>>;
  intervencoesDosItens(c: ContextoFarmacia, itens: readonly number[]): Promise<IntervencaoRepo[]>;
  intervencoesDoPrescritor(c: ContextoFarmacia, login: string): Promise<IntervencaoRepo[]>;
  intervencao(c: ContextoFarmacia, id: number): Promise<IntervencaoRepo | null>;
  totaisIntervencoes(
    c: ContextoFarmacia,
    desde: Date,
  ): Promise<{ abertas: number; aceitas: number; recusadas: number }>;
  substituicoes(
    c: ContextoFarmacia,
    horarios: readonly number[],
  ): Promise<
    {
      id: number;
      horario: number | null;
      item: number;
      descricao: string;
      quantidade: number;
      unidade: string;
      usuario: string;
      em: string;
    }[]
  >;
  controlados(c: ContextoFarmacia): Promise<ControladoLido[]>;
  movimentos(
    c: ContextoFarmacia,
    o: { itens: readonly number[]; inicio: Date; fim: Date },
  ): Promise<MovimentoControladoRepo[]>;
  conferencias(
    c: ContextoFarmacia,
    desde: Date,
  ): Promise<{ item: number; docTipo: string; docId: number; tipo: string }[]>;
  livroFechado(
    c: ContextoFarmacia,
    livro: number,
    inicio: Date,
  ): Promise<{
    em: string;
    por: string;
    guardaAte: string;
    hash: string;
    conteudo: string;
    modo: string;
  } | null>;
  parametrosIntegracao(c: ContextoFarmacia): Promise<ParametrosIntegracaoLidos>;
  /** Os locais de estoque (a farmácia que dispensa escolhe o dela). */
  locais(c: ContextoFarmacia): Promise<{ codigo: number; nome: string }[]>;
  /** Os lotes com saldo do item no local (validade primeiro), para a dose rastreável. */
  lotes(
    c: ContextoFarmacia,
    item: number,
    local: number,
  ): Promise<{ id: number; lote: string; validade: string; quantidade: number }[]>;
  /** Desde quando a fila de entregas olha (o recorte pela PK do controle). */
  janelaEntregas(c: ContextoFarmacia): Promise<{ desde: string | null }>;
  ambulatoriais(
    c: ContextoFarmacia,
    desde: Date,
  ): Promise<
    {
      id: number;
      paciente: number;
      item: number;
      lote: string;
      quantidade: number;
      em: string;
      escriturada: boolean;
    }[]
  >;
}

export const METODOS_PORTA_FARMACIA: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'unidades',
  'filaDaUnidade',
  'itens',
  'avaliacoes',
  'itensPrescritos',
  'dosesDoAtendimento',
  'situacoes',
  'entregas',
  'dosesDaSaida',
  'leitos',
  'aceites',
  'intervencoesDosItens',
  'intervencoesDoPrescritor',
  'intervencao',
  'totaisIntervencoes',
  'substituicoes',
  'controlados',
  'movimentos',
  'conferencias',
  'livroFechado',
  'parametrosIntegracao',
  'locais',
  'lotes',
  'janelaEntregas',
  'ambulatoriais',
]);

export type { AchadoAvaliacao, ClasseMedicamento };
