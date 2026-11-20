<script setup lang="ts">
// O painel operacional ou o financeiro da Rede (M57, etapa 3): cada série com a Rede e cada estabelecimento, mês a mês.
// Contagens e reais se somam; os percentuais (glosa, maturação) são Σ numeradores ÷ Σ denominadores.
import type { PainelConsolidadoRede } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatarMes, formatarValor } from '../../internacao/formato.js';

const props = defineProps<{ painel: PainelConsolidadoRede }>();
const { t } = useI18n();
const incluidos = computed(() => props.painel.estabelecimentos.filter((e) => e.situacao === 'incluido'));
const valorDe = (
  serie: PainelConsolidadoRede['series'][number],
  cod: string,
  periodo: string,
): number | null =>
  serie.parcelas.find((p) => p.estabelecimento === cod)?.valores.find((v) => v.periodo === periodo)?.valor ??
  null;
</script>

<template>
  <div data-testid="bi-rede-painel">
    <p v-if="painel.series.length === 0">{{ t('biRede.paineis.nenhuma') }}</p>
    <section v-for="s in painel.series" :key="s.codigo" :data-testid="`bi-rede-painel-${s.codigo}`">
      <h3>{{ s.rotulo }}</h3>
      <SanteAlerta
        v-if="s.recusa"
        :texto="`${t(`biRede.recusas.${s.recusa.motivo}`)} ${s.recusa.mensagem}`"
        variante="aviso"
      />
      <table v-else>
        <caption>
          {{
            t('biRede.paineis.legenda', { rotulo: s.rotulo })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('biRede.serie.mes') }}</th>
            <th scope="col">{{ t('biRede.indicadores.rede') }}</th>
            <th v-for="e in incluidos" :key="e.codigo" scope="col">{{ e.nome }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in s.valores" :key="v.periodo">
            <th scope="row">
              {{ formatarMes(v.periodo) }}
              <span v-if="v.parcial" class="secundario">({{ t('biRede.indicadores.parcial') }})</span>
            </th>
            <td>{{ formatarValor(v.valor, s.unidade) }}</td>
            <td v-for="e in incluidos" :key="e.codigo">
              {{ formatarValor(valorDe(s, e.codigo, v.periodo), s.unidade) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: var(--sgh-espaco-3);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
