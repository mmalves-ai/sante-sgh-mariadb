// Cliente da API do orçamento de exames particulares e da conversão em atendimento (F3.5, 05-SADT linha 26).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const S = '/api/sadt/orcamentos-exames';
const n = z.number();
const txt = z.string();

const esquemaPrevia = z.object({
  itens: z.array(
    z.object({
      exame: n,
      codigo: txt,
      nome: txt,
      quantidade: n,
      unitario: n,
      total: n,
      origemPreco: z.enum(['tabela', 'informado']),
      precoTabela: n.nullable(),
    }),
  ),
  bruto: n,
  desconto: n,
  total: n,
  validade: txt,
});
export type PreviaOrcamento = z.infer<typeof esquemaPrevia>;

const esquemaCriado = z.object({ id: n, numero: txt, total: n, validade: txt });
const esquemaAtendimentos = z.object({
  itens: z.array(z.object({ id: n, numero: txt, entradaEm: txt, situacao: txt, fonte: txt })),
});
const esquemaConvertido = z.object({
  id: n,
  atendimento: n,
  requisicoes: z.array(z.object({ requisicao: n, numero: txt })),
});

export interface CorpoOrcamento {
  paciente: number | null;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  fontePagadora: number;
  exames: { exame: number; quantidade: number; valor: number | null }[];
  desconto: number;
  validadeDias: number;
}

export const previaOrcamento = (c: CorpoOrcamento, chave: string) =>
  enviar(`${S}/previa`, c, esquemaPrevia, chave);
export const gravarOrcamento = (c: CorpoOrcamento, chave: string) => enviar(S, c, esquemaCriado, chave);
export const atendimentosDoOrcamento = (id: number) => ler(`${S}/${id}/atendimentos`, esquemaAtendimentos);
export const converterOrcamentoExames = (id: number, atendimento: number, chave: string) =>
  enviar(`${S}/${id}/converter`, { atendimento }, esquemaConvertido, chave);
