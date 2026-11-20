// Porta do eSocial, fatia F5 (M53.6; ficha do M53, seções 4 a 6, regras 1, 2, 3 e 9): o que a API do eSocial lê e grava,
// independente de onde (a API não escreve SQL; fronteira Nx). O vínculo, o salário, o afastamento, a rescisão e as
// rubricas vêm das portas que já os leem (pessoas, cálculo, interface, rubricas); desta, o que é do eSocial:
//   - `legado`: catálogos oficiais e pendências do outro sistema em transação READ ONLY (só contagem); gravações numa
//     transação só SGH_ com a SGH_TRILHA junto (o eSocial não tem receita de gravação no legado);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  ConciliacaoEsocialSghLida,
  EmpregadorEsocialSghLido,
  EventoCatalogoEsocial,
  EventoEsocialSghLido,
  FichaEsocialSghLida,
  FiltroEventosEsocialSgh,
  GravarFichaEsocialSgh,
  ItemCatalogoEsocial,
  LeiauteCatalogoEsocial,
  LoteEsocialSghLido,
  MudarSituacaoEventoSgh,
  MudarSituacaoLoteSgh,
  NovaConciliacaoEsocialSgh,
  NovoEmpregadorEsocialSgh,
  NovoEventoEsocialSgh,
  NovoLoteEsocialSgh,
  PendenciaLegadoLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_ESOCIAL = Symbol('PORTA_ESOCIAL');

export type ContextoEsocial = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ do eSocial numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorEsocial {
  empregadores(empresa: number | null): Promise<EmpregadorEsocialSghLido[]>;
  incluirEmpregador(x: SemHospital<NovoEmpregadorEsocialSgh>): Promise<number>;
  gravarFicha(x: SemHospital<GravarFichaEsocialSgh>): Promise<{ id: number; versao: number }>;
  eventos(f: FiltroEventosEsocialSgh): Promise<EventoEsocialSghLido[]>;
  eventosComTrava(ids: readonly number[]): Promise<EventoEsocialSghLido[]>;
  proximoIdEvento(): Promise<number>;
  incluirEvento(id: number, x: SemHospital<NovoEventoEsocialSgh>): Promise<number>;
  mudarSituacaoEvento(x: SemHospital<MudarSituacaoEventoSgh>): Promise<void>;
  loteComTrava(id: number): Promise<LoteEsocialSghLido | null>;
  incluirLote(x: SemHospital<NovoLoteEsocialSgh>): Promise<number>;
  mudarSituacaoLote(x: SemHospital<MudarSituacaoLoteSgh>): Promise<void>;
  incluirConciliacao(x: SemHospital<NovaConciliacaoEsocialSgh>): Promise<number>;
}

export interface PortaEsocial extends PortaGravacaoM18<GravadorEsocial> {
  // Catálogos oficiais e dados do outro sistema (só leitura).
  eventosCatalogo(c: ContextoEsocial): Promise<EventoCatalogoEsocial[]>;
  leiauteCatalogo(c: ContextoEsocial, data: string): Promise<LeiauteCatalogoEsocial[]>;
  motivosAfastamento(c: ContextoEsocial): Promise<ItemCatalogoEsocial[]>;
  categorias(c: ContextoEsocial): Promise<ItemCatalogoEsocial[]>;
  cnpjs(c: ContextoEsocial): Promise<Map<number, string | null>>;
  pendenciasLegado(c: ContextoEsocial, empresa: number | null): Promise<PendenciaLegadoLida[]>;
  recibosAutonomo(c: ContextoEsocial, empresa: number, competencia: string): Promise<number>;
  // SGH_ do eSocial.
  empregadores(c: ContextoEsocial, empresa: number | null): Promise<EmpregadorEsocialSghLido[]>;
  ficha(c: ContextoEsocial, vinculo: number): Promise<FichaEsocialSghLida | null>;
  eventos(c: ContextoEsocial, f: FiltroEventosEsocialSgh): Promise<EventoEsocialSghLido[]>;
  evento(c: ContextoEsocial, id: number): Promise<{ evento: EventoEsocialSghLido; xml: string } | null>;
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
  ): Promise<LoteEsocialSghLido[]>;
  lote(c: ContextoEsocial, id: number): Promise<LoteEsocialSghLido | null>;
  ultimaConciliacao(
    c: ContextoEsocial,
    empresa: number,
    competencia: string,
  ): Promise<ConciliacaoEsocialSghLida | null>;
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
  'pendenciasLegado',
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
