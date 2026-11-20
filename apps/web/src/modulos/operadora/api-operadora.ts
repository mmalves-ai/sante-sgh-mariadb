// Cliente da operadora própria (M56): na F0, a situação das chaves do módulo e das fatias e os catálogos da ANS (só
// leitura); na F1 (M56.2), beneficiários, planos e contratos, com as gravações (CSRF). Validados pelos contratos;
// Problem Details viram ErroApi.
import {
  type BeneficiarioFicha,
  type BeneficiariosOperadora,
  type ClassificacoesAns,
  type ContratoOperadora,
  type ContratosOperadora,
  type Elegibilidade,
  esquemaBeneficiarioFicha,
  esquemaBeneficiarios,
  esquemaClassificacoesAns,
  esquemaContratoOperadora,
  esquemaContratos,
  esquemaElegibilidade,
  esquemaGruposSip,
  esquemaProcedimentosSip,
  esquemaResultadoOperadora,
  esquemaSituacaoOperadora,
  esquemaTelaBeneficiarios,
  type GruposSip,
  type ProcedimentosSip,
  type ResultadoOperadora,
  type SituacaoOperadora,
  type TelaBeneficiarios,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { ler, lerJson, qs } from '../exames/api-exames.js';

const O = '/api/operadora';

export const lerSituacaoOperadora = (): Promise<SituacaoOperadora> =>
  ler(`${O}/situacao`, esquemaSituacaoOperadora);

export const lerGruposSip = (): Promise<GruposSip> => ler(`${O}/ans/sip/grupos`, esquemaGruposSip);

export function lerProcedimentosSip(f: {
  grupo?: number | null;
  vigentesEm?: string | null;
  procedimento?: string | null;
  apos?: string | null;
}): Promise<ProcedimentosSip> {
  const q = new URLSearchParams();
  if (f.grupo !== null && f.grupo !== undefined) q.set('grupo', String(f.grupo));
  if (f.vigentesEm) q.set('vigentesEm', f.vigentesEm);
  if (f.procedimento) q.set('procedimento', f.procedimento);
  if (f.apos) q.set('apos', f.apos);
  const s = q.toString();
  return ler(`${O}/ans/sip/procedimentos${s ? `?${s}` : ''}`, esquemaProcedimentosSip);
}

export function lerClassificacoesAns(
  apos: number | null,
  busca: string | null = null,
): Promise<ClassificacoesAns> {
  const q = new URLSearchParams();
  if (apos !== null) q.set('apos', String(apos));
  if (busca) q.set('busca', busca);
  const s = q.toString();
  return ler(`${O}/ans/classificacoes${s ? `?${s}` : ''}`, esquemaClassificacoesAns);
}

// ── Fatia F1 (M56.2): beneficiários, planos e contratos ──────────────────────────────────────────────────────────

export const lerTelaBeneficiarios = (): Promise<TelaBeneficiarios> =>
  ler(`${O}/beneficiarios/tela`, esquemaTelaBeneficiarios);

export const lerContratosOperadora = (f: {
  operadora: number | null;
  busca?: string | null;
  apos?: number | null;
}): Promise<ContratosOperadora> =>
  ler(`${O}/contratos${qs({ operadora: f.operadora, busca: f.busca, apos: f.apos })}`, esquemaContratos);

export const lerContratoOperadora = (id: number): Promise<ContratoOperadora> =>
  ler(`${O}/contratos/${id}`, esquemaContratoOperadora);

export const lerBeneficiariosOperadora = (f: {
  operadora: number | null;
  contrato?: number | null;
  busca?: string | null;
  situacao?: string | null;
  apos?: number | null;
}): Promise<BeneficiariosOperadora> =>
  ler(
    `${O}/beneficiarios${qs({ operadora: f.operadora, contrato: f.contrato, busca: f.busca, situacao: f.situacao, apos: f.apos })}`,
    esquemaBeneficiarios,
  );

export const lerFichaBeneficiario = (id: number): Promise<BeneficiarioFicha> =>
  ler(`${O}/beneficiarios/${id}`, esquemaBeneficiarioFicha);

export const lerElegibilidade = (carteirinha: string, data: string | null): Promise<Elegibilidade> =>
  ler(`${O}/elegibilidade${qs({ carteirinha, data })}`, esquemaElegibilidade);

async function mandar(metodo: 'POST' | 'PUT', url: string, corpo: unknown): Promise<ResultadoOperadora> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquemaResultadoOperadora);
}

/** Inclusão (id null) ou alteração do recurso da F1. */
const gravarRecurso = (recurso: string) => (id: number | null, corpo: unknown) =>
  id === null ? mandar('POST', `${O}/${recurso}`, corpo) : mandar('PUT', `${O}/${recurso}/${id}`, corpo);

export const gravarOperadoraEmpresa = gravarRecurso('empresas');
export const gravarProdutoOperadora = gravarRecurso('produtos');
export const gravarContratoOperadora = gravarRecurso('contratos');
export const gravarBeneficiarioOperadora = gravarRecurso('beneficiarios');
export const baixarBeneficiario = (id: number, corpo: { motivo: number; data: string; versao: number }) =>
  mandar('POST', `${O}/beneficiarios/${id}/baixa`, corpo);
export const reativarBeneficiario = (id: number, versao: number) =>
  mandar('POST', `${O}/beneficiarios/${id}/reativacao`, { versao });
export const emitirViaCarteirinha = (id: number, corpo: { motivo: number | null; versao: number }) =>
  mandar('POST', `${O}/beneficiarios/${id}/carteirinha`, corpo);
