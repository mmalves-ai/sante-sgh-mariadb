// Consulta somente leitura de tabela (M14; ficha, seções 4, 7 e 8, regras 5 e 15; cap-10 §10.11): cada tabela
// em consulta tem uma DECLARAÇÃO gerada em lote (`pnpm dominios:lote`) em duas partes, como o CRUD genérico:
//   - a parte PÚBLICA (aqui): módulo dono, recurso, título, item da árvore que atende a tabela, fase da tela
//     completa, classe (comum, pessoal, clínica) e se é grande (exige filtro); daqui saem as permissões
//     `<modulo>.consulta.ler` / `<modulo>.consulta.exportar` (clínica: `pep.consultaClinica.*`) e as rotas;
//   - a parte FÍSICA (em @sgh/legado, no grupo dono): tabela, colunas com classe de máscara, chave de
//     paginação (keyset) e filtros por coluna indexada.
// Nenhum nome de tabela do legado aparece aqui (fronteira).
import { z } from 'zod';
import { esquemaValorCampo } from '../dominios/tipos.js';

export const CLASSES_CONSULTA = [
  /** Sem dado de pessoa: lista e exportação simples. */
  'comum',
  /** Tem dado de pessoa: colunas mascaradas por classe; abrir o registro é evento auditado; exportar pede justificativa. */
  'pessoal',
  /** Conteúdo clínico: só perfis clínicos e auditor; ler gera o evento de leitura de prontuário. */
  'clinica',
] as const;
export type ClasseConsulta = (typeof CLASSES_CONSULTA)[number];

export interface ConsultaPublica {
  readonly modulo: string;
  readonly recurso: string;
  readonly rotulo: string;
  /** Item da árvore que atende a tabela (A, B ou C da ficha); null: só no índice de consultas. */
  readonly item: string | null;
  /** Fase da tela completa do item (aviso "tela completa na Fase N" quando passa de 1). */
  readonly fase: number | null;
  readonly classe: ClasseConsulta;
  /** Tabela grande: a tela exige filtro por período ou chave indexada. */
  readonly grande: boolean;
  readonly marco: string;
  /**
   * M34: a consulta é parte de uma tela de trabalho com permissão própria (ex.: os endpoints só com
   * `integracao.configuracao.ler`): ler e exportar exigem estas, no lugar das `<modulo>.consulta.*`.
   */
  readonly permissoes?: { readonly ler: string; readonly exportar: string };
}

export const ROTA_CONSULTAS = '/consultas';
export function rotaDaConsulta(c: Pick<ConsultaPublica, 'modulo' | 'recurso'>): string {
  return `${ROTA_CONSULTAS}/${c.modulo}/${c.recurso}`;
}
export function rotaDoItemConsulta(item: string): string {
  return `${ROTA_CONSULTAS}/item/${item}`;
}

export type AcaoConsulta = 'ler' | 'exportar';
/** Permissão da consulta: por módulo; a clínica é a do PEP (perfis clínicos e auditor). */
export function permissaoDaConsulta(
  c: Pick<ConsultaPublica, 'modulo' | 'classe' | 'permissoes'>,
  acao: AcaoConsulta,
): string {
  if (c.permissoes) return c.permissoes[acao];
  return c.classe === 'clinica' ? `pep.consultaClinica.${acao}` : `${c.modulo}.consulta.${acao}`;
}

/** Tetos (ficha, seção 4): 100 linhas por página; contagem até 10.000 ("mais de 10.000"). */
export const TETO_PAGINA_CONSULTA = 100;
export const TETO_CONTAGEM_CONSULTA = 10_000;

export const TIPOS_COLUNA_CONSULTA = ['texto', 'inteiro', 'decimal', 'data', 'hora', 'dataHora'] as const;
export type TipoColunaConsulta = (typeof TIPOS_COLUNA_CONSULTA)[number];

export const MODOS_FILTRO_CONSULTA = ['igual', 'periodo'] as const;
export type ModoFiltroConsulta = (typeof MODOS_FILTRO_CONSULTA)[number];

export const esquemaColunaConsulta = z.object({
  campo: z.string(),
  rotulo: z.string(),
  tipo: z.enum(TIPOS_COLUNA_CONSULTA),
  /** Mascarada na lista (dado de pessoa): aparece só ao abrir o registro, com evento auditado. */
  mascarada: z.boolean(),
  /** Filtro por coluna indexada (igual ou período). */
  filtro: z.enum(MODOS_FILTRO_CONSULTA).optional(),
  /** Faz parte da chave (o registro abre pela chave). */
  chave: z.boolean(),
});
export type ColunaConsulta = z.infer<typeof esquemaColunaConsulta>;

