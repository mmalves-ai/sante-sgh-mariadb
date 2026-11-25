<script setup lang="ts">
// Painéis de TV operacionais (01-REL L116): cadastro do painel e dos blocos numa tela só (lista à esquerda, editor à
// direita), validação na hora pelas regras do domínio (as mesmas do servidor), televisores com o código de pareamento
// e o atalho para ver como a TV mostra. Nenhum nome de paciente: a TV mostra só iniciais, números e tempos.
import {
  type BlocoTvEntrada,
  conferirBlocosTv,
  conferirTemposTv,
  FONTES_BLOCO_TV,
  FORMAS_BLOCO_TV,
  MAXIMO_BLOCOS_TV,
} from '@sgh/dominio-relatorio';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  type BlocoTv,
  criarPainelTv,
  desligarTelevisor,
  ligarTelevisor,
  lerCatalogoTv,
  lerPainelTv,
  lerPaineisTv,
  mudarSituacaoTv,
  salvarPainelTv,
} from '../api-paineis-tv.js';
import { mensagensPaineisTv } from '../i18n-paineis-tv.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensPaineisTv });
const qc = useQueryClient();
const lista = useQuery({ queryKey: ['paineis-tv'], queryFn: lerPaineisTv });
const catalogo = useQuery({ queryKey: ['paineis-tv', 'catalogo'], queryFn: lerCatalogoTv });
const escolhido = ref<number | null>(null);
const painel = useQuery({
  queryKey: computed(() => ['paineis-tv', escolhido.value]),
  queryFn: () => lerPainelTv(escolhido.value as number),
  enabled: computed(() => escolhido.value !== null),
});

