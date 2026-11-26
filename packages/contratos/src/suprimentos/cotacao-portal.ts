// Cotação por portal externo (05-SUP linha 19, C3-008): a importação das respostas do mapa de cotação devolvido pelo
// portal ou pelo fornecedor (primeiro adaptador: troca por arquivo). As regras de leitura moram em
// `regras/cotacao-arquivo.ts`; aqui ficam a entrada da operação e a resposta da importação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

export const OPERACAO_IMPORTAR_RESPOSTAS_COTACAO = 'suprimentos.importarRespostasCotacao';

/** O arquivo devolvido (CSV do mapa): o nome vira o código da troca no portal; o conteúdo vai inteiro, em texto. */
export const esquemaImportarRespostasCotacao = z
  .object({
    pedido: z.object({ ano: z.number().int().min(2000).max(2100), doc: idBanco }).strict(),
    arquivo: textoCp1252(60)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'Informe o nome do arquivo.')),
    conteudo: z.string().min(1, 'O arquivo está vazio.').max(1_000_000, 'O arquivo passa de 1 MB.'),
  })
  .strict();
export type ImportarRespostasCotacaoEntrada = z.infer<typeof esquemaImportarRespostasCotacao>;
