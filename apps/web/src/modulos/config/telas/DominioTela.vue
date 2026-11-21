<script setup lang="ts">
// Tela gerada do CRUD genérico (M08; ficha, seção 7): uma para cada domínio declarado, montada da descrição
// que a API devolve (campos, rótulos, tamanho em bytes CP1252, valores vistos, ações permitidas). Lista,
// filtro e ordenação no servidor, com teto; incluir, alterar (com a versão lida: colisão vira o aviso do M07)
// e inativar (com o uso pelas FKs: em uso pede confirmação); exportar (CSV, auditado). As ações aparecem só
// com a permissão; o servidor confere de novo. Nenhum nome de tabela do legado na tela.
// W0-02: Reativar (com motivo) também nos cadastros que inativam pela situação; Excluir (com motivo e a senha de
// novo, operação crítica; o próprio diálogo é a confirmação, por isso o botão não é o destrutivo de dupla pergunta) no domínio que declara a exclusão: com registros dependentes, a recusa mostra quantos e quais
// (rótulo, quantidade e amostra) e oferece "Inativar em vez disso"; a recusa do banco chega com a mensagem dele. O
// texto longo editável entra no formulário da alteração e da inclusão (editor de texto).
// Revisão do W0-02: Inativar pede o motivo (o mesmo diálogo de gravação); Excluir, Reativar e Inativar mandam a versão que
// a pessoa viu na lista (a colisão vira o aviso do M07 sobre a lista); o Reativar segue a liberação da própria operação;
// "Inativar em vez disso" só para o item ativo; o aviso da exclusão só promete o histórico quando a exclusão o guarda;
// o diálogo dos textos só manda usar Alterar quando o item está ativo e a pessoa pode alterar.
import type { CampoDescrito, DependenteItem, ItemDominio, Problema, ValorCampo } from '@sgh/contratos';
import {
  type PedidoGravacao,
  SanteAlerta,
  SanteAvisoColisao,
  SanteBotao,
  SanteCampoTexto,
  SanteDialogo,
  SanteDialogoGravacao,
  SanteSelecao,
} from '@sgh/ui';
import { tipoDoProblema } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  alterarItem,
  buscarDominio,
  buscarItem,
  buscarOpcoes,
  buscarTextos,
  buscarUso,
  excluirItem,
  exportarItens,
  incluirItem,
  inativarItem,
  listarItens,
  reativarItem,
} from '../api-m08.js';

// `secundaria`: a tela entra numa página que já tem o seu título (M11: especialidades e CBO na mesma página).
// M14: `referencia` filtra a lista pelos itens de um mestre (tela mestre-detalhe; a inclusão já vem com ele) e
// `selecionavel` mostra "ver os itens" em cada linha (o mestre escolhe o registro).
// M53.2: `abrir` filtra a lista pelo item que a tela de fora escolheu (`busca`) e, com a permissão de alterar e a
// gravação não recusada, abre a alteração dele (`codigo`) uma vez, assim que a descrição chega.
const props = defineProps<{
  modulo: string;
  recurso: string;
  secundaria?: boolean;
  referencia?: { campo: string; valor: string } | null;
  selecionavel?: boolean;
  abrir?: { codigo: string; busca: string } | null;
}>();
const emit = defineEmits<{ selecionar: [item: ItemDominio] }>();
const { t } = useI18n();

const descricao = useQuery({
  queryKey: computed(() => ['dominios', props.modulo, props.recurso]),
  queryFn: () => buscarDominio(props.modulo, props.recurso),
});
const d = computed(() => descricao.data.value);
const pode = (a: string) => d.value?.permitidas.includes(a as never) ?? false;
// A ação de escrita que a permissão deixa e o executor recusaria agora aparece desabilitada, com o aviso.
const recusada = (a: string) => !!d.value?.recusadas?.[a];
const avisoEscrita = computed(() => {
  const escritas = (['criar', 'editar', 'inativar', 'excluir'] as const).filter((a) => pode(a));
  const recusadas = escritas.filter((a) => recusada(a));
  if (recusadas.length === 0) return null;
  if (recusadas.length === escritas.length) return t('liberacao.escritaRecusada');
  return [...new Set(recusadas.map((a) => d.value?.recusadas?.[a] ?? ''))].filter(Boolean).join(' ');
});

