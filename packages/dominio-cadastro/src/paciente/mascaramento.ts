// Mascaramento e visibilidade (ficha do M11, regra 9; cap-08 §8.13): em LISTAS, CPF, telefone e endereço
// saem mascarados; o nome da mãe vira iniciais; na ficha, documentos só com `cadastro.paciente.verDocumento`
// e os dados sensíveis só com `cadastro.paciente.verSensivel`. O servidor mascara; a tela só exibe.
import { normalizarChave } from '@sgh/contratos';

/** Iniciais ("MARIA DA SILVA" → "M*** D*** S***"; sante-api, mascararNome). */
export function mascararNome(nome: string | null | undefined): string | null {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return partes.length === 0 ? null : partes.map((p) => `${p[0]}***`).join(' ');
}

/** "(**) *****-1234": só os 4 últimos dígitos. */
export function mascararTelefone(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? '').replace(/\D+/g, '');
  if (d.length < 4) return null;
  return `(**) *****-${d.slice(-4)}`;
}

/** Endereço em lista: só cidade e UF. */
export function enderecoDeLista(cidade: string | null, uf: string | null): string | null {
  const c = String(cidade ?? '').trim();
  const u = String(uf ?? '').trim();
  return c || u ? [c, u].filter(Boolean).join('/') : null;
}

export interface PermissoesFicha {
  readonly editar: boolean;
  readonly verDocumento: boolean;
  readonly verSensivel: boolean;
  readonly registrarConsentimento: boolean;
  readonly lerHistorico: boolean;
}

/** Permissões da ficha pela sessão (as mesmas regras CASL do servidor). */
export function permissoesDaFicha(pode: (codigo: string) => boolean): PermissoesFicha {
  return {
    editar: pode('cadastro.paciente.editar'),
    verDocumento: pode('cadastro.paciente.verDocumento'),
    verSensivel: pode('cadastro.paciente.verSensivel'),
    registrarConsentimento: pode('cadastro.consentimento.registrar'),
    lerHistorico: pode('cadastro.historico.ler'),
  };
}

/** Texto do legado para exibir: em branco e nulo viram null. */
export function textoOuNulo(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' ? null : t;
}

/** Nome comparável (homônimo): normalizado, sem acento. */
export function nomeComparavel(nome: string | null | undefined): string {
  return normalizarChave(nome);
}
