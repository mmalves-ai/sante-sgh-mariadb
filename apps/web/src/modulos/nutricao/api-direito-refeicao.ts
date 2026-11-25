// Refeição do acompanhante pelo direito (F7, 04-HOT linha 133): as regras do direito (lei, convênio ou política interna,
// com a fonte pagadora, a acomodação, a faixa de idade do paciente e as refeições), a decisão antes de lançar, o
// lançamento, a autorização da fonte pagadora e o cancelamento. A refeição cobrável vai para a conta do atendimento no
// servidor (faturamento). A recusa do servidor vem em `problema` (ErroNutricao).
import { FUNDAMENTOS_DIREITO_REFEICAO, COBERTURAS_REFEICAO } from '@sgh/dominio-pep';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, qs } from '../exames/api-exames.js';

const D = '/api/nutricao/direito-refeicao';
const R = '/api/nutricao/refeicoes-acompanhante';

const ni = z.number().int();
const esquemaRegra = z.object({
  id: ni,
  descricao: z.string(),
  fundamento: z.enum(FUNDAMENTOS_DIREITO_REFEICAO),
  fontePagadora: ni.nullable(),
  fontePagadoraNome: z.string().nullable(),
  acomodacao: ni.nullable(),
  acomodacaoDescricao: z.string().nullable(),
  idadeMinima: ni.nullable(),
  idadeMaxima: ni.nullable(),
  cobertoPelaFonte: z.boolean(),
  exigeAutorizacao: z.boolean(),
  incluidoNaDiaria: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
  refeicoes: z.array(ni),
  versao: ni,
});
export type RegraDireito = z.infer<typeof esquemaRegra>;

const esquemaOpcao = z.object({ id: ni, descricao: z.string() });
const esquemaApoio = z.object({
  fontes: z.array(esquemaOpcao),
  acomodacoes: z.array(esquemaOpcao),
  refeicoes: z.array(esquemaOpcao),
});
export type ApoioDireito = z.infer<typeof esquemaApoio>;

const esquemaDecisao = z.object({
  cobertura: z.enum(COBERTURAS_REFEICAO),
  regra: ni.nullable(),
  fundamento: z.enum(FUNDAMENTOS_DIREITO_REFEICAO).nullable(),
  incluidaNaDiaria: z.boolean(),
  motivo: z.string(),
  regraDescricao: z.string().nullable(),
  idadePaciente: ni.nullable(),
  baseLegal: z.string().nullable(),
});
export type DecisaoDireito = z.infer<typeof esquemaDecisao>;

const esquemaLancada = z.object({
  id: ni,
  data: z.string(),
  refeicao: ni,
  refeicaoDescricao: z.string().nullable(),
  quantidade: ni,
  situacao: z.string(),
  cobravel: z.boolean(),
  valor: z.number().nullable(),
  regra: ni.nullable(),
  regraDescricao: z.string().nullable(),
  autorizadaPelaFonte: z.boolean(),
  conta: ni.nullable(),
  observacao: z.string().nullable(),
  versao: ni,
});
export type RefeicaoAcompanhante = z.infer<typeof esquemaLancada>;

export interface RegraEnvio {
  readonly descricao: string;
  readonly fundamento: (typeof FUNDAMENTOS_DIREITO_REFEICAO)[number];
  readonly fontePagadora: number | null;
  readonly acomodacao: number | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly cobertoPelaFonte: boolean;
  readonly exigeAutorizacao: boolean;
  readonly incluidoNaDiaria: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly refeicoes: readonly number[];
}

const esquemaId = z.object({ id: ni }).passthrough();
const esquemaLancamento = z.object({
  id: ni,
  cobertura: z.enum(COBERTURAS_REFEICAO),
  valor: z.number().nullable(),
  motivo: z.string().optional(),
});

export const lerRegrasDireito = (): Promise<RegraDireito[]> =>
  ler(D, z.object({ itens: z.array(esquemaRegra) })).then((r) => r.itens);
export const lerApoioDireito = (): Promise<ApoioDireito> => ler(`${D}/apoio`, esquemaApoio);

export const incluirRegraDireito = (corpo: RegraEnvio, chave: string) => enviar(D, corpo, esquemaId, chave);

/** A alteração da regra é PUT, com a versão lida e a chave da intenção. */
export async function alterarRegraDireito(
  idRegra: number,
  corpo: RegraEnvio & { versao: number },
  chave: string,
) {
  const r = await fetch(`${D}/${idRegra}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaId);
}
export const definirUsoRegra = (idRegra: number, ativo: boolean, versao: number, chave: string) =>
  enviar(`${D}/${idRegra}/uso`, { ativo, versao }, esquemaId, chave);

export const lerRefeicoesAcompanhante = (internacao: number): Promise<RefeicaoAcompanhante[]> =>
  ler(`${R}/${internacao}`, z.object({ itens: z.array(esquemaLancada) })).then((r) => r.itens);
export const lerDecisaoRefeicao = (internacao: number, data: string, refeicao: number) =>
  ler(`${R}/${internacao}/decisao${qs({ data, refeicao })}`, esquemaDecisao);
export const lancarRefeicaoAcompanhante = (
  corpo: {
    internacao: number;
    data: string;
    refeicao: number;
    quantidade: number;
    observacao: string | null;
  },
  chave: string,
) => enviar(R, corpo, esquemaLancamento, chave);
export const autorizarRefeicaoAcompanhante = (
  id: number,
  autorizada: boolean,
  versao: number,
  chave: string,
) =>
  enviar(
    `${R}/${id}/autorizacao`,
    { autorizada, versao },
    z.object({ id: ni, cobertura: z.enum(COBERTURAS_REFEICAO), valor: z.number().nullable() }).passthrough(),
    chave,
  );
export const cancelarRefeicaoAcompanhante = (id: number, motivo: string, versao: number, chave: string) =>
  enviar(`${R}/${id}/cancelar`, { motivo, versao }, esquemaId, chave);
