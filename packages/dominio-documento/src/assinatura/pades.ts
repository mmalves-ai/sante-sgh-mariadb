// Assinatura PAdES do PDF/A emitido (M49, etapa 2; regras 1, 4 e 8; SBIS-35, SBIS-38, SBIS-42; ICP-05): o documento
// NÃO sai do servidor. O PDF/A que a prévia mostrou (o mesmo hash) recebe uma revisão incremental com o campo de
// assinatura (invisível: o selo visível já está no conteúdo da página) e o espaço do CMS; o resumo SHA-256 dos bytes
// cobertos pelo /ByteRange entra nos atributos assinados (contentType, messageDigest, signingCertificateV2 e, quando o
// deploy configura a política ICP-Brasil, o sigPolicyId); o HASH que vai ao provedor ou ao agente local é o desses
// atributos (o provedor devolve a assinatura PKCS#1 crua, D-RAW-49). O servidor monta o SignedData destacado
// (ETSI.CAdES.detached), com o carimbo do tempo da ACT como atributo não assinado (AD-RT: id-aa-signatureTimeStampToken
// sobre o valor da assinatura) e o grava no espaço reservado. Tudo determinístico: a mesma prévia, o mesmo instante e
// o mesmo certificado dão os mesmos atributos (o pedido guarda só os hashes; a volta remonta e confere).
// Só o leitor DER do motor e o SHA-256 do node; o PDF de origem é o do Gotenberg (tabela xref clássica).
import { createHash } from 'node:crypto';
import { derDoNo } from './cadeia.js';
import {
  concatenar,
  contexto,
  ErroDer,
  inteiroPequeno,
  lerDer,
  MARCA,
  nulo,
  octetos,
  oid,
  oidDeBytes,
  sequencia,
  tlv,
} from './der.js';
import { OID_ATR_RESUMO, OID_ATR_TIPO_CONTEUDO, OID_RSA, OID_SIGNED_DATA } from './icp-sintetica.js';
import { OID_SHA256 } from './oids.js';

export const OID_DADOS = '1.2.840.113549.1.7.1';
export const OID_ATR_CERTIFICADO_ASSINANTE_V2 = '1.2.840.113549.1.9.16.2.47';
export const OID_ATR_CARIMBO_ASSINATURA = '1.2.840.113549.1.9.16.2.14';
export const OID_ATR_POLITICA_ASSINATURA = '1.2.840.113549.1.9.16.2.15';

/** Espaço reservado para o CMS (em dígitos hexadecimais): certificado, cadeia e o token do carimbo cabem com folga. */
export const TAMANHO_CONTENTS_PADRAO = 32_768;
const LARGURA_BYTE_RANGE = 48;

export class ErroPades extends Error {
  override readonly name = 'ErroPades';
}

const sha256 = (b: Uint8Array) => Uint8Array.from(createHash('sha256').update(b).digest());
const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
const bytes = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

// ── Leitura mínima do PDF (tabela xref clássica) ─────────────────────────────────────────────────────────────

/** O fim do dicionário `<< … >>` que começa em `inicio` (cadeias literais e hexadecimais respeitadas). */
export function fimDoDicionario(s: string, inicio: number): number {
  if (s.slice(inicio, inicio + 2) !== '<<') throw new ErroPades('Dicionário esperado.');
  let nivel = 0;
  let i = inicio;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '(') {
      let p = 1;
      i++;
      while (i < s.length && p > 0) {
        if (s[i] === '\\') i += 2;
        else {
          if (s[i] === '(') p++;
          else if (s[i] === ')') p--;
          i++;
        }
      }
      continue;
    }
    if (c === '<' && s[i + 1] === '<') {
      nivel++;
      i += 2;
      continue;
    }
    if (c === '<') {
      const f = s.indexOf('>', i);
      if (f < 0) throw new ErroPades('Cadeia hexadecimal sem fim.');
      i = f + 1;
      continue;
    }
    if (c === '>' && s[i + 1] === '>') {
      nivel--;
      i += 2;
      if (nivel === 0) return i;
      continue;
    }
    i++;
  }
  throw new ErroPades('Dicionário sem fim.');
}

