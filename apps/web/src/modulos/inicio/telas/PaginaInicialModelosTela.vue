<script setup lang="ts">
// Página inicial por perfil (01-ADM L114; F8): `/admin/pagina-inicial`. Os modelos à esquerda; o modelo aberto à
// direita com os blocos em ordem (incluir, subir, descer, tirar, largura) e os perfis com a prioridade. A página
// inteira vai num "Salvar" só; a conferência (lista do catálogo, indicador escolhido, atalho interno ou https, texto,
// prioridade) é a mesma regra do domínio, feita na hora. Publicar exige bloco e perfil; inativar tira de uso sem apagar.
import {
  conferirBlocosInicio,
  conferirPerfisInicio,
  conferirPublicacaoInicio,
  type ErroRegraInicio,
} from '@sgh/dominio-relatorio';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type BlocoModelo,
  criarModeloPagina,
  lerCatalogoPagina,
  lerModeloPagina,
  lerModelosPagina,
  mudarSituacaoModelo,
  salvarModeloPagina,
  TIPOS_BLOCO,
  type TipoBloco,
} from '../api-pagina-inicial.js';
import { mensagensPaginaInicial } from '../i18n-pagina-inicial.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensPaginaInicial });
const fila = useQueryClient();
const podeCriar = computed(() => pode('relatorio.paginaInicial.editar'));

const catalogo = useQuery({ queryKey: ['pagina-inicial', 'catalogo'], queryFn: lerCatalogoPagina });
const modelos = useQuery({ queryKey: ['pagina-inicial', 'modelos'], queryFn: lerModelosPagina });
const aberto = ref(0);
const detalhe = useQuery({
  queryKey: ['pagina-inicial', 'modelo', aberto],
  queryFn: () => lerModeloPagina(aberto.value),
  enabled: computed(() => aberto.value > 0),
});
// O modelo da rede vale para todos os estabelecimentos: sem o escopo de rede, só consulta (o servidor confere também).
const podeRede = computed(() => catalogo.data.value?.podeRede ?? false);
const podeEditar = computed(() => podeCriar.value && (detalhe.data.value?.podeAlterar ?? true));
const soConsultaRede = computed(() => podeCriar.value && detalhe.data.value?.podeAlterar === false);

const opcoesLista = computed(() =>
  (catalogo.data.value?.tipos ?? [])
    .filter((x) => x.componente === 'lista_trabalho')
    .map((x) => ({ valor: x.codigo, rotulo: x.descricao })),
);
const opcoesIndicador = computed(() =>
  (catalogo.data.value?.indicadores ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
);
const opcoesTipo = computed(() => TIPOS_BLOCO.map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })));
const opcoesLargura = computed(() => [1, 2, 3].map((v) => ({ valor: v, rotulo: t(`larguras.${v}`) })));

// O rascunho da página na tela (vai inteiro no salvar).
const nome = ref('');
const blocos = ref<BlocoModelo[]>([]);
const perfis = ref<{ perfilId: number; nome: string; prioridade: number }[]>([]);
watch(
  () => detalhe.data.value,
  (d) => {
    if (!d) return;
    nome.value = d.nome;
    blocos.value = d.blocos.map((b) => ({ ...b }));
    perfis.value = d.perfis.map((p) => ({ ...p }));
  },
  { immediate: true },
);

const novoTipo = ref<TipoBloco | null>('lista_trabalho');
function incluir(): void {
  if (!novoTipo.value) return;
  blocos.value.push({
    tipo: novoTipo.value,
    catalogo: null,
    indicadorId: null,
    titulo: null,
    endereco: novoTipo.value === 'link' ? '/' : null,
    texto: null,
    largura: novoTipo.value === 'texto' ? 3 : 1,
  });
}
function mover(i: number, d: -1 | 1): void {
  const j = i + d;
  if (j < 0 || j >= blocos.value.length) return;
  const b = blocos.value;
  [b[i], b[j]] = [b[j]!, b[i]!];
}
const tirar = (i: number) => blocos.value.splice(i, 1);

const perfilNovo = ref<number | null>(null);
// Os perfis pelo escopo do modelo: o da rede aceita os de qualquer estabelecimento; o daqui, só os daqui e os da rede.
const perfisDoEscopo = computed(() => {
  const c = catalogo.data.value;
  if (!c) return [];
  return detalhe.data.value?.rede
    ? c.perfis
    : c.perfis.filter((p) => p.estabelecimentoId === null || p.estabelecimentoId === c.estabelecimento);
});
const rotuloPerfil = (p: {
  nome: string;
  estabelecimento: string | null;
  estabelecimentoId: number | null;
}) =>
  p.estabelecimentoId !== null && p.estabelecimentoId !== catalogo.data.value?.estabelecimento
    ? t('perfilDe', { nome: p.nome, estabelecimento: p.estabelecimento ?? '' })
    : p.nome;
