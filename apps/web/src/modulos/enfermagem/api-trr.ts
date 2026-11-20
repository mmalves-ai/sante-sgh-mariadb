// W0-03, mercado M2: cliente da tela do Time de Resposta Rápida e da ficha da parada (Utstein). As leituras vêm tipadas
// pelos contratos; as gravações levam o CSRF e a Idempotency-Key. Problem Details viram ErroApi.
import type {
  AcionamentoTrrLido,
  AlertaTrrAberto,
  DadosPcr,
  DesfechoTrr,
  FichaPcrLida,
  IndicadoresTrrPcr,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-enfermagem.js';

const T = '/api/enfermagem/trr';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<R>(url: string): Promise<R> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as R;
}

async function enviar<R>(url: string, corpo: unknown): Promise<R> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('trr'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as R;
}

export interface TelaTrr {
  readonly unidade: string;
  readonly agora: string;
  readonly alertas: readonly AlertaTrrAberto[];
  readonly pacientes: readonly { paciente: number; atendimento: number; leito: string; nome: string }[];
  readonly acionamentos: readonly (AcionamentoTrrLido & { leito: string; nome: string })[];
  readonly fichas: readonly FichaPcrLida[];
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null; readonly agir: boolean };
}
interface Feito {
  readonly ok: true;
  readonly mensagem: string;
}

export const lerTrr = (unidade: string) =>
  ler<TelaTrr>(`${T}/unidade?unidade=${encodeURIComponent(unidade)}`);
export const lerIndicadoresTrr = (de: string, ate: string) =>
  ler<IndicadoresTrrPcr>(`${T}/indicadores?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
export const acionarTrr = (e: { paciente: number; atendimento: number; escore?: number; motivo?: string }) =>
  enviar<Feito & { id: number }>(T, e);
export const eventoTrr = (id: number, tipo: 'chegada' | 'desfecho', desfecho?: DesfechoTrr) =>
  enviar<Feito>(`${T}/${id}/eventos`, { tipo, ...(desfecho ? { desfecho } : {}) });
export const gravarFichaPcr = (e: {
  paciente: number;
  atendimento: number;
  trr?: number;
  dados: DadosPcr;
  finalizar: boolean;
}) => enviar<Feito & { id: number; versao: number }>(`${T}/pcr`, e);
export const novaVersaoPcr = (id: number, dados: DadosPcr, finalizar: boolean) =>
  enviar<Feito & { id: number; versao: number }>(`${T}/pcr/${id}/versoes`, { dados, finalizar });
// Revisão W0-03: a correção da finalizada (com a justificativa), a retificação da chegada ou do desfecho e a
// inativação do lançado errado (com a senha).
export const corrigirFichaPcr = (id: number, dados: DadosPcr, motivo: string) =>
  enviar<Feito & { id: number; versao: number }>(`${T}/pcr/${id}/versoes`, {
    dados,
    finalizar: true,
    motivo,
  });
export const retificarEventoTrr = (
  evento: number,
  e: { em?: string; desfecho?: DesfechoTrr; motivo: string },
) => enviar<Feito & { id: number }>(`${T}/eventos/${evento}/retificar`, e);
export const inativarTrr = (origem: 'trr' | 'evento' | 'pcr', id: number, motivo: string, senha: string) =>
  enviar<Feito>(
    origem === 'trr'
      ? `${T}/${id}/inativar`
      : origem === 'evento'
        ? `${T}/eventos/${id}/inativar`
        : `${T}/pcr/${id}/inativar`,
    { motivo, senha },
  );
