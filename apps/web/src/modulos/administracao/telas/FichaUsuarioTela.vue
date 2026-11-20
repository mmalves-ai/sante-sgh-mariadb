<script setup lang="ts">
// Ficha do usuário (M10, ficha seção 7): dados (nome completo, grupo, CPF e senha só como "definida"), bloqueio,
// escopos (concede e retira um a um), setores, papéis SBIS, permissões complementares (só consulta, "a confirmar"),
// conexões, sessões abertas no sistema (o que o bloqueio derruba), termo e, para o Auditor, o histórico de senha
// como contagem. Ninguém altera a si mesmo (o servidor recusa e a tela mostra o motivo).
// Redesenho (17/11/2026): cartão de perfil no topo; o resto em abas; o bloqueio é a chave "Acesso liberado"; a
// senha de novo (reautenticação, SBIS-07) é pedida num diálogo na hora de cada gravação, nunca num campo solto;
// as gravações desligadas aparecem num aviso único, agrupadas pelo motivo, e cada controle desligado diz o porquê.
// O CPF: a conta da plataforma recebe o número (`usuario.cpf`) e o vê mascarado, com o olho para revelar; os
// demais veem só "Informado"/"Não informado".
import {
  type FlagUsuario,
  type OperacaoUsuario,
  type Problema,
  type TipoEscopo,
  TIPOS_ESCOPO,
  operacaoDeEscopo,
  tipoDoProblema,
} from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  SanteAlerta,
  SanteAvisoColisao,
  SanteBotao,
  SanteCampoTexto,
  SanteChave,
  SanteDialogo,
  SanteDialogoGravacao,
  SanteIcone,
  SanteSelecao,
  type PedidoGravacao,
} from '@sgh/ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import AplicarModelo from '../componentes/AplicarModelo.vue';
import ConselhoUsuario from '../componentes/ConselhoUsuario.vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarEscopo,
  alterarFlags,
  alterarNome,
  alterarSetor,
  bloquear,
  buscarFicha,
  buscarOpcoesUsuarios,
  buscarPinUsuario,
  redefinirSenha,
  retirarPinUsuario,
  trocarCpf,
  trocarGrupo,
} from '../api.js';
import {
  CAMINHO_LISTA_USUARIOS,
  dataHora,
  desligadasPorMotivo,
  formatarCpf,
  iniciais,
  mascararCpf,
  mostrarAbaAtiva,
  usarAbasRolaveis,
  voltarParaLista,
} from '../usuarios-tela.js';

const props = defineProps<{ login: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const roteador = useRouter();
/** "Voltar à lista" volta à lista como ela estava (busca, filtros e página na query), quando veio de lá. */
const destinoVoltar = ref(voltarParaLista(roteador.options.history.state['back']));
const ficha = useQuery({
  queryKey: computed(() => ['adm', 'ficha', props.login]),
  queryFn: () => buscarFicha(props.login),
});
const opcoes = useQuery({ queryKey: ['adm', 'usuarios-opcoes'], queryFn: () => buscarOpcoesUsuarios() });
const u = computed(() => ficha.data.value?.usuario ?? null);

const nome = ref('');
const cpfNovo = ref('');
const cpfJustificativa = ref('');
const grupo = ref('');
const escolha = ref<Record<string, string>>({});
const setor = ref('');
const aviso = ref('');
const recusa = ref('');
const colisao = ref<Problema | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const cpfVisivel = ref(false);
watch(
  u,
  (x) => {
    if (x) {
      nome.value = x.nome ?? '';
      grupo.value = x.grupo ?? '';
    }
  },
  { immediate: true },
);

// ---- Abas ----
const ABAS = ['dados', 'escopos', 'papeis', 'flags', 'sessoes'] as const;
type Aba = (typeof ABAS)[number];
const aba = ref<Aba>('dados');
const botoesAba = ref<HTMLButtonElement[]>([]);
const listaAbas = ref<HTMLElement | null>(null);
const rolagemAbas = usarAbasRolaveis(listaAbas);
watch(aba, () => void nextTick(() => mostrarAbaAtiva(listaAbas.value)));
function teclaAba(e: KeyboardEvent, i: number): void {
  const n = ABAS.length;
  const destino =
    e.key === 'ArrowRight'
      ? (i + 1) % n
      : e.key === 'ArrowLeft'
        ? (i - 1 + n) % n
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? n - 1
            : -1;
  if (destino < 0) return;
  e.preventDefault();
  aba.value = ABAS[destino]!;
  void nextTick(() => botoesAba.value[destino]?.focus());
}
/** O número de cada aba: o total de itens; nas permissões, "ligadas/total" (com o texto por extenso oculto). */
const contagemAba = computed<Record<Aba, { curto: string; extenso: string } | null>>(() => {
  const f = ficha.data.value;
  if (!f) return { dados: null, escopos: null, papeis: null, flags: null, sessoes: null };
  const n = (x: number) => ({ curto: String(x), extenso: '' });
  const ligadas = f.flags.filter((x) => x.ligado === true).length;
  return {
    dados: null,
    escopos: n(TIPOS_ESCOPO.reduce((s, x) => s + (f.escopos[x]?.length ?? 0), 0) + f.setores.length),
    papeis: n(f.papeis.length),
    flags: {
      curto: `${ligadas}/${f.flags.length}`,
      extenso: t('adm.ficha.flagsContagem', { ligadas, total: f.flags.length }),
    },
    sessoes: n(f.sessoes.length),
  };
});

// ---- Gravações desligadas (POL-3): um aviso só, agrupado pelo motivo ----
const FLAGS_OP: OperacaoUsuario = 'acesso.alterarFlagsUsuario';
const estadoOp = (op: OperacaoUsuario) => ficha.data.value?.operacoes.find((x) => x.operacao === op) ?? null;
const desligada = (op: OperacaoUsuario) => estadoOp(op)?.ligada === false;
const grupoDesligadas = computed(() => desligadasPorMotivo(ficha.data.value?.operacoes ?? [], [FLAGS_OP]));
const totalDesligadas = computed(() => grupoDesligadas.value.reduce((s, g) => s + g.rotulos.length, 0));
const motivoFlags = computed(() => estadoOp(FLAGS_OP)?.motivo ?? '');

// ---- Reautenticação: a senha num diálogo (SanteDialogoGravacao, único em @sgh/ui; X-01), na hora da gravação ----
// O diálogo fica aberto até a resposta: senha que não confere aparece DENTRO dele (o campo limpa e recebe o foco),
// sem perder a ação. Sucesso fecha; recusa, colisão e erro fecham e levam a tela até o aviso. A senha nunca fica
// guardada: limpa ao fechar o diálogo por qualquer caminho (Cancelar, Esc, X ou clique fora).
interface Pedido {
  titulo: string;
  /** Só quando há consequência a dizer (o bloqueio derruba as sessões); o título já diz a ação. */
  texto?: string;
  confirmar: string;
  /** W1-01 (11b3c): rótulo do motivo obrigatório (retirar o PIN); ausente: só a senha. */
  motivo?: string;
  gravar: (senha: string, motivo: string) => Promise<unknown>;
  ok: string;
}
/** Os data-testid de sempre da ficha (testes de componente e E2E). */
const TESTIDS_SENHA = {
  form: 'form-reautenticar',
  erro: 'reautenticar-erro',
  senha: 'ficha-senha',
  confirmar: 'reautenticar-confirmar',
};
const pedido = ref<Pedido | null>(null);
const dialogoSenha = ref(false);
function pedirSenha(p: Pedido): void {
  pedido.value = p;
  dialogoSenha.value = true;
}
/** O pedido no formato do diálogo único de @sgh/ui (X-01): só a senha, sem motivo. */
const pedidoGravacao = computed<PedidoGravacao | null>(() => {
  const p = pedido.value;
  if (!p) return null;
  return {
    titulo: p.titulo,
    ...(p.texto ? { texto: p.texto } : {}),
    senha: true,
    ...(p.motivo ? { motivo: p.motivo, motivoObrigatorio: true } : {}),
    confirmar: p.confirmar,
    gravar: ({ senha, motivo }) => {
      limparResultado();
      return p.gravar(senha, motivo);
    },
  };
});
function limparResultado(): void {
  recusa.value = '';
  colisao.value = null;
  erro.value = null;
  aviso.value = '';
}
async function concluido(ok: string): Promise<void> {
  aviso.value = ok;
  await cliente.invalidateQueries({ queryKey: ['adm', 'ficha', props.login] });
  await cliente.invalidateQueries({ queryKey: ['adm', 'usuarios'] });
}
function tratarFalha(e: unknown): void {
  if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'conflito-de-versao')
    colisao.value = e.problema;
  else if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erro.value = e;
  void nextTick(() =>
    document
      .querySelector('[data-ficha-resultado]')
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
  );
}
function gravadoComSenha(): void {
  const p = pedido.value;
  if (p) void concluido(p.ok);
}

