// Justificativa para imprimir documento do prontuário (01-ADM L82; LGPD, art. 6º, e CFM 1.821/2007: a cópia em
// papel sai do controle do sistema). Toda impressão diz por quê: a 1ª via pede a justificativa (com as razões
// mais comuns à mão, para não digitar), a 2ª via em diante pede o motivo da nova via. O que fica gravado é o
// evento do documento (tipo, justificativa, quem e quando), nunca apagado. Regra pura: sem banco nem I/O.

/** Mínimo da justificativa da 1ª via (o mesmo da exportação do prontuário). */
export const JUSTIFICATIVA_MINIMA_IMPRESSAO = 10;
/** Mínimo do motivo da 2ª via em diante. */
export const MOTIVO_MINIMO_SEGUNDA_VIA = 5;
export const JUSTIFICATIVA_MAXIMA_IMPRESSAO = 255;

/** Razões mais comuns (a tela oferece como atalho; o texto continua livre). */
export const RAZOES_IMPRESSAO = [
  'Entrega ao paciente ou ao responsável legal',
  'Continuidade do cuidado em outro serviço',
  'Auditoria do convênio',
  'Solicitação judicial ou de órgão público',
  'Arquivo físico exigido pelo setor',
] as const;

export type TipoEventoImpressao = 'impresso' | 'segunda-via';

export type ResultadoJustificativaImpressao =
  | { readonly ok: true; readonly tipo: TipoEventoImpressao; readonly justificativa: string }
  | {
      readonly ok: false;
      readonly codigo: 'justificativa-obrigatoria' | 'motivo-obrigatorio' | 'justificativa-longa';
      readonly mensagem: string;
    };

/**
 * Decide o evento da impressão: sem via anterior, é a 1ª via e exige a justificativa; com via anterior, é nova
 * via e exige o motivo (aceita a justificativa no lugar, para a tela mandar um campo só).
 */
export function regraJustificativaImpressao(e: {
  readonly viaAnterior: boolean;
  readonly justificativa?: string | null;
  readonly motivo?: string | null;
}): ResultadoJustificativaImpressao {
  const just = (e.justificativa ?? '').trim();
  const motivo = (e.motivo ?? '').trim();
  if (e.viaAnterior) {
    const texto = motivo || just;
    if (texto.length < MOTIVO_MINIMO_SEGUNDA_VIA)
      return {
        ok: false,
        codigo: 'motivo-obrigatorio',
        mensagem: `Informe o motivo da nova via (mínimo de ${MOTIVO_MINIMO_SEGUNDA_VIA} caracteres).`,
      };
    if (texto.length > JUSTIFICATIVA_MAXIMA_IMPRESSAO)
      return { ok: false, codigo: 'justificativa-longa', mensagem: 'O motivo passa do tamanho aceito.' };
    return { ok: true, tipo: 'segunda-via', justificativa: texto };
  }
  if (just.length < JUSTIFICATIVA_MINIMA_IMPRESSAO)
    return {
      ok: false,
      codigo: 'justificativa-obrigatoria',
      mensagem: `Informe a justificativa da impressão (mínimo de ${JUSTIFICATIVA_MINIMA_IMPRESSAO} caracteres).`,
    };
  if (just.length > JUSTIFICATIVA_MAXIMA_IMPRESSAO)
    return { ok: false, codigo: 'justificativa-longa', mensagem: 'A justificativa passa do tamanho aceito.' };
  return { ok: true, tipo: 'impresso', justificativa: just };
}
