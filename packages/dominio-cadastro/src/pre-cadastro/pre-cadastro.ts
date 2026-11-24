// Pré-cadastro de quem marca sem prontuário (F3.1, 02-CAD linha 6): a central de marcação grava o mínimo (nome,
// nascimento, um telefone e, se houver, CPF e a fonte pagadora com a carteira) e, na chegada, a recepção converte o
// pré-cadastro em paciente: pelo CPF, reaproveita o paciente que já existe; sem ele, o paciente é cadastrado com os dados
// do pré-cadastro já preenchidos. Nada é apagado: o pré-cadastro fica "convertido", ligado ao paciente.
// Vocabulário neutro: ids, datas AAAA-MM-DD e texto.
import { cpfValido, somenteDigitos } from '../documento/cpf.js';

export interface PreCadastroProposto {
  readonly nome: string;
  readonly nascimento: string;
  readonly telefone?: string | null;
  readonly celular?: string | null;
  readonly cpf?: string | null;
  readonly fontePagadora?: number | null;
  readonly plano?: number | null;
  readonly numeroCarteira?: string | null;
}

export interface RecusaPreCadastro {
  readonly codigo: string;
  readonly campo: string;
  readonly mensagem: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const preenchido = (t: string | null | undefined): boolean => (t ?? '').trim().length > 0;

/** Confere o pré-cadastro no dia `hoje`; devolve as recusas (vazia quando pode gravar). */
export function conferirPreCadastro(p: PreCadastroProposto, hoje: string): RecusaPreCadastro[] {
  const r: RecusaPreCadastro[] = [];
  if ((p.nome ?? '').trim().split(/\s+/).filter(Boolean).length < 2)
    r.push({ codigo: 'nome-incompleto', campo: 'nome', mensagem: 'Informe nome e sobrenome.' });
  if (!DATA.test(p.nascimento ?? ''))
    r.push({ codigo: 'nascimento-invalido', campo: 'nascimento', mensagem: 'Data de nascimento inválida.' });
  else if (p.nascimento > hoje)
    r.push({
      codigo: 'nascimento-futuro',
      campo: 'nascimento',
      mensagem: 'A data de nascimento não pode ser no futuro.',
    });
  else if (Number(hoje.slice(0, 4)) - Number(p.nascimento.slice(0, 4)) > 130)
    r.push({ codigo: 'nascimento-invalido', campo: 'nascimento', mensagem: 'Data de nascimento inválida.' });
  const tel = somenteDigitos(p.telefone ?? '');
  const cel = somenteDigitos(p.celular ?? '');
  if (tel.length < 10 && cel.length < 10)
    r.push({
      codigo: 'contato-obrigatorio',
      campo: 'celular',
      mensagem: 'Informe um telefone com DDD para confirmar a marcação.',
    });
  if (preenchido(p.cpf) && !cpfValido(somenteDigitos(p.cpf ?? '')))
    r.push({ codigo: 'cpf-invalido', campo: 'cpf', mensagem: 'CPF inválido.' });
  if ((p.plano || preenchido(p.numeroCarteira)) && !p.fontePagadora)
    r.push({
      codigo: 'fonte-pagadora-obrigatoria',
      campo: 'fontePagadora',
      mensagem: 'Plano e carteira pedem a fonte pagadora.',
    });
  return r;
}

export interface CandidatoConversao {
  readonly id: number;
  readonly nascimento: string | null;
}

/** O paciente que a recepção escolheu na busca, com os dados que a conversão confere. */
export interface PacienteEscolhido extends CandidatoConversao {
  readonly nome: string;
  readonly cpf: string | null;
}

export type DecisaoConversao =
  | {
      readonly acao: 'vincular';
      readonly paciente: number;
      /** Dados que divergem entre o pré-cadastro e o paciente escolhido, ligados com o motivo informado. */
      readonly divergencias: readonly string[];
    }
  | { readonly acao: 'cadastrar' }
  | {
      readonly acao: 'recusar';
      readonly codigo: string;
      readonly mensagem: string;
      readonly divergencias?: readonly string[];
    };

/** Primeiro nome sem acento e sem caixa, para conferir se o escolhido é a mesma pessoa. */
function primeiroNome(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim()
      .split(/\s+/)[0] ?? ''
  );
}

