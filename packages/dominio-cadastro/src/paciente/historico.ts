// Linha do tempo do cadastro (ficha do M11, seção 4; versão do paciente e versão do profissional): cada versão do retrato do legado
// é comparada com a anterior e vira a lista de campos que mudaram (rótulo em português). As colunas sensíveis
// e os documentos seguem as mesmas permissões da ficha (sem a permissão, "restrito").
export interface CampoHistorico {
  readonly coluna: string;
  readonly campo: string;
  readonly rotulo: string;
  /** documento (verDocumento) ou sensivel (verSensivel). */
  readonly restricao?: 'documento' | 'sensivel';
}

export interface MudancaHistorico {
  readonly campo: string;
  readonly rotulo: string;
  readonly antes: string | null;
  readonly depois: string | null;
}

export const RESTRITO = 'restrito ao seu perfil';

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (v.getUTCFullYear() === 1899) return null;
    return v.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  return t === '' ? null : t;
}

/**
 * Mudanças entre duas versões (a primeira versão: todos os campos preenchidos, "antes" vazio). Valores de
 * campo restrito sem a permissão saem como "restrito ao seu perfil".
 */
export function mudancasEntreVersoes(
  anterior: Readonly<Record<string, unknown>> | null,
  atual: Readonly<Record<string, unknown>>,
  campos: readonly CampoHistorico[],
  permite: { readonly documento: boolean; readonly sensivel: boolean },
): MudancaHistorico[] {
  const r: MudancaHistorico[] = [];
  for (const c of campos) {
    const a = anterior ? texto(anterior[c.coluna]) : null;
    const d = texto(atual[c.coluna]);
    if (a === d) continue;
    const oculto =
      (c.restricao === 'documento' && !permite.documento) ||
      (c.restricao === 'sensivel' && !permite.sensivel);
    r.push({
      campo: c.campo,
      rotulo: c.rotulo,
      antes: oculto && a !== null ? RESTRITO : a,
      depois: oculto && d !== null ? RESTRITO : d,
    });
  }
  return r;
}
