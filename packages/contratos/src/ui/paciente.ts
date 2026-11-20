// Contexto do paciente exibido no cabeçalho fixo (cap-03 §3.4; regra 11 do M07). Os dados chegam no M15;
// aqui fica a forma. Mascaramento é do servidor: a tela mostra o que a API manda e nunca desmascara.
import { z } from 'zod';

export const esquemaAlergias = z.discriminatedUnion('situacao', [
  z.object({ situacao: z.literal('nao-avaliadas') }),
  z.object({ situacao: z.literal('nega') }),
  z.object({ situacao: z.literal('lista'), itens: z.array(z.string().min(1)).min(1) }),
]);
export type Alergias = z.infer<typeof esquemaAlergias>;

export const esquemaContextoPaciente = z.object({
  identificacao: z.object({
    nomeSocial: z.string().min(1).nullable(),
    nomeCivil: z.string().min(1),
    /** AAAA-MM-DD (segundo identificador junto com o nome). */
    nascimento: z.iso.date(),
    idade: z.string().min(1),
    sexo: z.string().min(1),
    prontuario: z.string().min(1),
  }),
  localizacao: z.object({
    estabelecimento: z.string().min(1),
    unidade: z.string().nullable(),
    leito: z.string().nullable(),
    diasInternacao: z.number().int().min(0).nullable(),
    altaProvavel: z.iso.date().nullable(),
  }),
  atendimento: z.object({
    tipo: z.string().min(1),
    numero: z.string().min(1),
    convenio: z.string().nullable(),
    medicoResponsavel: z.string().nullable(),
  }),
  alergias: esquemaAlergias,
  alertas: z.array(z.object({ id: z.string().min(1), texto: z.string().min(1) })),
  homonimoNaUnidade: z.boolean(),
  medidas: z.object({
    peso: z.object({ valor: z.string().min(1), data: z.iso.date() }).nullable(),
    altura: z.object({ valor: z.string().min(1), data: z.iso.date() }).nullable(),
  }),
});
export type ContextoPaciente = z.infer<typeof esquemaContextoPaciente>;
