// Cliente das telas internas do portal do paciente (M50, etapa 1): a conta do portal na ficha do paciente e a
// conferência dos responsáveis legais. Sessão interna: CSRF da plataforma e Idempotency-Key; as ações críticas mandam
// a senha da reautenticação. Respostas validadas pelos contratos.
import {
  type AtoCopiaItem,
  type ContaPortalResumo,
  type CopiaNaFilaItem,
  type ConviteEmitido,
  esquemaAtoCopiaItem,
  esquemaContaPortalResumo,
  esquemaCopiaNaFila,
  esquemaConviteEmitido,
  esquemaFilaVinculos,
  esquemaTrocaEmailPedida,
  esquemaVinculoParaConferir,
  type FilaVinculos,
  type TrocaEmailPedida,
  type VinculoParaConferir,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/portal-paciente';
const JSON_ACEITO = { accept: 'application/json' };

const chave = () => {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
};
async function json<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const postar = (url: string, corpo: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo ?? {}),
  });

export const esquemaContaNaFicha = z.object({
  conta: esquemaContaPortalResumo.nullable(),
  ligado: z.boolean(),
});
export type ContaNaFicha = z.infer<typeof esquemaContaNaFicha>;

export const contaDoPaciente = (paciente: number): Promise<ContaNaFicha> =>
  fetch(`${P}/pacientes/${paciente}/conta`, { headers: JSON_ACEITO }).then((r) =>
    json(r, esquemaContaNaFicha),
  );
export const convidarPaciente = (paciente: number, origem: string): Promise<ConviteEmitido> =>
  postar(`${P}/pacientes/${paciente}/convite`, { origem }).then((r) => json(r, esquemaConviteEmitido));
export const convidarResponsavel = (
  paciente: number,
  corpo: Record<string, unknown>,
): Promise<ConviteEmitido> =>
  postar(`${P}/pacientes/${paciente}/responsavel`, corpo).then((r) => json(r, esquemaConviteEmitido));
export const bloquearConta = (conta: string, corpo: Record<string, unknown>): Promise<ContaPortalResumo> =>
  postar(`${P}/contas/${conta}/bloqueio`, corpo).then((r) => json(r, esquemaContaPortalResumo));
export const desbloquearConta = (conta: string, corpo: Record<string, unknown>) =>
  postar(`${P}/contas/${conta}/desbloqueio`, corpo).then((r) =>
    json(r, z.object({ conta: esquemaContaPortalResumo, convite: esquemaConviteEmitido.nullable() })),
  );
export const encerrarConta = (conta: string, corpo: Record<string, unknown>): Promise<ContaPortalResumo> =>
  postar(`${P}/contas/${conta}/encerramento`, corpo).then((r) => json(r, esquemaContaPortalResumo));

/** Uma página da fila da conferência: a situação, a busca pelo prontuário do representado e o cursor. */
export function filaVinculos(
  situacao: string,
  prontuario: string | null = null,
  depoisDe: string | null = null,
): Promise<FilaVinculos> {
  const q = new URLSearchParams({ situacao });
  if (prontuario) q.set('prontuario', prontuario);
  if (depoisDe) q.set('depoisDe', depoisDe);
  return fetch(`${P}/vinculos?${q.toString()}`, { headers: JSON_ACEITO }).then((r) =>
    json(r, esquemaFilaVinculos),
  );
}
/** Os responsáveis vigentes (pendentes e ativos) do paciente, na ficha. */
export const responsaveisDoPaciente = (paciente: number): Promise<VinculoParaConferir[]> =>
  fetch(`${P}/pacientes/${paciente}/responsaveis`, { headers: JSON_ACEITO }).then((r) =>
    json(r, z.array(esquemaVinculoParaConferir)),
  );
export const provaDoVinculo = (vinculo: string) =>
  fetch(`${P}/vinculos/${vinculo}/prova`, { headers: JSON_ACEITO }).then((r) =>
    json(r, z.object({ tipo: z.string(), conteudo: z.string() })),
  );
