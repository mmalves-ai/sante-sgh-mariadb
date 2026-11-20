// Cliente das telas da nutrição, do mapa de dietas e do serviço social (M45, etapa 5), validado pelos contratos. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código
// da recusa (ex.: triagem-final-pendente, mapa-ja-fechado, sem-direito-legal) fica em `problema.codigo`.
import {
  esquemaAlteracaoHotLida,
  esquemaResultadoCorrecao,
  type ResultadoCorrecao,
  esquemaEtiquetasGeradas,
  esquemaFilaNutricao,
  esquemaFilaSocial,
  esquemaGravacaoNutricao,
  esquemaMapaDietas,
  esquemaOpcoesMapa,
  esquemaResultadoMapa,
  esquemaResultadoSocial,
  esquemaResultadoTerapia,
  esquemaResultadoTriagem,
  esquemaServicoSocialPaciente,
  esquemaTerapiaNutricional,
  esquemaTriagemNutricionalLida,
  type EtiquetasGeradas,
  type FilaNutricao,
  type FilaSocial,
  type GravacaoNutricao,
  type MapaDietas,
  type OpcoesMapa,
  type ResultadoMapa,
  type ResultadoSocial,
  type ResultadoTerapia,
  type ResultadoTriagem,
  type ServicoSocialPaciente,
  type TerapiaNutricional,
  type TriagemNutricionalLida,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const N = '/api/nutricao';
const S = '/api/servico-social';

let sequencia = 0;
export function novaChaveNutricao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m45n.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export type MapaComHash = MapaDietas & { hash: string };
const esquemaMapaComHash = esquemaMapaDietas.extend({ hash: z.string() });
const esquemaAcompanhantes = z.object({
  itens: z.array(
    z.object({
      id: z.number().int(),
      reg: z.number().int(),
      baseLegal: z.string(),
      refeicoes: z.array(z.number().int()),
      inicio: z.string(),
      fim: z.string().nullable(),
      observacao: z.string().nullable(),
      situacao: z.enum(['ativa', 'encerrada']),
      por: z.string(),
      em: z.string(),
      /** W0-05: a dieta do acompanhante e o histórico das alterações (o valor anterior). */
      dieta: z.string().nullable().default(null),
      historico: z.array(esquemaAlteracaoHotLida).default([]),
    }),
  ),
});
export type AcompanhantesDaInternacao = z.infer<typeof esquemaAcompanhantes>;

export const lerGravacaoNutricao = (): Promise<GravacaoNutricao> =>
  ler(`${N}/gravacao`, esquemaGravacaoNutricao);
export const lerGravacaoMapa = (): Promise<GravacaoNutricao> =>
  ler(`${N}/mapa/gravacao`, esquemaGravacaoNutricao);
export const lerFilaNutricao = (unidade: string | null = null): Promise<FilaNutricao> =>
  ler(`${N}/fila${qs({ unidade })}`, esquemaFilaNutricao);
export const lerTriagens = (reg: number): Promise<{ itens: TriagemNutricionalLida[] }> =>
  ler(`${N}/internacoes/${reg}/triagens`, z.object({ itens: z.array(esquemaTriagemNutricionalLida) }));
export const registrarTriagem = (corpo: unknown, chave: string): Promise<ResultadoTriagem> =>
  enviar(`${N}/triagens`, corpo, esquemaResultadoTriagem, chave);

export const lerTerapia = (reg: number): Promise<TerapiaNutricional> =>
  ler(`${N}/terapias/${reg}`, esquemaTerapiaNutricional);
export const registrarMeta = (corpo: unknown, chave: string): Promise<ResultadoTerapia> =>
  enviar(`${N}/terapias/metas`, corpo, esquemaResultadoTerapia, chave);
export const registrarAcompanhamento = (corpo: unknown, chave: string): Promise<ResultadoTerapia> =>
  enviar(`${N}/terapias/acompanhamentos`, corpo, esquemaResultadoTerapia, chave);

/** As unidades e as refeições com o corte da unidade escolhida (sem ela, o do estabelecimento). */
export const lerOpcoesMapa = (unidade?: string): Promise<OpcoesMapa> =>
  ler(`${N}/mapa/opcoes${unidade ? qs({ unidade }) : ''}`, esquemaOpcoesMapa);
export const lerMapa = (unidade: string, refeicao: number, data: string): Promise<MapaComHash> =>
  ler(`${N}/mapa${qs({ unidade, refeicao, data })}`, esquemaMapaComHash);
export const fecharMapa = (corpo: unknown, chave: string): Promise<ResultadoMapa> =>
  enviar(`${N}/mapa/fechar`, corpo, esquemaResultadoMapa, chave);
export const gerarEtiquetas = (corpo: unknown, chave: string): Promise<EtiquetasGeradas> =>
  enviar(`${N}/mapa/etiquetas`, corpo, esquemaEtiquetasGeradas, chave);
export const lerAcompanhantes = (reg: number): Promise<AcompanhantesDaInternacao> =>
  ler(`${N}/acompanhantes/${reg}`, esquemaAcompanhantes);
export const registrarAcompanhante = (corpo: unknown, chave: string): Promise<ResultadoMapa> =>
  enviar(`${N}/acompanhantes`, corpo, esquemaResultadoMapa, chave);
export const encerrarAcompanhante = (id: number, corpo: unknown, chave: string): Promise<ResultadoMapa> =>
  enviar(`${N}/acompanhantes/${id}/encerrar`, corpo, esquemaResultadoMapa, chave);

export const lerGravacaoSocial = (): Promise<GravacaoNutricao> =>
  ler(`${S}/gravacao`, esquemaGravacaoNutricao);
export const lerFilaSocial = (): Promise<FilaSocial> => ler(`${S}/fila`, esquemaFilaSocial);
export const lerServicoSocial = (reg: number): Promise<ServicoSocialPaciente> =>
  ler(`${S}/internacoes/${reg}`, esquemaServicoSocialPaciente);
export const registrarSocial = (corpo: unknown, chave: string): Promise<ResultadoSocial> =>
  enviar(`${S}/registros`, corpo, esquemaResultadoSocial, chave);

// ── W0-05: correção, estorno, versões e alteração (o motivo sempre no corpo) ────────────────────────

export const retificarTriagem = (id: number, corpo: unknown, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${N}/triagens/${id}/retificar`, corpo, esquemaResultadoCorrecao, chave);
export const estornarTriagem = (id: number, motivo: string, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${N}/triagens/${id}/estornar`, { motivo }, esquemaResultadoCorrecao, chave);
export const alterarMeta = (id: number, corpo: unknown, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${N}/terapias/metas/${id}/alterar`, corpo, esquemaResultadoCorrecao, chave);
export const encerrarMeta = (id: number, motivo: string, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${N}/terapias/metas/${id}/encerrar`, { motivo }, esquemaResultadoCorrecao, chave);
export const avaliarNpt = (id: number, corpo: unknown, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${N}/terapias/metas/${id}/avaliacao-npt`, corpo, esquemaResultadoCorrecao, chave);
export const retificarAcompanhamento = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoCorrecao> =>
  enviar(`${N}/terapias/acompanhamentos/${id}/retificar`, corpo, esquemaResultadoCorrecao, chave);
export const estornarAcompanhamento = (
  id: number,
  motivo: string,
  chave: string,
): Promise<ResultadoCorrecao> =>
  enviar(`${N}/terapias/acompanhamentos/${id}/estornar`, { motivo }, esquemaResultadoCorrecao, chave);
export const adendoSocial = (id: number, corpo: unknown, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${S}/registros/${id}/adendo`, corpo, esquemaResultadoCorrecao, chave);
export const estornarSocial = (id: number, motivo: string, chave: string): Promise<ResultadoCorrecao> =>
  enviar(`${S}/registros/${id}/estornar`, { motivo }, esquemaResultadoCorrecao, chave);
export const alterarAcompanhante = (id: number, corpo: unknown, chave: string): Promise<ResultadoMapa> =>
  enviar(`${N}/acompanhantes/${id}/alterar`, corpo, esquemaResultadoMapa, chave);
