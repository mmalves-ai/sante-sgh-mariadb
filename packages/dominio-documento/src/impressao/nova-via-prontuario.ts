// Nova via de documento do prontuário (01-ADM L79 e L82): um só caminho de motivo para toda reimpressão. A 1ª via
// leva a justificativa (regra do PEP); da 2ª via em diante o motivo vem do catálogo de motivos de reimpressão, com o
// complemento quando o motivo pede, e a via entra no registro de reimpressões. O texto gravado na emissão (o que o
// PDF e o registro da emissão mostram) é a descrição do motivo, mais o complemento. Regra pura: sem banco nem I/O.
import { MENSAGEM_IMPRESSAO, planoReimpressao, type RecusaImpressao } from './estacao.js';

export type RecusaNovaVia = RecusaImpressao | 'motivo-obrigatorio';

export const MENSAGEM_NOVA_VIA: Readonly<Record<RecusaNovaVia, string>> = {
  ...MENSAGEM_IMPRESSAO,
  'motivo-obrigatorio': 'Este documento já foi impresso: para a nova via, escolha o motivo da reimpressão.',
};

/** O que cabe no motivo gravado na emissão (o mesmo do motivo da reemissão). */
export const TEXTO_MAXIMO_MOTIVO_EMISSAO = 200;

export interface MotivoCatalogo {
  readonly ativo: boolean;
  readonly exigeComplemento: boolean;
  readonly descricao: string;
}

export interface PlanoNovaVia {
  readonly via: number;
  readonly complemento: string | null;
  /** O motivo como fica na emissão: a descrição do catálogo, mais o complemento. */
  readonly textoEmissao: string;
}

/**
 * Confere a nova via do documento já impresso: motivo informado e do catálogo, ativo, complemento quando o motivo
 * pede; a via é a seguinte à maior já conhecida (registro de reimpressões, vias do documento e da emissão).
 */
export function planoNovaViaProntuario(f: {
  readonly viasAnteriores: number;
  readonly motivoInformado: boolean;
  readonly motivo: MotivoCatalogo | null;
  readonly complemento?: string | null;
}): { readonly recusa: RecusaNovaVia } | PlanoNovaVia {
  if (f.viasAnteriores < 1) return { recusa: 'documento-nunca-impresso' };
  if (!f.motivoInformado) return { recusa: 'motivo-obrigatorio' };
  const p = planoReimpressao({
    viasAnteriores: f.viasAnteriores,
    motivo: f.motivo,
    complemento: f.complemento ?? null,
  });
  if ('recusa' in p) return p;
  const descricao = (f.motivo?.descricao ?? '').trim();
  const texto = p.complemento ? `${descricao}: ${p.complemento}` : descricao;
  return {
    via: p.via,
    complemento: p.complemento,
    textoEmissao: texto.slice(0, TEXTO_MAXIMO_MOTIVO_EMISSAO),
  };
}
