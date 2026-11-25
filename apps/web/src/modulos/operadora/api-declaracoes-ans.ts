// Cliente das declarações periódicas da operadora (08-SGO L110): TPS apurada, conferência cadastral da base da ANS e
// DMED. Respostas validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/ans/declaracoes';
const gravado = z.object({ id: z.number().int(), versao: z.number().int() }).passthrough();
const n = z.number();
const tn = z.string().nullable();

export const esquemaApuracaoTps = z.object({
  id: n,
  versao: n,
  ano: n,
  trimestre: n.nullable(),
  vigencia: z.string(),
  vidas: n,
  valorPorVida: n,
  valorTotal: n,
  nossoNumero: tn,
  vencimento: tn,
  dataPagamento: tn,
  valorPago: n.nullable(),
  situacao: z.enum(['apurada', 'guia_emitida', 'paga', 'cancelada']),
});
export type ApuracaoTps = z.infer<typeof esquemaApuracaoTps>;
const esquemaApurado = z.object({
  id: n,
  apuracao: z.object({
    valorTotal: n,
    vencimento: z.string(),
    parcelas: z.array(z.object({ plano: z.string(), media: n, valor: n })),
  }),
});
export type ResultadoApuracao = z.infer<typeof esquemaApurado>;

export const esquemaConferencia = z.object({
  id: n,
  competencia: z.string(),
  importadaEm: z.string(),
  registros: n,
  divergencias: n,
  pendentes: n,
  situacao: z.string(),
  observacao: tn,
});
export type Conferencia = z.infer<typeof esquemaConferencia>;
export const esquemaDivergencia = z.object({
  id: n,
  versao: n,
  sequencia: n,
  beneficiario: n.nullable(),
  cco: tn,
  tipo: z.string(),
  campo: tn,
  valorCadastro: tn,
  valorAns: tn,
  correcao: z.enum(['pendente', 'corrigir_cadastro', 'retificar_ans', 'corrigida', 'ignorada']),
  justificativa: tn,
});
export type Divergencia = z.infer<typeof esquemaDivergencia>;

export const esquemaDeclaracao = z.object({
  id: n,
  versao: n,
  anoCalendario: n,
  anoReferencia: n,
  prazo: z.string(),
  retificadora: z.boolean(),
  retifica: n.nullable(),
  numeroRecibo: tn,
  responsavelNome: z.string(),
  situacao: z.enum(['em_preparacao', 'gerada', 'transmitida', 'aceita', 'rejeitada', 'cancelada']),
  arquivo: z.boolean(),
  itens: n,
  total: n,
});
export type Declaracao = z.infer<typeof esquemaDeclaracao>;
const esquemaArquivo = z.object({ nome: z.string(), base64: z.string(), sha256: z.string() });

export const lerApuracoesTps = (op: number) => ler(`${A}/${op}/tps`, z.array(esquemaApuracaoTps));
export const apurarTps = (op: number, ano: number, trimestre: number) =>
  enviar(`${A}/${op}/tps`, { ano, trimestre }, esquemaApurado, novaChave('tps'));
export const passoTps = (
  id: number,
  corpo: {
    versao: number;
    para: 'guia_emitida' | 'paga' | 'cancelada';
    nossoNumero?: string | null;
    dataPagamento?: string | null;
    valorPago?: number | null;
  },
) => enviar(`${A}/tps/${id}/passo`, corpo, gravado, novaChave('tps-passo'));

export const lerConferencias = (op: number) => ler(`${A}/${op}/conferencias`, z.array(esquemaConferencia));
export const importarConferencia = (op: number, competencia: string, nome: string, base64: string) =>
  enviar(`${A}/${op}/conferencias`, { competencia, nome, base64 }, gravado, novaChave('conferencia'));
export const lerDivergencias = (id: number) =>
  ler(`${A}/conferencias/${id}/itens`, z.array(esquemaDivergencia));
export const tratarDivergencia = (
  id: number,
  versao: number,
  para: Exclude<Divergencia['correcao'], 'pendente'>,
  justificativa: string | null,
) =>
  enviar(
    `${A}/divergencias/${id}/tratar`,
    { versao, para, justificativa },
    gravado,
    novaChave('divergencia'),
  );

export const lerDeclaracoes = (op: number) => ler(`${A}/${op}/dmed`, z.array(esquemaDeclaracao));
export const gerarDmed = (
  op: number,
  corpo: {
    anoCalendario: number;
    retifica: number | null;
    responsavelCpf: string;
    responsavelNome: string;
    responsavelDdd: string | null;
    responsavelTelefone: string | null;
    responsavelEmail: string | null;
  },
) => enviar(`${A}/${op}/dmed`, corpo, gravado, novaChave('dmed'));
export const passoDmed = (
  id: number,
  versao: number,
  para: 'transmitida' | 'aceita' | 'rejeitada' | 'cancelada',
  recibo: string | null,
) => enviar(`${A}/dmed/${id}/passo`, { versao, para, recibo }, gravado, novaChave('dmed-passo'));
export const lerArquivoDmed = (id: number) => ler(`${A}/dmed/${id}/arquivo`, esquemaArquivo);
