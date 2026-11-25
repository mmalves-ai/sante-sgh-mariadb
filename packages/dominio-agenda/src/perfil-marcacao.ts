// Perfis de marcação (02-AGE linha 46): o que um grupo de usuários pode marcar, recortado por fonte pagadora,
// especialidade, setor, serviço (a agenda), profissional e unidade. Completa a trava da agenda (escopo do cargo por
// unidade e tipo de agenda, e a lista nominal da agenda restrita): o perfil diz O QUE o usuário marca.
// Regras (decisão do domínio):
//   - usuário sem perfil vigente que alcance a unidade fica no escopo atual, sem bloqueio (ADR 0002);
//   - com perfil, a marcação passa se ALGUM perfil vigente a aceita;
//   - um perfil aceita quando, em cada dimensão com recorte permitido, o alvo está no recorte (falha fechada: alvo sem
//     valor na dimensão não entra), e nenhum recorte de exceção (proibido) acerta o alvo;
//   - especialidade: a agenda atende uma ou mais; o recorte permitido pede ao menos uma delas, e a exceção acerta se
//     qualquer uma delas estiver proibida;
//   - unidade: o perfil vale na unidade dona; recortes de unidade estendem (ou trocam) as unidades alcançadas;
//   - encaixe só por perfil que o permita;
//   - perfil inativo, excluído ou fora da vigência do vínculo do usuário não conta;
//   - o administrador da plataforma pode tudo; processo automático do sistema (sem usuário) não passa pelo perfil.

export const DIMENSOES_PERFIL = [
  'fonte_pagadora',
  'especialidade',
  'setor',
  'agenda',
  'profissional',
  'estabelecimento',
] as const;
export type DimensaoPerfil = (typeof DIMENSOES_PERFIL)[number];

export const TIPOS_PERFIL = ['geral', 'central', 'ambulatorio', 'exame', 'portal'] as const;
export type TipoPerfil = (typeof TIPOS_PERFIL)[number];

export interface RecortePerfil {
  readonly dimensao: DimensaoPerfil;
  readonly alvo: number;
  /** Falso: exceção (o recorte proíbe). */
  readonly permitido: boolean;
}