interface TrailerLido {
  readonly raiz: { num: number; ger: number };
  readonly tamanho: number;
  readonly info: string | null;
  readonly id: string | null;
  readonly xrefAnterior: number;
}

function lerTrailer(s: string): TrailerLido {
  const sx = s.lastIndexOf('startxref');
  if (sx < 0) throw new ErroPades('PDF sem startxref.');
  const xref = /startxref\s+(\d+)/.exec(s.slice(sx));
  if (!xref) throw new ErroPades('startxref ilegível.');
  const t = s.lastIndexOf('trailer', sx);
  if (t < 0) throw new ErroPades('PDF com xref em fluxo não suportado (só a tabela clássica).');
  const ini = s.indexOf('<<', t);
  const dic = s.slice(ini, fimDoDicionario(s, ini));
  const raiz = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(dic);
  const tamanho = /\/Size\s+(\d+)/.exec(dic);
  if (!raiz || !tamanho) throw new ErroPades('Trailer sem /Root ou /Size.');
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dic);
  const id = /\/ID\s*(\[[^\]]*\])/.exec(dic);
  return {
    raiz: { num: Number(raiz[1]), ger: Number(raiz[2]) },
    tamanho: Number(tamanho[1]),
    info: info ? info[1]!.replace(/\s+/g, ' ') : null,
    id: id ? id[1]!.replace(/\s+/g, ' ') : null,
    xrefAnterior: Number(xref[1]),
  };
}

/** O dicionário do objeto `num ger obj` (a última definição: revisões incrementais redefinem). */
function dicionarioDoObjeto(s: string, num: number, ger: number): string {
  const re = new RegExp(`(?:^|[\\s>])${num}\\s+${ger}\\s+obj\\b`, 'g');
  let ultimo = -1;
  for (let m = re.exec(s); m; m = re.exec(s)) ultimo = m.index + m[0].length;
  if (ultimo < 0) throw new ErroPades(`Objeto ${num} ${ger} não encontrado.`);
  const ini = s.indexOf('<<', ultimo);
  const antes = s.slice(ultimo, ini).trim();
  if (ini < 0 || antes !== '') throw new ErroPades(`Objeto ${num} ${ger} não é dicionário.`);
  return s.slice(ini, fimDoDicionario(s, ini));
}

