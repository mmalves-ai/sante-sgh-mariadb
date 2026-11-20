// Regras de tela do M59-F3 (puras, testadas sem navegador): como a linha de um segredo de parceiro aparece (sem o
// nome da tabela, sem o valor), o que falta guardar no cofre antes da retirada, a situação da linha e as contagens
// em faixa. O servidor confere tudo de novo; isto só decide o que a tela oferece.
import { type LinhaSegredoLegado, segredoCatalogado } from '@sgh/contratos';

export type SituacaoLinhaSegredo = 'retirado' | 'pronto' | 'falta-cofre' | 'bloqueado';

/** "COD=12;ID=3" → "12 · 3" (só os valores da chave, na ordem do catálogo). */
export function valoresDaChave(chave: string): string {
  return chave
    .split(';')
    .map((p) => p.split('=').slice(1).join('='))
    .filter(Boolean)
    .join(' · ');
}

/** Como a linha se identifica na tela: a descrição (nome do convênio, do equipamento…) ou os valores da chave. */
export function identificacaoDaLinha(l: Pick<LinhaSegredoLegado, 'chave' | 'descricao'>): string {
  const d = l.descricao?.trim();
  const v = valoresDaChave(l.chave);
  return d ? `${d} (${v})` : v;
}

/** Colunas com valor guardado na tabela e ainda sem a credencial do Sante no cofre (ordem do catálogo). */
export function colunasSemCofre(l: Pick<LinhaSegredoLegado, 'tabela' | 'comValor' | 'noCofre'>): string[] {
  const ordem = segredoCatalogado(l.tabela)?.colunas ?? l.comValor;
  const noCofre = new Set(l.noCofre);
  return ordem.filter((c) => l.comValor.includes(c) && !noCofre.has(c));
}

/** Colunas de segredo da tabela (as que o gestor pode guardar no cofre). */
export const colunasDaTabela = (tabela: string): readonly string[] =>
  segredoCatalogado(tabela)?.colunas ?? [];

export function situacaoDaLinha(l: LinhaSegredoLegado): SituacaoLinhaSegredo {
  if (l.retiradoEm) return 'retirado';
  if (colunasSemCofre(l).length > 0) return 'falta-cofre';
  if (l.bloqueio) return 'bloqueado';
  return 'pronto';
}

/** A retirada só é oferecida a quem gere, com a linha pronta (o servidor confere de novo, na transação). */
export const podeRetirarLinha = (l: LinhaSegredoLegado, gere: boolean): boolean =>
  gere && situacaoDaLinha(l) === 'pronto';

/** Guardar no cofre: a quem gere, enquanto a linha não foi retirada. */
export const podeGuardarNaLinha = (l: LinhaSegredoLegado, gere: boolean): boolean => gere && !l.retiradoEm;

/** Contagem em faixa (abaixo de 5 vem "<5" do servidor) no formato brasileiro. */
export const fmtContagem = (n: number | '<5'): string => (n === '<5' ? n : n.toLocaleString('pt-BR'));

/** ISO com hora → dd/mm/aaaa hh:mm (hora local do servidor, como as demais telas de consulta). */
export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}
