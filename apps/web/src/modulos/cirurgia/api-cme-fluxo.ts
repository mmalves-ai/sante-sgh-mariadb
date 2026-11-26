// Cliente do fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117; RDC 15/2012):
// /api/cirurgia/cme/fluxo. Painel (fila de solicitações, arsenal, pacotes fora da CME, movimentos, permissões e
// setores) e as gravações: receber, cancelar, entregar ao setor, recolher, conferir e gravar a permissão por setor.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const F = '/api/cirurgia/cme/fluxo';
const nulo = <T extends z.ZodTypeAny>(x: T) => x.nullable();
const qualquer = z.record(z.string(), z.unknown());

const esquemaPacote = z.object({
  id: z.number(),
  etiqueta: nulo(z.string()),
  caixa: nulo(z.string()),
  situacao: z.string(),
  validade: nulo(z.string()),
  setor: nulo(z.number()),
});
export const MARCAS_PERMISSAO = [
  'expurgo',
  'lavagem',
  'desinfeccao',
  'preparo',
  'esterilizacao',
  'entradaArsenal',
  'saidaArsenal',
  'devolucaoArsenal',
  'transferenciaArsenal',
  'terceirizacao',
] as const;
export type MarcaPermissao = (typeof MARCAS_PERMISSAO)[number];
const esquemaPermissao = z.object({
  id: z.number(),
  usuario: z.number(),
  usuarioNome: nulo(z.string()),
  setor: z.number(),
  setorNome: nulo(z.string()),
  ...Object.fromEntries(MARCAS_PERMISSAO.map((k) => [k, z.boolean()])),
}) as z.ZodType<
  {
    id: number;
    usuario: number;
    usuarioNome: string | null;
    setor: number;
    setorNome: string | null;
  } & Record<MarcaPermissao, boolean>
>;
const esquemaPainel = z.object({
  solicitacoes: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      tipo: z.string(),
      situacao: z.string(),
      urgente: z.boolean(),
      setor: nulo(z.string()),
      solicitadoEm: nulo(z.string()),
      necessarioAte: nulo(z.string()),
      versao: z.number(),
      itens: z.array(
        z.object({
          id: z.number(),
          caixa: nulo(z.string()),
          quantidade: z.number(),
          atendida: z.number(),
          situacao: z.string(),
        }),
      ),
    }),
  ),
  arsenal: z.array(esquemaPacote),
  foraDaCme: z.array(esquemaPacote),
  movimentos: z.array(
    z.object({
      id: z.number(),
      numero: z.number(),
      tipo: z.string(),
      situacao: z.string(),
      setor: nulo(z.string()),
      ocorridoEm: nulo(z.string()),
      itens: z.number(),
      versao: z.number(),
    }),
  ),
  permissoes: z.array(esquemaPermissao),
  setores: z.array(z.object({ id: z.number(), nome: z.string() })),
});
export type PainelFluxoCme = z.infer<typeof esquemaPainel>;
export type PacoteFluxoCme = z.infer<typeof esquemaPacote>;

export const lerFluxoCme = () => ler(F, esquemaPainel);
export const buscarUsuariosCme = (busca: string) =>
  ler(
    `${F}/usuarios?${new URLSearchParams({ busca }).toString()}`,
    z.object({ itens: z.array(z.object({ id: z.number(), nome: z.string() })) }),
  ).then((r) => r.itens);
export const receberSolicitacaoCme = (id: number) =>
  enviar(`${F}/solicitacoes/${id}/receber`, {}, qualquer, novaChave('cme.receber'));
export const cancelarSolicitacaoCme = (id: number, motivo: string) =>
  enviar(`${F}/solicitacoes/${id}/cancelar`, { motivo }, qualquer, novaChave('cme.cancelar'));
export const entregarAoSetorCme = (corpo: {
  solicitacao: number;
  cme: number;
  setor: number;
  pacotes: number[];
}) =>
  enviar(
    `${F}/entregas`,
    corpo,
    z.object({ movimento: z.number(), solicitacao: z.string() }),
    novaChave('cme.entrega'),
  );
export const recolherDoSetorCme = (corpo: {
  cme: number;
  setor: number;
  observacao: string | null;
  pacotes: { pacote: number; integro: boolean }[];
}) =>
  enviar(
    `${F}/recolhimentos`,
    corpo,
    z.object({ movimento: z.number(), arsenal: z.number(), expurgo: z.number() }),
    novaChave('cme.recolhimento'),
  );
export const conferirMovimentoCme = (id: number) =>
  enviar(`${F}/movimentos/${id}/conferir`, {}, qualquer, novaChave('cme.conferir'));
export const gravarPermissaoCme = (
  corpo: { usuario: number; setor: number } & Partial<Record<MarcaPermissao, boolean>>,
) => enviar(`${F}/permissoes`, corpo, qualquer, novaChave('cme.permissao'));
