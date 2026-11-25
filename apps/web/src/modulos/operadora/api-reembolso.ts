// Cliente do reembolso ao beneficiário (08-SGO L106, C2-047): fila com prazo legal, visão por beneficiário, pedido com
// comprovantes, análise com glosa por item, pagamento, tabela de referência por município e regra do plano. Respostas
// validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/reembolsos';
const n = z.number();
const tn = z.string().nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();
const opcao = z.object({ id: n, rotulo: z.string() });
export type Opcao = z.infer<typeof opcao>;

export const SITUACOES = [
  'solicitado',
  'em_analise',
  'pendente_documento',
  'aprovado',
  'aprovado_parcial',
  'negado',
  'pago',
  'cancelado',
] as const;
export type Situacao = (typeof SITUACOES)[number];

const esquemaApoio = z.object({
  operadoras: z.array(z.object({ id: n, nome: z.string() })),
  modalidades: z.array(z.object({ id: n, codigo: z.string(), descricao: z.string() })),
  motivos: z.array(z.object({ id: n, codigo: z.string(), descricao: z.string() })),
});
export type Apoio = z.infer<typeof esquemaApoio>;
const esquemaResumo = z.object({
  id: n,
  versao: n,
  numero: z.string(),
  beneficiario: z.object({ id: n, nome: z.string(), matricula: z.string() }),
  prestadorNome: z.string(),
  dataAtendimento: z.string(),
  solicitadoEm: z.string(),
  prazoPagamento: z.string(),
  diasParaOPrazo: n.nullable(),
  atrasado: z.boolean(),
  valorApresentado: n,
  valorGlosado: n,
  valorReembolsado: n,
  situacao: z.enum(SITUACOES),
});
export type Resumo = z.infer<typeof esquemaResumo>;
const esquemaDetalhe = esquemaResumo.extend({
  canal: z.string(),
  prestadorDocumento: z.string(),
  numeroDocumentoFiscal: tn,
  tabelaReferencia: z.object({ id: n, nome: z.string() }).nullable(),
  observacao: tn,
  analisadoEm: tn,
  pagoEm: tn,
  motivoCancelamento: tn,
  itens: z.array(
    z.object({
      id: n,
      versao: n,
      procedimento: z.object({ id: n, codigo: z.string(), descricao: z.string() }),
      quantidade: n,
      valorApresentado: n,
      valorLimite: n.nullable(),
      valorGlosado: n,
      valorCoparticipacao: n,
      valorReembolsado: n,
      situacao: z.string(),
      glosas: z.array(z.object({ motivo: z.string(), valor: n, justificativa: tn })),
    }),
  ),
  anexos: z.array(z.object({ id: n, nome: z.string(), tipoMime: z.string(), bytes: n })),
});
export type Detalhe = z.infer<typeof esquemaDetalhe>;
const esquemaTabela = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  nome: z.string(),
  produto: n.nullable(),
  municipio: z.object({ id: n, nome: z.string() }).nullable(),
  padrao: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  ativo: z.boolean(),
  itens: n,
});
export type Tabela = z.infer<typeof esquemaTabela>;
const esquemaRegra = z.object({
  id: n,
  versao: n,
  plano: z.object({ id: n, nome: z.string() }),
  tabela: n.nullable(),
  multiplicador: n,
  percentual: n.nullable(),
  limitePorEvento: n.nullable(),
  limiteAnual: n.nullable(),
  prazoPagamentoDias: n,
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  ativo: z.boolean(),
});
export type Regra = z.infer<typeof esquemaRegra>;

export interface Anexo {
  nome: string;
  tipoMime: string;
  base64: string;
}

export const lerApoio = () => ler(`${A}/apoio`, esquemaApoio);
export const buscar = (alvo: 'beneficiarios' | 'procedimentos' | 'municipios', termo: string) =>
  ler(`${A}/busca/${alvo}?termo=${encodeURIComponent(termo)}`, z.array(opcao));
export const lerFila = (situacao: Situacao | null) =>
  ler(situacao ? `${A}?situacao=${situacao}` : A, z.array(esquemaResumo));
export const lerDoBeneficiario = (id: number) =>
  ler(`${A}/beneficiario/${id}`, z.object({ pedidos: z.array(esquemaResumo), reembolsadoNoAno: n }));
export const lerPedido = (id: number) => ler(`${A}/${id}`, esquemaDetalhe);
export const incluirPedido = (corpo: Record<string, unknown>) =>
  enviar(A, corpo, gravado, novaChave('reemb-pedido'));
export const anexar = (id: number, versao: number, anexo: Anexo) =>
  enviar(`${A}/${id}/comprovantes`, { versao, anexo }, gravado, novaChave('reemb-anexo'));
export const analisar = (id: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${id}/analise`, corpo, gravado, novaChave('reemb-analise'));
export const pagar = (id: number, versao: number, pagoEm: string) =>
  enviar(`${A}/${id}/pagamento`, { versao, pagoEm }, gravado, novaChave('reemb-pagamento'));
export const cancelar = (id: number, versao: number, motivo: string) =>
  enviar(`${A}/${id}/cancelamento`, { versao, motivo }, gravado, novaChave('reemb-cancelamento'));
export const lerTabelas = (op: number) =>
  ler(`/api/operadora/reembolsos-tabelas/${op}`, z.array(esquemaTabela));
export const incluirTabela = (op: number, corpo: Record<string, unknown>) =>
  enviar(`/api/operadora/reembolsos-tabelas/${op}`, corpo, gravado, novaChave('reemb-tabela'));
export const lerRegras = (op: number) => ler(`/api/operadora/reembolsos-regras/${op}`, z.array(esquemaRegra));
export const incluirRegra = (op: number, corpo: Record<string, unknown>) =>
  enviar(`/api/operadora/reembolsos-regras/${op}`, corpo, gravado, novaChave('reemb-regra'));

/** Arquivo escolhido → anexo em base64 (só PDF, PNG ou JPEG até 5 MB; o servidor confere de novo). */
export async function lerAnexo(f: File): Promise<Anexo> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { nome: f.name, tipoMime: f.type, base64: btoa(bin) };
}

/** CPF (11) ou CNPJ (14) com dígito verificador conferido — a mesma conta do domínio, para validar na hora. */
export function documentoValido(doc: string): boolean {
  const d = doc.replace(/\D/g, '');
  const dv = (pesos: number[], mod: (s: number) => number) =>
    mod(pesos.reduce((a, p, i) => a + p * Number(d[i]), 0));
  if (d.length === 11 && !/^(\d)\1{10}$/.test(d)) {
    const m = (s: number) => ((s * 10) % 11) % 10;
    return (
      dv([10, 9, 8, 7, 6, 5, 4, 3, 2], m) === Number(d[9]) &&
      dv([11, 10, 9, 8, 7, 6, 5, 4, 3, 2], m) === Number(d[10])
    );
  }
  if (d.length === 14 && !/^(\d)\1{13}$/.test(d)) {
    const m = (s: number) => (s % 11 < 2 ? 0 : 11 - (s % 11));
    return (
      dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], m) === Number(d[12]) &&
      dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], m) === Number(d[13])
    );
  }
  return false;
}
