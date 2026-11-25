<script setup lang="ts">
// Exame físico estruturado por sistema e região do corpo (03-PEP L97), numa tela só por paciente. À esquerda o mapa do
// corpo (desenho de cada região vindo do cadastro; a região sem desenho fica na lista ao lado) e os sistemas; ao
// centro os achados padronizados da escolha, de um clique cada, e o achado livre no lugar escolhido; à direita o exame
// em montagem, com lado, normal/alterado e descrição, validado na hora pela mesma regra do servidor (lado na região
// que tem lado, achado de outra idade, repetido, normal contra alterado, inclusive contra o já gravado). Um botão marca
// os sistemas ainda não examinados como sem alterações pelo achado normal padronizado. Abaixo, os exames já
// registrados com o resumo por sistema. Nada é apagado: só o autor acrescenta achados ao registro em vigor.
import {
  type CatalogoExame,
  type FaixaPaciente,
  type ItemExame,
  type LateralidadeExame,
  LATERALIDADES_EXAME,
  padraoServeAoPaciente,
  regiaoDentroDe,
  validarExameFisico,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarExameFisico, lerCatalogoExame, lerExamePaciente } from '../api-exame-fisico.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'exame-fisico', id.value]);
const cat = useQuery({ queryKey: ['pep', 'exame-fisico', 'catalogo'], queryFn: () => lerCatalogoExame() });
const dados = useQuery({ queryKey: chave, queryFn: () => lerExamePaciente(id.value), staleTime: 0 });
const c = computed(() => cat.data.value);
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const faixa = computed(() => (d.value?.faixa ?? null) as FaixaPaciente | null);

// Registro clínico que recebe o exame: o mais recente desta pessoa em vigor.
const meus = computed(() => (d.value?.registros ?? []).filter((r) => r.podeAcrescentar));
const registro = ref('');
watch(
  meus,
  (m) => {
    if (!m.some((r) => String(r.registro) === registro.value))
      registro.value = m[0] ? String(m[0].registro) : '';
  },
  { immediate: true },
);
const opcoesRegistro = computed(() =>
  meus.value.map((r) => ({
    valor: String(r.registro),
    rotulo: `${r.titulo} · ${r.dataHoraClinica ? dataHoraBr(r.dataHoraClinica) : ''}`,
  })),
);
const registroAtual = computed(() => meus.value.find((r) => String(r.registro) === registro.value));
const podeGravar = computed(() => pode('pep.evolucao.criar') && Boolean(registroAtual.value));

// Escolha: sistema (filtro) e região (mapa ou lista).
const sistema = ref<number | null>(null);
const regiao = ref<number | null>(null);
const TODAS = '';
const regiaoTexto = computed({
  get: () => (regiao.value === null ? TODAS : String(regiao.value)),
  set: (v: string) => (regiao.value = v ? Number(v) : null),
});
const opcoesRegiao = computed(() => [
  { valor: TODAS, rotulo: t('pep.exameFisico.todos') },
  ...(c.value?.regioes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
]);
// Só caminho vetorial (letras de comando, números, vírgulas e espaços) vai ao desenho.
const CAMINHO = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;
const comDesenho = computed(() =>
  (c.value?.regioes ?? []).filter((r) => r.desenho && CAMINHO.test(r.desenho) && r.desenho.length < 20_000),
);

const catalogoRegra = computed<CatalogoExame>(() => ({
  sistemas: new Map((c.value?.sistemas ?? []).map((s) => [s.id, { id: s.id, ativo: true }])),
  regioes: new Map(
    (c.value?.regioes ?? []).map((r) => [
      r.id,
      { id: r.id, ativo: true, admiteLateralidade: r.admiteLateralidade, superiorId: r.superior },
    ]),
  ),
  padroes: new Map(
    (c.value?.padroes ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        ativo: true,
        sistemaId: p.sistema,
        regiaoId: p.regiao,
        normal: p.normal,
        publicoAlvo: p.publicoAlvo,
      },
    ]),
  ),
}));
const padroesVisiveis = computed(() =>
  (c.value?.padroes ?? []).filter(
    (p) =>
      padraoServeAoPaciente(p.publicoAlvo, faixa.value) &&
      (sistema.value === null || p.sistema === null || p.sistema === sistema.value) &&
      (regiao.value === null
        ? sistema.value !== null || p.regiao === null
        : p.regiao !== null && regiaoDentroDe(regiao.value, p.regiao, catalogoRegra.value.regioes)) &&
      (sistema.value !== null || regiao.value !== null),
  ),
);

