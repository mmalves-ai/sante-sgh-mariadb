// Justificativa para imprimir documento do prontuário (01-ADM L82; LGPD, art. 6º, e CFM 1.821/2007: a cópia em
// papel sai do controle do sistema). Toda impressão diz por quê: a 1ª via pede a justificativa (com as razões
// mais comuns à mão, para não digitar), a 2ª via em diante pede o motivo da nova via. O que fica gravado é o
// evento do documento (tipo, justificativa, quem e quando), nunca apagado. Regra pura: sem banco nem I/O.

/** Mínimo da justificativa da 1ª via (o mesmo da exportação do prontuário). */
export const JUSTIFICATIVA_MINIMA_IMPRESSAO = 10;
/** Mínimo do motivo da 2ª via em diante. */
export const MOTIVO_MINIMO_SEGUNDA_VIA = 5;
/** O que cabe no registro da emissão (o mesmo do motivo da reemissão). */
export const JUSTIFICATIVA_MAXIMA_IMPRESSAO = 200;

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

/** Como a via entra no registro único de impressão e exportação (quem, quando, o quê e por quê). */
export type OperacaoRegistroImpressao = 'impressao' | 'reimpressao';

export type RegistroDaVia =
  | {
      readonly ok: true;
      readonly operacao: OperacaoRegistroImpressao;
      readonly justificativa: string | null;
    }
  | { readonly ok: false; readonly codigo: 'justificativa-obrigatoria' | 'motivo-obrigatorio' };

/** O que cabe no texto do registro único. */
export const TEXTO_MAXIMO_REGISTRO_IMPRESSAO = 500;

/**
 * A linha do registro único de cada via emitida (documento do prontuário, prescrição, laudo de exame): a 1ª via é
 * "impressao" e as seguintes "reimpressao", sempre com o motivo. A 1ª via só dispensa o texto quando a emissão é o
 * próprio ato de entrega (o laudo de exame liberado, `primeiraViaPedeTexto: false`).
 */
export function registroDaVia(e: {
  readonly via: number;
  readonly texto?: string | null;
  readonly primeiraViaPedeTexto: boolean;
}): RegistroDaVia {
  const texto = (e.texto ?? '').trim().slice(0, TEXTO_MAXIMO_REGISTRO_IMPRESSAO);
  if (e.via > 1)
    return texto
      ? { ok: true, operacao: 'reimpressao', justificativa: texto }
      : { ok: false, codigo: 'motivo-obrigatorio' };
  if (!texto && e.primeiraViaPedeTexto) return { ok: false, codigo: 'justificativa-obrigatoria' };
  return { ok: true, operacao: 'impressao', justificativa: texto || null };
}
