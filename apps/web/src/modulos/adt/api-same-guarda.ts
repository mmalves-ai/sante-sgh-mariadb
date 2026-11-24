// Cliente das rotas da guarda do prontuário pelo volume (F3.9, 04-HOT L126): /api/same/guarda.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-adt.js';

const G = '/api/same/guarda';

const esquemaOperacao = z.object({
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.enum(['registro', 'saida', 'emprestimo', 'devolucao', 'transferencia', 'recebimento', 'descarte']),
  sentido: z.enum(['entrada', 'saida', 'neutro']),
  exigeDestino: z.boolean(),
  exigePrevisaoRetorno: z.boolean(),
  encerraGuarda: z.boolean(),
});
export type OperacaoGuardaTela = z.infer<typeof esquemaOperacao>;

const esquemaApoio = z.object({
  locais: z.array(
    z.object({
      id: z.number(),
      nivel: z.string(),
      codigo: z.string(),
      caminho: z.string(),
      pai: z.number().nullable(),
      capacidade: z.number().nullable(),
      volumes: z.number(),
    }),
  ),
  setores: z.array(z.object({ id: z.number(), nome: z.string() })),
  tiposDocumento: z.array(z.object({ id: z.number(), descricao: z.string() })),
});
export type ApoioGuarda = z.infer<typeof esquemaApoio>;

const esquemaMovimento = z.object({
  id: z.number(),
  em: z.string(),
  operacao: z.object({ codigo: z.string(), descricao: z.string(), tipo: z.string(), sentido: z.string() }),
  setorOrigem: z.string().nullable(),
  setorDestino: z.string().nullable(),
  localDestino: z.string().nullable(),
  responsavel: z.string().nullable(),
  previsaoRetorno: z.string().nullable(),
  por: z.string().nullable(),
  excluido: z.boolean(),
});
const esquemaVolume = z.object({
  id: z.number(),
  numero: z.number(),
  matricula: z.string().nullable(),
  tipoDocumento: z.object({ id: z.number(), descricao: z.string() }),
  atendimento: z.number().nullable(),
  situacao: z.string(),
  noLocal: z.boolean(),
  local: z.object({ id: z.number(), caminho: z.string() }).nullable(),
  posicao: z.object({ linha: z.string().nullable(), coluna: z.string().nullable() }),
  ondeEsta: z.string(),
  previsaoRetorno: z.string().nullable(),
  retornoAtrasado: z.boolean(),
  extraviadoEm: z.string().nullable(),
  guardaDesde: z.string().nullable(),
  prazoGuardaAnos: z.number().nullable(),
  versao: z.number(),
  movimentos: z.array(esquemaMovimento),
});
export type VolumeTela = z.infer<typeof esquemaVolume>;

const qualquer = z.record(z.string(), z.unknown());

export const lerOperacoesGuarda = async () =>
  (await ler(`${G}/operacoes`, z.object({ itens: z.array(esquemaOperacao) }))).itens;
export const lerApoioGuarda = () => ler(`${G}/apoio`, esquemaApoio);
export const buscarGuarda = (o: { prontuario?: string; etiqueta?: string }) =>
  ler(`${G}/busca${qs(o)}`, z.object({ paciente: z.number(), volume: z.number().nullable() }));
export const lerVolumes = async (paciente: number) =>
  (await ler(`${G}/pacientes/${paciente}/volumes`, z.object({ itens: z.array(esquemaVolume) }))).itens;
export const incluirLocal = (corpo: unknown) =>
  enviar(`${G}/locais`, corpo, qualquer, novaChave('same-local'));
export const abrirVolume = (corpo: unknown) =>
  enviar(`${G}/volumes`, corpo, qualquer, novaChave('same-volume'));
export const movimentarVolume = (volume: number, corpo: unknown) =>
  enviar(`${G}/volumes/${volume}/movimentos`, corpo, qualquer, novaChave('same-mov'));
export const lerDeliberacoesDescarte = async () =>
  (
    await ler(
      `${G}/deliberacoes`,
      z.object({ itens: z.array(z.object({ id: z.number(), texto: z.string() })) }),
    )
  ).itens;
export const descartarVolume = (volume: number, corpo: unknown) =>
  enviar(`${G}/volumes/${volume}/descarte`, corpo, qualquer, novaChave('same-descarte'));
export const desfazerUltimo = (volume: number, corpo: unknown) =>
  enviar(`${G}/volumes/${volume}/desfazer`, corpo, qualquer, novaChave('same-desfazer'));
export const registrarExtravio = (volume: number, corpo: unknown) =>
  enviar(`${G}/volumes/${volume}/extravio`, corpo, qualquer, novaChave('same-extravio'));
