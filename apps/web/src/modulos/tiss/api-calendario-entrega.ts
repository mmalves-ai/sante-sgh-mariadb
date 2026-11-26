// Cliente do cadastro do calendário de entrega da fatura por convênio (06-FAT linha 31): lista, inclui, altera e
// inativa as janelas. A gravação vai com a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o
// texto do servidor (janela sobreposta, entrega antes da competência, versão alterada).
import type { JanelaCalendarioLida } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const URL = '/api/tiss/calendario-entrega';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = z.object({ id: z.number(), versao: z.number() }).passthrough();

export interface PedidoJanela {
  competencia: string;
  inicio: string;
  fim: string;
  pagamentoPrevisto: string | null;
  prazoPagamentoDias: number | null;
  restritivo: boolean;
  observacao: string;
}

export const listarCalendario = (f: { convenio?: string; inativas?: boolean }) =>
  ler(
    `${URL}${qs({ convenio: f.convenio || undefined, inativas: f.inativas ? '1' : undefined })}`,
    z.array(confiar<JanelaCalendarioLida>()),
  );

export const incluirJanela = (corpo: PedidoJanela & { convenio: number }, chave: string) =>
  enviar(URL, corpo, resultado, chave);

export const alterarJanela = (id: number, corpo: PedidoJanela & { versao: number }, chave: string) =>
  enviar(`${URL}/${id}`, corpo, resultado, chave);

export const inativarJanela = (id: number, versao: number, chave: string) =>
  enviar(`${URL}/${id}/inativacao`, { versao }, resultado, chave);
