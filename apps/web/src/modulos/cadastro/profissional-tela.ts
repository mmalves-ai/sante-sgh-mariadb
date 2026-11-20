// D-PROF-39 (redesenho do dono, 18/11/2026): a lógica pura da ficha do profissional no visual de Usuários e Acessos
// (cartão de perfil, abas, aviso único do que não pode ser gravado, sensíveis mascarados). Sem Vue: testável à parte.
// Copiado do padrão de administracao/usuarios-tela.ts (a unificação em @sgh/ui fica para depois: decisão registrada
// em docs/marcos/D-PROF-39/evidencias.md).
import type { FichaProfissional } from '@sgh/contratos';

export const ABAS_PROFISSIONAL = [
  'dados',
  'registros',
  'especialidades',
  'lotacao',
  'convenios',
  'login',
  'historico',
] as const;
export type AbaProfissional = (typeof ABAS_PROFISSIONAL)[number];

/** O registro mantido pelo próprio cadastro (CBO '000000'): nunca se edita nem se exclui pela tela. */
export const CBO_MANTIDO = '000000';

/** Até duas iniciais do nome (o avatar do cartão de perfil). */
export function iniciais(nome: string): string {
  const partes = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]$/i.test(p));
  const a = partes[0]?.[0] ?? '';
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (a + b).toUpperCase() || '?';
}

/** Máscara de dado sensível: e-mail (a primeira letra e o domínio), telefone (os 4 últimos), data (só o ano). */
export function mascarar(
  tipo: 'email' | 'telefone' | 'data' | 'texto',
  v: string | null | undefined,
): string {
  const x = (v ?? '').trim();
  if (!x) return '';
  if (tipo === 'email') {
    const [u = '', d = ''] = x.split('@');
    return `${u.slice(0, 1)}•••@${d}`;
  }
  if (tipo === 'telefone') return `•••• ${x.replace(/\D+/g, '').slice(-4)}`;
  if (tipo === 'data') return `••/••/${x.slice(0, 4)}`;
  return `${x.slice(0, 1)}${'•'.repeat(Math.min(8, Math.max(3, x.length - 1)))}`;
}

/** A data civil AAAA-MM-DD em DD/MM/AAAA. */
export function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** O registro real (não o mantido pelo cadastro). */
export const registroReal = (r: FichaProfissional['registros'][number]) => r.cbo !== CBO_MANTIDO;

/** Ativo = algum registro real ativo (a atividade real é a do registro; regra 10 do M11). */
export function ativoDaFicha(f: Pick<FichaProfissional, 'registros'>): boolean {
  return f.registros.some((r) => registroReal(r) && r.ativo !== false);
}

type RegistroFicha = FichaProfissional['registros'][number];

/** O registro no conselho, sem a ocupação: "CRM 12345/MG". */
export const conselhoDoRegistro = (r: RegistroFicha) =>
  `${r.sigla ?? r.conselho ?? ''} ${r.numero ?? ''}/${r.uf ?? ''}`;

/** A ocupação do registro: "225125 · MÉDICO CLÍNICO". */
export const ocupacaoDoRegistro = (r: RegistroFicha) => [r.cbo, r.cboDescricao].filter(Boolean).join(' · ');

export interface GrupoDeRegistro {
  readonly chave: string;
  /** "CRM 12345/MG", uma vez só. */
  readonly rotulo: string;
  /** As ocupações (CBO) desse registro no conselho, com a situação de cada uma. */
  readonly ocupacoes: readonly { id: number; texto: string; ativo: boolean }[];
  /** Algum registro do grupo ativo. */
  readonly ativo: boolean;
}

/**
 * O cartão sem chips repetidos (pergunta do dono, 18/11/2026): os registros reais agrupados por conselho + número +
 * UF, uma vez cada, com as ocupações (CBO e descrição) como detalhe e o registro inativo marcado. O mesmo CRM em três
 * CBOs é UM registro no conselho com três ocupações.
 */
export function gruposDeRegistro(registros: readonly RegistroFicha[]): GrupoDeRegistro[] {
  const grupos = new Map<
    string,
    { rotulo: string; ocupacoes: { id: number; texto: string; ativo: boolean }[] }
  >();
  for (const r of registros.filter(registroReal)) {
    const chave = `${r.conselho ?? r.sigla ?? ''}|${r.numero ?? ''}|${r.uf ?? ''}`;
    const g = grupos.get(chave) ?? { rotulo: conselhoDoRegistro(r), ocupacoes: [] };
    g.ocupacoes.push({ id: r.id, texto: ocupacaoDoRegistro(r), ativo: r.ativo !== false });
    grupos.set(chave, g);
  }
  return [...grupos.entries()].map(([chave, g]) => ({
    chave,
    rotulo: g.rotulo,
    ocupacoes: g.ocupacoes,
    ativo: g.ocupacoes.some((o) => o.ativo),
  }));
}

/**
 * As ocupações (registros) a que o login pode ser ligado: as ativas; sem nenhuma ativa, todas as reais (o aviso diz
 * que o login não fará ato de profissional).
 */
export function ocupacoesParaLogin(registros: readonly RegistroFicha[]): RegistroFicha[] {
  const reais = registros.filter(registroReal);
  const ativos = reais.filter((r) => r.ativo !== false);
  return ativos.length > 0 ? ativos : reais;
}

