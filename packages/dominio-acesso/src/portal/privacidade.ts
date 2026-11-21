// O que o portal do paciente mostra e como registra as escolhas do titular (M50 etapa 1; ficha, regras 1, 5 e 13;
// cap-07 §7.6; LGPD art. 18; SBIS-24):
//   - documentos: só os do prontuário do novo, de tipo permitido, assinados no nível mínimo (M49) e não suspensos nem
//     retificados; resultados: só os liberados de setor publicado (a regra do M26 continua em @sgh/dominio-sadt);
//   - consentimentos: só as finalidades que dependem de consentimento; o signatário é o paciente ou o representante;
//   - pedidos do titular: abertos por uma conta ativa com segundo fator já nascem com a identidade verificada (D-IDENT-50);
//   - relatório de acessos: por dia, pessoa e natureza; sem estação, tela, termo de busca nem motivo.
import {
  FINALIDADES_CONSENTIMENTO_PORTAL,
  NATUREZA_DO_EVENTO,
  type NaturezaAcessoTitular,
  NIVEIS_ASSINATURA_DOCUMENTO,
  type NivelAssinaturaDocumento,
  type SignatarioPortal,
  TIPOS_DOCUMENTO_PORTAL,
} from '@sgh/contratos';

/** Eventos do documento (SGH_PEP_DOCUMENTO_EVENTO.TIPO) que o tiram do portal. */
const EVENTOS_QUE_TIRAM = new Set(['suspenso', 'retificado', 'inativado']);

export interface DocumentoCandidato {
  readonly tipo: string;
  readonly nivelAssinatura: string;
  /** Tipos dos eventos do documento, em ordem. */
  readonly eventos: readonly string[];
  readonly paciente: number;
}

const nivel = (n: string): number => NIVEIS_ASSINATURA_DOCUMENTO.indexOf(n as NivelAssinaturaDocumento);

/** O documento aparece no portal do titular? */
export function documentoVisivelNoPortal(
  d: DocumentoCandidato,
  paciente: number,
  nivelMinimo: NivelAssinaturaDocumento,
): boolean {
  if (d.paciente !== paciente) return false;
  if (!(TIPOS_DOCUMENTO_PORTAL as readonly string[]).includes(d.tipo)) return false;
  if (!d.eventos.includes('assinado')) return false;
  if (nivel(d.nivelAssinatura) < nivel(nivelMinimo)) return false;
  return !d.eventos.some((e) => EVENTOS_QUE_TIRAM.has(e));
}

/** O titular muda esta finalidade pelo portal? (`atendimento` só aparece). */
export function finalidadeEditavelNoPortal(finalidade: string): boolean {
  return (FINALIDADES_CONSENTIMENTO_PORTAL as readonly string[]).includes(finalidade);
}

/** Signatário do consentimento dado na sessão: o próprio titular ou o representante legal. */
export function signatarioDaSessao(vinculoEscolhido: string | null): SignatarioPortal {
  return vinculoEscolhido === null ? 'paciente' : 'representante-legal';
}

/**
 * ID do signatário no domínio do cadastro (tipo de representante), pela descrição lida ao vivo ("Paciente", "Representante Legal"):
 * nunca um número fixo no código.
 */
export function idSignatario(
  s: SignatarioPortal,
  dominio: readonly { readonly id: number; readonly descricao: string; readonly ativo: boolean }[],
): number | null {
  const alvo = s === 'paciente' ? /^paciente$/ : /representante/;
  const achado = dominio.find((d) => d.ativo && alvo.test(d.descricao.trim().toLowerCase()));
  return achado?.id ?? null;
}

/**
 * Situação do termo (situação da movimentação do termo) para "consentiu" e "não consentiu", pela descrição (na cópia do pc: 3
 * "Consentimento Autorizado" e 4 "Não autorizado").
 */
export function idSituacaoTermo(
  consentiu: boolean,
  dominio: readonly { readonly id: number; readonly descricao: string; readonly ativo: boolean }[],
): number | null {
  const norm = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const achado = dominio.find((d) => {
    if (!d.ativo) return false;
    const t = norm(d.descricao);
    return consentiu ? t.startsWith('consentimento autorizado') : t.startsWith('nao autorizado');
  });
  return achado?.id ?? null;
}

export interface ContaParaPedido {
  readonly ativa: boolean;
  readonly segundoFatorConfirmado: boolean;
}

/**
 * Situação inicial do pedido do titular aberto pelo portal: a conta ativa com segundo fator, ativada por convite do
 * hospital (que conferiu a pessoa), conta como identidade verificada (D-IDENT-50); a decisão continua com a privacidade.
 */
export function situacaoInicialPedidoPortal(c: ContaParaPedido): 'aberto' | 'identidade-verificada' {
  return c.ativa && c.segundoFatorConfirmado ? 'identidade-verificada' : 'aberto';
}

/** Linha da trilha de leitura do prontuário (só o que o relatório precisa). */
export interface LeituraDaTrilha {
  readonly em: string;
  readonly usuario: string;
  readonly evento: string;
}

export interface AcessoAgrupado {
  readonly dia: string;
  readonly natureza: NaturezaAcessoTitular;
  readonly usuario: string;
  readonly vezes: number;
  readonly primeiraEm: string;
  readonly ultimaEm: string;
}

/** Dia civil de São Paulo (UTC−3, sem horário de verão desde 2019) de um instante ISO. */
export function diaCivil(instante: string): string {
  return new Date(Date.parse(instante) - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Agrupa as leituras por dia, pessoa e natureza (do mais recente ao mais antigo). Eventos fora do mapa não aparecem
 * (o alerta ao auditor, por exemplo, não é acesso ao prontuário).
 */
export function agruparAcessos(linhas: readonly LeituraDaTrilha[]): AcessoAgrupado[] {
  const grupos = new Map<string, AcessoAgrupado>();
  for (const l of linhas) {
    const natureza = NATUREZA_DO_EVENTO[l.evento];
    if (!natureza) continue;
    const dia = diaCivil(l.em);
    const chave = `${dia}|${l.usuario}|${natureza}`;
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, { dia, natureza, usuario: l.usuario, vezes: 1, primeiraEm: l.em, ultimaEm: l.em });
      continue;
    }
    grupos.set(chave, {
      ...g,
      vezes: g.vezes + 1,
      primeiraEm: l.em < g.primeiraEm ? l.em : g.primeiraEm,
      ultimaEm: l.em > g.ultimaEm ? l.em : g.ultimaEm,
    });
  }
  return [...grupos.values()].sort(
    (a, b) => b.ultimaEm.localeCompare(a.ultimaEm) || a.usuario.localeCompare(b.usuario),
  );
}

/** Confere a janela do relatório (dias inclusivos). */
export function janelaValida(de: string, ate: string, maximoDias: number): boolean {
  const d = Date.parse(`${de}T00:00:00Z`);
  const a = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(a) || a < d) return false;
  return (a - d) / 86_400_000 + 1 <= maximoDias;
}
