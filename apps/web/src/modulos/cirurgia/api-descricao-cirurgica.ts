// Cliente da descrição cirúrgica assinada e das intercorrências do ato (04-CC linha 96; F3.4):
//   GET  /api/cirurgia/realizadas/:ato/descricao        o ato, a equipe, as descrições, as intercorrências e os catálogos
//   POST /api/cirurgia/realizadas/:ato/descricao        salvar o rascunho, ou salvar e assinar (com a senha)
//   POST /api/cirurgia/descricoes/:id/adendos           adendo na assinada (com a senha)
//   POST /api/cirurgia/realizadas/:ato/intercorrencias  intercorrência (a grave abre a notificação de evento adverso)
//   GET  /api/cirurgia/pacientes/:paciente/descricoes   as descrições do paciente
// A senha segue só no corpo do pedido de assinar e de incluir adendo; a API a confere e nunca a grava.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia';

const descricao = z.object({
  id: z.number(),
  cirurgiao: z.number(),
  cirurgiaoNome: z.string(),
  situacao: z.string(),
  versao: z.number(),
  descricaoTecnica: z.string().nullable(),
  achadosTexto: z.string().nullable(),
  riscoCirurgico: z.string().nullable(),
  acidentes: z.string().nullable(),
  orteseProtese: z.string().nullable(),
  atoAnestesico: z.string().nullable(),
  sangramentoMl: z.number().nullable(),
  envioAnatomopatologico: z.boolean(),
  descricaoPecas: z.string().nullable(),
  assinadaEm: z.string().nullable(),
  assinatura: z.object({
    nivel: z.enum(['eletronica-avancada', 'icp-brasil']).nullable(),
    documento: z.number().nullable(),
    envelope: z.number().nullable(),
  }),
  achados: z.array(z.object({ achado: z.number(), rotulo: z.string(), complemento: z.string().nullable() })),
  adendos: z.array(
    z.object({
      sequencia: z.number(),
      texto: z.string(),
      motivo: z.string(),
      registradoEm: z.string().nullable(),
    }),
  ),
});
export type DescricaoCirurgica = z.infer<typeof descricao>;

export const esquemaTelaDescricao = z.object({
  ato: z.object({
    id: z.number(),
    numero: z.string(),
    paciente: z.number(),
    pacienteNome: z.string(),
    sala: z.string(),
    entrada: z.string().nullable(),
    saida: z.string().nullable(),
  }),
  eu: z.object({ profissional: z.number().nullable(), naEquipe: z.boolean(), descreve: z.boolean() }),
  equipe: z.array(
    z.object({ profissional: z.number(), nome: z.string(), funcao: z.string(), descreve: z.boolean() }),
  ),
  descricoes: z.array(descricao),
  intercorrencias: z.array(
    z.object({
      sequencia: z.number(),
      tipo: z.string(),
      ocorridoEm: z.string().nullable(),
      fase: z.string(),
      gravidade: z.string(),
      descricao: z.string().nullable(),
      conduta: z.string().nullable(),
      registradoPor: z.string(),
      notificacao: z.string().nullable().default(null),
    }),
  ),
  catalogos: z.object({
    achados: z.array(z.object({ id: z.number(), rotulo: z.string(), textoSugerido: z.string().nullable() })),
    tipos: z.array(
      z.object({
        id: z.number(),
        rotulo: z.string(),
        exigeConduta: z.boolean(),
        eventoAdverso: z.boolean(),
        gravidade: z.string().nullable(),
      }),
    ),
  }),
});
export type TelaDescricao = z.infer<typeof esquemaTelaDescricao>;

const resultado = z
  .object({
    ok: z.literal(true),
    resultado: z.record(z.string(), z.unknown()),
    repetida: z.boolean(),
    mensagem: z.string(),
  })
  .passthrough();
export type ResultadoDescricao = z.infer<typeof resultado>;

export interface EntradaDescricao {
  versao: number | null;
  assinar: boolean;
  senha?: string;
  descricaoTecnica: string | null;
  achadosTexto: string | null;
  riscoCirurgico: string | null;
  acidentes: string | null;
  orteseProtese: string | null;
  atoAnestesico: string | null;
  sangramentoMl: number | null;
  envioAnatomopatologico: boolean;
  descricaoPecas: string | null;
  achados: { achado: number; complemento: string | null }[];
}
export interface EntradaIntercorrencia {
  tipo: number;
  ocorridoEm: string;
  fase: string;
  gravidade: string;
  descricao: string | null;
  conduta: string | null;
}

export const lerTelaDescricao = (ato: number) =>
  ler(`${C}/realizadas/${ato}/descricao`, esquemaTelaDescricao);
export const salvarDescricao = (ato: number, corpo: EntradaDescricao) =>
  enviar(`${C}/realizadas/${ato}/descricao`, corpo, resultado, novaChave('descricao-cirurgica'));
export const incluirAdendoDescricao = (
  descricaoId: number,
  corpo: { texto: string; motivo: string; senha: string },
) => enviar(`${C}/descricoes/${descricaoId}/adendos`, corpo, resultado, novaChave('descricao-adendo'));
export const registrarIntercorrencia = (ato: number, corpo: EntradaIntercorrencia) =>
  enviar(`${C}/realizadas/${ato}/intercorrencias`, corpo, resultado, novaChave('intercorrencia'));
export const lerDescricoesDoPaciente = (paciente: number) =>
  ler(
    `${C}/pacientes/${paciente}/descricoes`,
    z.array(
      z.object({
        ato: z.number(),
        numero: z.string(),
        inicio: z.string().nullable(),
        cirurgiao: z.string(),
        situacao: z.string(),
        assinadaEm: z.string().nullable(),
        adendos: z.number(),
        intercorrencias: z.number(),
      }),
    ),
  );
