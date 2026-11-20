// Cliente da tela do balanço hídrico (M45, etapa 3). As leituras vêm tipadas pelos contratos; as gravações levam o
// CSRF e a Idempotency-Key (o mesmo pedido reenviado não grava duas vezes). Problem Details viram ErroApi.
import type { BalancoDoPaciente, ResultadoBalanco } from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { consulta, novaChave } from './api-enfermagem.js';

const B = '/api/enfermagem/balanco';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface UnidadeBalanco {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}
export interface PacienteBalanco {
  readonly paciente: number;
  readonly atendimento: number;
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
}

export const lerUnidadesBalanco = (b?: typeof fetch) => ler<UnidadeBalanco[]>(`${B}/unidades`, b);
export const lerPacientesBalanco = (unidade: string, b?: typeof fetch) =>
  ler<PacienteBalanco[]>(`${B}/unidades/${encodeURIComponent(unidade)}/pacientes`, b);
export const lerBalanco = (
  atendimento: number,
  o: { inicio?: string | null; peso?: number | null } = {},
  b?: typeof fetch,
) => ler<BalancoDoPaciente>(`${B}/${atendimento}${consulta({ inicio: o.inicio, peso: o.peso })}`, b);

export const lancarBalanco = (atendimento: number, lancamentos: unknown[], b?: typeof fetch) =>
  enviar<ResultadoBalanco>(`${B}/${atendimento}/lancamentos`, { lancamentos }, novaChave('balanco'), b);
export const estornarLancamento = (atendimento: number, id: number, motivo: string, b?: typeof fetch) =>
  enviar<ResultadoBalanco>(
    `${B}/${atendimento}/lancamentos/${id}/estorno`,
    { motivo },
    novaChave(`estorno-${id}`),
    b,
  );
export const fecharBalanco = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoBalanco>(`${B}/${atendimento}/fechamentos`, corpo, novaChave('fechamento'), b);
