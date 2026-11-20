<script setup lang="ts">
// Revisão do W0-02 (D-CRUD-SEM-GATILHO): o relatório "exclusões de cadastro feitas fora do sistema" da vigia de
// reconciliação, na página dos parâmetros (onde o parâmetro que a liga é definido). Mostra se a vigia está ligada no
// estabelecimento, a última rodada e as exclusões achadas (rótulo do cadastro, nunca o nome da tabela). A consulta vai
// à trilha de auditoria; a permissão é a de ver os parâmetros.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarRelatorioVigia } from '../api-m08.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['vigia-reconciliacao'], queryFn: () => buscarRelatorioVigia() });
const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
};
</script>

<template>
  <section class="vigia" aria-labelledby="vigia-reconciliacao-titulo" data-testid="vigia-reconciliacao">
    <h2 id="vigia-reconciliacao-titulo">{{ t('vigiaReconciliacao.titulo') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <p>{{ t('vigiaReconciliacao.explicacao', { minutos: consulta.data.value.intervaloMinutos }) }}</p>
      <SanteAlerta
        v-if="!consulta.data.value.disponivel"
        :texto="t('vigiaReconciliacao.indisponivel')"
        variante="info"
        data-testid="vigia-indisponivel"
      />
      <SanteAlerta
        v-else
        :texto="
          consulta.data.value.ligada ? t('vigiaReconciliacao.ligada') : t('vigiaReconciliacao.desligada')
        "
        variante="info"
        data-testid="vigia-situacao"
      />
      <p v-if="consulta.data.value.disponivel" data-testid="vigia-ultima-rodada">
        {{
          consulta.data.value.ultimaRodada === null
            ? t('vigiaReconciliacao.semRodada')
            : consulta.data.value.ultimaRodada.erro
              ? t('vigiaReconciliacao.ultimaRodadaErro', {
                  em: quando(consulta.data.value.ultimaRodada.em),
                  erro: consulta.data.value.ultimaRodada.erro,
                })
              : t('vigiaReconciliacao.ultimaRodada', {
                  em: quando(consulta.data.value.ultimaRodada.em),
                  tabelas: consulta.data.value.ultimaRodada.tabelas,
                  achados: consulta.data.value.ultimaRodada.achados,
                })
        }}
      </p>
      <p v-if="consulta.data.value.linhas.length === 0" data-testid="vigia-vazio">
        {{ t('vigiaReconciliacao.vazio') }}
      </p>
      <table v-else data-testid="vigia-linhas">
        <caption>
          {{
            t('vigiaReconciliacao.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('vigiaReconciliacao.cadastro') }}</th>
            <th scope="col">{{ t('vigiaReconciliacao.detectadoEm') }}</th>
            <th scope="col">{{ t('vigiaReconciliacao.antesDepois') }}</th>
            <th scope="col">{{ t('vigiaReconciliacao.quantos') }}</th>
            <th scope="col">{{ t('vigiaReconciliacao.chaves') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(x, n) in consulta.data.value.linhas" :key="n" :data-testid="`vigia-linha-${n}`">
            <td>{{ x.rotulo }}</td>
            <td>{{ quando(x.detectadoEm) }}</td>
            <td>
              {{ t('vigiaReconciliacao.deAte', { antes: x.contagemAntes, depois: x.contagemDepois }) }}
            </td>
            <td>{{ x.foraDoSistema }}</td>
            <td>{{ x.chaves.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        :rotulo="t('vigiaReconciliacao.atualizar')"
        variante="secundario"
        data-testid="vigia-atualizar"
        @acionar="consulta.refetch()"
      />
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
.vigia {
  display: grid;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
</style>
