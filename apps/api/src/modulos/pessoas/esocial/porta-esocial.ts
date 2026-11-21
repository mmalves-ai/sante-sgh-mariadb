// Porta do eSocial (M53.6; ficha do M53, seções 4 a 6, regras 1, 2, 3 e 9): o que a API do eSocial lê e grava,
// independente de onde (a API não escreve SQL). O vínculo, o salário, o afastamento, a rescisão e as rubricas vêm das
// portas que já os leem (pessoas, cálculo, interface, rubricas); desta, o que é do eSocial:
//   - `banco` (porta-esocial-propria.ts): o MariaDB do cliente pelo @sgh/nucleo; gravações numa operação do Executor
//     (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: tipos de negócio do próprio módulo (data ISO, id numérico, booleano), sem tipo nem nome do sistema de origem;
// o contexto é o ContextoNucleo (cliente, estabelecimento, usuário e correlação).
// Melhoria: as "pendências do sistema anterior" são os eventos trazidos pelo conector (origem `migracao`) ainda não
// processados, contados por evento e ano (`pendenciasMigradas`), sem leitura de outro banco.
import type {
  AmbienteEsocial,
  EventoEsocial,
  GrupoEventoEsocial,
  OperacaoTabelaEsocial,
  SituacaoEventoEsocial,
  SituacaoLoteEsocial,
  TransmissorEsocial,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_ESOCIAL = Symbol('PORTA_ESOCIAL');

export type ContextoEsocial = ContextoPortaM18;

/** Teto das listas de eventos e de lotes (a tela avisa quando trunca). */
export const TETO_EVENTOS_ESOCIAL = 1_000;
export const TETO_LOTES_ESOCIAL = 500;

/** Vigência dos parâmetros do eSocial do empregador (os parâmetros do leiaute em JSON, validados pelo contrato). */
export interface VigenciaEmpregadorEsocial {
  readonly id: number;
  readonly empresa: number;
  /** Início da vigência (AAAA-MM). */
  readonly inicio: string;
  readonly transmissor: string;
  readonly leiaute: string;
  readonly parametros: string;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface NovaVigenciaEmpregador {
  readonly empresa: number;
  readonly inicio: string;
  readonly transmissor: string;
  readonly leiaute: string;
  readonly parametros: string;
  /** Login de quem grava (a memória mostra; o banco usa o usuário da sessão). */
  readonly por: string;
}

/** A ficha do eSocial do vínculo, cifrada. */
export interface FichaEsocialCifrada {
  readonly id: number;
  readonly vinculo: number;
  readonly dadosCifrados: string;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface GravacaoFichaEsocial {
  readonly vinculo: number;
  readonly dadosCifrados: string;
  /** null: ficha nova; número: a versão que a tela leu. */
  readonly versao: number | null;
  readonly por: string;
}

/** O evento do eSocial guardado (sem o XML). */
export interface RegistroEventoEsocial {
  readonly id: number;
  readonly empresa: number;
  readonly evento: EventoEsocial;
  readonly grupo: GrupoEventoEsocial;
  readonly operacao: OperacaoTabelaEsocial | null;
  readonly idEsocial: string;
  readonly vinculo: number | null;
  /** O tipo do registro de origem (rubrica, afastamento, vínculo, acidente...) e o id dele. */
  readonly origem: string | null;
  readonly referencia: number | null;
  readonly dataReferencia: string;
  readonly leiaute: string;
  readonly xmlCifrado: boolean;
  readonly hashXml: string;
  readonly errosXsd: readonly string[];
  readonly situacao: SituacaoEventoEsocial;
  readonly eventoAnterior: number | null;
  readonly lote: number | null;
  readonly recibo: string | null;
  readonly retornoCodigo: string | null;
  readonly retornoDescricao: string | null;
  readonly motivo: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export interface FiltroRegistrosEventoEsocial {
  readonly empresa?: number;
  readonly evento?: string;
  readonly eventos?: readonly string[];
  readonly situacao?: string;
  readonly situacoes?: readonly string[];
  readonly vinculo?: number;
  readonly lote?: number;
  readonly origem?: string;
  readonly referencia?: number;
  readonly de?: string;
  readonly ate?: string;
}

export interface NovoRegistroEvento {
  readonly empresa: number;
  readonly evento: EventoEsocial;
  readonly grupo: GrupoEventoEsocial;
  readonly operacao: OperacaoTabelaEsocial | null;
  readonly idEsocial: string;
  readonly vinculo: number | null;
  readonly origem: string | null;
  readonly referencia: number | null;
  readonly dataReferencia: string;
  readonly leiaute: string;
  readonly xml: string;
  readonly xmlCifrado: boolean;
  readonly hashXml: string;
  readonly errosXsd: readonly string[];
  readonly situacao: SituacaoEventoEsocial;
  readonly eventoAnterior: number | null;
  readonly por: string;
}

export interface MudancaSituacaoEvento {
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoEventoEsocial;
  readonly lote?: number | null;
  readonly recibo?: string | null;
  readonly retorno?: { readonly codigo: string; readonly descricao: string } | null;
  readonly motivo?: string | null;
  readonly por: string;
}

export interface RegistroLoteEsocial {
  readonly id: number;
  readonly empresa: number;
  readonly grupo: GrupoEventoEsocial;
  readonly ambiente: AmbienteEsocial;
  readonly situacao: SituacaoLoteEsocial;
  readonly quantidade: number;
  readonly protocolo: string | null;
  readonly motivo: string | null;
  readonly enviadoPor: string | null;
  readonly enviadoEm: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly versao: number;
}

export interface NovoRegistroLote {
  readonly empresa: number;
  readonly grupo: GrupoEventoEsocial;
  readonly ambiente: AmbienteEsocial;
  readonly quantidade: number;
  readonly por: string;
}

export interface MudancaSituacaoLote {
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoLoteEsocial;
  readonly protocolo?: string | null;
  readonly motivo?: string | null;
  readonly enviado?: boolean;
  readonly por: string;
}

export type SituacaoConciliacaoEsocial = 'conciliada' | 'divergente' | 'sem-transmissor';

/** A conferência da competência gravada (as linhas em JSON, como a tela as viu). */
export interface RegistroConciliacaoEsocial {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly transmissor: TransmissorEsocial | null;
  readonly situacao: SituacaoConciliacaoEsocial;
  readonly linhas: string;
  readonly observacao: string | null;
  readonly conferidoPor: string;
  readonly conferidoEm: string;
}

export interface NovaConciliacaoEsocial {
  readonly empresa: number;
  readonly competencia: string;
  readonly transmissor: TransmissorEsocial | null;
  readonly situacao: SituacaoConciliacaoEsocial;
  readonly linhas: string;
  readonly observacao: string | null;
  readonly por: string;
}

/** Evento do catálogo oficial (grupo 1 tabela, 2 não periódico, 3 periódico). */
export interface EventoDoCatalogoEsocial {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly grupo: 1 | 2 | 3;
}

/** Leiaute vigente de um evento (versão no formato do XSD, v_S_01_03_00). */
export interface LeiauteDoCatalogoEsocial {
  readonly evento: string;
  readonly versao: string;
  readonly inicio: string;
}

export interface ItemDoCatalogoEsocial {
  readonly codigo: string;
  readonly rotulo: string;
}

/** Eventos trazidos pelo conector e ainda não processados, por evento e ano (só contagem). */
export interface PendenciaMigradaEsocial {
  readonly evento: string;
  readonly ano: number;
  readonly quantidade: number;
}

/** As gravações do eSocial numa transação só, com as releituras dentro dela. */
export interface GravadorEsocial {
  empregadores(empresa: number | null): Promise<VigenciaEmpregadorEsocial[]>;
  incluirEmpregador(x: NovaVigenciaEmpregador): Promise<number>;
  gravarFicha(x: GravacaoFichaEsocial): Promise<{ id: number; versao: number }>;
  eventos(f: FiltroRegistrosEventoEsocial): Promise<RegistroEventoEsocial[]>;
  eventosComTrava(ids: readonly number[]): Promise<RegistroEventoEsocial[]>;
  /**
   * O próximo sequencial do identificador do evento (os 5 dígitos finais do Id do eSocial): número de negócio do
   * estabelecimento, travado na transação (nunca MAX + 1, nunca o id do registro).
   */
  proximoSequencialEvento(): Promise<number>;
  /** Inclui o evento e devolve o id do registro (gerado pelo banco). */
  incluirEvento(x: NovoRegistroEvento): Promise<number>;
  mudarSituacaoEvento(x: MudancaSituacaoEvento): Promise<void>;
  loteComTrava(id: number): Promise<RegistroLoteEsocial | null>;
  incluirLote(x: NovoRegistroLote): Promise<number>;
  mudarSituacaoLote(x: MudancaSituacaoLote): Promise<void>;
  incluirConciliacao(x: NovaConciliacaoEsocial): Promise<number>;
}

export interface PortaEsocial extends PortaGravacaoM18<GravadorEsocial> {
  // Catálogos oficiais (só leitura).
  eventosCatalogo(c: ContextoEsocial): Promise<EventoDoCatalogoEsocial[]>;
  leiauteCatalogo(c: ContextoEsocial, data: string): Promise<LeiauteDoCatalogoEsocial[]>;
  motivosAfastamento(c: ContextoEsocial): Promise<ItemDoCatalogoEsocial[]>;
  categorias(c: ContextoEsocial): Promise<ItemDoCatalogoEsocial[]>;
  /** CNPJ de cada empresa (estabelecimento) do cliente: o transmissor é único por raiz de CNPJ (regra 1). */
  cnpjs(c: ContextoEsocial): Promise<Map<number, string | null>>;
  pendenciasMigradas(c: ContextoEsocial, empresa: number | null): Promise<PendenciaMigradaEsocial[]>;
  recibosAutonomo(c: ContextoEsocial, empresa: number, competencia: string): Promise<number>;
  // Registros do eSocial.
  empregadores(c: ContextoEsocial, empresa: number | null): Promise<VigenciaEmpregadorEsocial[]>;
  ficha(c: ContextoEsocial, vinculo: number): Promise<FichaEsocialCifrada | null>;
  eventos(c: ContextoEsocial, f: FiltroRegistrosEventoEsocial): Promise<RegistroEventoEsocial[]>;
  evento(c: ContextoEsocial, id: number): Promise<{ evento: RegistroEventoEsocial; xml: string } | null>;
  contagemEventos(
    c: ContextoEsocial,
    empresas: readonly number[],
    de: string,
    ate: string,
    situacoes: readonly string[],
  ): Promise<Record<string, number>>;
  lotes(
    c: ContextoEsocial,
    f: { readonly empresa?: number; readonly situacao?: string },
  ): Promise<RegistroLoteEsocial[]>;
  lote(c: ContextoEsocial, id: number): Promise<RegistroLoteEsocial | null>;
  ultimaConciliacao(
    c: ContextoEsocial,
    empresa: number,
    competencia: string,
  ): Promise<RegistroConciliacaoEsocial | null>;
}

export const METODOS_PORTA_ESOCIAL: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'eventosCatalogo',
  'leiauteCatalogo',
  'motivosAfastamento',
  'categorias',
  'cnpjs',
  'pendenciasMigradas',
  'recibosAutonomo',
  'empregadores',
  'ficha',
  'eventos',
  'evento',
  'contagemEventos',
  'lotes',
  'lote',
  'ultimaConciliacao',
]);
