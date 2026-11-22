<script setup lang="ts">
// Relatório de conciliação da execução do conector (F4 L10; ADR 0007, item 22), CURTO: totais, o que precisa de
// decisão do cliente, pendências abertas, críticas e resolvidas por entidade e regra (com filtro), o que não carregou
// e a prova de não copiar de cada tabela. Exportável em CSV com o mesmo filtro. Só agregados e entidades de destino.
import type { ExecucaoConector, RelatorioConector } from '@sgh/contratos';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { urlRelatorioCsv } from '../api-onboarding.js';

const props = defineProps<{ codigo: string; execucao: ExecucaoConector }>();
const { t, te } = useI18n();
const entidade = ref('');
const regra = ref('');
watch(
  () => props.execucao.id,
  () => {
    entidade.value = '';
    regra.value = '';
  },
);

const rel = computed<RelatorioConector | null>(() => props.execucao.relatorio ?? null);
const n = (x: number) => x.toLocaleString('pt-BR');
const rotuloEntidade = (e: string) => (te(`onboarding.entidades.${e}`) ? t(`onboarding.entidades.${e}`) : e);
const rotuloRegra = (r: string) => r.replace(/_/g, ' ');
const rotuloCausa = (c: string) =>
  te(`onboarding.relatorio.causas.${c}`) ? t(`onboarding.relatorio.causas.${c}`) : rotuloRegra(c);

const entidades = computed(() => [...new Set((rel.value?.porRegra ?? []).map((p) => p.entidade))].sort());
const regras = computed(() =>
  [
    ...new Set(
      (rel.value?.porRegra ?? [])
        .filter((p) => !entidade.value || p.entidade === entidade.value)
        .map((p) => p.regra),
    ),
  ].sort(),
);
const porRegra = computed(() =>
  (rel.value?.porRegra ?? []).filter(
    (p) => (!entidade.value || p.entidade === entidade.value) && (!regra.value || p.regra === regra.value),
  ),
);
const decisoes = computed(() => {
  const r = rel.value;
  if (!r) return [];
  if (!entidade.value && !regra.value) return r.decisoesCliente;
  const m = new Map<string, RelatorioConector['decisoesCliente'][number]>();
  for (const p of porRegra.value) {
    if (p.decisao !== 'cliente' || !p.abertas) continue;
    const d = m.get(p.regra) ?? {
      regra: p.regra,
      gravidade: p.gravidade,
      quantidade: 0,
      entidades: 0,
      acao: p.acao,
    };
    d.quantidade += p.abertas;
    d.entidades += 1;
    m.set(p.regra, d);
  }
  return [...m.values()];
});
const recusados = computed(() =>
  (rel.value?.naoCarregado.recusados ?? []).filter((x) => !entidade.value || x.entidade === entidade.value),
);
const exportar = computed(() =>
  urlRelatorioCsv(props.codigo, props.execucao.id, { entidade: entidade.value, regra: regra.value }),
);
</script>

