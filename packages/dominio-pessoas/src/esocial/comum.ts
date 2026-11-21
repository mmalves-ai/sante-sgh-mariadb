// Partes comuns dos eventos do eSocial (M53-F5): o identificador do evento, a identificação do evento e do empregador, o
// envelope `eSocial` com o namespace do leiaute e a assinatura provisória que permite conferir o XSD antes da assinatura
// real (D-ASSINATURA-536, em xsd.ts). Regras puras: nenhum acesso a banco, relógio ou rede (o instante e a sequência
// vêm de quem chama).
import {
  definicaoEventoEsocial,
  type EmpregadorEsocial,
  type EventoEsocial,
  type LeiauteEsocial,
  type PendenciaEsocial,
} from '@sgh/contratos';
import { el, type NoXml, obrig, serializarDocumento } from './xml.js';

/** O contexto da geração: leiaute, ambiente, versão do aplicativo, instante e sequência do identificador. */
export interface ContextoEventoEsocial {
  readonly leiaute: LeiauteEsocial;
  /** tpAmb do evento: 1 produção, 2 produção restrita (o coletor usa 2: nada vai como produção fora dela). */
  readonly tpAmb: 1 | 2;
  /** Versão do aplicativo emissor (verProc, até 20 posições). */
  readonly verProc: string;
  /** Instante da geração, AAAA-MM-DDTHH:MM:SS (horário de Brasília, como o leiaute pede). */
  readonly instante: string;
  /** Sequência do identificador no mesmo segundo (1 a 99999). */
  readonly sequencia: number;
}

/** O empregador com os parâmetros vigentes e o CNPJ (14 posições) lido do cadastro da empresa. */
export interface EmpregadorParaEvento extends EmpregadorEsocial {
  readonly cnpj: string | null;
}

export type ResultadoEventoEsocial =
  | { readonly ok: true; readonly raiz: NoXml; readonly idEsocial: string; readonly dataReferencia: string }
  | { readonly ok: false; readonly pendencias: readonly PendenciaEsocial[] };

export const pendencia = (codigo: string, mensagem: string): PendenciaEsocial => ({ codigo, mensagem });

/** A raiz do CNPJ (8 posições): o empregador no eSocial (a pessoa jurídica, não o estabelecimento). */
export const raizCnpj = (cnpj: string): string => cnpj.slice(0, 8);

/**
 * O identificador do evento: "ID" + tipo de inscrição + inscrição do empregador com 14 posições (a raiz do CNPJ
 * completada com zeros à direita, como no S-1000) + data e hora em 14 dígitos (ano, mês, dia, hora, minuto e segundo) + sequência de 5 dígitos (36 posições).
 */
export function idEventoEsocial(nrInscEmpregador: string, instante: string, sequencia: number): string {
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 99_999)
    throw new Error('Sequência do identificador fora de 1 a 99999.');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(instante);
  if (!m) throw new Error('Instante no formato AAAA-MM-DDTHH:MM:SS.');
  return `ID1${nrInscEmpregador.padEnd(14, '0')}${m.slice(1).join('')}${String(sequencia).padStart(5, '0')}`;
}

/** Namespace do evento no leiaute (ex.: http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_03_00). */
export const namespaceEvento = (raiz: string, leiaute: LeiauteEsocial): string =>
  `http://www.esocial.gov.br/schema/evt/${raiz}/${leiaute}`;

export function ideEmpregador(cnpj: string): NoXml {
  return obrig('ideEmpregador', [obrig('tpInsc', 1), obrig('nrInsc', raizCnpj(cnpj))]);
}

/** A identificação do evento de tabela e de exclusão (sem retificação). */
export function ideEventoTabela(ctx: ContextoEventoEsocial): NoXml {
  return obrig('ideEvento', [obrig('tpAmb', ctx.tpAmb), obrig('procEmi', 1), obrig('verProc', ctx.verProc)]);
}

/** A identificação do evento do trabalhador: original (1) ou retificação (2, com o recibo do retificado). */
export function ideEventoTrabalhador(ctx: ContextoEventoEsocial, reciboRetificado: string | null): NoXml {
  return obrig('ideEvento', [
    obrig('indRetif', reciboRetificado ? 2 : 1),
    el('nrRecibo', reciboRetificado),
    obrig('tpAmb', ctx.tpAmb),
    obrig('procEmi', 1),
    obrig('verProc', ctx.verProc),
  ]);
}

/** O envelope `eSocial` com o evento (sem assinatura: a do envio entra na transmissão). */
export function envelope(
  evento: EventoEsocial,
  ctx: ContextoEventoEsocial,
  filhos: readonly (NoXml | null)[],
  id: string,
): NoXml {
  const { raiz } = definicaoEventoEsocial(evento);
  return obrig('eSocial', [obrig(raiz, filhos, { Id: id })], { xmlns: namespaceEvento(raiz, ctx.leiaute) });
}

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const vazio = (nome: string, atributos: Readonly<Record<string, string>>): NoXml => ({
  nome,
  atributos: Object.entries(atributos),
  filhos: [],
  texto: '',
});

/** Assinatura de forma válida e valores zerados, só para a conferência do XSD antes da assinatura real. */
export function assinaturaProvisoria(): NoXml {
  return obrig(
    'Signature',
    [
      obrig('SignedInfo', [
        vazio('CanonicalizationMethod', { Algorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' }),
        vazio('SignatureMethod', { Algorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' }),
        obrig(
          'Reference',
          [
            obrig('Transforms', [
              vazio('Transform', { Algorithm: `${DS}enveloped-signature` }),
              vazio('Transform', { Algorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' }),
            ]),
            vazio('DigestMethod', { Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' }),
            obrig('DigestValue', 'AAAA'),
          ],
          { URI: '' },
        ),
      ]),
      obrig('SignatureValue', 'AAAA'),
    ],
    { xmlns: DS },
  );
}

/** O XML gravado (sem assinatura). */
export const xmlDoEvento = (raiz: NoXml): string => serializarDocumento(raiz);

/** O XML para a conferência do XSD: o mesmo evento com a assinatura provisória no fim do envelope. */
export const xmlParaConferencia = (raiz: NoXml): string =>
  serializarDocumento({ ...raiz, filhos: [...raiz.filhos, assinaturaProvisoria()] });
