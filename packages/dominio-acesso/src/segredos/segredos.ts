// M59-F3 (ficha do M59, seção 5, regras 1 e 7; cap-08 §8.11): regras puras da retirada dos segredos de parceiros e
// das senhas secundárias. A retirada só acontece com o período de contingência DESLIGADO (enquanto o sistema anterior
// puder ser religado, ele precisa do segredo), com a receita ligada e, para o segredo de parceiro, com a credencial do
// Sante no cofre para cada coluna que ainda tem valor (sem ela, o Sante perderia o acesso ao parceiro) e já rotacionada
// com o parceiro (ficha do M59, F3: "em envelope e rotacionado").
import { createHash } from 'node:crypto';
import {
  type BloqueioRetirada,
  COLUNAS_SENHA_SECUNDARIA,
  lerChaveDaLinha,
  referenciaSegredoLegado,
  segredoCatalogado,
} from '@sgh/contratos';

/** 16 hex do SHA-256 da chave da linha (vai na referência do cofre; a chave em claro fica só na tabela SGH_). */
export function resumoChave(tabela: string, chave: string): string {
  if (!lerChaveDaLinha(tabela, chave)) throw new Error('Chave da linha inválida.');
  return createHash('sha256').update(`${tabela}\u0000${chave}`).digest('hex').slice(0, 16);
}

/** Referência do cofre da coluna de segredo da linha. */
export const referenciaDaColuna = (hospital: string, tabela: string, chave: string, coluna: string): string =>
  referenciaSegredoLegado(hospital, tabela, resumoChave(tabela, chave), coluna);

export interface SituacaoLinhaSegredo {
  readonly tabela: string;
  readonly comValor: readonly string[];
  readonly noCofre: readonly string[];
  /** Colunas cuja credencial no cofre é a nova, já trocada com o parceiro (rotação feita). */
  readonly rotacionadas: readonly string[];
}

export interface CondicoesRetirada {
  readonly contingenciaLigada: boolean;
  readonly receitaLigada: boolean;
  readonly cofreDisponivel: boolean;
}

/**
 * Por que a linha ainda não pode perder o segredo antigo (null: pode). Ordem: nada a retirar; contingência; receita;
 * cofre; credencial do Sante faltando para alguma coluna com valor; rotação pendente (a credencial guardada é a mesma
 * de antes: o segredo antigo, que ficou em texto puro no banco e nos backups, continuaria valendo no parceiro).
 */
export function bloqueioRetiradaSegredo(
  l: SituacaoLinhaSegredo,
  c: CondicoesRetirada,
): BloqueioRetirada | null {
  const s = segredoCatalogado(l.tabela);
  if (!s) throw new Error(`Tabela sem segredo catalogado: ${l.tabela}`);
  const comValor = l.comValor.filter((x) => s.colunas.includes(x));
  if (comValor.length === 0) return 'sem-valor';
  if (c.contingenciaLigada) return 'contingencia-ativa';
  if (!c.receitaLigada) return 'operacao-desligada';
  if (!c.cofreDisponivel) return 'cofre-indisponivel';
  if (comValor.some((x) => !l.noCofre.includes(x))) return 'falta-no-cofre';
  if (comValor.some((x) => !l.rotacionadas.includes(x))) return 'rotacao-pendente';
  return null;
}

export type BloqueioSenhaSecundaria =
  'sem-valor' | 'contingencia-ativa' | 'operacao-desligada' | 'a-si-mesmo';

/** A retirada das senhas secundárias de um usuário: as mesmas condições, e ninguém retira as próprias. */
export function bloqueioRetiradaSenhaSecundaria(
  u: { readonly login: string; readonly colunas: readonly string[] },
  c: Omit<CondicoesRetirada, 'cofreDisponivel'> & { readonly operador: string },
): BloqueioSenhaSecundaria | null {
  const com = u.colunas.filter((x) => (COLUNAS_SENHA_SECUNDARIA as readonly string[]).includes(x));
  if (com.length === 0) return 'sem-valor';
  if (c.contingenciaLigada) return 'contingencia-ativa';
  if (!c.receitaLigada) return 'operacao-desligada';
  if (u.login === c.operador) return 'a-si-mesmo';
  return null;
}

/** Valor do parâmetro `legado.contingencia`: ausente ou qualquer coisa que não seja "não" = ligada (falha segura). */
export function contingenciaLigadaDoValor(valor: unknown): boolean {
  const v = (valor === null || valor === undefined ? '' : String(valor)).trim().toLowerCase();
  return !(v === 'nao' || v === 'não' || v === 'false' || v === 'f' || v === 'n');
}

/** Contagem para a tela: entre 1 e 4 vira '<5'. */
export const contagemProtegida = (n: number): number | '<5' => (n > 0 && n < 5 ? '<5' : n);
