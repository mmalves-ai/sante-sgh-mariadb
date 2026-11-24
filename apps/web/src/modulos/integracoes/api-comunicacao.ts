// F3.9-6: mensagens ao paciente pela Hal-AI (L133), pacotes de parceiros e entregas (L134) e classificação de risco
// externa (L140) — rotas de comunicacao.controller.ts. Gravações com CSRF e Idempotency-Key.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';
import { tokenCsrf } from '../../api.js';
import { novaChave } from '../relatorios/api-relatorios.js';

const I = '/api/integracoes';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const itens = <X>() => z.object({ itens: z.array(confiar<X>()) });

async function substituir<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('comunicacao'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok)
    throw Object.assign(new Error(String(json['detail'] ?? json['title'] ?? r.statusText)), {
      problema: json,
    });
  return json as T;
}

export interface ModeloMensagem {
  readonly id: number;
  readonly doCliente: boolean;
  readonly codigo: string;
  readonly descricao: string;
  readonly finalidade: string;
  readonly canal: string;
  readonly assunto: string | null;
  readonly corpo: string;
  readonly respostaConfirmacao: string | null;
  readonly respostaRecusa: string | null;
  readonly janelaInicio: string | null;
  readonly janelaFim: string | null;
  readonly ativo: boolean;
  readonly versao: number;
}
export interface RegraEnvio {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly modeloId: number;
  readonly modelo: string;
  readonly gatilho: string;
  readonly canal: string;
  readonly antecedenciaMinutos: number | null;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly maximoEnviosPaciente: number | null;
  readonly exigeConsentimento: boolean;
  readonly ativo: boolean;
  readonly versao: number;
}
export interface PedidoMensagem {
  readonly id: number;
  readonly motivo: string;
  readonly canal: string;
  readonly regra: string | null;
  readonly situacao: string;
  readonly agendadoPara: string | null;
  readonly enviadoEm: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly retornos: readonly { tipo: string; recebidoEm: string; respostaInterpretada: string | null }[];
}

export const lerModelos = () => ler(`${I}/mensagens/modelos`, itens<ModeloMensagem>());
export const gravarModelo = (c: Record<string, unknown>) =>
  substituir<{ id: number }>(`${I}/mensagens/modelos`, c);
export const lerRegras = () => ler(`${I}/mensagens/regras`, itens<RegraEnvio>());
export const gravarRegra = (c: Record<string, unknown>) =>
  substituir<{ id: number }>(`${I}/mensagens/regras`, c);
export const pedirEnvio = (c: Record<string, unknown>) =>
  enviar(`${I}/mensagens/pedidos`, c, confiar<{ id: number; agendadoPara: string }>(), novaChave('pedido'));
export const cancelarPedido = (id: number, motivo: string) =>
  enviar(
    `${I}/mensagens/pedidos/${id}/cancelar`,
    { motivo },
    confiar<{ id: number }>(),
    novaChave('cancelar'),
  );
export const pedidosDoPaciente = (p: number) => ler(`${I}/mensagens/paciente/${p}`, itens<PedidoMensagem>());

export interface PacoteParceiro {
  readonly id: number;
  readonly parceiroCodigo: string;
  readonly parceiro: string;
  readonly codigo: string;
  readonly nome: string;
  readonly conteudo: string;
  readonly formato: string;
  readonly meioEntrega: string;
  readonly periodicidade: string;
  readonly agenda: string | null;
  readonly anonimizacao: string;
  readonly janelaDias: number | null;
  readonly proximaRevisao: string | null;
  readonly revisaoVencida: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly campos: readonly {
    sequencia: number;
    entidade: string;
    campo: string;
    rotuloSaida: string;
    tratamento: string;
    dadoSensivel: boolean;
    justificativa: string;
  }[];
  readonly ultimaEntrega: { id: number; situacao: string; periodoFim: string } | null;
  readonly proximaDevida: { inicio: string; fim: string } | null;
}
export interface EntregaPacote {
  readonly id: number;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly quantidadeRegistros: number;
  readonly situacao: string;
  readonly protocolo: string | null;
  readonly mensagem: string | null;
}
export const lerPacotes = () => ler(`${I}/pacotes`, itens<PacoteParceiro>());
export const gravarPacote = (c: Record<string, unknown>) => substituir<{ id: number }>(`${I}/pacotes`, c);
export const lerEntregas = (p: number) => ler(`${I}/pacotes/${p}/entregas`, itens<EntregaPacote>());
export const mudarEntrega = (e: number, c: Record<string, unknown>) =>
  enviar(`${I}/entregas/${e}/situacao`, c, confiar<{ id: number }>(), novaChave('entrega'));

export interface PerfilPrioridade {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly sistemaCodigo: string | null;
  readonly codigoExterno: string | null;
  readonly condicaoPreferencial: string | null;
  readonly ordemPrioridade: number;
  readonly ativo: boolean;
  readonly versao: number;
}
export interface ClassificacaoRecebida {
  readonly id: number;
  readonly sistema: string;
  readonly identificadorExterno: string;
  readonly codigoPrioridade: string;
  readonly descricaoPrioridade: string | null;
  readonly cor: string | null;
  readonly perfil: string | null;
  readonly classificadoEm: string;
  readonly prazoAtendimento: string | null;
  readonly situacao: string;
  readonly motivoRejeicao: string | null;
}
const C = `${I}/classificacao-externa`;
export const lerPerfis = () => ler(`${C}/perfis`, itens<PerfilPrioridade>());
export const gravarPerfil = (c: Record<string, unknown>) => substituir<{ id: number }>(`${C}/perfis`, c);
export const recebidasDoAtendimento = (a: number) =>
  ler(`${C}/atendimento/${a}`, itens<ClassificacaoRecebida>());
