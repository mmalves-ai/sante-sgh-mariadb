// Formulário gravado com o registro (PRCONTEVOL.EVOLUCAO_XML, UTF-8) e documento emitido da trilha documental
// (PRASSINATURA_DOC.DOCUMENTO_ORIGINAL: XML Windows-1252, comprimido pelo adaptador), no formato que o formulário
// de origem grava (medido na cópia `pc`, 800 registros recentes, só estrutura): `<evolucao id_evolucao id_prcabevol
// id_prtpcomp nomeComposicao="<tipo> - <modelo>" tipo="2">` (tipo 2 em 100%), sem prólogo, um `<componente>` por
// seção com resposta embaixo e por pergunta respondida (className, name, top, left, height, width,
// autopreenchido, alergico_ao_item, title, value); quebras CRLF dentro do valor. O documento repete o formulário
// com o cabeçalho congelado (hospital, paciente, atendimento, lançamento, identificação) e as listas em
// value_texto/Item0..n + Count. Os dois voltam iguais pelo leitor do M15 (layout da época e como emitido).
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import type { Apresentacao } from './colunas.js';
import { rtfDoCampo } from './rtf.js';

export function escaparXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ComponenteGravado {
  readonly classe: string;
  readonly nome: string;
  readonly topo: number;
  readonly esquerda: number;
  readonly altura: number;
  readonly largura: number;
  readonly autopreenchido: boolean;
  readonly titulo: string;
  /** Valor como o componente mostra (texto, ou RTF do texto formatado). */
  readonly valor: string;
  /** Itens da lista (documento emitido). */
  readonly itens: readonly string[] | null;
  readonly secao: boolean;
}

/** Componentes do registro na ordem da árvore: seções com resposta e perguntas respondidas. */
export function componentesDoRegistro(
  rep: Pick<RepresentacaoFormulario, 'itens'>,
  respondidos: ReadonlyMap<number, Apresentacao>,
  secoes: ReadonlySet<number>,
  autopreenchidos: ReadonlySet<number> = new Set(),
): ComponenteGravado[] {
  const r: ComponenteGravado[] = [];
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const i of itens) {
      const x = i['x-legacy'];
      const ap = respondidos.get(x.vinculo);
      const secao = secoes.has(x.vinculo);
      if (secao || ap) {
        const l = i.layout;
        r.push({
          classe: x.classe ?? '',
          nome: x.componente ?? `cmp${x.vinculo}`,
          topo: l?.topo ?? 0,
          esquerda: l?.esquerda ?? 0,
          altura: l?.altura ?? 0,
          largura: l?.largura ?? 0,
          autopreenchido: autopreenchidos.has(x.vinculo),
          titulo: i.texto,
          valor: !ap ? '' : ap.paragrafos ? rtfDoCampo(ap.paragrafos) : (ap.linha ?? ''),
          itens: ap?.itens ?? null,
          secao: secao && !ap,
        });
      }
      visitar(i.itens);
    }
  };
  visitar(rep.itens);
  return r;
}

export interface CabecalhoFormulario {
  readonly modelo: number;
  readonly registro: number;
  /** PREVOLUCAO.ID_PRTPCOMP e o nome do tipo (PRTPCOMP.NOME). */
  readonly tipoComposicao: number;
  readonly nomeTipoComposicao: string;
  readonly descricaoModelo: string;
}

function nomeComposicao(c: CabecalhoFormulario): string {
  return `${c.nomeTipoComposicao} - ${c.descricaoModelo}`;
}

/** XML do formulário gravado com o registro (EVOLUCAO_XML). */
export function xmlDoFormulario(c: CabecalhoFormulario, comps: readonly ComponenteGravado[]): string {
  const corpo = comps
    .map(
      (k) =>
        `<componente><className>${escaparXml(k.classe)}</className><name>${escaparXml(k.nome)}</name>` +
        `<top>${k.topo}</top><left>${k.esquerda}</left><height>${k.altura}</height><width>${k.largura}</width>` +
        `<autopreenchido>${k.autopreenchido ? 'T' : 'F'}</autopreenchido><alergico_ao_item>F</alergico_ao_item>` +
        `<title>${escaparXml(k.titulo)}</title><value>${escaparXml(k.valor)}</value></componente>`,
    )
    .join('');
  return (
    `<evolucao id_evolucao="${c.modelo}" id_prcabevol="${c.registro}" id_prtpcomp="${c.tipoComposicao}" ` +
    `nomeComposicao="${escaparXml(nomeComposicao(c))}" tipo="2">${corpo}</evolucao>`
  );
}

// ── Documento emitido ────────────────────────────────────────────────────────────────────────────────

/** Campo do cabeçalho do documento: nome da marca e valor (ou bloco aninhado). */
export type CampoDocumento = readonly [string, string | number | null | readonly CampoDocumento[]];

export interface CabecalhoDocumento {
  readonly hospital: readonly CampoDocumento[];
  readonly paciente: readonly CampoDocumento[];
  readonly atendimento: readonly CampoDocumento[];
  readonly lancamento: readonly CampoDocumento[];
}

