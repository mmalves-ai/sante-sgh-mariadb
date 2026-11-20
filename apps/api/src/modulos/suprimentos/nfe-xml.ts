// Pré-preenchimento da entrada pela NF-e (ficha do M28, seção 5): o arquivo XML enviado pelo usuário é LIDO (nada é
// gravado nem consultado fora): emitente, número, série, emissão e os itens (código e descrição do fornecedor,
// quantidade, unitário e os lotes do grupo de rastreabilidade). O de-para fornecedor × item é escolhido na tela.
// Consulta e manifestação na SEFAZ ficam desligadas fora de produção (pnpm ambiente:verificar).
import { ErroProblema } from '../../problema.filter.js';

export interface ItemDoXml {
  readonly codigoFornecedor: string;
  readonly descricao: string;
  readonly unidade: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly lotes: readonly { lote: string; validade: string; quantidade: number }[];
}

export interface NotaDoXml {
  readonly cnpjEmitente: string;
  readonly nomeEmitente: string;
  readonly numero: number;
  readonly serie: string;
  readonly emissao: string;
  readonly itens: readonly ItemDoXml[];
}

// Leitura linear, sem expressão com retrocesso (D-XML-28): uma varredura acha as aberturas e os fechos da marca e cada
// abertura casa com o primeiro fecho depois dela, em ponteiro único. Marca aberta sem fecho não reabre a busca.
const NOME = /[\w:.-]/;
const local = (n: string) => n.slice(n.lastIndexOf(':') + 1);
function blocos(xml: string, nome: string): string[] {
  const aberturas: { ini: number; conteudo: number }[] = [];
  const fechos: { ini: number; fim: number }[] = [];
  let maiorQue = -1;
  for (let i = xml.indexOf('<'); i !== -1; i = xml.indexOf('<', i + 1)) {
    const fecho = xml[i + 1] === '/';
    let j = fecho ? i + 2 : i + 1;
    const ini = j;
    while (j < xml.length && NOME.test(xml[j]!)) j++;
    if (local(xml.slice(ini, j)) !== nome) continue;
    if (fecho) {
      if (xml[j] === '>') fechos.push({ ini: i, fim: j + 1 });
      continue;
    }
    const c = xml[j];
    if (c !== '>' && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') continue;
    if (maiorQue < j) maiorQue = xml.indexOf('>', j);
    if (maiorQue === -1) break;
    aberturas.push({ ini: i, conteudo: maiorQue + 1 });
  }
  const r: string[] = [];
  let f = 0;
  let depois = 0;
  for (const a of aberturas) {
    if (a.ini < depois) continue;
    while (f < fechos.length && fechos[f]!.ini < a.conteudo) f++;
    const x = fechos[f];
    if (!x) break;
    r.push(xml.slice(a.conteudo, x.ini));
    depois = x.fim;
  }
  return r;
}
const tag = (xml: string, nome: string): string => {
  const m = blocos(xml, nome).find((b) => !b.includes('<'));
  return m === undefined ? '' : desescapar(m).trim();
};
const numero = (t: string): number => {
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
function desescapar(t: string): string {
  return t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function lerXmlNota(xml: string): NotaDoXml {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Arquivo recusado',
      'O XML tem declaração de entidade: não é lido.',
    );
  const ide = blocos(xml, 'ide')[0] ?? '';
  const emit = blocos(xml, 'emit')[0] ?? '';
  const nNF = numero(tag(ide, 'nNF'));
  if (!ide || !emit || nNF <= 0)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Arquivo não reconhecido',
      'O arquivo não parece uma NF-e (faltam a identificação ou o emitente).',
    );
  const itens = blocos(xml, 'det').map((d): ItemDoXml => {
    const prod = blocos(d, 'prod')[0] ?? d;
    return {
      codigoFornecedor: tag(prod, 'cProd').slice(0, 60),
      descricao: tag(prod, 'xProd').slice(0, 120),
      unidade: tag(prod, 'uCom').slice(0, 6),
      quantidade: numero(tag(prod, 'qCom')),
      valorUnitario: numero(tag(prod, 'vUnCom')),
      lotes: blocos(prod, 'rastro').map((r) => ({
        lote: tag(r, 'nLote').slice(0, 30),
        validade: tag(r, 'dVal').slice(0, 10),
        quantidade: numero(tag(r, 'qLote')),
      })),
    };
  });
  return {
    cnpjEmitente: tag(emit, 'CNPJ') || tag(emit, 'CPF'),
    nomeEmitente: tag(emit, 'xNome').slice(0, 120),
    numero: nNF,
    serie: tag(ide, 'serie').slice(0, 3) || '1',
    emissao: (tag(ide, 'dhEmi') || tag(ide, 'dEmi')).slice(0, 10),
    itens,
  };
}
