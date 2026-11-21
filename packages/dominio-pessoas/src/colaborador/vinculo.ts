// Regra 1 do M52 (cap-07 §7.1.1): uma pessoa, vários vínculos. Colaborador, profissional de saúde e usuário de acesso
// apontam para a mesma pessoa; admitir um CPF já cadastrado reusa o profissional e o usuário existentes, nunca cria
// segunda pessoa. A API lê o que existe com o CPF (filtro exato), mostra a prévia, e a admissão confere que a prévia
// não mudou. Na cópia do pc, 697 dos 1.080 usuários com CPF têm profissional com o mesmo CPF; nenhum CPF repete
// dentro do cadastro de profissionais nem do de usuários.
import type { TipoVinculo } from '@sgh/contratos';

export interface VinculoExistente {
  readonly id: number;
  readonly tipo: TipoVinculo;
  /** Nulo: vínculo sem centro de custo (nunca é igual ao de outro vínculo). */
  readonly centroCusto: number | null;
  readonly cargo: string;
  readonly admissao: string;
  readonly desligamento: string | null;
}

/** O que existe com o CPF no estabelecimento (lido pela API: profissionais, usuários e vínculos de trabalho). */
export interface PessoaAchada {
  readonly profissionais: readonly { readonly id: number }[];
  readonly usuarios: readonly { readonly id: number; readonly bloqueado: boolean }[];
  readonly vinculos: readonly VinculoExistente[];
}

export interface PedidoAdmissao {
  readonly tipo: TipoVinculo;
  readonly admissao: string;
  readonly centroCusto: number;
  readonly cargaSemanalHoras: number;
  /** Da prévia mostrada na tela. */
  readonly profissional: number | null;
  readonly usuario: number | null;
}

export type RecusaAdmissao =
  'cpf-ambiguo' | 'previa-desatualizada' | 'vinculo-duplicado' | 'carga-acima-do-limite';

export type DecisaoAdmissao =
  | {
      readonly ok: true;
      readonly reusarProfissional: number | null;
      readonly reusarUsuario: number | null;
      /** A pessoa já tem outro vínculo ativo (regra 1: permitido, a tela avisa). */
      readonly outrosVinculosAtivos: readonly number[];
    }
  | { readonly ok: false; readonly recusa: RecusaAdmissao; readonly mensagem: string };

/**
 * Teto da carga semanal por tipo de vínculo, em horas: CLT e estatutário 44 (CF art. 7º, XIII), estagiário 30
 * (Lei 11.788/2008, art. 10), residente 60 (Lei 6.932/1981, art. 5º); cooperado, PJ e terceiro não têm jornada
 * contratada pelo hospital e ficam no teto do formulário. O tempo parcial é a regra 6, na F2.
 */
export function limiteCargaSemanal(tipo: TipoVinculo): number {
  switch (tipo) {
    case 'clt':
    case 'estatutario':
      return 44;
    case 'estagiario':
      return 30;
    default:
      return 60;
  }
}

export function vinculoAtivo(v: Pick<VinculoExistente, 'desligamento'>): boolean {
  return v.desligamento === null;
}

/** Decide a admissão a partir do que foi relido dentro da transação (regra 1). */
export function decidirAdmissao(pedido: PedidoAdmissao, achado: PessoaAchada): DecisaoAdmissao {
  if (achado.profissionais.length > 1 || achado.usuarios.length > 1)
    return {
      ok: false,
      recusa: 'cpf-ambiguo',
      mensagem:
        'Há mais de um cadastro com este CPF. Unifique os cadastros de profissional ou de usuário antes de admitir.',
    };
  const profissional = achado.profissionais[0]?.id ?? null;
  const usuario = achado.usuarios[0]?.id ?? null;
  if (profissional !== pedido.profissional || usuario !== pedido.usuario)
    return {
      ok: false,
      recusa: 'previa-desatualizada',
      mensagem: 'O cadastro desta pessoa mudou desde a consulta. Consulte o CPF de novo antes de admitir.',
    };
  const ativos = achado.vinculos.filter(vinculoAtivo);
  if (ativos.some((v) => v.tipo === pedido.tipo && v.centroCusto === pedido.centroCusto))
    return {
      ok: false,
      recusa: 'vinculo-duplicado',
      mensagem: 'A pessoa já tem um vínculo ativo deste tipo neste centro de custo.',
    };
  const limite = limiteCargaSemanal(pedido.tipo);
  if (pedido.cargaSemanalHoras > limite)
    return {
      ok: false,
      recusa: 'carga-acima-do-limite',
      mensagem: `A carga semanal deste tipo de vínculo vai até ${limite} horas.`,
    };
  return {
    ok: true,
    reusarProfissional: profissional,
    reusarUsuario: usuario,
    outrosVinculosAtivos: ativos.map((v) => v.id),
  };
}
