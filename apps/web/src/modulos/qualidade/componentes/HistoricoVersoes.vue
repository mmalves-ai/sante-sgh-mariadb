<script setup lang="ts">
// W0-04: o histórico de versões de um registro da qualidade (SBIS NGS1.12.01 e NGS1.12.03): cada versão anterior,
// inativa, com a ação, a justificativa, quem e quando, e os campos como estavam. Só os campos com rótulo aparecem (a
// identificação interna da linha não). Abre num diálogo; a leitura é feita só ao abrir.
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../regras-qualidade.js';
import { lerVersoes, type RegistroComVersao } from '../api-correcao.js';
import { mensagensCorrecao } from '../i18n-correcao.js';

const props = defineProps<{
  registro: RegistroComVersao;
  id: number;
  rotulo?: string;
  /** Revisão do W0-04: a aba de dispositivos lê pela rota da enfermagem. */
  enfermagem?: boolean;
}>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const aberto = ref(false);

const q = useQuery({
  queryKey: computed(() => ['qualidade', 'versoes', props.registro, props.id]),
  queryFn: () => lerVersoes(props.registro, props.id, props.enfermagem ?? false),
  enabled: aberto,
});

const CAMPOS = mensagensCorrecao.versoes.campos as Record<string, string>;
function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? t('qualidade.sim') : t('qualidade.nao');
  if (typeof v === 'number' && (v === 0 || v === 1)) return String(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return dataHora(v);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
/** O retrato vem com o nome da coluna (INSERIDO_EM) ou do campo (inseridoEm): os dois dão a mesma chave. */
const coluna = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const campos = (d: Record<string, unknown>) =>
  Object.entries(d)
    .map(([k, v]) => ({ k: coluna(k), v }))
    .filter(({ k }) => k in CAMPOS)
    .map(({ k, v }) => ({ k, rotulo: CAMPOS[k] ?? k, valor: valor(v) }));
</script>

<template>
  <SanteBotao
    :rotulo="rotulo ?? T('historico')"
    variante="texto"
    :data-testid="`historico-${registro}-${id}`"
    @acionar="aberto = true"
  />
  <SanteDialogo v-model:visivel="aberto" :titulo="T('versoes.titulo')" largura="44rem">
    <div class="historico" data-testid="historico-versoes">
      <p class="secundario">{{ T('versoes.explicacao') }}</p>
      <p v-if="q.isLoading.value" role="status">{{ t('qualidade.carregando') }}</p>
      <p v-else-if="!q.data.value?.itens.length" data-testid="historico-vazio">{{ T('versoes.nenhuma') }}</p>
      <ol v-else class="versoes">
        <li
          v-for="v in q.data.value.itens"
          :key="v.versao"
          class="versao"
          :data-testid="`versao-${v.versao}`"
        >
          <p>
            <strong>{{ T('versoes.versao', { v: v.versao }) }}</strong>
            <span class="selo selo--inativo">{{ T('inativo') }}</span>
            · {{ T(`versoes.acoes.${v.acao}`) }}
          </p>
          <p class="secundario">
            {{ T('versoes.por', { quem: v.alteradoPor, em: dataHora(v.alteradoEm) }) }}
          </p>
          <p>
            <span class="secundario">{{ T('versoes.motivo') }}:</span> {{ v.motivo }}
          </p>
          <dl class="campos">
            <template v-for="c in campos(v.dados)" :key="c.k">
              <dt>{{ c.rotulo }}</dt>
              <dd>{{ c.valor }}</dd>
            </template>
          </dl>
        </li>
      </ol>
    </div>
  </SanteDialogo>
</template>

<style scoped>
.historico {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.versoes {
  display: grid;
  gap: var(--sgh-espaco-3);
  padding: 0;
  list-style: none;
}
.versao {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 4px);
  padding: var(--sgh-espaco-2);
  background: var(--sgh-fundo-elevado, var(--sgh-fundo));
}
.campos {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
dd {
  margin: 0;
  white-space: pre-wrap;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.selo--inativo {
  margin-inline-start: var(--sgh-espaco-2);
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  color: var(--sgh-texto-secundario);
  font-size: 0.85em;
}
</style>
