// O registro da vacina aplicada (M45, etapa 4; regra 18; Portaria GM/MS 5.663/2024 e RDC 197/2017): o imunobiológico é
// um dos que o estabelecimento aplica (parâmetro com o código do catálogo do modelo de informação); o lote dentro da
// validade no dia da aplicação; a mesma dose do mesmo imunobiológico uma vez só por paciente (o reforço repete); a
// aplicação não é no futuro e, registrada depois, até 15 dias (o prazo das salas sem conectividade). O envio RIA à RNDS
// vence 24 horas depois da aplicação; o envio é do conector do M34 (outbox), nunca daqui.
import {
  DOSES_QUE_REPETEM,
  type DoseVacina,
  type ImunobiologicoVacina,
  type RegistrarVacinaEntrada,
  type SituacaoEnvioVacina,
} from '@sgh/contratos';
import { diferencaMinutos, somarMinutos } from '../tempo.js';
import type { RecusaSae } from './processo.js';

const recusa = (codigo: string, mensagem: string, campo?: string): RecusaSae => ({
  ok: false,
  codigo,
  mensagem,
  ...(campo ? { campo } : {}),
});

/** Os imunobiológicos do parâmetro (`codigo:nome;...`); o que não estiver no formato fica de fora. */
export function lerImunobiologicos(valor: string | null | undefined): ImunobiologicoVacina[] {
  const saida: ImunobiologicoVacina[] = [];
  for (const parte of String(valor ?? '').split(';')) {
    const m = /^\s*([A-Za-z0-9]{1,10}):([^;:]{2,120})$/.exec(parte);
    if (m && !saida.some((x) => x.codigo === m[1])) saida.push({ codigo: m[1]!, nome: m[2]!.trim() });
  }
  return saida;
}

/** O prazo do envio RIA (24 horas depois da aplicação; Portaria GM/MS 5.663/2024). */
export function prazoEnvioRia(aplicadaEm: string): string {
  return somarMinutos(aplicadaEm.slice(0, 16), 24 * 60);
}

/** A dose repete (o reforço) ou é uma vez só por paciente? */
export function doseRepete(dose: DoseVacina): boolean {
  return DOSES_QUE_REPETEM.includes(dose);
}

/** A chave da dose (uma por paciente, imunobiológico e dose; nula no reforço). */
export function chaveDaDose(
  hospital: string,
  paciente: number,
  imunobiologico: string,
  dose: DoseVacina,
): string | null {
  return doseRepete(dose) ? null : `${hospital}:${paciente}:${imunobiologico}:${dose}`;
}

export interface VacinaConferida {
  readonly ok: true;
  readonly imunobiologico: ImunobiologicoVacina;
  readonly aplicadaEm: string;
  readonly prazoEnvio: string;
}

/** Regra 18: confere o registro da vacina aplicada. */
export function conferirVacina(
  e: RegistrarVacinaEntrada,
  o: {
    readonly agora: string;
    readonly imunobiologicos: readonly ImunobiologicoVacina[];
    readonly jaAplicadas: readonly { readonly imunobiologico: string; readonly dose: DoseVacina }[];
  },
): VacinaConferida | RecusaSae {
  const imuno = o.imunobiologicos.find((x) => x.codigo === e.imunobiologico);
  if (!imuno)
    return recusa(
      'imunobiologico-desconhecido',
      'O imunobiológico não está na lista dos que este estabelecimento aplica.',
      'imunobiologico',
    );
  const agora = o.agora.slice(0, 16);
  const aplicadaEm = (e.aplicadaEm ?? agora).slice(0, 16);
  if (aplicadaEm > agora) return recusa('aplicacao-futura', 'A aplicação é depois de agora.', 'aplicadaEm');
  if (diferencaMinutos(aplicadaEm, agora) > 15 * 24 * 60)
    return recusa(
      'aplicacao-antiga',
      'O registro da vacina vai até 15 dias depois da aplicação.',
      'aplicadaEm',
    );
  if (e.validadeLote < aplicadaEm.slice(0, 10))
    return recusa(
      'lote-vencido',
      'O lote estava vencido no dia da aplicação: confira o lote.',
      'validadeLote',
    );
  if (
    !doseRepete(e.dose) &&
    o.jaAplicadas.some((x) => x.imunobiologico === e.imunobiologico && x.dose === e.dose)
  )
    return recusa(
      'dose-ja-registrada',
      `A dose ${e.dose} deste imunobiológico já foi registrada para o paciente.`,
      'dose',
    );
  return { ok: true, imunobiologico: imuno, aplicadaEm, prazoEnvio: prazoEnvioRia(aplicadaEm) };
}

/**
 * A situação do envio RIA: pelo evento na fila de saída (pendente, publicado ou morto) e pela entrega do conector do
 * M34 ao parceiro da RNDS (enviado, morto ou descartado); com o conector desligado, aguarda.
 */
export function situacaoDoEnvio(o: {
  readonly conectorLigado: boolean;
  readonly evento: 'pendente' | 'publicado' | 'morto' | null;
  readonly entrega: 'pendente' | 'enviado' | 'morto' | 'descartado' | null;
  readonly prazo: string;
  readonly agora: string;
}): { situacao: SituacaoEnvioVacina; vencido: boolean } {
  const situacao: SituacaoEnvioVacina =
    o.entrega === 'enviado'
      ? 'enviado'
      : o.entrega === 'morto' || o.entrega === 'descartado' || o.evento === 'morto'
        ? 'falhou'
        : o.conectorLigado
          ? 'naFila'
          : 'aguardandoConector';
  return { situacao, vencido: situacao !== 'enviado' && o.agora.slice(0, 16) > o.prazo.slice(0, 16) };
}
