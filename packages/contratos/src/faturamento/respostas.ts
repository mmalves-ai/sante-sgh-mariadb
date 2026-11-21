// Respostas das telas da conta do paciente (M30; ficha, seções 4 e 7): o que a API devolve e a tela valida (o mesmo
// Zod). Valores, totais e situação gravada são os do banco (produzidos pelos gatilhos); a tela só mostra. O CPF do
// beneficiário sai mascarado; as telas que listam pacientes emitem o evento de leitura auditada.
import { z } from 'zod';
import { SITUACOES_DERIVADAS } from './regras/situacao.js';

const n = z.number();
const texto = z.string();
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullable();

export const esquemaContaResumo = z.object({
  id: n,
  ano: n,
  mes: n,
  tipoConta: z.enum(['E', 'I', '']),
  codigo: n,
  /** Nome do paciente (tela com leitura auditada). */
  paciente: texto,
  convenio: n,
  convenioNome: texto,
  situacao: z.enum(SITUACOES_DERIVADAS),
  situacaoRotulo: texto,
  inferida: z.boolean(),
  fechada: texto,
  emitida: z.boolean(),
  alta: nulo(texto),
  diasDesdeAlta: nulo(n),
  total: n,
  pacote: texto,
  pendencias: n,
});
export type ContaResumo = z.infer<typeof esquemaContaResumo>;

export const esquemaListaContas = z.object({
  contas: z.array(esquemaContaResumo),
  total: n,
  pagina: n,
  porPagina: n,
  regua: z.enum(['competencia', 'data-item']),
});
export type ListaContas = z.infer<typeof esquemaListaContas>;

export const esquemaPendenciaConta = z.object({
  id: n,
  tipo: n,
  tipoNome: texto,
  descricao: texto,
  bloqueante: z.boolean(),
  aberta: z.boolean(),
  registradaPor: texto,
  registradaEm: texto,
  resolucao: nulo(texto),
  /** "novo" (pendência do produto) ou "outro" (pendência importada, até 03/2022, só leitura). */
  origem: z.enum(['novo', 'outro']),
});
export type PendenciaConta = z.infer<typeof esquemaPendenciaConta>;

export const esquemaEtapaLida = z.object({
  id: n,
  etapa: z.enum(['conferencia', 'auditoria', 'conferencia-item', 'reabertura', 'fechamento']),
  situacao: z.enum(['em-andamento', 'concluida', 'registrada']),
  usuario: texto,
  inicio: texto,
  fim: nulo(texto),
  observacao: texto,
});
export type EtapaLida = z.infer<typeof esquemaEtapaLida>;

export const esquemaContaDetalhe = esquemaContaResumo.extend({
  versao: texto,
  remessa: n,
  dataEmissao: nulo(texto),
  dataFechamento: nulo(texto),
  usuarioFechamento: texto,
  indEmi: texto,
  pacoteRotulo: texto,
  pacoteAConfirmar: z.boolean(),
  tipoNota: nulo(n),
  guia: texto,
  senha: texto,
  registroAtendimento: n,
  somaItens: n,
  itens: n,
  lotesTiss: n,
  beneficiario: z.object({
    matricula: texto,
    validadeCarteira: nulo(texto),
    cpfMascarado: texto,
    plano: texto,
  }),
  guias: z.array(
    z.object({ tipo: texto, principal: texto, secundaria: texto, senha: texto, sequencia: nulo(n) }),
  ),
  parciais: z.array(z.object({ seq: n, tipo: n, inicio: nulo(texto), fim: nulo(texto) })),
  pendenciasLista: z.array(esquemaPendenciaConta),
  etapas: z.array(esquemaEtapaLida),
  avisos: z.array(texto),
  /** O que o fechamento recusaria agora (o pré-voo), ou null. */
  preVooFechamento: nulo(z.object({ codigo: texto, mensagem: texto })),
});
export type ContaDetalhe = z.infer<typeof esquemaContaDetalhe>;