const filtro = reactive({
  busca: props.abrir?.busca ?? '',
  ordem: '',
  direcao: 'asc' as 'asc' | 'desc',
  pagina: 1,
  inativos: false,
});
const lista = useQuery({
  queryKey: computed(() => [
    'dominios',
    props.modulo,
    props.recurso,
    'itens',
    { ...filtro },
    props.referencia ?? null,
  ]),
  queryFn: () =>
    listarItens(
      props.modulo,
      props.recurso,
      {
        ...(filtro.busca ? { busca: filtro.busca } : {}),
        ...(filtro.ordem ? { ordem: filtro.ordem, direcao: filtro.direcao } : {}),
        pagina: filtro.pagina,
        porPagina: 25,
        ...(filtro.inativos ? { inativos: 'sim' as const } : {}),
      },
      fetch,
      props.referencia ?? null,
    ),
  enabled: computed(() => d.value !== undefined),
});
const colunas = computed(() => (d.value?.campos ?? []).filter((c) => c.naLista));
const totalPaginas = computed(() => Math.max(1, Math.ceil((lista.data.value?.total ?? 0) / 25)));

// Opções dos campos de referência (do servidor).
const opcoes = ref<Record<string, { valor: number | string; rotulo: string }[]>>({});
watch(d, async (x) => {
  if (!x) return;
  for (const c of x.campos.filter((y) => y.referencia)) {
    try {
      opcoes.value[c.campo] = (await buscarOpcoes(props.modulo, props.recurso, c.campo)).opcoes.filter(
        (o) => o.ativo,
      );
    } catch {
      opcoes.value[c.campo] = [];
    }
  }
});

function ordenar(campo: string): void {
  if (filtro.ordem === campo) filtro.direcao = filtro.direcao === 'asc' ? 'desc' : 'asc';
  else {
    filtro.ordem = campo;
    filtro.direcao = 'asc';
  }
  filtro.pagina = 1;
}

function exibir(c: CampoDescrito, v: ValorCampo | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (c.valores) return c.valores.find((x) => x.valor === String(v))?.rotulo ?? String(v);
  if (c.referencia)
    return opcoes.value[c.campo]?.find((x) => String(x.valor) === String(v))?.rotulo ?? String(v);
  return String(v);
}

// ── formulário (incluir e alterar) ──
const dialogo = ref(false);
const editando = ref<ItemDominio | null>(null);
const valores = ref<Record<string, ValorCampo>>({});
const textos = ref<Record<string, string>>({});
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const colisao = ref<Problema | null>(null);
const erroForm = ref<unknown>(null);
const salvando = ref(false);

const camposDoForm = computed(() =>
  (d.value?.campos ?? []).filter((c) => (editando.value ? c.editavel : c.naInclusao)),
);
// W0-02 (D-CRUD-30): os textos longos editáveis entram na alteração (carregados do item ao abrir).
const textosEditaveis = computed(() => (d.value?.textosLongos ?? []).filter((x) => x.editavel));
const textosLongosForm = ref<Record<string, string>>({});
const textosLongosOriginais = ref<Record<string, string>>({});

// Campos digitados (os demais, fora o texto, escolhem de uma lista: valores vistos ou referência).
const TIPOS_DIGITADOS = new Set<CampoDescrito['tipo']>(['inteiro', 'decimal', 'data', 'hora']);
const rotuloDoCampo = (c: CampoDescrito) =>
  c.aConfirmar ? `${c.rotulo}(${t('dominios.aConfirmar')})` : c.rotulo;
