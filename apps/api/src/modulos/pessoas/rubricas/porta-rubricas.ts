// Porta das rubricas, incidências e tabelas legais da folha (M53, etapa F1; ficha, seção 4): o que a tela
// "Rubricas, incidências e tabelas legais" e o cálculo da folha (F2) leem, independente de onde (a API não escreve SQL;
// fronteira Nx). A gravação NÃO passa por aqui: é a do CRUD genérico (receita genérica com assinatura, `pessoas.*`
// do lote `pnpm folha:rubricas`), que a tela abre embutido.
//   - `legado`: leituras de @sgh/legado em transação READ ONLY no banco do estabelecimento da sessão;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com rubricas e tabelas legais sintéticas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ApoioRubricas, DiasAfastamentoFolha, RubricaFolha, TabelaLegalFolha } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_RUBRICAS = Symbol('PORTA_RUBRICAS');

export type ContextoRubricas = ContextoPortaM18;

/** Só leitura: a gravação é a do CRUD genérico (o gravador SGH_ não existe nesta porta). */
export interface PortaRubricas extends PortaGravacaoM18<never> {
  rubricas(c: ContextoRubricas, empresa: number | null): Promise<RubricaFolha[]>;
  tabelasLegais(c: ContextoRubricas): Promise<TabelaLegalFolha[]>;
  /** Dias de afastamento a cargo da empresa por vigência (regra 7). */
  diasAfastamento(c: ContextoRubricas): Promise<DiasAfastamentoFolha[]>;
  dominios(c: ContextoRubricas): Promise<Pick<ApoioRubricas, 'incidenciasEsocial' | 'naturezas'>>;
}

export const METODOS_PORTA_RUBRICAS: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'rubricas',
  'tabelasLegais',
  'diasAfastamento',
  'dominios',
]);