function refDe(dic: string, chave: string): { num: number; ger: number } | null {
  const m = new RegExp(`/${chave}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(dic);
  return m ? { num: Number(m[1]), ger: Number(m[2]) } : null;
}

/** A primeira folha da árvore de páginas (a assinatura fica na primeira página). */
function primeiraPagina(s: string, paginas: { num: number; ger: number }): { num: number; ger: number } {
  let atual = paginas;
  for (let nivel = 0; nivel < 16; nivel++) {
    const d = dicionarioDoObjeto(s, atual.num, atual.ger);
    if (/\/Type\s*\/Page(?![s\w])/.test(d)) return atual;
    const kids = /\/Kids\s*\[\s*(\d+)\s+(\d+)\s+R/.exec(d);
    if (!kids) throw new ErroPades('Árvore de páginas sem /Kids.');
    atual = { num: Number(kids[1]), ger: Number(kids[2]) };
  }
  throw new ErroPades('Árvore de páginas funda demais.');
}

const semFim = (dic: string) => dic.slice(0, dic.lastIndexOf('>>'));

/** Data do PDF (D:AAAAMMDDHHmmSSZ, sempre em UTC). */
export function dataPdf(d: Date): string {
  return `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
}

export interface PdfPreparado {
  /** O PDF com a revisão incremental e o espaço do CMS (zeros). */
  readonly pdf: Uint8Array;
  readonly byteRange: readonly [number, number, number, number];
  /** SHA-256 dos bytes cobertos pelo /ByteRange (o messageDigest dos atributos assinados). */
  readonly resumo: Uint8Array;
}

/**
 * Acrescenta ao PDF/A a revisão incremental com o campo de assinatura (widget de área zero na primeira página, impressão
 * ligada e travado, como pede o PDF/A-2 para anotação sem aparência) e o /Sig com o espaço do CMS. Não muda nenhum byte
 * do original (a prévia exata continua sendo o começo do arquivo). Determinístico em `assinadoEm` e `nomeCampo`.
 */
export function prepararPades(
  original: Uint8Array,
  o: { readonly assinadoEm: Date; readonly nomeCampo?: string; readonly tamanhoContents?: number },
): PdfPreparado {
  const s = latin1(original);
  if (!s.startsWith('%PDF-')) throw new ErroPades('Não é PDF.');
  const tr = lerTrailer(s);
  const raiz = dicionarioDoObjeto(s, tr.raiz.num, tr.raiz.ger);
  if (/\/AcroForm/.test(raiz))
    throw new ErroPades('O documento já tem formulário (AcroForm): não é o emitido aqui.');
  const paginas = refDe(raiz, 'Pages');
  if (!paginas) throw new ErroPades('Catálogo sem /Pages.');
  const pag = primeiraPagina(s, paginas);
  const dicPagina = dicionarioDoObjeto(s, pag.num, pag.ger);
  const tamanhoContents = o.tamanhoContents ?? TAMANHO_CONTENTS_PADRAO;
  if (tamanhoContents % 2 !== 0 || tamanhoContents < 1024) throw new ErroPades('Espaço do CMS inválido.');
  const nome = (o.nomeCampo ?? 'Assinatura ICP-Brasil').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '');

  const nSig = tr.tamanho;
  const nWidget = tr.tamanho + 1;
  const objetos: { num: number; ger: number; corpo: string }[] = [];
  objetos.push({
    num: tr.raiz.num,
    ger: tr.raiz.ger,
    corpo: `${semFim(raiz)}/AcroForm <</Fields [${nWidget} 0 R] /SigFlags 3>>>>`,
  });
  const annots = /\/Annots\s*(\[|(\d+)\s+(\d+)\s+R)/.exec(dicPagina);
  if (!annots) {
    objetos.push({ num: pag.num, ger: pag.ger, corpo: `${semFim(dicPagina)}/Annots [${nWidget} 0 R]>>` });
  } else if (annots[1] === '[') {
    const ab = annots.index + annots[0].length;
    objetos.push({
      num: pag.num,
      ger: pag.ger,
      corpo: `${dicPagina.slice(0, ab)}${nWidget} 0 R ${dicPagina.slice(ab)}`,
    });
  } else {
    const nA = Number(annots[2]);
    const gA = Number(annots[3]);
    const re = new RegExp(`(?:^|[\\s>])${nA}\\s+${gA}\\s+obj\\s*(\\[[^\\]]*\\])`, 'g');
    let arr: string | null = null;
    for (let m = re.exec(s); m; m = re.exec(s)) arr = m[1]!;
    if (!arr) throw new ErroPades('Lista de anotações ilegível.');
    objetos.push({ num: nA, ger: gA, corpo: `${arr.slice(0, -1)} ${nWidget} 0 R]` });
  }
  const contentsVazio = '0'.repeat(tamanhoContents);
  const brVazio = '[0 0 0 0]'.padEnd(LARGURA_BYTE_RANGE, ' ');
  objetos.push({
    num: nSig,
    ger: 0,
    corpo:
      `<</Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange ${brVazio}` +
      ` /Contents <${contentsVazio}> /M (${dataPdf(o.assinadoEm)})>>`,
  });
  objetos.push({
    num: nWidget,
    ger: 0,
    corpo: `<</Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /F 132 /T (${nome}) /V ${nSig} 0 R /P ${pag.num} ${pag.ger} R>>`,
  });

  let texto = s.endsWith('\n') ? '' : '\n';
  let pos = original.length + texto.length;
  const offsets = new Map<number, number>();
  for (const ob of objetos) {
    const bloco = `${ob.num} ${ob.ger} obj\n${ob.corpo}\nendobj\n`;
    offsets.set(ob.num, pos);
    texto += bloco;
    pos += bloco.length;
  }
  const inicioXref = pos;
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  let xref = 'xref\n';
  for (const n of nums) {
    const ger = objetos.find((x) => x.num === n)!.ger;
    xref += `${n} 1\n${String(offsets.get(n)).padStart(10, '0')} ${String(ger).padStart(5, '0')} n\r\n`;
  }
  const trailer =
    `trailer\n<</Size ${tr.tamanho + 2} /Root ${tr.raiz.num} ${tr.raiz.ger} R` +
    `${tr.info ? ` /Info ${tr.info}` : ''}${tr.id ? ` /ID ${tr.id}` : ''} /Prev ${tr.xrefAnterior}>>\n` +
    `startxref\n${inicioXref}\n%%EOF\n`;
  texto += xref + trailer;
  const pdf = concatenar(original, bytes(texto));
  const sTudo = latin1(pdf);
  const marca = sTudo.lastIndexOf(`/Contents <${contentsVazio}>`);
  const inicioC = marca + '/Contents '.length;
  const fimC = inicioC + tamanhoContents + 2;
  const br: [number, number, number, number] = [0, inicioC, fimC, pdf.length - fimC];
  const brTexto = `[${br.join(' ')}]`.padEnd(LARGURA_BYTE_RANGE, ' ');
  const posBr = sTudo.lastIndexOf(`/ByteRange ${brVazio}`) + '/ByteRange '.length;
  pdf.set(bytes(brTexto), posBr);
  return { pdf, byteRange: br, resumo: resumoDoByteRange(pdf, br) };
}

export function resumoDoByteRange(
  pdf: Uint8Array,
  br: readonly [number, number, number, number],
): Uint8Array {
  return sha256(concatenar(pdf.subarray(br[0], br[0] + br[1]), pdf.subarray(br[2], br[2] + br[3])));
}

/** Grava o CMS (DER) no espaço reservado; o resto do arquivo não muda (o /ByteRange continua valendo). */
export function inserirCms(p: PdfPreparado, cms: Uint8Array): Uint8Array {
  const espaco = p.byteRange[2] - p.byteRange[1] - 2;
  const h = Buffer.from(cms).toString('hex').toUpperCase();
  if (h.length > espaco) throw new ErroPades('O CMS não cabe no espaço reservado.');
  const pdf = Uint8Array.from(p.pdf);
  pdf.set(bytes(h.padEnd(espaco, '0')), p.byteRange[1] + 1);
  return pdf;
}

/** Lê a última assinatura do PDF: o /ByteRange, o CMS (sem os zeros do fim) e o resumo dos bytes cobertos. */
export function lerAssinaturaPdf(pdf: Uint8Array): {
  readonly byteRange: readonly [number, number, number, number];
  readonly cms: Uint8Array;
  readonly resumo: Uint8Array;
  readonly cobreTudo: boolean;
} {
  const s = latin1(pdf);
  const i = s.lastIndexOf('/ByteRange');
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s.slice(i));
  if (i < 0 || !m) throw new ErroPades('PDF sem assinatura.');
  const br = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
  const hex = s.slice(br[1] + 1, br[2] - 1);
  if (!/^[0-9A-Fa-f]*$/.test(hex)) throw new ErroPades('Contents da assinatura ilegível.');
  const bruto = Uint8Array.from(Buffer.from(hex, 'hex'));
  // O CMS é um único elemento DER: o tamanho vem do cabeçalho (o resto é o preenchimento).
  const cms = bruto.subarray(0, tamanhoDer(bruto));
  return { byteRange: br, cms, resumo: resumoDoByteRange(pdf, br), cobreTudo: br[2] + br[3] === pdf.length };
}

