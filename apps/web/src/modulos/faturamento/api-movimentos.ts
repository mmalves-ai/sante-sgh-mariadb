// Cliente dos movimentos da conta (F3.7, 06-FAT linhas 14, 15 e 16): equipe do item, kit de cobrança e transferência
// de itens entre contas. As regras vêm de @sgh/dominio-faturamento (a mesma da API), para a validação aparecer
// enquanto se escolhe; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const participante = z.object({
  sequencia: z.number(),
  profissionalId: z.number(),
  nome: z.string(),
  funcaoId: z.number(),
  grauId: z.number().nullable(),
  percentual: z.number().nullable(),
  formaPagamento: z.string(),
  valorAto: z.number(),
});
const item = z.object({
  id: z.number(),
  sequencia: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  quantidade: z.number(),
  valorTotal: z.number(),
  honorario: z.number(),
  situacao: z.string(),
  kitId: z.number().nullable(),
  equipe: z.array(participante),
});
export type ItemConta = z.infer<typeof item>;
const esquemaMovimentos = z.object({
  contaId: z.number(),
  numero: z.string(),
  situacao: z.string(),
  editavel: z.boolean(),
  fontePagadoraId: z.number(),
  fonte: z.string(),
  itens: z.array(item),
  funcoes: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      tipo: z.string(),
      ativo: z.boolean(),
      percentual: z.number().nullable(),
      grau: z.number().nullable(),
      ordemAuxiliar: z.number().nullable(),
      ordemApresentacao: z.number().nullable(),
    }),
  ),
  graus: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })),
  kits: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), modo: z.string() })),
  profissionais: z.array(z.object({ id: z.number(), nome: z.string() })),
  destinos: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      situacao: z.string(),
      fonte: z.string(),
      outroEstabelecimento: z.boolean(),
      aberta: z.boolean(),
    }),
  ),
  transferencias: z.array(
    z.object({
      id: z.number(),
      numero: z.number(),
      tipo: z.string(),
      saiu: z.boolean(),
      outraConta: z.number(),
      motivo: z.string(),
      em: z.string(),
      valorOrigem: z.number(),
      valorDestino: z.number(),
      situacao: z.string(),
      itens: z.number(),
    }),
  ),
});
export type MovimentosConta = z.infer<typeof esquemaMovimentos>;

export const lerMovimentos = (conta: number) => ler(`${F}/contas/${conta}/movimentos`, esquemaMovimentos);

export interface ParticipantePedido {
  profissionalId: number;
  funcaoId: number;
  grauId?: number | null;
  percentual?: number | null;
  formaPagamento?: string;
}
const esquemaProfissionais = z.array(z.object({ id: z.number(), nome: z.string(), inscricao: z.string() }));
/** Profissionais por nome ou número da inscrição no conselho (ao menos 3 letras). */
export const buscarProfissionais = (termo: string) =>
  ler(`${F}/profissionais-equipe?termo=${encodeURIComponent(termo)}`, esquemaProfissionais);
export const gravarEquipe = (item: number, participantes: ParticipantePedido[], chave: string) =>
  enviar(`${F}/itens/${item}/equipe`, { participantes }, qualquer, chave);
export const lancarKit = (conta: number, kitId: number, vezes: number, chave: string) =>
  enviar(`${F}/contas/${conta}/kits`, { kitId, vezes }, qualquer, chave);
export const transferirItens = (
  conta: number,
  corpo: { contaDestinoId: number; itens: number[]; motivo: string },
  chave: string,
) => enviar(`${F}/contas/${conta}/transferencias`, corpo, qualquer, chave);

const esquemaItensCobranca = z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() }));
/** Itens cobráveis por código ou parte da descrição (ao menos 2 letras), para o cadastro do kit. */
export const buscarItensCobranca = (termo: string) =>
  ler(`${F}/itens-cobranca?termo=${encodeURIComponent(termo)}`, esquemaItensCobranca);
export interface KitPedido {
  codigo: string;
  descricao: string;
  tipoKit: 'procedimento' | 'sala' | 'cota' | 'outro';
  modo: 'aberto' | 'fechado';
  itemId: number | null;
  fontePagadoraId: number | null;
  planoId: number | null;
  todosEstabelecimentos: boolean;
  componentes: { itemId: number; quantidade: number; inclusoNoPacote: boolean }[];
}
export const cadastrarKit = (corpo: KitPedido, chave: string) => enviar(`${F}/kits`, corpo, qualquer, chave);
