// Porta do pós-fechamento (M31): o que as telas de guias, lotes, protocolo, prazos, competências, demonstrativos,
// retorno e glosa, webservices e o painel leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas
//     faturamento.*, com a trilha na mesma transação); as só do novo (demonstrativo, decisão da glosa, endpoint e
//     mensagens) em transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): contas, lotes, itens e demonstrativos SINTÉTICOS em memória, com
//     as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  CompetenciaLida,
  ConfiguracaoTissLida,
  ContaProntaLote,
  DecidirGlosaEntrada,
  DemonstrativoLido,
  EditarEndpointTissEntrada,
  EvidenciaGlosaLida,
  GradeGlosa,
  GuiaLida,
  ItemDemonstrativo,
  ItemDemonstrativoLido,
  ItemGlosaLido,
  ListaLotes,
  LoteDetalhe,
  MotivoGlosaLido,
  PainelGlosa,
  PrazoEnvio,
} from '@sgh/contratos';
import type { LinhaContasCompetencia } from '@sgh/contratos/regras-faturamento';
import type {
  FiltroContasLote,
  FiltroGlosa,
  FiltroLotes,
  LotesDaCompetencia,
  MensagemTissRegistro,
  RepasseDoMes,
  TitulosDoMes,
  UsoPorGrupo,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_TISS = Symbol('PORTA_TISS');

export type ContextoTiss = ContextoPortaM18;

export interface ImportacaoPorta {
  readonly usuario: string;
  readonly lote: number;
  readonly tipo: 'analise' | 'pagamento';
  readonly origem: 'xml' | 'digitacao';
  readonly numero: string;
  readonly dataEmissao: string;
  readonly itens: readonly ItemDemonstrativo[];
  readonly hashArquivo: string | null;
  readonly chaveObjeto: string | null;
}

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
export interface GravadorSghTiss {
  importarDemonstrativo(
    d: ImportacaoPorta,
  ): Promise<{ id: number; repetido: boolean; casados: number; semCasamento: number }>;
  decidirGlosa(
    d: DecidirGlosaEntrada & { usuario: string; prazo: string | null },
  ): Promise<{ id: number; estado: string; conta: number; glosa: number }>;
  editarEndpoint(d: EditarEndpointTissEntrada & { usuario: string }): Promise<{ id: number }>;
  registrarMensagem(m: Omit<MensagemTissRegistro, 'hospital'>): Promise<{ id: number }>;
}

/** M42: o que o painel "Acompanhamento da competência" lê (cada bloco só quando a sessão tem a leitura do setor). */
export interface FiltroAcompanhamentoPorta {
  readonly ano: number;
  readonly mes: number;
  readonly convenio: number | null;
  /** Escopo por convênio da sessão (null = sem restrição). */
  readonly convenios: readonly number[] | null;
  /** Operações da onda contadas na trilha própria. */
  readonly operacoes: readonly string[];
  readonly titulos: boolean;
  /**
   * Contas bancárias (TBCTABAN.ID) do escopo do usuário para o movimento (regra 15 do M32, MFCTAUSU): null = todas;
   * lista vazia = nenhuma.
   */
  readonly contasBancarias: readonly number[] | null;
  readonly repasse: boolean;
  /** Grupos acompanhados e o dia desde quando contar a conexão (null: sem a leitura da migração). */
  readonly uso: { readonly grupos: readonly string[]; readonly desde: string } | null;
}

export interface LeituraAcompanhamento {
  readonly contas: readonly LinhaContasCompetencia[];
  readonly lotes: LotesDaCompetencia;
  readonly titulos: TitulosDoMes | null;
  readonly repasse: RepasseDoMes | null;
  readonly gravacoes: readonly { operacao: string; peloNovo: number }[];
  readonly uso: readonly UsoPorGrupo[] | null;
}

export interface PortaTiss extends PortaGravacaoM18<GravadorSghTiss> {
  /** M42: as leituras do acompanhamento da competência (só agregados, READ ONLY). */
  acompanhamento(c: ContextoTiss, f: FiltroAcompanhamentoPorta): Promise<LeituraAcompanhamento>;
  /** M42: as contas bancárias do escopo do usuário (a mesma regra do movimento do M32; null = todas). */
  contasBancariasDoEscopo(c: ContextoTiss, usuarioLegado: string | null): Promise<number[] | null>;
  hoje(c: ContextoTiss): Promise<string>;
  convenios(c: ContextoTiss): Promise<{ codigo: number; nome: string }[]>;
  contasProntas(c: ContextoTiss, f: FiltroContasLote): Promise<ContaProntaLote[]>;
  guias(
    c: ContextoTiss,
    f: {
      convenio: number | null;
      ano: number | null;
      mes: number | null;
      convenios: readonly number[] | null;
    },
  ): Promise<GuiaLida[]>;
  lotes(c: ContextoTiss, f: FiltroLotes): Promise<ListaLotes>;
  lote(c: ContextoTiss, id: number, hoje: string): Promise<LoteDetalhe | null>;
  convenioDoLote(c: ContextoTiss, id: number): Promise<number | null>;
  situacoesProtocolo(c: ContextoTiss): Promise<{ id: number; nome: string }[]>;
  prazos(
    c: ContextoTiss,
    o: { hoje: string; paradoDias: number; prazoRecurso: string; convenios: readonly number[] | null },
  ): Promise<PrazoEnvio[]>;
  competencias(
    c: ContextoTiss,
    f: { convenio: number | null; ano: number | null; convenios: readonly number[] | null },
  ): Promise<CompetenciaLida[]>;
  resumoCompetencia(
    c: ContextoTiss,
    x: { convenio: number; ano: number; mes: number },
  ): Promise<CompetenciaLida>;
  motivos(c: ContextoTiss): Promise<MotivoGlosaLido[]>;
  grade(c: ContextoTiss, f: FiltroGlosa): Promise<GradeGlosa>;
  itensDaConta(c: ContextoTiss, conta: number, prazo: string): Promise<ItemGlosaLido[]>;
  /** A evidência do prontuário da decisão de recorrer (só pela rota auditada). */
  evidenciaDoItem(c: ContextoTiss, item: number): Promise<EvidenciaGlosaLida | null>;
  convenioDaConta(c: ContextoTiss, conta: number): Promise<number | null>;
  contaDoItem(c: ContextoTiss, item: number): Promise<{ conta: number; convenio: number } | null>;
  demonstrativos(
    c: ContextoTiss,
    f: { lote: number | null; convenios: readonly number[] | null },
  ): Promise<DemonstrativoLido[]>;
  demonstrativo(
    c: ContextoTiss,
    id: number,
  ): Promise<{ lote: number; convenio: number; itens: ItemDemonstrativoLido[] } | null>;
  configuracao(c: ContextoTiss): Promise<ConfiguracaoTissLida>;
  painel(
    c: ContextoTiss,
    f: { de: string; ate: string; convenios: readonly number[] | null },
  ): Promise<PainelGlosa>;
  xmlDoLote(
    c: ContextoTiss,
    lote: number,
  ): Promise<{ chave: string; hashArquivo: string; convenio: number } | null>;
}

export const METODOS_PORTA_TISS: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'podeGravar',
  'hoje',
  'convenios',
  'contasProntas',
  'guias',
  'lotes',
  'lote',
  'convenioDoLote',
  'situacoesProtocolo',
  'prazos',
  'competencias',
  'resumoCompetencia',
  'motivos',
  'grade',
  'itensDaConta',
  'evidenciaDoItem',
  'convenioDaConta',
  'contaDoItem',
  'demonstrativos',
  'demonstrativo',
  'configuracao',
  'painel',
  'xmlDoLote',
  'acompanhamento',
  'contasBancariasDoEscopo',
]);
