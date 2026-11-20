// Transmissor real do eSocial (M53.6, achado do corretor; ficha do M53, seção 1 e DP-10: "transmissão pronta e
// desligada, com o certificado como pré-requisito"; regra 3). Atrás da porta `TransmissorEsocial`: assina cada evento
// (XMLDSig com o A1), monta o envelope do lote, chama o serviço de envio por SOAP com TLS mútuo e consulta o retorno pelo
// protocolo. Sai completo e DESLIGADO (POL-3): só existe com AMBIENTE=producao, ESOCIAL_MODO=producao e o certificado
// conferido (`transmissorEsocialDoAmbiente`); fora disso o serviço recebe `null` com o motivo, e a tela mostra o motivo.
// Trava de ambiente em duas camadas: a trava de saídas do processo (trava-saidas, regra 3) e a deste construtor, que
// fora de `producao` só aceita endereço de loopback (o simulador local dos testes de contrato).
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as requestHttp } from 'node:http';
import { lerCertificadoEsocial, type CertificadoEsocial } from './certificado-esocial.js';
import {
  ACAO_CONSULTA,
  ACAO_ENVIO,
  envelopeConsultaLote,
  envelopeEnvioLote,
  ErroRespostaEsocial,
  lerRespostaConsulta,
  lerRespostaEnvio,
  type RespostaConsultaLote,
  type RespostaEnvioLote,
  URL_CONSULTA_PRODUCAO,
  URL_ENVIO_PRODUCAO,
} from './soap-esocial.js';
import { assinarEventoEsocial, conferirAssinaturaEvento } from './xmldsig.js';

export const TRANSMISSOR_ESOCIAL = Symbol('TRANSMISSOR_ESOCIAL');

export interface EventoParaTransmitir {
  /** O Id do evento (atributo `Id` do elemento do evento). */
  readonly id: string;
  /** O XML gravado (sem assinatura). */
  readonly xml: string;
}

export interface TransmissorEsocial {
  /** CNPJ do transmissor (o do certificado). */
  readonly cnpjTransmissor: string;
  enviarLote(x: {
    readonly grupo: 1 | 2 | 3;
    readonly empregador: string;
    readonly eventos: readonly EventoParaTransmitir[];
  }): Promise<RespostaEnvioLote>;
  consultarLote(protocolo: string): Promise<RespostaConsultaLote>;
}

/** Uma chamada SOAP: o endereço, a ação e o corpo; devolve o status HTTP e o corpo da resposta. */
export type TransporteSoap = (
  url: string,
  acao: string,
  corpo: string,
) => Promise<{ readonly status: number; readonly corpo: string }>;

export class ErroTransmissorEsocial extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1)$/i;
const TEMPO_LIMITE_MS = 60_000;
const TETO_RESPOSTA = 8 * 1024 * 1024;

/** Transporte HTTPS com TLS mútuo (o certificado do transmissor); `ca` só nos testes com o simulador local. */
export function transporteHttps(
  cert: CertificadoEsocial,
  opcoes: { readonly ca?: string } = {},
): TransporteSoap {
  return (url, acao, corpo) =>
    new Promise((resolver, rejeitar) => {
      const u = new URL(url);
      const fazer =
        u.protocol === 'https:'
          ? request
          : u.protocol === 'http:' && LOOPBACK.test(u.hostname)
            ? requestHttp
            : null;
      if (!fazer) {
        rejeitar(new ErroTransmissorEsocial('endereco-invalido', 'Endereço do serviço do eSocial inválido.'));
        return;
      }
      const req = fazer(
        u,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: `"${acao}"`,
            'Content-Length': Buffer.byteLength(corpo, 'utf8'),
          },
          ...(u.protocol === 'https:'
            ? { cert: cert.certificadoPem, key: cert.chavePem, ...(opcoes.ca ? { ca: opcoes.ca } : {}) }
            : {}),
          timeout: TEMPO_LIMITE_MS,
        },
        (res) => {
          const partes: Buffer[] = [];
          let total = 0;
          res.on('data', (b: Buffer) => {
            total += b.length;
            if (total > TETO_RESPOSTA) req.destroy(new Error('Resposta grande demais.'));
            else partes.push(b);
          });
          res.on('end', () =>
            resolver({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }),
          );
          res.on('error', rejeitar);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado.')));
      req.on('error', (e) =>
        rejeitar(
          new ErroTransmissorEsocial(
            'servico-inacessivel',
            `O serviço do eSocial não respondeu (${e.message.slice(0, 120)}). Tente de novo mais tarde.`,
          ),
        ),
      );
      req.end(corpo, 'utf8');
    });
}

export class TransmissorEsocialSoap implements TransmissorEsocial {
  readonly cnpjTransmissor: string;

