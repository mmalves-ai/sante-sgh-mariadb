// Cliente das regras de franquia do plano e do contrato (08-SGO L98, C2-116, decisão 56): o limite da janela de
// acúmulo, o percentual ou o fator, o teto por guia e a internação; encerrar pela vigência. Respostas validadas aqui;
// Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/franquia-regras';
const n = z.number();
const nn = n.nullable();
const tn = z.string().nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();
const opcao = z.object({ id: n, rotulo: z.string() });
export type Opcao = z.infer<typeof opcao>;

export const PERIODOS_ACUMULO = ['evento', 'dia', 'mes', 'ano', 'vigencia_contrato'] as const;
export type PeriodoAcumulo = (typeof PERIODOS_ACUMULO)[number];

export const esquemaRegraFranquia = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  tipoFranquia: n,
  tipoFranquiaDescricao: tn,
  plano: nn,
  contrato: nn,
  grupo: nn,
  grupoDescricao: tn,
  regime: nn,
  regimeDescricao: tn,
  valor: nn,
  percentual: nn,
  fator: nn,
  tetoPorGuia: nn,
  periodoAcumulo: z.enum(PERIODOS_ACUMULO),
  diasInternacao: nn,
  cobraGuiaAmbulatorialNaInternacao: z.boolean(),
  inicio: z.string(),
  fim: tn,
  vigente: z.boolean(),
});
export type RegraFranquia = z.infer<typeof esquemaRegraFranquia>;
export const esquemaOpcoesFranquia = z.object({
  planos: z.array(opcao),
  contratos: z.array(opcao),
  tiposFranquia: z.array(opcao),
  grupos: z.array(opcao),
  regimes: z.array(opcao),
});
export type OpcoesFranquia = z.infer<typeof esquemaOpcoesFranquia>;

export interface NovaRegraFranquia {
  codigo: string;
  descricao: string;
  tipoFranquia: number;
  plano: number | null;
  contrato: number | null;
  grupo: number | null;
  regime: number | null;
  valor: number | null;
  percentual: number | null;
  fator: number | null;
  tetoPorGuia: number | null;
  periodoAcumulo: PeriodoAcumulo;
  diasInternacao: number | null;
  cobraGuiaAmbulatorialNaInternacao: boolean;
  inicio: string;
  fim: string | null;
}

export const lerOpcoesFranquia = (op: number) => ler(`${A}/${op}/opcoes`, esquemaOpcoesFranquia);
export const lerRegrasFranquia = (op: number, alvo: { plano: number | null; contrato: number | null }) => {
  const q = alvo.plano ? `?plano=${alvo.plano}` : alvo.contrato ? `?contrato=${alvo.contrato}` : '';
  return ler(`${A}/${op}${q}`, z.array(esquemaRegraFranquia));
};
export const incluirRegraFranquia = (op: number, corpo: NovaRegraFranquia) =>
  enviar(`${A}/${op}`, corpo, gravado, novaChave('franquia-regra'));
export const encerrarRegraFranquia = (id: number, corpo: { versao: number; fim: string }) =>
  enviar(`${A}/regra/${id}/encerrar`, corpo, gravado, novaChave('franquia-encerrar'));
