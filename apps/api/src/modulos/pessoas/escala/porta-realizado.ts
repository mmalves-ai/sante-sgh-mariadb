// Porta do plantão realizado, fatia F6 (M52.6; ficha, seções 5 e 6; DP-33): os plantões das escalas publicadas, o
// realizado com a decisão por outra pessoa, as tarifas por hora e o lançamento no repasse pela receita
// `repasse.lancarEvento` (origem `plantao`, a única escrita no outro sistema, pelo executor do M04):
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações SGH_ numa transação só SGH_ com a trilha; o
//     lançamento pelo executor (assinatura verde em origem-plantao);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com o lançamento simulado; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  NovoRealizadoSgh,
  PlantaoParaRealizadoLido,
  RealizadoPesLido,
  TarifaPlantaoPesLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_REALIZADO = Symbol('PORTA_REALIZADO');

export type ContextoRealizado = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

export interface GravadorRealizado {
  plantao(id: number): Promise<PlantaoParaRealizadoLido | null>;
  realizadosDoPlantao(plantao: number): Promise<RealizadoPesLido[]>;
  realizadosDaPessoa(pessoa: number, de: string, ate: string): Promise<RealizadoPesLido[]>;
  realizado(id: number): Promise<RealizadoPesLido | null>;
  tarifas(): Promise<TarifaPlantaoPesLida[]>;
  incluirRealizado(r: SemHospital<NovoRealizadoSgh>): Promise<number>;
  decidirRealizado(d: {
    id: number;
    versao: number;
    situacao: 'aprovado' | 'recusado';
    motivo: string | null;
    tarifa: number | null;
    valorHora: number | null;
    valor: number | null;
    por: string;
  }): Promise<void>;
  incluirTarifa(t: {
    tipo: string;
    unidade: number | null;
    inicio: string;
    fim: string | null;
    valorHora: number;
    por: string;
  }): Promise<number>;
  encerrarTarifa(t: { id: number; fim: string; por: string }): Promise<void>;
  /** Os aprovados sem valor e não lançados que começam na vigência [de, ate] (ate null: sem fim). */
  realizadosSemValor(de: string, ate: string | null): Promise<RealizadoPesLido[]>;
  plantoesPorIds(ids: readonly number[]): Promise<PlantaoParaRealizadoLido[]>;
  /** Valorar o aprovado sem valor (a tarifa chegou depois); false se já tinha valor ou já foi lançado. */
  valorarRealizado(v: { id: number; tarifa: number; valorHora: number; valor: number }): Promise<boolean>;
  /** W0-06: a apuração do repasse da competência (empresa 1), relida na transação do estorno. */
  apuracaoRepasse(competencia: string): Promise<{ id: number; estado: string } | null>;
  /** W0-06: estornar o aprovado (versão lida), com o motivo. */
  estornarRealizado(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  /** W0-06: ligar o lançamento negativo do repasse ao realizado estornado. */
  ligarEstorno(x: { id: number; lancamento: number }): Promise<void>;
  /** W0-06: desfazer o estorno que ficou sem o lançamento negativo (a receita recusou). */
  desfazerEstorno(id: number): Promise<void>;
  /**
   * Revisão W0-06: o lançamento negativo já feito no repasse para o realizado (pelo original e pelo motivo) e ainda
   * não ligado, ou null (conciliação do estorno pendente).
   */
  estornoLancado(x: { id: number; original: number }): Promise<number | null>;
}

export interface PortaRealizado extends PortaGravacaoM18<GravadorRealizado> {
  relogio(c: ContextoRealizado): Promise<{ hoje: string; agora: string }>;
  plantoes(
    c: ContextoRealizado,
    f: { readonly de: string; readonly ate: string; readonly unidade?: number },
  ): Promise<PlantaoParaRealizadoLido[]>;
  plantao(c: ContextoRealizado, id: number): Promise<PlantaoParaRealizadoLido | null>;
  plantoesPorIds(c: ContextoRealizado, ids: readonly number[]): Promise<PlantaoParaRealizadoLido[]>;
  realizadosDosPlantoes(c: ContextoRealizado, plantoes: readonly number[]): Promise<RealizadoPesLido[]>;
  realizadosAprovados(c: ContextoRealizado, de: string, ate: string): Promise<RealizadoPesLido[]>;
  realizado(c: ContextoRealizado, id: number): Promise<RealizadoPesLido | null>;
  tarifas(c: ContextoRealizado): Promise<TarifaPlantaoPesLida[]>;
  codigosDosRegistros(c: ContextoRealizado, registros: readonly number[]): Promise<Map<number, number>>;
  /** W0-06: a apuração do repasse da competência (empresa 1), ou null. */
  apuracaoRepasse(c: ContextoRealizado, competencia: string): Promise<{ id: number; estado: string } | null>;
}

export const METODOS_PORTA_REALIZADO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'plantoes',
  'plantao',
  'plantoesPorIds',
  'realizadosDosPlantoes',
  'realizadosAprovados',
  'realizado',
  'tarifas',
  'codigosDosRegistros',
  'apuracaoRepasse',
]);
