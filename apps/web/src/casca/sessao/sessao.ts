// Sessão da casca (TanStack Query). Trocar de estabelecimento chama o login do outro banco (M05; hoje a
// sessão sintética) e LIMPA todo o cache do TanStack Query: nada do banco anterior fica na tela (regra 13).
import type { Sessao } from '@sgh/contratos';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query';
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { buscarSessao, reautenticar, sair, trocarEstabelecimento, trocarUsuarioPorPin } from '../../api.js';
import { lerLiberacaoM16 } from '../../modulos/internacao/api-internacao.js';
import { lerLiberacaoProntuario } from '../../modulos/pep/api-pep.js';
import { apagarTudoLocal as apagarRascunhos } from '../../modulos/pep/rascunho-local.js';
import { apagarCofreLocal } from '../../modulos/enfermagem/cofre-local.js';
import { usarBloqueio } from '../bloqueio/bloqueio.js';
import { mensagemDoErro } from '../erros/problem-details.js';
import { definirSessaoDaTela } from './pode.js';

/** O que é clínico e fica no navegador (rascunhos do M22 e o cache da beira do leito do M25) sai junto da sessão. */
async function apagarTudoLocal(): Promise<void> {
  await Promise.all([apagarRascunhos(), apagarCofreLocal()]);
}

export const CHAVE_SESSAO = ['sessao'] as const;

/**
 * Permissões que dependem de uma chave de liberação do estabelecimento (POL-3; M15, ficha seção 12): com a
 * chave desligada (recolher), o menu, a paleta e a guarda escondem o destino. O servidor recusa de qualquer
 * jeito (403 `recurso-desligado`); aqui só não se oferece o que não abre.
 */
export const PERMISSOES_SOB_CHAVE = {
  prontuario: ['pep.prontuario.ler'],
  // M16 (ficha, seção 12): painel de leitos e censo; painéis gerenciais e indicadores.
  painel: ['internacao.leitos.ler', 'internacao.censo.ler', 'internacao.censo.exportar'],
  paineis: [
    'relatorio.paineis.ler',
    'relatorio.financeiro.ler',
    'relatorio.indicadores.ler',
    'relatorio.indicadores.exportar',
  ],
} as const;

export interface ChavesDesligadas {
  readonly prontuario: boolean;
  readonly painel?: boolean;
  readonly paineis?: boolean;
}

/** As permissões da sessão menos as das chaves desligadas (sem resposta ainda: nada é tirado). */
export function permissoesEfetivas(daSessao: readonly string[], desligadas: ChavesDesligadas): Set<string> {
  const s = new Set(daSessao);
  for (const k of ['prontuario', 'painel', 'paineis'] as const)
    if (desligadas[k]) for (const p of PERMISSOES_SOB_CHAVE[k]) s.delete(p);
  return s;
}