function tamanhoDer(b: Uint8Array): number {
  const p = b[1];
  if (b[0] !== MARCA.sequencia || p === undefined) throw new ErroPades('CMS ilegível.');
  if (p < 0x80) return 2 + p;
  const n = p & 0x7f;
  let t = 0;
  for (let k = 0; k < n; k++) t = t * 256 + b[2 + k]!;
  return 2 + n + t;
}

// ── CMS (CAdES destacado) ────────────────────────────────────────────────────────────────────────────────────

const algSha256 = () => sequencia(oid(OID_SHA256), nulo());
const conjunto = (...xs: readonly Uint8Array[]) => {
  // DER: SET OF em ordem crescente das codificações.
  const ord = [...xs].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return tlv(MARCA.conjunto, concatenar(...ord));
};
const atributo = (id: string, valor: Uint8Array) => sequencia(oid(id), tlv(MARCA.conjunto, valor));

/** Emissor e série do certificado (DER exatos), para o IssuerAndSerialNumber e o ESSCertIDv2. */
export function emissorESerie(certificado: Uint8Array): { emissor: Uint8Array; serie: Uint8Array } {
  const raiz = lerDer(certificado);
  const tbs = raiz.filhos?.[0];
  const campos = tbs?.filhos;
  if (!campos) throw new ErroDer('Certificado malformado.');
  const i = campos[0]?.marca === 0xa0 ? 1 : 0;
  const serie = campos[i];
  const emissor = campos[i + 2];
  if (serie?.marca !== MARCA.inteiro || emissor?.marca !== MARCA.sequencia)
    throw new ErroDer('Certificado sem emissor ou série.');
  return { emissor: derDoNo(emissor), serie: derDoNo(serie) };
}

