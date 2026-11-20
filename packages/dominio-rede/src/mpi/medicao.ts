// Medição do pareamento só em agregados (M57, ficha, seção 10; regra 1.7 das convenções; DP-41): quantos vínculos
// automáticos, quantos na fila, por faixa de pontuação, quantos descartados. Contagem entre 1 e 4 sai como "<5" no que
// vai para evidência (nenhum número pequeno que permita reidentificar alguém).
import { faixaPontuacaoRede } from '@sgh/contratos';
import type { DecisaoPar } from './automatico.js';

export interface ResumoPareamento {
  readonly pares: number;
  readonly automaticos: number;
  readonly naFila: number;
  readonly descartados: number;
  readonly duplicadosLocais: number;
  readonly inelegiveis: number;
  readonly jaDecididos: number;
  readonly filaPorFaixa: { readonly alta: number; readonly media: number; readonly baixa: number };
}

export function resumirPareamento(decisoes: readonly DecisaoPar[]): ResumoPareamento {
  const filaPorFaixa = { alta: 0, media: 0, baixa: 0 };
  let automaticos = 0;
  let naFila = 0;
  let descartados = 0;
  let duplicadosLocais = 0;
  let inelegiveis = 0;
  let jaDecididos = 0;
  for (const d of decisoes) {
    if (d.destino === 'vincular_automatico') automaticos++;
    else if (d.destino === 'fila') {
      naFila++;
      filaPorFaixa[faixaPontuacaoRede(d.pontuacao) ?? 'baixa']++;
    } else if (d.destino === 'descartar') descartados++;
    else if (d.destino === 'fila_duplicidade_local') duplicadosLocais++;
    else if (d.destino === 'inelegivel') inelegiveis++;
    else jaDecididos++;
  }
  return {
    pares: decisoes.length,
    automaticos,
    naFila,
    descartados,
    duplicadosLocais,
    inelegiveis,
    jaDecididos,
    filaPorFaixa,
  };
}

/** Contagem para evidência: de 1 a 4 vira "<5". */
export function contagemSegura(n: number): string {
  return n > 0 && n < 5 ? '<5' : String(n);
}
