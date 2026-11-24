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

export type DecisaoConversao =
  | { readonly acao: 'vincular'; readonly paciente: number }
  | { readonly acao: 'cadastrar' }
  | { readonly acao: 'recusar'; readonly codigo: string; readonly mensagem: string };

/**
 * O que fazer com o pré-cadastro na chegada. `escolhido`: o paciente que a recepção escolheu (ou acabou de cadastrar);
 * `porCpf`: os pacientes com o mesmo CPF. Um só pelo CPF, com o mesmo nascimento: reaproveita. CPF de paciente com
 * outro nascimento: recusa (confira antes de ligar). Nenhum: cadastrar com os dados do pré-cadastro.
 */
export function decidirConversao(
  pre: { readonly nascimento: string },
  porCpf: readonly CandidatoConversao[],
  escolhido?: number | null,
): DecisaoConversao {
  if (escolhido) return { acao: 'vincular', paciente: escolhido };
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
  return { acao: 'vincular', paciente: u.id };
}