// Outro usuário na mesma tela (a rota troca só o :login): nada do anterior fica à vista.
watch(
  () => props.login,
  () => {
    cpfVisivel.value = false;
    limparResultado();
    aba.value = 'dados';
    dialogoSenha.value = false;
    dialogoProvisoria.value = false;
    buscaFlag.value = '';
    filtroFlag.value = 'todas';
    flagsPendentes.value = {};
    adicionando.value = null;
    escolha.value = {};
    setor.value = '';
    destinoVoltar.value = voltarParaLista(roteador.options.history.state['back']);
  },
);

// O valor e a versão vão como estavam ao abrir o diálogo: uma recarga da ficha no meio (foco de janela) não troca
// o que se grava nem a versão conferida (o conflito de versão continua chegando como colisão).
function salvarNome(): void {
  const login = props.login;
  const valor = nome.value;
  const versao = u.value?.versao ?? '';
  pedirSenha({
    titulo: t('adm.ficha.reautenticar.nome', { login }),
    confirmar: t('adm.comum.salvar'),
    gravar: (s) => alterarNome(login, valor, versao, s),
    ok: t('adm.comum.gravado'),
  });
}
/** W1-01: troca do CPF com justificativa (o servidor recusa CPF de outro login e a troca sem motivo). */
const cpfPronto = computed(
  () => /^\d{11}$/.test(cpfNovo.value.trim()) && cpfJustificativa.value.trim().length >= 10,
);
function salvarCpf(): void {
  const login = props.login;
  const dados = {
    nomeCompleto: u.value?.nome ?? nome.value,
    versao: u.value?.versao ?? '',
    cpf: cpfNovo.value.trim(),
    justificativa: cpfJustificativa.value.trim(),
  };
  pedirSenha({
    titulo: t('adm.ficha.reautenticar.cpf', { login }),
    confirmar: t('adm.ficha.cpfTrocar'),
    gravar: async (s) => {
      const r = await trocarCpf(login, dados, s);
      cpfNovo.value = '';
      cpfJustificativa.value = '';
      return r;
    },
    ok: t('adm.comum.gravado'),
  });
}
function salvarGrupo(): void {
  const login = props.login;
  const valor = grupo.value;
  pedirSenha({
    titulo: t('adm.ficha.reautenticar.grupo', { login, grupo: valor }),
    confirmar: t('adm.ficha.trocarGrupoCurto'),
    gravar: (s) => trocarGrupo(login, valor, s),
    ok: t('adm.comum.gravado'),
  });
}
/** A chave "Acesso liberado": desligar bloqueia (com o aviso da queda das sessões); ligar desbloqueia. */
function alternarAcesso(liberar: boolean): void {
  const bloquearAgora = !liberar;
  const login = props.login;
  pedirSenha({
    titulo: t(bloquearAgora ? 'adm.ficha.reautenticar.bloquear' : 'adm.ficha.reautenticar.desbloquear', {
      login,
    }),
    texto: bloquearAgora
      ? t('adm.ficha.confirmarBloqueio')
      : t('adm.ficha.reautenticar.desbloquearTexto', { login }),
    confirmar: bloquearAgora ? t('adm.ficha.bloquear') : t('adm.ficha.desbloquear'),
    gravar: (s) => bloquear(login, bloquearAgora, s),
    ok: bloquearAgora ? t('adm.ficha.bloqueado') : t('adm.ficha.desbloqueado'),
  });
}
// ---- W1-01: redefinir a senha (senha provisória gerada pelo servidor, mostrada uma vez, só a quem redefiniu) ----
const provisoria = ref<{ login: string; senha: string; trocaObrigatoria: boolean } | null>(null);
const dialogoProvisoria = ref(false);
const copiada = ref(false);
watch(dialogoProvisoria, (aberto) => {
  // Fechou: a senha some da memória da tela.
  if (!aberto) {
    provisoria.value = null;
    copiada.value = false;
  }
});
function pedirRedefinicao(): void {
  const login = props.login;
  pedirSenha({
    titulo: t('adm.ficha.reautenticar.redefinirSenha', { login }),
    texto: t('adm.ficha.redefinirTexto'),
    confirmar: t('adm.ficha.redefinirSenha'),
    gravar: async (s) => {
      const r = await redefinirSenha(login, s);
      provisoria.value = { login, senha: r.senhaProvisoria, trocaObrigatoria: r.trocaObrigatoria };
      copiada.value = false;
      void nextTick(() => (dialogoProvisoria.value = true));
    },
    ok: t('adm.ficha.senhaRedefinida'),
  });
}
async function copiarProvisoria(): Promise<void> {
  if (!provisoria.value) return;
  try {
    await navigator.clipboard?.writeText(provisoria.value.senha);
    copiada.value = true;
  } catch {
    copiada.value = false;
  }
}
const rotuloItem = (tipo: TipoEscopo, valor: string) =>
  ficha.data.value?.escopos[tipo]?.find((x) => x.valor === valor)?.rotulo ??
  opcoes.data.value?.escopos[tipo]?.find((x) => x.valor === valor)?.rotulo ??
  valor;
function escopo(tipo: TipoEscopo, acao: 'conceder' | 'retirar', valor: string): void {
  if (!valor) return;
  const login = props.login;
  pedirSenha({
    titulo: t(`adm.ficha.reautenticar.${acao}`, {
      item: rotuloItem(tipo, valor),
      tipo: t(`adm.ficha.tipos.${tipo}`),
    }),
    confirmar: acao === 'conceder' ? t('adm.comum.conceder') : t('adm.comum.retirar'),
    gravar: async (s) => {
      await alterarEscopo(login, tipo, acao, valor, s);
      if (acao === 'conceder') {
        escolha.value[tipo] = '';
        adicionando.value = null;
      }
    },
    ok: t('adm.comum.gravado'),
  });
}
const rotuloSetor = (bloco: string) =>
  ficha.data.value?.setores.find((x) => x.valor === bloco)?.rotulo ??
  opcoes.data.value?.setores.find((x) => x.valor === bloco)?.rotulo ??
  bloco;
function mudarSetor(acao: 'conceder' | 'retirar', bloco: string): void {
  if (!bloco) return;
  const login = props.login;
  pedirSenha({
    titulo: t(`adm.ficha.reautenticar.${acao}`, { item: rotuloSetor(bloco), tipo: t('adm.ficha.setores') }),
    confirmar: acao === 'conceder' ? t('adm.comum.conceder') : t('adm.comum.retirar'),
    gravar: async (s) => {
      await alterarSetor(login, bloco, acao, s);
      if (acao === 'conceder') {
        setor.value = '';
        adicionando.value = null;
      }
    },
    ok: t('adm.comum.gravado'),
  });
}

const disponiveis = (tipo: TipoEscopo) =>
  (opcoes.data.value?.escopos[tipo] ?? []).filter(
    (o) => !(ficha.data.value?.escopos[tipo] ?? []).some((x) => x.valor === o.valor),
  );
