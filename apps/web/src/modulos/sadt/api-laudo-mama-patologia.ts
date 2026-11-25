// Cliente dos laudos estruturados de mamografia e de anatomia patológica (C2-071, 05-SADT linha 18): a fila por tipo,
// o exame aberto com o laudo, os achados ou as amostras e os laudos anteriores do paciente, as peças enviadas pela
// cirurgia e a ficha do SISCAN, em /api/sadt/laudos-especializados.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const P = '/api/sadt/laudos-especializados';
const txt = z.string().nullable();
const nr = z.number().nullable();
const opcao = z.object({ id: z.string(), rotulo: z.string() });
const profissional = z.object({ id: z.number(), rotulo: z.string() });
const q = (de: string, ate: string) => `de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;

const exame = z.object({
  item: z.number(),
  numero: z.string(),
  solicitadoEm: txt,
  urgente: z.boolean(),
  situacaoItem: z.string(),
  paciente: z.string(),
  pacienteId: z.number(),
  prontuario: txt,
  exame: z.string(),
  setor: z.string(),
});

const esquemaFila = z.object({
  de: z.string(),
  ate: z.string(),
  tipo: z.string(),
  exames: z.array(
    exame.extend({
      laudo: nr,
      situacao: z.string(),
      categoria: txt,
      resultado: txt,
      numeroLaudo: txt,
    }),
  ),
});
export type FilaLaudoEspecializado = z.infer<typeof esquemaFila>;
export type TipoLaudoEspecializado = 'mama' | 'anatomopatologico';

const achado = z.object({
  id: z.number(),
  sequencia: z.number(),
  lateralidade: z.string(),
  quadrante: txt,
  tipo: z.string(),
  categoria: txt,
  tamanhoMm: nr,
  posicaoHoraria: nr,
  distanciaMamiloMm: nr,
  forma: txt,
  contorno: txt,
  densidade: txt,
  morfologiaCalcificacao: txt,
  distribuicaoCalcificacao: txt,
  correlacaoUltrassom: z.boolean(),
  descricao: txt,
});
export type AchadoMamaLido = z.infer<typeof achado>;

const esquemaMama = z.object({
  exame,
  laudo: z
    .object({
      id: z.number(),
      versao: z.number(),
      situacao: z.string(),
      liberadoEm: txt,
      tipoMamografia: z.string(),
      noduloPalpavel: z.boolean(),
      historicoFamiliar: z.boolean(),
      mamografiaAnterior: z.boolean(),
      mamografiaAnteriorAno: nr,
      composicaoDireita: txt,
      composicaoEsquerda: txt,
      categoriaDireita: txt,
      categoriaEsquerda: txt,
      recomendacao: txt,
      intervaloControleMeses: nr,
      conclusao: txt,
      laudista: nr,
    })
    .nullable(),
  achados: z.array(achado),
  achadosCorrigidos: z.number(),
  anteriores: z.array(
    z.object({
      id: z.number(),
      liberadoEm: txt,
      categoriaDireita: txt,
      categoriaEsquerda: txt,
      recomendacao: txt,
    }),
  ),
  emExecucao: z.boolean(),
  alertas: z.array(z.string()),
  opcoes: z.object({
    profissionais: z.array(profissional),
    categorias: z.array(z.object({ categoria: z.string(), rotulo: z.string() })),
    tipos: z.array(opcao),
    composicoes: z.array(opcao),
    recomendacoes: z.array(opcao),
    quadrantes: z.array(opcao),
    tiposAchado: z.array(opcao),
    formas: z.array(opcao),
    contornos: z.array(opcao),
    densidades: z.array(opcao),
    distribuicoes: z.array(opcao),
  }),
});
export type ExameMama = z.infer<typeof esquemaMama>;

const amostra = z.object({
  id: z.number(),
  sequencia: z.number(),
  tipo: z.string(),
  identificacao: z.string(),
  descricao: txt,
  quantidadeFragmentos: nr,
  dimensoes: txt,
  fixador: txt,
  coloracao: txt,
});
const esquemaAp = z.object({
  exame,
  laudo: z
    .object({
      id: z.number(),
      versao: z.number(),
      numero: z.string(),
      situacao: z.string(),
      liberadoEm: txt,
      descricaoCirurgica: nr,
      tipoExame: z.string(),
      coletaEm: txt,
      recebidoEm: txt,
      dadosClinicos: txt,
      macroscopia: txt,
      microscopia: txt,
      diagnostico: txt,
      conclusao: txt,
      nota: txt,
      grauHistologico: nr,
      adequabilidade: txt,
      resultado: txt,
      patologista: nr,
      solicitante: nr,
      dados: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  amostras: z.array(amostra),
  anteriores: z.array(
    z.object({ id: z.number(), numero: z.string(), tipoExame: z.string(), resultado: txt, liberadoEm: txt }),
  ),
  emExecucao: z.boolean(),
  alertas: z.array(z.string()),
  opcoes: z.object({
    profissionais: z.array(profissional),
    graus: z.array(profissional),
    tiposExame: z.array(opcao),
    adequabilidades: z.array(opcao),
    resultados: z.array(opcao),
    tiposAmostra: z.array(opcao),
    margens: z.array(opcao),
    her2: z.array(opcao),
  }),
});
export type ExameAnatomopatologico = z.infer<typeof esquemaAp>;

const esquemaPecas = z.object({
  de: z.string(),
  ate: z.string(),
  pecas: z.array(
    z.object({
      descricao: z.number(),
      cirurgia: z.string(),
      realizadaEm: txt,
      paciente: z.string(),
      prontuario: txt,
      cirurgiao: z.string(),
      pecas: txt,
      pedidos: z.array(z.object({ item: z.number(), numero: z.string(), exame: z.string() })),
    }),
  ),
});
export type PecasEnviadas = z.infer<typeof esquemaPecas>;

const mamaSiscan = z.object({
  avaliada: z.boolean(),
  composicao: txt,
  categoria: txt,
  nodulos: z.number(),
  microcalcificacoes: z.number(),
  assimetrias: z.number(),
  distorcaoArquitetural: z.boolean(),
  linfonodoAxilar: z.boolean(),
});
const esquemaSiscan = z.object({
  de: z.string(),
  ate: z.string(),
  fichas: z.array(
    z.object({
      laudo: z.number(),
      paciente: z.string(),
      prontuario: txt,
      indicacao: z.string(),
      noduloPalpavel: z.boolean(),
      riscoElevadoHistoricoFamiliar: z.boolean(),
      mamografiaAnterior: z.boolean(),
      mamografiaAnteriorAno: nr,
      direita: mamaSiscan,
      esquerda: mamaSiscan,
      recomendacao: txt,
      intervaloControleMeses: nr,
      liberadoEm: txt,
    }),
  ),
});
export type FichasSiscan = z.infer<typeof esquemaSiscan>;

const gravado = z.object({ id: z.number(), versao: z.number() }).passthrough();
const liberado = z.object({ id: z.number(), versao: z.number(), alertas: z.array(z.string()) }).passthrough();
const recebido = z.object({ id: z.number(), numero: z.string(), item: z.number() }).passthrough();

export const lerFilaLaudoEspecializado = (tipo: TipoLaudoEspecializado, de: string, ate: string) =>
  ler(`${P}/fila?tipo=${tipo}&${q(de, ate)}`, esquemaFila);
export const abrirExameMama = (item: number) => ler(`${P}/mama/itens/${item}`, esquemaMama);
export const salvarLaudoMama = (item: number, corpo: Record<string, unknown>) =>
  enviar(`${P}/mama/itens/${item}`, corpo, gravado, novaChave('laudo-mama-salvar'));
export const liberarLaudoMama = (laudo: number, versao: number) =>
  enviar(`${P}/mama/laudos/${laudo}/liberar`, { versao }, liberado, novaChave('laudo-mama-liberar'));
export const abrirExameAnatomopatologico = (item: number) =>
  ler(`${P}/anatomopatologico/itens/${item}`, esquemaAp);
export const salvarLaudoAnatomopatologico = (item: number, corpo: Record<string, unknown>) =>
  enviar(`${P}/anatomopatologico/itens/${item}`, corpo, gravado, novaChave('laudo-ap-salvar'));
export const liberarLaudoAnatomopatologico = (laudo: number, versao: number) =>
  enviar(
    `${P}/anatomopatologico/laudos/${laudo}/liberar`,
    { versao },
    liberado,
    novaChave('laudo-ap-liberar'),
  );
export const lerPecasEnviadas = (de: string, ate: string) =>
  ler(`${P}/pecas-enviadas?${q(de, ate)}`, esquemaPecas);
export const receberPeca = (descricao: number, item: number) =>
  enviar(`${P}/pecas-enviadas/${descricao}/receber`, { item }, recebido, novaChave('laudo-ap-receber'));
export const lerFichasSiscan = (de: string, ate: string) =>
  ler(`${P}/siscan/mamografia?${q(de, ate)}`, esquemaSiscan);
