<script setup lang="ts">
// Relatório de divergência entre os índices dos estabelecimentos da rede (M57, etapa 1; regra 4; critério de aceite
// "0 divergência depois do ciclo"): cada par com a situação vista em cada estabelecimento, e "Completar o que faltou"
// (só com `rede.mpi.vincular`), que repete a gravação no estabelecimento que ficou para trás (idempotente); pessoa
// diferente nos dois fica para revisão humana.
import type { DivergenciasRede } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr } from '../../cadastro/formato.js';
import { lerDivergenciasRede, repararIndiceRede } from '../api-rede.js';

const props = defineProps<{ nomes: Readonly<Record<string, string>> }>();
const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['rede', 'divergencias'], queryFn: () => lerDivergenciasRede() });
const d = computed<DivergenciasRede | undefined>(() => consulta.data.value);
const podeReparar = computed(() => pode('rede.mpi.vincular'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

async function reparar(): Promise<void> {
  erro.value = null;
  try {
    const r = await repararIndiceRede();
    mensagem.value = t('rede.divergencia.reparado', {
      reparados: r.reparados,
      total: r.reparados + r.pendentes,
    });
    await cliente.invalidateQueries({ queryKey: ['rede'] });
  } catch (e) {
    erro.value = e;
  }
}
const nome = (est: string) => props.nomes[est] ?? est;
function situacaoNo(x: DivergenciasRede['itens'][number], est: string): string {
  const b = x.porBanco.find((p) => p.estabelecimento === est);
  return b?.situacao ? t(`rede.vinculos.situacoes.${b.situacao}`) : '—';
}
</script>

<template>
  <section aria-labelledby="divergencia-titulo" data-testid="divergencias-rede">
    <h2 id="divergencia-titulo">{{ t('rede.divergencia.titulo') }}</h2>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!d">{{ t('rede.carregando') }}</p>
    <template v-else>
      <p v-if="mensagem" role="status" data-testid="mensagem-reparo">{{ mensagem }}</p>
      <p class="pequeno">{{ carimboBr(d.geradoEm) }}</p>
      <p v-if="d.total === 0" role="status" data-testid="sem-divergencia">
        {{ t('rede.divergencia.nenhuma') }}
      </p>
      <template v-else>
        <p data-testid="total-divergencias">{{ t('rede.divergencia.total', { total: d.total }) }}</p>
        <table>
          <caption>
            {{
              t('rede.divergencia.total', { total: d.total })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('rede.colunas.situacao') }}</th>
              <th v-for="e in d.estabelecimentos" :key="e" scope="col">{{ nome(e) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in d.itens" :key="x.chave" :data-testid="`divergencia-${x.chave}`">
              <td>{{ t(`rede.divergencia.tipos.${x.tipo}`) }}</td>
              <td v-for="e in d.estabelecimentos" :key="e">{{ situacaoNo(x, e) }}</td>
            </tr>
          </tbody>
        </table>
        <SanteBotao
          v-if="podeReparar"
          :rotulo="t('rede.divergencia.reparar')"
          variante="secundario"
          data-testid="botao-reparar"
          @acionar="reparar"
        />
      </template>
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
.pequeno {
  font-size: var(--sgh-fonte-pequena);
}
</style>