const opcoesPerfil = computed(() =>
  perfisDoEscopo.value
    .filter((p) => !perfis.value.some((x) => x.perfilId === p.id))
    .map((p) => ({ valor: p.id, rotulo: rotuloPerfil(p) })),
);
function ligar(): void {
  const p = perfisDoEscopo.value.find((x) => x.id === perfilNovo.value);
  if (!p) return;
  perfis.value.push({ perfilId: p.id, nome: rotuloPerfil(p), prioridade: perfis.value.length + 1 });
  perfilNovo.value = null;
}
const desligar = (i: number) => perfis.value.splice(i, 1);

// A conferência na hora: a mesma regra do servidor.
const TEXTO_ERRO: Record<string, string> = {
  'lista-desconhecida': 'erros.lista',
  'lista-repetida': 'erros.listaRepetida',
  'indicador-ausente': 'erros.indicador',
  'indicador-repetido': 'erros.indicador',
  'endereco-invalido': 'erros.endereco',
  'titulo-ausente': 'erros.tituloAtalho',
  'texto-ausente': 'erros.texto',
  'prioridade-invalida': 'erros.prioridade',
};
const errosBlocos = computed<ErroRegraInicio[]>(() =>
  conferirBlocosInicio(blocos.value, new Set(opcoesLista.value.map((o) => o.valor))),
);
const errosPerfis = computed(() => conferirPerfisInicio(perfis.value));
const erroDo = (campo: string) => {
  const e = [...errosBlocos.value, ...errosPerfis.value].find((x) => x.campo === campo);
  return e ? (TEXTO_ERRO[e.codigo] ? t(TEXTO_ERRO[e.codigo]!) : e.mensagem) : '';
};
const nomeValido = computed(() => nome.value.trim().length >= 3 && nome.value.trim().length <= 150);
const publicado = computed(() => detalhe.data.value?.situacao === 'publicado');
const faltaParaPublicar = computed(
  () => conferirPublicacaoInicio(blocos.value.length, perfis.value.length).length > 0,
);
const podeSalvar = computed(
  () =>
    podeEditar.value &&
    nomeValido.value &&
    errosBlocos.value.length === 0 &&
    errosPerfis.value.length === 0 &&
    !(publicado.value && faltaParaPublicar.value),
);

const aviso = ref('');
const erro = ref<unknown>(null);
const ok = async (texto: string) => {
  aviso.value = texto;
  erro.value = null;
  await fila.invalidateQueries({ queryKey: ['pagina-inicial'] });
};

const nomeNovo = ref('');
const daRede = ref(false);
const criacao = useMutation({
  mutationFn: () => criarModeloPagina(nomeNovo.value.trim(), daRede.value && podeRede.value),
  onSuccess: async (r) => {
    nomeNovo.value = '';
    aberto.value = r.id;
    await ok(t('criado'));
  },
  onError: (e) => (erro.value = e),
});

const gravacao = useMutation({
  mutationFn: () =>
    salvarModeloPagina(aberto.value, {
      versao: detalhe.data.value!.versao,
      nome: nome.value.trim(),
      descricao: detalhe.data.value!.descricao,
      blocos: blocos.value.map((b) => ({
        tipo: b.tipo,
        catalogo: b.catalogo,
        indicadorId: b.indicadorId,
        titulo: b.titulo,
        endereco: b.endereco,
        texto: b.texto,
        largura: b.largura,
      })),
      perfis: perfis.value.map((p) => ({ perfilId: p.perfilId, prioridade: p.prioridade })),
    }),
  onSuccess: () => ok(t('salvo')),
  onError: (e) => (erro.value = e),
});