// Opções de cada campo de escolha do formulário (o texto com referência guarda o código como texto).
const opcoesDoForm = computed(() => {
  const r: Record<string, { valor: ValorCampo; rotulo: string }[]> = {};
  for (const c of camposDoForm.value) {
    if (c.tipo === 'texto' && c.referencia)
      r[c.campo] = [
        ...(c.obrigatorio ? [] : [{ valor: '', rotulo: t('dominios.nenhumaOpcao') }]),
        ...(opcoes.value[c.campo] ?? []).map((o) => ({ valor: String(o.valor), rotulo: o.rotulo })),
      ];
    else if (c.tipo !== 'texto' && !TIPOS_DIGITADOS.has(c.tipo))
      r[c.campo] = [
        ...(c.obrigatorio ? [] : [{ valor: null, rotulo: t('dominios.nenhumaOpcao') }]),
        ...(c.valores ?? opcoes.value[c.campo] ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
      ];
  }
  return r;
});

function abrirIncluir(): void {
  editando.value = null;
  valores.value = {};
  textos.value = {};
  for (const c of d.value?.campos ?? []) if (c.tipo === 'texto') textos.value[c.campo] = '';
  // Revisão do W0-02: o texto longo editável também na inclusão (começa vazio).
  textosLongosForm.value = {};
  textosLongosOriginais.value = {};
  for (const x of textosEditaveis.value) {
    textosLongosForm.value[x.campo] = '';
    textosLongosOriginais.value[x.campo] = '';
  }
  // M14: na tela mestre-detalhe, o item novo já vem ligado ao registro do mestre.
  const ref = props.referencia;
  if (ref) {
    const c = d.value?.campos.find((x) => x.campo === ref.campo);
    if (c?.tipo === 'texto') textos.value[c.campo] = ref.valor;
    else if (c)
      valores.value[c.campo] =
        c.tipo === 'inteiro' || c.tipo === 'referencia' ? Number(ref.valor) : ref.valor;
  }
  limparAvisos();
  dialogo.value = true;
}

async function abrirAlterar(codigo: string): Promise<void> {
  limparAvisos();
  const i = await buscarItem(props.modulo, props.recurso, codigo);
  editando.value = i;
  valores.value = { ...i.valores };
  textos.value = {};
  for (const c of d.value?.campos ?? [])
    if (c.tipo === 'texto') textos.value[c.campo] = String(i.valores[c.campo] ?? '');
  textosLongosForm.value = {};
  textosLongosOriginais.value = {};
  if (textosEditaveis.value.length > 0) {
    const lidos = (await buscarTextos(props.modulo, props.recurso, codigo)).textos;
    for (const x of textosEditaveis.value) {
      textosLongosForm.value[x.campo] = lidos[x.campo] ?? '';
      textosLongosOriginais.value[x.campo] = lidos[x.campo] ?? '';
    }
  }
  dialogo.value = true;
}

function limparAvisos(): void {
  recusa.value = null;
  colisao.value = null;
  erroForm.value = null;
}

function tratarErro(e: unknown): void {
  if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'conflito-de-versao')
    colisao.value = e.problema;
  else if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erroForm.value = e;
}

function valoresDoForm(): Record<string, ValorCampo> {
  const r: Record<string, ValorCampo> = {};
  for (const c of camposDoForm.value) {
    if (c.tipo === 'texto') r[c.campo] = textos.value[c.campo] ?? '';
    else if (c.tipo === 'inteiro' || c.tipo === 'referencia' || c.tipo === 'decimal') {
      const v = valores.value[c.campo];
      r[c.campo] = v === '' || v === null || v === undefined ? null : Number(v);
    } else r[c.campo] = (valores.value[c.campo] as string | null | undefined) ?? null;
  }
  return r;
}

// Combo obrigatório sem escolha: a gravação não sai (o select nativo antigo barrava pelo `required`).
function comboObrigatorioVazio(): CampoDescrito | undefined {
  return camposDoForm.value.find((c) => {
    if (!c.obrigatorio || opcoesDoForm.value[c.campo] === undefined) return false;
    const v = c.tipo === 'texto' ? textos.value[c.campo] : valores.value[c.campo];
    return v === '' || v === null || v === undefined;
  });
}

async function salvar(): Promise<void> {
  if (!d.value) return;
  limparAvisos();
  const vazio = comboObrigatorioVazio();
  if (vazio) {
    recusa.value = t('dominios.escolhaObrigatoria', { campo: vazio.rotulo });
    return;
  }
  salvando.value = true;
  try {
    const v = valoresDoForm();
    // W0-02: só o texto longo que mudou vai na alteração (vazio grava vazio); na inclusão, o preenchido.
    for (const x of textosEditaveis.value)
      if ((textosLongosForm.value[x.campo] ?? '') !== (textosLongosOriginais.value[x.campo] ?? ''))
        v[x.campo] = textosLongosForm.value[x.campo] || null;
    const r = editando.value
      ? await alterarItem(props.modulo, props.recurso, editando.value.codigo, editando.value.versao, v)
      : await incluirItem(
          props.modulo,
          props.recurso,
          Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)),
        );
    mensagem.value =
      (editando.value ? t('dominios.alterado') : t('dominios.incluido', { codigo: r.codigo })) +
      (r.destino === 'memoria' ? ` ${t('dominios.memoria')}` : '');
    dialogo.value = false;
    await lista.refetch();
  } catch (e) {
    tratarErro(e);
  } finally {
    salvando.value = false;
  }
}

async function rever(): Promise<void> {
  // Colisão: relê o item (o que está no banco agora), mantendo o que a pessoa digitou nos campos.
  if (!editando.value) return;
  const digitado = { ...textos.value };
  const i = await buscarItem(props.modulo, props.recurso, editando.value.codigo);
  editando.value = i;
  textos.value = { ...textos.value, ...digitado };
  colisao.value = null;
}

