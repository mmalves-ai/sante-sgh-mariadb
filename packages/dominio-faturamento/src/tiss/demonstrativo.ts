// Leitura do demonstrativo de análise de conta da operadora (M31; ficha, seção 5, `faturamento.importarDemonstrativo`;
// DP-33.8: importar o XML TISS quando a operadora fornece): do XML 04.03.00 (demonstrativoAnaliseConta) saem o número
// e a data do demonstrativo e cada item de cada guia (o número da guia do prestador, o sequencial, o procedimento, o
// valor informado, o liberado, a quantidade e o código da glosa). O nome do beneficiário que o XML traz NUNCA é lido.
// Sem dependência: o XML é lido por expressões sobre os elementos (com ou sem o prefixo do namespace).
import type { ItemDemonstrativo } from '@sgh/contratos';

export class ErroDemonstrativo extends Error {
  override readonly name = 'ErroDemonstrativo';
}

const tag = (nome: string) =>
  new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${nome}>`, 'g');
const valorDe = (xml: string, nome: string): string | null => {
  const r = tag(nome).exec(xml);
  return r ? r[1]!.replace(/<[^>]+>/g, '').trim() : null;
};
const blocos = (xml: string, nome: string): string[] => [...xml.matchAll(tag(nome))].map((m) => m[1]!);
const numero = (s: string | null): number => {
  const n = Number((s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export interface DemonstrativoLidoXml {
  readonly numero: string;
  readonly dataEmissao: string;
  readonly numeroLote: string | null;
  readonly protocolo: string | null;
  readonly itens: readonly ItemDemonstrativo[];
}

export function lerDemonstrativoXml(xml: string): DemonstrativoLidoXml {
  if (!/demonstrativoAnaliseConta/.test(xml))
    throw new ErroDemonstrativo('O arquivo não é um demonstrativo de análise de conta da TISS.');
  const cab = blocos(xml, 'cabecalhoDemonstrativo')[0] ?? '';
  const numeroDem = valorDe(cab, 'numeroDemonstrativo');
  const dataEmissao = valorDe(cab, 'dataEmissao');
  if (!numeroDem || !dataEmissao || !/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao))
    throw new ErroDemonstrativo('O cabeçalho do demonstrativo não tem o número e a data de emissão.');
  const itens: ItemDemonstrativo[] = [];
  let numeroLote: string | null = null;
  let protocolo: string | null = null;
  for (const p of blocos(xml, 'dadosProtocolo')) {
    numeroLote ??= valorDe(p, 'numeroLotePrestador');
    protocolo ??= valorDe(p, 'numeroProtocolo');
    for (const g of blocos(p, 'relacaoGuias')) {
      const guia = valorDe(g, 'numeroGuiaPrestador') ?? '';
      for (const d of blocos(g, 'detalhesGuia')) {
        const proc = blocos(d, 'procedimento')[0] ?? '';
        const glosas = blocos(d, 'relacaoGlosa');
        const motivo = glosas.length ? Math.trunc(numero(valorDe(glosas[0]!, 'tipoGlosa'))) : 0;
        itens.push({
          numeroGuia: guia.slice(0, 20),
          sequencial: Math.trunc(numero(valorDe(d, 'sequencialItem'))),
          codigoProcedimento: (valorDe(proc, 'codigoProcedimento') ?? '').slice(0, 20),
          valorInformado: numero(valorDe(d, 'valorInformado')),
          valorPago: numero(valorDe(d, 'valorLiberado')),
          quantidadePaga: numero(valorDe(d, 'qtdExecutada')),
          motivo,
        });
      }
    }
  }
  if (itens.length === 0) throw new ErroDemonstrativo('O demonstrativo não tem itens (detalhesGuia).');
  return { numero: numeroDem.slice(0, 20), dataEmissao, numeroLote, protocolo, itens };
}

/** Um demonstrativo SINTÉTICO de análise de conta (testes e simulador): os itens com o pago e a glosa. */
export function demonstrativoSinteticoXml(d: {
  numero: string;
  dataEmissao: string;
  numeroLote: string;
  protocolo: string;
  guias: readonly {
    numeroGuia: string;
    itens: readonly {
      sequencial: number;
      codigo: string;
      informado: number;
      liberado: number;
      quantidade: number;
      motivo: number;
    }[];
  }[];
}): string {
  const dinheiro = (v: number) => v.toFixed(2);
  const guias = d.guias
    .map(
      (g) =>
        `<ans:relacaoGuias><ans:numeroGuiaPrestador>${g.numeroGuia}</ans:numeroGuiaPrestador><ans:nomeBeneficiario>NAO LIDO</ans:nomeBeneficiario>${g.itens
          .map(
            (i) =>
              `<ans:detalhesGuia><ans:sequencialItem>${i.sequencial}</ans:sequencialItem><ans:dataRealizacao>${d.dataEmissao}</ans:dataRealizacao><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>${i.codigo}</ans:codigoProcedimento><ans:descricaoProcedimento>ITEM SINTETICO</ans:descricaoProcedimento></ans:procedimento><ans:valorInformado>${dinheiro(i.informado)}</ans:valorInformado><ans:qtdExecutada>${i.quantidade.toFixed(4)}</ans:qtdExecutada><ans:valorProcessado>${dinheiro(i.informado)}</ans:valorProcessado><ans:valorLiberado>${dinheiro(i.liberado)}</ans:valorLiberado>${
                i.motivo
                  ? `<ans:relacaoGlosa><ans:valorGlosa>${dinheiro(i.informado - i.liberado)}</ans:valorGlosa><ans:tipoGlosa>${i.motivo}</ans:tipoGlosa></ans:relacaoGlosa>`
                  : ''
              }</ans:detalhesGuia>`,
          )
          .join('')}</ans:relacaoGuias>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:operadoraParaPrestador><ans:demonstrativosRetorno><ans:demonstrativoAnaliseConta><ans:cabecalhoDemonstrativo><ans:registroANS>999999</ans:registroANS><ans:numeroDemonstrativo>${d.numero}</ans:numeroDemonstrativo><ans:nomeOperadora>OPERADORA SINTETICA</ans:nomeOperadora><ans:numeroCNPJ>00000000000000</ans:numeroCNPJ><ans:dataEmissao>${d.dataEmissao}</ans:dataEmissao></ans:cabecalhoDemonstrativo><ans:dadosConta><ans:dadosProtocolo><ans:numeroLotePrestador>${d.numeroLote}</ans:numeroLotePrestador><ans:numeroProtocolo>${d.protocolo}</ans:numeroProtocolo>${guias}</ans:dadosProtocolo></ans:dadosConta></ans:demonstrativoAnaliseConta></ans:demonstrativosRetorno></ans:operadoraParaPrestador></ans:mensagemTISS>`;
}
