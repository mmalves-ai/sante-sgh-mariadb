// W1-01 (parte 11a): PROVISIONAMENTO PELO RH. O que o RH registra na gestão de pessoas vira tarefa para o gestor de
// acessos, sem gancho no módulo de pessoas (D-W101-35): as tarefas são DERIVADAS a cada leitura dos vínculos e do
// histórico funcional, e só a resolução é gravada (SGH_ACESSO_RH_TAREFA, fato novo e imutável). Puro: recebe o que o
// adaptador leu e devolve as tarefas abertas. Regras:
// - 'criar-acesso': vínculo ativo sem usuário do sistema; perfil sugerido pelo cargo (senão pela função) no mapa
//   cargo → perfil do estabelecimento (configuração por fato novo, SGH_ACESSO_RH_PERFIL_CARGO);
// - 'revisar-acesso': vínculo ativo com usuário e mudança de cargo, função ou lotação já em vigor que ninguém revisou;
//   uma tarefa por vínculo, que cobre todas as mudanças até a mais nova (ref = ID do histórico mais novo);
// - 'suspender-acesso' (opcional, parâmetro acesso.provisionamentoRh.suspenderAfastamento): férias ou afastamento em
//   curso de quem tem usuário, com duração mínima; a suspensão é o bloqueio pelo executor, e dispensar é permitido;
// - o desligamento já bloqueia o usuário pelo executor (M52): não gera tarefa aqui;
// - resolver: 'feita' (criar-acesso exige o login criado) ou 'dispensada' (motivo obrigatório); resolução não se edita.

export type TipoTarefaRh = 'criar-acesso' | 'revisar-acesso' | 'suspender-acesso';
export const TIPOS_TAREFA_RH: readonly TipoTarefaRh[] = [
  'criar-acesso',
  'revisar-acesso',
  'suspender-acesso',
];
export type SituacaoResolucaoRh = 'feita' | 'dispensada';

/** O ref da tarefa 'criar-acesso' (uma por vínculo). */
export const REF_CRIAR_ACESSO = 'admissao';
export const MOTIVO_RH_MINIMO = 10;
export const MOTIVO_RH_MAXIMO = 200;

export interface VinculoRh {
  readonly id: number;
  readonly nome: string;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
  /** TBUSERS.ID_TBUSERS do vínculo (null: ainda sem usuário). */
  readonly usuario: number | null;
}

export interface MudancaFuncionalRh {
  /** SGH_PES_HISTORICO.ID */
  readonly id: number;
  readonly vinculo: number;
  readonly tipo: string;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
}

export interface AfastamentoRh {
  readonly vinculo: number;
  /** Identificador estável do período (ex.: 'ferias:12', 'afastamento:7'). */
  readonly ref: string;
  readonly natureza: 'ferias' | 'afastamento';
  readonly inicio: string;
  /** null: sem data de retorno. */
  readonly fim: string | null;
}

export interface ResolucaoRhLida {
  readonly tipo: TipoTarefaRh;
  readonly vinculo: number;
  readonly ref: string;
  readonly situacao: SituacaoResolucaoRh;
}

export interface ParametrosRh {
  /** Gera a tarefa de suspensão nas férias e afastamentos (padrão: não; D-W101-35). */
  readonly suspenderAfastamento: boolean;
  /** Duração mínima, em dias, do afastamento que gera a tarefa (sem data de retorno sempre gera). */
  readonly diasMinimosAfastamento: number;
}

export const PADRAO_RH: ParametrosRh = { suspenderAfastamento: false, diasMinimosAfastamento: 15 };

export interface EntradaTarefasRh {
  readonly hoje: string;
  readonly vinculos: readonly VinculoRh[];
  readonly mudancas: readonly MudancaFuncionalRh[];
  readonly afastamentos: readonly AfastamentoRh[];
  readonly resolucoes: readonly ResolucaoRhLida[];
  /** Mapa vigente cargo (normalizado por chaveCargoRh) → perfil do Sante. */
  readonly perfilPorCargo: Readonly<Record<string, string>>;
  readonly parametros: ParametrosRh;
}

export interface TarefaRh {
  readonly tipo: TipoTarefaRh;
  readonly vinculo: number;
  readonly ref: string;
  readonly nome: string;
  readonly cargo: string;
  readonly setor: string | null;
  /** Desde quando a tarefa existe (admissão, vigência da mudança mais antiga em aberto, início do afastamento). */
  readonly desde: string;
  readonly usuario: number | null;
  readonly perfilSugerido: string | null;
  /** O que mudou (revisar) ou o período (suspender), em texto curto. */
  readonly detalhe: string[];
}

const TIPOS_MUDANCA = new Set(['cargo', 'funcao', 'lotacao']);

