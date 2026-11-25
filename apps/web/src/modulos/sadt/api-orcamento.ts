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
  itens: z.array(
    z.object({
      id: n,
      paciente: n,
      pacienteNome: txt,
      numero: txt,
      entradaEm: txt,
      situacao: txt,
      fonte: txt,
    }),
  ),
});
export type AtendimentoConversao = z.infer<typeof esquemaAtendimentos>['itens'][number];
const esquemaConvertido = z.object({
  id: n,
  atendimento: n,
  conta: n,
  requisicoes: z.array(z.object({ requisicao: n, numero: txt })),
});
const esquemaApoio = z.object({
  exames: z.array(z.object({ id: n, codigo: txt, nome: txt, tipo: txt })),
  fontes: z.array(z.object({ id: n, nome: txt })),
});
const esquemaAvaliacao = z.object({
  paciente: z.object({ id: n, nome: txt }),
  confirmarPaciente: z.boolean(),
  restricoes: z.array(z.object({ exame: n, tipo: txt, mensagem: txt, permiteExcecao: z.boolean() })),
  segue: z.boolean(),
  codigo: txt.nullable(),
  motivo: txt.nullable(),
});
export type AvaliacaoConversao = z.infer<typeof esquemaAvaliacao>;

export interface CorpoConversao {
  atendimento: number;
  confirmaPaciente: number | null;
  confirmado: boolean;
  justificativa: string | null;
}

export interface CorpoOrcamento {
  paciente: number | null;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  fontePagadora: number;
  exames: { exame: number; quantidade: number; valor: number | null }[];
  desconto: number;
  /** Sem o campo, vale a validade padrão do estabelecimento (parâmetro). */
  validadeDias?: number;
}

export const previaOrcamento = (c: CorpoOrcamento, chave: string) =>
  enviar(`${S}/previa`, c, esquemaPrevia, chave);
export const gravarOrcamento = (c: CorpoOrcamento, chave: string) => enviar(S, c, esquemaCriado, chave);
export const lerApoioOrcamento = () => ler(`${S}/apoio`, esquemaApoio);
export const atendimentosDoOrcamento = (id: number, paciente: number | null = null) =>
  ler(`${S}/${id}/atendimentos${paciente ? `?paciente=${paciente}` : ''}`, esquemaAtendimentos);
export const avaliarConversao = (id: number, c: CorpoConversao, chave: string) =>
  enviar(`${S}/${id}/avaliar`, c, esquemaAvaliacao, chave);
export const converterOrcamentoExames = (id: number, c: CorpoConversao, chave: string) =>
  enviar(`${S}/${id}/converter`, c, esquemaConvertido, chave);
