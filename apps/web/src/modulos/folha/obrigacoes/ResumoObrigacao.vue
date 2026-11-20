<script setup lang="ts">
// Resumo de uma apuração ou prévia das obrigações (M53.8): os totais (os valores só com `pessoas.salario.ler`; as
// quantidades sempre), a prova da soma com as parcelas impressas, as pendências que barram a geração (com os vínculos,
// nunca o nome) e os avisos que não barram. Nenhum código cru: cada pendência e aviso tem texto em
// `folha.obrigacoes.pendencia.*` e `folha.obrigacoes.aviso.*`.
import type {
  CodigoAvisoObrigacao,
  ConferenciaObrigacao,
  PendenciaObrigacao,
  TipoObrigacao,
  TotaisObrigacao,
} from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { reais } from '../comum-folha.js';

const props = withDefaults(
  defineProps<{
    tipo: TipoObrigacao;
    totais: TotaisObrigacao | null;
    trabalhadores: number;
    conferencia: ConferenciaObrigacao | null;
    pendencias: readonly PendenciaObrigacao[];
    avisos: readonly CodigoAvisoObrigacao[];
    prefixo: string;
    /** Falso na obrigação já gerada: sem a linha "sem pendências". */
    previa?: boolean;
  }>(),
  { previa: true },
);
const { t, te } = useI18n();
const textoPendencia = (p: PendenciaObrigacao) =>
  te(`folha.obrigacoes.pendencia.${p.codigo}`) ? t(`folha.obrigacoes.pendencia.${p.codigo}`) : p.mensagem;
const fgts = computed(() => props.tipo === 'fgts-digital' || props.tipo === 'sefip');
const movimento = computed(() => props.tipo !== 'fgts-digital');
type Chave = 'remuneracao' | 'remuneracaoDecimo' | 'baseFgts' | 'fgts' | 'rescisorio';
const valores = computed<[Chave, number][]>(() => {
  const x = props.totais;
  if (!x) return [];
  const ks: Chave[] = [
    'remuneracao',
    'remuneracaoDecimo',
    ...(fgts.value ? (['baseFgts', 'fgts', 'rescisorio'] as const) : []),
  ];
  return ks.map((k) => [k, x[k]]);
});
</script>

<template>
  <div class="bloco" :data-testid="`${prefixo}-resumo`">
    <h3>{{ t('folha.obrigacoes.totais.titulo') }}</h3>
    <dl class="campos" :data-testid="`${prefixo}-totais`">
      <div>
        <dt>{{ t('folha.obrigacoes.totais.trabalhadores') }}</dt>
        <dd :data-testid="`${prefixo}-trabalhadores`">{{ totais?.trabalhadores ?? trabalhadores }}</dd>
      </div>
      <template v-if="totais && movimento">
        <div>
          <dt>{{ t('folha.obrigacoes.totais.admissoes') }}</dt>
          <dd>{{ totais.admissoes }}</dd>
        </div>
        <div>
          <dt>{{ t('folha.obrigacoes.totais.desligamentos') }}</dt>
          <dd>{{ totais.desligamentos }}</dd>
        </div>
      </template>
      <div v-for="[k, v] in valores" :key="k">
        <dt>{{ t(`folha.obrigacoes.totais.${k}`) }}</dt>
        <dd :data-testid="`${prefixo}-total-${k}`">{{ reais(v) }}</dd>
      </div>
    </dl>
    <template v-if="conferencia">
      <h3>{{ t('folha.obrigacoes.conferencia.titulo') }}</h3>
      <ul class="lista" :data-testid="`${prefixo}-parcelas`">
        <li v-for="(p, i) in conferencia.parcelas" :key="i">{{ p.rotulo }}: {{ reais(p.valor) }}</li>
      </ul>
      <p v-if="conferencia.ok" class="secundario" :data-testid="`${prefixo}-conferencia-ok`">
        {{ t('folha.obrigacoes.conferencia.ok') }}
      </p>
      <template v-else>
        <p role="alert">{{ t('folha.obrigacoes.conferencia.divergente') }}</p>
        <ul class="lista" :data-testid="`${prefixo}-divergencias`">
          <li v-for="(d, i) in conferencia.divergencias" :key="i">{{ d }}</li>
        </ul>
      </template>
    </template>
    <template v-if="pendencias.length">
      <p role="alert">{{ t('folha.obrigacoes.pendencias') }}</p>
      <ul class="lista" :data-testid="`${prefixo}-pendencias`">
        <li v-for="p in pendencias" :key="p.codigo" :data-testid="`${prefixo}-pendencia-${p.codigo}`">
          {{ textoPendencia(p) }}
          <span v-if="p.vinculos.length" class="secundario">
            · {{ t('folha.obrigacoes.vinculos', { v: p.vinculos.slice(0, 20).join(', ') }) }}</span
          >
        </li>
      </ul>
    </template>
    <p v-else-if="previa" class="secundario" :data-testid="`${prefixo}-sem-pendencias`">
      {{ t('folha.obrigacoes.semPendencias') }}
    </p>
    <SanteAlerta
      v-for="a in avisos"
      :key="a"
      :texto="t(`folha.obrigacoes.aviso.${a}`)"
      variante="aviso"
      :data-testid="`${prefixo}-aviso-${a}`"
    />
  </div>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
