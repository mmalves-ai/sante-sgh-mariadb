// Catálogo de ações do sistema (acao_sistema) a partir dos contratos do produto (decisão do dono 2026-11-20, a): cada
// permissão declarada em @sgh/contratos vira uma linha de acao_sistema no banco do cliente. Regra pura aqui (o
// tipo da ação pelo verbo final do código); a gravação é do carregador tools/db/carregar_acoes.py, chamado pelo
// comando "criar novo cliente" (tools/db/criar_cliente.py). Sem banco e sem .env.
//
// Rodado direto pelo Node, imprime o catálogo em JSON (uma linha), que o carregador lê:
//   node --import ./tools/verificadores/src/caminhos-sgh.ts tools/db/acoes-sistema.ts
import { CATALOGO_DECLARADO, type DeclaracaoPermissao } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';

/** Valores do CHECK ck_acao_sistema_tipo_acao (db/migracoes/02_ADM/01_tabelas.sql). */
export const TIPOS_ACAO = [
  'ver',
  'incluir',
  'alterar',
  'excluir',
  'aprovar',
  'imprimir',
  'exportar',
  'executar',
  'assinar',
  'liberar',
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

/** Tamanhos das colunas de acao_sistema (o carregador recusa banco com colunas menores). */
export const TAMANHO_CODIGO = 120;
export const TAMANHO_DESCRICAO = 255;
/** ordem é SMALLINT UNSIGNED. */
const ORDEM_MAXIMA = 65_535;

const POR_VERBO: Readonly<Record<string, TipoAcao>> = {
  ler: 'ver',
  acessar: 'ver',
  listagem: 'ver',
  consultar: 'ver',
  visualizar: 'ver',
  ver: 'ver',
  criar: 'incluir',
  incluir: 'incluir',
  registrar: 'incluir',
  editar: 'alterar',
  alterar: 'alterar',
  retificar: 'alterar',
  corrigir: 'alterar',
  manutencao: 'alterar',
  parametros: 'alterar',
  configurar: 'alterar',
  suspender: 'alterar',
  excluir: 'excluir',
  inativar: 'excluir',
  cancelar: 'excluir',
  remover: 'excluir',
  aprovar: 'aprovar',
  confirmar: 'aprovar',
  autorizar: 'aprovar',
  validar: 'aprovar',
  imprimir: 'imprimir',
  preimpressao: 'imprimir',
  analitico: 'imprimir',
  sintetico: 'imprimir',
  relatorio: 'imprimir',
  exportar: 'exportar',
  assinar: 'assinar',
  liberar: 'liberar',
};

/** Tipo da ação pelo último segmento do código (modelos de relatório imprimem; o resto executa). */
export function tipoDaAcao(codigo: string): TipoAcao {
  const verbo = codigo.split('.').at(-1) ?? '';
  if (/^modelo[IVXLC]+$/.test(verbo)) return 'imprimir';
  return POR_VERBO[verbo.toLowerCase()] ?? 'executar';
}

export interface AcaoSistema {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoAcao: TipoAcao;
  readonly ordem: number;
}

/** O catálogo completo do produto (o mesmo que a API usa para autorizar). */
export function catalogoDoProduto(): readonly DeclaracaoPermissao[] {
  return [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO];
}

/**
 * As linhas de acao_sistema, na ordem do catálogo. Código vazio, longo demais ou repetido (sem diferenciar
 * maiúsculas e acentos, como a colação do banco) recusa: o catálogo do produto está errado, nada é gravado.
 */
export function acoesDoCatalogo(
  catalogo: readonly DeclaracaoPermissao[] = catalogoDoProduto(),
): AcaoSistema[] {
  const vistos = new Set<string>();
  return catalogo.map((p, i) => {
    const codigo = p.codigo.trim();
    if (codigo === '' || codigo.length > TAMANHO_CODIGO)
      throw new Error(
        `Código de permissão vazio ou com mais de ${TAMANHO_CODIGO} caracteres (posição ${i}).`,
      );
    const chave = codigo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (vistos.has(chave)) throw new Error(`Código de permissão repetido: ${codigo}.`);
    vistos.add(chave);
    const d = p.descricao.trim() || codigo;
    const descricao = d.length > TAMANHO_DESCRICAO ? `${d.slice(0, TAMANHO_DESCRICAO - 1)}…` : d;
    return { codigo, descricao, tipoAcao: tipoDaAcao(codigo), ordem: Math.min(i + 1, ORDEM_MAXIMA) };
  });
}

if ((import.meta as { main?: boolean }).main) {
  process.stdout.write(JSON.stringify(acoesDoCatalogo()) + '\n');
}
