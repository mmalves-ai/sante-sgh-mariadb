// Cliente das telas do M59-F5 (ficha do M59, seção 7): certificação SBIS (requisitos, pacote de evidências e ciclos),
// backup verificado e concessões da coexistência, validado pelos contratos. As gravações levam o CSRF da sessão e a
// Idempotency-Key (uma por pedido); encerrar e reabrir concessão e concluir ciclo levam a senha digitada na hora
// (reautenticação; nunca guardada). A exportação da trilha para a auditoria é um link (download) com o período.
import {
  type AbrirCicloPedido,
  type AvaliarItemPedido,
  type BackupVerificado,
  type CicloSbisDetalhe,
  type CodigoConcessao,
  esquemaBackupVerificado,
  esquemaCicloSbisDetalhe,
  esquemaItemCicloSbis,
  esquemaPainelConcessoes,
  esquemaPainelSbis,
  type ItemCicloSbis,
  type PainelConcessoes,
  type PainelSbis,
  type RegistrarRestauracaoPedido,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
export const BASE_CONCESSOES = '/api/administracao/coexistencia/concessoes';
export const BASE_SBIS = '/api/administracao/auditoria/sbis';
export const BASE_BACKUP_VERIFICADO = '/api/administracao/auditoria/backup';
export const BASE_EXPORTAR_SBIS = '/api/administracao/auditoria/trilha/exportar-sbis';

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  buscar: typeof fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const qualquer = z.record(z.string(), z.unknown());
const e = (s: string) => encodeURIComponent(s);

// ── concessões da coexistência ─────────────────────────────────────────────────────────────────

export const buscarConcessoes = (buscar: typeof fetch = fetch): Promise<PainelConcessoes> =>
  ler(BASE_CONCESSOES, esquemaPainelConcessoes, buscar);

export const encerrarConcessao = (
  codigo: CodigoConcessao,
  evidencia: string,
  senha: string,
  buscar: typeof fetch = fetch,
) => enviar(`${BASE_CONCESSOES}/${e(codigo)}/encerrar`, { evidencia, senha }, qualquer, buscar);

export const reabrirConcessao = (
  codigo: CodigoConcessao,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
) => enviar(`${BASE_CONCESSOES}/${e(codigo)}/reabrir`, { motivo, senha }, qualquer, buscar);

export const preverConcessao = (
  codigo: CodigoConcessao,
  fimPrevisto: string | null,
  buscar: typeof fetch = fetch,
) => enviar(`${BASE_CONCESSOES}/${e(codigo)}/previsao`, { fimPrevisto }, qualquer, buscar);

// ── certificação ──────────────────────────────────────────────────────────────────────────────

export const buscarPainelSbis = (buscar: typeof fetch = fetch): Promise<PainelSbis> =>
  ler(BASE_SBIS, esquemaPainelSbis, buscar);

export const buscarCicloSbis = (id: string, buscar: typeof fetch = fetch): Promise<CicloSbisDetalhe> =>
  ler(`${BASE_SBIS}/ciclos/${e(id)}`, esquemaCicloSbisDetalhe, buscar);

export const abrirCicloSbis = (
  p: AbrirCicloPedido,
  buscar: typeof fetch = fetch,
): Promise<CicloSbisDetalhe> => enviar(`${BASE_SBIS}/ciclos`, p, esquemaCicloSbisDetalhe, buscar);

export const avaliarItemSbis = (
  id: string,
  requisito: string,
  p: AvaliarItemPedido,
  buscar: typeof fetch = fetch,
): Promise<ItemCicloSbis> =>
  enviar(`${BASE_SBIS}/ciclos/${e(id)}/itens/${e(requisito)}`, p, esquemaItemCicloSbis, buscar);

export const corrigirItemSbis = (
  id: string,
  requisito: string,
  descricao: string,
  buscar: typeof fetch = fetch,
) => enviar(`${BASE_SBIS}/ciclos/${e(id)}/itens/${e(requisito)}/corrigir`, { descricao }, qualquer, buscar);

export const verificarItemSbis = (id: string, requisito: string, buscar: typeof fetch = fetch) =>
  enviar(`${BASE_SBIS}/ciclos/${e(id)}/itens/${e(requisito)}/verificar`, {}, qualquer, buscar);

export const concluirCicloSbis = (
  id: string,
  p: { parecerTexto: string; certificado?: string },
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<CicloSbisDetalhe> =>
  enviar(`${BASE_SBIS}/ciclos/${e(id)}/concluir`, { ...p, senha }, esquemaCicloSbisDetalhe, buscar);

export const cancelarCicloSbis = (id: string, motivo: string, buscar: typeof fetch = fetch) =>
  enviar(`${BASE_SBIS}/ciclos/${e(id)}/cancelar`, { motivo }, qualquer, buscar);

// ── backup verificado ─────────────────────────────────────────────────────────────────────────

export const buscarBackupVerificado = (buscar: typeof fetch = fetch): Promise<BackupVerificado> =>
  ler(BASE_BACKUP_VERIFICADO, esquemaBackupVerificado, buscar);

export const registrarRestauracao = (
  p: RegistrarRestauracaoPedido,
  buscar: typeof fetch = fetch,
): Promise<{ id: string }> =>
  enviar(`${BASE_BACKUP_VERIFICADO}/restauracoes`, p, z.object({ id: z.string() }), buscar);

// ── exportação da trilha para a auditoria ────────────────────────────────────────────────────

export const urlExportacaoSbis = (inicio: string, fim: string, formato: 'csv' | 'xml'): string =>
  `${BASE_EXPORTAR_SBIS}?${new URLSearchParams({ formato, inicio, fim }).toString()}`;
