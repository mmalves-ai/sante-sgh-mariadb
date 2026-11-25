// Registro oncológico e radioterapia (09-AREA linha 69): o tumor, o estadiamento TNM e os planos de radioterapia do
// paciente pela internação; as gravações vão com o CSRF e a Idempotency-Key.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const E = '/api/especialidades/oncologia';
const item = z.object({ codigo: z.string(), descricao: z.string() });
export type ItemCatalogo = z.infer<typeof item>;
const esquemaRegistro = z.object({
  hoje: z.string(),
  tumores: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      cid: z.string(),
      cidDescricao: z.string(),
      topografia: z.string(),
      topografiaDescricao: z.string(),
      morfologia: z.string().nullable(),
      morfologiaDescricao: z.string().nullable(),
      lateralidade: z.string(),
      diagnosticadoEm: z.string(),
      baseDiagnostica: z.string(),
      ecog: z.number().nullable(),
      situacao: z.string(),
      estadiamentos: z.array(
        z.object({
          id: z.number(),
          tipo: z.string(),
          data: z.string(),
          tnm: z.string(),
          t: z.string(),
          n: z.string(),
          m: z.string(),
          estadio: z.string().nullable(),
          metastases: z.string().nullable(),
        }),
      ),
      metastases: z.array(
        z.object({
          sequencia: z.number(),
          topografia: z.string().nullable(),
          descricao: z.string().nullable(),
        }),
      ),
    }),
  ),
  planos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      numero: z.string(),
      tumor: z.number(),
      regiao: z.string(),
      aparelho: z.string().nullable(),
      intencao: z.string(),
      tecnica: z.string(),
      doseTotalCgy: z.number(),
      doseFracaoCgy: z.number(),
      fracoesPrevistas: z.number(),
      fracoesPorSemana: z.number().nullable(),
      situacao: z.string(),
      inicioPrevisto: z.string().nullable(),
      inicio: z.string().nullable(),
      fim: z.string().nullable(),
      fisico: z.boolean(),
      realizadas: z.number(),
      doseAcumuladaCgy: z.number(),
      motivoEncerramento: z.string().nullable(),
      sessoes: z.array(
        z.object({
          sequencia: z.number(),
          situacao: z.string(),
          realizadaEm: z.string().nullable(),
          doseAplicadaCgy: z.number().nullable(),
          motivo: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type RegistroOncologico = z.infer<typeof esquemaRegistro>;
export type TumorLido = RegistroOncologico['tumores'][number];
export type PlanoLido = RegistroOncologico['planos'][number];
const esquemaCadastros = z.object({
  intencoes: z.array(item.extend({ id: z.number().optional() })),
  regioes: z.array(item),
  aparelhos: z.array(item.extend({ modalidade: z.string() })),
  estadios: z.array(item),
  fisicos: z.array(item).default([]),
});
const esquemaGravado = z.object({
  ok: z.boolean(),
  id: z.number(),
  mensagem: z.string(),
  aviso: z.string().nullable().optional(),
  situacao: z.string().optional(),
  numero: z.string().optional(),
});

export const lerRegistroOncologico = (reg: number) =>
  ler(`${E}/internacoes/${reg}/registro`, esquemaRegistro);
export const lerCadastrosOncologia = () => ler(`${E}/registro/cadastros`, esquemaCadastros);
export const buscarCatalogoOnco = (catalogo: 'cid' | 'topografia' | 'morfologia', termo: string, cid = '') =>
  ler(
    `${E}/registro/busca?catalogo=${catalogo}&termo=${encodeURIComponent(termo)}&cid=${encodeURIComponent(cid)}`,
    z.object({ itens: z.array(item) }),
  ).then((r) => r.itens);
const gravar = (caminho: string, reg: number, corpo: unknown, chave: string) =>
  enviar(`${E}/registro/${caminho}?internacao=${reg}`, corpo, esquemaGravado, chave);
export const registrarTumor = (reg: number, corpo: unknown, chave: string) =>
  gravar('tumores', reg, corpo, chave);
export const estadiarTumor = (reg: number, corpo: unknown, chave: string) =>
  gravar('estadiamentos', reg, corpo, chave);
export const planejarRadioterapia = (reg: number, corpo: unknown, chave: string) =>
  gravar('planos', reg, corpo, chave);
export const aprovarPlanoRt = (reg: number, id: number, corpo: unknown, chave: string) =>
  gravar(`planos/${id}/aprovacao`, reg, corpo, chave);
export const encerrarPlanoRt = (reg: number, id: number, corpo: unknown, chave: string) =>
  gravar(`planos/${id}/encerramento`, reg, corpo, chave);
export const registrarSessaoRt = (reg: number, id: number, corpo: unknown, chave: string) =>
  gravar(`planos/${id}/sessoes`, reg, corpo, chave);
