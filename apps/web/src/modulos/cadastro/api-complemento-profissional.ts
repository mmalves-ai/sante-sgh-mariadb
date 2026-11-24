// Cliente das rotas do complemento do profissional (F3.1, 02-CAD linha 16): RQE e assinaturas (corpo clínico), dados
// fiscais e contas (cargo do repasse). Respostas do profissional-complemento.controller.ts; a gravação leva CSRF e
// Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const objeto = z.record(z.string(), z.unknown());

export interface Rqe {
  id: number;
  versao: number;
  numero: string;
  uf: string;
  especialidade: number;
  especialidadeDescricao: string;
  conselho: string | null;
  dataRegistro: string | null;
  ativo: boolean;
}
export interface Assinatura {
  id: number;
  versao: number;
  tipo: 'imagem' | 'certificado_digital';
  arquivo: number | null;
  titular: string | null;
  numeroSerie: string | null;
  emissor: string | null;
  usoTiss: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
  vigente: boolean;
}
export interface Complemento {
  rqes: Rqe[];
  assinaturas: Assinatura[];
}
export interface DadoFiscal {
  id: number;
  versao: number;
  estabelecimento: number | null;
  estabelecimentoNome: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  tipoRecebedor: string;
  pessoaJuridica: number | null;
  empresa: string | null;
  regime: string | null;
  inscricaoMunicipal: string | null;
  inscricaoInss: string | null;
  categoriaSefip: number | null;
  pisPasep: string | null;
  aliquotaIss: number | null;
  percentualInss: number | null;
  retemIss: boolean;
  retemInss: boolean;
  retemIrrf: boolean;
  retemPisCofinsCsll: boolean;
  dependentesIrrf: number;
  incidencia: string | null;
  vigente: boolean;
}
export interface Conta {
  id: number;
  versao: number;
  banco: number | null;
  bancoDescricao: string | null;
  agencia: string | null;
  numeroConta: string | null;
  tipoChavePix: string | null;
  chavePix: string | null;
  favorecidoNome: string;
  favorecidoTipo: string;
  favorecidoDocumento: string;
  principal: boolean;
  ativo: boolean;
}
export interface Financeiro {
  fiscais: DadoFiscal[];
  contas: Conta[];
}
export interface OpcoesComplemento {
  bancos: { id: number; texto: string }[];
  tiposConta: { id: number; texto: string }[];
  especialidades: { id: number; texto: string }[];
  estabelecimentos: { id: number; texto: string }[];
  empresas: { id: number; texto: string; cnpj: string | null }[];
}
export type TipoComplemento = 'dados-fiscais' | 'contas' | 'rqes' | 'assinaturas';

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: JSON_ACEITO }
      : {
          method: metodo,
          headers: {
            ...JSON_ACEITO,
            'content-type': 'application/json',
            'x-csrf': tokenCsrf(),
            'idempotency-key': chave(),
          },
          body: JSON.stringify(corpo ?? {}),
        },
  );
  if (!r.ok) throw await erroDaResposta(r);
  return objeto.parse(await r.json()) as T;
}

const C = '/api/cadastros';
export const lerComplemento = (p: number) => pedir<Complemento>(`${C}/profissionais/${p}/complemento`);
export const lerFinanceiro = (p: number) => pedir<Financeiro>(`${C}/profissionais/${p}/financeiro`);
export const lerOpcoesComplemento = (empresa = '') =>
  pedir<OpcoesComplemento>(
    `${C}/profissionais-complemento/opcoes${empresa ? `?empresa=${encodeURIComponent(empresa)}` : ''}`,
  );
export const incluirRqe = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/profissionais/${p}/rqes`, 'POST', c);
export const incluirAssinatura = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/profissionais/${p}/assinaturas`, 'POST', c);
/** A imagem da assinatura (data URL ou base64), guardada pela porta de arquivos com a finalidade da assinatura. */
export const enviarImagemAssinatura = (
  p: number,
  c: { conteudo: string; nomeOriginal: string; usoTiss: boolean; vigenciaInicio: string },
) => pedir<{ id: number }>(`${C}/profissionais/${p}/assinaturas/imagem`, 'POST', c);
export const gravarDadoFiscal = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/profissionais/${p}/dados-fiscais`, 'POST', c);
export const incluirConta = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/profissionais/${p}/contas`, 'POST', c);
export const encerrarComplemento = (
  p: number,
  tipo: TipoComplemento,
  id: number,
  versao: number,
  fim: string | null = null,
) =>
  pedir<{ id: number }>(
    // O dado fiscal e a conta têm a rota do cargo do repasse; RQE e assinatura, a da edição do profissional.
    `${C}/profissionais/${p}/${tipo === 'dados-fiscais' || tipo === 'contas' ? 'financeiro/' : ''}${tipo}/${id}/encerrar`,
    'POST',
    { versao, fim },
  );
