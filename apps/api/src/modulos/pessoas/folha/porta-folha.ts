// Porta da interface com a folha externa, fatia F0 (M53.1; ficha do M53, seções 4 a 6, regras 3 a 6): o que a tela
// `/pessoas/folha` lê e grava, independente de onde (a API não escreve SQL; fronteira Nx). O ponto fechado e os plantões
// realizados vêm das portas do ponto e do realizado (M52); o vínculo, o CPF cifrado e o conselho, desta:
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto
//     (nenhuma tabela do outro sistema: a F0 não tem receita de gravação no legado);
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AfastamentoPesLido,
  ConselhoDoProfissionalLido,
  FiltroAfastamentosSgh,
  FiltroLotesFolhaSgh,
  ItemDominioFolha,
  LinhaResumoFolhaSgh,
  LoteFolhaCompletoLido,
  LoteFolhaLido,
  NovoAfastamentoSgh,
  NovoLoteFolhaSgh,
  RemessaFolhaLegada,
  ResumoFolhaLido,
  VinculoFolhaLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_FOLHA = Symbol('PORTA_FOLHA');

export type ContextoFolha = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ da F0 numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorFolha {
  proximoIdLote(): Promise<number>;
  lote(id: number): Promise<LoteFolhaCompletoLido | null>;
  lotesDaCompetencia(empresa: number, competencia: string): Promise<LoteFolhaLido[]>;
  competenciaLancada(empresa: number, competencia: string): Promise<boolean>;
  incluirLote(x: SemHospital<NovoLoteFolhaSgh>): Promise<number>;
  situacaoLote(x: { id: number; de: readonly string[]; para: string; por: string }): Promise<void>;
  incluirResumo(x: {
    interface: number;
    empresa: number;
    competencia: string;
    linhas: readonly LinhaResumoFolhaSgh[];
  }): Promise<number>;
  resumo(interfaceId: number): Promise<ResumoFolhaLido[]>;
  afastamento(id: number): Promise<AfastamentoPesLido | null>;
  afastamentos(f: FiltroAfastamentosSgh): Promise<AfastamentoPesLido[]>;
  incluirAfastamento(x: SemHospital<NovoAfastamentoSgh>): Promise<number>;
  encerrarAfastamento(x: { id: number; versao: number; fim: string; por: string }): Promise<void>;
  cancelarAfastamento(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
}

export interface PortaFolha extends PortaGravacaoM18<GravadorFolha> {
  /** Hoje e agora (AAAA-MM-DDTHH:MM:SS, horário local do banco). */
  relogio(c: ContextoFolha): Promise<{ hoje: string; agora: string }>;
  empresas(c: ContextoFolha): Promise<ItemDominioFolha[]>;
  eventosPonto(c: ContextoFolha): Promise<ItemDominioFolha[]>;
  motivosAfastamento(c: ContextoFolha): Promise<ItemDominioFolha[]>;
  tiposFolha(c: ContextoFolha): Promise<ItemDominioFolha[]>;
  remessas(c: ContextoFolha, empresa: number): Promise<RemessaFolhaLegada[]>;
  lotes(c: ContextoFolha, f: FiltroLotesFolhaSgh): Promise<LoteFolhaLido[]>;
  lote(c: ContextoFolha, id: number): Promise<LoteFolhaCompletoLido | null>;
  competenciaLancada(c: ContextoFolha, empresa: number, competencia: string): Promise<boolean>;
  vinculosDaFolha(c: ContextoFolha, inicio: string, fim: string): Promise<VinculoFolhaLido[]>;
  conselhos(
    c: ContextoFolha,
    profissionais: readonly number[],
  ): Promise<Map<number, ConselhoDoProfissionalLido>>;
  afastamentos(c: ContextoFolha, f: FiltroAfastamentosSgh): Promise<AfastamentoPesLido[]>;
  afastamento(c: ContextoFolha, id: number): Promise<AfastamentoPesLido | null>;
}

export const METODOS_PORTA_FOLHA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'empresas',
  'eventosPonto',
  'motivosAfastamento',
  'tiposFolha',
  'remessas',
  'lotes',
  'lote',
  'competenciaLancada',
  'vinculosDaFolha',
  'conselhos',
  'afastamentos',
  'afastamento',
]);

/** O instante local com segundos (o banco devolve até os milésimos; o lote leva até os segundos). */
export function instanteComSegundos(agora: string): string {
  const t = agora.replace(' ', 'T');
  return t.length >= 19 ? t.slice(0, 19) : `${t.slice(0, 16)}:00`;
}
