// Identidade da pessoa do cadastro único (pessoa_fisica, a mesma do paciente do hospital), conferida pela operadora.
// Regra pura, sem banco:
//   - na inclusão, um CPF já cadastrado só é reaproveitado quando o nome e o nascimento digitados casam com a pessoa
//     encontrada (senão o CPF é de outra pessoa ou foi digitado errado);
//   - na alteração do beneficiário, a operadora não regrava os dados pessoais: a mudança deles vai pelo cadastro de
//     pessoas, com as regras e a trilha dele. A porta só aceita os dados pessoais iguais aos gravados.
// Melhoria: o cadastro único deixa de ser sobrescrito por uma tela de outro domínio (o beneficiário mostra a pessoa como
// ela está no cadastro, e o prontuário do paciente não muda pela operadora).

/** Os dados da pessoa como a tela do beneficiário os manda (sexo 'I' = não informado). */
export interface DadosPessoais {
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nascimento: string | null;
  readonly sexo: string;
  readonly nomeMae: string | null;
}

/** Nome comparável: sem acento, sem caixa e com um espaço só entre as palavras. */
export function nomeComparavel(n: string | null | undefined): string {
  return (n ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** O CPF encontrado é da pessoa digitada? Nome (comparável) e nascimento iguais; sem nascimento gravado, só o nome. */
export function mesmaPessoa(
  gravada: { readonly nome: string | null; readonly nascimento: string | null },
  digitada: { readonly nome: string; readonly nascimento: string | null },
): boolean {
  if (nomeComparavel(gravada.nome) !== nomeComparavel(digitada.nome)) return false;
  return gravada.nascimento === null || digitada.nascimento === null || gravada.nascimento === digitada.nascimento;
}

/** Os campos pessoais digitados que diferem dos gravados (vazio: nada mudou). */
export function camposPessoaisMudados(gravada: DadosPessoais, digitada: DadosPessoais): string[] {
  const so = (v: string | null) => (v ?? '').replace(/\D/g, '');
  const sexo = (v: string) => (v === '' ? 'I' : v);
  const mudou: string[] = [];
  if (nomeComparavel(gravada.nome) !== nomeComparavel(digitada.nome)) mudou.push('nome');
  if (nomeComparavel(gravada.nomeSocial) !== nomeComparavel(digitada.nomeSocial)) mudou.push('nomeSocial');
  if (so(gravada.cpf) !== so(digitada.cpf)) mudou.push('cpf');
  if (so(gravada.cns) !== so(digitada.cns)) mudou.push('cns');
  if ((gravada.nascimento ?? '') !== (digitada.nascimento ?? '')) mudou.push('nascimento');
  if (sexo(gravada.sexo) !== sexo(digitada.sexo)) mudou.push('sexo');
  if (nomeComparavel(gravada.nomeMae) !== nomeComparavel(digitada.nomeMae)) mudou.push('nomeMae');
  return mudou;
}