const opcoesGrupo = computed(() =>
  (opcoes.data.value?.grupos ?? []).filter((x) => x.ativo).map((g) => ({ valor: g.nome, rotulo: g.nome })),
);
// A primeira opção (valor vazio) é o "Escolha…" que o combo mostra antes da escolha.
const escolhaVazia = computed(() => ({ valor: '', rotulo: t('adm.ficha.escolherPlaceholder') }));
const setoresDisponiveis = computed(() =>
  (opcoes.data.value?.setores ?? []).filter(
    (s) => !(ficha.data.value?.setores ?? []).some((x) => x.valor === s.valor),
  ),
);
const opcoesSetor = computed(() => [
  escolhaVazia.value,
  ...setoresDisponiveis.value.map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
]);
const opcoesEscopo = (tipo: TipoEscopo) => [
  escolhaVazia.value,
  ...disponiveis(tipo).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
];
/** Qual cartão de "Onde atua" está com o combo de adicionar aberto (um por vez; o resto mostra só o botão). */
const adicionando = ref<TipoEscopo | 'setor' | null>(null);
function abrirAdicionar(alvo: TipoEscopo | 'setor'): void {
  adicionando.value = alvo;
  void nextTick(() =>
    document.querySelector<HTMLElement>(`[data-testid="escolher-${alvo}"] [role="combobox"]`)?.focus(),
  );
}
function fecharAdicionar(): void {
  if (adicionando.value === 'setor') setor.value = '';
  else if (adicionando.value) escolha.value[adicionando.value] = '';
  adicionando.value = null;
}
const podeEditar = computed(() => pode('acesso.usuario.editar'));
const podeBloquear = computed(() => pode('acesso.usuario.bloquear'));
const podeEscopo = computed(() => pode('acesso.escopo.editar'));
// W1-01 (parte 11b3c): o PIN da troca rápida (situação e retirar), só para quem gere acessos.
const podeGerirPin = computed(() => pode('acesso.perfil.gerir'));
const pinUsuario = useQuery({
  queryKey: computed(() => ['adm', 'ficha', props.login, 'pin']),
  queryFn: () => buscarPinUsuario(props.login),
  enabled: podeGerirPin,
  retry: false,
});
function pedirRetirarPin(): void {
  const login = props.login;
  pedirSenha({
    titulo: t('adm.ficha.pin.dialogo', { login }),
    texto: t('adm.ficha.pin.dialogoTexto'),
    motivo: t('adm.ficha.pin.motivo'),
    confirmar: t('adm.ficha.pin.confirmar'),
    gravar: (senha, motivo) => retirarPinUsuario(login, motivo.trim(), senha),
    ok: t('adm.ficha.pin.retirado', { login }),
  });
}
// Atalho "Profissional vinculado" (X-01): o profissional do login pelo papel Operador de sistema; sem vínculo, quem
// gere perfis vai à aba "Login do sistema" da ficha do profissional (a lista leva o pedido da aba até a ficha).
const vinculado = computed(() => ficha.data.value?.profissionalVinculado ?? null);
const podeVerProfissional = computed(() => pode('cadastro.profissional.ler'));
const podeVincularProfissional = computed(
  () => pode('acesso.perfil.gerir') && pode('cadastro.profissional.ler'),
);
const opAcesso = computed<OperacaoUsuario>(() =>
  u.value?.bloqueado ? 'acesso.desbloquearUsuario' : 'acesso.bloquearUsuario',
);
const nomeMudou = computed(
  () => nome.value.trim() !== (u.value?.nome ?? '').trim() && nome.value.trim() !== '',
);

// ---- CPF ----
const cpfMostrado = computed(() => {
  const c = u.value?.cpf;
  if (!c) return null;
  return cpfVisivel.value ? formatarCpf(c) : mascararCpf(c);
});

// ---- Permissões complementares: busca, filtro e grupos ----
type FiltroFlag = 'todas' | 'ligadas' | 'desligadas' | 'indefinidas';
const buscaFlag = ref('');
const filtroFlag = ref<FiltroFlag>('todas');
const flagsFiltradas = computed(() => {
  const termo = buscaFlag.value.trim().toUpperCase();
  return (ficha.data.value?.flags ?? []).filter((f) => !termo || f.coluna.toUpperCase().includes(termo));
});
const gruposFlags = computed(() => {
  const lista = flagsFiltradas.value;
  const grupos = [
    { chave: 'ligadas' as const, itens: lista.filter((f) => f.ligado === true) },
    { chave: 'desligadas' as const, itens: lista.filter((f) => f.ligado === false) },
    { chave: 'indefinidas' as const, itens: lista.filter((f) => f.ligado === null) },
  ];
  return grupos.filter(
    (g) => g.itens.length && (filtroFlag.value === 'todas' || filtroFlag.value === g.chave),
  );
});
const contagemFlags = computed(() => {
  const l = ficha.data.value?.flags ?? [];
  return {
    todas: l.length,
    ligadas: l.filter((f) => f.ligado === true).length,
    desligadas: l.filter((f) => f.ligado === false).length,
    indefinidas: l.filter((f) => f.ligado === null).length,
  };
});
const FILTROS_FLAG: readonly FiltroFlag[] = ['todas', 'ligadas', 'desligadas', 'indefinidas'];
// W1-01 (parte 3b): as chaves mudam na tela e gravam juntas (um diálogo de senha); a letra lida vai como "antes".
const flagsPendentes = ref<Record<string, boolean>>({});
const nPendentes = computed(() => Object.keys(flagsPendentes.value).length);
const valorFlag = (f: FlagUsuario) => flagsPendentes.value[f.coluna] ?? f.ligado === true;
const flagEditavel = (f: FlagUsuario) =>
  !desligada(FLAGS_OP) && (valorFlag(f) ? f.podeDesligar === true : f.podeLigar === true);
function alternarFlag(f: FlagUsuario, v: boolean): void {
  const p = { ...flagsPendentes.value };
  if (v === (f.ligado === true)) delete p[f.coluna];
  else p[f.coluna] = v;
  flagsPendentes.value = p;
}
function salvarFlags(): void {
  const login = props.login;
  const atuais = new Map((ficha.data.value?.flags ?? []).map((f) => [f.coluna, f]));
  const pedido = Object.entries(flagsPendentes.value).map(([coluna, ligado]) => {
    const l = atuais.get(coluna)?.letra ?? null;
    const antes: 'T' | 'F' | '' | null = l === 'T' || l === 'F' || l === '' ? l : null;
    return { coluna, ligado, antes };
  });
  pedirSenha({
    titulo: t('adm.ficha.reautenticar.flags', { login, n: pedido.length }),
    confirmar: t('adm.ficha.flagsSalvar'),
    gravar: async (s) => {
      const r = await alterarFlags(login, pedido, s);
      flagsPendentes.value = {};
      return r;
    },
    ok: t('adm.comum.gravado'),
  });
}
/** Segmento vazio (contagem 0) some, menos o "Todas" e o escolhido: menos ruído, nada de quebra de linha à toa. */
const filtrosFlagVisiveis = computed(() =>
  FILTROS_FLAG.filter((f) => f === 'todas' || f === filtroFlag.value || contagemFlags.value[f] > 0),
);
const rotuloFiltroFlag = (f: FiltroFlag) =>
  f === 'todas'
    ? t('adm.ficha.flagsTodas', { n: contagemFlags.value.todas })
    : `${t(`adm.ficha.flagsGrupos.${f}`)} (${contagemFlags.value[f]})`;
</script>