export const esquemaConsultaDescrita = z.object({
  modulo: z.string(),
  recurso: z.string(),
  rotulo: z.string(),
  item: z.string().nullable(),
  fase: z.number().int().nullable(),
  classe: z.enum(CLASSES_CONSULTA),
  grande: z.boolean(),
  rota: z.string(),
  colunas: z.array(esquemaColunaConsulta),
  /** Sem filtro a tela recusa (tabela grande). */
  exigeFiltro: z.boolean(),
  /** Ações que a sessão pode fazer. */
  permitidas: z.array(z.enum(['ler', 'exportar'])),
  /** Exportar exige justificativa (dado de pessoa ou conteúdo clínico). */
  exportarExigeJustificativa: z.boolean(),
});
export type ConsultaDescrita = z.infer<typeof esquemaConsultaDescrita>;

export const esquemaIndiceConsultas = z.object({
  consultas: z.array(
    esquemaConsultaDescrita.pick({
      modulo: true,
      recurso: true,
      rotulo: true,
      item: true,
      fase: true,
      classe: true,
      grande: true,
      rota: true,
    }),
  ),
});
export type IndiceConsultas = z.infer<typeof esquemaIndiceConsultas>;

/** Pedido de página: filtros `f.<campo>` (igual), `de.<campo>`/`ate.<campo>` (período), cursor e tamanho. */
export const esquemaPedidoPaginaConsulta = z
  .object({
    apos: z.string().max(2000).optional(),
    porPagina: z.coerce.number().int().min(1).max(TETO_PAGINA_CONSULTA).optional(),
  })
  .catchall(z.string().max(100));
export type PedidoPaginaConsulta = z.infer<typeof esquemaPedidoPaginaConsulta>;

export const esquemaPaginaConsulta = z.object({
  itens: z.array(z.record(z.string(), esquemaValorCampo)),
  /** Cursor da próxima página (keyset); null: acabou. */
  proxima: z.string().nullable(),
  /** Contagem com teto: `maisDe` = passou de TETO_CONTAGEM_CONSULTA. */
  contagem: z.object({ valor: z.number().int(), maisDe: z.boolean() }),
  porPagina: z.number().int(),
});
export type PaginaConsulta = z.infer<typeof esquemaPaginaConsulta>;

export const esquemaRegistroConsulta = z.object({
  chave: z.string(),
  valores: z.record(z.string(), esquemaValorCampo),
});
export type RegistroConsulta = z.infer<typeof esquemaRegistroConsulta>;

export const esquemaPedidoExportacaoConsulta = z.object({
  /** Código do tipo de justificativa da exportação (dado de pessoa ou clínico). */
  justificativa: z.number().int().positive().optional(),
  filtros: z.record(z.string(), z.string().max(100)).default({}),
});

/** Teto da exportação (linhas), por pedido: a exportação recusa acima disso (filtre mais). */
export const TETO_EXPORTACAO_CONSULTA = 5_000;

// ── Painel da matriz de cobertura (M14; ficha, seção 7) ──────────────────────────────────────────────

export const ATENDIMENTOS_MATRIZ = ['tela', 'consulta', 'importador', 'descartada', 'pendente'] as const;

export const esquemaPainelMatriz = z.object({
  geradoEm: z.string(),
  resumo: z.object({
    total: z.number().int(),
    atendidas: z.number().int(),
    descartadas: z.number().int(),
    pendentes: z.number().int(),
  }),
  porCodigo: z.array(
    z.object({
      codigo: z.string(),
      total: z.number().int(),
      porAtendimento: z.record(z.enum(ATENDIMENTOS_MATRIZ), z.number().int()),
    }),
  ),
  tabelas: z.array(
    z.object({
      tabela: z.string(),
      codigo: z.string(),
      destino: z.string(),
      marco: z.string(),
      atendimento: z.enum(ATENDIMENTOS_MATRIZ),
      linhas: z.number().int(),
      justificativa: z.string().nullable(),
    }),
  ),
  /** Vigia das tabelas vazias do estabelecimento (null: ainda não rodou). */
  vazias: z
    .object({
      vazias: z.number().int(),
      registradas: z.number().int(),
      comDados: z.array(
        z.object({ tabela: z.string(), desde: z.string().nullable(), avisadoEm: z.string().nullable() }),
      ),
      ultimaVerificacao: z.string().nullable(),
    })
    .nullable(),
});
export type PainelMatriz = z.infer<typeof esquemaPainelMatriz>;
