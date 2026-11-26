// Cliente da API da redação do laudo e do laudo estruturado (F3.5, 05-SADT linhas 16 e 17).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const S = '/api/sadt/laudos';
const n = z.number();
const txt = z.string();

const esquemaValor = z.object({
  grandeza: n,
  sequencia: n,
  numero: n.nullable(),
  texto: txt.nullable(),
  foraReferencia: z.boolean(),
  faixa: z.object({ minima: n.nullable(), maxima: n.nullable(), indexada: z.boolean() }).nullable(),
});
export const esquemaLaudoEmRedacao = z.object({
  exame: z.object({ item: n, exame: n, nome: txt, setor: n, tipoSetor: txt }),
  paciente: z.object({
    id: n,
    sexo: z.enum(['feminino', 'masculino']).nullable(),
    idadeDias: n.nullable(),
    dataExame: txt,
    nome: txt.default(''),
    prontuario: txt.default(''),
  }),
  /** As palavras-chave vigentes do laudo e as do cadastro ativo. */
  palavrasChave: z.array(n).default([]),
  palavras: z.array(z.object({ id: n, codigo: txt, descricao: txt })).default([]),
  /** Os laudos assinados anteriores do mesmo exame do paciente. */
  anteriores: z
    .array(
      z.object({
        item: n,
        assinadoEm: txt.nullable(),
        resultado: txt.nullable(),
        achadoCritico: z.boolean(),
        texto: txt,
      }),
    )
    .default([]),
  laudo: z
    .object({
      id: n,
      situacao: txt,
      titulo: txt.nullable(),
      texto: txt,
      resultado: txt.nullable(),
      achadoCritico: z.boolean(),
      achadoCriticoDescricao: txt.nullable(),
      modelo: n.nullable(),
      versaoAtual: n,
      pesoKg: n.nullable(),
      alturaCm: n.nullable(),
      superficieCorporal: n.nullable(),
    })
    .nullable(),
  versoes: z.array(
    z.object({
      numero: n,
      situacao: txt,
      em: txt,
      motivo: txt.nullable(),
      hash: txt.nullable(),
      // C3-005: o documento do prontuário da versão e onde está a assinatura com certificado ICP-Brasil.
      documento: n.nullable().default(null),
      assinaturaIcp: z.enum(['sem-documento', 'nao-exigida', 'na-fila', 'assinada']).default('sem-documento'),
    }),
  ),
  secoes: z.array(z.object({ id: n, nome: txt, ordem: n })),
  grandezas: z.array(
    z.object({
      id: n,
      codigo: txt,
      sigla: txt,
      descricao: txt,
      casasDecimais: n.nullable(),
      obrigatoria: z.boolean(),
      calculada: z.boolean().default(false),
      secao: n.nullable(),
    }),
  ),
  /** Todas as faixas do exame: a tela escolhe a do paciente na hora, pela mesma regra do domínio. */
  faixas: z.array(
    z.object({
      grandeza: n,
      sexo: z.enum(['feminino', 'masculino']).nullable(),
      idadeMinimaDias: n.nullable(),
      idadeMaximaDias: n.nullable(),
      pesoMinimoKg: n.nullable(),
      pesoMaximoKg: n.nullable(),
      superficieMinima: n.nullable(),
      superficieMaxima: n.nullable(),
      minima: n.nullable(),
      maxima: n.nullable(),
      indexadaSuperficie: z.boolean(),
      vigenciaInicio: txt,
      vigenciaFim: txt.nullable(),
    }),
  ),
  /** As fórmulas das medidas calculadas: a tela faz a conta na hora pela mesma regra do domínio. */
  formulas: z
    .array(
      z.object({
        grandeza: n,
        expressao: txt,
        casas: n.nullable(),
        vigenciaInicio: txt,
        vigenciaFim: txt.nullable(),
        variaveis: z.array(
          z.object({
            identificador: txt,
            fonte: z.enum(['grandeza', 'dado_paciente']),
            grandeza: n.nullable(),
            dadoPaciente: txt.nullable(),
          }),
        ),
      }),
    )
    .default([]),
  valores: z.array(esquemaValor),
  modelos: z.array(
    z.object({ id: n, nome: txt, tipo: txt, atalho: txt.nullable(), texto: txt, campos: z.array(txt) }),
  ),
  pode: z.object({ salvar: z.boolean(), assinar: z.boolean(), retificar: z.boolean() }),
});
export type LaudoEmRedacao = z.infer<typeof esquemaLaudoEmRedacao>;

const esquemaGravado = z.object({
  id: n,
  situacao: txt,
  versaoAtual: n,
  valores: n,
  foraReferencia: n,
  exameLiberado: z.boolean().optional(),
  avisoCritico: z.enum(['abrir', 'cancelar', 'nada']).optional(),
  avisados: n.optional(),
  emissoesSuperadas: n.optional(),
});
export type LaudoGravado = z.infer<typeof esquemaGravado>;

