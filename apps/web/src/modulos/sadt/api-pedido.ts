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
  // Cota, intervalo e último resultado (05-SADT linha 6).
  limites: z
    .array(
      z.object({
        tipo: z.enum(['cota', 'intervalo', 'ultimo_resultado']),
        regra: n,
        exame: n,
        acao: z.enum(['bloquear', 'alertar', 'exigir_justificativa']),
        mensagem: txt,
      }),
    )
    .default([]),
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

const esquemaAtendimento = z.object({
  id: n,
  numero: txt,
  paciente: n,
  nome: txt,
  prontuario: txt,
  sexo: z.enum(['feminino', 'masculino']).nullable(),
  nascimento: txt.nullable(),
  idadeAnos: n.nullable(),
});
export type AtendimentoPedido = z.infer<typeof esquemaAtendimento>;
const esquemaDoAtendimento = z.object({
  atendimento: esquemaAtendimento.extend({ estabelecimento: txt }),
  podeAutorizarExcecao: z.boolean(),
  requisicoes: z.array(
    z.object({
      id: n,
      numero: txt,
      situacao: txt,
      prioridade: txt,
      solicitadaEm: txt,
      itens: z.array(
        z.object({ id: n, sequencia: n, exame: txt, situacao: txt, coletaPendente: z.boolean() }),
      ),
    }),
  ),
});
export type PedidosDoAtendimento = z.infer<typeof esquemaDoAtendimento>;
const esquemaEventos = z.object({
  itens: z.array(
    z.object({ evento: txt, em: txt, de: txt.nullable(), para: txt.nullable(), motivo: txt.nullable() }),
  ),
});

export interface CorpoPedido {
  atendimento: number;
  setor: number;
  prioridade: 'rotina' | 'urgente' | 'emergencia';
  /** Setor executante próprio do exame (nulo: o setor do pedido); o material nulo usa o padrão do cadastro. */
  exames: { exame: number; setor: number | null; urgente: boolean }[];
  kits: number[];
  indicacaoClinica: string | null;
  confirmado: boolean;
  justificativa: string | null;
}

export const avaliarPedido = (c: CorpoPedido, chave: string) =>
  enviar(`${S}/pedidos/avaliar`, c, esquemaAvaliacao, chave);
export const gravarPedido = (c: CorpoPedido, chave: string) =>
  enviar(`${S}/pedidos`, c, esquemaPedido, chave);
export const buscarAtendimentos = (busca: string) =>
  ler(`${S}/pedidos/atendimentos${qs({ busca })}`, z.object({ itens: z.array(esquemaAtendimento) }));
export const lerPedidosDoAtendimento = (id: number) =>
  ler(`${S}/pedidos/atendimentos/${id}`, esquemaDoAtendimento);
export const lerEventosDoItem = (item: number) => ler(`${S}/itens/${item}/eventos`, esquemaEventos);
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
/** A identificação positiva do paciente na coleta da recoleta (mesma exigência da coleta comum). */
export interface ConferenciaColeta {
  identificadoresConferidos: boolean;
  pulseira: string | null;
  estacao: string | null;
}
export const coletarRecoleta = (id: number, conferencia: ConferenciaColeta, chave: string) =>
  enviar(`${S}/recoletas/${id}/coletar`, conferencia, z.object({ id: n, amostra: n, codigo: txt }), chave);
export const cancelarRecoleta = (
  id: number,
  motivo: string,
  destinoExames: 'cancelar' | 'manter',
  motivoCancelamentoExame: number | null,
  chave: string,
) =>
  enviar(
    `${S}/recoletas/${id}/cancelar`,
    { motivo, destinoExames, motivoCancelamentoExame },
    z.object({ id: n, exames: n }),
    chave,
  );
export const gerarAliquotas = (amostra: number, chave: string) =>
  enviar(
    `${S}/amostras/${amostra}/subamostras`,
    {},
    z.object({ id: n, subamostras: z.array(z.object({ id: n, codigo: txt, exames: n })) }),
    chave,
  );
