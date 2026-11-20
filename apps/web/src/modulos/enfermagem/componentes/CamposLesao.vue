<script lang="ts">
// W0-03, mercado M4: os campos das medidas e do leito da ferida, comuns à ficha da lesão e ao curativo. O formulário
// é um objeto reativo do pai; `medidasDoForm` e `leitoDoForm` montam a entrada do contrato (vazio = null).
import type { Exsudato, LeitoLesao, MedidasLesao } from '@sgh/contratos';

export interface FormMedidasLeito {
  comprimento: number | null;
  largura: number | null;
  profundidade: number | null;
  avaliarLeito: boolean;
  granulacao: number;
  epitelizacao: number;
  esfacelo: number;
  necrose: number;
  exsudato: Exsudato;
  odor: boolean;
  sinaisInfeccao: boolean;
  dor: number | null;
}

export const formMedidasLeitoVazio = (): FormMedidasLeito => ({
  comprimento: null,
  largura: null,
  profundidade: null,
  avaliarLeito: false,
  granulacao: 100,
  epitelizacao: 0,
  esfacelo: 0,
  necrose: 0,
  exsudato: 'ausente',
  odor: false,
  sinaisInfeccao: false,
  dor: null,
});

const num = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : Number(v));
const cm = (v: unknown): number | null => {
  const n = num(v);
  return n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;
};

export function medidasDoForm(f: FormMedidasLeito): MedidasLesao | null {
  const c = cm(f.comprimento);
  const l = cm(f.largura);
  return c === null || l === null ? null : { comprimento: c, largura: l, profundidade: cm(f.profundidade) };
}

export function leitoDoForm(f: FormMedidasLeito): LeitoLesao {
  const dor = num(f.dor);
  return {
    granulacao: Number(f.granulacao) || 0,
    epitelizacao: Number(f.epitelizacao) || 0,
    esfacelo: Number(f.esfacelo) || 0,
    necrose: Number(f.necrose) || 0,
    exsudato: f.exsudato,
    odor: f.odor,
    sinaisInfeccao: f.sinaisInfeccao,
    dor: dor === null || Number.isNaN(dor) ? null : Math.round(dor),
  };
}

export function formDe(m: MedidasLesao | null, l: LeitoLesao | null): FormMedidasLeito {
  return {
    ...formMedidasLeitoVazio(),
    ...(m ? { comprimento: m.comprimento, largura: m.largura, profundidade: m.profundidade } : {}),
    ...(l ? { ...l, avaliarLeito: true } : {}),
  };
}
</script>

<script setup lang="ts">
import { EXSUDATOS } from '@sgh/contratos';
import { SanteOpcoes } from '@sgh/ui';
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{ testid: string; leitoObrigatorio?: boolean }>(), {
  leitoObrigatorio: false,
});
const f = defineModel<FormMedidasLeito>({ required: true });
const { t } = useI18n();
const id = `cl-${useId()}`;
const opcoesExsudato = computed(() =>
  EXSUDATOS.map((v) => ({ valor: v, rotulo: t(`enfermagem.lesao.exsudatos.${v}`) })),
);
const soma = computed(
  () =>
    (Number(f.value.granulacao) || 0) +
    (Number(f.value.epitelizacao) || 0) +
    (Number(f.value.esfacelo) || 0) +
    (Number(f.value.necrose) || 0),
);
const comLeito = computed(() => props.leitoObrigatorio || f.value.avaliarLeito);
const tecidos = ['granulacao', 'epitelizacao', 'esfacelo', 'necrose'] as const;
</script>

<template>
  <div class="medidas">
    <span v-for="k in ['comprimento', 'largura', 'profundidade'] as const" :key="k" class="campo">
      <label :for="`${id}-${k}`">{{ t(`enfermagem.lesao.campos.${k}`) }}</label>
      <input
        :id="`${id}-${k}`"
        v-model.number="f[k]"
        type="number"
        min="0"
        max="99.9"
        step="0.1"
        inputmode="decimal"
        :data-testid="`${testid}-${k}`"
      />
    </span>
  </div>
  <label v-if="!leitoObrigatorio" class="marca">
    <input v-model="f.avaliarLeito" type="checkbox" :data-testid="`${testid}-avaliar-leito`" />
    {{ t('enfermagem.lesao.campos.avaliarLeito') }}
  </label>
  <template v-if="comLeito">
    <div class="medidas">
      <span v-for="k in tecidos" :key="k" class="campo">
        <label :for="`${id}-${k}`">{{ t(`enfermagem.lesao.campos.${k}`) }}</label>
        <input
          :id="`${id}-${k}`"
          v-model.number="f[k]"
          type="number"
          min="0"
          max="100"
          step="5"
          :data-testid="`${testid}-${k}`"
        />
      </span>
    </div>
    <small :class="{ alerta: soma !== 100 }" :data-testid="`${testid}-soma`" aria-live="polite">{{
      t('enfermagem.lesao.campos.somaTecidos', { soma })
    }}</small>
    <SanteOpcoes
      v-model="f.exsudato"
      :legenda="t('enfermagem.lesao.campos.exsudato')"
      :opcoes="opcoesExsudato"
      :nome="`${id}-exsudato`"
    />
    <label class="marca">
      <input v-model="f.odor" type="checkbox" :data-testid="`${testid}-odor`" />
      {{ t('enfermagem.lesao.campos.odor') }}
    </label>
    <label class="marca">
      <input v-model="f.sinaisInfeccao" type="checkbox" :data-testid="`${testid}-infeccao`" />
      {{ t('enfermagem.lesao.campos.infeccao') }}
    </label>
    <span class="campo">
      <label :for="`${id}-dor`">{{ t('enfermagem.lesao.campos.dor') }}</label>
      <input
        :id="`${id}-dor`"
        v-model.number="f.dor"
        type="number"
        min="0"
        max="10"
        step="1"
        :data-testid="`${testid}-dor`"
      />
    </span>
  </template>
</template>

<style scoped>
.medidas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
  margin: 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo input {
  max-width: 10rem;
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.alerta {
  font-weight: 700;
}
</style>
