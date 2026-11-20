// W0-03, mercado M3: cliente da tela do relógio de protocolos no internado. As leituras vêm tipadas pelos contratos; as
// gravações levam o CSRF e a Idempotency-Key. Problem Details viram ErroApi (o código da recusa em `problema.codigo`).
import type {
  EncerrarProtocoloInternadoEntrada,
  IncluirProtocoloInternadoEntrada,
  IndicadorOrigemProtocolo,
  RegistrarMetaInternadoEntrada,
  RelogioInternado,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-enfermagem.js';

const C = '/api/enfermagem/protocolos-internado';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('protocolo-internado'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

interface Feito {
  readonly ok: true;
  readonly mensagem: string;
}

export const lerRelogioInternado = (unidade: string) =>
  ler<RelogioInternado>(`${C}/relogio?unidade=${encodeURIComponent(unidade)}`);
export const lerIndicadoresProtocolo = (de: string, ate: string) =>
  ler<{ periodo: { desde: string; ate: string }; indicadores: IndicadorOrigemProtocolo[] }>(
    `${C}/indicadores?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
  );
export const incluirProtocoloInternado = (
  e: Omit<IncluirProtocoloInternadoEntrada, 'escore' | 'reconhecidoEm' | 'observacao'> &
    Partial<Pick<IncluirProtocoloInternadoEntrada, 'escore' | 'reconhecidoEm' | 'observacao'>>,
) => enviar<Feito & { id: number; reconhecidoEm: string }>(C, e);
export const registrarMetaInternado = (
  id: number,
  e: Omit<RegistrarMetaInternadoEntrada, 'quando' | 'motivo'> &
    Partial<Pick<RegistrarMetaInternadoEntrada, 'quando' | 'motivo'>>,
) => enviar<Feito & { situacao: 'cumprida' | 'perdida' }>(`${C}/${id}/metas`, e);
export const encerrarProtocoloInternado = (
  id: number,
  e: Omit<EncerrarProtocoloInternadoEntrada, 'motivo'> &
    Partial<Pick<EncerrarProtocoloInternadoEntrada, 'motivo'>>,
) => enviar<Feito>(`${C}/${id}/encerrar`, e);
export const inativarProtocoloInternado = (id: number, motivo: string, senha: string) =>
  enviar<Feito>(`${C}/${id}/inativar`, { motivo, senha });
