// Relatório diário de divergência entre os índices dos bancos (M57, regra 4; critério de aceite "0 divergência depois do
// ciclo de teste"): como cada banco grava numa transação própria, uma queda entre as duas gravações deixa um banco para
// trás. O relatório compara, chave a chave, as linhas de SGH_REDE_VINCULO de cada banco do par e propõe o reparo:
//   - linha ausente em um banco: grava o espelho da que existe (e a pessoa, se faltar);
//   - situação diferente: prevalece a mudança mais recente (vincular ou desfazer), gravada no outro banco;
//   - pessoa diferente: não se repara sozinho (vai para revisão humana; aparece no relatório).
// Só identificadores no relatório: chave, situação e pessoa da Rede; nenhum nome nem documento.
import type { TipoDivergenciaIndiceRede } from '@sgh/contratos';
import { ladosDaChave } from './chave.js';
import { espelho, type PlanoIndice, ultimaMudanca, type VinculoIndice } from './indice.js';

export interface DivergenciaIndice {
  readonly chave: string;
  readonly tipo: TipoDivergenciaIndiceRede;
  readonly porBanco: readonly {
    readonly estabelecimento: string;
    readonly situacao: VinculoIndice['situacao'] | null;
    readonly pessoa: string | null;
  }[];
}

/**
 * Compara os índices. `linhasPorBanco` traz as linhas de SGH_REDE_VINCULO de cada banco (lidas separadamente, uma
 * consulta por banco). Pares com um lado fora dos estabelecimentos dados são ignorados (o isolamento já recusa).
 */
export function compararIndices(
  estabelecimentos: readonly string[],
  linhasPorBanco: ReadonlyMap<string, readonly VinculoIndice[]>,
): DivergenciaIndice[] {
  const ests = new Set(estabelecimentos);
  const porChave = new Map<string, Map<string, VinculoIndice>>();
  for (const [banco, linhas] of linhasPorBanco) {
    if (!ests.has(banco)) continue;
    for (const l of linhas) {
      if (l.estabelecimento !== banco) continue;
      const m = porChave.get(l.chave) ?? new Map<string, VinculoIndice>();
      m.set(banco, l);
      porChave.set(l.chave, m);
    }
  }
  const r: DivergenciaIndice[] = [];
  for (const [chave, m] of porChave) {
    const lados = ladosDaChave(chave).map((l) => l.estabelecimento);
    if (!lados.every((e) => ests.has(e))) continue;
    const vistas = lados.map((e) => m.get(e) ?? null);
    const porBanco = lados.map((e, i) => ({
      estabelecimento: e,
      situacao: vistas[i]?.situacao ?? null,
      pessoa: vistas[i]?.pessoa ?? null,
    }));
    let tipo: TipoDivergenciaIndiceRede | null = null;
    if (vistas.some((v) => v === null)) tipo = 'ausente_em_um_banco';
    else if (vistas[0]!.pessoa !== vistas[1]!.pessoa) tipo = 'pessoa_diferente';
    else if (vistas[0]!.situacao !== vistas[1]!.situacao) tipo = 'situacao_diferente';
    if (tipo) r.push({ chave, tipo, porBanco });
  }
  return r.sort((x, y) => x.chave.localeCompare(y.chave));
}

export interface PlanoReparo {
  readonly planos: readonly PlanoIndice[];
  /** Chaves que precisam de revisão humana (pessoa diferente nos dois bancos). */
  readonly manuais: readonly string[];
}

/** O reparo das divergências (idempotente: rodar de novo depois do reparo não acha nada). */
export function planejarReparo(
  divergencias: readonly DivergenciaIndice[],
  linhasPorBanco: ReadonlyMap<string, readonly VinculoIndice[]>,
): PlanoReparo {
  const linha = (banco: string, chave: string) =>
    (linhasPorBanco.get(banco) ?? []).find((l) => l.chave === chave && l.estabelecimento === banco) ?? null;
  const planos: PlanoIndice[] = [];
  const manuais: string[] = [];
  for (const d of divergencias) {
    if (d.tipo === 'pessoa_diferente') {
      manuais.push(d.chave);
      continue;
    }
    const existentes = d.porBanco
      .map((b) => linha(b.estabelecimento, d.chave))
      .filter((l): l is VinculoIndice => l !== null)
      .sort((x, y) => ultimaMudanca(y).localeCompare(ultimaMudanca(x)));
    const vencedora = existentes[0] as VinculoIndice;
    const alvo = espelho(vencedora);
    planos.push({
      operacao: 'reparo',
      chave: d.chave,
      pessoa: vencedora.pessoa,
      bancos: [
        {
          estabelecimento: alvo.estabelecimento,
          escritas: [
            {
              tabela: 'SGH_REDE_PESSOA',
              acao: 'inserir_se_ausente',
              pessoa: alvo.pessoa,
              em: ultimaMudanca(alvo),
            },
            { tabela: 'SGH_REDE_VINCULO', acao: 'gravar', linha: alvo },
          ],
        },
      ],
    });
  }
  return { planos, manuais };
}
