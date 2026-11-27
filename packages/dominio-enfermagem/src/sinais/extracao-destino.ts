// Rotina "destino confirmado -> aferição" (decisão 62, C2-003; ADR 0007). Regras puras:
//   - o destino só alimenta aferição quando o hospital o confirma: ativo, entidade 'afericao', com parâmetro vital e
//     com a pergunta do registro ligada (nunca por palpite de nome na carga);
//   - cada resposta histórica vira, no máximo, uma aferição (a porta grava o rastro e não reprocessa a já tratada);
//   - o valor sai do número da resposta ou do texto legível ("36,5", "120"); outro texto é pendência;
//   - a unidade da resposta, quando informada, tem de ser a do parâmetro (sem conversão presumida);
//   - fora da faixa possível do parâmetro (valor mínimo e máximo) é pendência, nunca aferição;
//   - o valor é arredondado às casas do parâmetro e recebe o nível pela faixa de alerta (fora dela, atenção).

export interface DestinoParaExtracao {
  readonly ativo: boolean;
  readonly entidadeDestino: string;
  readonly parametroVitalId: number | null;
  readonly modeloCampoId: number | null;
}

export interface ParametroParaExtracao {
  readonly tipoResposta: string;
  readonly unidade: string | null;
  readonly casasDecimais: number;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly alertaMinimo: number | null;
  readonly alertaMaximo: number | null;
}

export interface RespostaHistorica {
  readonly valorNumero: number | null;
  readonly valorTexto: string | null;
  readonly unidade: string | null;
}

export type MotivoPendenciaExtracao =
  'sem_valor' | 'valor_nao_numerico' | 'unidade_divergente' | 'fora_da_faixa';

export type DecisaoExtracao =
  | { readonly tipo: 'afericao'; readonly valor: number; readonly nivel: 'normal' | 'atencao' }
  | { readonly tipo: 'pendencia'; readonly motivo: MotivoPendenciaExtracao };

export type RecusaDestino =
  | 'destino-inativo'
  | 'destino-nao-afericao'
  | 'sem-parametro-vital'
  | 'sem-pergunta'
  | 'parametro-nao-numerico';

/** Por que o destino ainda não pode alimentar aferição; null quando o hospital já o confirmou. */
export function recusaDoDestino(
  d: DestinoParaExtracao,
  p: ParametroParaExtracao | null,
): RecusaDestino | null {
  if (!d.ativo) return 'destino-inativo';
  if (d.entidadeDestino !== 'afericao') return 'destino-nao-afericao';
  if (d.parametroVitalId === null || p === null) return 'sem-parametro-vital';
  if (d.modeloCampoId === null) return 'sem-pergunta';
  if (p.tipoResposta !== 'numero') return 'parametro-nao-numerico';
  return null;
}

const NUMERO_LEGIVEL = /^[-+]?\d+(?:[.,]\d+)?$/;

function normalizarUnidade(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/[\s.º°]/g, '');
}

/** O que a resposta histórica vira: aferição (valor e nível) ou pendência com o motivo. */
export function decidirExtracao(r: RespostaHistorica, p: ParametroParaExtracao): DecisaoExtracao {
  let valor: number | null = r.valorNumero;
  if (valor === null) {
    const t = r.valorTexto?.trim() ?? '';
    if (t === '') return { tipo: 'pendencia', motivo: 'sem_valor' };
    if (!NUMERO_LEGIVEL.test(t)) return { tipo: 'pendencia', motivo: 'valor_nao_numerico' };
    valor = Number(t.replace(',', '.'));
  }
  if (!Number.isFinite(valor)) return { tipo: 'pendencia', motivo: 'valor_nao_numerico' };
  const ur = r.unidade?.trim() ? normalizarUnidade(r.unidade) : '';
  if (ur !== '' && p.unidade !== null && ur !== normalizarUnidade(p.unidade)) {
    return { tipo: 'pendencia', motivo: 'unidade_divergente' };
  }
  const fator = 10 ** p.casasDecimais;
  const arredondado = Math.round(valor * fator) / fator;
  if (
    (p.valorMinimo !== null && arredondado < p.valorMinimo) ||
    (p.valorMaximo !== null && arredondado > p.valorMaximo)
  ) {
    return { tipo: 'pendencia', motivo: 'fora_da_faixa' };
  }
  const atencao =
    (p.alertaMinimo !== null && arredondado < p.alertaMinimo) ||
    (p.alertaMaximo !== null && arredondado > p.alertaMaximo);
  return { tipo: 'afericao', valor: arredondado, nivel: atencao ? 'atencao' : 'normal' };
}

export interface ResultadoExtracao {
  readonly gerados: number;
  readonly recusados: number;
  readonly porMotivo: Readonly<Partial<Record<MotivoPendenciaExtracao, number>>>;
}
