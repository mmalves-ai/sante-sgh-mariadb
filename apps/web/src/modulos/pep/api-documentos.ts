// Cliente das telas do prontuário de uso diário (M23): painel, cabeçalho, linha do tempo, documentos, alergias,
// problemas, exames, resultados, receitas, atestados, TCLE, alta, anexos, tempos, pareceres e assinaturas. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi com o
// código da recusa em `problema.codigo`. As entradas são conferidas pelos esquemas dos contratos antes de sair.
import type {
  AlergiasPaciente,
  HistoricoAlergia,
  AltaPaciente,
  AnexarDocumento,
  AnexosPaciente,
  AssinarLote,
  CabecalhoPep,
  CancelamentoObito,
  CienciaCritico,
  DeclaracaoObito,
  DocumentoAberto,
  DocumentoGravado,
  DocumentosPaciente,
  EmitirAtestado,
  EmitirReceita,
  EmitirTcle,
  ExameExterno,
  FilaPareceres,
  GravarProblema,
  LinhaTempo,
  MudarSituacaoProblema,
  PainelPacientes,
  PedidosExame,
  PendenciasAssinatura,
  PreviaAssinatura,
  ProblemaPep,
  RegistrarAlergia,
  RelatorioTransferencia,
  ResultadoAssinatura,
  ResultadoSolicitacao,
  ResultadosPaciente,
  SalvarSumario,
  SolicitarExames,
  TclesPaciente,
  TempoEvento,
  TipoDocumentoAberto,
  AcaoLiberada,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

export { novaChave };

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/pep';

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
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
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviarArquivo(url: string, corpo: unknown, buscar: typeof fetch = fetch): Promise<Blob> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      accept: 'application/pdf, text/plain',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.blob();
}