/** Tamanho mínimo do motivo que confirma a ligação com dados divergentes. */
export const MOTIVO_DIVERGENCIA_MINIMO = 10;

/**
 * O que fazer com o pré-cadastro na chegada. `porCpf`: os pacientes com o CPF do pré-cadastro. `escolhido`: o paciente
 * que a recepção escolheu na busca. A escolha nunca passa sem conferência: o CPF do pré-cadastro de outro paciente
 * recusa sempre (a agenda e a cobertura iriam para outra pessoa); CPF, nascimento ou primeiro nome divergentes recusam
 * até a recepção confirmar com o motivo, que fica na trilha. Sem escolha: um só pelo CPF, com o mesmo nascimento,
 * reaproveita; CPF de paciente com outro nascimento recusa; nenhum, cadastrar com os dados do pré-cadastro.
 */
export function decidirConversao(
  pre: { readonly nascimento: string; readonly nome?: string | null; readonly cpf?: string | null },
  porCpf: readonly CandidatoConversao[],
  escolhido?: PacienteEscolhido | null,
  motivoDivergencia?: string | null,
): DecisaoConversao {
  if (escolhido) {
    if (porCpf.some((p) => p.id !== escolhido.id))
      return {
        acao: 'recusar',
        codigo: 'cpf-de-outro-paciente',
        mensagem: 'O CPF do pré-cadastro é de outro paciente: confira quem chegou antes de ligar.',
      };
    const divergencias: string[] = [];
    const cpfPre = somenteDigitos(pre.cpf ?? '');
    if (cpfPre && escolhido.cpf && somenteDigitos(escolhido.cpf) !== cpfPre) divergencias.push('cpf');
    if (escolhido.nascimento && escolhido.nascimento !== pre.nascimento) divergencias.push('nascimento');
    if (pre.nome && primeiroNome(pre.nome) !== primeiroNome(escolhido.nome)) divergencias.push('nome');
    if (divergencias.length > 0 && (motivoDivergencia ?? '').trim().length < MOTIVO_DIVERGENCIA_MINIMO)
      return {
        acao: 'recusar',
        codigo: 'dados-divergentes',
        mensagem: `O paciente escolhido diverge do pré-cadastro (${divergencias.join(', ')}): confira e, se for a mesma pessoa, informe o motivo.`,
        divergencias,
      };
    return { acao: 'vincular', paciente: escolhido.id, divergencias };
  }
  if (porCpf.length > 1)
    return {
      acao: 'recusar',
      codigo: 'cpf-em-varios-pacientes',
      mensagem: 'O CPF está em mais de um paciente: escolha o paciente (e trate a duplicidade).',
    };
  const [u] = porCpf;
  if (!u) return { acao: 'cadastrar' };
  if (u.nascimento && u.nascimento !== pre.nascimento)
    return {
      acao: 'recusar',
      codigo: 'cpf-com-outro-nascimento',
      mensagem: 'O CPF é de um paciente com outra data de nascimento: confira antes de ligar.',
    };
  return { acao: 'vincular', paciente: u.id, divergencias: [] };
}

/** Pacientes já cadastrados que o pré-cadastro parece repetir (pelo CPF, ou pelo nome com o nascimento). */
export interface SemelhancaPreCadastro {
  readonly porCpf: readonly number[];
  readonly porNomeNascimento: readonly number[];
}

/**
 * Antes de gravar o pré-cadastro: quem marca deve marcar no paciente que já existe. CPF de paciente cadastrado recusa
 * sempre; nome e nascimento iguais aos de um paciente recusam até quem marca confirmar que é outra pessoa (homônimo).
 */
export function conferirSemelhanca(
  s: SemelhancaPreCadastro,
  confirmadoOutraPessoa: boolean,
): RecusaPreCadastro | null {
  if (s.porCpf.length > 0)
    return {
      codigo: 'paciente-ja-cadastrado',
      campo: 'cpf',
      mensagem: `O CPF já é do paciente ${s.porCpf.join(', ')}: marque direto no paciente.`,
    };
  if (s.porNomeNascimento.length > 0 && !confirmadoOutraPessoa)
    return {
      codigo: 'paciente-semelhante',
      campo: 'nome',
      mensagem: `Já existe paciente com este nome e nascimento (${s.porNomeNascimento.join(', ')}): marque nele ou confirme que é outra pessoa.`,
    };
  return null;
}
