// Simulador local do serviço do eSocial (M53.6, testes de contrato do transmissor real; nada sai da máquina): recebe o
// envelope SOAP do envio, confere a ação, o empregador, o transmissor, a assinatura XMLDSig de cada evento e o evento
// assinado no XSD oficial do leiaute, devolve o protocolo e, na consulta, o retorno de cada evento (recibo ou rejeição).
// Dados SINTÉTICOS.
import { esquemasDoLeiaute, validarEventoNoXsd } from '@sgh/dominio-pessoas';
import { ACAO_CONSULTA, ACAO_ENVIO } from './soap-esocial.js';
import type { TransporteSoap } from './transmissor-esocial.js';
import { atributo, buscar, filhosChamados, lerXml, nomeLocal, textoDe } from './xml-leitura.js';
import { canonizar, conferirAssinaturaEvento } from './xmldsig.js';

export interface LoteRecebido {
  readonly protocolo: string;
  readonly grupo: string;
  readonly empregador: string;
  readonly transmissor: string;
  readonly eventos: readonly { readonly id: string; readonly raiz: string; readonly xml: string }[];
}

const env = (corpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<s:Body>${corpo}</s:Body></s:Envelope>`;

export class SimuladorEsocial {
  readonly recebidos: LoteRecebido[] = [];
  /** Erros de assinatura ou de XSD dos eventos recebidos (vazio: tudo conforme o leiaute). */
  readonly problemas: string[] = [];
  /** Código da resposta do envio (201: lote recebido). */
  codigoEnvio = 201;
  /** Quantas consultas ainda respondem "em processamento" (101). */
  consultasEmProcessamento = 0;
  /** Id do evento → ocorrência de rejeição. */
  readonly rejeitar = new Map<string, { codigo: string; descricao: string }>();
  readonly acoes: string[] = [];
  /** Confere cada evento assinado no XSD oficial (desligue só para evento sintético incompleto). */
  validarXsd = true;
  private seq = 0;

  readonly transporte: TransporteSoap = async (_url, acao, corpo) => ({
    status: 200,
    corpo: await this.responder(acao, corpo),
  });

  async responder(acao: string, corpo: string): Promise<string> {
    this.acoes.push(acao);
    const doc = lerXml(corpo);
    if (acao === ACAO_ENVIO) return this.envio(doc);
    if (acao === ACAO_CONSULTA) return this.consulta(textoDe(doc, 'protocoloEnvio') ?? '');
    return env(
      '<s:Fault><faultcode>s:Client</faultcode><faultstring>Ação desconhecida</faultstring></s:Fault>',
    );
  }

  private async envio(doc: ReturnType<typeof lerXml>): Promise<string> {
    const lote = buscar(doc, 'envioLoteEventos');
    if (!lote) throw new Error('Envelope sem envioLoteEventos.');
    const eventos = filhosChamados(buscar(lote, 'eventos')!, 'evento').map((ev) => {
      const raiz = ev.filhos[0]!;
      const xml = canonizar(raiz);
      const nomeEvento = nomeLocal(raiz.filhos[0]!.nome);
      return { id: atributo(ev, 'Id') ?? '', raiz: nomeEvento, xml };
    });
    const esquemas = await esquemasDoLeiaute('v_S_01_03_00');
    for (const e of eventos) {
      const c = conferirAssinaturaEvento(e.xml);
      if (!c.ok) this.problemas.push(`${e.id}: ${c.motivo}`);
      if (!this.validarXsd) continue;
      const v = await validarEventoNoXsd(`<?xml version="1.0" encoding="UTF-8"?>${e.xml}`, e.raiz, esquemas);
      for (const erro of v.erros) this.problemas.push(`${e.id}: ${erro}`);
    }
    const protocolo = `1.2.202610.${String(++this.seq).padStart(19, '0')}`;
    if (this.codigoEnvio === 201)
      this.recebidos.push({
        protocolo,
        grupo: atributo(lote, 'grupo') ?? '',
        empregador: textoDe(buscar(lote, 'ideEmpregador')!, 'nrInsc') ?? '',
        transmissor: textoDe(buscar(lote, 'ideTransmissor')!, 'nrInsc') ?? '',
        eventos,
      });
    return env(
      `<EnviarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0">` +
        `<EnviarLoteEventosResult><eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoEnvio/v1_1_0">` +
        `<retornoEnvioLoteEventos><status><cdResposta>${this.codigoEnvio}</cdResposta>` +
        `<descResposta>${this.codigoEnvio === 201 ? 'Lote Recebido com Sucesso.' : 'Lote recusado.'}</descResposta>` +
        (this.codigoEnvio === 201
          ? ''
          : '<ocorrencias><ocorrencia><codigo>402</codigo><descricao>Empregador sem procuração.</descricao><tipo>1</tipo></ocorrencia></ocorrencias>') +
        `</status>` +
        (this.codigoEnvio === 201
          ? `<dadosRecepcaoLote><dhRecepcao>2026-10-28T10:00:00</dhRecepcao><versaoAplicativoRecepcao>1.0</versaoAplicativoRecepcao><protocoloEnvio>${protocolo}</protocoloEnvio></dadosRecepcaoLote>`
          : '') +
        `</retornoEnvioLoteEventos></eSocial></EnviarLoteEventosResult></EnviarLoteEventosResponse>`,
    );
  }

  private consulta(protocolo: string): string {
    const lote = this.recebidos.find((l) => l.protocolo === protocolo);
    const status = (c: number, d: string) =>
      `<status><cdResposta>${c}</cdResposta><descResposta>${d}</descResposta></status>`;
    const abre =
      `<ConsultarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0">` +
      `<ConsultarLoteEventosResult><eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoProcessamento/v1_3_0">` +
      `<retornoProcessamentoLoteEventos>`;
    const fecha = `</retornoProcessamentoLoteEventos></eSocial></ConsultarLoteEventosResult></ConsultarLoteEventosResponse>`;
    if (!lote) return env(`${abre}${status(501, 'Protocolo inexistente.')}${fecha}`);
    if (this.consultasEmProcessamento > 0) {
      this.consultasEmProcessamento -= 1;
      return env(`${abre}${status(101, 'Lote aguardando processamento.')}${fecha}`);
    }
    const eventos = lote.eventos
      .map((e, i) => {
        const r = this.rejeitar.get(e.id);
        const proc = r
          ? `<processamento><cdResposta>401</cdResposta><descResposta>Lote processado com erros.</descResposta>` +
            `<ocorrencias><ocorrencia><tipo>1</tipo><codigo>${r.codigo}</codigo><descricao>${r.descricao}</descricao></ocorrencia></ocorrencias></processamento>`
          : `<processamento><cdResposta>201</cdResposta><descResposta>Sucesso.</descResposta></processamento>` +
            `<recibo><nrRecibo>1.1.${String(i + 1).padStart(19, '0')}</nrRecibo><hash>AAAA</hash></recibo>`;
        return (
          `<evento Id="${e.id}"><retornoEvento><eSocial xmlns="http://www.esocial.gov.br/schema/evt/retornoEvento/v1_2_1">` +
          `<retornoEvento Id="${e.id}"><recepcao><tpAmb>1</tpAmb><protocoloEnvioLote>${protocolo}</protocoloEnvioLote></recepcao>` +
          `${proc}</retornoEvento></eSocial></retornoEvento></evento>`
        );
      })
      .join('');
    return env(
      `${abre}${status(201, 'Lote processado com sucesso.')}<retornoEventos>${eventos}</retornoEventos>${fecha}`,
    );
  }
}