export const decidirVinculo = (
  vinculo: string,
  corpo: Record<string, unknown>,
): Promise<VinculoParaConferir> =>
  postar(`${P}/vinculos/${vinculo}/decisao`, corpo).then((r) => json(r, esquemaVinculoParaConferir));
export async function encerrarVinculo(vinculo: string, corpo: Record<string, unknown>): Promise<void> {
  const r = await postar(`${P}/vinculos/${vinculo}/encerramento`, corpo);
  if (!r.ok) throw await erroDaResposta(r);
}

// W0-10: a troca do e-mail no balcão (com a confirmação no e-mail novo) e a redefinição do segundo fator.
export const trocaEmailDaConta = (conta: string): Promise<TrocaEmailPedida | null> =>
  fetch(`${P}/contas/${conta}/email/troca`, { headers: JSON_ACEITO })
    .then((r) => json(r, z.object({ troca: esquemaTrocaEmailPedida.nullable() })))
    .then((x) => x.troca);
export const trocarEmailConta = (conta: string, corpo: Record<string, unknown>): Promise<TrocaEmailPedida> =>
  postar(`${P}/contas/${conta}/email`, corpo).then((r) => json(r, esquemaTrocaEmailPedida));
export async function cancelarTrocaEmailConta(conta: string, corpo: { senha: string }): Promise<void> {
  const r = await postar(`${P}/contas/${conta}/email/troca/cancelamento`, corpo);
  if (!r.ok) throw await erroDaResposta(r);
}
export const redefinirSegundoFator = (conta: string, corpo: Record<string, unknown>) =>
  postar(`${P}/contas/${conta}/segundo-fator/redefinicao`, corpo).then((r) =>
    json(r, z.object({ conta: esquemaContaPortalResumo, convite: esquemaConviteEmitido })),
  );

// W0-10 (M2): a fila da cópia do prontuário no balcão (pedido, legitimidade, geração do PDF e entrega).
export function filaCopias(pendentes: boolean, paciente: number | null = null): Promise<CopiaNaFilaItem[]> {
  const q = new URLSearchParams({ pendentes: pendentes ? 'sim' : 'nao' });
  if (paciente !== null) q.set('paciente', String(paciente));
  return fetch(`${P}/copias?${q.toString()}`, { headers: JSON_ACEITO }).then((r) =>
    json(r, z.array(esquemaCopiaNaFila)),
  );
}
export const atosDaCopia = (protocolo: string): Promise<AtoCopiaItem[]> =>
  fetch(`${P}/copias/${encodeURIComponent(protocolo)}/atos`, { headers: JSON_ACEITO }).then((r) =>
    json(r, z.array(esquemaAtoCopiaItem)),
  );
export const pedirCopiaBalcao = (corpo: Record<string, unknown>) =>
  postar(`${P}/copias`, corpo).then((r) => json(r, z.object({ protocolo: z.string() })));
async function semCorpo(r: Response): Promise<void> {
  if (!r.ok) throw await erroDaResposta(r);
}
export const conferirLegitimidadeCopia = (protocolo: string, corpo: Record<string, unknown>) =>
  postar(`${P}/copias/${encodeURIComponent(protocolo)}/legitimidade`, corpo).then(semCorpo);
export const entregarCopia = (protocolo: string, corpo: Record<string, unknown>) =>
  postar(`${P}/copias/${encodeURIComponent(protocolo)}/entrega`, corpo).then(semCorpo);
/** Gera o PDF (cada geração vai à trilha com o hash): devolve o arquivo, o hash e as páginas. */
export async function gerarCopia(protocolo: string): Promise<{ pdf: Blob; hash: string; paginas: number }> {
  const r = await fetch(`${P}/copias/${encodeURIComponent(protocolo)}/geracao`, {
    method: 'POST',
    headers: {
      accept: 'application/pdf',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: '{}',
  });
  if (!r.ok) throw await erroDaResposta(r);
  return {
    pdf: await r.blob(),
    hash: r.headers.get('x-copia-sha256') ?? '',
    paginas: Number(r.headers.get('x-copia-paginas') ?? '0'),
  };
}
