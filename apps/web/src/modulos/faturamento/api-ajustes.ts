// Cliente dos ajustes de valor na conta (F3.7, 06-FAT linhas 17, 18 e 20): horário especial, acréscimo e desconto com
// alçada e pacote na conta. As regras vêm de @sgh/dominio-faturamento (a mesma da API), para a validação aparecer
// enquanto se digita; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const itemHorario = z.object({
  id: z.number(),
  sequencia: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  realizadoEm: z.string(),
  feriado: z.boolean(),
  faixa: z.string().nullable(),
  acrescimoAtual: z.number(),
  acrescimo: z.number(),
  mudou: z.boolean(),
});
const ajuste = z.object({
  id: z.number(),
  versao: z.number(),
  tipo: z.string(),
  motivo: z.string(),
  forma: z.string(),
  percentual: z.number().nullable(),
  valor: z.number(),
  justificativa: z.string(),
  situacao: z.string(),
  solicitadoEm: z.string(),
  solicitanteId: z.number(),
  solicitante: z.string().nullable(),
  decisor: z.string().nullable(),
});
export type AjusteConta = z.infer<typeof ajuste>;
const motivo = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipoAjuste: z.enum(['acrescimo', 'desconto']),
  forma: z.string().nullable(),
  valorPadrao: z.number().nullable(),
  textoPadrao: z.string().nullable(),
});
export type MotivoAjuste = z.infer<typeof motivo>;
const esquemaAjustes = z.object({
  contaId: z.number(),
  situacao: z.string(),
  editavel: z.boolean(),
  valores: z.object({ itens: z.number(), acrescimo: z.number(), desconto: z.number(), total: z.number() }),
  reservado: z.object({ desconto: z.number(), acrescimo: z.number() }),
  ajustes: z.array(ajuste),
  motivos: z.array(motivo),
  horario: z.array(itemHorario),
});
export type AjustesDaConta = z.infer<typeof esquemaAjustes>;

const alerta = z.object({ tipo: z.string(), descaracteriza: z.boolean(), mensagem: z.string() });
const esquemaPacotes = z.object({
  contaId: z.number(),
  situacao: z.string(),
  editavel: z.boolean(),
  dias: z.number(),
  aplicados: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      pacoteId: z.number(),
      pacote: z.string(),
      numeroVersao: z.number().nullable(),
      valorCobrado: z.number(),
      ativo: z.boolean(),
      descaracterizacao: z
        .object({ motivo: z.string().nullable(), justificativa: z.string().nullable() })
        .passthrough()
        .nullable(),
      inclusos: z.number(),
      aParte: z.number(),
      alertas: z.array(alerta),
    }),
  ),
  candidatos: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })),
  motivos: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), tipo: z.string() })),
});
export type PacotesDaConta = z.infer<typeof esquemaPacotes>;

export const lerAjustes = (conta: number) => ler(`${F}/contas/${conta}/ajustes`, esquemaAjustes);
export const aplicarHorario = (conta: number, chave: string) =>
  enviar(`${F}/contas/${conta}/horario-especial`, {}, qualquer, chave);
export const pedirAjuste = (conta: number, a: Record<string, unknown>, chave: string) =>
  enviar(`${F}/contas/${conta}/ajustes`, a, qualquer, chave);
export const decidirAjuste = (
  id: number,
  versao: number,
  decisao: 'aprovar' | 'recusar',
  observacao: string | null,
  chave: string,
) => enviar(`${F}/ajustes-conta/${id}/decisao`, { versao, decisao, observacao }, qualquer, chave);
export const cancelarAjuste = (id: number, versao: number, chave: string) =>
  enviar(`${F}/ajustes-conta/${id}/cancelamento`, { versao }, qualquer, chave);

export const lerPacotes = (conta: number) => ler(`${F}/contas/${conta}/pacotes`, esquemaPacotes);
export const aplicarPacote = (conta: number, pacoteId: number, chave: string) =>
  enviar(`${F}/contas/${conta}/pacotes`, { pacoteId }, qualquer, chave);
export const descaracterizarPacote = (
  id: number,
  versao: number,
  motivoId: number,
  justificativa: string,
  chave: string,
) =>
  enviar(`${F}/pacotes-conta/${id}/descaracterizacao`, { versao, motivoId, justificativa }, qualquer, chave);

// ── Cadastro do horário especial (06-FAT linha 17): faixas de acréscimo e expediente da tabela de preço ──────────

const faixaHorario = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipoHorario: z.string(),
  diaSemana: z.number().nullable(),
  aplicaFeriado: z.boolean(),
  horaInicio: z.string().nullable(),
  horaFim: z.string().nullable(),
  percentual: z.number(),
  percentualHonorario: z.number().nullable(),
  percentualCustoOperacional: z.number().nullable().optional(),
  percentualFilme: z.number().nullable().optional(),
  percentualAnestesia: z.number().nullable().optional(),
  exigeUrgencia: z.boolean().optional(),
  aplicaProcedimentosVinculados: z.boolean().optional(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  fontePagadoraId: z.number().nullable(),
  contratoId: z.number().nullable().optional(),
  ativo: z.boolean(),
});
export type FaixaHorarioTela = z.infer<typeof faixaHorario>;
const esquemaHorarioEspecial = z.object({
  faixas: z.array(faixaHorario),
  expediente: z.array(z.object({ diaSemana: z.number(), horaInicio: z.string(), horaFim: z.string() })),
  fontes: z.array(z.object({ id: z.number(), nome: z.string() })).default([]),
  tabelas: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })).default([]),
});
export type HorarioEspecialCadastro = z.infer<typeof esquemaHorarioEspecial>;

export const lerHorarioEspecial = (tabela: number | null) =>
  ler(`${F}/horario-especial${tabela ? `?tabela=${tabela}` : ''}`, esquemaHorarioEspecial);
export const gravarFaixaHorario = (f: Record<string, unknown>, chave: string) =>
  enviar(`${F}/horario-especial`, f, qualquer, chave);
export const gravarExpediente = (
  tabela: number,
  periodos: readonly { diaSemana: number; horaInicio: string; horaFim: string }[],
  chave: string,
) => enviar(`${F}/tabelas/${tabela}/expediente`, { faixas: periodos }, qualquer, chave);
