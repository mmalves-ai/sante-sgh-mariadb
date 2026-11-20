// Página inicial por perfil (ficha do M27, regra 1; cap-03 §3.2 e §3.5): a tela inicial é a fila do perfil, ordenada
// por prioridade e prazo; só aparecem os componentes que o servidor devolveu (módulo entregue, permissão do módulo de
// origem e funcionalidade ligada no estabelecimento). Quem acumula perfis (médico e recepção, por exemplo) escolhe o
// perfil ativo: a fila do outro perfil sai da página inicial (continua no menu). Puro, sem rede: a tela monta os resumos.
import type {
  AltasPrevistas,
  CaixaMensagens,
  ComponenteDaInicio,
  ComponenteInicio,
  FilaNir,
  FilaNutricao,
  PaginaInicio,
  QuadroPa,
  WorklistMedico,
  WorklistRecepcao,
} from '@sgh/contratos';

export interface ResumoDaFila {
  /** Itens pendentes (o selo do cartão); null quando ainda não carregou. */
  readonly pendentes: number | null;
  /** Maior = mais urgente. */
  readonly prioridade: number;
  /** Prazo mais próximo (ISO local), ou null. */
  readonly prazo: string | null;
}

export interface CartaoDaInicio extends ComponenteDaInicio, ResumoDaFila {
  readonly ordem: number;
}

const PERFIS: readonly ComponenteInicio[] = ['medico', 'recepcao'];

/** Os componentes do perfil ativo: com um perfil só (ou nenhum escolhido), todos. */
export function componentesDoPerfil(
  p: PaginaInicio,
  ativo: ComponenteInicio | null,
): readonly ComponenteDaInicio[] {
  if (p.perfis.length < 2 || ativo === null || !p.perfis.some((x) => x.id === ativo)) return p.componentes;
  return p.componentes.filter((c) => !PERFIS.includes(c.id) || c.id === ativo);
}

/** O perfil guardado vale se a sessão ainda o tem; senão, o primeiro. */
export function perfilAtivo(p: PaginaInicio, guardado: string | null): ComponenteInicio | null {
  if (p.perfis.length === 0) return null;
  return p.perfis.find((x) => x.id === guardado)?.id ?? p.perfis[0]!.id;
}

/** A ordem da página inicial: prioridade (desc), prazo (o mais próximo; sem prazo por último), a ordem padrão. */
export function ordenarCartoes(cs: readonly CartaoDaInicio[]): CartaoDaInicio[] {
  return [...cs].sort(
    (a, b) =>
      b.prioridade - a.prioridade ||
      (a.prazo === null ? 1 : 0) - (b.prazo === null ? 1 : 0) ||
      (a.prazo ?? '').localeCompare(b.prazo ?? '') ||
      a.ordem - b.ordem,
  );
}