export interface PoliticaAssinaturaIdentificada {
  /** OID da política de assinatura ICP-Brasil (DOC-ICP-15.03), configurado pelo deploy. */
  readonly oid: string;
  /** SHA-256 do arquivo da política (LPA do ITI), em hexadecimal. */
  readonly hashSha256: string;
}

/**
 * Os atributos assinados (SET, DER) e o HASH que o provedor assina: SHA-256 do SET (RFC 5652 §5.4). Sem signingTime
 * (o PAdES usa o /M do dicionário da assinatura).
 */
export function atributosAssinados(d: {
  readonly resumo: Uint8Array;
  readonly certificado: Uint8Array;
  readonly politica?: PoliticaAssinaturaIdentificada | null;
}): { readonly der: Uint8Array; readonly hash: string } {
  if (d.resumo.length !== 32) throw new ErroPades('Resumo SHA-256 de 32 bytes.');
  const { emissor, serie } = emissorESerie(d.certificado);
  const essCertIdV2 = sequencia(
    octetos(sha256(d.certificado)),
    sequencia(sequencia(contexto(4, emissor)), serie),
  );
  const attrs: Uint8Array[] = [
    atributo(OID_ATR_TIPO_CONTEUDO, oid(OID_DADOS)),
    atributo(OID_ATR_RESUMO, octetos(d.resumo)),
    atributo(OID_ATR_CERTIFICADO_ASSINANTE_V2, sequencia(sequencia(essCertIdV2))),
  ];
  if (d.politica) {
    if (!/^[0-9a-f]{64}$/.test(d.politica.hashSha256)) throw new ErroPades('Hash da política inválido.');
    attrs.push(
      atributo(
        OID_ATR_POLITICA_ASSINATURA,
        sequencia(
          oid(d.politica.oid),
          sequencia(algSha256(), octetos(Uint8Array.from(Buffer.from(d.politica.hashSha256, 'hex')))),
        ),
      ),
    );
  }
  const der = conjunto(...attrs);
  return { der, hash: Buffer.from(sha256(der)).toString('hex') };
}