function consulta(x: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

const pac = (p: number) => `${P}/paciente/${p}`;

// ── Painel, cabeçalho, linha do tempo e documentos ─────────────────────────────────────────────────

export function lerPainel(
  f: {
    unidade?: number | null;
    busca?: string;
    vinculo?: 'todos' | 'meus' | 'equipe';
    favoritos?: readonly number[] | null;
  },
  buscar: typeof fetch = fetch,
): Promise<PainelPacientes> {
  return ler(
    `${P}/painel${consulta({
      unidade: f.unidade ?? undefined,
      busca: f.busca,
      vinculo: f.vinculo && f.vinculo !== 'todos' ? f.vinculo : undefined,
      favoritos: f.favoritos ? 'sim' : undefined,
      ids: f.favoritos?.join(','),
    })}`,
    buscar,
  );
}

export const lerCabecalho = (p: number, b: typeof fetch = fetch) =>
  ler<CabecalhoPep>(`${pac(p)}/cabecalho`, b);

export function lerLinhaTempo(
  p: number,
  f: { de?: string; ate?: string; tipos?: string; pagina?: number },
  b: typeof fetch = fetch,
): Promise<LinhaTempo> {
  return ler(`${pac(p)}/linha-do-tempo${consulta({ ...f })}`, b);
}

export const abrirDocumento = (p: number, tipo: TipoDocumentoAberto, id: number, b: typeof fetch = fetch) =>
  ler<DocumentoAberto>(`${pac(p)}/documentos/${tipo}/${id}`, b);

/** 01-ADM L82: a 1ª via leva a justificativa; a nova via, o motivo. */
export const imprimirDocumento = (
  p: number,
  tipo: TipoDocumentoAberto,
  id: number,
  texto: { justificativa: string } | { motivo: string },
) => enviarArquivo(`${pac(p)}/documentos/${tipo}/${id}/imprimir`, texto);

export const exportarProntuario = (p: number, justificativa: string, senha?: string) =>
  enviarArquivo(`${pac(p)}/exportar`, { justificativa, ...(senha ? { senha } : {}) });

// ── Alergias e problemas ───────────────────────────────────────────────────────────────────────────

export const lerAlergias = (p: number, b: typeof fetch = fetch) =>
  ler<AlergiasPaciente>(`${pac(p)}/alergias`, b);
export const registrarAlergia = (p: number, e: RegistrarAlergia) =>
  enviar<{ alergia: number; documento: number }>(`${pac(p)}/alergias`, e, novaChave('alergia'));
export const lerHistoricoAlergia = (p: number, id: number, b: typeof fetch = fetch) =>
  ler<HistoricoAlergia>(`${pac(p)}/alergias/${id}/historico`, b);
export const inativarAlergia = (p: number, id: number, motivo: string, versao: string) =>
  enviar<{ ok: true }>(`${pac(p)}/alergias/${id}/inativar`, { motivo, versao }, novaChave('alergia'));

export const lerProblemas = (p: number, b: typeof fetch = fetch) =>
  ler<{ problemas: ProblemaPep[]; criar: AcaoLiberada }>(`${pac(p)}/problemas`, b);
export const incluirProblema = (p: number, e: GravarProblema) =>
  enviar<{ problema: number }>(`${pac(p)}/problemas`, e, null);
export const mudarProblema = (p: number, id: number, e: MudarSituacaoProblema) =>
  enviar<{ problema: number }>(`${pac(p)}/problemas/${id}/situacao`, e, null);

// ── Exames e resultados ────────────────────────────────────────────────────────────────────────────

export const lerExames = (p: number, termo: string | null, b: typeof fetch = fetch) =>
  ler<PedidosExame>(`${pac(p)}/exames${consulta({ termo })}`, b);
export const solicitarExames = (p: number, e: SolicitarExames, chave: string) =>
  enviar<ResultadoSolicitacao>(`${pac(p)}/exames`, e, chave);
export const lerResultados = (p: number, b: typeof fetch = fetch) =>
  ler<ResultadosPaciente>(`${pac(p)}/resultados`, b);
export const darCiencia = (p: number, exame: number, e: CienciaCritico) =>
  enviar<{ ciencia: number }>(`${pac(p)}/resultados/${exame}/ciencia`, e, null);
export const lancarExameExterno = (p: number, e: ExameExterno) =>
  enviar<DocumentoGravado>(`${pac(p)}/resultados/externo`, e, novaChave('exame-externo'));

// ── Receitas, atestados e TCLE ─────────────────────────────────────────────────────────────────────

export const lerReceitas = (p: number, b: typeof fetch = fetch) =>
  ler<DocumentosPaciente>(`${pac(p)}/receitas`, b);
export const lerAtestados = (p: number, b: typeof fetch = fetch) =>
  ler<DocumentosPaciente>(`${pac(p)}/atestados`, b);
export const emitirReceita = (p: number, e: EmitirReceita) =>
  enviar<DocumentoGravado>(`${pac(p)}/receitas`, e, novaChave('receita'));
export const emitirAtestado = (p: number, e: EmitirAtestado) =>
  enviar<DocumentoGravado>(`${pac(p)}/atestados`, e, novaChave('atestado'));
export const suspenderDocumento = (
  p: number,
  familia: 'receitas' | 'atestados',
  id: number,
  justificativa: string,
  senha?: string,
) =>
  enviar<{ ok: true }>(
    `${pac(p)}/${familia}/${id}/suspender`,
    { justificativa, ...(senha ? { senha } : {}) },
    novaChave('suspensao'),
  );

export const lerTcle = (p: number, b: typeof fetch = fetch) => ler<TclesPaciente>(`${pac(p)}/tcle`, b);
export const emitirTcle = (p: number, e: EmitirTcle) =>
  enviar<{ id: number; documento: number }>(`${pac(p)}/tcle`, e, null);
export const mudarTcle = (p: number, id: number, situacao: 'assinado' | 'revogado', motivo?: string) =>
  enviar<{ tcle: number }>(
    `${pac(p)}/tcle/${id}/situacao`,
    { situacao, versao: id, ...(motivo ? { motivo } : {}) },
    null,
  );

// ── Alta, anexos e tempos ──────────────────────────────────────────────────────────────────────────

export const lerAlta = (p: number, atendimento: number | null, b: typeof fetch = fetch) =>
  ler<AltaPaciente>(`${pac(p)}/alta${consulta({ atendimento })}`, b);
export const salvarSumario = (p: number, e: SalvarSumario) =>
  enviar<{ versao: number }>(`${pac(p)}/alta/rascunho`, e, null);
export const finalizarSumario = (p: number, e: SalvarSumario) =>
  enviar<DocumentoGravado>(`${pac(p)}/alta/finalizar`, e, novaChave('sumario'));
export const registrarTransferencia = (p: number, e: RelatorioTransferencia) =>
  enviar<{ id: number; documento: number }>(`${pac(p)}/alta/transferencia`, e, null);
export const registrarObito = (p: number, e: DeclaracaoObito) =>
  enviar<{ id: number; documento: number }>(`${pac(p)}/alta/obito`, e, null);
export const cancelarObito = (p: number, e: CancelamentoObito) =>
  enviar<{ id: number; documento: number | null }>(`${pac(p)}/alta/obito/cancelar`, e, null);

export const lerAnexos = (p: number, b: typeof fetch = fetch) => ler<AnexosPaciente>(`${pac(p)}/anexos`, b);
export const anexarDocumento = (p: number, e: AnexarDocumento) =>
  enviar<DocumentoGravado>(`${pac(p)}/anexos`, e, novaChave('anexo'));
export const urlArquivoAnexo = (p: number, id: number) => `${pac(p)}/anexos/${id}/arquivo`;
export const lerTempos = (p: number, b: typeof fetch = fetch) => ler<TempoEvento[]>(`${pac(p)}/tempos`, b);

// ── Pareceres e assinaturas ────────────────────────────────────────────────────────────────────────

export const lerFila = (
  f: { especialidade?: number; categoria?: string; situacao?: string },
  b: typeof fetch = fetch,
) => ler<FilaPareceres>(`${P}/interconsultas${consulta({ ...f })}`, b);
export const aceitarParecer = (id: number) =>
  enviar<{ ok: true }>(`${P}/interconsultas/${id}/aceitar`, {}, null);
export const cancelarParecer = (id: number, motivo: string) =>
  enviar<{ ok: true }>(`${P}/interconsultas/${id}/cancelar`, { motivo }, null);

export const lerPendencias = (b: typeof fetch = fetch) =>
  ler<PendenciasAssinatura & { assinar: AcaoLiberada; categoria: string | null }>(`${P}/assinaturas`, b);
export const lerPrevia = (id: number, b: typeof fetch = fetch) =>
  ler<PreviaAssinatura>(`${P}/assinaturas/${id}/previa`, b);
export const assinarLote = (e: AssinarLote) => enviar<ResultadoAssinatura>(`${P}/assinaturas`, e, null);
/** Regra 3: o preceptor coassina (ou recusa com o motivo) o registro do residente. */
export const coassinar = (id: number, e: { decisao: 'coassinado' | 'recusado'; motivo?: string }) =>
  enviar<{ ok: true }>(`${P}/supervisao/${id}/coassinar`, e, null);

/** Validação pública do documento pelo QR (sem conteúdo clínico). */
export async function validarDocumento(qr: string, buscar: typeof fetch = fetch): Promise<unknown> {
  const r = await buscar(`/api/publico/documentos/${encodeURIComponent(qr)}/validacao`, {
    headers: JSON_ACEITO,
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.json();
}

/** Abre o PDF (ou o texto exportado) numa aba nova do navegador. */
export function abrirArquivo(b: Blob): void {
  const url = URL.createObjectURL(b);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
