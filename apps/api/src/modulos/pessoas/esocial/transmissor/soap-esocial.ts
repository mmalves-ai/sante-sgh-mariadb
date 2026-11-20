// Mensagens SOAP do serviço do eSocial (M53.6, achado do corretor; "Manual de Orientação do Desenvolvedor", serviços
// de envio e de consulta do lote, versões v1_1_0 dos serviços e v1_1_1 / v1_0_0 dos esquemas do lote): o envelope do
// envio do lote (empregador, transmissor e os eventos assinados) e o da consulta pelo protocolo, e a leitura das duas
// respostas. Puro: o transporte (TLS mútuo com o certificado) fica em transmissor-esocial.ts.
import { atributo, buscar, filhosChamados, lerXml, type NoLido, textoDe } from './xml-leitura.js';

export const SOAP_ENV = 'http://schemas.xmlsoap.org/soap/envelope/';
export const NS_SERVICO_ENVIO = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0';
export const NS_LOTE_ENVIO = 'http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1';
export const ACAO_ENVIO = `${NS_SERVICO_ENVIO}/ServicoEnviarLoteEventos/EnviarLoteEventos`;
export const NS_SERVICO_CONSULTA =
  'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0';
export const NS_LOTE_CONSULTA =
  'http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0';
export const ACAO_CONSULTA = `${NS_SERVICO_CONSULTA}/ServicoConsultarLoteEventos/ConsultarLoteEventos`;

/** Endereços oficiais do serviço (produção). Só se usam com AMBIENTE=producao (regra 3; trava-saidas). */
export const URL_ENVIO_PRODUCAO =
  'https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc';
export const URL_CONSULTA_PRODUCAO =
  'https://webservices.consulta.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc';

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface LoteParaEnvio {
  /** 1 tabela, 2 não periódicos, 3 periódicos. */
  readonly grupo: 1 | 2 | 3;
  /** Raiz do CNPJ do empregador (8 dígitos). */
  readonly empregador: string;
  /** CNPJ do transmissor (o do certificado, 14 dígitos). */
  readonly transmissor: string;
  /** Os eventos assinados (sem a declaração XML) com o Id. */
  readonly eventos: readonly { readonly id: string; readonly xml: string }[];
}

const envelope = (ns: string, corpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_ENV}" xmlns:v1="${ns}">` +
  `<soapenv:Header/><soapenv:Body>${corpo}</soapenv:Body></soapenv:Envelope>`;

export function envelopeEnvioLote(l: LoteParaEnvio): string {
  if (!/^\d{8}$/.test(l.empregador)) throw new Error('Raiz do CNPJ do empregador inválida.');
  if (!/^\d{14}$/.test(l.transmissor)) throw new Error('CNPJ do transmissor inválido.');
  if (l.eventos.length < 1 || l.eventos.length > 50) throw new Error('O lote leva de 1 a 50 eventos.');
  const eventos = l.eventos
    .map((e) => `<evento Id="${esc(e.id)}">${e.xml.replace(/^<\?xml[^>]*\?>/, '')}</evento>`)
    .join('');
  return envelope(
    NS_SERVICO_ENVIO,
    `<v1:EnviarLoteEventos><v1:loteEventos><eSocial xmlns="${NS_LOTE_ENVIO}"><envioLoteEventos grupo="${l.grupo}">` +
      `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${l.empregador}</nrInsc></ideEmpregador>` +
      `<ideTransmissor><tpInsc>1</tpInsc><nrInsc>${l.transmissor}</nrInsc></ideTransmissor>` +
      `<eventos>${eventos}</eventos></envioLoteEventos></eSocial></v1:loteEventos></v1:EnviarLoteEventos>`,
  );
}

export function envelopeConsultaLote(protocolo: string): string {
  return envelope(
    NS_SERVICO_CONSULTA,
    `<v1:ConsultarLoteEventos><v1:consulta><eSocial xmlns="${NS_LOTE_CONSULTA}"><consultaLoteEventos>` +
      `<protocoloEnvio>${esc(protocolo)}</protocoloEnvio></consultaLoteEventos></eSocial></v1:consulta>` +
      `</v1:ConsultarLoteEventos>`,
  );
}

