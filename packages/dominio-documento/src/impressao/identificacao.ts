// Pulseira e etiqueta de identificação do paciente ligadas à impressora da estação e à reimpressão registrada
// (01-ADM L79). Desenho próprio: a primeira impressão de cada identificação do atendimento fica registrada (via 1);
// dali em diante toda nova impressão é reimpressão e só sai com o motivo do catálogo (e o complemento quando o motivo
// pede), com o número da via. Não existe reimpressão fora deste caminho. Quem imprime não escolhe impressora: a
// finalidade vem do tipo da identificação e a impressora vem da estação (regra de `estacao.ts`).
// Regra pura: sem banco nem I/O.
import { MENSAGEM_IMPRESSAO, planoReimpressao, type RecusaImpressao } from './estacao.js';

export const TIPOS_IDENTIFICACAO = ['pulseira', 'etiqueta'] as const;
export type TipoIdentificacao = (typeof TIPOS_IDENTIFICACAO)[number];

export type RecusaIdentificacao = RecusaImpressao | 'motivo-obrigatorio' | 'atendimento-inexistente';

export const MENSAGEM_IDENTIFICACAO: Readonly<Record<RecusaIdentificacao, string>> = {
  ...MENSAGEM_IMPRESSAO,
  'motivo-obrigatorio':
    'Esta identificação já foi impressa: para reimprimir, escolha o motivo da reimpressão.',
  'atendimento-inexistente': 'Atendimento não encontrado neste estabelecimento.',
};

export interface PlanoIdentificacao {
  readonly via: number;
  /** Falso só na primeira impressão (via 1). */
  readonly reimpressao: boolean;
  readonly complemento: string | null;
}

/**
 * O que acontece ao imprimir a identificação: sem via anterior é a 1ª impressão (o motivo, se vier, é ignorado);
 * com via anterior é reimpressão, que exige o motivo do catálogo e segue a regra da reimpressão (motivo ativo,
 * complemento quando o motivo pede, via crescente).
 */
export function planoImpressaoIdentificacao(f: {
  readonly viasAnteriores: number;
  readonly motivoInformado: boolean;
  readonly motivo: { readonly ativo: boolean; readonly exigeComplemento: boolean } | null;
  readonly complemento?: string | null;
}): { readonly recusa: RecusaIdentificacao } | PlanoIdentificacao {
  if (f.viasAnteriores < 1) return { via: 1, reimpressao: false, complemento: null };
  if (!f.motivoInformado) return { recusa: 'motivo-obrigatorio' };
  const p = planoReimpressao({
    viasAnteriores: f.viasAnteriores,
    motivo: f.motivo,
    complemento: f.complemento ?? null,
  });
  if ('recusa' in p) return p;
  return { via: p.via, reimpressao: true, complemento: p.complemento };
}

export interface FinalidadeCandidata {
  readonly id: number;
  readonly codigo: string;
  /** Tipo de mídia da finalidade (pulseira, etiqueta, a4...). */
  readonly midia: string;
  readonly ativa: boolean;
}

/**
 * A finalidade de impressão da identificação: a ativa cuja mídia é a do tipo. Na etiqueta, a do paciente ou do
 * prontuário vem antes das demais e a de amostra nunca serve (é do laboratório). Empate: a de menor código.
 */
export function finalidadeDaIdentificacao(
  tipo: TipoIdentificacao,
  finalidades: readonly FinalidadeCandidata[],
): number | null {
  const nota = (c: string): number => {
    const u = c.toUpperCase();
    if (tipo === 'pulseira') return u.includes('PULSEIRA') ? 0 : 1;
    if (/PACIENTE|PRONTUARIO|IDENTIFIC/.test(u)) return 0;
    return 1;
  };
  const serve = finalidades
    .filter((f) => f.ativa && f.midia === tipo)
    .filter((f) => tipo === 'pulseira' || !/AMOSTRA/i.test(f.codigo))
    .sort((a, b) => nota(a.codigo) - nota(b.codigo) || a.codigo.localeCompare(b.codigo));
  return serve[0]?.id ?? null;
}
