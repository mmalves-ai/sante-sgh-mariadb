// Regras de emissão de documento (regra 9 da ficha do M09; cap-09 §9.8; roteiro 6.8): cada emissão é uma
// linha só de inclusão em SGH_DOCUMENTO_EMISSAO, com modelo e versão, objeto de origem (tipo + ID legado),
// via (1, 2, …), motivo da reemissão, SHA-256, chave no S3, identificador do QR, autor e carimbo.
// Reemissão é nova via marcada "2ª via" (ou "3ª via"…), nunca sobrescreve; o QR leva só o identificador.

export interface ObjetoOrigem {
  /** Tipo do objeto do legado (ex.: 'paciente', 'atendimento'); no spike, só objetos sintéticos. */
  readonly tipo: string;
  readonly idLegado: number;
}

export interface EmissaoDocumento {
  readonly id: string;
  readonly rede: string;
  readonly estabelecimento: string;
  readonly modelo: string;
  readonly versaoModelo: string;
  readonly origem: ObjetoOrigem;
  readonly via: number;
  /** ID da emissão original (via 1) quando esta é reemissão. */
  readonly idOriginal: string | null;
  readonly motivoReemissao: string | null;
  readonly sha256: string;
  readonly chaveObjeto: string;
  readonly identificadorQr: string;
  readonly autor: string;
  /** ISO 8601 em UTC (relógio da aplicação, TZ=UTC; o banco não tem DEFAULT de hora). */
  readonly emitidoEm: string;
  /**
   * `x-amz-version-id` do objeto gravado (null só enquanto a emissão está reservada). A leitura do PDF é
   * sempre por esta versão: um PUT posterior na mesma chave (o SeaweedFS ignora `If-None-Match`, ADR 0015)
   * cria outra versão "mais recente", que nunca é a do registro.
   */
  readonly versaoS3: string | null;
}

/** Via já ocupada para o mesmo original (unicidade (ID_ORIGINAL, VIA)): a reemissão tenta a próxima. */
export class ErroViaOcupada extends Error {
  override readonly name = 'ErroViaOcupada';
}

export class ErroEmissao extends Error {
  override readonly name = 'ErroEmissao';
}

/**
 * Tamanho máximo de cada segmento da chave, igual às colunas de SGH_DOCUMENTO_EMISSAO (REDE VARCHAR(63),
 * ESTABELECIMENTO VARCHAR(20), MODELO VARCHAR(40)); o teste do registro confere os dois lados.
 */
export const LIMITES_CHAVE = Object.freeze({ rede: 63, estabelecimento: 20, modelo: 40 });

const segmento = (max: number) => new RegExp(`^[a-z0-9][a-z0-9-]{0,${max - 1}}$`);

/** Chave no S3 (ARQ-2: com o código da rede): única por emissão e via; nunca reaproveitada. */
export function chaveObjeto(
  e: Pick<EmissaoDocumento, 'rede' | 'estabelecimento' | 'modelo' | 'id' | 'via'>,
): string {
  for (const [nome, v] of [
    ['rede', e.rede],
    ['estabelecimento', e.estabelecimento],
    ['modelo', e.modelo],
  ] as const) {
    if (!segmento(LIMITES_CHAVE[nome]).test(v))
      throw new ErroEmissao(`${nome} inválido para a chave do documento.`);
  }
  if (!/^[0-9a-f-]{36}$/.test(e.id)) throw new ErroEmissao('Identificador da emissão inválido.');
  if (!Number.isSafeInteger(e.via) || e.via < 1) throw new ErroEmissao('Via inválida.');
  return `${e.rede}/${e.estabelecimento}/documentos/${e.modelo}/${e.id}/via-${e.via}.pdf`;
}

/** Rótulo da via no documento: original sem marca; reemissão "2ª via", "3ª via"… */
export function rotuloVia(via: number): string | null {
  if (!Number.isSafeInteger(via) || via < 1) throw new ErroEmissao('Via inválida.');
  return via === 1 ? null : `${via}ª via`;
}

/** Próxima via de um documento: conta as emissões do mesmo original (a 1ª via inclusive). */
export function proximaVia(
  original: EmissaoDocumento,
  emissoesDoOriginal: readonly EmissaoDocumento[],
): number {
  if (original.via !== 1 || original.idOriginal !== null) throw new ErroEmissao('Reemissão parte da 1ª via.');
  const maior = Math.max(
    1,
    ...emissoesDoOriginal.filter((e) => e.idOriginal === original.id).map((e) => e.via),
  );
  return maior + 1;
}

export function exigirMotivo(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim();
  if (m.length < 5) throw new ErroEmissao('A reemissão exige motivo (mínimo de 5 caracteres).');
  if (m.length > 200) throw new ErroEmissao('Motivo da reemissão com mais de 200 caracteres.');
  return m;
}

export interface ValidacaoPublica {
  readonly existe: boolean;
  readonly emitidoEm?: string;
  readonly estabelecimento?: string;
  readonly sha256?: string;
  readonly via?: number;
}

/** Página pública do QR: existência, data, estabelecimento e hash; nada de conteúdo nem de origem. */
export function validacaoPublica(
  e: EmissaoDocumento | null,
  nomeEstabelecimento: (codigo: string) => string,
): ValidacaoPublica {
  if (!e) return { existe: false };
  return {
    existe: true,
    emitidoEm: e.emitidoEm,
    estabelecimento: nomeEstabelecimento(e.estabelecimento),
    sha256: e.sha256,
    via: e.via,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identificador opaco do QR (128 bits, base64url), sem relação com o ID interno. */
export function novoIdentificadorQr(
  aleatorio: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
): string {
  let s = '';
  for (const b of aleatorio(16)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
