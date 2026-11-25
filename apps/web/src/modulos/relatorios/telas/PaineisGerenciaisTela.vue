<script setup lang="ts">
// Painéis gerenciais montados pelo hospital (01-REL L112; F3): `/relatorios/paineis-gerenciais`. À esquerda, os
// painéis que a pessoa pode abrir; um clique abre o painel com cada indicador apurado (último valor, numerador e
// denominador, meta, situação frente à meta, variação e a série das competências do período). Quem monta vê ainda o
// editor do painel aberto: dados, quadros em ordem (incluir, subir, descer, tirar, largura, forma) e quem pode abrir
// (perfis, com exportação e vigência). A conferência é a mesma regra do domínio, feita na hora; pôr em uso exige quadro
// e permissão; tirar de uso não apaga nada.
import {
  conferirAtivacaoPainel,
  conferirItensPainel,
  conferirPermissoesPainel,
  FORMAS_EXIBICAO_PAINEL,
  PERIODOS_PAINEL,
  PUBLICOS_PAINEL,
  TIPOS_ITEM_PAINEL,
  type TipoItemPainel,
} from '@sgh/dominio-relatorio';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  abrirPainel,
  criarPainel,
  type ItemPainel,
  lerCatalogoPainel,
  lerPainel,
  lerPaineis,
  mudarUsoPainel,
  type PermissaoPainel,
  salvarPainel,
} from '../api-paineis-gerenciais.js';
import { mensagensPaineisGerenciais } from '../i18n-paineis-gerenciais.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensPaineisGerenciais });
const fila = useQueryClient();
const podeMontar = computed(() => pode('relatorio.painelGerencial.editar'));

const paineis = useQuery({ queryKey: ['paineis-gerenciais', 'lista'], queryFn: lerPaineis });
const aberto = ref(0);
const visao = useQuery({
  queryKey: ['paineis-gerenciais', 'abrir', aberto],
  queryFn: () => abrirPainel(aberto.value),
  enabled: computed(() => aberto.value > 0),
});

// ---- Leitura do painel ----
const mesAno = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const numero = (v: number | null, casas: number) =>
  v === null
    ? '—'
    : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const largura = (v: number | null, serie: readonly { valor: number | null }[]) => {
  const max = Math.max(...serie.map((s) => Math.abs(s.valor ?? 0)), 0);
  return max > 0 && v !== null ? `${Math.round((Math.abs(v) / max) * 100)}%` : '0%';
};

// ---- Montagem ----
const editando = ref(false);
const catalogo = useQuery({
  queryKey: ['paineis-gerenciais', 'catalogo'],
  queryFn: lerCatalogoPainel,
  enabled: podeMontar,
});
const detalhe = useQuery({
  queryKey: ['paineis-gerenciais', 'painel', aberto],
  queryFn: () => lerPainel(aberto.value),
  enabled: computed(() => podeMontar.value && editando.value && aberto.value > 0),
});

const opcoesIndicador = computed(() =>
  (catalogo.data.value?.indicadores ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
);
const opcoesTipo = computed(() => TIPOS_ITEM_PAINEL.map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })));
const opcoesForma = (tipo: TipoItemPainel) =>
  FORMAS_EXIBICAO_PAINEL.filter((f) => (tipo === 'texto' ? f === 'texto' : f !== 'texto')).map((v) => ({
    valor: v,
    rotulo: t(`formas.${v}`),
  }));
const opcoesLargura = computed(() => [1, 2, 3].map((v) => ({ valor: v, rotulo: t(`larguras.${v}`) })));
const opcoesPublico = computed(() => PUBLICOS_PAINEL.map((v) => ({ valor: v, rotulo: t(`publicos.${v}`) })));
const opcoesPeriodo = computed(() => PERIODOS_PAINEL.map((v) => ({ valor: v, rotulo: t(`periodos.${v}`) })));

