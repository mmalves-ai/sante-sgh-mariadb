// Porta do pós-fechamento (M31): o que as telas de guias, lotes, protocolo, prazos, competências, demonstrativos,
// retorno e glosa, webservices e o painel leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo: leituras somente
//     leitura e gravações pelo Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E): contas, lotes, itens e demonstrativos SINTÉTICOS em memória, com
//     as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: os tipos da porta são do próprio módulo (filtros, agregados e mensagem TISS), sem tipo de repositório
// de outro sistema; o contexto é o da sessão (cliente, estabelecimento, usuário e correlação por id).
import type { PagamentoPorta, ResumoPagamento } from './demonstrativo-importacao-propria.js';
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
import type { ContextoPorta } from '../cadastro/porta.js';
import type { PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_TISS = Symbol('PORTA_TISS');

export type ContextoTiss = ContextoPorta;

/** Contas prontas para o lote: fonte pagadora, tipo de guia (1 a 4) e a competência (opcional). */
export interface FiltroContasLote {
  readonly convenio: number;
  readonly tipoGuia: number;
  readonly ano: number | null;
  readonly mes: number | null;
  /** Escopo por convênio da sessão (null = sem restrição). */
  readonly convenios: readonly number[] | null;
}

/** Lista de lotes por período de geração (AAAA-MM-DD), com paginação. */
export interface FiltroLotes {
  readonly convenio: number | null;
  readonly de: string;
  readonly ate: string;
  readonly semProtocolo: boolean;
  readonly convenios: readonly number[] | null;
  readonly pagina: number;
  readonly porPagina: number;
  readonly hoje: string;
}

/** Grade de glosa por competência. */
export interface FiltroGlosa {
  readonly convenios: readonly number[] | null;
  readonly convenio: number | null;
  readonly ano: number;
  readonly mes: number;
  readonly estado: 'todas' | 'com-glosa' | 'em-recurso' | 'nao-conciliadas';
  readonly pagina: number;
  readonly porPagina: number;
}

/** M42: os lotes da competência (só contagens). */
export interface LotesDaCompetencia {
  readonly lotes: number;
  readonly comProtocolo: number;
  readonly contasEmLote: number;
  readonly conveniosFechados: number;
  readonly conveniosComConta: number;
}

/** M42: títulos e movimento do mês (só agregados). */
export interface TitulosDoMes {
  readonly aPagar: {
    readonly titulos: number;
    readonly valor: number;
    readonly pagos: number;
    readonly valorPago: number;
  };
  readonly aReceber: {
    readonly titulos: number;
    readonly valor: number;
    readonly recebidos: number;
    readonly valorRecebido: number;
  };
  /** Movimento bancário por tipo de lançamento. */
  readonly movimento: readonly {
    readonly tipo: string;
    readonly lancamentos: number;
    readonly valor: number;
  }[];
}

/** M42: repasse do mês (só agregados). */
export interface RepasseDoMes {
  readonly itensIntegrados: number;
  readonly valorIntegrado: number;
  readonly eventos: number;
  readonly valorEventos: number;
  readonly rpas: number;
}

/** M42: uso por grupo de usuários (quantos usam e quantos se conectaram desde a data). */
export interface UsoPorGrupo {
  readonly grupo: string;
  readonly usuarios: number;
  readonly conectadosDesde: number;
}

/** Mensagem TISS trocada com a operadora (ou o simulador), registrada para o lote ou a conta. */
export interface MensagemTissRegistro {
  /** Login de quem enviou (a trilha leva o id do usuário). */
  readonly usuario: string;
  readonly lote: number | null;
  readonly conta: number | null;
  readonly convenio: number;
  readonly transacao: string;
  readonly direcao: 'envio' | 'resposta';
  readonly destino: 'simulador' | 'operadora';
  readonly hashRequisicao: string;
  readonly hashResposta: string | null;
  readonly tentativa: number;
  readonly situacao: 'enfileirada' | 'enviada' | 'aceita' | 'recusada' | 'erro';
  readonly protocolo: string | null;
}

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
  /** Demonstrativo de pagamento: protocolos ou guias e os débitos e créditos (06-FAT linha 33). */
  readonly pagamento?: PagamentoPorta | null;
}

/** Gravações diretas da porta, numa transação com a linha da trilha junto (o estabelecimento vem do contexto). */
export interface GravadorSghTiss {
  importarDemonstrativo(
    d: ImportacaoPorta,
  ): Promise<{ id: number; repetido: boolean; casados: number; semCasamento: number }>;
  decidirGlosa(
    d: DecidirGlosaEntrada & { usuario: string; prazo: string | null },
  ): Promise<{ id: number; estado: string; conta: number; glosa: number }>;
  editarEndpoint(d: EditarEndpointTissEntrada & { usuario: string }): Promise<{ id: number }>;
  registrarMensagem(m: MensagemTissRegistro): Promise<{ id: number }>;
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
  /** Contas bancárias do escopo do usuário para o movimento (regra 15 do M32): null = todas; lista vazia = nenhuma. */
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
  contasBancariasDoEscopo(c: ContextoTiss, login: string | null): Promise<number[] | null>;
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
    tipo?: 'analise' | 'pagamento',
  ): Promise<{
    lote: number;
    convenio: number;
    itens: ItemDemonstrativoLido[];
    /** Só no de pagamento: totais, deduções, situação da baixa e o lote de cada linha. */
    pagamento?: ResumoPagamento;
  } | null>;
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