// ── diálogo de gravação (inativar, reativar e excluir pedem o motivo; excluir, também a senha) ──
const gravacaoVisivel = ref(false);
const pedido = ref<PedidoGravacao | null>(null);
/** O item da gravação pedida (a recusa da exclusão oferece inativar este, se estiver ativo). */
const alvoGravacao = ref<ItemDominio | null>(null);

// ── inativar (revisão do W0-02: com o motivo, no diálogo de gravação) ──
const emUso = ref<{ codigo: string; aviso: string; versao: string; motivo: string } | null>(null);
/** Colisão numa ação da lista (inativar, reativar, excluir): o aviso do M07, com "rever" relendo a lista. */
const colisaoLista = ref<Problema | null>(null);
function inativar(i: ItemDominio): void {
  mensagem.value = null;
  recusa.value = null;
  colisaoLista.value = null;
  alvoGravacao.value = i;
  pedido.value = {
    titulo: t('dominios.tituloInativar', { codigo: i.codigo }),
    texto: t('dominios.confirmarInativar', { codigo: i.codigo }),
    motivo: t('dominios.motivoInativar'),
    senha: false,
    confirmar: t('dominios.inativar'),
    gravar: async ({ motivo }) => {
      const u = await buscarUso(props.modulo, props.recurso, i.codigo);
      if (u.emUso) {
        emUso.value = { codigo: i.codigo, aviso: u.aviso ?? '', versao: i.versao, motivo };
        return;
      }
      await inativarItem(props.modulo, props.recurso, i.codigo, i.versao, motivo, false);
      mensagem.value = t('dominios.inativado');
      await lista.refetch();
    },
  };
  gravacaoVisivel.value = true;
}
async function inativarEmUso(): Promise<void> {
  if (!emUso.value) return;
  try {
    await inativarItem(
      props.modulo,
      props.recurso,
      emUso.value.codigo,
      emUso.value.versao,
      emUso.value.motivo,
      true,
    );
    emUso.value = null;
    mensagem.value = t('dominios.inativado');
    await lista.refetch();
  } catch (e) {
    emUso.value = null;
    falhaGravacao(e);
  }
}

// ── reativar (correção do M14; W0-02: também pela situação do cadastro) e excluir (W0-02), com motivo ──
const podeReativar = computed(
  () => pode('inativar') && !!(d.value?.inativacaoSoNoNovo || d.value?.reativaNaSituacao),
);
function reativar(i: ItemDominio): void {
  mensagem.value = null;
  recusa.value = null;
  colisaoLista.value = null;
  alvoGravacao.value = i;
  pedido.value = {
    titulo: t('dominios.tituloReativar', { codigo: i.codigo }),
    texto: t('dominios.confirmarReativar', { codigo: i.codigo }),
    motivo: t('dominios.motivoReativar'),
    senha: false,
    confirmar: t('dominios.reativar'),
    gravar: async ({ motivo }) => {
      // A versão que a pessoa viu na lista (mudou por fora: o aviso de colisão).
      await reativarItem(props.modulo, props.recurso, i.codigo, i.versao, motivo);
      mensagem.value = t('dominios.reativado');
      await lista.refetch();
    },
  };
  gravacaoVisivel.value = true;
}