const CRLF = '\r\n';

function blocoXml(campos: readonly CampoDocumento[], nivel: number): string {
  const tab = '\t'.repeat(nivel);
  return campos
    .filter(([, v]) => v !== null && v !== '')
    .map(([n, v]) =>
      Array.isArray(v)
        ? `${tab}<${n}>${CRLF}${blocoXml(v, nivel + 1)}${tab}</${n}>${CRLF}`
        : `${tab}<${n}>${escaparXml(String(v))}</${n}>${CRLF}`,
    )
    .join('');
}

/** XML do documento emitido (antes da compressão; Windows-1252 no prólogo, como o formulário de origem grava). */
export function xmlDoDocumento(
  cab: CabecalhoDocumento,
  form: CabecalhoFormulario,
  comps: readonly ComponenteGravado[],
): string {
  const t2 = '\t\t';
  const t3 = '\t\t\t';
  const componentes = comps
    .map((k) => {
      const linhas = [
        `${t2}<componente>`,
        `${t3}<className>${escaparXml(k.classe)}</className>`,
        `${t3}<name>${escaparXml(k.nome)}</name>`,
        `${t3}<top>${k.topo}</top>`,
        `${t3}<left>${k.esquerda}</left>`,
        `${t3}<height>${k.altura}</height>`,
        `${t3}<width>${k.largura}</width>`,
        `${t3}<title>${escaparXml(k.titulo)}</title>`,
      ];
      if (k.itens && k.itens.length > 0) {
        linhas.push(`${t3}<value_texto>`);
        k.itens.forEach((it, i) =>
          linhas.push(it === '' ? `${t3}\t<Item${i}/>` : `${t3}\t<Item${i}>${escaparXml(it)}</Item${i}>`),
        );
        linhas.push(`${t3}\t<Count>${k.itens.length}</Count>`, `${t3}</value_texto>`);
      }
      if (!k.secao) linhas.push(`${t3}<value>${escaparXml(k.valor)}</value>`);
      linhas.push(`${t2}</componente>`);
      return linhas.join(CRLF);
    })
    .join(CRLF);
  return (
    `<?xml version="1.0" encoding="Windows-1252" standalone="no"?>${CRLF}<documento>${CRLF}` +
    `\t<versaoXML>1</versaoXML>${CRLF}` +
    `\t<hospital>${CRLF}${blocoXml(cab.hospital, 2)}\t</hospital>${CRLF}` +
    `\t<paciente>${CRLF}${blocoXml(cab.paciente, 2)}\t</paciente>${CRLF}` +
    `\t<atendimento>${CRLF}${blocoXml(cab.atendimento, 2)}\t</atendimento>${CRLF}` +
    `\t<lancamento>${CRLF}${blocoXml(cab.lancamento, 2)}\t</lancamento>${CRLF}` +
    `\t<identificacao>${CRLF}` +
    `\t\t<id_prcabevol>${form.registro}</id_prcabevol>${CRLF}` +
    `\t\t<id_evolucao>${form.modelo}</id_evolucao>${CRLF}` +
    `\t\t<id_prtpcomp>${form.tipoComposicao}</id_prtpcomp>${CRLF}` +
    `\t\t<nomeComposicao>${escaparXml(nomeComposicao(form))}</nomeComposicao>${CRLF}` +
    `\t\t<tipo>2</tipo>${CRLF}` +
    `\t</identificacao>${CRLF}` +
    `\t<evolucao>${componentes ? `${componentes.replace(/^\t\t/, '')}${CRLF}\t` : ''}</evolucao></documento>${CRLF}`
  );
}

/**
 * M23: documento emitido de outros tipos de ato (receita 41, atestado 40, resultado lançado 54, solicitação de exame
 * agrupada 79): o mesmo cabeçalho (estabelecimento, paciente, atendimento, lançamento) e a parte do tipo depois dele
 * (`cauda`, na ordem em que o legado grava; campo vazio não sai).
 */
export function xmlDocumentoEmitido(cab: CabecalhoDocumento, cauda: readonly CampoDocumento[]): string {
  return (
    `<?xml version="1.0" encoding="Windows-1252" standalone="no"?>${CRLF}<documento>${CRLF}` +
    `\t<versaoXML>1</versaoXML>${CRLF}` +
    `\t<hospital>${CRLF}${blocoXml(cab.hospital, 2)}\t</hospital>${CRLF}` +
    `\t<paciente>${CRLF}${blocoXml(cab.paciente, 2)}\t</paciente>${CRLF}` +
    `\t<atendimento>${CRLF}${blocoXml(cab.atendimento, 2)}\t</atendimento>${CRLF}` +
    `\t<lancamento>${CRLF}${blocoXml(cab.lancamento, 2)}\t</lancamento>${CRLF}` +
    `${blocoXml(cauda, 1)}</documento>${CRLF}`
  );
}
