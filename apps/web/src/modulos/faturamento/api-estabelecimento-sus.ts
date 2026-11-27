// Cliente das rotas do cadastro SUS do estabelecimento (F7, 06-SUS linha 61): /api/sus/estabelecimento.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/estabelecimento';
const comId = z.object({ id: z.number().nullable() }).passthrough();
const opcao = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
const vig = { vigenciaInicio: z.string(), vigenciaFim: z.string().nullable(), versao: z.number() };

export const esquemaCadastroSus = z.object({
  habilitacoes: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      numeroPortaria: z.string().nullable(),
      dataPortaria: z.string().nullable(),
      leitosHabilitados: z.number().nullable(),
      observacao: z.string().nullable(),
      vigente: z.boolean(),
      ...vig,
    }),
  ),
  servicos: z.array(
    z.object({
      id: z.number(),
      servicoClassificacao: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      caracteristica: z.string(),
      prestadorExterno: z.number().nullable(),
      prestadorNome: z.string().nullable(),
      vigente: z.boolean(),
      ...vig,
    }),
  ),
  regrasPrestador: z.array(
    z.object({
      id: z.number(),
      geral: z.boolean(),
      tipoPrestador: z.string(),
      naturezaJuridica: z.string().nullable(),
      procedimento: z.string().nullable(),
      grupo: z.string().nullable(),
      servicoClassificacao: z.string().nullable(),
      instrumento: z.string().nullable(),
      permitido: z.boolean(),
      vigente: z.boolean(),
      ...vig,
    }),
  ),
  regrasServico: z.array(
    z.object({
      id: z.number(),
      servicoClassificacao: z.string(),
      procedimento: z.string().nullable(),
      grupo: z.string().nullable(),
      setor: z.string().nullable(),
      local: z.string().nullable(),
      urgencia: z.boolean(),
      prioridade: z.number(),
      ativo: z.boolean(),
      versao: z.number(),
    }),
  ),
});
export type CadastroSus = z.infer<typeof esquemaCadastroSus>;

export const esquemaOpcoesCadastroSus = z.object({
  tiposPrestador: z.array(opcao),
  instrumentos: z.array(opcao),
  naturezas: z.array(opcao),
  servicos: z.array(opcao),
  servicosSigtap: z.array(opcao),
  grupos: z.array(opcao),
  prestadores: z.array(opcao),
  setores: z.array(opcao),
  locais: z.array(opcao),
});

const esquemaConciliacao = z.object({
  incluir: z.array(z.object({ codigo: z.string(), vigenciaInicio: z.string() }).passthrough()),
  encerrar: z.array(z.object({ id: z.number(), codigo: z.string(), vigenciaFim: z.string() })),
  conflitos: z.array(z.object({ id: z.number(), codigo: z.string(), motivo: z.string() })),
  mantidas: z.number(),
  aplicada: z.boolean(),
});
export type ConciliacaoCnesTela = z.infer<typeof esquemaConciliacao>;

export const lerCadastroSus = () => ler(B, esquemaCadastroSus);
export const lerOpcoesCadastroSus = () => ler(`${B}/opcoes`, esquemaOpcoesCadastroSus);
export const incluirHabilitacaoSus = (corpo: {
  codigo: string;
  numeroPortaria: string | null;
  dataPortaria: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  leitosHabilitados: number | null;
}) => enviar(`${B}/habilitacoes`, corpo, comId, novaChave('sus-habilitacao'));
export const conciliarHabilitacoesSus = (corpo: {
  competencia: string;
  habilitacoes: { codigo: string }[];
  aplicar: boolean;
}) =>
  enviar(`${B}/habilitacoes/conciliar`, corpo, esquemaConciliacao, novaChave('sus-habilitacao-conciliar'));
export type TipoEncerravel = 'habilitacoes' | 'servicos' | 'regras-prestador';
export const encerrarCadastroSus = (tipo: TipoEncerravel, id: number, vigenciaFim: string, versao: number) =>
  enviar(`${B}/${tipo}/${id}/encerrar`, { vigenciaFim, versao }, comId, novaChave(`sus-${tipo}-encerrar`));
export const incluirServicoSus = (corpo: {
  servicoClassificacao: number;
  caracteristica: 'proprio' | 'terceirizado';
  prestadorExterno: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}) => enviar(`${B}/servicos`, corpo, comId, novaChave('sus-servico'));
export const incluirRegraPrestadorSus = (corpo: {
  geral: boolean;
  tipoPrestador: number;
  naturezaJuridica: number | null;
  procedimentoCodigo: string | null;
  grupo: number | null;
  servicoClassificacao: number | null;
  instrumento: number | null;
  permitido: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}) => enviar(`${B}/regras-prestador`, corpo, comId, novaChave('sus-regra-prestador'));
export const incluirRegraServicoSus = (corpo: {
  servicoClassificacao: number;
  procedimentoCodigo: string | null;
  grupo: number | null;
  setor: number | null;
  local: number | null;
  urgencia: boolean;
  prioridade: number;
}) => enviar(`${B}/regras-servico`, corpo, comId, novaChave('sus-regra-servico'));
export const inativarRegraServicoSus = (id: number, versao: number) =>
  enviar(`${B}/regras-servico/${id}/inativar`, { versao }, comId, novaChave('sus-regra-servico-inativar'));

// Conferência com o cadastro nacional (C3-011): remessa de conferência por competência e críticas por gravidade.
export const esquemaConferenciasCnes = z.array(
  z.object({
    id: z.number(),
    competencia: z.string(),
    numeroRemessa: z.number(),
    situacao: z.string(),
    geradaEm: z.string().nullable(),
    quantidadeCriticas: z.number(),
    criticas: z.array(
      z.object({
        id: z.number(),
        sequencia: z.number(),
        categoria: z.string(),
        gravidade: z.enum(['erro', 'alerta', 'informacao']),
        mensagem: z.string(),
        resolvida: z.boolean(),
        versao: z.number(),
      }),
    ),
  }),
);
export type ConferenciaCnesTela = z.infer<typeof esquemaConferenciasCnes>[number];
const esquemaConferido = z
  .object({ id: z.number(), resumo: z.record(z.string(), z.number()), quantidadeCriticas: z.number() })
  .passthrough();
export const lerConferenciasCnes = () => ler(`${B}/cnes/conferencias`, esquemaConferenciasCnes);
export const conferirComCnes = (competencia: string) =>
  enviar(`${B}/cnes/conferir`, { competencia }, esquemaConferido, novaChave('sus-cnes-conferir'));
export const resolverCriticaCnes = (id: number, versao: number) =>
  enviar(`${B}/cnes/criticas/${id}/resolver`, { versao }, comId, novaChave('sus-cnes-resolver'));