export const esquemaItemConta = z.object({
  id: n,
  versao: texto,
  tipo: n,
  grupo: texto,
  data: texto,
  hora: texto,
  codigo: n,
  nome: texto,
  quantidade: n,
  unitario: n,
  valor: n,
  ch: n,
  cop: n,
  filme: n,
  perc: n,
  veio: texto,
  origemRotulo: texto,
  origemAConfirmar: z.boolean(),
  /** Documento de origem registrado pelo novo (SGH_FAT_ITEM_ORIGEM), se houver. */
  documentoOrigem: nulo(texto),
  pacote: texto,
  pacoteRotulo: texto,
  conferidoPor: texto,
  usuario: texto,
  sigtap: nulo(n),
});
export type ItemConta = z.infer<typeof esquemaItemConta>;

export const esquemaListaItens = z.object({
  itens: z.array(esquemaItemConta),
  total: n,
  pagina: n,
  porPagina: n,
  somaPagina: n,
  regua: z.enum(['competencia', 'data-item']),
});
export type ListaItens = z.infer<typeof esquemaListaItens>;

export const esquemaExplicacaoLida = z.object({
  item: n,
  modelo: texto,
  passos: z.array(z.object({ ordem: n, etapa: texto, texto, valor: n.optional() })),
  calculado: nulo(n),
  gravado: n,
  confere: z.boolean(),
  diferenca: n,
  conclusao: texto,
  causa: texto,
});
export type ExplicacaoLida = z.infer<typeof esquemaExplicacaoLida>;

export const esquemaLancamentoTardio = z.object({
  registro: n,
  data: texto,
  convenio: n,
  conta: nulo(n),
  contaSituacao: texto,
  paciente: texto,
  decisao: nulo(texto),
  decididoPor: nulo(texto),
  motivo: nulo(texto),
});
export type LancamentoTardio = z.infer<typeof esquemaLancamentoTardio>;

export const esquemaPainelLancamentos = z.object({
  porOrigem: z.array(z.object({ veio: texto, rotulo: texto, aConfirmar: z.boolean(), itens: n, valor: n })),
  tardios: z.array(esquemaLancamentoTardio),
  totalTardios: n,
  pendentesDecisao: n,
});
export type PainelLancamentos = z.infer<typeof esquemaPainelLancamentos>;

export const esquemaAuditoriaConta = z.object({
  conta: n,
  retratoLegado: nulo(z.object({ total: n, itens: n, auditada: texto })),
  diferencas: z.array(
    z.object({ codigo: n, nome: texto, antes: n, depois: n, quantidadeAntes: n, quantidadeDepois: n }),
  ),
  versoes: z.array(
    z.object({ id: n, papel: texto, parecer: texto, usuario: texto, em: texto, total: n, itens: n }),
  ),
  /** As irregularidades DESTA conta (as do novo e as registradas antes), com o nome do tipo; nunca o catálogo. */
  irregularidades: z.array(
    z.object({ id: n, tipo: n, nome: texto, descricao: texto, aberta: z.boolean(), registradaEm: texto }),
  ),
});
export type AuditoriaConta = z.infer<typeof esquemaAuditoriaConta>;

export const esquemaItemSigtap = z.object({
  item: n,
  codigo: n,
  nome: texto,
  sigtap: nulo(n),
  sigtapCodigo: nulo(texto),
});
export type ItemSigtap = z.infer<typeof esquemaItemSigtap>;

export const esquemaNotaSala = z.object({
  cirurgia: n,
  data: nulo(texto),
  sala: texto,
  procedimentos: z.array(z.object({ codigo: n, nome: texto })),
  equipe: z.array(z.object({ funcao: texto, profissional: texto })),
  itensConta: z.array(esquemaItemConta),
  conta: nulo(n),
});
export type NotaSala = z.infer<typeof esquemaNotaSala>;

export const esquemaRegraLida = z.object({
  id: n,
  convenio: n,
  nome: texto,
  exige: texto,
  seletor: z.object({ tipoConta: nulo(texto), grupos: z.array(texto), codigos: z.array(n) }),
  bloqueiaFechamento: z.boolean(),
  inicio: texto,
  fim: nulo(texto),
  ativa: z.boolean(),
  autor: texto,
});
export type RegraLida = z.infer<typeof esquemaRegraLida>;

