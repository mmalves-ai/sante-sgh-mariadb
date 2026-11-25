// Cliente das rotas do plano da pré-internação e da fila de espera eletiva (C2-048, 04-INT linha 70):
// /api/internacao/pre-internacao. Procedimentos, materiais e equipe previstos; fila por prioridade e data do pedido.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/internacao/pre-internacao';
const n = z.number();
const txt = z.string();
export const PRIORIDADES_FILA = ['urgente', 'prioritaria', 'normal'] as const;
export const VIAS_ACESSO = ['unica', 'mesma_via', 'diferente_via'] as const;

const esquemaPlano = z.object({
  preInternacao: n,
  numero: txt,
  paciente: n,
  situacao: txt,
  prioridade: z.enum(PRIORIDADES_FILA),
  editavel: z.boolean(),
  versao: n,
  procedimentoSus: z.object({ codigo: txt, descricao: txt }).nullable(),
  procedimentos: z.array(
    z.object({
      item: n,
      codigo: txt,
      descricao: txt,
      quantidade: n,
      principal: z.boolean(),
      viaAcesso: txt.nullable(),
      incluirNaGuia: z.boolean(),
    }),
  ),
  materiais: z.array(
    z.object({
      insumo: n,
      codigo: txt,
      nome: txt,
      unidade: txt.nullable(),
      quantidade: n,
      fornecedor: n.nullable(),
      fornecedorNome: txt.nullable(),
      observacao: txt.nullable(),
    }),
  ),
  equipe: z.array(z.object({ profissional: n, nome: txt, funcao: n, funcaoDescricao: txt })),
});
export type PlanoPre = z.infer<typeof esquemaPlano>;

const esquemaEspera = z.object({
  preInternacao: n,
  numero: txt,
  paciente: n,
  nome: txt,
  prontuario: n.nullable(),
  prioridade: z.enum(PRIORIDADES_FILA),
  solicitadoEm: txt,
  diasEspera: n,
  posicao: n,
  especialidade: txt.nullable(),
  procedimentoPrincipal: txt.nullable(),
  procedimentos: n,
  materiais: n,
  equipe: n,
  versao: n,
});
export type EsperaInternacao = z.infer<typeof esquemaEspera>;

export const lerApoioPlanoPre = () =>
  ler(`${C}/apoio`, z.object({ funcoes: z.array(z.object({ id: n, descricao: txt })) }).passthrough());
const q = (t: string) => encodeURIComponent(t.trim());
export const buscarItensPlano = (t: string) =>
  ler(`${C}/busca/itens?termo=${q(t)}`, z.array(z.object({ id: n, codigo: txt, descricao: txt })));
export const buscarInsumosPlano = (t: string) =>
  ler(
    `${C}/busca/insumos?termo=${q(t)}`,
    z.array(z.object({ id: n, codigo: txt, nome: txt, unidade: txt.nullable() })),
  );
export const buscarProfissionaisPlano = (t: string) =>
  ler(`${C}/busca/profissionais?termo=${q(t)}`, z.array(z.object({ id: n, nome: txt })));
export const buscarFornecedoresPlano = (t: string) =>
  ler(
    `${C}/busca/fornecedores?termo=${q(t)}`,
    z.array(z.object({ id: n, nome: txt, fantasia: txt.nullable(), opme: z.boolean() })),
  );
export const lerPlanoDoPaciente = (paciente: number) =>
  ler(`${C}/pacientes/${paciente}/plano`, z.object({ plano: esquemaPlano.nullable() }));
export const lerFilaEspera = () =>
  ler(`${C}/fila`, z.object({ itens: z.array(esquemaEspera), contagens: z.record(z.string(), n) }));

export interface CorpoPlano {
  versao: number;
  procedimentos: {
    item: number;
    quantidade: number;
    principal: boolean;
    viaAcesso: string | null;
    incluirNaGuia: boolean;
  }[];
  materiais: { insumo: number; quantidade: number; fornecedor: number | null; observacao: string | null }[];
  equipe: { profissional: number; funcao: number }[];
}
const okVersao = z.object({ versao: n }).passthrough();
export const gravarPlanoPre = (pre: number, corpo: CorpoPlano) =>
  enviar(`${C}/${pre}/plano`, corpo, okVersao, novaChave('pre-plano'));
export const priorizarPre = (
  pre: number,
  corpo: { versao: number; prioridade: string; justificativa: string },
) => enviar(`${C}/${pre}/prioridade`, corpo, okVersao, novaChave('pre-prioridade'));
