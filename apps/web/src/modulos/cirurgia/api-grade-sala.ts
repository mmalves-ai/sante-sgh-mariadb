// Cliente da grade de funcionamento da sala cirúrgica (04-CC linha 92; F3.4): as faixas da sala (ativas e inativas,
// para o histórico), gravar uma faixa (incluir ou alterar com a versão), inativar (a faixa nunca é apagada) e a grade
// aberta de cada sala por dia, que o mapa cirúrgico pinta sob os blocos.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { novaChave } from '../exames/api-exames.js';

const P = '/api/cirurgia';

export const esquemaFaixaGrade = z.object({
  id: z.number(),
  diaSemana: z.number().int().min(1).max(7),
  inicio: z.string(),
  fim: z.string(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  valeFeriado: z.boolean(),
  especialidade: z.number().nullable(),
  profissional: z.number().nullable(),
  ativo: z.boolean(),
  versao: z.number(),
});
export type FaixaGrade = z.infer<typeof esquemaFaixaGrade>;

export const esquemaGradeDaSala = z.object({ sala: z.number(), faixas: z.array(esquemaFaixaGrade) });
export type GradeDaSala = z.infer<typeof esquemaGradeDaSala>;

const esquemaFaixaAberta = z.object({
  inicio: z.string(),
  fim: z.string(),
  especialidade: z.number().nullable(),
  profissional: z.number().nullable(),
});
export const esquemaGradeAberta = z.object({
  dias: z.array(
    z.object({
      dia: z.string(),
      feriado: z.boolean(),
      salas: z.array(z.object({ sala: z.number(), faixas: z.array(esquemaFaixaAberta) })),
    }),
  ),
});
export type GradeAberta = z.infer<typeof esquemaGradeAberta>;

const esquemaGravacao = z.object({
  ok: z.literal(true),
  resultado: z.object({ faixa: z.number() }).passthrough(),
  repetida: z.boolean(),
});

export interface EntradaFaixaGrade {
  readonly faixa?: number;
  readonly versao?: number;
  readonly diaSemana: number;
  readonly inicio: string;
  readonly fim: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly valeFeriado: boolean;
  readonly especialidade: number | null;
  readonly profissional: number | null;
}

export const lerGradeDaSala = (sala: number): Promise<GradeDaSala> =>
  ler(`${P}/salas/${sala}/grade`, esquemaGradeDaSala);
export const gravarFaixaGrade = (sala: number, e: EntradaFaixaGrade, chave: string) =>
  enviar(`${P}/salas/${sala}/grade`, e, esquemaGravacao, chave);
export const inativarFaixaGrade = (faixa: number, versao: number, chave: string) =>
  enviar(`${P}/grade-sala/${faixa}/inativar`, { versao }, esquemaGravacao, chave);
export const lerGradeAberta = (inicio: string, dias: number): Promise<GradeAberta> =>
  ler(`${P}/grade-sala/aberta${qs({ inicio, dias })}`, esquemaGradeAberta);
