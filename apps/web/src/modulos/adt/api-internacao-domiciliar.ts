// Cliente das rotas da internação domiciliar (C2-079, 04-INT linha 84): /api/internacao/domiciliar.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const D = '/api/internacao/domiciliar';
const opcao = z.object({ id: z.number(), nome: z.string() });

export const esquemaOpcoesDomiciliar = z.object({
  tiposChamado: z.array(opcao.extend({ coparticipacao: z.boolean() })),
  motivosChamado: z.array(opcao.extend({ tipo: z.number().nullable() })),
  motivosTransferencia: z.array(opcao),
  programas: z.array(opcao),
  areas: z.array(opcao),
  fontes: z.array(opcao),
  tiposCusto: z.array(opcao),
  profissionais: z.array(opcao),
});
export type OpcoesDomiciliar = z.infer<typeof esquemaOpcoesDomiciliar>;

const n = z.number().nullable();
const s = z.string().nullable();
export const esquemaOrcamentoDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.string(),
  paciente: z.number(),
  pacienteNome: s,
  tipo: z.string(),
  modalidade: z.string(),
  fontePagadora: n,
  fonteNome: s,
  situacao: z.string(),
  validade: s,
  periodoInicio: s,
  periodoFim: s,
  diagnostico: s,
  percentualImpostos: z.number(),
  valorCustoTotal: z.number(),
  valorImpostos: z.number(),
  valorTotal: z.number(),
  criadoEm: s,
  respostaEm: s,
  itens: z.array(
    z.object({
      sequencia: z.number(),
      tipoItem: z.string(),
      descricao: z.string(),
      quantidade: z.number(),
      dias: n,
      valorUnitario: z.number(),
      valorTotal: z.number(),
    }),
  ),
});
export type OrcamentoDomiciliar = z.infer<typeof esquemaOrcamentoDomiciliar>;
export const esquemaInternacaoDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.string(),
  paciente: z.number(),
  pacienteNome: s,
  situacao: z.string(),
  endereco: s,
  origemInternacao: n,
  orcamento: n,
  orcamentoNumero: s,
  medico: n,
  medicoNome: s,
  porLiminar: z.boolean(),
  solicitacao: s,
  prevista: s,
  inicio: s,
  fim: s,
  observacao: s,
});
export type InternacaoDomiciliar = z.infer<typeof esquemaInternacaoDomiciliar>;
export const esquemaChamadoDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.string(),
  paciente: z.number(),
  pacienteNome: s,
  internacao: n,
  tipo: z.number(),
  tipoNome: s,
  motivoNome: s,
  prioridade: s,
  situacao: z.string(),
  chamadoEm: z.string(),
  endereco: s,
  sintoma: s,
  profissional: n,
  profissionalNome: s,
  desfecho: s,
  realizadoEm: s,
  motivoAnulacao: s,
});
export type ChamadoDomiciliar = z.infer<typeof esquemaChamadoDomiciliar>;
export const esquemaVisitaDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  paciente: z.number(),
  pacienteNome: s,
  internacao: n,
  chamado: n,
  profissional: z.number(),
  profissionalNome: s,
  tipoNome: s,
  agendadaPara: z.string(),
  duracao: n,
  extra: z.boolean(),
  situacao: z.string(),
  iniciadaEm: s,
  encerradaEm: s,
  motivo: s,
});
export type VisitaDomiciliar = z.infer<typeof esquemaVisitaDomiciliar>;

export const esquemaPainelDomiciliar = z.object({
  internacoes: z.array(esquemaInternacaoDomiciliar),
  chamados: z.array(esquemaChamadoDomiciliar),
  visitas: z.array(esquemaVisitaDomiciliar),
  orcamentos: z.array(esquemaOrcamentoDomiciliar),
});
export type PainelDomiciliar = z.infer<typeof esquemaPainelDomiciliar>;
export const esquemaPacienteDomiciliar = esquemaPainelDomiciliar.extend({
  paciente: z.object({ id: z.number(), nome: s }),
  enderecos: z.array(opcao),
  hospitalares: z.array(opcao),
});
export type PacienteDomiciliar = z.infer<typeof esquemaPacienteDomiciliar>;

const resposta = z
  .object({
    id: z.number().nullable().optional(),
    numero: z.string().optional(),
    situacao: z.string().nullable().optional(),
  })
  .passthrough();

export const lerOpcoesDomiciliar = () => ler(`${D}/opcoes`, esquemaOpcoesDomiciliar);
export const lerPainelDomiciliar = () => ler(`${D}/painel`, esquemaPainelDomiciliar);
export const lerPacienteDomiciliar = (id: number) => ler(`${D}/pacientes/${id}`, esquemaPacienteDomiciliar);

export const salvarOrcamentoDomiciliar = (id: number | null, corpo: Record<string, unknown>) =>
  enviar(
    id === null ? `${D}/orcamentos` : `${D}/orcamentos/${id}`,
    corpo,
    resposta,
    novaChave('domiciliar-orcamento'),
  );
export const agirOrcamentoDomiciliar = (id: number, acao: string, corpo: Record<string, unknown>) =>
  enviar(`${D}/orcamentos/${id}/${acao}`, corpo, resposta, novaChave(`domiciliar-orcamento-${acao}`));
export const transferirParaCasa = (corpo: Record<string, unknown>) =>
  enviar(`${D}/internacoes`, corpo, resposta, novaChave('domiciliar-transferir'));
export const agirInternacaoDomiciliar = (id: number, acao: string, corpo: Record<string, unknown>) =>
  enviar(`${D}/internacoes/${id}/${acao}`, corpo, resposta, novaChave(`domiciliar-${acao}`));
export const abrirChamadoDomiciliar = (corpo: Record<string, unknown>) =>
  enviar(`${D}/chamados`, corpo, resposta, novaChave('domiciliar-chamado'));
export const agirChamadoDomiciliar = (id: number, acao: string, corpo: Record<string, unknown>) =>
  enviar(`${D}/chamados/${id}/${acao}`, corpo, resposta, novaChave(`domiciliar-chamado-${acao}`));
export const agendarVisitaDomiciliar = (corpo: Record<string, unknown>) =>
  enviar(`${D}/visitas`, corpo, resposta, novaChave('domiciliar-visita'));
export const agirVisitaDomiciliar = (id: number, acao: string, corpo: Record<string, unknown>) =>
  enviar(`${D}/visitas/${id}/${acao}`, corpo, resposta, novaChave(`domiciliar-visita-${acao}`));
