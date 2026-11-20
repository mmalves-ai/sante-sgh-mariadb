// W0-03, mercado M4: cliente da tela das feridas e LPP. As leituras vêm tipadas pelos contratos; as gravações levam o
// CSRF e a Idempotency-Key. Problem Details viram ErroApi (o código da recusa em `problema.codigo`). A foto é o anexo
// do prontuário (o PDF de uma página com a foto): primeiro vai ao prontuário (rota do PEP), depois a lesão guarda a
// referência.
import type {
  CurativoEntrada,
  DadosLesao,
  DesfechoLesao,
  DocumentoGravado,
  IncidenciaLpp,
  LesaoLida,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { anexarDocumento } from '../pep/api-documentos.js';
import { novaChave } from './api-enfermagem.js';

const L = '/api/enfermagem/lesoes';
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
      'idempotency-key': novaChave('lesao'),
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

export interface PacienteLesao {
  readonly paciente: number;
  readonly atendimento: number;
  readonly leito: string;
  readonly nome: string;
}

export interface LesoesDaUnidade {
  readonly unidade: string;
  readonly agora: string;
  readonly pacientes: readonly PacienteLesao[];
  readonly lesoes: readonly LesaoLida[];
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly agir: boolean;
    readonly login: string;
  };
}

export const lerLesoesDaUnidade = (unidade: string) =>
  ler<LesoesDaUnidade>(`${L}/unidade?unidade=${encodeURIComponent(unidade)}`);
export const lerIncidenciaLpp = (de: string, ate: string) =>
  ler<IncidenciaLpp>(`${L}/indicadores?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
export const registrarLesao = (e: {
  paciente: number;
  atendimento: number;
  dados: DadosLesao;
  finalizar: boolean;
}) => enviar<Feito & { id: number; versao: number }>(L, e);
export const versaoLesao = (id: number, e: { dados: DadosLesao; finalizar: boolean; motivo?: string }) =>
  enviar<Feito>(`${L}/${id}/versoes`, e);
export const registrarCurativo = (id: number, e: CurativoEntrada) =>
  enviar<Feito & { id: number }>(`${L}/${id}/curativos`, e);
export const corrigirCurativo = (id: number, dados: CurativoEntrada, motivo: string) =>
  enviar<Feito>(`${L}/curativos/${id}/corrigir`, { dados, motivo });
export const encerrarLesao = (id: number, e: { desfecho: DesfechoLesao; em: string; observacao?: string }) =>
  enviar<Feito>(`${L}/${id}/encerrar`, e);
export const inativarLesao = (
  origem: 'lesao' | 'curativo' | 'foto',
  id: number,
  motivo: string,
  senha: string,
) =>
  enviar<Feito>(
    origem === 'lesao'
      ? `${L}/${id}/inativar`
      : `${L}/${origem === 'curativo' ? 'curativos' : 'fotos'}/${id}/inativar`,
    { motivo, senha },
  );

/**
 * A foto: vai ao prontuário como anexo (o PDF de uma página com a foto, montado pela tela; o prontuário guarda os
 * anexos em PDF) e a lesão guarda a referência (o `origem` devolvido pelo prontuário). O arquivo nunca fica na lesão.
 */
export async function anexarFotoLesao(
  l: { id: number; paciente: number; atendimento: number },
  arquivo: { nome: string; pdf: string },
  e: { tiradaEm: string; curativo?: number },
): Promise<Feito & { anexo: number }> {
  const g: DocumentoGravado = await anexarDocumento(l.paciente, {
    atendimento: l.atendimento,
    nome: arquivo.nome,
    extensao: 'pdf',
    conteudo: arquivo.pdf,
  });
  const r = await enviar<Feito>(`${L}/${l.id}/fotos`, {
    anexo: g.origem,
    tiradaEm: e.tiradaEm,
    ...(e.curativo ? { curativo: e.curativo } : {}),
  });
  return { ...r, anexo: g.origem };
}