const menorPrazo = (xs: readonly (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

/** Resumo da fila do médico: pacientes com pendência, a maior prioridade e o prazo mais próximo. */
export function resumoMedico(w: WorklistMedico): ResumoDaFila {
  const com = w.pacientes.filter((p) => p.pendencias.length > 0);
  return {
    pendentes: com.length,
    prioridade: Math.max(0, ...w.pacientes.map((p) => p.prioridade)),
    prazo: menorPrazo(w.pacientes.map((p) => p.prazo)),
  };
}

/** Resumo da fila da recepção: senhas na fila e guias; prioritária esperando sobe a urgência. */
export function resumoRecepcao(w: WorklistRecepcao): ResumoDaFila {
  const prioritarias = w.senhas.filter((s) => s.prioridade !== '2').length;
  return {
    pendentes: w.senhas.length + w.guias.length,
    prioridade: prioritarias > 0 ? 90 : w.senhas.length > 0 ? 45 : w.guias.length > 0 ? 25 : 0,
    prazo: menorPrazo([...w.senhas.map((s) => s.emitidaEm), ...w.guias.map((g) => g.abertoEm)]),
  };
}

/** Resumo das mensagens: não lidas; a ciência pendente sobe a urgência. */
export function resumoMensagens(c: CaixaMensagens): ResumoDaFila {
  return {
    pendentes: c.naoLidas,
    prioridade: c.cienciasPendentes > 0 ? 30 : c.naoLidas > 0 ? 10 : 0,
    prazo: null,
  };
}

/** Resumo das pendências de assinatura: os documentos aguardando (assinar fecha o prontuário do dia). */
export function resumoAssinaturas(total: number): ResumoDaFila {
  return { pendentes: Math.max(0, total), prioridade: total > 0 ? 35 : 0, prazo: null };
}

/**
 * M44 (etapa 3): o cartão do PA (o quadro por cor de risco): os atendimentos no quadro; a classificação estourada
 * (reclassificar) e quem aguarda classificação sobem a urgência; o prazo mais próximo é o do risco que corre.
 */
export function resumoPa(q: QuadroPa): ResumoDaFila {
  const cartoes = q.colunas.flatMap((c) => c.cartoes);
  const estourados = cartoes.filter((k) => k.risco?.estourado).length;
  const vermelhos = cartoes.filter((k) => k.risco?.cor === 'vermelho' || k.risco?.cor === 'laranja').length;
  const semClassificacao = cartoes.filter((k) => k.risco === null).length;
  const protocolosVencidos = cartoes.filter((k) => (k.protocolos ?? []).some((p) => p.atrasadas > 0)).length;
  return {
    pendentes: cartoes.length,
    prioridade:
      estourados > 0 || protocolosVencidos > 0
        ? 95
        : vermelhos > 0
          ? 85
          : semClassificacao > 0
            ? 60
            : cartoes.length > 0
              ? 30
              : 0,
    prazo: menorPrazo(cartoes.map((k) => (k.risco && !k.risco.estourado ? k.risco.prazoEm : null))),
  };
}

/** Uma barreira de alta aberta no cartão do NIR, com o internado (nome e leito) a que ela pertence. */
export interface BarreiraDoCartao {
  readonly id: number;
  readonly internacao: number;
  readonly nome: string;
  readonly leito: string;
  readonly tipo: string;
  readonly descricao: string;
  readonly prazo: string;
  readonly vencida: boolean;
}

/** As barreiras de alta abertas dos internados: as vencidas primeiro, depois pelo prazo mais próximo. */
export function barreirasAbertas(a: AltasPrevistas): BarreiraDoCartao[] {
  return a.itens
    .flatMap((i) =>
      i.barreiras
        .filter((b) => b.situacao === 'aberta')
        .map((b) => ({
          id: b.id,
          internacao: i.internacao,
          nome: i.nome,
          leito: `${i.leito.bloco} · ${i.leito.acomodacao} · ${i.leito.leito}`,
          tipo: b.tipo,
          descricao: b.descricao,
          prazo: b.prazo,
          vencida: b.vencida,
        })),
    )
    .sort((x, y) => Number(y.vencida) - Number(x.vencida) || x.prazo.localeCompare(y.prazo) || x.id - y.id);
}

/**
 * M44 (etapa 3): o cartão do NIR: solicitações de leito abertas e barreiras de alta abertas; prazo estourado, conflito
 * de reserva e barreira vencida sobem a urgência; o prazo mais próximo é o das solicitações e barreiras que correm.
 * Sem a leitura das barreiras (a sessão não tem a permissão ou ainda não carregou), só as solicitações.
 */
export function resumoNir(f: FilaNir, barreiras: readonly BarreiraDoCartao[] = []): ResumoDaFila {
  const vencidas = barreiras.filter((b) => b.vencida).length;
  const total = f.itens.length + barreiras.length;
  return {
    pendentes: total,
    prioridade: f.estourados > 0 || f.conflitos.length > 0 || vencidas > 0 ? 90 : total > 0 ? 50 : 0,
    prazo: menorPrazo([
      ...f.itens.filter((i) => !i.prazoEstourado).map((i) => i.prazoEm),
      ...barreiras.filter((b) => !b.vencida).map((b) => b.prazo),
    ]),
  };
}

/**
 * M45 (etapa 5): o cartão da nutrição. Pendentes: os internados a triar, em atenção, com a triagem vencida e a
 * reavaliar; a triagem vencida (mais de 48 h) é a mais urgente. O prazo é o mais próximo dos que ainda não venceram.
 */
export function resumoNutricao(f: FilaNutricao): ResumoDaFila {
  const pendentes = f.itens.filter((i) => i.situacao !== 'triado');
  const vencidas = f.contagens.vencida;
  return {
    pendentes: pendentes.length,
    prioridade: vencidas > 0 ? 80 : f.contagens.atencao > 0 ? 55 : pendentes.length > 0 ? 35 : 0,
    prazo: menorPrazo(
      pendentes.filter((i) => i.situacao !== 'vencida' && i.situacao !== 'reavaliar').map((i) => i.prazoEm),
    ),
  };
}

/**
 * M48 (etapa 1): o cartão do NSP, pelas notificações por prazo regulatório em aberto. Vencido é o mais urgente (o
 * Notivisa e a análise de causa raiz têm prazo legal); o resumo não traz o instante, então o prazo fica de fora.
 */
export function resumoQualidade(r: {
  readonly porSituacao: { readonly noPrazo: number; readonly venceEmBreve: number; readonly vencido: number };
}): ResumoDaFila {
  const { noPrazo, venceEmBreve, vencido } = r.porSituacao;
  return {
    pendentes: noPrazo + venceEmBreve + vencido,
    prioridade: vencido > 0 ? 85 : venceEmBreve > 0 ? 60 : noPrazo > 0 ? 30 : 0,
    prazo: null,
  };
}

/**
 * O cartão da CCIH (M48, etapa 3): os pacientes em vigilância; o restrito sem liberação no prazo é o mais urgente.
 */
export function resumoCcih(r: {
  readonly emVigilancia: number;
  readonly semLiberacao: number;
}): ResumoDaFila {
  return {
    pendentes: r.emVigilancia,
    prioridade: r.semLiberacao > 0 ? 75 : r.emVigilancia > 0 ? 30 : 0,
    prazo: null,
  };
}

/**
 * O cartão da notificação compulsória (M48, etapa 4): os casos aguardando notificação mais as sugestões sem caso; o
 * prazo vencido é o mais urgente, depois o imediato aguardando (24 h).
 */
export function resumoAgravos(r: {
  readonly abertos: number;
  readonly imediatosAbertos: number;
  readonly vencidos: number;
  readonly gatilhosSemCaso: number;
}): ResumoDaFila {
  const pendentes = r.abertos + r.gatilhosSemCaso;
  return {
    pendentes,
    prioridade: r.vencidos > 0 ? 90 : r.imediatosAbertos > 0 ? 70 : pendentes > 0 ? 30 : 0,
    prazo: null,
  };
}

/** A chave do perfil ativo guardado neste navegador (conveniência; vale só se a sessão ainda tem o perfil). */
export const CHAVE_PERFIL_ATIVO = 'sgh.inicio.perfil.v1';

export function lerPerfilGuardado(
  armazenamento: () => Storage | null = () => window.localStorage,
): string | null {
  try {
    return armazenamento()?.getItem(CHAVE_PERFIL_ATIVO) ?? null;
  } catch {
    return null;
  }
}

export function guardarPerfil(
  perfil: string,
  armazenamento: () => Storage | null = () => window.localStorage,
): void {
  try {
    armazenamento()?.setItem(CHAVE_PERFIL_ATIVO, perfil);
  } catch {
    /* sem armazenamento: o perfil vale só nesta tela */
  }
}

/** Os cartões da página inicial, com o resumo de cada fila (os que ainda não carregaram ficam com prioridade 0). */
export function montarCartoes(
  componentes: readonly ComponenteDaInicio[],
  resumos: Partial<Record<ComponenteInicio, ResumoDaFila>>,
): CartaoDaInicio[] {
  return ordenarCartoes(
    componentes.map((c, ordem) => ({
      ...c,
      ...(resumos[c.id] ?? { pendentes: null, prioridade: 0, prazo: null }),
      ordem,
    })),
  );
}
