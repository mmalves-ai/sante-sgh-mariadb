// W1-01 (parte 9a): a regra das CONTAS DORMENTES. Uma conta ativa e livre que não entra há mais de N dias (N por tipo de
// conta: pessoal ou de dispositivo/integração) é bloqueada pela rotina, pelo executor (acesso.bloquearUsuario). Puro:
// recebe o que o adaptador leu (contas com a última conexão, exceções vigentes, gestores ativos) e devolve o que
// bloquear e o que poupar, com o motivo de cada uma. Regras:
// - conta que nunca entrou (sem conexão registrada) não é bloqueada sozinha: vai ao aviso do gestor (D-W101-29);
// - exceção justificada vigente (sem prazo ou com prazo até hoje) poupa a conta;
// - o último gestor de acessos ativo nunca fica sem sucessor: se todos os gestores ativos estão dormentes, o de acesso
//   mais recente fica (regra do administrador mínimo, como em ultimo-gestor.ts).
import { GRUPOS_SEM_CPF } from './painel-cpf.js';
import { chaveGrupo } from '../mapa-grupos.js';
import { diasSemAcesso } from '../saneamento.js';

export type TipoContaDormencia = 'pessoal' | 'dispositivo';

export interface ParametrosDormencia {
  /** acesso.contasDormentes.ligada: sem ela a rotina não bloqueia (a prévia continua). */
  readonly ligada: boolean;
  /** Dias sem entrar para bloquear a conta pessoal. */
  readonly diasPessoal: number;
  /** Dias sem entrar para bloquear a conta de dispositivo ou integração (sem pessoa por trás). */
  readonly diasDispositivo: number;
}

/** Padrões (D-W101-29; o dono confirma): 90 dias para conta pessoal, 180 para dispositivo e integração. */
export const PADRAO_DORMENCIA: ParametrosDormencia = { ligada: true, diasPessoal: 90, diasDispositivo: 180 };
export const DIAS_DORMENCIA_MINIMO = 30;
export const DIAS_DORMENCIA_MAXIMO = 730;

export interface ContaDormenciaLida {
  readonly login: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  /** Última conexão a qualquer módulo, AAAA-MM-DD; null se nunca entrou. */
  readonly ultimoAcesso: string | null;
}

export interface ExcecaoDormenciaVigente {
  readonly login: string;
  /** Prazo da exceção (AAAA-MM-DD, inclusive); null sem prazo. */
  readonly ate: string | null;
  readonly motivo: string;
}

export type SituacaoDormencia = 'bloquear' | 'excecao' | 'nunca-entrou' | 'ultimo-gestor';

export interface ContaDormente {
  readonly login: string;
  readonly tipo: TipoContaDormencia;
  readonly situacao: SituacaoDormencia;
  /** null: nunca entrou. */
  readonly diasSemAcesso: number | null;
  readonly limiteDias: number;
  readonly ultimoAcesso: string | null;
  /** O motivo da exceção (só na situação 'excecao'). */
  readonly motivoExcecao?: string;
}

export interface AvaliacaoDormencia {
  readonly hoje: string;
  readonly parametros: ParametrosDormencia;
  /** As contas a bloquear agora (vazio com a rotina desligada: ver `previa`). */
  readonly bloquear: ContaDormente[];
  /** As que bloqueariam com a rotina ligada (igual a `bloquear` quando ligada). */
  readonly previa: ContaDormente[];
  /** Dormentes poupadas: exceção vigente, nunca entrou, último gestor. */
  readonly poupadas: ContaDormente[];
}

export function tipoContaDormencia(
  grupo: string | null,
  dispensados: readonly string[] = GRUPOS_SEM_CPF,
): TipoContaDormencia {
  return dispensados.some((g) => chaveGrupo(g) === chaveGrupo(grupo ?? '')) ? 'dispositivo' : 'pessoal';
}

/** Recusa de parâmetro fora da faixa (null: válido). */
export function validarParametrosDormencia(p: ParametrosDormencia): string | null {
  for (const d of [p.diasPessoal, p.diasDispositivo])
    if (!Number.isInteger(d) || d < DIAS_DORMENCIA_MINIMO || d > DIAS_DORMENCIA_MAXIMO)
      return `Os dias sem acesso vão de ${DIAS_DORMENCIA_MINIMO} a ${DIAS_DORMENCIA_MAXIMO}.`;
  return null;
}

/** A exceção vale hoje? (sem prazo, ou prazo em ou depois de hoje). */
export function excecaoValeHoje(x: ExcecaoDormenciaVigente, hoje: string): boolean {
  return x.ate === null || x.ate >= hoje;
}

const porLogin = (a: { login: string }, b: { login: string }) => a.login.localeCompare(b.login);

export function avaliarDormencia(
  contas: readonly ContaDormenciaLida[],
  hoje: string,
  p: ParametrosDormencia,
  excecoes: readonly ExcecaoDormenciaVigente[],
  gestoresAtivos: readonly string[],
): AvaliacaoDormencia {
  const exc = new Map(excecoes.filter((x) => excecaoValeHoje(x, hoje)).map((x) => [x.login, x]));
  const candidatas: ContaDormente[] = [];
  const poupadas: ContaDormente[] = [];
  for (const c of contas) {
    if (!c.ativo || c.bloqueado) continue;
    const tipo = tipoContaDormencia(c.grupo);
    const limiteDias = tipo === 'pessoal' ? p.diasPessoal : p.diasDispositivo;
    const dias = diasSemAcesso(c.ultimoAcesso, hoje);
    const base = { login: c.login, tipo, diasSemAcesso: dias, limiteDias, ultimoAcesso: c.ultimoAcesso };
    if (dias === null) {
      poupadas.push({ ...base, situacao: 'nunca-entrou' });
      continue;
    }
    if (dias <= limiteDias) continue;
    const e = exc.get(c.login);
    if (e) poupadas.push({ ...base, situacao: 'excecao', motivoExcecao: e.motivo });
    else candidatas.push({ ...base, situacao: 'bloquear' });
  }
  // Administrador mínimo: se nenhum gestor ativo sobraria, o de acesso mais recente fica.
  const gestores = new Set(gestoresAtivos);
  const restam = [...gestores].filter((g) => !candidatas.some((c) => c.login === g));
  let previa = candidatas;
  if (gestores.size > 0 && restam.length === 0) {
    const fica = candidatas
      .filter((c) => gestores.has(c.login))
      .sort((a, b) => (a.diasSemAcesso ?? 0) - (b.diasSemAcesso ?? 0) || porLogin(a, b))[0];
    if (fica) {
      previa = candidatas.filter((c) => c !== fica);
      poupadas.push({ ...fica, situacao: 'ultimo-gestor' });
    }
  }
  previa = [...previa].sort(porLogin);
  return {
    hoje,
    parametros: p,
    previa,
    bloquear: p.ligada ? previa : [],
    poupadas: poupadas.sort(porLogin),
  };
}
