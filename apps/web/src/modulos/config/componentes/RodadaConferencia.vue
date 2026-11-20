<script setup lang="ts">
// M36: "Rodada de conferência" da tela de testes de assinatura — operações por rodada (onda) e estabelecimento,
// verdes, conferidas e com cenário controlado; bloqueios por estabelecimento; a situação do teste de invasão; a fila
// herdada de cenários controlados e os problemas dos registros de conferência. Só leitura do painel gerado.
import type { PainelHomologacao } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ painel: PainelHomologacao }>();
const { t, te } = useI18n();
const hospitais = computed(() => props.painel.hospitais.map((h) => h.codigo));
const situacao = computed(() => {
  const k = `config.homologacao.situacoes.${props.painel.pentest.situacao.replace(/-/g, '_')}`;
  return te(k) ? t(k) : props.painel.pentest.situacao;
});
</script>

<template>
  <section aria-labelledby="titulo-rodada" data-testid="rodada-conferencia">
    <h2 id="titulo-rodada">{{ t('config.homologacao.titulo') }}</h2>
    <p>{{ t('config.homologacao.texto') }}</p>
    <p data-testid="versao-roteiro">
      {{
        t('config.homologacao.versao', {
          versao: painel.versaoRoteiro,
          data: new Date(painel.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        })
      }}
    </p>
    <ul v-if="painel.hospitais.some((h) => h.bloqueio)">
      <li v-for="h in painel.hospitais.filter((x) => x.bloqueio)" :key="h.codigo">
        {{ t('config.homologacao.bloqueio', { hospital: h.codigo, motivo: h.bloqueio }) }}
      </li>
    </ul>
    <table data-testid="tabela-rodadas">
      <caption>
        {{
          t('config.homologacao.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.homologacao.onda') }}</th>
          <th scope="col">{{ t('config.homologacao.quem') }}</th>
          <th v-for="h in hospitais" :key="h" scope="col">{{ h }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in painel.rodadas" :key="r.onda" data-testid="linha-rodada">
          <th scope="row">{{ r.rotulo }}</th>
          <td>{{ r.quem }}</td>
          <td v-for="h in hospitais" :key="h">
            <dl class="contagens">
              <dt>{{ t('config.homologacao.operacoes') }}</dt>
              <dd>{{ r.porHospital[h]?.operacoes ?? 0 }}</dd>
              <dt>{{ t('config.homologacao.verdes') }}</dt>
              <dd>{{ r.porHospital[h]?.verdes ?? 0 }}</dd>
              <dt>{{ t('config.homologacao.conferidas') }}</dt>
              <dd>{{ r.porHospital[h]?.conferidas ?? 0 }}</dd>
              <dt>{{ t('config.homologacao.controlado') }}</dt>
              <dd>{{ r.porHospital[h]?.comCenarioControlado ?? 0 }}</dd>
            </dl>
          </td>
        </tr>
      </tbody>
    </table>
    <h3>{{ t('config.homologacao.pentest') }}</h3>
    <p data-testid="situacao-pentest">
      {{
        t('config.homologacao.pentestSituacao', {
          situacao,
          abertos: painel.pentest.abertosCriticosOuAltos,
          reteste: painel.pentest.reteste ?? '—',
        })
      }}
      {{
        painel.pentest.bloqueiaLiberacao
          ? t('config.homologacao.pentestBloqueia')
          : t('config.homologacao.pentestLivre')
      }}
    </p>
    <p v-if="painel.filaCenarioControlado.length" data-testid="fila-controlado">
      {{ t('config.homologacao.fila', { n: painel.filaCenarioControlado.length }) }}
    </p>
    <p v-if="painel.problemas.length === 0">{{ t('config.homologacao.semProblemas') }}</p>
    <template v-else>
      <h3>{{ t('config.homologacao.problemas') }}</h3>
      <ul data-testid="problemas-conferencia">
        <li v-for="p in painel.problemas" :key="p">{{ p }}</li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.contagens {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0 var(--sgh-espaco-2);
  margin: 0;
}
.contagens dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>
