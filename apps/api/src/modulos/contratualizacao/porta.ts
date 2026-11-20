// Porta da contratualização SUS (M55, fatia F5; ficha, seções 4 a 7; regra 11), independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (os domínios CM* onde estão, os contratos, as metas, as apurações, a SIGTAP e a
//     produção SUS agregada do faturamento SUS ou das contas SUS) e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto (o contrato, a meta e a apuração relidos e travados na MESMA transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Recurso só do novo: nenhuma operação do executor (os domínios CM* recusam gravação pelo gatilho).
import type { ApuracaoSus, ContratoSus, MetaSus, ProducaoSigtapSus } from '@sgh/contratos';
import type {
  ApuracaoSusSgh,
  ContratoSusSgh,
  ItemDominioContratualizacao,
  MetaSusSgh,
  TabelaDominioContratualizacao,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CONTRATUALIZACAO = Symbol('PORTA_CONTRATUALIZACAO');

type SemHospital<T> = Omit<T, 'hospital'>;
type Gravado = Promise<{ id: number; versao: number }>;

/** Gravações só do novo (SGH_SUS_*), numa transação com a SGH_TRILHA junto; as leituras são da mesma transação. */
export interface GravadorContratualizacao {
  relogio(): Promise<{ hoje: string; competencia: string }>;
  contrato(id: number): Promise<ContratoSus | null>;
  contratoPelaChave(chave: string): Promise<ContratoSus | null>;
  numeroEmUso(numero: string, excetoId: number | null): Promise<boolean>;
  /** As metas do contrato (a alteração da vigência confere que nenhuma fica de fora). */
  metas(contrato: number): Promise<MetaSus[]>;
  meta(id: number): Promise<MetaSus | null>;
  metaPelaChave(chave: string): Promise<MetaSus | null>;
  apuracao(meta: number, competencia: string): Promise<ApuracaoSus | null>;
  apuracaoPelaChave(chave: string): Promise<ApuracaoSus | null>;
  incluirContrato(c: SemHospital<ContratoSusSgh> & { chave: string }): Gravado;
  alterarContrato(c: SemHospital<ContratoSusSgh> & { id: number; versaoVista: number }): Gravado;
  encerrarContrato(c: { id: number; versaoVista: number; motivo: string; usuario: string }): Gravado;
  incluirMeta(m: SemHospital<MetaSusSgh> & { contrato: number; chave: string }): Gravado;
  alterarMeta(m: SemHospital<MetaSusSgh> & { id: number; versaoVista: number }): Gravado;
  registrarApuracao(a: SemHospital<ApuracaoSusSgh> & { chave: string }): Gravado;
  corrigirApuracao(a: SemHospital<ApuracaoSusSgh> & { id: number; versaoVista: number }): Gravado;
}

export type DominiosContratualizacaoLidos = Record<
  TabelaDominioContratualizacao,
  ItemDominioContratualizacao[]
>;

export interface PortaContratualizacao extends PortaGravacaoM18<GravadorContratualizacao> {
  relogio(c: ContextoPortaM18): Promise<{ hoje: string; competencia: string }>;
  dominios(c: ContextoPortaM18): Promise<DominiosContratualizacaoLidos>;
  contratos(c: ContextoPortaM18): Promise<{ itens: ContratoSus[]; cortada: boolean }>;
  contrato(c: ContextoPortaM18, id: number): Promise<ContratoSus | null>;
  metas(c: ContextoPortaM18, contrato: number): Promise<MetaSus[]>;
  meta(c: ContextoPortaM18, id: number): Promise<MetaSus | null>;
  apuracoes(c: ContextoPortaM18, metas: readonly number[]): Promise<ApuracaoSus[]>;
  sigtapExiste(c: ContextoPortaM18, prefixo: string): Promise<boolean>;
  buscarSigtap(c: ContextoPortaM18, termo: string): Promise<{ codigo: string; nome: string }[]>;
  /** A produção do faturamento SUS (M51) da competência `de` a `ate`. */
  producaoFaturamentoSus(c: ContextoPortaM18, de: string, ate: string): Promise<ProducaoSigtapSus[]>;
  /** A produção das contas SUS (convênios do parâmetro) de UMA competência. */
  producaoContasSus(
    c: ContextoPortaM18,
    competencia: string,
    convenios: readonly number[],
  ): Promise<ProducaoSigtapSus[]>;
}

export const METODOS_PORTA_CONTRATUALIZACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'dominios',
  'contratos',
  'contrato',
  'metas',
  'meta',
  'apuracoes',
  'sigtapExiste',
  'buscarSigtap',
  'producaoFaturamentoSus',
  'producaoContasSus',
]);
