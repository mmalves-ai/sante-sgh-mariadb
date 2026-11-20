<script setup lang="ts">
// Os processamentos que o fechamento fixa, os totais do período e, na conferência, a prova da soma com as parcelas
// impressas (o líquido de cada processamento e o total) — M53.7. O líquido do recibo individual (férias, rescisão) vem
// nulo para quem não consulta salário e aparece como "Restrito".
import type { ConferenciaFechamentoFolha, ProcessoNoFechamento, TotaisFechamentoFolha } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { reais, rotuloCompetencia } from '../comum-folha.js';

defineProps<{
  processos: readonly ProcessoNoFechamento[];
  totais: TotaisFechamentoFolha;
  conferencia: ConferenciaFechamentoFolha | null;
}>();
const { t } = useI18n();
const CAMPOS = ['proventos', 'descontos', 'liquido', 'inss', 'irrf', 'fgts', 'encargos'] as const;
</script>

<template>
  <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.fechamento.processos')">
    <table class="tabela" data-testid="folha-fechamento-processos">
      <thead>
        <tr>
          <th scope="col">{{ t('folha.fechamento.processos') }}</th>
          <th scope="col">{{ t('folha.competencia') }}</th>
          <th scope="col">{{ t('folha.fechamento.numero') }}</th>
          <th scope="col">{{ t('folha.fechamento.colaboradores') }}</th>
          <th scope="col">{{ t('folha.fechamento.pagamento') }}</th>
          <th scope="col">{{ t('folha.fechamento.liquido') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in processos" :key="p.id" :data-testid="`folha-fechamento-processo-${p.id}`">
          <th scope="row">{{ t(`folha.fechamento.tipos.${p.tipo}`) }} · {{ p.id }}</th>
          <td>{{ rotuloCompetencia(p.competencia) }}</td>
          <td>{{ p.numero }}</td>
          <td>{{ p.colaboradores }}</td>
          <td>{{ p.pagamento ? dataBr(p.pagamento) : '—' }}</td>
          <td>{{ p.liquido === null ? t('folha.fechamento.semValor') : reais(p.liquido) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <h3>{{ t('folha.fechamento.totais.titulo') }}</h3>
  <dl class="dados" data-testid="folha-fechamento-totais">
    <div>
      <dt>{{ t('folha.fechamento.totais.processos') }}</dt>
      <dd>{{ totais.processos }}</dd>
    </div>
    <div v-for="c in CAMPOS" :key="c">
      <dt>{{ t(`folha.fechamento.totais.${c}`) }}</dt>
      <dd :data-testid="`folha-fechamento-total-${c}`">{{ reais(totais[c]) }}</dd>
    </div>
  </dl>
  <template v-if="conferencia">
    <h3>{{ t('folha.fechamento.conferencia.titulo') }}</h3>
    <ul class="lista" data-testid="folha-fechamento-parcelas">
      <li v-for="(p, i) in conferencia.parcelas" :key="i">{{ p.rotulo }}: {{ reais(p.valor) }}</li>
    </ul>
    <p v-if="conferencia.ok" class="secundario" data-testid="folha-fechamento-conferencia-ok">
      {{ t('folha.fechamento.conferencia.ok') }}
    </p>
    <template v-else>
      <p role="alert">{{ t('folha.fechamento.conferencia.divergente') }}</p>
      <ul class="lista" data-testid="folha-fechamento-divergencias">
        <li v-for="(d, i) in conferencia.divergencias" :key="i">{{ d }}</li>
      </ul>
    </template>
  </template>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