  constructor(
    private readonly cert: CertificadoEsocial,
    private readonly opcoes: {
      readonly ambiente: string;
      readonly urlEnvio: string;
      readonly urlConsulta: string;
      readonly transporte?: TransporteSoap;
    },
  ) {
    for (const url of [opcoes.urlEnvio, opcoes.urlConsulta]) {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        throw new ErroTransmissorEsocial('endereco-invalido', 'Endereço do serviço do eSocial inválido.');
      }
      if (opcoes.ambiente !== 'producao' && !LOOPBACK.test(host))
        throw new ErroTransmissorEsocial(
          'fora-de-producao',
          'Fora de produção o transmissor do eSocial só fala com o simulador local (regra 3).',
        );
    }
    this.cnpjTransmissor = cert.cnpj;
  }

  private get transporte(): TransporteSoap {
    return this.opcoes.transporte ?? transporteHttps(this.cert);
  }

  private async chamar(url: string, acao: string, corpo: string): Promise<string> {
    const r = await this.transporte(url, acao, corpo);
    // O SOAP 1.1 devolve a falha com HTTP 500 e o Fault no corpo: a leitura da resposta traduz.
    if (r.status !== 200 && !(r.status === 500 && /Fault/.test(r.corpo)))
      throw new ErroTransmissorEsocial(
        'servico-indisponivel',
        `O serviço do eSocial respondeu ${r.status}. Tente de novo mais tarde.`,
      );
    return r.corpo;
  }

  async enviarLote(x: Parameters<TransmissorEsocial['enviarLote']>[0]): Promise<RespostaEnvioLote> {
    if (Date.now() > this.cert.validoAte.getTime())
      throw new ErroTransmissorEsocial(
        'certificado-vencido',
        `O certificado digital do eSocial venceu em ${this.cert.validoAte.toISOString().slice(0, 10)}.`,
      );
    const assinados = x.eventos.map((e) => {
      const xml = assinarEventoEsocial(e.xml, this.cert);
      const c = conferirAssinaturaEvento(xml);
      if (!c.ok)
        throw new ErroTransmissorEsocial('assinatura-invalida', `A assinatura do evento falhou: ${c.motivo}`);
      return { id: e.id, xml };
    });
    const corpo = envelopeEnvioLote({
      grupo: x.grupo,
      empregador: x.empregador,
      transmissor: this.cnpjTransmissor,
      eventos: assinados,
    });
    try {
      return lerRespostaEnvio(await this.chamar(this.opcoes.urlEnvio, ACAO_ENVIO, corpo));
    } catch (e) {
      if (e instanceof ErroRespostaEsocial) throw new ErroTransmissorEsocial('resposta-invalida', e.message);
      throw e;
    }
  }

  async consultarLote(protocolo: string): Promise<RespostaConsultaLote> {
    try {
      return lerRespostaConsulta(
        await this.chamar(this.opcoes.urlConsulta, ACAO_CONSULTA, envelopeConsultaLote(protocolo)),
      );
    } catch (e) {
      if (e instanceof ErroRespostaEsocial) throw new ErroTransmissorEsocial('resposta-invalida', e.message);
      throw e;
    }
  }
}

export type DisponibilidadeTransmissor =
  | { readonly transmissor: TransmissorEsocial; readonly motivo: null }
  | { readonly transmissor: null; readonly motivo: string };

/**
 * O transmissor real a partir do ambiente do processo, ou null com o motivo (POL-3: desligado até o certificado e a
 * autorização). Só em AMBIENTE=producao com ESOCIAL_MODO=producao; o certificado vem do cofre do servidor (D-CERT-536).
 */
export function transmissorEsocialDoAmbiente(
  env: Readonly<Record<string, string | undefined>>,
  agora: Date = new Date(),
  ler: (caminho: string) => string = (c) => readFileSync(c, 'utf8'),
): DisponibilidadeTransmissor {
  const ambiente = (env['AMBIENTE'] ?? 'dev').trim();
  const nada = (motivo: string): DisponibilidadeTransmissor => ({ transmissor: null, motivo });
  if (ambiente !== 'producao') return nada('Fora de produção os lotes vão ao coletor local.');
  if ((env['ESOCIAL_MODO'] ?? '').trim() !== 'producao')
    return nada('O envio ao serviço do eSocial não está habilitado neste servidor.');
  const certArq = env['ESOCIAL_CERTIFICADO_ARQUIVO']?.trim();
  const chaveArq = env['ESOCIAL_CHAVE_ARQUIVO']?.trim();
  if (!certArq || !chaveArq) return nada('O certificado digital do eSocial não está instalado no servidor.');
  let certificadoPem: string;
  let chavePem: string;
  try {
    certificadoPem = ler(certArq);
    chavePem = ler(chaveArq);
  } catch {
    return nada('O certificado digital do eSocial não pôde ser lido no servidor.');
  }
  const l = lerCertificadoEsocial(
    { certificadoPem, chavePem, senha: env['ESOCIAL_CHAVE_SENHA'] ?? null },
    agora,
  );
  if (!l.ok) return nada(l.motivo);
  return {
    transmissor: new TransmissorEsocialSoap(l.certificado, {
      ambiente,
      urlEnvio: env['ESOCIAL_ENVIO_URL']?.trim() || URL_ENVIO_PRODUCAO,
      urlConsulta: env['ESOCIAL_CONSULTA_URL']?.trim() || URL_CONSULTA_PRODUCAO,
    }),
    motivo: null,
  };
}
