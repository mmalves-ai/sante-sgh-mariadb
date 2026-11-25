// Cliente das rotas do chamado de ambulância e do maqueiro (C2-068, 04-INT linha 83): /api/internacao/ambulancias e
// /api/internacao/maqueiros/transportes.
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const A = '/api/internacao/ambulancias';
const M = '/api/internacao/maqueiros/transportes';

const opcao = z.object({ id: z.number(), nome: z.string() });
export const esquemaOpcoesAmbulancia = z.object({
  categorias: z.array(opcao.extend({ classificacao: z.string().nullable() })),
  ambulancias: z.array(opcao.extend({ categoria: z.number(), quilometragem: z.number().nullable() })),
  rotas: z.array(opcao),
  destinos: z.array(opcao),
  motivosCancelamento: z.array(opcao),
  motivosAtraso: z.array(opcao),
  profissionais: z.array(opcao.extend({ funcao: z.string(), tipo: z.string() })),
  funcoes: z.array(z.string()),
});
export type OpcoesAmbulancia = z.infer<typeof esquemaOpcoesAmbulancia>;

export const esquemaChamado = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  paciente: z.number(),
  pacienteNome: z.string().nullable(),
  atendimento: z.number().nullable(),
  categoria: z.number(),
  categoriaNome: z.string().nullable(),
  ambulancia: z.number().nullable(),
  ambulanciaPlaca: z.string().nullable(),
  rota: z.number().nullable(),
  rotaNome: z.string().nullable(),
  destino: z.string().nullable(),
  posicao: z.string().nullable(),
  solicitado: z.string(),
  previsto: z.string().nullable(),
  saida: z.string().nullable(),
  fim: z.string().nullable(),
  kmInicial: z.number().nullable(),
  kmFinal: z.number().nullable(),
  kmRodados: z.number().nullable(),
  itemConta: z.number().nullable(),
  motivoReprovacao: z.string().nullable(),
  equipe: z.array(z.object({ profissional: z.number(), nome: z.string().nullable(), funcao: z.string() })),
});
export type Chamado = z.infer<typeof esquemaChamado>;

export const esquemaInterno = z.object({
  id: z.number(),
  versao: z.number(),
  tipo: z.string(),
  prioridade: z.string(),
  situacao: z.string(),
  previsto: z.string().nullable(),
  solicitado: z.string().nullable(),
  paciente: z.number(),
  pacienteNome: z.string().nullable(),
  origem: z.string().nullable(),
  destino: z.string().nullable(),
  maqueiro: z.number().nullable(),
  maqueiroNome: z.string().nullable(),
});
export type TransporteInterno = z.infer<typeof esquemaInterno>;

const resposta = z
  .object({
    id: z.number().nullable().optional(),
    numero: z.string().optional(),
    situacao: z.string().optional(),
    cobranca: z
      .object({ situacao: z.string(), motivo: z.string().optional(), quantidade: z.number().optional() })
      .optional(),
  })
  .passthrough();

export interface PedidoAmbulanciaEntrada {
  atendimento: number;
  transporte: number | null;
  tipo: string;
  categoria: number;
  rota: number | null;
  destinoExterno: number | null;
  destinoLogradouro: string | null;
  destinoNumero: string | null;
  destinoBairro: string | null;
  destinoCep: string | null;
  posicao: string | null;
  previsto: string | null;
  contato: string | null;
  observacao: string | null;
}

export const lerOpcoesAmbulancia = () => ler(`${A}/opcoes`, esquemaOpcoesAmbulancia);
export const listarChamados = (f: {
  situacao?: string;
  paciente?: number | null;
  atendimento?: number | null;
}) => ler(`${A}${qs(f)}`, z.object({ itens: z.array(esquemaChamado) }));
export const solicitarAmbulancia = (corpo: PedidoAmbulanciaEntrada) =>
  enviar(A, corpo, resposta, novaChave('ambulancia-solicitar'));
const agir = (acao: string) => (id: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${id}/${acao}`, corpo, resposta, novaChave(`ambulancia-${acao}`));
export const aprovarChamado = agir('aprovar');
export const reprovarChamado = agir('reprovar');
export const sairChamado = agir('sair');
export const concluirChamado = agir('concluir');
export const cobrarChamado = agir('cobrar');
export const cancelarChamado = agir('cancelar');
export const listarInternos = () => ler(M, z.object({ itens: z.array(esquemaInterno) }));
export const designarMaqueiro = (id: number, corpo: { maqueiro: number; versao: number }) =>
  enviar(`${M}/${id}`, corpo, resposta, novaChave('maqueiro-designar'));
