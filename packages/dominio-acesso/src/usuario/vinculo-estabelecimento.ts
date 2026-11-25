// Vínculo da conta ao estabelecimento (01-ADM L59): dar acesso a este estabelecimento a uma conta que já existe no
// cliente (a pessoa tem uma conta só, e não se cria outra) e encerrar esse acesso, sem I/O. A API consulta o banco,
// monta o fato e grava só o que estas funções deixam.
// Desenho próprio:
//   - vincular já deixa o perfil principal da conta neste estabelecimento, numa gravação só;
//   - conta bloqueada ou inativa não recebe acesso novo (primeiro se resolve a conta);
//   - encerrar fecha a vigência ontem (o histórico de quem teve acesso a qual estabelecimento não se apaga); o
//     vínculo que começou hoje é anulado por exclusão lógica (a linha fica no banco);
//   - ninguém encerra o próprio vínculo, e o último vínculo da conta não se encerra aqui: para tirar todo o acesso
//     existe o bloqueio da conta, que tem motivo e derruba as sessões;
//   - se o vínculo encerrado era o de entrada após o login, a entrada passa para o vínculo vigente mais antigo.

export type RecusaVinculoEstabelecimento =
  | 'usuario-inexistente'
  | 'conta-sem-acesso'
  | 'ja-vinculado'
  | 'grupo-inexistente'
  | 'grupo-inativo'
  | 'nao-vinculado'
  | 'proprio-vinculo'
  | 'unico-vinculo';

export const MENSAGEM_VINCULO_ESTABELECIMENTO: Readonly<Record<RecusaVinculoEstabelecimento, string>> = {
  'usuario-inexistente': 'Não há conta com este login neste cliente.',
  'conta-sem-acesso': 'A conta está bloqueada ou inativa: resolva a situação dela antes de dar acesso novo.',
  'ja-vinculado': 'A conta já tem acesso a este estabelecimento.',
  'grupo-inexistente': 'Escolha um grupo existente neste estabelecimento.',
  'grupo-inativo': 'O grupo escolhido está inativo.',
  'nao-vinculado': 'A conta não tem acesso a este estabelecimento.',
  'proprio-vinculo': 'Ninguém encerra o próprio acesso ao estabelecimento.',
  'unico-vinculo':
    'Este é o único estabelecimento da conta: para tirar todo o acesso, bloqueie a conta (com o motivo).',
};

/** O que a API apurou antes de dar o acesso. */
export interface FatoVinculoEstabelecimento {
  /** null: não há conta com o login. */
  readonly situacaoConta: string | null;
  readonly jaVinculada: boolean;
  /** null: o grupo não existe no estabelecimento. */
  readonly grupoAtivo: boolean | null;
}

export function conferirVinculoEstabelecimento(
  f: FatoVinculoEstabelecimento,
): RecusaVinculoEstabelecimento | null {
  if (f.situacaoConta === null) return 'usuario-inexistente';
  if (f.situacaoConta === 'bloqueado' || f.situacaoConta === 'inativo') return 'conta-sem-acesso';
  if (f.jaVinculada) return 'ja-vinculado';
  if (f.grupoAtivo === null) return 'grupo-inexistente';
  if (!f.grupoAtivo) return 'grupo-inativo';
  return null;
}

/** O que a API apurou antes de encerrar o acesso. */
export interface FatoEncerramentoVinculo {
  /** Início da vigência do vínculo vigente (AAAA-MM-DD); null: a conta não tem vínculo vigente aqui. */
  readonly inicio: string | null;
  readonly hoje: string;
  /** Quem encerra é a própria conta. */
  readonly proprio: boolean;
  /** Vínculos vigentes da conta em outros estabelecimentos. */
  readonly outrosVigentes: number;
}

export type PlanoEncerramentoVinculo =
  | { recusa: RecusaVinculoEstabelecimento }
  /** Fecha a vigência no dia anterior. */
  | { modo: 'fechar'; fim: string }
  /** Começou hoje: exclusão lógica (a linha fica no banco). */
  | { modo: 'anular' };

export function planoEncerramentoVinculo(f: FatoEncerramentoVinculo): PlanoEncerramentoVinculo {
  if (f.inicio === null) return { recusa: 'nao-vinculado' };
  if (f.proprio) return { recusa: 'proprio-vinculo' };
  if (f.outrosVigentes < 1) return { recusa: 'unico-vinculo' };
  if (f.inicio >= f.hoje) return { modo: 'anular' };
  const d = new Date(`${f.hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { modo: 'fechar', fim: d.toISOString().slice(0, 10) };
}