export interface Ocorrencia {
  readonly codigo: string;
  readonly descricao: string;
}

const ocorrenciasDe = (n: NoLido | null): Ocorrencia[] => {
  const oc = n ? buscar(n, 'ocorrencias') : null;
  if (!oc) return [];
  return filhosChamados(oc, 'ocorrencia').map((o) => ({
    codigo: textoDe(o, 'codigo') ?? '',
    descricao: textoDe(o, 'descricao') ?? '',
  }));
};

/** Falha SOAP (Fault) ou documento sem o retorno esperado. */
export class ErroRespostaEsocial extends Error {}

function corpoDaResposta(xml: string, retorno: string): NoLido {
  const doc = lerXml(xml);
  const fault = buscar(doc, 'Fault');
  if (fault)
    throw new ErroRespostaEsocial(
      `O serviço do eSocial recusou a chamada: ${(textoDe(fault, 'faultstring') ?? 'falha SOAP').slice(0, 200)}.`,
    );
  const r = buscar(doc, retorno);
  if (!r) throw new ErroRespostaEsocial('Resposta do serviço do eSocial sem o retorno esperado.');
  return r;
}

export interface RespostaEnvioLote {
  readonly codigo: number;
  readonly descricao: string;
  /** Protocolo do envio (só com o lote recebido, código 201). */
  readonly protocolo: string | null;
  readonly ocorrencias: readonly Ocorrencia[];
}

export function lerRespostaEnvio(xml: string): RespostaEnvioLote {
  const r = corpoDaResposta(xml, 'retornoEnvioLoteEventos');
  const status = buscar(r, 'status');
  const codigo = Number(status ? textoDe(status, 'cdResposta') : NaN);
  if (!Number.isInteger(codigo)) throw new ErroRespostaEsocial('Resposta do envio sem o código de resposta.');
  const dados = buscar(r, 'dadosRecepcaoLote');
  return {
    codigo,
    descricao: (status && textoDe(status, 'descResposta')) ?? '',
    protocolo: dados ? textoDe(dados, 'protocoloEnvio') : null,
    ocorrencias: ocorrenciasDe(status),
  };
}

export interface RetornoEventoLido {
  readonly id: string;
  readonly codigo: number;
  readonly descricao: string;
  readonly recibo: string | null;
  readonly ocorrencias: readonly Ocorrencia[];
}

export interface RespostaConsultaLote {
  readonly codigo: number;
  readonly descricao: string;
  readonly ocorrencias: readonly Ocorrencia[];
  readonly eventos: readonly RetornoEventoLido[];
}

export function lerRespostaConsulta(xml: string): RespostaConsultaLote {
  const r = corpoDaResposta(xml, 'retornoProcessamentoLoteEventos');
  const status = filhosChamados(r, 'status')[0] ?? null;
  const codigo = Number(status ? textoDe(status, 'cdResposta') : NaN);
  if (!Number.isInteger(codigo))
    throw new ErroRespostaEsocial('Resposta da consulta sem o código de resposta.');
  const lista = buscar(r, 'retornoEventos');
  const eventos = (lista ? filhosChamados(lista, 'evento') : []).map((ev) => {
    const proc = buscar(ev, 'processamento');
    const recibo = buscar(ev, 'recibo');
    return {
      id: atributo(ev, 'Id') ?? '',
      codigo: Number(proc ? textoDe(proc, 'cdResposta') : NaN),
      descricao: (proc && textoDe(proc, 'descResposta')) ?? '',
      recibo: recibo ? textoDe(recibo, 'nrRecibo') : null,
      ocorrencias: ocorrenciasDe(proc),
    };
  });
  return {
    codigo,
    descricao: (status && textoDe(status, 'descResposta')) ?? '',
    ocorrencias: ocorrenciasDe(status),
    eventos,
  };
}

/** Lote ainda em processamento no eSocial (1xx). */
export const loteEmProcessamento = (codigo: number) => codigo >= 100 && codigo < 200;
/** Evento aceito pelo eSocial (201 sucesso; 202 sucesso com advertência) e com o recibo. */
export const eventoAceito = (e: RetornoEventoLido) => (e.codigo === 201 || e.codigo === 202) && !!e.recibo;
