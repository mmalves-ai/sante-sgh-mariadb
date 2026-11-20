// Nome conferido com o banco (ARQ-1): razão social e CNES lidos no próprio banco (TBHOSPIT, TBEMPHOS) e
// unidades (TBUNIDAD). Só identificação, CNES e nome: nunca as colunas de credencial, contato ou pessoa.
import type { CharsetLegado } from '@sgh/contratos';
import { lerTexto } from './codec.js';
import { charsetTextoDe } from './codec/charset.js';
import type { Leitor } from './transacao.js';

export interface UnidadeLegado {
  readonly codigo: number;
  readonly nome: string;
  readonly cnes: number | null;
}

export interface IdentificacaoBanco {
  /** TBHOSPIT.NOME */
  readonly nomeHospital: string | null;
  readonly cnesHospital: number | null;
  /** TBEMPHOS.NOME (razão social da empresa) */
  readonly razaoSocial: string | null;
  readonly cnesEmpresa: number | null;
  /** Até LIMITE_UNIDADES (as primeiras por código). */
  readonly unidades: readonly UnidadeLegado[];
  /** O banco tem mais unidades que o limite (lista cortada, não é falha de conexão). */
  readonly unidadesCortadas: boolean;
}

/** Unidades lidas na identificação; acima disso a lista é cortada e sinalizada. */
export const LIMITE_UNIDADES = 20;

const textoNo =
  (charsetBanco: CharsetLegado) =>
  (v: unknown): string | null =>
    typeof v === 'string'
      ? (lerTexto(v, { tipo: 'VARCHAR', charsetBanco })?.texto.trim() ?? null) || null
      : null;
const numero = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

export async function lerIdentificacao(leitor: Leitor): Promise<IdentificacaoBanco> {
  const texto = textoNo(charsetTextoDe(leitor.hospital));
  const opc = { teto: 1 };
  const [h] = await leitor.consultar('SELECT FIRST 1 h.NOME, h.CNES FROM TBHOSPIT h', [], opc);
  const [e] = await leitor.consultar('SELECT FIRST 1 e.NOME, e.CNES FROM TBEMPHOS e ORDER BY e.COD', [], opc);
  const u = await leitor.consultar(
    `SELECT FIRST ${LIMITE_UNIDADES + 1} u.COD, u.NOME, u.CNES FROM TBUNIDAD u ORDER BY u.COD`,
    [],
    { teto: LIMITE_UNIDADES + 1 },
  );
  return {
    nomeHospital: texto(h?.['NOME']),
    cnesHospital: numero(h?.['CNES']),
    razaoSocial: texto(e?.['NOME']),
    cnesEmpresa: numero(e?.['CNES']),
    unidadesCortadas: u.length > LIMITE_UNIDADES,
    unidades: u.slice(0, LIMITE_UNIDADES).map((r) => ({
      codigo: typeof r['COD'] === 'number' ? r['COD'] : 0,
      nome: texto(r['NOME']) ?? '',
      cnes: numero(r['CNES']),
    })),
  };
}

/** Comparação sem caixa, acento, pontuação e espaços repetidos. */
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// Sufixo societário no fim do nome (LTDA, S/A, ME, EPP, EIRELI), ignorado na comparação: o banco guarda a
// razão social ("HOSPITAL GERAL PRONTOCARDIO LTDA") e a tela mostra o nome ("Hospital Geral ProntoCardio").
const SUFIXO_SOCIETARIO = /(?: (?:LTDA|LIMITADA|S A|SA|ME|EPP|EIRELI|SLU))+$/;

function semSufixoSocietario(nomeNormalizado: string): string {
  return nomeNormalizado.replace(SUFIXO_SOCIETARIO, '');
}

/** O nome configurado (FB_<COD>_NOME) bate com o nome do hospital ou com a razão social do banco? */
export function nomeConfere(nomeConfigurado: string, id: IdentificacaoBanco): boolean {
  const alvo = semSufixoSocietario(normalizarNome(nomeConfigurado));
  return [id.nomeHospital, id.razaoSocial].some(
    (n) => n !== null && semSufixoSocietario(normalizarNome(n)) === alvo,
  );
}
