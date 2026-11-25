// Cliente das rotas dos leitos de UTI habilitados pelo SUS (F7, 06-SUS linha 59): /api/sus/leitos-uti.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/leitos-uti';
const comId = z.object({ id: z.number() }).passthrough();

export const esquemaLeitoUti = z.object({
  id: z.number(),
  tipo: z.number(),
  tipoCodigo: z.string(),
  tipoDescricao: z.string(),
  classe: z.string().nullable(),
  nivel: z.number().nullable(),
  unidade: z.number().nullable(),
  unidadeDescricao: z.string().nullable(),
  quantidadeLeitos: z.number(),
  liberaCritica: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
  vigente: z.boolean(),
  versao: z.number(),
});
export type LeitoUti = z.infer<typeof esquemaLeitoUti>;

const opcao = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });

export const lerLeitosUti = () => ler(B, z.object({ itens: z.array(esquemaLeitoUti) }));
export const lerOpcoesLeitosUti = () =>
  ler(`${B}/opcoes`, z.object({ tipos: z.array(opcao), unidades: z.array(opcao) }));
export const incluirLeitoUti = (corpo: {
  tipo: number;
  unidade: number | null;
  quantidadeLeitos: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  liberaCritica: boolean;
}) =>
  enviar(
    B,
    corpo,
    z.object({ id: z.number(), encerrada: z.number().nullable() }).passthrough(),
    novaChave('sus-leito-uti'),
  );
export const alterarVigenciaLeitoUti = (
  id: number,
  corpo: { vigenciaInicio: string; vigenciaFim: string | null; liberaCritica: boolean; versao: number },
) => enviar(`${B}/${id}/vigencia`, corpo, comId, novaChave('sus-leito-uti-vigencia'));
export const inativarLeitoUti = (id: number, versao: number) =>
  enviar(`${B}/${id}/inativar`, { versao }, comId, novaChave('sus-leito-uti-inativar'));
