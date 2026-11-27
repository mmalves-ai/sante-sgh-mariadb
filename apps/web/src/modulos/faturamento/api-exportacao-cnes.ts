// Cliente das rotas da exportação dos profissionais ao cadastro nacional (C3-011, 02-CAD linha 29, item 3):
// /api/sus/estabelecimento/cnes/exportacoes.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/estabelecimento/cnes/exportacoes';

export const esquemaExportacoesCnes = z.array(
  z.object({
    id: z.number(),
    competencia: z.string(),
    numeroRemessa: z.number(),
    situacao: z.string(),
    exportadaEm: z.string().nullable(),
    arquivoId: z.number().nullable(),
    nomeArquivo: z.string().nullable(),
    observacao: z.string().nullable(),
  }),
);
export type ExportacaoCnesTela = z.infer<typeof esquemaExportacoesCnes>[number];

export const esquemaExportadoCnes = z.object({
  id: z.number(),
  arquivoId: z.number(),
  nomeArquivo: z.string(),
  exportados: z.number(),
  pendencias: z.array(z.object({ sequencia: z.number(), nome: z.string(), motivos: z.array(z.string()) })),
  leiaute: z.object({ versao: z.string(), aviso: z.string() }),
});
export type ExportadoCnes = z.infer<typeof esquemaExportadoCnes>;

const esquemaArquivo = z.object({ nomeArquivo: z.string(), conteudo: z.string() });

export const lerExportacoesCnes = () => ler(B, esquemaExportacoesCnes);
export const exportarProfissionaisCnes = (competencia: string) =>
  enviar(B, { competencia }, esquemaExportadoCnes, novaChave('sus-cnes-exportar'));
export const lerArquivoExportacaoCnes = (id: number) => ler(`${B}/${id}/arquivo`, esquemaArquivo);