export interface PerfilDoUsuario {
  readonly id: number;
  readonly codigo: string;
  /** Unidade dona do perfil. */
  readonly estabelecimento: number;
  readonly ativo: boolean;
  readonly permiteEncaixe: boolean;
  readonly recortes: readonly RecortePerfil[];
  /** Vigência do vínculo do usuário no perfil (AAAA-MM-DD; null = aberta). */
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

/** O que a marcação alcança. */
export interface AlvoMarcacao {
  readonly estabelecimento: number;
  readonly agenda: number;
  readonly fontePagadora: number;
  readonly setor: number | null;
  readonly profissional: number | null;
  readonly especialidades: readonly number[];
  readonly encaixe: boolean;
}

export type DecisaoPerfil =
  | {
      readonly ok: true;
      readonly motivo: 'sem-perfil' | 'administrador' | 'perfil';
      readonly perfil?: string;
    }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

const vigente = (p: PerfilDoUsuario, hoje: string): boolean =>
  p.ativo &&
  (p.vigenciaInicio === null || p.vigenciaInicio <= hoje) &&
  (p.vigenciaFim === null || p.vigenciaFim >= hoje);

/** O perfil alcança a unidade da marcação? */
export function perfilAlcancaUnidade(p: PerfilDoUsuario, estabelecimento: number): boolean {
  const un = p.recortes.filter((r) => r.dimensao === 'estabelecimento');
  if (un.some((r) => !r.permitido && r.alvo === estabelecimento)) return false;
  const permitidas = un.filter((r) => r.permitido).map((r) => r.alvo);
  return permitidas.length > 0 ? permitidas.includes(estabelecimento) : p.estabelecimento === estabelecimento;
}

function valores(a: AlvoMarcacao, d: DimensaoPerfil): readonly number[] {
  switch (d) {
    case 'fonte_pagadora':
      return [a.fontePagadora];
    case 'especialidade':
      return a.especialidades;
    case 'setor':
      return a.setor === null ? [] : [a.setor];
    case 'agenda':
      return [a.agenda];
    case 'profissional':
      return a.profissional === null ? [] : [a.profissional];
    case 'estabelecimento':
      return [a.estabelecimento];
  }
}

const NOME: Record<DimensaoPerfil, string> = {
  fonte_pagadora: 'convênio',
  especialidade: 'especialidade',
  setor: 'setor',
  agenda: 'agenda',
  profissional: 'profissional',
  estabelecimento: 'unidade',
};

const FEMININO = new Set<DimensaoPerfil>(['especialidade', 'agenda', 'estabelecimento']);

/** A dimensão em que o perfil recusa o alvo (null = o perfil aceita). */
export function dimensaoRecusada(p: PerfilDoUsuario, a: AlvoMarcacao): DimensaoPerfil | null {
  if (!perfilAlcancaUnidade(p, a.estabelecimento)) return 'estabelecimento';
  for (const d of DIMENSOES_PERFIL) {
    if (d === 'estabelecimento') continue;
    const rs = p.recortes.filter((r) => r.dimensao === d);
    if (rs.length === 0) continue;
    const v = valores(a, d);
    if (rs.some((r) => !r.permitido && v.includes(r.alvo))) return d;
    const perm = rs.filter((r) => r.permitido);
    if (perm.length > 0 && !perm.some((r) => v.includes(r.alvo))) return d;
  }
  return null;
}

/** Decide se o usuário pode fazer a marcação pelos seus perfis. */
export function decidirPerfilMarcacao(
  perfis: readonly PerfilDoUsuario[],
  alvo: AlvoMarcacao,
  hoje: string,
  administrador = false,
): DecisaoPerfil {
  if (administrador) return { ok: true, motivo: 'administrador' };
  const valem = perfis.filter((p) => vigente(p, hoje) && perfilAlcancaUnidade(p, alvo.estabelecimento));
  if (valem.length === 0) return { ok: true, motivo: 'sem-perfil' };
  const aceitam = valem.filter((p) => dimensaoRecusada(p, alvo) === null);
  if (aceitam.length === 0) {
    const d = dimensaoRecusada(valem[0]!, alvo)!;
    return {
      ok: false,
      codigo: 'fora-do-perfil-marcacao',
      mensagem: `Seu perfil de marcação não alcança ${FEMININO.has(d) ? 'esta' : 'este'} ${NOME[d]}: peça ao gestor de agendas a inclusão no perfil ou escolha outra opção.`,
    };
  }
  const comEncaixe = aceitam.find((p) => p.permiteEncaixe);
  if (alvo.encaixe && !comEncaixe)
    return {
      ok: false,
      codigo: 'perfil-sem-encaixe',
      mensagem:
        'Seu perfil de marcação não permite encaixe: marque numa vaga da grade ou peça a um supervisor.',
    };
  return { ok: true, motivo: 'perfil', perfil: (alvo.encaixe ? comEncaixe! : aceitam[0]!).codigo };
}

/** Recusa do cadastro (null = ok). */
export interface RecusaPerfil {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo?: string;
}

/** Validação dos recortes de um perfil (na tela, na hora, e no servidor, antes de gravar). */
export function validarRecortes(rs: readonly RecortePerfil[]): RecusaPerfil | null {
  const vistos = new Set<string>();
  for (const r of rs) {
    if (!DIMENSOES_PERFIL.includes(r.dimensao))
      return { codigo: 'recorte-invalido', mensagem: 'Tipo de recorte desconhecido.', campo: 'recortes' };
    if (!Number.isInteger(r.alvo) || r.alvo <= 0)
      return { codigo: 'recorte-sem-alvo', mensagem: 'Escolha o item do recorte.', campo: 'recortes' };
    const k = `${r.dimensao}:${r.alvo}`;
    if (vistos.has(k))
      return {
        codigo: 'recorte-repetido',
        mensagem: `O mesmo ${NOME[r.dimensao]} aparece duas vezes no perfil.`,
        campo: 'recortes',
      };
    vistos.add(k);
  }
  return null;
}

/** Validação do código e da descrição do perfil. */
export function validarPerfil(p: { codigo: string; descricao: string }): RecusaPerfil | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(p.codigo.trim()))
    return {
      codigo: 'codigo-invalido',
      mensagem: 'O código tem de 1 a 30 letras, números, ponto, hífen ou sublinhado.',
      campo: 'codigo',
    };
  if (p.descricao.trim().length < 3 || p.descricao.trim().length > 150)
    return {
      codigo: 'descricao-invalida',
      mensagem: 'A descrição tem de 3 a 150 caracteres.',
      campo: 'descricao',
    };
  return null;
}

/** Validação da vigência do vínculo do usuário (AAAA-MM-DD). */
export function validarVigencia(inicio: string | null, fim: string | null): RecusaPerfil | null {
  if (inicio !== null && fim !== null && fim < inicio)
    return {
      codigo: 'vigencia-invertida',
      mensagem: 'O fim da vigência é antes do início.',
      campo: 'vigenciaFim',
    };
  return null;
}
