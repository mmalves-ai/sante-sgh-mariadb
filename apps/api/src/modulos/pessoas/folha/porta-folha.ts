// Porta da interface com a folha externa (M53.1): o que a tela `/pessoas/folha` lê e grava, independente de onde (a API
// não escreve SQL). O ponto fechado e os plantões realizados vêm das portas do ponto e do realizado; o vínculo, o CPF
// cifrado, o conselho e o afastamento, desta:
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-folha-propria.ts), gravação pelo Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import {
  type AfastamentoFolha,
  type ConselhoDoProfissional,
  type FiltroAfastamentosFolha,
  type FiltroLotesDaFolha,
  type ItemDominioFolha,
  type LinhaResumoDaFolha,
  type LoteDaFolha,
  type LoteFolhaCompleto,
  type NovoAfastamentoFolha,
  type NovoLoteDaFolha,
  type RemessaDaFolha,
  type ResumoDaFolha,
  type VinculoDaFolha,
} from './tipos-folha.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_FOLHA = Symbol('PORTA_FOLHA');

export type ContextoFolha = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações da interface com a folha numa transação, com as releituras dentro dela. */
export interface GravadorFolha {
  proximoIdLote(): Promise<number>;
  lote(id: number): Promise<LoteFolhaCompleto | null>;
  lotesDaCompetencia(empresa: number, competencia: string): Promise<LoteDaFolha[]>;
  competenciaLancada(empresa: number, competencia: string): Promise<boolean>;
  incluirLote(x: SemHospital<NovoLoteDaFolha>): Promise<number>;
  situacaoLote(x: { id: number; de: readonly string[]; para: string; por: string }): Promise<void>;
  incluirResumo(x: {
    interface: number;
    empresa: number;
    competencia: string;
    linhas: readonly LinhaResumoDaFolha[];
  }): Promise<number>;
  resumo(interfaceId: number): Promise<ResumoDaFolha[]>;
  afastamento(id: number): Promise<AfastamentoFolha | null>;
  afastamentos(f: FiltroAfastamentosFolha): Promise<AfastamentoFolha[]>;
  incluirAfastamento(x: SemHospital<NovoAfastamentoFolha>): Promise<number>;
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
  remessas(c: ContextoFolha, empresa: number): Promise<RemessaDaFolha[]>;
  lotes(c: ContextoFolha, f: FiltroLotesDaFolha): Promise<LoteDaFolha[]>;
  lote(c: ContextoFolha, id: number): Promise<LoteFolhaCompleto | null>;
  competenciaLancada(c: ContextoFolha, empresa: number, competencia: string): Promise<boolean>;
  vinculosDaFolha(c: ContextoFolha, inicio: string, fim: string): Promise<VinculoDaFolha[]>;
  conselhos(c: ContextoFolha, profissionais: readonly number[]): Promise<Map<number, ConselhoDoProfissional>>;
  afastamentos(c: ContextoFolha, f: FiltroAfastamentosFolha): Promise<AfastamentoFolha[]>;
  afastamento(c: ContextoFolha, id: number): Promise<AfastamentoFolha | null>;
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
