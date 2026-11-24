// Cliente da API do pedido de exames, do cancelamento do item, dos kits e da recoleta (F3.5, 05-SADT linhas 4, 5 e 7).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const S = '/api/sadt';
const n = z.number();
const txt = z.string();

const esquemaRestricao = z.object({
  regra: n,
  exame: n,
  tipo: z.enum(['bloqueio', 'alerta']),
  motivo: txt,
  mensagem: txt,
  permiteExcecao: z.boolean(),
  excecao: n.nullable(),
});
export const esquemaAvaliacao = z.object({
  itens: z.array(z.object({ sequencia: n, exame: n, kitVersao: n.nullable() })),
  restricoes: z.array(esquemaRestricao),
  segue: z.boolean(),
  codigo: txt.nullable(),
  motivo: txt.nullable(),
});
export type AvaliacaoPedido = z.infer<typeof esquemaAvaliacao>;
const esquemaPedido = z.object({
  requisicao: n,
  numero: txt,
  itens: z.array(z.object({ id: n, exame: n, sequencia: n })),
  excecoes: n,
});
const esquemaMotivos = z.object({
  setores: z.array(z.object({ id: n, nome: txt })),
  cancelamento: z.array(z.object({ id: n, descricao: txt, exigeComplemento: z.boolean() })),
  recoleta: z.array(z.object({ id: n, descricao: txt })),
});
const esquemaKits = z.object({
  itens: z.array(
    z.object({
      id: n,
      codigo: txt,
      nome: txt,
      versao: n,
      numeroVersao: n,
      itens: z.array(z.object({ exame: n, nome: txt, material: n.nullable(), quantidade: n })),
    }),
  ),
});
const esquemaRecoletas = z.object({
  itens: z.array(
    z.object({
      id: n,
      numero: txt,
      situacao: txt,
      amostraOriginal: n,
      codigoOriginal: txt,
      novaAmostra: n.nullable(),
      motivo: txt,
      solicitadaEm: txt,
      paciente: n,
    }),
  ),
});

export interface CorpoPedido {
  atendimento: number;
  setor: number;
  prioridade: 'rotina' | 'urgente' | 'emergencia';
  exames: { exame: number }[];
  kits: number[];
  indicacaoClinica: string | null;
  confirmado: boolean;
  justificativa: string | null;
}

export const avaliarPedido = (c: CorpoPedido, chave: string) =>
  enviar(`${S}/pedidos/avaliar`, c, esquemaAvaliacao, chave);
export const gravarPedido = (c: CorpoPedido, chave: string) =>
  enviar(`${S}/pedidos`, c, esquemaPedido, chave);
export const lerMotivosPedido = () => ler(`${S}/pedidos/motivos`, esquemaMotivos);
export const listarKits = () => ler(`${S}/kits`, esquemaKits);
export const cancelarItem = (item: number, motivo: number, complemento: string | null, chave: string) =>
  enviar(
    `${S}/itens/${item}/cancelar`,
    { motivo, complemento },
    z.object({ id: n, requisicaoCancelada: z.boolean() }),
    chave,
  );
export const listarRecoletas = () => ler(`${S}/recoletas${qs({ abertas: 'sim' })}`, esquemaRecoletas);
export const pedirRecoleta = (amostra: number, motivo: number, chave: string) =>
  enviar(`${S}/amostras/${amostra}/recoleta`, { motivo }, z.object({ id: n, numero: txt }), chave);
export const coletarRecoleta = (id: number, chave: string) =>
  enviar(`${S}/recoletas/${id}/coletar`, {}, z.object({ id: n, amostra: n, codigo: txt }), chave);
export const cancelarRecoleta = (id: number, motivo: string, chave: string) =>
  enviar(`${S}/recoletas/${id}/cancelar`, { motivo }, z.object({ id: n }), chave);
export const gerarAliquotas = (amostra: number, chave: string) =>
  enviar(
    `${S}/amostras/${amostra}/subamostras`,
    {},
    z.object({ id: n, subamostras: z.array(z.object({ id: n, codigo: txt, exames: n })) }),
    chave,
  );
