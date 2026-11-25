// C2-100 (06-FAT linha 47): a regra de plantão do repasse — valor por plantão ou por hora, por profissional, escala,
// setor ou especialidade, com valor de fim de semana, de feriado (ou percentual), fator e hora extra. O mesmo Zod vale
// na tela e no servidor.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const idOuNulo = z.number().int().positive().nullable().default(null);
const valorOuNulo = z.number().min(0).max(1_000_000).nullable().default(null);
const percentualOuNulo = z.number().min(0).max(1_000).nullable().default(null);

export const esquemaRegraPlantao = z
  .object({
    descricao: textoCp1252(150).refine((s) => s.trim().length > 0, 'Dê um nome à regra.'),
    profissional: idOuNulo,
    escala: idOuNulo,
    setor: idOuNulo,
    especialidade: idOuNulo,
    diaSemana: z.number().int().min(1).max(7).nullable().default(null),
    forma: z.enum(['por_plantao', 'por_hora']),
    horasPlantao: z.number().positive().max(999).nullable().default(null),
    valorPadrao: z.number().positive().max(1_000_000),
    valorFimSemana: valorOuNulo,
    valorFeriado: valorOuNulo,
    percentualFeriado: percentualOuNulo,
    fator: z.number().positive().max(100).nullable().default(null),
    valorHoraExtraAntes: valorOuNulo,
    percentualHoraExtraAntes: percentualOuNulo,
    valorHoraExtraDepois: valorOuNulo,
    percentualHoraExtraDepois: percentualOuNulo,
    toleranciaMinutos: z.number().int().min(0).max(600).default(0),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict()
  .refine((r) => r.profissional !== null || r.escala !== null || r.setor !== null, {
    message: 'Escolha o profissional, a escala ou o setor que a regra alcança.',
    path: ['setor'],
  })
  .refine((r) => r.forma === 'por_hora' || r.horasPlantao !== null, {
    message: 'Informe as horas do plantão.',
    path: ['horasPlantao'],
  })
  .refine((r) => r.fim === null || r.fim >= r.inicio, {
    message: 'O fim da vigência vem antes do início.',
    path: ['fim'],
  });
export type RegraPlantaoEntrada = z.infer<typeof esquemaRegraPlantao>;

export const esquemaEncerrarRegraPlantao = z
  .object({ regra: z.number().int().positive(), fim: data })
  .strict();
export type EncerrarRegraPlantaoEntrada = z.infer<typeof esquemaEncerrarRegraPlantao>;

export type RegraPlantaoResposta = Omit<RegraPlantaoEntrada, never> & {
  readonly id: number;
  readonly setorNome: string | null;
};
export interface ListaRegrasPlantao {
  readonly itens: readonly RegraPlantaoResposta[];
}
