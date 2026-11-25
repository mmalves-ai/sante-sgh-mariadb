// Central de regras de aviso clínico (F3.3, 03-PEP L133): a regra diz QUAL evento clínico (o tipo de aviso: valor
// crítico, resultado, pendência, acesso de emergência...), ONDE ele vale (todo o estabelecimento ou só um setor ou uma
// especialidade do evento), QUEM recebe (setor de lotação, especialidade, categoria profissional, perfil de acesso ou
// usuário) e POR ONDE (central de avisos do sistema, e-mail, ou os dois). Regras puras, sem banco:
//   - validarRegraAvisoClinico: o que a regra precisa para ser gravada (recusa nomeada);
//   - regraValeParaEvento: se a regra ativa e vigente cobre o evento (tipo, setor e especialidade do evento);
//   - destinatariosDoAviso: quem recebe cada aviso, sem repetir pessoa e canal entre regras, sem o autor do evento, e o
//     e-mail só para quem tem endereço;
//   - prioridadeDoAviso: a prioridade do tipo de aviso na escala do aviso (média = normal).
// O motor de regras de alerta da administração (regra_alerta) guarda a regra; o aviso nasce em aviso_clinico e
// aviso_clinico_destinatario (central de avisos do destinatário).

export const CANAIS_AVISO_CLINICO = ['sistema', 'email'] as const;
export type CanalAvisoClinico = (typeof CANAIS_AVISO_CLINICO)[number];

export const ALVOS_AVISO_CLINICO = [
  'setor',
  'especialidade',
  'categoria_profissional',
  'perfil',
  'usuario',
] as const;
export type AlvoAvisoClinico = (typeof ALVOS_AVISO_CLINICO)[number];

export const CATEGORIAS_TIPO_AVISO_CLINICO = [
  'acesso_emergencia',
  'ciclo_tratamento',
  'valor_critico',
  'pendencia',
  'resultado',
  'outro',
] as const;
export const PRIORIDADES_TIPO_AVISO_CLINICO = ['baixa', 'media', 'alta', 'critica'] as const;
export type PrioridadeTipoAvisoClinico = (typeof PRIORIDADES_TIPO_AVISO_CLINICO)[number];
export type PrioridadeAvisoClinico = 'baixa' | 'normal' | 'alta' | 'critica';

export type RecusaRegraAvisoClinico =
  | 'nome-vazio'
  | 'mensagem-vazia'
  | 'sem-evento'
  | 'sem-canal'
  | 'sem-destinatario'
  | 'destinatario-repetido'
  | 'vigencia-invertida'
  | 'tipo-codigo-invalido'
  | 'tipo-descricao-vazia';

export const MENSAGEM_REGRA_AVISO_CLINICO: Readonly<Record<RecusaRegraAvisoClinico, string>> = {
  'nome-vazio': 'Dê um nome à regra.',
  'mensagem-vazia': 'Escreva a mensagem padrão do aviso.',
  'sem-evento': 'Escolha o evento clínico (tipo de aviso) que dispara a regra.',
  'sem-canal': 'Escolha ao menos um canal: central de avisos ou e-mail.',
  'sem-destinatario': 'Escolha ao menos um destinatário: setor, especialidade, categoria, perfil ou usuário.',
  'destinatario-repetido': 'O mesmo destinatário aparece mais de uma vez na regra.',
  'vigencia-invertida': 'O fim da vigência é anterior ao início.',
  'tipo-codigo-invalido': 'O código do tipo de aviso usa letras minúsculas, números e sublinhado (até 30).',
  'tipo-descricao-vazia': 'Descreva o tipo de aviso.',
};

export interface AlvoRegraAvisoClinico {
  readonly tipo: AlvoAvisoClinico;
  readonly id: number;
}

export interface RegraAvisoClinicoEntrada {
  readonly nome: string;
  readonly mensagem: string;
  readonly tipoAviso: string | null;
  readonly canais: readonly CanalAvisoClinico[];
  readonly alvos: readonly AlvoRegraAvisoClinico[];
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** A regra pode ser gravada? Devolve a primeira recusa, ou nulo. */
export function validarRegraAvisoClinico(r: RegraAvisoClinicoEntrada): RecusaRegraAvisoClinico | null {
  if (!r.nome.trim()) return 'nome-vazio';
  if (!r.tipoAviso || !r.tipoAviso.trim()) return 'sem-evento';
  if (!r.mensagem.trim()) return 'mensagem-vazia';
  if (r.canais.length === 0) return 'sem-canal';
  if (r.alvos.length === 0) return 'sem-destinatario';
  const vistos = new Set<string>();
  for (const a of r.alvos) {
    const k = `${a.tipo}:${a.id}`;
    if (vistos.has(k)) return 'destinatario-repetido';
    vistos.add(k);
  }
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio) return 'vigencia-invertida';
  return null;
}

