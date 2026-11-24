// Cliente das rotas dos leitos do sistema público (F78.04-2, 04-INT linha 79): /api/internacao/leitos-sus, e da
// comunicação da internação e da alta à operadora (04-INT linha 80): /api/internacao/comunicacoes-operadora.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const S = '/api/internacao/leitos-sus';
const C = '/api/internacao/comunicacoes-operadora';
const comId = z.object({ id: z.number() }).passthrough();

export const esquemaHabilitacaoSus = z.object({
  id: z.number(),
  codigo: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  numeroPortaria: z.string().nullable(),
  dataPortaria: z.string().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  quantidadeLeitosHabilitados: z.number().nullable(),
  tipoAtendimento: z.string(),
  permiteUsoForaPrograma: z.boolean(),
  avisaUsuario: z.boolean(),
  ativo: z.boolean(),
  leitosNoPrograma: z.number(),
  versao: z.number(),
});
export type HabilitacaoSus = z.infer<typeof esquemaHabilitacaoSus>;

export const esquemaLeitoPrograma = z.object({
  id: z.number(),
  leito: z.number(),
  leitoCodigo: z.string(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  versao: z.number(),
});
export type LeitoPrograma = z.infer<typeof esquemaLeitoPrograma>;

export const esquemaCapacidadeSus = z.object({
  especialidade: z.number(),
  especialidadeDescricao: z.string(),
  terapiaIntensiva: z.boolean(),
  quantidadeLeitos: z.number(),
  criticaLiberada: z.boolean(),
  tetoDiarias: z.number(),
  historico: z.array(
    z.object({
      id: z.number(),
      operacao: z.string(),
      quantidadeLeitos: z.number(),
      criticaLiberada: z.boolean(),
      ocorridoEm: z.string(),
      usuario: z.number().nullable(),
    }),
  ),
});
export type CapacidadeSus = z.infer<typeof esquemaCapacidadeSus>;

export const lerHabilitacoesSus = () =>
  ler(`${S}/habilitacoes`, z.object({ itens: z.array(esquemaHabilitacaoSus) }));
export const incluirHabilitacaoSus = (corpo: Record<string, unknown>) =>
  enviar(`${S}/habilitacoes`, corpo, comId, novaChave('sus-habilitacao'));
export const encerrarHabilitacaoSus = (id: number, versao: number, vigenciaFim: string) =>
  enviar(
    `${S}/habilitacoes/${id}/encerrar`,
    { versao, vigenciaFim },
    comId,
    novaChave('sus-habilitacao-fim'),
  );
export const lerLeitosPrograma = (hab: number) =>
  ler(`${S}/habilitacoes/${hab}/leitos`, z.object({ itens: z.array(esquemaLeitoPrograma) }));
export const vincularLeitoPrograma = (hab: number, corpo: { leito: number; vigenciaInicio: string }) =>
  enviar(`${S}/habilitacoes/${hab}/leitos`, corpo, comId, novaChave('sus-leito'));
export const encerrarLeitoPrograma = (id: number, versao: number, vigenciaFim: string) =>
  enviar(`${S}/leitos/${id}/encerrar`, { versao, vigenciaFim }, comId, novaChave('sus-leito-fim'));
export const lerCapacidadeSus = (competencia: string) =>
  ler(
    `${S}/capacidade?competencia=${encodeURIComponent(competencia)}`,
    z.object({ competencia: z.string(), itens: z.array(esquemaCapacidadeSus) }),
  );
export const registrarCapacidadeSus = (corpo: {
  especialidade: number;
  competencia: string;
  quantidadeLeitos: number;
  criticaLiberada: boolean;
  excluir: boolean;
}) => enviar(`${S}/capacidade`, corpo, comId, novaChave('sus-capacidade'));

export const esquemaComunicacao = z.object({
  id: z.number(),
  tipo: z.string(),
  situacao: z.string(),
  protocolo: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  respondidoEm: z.string().nullable(),
  resposta: z.string().nullable(),
  criadoEm: z.string(),
  versao: z.number(),
});
export type Comunicacao = z.infer<typeof esquemaComunicacao>;

export const lerComunicacoes = (int: number) =>
  ler(`${C}/internacoes/${int}`, z.object({ itens: z.array(esquemaComunicacao) }));
export const registrarComunicacao = (int: number, tipo: string) =>
  enviar(`${C}/internacoes/${int}`, { tipo }, comId, novaChave('com-operadora'));
export const lerMensagemComunicacao = (id: number) =>
  ler(
    `${C}/${id}/mensagem`,
    z.object({
      xml: z.string().nullable(),
      problemas: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
    }),
  );
export const transicaoComunicacao = (
  id: number,
  corpo: { acao: string; versao: number; protocolo?: string | null; resposta?: string | null },
) => enviar(`${C}/${id}/transicao`, corpo, comId, novaChave('com-operadora-transicao'));