export interface CorpoLaudo {
  modelo: number | null;
  titulo: string | null;
  texto: string;
  resultado: 'normal' | 'alterado' | 'inconclusivo' | null;
  achadoCritico: boolean;
  achadoCriticoDescricao: string | null;
  pesoKg: number | null;
  alturaCm: number | null;
  valores: { grandeza: number; numero: number | null; texto: string | null }[];
  /** Ids do cadastro; sem o campo, as palavras gravadas ficam como estão. */
  palavrasChave?: number[] | null;
}

export const abrirLaudo = (item: number) => ler(`${S}/redacao/${item}`, esquemaLaudoEmRedacao);
export const lerMotivosRetificacao = () =>
  ler(
    `${S}/motivos-retificacao`,
    z.object({ itens: z.array(z.object({ id: n, codigo: txt, descricao: txt })) }),
  );
export const salvarLaudo = (item: number, corpo: CorpoLaudo & { revisao: boolean }, chave: string) =>
  enviar(`${S}/redacao/${item}`, corpo, esquemaGravado, chave);
export const assinarLaudo = (item: number, corpo: CorpoLaudo, chave: string) =>
  enviar(`${S}/redacao/${item}/assinar`, corpo, esquemaGravado, chave);
export const retificarLaudo = (
  item: number,
  corpo: CorpoLaudo & { motivo: number | null; motivoTexto: string | null },
  chave: string,
) => enviar(`${S}/redacao/${item}/retificar`, corpo, esquemaGravado, chave);
export const previaDoModelo = (
  item: number,
  corpo: { modelo: number; pesoKg: number | null; alturaCm: number | null; valores: CorpoLaudo['valores'] },
  chave: string,
) => enviar(`${S}/redacao/${item}/previa`, corpo, z.object({ texto: txt, faltam: z.array(txt) }), chave);

// ── Lista de trabalho, versões, busca de casos e manutenção dos modelos (05-SADT linha 16) ──────────────────────

const esquemaFila = z.object({
  itens: z.array(
    z.object({
      item: n,
      exame: txt,
      setor: n,
      setorNome: txt,
      paciente: txt,
      prontuario: txt,
      realizadoEm: txt.nullable(),
      laudo: txt.nullable(),
    }),
  ),
  setores: z.array(z.object({ id: n, nome: txt })),
});
export type FilaDeLaudos = z.infer<typeof esquemaFila>;
export const lerFilaDeLaudos = (setor: number | null) =>
  ler(`${S}/fila${setor ? `?setor=${setor}` : ''}`, esquemaFila);

const esquemaVersao = z.object({
  numero: n,
  situacao: txt,
  em: txt,
  titulo: txt.nullable(),
  texto: txt,
  motivo: txt.nullable(),
  laudista: txt,
  resultado: txt.nullable(),
  achadoCritico: z.boolean(),
});
export type VersaoDoLaudo = z.infer<typeof esquemaVersao>;
export const lerVersaoDoLaudo = (item: number, numero: number) =>
  ler(`${S}/redacao/${item}/versoes/${numero}`, esquemaVersao);

const esquemaPalavras = z.object({ itens: z.array(z.object({ id: n, codigo: txt, descricao: txt })) });
export const lerPalavrasChave = () => ler(`${S}/palavras-chave`, esquemaPalavras);
const esquemaBusca = z.object({
  itens: z.array(
    z.object({
      item: n,
      exame: txt,
      paciente: txt,
      prontuario: txt,
      assinadoEm: txt.nullable(),
      resultado: txt.nullable(),
    }),
  ),
});
export type CasoAchado = z.infer<typeof esquemaBusca>['itens'][number];
export const buscarLaudosPorPalavras = (palavras: readonly number[]) =>
  ler(`${S}/busca?palavras=${palavras.join(',')}`, esquemaBusca);

const esquemaModelos = z.object({
  itens: z.array(
    z.object({
      id: n,
      codigo: txt,
      nome: txt,
      tipo: txt,
      atalho: txt.nullable(),
      texto: txt,
      ativo: z.boolean(),
      exame: n.nullable(),
      exameNome: txt.nullable(),
      setor: n.nullable(),
      setorNome: txt.nullable(),
      pessoal: z.boolean(),
    }),
  ),
  exames: z.array(z.object({ id: n, nome: txt })),
  setores: z.array(z.object({ id: n, nome: txt })),
  temProfissional: z.boolean(),
});
export type ModelosDeLaudo = z.infer<typeof esquemaModelos>;
export type ModeloDeLaudo = ModelosDeLaudo['itens'][number];
export const lerModelosDeLaudo = () => ler(`${S}/modelos`, esquemaModelos);
export interface CorpoModelo {
  id: number | null;
  codigo: string;
  nome: string;
  exame: number | null;
  setor: number | null;
  pessoal: boolean;
  tipo: 'texto' | 'normal' | 'alterado' | 'conclusao' | 'frase';
  atalho: string | null;
  texto: string;
  ativo: boolean;
}
export const salvarModeloDeLaudo = (corpo: CorpoModelo, chave: string) =>
  enviar(`${S}/modelos`, corpo, z.object({ id: n, campos: z.array(txt) }), chave);