/** O tipo de aviso (o evento) pode ser gravado? */
export function validarTipoAvisoClinico(t: {
  codigo: string;
  descricao: string;
}): RecusaRegraAvisoClinico | null {
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(t.codigo)) return 'tipo-codigo-invalido';
  if (!t.descricao.trim()) return 'tipo-descricao-vazia';
  return null;
}

/** A regra como o motor a aplica (lida do banco). */
export interface RegraAvisoClinicoAplicavel {
  readonly id: number;
  readonly tipoAviso: string;
  /** Só eventos deste setor (nulo: qualquer setor). */
  readonly setorEvento: number | null;
  /** Só eventos desta especialidade (nulo: qualquer especialidade). */
  readonly especialidadeEvento: number | null;
  readonly ativa: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly canais: readonly CanalAvisoClinico[];
  readonly alvos: readonly AlvoRegraAvisoClinico[];
}

export interface EventoAvisoClinico {
  readonly tipoAviso: string;
  readonly setor: number | null;
  readonly especialidade: number | null;
  /** Dia do evento (AAAA-MM-DD), para a vigência. */
  readonly dia: string;
}

/** A regra cobre o evento: mesmo tipo, ativa, vigente no dia e, se restrita, no setor e na especialidade do evento. */
export function regraValeParaEvento(r: RegraAvisoClinicoAplicavel, e: EventoAvisoClinico): boolean {
  if (!r.ativa || r.tipoAviso !== e.tipoAviso) return false;
  if (e.dia < r.vigenciaInicio || (r.vigenciaFim !== null && e.dia > r.vigenciaFim)) return false;
  if (r.setorEvento !== null && r.setorEvento !== e.setor) return false;
  if (r.especialidadeEvento !== null && r.especialidadeEvento !== e.especialidade) return false;
  return true;
}

/** Quem pode receber: o usuário, o profissional dele e onde ele se encaixa nas regras. */
export interface CandidatoAvisoClinico {
  readonly usuario: number;
  readonly profissional: number | null;
  readonly setores: readonly number[];
  readonly especialidades: readonly number[];
  readonly categorias: readonly number[];
  readonly perfis: readonly number[];
  readonly temEmail: boolean;
}

export interface DestinoAvisoClinico {
  readonly usuario: number;
  readonly profissional: number | null;
  readonly canal: CanalAvisoClinico;
}

export interface AvisoDaRegra {
  readonly regra: number;
  readonly destinos: readonly DestinoAvisoClinico[];
}

function encaixa(c: CandidatoAvisoClinico, a: AlvoRegraAvisoClinico): boolean {
  switch (a.tipo) {
    case 'setor':
      return c.setores.includes(a.id);
    case 'especialidade':
      return c.especialidades.includes(a.id);
    case 'categoria_profissional':
      return c.categorias.includes(a.id);
    case 'perfil':
      return c.perfis.includes(a.id);
    case 'usuario':
      return c.usuario === a.id;
  }
}

/**
 * Um aviso por regra que cobre o evento, com os destinos de cada uma: a pessoa que se encaixa em algum alvo recebe em
 * cada canal da regra (e-mail só com endereço); a mesma pessoa no mesmo canal recebe uma vez só (a primeira regra
 * leva); o autor do evento não é avisado do que ele mesmo fez. Regra sem destino não gera aviso.
 */
export function destinatariosDoAviso(
  regras: readonly RegraAvisoClinicoAplicavel[],
  evento: EventoAvisoClinico,
  candidatos: readonly CandidatoAvisoClinico[],
  autor: number | null,
): AvisoDaRegra[] {
  const entregues = new Set<string>();
  const avisos: AvisoDaRegra[] = [];
  for (const r of regras) {
    if (!regraValeParaEvento(r, evento)) continue;
    const destinos: DestinoAvisoClinico[] = [];
    for (const c of candidatos) {
      if (c.usuario === autor) continue;
      if (!r.alvos.some((a) => encaixa(c, a))) continue;
      for (const canal of CANAIS_AVISO_CLINICO) {
        if (!r.canais.includes(canal)) continue;
        if (canal === 'email' && !c.temEmail) continue;
        const k = `${c.usuario}:${canal}`;
        if (entregues.has(k)) continue;
        entregues.add(k);
        destinos.push({ usuario: c.usuario, profissional: c.profissional, canal });
      }
    }
    if (destinos.length > 0) avisos.push({ regra: r.id, destinos });
  }
  return avisos;
}

/** A prioridade do tipo de aviso (baixa, média, alta, crítica) na escala do aviso (baixa, normal, alta, crítica). */
export function prioridadeDoAviso(p: string): PrioridadeAvisoClinico {
  if (p === 'baixa' || p === 'alta' || p === 'critica') return p;
  return 'normal';
}
