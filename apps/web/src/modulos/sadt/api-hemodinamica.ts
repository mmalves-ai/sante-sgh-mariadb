// Cliente do registro do exame de hemodinâmica (C2-027, 04-CC linha 107): a fila do setor por paciente, o exame
// aberto com o registro, os achados por vaso e as opções, e as gravações (iniciar, salvar, concluir, cancelar) em
// /api/sadt/hemodinamica.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const P = '/api/sadt/hemodinamica';
const txt = z.string().nullable();
const nr = z.number().nullable();

const esquemaFila = z.object({
  de: z.string(),
  ate: z.string(),
  exames: z.array(
    z.object({
      item: z.number(),
      numero: z.string(),
      solicitadoEm: txt,
      urgente: z.boolean(),
      situacaoItem: z.string(),
      paciente: z.string(),
      prontuario: txt,
      exame: z.string(),
      setor: z.string(),
      registro: nr,
      situacao: z.string(),
      inicioEm: txt,
      vasosComLesao: z.number(),
      alertas: z.array(z.string()),
    }),
  ),
});
export type FilaHemodinamica = z.infer<typeof esquemaFila>;

const achado = z.object({
  id: z.number(),
  sequencia: z.number(),
  vaso: z.string(),
  segmento: txt,
  tipo: z.string(),
  grauPercentual: nr,
  fluxoTimi: nr,
  calcificacao: txt,
  comprimentoMm: nr,
  bifurcacao: z.boolean(),
  conduta: txt,
  stentImplantado: z.boolean(),
  observacao: txt,
});
export type AchadoHemodinamicaLido = z.infer<typeof achado>;

const registro = z.object({
  id: z.number(),
  versao: z.number(),
  situacao: z.string(),
  inicioEm: txt,
  fimEm: txt,
  viaAcesso: z.string(),
  introdutorFrench: nr,
  anestesia: txt,
  contrasteNome: txt,
  contrasteVolumeMl: nr,
  heparinaUi: nr,
  tempoFluoroscopiaSegundos: nr,
  kermaReferenciaMgy: nr,
  produtoDoseAreaGycm2: nr,
  dominancia: txt,
  fracaoEjecao: nr,
  pressaoDiastolicaFinalVe: nr,
  hemostasia: txt,
  complicacoes: txt,
  conclusao: txt,
  condutaIndicada: txt,
  primeiroOperador: z.number(),
  segundoOperador: nr,
  anestesista: nr,
});
export type RegistroHemodinamicaLido = z.infer<typeof registro>;

const lista = z.array(z.object({ id: z.string(), rotulo: z.string() }));
const esquemaAberto = z.object({
  exame: z.object({
    item: z.number(),
    numero: z.string(),
    solicitadoEm: txt,
    urgente: z.boolean(),
    situacaoItem: z.string(),
    paciente: z.string(),
    prontuario: txt,
    exame: z.string(),
    setor: z.string(),
  }),
  registro: registro.nullable(),
  achados: z.array(achado),
  achadosCorrigidos: z.number(),
  alertas: z.array(z.string()),
  vasosComLesao: z.number(),
  opcoes: z.object({
    profissionais: z.array(z.object({ id: z.number(), rotulo: z.string() })),
    vias: lista,
    anestesias: lista,
    dominancias: lista,
    hemostasias: lista,
    condutas: lista,
    tiposAchado: lista,
    calcificacoes: lista,
    condutasAchado: lista,
  }),
});
export type ExameHemodinamica = z.infer<typeof esquemaAberto>;

const gravado = z.object({ id: z.number().nullable() }).passthrough();
const concluido = z.object({ id: z.number().nullable(), alertas: z.array(z.string()) }).passthrough();

export interface AchadoPedido {
  id?: number;
  vaso: string;
  segmento: string | null;
  tipo: string;
  grauPercentual: number | null;
  fluxoTimi: number | null;
  calcificacao: string | null;
  comprimentoMm: number | null;
  bifurcacao: boolean;
  conduta: string | null;
  stentImplantado: boolean;
  observacao: string | null;
}

export interface RegistroPedido {
  inicioEm: string;
  fimEm: string | null;
  viaAcesso: string;
  introdutorFrench: number | null;
  anestesia: string | null;
  contrasteNome: string | null;
  contrasteVolumeMl: number | null;
  heparinaUi: number | null;
  tempoFluoroscopiaSegundos: number | null;
  kermaReferenciaMgy: number | null;
  produtoDoseAreaGycm2: number | null;
  dominancia: string | null;
  fracaoEjecao: number | null;
  pressaoDiastolicaFinalVe: number | null;
  hemostasia: string | null;
  complicacoes: string | null;
  conclusao: string | null;
  condutaIndicada: string | null;
  primeiroOperador: number;
  segundoOperador: number | null;
  anestesista: number | null;
}

export const lerFilaHemodinamica = (de: string, ate: string) =>
  ler(`${P}/fila?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`, esquemaFila);

export const abrirExameHemodinamica = (item: number) => ler(`${P}/itens/${item}`, esquemaAberto);

export const iniciarRegistroHemodinamica = (item: number, r: RegistroPedido) =>
  enviar(`${P}/itens/${item}/iniciar`, r, gravado, novaChave('hemodinamica-iniciar'));

export const salvarRegistroHemodinamica = (
  registro: number,
  versao: number,
  r: RegistroPedido,
  achados: AchadoPedido[],
) =>
  enviar(`${P}/registros/${registro}`, { ...r, versao, achados }, gravado, novaChave('hemodinamica-salvar'));

export const concluirRegistroHemodinamica = (registro: number, versao: number) =>
  enviar(`${P}/registros/${registro}/concluir`, { versao }, concluido, novaChave('hemodinamica-concluir'));

export const cancelarRegistroHemodinamica = (registro: number, versao: number, motivo: string) =>
  enviar(
    `${P}/registros/${registro}/cancelar`,
    { versao, motivo },
    gravado,
    novaChave('hemodinamica-cancelar'),
  );