<template>
  <section class="tela ficha" aria-labelledby="ficha-titulo">
    <nav class="trilha">
      <router-link :to="destinoVoltar" class="trilha__voltar" data-testid="ficha-voltar">
        <SanteIcone nome="seta" tamanho="1em" class="trilha__seta" />{{ t('adm.ficha.voltar') }}
      </router-link>
    </nav>
    <div v-if="ficha.isError.value" class="falha">
      <MensagemErro :erro="ficha.error.value" />
      <SanteBotao
        :rotulo="t('adm.ficha.tentarDeNovo')"
        variante="secundario"
        data-testid="ficha-tentar"
        @acionar="ficha.refetch()"
      />
    </div>
    <div v-else-if="ficha.isPending.value" class="esqueleto" aria-busy="true" data-testid="ficha-carregando">
      <span class="sgh-visualmente-oculto" role="status">{{ t('adm.comum.carregando') }}</span>
      <div class="esqueleto__perfil" aria-hidden="true">
        <span class="esqueleto__bloco esqueleto__bloco--avatar" />
        <span class="esqueleto__linhas">
          <span class="esqueleto__bloco esqueleto__bloco--titulo" />
          <span class="esqueleto__bloco esqueleto__bloco--curto" />
        </span>
      </div>
      <span class="esqueleto__bloco esqueleto__bloco--abas" aria-hidden="true" />
      <span class="esqueleto__bloco esqueleto__bloco--cartao" aria-hidden="true" />
    </div>
    <h1 v-if="!(ficha.data.value && u)" id="ficha-titulo" class="sgh-visualmente-oculto">
      {{ t('adm.ficha.titulo', { login }) }}
    </h1>
    <template v-if="ficha.data.value && u">
      <!-- Cartão de perfil -->
      <header class="perfil">
        <span class="perfil__avatar" aria-hidden="true">{{ iniciais(u.nome, u.login) }}</span>
        <div class="perfil__textos">
          <h1 id="ficha-titulo" :class="['perfil__nome', { 'perfil__nome--vazio': !u.nome }]">
            {{ u.nome || t('adm.usuarios.semNome') }}
          </h1>
          <p class="perfil__login">
            <span class="sgh-visualmente-oculto">{{ t('adm.ficha.login') }}: </span>{{ u.login }}
          </p>
          <div class="pilulas" data-testid="ficha-situacao">
            <span :class="['pilula', u.ativo ? 'pilula--ok' : 'pilula--neutra']">{{
              u.ativo ? t('adm.comum.ativo') : t('adm.comum.inativo')
            }}</span>
            <span v-if="u.bloqueado" class="pilula pilula--alerta">
              <SanteIcone nome="cadeado" tamanho="0.95em" />{{ t('adm.usuarios.bloqueado') }}
            </span>
            <span v-else-if="!u.senhaDefinida" class="pilula pilula--aviso" data-testid="ficha-sem-senha">{{
              t('adm.ficha.semSenhaPilula')
            }}</span>
            <span v-else class="pilula pilula--ok">{{ t('adm.usuarios.acessoLivre') }}</span>
            <span v-if="u.grupo" class="etiqueta">{{ u.grupo }}</span>
            <span v-else class="pilula pilula--neutra">{{ t('adm.usuarios.semGrupo') }}</span>
            <span v-if="ficha.data.value.grupoAtivo === false" class="pilula pilula--aviso">{{
              t('adm.ficha.grupoInativo')
            }}</span>
          </div>
        </div>
        <div class="perfil__acoes">
          <router-link
            class="botao-link"
            :to="{ path: '/administracao/acesso/simulador', query: { login } }"
            :title="t('adm.ficha.simular')"
            >{{ t('adm.ficha.simularCurto') }}</router-link
          >
        </div>
      </header>

      <p v-if="ficha.data.value.destino === 'memoria'" class="nota">{{ t('adm.comum.memoria') }}</p>

      <!-- Resultado da última ação (a tela rola até aqui quando a gravação é recusada) -->
      <div v-if="aviso || recusa || colisao || erro" class="resultado" data-ficha-resultado>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="ficha-aviso" />
        <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="ficha-recusa" />
        <SanteAvisoColisao
          v-if="colisao"
          :problema="colisao"
          @rever="ficha.refetch()"
          @descartar="colisao = null"
        />
        <MensagemErro v-if="erro" :erro="erro" />
      </div>

      <!-- Gravações desligadas: um aviso só, recolhido -->
      <details v-if="totalDesligadas > 0" class="desligadas" data-testid="estados-gravacao">
        <summary>
          <SanteIcone nome="info" tamanho="1.1em" />
          <span>{{ t('adm.ficha.desligadasResumo', { n: totalDesligadas }, totalDesligadas) }}</span>
          <span class="desligadas__ver">{{ t('adm.ficha.desligadasVer') }}</span>
        </summary>
        <div v-for="(g, i) in grupoDesligadas" :key="i" class="desligadas__grupo">
          <p class="desligadas__motivo">{{ g.motivo }}</p>
          <p class="desligadas__afeta">
            <span class="desligadas__rotulo">{{ t('adm.ficha.desligadasAfeta') }}:</span>
            <span v-for="r in g.rotulos" :key="r" class="etiqueta etiqueta--texto">{{ r }}</span>
          </p>
        </div>
      </details>

      <!-- Abas -->
      <div
        ref="listaAbas"
        :class="[
          'abas',
          { 'abas--antes': rolagemAbas.antes.value, 'abas--depois': rolagemAbas.depois.value },
        ]"
        role="tablist"
        :aria-label="t('adm.ficha.abasRotulo')"
      >
        <button
          v-for="(a, i) in ABAS"
          :id="`ficha-aba-${a}`"
          :key="a"
          ref="botoesAba"
          type="button"
          role="tab"
          class="aba"
          :aria-selected="aba === a ? 'true' : 'false'"
          :aria-controls="`ficha-painel-${a}`"
          :tabindex="aba === a ? 0 : -1"
          :data-testid="`ficha-aba-${a}`"
          @click="aba = a"
          @keydown="teclaAba($event, i)"
        >
          {{ t(`adm.ficha.abas.${a}`) }}
          <span v-if="contagemAba[a]" class="aba__n">
            <span :aria-hidden="contagemAba[a]!.extenso ? 'true' : undefined">{{
              contagemAba[a]!.curto
            }}</span>
            <span v-if="contagemAba[a]!.extenso" class="sgh-visualmente-oculto">{{
              contagemAba[a]!.extenso
            }}</span>
          </span>
        </button>
      </div>

      <!-- Dados e acesso -->
      <div
        v-if="aba === 'dados'"
        id="ficha-painel-dados"
        class="painel painel--dados"
        role="tabpanel"
        aria-labelledby="ficha-aba-dados"
      >
        <section class="cartao" aria-labelledby="ficha-acesso">
          <h2 id="ficha-acesso" class="cartao__titulo">{{ t('adm.ficha.acesso') }}</h2>
          <SanteChave
            :ligada="!u.bloqueado"
            :rotulo="t('adm.ficha.acessoLiberado')"
            :descricao="t('adm.ficha.acessoLiberadoTexto')"
            :texto-ligada="t('adm.ficha.liberado')"
            :texto-desligada="t('adm.ficha.bloqueadoCurto')"
            :desabilitada="!podeBloquear || ocupado || desligada(opAcesso)"
            :motivo="desligada(opAcesso) ? t('adm.ficha.indisponivel') : ''"
            :data-testid="u.bloqueado ? 'desbloquear-usuario' : 'bloquear-usuario'"
            @alternar="alternarAcesso"
          />
          <dl class="fatos">
            <div>
              <dt>{{ t('adm.ficha.senha') }}</dt>
              <dd>
                <template v-if="u.senhaDefinida">{{ t('adm.ficha.senhaSim') }}</template>
                <template v-else>
                  {{ t('adm.ficha.senhaNao') }}
                  <router-link
                    class="link-acao"
                    :to="{ path: CAMINHO_LISTA_USUARIOS, query: { vista: 'identidade' } }"
                    data-testid="ficha-ir-senhas"
                    >{{ t('adm.ficha.irSenhas') }}</router-link
                  >
                </template>
                <SanteBotao
                  v-if="podeBloquear && !u.bloqueado"
                  class="link-acao"
                  :rotulo="t('adm.ficha.redefinirSenha')"
                  variante="texto"
                  :desabilitado="ocupado || desligada('acesso.redefinirSenha')"
                  data-testid="redefinir-senha"
                  @acionar="pedirRedefinicao"
                />
              </dd>
            </div>
            <div>
              <dt>{{ t('adm.ficha.termo') }}</dt>
              <dd>
                {{
                  ficha.data.value.termo.aceitouVigente
                    ? t('adm.ficha.termoSim', { em: dataHora(ficha.data.value.termo.aceitoEm) })
                    : t('adm.ficha.termoNao')
                }}
              </dd>
            </div>
            <div data-testid="ficha-profissional">
              <dt>{{ t('adm.ficha.profissional') }}</dt>
              <dd>
                <template v-if="vinculado">
                  <router-link
                    v-if="podeVerProfissional"
                    class="link-acao"
                    :to="`/cadastros/profissionais/${vinculado.id}`"
                    :aria-label="t('adm.ficha.profissionalAbrir', { nome: vinculado.nome })"
                    data-testid="ficha-profissional-link"
                    >{{ vinculado.nome }}</router-link
                  >
                  <template v-else>{{ vinculado.nome }}</template>
                </template>
                <template v-else>
                  {{ t('adm.ficha.profissionalNenhum') }}
                  <router-link
                    v-if="podeVincularProfissional"
                    class="link-acao"
                    :to="{ path: '/cadastros/profissionais', query: { aba: 'login', login: props.login } }"
                    data-testid="ficha-profissional-vincular"
                    >{{ t('adm.ficha.profissionalVincular') }}</router-link
                  >
                </template>
              </dd>
            </div>
            <div v-if="ficha.data.value.historicoSenha">
              <dt>{{ t('adm.ficha.historicoSenhaRotulo') }}</dt>
              <dd>
                {{
                  t('adm.ficha.historicoSenha', {
                    n: ficha.data.value.historicoSenha.trocas,
                    em: dataHora(ficha.data.value.historicoSenha.ultima) || '—',
                  })
                }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="cartao" aria-labelledby="ficha-dados">
          <h2 id="ficha-dados" class="cartao__titulo">{{ t('adm.ficha.identificacao') }}</h2>
          <dl class="fatos fatos--empilhados">
            <div>
              <dt>{{ t('adm.ficha.cpf') }}</dt>
              <dd class="cpf" data-testid="ficha-cpf">
                <template v-if="cpfMostrado">
                  <span class="mono">{{ cpfMostrado }}</span>
                  <button
                    type="button"
                    class="olho"
                    :aria-pressed="cpfVisivel ? 'true' : 'false'"
                    :aria-label="cpfVisivel ? t('adm.ficha.cpfOcultar') : t('adm.ficha.cpfMostrar')"
                    :title="cpfVisivel ? t('adm.ficha.cpfOcultar') : t('adm.ficha.cpfMostrar')"
                    data-testid="ficha-cpf-revelar"
                    @click="cpfVisivel = !cpfVisivel"
                  >
                    <svg
                      width="1.2em"
                      height="1.2em"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                      <path v-if="cpfVisivel" d="M3 3l18 18" />
                    </svg>
                  </button>
                </template>
                <template v-else>{{
                  u.cpfInformado ? t('adm.ficha.cpfSim') : t('adm.ficha.cpfNao')
                }}</template>
              </dd>
            </div>
          </dl>
          <form v-if="podeEditar" class="campo-acao" @submit.prevent="salvarNome">
            <SanteCampoTexto
              v-model="nome"
              :rotulo="t('adm.ficha.nomeCompleto')"
              :max-bytes="70"
              data-testid="ficha-nome"
            />
            <div class="campo-acao__botao campo-acao__botao--sob-rotulo">
              <SanteBotao
                :rotulo="t('adm.comum.salvar')"
                tipo="submit"
                variante="secundario"
                :desabilitado="ocupado || !nomeMudou || desligada('acesso.alterarUsuario')"
                data-testid="salvar-nome"
              />
            </div>
            <small v-if="desligada('acesso.alterarUsuario')" class="motivo">{{
              t('adm.ficha.indisponivel')
            }}</small>
          </form>
          <form v-if="podeEditar" class="campo-acao campo-acao--cpf" @submit.prevent="salvarCpf">
            <SanteCampoTexto
              v-model="cpfNovo"
              :rotulo="t('adm.ficha.cpfNovo')"
              :max-bytes="11"
              data-testid="ficha-cpf-novo"
            />
            <SanteCampoTexto
              v-model="cpfJustificativa"
              :rotulo="t('adm.ficha.cpfJustificativa')"
              :max-bytes="255"
              data-testid="ficha-cpf-justificativa"
            />
            <div class="campo-acao__botao campo-acao__botao--sob-rotulo">
              <SanteBotao
                :rotulo="t('adm.ficha.cpfTrocar')"
                tipo="submit"
                variante="secundario"
                :desabilitado="ocupado || !cpfPronto || desligada('acesso.alterarUsuario')"
                data-testid="trocar-cpf"
              />
            </div>
            <small class="motivo">{{ t('adm.ficha.cpfAjuda') }}</small>
          </form>
          <form v-if="podeEditar" class="campo-acao" @submit.prevent="salvarGrupo">
            <SanteSelecao
              id="ficha-grupo"
              v-model="grupo"
              class="selecao-empilhada"
              :rotulo="t('adm.ficha.grupo')"
              :opcoes="opcoesGrupo"
              data-testid="ficha-grupo"
            />
            <div class="campo-acao__botao">
              <SanteBotao
                :rotulo="t('adm.ficha.trocarGrupoCurto')"
                tipo="submit"
                variante="secundario"
                :desabilitado="
                  ocupado || !grupo || grupo === u.grupo || desligada('acesso.trocarGrupoUsuario')
                "
                data-testid="trocar-grupo"
              />
            </div>
            <small v-if="desligada('acesso.trocarGrupoUsuario')" class="motivo">{{
              t('adm.ficha.indisponivel')
            }}</small>
          </form>
          <dl v-if="!podeEditar" class="fatos fatos--empilhados">
            <div>
              <dt>{{ t('adm.ficha.grupo') }}</dt>
              <dd>{{ u.grupo ?? t('adm.usuarios.semGrupo') }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <!-- Onde atua: escopos e setores -->
      <div
        v-else-if="aba === 'escopos'"
        id="ficha-painel-escopos"
        class="painel"
        role="tabpanel"
        aria-labelledby="ficha-aba-escopos"
      >
        <p class="nota">{{ t('adm.ficha.escoposTexto') }}</p>
        <div class="escopos">
          <section
            v-for="tipo in TIPOS_ESCOPO"
            :key="tipo"
            class="cartao escopo"
            :aria-labelledby="`ficha-escopo-${tipo}`"
            :data-testid="`escopo-${tipo}`"
          >
            <h2 :id="`ficha-escopo-${tipo}`" class="cartao__titulo cartao__titulo--contagem">
              <span>{{ t(`adm.ficha.tipos.${tipo}`) }}</span>
              <span class="aba__n">{{ ficha.data.value.escopos[tipo]?.length ?? 0 }}</span>
            </h2>
            <ul v-if="(ficha.data.value.escopos[tipo] ?? []).length" class="chips">
              <li v-for="x in ficha.data.value.escopos[tipo] ?? []" :key="x.valor" class="chip">
                <span>{{ x.rotulo }}</span>
                <button
                  v-if="podeEscopo"
                  type="button"
                  class="chip__x"
                  :aria-label="t('adm.ficha.retirarItem', { item: x.rotulo })"
                  :title="t('adm.ficha.retirarItem', { item: x.rotulo })"
                  :disabled="ocupado || desligada(operacaoDeEscopo(tipo, 'retirar'))"
                  :data-testid="`retirar-${tipo}-${x.valor}`"
                  @click="escopo(tipo, 'retirar', x.valor)"
                >
                  <SanteIcone nome="fechar" tamanho="0.9em" />
                </button>
              </li>
            </ul>
            <p v-else class="sem-restricao">{{ t('adm.ficha.semRestricao') }}</p>
            <form
              v-if="podeEscopo && adicionando === tipo"
              class="adicionar"
              @submit.prevent="escopo(tipo, 'conceder', escolha[tipo] ?? '')"
            >
              <SanteSelecao
                :id="`conceder-${tipo}`"
                :model-value="escolha[tipo] ?? ''"
                class="selecao-larga"
                :rotulo="t('adm.ficha.escolher', { tipo: t(`adm.ficha.tipos.${tipo}`) })"
                :ocultar-rotulo="true"
                :opcoes="opcoesEscopo(tipo)"
                :data-testid="`escolher-${tipo}`"
                @update:model-value="(v) => (escolha[tipo] = v)"
              />
              <div class="adicionar__botoes">
                <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="fecharAdicionar" />
                <SanteBotao
                  :rotulo="t('adm.comum.conceder')"
                  tipo="submit"
                  :desabilitado="ocupado || !escolha[tipo]"
                  :data-testid="`conceder-${tipo}`"
                />
              </div>
            </form>
            <button
              v-else-if="
                podeEscopo && disponiveis(tipo).length && !desligada(operacaoDeEscopo(tipo, 'conceder'))
              "
              type="button"
              class="botao-adicionar"
              :aria-label="t('adm.ficha.adicionarEm', { tipo: t(`adm.ficha.tipos.${tipo}`) })"
              :disabled="ocupado"
              :data-testid="`adicionar-${tipo}`"
              @click="abrirAdicionar(tipo)"
            >
              <span aria-hidden="true">+</span> {{ t('adm.ficha.adicionar') }}
            </button>
            <small
              v-if="
                podeEscopo &&
                (desligada(operacaoDeEscopo(tipo, 'conceder')) ||
                  desligada(operacaoDeEscopo(tipo, 'retirar')))
              "
              class="motivo"
              >{{ t('adm.ficha.indisponivel') }}</small
            >
          </section>
          <section class="cartao escopo" aria-labelledby="ficha-escopo-setores" data-testid="escopo-setores">
            <h2 id="ficha-escopo-setores" class="cartao__titulo cartao__titulo--contagem">
              <span>{{ t('adm.ficha.setores') }}</span>
              <span class="aba__n">{{ ficha.data.value.setores.length }}</span>
            </h2>
            <ul v-if="ficha.data.value.setores.length" class="chips">
              <li v-for="x in ficha.data.value.setores" :key="x.valor" class="chip">
                <span>{{ x.rotulo }}</span>
                <button
                  v-if="podeEscopo"
                  type="button"
                  class="chip__x"
                  :aria-label="t('adm.ficha.retirarItem', { item: x.rotulo })"
                  :title="t('adm.ficha.retirarItem', { item: x.rotulo })"
                  :disabled="ocupado"
                  :data-testid="`retirar-setor-${x.valor}`"
                  @click="mudarSetor('retirar', x.valor)"
                >
                  <SanteIcone nome="fechar" tamanho="0.9em" />
                </button>
              </li>
            </ul>
            <p v-else class="sem-restricao">{{ t('adm.ficha.semRestricao') }}</p>
            <form
              v-if="podeEscopo && adicionando === 'setor'"
              class="adicionar"
              @submit.prevent="mudarSetor('conceder', setor)"
            >
              <SanteSelecao
                id="conceder-setor"
                v-model="setor"
                class="selecao-larga"
                :rotulo="t('adm.ficha.escolher', { tipo: t('adm.ficha.setores') })"
                :ocultar-rotulo="true"
                :opcoes="opcoesSetor"
                data-testid="escolher-setor"
              />
              <div class="adicionar__botoes">
                <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="fecharAdicionar" />
                <SanteBotao
                  :rotulo="t('adm.comum.conceder')"
                  tipo="submit"
                  :desabilitado="ocupado || !setor"
                  data-testid="conceder-setor"
                />
              </div>
            </form>
            <button
              v-else-if="podeEscopo && setoresDisponiveis.length"
              type="button"
              class="botao-adicionar"
              :aria-label="t('adm.ficha.adicionarEm', { tipo: t('adm.ficha.setores') })"
              :disabled="ocupado"
              data-testid="adicionar-setor"
              @click="abrirAdicionar('setor')"
            >
              <span aria-hidden="true">+</span> {{ t('adm.ficha.adicionar') }}
            </button>
          </section>
        </div>
        <p class="nota">
          {{
            t('adm.ficha.consultaOutras', {
              cc: ficha.data.value.escoposConsulta.centrosCusto,
              le: ficha.data.value.escoposConsulta.locaisEstoque,
              cb: ficha.data.value.escoposConsulta.contasBancarias,
            })
          }}
        </p>
      </div>

      <!-- Papéis SBIS -->
      <div
        v-else-if="aba === 'papeis'"
        id="ficha-painel-papeis"
        class="painel"
        role="tabpanel"
        aria-labelledby="ficha-aba-papeis"
      >
        <section class="cartao" aria-labelledby="ficha-papeis">
          <h2 id="ficha-papeis" class="cartao__titulo">{{ t('adm.ficha.papeis') }}</h2>
          <ul v-if="ficha.data.value.papeis.length" class="lista-linhas">
            <li v-for="p in ficha.data.value.papeis" :key="p.papel">
              <span>{{ p.nome }}</span>
              <span :class="['pilula', p.ativo ? 'pilula--ok' : 'pilula--neutra']">{{
                p.ativo ? t('adm.comum.ativo') : t('adm.comum.inativo')
              }}</span>
            </li>
          </ul>
          <p v-else class="sem-restricao">{{ t('adm.ficha.nenhumPapel') }}</p>
          <p class="nota">
            <router-link to="/administracao/acesso/perfis">{{ t('adm.ficha.papeisTexto') }}</router-link>
          </p>
        </section>
        <!-- W1-01 (parte 11d): conferência do conselho no vínculo usuário–profissional (quem gere acessos). -->
        <ConselhoUsuario v-if="podeGerirPin" :login="props.login" />
        <!-- W1-01 (parte 12a): "Aplicar acessos de…" (usuário-modelo; diferença antes de gravar). -->
        <AplicarModelo v-if="podeGerirPin" :login="props.login" @aplicado="void ficha.refetch()" />
      </div>

      <!-- Permissões complementares (W1-01: ligar e desligar com a letra de cada coluna) -->
      <div
        v-else-if="aba === 'flags'"
        id="ficha-painel-flags"
        class="painel"
        role="tabpanel"
        aria-labelledby="ficha-aba-flags"
      >
        <section class="cartao" aria-labelledby="ficha-flags">
          <h2 id="ficha-flags" class="cartao__titulo">{{ t('adm.ficha.flags') }}</h2>
          <p v-if="desligada(FLAGS_OP) && motivoFlags" class="motivo-bloco" data-testid="ficha-flags-motivo">
            <SanteIcone nome="cadeado" tamanho="1em" />{{ motivoFlags }}
          </p>
          <p v-else class="nota">{{ t('adm.ficha.flagsTexto') }}</p>
          <div class="flags-filtros">
            <div class="busca">
              <label for="ficha-flags-busca" class="sgh-visualmente-oculto">{{
                t('adm.ficha.flagsBusca')
              }}</label>
              <SanteIcone nome="busca" class="busca__icone" />
              <input
                id="ficha-flags-busca"
                v-model="buscaFlag"
                type="search"
                autocomplete="off"
                :placeholder="t('adm.ficha.flagsBusca')"
                data-testid="ficha-flags-busca"
              />
            </div>
            <fieldset class="segmentos">
              <legend class="sgh-visualmente-oculto">{{ t('adm.ficha.flagsMostrar') }}</legend>
              <label
                v-for="f in filtrosFlagVisiveis"
                :key="f"
                :class="['segmento', { 'segmento--ativo': filtroFlag === f }]"
              >
                <input v-model="filtroFlag" type="radio" name="ficha-flags-filtro" :value="f" />
                <span>{{ rotuloFiltroFlag(f) }}</span>
              </label>
            </fieldset>
          </div>
          <div data-testid="ficha-flags" class="flags">
            <p v-if="gruposFlags.length === 0" class="sem-restricao">{{ t('adm.ficha.flagsNenhuma') }}</p>
            <section
              v-for="g in gruposFlags"
              :key="g.chave"
              class="flags__grupo"
              :aria-labelledby="`ficha-flags-${g.chave}`"
            >
              <h3 :id="`ficha-flags-${g.chave}`" class="flags__titulo">
                {{ t(`adm.ficha.flagsGrupos.${g.chave}`) }} <span class="aba__n">{{ g.itens.length }}</span>
              </h3>
              <ul class="flags__lista">
                <li v-for="f in g.itens" :key="f.coluna" class="flag">
                  <span class="flag__textos">
                    <code class="flag__codigo">{{ f.coluna }}</code>
                    <span v-if="f.aConfirmar" class="flag__confirmar">{{ t('adm.comum.aConfirmar') }}</span>
                  </span>
                  <SanteChave
                    v-if="f.ligado !== null || f.podeLigar"
                    :ligada="valorFlag(f)"
                    :rotulo="f.coluna"
                    ocultar-rotulo
                    compacta
                    :desabilitada="!flagEditavel(f)"
                    :motivo="desligada(FLAGS_OP) ? motivoFlags : t('adm.ficha.flagSemLetra')"
                    :data-testid="`flag-${f.coluna}`"
                    @alternar="(v: boolean) => alternarFlag(f, v)"
                  />
                  <span v-else class="flag__indefinida">{{ t('adm.ficha.flagIndefinida') }}</span>
                </li>
              </ul>
            </section>
          </div>
          <div v-if="nPendentes > 0" class="flags-acoes" data-testid="flags-pendentes">
            <span class="nota">{{ t('adm.ficha.flagsPendentes', { n: nPendentes }) }}</span>
            <SanteBotao
              :rotulo="t('adm.ficha.flagsDescartar')"
              variante="secundario"
              data-testid="flags-descartar"
              @acionar="flagsPendentes = {}"
            />
            <SanteBotao
              :rotulo="t('adm.ficha.flagsSalvar')"
              :desabilitado="ocupado"
              data-testid="flags-salvar"
              @acionar="salvarFlags"
            />
          </div>
        </section>
      </div>

      <!-- Sessões e conexões -->
      <div
        v-else-if="aba === 'sessoes'"
        id="ficha-painel-sessoes"
        class="painel painel--dados"
        role="tabpanel"
        aria-labelledby="ficha-aba-sessoes"
      >
        <section class="cartao" aria-labelledby="ficha-sessoes">
          <h2 id="ficha-sessoes" class="cartao__titulo">{{ t('adm.ficha.sessoes') }}</h2>
          <p class="nota">{{ t('adm.ficha.sessoesTexto') }}</p>
          <ul data-testid="ficha-sessoes" class="lista-linhas">
            <li v-if="ficha.data.value.sessoes.length === 0" class="sem-restricao">
              {{ t('adm.ficha.semSessoes') }}
            </li>
            <li v-for="(x, i) in ficha.data.value.sessoes" :key="i" class="sessao">
              <span class="sessao__textos">
                <strong>{{ x.estabelecimento }}</strong>
                <span class="nota">
                  {{ t('adm.ficha.sessaoDesde', { em: dataHora(x.inicio) }) }} ·
                  {{ t('adm.ficha.sessaoUltimo', { em: dataHora(x.ultimoUso) }) }}
                </span>
              </span>
              <span class="pilulas">
                <span v-if="x.bloqueada" class="pilula pilula--aviso">{{
                  t('adm.ficha.sessaoBloqueada')
                }}</span>
                <span v-if="x.como" class="pilula pilula--neutra">{{ t('adm.ficha.sessaoComo') }}</span>
              </span>
            </li>
          </ul>
        </section>
        <section v-if="podeGerirPin" class="cartao" aria-labelledby="ficha-pin" data-testid="ficha-pin">
          <h2 id="ficha-pin" class="cartao__titulo">{{ t('adm.ficha.pin.titulo') }}</h2>
          <p class="nota">{{ t('adm.ficha.pin.texto') }}</p>
          <MensagemErro v-if="pinUsuario.isError.value" :erro="pinUsuario.error.value" />
          <template v-else-if="pinUsuario.data.value">
            <p v-if="!pinUsuario.data.value.ligada" class="nota" data-testid="ficha-pin-desligada">
              {{ t('adm.ficha.pin.desligada') }}
            </p>
            <p data-testid="ficha-pin-situacao">
              {{
                !pinUsuario.data.value.definido
                  ? t('adm.ficha.pin.naoDefinido')
                  : pinUsuario.data.value.criadoEm
                    ? t('adm.ficha.pin.definidoDesde', { data: dataHora(pinUsuario.data.value.criadoEm) })
                    : t('adm.ficha.pin.definido')
              }}
            </p>
            <SanteAlerta
              v-if="pinUsuario.data.value.bloqueado"
              :texto="t('adm.ficha.pin.bloqueado')"
              variante="aviso"
              data-testid="ficha-pin-bloqueado"
            />
            <SanteBotao
              v-if="pinUsuario.data.value.definido"
              :rotulo="t('adm.ficha.pin.retirar')"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="ficha-pin-retirar"
              @acionar="pedirRetirarPin"
            />
          </template>
        </section>

        <section class="cartao" aria-labelledby="ficha-conexoes">
          <h2 id="ficha-conexoes" class="cartao__titulo">{{ t('adm.ficha.conexoes') }}</h2>
          <table v-if="ficha.data.value.conexoes.length" class="tabela-simples">
            <thead>
              <tr>
                <th scope="col">{{ t('adm.ficha.conexaoModulo') }}</th>
                <th scope="col">{{ t('adm.ficha.conexaoUltima') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in ficha.data.value.conexoes" :key="c.modulo">
                <th scope="row">{{ c.nome }}</th>
                <td class="data">{{ dataHora(c.ultima) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="sem-restricao">{{ t('adm.ficha.semConexoes') }}</p>
        </section>
      </div>
    </template>

    <!-- Reautenticação: a senha de novo na hora da gravação (nunca guardada), no diálogo único de @sgh/ui -->
    <SanteDialogoGravacao
      v-model:visivel="dialogoSenha"
      v-model:ocupado="ocupado"
      :pedido="pedidoGravacao"
      :testids="TESTIDS_SENHA"
      @feito="gravadoComSenha"
      @falha="tratarFalha"
    />

    <!-- W1-01: a senha provisória, uma vez, só para quem redefiniu (fechar apaga) -->
    <SanteDialogo
      v-model:visivel="dialogoProvisoria"
      :titulo="provisoria ? t('adm.ficha.provisoria.titulo', { login: provisoria.login }) : ''"
    >
      <div v-if="provisoria" class="form-senha" data-testid="senha-provisoria">
        <p>{{ t('adm.ficha.provisoria.texto') }}</p>
        <SanteAlerta
          v-if="!provisoria.trocaObrigatoria"
          :texto="t('adm.ficha.provisoria.semTroca')"
          variante="aviso"
          data-testid="senha-provisoria-sem-troca"
        />
        <code class="senha-provisoria" data-testid="senha-provisoria-valor">{{ provisoria.senha }}</code>
        <div class="botoes">
          <SanteBotao
            :rotulo="copiada ? t('adm.ficha.provisoria.copiada') : t('adm.ficha.provisoria.copiar')"
            variante="texto"
            data-testid="senha-provisoria-copiar"
            @acionar="copiarProvisoria"
          />
          <SanteBotao
            :rotulo="t('adm.ficha.provisoria.fechar')"
            data-testid="senha-provisoria-fechar"
            @acionar="dialogoProvisoria = false"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.senha-provisoria {
  display: block;
  padding: var(--sgh-espaco-2);
  font-size: 1.25rem;
  letter-spacing: 0.08em;
  text-align: center;
  user-select: all;
  overflow-wrap: anywhere;
}
.ficha {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.trilha__voltar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  color: var(--sgh-link);
  font-size: var(--sgh-fonte-pequena);
}
.trilha__seta {
  transform: scaleX(-1);
}
.falha,
.resultado {
  display: grid;
  gap: var(--sgh-espaco-2);
  justify-items: start;
}
.resultado {
  justify-items: stretch;
  scroll-margin-top: var(--sgh-espaco-4);
}
/* Esqueleto do carregamento: a forma da ficha, sem pulo quando os dados chegam. */
.esqueleto {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.esqueleto__perfil {
  display: flex;
  gap: var(--sgh-espaco-3);
  align-items: center;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
}
.esqueleto__linhas {
  display: grid;
  gap: var(--sgh-espaco-2);
  flex: 1;
}
.esqueleto__bloco {
  display: block;
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
  animation: pulsar 1.4s ease-in-out infinite;
}
.esqueleto__bloco--avatar {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
}
.esqueleto__bloco--titulo {
  height: 1.5rem;
  width: min(20rem, 70%);
}
.esqueleto__bloco--curto {
  height: 1rem;
  width: min(10rem, 40%);
}
.esqueleto__bloco--abas {
  height: var(--sgh-alvo-minimo);
}
.esqueleto__bloco--cartao {
  height: 12rem;
}
@keyframes pulsar {
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .esqueleto__bloco {
    animation: none;
  }
}
.link-acao {
  margin-left: var(--sgh-espaco-1);
  color: var(--sgh-link);
  white-space: nowrap;
}
.nota {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.mono {
  font-family: var(--sgh-fonte-codigo);
}
/* Cartão de perfil */
.perfil {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--sgh-espaco-3);
  align-items: center;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  border-top: 4px solid var(--sgh-primaria);
}
.perfil__avatar {
  display: inline-grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 700;
  font-size: 1.4rem;
  font-family: var(--sgh-fonte-titulo);
}
.perfil__textos {
  display: grid;
  gap: var(--sgh-espaco-1);
  min-width: 0;
}
.perfil__nome {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.perfil__nome--vazio {
  color: var(--sgh-texto-secundario);
  font-style: italic;
  font-weight: 400;
}
.perfil__login {
  margin: 0;
  font-family: var(--sgh-fonte-codigo);
  color: var(--sgh-texto-secundario);
  overflow-wrap: anywhere;
}
.perfil__acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.botao-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  color: var(--sgh-texto);
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}
.botao-link:hover {
  background: var(--sgh-fundo-sutil);
}
.pilulas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.pilula {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px var(--sgh-espaco-2);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  border: 1px solid currentcolor;
  white-space: nowrap;
}
.pilula--ok {
  color: var(--sgh-sucesso);
}
.pilula--neutra {
  color: var(--sgh-texto-secundario);
}
.pilula--aviso {
  color: var(--sgh-aviso);
}
.pilula--alerta {
  color: var(--sgh-alerta);
  background: var(--sgh-alerta-suave);
}
.etiqueta {
  display: inline-block;
  padding: 1px var(--sgh-espaco-2);
  border-radius: var(--p-button-border-radius, 6px);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  font-size: var(--sgh-fonte-pequena);
  font-family: var(--sgh-fonte-codigo);
  white-space: nowrap;
}
.etiqueta--texto {
  font-family: inherit;
}
/* Aviso único das gravações desligadas */
.desligadas {
  border: 1px solid var(--sgh-aviso);
  background: var(--sgh-aviso-suave);
  border-radius: var(--p-button-border-radius, 6px);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  color: var(--sgh-texto);
}
.desligadas summary {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  cursor: pointer;
  font-weight: 600;
  flex-wrap: wrap;
}
.desligadas__ver {
  margin-left: auto;
  font-weight: 400;
  text-decoration: underline;
  font-size: var(--sgh-fonte-pequena);
}
.desligadas__grupo {
  margin-top: var(--sgh-espaco-2);
  padding-top: var(--sgh-espaco-2);
  border-top: 1px solid var(--sgh-borda);
}
.desligadas__motivo {
  margin: 0 0 var(--sgh-espaco-1);
}
.desligadas__afeta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.desligadas__rotulo {
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
}
/* Abas */
.abas {
  /* relative: o texto oculto das contagens (posição absoluta) fica preso na rolagem, sem alargar a página. */
  position: relative;
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  overflow-x: auto;
  scrollbar-width: none;
}
/* Abas que não cabem (celular): a borda some em degradê do lado em que há mais abas (a máscara usa só o alfa). */
.abas--depois {
  mask-image: linear-gradient(to right, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes {
  mask-image: linear-gradient(to left, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes.abas--depois {
  mask-image: linear-gradient(
    to right,
    transparent,
    var(--sgh-texto) 3rem,
    var(--sgh-texto) calc(100% - 3rem),
    transparent
  );
}
.aba {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.aba:hover {
  color: var(--sgh-texto);
}
.aba[aria-selected='true'] {
  color: var(--sgh-texto);
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.aba__n {
  display: inline-grid;
  place-items: center;
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  color: var(--sgh-texto);
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.painel--dados {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  align-items: start;
}
/* Cartões */
.cartao {
  display: grid;
  gap: var(--sgh-espaco-3);
  align-content: start;
  padding: var(--sgh-espaco-3) var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  min-width: 0;
}
.cartao__titulo {
  margin: 0;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.cartao__titulo--contagem {
  align-items: baseline;
}
.fatos {
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.fatos > div {
  display: grid;
  grid-template-columns: minmax(6rem, 9rem) 1fr;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.fatos dt {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.fatos dd {
  margin: 0;
}
/* Identificação: rótulo acima e valor abaixo, como nos campos editáveis do mesmo cartão. */
.fatos--empilhados > div {
  grid-template-columns: 1fr;
  gap: 2px;
}
.fatos--empilhados dt {
  color: var(--sgh-texto);
  font-size: inherit;
  font-weight: 600;
}
.cpf {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.olho {
  display: inline-grid;
  place-items: center;
  min-width: var(--sgh-alvo-minimo);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
}
.olho:hover {
  background: var(--sgh-fundo-sutil);
  color: var(--sgh-texto);
}
.olho:focus-visible,
.chip__x:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
.campo-acao {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
  align-items: end;
}
.campo-acao .motivo {
  grid-column: 1 / -1;
}
/* O botão fica na altura do campo (o rótulo acima tem uma linha; o contador abaixo não conta). */
.campo-acao__botao--sob-rotulo {
  align-self: start;
  margin-top: calc(1lh + var(--sgh-espaco-1));
}
.campo-acao .selecao-empilhada {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.selecao-empilhada :deep(.sgh-selecao__rotulo) {
  font-weight: 600;
}
.selecao-empilhada :deep(.sgh-selecao__campo) {
  width: 100%;
}
/* "Onde atua": "+ Adicionar" discreto; o combo (largura toda) só aparece quando se vai adicionar. */
.botao-adicionar {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  border: 1px dashed var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  background: transparent;
  color: var(--sgh-link);
  font: inherit;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  cursor: pointer;
}
.botao-adicionar:hover:not(:disabled) {
  background: var(--sgh-fundo-sutil);
}
.botao-adicionar:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
.botao-adicionar:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.adicionar {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.adicionar .selecao-larga {
  display: flex;
  width: 100%;
}
.selecao-larga :deep(.sgh-selecao__campo) {
  flex: 1;
  min-width: 0;
}
.adicionar__botoes {
  display: flex;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
.motivo {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.motivo-bloco {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: flex-start;
  margin: 0;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
  font-size: var(--sgh-fonte-pequena);
}
/* Escopos com chips */
.escopos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  gap: var(--sgh-espaco-3);
}
.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px var(--sgh-espaco-2);
  border-radius: 999px;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-texto);
  font-size: var(--sgh-fonte-pequena);
  max-width: 100%;
}
.chip > span {
  overflow-wrap: anywhere;
}
.chip__x {
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--sgh-texto);
  cursor: pointer;
}
.chip__x:hover:not(:disabled) {
  background: var(--sgh-fundo-elevado);
}
.chip__x:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.sem-restricao {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-style: italic;
}
/* Listas em linhas */
.lista-linhas {
  list-style: none;
  margin: 0;
  padding: 0;
}
.lista-linhas > li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2) 0;
  border-bottom: 1px solid var(--sgh-borda);
  flex-wrap: wrap;
}
.lista-linhas > li:last-child {
  border-bottom: 0;
}
.sessao__textos {
  display: grid;
  gap: 2px;
}
.tabela-simples {
  width: 100%;
  border-collapse: collapse;
}
.tabela-simples th,
.tabela-simples td {
  text-align: left;
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
  font-weight: 400;
}
.tabela-simples thead th {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
}
.data {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* Permissões complementares */
.flags-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  justify-content: flex-end;
  margin-top: var(--sgh-espaco-3);
}
.flags-filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.busca {
  position: relative;
  flex: 1 1 14rem;
  min-width: 0;
}
.busca__icone {
  position: absolute;
  left: var(--sgh-espaco-2);
  top: 50%;
  transform: translateY(-50%);
  color: var(--sgh-texto-secundario);
  pointer-events: none;
}
.busca input {
  font: inherit;
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2) var(--sgh-espaco-1) calc(var(--sgh-espaco-2) + 1.6em);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.segmentos {
  display: inline-flex;
  flex-wrap: wrap;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
}
.segmento {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: calc(var(--sgh-alvo-minimo) - 6px);
  padding: 0 var(--sgh-espaco-3);
  border-radius: var(--p-button-border-radius, 6px);
  cursor: pointer;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.segmento input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
.segmento--ativo {
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--sgh-borda);
}
.segmento:has(input:focus-visible) {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
.flags {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.flags__titulo {
  margin: 0 0 var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-base);
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.flags__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.flag {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sgh-espaco-2);
  padding: 2px var(--sgh-espaco-2);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
}
.flag__textos {
  display: grid;
  min-width: 0;
}
.flag__confirmar {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  font-style: italic;
}
.flag__codigo {
  font-family: var(--sgh-fonte-codigo);
  font-size: var(--sgh-fonte-pequena);
  overflow-wrap: anywhere;
}
.flag__indefinida {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  font-style: italic;
  min-height: var(--sgh-alvo-minimo);
  display: inline-flex;
  align-items: center;
}
@media (width <= 40rem) {
  .perfil {
    grid-template-columns: auto 1fr;
    padding: var(--sgh-espaco-3);
  }
  .perfil__avatar {
    width: 3rem;
    height: 3rem;
    font-size: 1.1rem;
  }
  .perfil__acoes {
    grid-column: 1 / -1;
  }
  .perfil__nome {
    font-size: 1.25rem;
  }
  .fatos > div {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .segmentos {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
  }
  .segmento {
    flex: 1 0 auto;
    justify-content: center;
    white-space: nowrap;
  }
}
</style>
