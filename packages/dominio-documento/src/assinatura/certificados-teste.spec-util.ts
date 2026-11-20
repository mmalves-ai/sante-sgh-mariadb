// Certificados de TESTE sintéticos (M49, regra 2): só a estrutura X.509 que o leitor percorre, montada com o
// codificador DER do motor. Nenhum certificado real, nenhum CPF de pessoa: o CPF é gerado de uma base fictícia com os
// dígitos verificadores calculados. A assinatura do emissor é lixo de propósito (a cadeia é do validador).
import {
  booleano,
  concatenar,
  contexto,
  inteiroSemSinal,
  MARCA,
  nulo,
  octetos,
  oid,
  sequencia,
  texto,
  tlv,
} from './der.js';
import {
  OID_EXT_KEY_USAGE,
  OID_EXT_POLITICAS_CERTIFICADO,
  OID_EXT_SUBJECT_ALT_NAME,
  OID_PF_DADOS_TITULAR,
  RAIZ_POLITICA_POR_TIPO,
} from './oids.js';

/** CPF sintético com dígitos verificadores válidos a partir de 9 dígitos de base. */
export function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

export const CPF_TESTE_A = cpfSintetico('900000001');
export const CPF_TESTE_B = cpfSintetico('900000002');

const utc = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return texto(
    0x17,
    `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
  );
};

const nome = (cn: string) => sequencia(tlv(MARCA.conjunto, sequencia(oid('2.5.4.3'), texto(MARCA.utf8, cn))));

const extensao = (id: string, valor: Uint8Array, critica = false) =>
  sequencia(oid(id), ...(critica ? [booleano(true)] : []), octetos(valor));

export interface OpcoesCertificadoTeste {
  readonly cpf?: string | null;
  readonly validoDe?: Date;
  readonly validoAte?: Date;
  /** Bits do KeyUsage no primeiro byte (0x80 assinatura digital, 0x40 não repúdio); null: sem a extensão. */
  readonly usoDaChave?: number | null;
  readonly politicas?: readonly string[];
  readonly serie?: Uint8Array;
}

export function certificadoTeste(o: OpcoesCertificadoTeste = {}): Uint8Array {
  const cpf = o.cpf === undefined ? CPF_TESTE_A : o.cpf;
  const exts: Uint8Array[] = [];
  if (o.usoDaChave !== null)
    exts.push(
      extensao(OID_EXT_KEY_USAGE, tlv(MARCA.bitString, Uint8Array.of(6, o.usoDaChave ?? 0xc0)), true),
    );
  exts.push(
    extensao(
      OID_EXT_POLITICAS_CERTIFICADO,
      sequencia(...(o.politicas ?? [`${RAIZ_POLITICA_POR_TIPO.A3}.12`]).map((p) => sequencia(oid(p)))),
    ),
  );
  if (cpf !== null) {
    // 2.16.76.1.3.1: nascimento (8) + CPF (11) + NIS (11) + RG (15) + órgão/UF (6), tudo sintético.
    const valor = `01011990${cpf}${'0'.repeat(11)}${'0'.repeat(15)}${'0'.repeat(6)}`;
    const outroNome = contexto(
      0,
      concatenar(oid(OID_PF_DADOS_TITULAR), contexto(0, octetos(new TextEncoder().encode(valor)))),
    );
    // e-mail (rfc822Name [1]) para provar que o leitor ignora o que não é otherName.
    exts.push(
      extensao(
        OID_EXT_SUBJECT_ALT_NAME,
        sequencia(outroNome, contexto(1, new TextEncoder().encode('teste@exemplo.invalid'), false)),
      ),
    );
  }
  const algoritmo = sequencia(oid('1.2.840.113549.1.1.11'), nulo());
  const tbs = sequencia(
    contexto(0, inteiroSemSinal(Uint8Array.of(2))),
    inteiroSemSinal(o.serie ?? Uint8Array.of(0x8a, 0x01, 0x02)),
    algoritmo,
    nome('AC TESTE SINTETICA'),
    sequencia(
      utc(o.validoDe ?? new Date('2026-01-01T00:00:00Z')),
      utc(o.validoAte ?? new Date('2028-01-01T00:00:00Z')),
    ),
    nome('TITULAR SINTETICO'),
    sequencia(
      sequencia(oid('1.2.840.113549.1.1.1'), nulo()),
      tlv(MARCA.bitString, Uint8Array.of(0, 1, 2, 3)),
    ),
    contexto(3, sequencia(...exts)),
  );
  return sequencia(tbs, algoritmo, tlv(MARCA.bitString, Uint8Array.of(0, 0xde, 0xad)));
}
