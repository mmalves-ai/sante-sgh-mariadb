// 02-AGE 42 e 44: marcação de consulta ou exame para quem ainda não tem prontuário. A central não abre cadastro
// completo ao telefone: grava o mínimo (nome, nascimento, um telefone) num pré-cadastro, liga a marcação a ele e,
// na chegada, a recepção converte o pré-cadastro em paciente (as marcações passam ao paciente na mesma transação).
// Melhoria: o mesmo pré-cadastro pendente é reaproveitado (mesmo nome, nascimento e telefone), para que duas
// marcações da mesma pessoa não virem dois pré-cadastros a converter; o telefone vai a celular ou fixo pela regra
// do número; a data de nascimento é conferida na hora (nem futura nem acima de 130 anos).

/** Dados mínimos da pessoa na marcação sem prontuário (vocabulário neutro: data ISO, telefone só com dígitos). */
export interface PessoaSemProntuario {
  readonly nome: string;
  readonly nascimento: string;
  readonly telefone: string;
}

/** Pré-cadastro pendente do estabelecimento, candidato ao reaproveitamento. */
export interface PreCadastroCandidato {
  readonly id: number;
  readonly nome: string;
  readonly nascimento: string;
  readonly telefone: string | null;
  readonly celular: string | null;
}

export type DecisaoPreCadastro =
  | { readonly ok: false; readonly codigo: string; readonly motivo: string; readonly campo: string }
  | {
      readonly ok: true;
      readonly acao: 'reaproveitar';
      readonly preCadastro: number;
    }
  | {
      readonly ok: true;
      readonly acao: 'criar';
      readonly nome: string;
      readonly telefone: string | null;
      readonly celular: string | null;
    };

const IDADE_MAXIMA_ANOS = 130;

/** Nome normalizado para comparar: espaços simples, maiúsculas, sem acento. */
export function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Celular brasileiro: 11 dígitos com o 9 depois do DDD (ou 13 com o 55 do país). */
export function ehCelular(digitos: string): boolean {
  const d = digitos.length === 13 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
  return d.length === 11 && d[2] === '9';
}

function anosEntre(nascimento: string, hoje: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ah, mh, dh] = hoje.split('-').map(Number) as [number, number, number];
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

/**
 * Decide o pré-cadastro da marcação: confere os dados mínimos e reaproveita o pendente da mesma pessoa (nome,
 * nascimento e o mesmo número em telefone ou celular) ou pede a criação, com o número no campo certo.
 */
export function decidirPreCadastroDaMarcacao(
  pessoa: PessoaSemProntuario,
  hoje: string,
  pendentes: readonly PreCadastroCandidato[],
): DecisaoPreCadastro {
  const nome = nomeComparavel(pessoa.nome);
  if (nome.length < 3 || !/[A-Z]/.test(nome))
    return {
      ok: false,
      codigo: 'nome-invalido',
      motivo: 'Informe o nome com ao menos 3 letras.',
      campo: 'nome',
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pessoa.nascimento))
    return {
      ok: false,
      codigo: 'nascimento-invalido',
      motivo: 'Informe a data de nascimento.',
      campo: 'nascimento',
    };
  if (pessoa.nascimento > hoje)
    return {
      ok: false,
      codigo: 'nascimento-futuro',
      motivo: 'A data de nascimento está no futuro.',
      campo: 'nascimento',
    };
  if (anosEntre(pessoa.nascimento, hoje) > IDADE_MAXIMA_ANOS)
    return {
      ok: false,
      codigo: 'nascimento-improvavel',
      motivo: `A data de nascimento dá mais de ${IDADE_MAXIMA_ANOS} anos: confira.`,
      campo: 'nascimento',
    };
  const fone = pessoa.telefone.replace(/\D/g, '');
  if (fone.length < 8 || fone.length > 15)
    return {
      ok: false,
      codigo: 'telefone-invalido',
      motivo: 'Informe um telefone com DDD (8 a 15 dígitos).',
      campo: 'telefone',
    };
  const mesmo = pendentes
    .filter(
      (c) =>
        nomeComparavel(c.nome) === nome &&
        c.nascimento === pessoa.nascimento &&
        (c.telefone === fone || c.celular === fone),
    )
    .sort((a, b) => a.id - b.id)[0];
  if (mesmo) return { ok: true, acao: 'reaproveitar', preCadastro: mesmo.id };
  const celular = ehCelular(fone);
  return { ok: true, acao: 'criar', nome, telefone: celular ? null : fone, celular: celular ? fone : null };
}
