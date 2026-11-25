// Cliente da API da cópia do prontuário no balcão e do cabeçalho por tipo de documento (03-PEP L131):
// GET  /api/pep/copias-prontuario?paciente=&situacao=   fila do balcão ou visão por paciente
// POST /api/pep/copias-prontuario                       pedido novo
// POST /api/pep/copias-prontuario/:pedido/acao          análise, autorização, produção, pronta, negativa, cancelamento
// POST /api/pep/copias-prontuario/:pedido/entrega       entrega com quem recebeu e documento conferido
// GET  /api/pep/cabecalhos-impressao[/previa]           regras, opções e prévia
// POST /api/pep/cabecalhos-impressao[/:regra[/ativo]]   incluir, alterar, ativar/desativar
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const C = '/api/pep/copias-prontuario';
const H = '/api/pep/cabecalhos-impressao';
const JSON_ACEITO = { accept: 'application/json' };
const opcao = z.object({ id: z.number(), rotulo: z.string() });

export const esquemaPedidoCopia = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.number(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.string().nullable(),
  solicitanteTipo: z.string(),
  solicitanteNome: z.string(),
  motivo: z.string(),
  periodoInicio: z.string().nullable(),
  periodoFim: z.string().nullable(),
  solicitadaEm: z.string().nullable(),
  prazo: z.string(),
  atrasada: z.boolean(),
  situacao: z.string(),
  temAutorizacao: z.boolean(),
  temProcuracao: z.boolean(),
  motivoNegativa: z.string().nullable(),
  portal: z.boolean(),
  entrega: z
    .object({
      entregueEm: z.string().nullable(),
      entregador: z.string().nullable(),
      recebedorNome: z.string(),
      vinculo: z.string(),
      tipoDocumento: z.string().nullable(),
      quantidadeFolhas: z.number().nullable(),
    })
    .passthrough()
    .nullable(),
});
export type PedidoCopiaTela = z.infer<typeof esquemaPedidoCopia>;

const esquemaPedidos = z.object({
  hoje: z.string(),
  pedidos: z.array(esquemaPedidoCopia),
  opcoes: z.object({ tiposDocumento: z.array(opcao) }),
});

export const esquemaRegraCabecalho = z.object({
  id: z.number(),
  versao: z.number(),
  estabelecimento: z.number().nullable(),
  tipoDocumento: z.number().nullable(),
  tipoDocumentoNome: z.string().nullable(),
  fonte: z.enum(['estabelecimento', 'mantenedora', 'personalizado']),
  cabecalho: z.string().nullable(),
  rodape: z.string().nullable(),
  exibeDadosPaciente: z.boolean(),
  exibeAssinatura: z.boolean(),
  gerenciavel: z.boolean(),
  ativo: z.boolean(),
});
export type RegraCabecalhoTela = z.infer<typeof esquemaRegraCabecalho>;

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function enviar(url: string, corpo: Record<string, unknown>, buscar: typeof fetch) {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.copiaProntuario'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z.record(z.unknown()).parse(await r.json());
}

export const lerCopias = (paciente: number | null, buscar: typeof fetch = fetch) =>
  ler(paciente ? `${C}?paciente=${paciente}` : C, esquemaPedidos, buscar);
export const pedirCopia = (corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  enviar(C, corpo, buscar);
export const acaoCopia = (pedido: number, corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  enviar(`${C}/${pedido}/acao`, corpo, buscar);
export const entregarCopia = (pedido: number, corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  enviar(`${C}/${pedido}/entrega`, corpo, buscar);

export const lerCabecalhos = (buscar: typeof fetch = fetch) =>
  ler(
    H,
    z.object({
      regras: z.array(esquemaRegraCabecalho),
      opcoes: z.object({ tiposDocumento: z.array(opcao) }),
    }),
    buscar,
  );
export const previaCabecalho = (tipo: number | null, buscar: typeof fetch = fetch) =>
  ler(
    tipo ? `${H}/previa?tipoDocumento=${tipo}` : `${H}/previa`,
    z.object({
      regra: z.number().nullable(),
      linhas: z.array(z.string()),
      rodape: z.array(z.string()),
      exibeDadosPaciente: z.boolean(),
      exibeAssinatura: z.boolean(),
    }),
    buscar,
  );
export const incluirCabecalho = (corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  enviar(H, corpo, buscar);
export const alterarCabecalho = (
  regra: number,
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) => enviar(`${H}/${regra}`, corpo, buscar);
export const ativarCabecalho = (
  regra: number,
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) => enviar(`${H}/${regra}/ativo`, corpo, buscar);
