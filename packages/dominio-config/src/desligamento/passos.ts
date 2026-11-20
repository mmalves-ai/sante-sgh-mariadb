// Ordem e liberação dos três passos do M58 por hospital (ficha, seções 2, 8 e 12; regras 3 a 6): desligar o outro
// sistema → Firebird 5 → UTF-8. Cada passo exige o anterior executado, o seu ensaio aprovado (F1 a F3) e a autorização
// do dono em `ESTADO.md` › Autorizações; a execução é da TI na janela. Puro: o painel recebe o estado lido e mostra o
// que falta; nada aqui liga ou desliga coisa alguma.
import {
  FATIA_DO_PASSO,
  PASSOS_DESLIGAMENTO,
  type MotivoBloqueioPasso,
  type PassoAvaliado,
  type PassoDesligamento,
} from '@sgh/contratos';

export interface EstadoPasso {
  readonly autorizado: boolean;
  readonly executado: boolean;
  /** O relatório do ensaio da fatia está aprovado (F1: checklist; F2: firebird5.md; F3: utf8.md). */
  readonly ensaioAprovado: boolean;
}

export interface EstadoDesligamento {
  /** O fim da coexistência registrado pelo dono no hospital (M43, regra 8). */
  readonly fimDaCoexistencia: boolean;
  /** A DP-6 com data e contingência decididas para o hospital. */
  readonly dp6Decidida: boolean;
  readonly sessoesCumprido: boolean;
  readonly inventarioResolvido: boolean;
  /** As funções externas que bloqueiam a troca do motor (regra 5). */
  readonly funcoesPendentes: readonly string[];
  /** Os parceiros que leem o banco testados e avisados (regra 10; DP-16). */
  readonly parceirosAvisados: boolean;
  /** Os contratos da API de integração da Hal-AI verdes contra a cópia (regra 8). */
  readonly contratosHalAi: boolean;
  readonly passos: Readonly<Record<PassoDesligamento, EstadoPasso>>;
}

function motivosDoPasso(p: PassoDesligamento, e: EstadoDesligamento): MotivoBloqueioPasso[] {
  const m: MotivoBloqueioPasso[] = [];
  const i = PASSOS_DESLIGAMENTO.indexOf(p);
  const anterior = i > 0 ? PASSOS_DESLIGAMENTO[i - 1] : undefined;
  if (anterior && !e.passos[anterior].executado) m.push('passo-anterior-pendente');
  if (p === 'desligamento') {
    if (!e.fimDaCoexistencia) m.push('fim-da-coexistencia-nao-registrado');
    if (!e.dp6Decidida) m.push('dp6-sem-data');
    if (!e.sessoesCumprido) m.push('sessoes-na-janela');
    if (!e.inventarioResolvido) m.push('inventario-pendente');
  }
  if (p === 'firebird5' && e.funcoesPendentes.length > 0) m.push('funcoes-externas-pendentes');
  if (p !== 'desligamento') {
    if (!e.parceirosAvisados) m.push('parceiros-nao-avisados');
    if (!e.contratosHalAi) m.push('sante-api-sem-contrato');
  }
  if (!e.passos[p].ensaioAprovado) m.push('ensaio-nao-aprovado');
  return m;
}

/** Os três passos avaliados, na ordem. Um passo executado continua executado (a volta atrás é a regra 12). */
export function avaliarPassos(e: EstadoDesligamento): PassoAvaliado[] {
  return PASSOS_DESLIGAMENTO.map((passo) => {
    const s = e.passos[passo];
    const fatia = FATIA_DO_PASSO[passo];
    if (s.executado) return { passo, fatia, situacao: 'executado', motivos: [] };
    const motivos = motivosDoPasso(passo, e);
    if (motivos.length > 0) return { passo, fatia, situacao: 'bloqueado', motivos };
    return { passo, fatia, situacao: s.autorizado ? 'autorizado' : 'pronto-para-autorizar', motivos: [] };
  });
}

/** O padrão aprovado da DP-6 (2026-10-19): o outro sistema continua ligado; nenhum passo de desligamento. */
export const ESTADO_PADRAO_DP6: EstadoDesligamento = {
  fimDaCoexistencia: false,
  dp6Decidida: false,
  sessoesCumprido: false,
  inventarioResolvido: false,
  funcoesPendentes: [],
  parceirosAvisados: false,
  contratosHalAi: false,
  passos: {
    desligamento: { autorizado: false, executado: false, ensaioAprovado: false },
    firebird5: { autorizado: false, executado: false, ensaioAprovado: false },
    utf8: { autorizado: false, executado: false, ensaioAprovado: false },
  },
};
