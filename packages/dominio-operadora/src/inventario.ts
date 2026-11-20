// Conferência do inventário da F0 (ficha, seção 2: "a lista de fatias é revista com o relatório da M56-F0"): compara
// as contagens lidas na cópia (só COUNT, sem dado de pessoa) com o inventário versionado e aponta o que mudou. Os
// registros fictícios de beneficiário entram só como contagem esperada (1 linha cada): se aparecer beneficiário de
// verdade no outro sistema, a premissa da DP-11 ("o legado nunca usou o módulo") cai e a migração da carteira volta
// à mesa (seção 12). Puro: as 80 do inventário vêm de `contarInventarioOperadora` (@sgh/legado); as dos fictícios,
// que nenhum SQL do projeto cita (regra 4), só do retrato de linhas por tabela da matriz (tools/matriz/dados), que o
// levantamento genérico do M14 tira de todas as tabelas.
import {
  INVENTARIO_OPERADORA,
  TABELAS_BENEFICIARIO_FICTICIO,
  type TabelaInventarioOperadora,
} from '@sgh/contratos';

export type AchadoInventario =
  | { readonly tipo: 'tabela-sem-contagem'; readonly tabela: string }
  | {
      readonly tipo: 'linhas-mudaram';
      readonly tabela: string;
      readonly antes: number;
      readonly agora: number;
    }
  | { readonly tipo: 'beneficiario-real'; readonly tabela: string; readonly linhas: number };

/** Tolerância de variação para domínio (linha nova num domínio pequeno é cadastro, não alarme). */
const TOLERANCIA_RELATIVA = 0.2;

function mudou(antes: number, agora: number): boolean {
  if (antes === agora) return false;
  if (antes === 0) return agora > 0;
  return Math.abs(agora - antes) / antes > TOLERANCIA_RELATIVA;
}

export function conferirInventario(
  contagens: Readonly<Record<string, number>>,
  inventario: readonly TabelaInventarioOperadora[] = INVENTARIO_OPERADORA,
): AchadoInventario[] {
  const achados: AchadoInventario[] = [];
  for (const t of inventario) {
    const agora = contagens[t.tabela];
    if (agora === undefined) achados.push({ tipo: 'tabela-sem-contagem', tabela: t.tabela });
    else if (mudou(t.linhas, agora))
      achados.push({ tipo: 'linhas-mudaram', tabela: t.tabela, antes: t.linhas, agora });
  }
  for (const t of TABELAS_BENEFICIARIO_FICTICIO) {
    const n = contagens[t];
    if (n !== undefined && n > 1) achados.push({ tipo: 'beneficiario-real', tabela: t, linhas: n });
  }
  return achados;
}

/** A premissa da DP-11 (nenhum beneficiário real no outro sistema) continua de pé? */
export function semCarteiraNoOutroSistema(achados: readonly AchadoInventario[]): boolean {
  return !achados.some((a) => a.tipo === 'beneficiario-real');
}