// Exame em montagem.
interface Rascunho extends ItemExame {
  readonly chave: number;
  readonly rotulo: string;
}
const montagem = ref<Rascunho[]>([]);
let proxima = 1;
const nomeSistema = (s: number | null) => c.value?.sistemas.find((x) => x.id === s)?.descricao ?? null;
const nomeRegiao = (r: number | null) => c.value?.regioes.find((x) => x.id === r)?.descricao ?? null;
const rotuloLugar = (s: number | null, r: number | null) =>
  [nomeSistema(s), nomeRegiao(r)].filter(Boolean).join(' · ');
function acrescentar(p: { id: number; descricao: string; sistema: number | null; regiao: number | null }) {
  const s = p.sistema ?? sistema.value;
  const r = regiao.value ?? p.regiao;
  montagem.value.push({
    chave: proxima++,
    rotulo: `${rotuloLugar(s, r)}: ${p.descricao}`,
    sistemaId: s,
    regiaoId: r,
    padraoId: p.id,
    lateralidade: 'nao_se_aplica',
    normal: null,
    descricao: null,
  });
}
function acrescentarLivre() {
  montagem.value.push({
    chave: proxima++,
    rotulo: rotuloLugar(sistema.value, regiao.value),
    sistemaId: sistema.value,
    regiaoId: regiao.value,
    padraoId: null,
    lateralidade: 'nao_se_aplica',
    normal: false,
    descricao: '',
  });
}
const existentes = computed<ItemExame[]>(() =>
  (registroAtual.value?.achados ?? []).map((a) => ({
    sistemaId: a.sistema?.id ?? null,
    regiaoId: a.regiao?.id ?? null,
    padraoId: a.padrao?.id ?? null,
    lateralidade: a.lateralidade as LateralidadeExame,
    normal: a.normal,
    descricao: a.descricao,
  })),
);
/** Sistemas ainda sem achado (na montagem e no registro) que têm achado normal padronizado para a idade. */
function sistemasSemAlteracao() {
  const vistos = new Set([...existentes.value, ...montagem.value].map((i) => i.sistemaId));
  for (const s of c.value?.sistemas ?? []) {
    if (vistos.has(s.id)) continue;
    const p = (c.value?.padroes ?? []).find(
      (x) =>
        x.sistema === s.id &&
        x.regiao === null &&
        x.normal &&
        padraoServeAoPaciente(x.publicoAlvo, faixa.value),
    );
    if (p) {
      montagem.value.push({
        chave: proxima++,
        rotulo: `${s.descricao}: ${p.descricao}`,
        sistemaId: s.id,
        regiaoId: null,
        padraoId: p.id,
        lateralidade: 'nao_se_aplica',
        normal: null,
        descricao: null,
      });
    }
  }
}
const remover = (k: number) => (montagem.value = montagem.value.filter((i) => i.chave !== k));
const admiteLado = (r: number | null) =>
  c.value?.regioes.find((x) => x.id === r)?.admiteLateralidade ?? false;
