// Cliente das regras de coparticipação do plano e do contrato (08-SGO L98, C2-116): regra geral e por tipo de guia,
// grupo, procedimento e regime, com os tetos por evento, mês e ano; encerrar pela vigência. Respostas validadas aqui;
// Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/coparticipacao-regras';
const n = z.number();
const nn = n.nullable();
const tn = z.string().nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();
const opcao = z.object({ id: n, rotulo: z.string() });
export type Opcao = z.infer<typeof opcao>;

export const TIPOS_COPARTICIPACAO = ['nenhuma', 'percentual', 'valor_fixo'] as const;
export type TipoCoparticipacao = (typeof TIPOS_COPARTICIPACAO)[number];

export const esquemaRegra = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  plano: nn,
  contrato: nn,
  tipo: z.enum(TIPOS_COPARTICIPACAO),
  valor: nn,
  tetoEvento: nn,
  tetoMensal: nn,
  tetoAnual: nn,
  procedimento: nn,
  procedimentoDescricao: tn,
  grupo: nn,
  grupoDescricao: tn,
  tipoGuia: nn,
  tipoGuiaDescricao: tn,
  regime: nn,
  regimeDescricao: tn,
  inicio: z.string(),
  fim: tn,
  vigente: z.boolean(),
});
export type RegraCoparticipacao = z.infer<typeof esquemaRegra>;
export const esquemaOpcoes = z.object({
  planos: z.array(opcao),
  contratos: z.array(opcao),
  tiposGuia: z.array(opcao),
  grupos: z.array(opcao),
  regimes: z.array(opcao),
});
export type OpcoesRegra = z.infer<typeof esquemaOpcoes>;

export interface NovaRegra {
  codigo: string;
  descricao: string;
  plano: number | null;
  contrato: number | null;
  tipo: TipoCoparticipacao;
  valor: number | null;
  tetoEvento: number | null;
  tetoMensal: number | null;
  tetoAnual: number | null;
  procedimento: number | null;
  grupo: number | null;
  tipoGuia: number | null;
  regime: number | null;
  inicio: string;
  fim: string | null;
}

export const lerOpcoes = (op: number) => ler(`${A}/${op}/opcoes`, esquemaOpcoes);
export const lerRegras = (op: number, alvo: { plano: number | null; contrato: number | null }) => {
  const q = alvo.plano ? `?plano=${alvo.plano}` : alvo.contrato ? `?contrato=${alvo.contrato}` : '';
  return ler(`${A}/${op}${q}`, z.array(esquemaRegra));
};
export const buscarProcedimentos = (busca: string) =>
  ler(`/api/operadora/coparticipacao-procedimentos?busca=${encodeURIComponent(busca)}`, z.array(opcao));
export const incluirRegra = (op: number, corpo: NovaRegra) =>
  enviar(`${A}/${op}`, corpo, gravado, novaChave('copart-regra'));
export const encerrarRegra = (id: number, corpo: { versao: number; fim: string }) =>
  enviar(`${A}/regra/${id}/encerrar`, corpo, gravado, novaChave('copart-encerrar'));
