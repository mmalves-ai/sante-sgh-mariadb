// Cliente dos avisos clínicos na central de avisos (F3.5, 05-SADT linha 10): a retificação do resultado que a pessoa
// já tinha visto, o laudo retificado e os demais avisos clínicos chegam ao sino de quem os recebe; a ciência é do
// próprio destinatário. Sem o banco do cliente, a rota responde 503 e a seção some.
import { z } from 'zod';
import { enviar, ler } from '../../modulos/exames/api-exames.js';

const C = '/api/acesso/avisos-clinicos';

export const esquemaAvisoClinico = z.object({
  id: z.number().int(),
  aviso: z.number().int(),
  titulo: z.string(),
  mensagem: z.string(),
  gravidade: z.enum(['atencao', 'informacao']),
  modulo: z.string().nullable(),
  link: z.string().nullable(),
  estado: z.enum(['novo', 'lido', 'ciente']),
  geradoEm: z.string(),
});
export type AvisoClinico = z.infer<typeof esquemaAvisoClinico>;

export const esquemaCaixaAvisosClinicos = z.object({
  avisos: z.array(esquemaAvisoClinico),
  novos: z.number().int(),
});
export type CaixaAvisosClinicos = z.infer<typeof esquemaCaixaAvisosClinicos>;

export const lerAvisosClinicos = (): Promise<CaixaAvisosClinicos> => ler(C, esquemaCaixaAvisosClinicos);
export const darCienciaAvisoClinico = (id: number, chave: string) =>
  enviar(`${C}/${id}/ciente`, {}, z.object({ id: z.number().int(), gravou: z.boolean() }), chave);