const nome = ref('');
const publico = ref<string | null>('gestor');
const periodo = ref<string | null>('ultimos_3_meses');
const itens = ref<ItemPainel[]>([]);
const permissoes = ref<PermissaoPainel[]>([]);
watch(
  () => detalhe.data.value,
  (d) => {
    if (!d) return;
    nome.value = d.nome;
    publico.value = d.publico;
    periodo.value = d.periodoPadrao;
    itens.value = d.itens.map((i) => ({ ...i }));
    permissoes.value = d.permissoes.map((p) => ({ ...p }));
  },
  { immediate: true },
);

const novoTipo = ref<TipoItemPainel | null>('indicador');
function incluir(): void {
  if (!novoTipo.value) return;
  const texto = novoTipo.value === 'texto';
  itens.value.push({
    tipo: novoTipo.value,
    indicadorId: null,
    titulo: null,
    texto: texto ? '' : null,
    forma: texto ? 'texto' : 'numero',
    largura: texto ? 3 : 1,
    casasDecimais: null,
    exibirMeta: !texto,
  });
}
function mover(i: number, d: -1 | 1): void {
  const j = i + d;
  if (j < 0 || j >= itens.value.length) return;
  const v = itens.value;
  [v[i], v[j]] = [v[j]!, v[i]!];
}
const tirar = (i: number) => itens.value.splice(i, 1);

const perfilNovo = ref<number | null>(null);
const opcoesPerfil = computed(() =>
  (catalogo.data.value?.perfis ?? [])
    .filter((p) => !permissoes.value.some((x) => x.perfilId === p.id))
    .map((p) => ({ valor: p.id, rotulo: p.nome })),
);
function liberar(): void {
  const p = catalogo.data.value?.perfis.find((x) => x.id === perfilNovo.value);
  if (!p) return;
  permissoes.value.push({
    perfilId: p.id,
    usuarioId: null,
    perfilNome: p.nome,
    podeExportar: false,
    vigenciaInicio: null,
    vigenciaFim: null,
  });
  perfilNovo.value = null;
}
const desligar = (i: number) => permissoes.value.splice(i, 1);
const nomePermissao = (p: PermissaoPainel) => p.perfilNome ?? `#${p.usuarioId}`;

// A conferência na hora: a mesma regra do servidor.
const errosItens = computed(() => conferirItensPainel(itens.value));
const errosPermissoes = computed(() =>
  conferirPermissoesPainel(
    permissoes.value.map((p) => ({
      ...p,
      vigenciaInicio: p.vigenciaInicio || null,
      vigenciaFim: p.vigenciaFim || null,
    })),
  ),
);
const erroDo = (campo: string) =>
  [...errosItens.value, ...errosPermissoes.value].find((x) => x.campo === campo)?.mensagem ?? '';
const nomeValido = computed(() => nome.value.trim().length >= 3 && nome.value.trim().length <= 150);
const emUso = computed(() => detalhe.data.value?.ativo === true);
const faltaParaUso = computed(
  () => conferirAtivacaoPainel(itens.value.length, permissoes.value.length).length > 0,
);
const podeSalvar = computed(
  () =>
    nomeValido.value &&
    !!publico.value &&
    !!periodo.value &&
    errosItens.value.length === 0 &&
    errosPermissoes.value.length === 0 &&
    !(emUso.value && faltaParaUso.value),
);

const aviso = ref('');
const erro = ref<unknown>(null);
const ok = async (texto: string) => {
  aviso.value = texto;
  erro.value = null;
  await fila.invalidateQueries({ queryKey: ['paineis-gerenciais'] });
};

const novo = ref({
  codigo: '',
  nome: '',
  publico: 'gestor' as string | null,
  periodo: 'ultimos_3_meses' as string | null,
  rede: false,
});
const codigoValido = computed(() => /^[A-Za-z0-9_.-]{2,30}$/.test(novo.value.codigo.trim()));
const criacao = useMutation({
  mutationFn: () =>
    criarPainel({
      codigo: novo.value.codigo.trim(),
      nome: novo.value.nome.trim(),
      descricao: null,
      publico: novo.value.publico ?? 'gestor',
      periodoPadrao: novo.value.periodo ?? 'ultimos_3_meses',
      rede: novo.value.rede,
    }),
  onSuccess: async (r) => {
    novo.value = { codigo: '', nome: '', publico: 'gestor', periodo: 'ultimos_3_meses', rede: false };
    aberto.value = r.id;
    editando.value = true;
    await ok(t('criado'));
  },
  onError: (e) => (erro.value = e),
});