<template>
  <section v-if="rel" class="relatorio" aria-labelledby="onb-rel" data-testid="onb-relatorio">
    <h4 id="onb-rel">{{ t('onboarding.relatorio.titulo') }}</h4>
    <p data-testid="onb-rel-totais">{{ t('onboarding.relatorio.totais', rel.totais) }}</p>
    <p data-testid="onb-rel-pendencias">{{ t('onboarding.relatorio.pendenciasResumo', rel.totais) }}</p>
    <p data-testid="onb-rel-saidas">
      {{ t('onboarding.relatorio.saidas', { n: rel.saidasExternas }) }}
      <template v-if="rel.redeSemRotaExterna">{{ t('onboarding.relatorio.redeFechada') }}</template>
    </p>

    <div class="filtros">
      <label>
        {{ t('onboarding.relatorio.filtroEntidade') }}
        <select v-model="entidade" data-testid="onb-rel-entidade" @change="regra = ''">
          <option value="">{{ t('onboarding.relatorio.todas') }}</option>
          <option v-for="e in entidades" :key="e" :value="e">{{ rotuloEntidade(e) }}</option>
        </select>
      </label>
      <label>
        {{ t('onboarding.relatorio.filtroRegra') }}
        <select v-model="regra" data-testid="onb-rel-regra">
          <option value="">{{ t('onboarding.relatorio.todas') }}</option>
          <option v-for="r in regras" :key="r" :value="r">{{ rotuloRegra(r) }}</option>
        </select>
      </label>
      <a :href="exportar" download data-testid="onb-rel-exportar">{{ t('onboarding.relatorio.exportar') }}</a>
    </div>

    <h5>{{ t('onboarding.relatorio.decisoes') }}</h5>
    <p v-if="!decisoes.length" data-testid="onb-rel-sem-decisoes">
      {{ t('onboarding.relatorio.semDecisoes') }}
    </p>
    <table v-else class="tabela" data-testid="onb-rel-decisoes">
      <thead>
        <tr>
          <th scope="col">{{ t('onboarding.execucao.regra') }}</th>
          <th scope="col">{{ t('onboarding.execucao.gravidade') }}</th>
          <th scope="col">{{ t('onboarding.execucao.quantidade') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.entidadesN') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.acao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in decisoes" :key="d.regra">
          <td>{{ rotuloRegra(d.regra) }}</td>
          <td>{{ t(`onboarding.gravidades.${d.gravidade}`) }}</td>
          <td>{{ n(d.quantidade) }}</td>
          <td>{{ n(d.entidades) }}</td>
          <td>{{ d.acao }}</td>
        </tr>
      </tbody>
    </table>

    <table v-if="porRegra.length" class="tabela" data-testid="onb-rel-regras">
      <caption>
        {{
          t('onboarding.relatorio.porRegra')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('onboarding.execucao.entidade') }}</th>
          <th scope="col">{{ t('onboarding.execucao.regra') }}</th>
          <th scope="col">{{ t('onboarding.execucao.gravidade') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.abertas') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.resolvidas') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.decisao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in porRegra" :key="`${p.entidade}:${p.regra}:${p.gravidade}`">
          <td>{{ rotuloEntidade(p.entidade) }}</td>
          <td :title="p.acao">{{ rotuloRegra(p.regra) }}</td>
          <td>{{ t(`onboarding.gravidades.${p.gravidade}`) }}</td>
          <td>{{ n(p.abertas) }}</td>
          <td>{{ n(p.resolvidas) }}</td>
          <td>{{ t(`onboarding.relatorio.classes.${p.decisao}`) }}</td>
        </tr>
      </tbody>
    </table>

    <h5>{{ t('onboarding.relatorio.naoCarregado') }}</h5>
    <ul data-testid="onb-rel-nao-carregado">
      <li>
        {{
          t('onboarding.relatorio.recusados', {
            n: n(recusados.reduce((s, x) => s + x.recusados, 0)),
            entidades: recusados.length,
          })
        }}
      </li>
      <li>{{ t('onboarding.relatorio.semMapa', rel.naoCarregado.semMapa) }}</li>
      <li>{{ t('onboarding.relatorio.bloqueadas', rel.naoCarregado.bloqueadas) }}</li>
    </ul>
    <table v-if="rel.naoCarregado.semCarga.length" class="tabela" data-testid="onb-rel-sem-carga">
      <thead>
        <tr>
          <th scope="col">{{ t('onboarding.relatorio.causa') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.tabelas') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.registros') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.conferida') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.falhou') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.semProva') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in rel.naoCarregado.semCarga" :key="c.causa">
          <td>{{ rotuloCausa(c.causa) }}</td>
          <td>{{ n(c.tabelas) }}</td>
          <td>{{ n(c.registros) }}</td>
          <td>{{ n(c.provasConferidas) }}</td>
          <td>{{ n(c.provasFalhas) }}</td>
          <td>{{ n(c.semProva) }}</td>
        </tr>
      </tbody>
    </table>

    <table v-if="rel.provas.length" class="tabela" data-testid="onb-rel-provas">
      <caption>
        {{
          t('onboarding.relatorio.provas')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('onboarding.relatorio.provaDestino') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.causa') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.provaLinhas') }}</th>
          <th scope="col">{{ t('onboarding.relatorio.provaOk') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in rel.provas" :key="p.destino">
          <td>{{ p.destino }}</td>
          <td>{{ rotuloCausa(p.causa) }}</td>
          <td>{{ n(p.iguais) }} / {{ n(p.linhasOrigem) }}</td>
          <td>{{ p.conferido ? t('onboarding.relatorio.conferida') : t('onboarding.relatorio.falhou') }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.relatorio {
  display: grid;
  gap: var(--sgh-espaco-2, 0.5rem);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3, 0.75rem);
  align-items: end;
}
.filtros label {
  display: grid;
  gap: 0.25rem;
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda, #ccc);
  padding: 0.25rem 0.5rem;
  text-align: left;
}
</style>