/** Dois conjuntos com os mesmos elementos. */
export function mesmoConjunto(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function usarSessao() {
  const consulta = useQuery({
    queryKey: CHAVE_SESSAO,
    queryFn: () => buscarSessao(),
    staleTime: 60_000,
    retry: 1,
  });
  const temProntuario = computed(() =>
    (consulta.data.value?.permissoes ?? []).some((p) =>
      (PERMISSOES_SOB_CHAVE.prontuario as readonly string[]).includes(p),
    ),
  );
  const liberacaoProntuario = useQuery({
    queryKey: computed(() => ['liberacao', 'prontuario', consulta.data.value?.estabelecimentoAtivo ?? '']),
    queryFn: () => lerLiberacaoProntuario(),
    enabled: temProntuario,
    staleTime: 60_000,
    retry: 1,
  });
  // M16: as chaves do painel de leitos e dos painéis gerenciais (uma consulta só para as quatro).
  const temM16 = computed(() =>
    (consulta.data.value?.permissoes ?? []).some((p) =>
      [...PERMISSOES_SOB_CHAVE.painel, ...PERMISSOES_SOB_CHAVE.paineis].includes(p as never),
    ),
  );
  const liberacaoM16 = useQuery({
    queryKey: computed(() => ['liberacao', 'm16', consulta.data.value?.estabelecimentoAtivo ?? '']),
    queryFn: () => lerLiberacaoM16(),
    enabled: temM16,
    staleTime: 60_000,
    retry: 1,
  });
  let ultimasPermissoes = new Set<string>();
  const permissoes = computed(() => {
    const novo = permissoesEfetivas(consulta.data.value?.permissoes ?? [], {
      prontuario: liberacaoProntuario.data.value?.ligada === false,
      painel: liberacaoM16.data.value?.painel === false,
      paineis: liberacaoM16.data.value?.paineis === false,
    });
    if (mesmoConjunto(novo, ultimasPermissoes)) return ultimasPermissoes;
    return (ultimasPermissoes = novo);
  });
  // M06: as regras CASL da tela acompanham a sessão (v-pode e a guarda do roteador).
  watch(() => consulta.data.value, definirSessaoDaTela, { immediate: true });
  const estabelecimentoAtivo = computed(() => {
    const s = consulta.data.value;
    return s?.estabelecimentos.find((e) => e.codigo === s.estabelecimentoAtivo) ?? null;
  });
  return {
    consulta,
    sessao: consulta.data,
    permissoes,
    estabelecimentoAtivo,
  };
}

/**
 * Depois da troca: todo o cache some, menos a própria sessão, que é substituída pela nova (o objeto da
 * consulta da sessão fica, para a casca continuar observando-a). A casca remonta a tela pela chave do
 * estabelecimento, e as telas releem do banco novo.
 */
export function aposTrocar(cliente: QueryClient, nova: Sessao): void {
  // A digitação clínica guardada no navegador é do estabelecimento anterior: sai junto (M22).
  void apagarTudoLocal();
  void cliente.cancelQueries();
  cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_SESSAO[0] });
  cliente.setQueryData(CHAVE_SESSAO, nova);
}

export function usarTrocaDeEstabelecimento() {
  const cliente = useQueryClient();
  const roteador = useRouter();
  return useMutation({
    mutationFn: (codigo: string) => trocarEstabelecimento(codigo),
    onSuccess: (nova) => aposTrocar(cliente, nova),
    // Sessão real: trocar de estabelecimento é um novo login (o servidor já encerrou a sessão). Nada do
    // banco anterior fica no cache; a entrada abre com o estabelecimento pedido.
    onError: (erro, codigo) => {
      if (mensagemDoErro(erro).tipo !== 'outro-estabelecimento') return;
      void apagarTudoLocal();
      void cliente.cancelQueries();
      cliente.clear();
      void roteador.replace({ name: 'entrar', query: { estabelecimento: codigo } });
    },
  });
}

/** Sair (ou trocar de usuário): encerra no servidor, limpa todo o cache e volta à entrada. */
export function usarSaida() {
  const cliente = useQueryClient();
  const roteador = useRouter();
  const bloqueio = usarBloqueio();
  return async function sairDaSessao(): Promise<void> {
    // ADR 0021: na sessão "como", sair é voltar à conta da plataforma (o servidor encerra o "como").
    const como = !!cliente.getQueryData<Sessao>(CHAVE_SESSAO)?.como;
    try {
      await sair();
    } finally {
      // A digitação clínica guardada neste navegador não fica para o próximo usuário (M22).
      await apagarTudoLocal();
      void cliente.cancelQueries();
      cliente.clear();
      bloqueio.desbloquear();
      if (como) window.location.assign('/plataforma');
      else await roteador.replace({ name: 'entrar' });
    }
  };
}

/**
 * W1-01 (parte 11b3b): troca rápida de usuário na tela bloqueada (login + PIN). A sessão nova é de OUTRA pessoa: todo o
 * cache e a digitação local saem (como na troca de estabelecimento) e a tela se desbloqueia já com a nova sessão.
 */
export function usarTrocaPorPin() {
  const cliente = useQueryClient();
  const bloqueio = usarBloqueio();
  return useMutation({
    mutationFn: (corpo: { login: string; pin: string }) => trocarUsuarioPorPin(corpo),
    onSuccess: (nova) => {
      aposTrocar(cliente, nova);
      bloqueio.desbloquear();
    },
  });
}

/** Desbloqueio com a senha (sessão real): POST /api/sessao/reautenticar; a sessão nova vai ao cache. */
export function usarDesbloqueio() {
  const cliente = useQueryClient();
  const bloqueio = usarBloqueio();
  return useMutation({
    mutationFn: (senha: string) => reautenticar(senha),
    onSuccess: (nova) => {
      cliente.setQueryData(CHAVE_SESSAO, nova);
      bloqueio.desbloquear();
    },
  });
}
