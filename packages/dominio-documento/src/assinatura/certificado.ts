// Leitura do certificado X.509 ICP-Brasil (M49; regras 2 e 3; SBIS-31 a SBIS-34; DOC-ICP-04): número de série,
// vigência, KeyUsage, políticas e os "otherName" do SubjectAltName (o CPF do titular está no 2.16.76.1.3.1). Só a parte
// pública: a chave privada nunca chega ao servidor (regra 1). A cadeia e a revogação são conferidas pelo validador
// (validacao.ts) a partir do que o serviço isolado consultou.
import { ErroDer, lerDer, MARCA, oidDeBytes, textoDe, type NoDer } from './der.js';
import {
  OID_EXT_KEY_USAGE,
  OID_EXT_POLITICAS_CERTIFICADO,
  OID_EXT_SUBJECT_ALT_NAME,
  OID_PF_DADOS_TITULAR,
} from './oids.js';

export interface UsoDaChave {
  readonly assinaturaDigital: boolean;
  readonly naoRepudio: boolean;
}

export interface CertificadoLido {
  /** Número de série em hexadecimal (minúsculas, sem zeros à esquerda além de um). */
  readonly serie: string;
  readonly validoDe: Date;
  readonly validoAte: Date;
  /** null: o certificado não traz a extensão KeyUsage. */
  readonly usoDaChave: UsoDaChave | null;
  readonly politicas: readonly string[];
  /** otherName do SubjectAltName: OID → valor em texto (ICP-Brasil grava como OCTET STRING ou texto). */
  readonly outrosNomes: Readonly<Record<string, string>>;
}

const filhos = (n: NoDer | undefined, o: string): readonly NoDer[] => {
  if (!n?.filhos) throw new ErroDer(`Certificado malformado: ${o}.`);
  return n.filhos;
};

function data(n: NoDer): Date {
  const s = textoDe(n);
  let m: RegExpMatchArray | null;
  if (n.marca === 0x17 && (m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const a = Number(m[1]);
    return new Date(Date.UTC(a < 50 ? 2000 + a : 1900 + a, Number(m[2]) - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  }
  if (n.marca === 0x18 && (m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)))
    return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  throw new ErroDer('Data do certificado em formato não suportado.');
}

function usoDaChave(valor: NoDer): UsoDaChave {
  if (valor.marca !== MARCA.bitString || valor.conteudo.length < 2) throw new ErroDer('KeyUsage malformado.');
  const bits = valor.conteudo[1]!;
  return { assinaturaDigital: (bits & 0x80) !== 0, naoRepudio: (bits & 0x40) !== 0 };
}

function outrosNomes(valor: NoDer): Record<string, string> {
  const r: Record<string, string> = {};
  for (const g of filhos(valor, 'SubjectAltName')) {
    // otherName: [0] IMPLICIT SEQUENCE { type-id OID, [0] EXPLICIT valor }
    if (g.marca !== 0xa0 || !g.filhos) continue;
    const [tipo, explicito] = g.filhos;
    if (tipo?.marca !== MARCA.oid || explicito?.marca !== 0xa0 || !explicito.filhos?.[0]) continue;
    r[oidDeBytes(tipo.conteudo)] = textoDe(explicito.filhos[0]);
  }
  return r;
}

/** Lê o certificado DER (sem conferir a assinatura do emissor: isso é da cadeia, no validador). */
export function lerCertificado(der: Uint8Array): CertificadoLido {
  const raiz = lerDer(der);
  const tbs = filhos(raiz, 'Certificate')[0];
  const campos = filhos(tbs, 'TBSCertificate');
  let i = campos[0]?.marca === 0xa0 ? 1 : 0;
  const serial = campos[i++];
  if (serial?.marca !== MARCA.inteiro) throw new ErroDer('Certificado sem número de série.');
  i += 2; // algoritmo da assinatura e emissor
  const vigencia = filhos(campos[i++], 'Validity');
  i += 2; // titular e chave pública
  let uso: UsoDaChave | null = null;
  let politicas: string[] = [];
  let nomes: Record<string, string> = {};
  for (const c of campos.slice(i)) {
    if (c.marca !== 0xa3) continue;
    for (const ext of filhos(filhos(c, 'Extensions')[0], 'Extensions')) {
      const partes = filhos(ext, 'Extension');
      const id = oidDeBytes(partes[0]!.conteudo);
      const corpo = partes[partes.length - 1]!;
      if (corpo.marca !== MARCA.octetos) throw new ErroDer('Extensão sem OCTET STRING.');
      const valor = lerDer(corpo.conteudo);
      if (id === OID_EXT_KEY_USAGE) uso = usoDaChave(valor);
      else if (id === OID_EXT_POLITICAS_CERTIFICADO)
        politicas = filhos(valor, 'CertificatePolicies').map((p) =>
          oidDeBytes(filhos(p, 'Policy')[0]!.conteudo),
        );
      else if (id === OID_EXT_SUBJECT_ALT_NAME) nomes = outrosNomes(valor);
    }
  }
  const serie = Buffer.from(serial.conteudo)
    .toString('hex')
    .replace(/^(00)+(?=..)/, '');
  return {
    serie,
    validoDe: data(vigencia[0]!),
    validoAte: data(vigencia[1]!),
    usoDaChave: uso,
    politicas,
    outrosNomes: nomes,
  };
}

// ── CPF do titular (regra 2; SBIS-31) ───────────────────────────────────────────────────────────────────────

/** Dígitos verificadores do CPF (módulo 11). */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split('').map(Number);
  const dv = (n: number) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === d[9] && dv(10) === d[10];
}

/** Só os dígitos, com zeros à esquerda (o cadastro guarda o CPF como número). */
export function normalizarCpf(v: string | number | bigint | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\D/g, '');
  if (s === '' || /^0+$/.test(s) || s.length > 11) return null;
  return s.padStart(11, '0');
}

/** CPF do titular no otherName 2.16.76.1.3.1 (posições 9 a 19, depois da data de nascimento); null se ausente ou zerado. */
export function cpfDoCertificado(c: Pick<CertificadoLido, 'outrosNomes'>): string | null {
  const v = c.outrosNomes[OID_PF_DADOS_TITULAR];
  if (!v || v.length < 19) return null;
  const cpf = v.slice(8, 19);
  return /^\d{11}$/.test(cpf) && cpfValido(cpf) ? cpf : null;
}

export type ConferenciaCpf =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: 'certificado-sem-cpf' | 'usuario-sem-cpf' | 'cpf-divergente' };

/**
 * Regra 2: o CPF do certificado tem de ser o do usuário da sessão, a cada uso. Comparação em tempo constante não é
 * necessária (nenhum dos dois é segredo), mas nenhum dos dois vai a log nem à mensagem de recusa.
 */
export function conferirCpf(
  certificado: Pick<CertificadoLido, 'outrosNomes'>,
  cpfDoUsuario: string | number | bigint | null,
): ConferenciaCpf {
  const doCert = cpfDoCertificado(certificado);
  if (!doCert) return { ok: false, motivo: 'certificado-sem-cpf' };
  const doUsuario = normalizarCpf(cpfDoUsuario);
  if (!doUsuario || !cpfValido(doUsuario)) return { ok: false, motivo: 'usuario-sem-cpf' };
  return doCert === doUsuario ? { ok: true } : { ok: false, motivo: 'cpf-divergente' };
}