const gravacao = useMutation({
  mutationFn: () =>
    salvarPainel(aberto.value, {
      versao: detalhe.data.value!.versao,
      nome: nome.value.trim(),
      descricao: detalhe.data.value!.descricao,
      publico: publico.value!,
      periodoPadrao: periodo.value!,
      itens: itens.value.map((i) => ({
        tipo: i.tipo,
        indicadorId: i.tipo === 'indicador' ? i.indicadorId : null,
        titulo: i.titulo || null,
        texto: i.tipo === 'texto' ? i.texto : null,
        forma: i.forma,
        largura: i.largura,
        casasDecimais:
          i.casasDecimais === null || (i.casasDecimais as unknown) === '' ? null : Number(i.casasDecimais),
        exibirMeta: i.exibirMeta,
      })),
      permissoes: permissoes.value.map((p) => ({
        perfilId: p.perfilId,
        usuarioId: p.usuarioId,
        podeExportar: p.podeExportar,
        vigenciaInicio: p.vigenciaInicio || null,
        vigenciaFim: p.vigenciaFim || null,
      })),
    }),
  onSuccess: () => ok(t('salvo')),
  onError: (e) => (erro.value = e),
});

const uso = useMutation({
  mutationFn: (ativo: boolean) => mudarUsoPainel(aberto.value, detalhe.data.value!.versao, ativo),
  onSuccess: (_r, ativo) =>
    ok(t('usoMudou', { situacao: (ativo ? t('emUso') : t('emMontagem')).toLowerCase() })),
  onError: (e) => (erro.value = e),
});
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="paineis-gerenciais-titulo"
    data-testid="tela-paineis-gerenciais"
  >
    <h1 id="paineis-gerenciais-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <p v-if="aviso" role="status" data-testid="pg-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <div class="pg-grade">
      <nav class="painel" :aria-label="t('paineis')" data-testid="pg-paineis">
        <h2>{{ t('paineis') }}</h2>
        <p v-if="paineis.isSuccess.value && (paineis.data.value ?? []).length === 0">{{ t('semPaineis') }}</p>
        <ul class="pg-lista">
          <li v-for="p in paineis.data.value ?? []" :key="p.id">
            <button
              type="button"
              class="pg-painel"
              :aria-pressed="aberto === p.id"
              :aria-label="t('abrir', { nome: p.nome })"
              :data-testid="`pg-painel-${p.id}`"
              @click="aberto = p.id"
            >
              <strong>{{ p.nome }}</strong>
              <span class="secundario">
                {{ p.ativo ? t('emUso') : t('emMontagem') }} · {{ t(`publicos.${p.publico}`) }}
                <template v-if="podeMontar">
                  · {{ t('resumo', { itens: p.itens, permissoes: p.permissoes }) }}</template
                >
                <template v-if="p.rede"> · {{ t('daRede') }}</template>
              </span>
            </button>
          </li>
        </ul>
        <form v-if="podeMontar" class="pg-form" data-testid="pg-novo" @submit.prevent="criacao.mutate()">
          <h3>{{ t('novo') }}</h3>
          <label>
            {{ t('codigo') }}
            <input v-model="novo.codigo" maxlength="30" required data-testid="pg-novo-codigo" />
          </label>
          <p v-if="novo.codigo && !codigoValido" role="alert">{{ t('erros.codigo') }}</p>
          <label>
            {{ t('nome') }}
            <input v-model="novo.nome" maxlength="150" required data-testid="pg-novo-nome" />
          </label>
          <SanteSelecao
            v-model="novo.publico"
            :rotulo="t('publico')"
            :opcoes="opcoesPublico"
            obrigatorio
            data-testid="pg-novo-publico"
          />
          <SanteSelecao
            v-model="novo.periodo"
            :rotulo="t('periodoPadrao')"
            :opcoes="opcoesPeriodo"
            obrigatorio
            data-testid="pg-novo-periodo"
          />
          <label class="pg-marca">
            <input v-model="novo.rede" type="checkbox" data-testid="pg-novo-rede" />
            {{ t('rede') }}
          </label>
          <button
            type="submit"
            :disabled="!codigoValido || novo.nome.trim().length < 3 || criacao.isPending.value"
            data-testid="pg-criar"
          >
            {{ t('criar') }}
          </button>
        </form>
      </nav>

      <div class="pg-direita">
        <article v-if="visao.data.value" class="painel" data-testid="pg-visao">
          <h2>{{ visao.data.value.painel.nome }}</h2>
          <p v-if="visao.data.value.painel.descricao">{{ visao.data.value.painel.descricao }}</p>
          <p class="secundario" data-testid="pg-periodo">
            {{
              t('periodo', {
                de: mesAno(visao.data.value.periodo.de),
                ate: mesAno(visao.data.value.periodo.ate),
              })
            }}
          </p>
          <div class="pg-quadros">
            <section
              v-for="(q, i) in visao.data.value.quadros"
              :key="i"
              class="pg-quadro"
              :class="`pg-larg-${q.largura}`"
              :data-testid="`pg-quadro-${i}`"
            >
              <template v-if="q.tipo === 'texto'">
                <h3 v-if="q.titulo">{{ q.titulo }}</h3>
                <p class="pg-texto">{{ q.texto }}</p>
              </template>
              <template v-else-if="q.indicador">
                <h3>{{ q.titulo || q.indicador.nome }}</h3>
                <p v-if="!q.indicador.ultima" class="secundario">{{ t('semApuracao') }}</p>
                <template v-else>
                  <p class="pg-valor" :data-testid="`pg-quadro-${i}-valor`">
                    {{ numero(q.indicador.ultima.valor, q.indicador.casasDecimais) }}
                    <small>{{ q.indicador.simbolo ?? '' }}</small>
                  </p>
                  <p class="secundario" :data-testid="`pg-quadro-${i}-fracao`">
                    {{ mesAno(q.indicador.ultima.competencia) }} ·
                    {{
                      t('fracao', {
                        numerador: numero(q.indicador.ultima.numerador, 0),
                        denominador: numero(q.indicador.ultima.denominador, 0),
                      })
                    }}
                  </p>
                  <p v-if="q.exibirMeta" :data-testid="`pg-quadro-${i}-meta`">
                    <span
                      class="pg-selo"
                      :class="{
                        'pg-na-meta': q.indicador.ultima.situacaoMeta === 'na_meta',
                        'pg-fora-meta': q.indicador.ultima.situacaoMeta === 'fora_da_meta',
                      }"
                      >{{ t(`situacoesMeta.${q.indicador.ultima.situacaoMeta}`) }}</span
                    >
                    <template v-if="q.indicador.ultima.meta !== null">
                      ·
                      {{
                        t('meta', { meta: numero(q.indicador.ultima.meta, q.indicador.casasDecimais) })
                      }}</template
                    >
                  </p>
                  <p
                    v-if="q.indicador.variacao !== null"
                    class="secundario"
                    :data-testid="`pg-quadro-${i}-variacao`"
                  >
                    {{ t('variacao', { v: numero(q.indicador.variacao, 1) }) }}
                  </p>
                  <table v-if="q.forma !== 'numero'" class="pg-serie" :aria-label="t('serie')">
                    <thead>
                      <tr>
                        <th scope="col">{{ t('competencia') }}</th>
                        <th scope="col">{{ t('valor') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="s in q.indicador.serie" :key="s.competencia">
                        <td>{{ mesAno(s.competencia) }}</td>
                        <td>
                          <span
                            class="pg-barra"
                            :style="{ width: largura(s.valor, q.indicador.serie) }"
                            aria-hidden="true"
                          />
                          {{ numero(s.valor, q.indicador.casasDecimais) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </template>
              </template>
            </section>
          </div>
          <button v-if="podeMontar" type="button" data-testid="pg-montar" @click="editando = !editando">
            {{ editando ? t('fecharEditor') : t('montar') }}
          </button>
        </article>

        <form
          v-if="podeMontar && editando && detalhe.data.value"
          class="painel pg-form"
          data-testid="pg-editor"
          @submit.prevent="gravacao.mutate()"
        >
          <label>
            {{ t('nome') }}
            <input v-model="nome" maxlength="150" required data-testid="pg-nome" />
          </label>
          <p v-if="!nomeValido" role="alert">{{ t('erros.nome') }}</p>
          <SanteSelecao
            v-model="publico"
            :rotulo="t('publico')"
            :opcoes="opcoesPublico"
            obrigatorio
            data-testid="pg-publico"
          />
          <SanteSelecao
            v-model="periodo"
            :rotulo="t('periodoPadrao')"
            :opcoes="opcoesPeriodo"
            obrigatorio
            data-testid="pg-periodo-padrao"
          />
          <p class="secundario" data-testid="pg-situacao">{{ emUso ? t('emUso') : t('emMontagem') }}</p>

          <h2>{{ t('quadros') }}</h2>
          <p v-if="itens.length === 0">{{ t('semQuadros') }}</p>
          <ol class="pg-lista">
            <li v-for="(q, i) in itens" :key="i" class="pg-item" :data-testid="`pg-item-${i}`">
              <strong>{{ t('ordem', { n: i + 1, tipo: t(`tipos.${q.tipo}`) }) }}</strong>
              <SanteSelecao
                v-if="q.tipo === 'indicador'"
                v-model="q.indicadorId"
                :rotulo="t('indicador')"
                :opcoes="opcoesIndicador"
                obrigatorio
                :data-testid="`pg-item-${i}-indicador`"
              />
              <label>
                {{ t('tituloQuadro') }}
                <input v-model="q.titulo" maxlength="150" :data-testid="`pg-item-${i}-titulo`" />
              </label>
              <label v-if="q.tipo === 'texto'">
                {{ t('texto') }}
                <textarea v-model="q.texto" maxlength="4000" rows="3" :data-testid="`pg-item-${i}-texto`" />
              </label>
              <SanteSelecao
                v-if="q.tipo === 'indicador'"
                v-model="q.forma"
                :rotulo="t('forma')"
                :opcoes="opcoesForma(q.tipo)"
                :data-testid="`pg-item-${i}-forma`"
              />
              <SanteSelecao
                v-model="q.largura"
                :rotulo="t('largura')"
                :opcoes="opcoesLargura"
                :data-testid="`pg-item-${i}-largura`"
              />
              <template v-if="q.tipo === 'indicador'">
                <label>
                  {{ t('casas') }}
                  <input
                    v-model.number="q.casasDecimais"
                    type="number"
                    min="0"
                    max="6"
                    :data-testid="`pg-item-${i}-casas`"
                  />
                </label>
                <label class="pg-marca">
                  <input v-model="q.exibirMeta" type="checkbox" :data-testid="`pg-item-${i}-meta`" />
                  {{ t('exibirMeta') }}
                </label>
              </template>
              <p v-if="erroDo(`itens[${i}]`)" role="alert" :data-testid="`pg-item-${i}-erro`">
                {{ erroDo(`itens[${i}]`) }}
              </p>
              <div class="pg-acoes">
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
                  :disabled="i === itens.length - 1"
                  :aria-label="t('descer', { n: i + 1 })"
                  @click="mover(i, 1)"
                >
                  {{ t('descerCurto') }}
                </button>
                <button
                  type="button"
                  :aria-label="t('tirar', { n: i + 1 })"
                  :data-testid="`pg-item-${i}-tirar`"
                  @click="tirar(i)"
                >
                  {{ t('tirarCurto') }}
                </button>
              </div>
            </li>
          </ol>
          <div class="pg-acoes">
            <SanteSelecao
              v-model="novoTipo"
              :rotulo="t('novoQuadro')"
              :opcoes="opcoesTipo"
              data-testid="pg-novo-tipo"
            />
            <button type="button" :disabled="!novoTipo" data-testid="pg-incluir" @click="incluir">
              {{ t('incluir') }}
            </button>
          </div>

          <h2>{{ t('quemAbre') }}</h2>
          <p v-if="permissoes.length === 0">{{ t('semPermissoes') }}</p>
          <ul class="pg-lista">
            <li
              v-for="(p, i) in permissoes"
              :key="`${p.perfilId}-${p.usuarioId}`"
              class="pg-item"
              :data-testid="`pg-permissao-${i}`"
            >
              <strong>{{ nomePermissao(p) }}</strong>
              <label class="pg-marca">
                <input v-model="p.podeExportar" type="checkbox" :data-testid="`pg-permissao-${i}-exportar`" />
                {{ t('exportar') }}
              </label>
              <label>
                {{ t('vigenciaInicio') }}
                <input v-model="p.vigenciaInicio" type="date" :data-testid="`pg-permissao-${i}-inicio`" />
              </label>
              <label>
                {{ t('vigenciaFim') }}
                <input v-model="p.vigenciaFim" type="date" :data-testid="`pg-permissao-${i}-fim`" />
              </label>
              <button
                type="button"
                :aria-label="t('desligar', { nome: nomePermissao(p) })"
                @click="desligar(i)"
              >
                {{ t('desligarCurto') }}
              </button>
              <p v-if="erroDo(`permissoes[${i}]`)" role="alert" :data-testid="`pg-permissao-${i}-erro`">
                {{ erroDo(`permissoes[${i}]`) }}
              </p>
            </li>
          </ul>
          <div class="pg-acoes">
            <SanteSelecao
              v-model="perfilNovo"
              :rotulo="t('perfil')"
              :opcoes="opcoesPerfil"
              data-testid="pg-perfil"
            />
            <button type="button" :disabled="!perfilNovo" data-testid="pg-liberar" @click="liberar">
              {{ t('ligar') }}
            </button>
          </div>

          <p v-if="faltaParaUso" class="secundario" data-testid="pg-falta-uso">{{ t('faltaUso') }}</p>
          <div class="pg-acoes">
            <button type="submit" :disabled="!podeSalvar || gravacao.isPending.value" data-testid="pg-salvar">
              {{ t('salvar') }}
            </button>
            <button
              v-if="!emUso"
              type="button"
              :disabled="faltaParaUso || uso.isPending.value"
              data-testid="pg-por-em-uso"
              @click="uso.mutate(true)"
            >
              {{ t('porEmUso') }}
            </button>
            <button
              v-else
              type="button"
              :disabled="uso.isPending.value"
              data-testid="pg-tirar-de-uso"
              @click="uso.mutate(false)"
            >
              {{ t('tirarDeUso') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.pg-grade {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) 3fr;
  gap: var(--sgh-espaco-3);
  align-items: start;
}
@media (max-width: 48rem) {
  .pg-grade {
    grid-template-columns: 1fr;
  }
}
.pg-direita,
.pg-form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.pg-lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.pg-painel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  text-align: left;
}
.pg-quadros {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sgh-espaco-2);
}
@media (max-width: 48rem) {
  .pg-quadros {
    grid-template-columns: 1fr;
  }
}
.pg-larg-2 {
  grid-column: span 2;
}
.pg-larg-3 {
  grid-column: 1 / -1;
}
@media (max-width: 48rem) {
  .pg-larg-2,
  .pg-larg-3 {
    grid-column: auto;
  }
}
.pg-quadro,
.pg-item {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--sgh-raio);
  padding: var(--sgh-espaco-2);
  background: var(--sgh-fundo-elevado);
}
.pg-item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.pg-valor {
  font-size: 2rem;
  font-weight: 700;
  margin: 0;
}
.pg-texto {
  white-space: pre-line;
}
.pg-selo {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--sgh-raio);
  padding: 0 var(--sgh-espaco-1);
}
.pg-na-meta {
  border-color: var(--sgh-sucesso);
}
.pg-fora-meta {
  border-color: var(--sgh-alerta);
}
.pg-serie {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--sgh-fonte-pequena);
}
.pg-serie td,
.pg-serie th {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
.pg-barra {
  display: inline-block;
  height: 0.5rem;
  max-width: 6rem;
  margin-right: var(--sgh-espaco-1);
  background: var(--sgh-primaria);
  vertical-align: middle;
}
.pg-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.pg-acoes button {
  min-height: var(--sgh-alvo-minimo);
  min-width: var(--sgh-alvo-minimo);
}
.pg-marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
</style>
