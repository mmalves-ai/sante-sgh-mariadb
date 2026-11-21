// Relatório de saneamento das regras de preço (ficha do M12, regra 9; cap-11 §11.3, Saneamento): datas
// inválidas em regras datadas (percentuais de materiais e medicamentos: 448 linhas, com anos como 0218 e 2201; índices do
// convênio: 2; percentuais por procedimento: 2)
// aparecem num relatório; o novo não corrige sozinho (a correção destas regras entra no saneamento da onda 4, com o faturamento). Saída só
// com chaves de regra (convênio, tabela, item, data), nunca dado de pessoa.
import { DATA_SENTINELA } from '@sgh/contratos';
import { dataDeCalendario } from './vigencia.js';

export type MotivoSaneamento = 'ano-fora-da-faixa' | 'data-ilegivel';

/** Motivo de a data de regra ser suspeita (null: é boa). A sentinela 1899-12-30 é "sem data", não erro. */
export function motivoDataSuspeita(d: string | null): MotivoSaneamento | null {
  if (d === null || d === DATA_SENTINELA) return null;
  if (!dataDeCalendario(d)) return 'data-ilegivel';
  const ano = Number(d.slice(0, 4));
  return ano < 1900 || ano > 2100 ? 'ano-fora-da-faixa' : null;
}

export interface RegraDatada {
  readonly origem: string;
  readonly chave: string;
  readonly data: string | null;
}

export interface AchadoSaneamento extends RegraDatada {
  readonly motivo: MotivoSaneamento;
}

export interface RelatorioSaneamento {
  readonly achados: readonly AchadoSaneamento[];
  readonly porOrigem: Readonly<Record<string, number>>;
}

export function relatorioSaneamento(regras: readonly RegraDatada[]): RelatorioSaneamento {
  const achados: AchadoSaneamento[] = [];
  const porOrigem: Record<string, number> = {};
  for (const r of regras) {
    const motivo = motivoDataSuspeita(r.data);
    if (!motivo) continue;
    achados.push({ ...r, motivo });
    porOrigem[r.origem] = (porOrigem[r.origem] ?? 0) + 1;
  }
  achados.sort((a, b) => `${a.origem}${a.chave}`.localeCompare(`${b.origem}${b.chave}`));
  return { achados, porOrigem };
}