/** A recusa da exclusão com os registros dependentes (rótulo, quantidade e amostra) e a oferta de inativar. */
const dependentes = ref<{
  item: ItemDominio;
  texto: string;
  lista: DependenteItem[];
  podeInativar: boolean;
} | null>(null);
const dependentesVisivel = ref(false);
function excluir(i: ItemDominio): void {
  mensagem.value = null;
  recusa.value = null;
  colisaoLista.value = null;
  alvoGravacao.value = i;
  pedido.value = {
    titulo: t('dominios.tituloExcluir', { codigo: i.codigo }),
    texto: d.value?.exclusaoProtegida
      ? t('dominios.confirmarExcluir', { codigo: i.codigo })
      : t('dominios.confirmarExcluirSemHistorico', { codigo: i.codigo }),
    motivo: t('dominios.motivoExcluir'),
    senha: true,
    confirmar: t('dominios.excluir'),
    gravar: async ({ motivo, senha }) => {
      // A versão que a pessoa viu na lista (mudou por fora: o aviso de colisão, nada apagado).
      await excluirItem(props.modulo, props.recurso, i.codigo, i.versao, motivo, senha);
      mensagem.value = t('dominios.excluido', { codigo: i.codigo });
      await lista.refetch();
    },
  };
  gravacaoVisivel.value = true;
}
function falhaGravacao(e: unknown): void {
  const p = e instanceof ErroApi ? e.problema : null;
  if (p && p.codigo === 'com-dependentes' && alvoGravacao.value) {
    dependentes.value = {
      item: alvoGravacao.value,
      texto: p.detail ?? '',
      lista: (p.dependentes ?? []) as DependenteItem[],
      // Só o item ativo recebe a oferta de inativar (o inativo já está inativo).
      podeInativar: p.podeInativar === true && pode('inativar') && alvoGravacao.value.ativo,
    };
    dependentesVisivel.value = true;
    return;
  }
  // A colisão de uma ação da lista: o aviso do M07 (o formulário tem o seu).
  if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'conflito-de-versao') {
    colisaoLista.value = e.problema;
    return;
  }
  tratarErro(e);
}
function inativarEmVezDeExcluir(): void {
  const x = dependentes.value;
  dependentesVisivel.value = false;
  dependentes.value = null;
  if (x) inativar(x.item);
}
async function reverLista(): Promise<void> {
  colisaoLista.value = null;
  await lista.refetch();
}

// ── textos longos em leitura (correção do M14) ──
const textosAbertos = ref<{ codigo: string; ativo: boolean; textos: Record<string, string | null> } | null>(
  null,
);
const textosVisiveis = ref(false);
/** O texto do diálogo: "use Alterar" só quando o item aberto está ativo e a pessoa pode alterá-lo agora. */
const avisoTextos = computed(() => {
  if (textosEditaveis.value.length === 0) return t('dominios.textosSomenteLeitura');
  if (!pode('editar') || recusada('editar')) return t('dominios.textosSomenteLeitura');
  return textosAbertos.value?.ativo === false ? t('dominios.textosInativo') : t('dominios.textosEditaveis');
});
async function verTextos(i: ItemDominio): Promise<void> {
  try {
    textosAbertos.value = {
      codigo: i.codigo,
      ativo: i.ativo,
      textos: (await buscarTextos(props.modulo, props.recurso, i.codigo)).textos,
    };
    textosVisiveis.value = true;
  } catch (e) {
    tratarErro(e);
  }
}
const temAcoes = computed(
  () =>
    pode('editar') ||
    pode('inativar') ||
    pode('excluir') ||
    props.selecionavel === true ||
    (d.value?.textosLongos?.length ?? 0) > 0,
);

// ── exportar ──
const linkExportacao = ref<string | null>(null);
async function exportar(): Promise<void> {
  try {
    const csv = await exportarItens(props.modulo, props.recurso);
    if (linkExportacao.value) URL.revokeObjectURL(linkExportacao.value);
    linkExportacao.value = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    mensagem.value = t('dominios.exportado');
  } catch (e) {
    tratarErro(e);
  }
}

// M53.2: no fim do setup, para a alteração já encontrar todo o estado da tela (a descrição pode vir do cache).
const abrirPendente = ref(props.abrir ?? null);
watch(
  d,
  (x) => {
    const a = abrirPendente.value;
    if (!x || !a) return;
    abrirPendente.value = null;
    if (pode('editar') && !recusada('editar')) void abrirAlterar(a.codigo).catch(tratarErro);
  },
  { immediate: true },
);
</script>

