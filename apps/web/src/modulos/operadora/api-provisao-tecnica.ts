// Cliente da contabilidade regulatória da operadora (08-SGO L111, C3-026): plano de contas padrão da ANS, mapa das
// contas contábeis próprias para ele, balancete no padrão da ANS e provisões técnicas por competência. Respostas
// validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/provisoes-tecnicas';
const n = z.number();
const tn = z.string().nullable();
const gravado = z.object({ id: z.number().int(), versao: z.number().int() }).passthrough();

export const TIPOS_PROVISAO = [
  'peona',
  'peona_sus',
  'pesl',
  'pesl_sus',
  'ppcng',
  'pic',
  'remissao',
  'outra',
] as const;
export type TipoProvisao = (typeof TIPOS_PROVISAO)[number];
export const METODOS_PROVISAO = ['metodologia_ans', 'nota_tecnica_atuarial'] as const;
export type MetodoProvisao = (typeof METODOS_PROVISAO)[number];

export const esquemaContaAns = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.enum(['sintetica', 'analitica']),
  natureza: z.enum(['devedora', 'credora']).nullable(),
  modalidades: z.array(z.string()).nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  versaoFonte: z.string(),
  grau: n,
  superior: n.nullable(),
});
export type ContaAns = z.infer<typeof esquemaContaAns>;

export const esquemaMapa = z.object({
  id: n,
  versao: n,
  contaContabil: n,
  contaAns: z.string(),
  contaAnsDescricao: z.string(),
  classificacao: z.string(),
  contaDescricao: z.string(),
  duplicaValor: z.boolean(),
  grupo: tn,
  subgrupo: tn,
  paginaDiops: n.nullable(),
  linhaDiops: n.nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  ativo: z.boolean(),
});
export type MapaConta = z.infer<typeof esquemaMapa>;

export const esquemaBalancete = z.object({
  data: z.string(),
  linhas: z.array(
    z.object({
      codigo: z.string(),
      descricao: z.string(),
      tipo: z.enum(['sintetica', 'analitica']),
      grau: n,
      saldoCentavos: n,
      parcelas: z.array(z.object({ classificacao: z.string(), saldoCentavos: n })),
    }),
  ),
  semMapa: z.array(z.object({ contaContabil: n, classificacao: z.string(), saldoCentavos: n })),
  diferencaCentavos: n,
});
export type BalanceteAns = z.infer<typeof esquemaBalancete>;

export const esquemaProvisao = z.object({
  id: n,
  versao: n,
  competencia: z.string(),
  baseInicio: z.string(),
  baseFim: z.string(),
  metodo: z.enum(METODOS_PROVISAO),
  situacao: z.enum(['aberta', 'calculada', 'contabilizada', 'cancelada']),
  calculadoEm: tn,
  contabilizadoEm: tn,
  observacao: tn,
  total: n,
  itens: z.array(
    z.object({
      id: n,
      sequencia: n,
      tipo: z.enum(TIPOS_PROVISAO),
      conta: n,
      classificacao: z.string(),
      valor: n,
      valorAnterior: n.nullable(),
      observacao: tn,
    }),
  ),
});
export type Provisao = z.infer<typeof esquemaProvisao>;

export const esquemaContaContabil = z.object({ id: n, classificacao: z.string(), descricao: z.string() });
export type ContaContabil = z.infer<typeof esquemaContaContabil>;

export interface NovaContaAns {
  codigo: string;
  descricao: string;
  tipo: 'sintetica' | 'analitica';
  natureza: 'devedora' | 'credora' | null;
  modalidades: string[] | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  versaoFonte: string;
}
export interface NovoMapa {
  contaContabil: number;
  contaAns: string;
  duplicaValor: boolean;
  grupo: string | null;
  subgrupo: string | null;
  paginaDiops: number | null;
  linhaDiops: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export interface PedidoCalculo {
  competencia: string;
  metodo: MetodoProvisao;
  contas: Partial<Record<TipoProvisao, number>>;
  base: { contraprestacoes: number; eventos: number; avisadosNaoPagos: number } | null;
  informados: { tipo: TipoProvisao; valor: number; observacao: string | null }[];
  notaTecnica: string | null;
  versao: number | null;
}

export const lerPlanoAns = () => ler(`${A}/plano-ans`, z.array(esquemaContaAns));
export const incluirContaAns = (c: NovaContaAns) =>
  enviar(`${A}/plano-ans`, c, gravado, novaChave('conta-ans'));
export const lerMapa = (op: number) => ler(`${A}/${op}/mapa`, z.array(esquemaMapa));
export const incluirMapa = (op: number, m: NovoMapa) =>
  enviar(`${A}/${op}/mapa`, m, gravado, novaChave('mapa-ans'));
export const encerrarMapa = (id: number, versao: number, fim: string) =>
  enviar(`${A}/mapa/${id}/encerramento`, { versao, fim }, gravado, novaChave('mapa-fim'));
export const lerBalanceteAns = (op: number, data: string) =>
  ler(`${A}/${op}/balancete?data=${encodeURIComponent(data)}`, esquemaBalancete);
export const lerProvisoes = () => ler(A, z.array(esquemaProvisao));
export const calcularProvisoes = (p: PedidoCalculo) =>
  enviar(`${A}/calculo`, p, gravado, novaChave('provisao-calculo'));
export const contabilizarProvisao = (
  id: number,
  versao: number,
  contaDespesa: number,
  contaReversao: number | null,
) =>
  enviar(
    `${A}/${id}/contabilizacao`,
    { versao, contaDespesa, contaReversao },
    gravado,
    novaChave('provisao-contabil'),
  );
export const cancelarProvisao = (id: number, versao: number, motivo: string) =>
  enviar(`${A}/${id}/cancelamento`, { versao, motivo }, gravado, novaChave('provisao-cancelar'));
export const buscarContasContabeis = (busca: string) =>
  ler(`${A}/contas-contabeis?busca=${encodeURIComponent(busca)}`, z.array(esquemaContaContabil));
