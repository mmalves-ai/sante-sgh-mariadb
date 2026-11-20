// Cliente das telas do prontuário ao vivo (M15), validado pelos contratos. Só leitura, salvo o motivo de
// acesso (POST com o CSRF). Problem Details viram ErroApi (mensagem em português na tela); o 422 do motivo
// vira ErroMotivo, para a tela abrir o diálogo do motivo.
import {
  type AbaRegistro,
  type AbaRegistroConteudo,
  esquemaAbaRegistro,
  esquemaLiberacaoProntuario,
  esquemaListaAcessos,
  esquemaRelatorioExcecoes,
  esquemaListaRegistros,
  esquemaMotivoAberto,
  esquemaRegistroAberto,
  esquemaResultadoBuscaPaciente,
  esquemaResultadoPalavra,
  type FiltrosAcessos,
  type FiltrosRegistros,
  type LiberacaoProntuario,
  type ListaAcessos,
  type ListaRegistros,
  type MotivoAberto,
  type MotivoAcessoProntuario,
  type RegistroAberto,
  type RelatorioExcecoes,
  type ResultadoBuscaPaciente,
  type ResultadoPalavra,
  type TipoBuscaPaciente,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

const P = '/api/pep';

function consulta(x: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function buscarPacientesPep(
  termo: string,
  tipo: TipoBuscaPaciente = 'auto',
  buscar: typeof fetch = fetch,
): Promise<ResultadoBuscaPaciente> {
  return ler(`${P}/pacientes${consulta({ termo, tipo })}`, esquemaResultadoBuscaPaciente, buscar);
}

/** A chave de liberação do prontuário vale para esta sessão (estabelecimento e setor)? */
export function lerLiberacaoProntuario(buscar: typeof fetch = fetch): Promise<LiberacaoProntuario> {
  return ler(`${P}/liberacao`, esquemaLiberacaoProntuario, buscar);
}

/** Relatório agregado das exceções do prontuário (só contagens). */
export function lerExcecoes(buscar: typeof fetch = fetch): Promise<RelatorioExcecoes> {
  return ler(`${P}/excecoes`, esquemaRelatorioExcecoes, buscar);
}

export function lerMotivo(paciente: number, buscar: typeof fetch = fetch): Promise<MotivoAberto> {
  return ler(`${P}/prontuario/${paciente}/motivo`, esquemaMotivoAberto, buscar);
}

export async function informarMotivo(
  paciente: number,
  motivo: MotivoAcessoProntuario,
  buscar: typeof fetch = fetch,
): Promise<MotivoAberto> {
  const r = await buscar(`${P}/prontuario/${paciente}/motivo`, {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify({ motivo }),
  });
  return lerJson(r, esquemaMotivoAberto);
}

export function listarRegistros(
  paciente: number,
  f: Partial<FiltrosRegistros>,
  buscar: typeof fetch = fetch,
): Promise<ListaRegistros> {
  return ler(`${P}/prontuario/${paciente}${consulta({ ...f })}`, esquemaListaRegistros, buscar);
}

export function abrirRegistro(
  paciente: number,
  registro: number,
  buscar: typeof fetch = fetch,
): Promise<RegistroAberto> {
  return ler(`${P}/prontuario/${paciente}/registros/${registro}`, esquemaRegistroAberto, buscar);
}

export function lerAba(
  paciente: number,
  registro: number,
  aba: AbaRegistro,
  buscar: typeof fetch = fetch,
): Promise<AbaRegistroConteudo> {
  return ler(`${P}/prontuario/${paciente}/registros/${registro}/${aba}`, esquemaAbaRegistro, buscar);
}

export function buscarPalavra(
  paciente: number,
  q: { termo: string; de?: string; ate?: string },
  buscar: typeof fetch = fetch,
): Promise<ResultadoPalavra> {
  return ler(`${P}/prontuario/${paciente}/busca${consulta(q)}`, esquemaResultadoPalavra, buscar);
}

const A = '/api/administracao/auditoria/acessos-prontuario';

export function listarAcessos(
  f: Partial<FiltrosAcessos>,
  buscar: typeof fetch = fetch,
): Promise<ListaAcessos> {
  return ler(`${A}${consulta({ ...f })}`, esquemaListaAcessos, buscar);
}

export function urlExportarAcessos(f: Partial<FiltrosAcessos>): string {
  return `${A}/exportar${consulta({ ...f })}`;
}
