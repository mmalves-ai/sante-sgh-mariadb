// Cliente das telas de registro clínico (M22), validado pelos contratos. As gravações (rascunho, finalização,
// descarte e suspensão) vão com o CSRF e a Idempotency-Key (uma por intenção de gravar: repetir o mesmo pedido
// não grava duas vezes). Problem Details viram ErroApi; o código da recusa (ex.: justificativa-necessaria) fica
// em `problema.codigo` para a tela mostrar o texto certo.
import {
  esquemaFormularioRegistro,
  esquemaHistoricoPergunta,
  esquemaLiberacaoProntuario,
  esquemaModeloAdmin,
  esquemaModeloAdminDetalhe,
  esquemaModeloImpressao,
  esquemaModeloRegistro,
  esquemaMotivoAberto,
  esquemaRascunhoGravado,
  esquemaRascunhoResumo,
  esquemaRegistroGravado,
  esquemaRegistroVisualizado,
  esquemaResultadoBuscaPaciente,
  type FormularioRegistro,
  type HistoricoPergunta,
  type LiberacaoProntuario,
  type ModeloAdmin,
  type ModeloAdminDetalhe,
  type ModeloImpressao,
  type ModeloRegistro,
  type MotivoAberto,
  type MotivoAcessoProntuario,
  type RascunhoGravado,
  type RascunhoResumo,
  type RegistrarEvolucaoEntrada,
  type RegistroGravado,
  type RegistroVisualizado,
  type ResultadoBuscaPaciente,
  type SalvarRascunhoEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/pep';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  chave: string | null,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquema);
}

export function lerLiberacaoRegistro(buscar: typeof fetch = fetch): Promise<LiberacaoProntuario> {
  return ler(`${P}/registro/liberacao`, esquemaLiberacaoProntuario, buscar);
}

export function buscarPacientesRegistro(
  termo: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoBuscaPaciente> {
  return ler(
    `${P}/registro/pacientes?${new URLSearchParams({ termo, tipo: 'auto' })}`,
    esquemaResultadoBuscaPaciente,
    buscar,
  );
}

export function listarModelosRegistro(
  paciente: number,
  buscar: typeof fetch = fetch,
): Promise<ModeloRegistro[]> {
  return ler(`${P}/registro/${paciente}/modelos`, z.array(esquemaModeloRegistro), buscar);
}

export function abrirFormulario(
  paciente: number,
  modelo: number,
  rascunho: number | null,
  buscar: typeof fetch = fetch,
): Promise<FormularioRegistro> {
  const q = rascunho ? `?rascunho=${rascunho}` : '';
  return ler(`${P}/registro/${paciente}/formulario/${modelo}${q}`, esquemaFormularioRegistro, buscar);
}

export function lerHistorico(
  paciente: number,
  modelo: number,
  vinculo: number,
  buscar: typeof fetch = fetch,
): Promise<HistoricoPergunta> {
  return ler(`${P}/registro/${paciente}/historico/${modelo}/${vinculo}`, esquemaHistoricoPergunta, buscar);
}

export function salvarRascunho(
  e: Omit<SalvarRascunhoEntrada, 'paciente'> & { paciente: number },
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<RascunhoGravado> {
  const { paciente, ...corpo } = e;
  return enviar(`${P}/registro/${paciente}/rascunho`, corpo, esquemaRascunhoGravado, chave, buscar);
}

export function finalizarRegistro(
  e: Omit<RegistrarEvolucaoEntrada, 'paciente'> & { paciente: number },
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<RegistroGravado> {
  const { paciente, ...corpo } = e;
  return enviar(`${P}/registro/${paciente}/finalizar`, corpo, esquemaRegistroGravado, chave, buscar);
}

export function listarRascunhos(buscar: typeof fetch = fetch): Promise<RascunhoResumo[]> {
  return ler(`${P}/rascunhos`, z.array(esquemaRascunhoResumo), buscar);
}

export function descartarRascunho(
  rascunho: number,
  versao: string,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return enviar(
    `${P}/rascunhos/${rascunho}/descartar`,
    { versao },
    z.object({ ok: z.literal(true) }),
    chave,
    buscar,
  );
}

export function informarMotivoRegistro(
  paciente: number,
  motivo: MotivoAcessoProntuario,
  buscar: typeof fetch = fetch,
): Promise<MotivoAberto> {
  return enviar(`${P}/registro/${paciente}/motivo`, { motivo }, esquemaMotivoAberto, null, buscar);
}

export function visualizarRegistro(
  paciente: number,
  registro: number,
  buscar: typeof fetch = fetch,
): Promise<RegistroVisualizado> {
  return ler(`${P}/registro/${paciente}/registros/${registro}`, esquemaRegistroVisualizado, buscar);
}

export function suspenderRegistro(
  paciente: number,
  registro: number,
  justificativa: string,
  senha: string,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return enviar(
    `${P}/registro/${paciente}/registros/${registro}/suspender`,
    { justificativa, senha },
    z.object({ ok: z.literal(true) }),
    chave,
    buscar,
  );
}

export function listarModelosAdmin(buscar: typeof fetch = fetch): Promise<ModeloAdmin[]> {
  return ler(`${P}/admin/modelos`, z.array(esquemaModeloAdmin), buscar);
}

export function lerModeloAdmin(id: number, buscar: typeof fetch = fetch): Promise<ModeloAdminDetalhe> {
  return ler(`${P}/admin/modelos/${id}`, esquemaModeloAdminDetalhe, buscar);
}

export function listarImpressao(
  buscar: typeof fetch = fetch,
): Promise<{ fichas: ModeloImpressao[]; relatorios: ModeloImpressao[] }> {
  return ler(
    `${P}/admin/impressao`,
    z.object({ fichas: z.array(esquemaModeloImpressao), relatorios: z.array(esquemaModeloImpressao) }),
    buscar,
  );
}

/** Código da recusa do servidor (Problem Details `codigo`), para o texto certo na tela. */
export function codigoDoErro(e: unknown): string | null {
  const p = (e as { problema?: { codigo?: unknown } } | null)?.problema;
  return typeof p?.codigo === 'string' ? p.codigo : null;
}