/** A ocupação padrão para ligar o login: a de médico (CBO 225…) ativa mais recente; senão a ativa mais recente. */
export function ocupacaoPadraoDoLogin(registros: readonly RegistroFicha[]): number | null {
  const lista = ocupacoesParaLogin(registros);
  const recente = (xs: readonly RegistroFicha[]) =>
    xs.reduce<RegistroFicha | null>((a, r) => (!a || r.id > a.id ? r : a), null);
  return (recente(lista.filter((r) => (r.cbo ?? '').startsWith('225'))) ?? recente(lista))?.id ?? null;
}

export interface Indisponivel {
  readonly motivo: string;
  readonly acoes: readonly string[];
}

/**
 * Revisão da D-PROF-39: ligar, trocar e desligar o login do profissional exigem a gestão de acessos (o vínculo é a
 * identidade clínica), como no servidor.
 */
export const PERMISSAO_VINCULO_LOGIN = 'acesso.perfil.gerir';

/** As gravações de cada ação da ficha (o executor aceita ou recusa cada uma; a ficha devolve a situação). */
export const OPERACOES_DA_ACAO: Readonly<Record<string, readonly string[]>> = {
  acaoDados: ['cadastro.alterarProfissional'],
  acaoRegistros: ['cadastro.incluirRegistroProfissional', 'cadastro.alterarRegistroProfissional'],
  acaoEspecialidades: ['cadastro.definirEspecialidadeProfissional'],
  acaoLotacao: ['cadastro.lotarProfissional'],
  acaoConvenios: ['cadastro.credenciarProfissional'],
  acaoLogin: ['cadastro.vincularLoginProfissional'],
  acaoSituacao: ['cadastro.inativarProfissional', 'cadastro.reativarProfissional'],
  acaoExcluir: ['cadastro.excluirProfissional', 'cadastro.excluirRegistroProfissional'],
};

/**
 * O executor aceitaria a gravação para quem pergunta? Pela situação que a ficha devolve (`operacoes`); sem ela (ficha
 * antiga), não bloqueia: o servidor decide na gravação.
 */
export function operacaoLigada(f: Pick<FichaProfissional, 'operacoes'>, operacao: string): boolean {
  const x = f.operacoes?.find((o) => o.operacao === operacao);
  return x ? x.ligada : true;
}

/** Todas as gravações da ação estão aceitas pelo executor. */
export function acaoLigada(f: Pick<FichaProfissional, 'operacoes'>, acao: string): boolean {
  return (OPERACOES_DA_ACAO[acao] ?? []).every((op) => operacaoLigada(f, op));
}

/**
 * O aviso único: o que não pode ser gravado nesta ficha e por quê, agrupado por motivo (um aviso só, recolhido).
 * `pode` diz as permissões da sessão; `t` traduz. Revisão da D-PROF-39: além das permissões, o que o executor recusa
 * para quem pergunta (`operacoes` da ficha), como a ficha de Usuários: os controles seguem a mesma regra.
 */
export function indisponiveis(
  f: Pick<FichaProfissional, 'registros' | 'dados' | 'operacoes'>,
  pode: (p: string) => boolean,
  t: (k: string) => string,
): Indisponivel[] {
  const grupos = new Map<string, string[]>();
  const add = (motivo: string, acao: string) => grupos.set(motivo, [...(grupos.get(motivo) ?? []), acao]);
  const T = (k: string) => t(`cadastro.profissionais.tela.${k}`);
  const editar = pode('cadastro.profissional.editar');
  if (!editar)
    for (const a of ['acaoDados', 'acaoRegistros', 'acaoEspecialidades', 'acaoLotacao', 'acaoConvenios'])
      add(T('semEditar'), T(a));
  if (!pode(PERMISSAO_VINCULO_LOGIN)) add(T('semGestaoAcesso'), T('acaoLogin'));
  if (!pode('cadastro.profissional.excluir'))
    for (const a of ['acaoSituacao', 'acaoExcluir']) add(T('semExcluir'), T(a));
  // As que a pessoa poderia fazer, mas o executor recusa nesta etapa (a mesma regra da faixa da lista).
  const permitida: Record<string, boolean> = {
    acaoDados: editar,
    acaoRegistros: editar,
    acaoEspecialidades: editar,
    acaoLotacao: editar,
    acaoConvenios: editar,
    acaoLogin: pode(PERMISSAO_VINCULO_LOGIN),
    acaoSituacao: pode('cadastro.profissional.excluir'),
    acaoExcluir: pode('cadastro.profissional.excluir'),
  };
  for (const a of Object.keys(OPERACOES_DA_ACAO))
    if (permitida[a] && !acaoLigada(f, a)) add(T('semEscrita'), T(a));
  if (pode(PERMISSAO_VINCULO_LOGIN) && acaoLigada(f, 'acaoLogin') && !f.registros.some(registroReal))
    add(T('semRegistro'), T('acaoLogin'));
  return [...grupos.entries()].map(([motivo, acoes]) => ({ motivo, acoes }));
}

/** Horas por mês da lotação: só inteiro de 0 a 744 (recusa vírgula e ponto em vez de juntar os dígitos). */
export function horasValidas(v: string): number | null {
  const x = v.trim();
  if (x === '') return 0;
  if (!/^\d{1,3}$/.test(x)) return null;
  const n = Number(x);
  return n <= 744 ? n : null;
}

/** A tecla da lista de abas (setas, Home e End): o índice de destino, ou -1. */
export function destinoDaTecla(tecla: string, i: number, n: number): number {
  if (tecla === 'ArrowRight') return (i + 1) % n;
  if (tecla === 'ArrowLeft') return (i - 1 + n) % n;
  if (tecla === 'Home') return 0;
  if (tecla === 'End') return n - 1;
  return -1;
}