const opcoesLado = computed(() =>
  LATERALIDADES_EXAME.map((v) => ({ valor: v, rotulo: t(`pep.exameFisico.lados.${v}`) })),
);
const opcoesSituacao = computed(() =>
  (['normal', 'alterado', 'semMarcar'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.exameFisico.situacoes.${v}`),
  })),
);
const situacaoDe = (i: Rascunho) =>
  i.normal === true ? 'normal' : i.normal === false ? 'alterado' : 'semMarcar';
function mudar(k: number, campo: Partial<ItemExame>) {
  montagem.value = montagem.value.map((i) => (i.chave === k ? { ...i, ...campo } : i));
}
const mudarSituacao = (k: number, v: string) =>
  mudar(k, { normal: v === 'normal' ? true : v === 'alterado' ? false : null });

const validacao = computed(() =>
  montagem.value.length
    ? validarExameFisico(montagem.value, catalogoRegra.value, faixa.value, existentes.value)
    : { itens: [], falhas: [] },
);
const pronto = computed(
  () => podeGravar.value && montagem.value.length > 0 && validacao.value.falhas.length === 0,
);
const marcados = computed(() => new Set(montagem.value.map((i) => i.regiaoId)));

async function gravar(): Promise<void> {
  erro.value = null;
  ok.value = '';
  try {
    await gravarExameFisico({
      registro: Number(registro.value),
      itens: montagem.value.map((i) => ({
        sistema: i.sistemaId,
        regiao: i.regiaoId,
        padrao: i.padraoId,
        lateralidade: i.lateralidade,
        normal: i.normal,
        descricao: i.descricao?.trim() ? i.descricao.trim() : null,
      })),
    });
    ok.value = t('pep.exameFisico.gravado');
    montagem.value = [];
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}
const comExame = computed(() => (d.value?.registros ?? []).filter((r) => r.achados.length > 0));
</script>

<template>
  <section class="exame" data-testid="exame-fisico-tela">
    <h1>{{ t('pep.exameFisico.titulo') }}</h1>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-else-if="cat.error.value" :erro="cat.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="exame-fisico-ok" />
    <p v-if="!d || !c">{{ t('pep.carregando') }}</p>
    <template v-else>
      <p v-if="pode('pep.evolucao.criar') && !meus.length" data-testid="exame-fisico-sem-registro">
        {{ t('pep.exameFisico.semRegistro') }}
      </p>
      <div v-if="podeGravar" class="exame__montar" data-testid="exame-fisico-montar">
        <div class="exame__coluna">
          <SanteSelecao
            v-model="registro"
            :rotulo="t('pep.exameFisico.registro')"
            :opcoes="opcoesRegistro"
            data-testid="exame-fisico-registro"
          />
          <h2>{{ t('pep.exameFisico.mapa') }}</h2>
          <p class="exame__dica">{{ t('pep.exameFisico.mapaDica') }}</p>
          <svg
            v-if="comDesenho.length"
            class="exame__mapa"
            viewBox="0 0 200 400"
            role="group"
            :aria-label="t('pep.exameFisico.mapa')"
            data-testid="exame-fisico-mapa"
          >
            <path
              v-for="r in comDesenho"
              :key="r.id"
              :d="r.desenho!"
              class="exame__regiao"
              :class="{
                'exame__regiao--escolhida': regiao === r.id,
                'exame__regiao--marcada': marcados.has(r.id),
              }"
              role="button"
              tabindex="0"
              :aria-label="r.descricao"
              :aria-pressed="regiao === r.id"
              :data-testid="`exame-fisico-regiao-${r.id}`"
              @click="regiao = regiao === r.id ? null : r.id"
              @keydown.enter.prevent="regiao = regiao === r.id ? null : r.id"
              @keydown.space.prevent="regiao = regiao === r.id ? null : r.id"
            >
              <title>{{ r.descricao }}</title>
            </path>
          </svg>
          <SanteSelecao
            v-model="regiaoTexto"
            :rotulo="comDesenho.length ? t('pep.exameFisico.semDesenho') : t('pep.exameFisico.mapa')"
            :opcoes="opcoesRegiao"
            data-testid="exame-fisico-regiao"
          />
          <h2>{{ t('pep.exameFisico.sistemas') }}</h2>
          <div class="exame__chips" role="group" :aria-label="t('pep.exameFisico.sistemas')">
            <button
              v-for="s in c.sistemas"
              :key="s.id"
              type="button"
              class="exame__chip"
              :aria-pressed="sistema === s.id"
              :data-testid="`exame-fisico-sistema-${s.id}`"
              @click="sistema = sistema === s.id ? null : s.id"
            >
              {{ s.descricao }}
            </button>
          </div>
        </div>

        <div class="exame__coluna">
          <h2>{{ t('pep.exameFisico.achados') }}</h2>
          <p v-if="(sistema !== null || regiao !== null) && !padroesVisiveis.length">
            {{ t('pep.exameFisico.semAchados') }}
          </p>
          <ul class="exame__achados" data-testid="exame-fisico-achados">
            <li v-for="p in padroesVisiveis" :key="p.id">
              <button
                type="button"
                class="exame__achado"
                :class="{ 'exame__achado--alterado': !p.normal }"
                :data-testid="`exame-fisico-padrao-${p.id}`"
                @click="acrescentar(p)"
              >
                {{ p.descricao }}
                <small>{{ p.normal ? t('pep.exameFisico.normal') : t('pep.exameFisico.alterado') }}</small>
              </button>
            </li>
          </ul>
          <SanteBotao
            v-if="sistema !== null || regiao !== null"
            variante="secundario"
            :rotulo="t('pep.exameFisico.livre')"
            data-testid="exame-fisico-livre"
            @acionar="acrescentarLivre"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.exameFisico.tudoNormal')"
            data-testid="exame-fisico-tudo-normal"
            @acionar="sistemasSemAlteracao"
          />
        </div>

        <form class="exame__coluna" data-testid="exame-fisico-montagem" @submit.prevent="gravar">
          <h2>{{ t('pep.exameFisico.rascunho') }}</h2>
          <p v-if="!montagem.length">{{ t('pep.exameFisico.vazio') }}</p>
          <article
            v-for="(i, k) in montagem"
            :key="i.chave"
            class="exame__item"
            :data-testid="`exame-fisico-item-${k + 1}`"
          >
            <strong>{{ k + 1 }}. {{ i.rotulo }}</strong>
            <SanteSelecao
              v-if="admiteLado(i.regiaoId)"
              :model-value="i.lateralidade"
              :rotulo="t('pep.exameFisico.lado')"
              :opcoes="opcoesLado"
              :data-testid="`exame-fisico-lado-${k + 1}`"
              @update:model-value="(v: string) => mudar(i.chave, { lateralidade: v as LateralidadeExame })"
            />
            <SanteSelecao
              :model-value="situacaoDe(i)"
              :rotulo="t('pep.exameFisico.situacaoAchado')"
              :opcoes="opcoesSituacao"
              :data-testid="`exame-fisico-situacao-${k + 1}`"
              @update:model-value="(v: string) => mudarSituacao(i.chave, v)"
            />
            <label>
              {{ t('pep.exameFisico.descricao') }}
              <textarea
                :value="i.descricao ?? ''"
                rows="2"
                maxlength="2000"
                :data-testid="`exame-fisico-descricao-${k + 1}`"
                @input="mudar(i.chave, { descricao: ($event.target as HTMLTextAreaElement).value })"
              />
            </label>
            <SanteBotao
              variante="secundario"
              :rotulo="t('pep.exameFisico.remover')"
              :data-testid="`exame-fisico-remover-${k + 1}`"
              @acionar="remover(i.chave)"
            />
          </article>
          <SanteAlerta
            v-if="validacao.falhas.length"
            variante="alerta"
            :texto="validacao.falhas.map((f) => f.mensagem).join(' ')"
            data-testid="exame-fisico-falhas"
          />
          <SanteBotao
            tipo="submit"
            :desabilitado="!pronto"
            :rotulo="t('pep.exameFisico.gravar')"
            data-testid="exame-fisico-gravar"
          />
        </form>
      </div>

      <h2>{{ t('pep.exameFisico.registrados') }}</h2>
      <p v-if="!comExame.length" data-testid="exame-fisico-nenhum">{{ t('pep.exameFisico.nenhum') }}</p>
      <article
        v-for="r in comExame"
        :key="r.registro"
        class="exame__registrado"
        :data-testid="`exame-fisico-registrado-${r.registro}`"
      >
        <h3>
          {{
            t('pep.exameFisico.por', {
              titulo: r.titulo,
              autor: r.autor ?? '',
              quando: r.dataHoraClinica ? dataHoraBr(r.dataHoraClinica) : '',
            })
          }}
        </h3>
        <ul class="exame__resumo">
          <li v-for="(s, k) in r.resumo" :key="k">
            {{
              t('pep.exameFisico.resumo', {
                sistema: s.sistema ?? t('pep.exameFisico.semSistema'),
                examinados: s.examinados,
                normais: s.normais,
                alterados: s.alterados,
              })
            }}
          </li>
        </ul>
        <ol>
          <li v-for="a in r.achados" :key="a.id" :class="{ 'exame__texto--alterado': a.normal === false }">
            {{ a.texto }}
          </li>
        </ol>
      </article>
    </template>
  </section>
</template>

<style scoped>
.exame__montar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-3);
}
.exame__coluna {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.exame__dica {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.exame__mapa {
  max-width: 14rem;
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
}
.exame__regiao {
  fill: var(--sgh-fundo);
  stroke: var(--sgh-borda-forte);
  cursor: pointer;
}
.exame__regiao:focus-visible,
.exame__regiao--escolhida {
  fill: var(--sgh-primaria);
  outline: none;
}
.exame__regiao--marcada {
  stroke: var(--sgh-alerta);
  stroke-width: 2;
}
.exame__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.exame__chip,
.exame__achado {
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  padding-inline: var(--sgh-espaco-2);
  cursor: pointer;
}
.exame__chip[aria-pressed='true'] {
  border-color: var(--sgh-primaria);
  font-weight: bold;
}
.exame__achados {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.exame__achado {
  width: 100%;
  text-align: start;
  display: flex;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
}
.exame__achado--alterado {
  border-color: var(--sgh-aviso);
}
.exame__item,
.exame__registrado {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-2);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.exame__resumo {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.exame__texto--alterado {
  font-weight: bold;
}
</style>
