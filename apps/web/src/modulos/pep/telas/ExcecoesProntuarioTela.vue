<script setup lang="ts">
// Exceções do prontuário (M15, regra 9): relatório agregado para o arquivo médico e a comissão de revisão de
// prontuário. Só contagens por tipo (sem conteúdo, data impossível), modelo e mês do lançamento; de 1 a 4 vira
// "<5"; nenhum paciente. Os totais trazem as parcelas na própria tabela. A consulta vai à trilha.
import type { ContagemAgregada } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerExcecoes } from '../api-pep.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['pep', 'excecoes'], queryFn: () => lerExcecoes(), staleTime: 60_000 });
const r = computed(() => consulta.data.value);
const n = (x: ContagemAgregada) => (typeof x === 'number' ? x.toLocaleString('pt-BR') : x);
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
const mes = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : t('pep.excecoes.semMes'));
</script>

<template>
  <section class="tela" aria-labelledby="pep-excecoes-titulo" data-testid="tela-excecoes-prontuario">
    <h1 id="pep-excecoes-titulo">{{ t('pep.excecoes.titulo') }}</h1>
    <p>{{ t('pep.excecoes.texto') }}</p>
    <p>{{ t('pep.excecoes.ilegivel') }}</p>
    <p>
      <RouterLink to="/pep/prontuario">{{ t('pep.excecoes.voltar') }}</RouterLink>
    </p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!r" role="status">{{ t('pep.carregando') }}</p>
    <template v-else>
      <p data-testid="excecoes-totais">
        {{
          t('pep.excecoes.totais', {
            sem: n(r.totais['sem-conteudo']),
            datas: n(r.totais['data-impossivel']),
          })
        }}
        {{ t('pep.excecoes.gerado', { em: quando(r.geradoEm) }) }}
      </p>
      <p v-if="r.linhas.length === 0" role="status">{{ t('pep.excecoes.vazio') }}</p>
      <table v-else data-testid="lista-excecoes">
        <caption>
          {{
            t('pep.excecoes.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.excecoes.tipo') }}</th>
            <th scope="col">{{ t('pep.excecoes.modelo') }}</th>
            <th scope="col">{{ t('pep.excecoes.mes') }}</th>
            <th scope="col" class="numero">{{ t('pep.excecoes.registros') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(x, i) in r.linhas" :key="i">
            <td>{{ t(`pep.excecoes.tipos.${x.tipo}`) }}</td>
            <td>{{ [x.modelo.codigo, x.modelo.nome].filter(Boolean).join(' · ') || x.modelo.id }}</td>
            <td>{{ mes(x.mes) }}</td>
            <td class="numero">{{ n(x.registros) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.numero {
  text-align: right;
}
</style>
