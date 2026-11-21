// Porta da contratualização SUS (M55, fatia F5; ficha, seções 4 a 7; regra 11), independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - própria (`porta-propria.ts`): o banco do cliente pelo @sgh/nucleo — contrato_gestor_sus, meta_contratual_sus,
//     afericao_meta_sus, incentivo_contratual_sus e indicador_contratual_sus; as listas em dominio_contratualizacao_sus;
//     a SIGTAP e a produção do faturamento SUS (BPA e AIH); gravações pelo Executor (trilha, outbox e idempotência na
//     mesma transação), o contrato, a meta e a apuração relidos e travados na MESMA transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai a banco;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  ApuracaoSus,
  ContratoSus,
  ContratoSusEntrada,
  EscoreSus,
  MetaSus,
  MetaSusEntrada,
  OrigemApuracaoSus,
  ProducaoSigtapSus,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CONTRATUALIZACAO = Symbol('PORTA_CONTRATUALIZACAO');

type Gravado = Promise<{ id: number; versao: number }>;

/** O contrato a gravar (a entrada da tela sem a chave e a versão vista) e quem grava. */
export interface ContratoParaGravar {
  readonly entrada: Omit<ContratoSusEntrada, 'versaoVista' | 'chave'>;
  readonly usuario: string;
}
/** A meta a gravar (a entrada da tela sem a chave e a versão vista) e quem grava. */
export interface MetaParaGravar {
  readonly entrada: Omit<MetaSusEntrada, 'versaoVista' | 'chave'>;
  readonly usuario: string;
}
/** O fechamento do período de uma meta (o realizado com as parcelas já calculadas pelo domínio). */
export interface ApuracaoParaGravar {
  readonly meta: number;
  readonly competencia: string;
  readonly inicioPeriodo: string;
  readonly metaPeriodo: number;
  readonly realizado: number;
  readonly cumprimentoPct: number;
  readonly escore: EscoreSus;
  readonly origem: OrigemApuracaoSus;
  readonly observacao: string | null;
  readonly usuario: string;
}

/** As listas da contratualização (dominio_contratualizacao_sus.lista), mais os incentivos cadastrados. */
export const LISTAS_DOMINIO_CONTRATUALIZACAO = [
  'periodicidade',
  'tipo_indicador',
  'complexidade',
  'tipo_item_indicador',
  'rede_assistencial',
  'escore',
  'tipo_afericao',
  'esfera',
  'tipo_dado',
  'componente_orcamento',
  'incentivo',
] as const;
export type ListaDominioContratualizacao = (typeof LISTAS_DOMINIO_CONTRATUALIZACAO)[number];

/** Um item de lista no código da tela (o vocabulário do contrato) com o nome gravado. */
export interface ItemDominioContratualizacao {
  readonly codigo: number;
  readonly nome: string;
  readonly sigla: string | null;
}

/** As gravações da contratualização, numa transação só com a trilha junto; as leituras são da mesma transação. */
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
  incluirContrato(c: ContratoParaGravar & { chave: string }): Gravado;
  alterarContrato(c: ContratoParaGravar & { id: number; versaoVista: number }): Gravado;
  encerrarContrato(c: { id: number; versaoVista: number; motivo: string; usuario: string }): Gravado;
  incluirMeta(m: MetaParaGravar & { contrato: number; chave: string }): Gravado;
  alterarMeta(m: MetaParaGravar & { id: number; versaoVista: number }): Gravado;
  registrarApuracao(a: ApuracaoParaGravar & { chave: string }): Gravado;
  corrigirApuracao(a: ApuracaoParaGravar & { id: number; versaoVista: number }): Gravado;
}

export type DominiosContratualizacao = Record<ListaDominioContratualizacao, ItemDominioContratualizacao[]>;

export interface PortaContratualizacao extends PortaGravacaoM18<GravadorContratualizacao> {
  relogio(c: ContextoPortaM18): Promise<{ hoje: string; competencia: string }>;
  dominios(c: ContextoPortaM18): Promise<DominiosContratualizacao>;
  contratos(c: ContextoPortaM18): Promise<{ itens: ContratoSus[]; cortada: boolean }>;
  contrato(c: ContextoPortaM18, id: number): Promise<ContratoSus | null>;
  metas(c: ContextoPortaM18, contrato: number): Promise<MetaSus[]>;
  meta(c: ContextoPortaM18, id: number): Promise<MetaSus | null>;
  apuracoes(c: ContextoPortaM18, metas: readonly number[]): Promise<ApuracaoSus[]>;
  sigtapExiste(c: ContextoPortaM18, prefixo: string): Promise<boolean>;
  buscarSigtap(c: ContextoPortaM18, termo: string): Promise<{ codigo: string; nome: string }[]>;
  /** A produção do faturamento SUS (M51) da competência `de` a `ate`. */
  producaoFaturamentoSus(c: ContextoPortaM18, de: string, ate: string): Promise<ProducaoSigtapSus[]>;
  /** A produção das contas SUS (fontes pagadoras do parâmetro) de UMA competência. */
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
