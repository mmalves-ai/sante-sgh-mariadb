// Cliente das telas do pós-fechamento (M31): guias, lotes e protocolo, prazos, competências, demonstrativos, retorno e
// glosa, webservices e o painel. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem
// Details viram ErroApi e a recusa de negócio traz o texto em português do servidor (XSD, protocolo, motivo, prazo…).
import type {
  CompetenciaLida,
  ConfiguracaoTissLida,
  ContaProntaLote,
  DemonstrativoLido,
  EvidenciaGlosaLida,
  GradeGlosa,
  GravacaoTiss,
  GuiaLida,
  ItemDemonstrativo,
  ItemDemonstrativoLido,
  ItemGlosaLido,
  ListaLotes,
  LoteDetalhe,
  MotivoGlosaLido,
  PainelGlosa,
  PrazoEnvio,
  ResultadoTiss,
} from '@sgh/contratos';
import {
  esquemaAcompanhamentoCompetencia,
  esquemaConferenciaCompetencia,
  type PedidoConferenciaCompetencia,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const T = '/api/tiss';
/** As respostas são conferidas pelo servidor (contratos); aqui só a forma de objeto. */
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

let sequencia = 0;
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m31.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = <X = ResultadoTiss>(url: string, corpo: unknown, chave: string): Promise<X> =>
  enviar(url, corpo, confiar<X>(), chave);

export interface ApoioTiss {
  hoje: string;
  convenios: { codigo: number; nome: string }[];
  situacoesProtocolo: { id: number; nome: string }[];
  tiposGuia: { id: number; nome: string }[];
  versao: string;
}

export const lerGravacao = (de: 'lote' | 'glosa' | 'integracao' = 'lote') =>
  ler(
    `${T}/${de === 'lote' ? 'gravacao' : de === 'glosa' ? 'gravacao-glosa' : 'gravacao-integracao'}`,
    confiar<GravacaoTiss>(),
  );
export const lerApoio = () => ler(`${T}/apoio`, confiar<ApoioTiss>());
export const lerMotivos = () => ler(`${T}/motivos`, z.array(confiar<MotivoGlosaLido>()));

export const listarGuias = (f: { convenio?: string; competencia?: string }) =>
  ler(`${T}/guias${qs(f)}`, z.array(confiar<GuiaLida>()));
export const urlImpressaoGuia = (conta: number) => `${T}/guias/${conta}/impressao`;

export const contasProntas = (f: { convenio: string; tipoGuia: string; competencia?: string }) =>
  ler(`${T}/lotes/contas-prontas${qs(f)}`, z.array(confiar<ContaProntaLote>()));
export const gerarLote = (
  corpo: { convenio: number; tipoGuia: number; contas: { id: number; versao: string }[] },
  chave: string,
) => gravar(`${T}/lotes`, corpo, chave);
export const listarLotes = (f: {
  convenio?: string;
  de?: string;
  ate?: string;
  semProtocolo?: string;
  pagina?: number;
}) =>
  ler(
    `${T}/lotes${qs({ ...f, pagina: f.pagina === undefined ? undefined : String(f.pagina) })}`,
    confiar<ListaLotes>(),
  );
export const lerLote = (id: number) => ler(`${T}/lotes/${id}`, confiar<LoteDetalhe>());
export const registrarProtocolo = (
  lote: number,
  corpo: {
    acao: 'registrar' | 'limpar';
    protocolo: string;
    data: string | null;
    recibo: string;
    situacao: number | null;
  },
  chave: string,
) => gravar(`${T}/lotes/${lote}/protocolo`, corpo, chave);
export const enviarLote = (lote: number, chave: string) =>
  gravar<
    ResultadoTiss & { resposta: { protocolo: string | null; recibo: string | null; situacao: number | null } }
  >(`${T}/lotes/${lote}/envio`, {}, chave);
export const lerPrazos = () => ler(`${T}/prazos`, z.array(confiar<PrazoEnvio>()));

export const listarCompetencias = (f: { convenio?: string; ano?: string }) =>
  ler(`${T}/competencias${qs(f)}`, z.array(confiar<CompetenciaLida>()));
export const resumoCompetencia = (f: { convenio: string; competencia: string }) =>
  ler(`${T}/competencias/resumo${qs(f)}`, confiar<CompetenciaLida>());
export const fecharCompetencia = (corpo: { convenio: number; ano: number; mes: number }, chave: string) =>
  gravar(`${T}/competencias`, corpo, chave);
export const reabrirCompetencia = (
  corpo: { convenio: number; ano: number; mes: number; motivo: string; confirmarImpacto: boolean },
  chave: string,
) => gravar(`${T}/competencias/reabrir`, corpo, chave);

export const listarDemonstrativos = (f: { lote?: string }) =>
  ler(`${T}/demonstrativos${qs(f)}`, z.array(confiar<DemonstrativoLido>()));
/** O cabeçalho do demonstrativo de pagamento: totais, situação da baixa, débitos e créditos e o lote de cada linha. */
export interface ResumoPagamentoTiss {
  readonly situacao: string;
  readonly dataPagamento: string;
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
  readonly debitos: number;
  readonly creditos: number;
  readonly liquido: number;
  readonly titulo: number | null;
  readonly deducoes: readonly {
    sequencia: number;
    natureza: 'debito' | 'credito';
    codigo: string;
    descricao: string;
    valor: number;
  }[];
  readonly lotes: Readonly<Record<number, number>>;
}
export const lerDemonstrativo = (id: number, tipo: 'analise' | 'pagamento' = 'analise') =>
  ler(
    `${T}/demonstrativos/${id}${tipo === 'pagamento' ? '?tipo=pagamento' : ''}`,
    confiar<{
      lote: number;
      convenio: number;
      itens: ItemDemonstrativoLido[];
      pagamento?: ResumoPagamentoTiss;
    }>(),
  );
/** A baixa do recebimento pelo demonstrativo de pagamento (rota do financeiro: financeiro.tituloReceber.baixar). */
export const baixarPagamentoTiss = (
  id: number,
  corpo: { conta: number; dataRecebimento: string },
  chave: string,
) =>
  enviar(
    `/api/financeiro/receber/pagamentos-tiss/${id}/baixa`,
    corpo,
    confiar<{ mensagem: string; repetida?: boolean }>(),
    chave,
  );
export const importarDemonstrativo = (
  corpo: {
    lote: number;
    tipo: 'analise' | 'pagamento';
    numero: string;
    dataEmissao: string;
    xml: string | null;
    itens: ItemDemonstrativo[];
  },
  chave: string,
) => gravar(`${T}/demonstrativos`, corpo, chave);

export const lerGrade = (f: { convenio?: string; competencia?: string; estado?: string; pagina?: number }) =>
  ler(
    `${T}/glosas${qs({ ...f, pagina: f.pagina === undefined ? undefined : String(f.pagina) })}`,
    confiar<GradeGlosa>(),
  );
export const itensGlosa = (conta: number) =>
  ler(`${T}/glosas/contas/${conta}`, z.array(confiar<ItemGlosaLido>()));
/** A evidência do prontuário da decisão de recorrer: leitura auditada (fica na trilha de quem leu). */
export const lerEvidencia = (item: number) =>
  ler(`${T}/glosas/itens/${item}/evidencia`, confiar<EvidenciaGlosaLida>());
export const baixar = (
  corpo: {
    itens: { item: number; versao: string; valorPago: number; quantidadePaga: number; motivo: number }[];
    dataPagamento: string;
    demonstrativo: number | null;
  },
  chave: string,
) => gravar(`${T}/glosas/baixa`, corpo, chave);
export const decidir = (
  corpo: { item: number; decisao: 'aceitar' | 'recorrer'; texto: string; evidencia: string },
  chave: string,
) => gravar(`${T}/glosas/decisao`, corpo, chave);
export const recorrer = (
  corpo: {
    itens: { item: number; versao: string; valor: number | null; quantidade: number | null }[];
    dataProtocolo: string;
  },
  chave: string,
) => gravar(`${T}/glosas/recurso`, corpo, chave);
export const registrarDesfecho = (
  corpo: {
    itens: {
      item: number;
      versao: string;
      desfecho: 'acatado' | 'parcial' | 'negado';
      valor: number | null;
      motivo: number | null;
    }[];
    data: string;
    numeroDemonstrativo: string;
  },
  chave: string,
) => gravar(`${T}/glosas/desfecho`, corpo, chave);

export const lerConfiguracao = () => ler(`${T}/configuracao`, confiar<ConfiguracaoTissLida>());
export const editarEndpoint = (
  corpo: { convenio: number; transacao: string; url: string; referenciaCofre: string; ativo: boolean },
  chave: string,
) => gravar(`${T}/endpoints`, corpo, chave);

export const lerPainel = (f: { de?: string; ate?: string }) =>
  ler(`${T}/painel${qs(f)}`, confiar<PainelGlosa>());
export const urlExportacaoPainel = (f: { de?: string; ate?: string }) => `${T}/painel/exportacao${qs(f)}`;

// M42: acompanhamento da competência (a tela valida com o mesmo Zod da API) e a conferência com o outro sistema.
export const lerAcompanhamento = (f: { competencia: string; convenio?: string }) =>
  ler(`${T}/painel/competencia${qs(f)}`, esquemaAcompanhamentoCompetencia);
export const urlExportacaoAcompanhamento = (f: { competencia: string; convenio?: string }) =>
  `${T}/painel/competencia/exportacao${qs(f)}`;
export const conferirCompetencia = (corpo: PedidoConferenciaCompetencia, chave: string) =>
  enviar(`${T}/painel/competencia/conferencia`, corpo, esquemaConferenciaCompetencia, chave);