export const esquemaPacoteLido = z.object({
  id: n,
  convenio: n,
  codigo: n,
  nome: texto,
  valor: n,
  inicio: texto,
  fim: nulo(texto),
  ativo: z.boolean(),
  itens: z.array(z.object({ codigo: n, quantidade: n })),
});
export type PacoteLido = z.infer<typeof esquemaPacoteLido>;

export const esquemaOrcamentoPadrao = z.object({
  convenio: n,
  procedimento: n,
  tipo: n,
  nome: texto,
  valor: n,
  quantidade: n,
});

export const esquemaOrcamentoParticular = z.object({
  id: n,
  prontuario: n,
  nome: texto,
  total: n,
  desconto: n,
  validoAte: texto,
  urgencia: z.boolean(),
  situacao: z.enum(['aberto', 'pago', 'vencido', 'cancelado']),
  pago: n,
  itens: z.array(z.object({ descricao: texto, quantidade: n, unitario: n })),
  criadoPor: texto,
  criadoEm: texto,
});
export type OrcamentoParticular = z.infer<typeof esquemaOrcamentoParticular>;

export const esquemaCaixaLido = z.object({
  id: n,
  operador: texto,
  abertoEm: texto,
  fechadoEm: nulo(texto),
  saldoInicial: n,
  recebido: n,
  contado: nulo(n),
  diferenca: nulo(n),
  porForma: z.record(z.string(), n),
});
export type CaixaLido = z.infer<typeof esquemaCaixaLido>;

export const esquemaPagamentoLido = z.object({
  id: n,
  caixa: n,
  orcamento: nulo(n),
  conta: nulo(n),
  forma: texto,
  valor: n,
  parcelas: n,
  situacao: z.enum(['aprovado', 'pendente', 'recusado', 'estornado']),
  comprovante: texto,
  /** O conector usado: "simulado" fora de produção; "manual" com o comprovante digitado. */
  conector: texto,
  recibo: nulo(n),
  em: texto,
});
export type PagamentoLido = z.infer<typeof esquemaPagamentoLido>;

export const esquemaReciboLido = z.object({
  id: n,
  numero: n,
  pagamento: nulo(n),
  pagador: texto,
  referente: texto,
  valor: n,
  em: texto,
  emitidoPor: texto,
  /** "novo" (recibo do produto) ou "antigo" (recibo importado, 2020 a 05/2021, só leitura). */
  origem: z.enum(['novo', 'antigo']),
});
export type ReciboLido = z.infer<typeof esquemaReciboLido>;

export const esquemaWorklistFaturamento = z.object({
  porSituacao: z.array(z.object({ situacao: texto, rotulo: texto, contas: n, valor: n })),
  porPrazo: z.array(z.object({ faixa: texto, contas: n })),
  comPendencia: n,
  tardiosPendentes: n,
  emAuditoria: n,
});
export type WorklistFaturamento = z.infer<typeof esquemaWorklistFaturamento>;

export const esquemaGravacaoFaturamento = z.object({
  funcionalidades: z.record(z.string(), z.object({ ligada: z.boolean(), motivo: texto.nullable() })),
  operacoes: z.record(z.string(), z.object({ ligada: z.boolean(), motivo: texto.nullable() })),
});
export type GravacaoFaturamento = z.infer<typeof esquemaGravacaoFaturamento>;

export const esquemaResultadoFaturamento = z.object({
  mensagem: texto,
  repetida: z.boolean(),
  ids: z.record(z.string(), z.union([n, texto])),
  avisos: z.array(texto),
});
export type ResultadoFaturamento = z.infer<typeof esquemaResultadoFaturamento>;

export const esquemaReproducaoGrupo = z.object({
  grupo: texto,
  total: n,
  conferem: n,
  acerto: n,
  meta: n,
  apto: z.boolean(),
});