const situacao = useMutation({
  mutationFn: (para: string) => mudarSituacaoModelo(aberto.value, detalhe.data.value!.versao, para),
  onSuccess: (_r, para) => ok(t('situacaoMudou', { situacao: t(`situacoes.${para}`).toLowerCase() })),
  onError: (e) => (erro.value = e),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pagina-inicial-titulo" data-testid="tela-pagina-inicial">
    <h1 id="pagina-inicial-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <p v-if="!podeCriar" role="note" data-testid="pi-so-consulta">{{ t('soConsulta') }}</p>
    <p v-if="aviso" role="status" data-testid="pi-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <div class="pi-grade">
      <nav class="painel" :aria-label="t('modelos')" data-testid="pi-modelos">
        <h2>{{ t('modelos') }}</h2>
        <p v-if="modelos.isSuccess.value && (modelos.data.value ?? []).length === 0">{{ t('semModelos') }}</p>
        <ul class="pi-lista">
          <li v-for="m in modelos.data.value ?? []" :key="m.id">
            <button
              type="button"
              class="pi-modelo"
              :aria-pressed="aberto === m.id"
              :aria-label="t('abrir', { nome: m.nome })"
              :data-testid="`pi-modelo-${m.id}`"
              @click="aberto = m.id"
            >
              <strong>{{ m.nome }}</strong>
              <span class="secundario">
                {{ t(`situacoes.${m.situacao}`) }} · {{ t('resumo', { blocos: m.blocos, perfis: m.perfis }) }}
                <template v-if="m.rede"> · {{ t('daRede') }}</template>
              </span>
            </button>
          </li>
        </ul>
        <form v-if="podeCriar" data-testid="pi-novo" @submit.prevent="criacao.mutate()">
          <h3>{{ t('novo') }}</h3>
          <label>
            {{ t('nome') }}
            <input v-model="nomeNovo" maxlength="150" required data-testid="pi-novo-nome" />
          </label>
          <label v-if="podeRede" class="pi-marca">
            <input v-model="daRede" type="checkbox" data-testid="pi-novo-rede" />
            {{ t('rede') }}
          </label>
          <button
            type="submit"
            :disabled="nomeNovo.trim().length < 3 || criacao.isPending.value"
            data-testid="pi-criar"
          >
            {{ t('criar') }}
          </button>
        </form>
      </nav>

      <form
        v-if="detalhe.data.value"
        class="painel pi-editor"
        data-testid="pi-editor"
        @submit.prevent="gravacao.mutate()"
      >
        <label>
          {{ t('nome') }}
          <input v-model="nome" maxlength="150" required data-testid="pi-nome" :disabled="!podeEditar" />
        </label>
        <p v-if="!nomeValido" role="alert">{{ t('erros.nome') }}</p>
        <p class="secundario" data-testid="pi-situacao">
          {{ t(`situacoes.${detalhe.data.value.situacao}`) }}
        </p>
        <p v-if="soConsultaRede" role="note" data-testid="pi-so-consulta-rede">{{ t('soConsultaRede') }}</p>

        <h2>{{ t('blocos') }}</h2>
        <p v-if="blocos.length === 0">{{ t('semBlocos') }}</p>
        <ol class="pi-blocos">
          <li v-for="(b, i) in blocos" :key="i" class="pi-bloco" :data-testid="`pi-bloco-${i}`">
            <strong>{{ t('ordem', { n: i + 1, tipo: t(`tipos.${b.tipo}`) }) }}</strong>
            <SanteSelecao
              v-if="b.tipo === 'lista_trabalho'"
              v-model="b.catalogo"
              :rotulo="t('lista')"
              :opcoes="opcoesLista"
              obrigatorio
              :data-testid="`pi-bloco-${i}-lista`"
            />
            <SanteSelecao
              v-if="b.tipo === 'indicador'"
              v-model="b.indicadorId"
              :rotulo="t('indicador')"
              :opcoes="opcoesIndicador"
              obrigatorio
              :data-testid="`pi-bloco-${i}-indicador`"
            />
            <label v-if="b.tipo !== 'lista_trabalho'">
              {{ t('tituloBloco') }}
              <input v-model="b.titulo" maxlength="150" :data-testid="`pi-bloco-${i}-titulo`" />
            </label>
            <label v-if="b.tipo === 'link'">
              {{ t('endereco') }}
              <input v-model="b.endereco" maxlength="1000" :data-testid="`pi-bloco-${i}-endereco`" />
            </label>
            <label v-if="b.tipo === 'texto'">
              {{ t('texto') }}
              <textarea v-model="b.texto" maxlength="2000" rows="3" :data-testid="`pi-bloco-${i}-texto`" />
            </label>
            <SanteSelecao
              v-model="b.largura"
              :rotulo="t('largura')"
              :opcoes="opcoesLargura"
              :data-testid="`pi-bloco-${i}-largura`"
            />
            <p v-if="erroDo(`blocos[${i}]`)" role="alert" :data-testid="`pi-bloco-${i}-erro`">
              {{ erroDo(`blocos[${i}]`) }}
            </p>
            <div v-if="podeEditar" class="pi-acoes">
              <button
                type="button"
                :disabled="i === 0"
                :aria-label="t('subir', { n: i + 1 })"
                @click="mover(i, -1)"
              >
                {{ t('subirCurto') }}
              </button>
              <button
                type="button"
                :disabled="i === blocos.length - 1"
                :aria-label="t('descer', { n: i + 1 })"
                @click="mover(i, 1)"
              >
                {{ t('descerCurto') }}
              </button>
              <button
                type="button"
                :aria-label="t('tirar', { n: i + 1 })"
                :data-testid="`pi-bloco-${i}-tirar`"
                @click="tirar(i)"
              >
                {{ t('tirarCurto') }}
              </button>
            </div>
          </li>
        </ol>
        <div v-if="podeEditar" class="pi-incluir">
          <SanteSelecao
            v-model="novoTipo"
            :rotulo="t('novoBloco')"
            :opcoes="opcoesTipo"
            data-testid="pi-novo-tipo"
          />
          <button type="button" :disabled="!novoTipo" data-testid="pi-incluir" @click="incluir">
            {{ t('incluir') }}
          </button>
        </div>

        <h2>{{ t('perfis') }}</h2>
        <p v-if="perfis.length === 0">{{ t('semPerfis') }}</p>
        <p
          v-if="(detalhe.data.value?.perfisOutros ?? 0) > 0"
          class="secundario"
          data-testid="pi-perfis-outros"
        >
          {{ t('perfisOutros', { n: detalhe.data.value!.perfisOutros }) }}
        </p>
        <ul class="pi-lista">
          <li
            v-for="(p, i) in perfis"
            :key="p.perfilId"
            class="pi-perfil"
            :data-testid="`pi-perfil-${p.perfilId}`"
          >
            <label>
              {{ t('prioridade', { nome: p.nome }) }}
              <input
                v-model.number="p.prioridade"
                type="number"
                min="1"
                max="99"
                :data-testid="`pi-perfil-${p.perfilId}-prioridade`"
              />
            </label>
            <button
              v-if="podeEditar"
              type="button"
              :aria-label="t('desligar', { nome: p.nome })"
              @click="desligar(i)"
            >
              {{ t('desligarCurto') }}
            </button>
            <p v-if="erroDo(`perfis[${i}]`)" role="alert">{{ erroDo(`perfis[${i}]`) }}</p>
          </li>
        </ul>
        <div v-if="podeEditar" class="pi-incluir">
          <SanteSelecao
            v-model="perfilNovo"
            :rotulo="t('perfil')"
            :opcoes="opcoesPerfil"
            data-testid="pi-perfil"
          />
          <button type="button" :disabled="!perfilNovo" data-testid="pi-ligar" @click="ligar">
            {{ t('ligar') }}
          </button>
        </div>

        <p v-if="faltaParaPublicar" class="secundario" data-testid="pi-falta-publicar">
          {{ t('erros.publicar') }}
        </p>
        <div v-if="podeEditar" class="pi-acoes">
          <button type="submit" :disabled="!podeSalvar || gravacao.isPending.value" data-testid="pi-salvar">
            {{ t('salvar') }}
          </button>
          <button
            v-if="detalhe.data.value.situacao !== 'publicado'"
            type="button"
            :disabled="faltaParaPublicar || situacao.isPending.value"
            data-testid="pi-publicar"
            @click="situacao.mutate('publicado')"
          >
            {{ t('publicar') }}
          </button>
          <button
            v-if="detalhe.data.value.situacao === 'publicado'"
            type="button"
            data-testid="pi-rascunho"
            @click="situacao.mutate('rascunho')"
          >
            {{ t('voltarRascunho') }}
          </button>
          <button
            v-if="detalhe.data.value.situacao !== 'inativo'"
            type="button"
            data-testid="pi-inativar"
            @click="situacao.mutate('inativo')"
          >
            {{ t('inativar') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.pi-grade {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) 3fr;
  gap: var(--sgh-espaco-3);
  align-items: start;
}
@media (max-width: 48rem) {
  .pi-grade {
    grid-template-columns: 1fr;
  }
}
.pi-lista,
.pi-blocos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.pi-modelo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  text-align: left;
}
.pi-bloco,
.pi-perfil {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 8px;
  padding: var(--sgh-espaco-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.pi-acoes,
.pi-incluir {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.pi-acoes button {
  min-height: var(--sgh-alvo-minimo);
  min-width: var(--sgh-alvo-minimo);
}
.pi-marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
</style>