/** O TimeStampToken (ContentInfo) de dentro da resposta da ACT (TimeStampResp, RFC 3161 §2.4.2). */
export function tokenDaRespostaCarimbo(resposta: Uint8Array): Uint8Array {
  const r = lerDer(resposta);
  const token = r.filhos?.[1];
  if (!token || token.marca !== MARCA.sequencia) throw new ErroPades('Resposta do carimbo sem token.');
  return derDoNo(token);
}

/**
 * O SignedData destacado (ContentInfo, DER): os atributos assinados, a assinatura PKCS#1 crua do provedor, o
 * certificado do signatário com a cadeia e, em AD-RT, o carimbo do tempo como atributo não assinado.
 */
export function montarCms(d: {
  readonly atributos: Uint8Array;
  readonly assinatura: Uint8Array;
  readonly certificado: Uint8Array;
  readonly cadeia?: readonly Uint8Array[];
  /** Resposta inteira da ACT (TimeStampResp, como guardada em SGH_DOC_ASSINATURA.CARIMBO_TOKEN); null em AD-RB. */
  readonly carimbo?: Uint8Array | null;
}): Uint8Array {
  if (d.atributos[0] !== MARCA.conjunto) throw new ErroPades('Atributos assinados devem vir como SET.');
  const { emissor, serie } = emissorESerie(d.certificado);
  const naoAssinados = d.carimbo
    ? [contexto(1, atributo(OID_ATR_CARIMBO_ASSINATURA, tokenDaRespostaCarimbo(d.carimbo)))]
    : [];
  const signerInfo = sequencia(
    inteiroPequeno(1),
    sequencia(emissor, serie),
    algSha256(),
    tlv(0xa0, d.atributos.subarray(cabecalhoDer(d.atributos))),
    sequencia(oid(OID_RSA), nulo()),
    octetos(d.assinatura),
    ...naoAssinados,
  );
  const signed = sequencia(
    inteiroPequeno(1),
    tlv(MARCA.conjunto, algSha256()),
    sequencia(oid(OID_DADOS)),
    contexto(0, concatenar(d.certificado, ...(d.cadeia ?? []))),
    tlv(MARCA.conjunto, signerInfo),
  );
  return sequencia(oid(OID_SIGNED_DATA), contexto(0, signed));
}

function cabecalhoDer(b: Uint8Array): number {
  const p = b[1]!;
  return p < 0x80 ? 2 : 2 + (p & 0x7f);
}

/** Lê do CMS os atributos assinados (SET), a assinatura e o messageDigest (para a conferência no servidor). */
export function lerCms(cms: Uint8Array): {
  readonly atributos: Uint8Array;
  readonly assinatura: Uint8Array;
  readonly resumo: Uint8Array | null;
  readonly certificado: Uint8Array | null;
  readonly temCarimbo: boolean;
} {
  const ci = lerDer(cms);
  const sd = ci.filhos?.[1]?.filhos?.[0]?.filhos;
  if (!sd) throw new ErroPades('CMS sem SignedData.');
  const certs = sd.find((x) => x.marca === 0xa0);
  const si = sd[sd.length - 1]?.filhos?.[0]?.filhos;
  if (!si) throw new ErroPades('CMS sem SignerInfo.');
  const a = si.find((x) => x.marca === 0xa0);
  const assinatura = si.find((x, k) => x.marca === MARCA.octetos && k > 3);
  if (!a || !assinatura) throw new ErroPades('SignerInfo incompleto.');
  const atributos = tlv(MARCA.conjunto, a.conteudo);
  let resumo: Uint8Array | null = null;
  for (const at of a.filhos ?? []) {
    const [id, val] = at.filhos ?? [];
    if (id && oidDeBytes(id.conteudo) === OID_ATR_RESUMO) resumo = val?.filhos?.[0]?.conteudo ?? null;
  }
  const temCarimbo = si.some((x) => x.marca === 0xa1);
  return {
    atributos,
    assinatura: assinatura.conteudo,
    resumo,
    certificado: certs?.filhos?.[0] ? derDoNo(certs.filhos[0]) : null,
    temCarimbo,
  };
}