const opcoesTipo = computed(() =>
  (catalogo.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
);
const opcoesFonte = computed(() => FONTES_BLOCO_TV.map((v) => ({ valor: v, rotulo: t(`fontes.${v}`) })));
const opcoesForma = computed(() => FORMAS_BLOCO_TV.map((v) => ({ valor: v, rotulo: t(`formas.${v}`) })));
const opcoesUnidade = computed(() => [
  { valor: null as number | null, rotulo: t('todasUnidades') },
  ...(catalogo.data.value?.unidadesIntensivas ?? []).map((x) => ({
    valor: x.id as number | null,
    rotulo: x.nome,
  })),
]);
const opcoesSala = computed(() => [
  { valor: null as number | null, rotulo: t('todasSalas') },
  ...(catalogo.data.value?.salas ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesTv = computed(() => [
  { valor: null as number | null, rotulo: t('televisor') },
  ...(catalogo.data.value?.televisores ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);

// ── Novo painel ──
const novo = reactive({ codigo: '', nome: '', tipoId: null as number | null, rotacao: 30, atualizacao: 60 });
const errosNovo = computed(() => conferirTemposTv(Number(novo.rotacao), Number(novo.atualizacao)));
const podeCriar = computed(
  () =>
    /^[A-Za-z0-9_.-]{2,30}$/.test(novo.codigo.trim()) &&
    novo.nome.trim().length >= 3 &&
    novo.tipoId !== null &&
    errosNovo.value.length === 0,
);
const criar = useMutation({
  mutationFn: () =>
    criarPainelTv({
      codigo: novo.codigo.trim(),
      nome: novo.nome.trim(),
      tipoId: novo.tipoId as number,
      tempoRotacaoSegundos: Number(novo.rotacao),
      atualizacaoSegundos: Number(novo.atualizacao),
    }),
  onSuccess: async (r) => {
    Object.assign(novo, { codigo: '', nome: '', tipoId: null });
    await qc.invalidateQueries({ queryKey: ['paineis-tv'] });
    escolhido.value = r.id;
  },
});

// ── Editor ──
const form = reactive({ nome: '', rotacao: 30, atualizacao: 60, blocos: [] as BlocoTv[] });
watch(
  () => painel.data.value,
  (p) => {
    if (!p) return;
    form.nome = p.nome;
    form.rotacao = p.tempoRotacaoSegundos;
    form.atualizacao = p.atualizacaoSegundos;
    form.blocos = p.blocos.map((b) => ({ ...b }));
  },
  { immediate: true },
);
const blocosEntrada = computed<BlocoTvEntrada[]>(() =>
  form.blocos.map((b) => ({
    ...b,
    tempoEmTelaSegundos:
      b.tempoEmTelaSegundos === null || String(b.tempoEmTelaSegundos) === ''
        ? null
        : Number(b.tempoEmTelaSegundos),
    limite: Number(b.limite),
  })),
);
const erros = computed(() => [
  ...conferirTemposTv(Number(form.rotacao), Number(form.atualizacao)),
  ...conferirBlocosTv(blocosEntrada.value),
]);
function incluirBloco() {
  form.blocos.push({
    fonte: 'uti',
    titulo: t('fontes.uti'),
    forma: 'tabela',
    tempoEmTelaSegundos: null,
    unidadeInternacaoId: null,
    salaCirurgicaId: null,
    limite: 20,
  });
}
function trocarFonte(i: number) {
  const b = form.blocos[i]!;
  b.titulo = t(`fontes.${b.fonte}`);
  if (b.fonte !== 'uti') b.unidadeInternacaoId = null;
  if (b.fonte !== 'mapa_cirurgico') b.salaCirurgicaId = null;
  if (b.forma === 'mapa' && b.fonte !== 'uti' && b.fonte !== 'mapa_cirurgico') b.forma = 'tabela';
}
function subir(i: number) {
  if (i === 0) return;
  const [b] = form.blocos.splice(i, 1);
  form.blocos.splice(i - 1, 0, b!);
}
const salvo = ref(false);
const salvar = useMutation({
  mutationFn: () =>
    salvarPainelTv(escolhido.value as number, {
      versao: painel.data.value!.versao,
      nome: form.nome.trim(),
      tempoRotacaoSegundos: Number(form.rotacao),
      atualizacaoSegundos: Number(form.atualizacao),
      blocos: blocosEntrada.value,
    }),
  onSuccess: async () => {
    salvo.value = true;
    await qc.invalidateQueries({ queryKey: ['paineis-tv'] });
  },
});
const situacao = useMutation({
  mutationFn: (s: string) => mudarSituacaoTv(escolhido.value as number, painel.data.value!.versao, s),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['paineis-tv'] }),
});
const tvEscolhida = ref<number | null>(null);
const codigoGerado = ref<string | null>(null);
const ligar = useMutation({
  mutationFn: () => ligarTelevisor(escolhido.value as number, tvEscolhida.value as number),
  onSuccess: async (r) => {
    codigoGerado.value = r.codigoPareamento;
    tvEscolhida.value = null;
    await qc.invalidateQueries({ queryKey: ['paineis-tv'] });
  },
});
const desligar = useMutation({
  mutationFn: (tv: number) => desligarTelevisor(escolhido.value as number, tv),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['paineis-tv'] }),
});
const sujo = computed(() => {
  const p = painel.data.value;
  return !!p && JSON.stringify(p.blocos) !== JSON.stringify(blocosEntrada.value);
});
watch(escolhido, () => {
  salvo.value = false;
  codigoGerado.value = null;
});
</script>

<template>
  <section class="ptv" aria-labelledby="ptv-titulo" data-testid="tela-paineis-tv-operacionais">
    <h1 id="ptv-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <div class="ptv-colunas">
      <aside class="ptv-lista" :aria-label="t('paineis')">
        <h2>{{ t('paineis') }}</h2>
        <p v-if="lista.data.value?.length === 0">{{ t('semPaineis') }}</p>
        <ul>
          <li v-for="p in lista.data.value ?? []" :key="p.id">
            <button
              type="button"
              class="ptv-item"
              :aria-current="escolhido === p.id"
              :data-testid="`ptv-painel-${p.codigo}`"
              @click="escolhido = p.id"
            >
              <strong>{{ p.nome }}</strong>
              <span>{{ t(`situacoes.${p.situacao}`) }} · {{ p.noAr ? t('noAr') : t('foraDoAr') }}</span>
              <small>{{ t('resumo', { tipo: p.tipo, blocos: p.blocos, televisores: p.televisores }) }}</small>
            </button>
          </li>
        </ul>
        <form class="ptv-novo" data-testid="ptv-novo" @submit.prevent="podeCriar && criar.mutate()">
          <h3>{{ t('novo') }}</h3>
          <label
            >{{ t('codigo') }}
            <input v-model="novo.codigo" maxlength="30" required data-testid="ptv-novo-codigo"
          /></label>
          <label
            >{{ t('nome') }} <input v-model="novo.nome" maxlength="150" required data-testid="ptv-novo-nome"
          /></label>
          <SanteSelecao
            v-model="novo.tipoId"
            :rotulo="t('tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="ptv-novo-tipo"
          />
          <label
            >{{ t('rotacao') }} <input v-model.number="novo.rotacao" type="number" min="5" max="3600"
          /></label>
          <label
            >{{ t('atualizacao') }} <input v-model.number="novo.atualizacao" type="number" min="5" max="3600"
          /></label>
          <p v-for="e in errosNovo" :key="e.campo" class="ptv-erro" role="alert">{{ e.mensagem }}</p>
          <MensagemErro v-if="criar.isError.value" :erro="criar.error.value" />
          <button type="submit" :disabled="!podeCriar || criar.isPending.value" data-testid="ptv-criar">
            {{ t('criar') }}
          </button>
        </form>
      </aside>

      <div v-if="painel.data.value" class="ptv-editor" data-testid="ptv-editor">
        <h2>{{ t('editar', { nome: painel.data.value.nome }) }}</h2>
        <p>{{ painel.data.value.tipo.descricao }} · {{ t(`situacoes.${painel.data.value.situacao}`) }}</p>
        <div class="ptv-linha">
          <label>{{ t('nome') }} <input v-model="form.nome" maxlength="150" data-testid="ptv-nome" /></label>
          <label
            >{{ t('rotacao') }} <input v-model.number="form.rotacao" type="number" min="5" max="3600"
          /></label>
          <label
            >{{ t('atualizacao') }} <input v-model.number="form.atualizacao" type="number" min="5" max="3600"
          /></label>
        </div>
        <h3>{{ t('blocos') }}</h3>
        <p v-if="form.blocos.length === 0">{{ t('semBlocos') }}</p>
        <ol class="ptv-blocos">
          <li v-for="(b, i) in form.blocos" :key="i" :data-testid="`ptv-bloco-${i}`">
            <SanteSelecao
              v-model="b.fonte"
              :rotulo="t('fonte')"
              :opcoes="opcoesFonte"
              obrigatorio
              :data-testid="`ptv-bloco-${i}-fonte`"
              @update:model-value="trocarFonte(i)"
            />
            <label
              >{{ t('tituloBloco') }}
              <input v-model="b.titulo" maxlength="150" :data-testid="`ptv-bloco-${i}-titulo`"
            /></label>
            <SanteSelecao
              v-model="b.forma"
              :rotulo="t('forma')"
              :opcoes="opcoesForma"
              obrigatorio
              :data-testid="`ptv-bloco-${i}-forma`"
            />
            <SanteSelecao
              v-if="b.fonte === 'uti'"
              v-model="b.unidadeInternacaoId"
              :rotulo="t('unidade')"
              :opcoes="opcoesUnidade"
              :data-testid="`ptv-bloco-${i}-unidade`"
            />
            <SanteSelecao
              v-if="b.fonte === 'mapa_cirurgico'"
              v-model="b.salaCirurgicaId"
              :rotulo="t('sala')"
              :opcoes="opcoesSala"
              :data-testid="`ptv-bloco-${i}-sala`"
            />
            <label
              >{{ t('tempoBloco') }}
              <input v-model.number="b.tempoEmTelaSegundos" type="number" min="5" max="3600"
            /></label>
            <label
              >{{ t('limite') }} <input v-model.number="b.limite" type="number" min="1" max="40"
            /></label>
            <div class="ptv-acoes">
              <button
                type="button"
                :aria-label="t('subir', { n: i + 1 })"
                :disabled="i === 0"
                @click="subir(i)"
              >
                {{ t('acima') }}
              </button>
              <button type="button" :aria-label="t('tirar', { n: i + 1 })" @click="form.blocos.splice(i, 1)">
                {{ t('remover') }}
              </button>
            </div>
          </li>
        </ol>
        <p v-for="e in erros" :key="e.campo + e.codigo" class="ptv-erro" role="alert">{{ e.mensagem }}</p>
        <div class="ptv-acoes">
          <button
            type="button"
            :disabled="form.blocos.length >= MAXIMO_BLOCOS_TV"
            data-testid="ptv-incluir-bloco"
            @click="incluirBloco"
          >
            {{ t('incluirBloco') }}
          </button>
          <button
            type="button"
            :disabled="erros.length > 0 || salvar.isPending.value"
            data-testid="ptv-salvar"
            @click="salvar.mutate()"
          >
            {{ t('salvar') }}
          </button>
          <button
            v-if="painel.data.value.situacao !== 'ativo'"
            type="button"
            :disabled="sujo || form.blocos.length === 0"
            data-testid="ptv-ativar"
            @click="situacao.mutate('ativo')"
          >
            {{ t('ativar') }}
          </button>
          <button v-else type="button" data-testid="ptv-suspender" @click="situacao.mutate('suspenso')">
            {{ t('suspender') }}
          </button>
          <button
            v-if="painel.data.value.situacao !== 'inativo'"
            type="button"
            @click="situacao.mutate('inativo')"
          >
            {{ t('inativar') }}
          </button>
          <RouterLink
            :to="`/relatorios/paineis-tv/${painel.data.value.id}/tela`"
            data-testid="ptv-ver-tela"
            >{{ t('abrirTela') }}</RouterLink
          >
        </div>
        <p v-if="salvo" role="status" data-testid="ptv-salvo">{{ t('salvo') }}</p>
        <MensagemErro v-if="salvar.isError.value" :erro="salvar.error.value" />
        <MensagemErro v-if="situacao.isError.value" :erro="situacao.error.value" />

        <h3>{{ t('televisores') }}</h3>
        <p v-if="painel.data.value.televisores.length === 0">{{ t('semTelevisores') }}</p>
        <ul class="ptv-tvs">
          <li v-for="d in painel.data.value.televisores" :key="d.id" :data-testid="`ptv-tv-${d.estacaoId}`">
            <strong>{{ d.estacao }}</strong>
            <span v-if="d.codigoPareamento">{{ t('codigoPareamento', { codigo: d.codigoPareamento }) }}</span>
            <span v-else>{{ t('pareado') }} · {{ d.noAr ? t('noAr') : t('foraDoAr') }}</span>
            <button type="button" @click="desligar.mutate(d.id)">
              {{ t('desligar', { nome: d.estacao }) }}
            </button>
          </li>
        </ul>
        <div class="ptv-linha">
          <SanteSelecao
            v-model="tvEscolhida"
            :rotulo="t('televisor')"
            :opcoes="opcoesTv"
            data-testid="ptv-tv-escolha"
          />
          <button
            type="button"
            :disabled="tvEscolhida === null || ligar.isPending.value"
            data-testid="ptv-ligar"
            @click="ligar.mutate()"
          >
            {{ t('ligar') }}
          </button>
        </div>
        <p v-if="codigoGerado" class="ptv-codigo" role="status" data-testid="ptv-codigo">
          {{ t('codigoPareamento', { codigo: codigoGerado }) }}
        </p>
        <MensagemErro v-if="ligar.isError.value" :erro="ligar.error.value" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ptv-colunas {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) 3fr;
  gap: var(--sgh-espaco-4);
}
.ptv-lista ul,
.ptv-blocos,
.ptv-tvs {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.ptv-item {
  display: grid;
  width: 100%;
  text-align: start;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.ptv-item[aria-current='true'] {
  border-color: var(--sgh-primaria);
}
.ptv-novo,
.ptv-blocos li {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
}
.ptv-linha,
.ptv-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.ptv-erro {
  color: var(--sgh-alerta);
}
.ptv-codigo {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--sgh-sucesso);
}
@media (max-width: 60rem) {
  .ptv-colunas {
    grid-template-columns: 1fr;
  }
}
</style>