/** A chave do cargo no mapa: sem acento, maiúsculas, espaços simples. */
export function chaveCargoRh(cargo: string): string {
  return cargo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function perfilSugeridoRh(
  mapa: Readonly<Record<string, string>>,
  cargo: string,
  funcao: string | null,
): string | null {
  return mapa[chaveCargoRh(cargo)] ?? (funcao ? (mapa[chaveCargoRh(funcao)] ?? null) : null);
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const ROTULO_MUDANCA: Record<string, string> = { cargo: 'Cargo', funcao: 'Função', lotacao: 'Lotação' };

/** As tarefas abertas do estabelecimento, na ordem: criar, revisar, suspender; dentro de cada, a mais antiga antes. */
export function tarefasRh(e: EntradaTarefasRh): TarefaRh[] {
  const resolvido = new Set(e.resolucoes.map((r) => `${r.tipo}|${r.vinculo}|${r.ref}`));
  const revisadoAte = new Map<number, number>();
  for (const r of e.resolucoes)
    if (r.tipo === 'revisar-acesso' && /^\d+$/.test(r.ref))
      revisadoAte.set(r.vinculo, Math.max(revisadoAte.get(r.vinculo) ?? 0, Number(r.ref)));
  const ativos = e.vinculos.filter((v) => v.desligamento === null || v.desligamento > e.hoje);
  const criar: TarefaRh[] = [];
  const revisar: TarefaRh[] = [];
  const suspender: TarefaRh[] = [];
  for (const v of ativos) {
    const base = { vinculo: v.id, nome: v.nome, cargo: v.cargo, setor: v.setor, usuario: v.usuario };
    if (v.usuario === null) {
      if (!resolvido.has(`criar-acesso|${v.id}|${REF_CRIAR_ACESSO}`))
        criar.push({
          ...base,
          tipo: 'criar-acesso',
          ref: REF_CRIAR_ACESSO,
          desde: v.admissao,
          perfilSugerido: perfilSugeridoRh(e.perfilPorCargo, v.cargo, v.funcao),
          detalhe: [],
        });
      continue;
    }
    const piso = revisadoAte.get(v.id) ?? 0;
    const abertas = e.mudancas
      .filter((m) => m.vinculo === v.id && TIPOS_MUDANCA.has(m.tipo) && m.id > piso && m.vigencia <= e.hoje)
      .sort((a, b) => a.id - b.id);
    const ultima = abertas[abertas.length - 1];
    if (ultima)
      revisar.push({
        ...base,
        tipo: 'revisar-acesso',
        ref: String(ultima.id),
        desde: abertas.reduce((m, x) => (x.vigencia < m ? x.vigencia : m), ultima.vigencia),
        perfilSugerido: perfilSugeridoRh(e.perfilPorCargo, v.cargo, v.funcao),
        detalhe: abertas.map(
          (m) =>
            `${ROTULO_MUDANCA[m.tipo] ?? m.tipo}: ${m.antes ?? '—'} → ${m.depois ?? '—'} (${m.vigencia})`,
        ),
      });
    if (!e.parametros.suspenderAfastamento) continue;
    for (const a of e.afastamentos) {
      if (a.vinculo !== v.id || a.inicio > e.hoje || (a.fim !== null && a.fim < e.hoje)) continue;
      if (a.fim !== null && diasEntre(a.inicio, a.fim) + 1 < e.parametros.diasMinimosAfastamento) continue;
      if (resolvido.has(`suspender-acesso|${v.id}|${a.ref}`)) continue;
      suspender.push({
        ...base,
        tipo: 'suspender-acesso',
        ref: a.ref,
        desde: a.inicio,
        perfilSugerido: null,
        detalhe: [
          `${a.natureza === 'ferias' ? 'Férias' : 'Afastamento'}: ${a.inicio} a ${a.fim ?? 'sem data de retorno'}`,
        ],
      });
    }
  }
  const porDesde = (a: TarefaRh, b: TarefaRh) => a.desde.localeCompare(b.desde) || a.vinculo - b.vinculo;
  return [...criar.sort(porDesde), ...revisar.sort(porDesde), ...suspender.sort(porDesde)];
}

export interface ResolucaoRhPedida {
  readonly tipo: TipoTarefaRh;
  readonly vinculo: number;
  readonly ref: string;
  readonly situacao: SituacaoResolucaoRh;
  readonly motivo: string;
  /** criar-acesso feita: o login criado (TBUSERS.NOME). */
  readonly login: string | null;
}

export type ValidacaoResolucaoRh =
  | { ok: true }
  | {
      ok: false;
      recusa: 'tarefa-inexistente' | 'motivo-curto' | 'login-obrigatorio' | 'login-indevido';
      mensagem: string;
      campos: string[];
    };

/** Confere a resolução contra as tarefas abertas (recalculadas na mesma transação da gravação). */
export function validarResolucaoRh(abertas: readonly TarefaRh[], p: ResolucaoRhPedida): ValidacaoResolucaoRh {
  if (!abertas.some((t) => t.tipo === p.tipo && t.vinculo === p.vinculo && t.ref === p.ref))
    return {
      ok: false,
      recusa: 'tarefa-inexistente',
      mensagem: 'Esta tarefa não está mais aberta: atualize a lista.',
      campos: [],
    };
  const motivo = p.motivo.trim();
  if (motivo.length < MOTIVO_RH_MINIMO || motivo.length > MOTIVO_RH_MAXIMO)
    return {
      ok: false,
      recusa: 'motivo-curto',
      mensagem: `Informe o motivo com ${MOTIVO_RH_MINIMO} a ${MOTIVO_RH_MAXIMO} caracteres.`,
      campos: ['motivo'],
    };
  const login = p.login?.trim() ?? '';
  if (p.tipo === 'criar-acesso' && p.situacao === 'feita' && !login)
    return {
      ok: false,
      recusa: 'login-obrigatorio',
      mensagem: 'Informe o usuário criado para este colaborador.',
      campos: ['login'],
    };
  if (login && !(p.tipo === 'criar-acesso' && p.situacao === 'feita'))
    return {
      ok: false,
      recusa: 'login-indevido',
      mensagem: 'O usuário só se informa ao concluir a criação do acesso.',
      campos: ['login'],
    };
  return { ok: true };
}