<template>
  <section
    class="tela"
    :aria-labelledby="`dominio-titulo-${props.recurso}`"
    :data-testid="`tela-dominio-${props.modulo}.${props.recurso}`"
  >
    <MensagemErro v-if="descricao.isError.value" :erro="descricao.error.value" />
    <p v-else-if="!d">{{ t('dominios.carregando') }}</p>
    <template v-else>
      <component :is="props.secundaria ? 'h2' : 'h1'" :id="`dominio-titulo-${props.recurso}`">{{
        d.rotulo.plural
      }}</component>
      <SanteAlerta
        v-if="d.motivoSomenteLeitura"
        :texto="t('dominios.somenteConsulta', { motivo: d.motivoSomenteLeitura })"
        variante="info"
      />
      <SanteAlerta
        v-if="d.semInclusao"
        :texto="t('dominios.semInclusao', { motivo: d.semInclusao })"
        variante="info"
        data-testid="dominio-sem-inclusao"
      />
      <SanteAlerta
        v-if="d.inativacaoSoNoNovo && pode('inativar')"
        :texto="t('dominios.inativacaoSoNoNovo')"
        variante="info"
        data-testid="dominio-inativacao-no-novo"
      />
      <SanteAlerta
        v-if="avisoEscrita"
        :texto="avisoEscrita"
        variante="info"
        icone="info"
        data-testid="dominio-escrita-recusada"
      />
      <p v-if="mensagem" role="status" data-testid="mensagem-dominio">{{ mensagem }}</p>
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-dominio" />
      <SanteAvisoColisao
        v-if="colisaoLista"
        :problema="colisaoLista"
        data-testid="colisao-lista"
        @rever="reverLista"
        @descartar="colisaoLista = null"
      />
      <div class="barra">
        <label :for="`busca-${d.recurso}`">{{ t('dominios.buscar') }}</label>
        <input
          :id="`busca-${d.recurso}`"
          v-model="filtro.busca"
          type="search"
          data-testid="busca-dominio"
          @input="filtro.pagina = 1"
        />
        <label class="marcar">
          <input v-model="filtro.inativos" type="checkbox" data-testid="mostrar-inativos" />
          {{ t('dominios.mostrarInativos') }}
        </label>
        <SanteBotao
          v-if="pode('criar')"
          :rotulo="t('dominios.incluir')"
          variante="primario"
          :desabilitado="recusada('criar')"
          data-testid="botao-incluir"
          @acionar="abrirIncluir"
        />
        <SanteBotao
          v-if="pode('exportar')"
          :rotulo="t('dominios.exportar')"
          variante="secundario"
          data-testid="botao-exportar"
          @acionar="exportar"
        />
        <a v-if="linkExportacao" :href="linkExportacao" :download="`${d.recurso}.csv`">{{
          t('dominios.exportar')
        }}</a>
      </div>
      <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
      <table v-else data-testid="tabela-dominio">
        <caption>
          {{
            t('dominios.lista', { nome: d.rotulo.plural.toLowerCase() })
          }}
        </caption>
        <thead>
          <tr>
            <th
              v-for="c in colunas"
              :key="c.campo"
              scope="col"
              :aria-sort="
                filtro.ordem === c.campo ? (filtro.direcao === 'asc' ? 'ascending' : 'descending') : 'none'
              "
            >
              <button type="button" class="ordenar" @click="ordenar(c.campo)">
                {{ c.rotulo }}<span v-if="c.aConfirmar">({{ t('dominios.aConfirmar') }})</span>
              </button>
            </th>
            <th v-if="d.legenda" scope="col">{{ d.legenda }}</th>
            <th v-if="d.campoSituacao" scope="col">{{ t('dominios.situacao') }}</th>
            <th v-if="temAcoes" scope="col">
              {{ t('dominios.acoes') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in lista.data.value?.itens ?? []" :key="i.codigo" :data-testid="`item-${i.codigo}`">
            <td v-for="c in colunas" :key="c.campo">
              {{ c.campo === d.campoCodigo ? i.codigo : exibir(c, i.valores[c.campo]) }}
            </td>
            <td v-if="d.legenda">{{ i.legenda ?? '' }}</td>
            <td v-if="d.campoSituacao">{{ i.ativo ? t('dominios.ativo') : t('dominios.inativo') }}</td>
            <td v-if="temAcoes && i.aConfirmar" class="acoes" :data-testid="`a-confirmar-${i.codigo}`">
              {{ t('dominios.itemAConfirmar') }}
            </td>
            <td v-else-if="temAcoes" class="acoes">
              <SanteBotao
                v-if="(d.textosLongos?.length ?? 0) > 0"
                :rotulo="t('dominios.verTextos')"
                variante="texto"
                :data-testid="`textos-${i.codigo}`"
                @acionar="verTextos(i)"
              />
              <SanteBotao
                v-if="podeReativar && !i.ativo"
                :rotulo="t('dominios.reativar')"
                variante="secundario"
                :desabilitado="recusada('reativar')"
                :data-testid="`reativar-${i.codigo}`"
                @acionar="reativar(i)"
              />
              <SanteBotao
                v-if="props.selecionavel"
                :rotulo="t('consultas.grupo.selecionar')"
                variante="texto"
                :data-testid="`selecionar-${i.codigo}`"
                @acionar="emit('selecionar', i)"
              />
              <SanteBotao
                v-if="pode('editar') && i.ativo"
                :rotulo="t('dominios.alterar')"
                variante="texto"
                :desabilitado="recusada('editar')"
                :data-testid="`alterar-${i.codigo}`"
                @acionar="abrirAlterar(i.codigo)"
              />
              <SanteBotao
                v-if="pode('inativar') && i.ativo"
                :rotulo="t('dominios.inativar')"
                variante="secundario"
                :desabilitado="recusada('inativar')"
                :data-testid="`inativar-${i.codigo}`"
                @acionar="inativar(i)"
              />
              <SanteBotao
                v-if="pode('excluir')"
                :rotulo="t('dominios.excluir')"
                variante="secundario"
                :desabilitado="recusada('excluir')"
                :data-testid="`excluir-${i.codigo}`"
                @acionar="excluir(i)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="paginas" :aria-label="t('dominios.lista', { nome: d.rotulo.plural.toLowerCase() })">
        <button type="button" :disabled="filtro.pagina <= 1" @click="filtro.pagina--">
          {{ t('dominios.anterior') }}
        </button>
        <span>{{ t('dominios.pagina', { pagina: filtro.pagina, total: totalPaginas }) }}</span>
        <button type="button" :disabled="filtro.pagina >= totalPaginas" @click="filtro.pagina++">
          {{ t('dominios.proxima') }}
        </button>
      </nav>
      <div v-if="emUso" class="aviso-uso" role="alertdialog" aria-labelledby="em-uso-titulo">
        <h2 id="em-uso-titulo">{{ t('dominios.emUso') }}</h2>
        <p>{{ emUso.aviso }}</p>
        <SanteBotao
          :rotulo="t('dominios.confirmarEmUso')"
          variante="primario"
          data-testid="confirmar-em-uso"
          @acionar="inativarEmUso"
        />
        <SanteBotao :rotulo="t('dominios.cancelar')" variante="texto" @acionar="emUso = null" />
      </div>
      <SanteDialogoGravacao v-model:visivel="gravacaoVisivel" :pedido="pedido" @falha="falhaGravacao" />
      <SanteDialogo v-model:visivel="dependentesVisivel" :titulo="t('dominios.exclusaoRecusada')">
        <div v-if="dependentes" class="dependentes" data-testid="dominio-dependentes">
          <SanteAlerta :texto="t('dominios.temDependentes')" variante="aviso" anunciar />
          <table>
            <caption>
              {{
                t('dominios.listaDependentes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('dominios.dependenteOnde') }}</th>
                <th scope="col">{{ t('dominios.dependenteQuantos') }}</th>
                <th scope="col">{{ t('dominios.dependenteAmostra') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(x, n) in dependentes.lista" :key="n" :data-testid="`dependente-${n}`">
                <td>{{ x.rotulo }}</td>
                <td>{{ x.quantidade }}</td>
                <td>{{ x.amostra.join(', ') }}</td>
              </tr>
            </tbody>
          </table>
          <div class="botoes">
            <SanteBotao
              v-if="dependentes.podeInativar"
              :rotulo="t('dominios.inativarEmVez')"
              variante="primario"
              data-testid="inativar-em-vez"
              @acionar="inativarEmVezDeExcluir"
            />
            <SanteBotao
              :rotulo="t('dominios.fechar')"
              variante="texto"
              @acionar="dependentesVisivel = false"
            />
          </div>
        </div>
      </SanteDialogo>
      <SanteDialogo
        v-model:visivel="textosVisiveis"
        :titulo="t('dominios.textosDe', { codigo: textosAbertos?.codigo ?? '' })"
      >
        <p data-testid="aviso-textos">{{ avisoTextos }}</p>
        <template v-if="textosAbertos">
          <div v-for="c in d.textosLongos ?? []" :key="c.campo" class="campo">
            <label :for="`texto-${d.recurso}-${c.campo}`">{{ c.rotulo }}</label>
            <textarea
              :id="`texto-${d.recurso}-${c.campo}`"
              :value="textosAbertos.textos[c.campo] ?? t('dominios.textoVazio')"
              readonly
              rows="8"
              :data-testid="`texto-${c.campo}`"
            />
          </div>
        </template>
        <SanteBotao :rotulo="t('dominios.fechar')" variante="texto" @acionar="textosVisiveis = false" />
      </SanteDialogo>
      <SanteDialogo
        v-model:visivel="dialogo"
        :titulo="
          editando
            ? t('dominios.tituloAlterar', { nome: d.rotulo.singular.toLowerCase(), codigo: editando.codigo })
            : t('dominios.tituloIncluir', { nome: d.rotulo.singular.toLowerCase() })
        "
      >
        <form class="form" data-testid="form-dominio" @submit.prevent="salvar">
          <SanteAvisoColisao v-if="colisao" :problema="colisao" @rever="rever" @descartar="dialogo = false" />
          <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar />
          <MensagemErro v-if="erroForm" :erro="erroForm" />
          <p v-if="!editando && d.campos.some((c) => c.codigo === 'generator')">
            {{ t('dominios.codigoGerado') }}
          </p>
          <template v-for="c in camposDoForm" :key="c.campo">
            <div v-if="c.tipo === 'texto' && c.referencia" class="campo">
              <!-- M24: referência de código em texto (unidade, via): as opções do cadastro ligado. -->
              <SanteSelecao
                :id="`campo-${c.campo}`"
                v-model="textos[c.campo]!"
                :obrigatorio="c.obrigatorio"
                :rotulo="c.rotulo"
                :opcoes="opcoesDoForm[c.campo] ?? []"
                :data-testid="`campo-${c.campo}`"
              />
            </div>
            <SanteCampoTexto
              v-else-if="c.tipo === 'texto'"
              v-model="textos[c.campo]!"
              :rotulo="c.rotulo"
              :max-bytes="c.maxBytes ?? 1"
              :obrigatorio="c.obrigatorio"
              :data-testid="`campo-${c.campo}`"
            />
            <div v-else-if="!TIPOS_DIGITADOS.has(c.tipo)" class="campo">
              <SanteSelecao
                :id="`campo-${c.campo}`"
                :model-value="valores[c.campo] ?? null"
                :obrigatorio="c.obrigatorio"
                :rotulo="rotuloDoCampo(c)"
                :opcoes="opcoesDoForm[c.campo] ?? []"
                :data-testid="`campo-${c.campo}`"
                @update:model-value="(v) => (valores[c.campo] = v)"
              />
            </div>
            <div v-else class="campo">
              <label :for="`campo-${c.campo}`"
                >{{ c.rotulo }}<span v-if="c.aConfirmar">({{ t('dominios.aConfirmar') }})</span></label
              >
              <input
                v-if="c.tipo === 'inteiro'"
                :id="`campo-${c.campo}`"
                v-model.number="valores[c.campo]"
                type="number"
                :min="c.minimo"
                :max="c.maximo"
                :required="c.obrigatorio"
                :data-testid="`campo-${c.campo}`"
              />
              <input
                v-else-if="c.tipo === 'decimal'"
                :id="`campo-${c.campo}`"
                v-model.number="valores[c.campo]"
                type="number"
                :step="c.casas ? 1 / 10 ** c.casas : 'any'"
                :required="c.obrigatorio"
                :data-testid="`campo-${c.campo}`"
              />
              <input
                v-else-if="c.tipo === 'data'"
                :id="`campo-${c.campo}`"
                v-model="valores[c.campo]"
                type="date"
                :required="c.obrigatorio"
                :data-testid="`campo-${c.campo}`"
              />
              <input
                v-else
                :id="`campo-${c.campo}`"
                v-model="valores[c.campo]"
                type="text"
                inputmode="numeric"
                pattern="[0-2][0-9]:[0-5][0-9]"
                :placeholder="t('dominios.formatoHora')"
                :required="c.obrigatorio"
                :data-testid="`campo-${c.campo}`"
              />
            </div>
          </template>
          <template v-if="!editando || editando.ativo">
            <div v-for="x in textosEditaveis" :key="x.campo" class="campo">
              <label :for="`texto-longo-${d.recurso}-${x.campo}`"
                >{{ x.rotulo }}<span v-if="!editando && x.obrigatorio" aria-hidden="true"> *</span></label
              >
              <!-- W1-04: o texto longo obrigatório (texto da senha da recepção) barra a inclusão vazia. -->
              <textarea
                :id="`texto-longo-${d.recurso}-${x.campo}`"
                v-model="textosLongosForm[x.campo]"
                rows="10"
                :required="!editando && x.obrigatorio"
                :aria-required="!editando && x.obrigatorio"
                :data-testid="`texto-longo-${x.campo}`"
              />
            </div>
          </template>
          <div class="botoes">
            <SanteBotao
              :rotulo="t('dominios.salvar')"
              variante="primario"
              tipo="submit"
              :desabilitado="salvando"
              data-testid="botao-salvar"
            />
            <SanteBotao :rotulo="t('dominios.cancelar')" variante="texto" @acionar="dialogo = false" />
          </div>
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.barra,
.paginas,
.botoes,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.ordenar {
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.aviso-uso {
  border: 1px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-2);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
