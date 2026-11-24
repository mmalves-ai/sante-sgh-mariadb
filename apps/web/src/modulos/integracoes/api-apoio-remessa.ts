// Cliente da remessa ao laboratório de apoio, das etiquetas e do de-para (F3.5, 05-SADT linha 14): /api/sadt/apoio.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/sadt/apoio';

const pendente = z.object({
  amostra: z.number(),
  codigoBarras: z.string(),
  exameItem: z.number(),
  exameNome: z.string(),
  codigoExameApoio: z.string().nullable(),
  codigoMaterialApoio: z.string().nullable(),
});
export type PendenteApoio = z.infer<typeof pendente>;

const resumoRemessa = z.object({
  id: z.number(),
  numero: z.string(),
  laboratorio: z.number(),
  laboratorioNome: z.string(),
  situacao: z.string(),
  abertaEm: z.string().nullable(),
  enviadaEm: z.string().nullable(),
  protocolo: z.string().nullable(),
  quantidadeAmostras: z.number(),
});
export type ResumoRemessa = z.infer<typeof resumoRemessa>;

const remessa = resumoRemessa.extend({
  meio: z.string(),
  semDePara: z.number(),
  itens: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      amostra: z.number(),
      codigoBarras: z.string(),
      exameItem: z.number(),
      exameNome: z.string(),
      codigoExameApoio: z.string().nullable(),
      codigoMaterialApoio: z.string().nullable(),
      situacao: z.string(),
    }),
  ),
});
export type RemessaApoio = z.infer<typeof remessa>;

const dePara = z.object({
  analitos: z.array(
    z.object({
      id: z.number(),
      exame: z.number(),
      exameNome: z.string(),
      analito: z.number(),
      analitoNome: z.string(),
      codigoExameApoio: z.string(),
      codigoAnalitoApoio: z.string(),
      nomeApoio: z.string().nullable(),
      fatorConversao: z.number(),
      ativo: z.boolean(),
    }),
  ),
  materiais: z.array(
    z.object({
      id: z.number(),
      material: z.number(),
      materialNome: z.string(),
      codigoApoio: z.string(),
      nomeApoio: z.string().nullable(),
      ativo: z.boolean(),
    }),
  ),
});
export type DeParaApoio = z.infer<typeof dePara>;

export const lerPendentesApoio = (lab: number) =>
  ler(`${A}/${lab}/pendentes`, z.object({ itens: z.array(pendente) })).then((r) => r.itens);
export const lerRemessasApoio = (lab: number) =>
  ler(`${A}/remessas?laboratorio=${lab}`, z.object({ itens: z.array(resumoRemessa) })).then((r) => r.itens);
export const lerRemessaApoio = (id: number) => ler(`${A}/remessas/${id}`, remessa);
export const lerEtiquetasApoio = (id: number) =>
  ler(
    `${A}/remessas/${id}/etiquetas`,
    z.object({
      itens: z.array(z.object({ item: z.number(), codigo: z.string(), linhas: z.array(z.string()) })),
    }),
  ).then((r) => r.itens);
export const abrirRemessaApoio = (laboratorio: number) =>
  enviar(
    `${A}/remessas`,
    { laboratorio },
    z.object({ id: z.number(), numero: z.string(), itens: z.number(), semDePara: z.number() }),
    novaChave('remessa-apoio'),
  );
export const agirRemessaApoio = (
  id: number,
  corpo: {
    acao: 'fechar' | 'reabrir' | 'enviar' | 'cancelar';
    meio?: 'integracao' | 'portal' | 'manual';
    protocolo?: string | null;
    motivo?: string | null;
  },
) =>
  enviar(
    `${A}/remessas/${id}/acao`,
    corpo,
    z.object({ id: z.number(), situacao: z.string() }),
    novaChave('remessa-apoio-acao'),
  );
export const retirarItemRemessaApoio = (id: number, item: number) =>
  enviar(
    `${A}/remessas/${id}/retirar`,
    { item },
    z.object({ id: z.number(), itens: z.number() }),
    novaChave('remessa-apoio-retirar'),
  );
export const lerDeParaApoio = (lab: number) => ler(`${A}/${lab}/de-para`, dePara);
export const salvarDeParaAnalitoApoio = (corpo: Record<string, unknown>) =>
  enviar(`${A}/de-para/analito`, corpo, z.object({ id: z.number() }), novaChave('de-para-analito'));
export const salvarDeParaMaterialApoio = (corpo: Record<string, unknown>) =>
  enviar(`${A}/de-para/material`, corpo, z.object({ id: z.number() }), novaChave('de-para-material'));
