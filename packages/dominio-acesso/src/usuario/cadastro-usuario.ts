// Cadastro da conta no banco próprio (01-ADM L57 e L59): as regras de criar a conta, alterar o nome e o CPF, trocar o
// grupo (perfil principal) e conceder ou retirar escopo, sem I/O. A API consulta o banco, monta o fato e grava só o
// que estas funções deixam.
// Desenho próprio:
//   - criar a conta já deixa o vínculo ao estabelecimento da sessão e o perfil principal, numa gravação só (um passo,
//     não três telas); a conta nasce exigindo troca de senha;
//   - sem CPF, a conta nasce com a dispensa marcada e registrada na trilha (nunca CPF inventado);
//   - a troca do CPF já informado exige justificativa; o CPF de outra conta é recusado sem dizer de quem é;
//   - a troca de grupo fecha a vigência do perfil anterior (o histórico de quem teve qual perfil não se apaga). Se o
//     perfil anterior começou hoje, a própria linha é corrigida (a trilha guarda o valor anterior).

export type RecusaCadastroUsuario =
  | 'login-em-uso'
  | 'cpf-em-uso'
  | 'grupo-inexistente'
  | 'grupo-inativo'
  | 'nada-mudou'
  | 'justificativa-obrigatoria'
  | 'mesmo-grupo'
  | 'valor-inexistente'
  | 'ja-concedido'
  | 'nao-concedido';

export const MENSAGEM_CADASTRO_USUARIO: Readonly<Record<RecusaCadastroUsuario, string>> = {
  'login-em-uso': 'Este login já existe neste cliente: escolha outro.',
  'cpf-em-uso': 'Este CPF já está em outra conta. Cada pessoa tem uma conta só.',
  'grupo-inexistente': 'Escolha um grupo existente neste estabelecimento.',
  'grupo-inativo': 'O grupo escolhido está inativo.',
  'nada-mudou': 'Nada foi alterado.',
  'justificativa-obrigatoria': 'A troca do CPF já informado exige justificativa (pelo menos 10 caracteres).',
  'mesmo-grupo': 'O usuário já está neste grupo.',
  'valor-inexistente': 'Escolha um item existente e ativo neste estabelecimento.',
  'ja-concedido': 'O usuário já tem este acesso.',
  'nao-concedido': 'O usuário não tem este acesso.',
};

/** O que a API apurou antes de criar a conta. */
export interface FatoCriacaoUsuario {
  readonly loginEmUso: boolean;
  readonly cpfEmUso: boolean;
  /** null: o grupo não existe no estabelecimento. */
  readonly grupoAtivo: boolean | null;
}

export function conferirCriacaoUsuario(f: FatoCriacaoUsuario): RecusaCadastroUsuario | null {
  if (f.loginEmUso) return 'login-em-uso';
  if (f.cpfEmUso) return 'cpf-em-uso';
  if (f.grupoAtivo === null) return 'grupo-inexistente';
  if (!f.grupoAtivo) return 'grupo-inativo';
  return null;
}

/** Colunas da conta nova (sem carimbo nem id). */
export function contaNova(e: { login: string; nomeCompleto: string; cpf?: string | undefined }): {
  login: string;
  nome: string;
  cpf: string | null;
  dispensa_cpf: boolean;
  tipo_conta: 'pessoa';
  situacao: 'ativo';
  exige_troca_senha: boolean;
  origem: 'sistema';
} {
  const cpf = e.cpf ?? null;
  return {
    login: e.login.trim(),
    nome: e.nomeCompleto.trim(),
    cpf,
    dispensa_cpf: cpf === null,
    tipo_conta: 'pessoa',
    situacao: 'ativo',
    exige_troca_senha: true,
    origem: 'sistema',
  };
}

export interface FatoAlteracaoUsuario {
  readonly nomeAtual: string;
  readonly nomeNovo: string;
  readonly cpfAtual: string | null;
  /** undefined: o CPF não foi enviado (fica como está). */
  readonly cpfNovo: string | undefined;
  readonly justificativa: string | undefined;
  /** O CPF novo já está em outra conta. */
  readonly cpfDeOutraConta: boolean;
}

/** Recusa, ou as colunas que mudam (nome e, se for o caso, CPF e o fim da dispensa). */
export function planoAlteracaoUsuario(
  f: FatoAlteracaoUsuario,
): { recusa: RecusaCadastroUsuario } | { valores: Record<string, unknown>; trocouCpf: boolean } {
  const nome = f.nomeNovo.trim();
  const valores: Record<string, unknown> = {};
  if (nome !== f.nomeAtual) valores['nome'] = nome;
  const trocouCpf = f.cpfNovo !== undefined && f.cpfNovo !== f.cpfAtual;
  if (trocouCpf) {
    if (f.cpfDeOutraConta) return { recusa: 'cpf-em-uso' };
    if (f.cpfAtual !== null && (f.justificativa ?? '').trim().length < 10)
      return { recusa: 'justificativa-obrigatoria' };
    valores['cpf'] = f.cpfNovo;
    valores['dispensa_cpf'] = false;
  }
  if (Object.keys(valores).length === 0) return { recusa: 'nada-mudou' };
  return { valores, trocouCpf };
}

/** Como trocar o perfil principal: fechar a vigência do anterior ontem, ou corrigir a linha que começou hoje. */
export function planoTrocaGrupo(
  inicioAtual: string | null,
  hoje: string,
): { modo: 'novo' } | { modo: 'fechar'; fim: string } | { modo: 'corrigir' } {
  if (inicioAtual === null) return { modo: 'novo' };
  if (inicioAtual >= hoje) return { modo: 'corrigir' };
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { modo: 'fechar', fim: d.toISOString().slice(0, 10) };
}

/** Conceder ou retirar um escopo. */
export function conferirEscopo(f: {
  readonly conceder: boolean;
  readonly entidadeValida: boolean;
  readonly jaTem: boolean;
}): RecusaCadastroUsuario | null {
  if (f.conceder && !f.entidadeValida) return 'valor-inexistente';
  if (f.conceder && f.jaTem) return 'ja-concedido';
  if (!f.conceder && !f.jaTem) return 'nao-concedido';
  return null;
}
