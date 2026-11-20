<script setup lang="ts">
// Situações de regulação de leito (ficha do M44, regra 10, etapa 2): `/internacao/nir/situacoes`. O de-para das 23
// situações do cadastro para os estados do NIR: a proposta, o estado vigente e quem aprovou; as 6 de baixa confiança com
// a legenda "a confirmar" até o aceite do NIR. Aprovar exige a permissão dos parâmetros do NIR.
import { CODIGOS_ESTADO_NIR } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { aprovarSituacao, lerGravacaoNir, lerSituacoesNir, novaChaveNir } from '../api-nir.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import { horaCurta } from '../regras-nir.js';

const { t } = useI18n();
const gravacao = useQuery({ queryKey: ['nir', 'gravacao'], queryFn: lerGravacaoNir, staleTime: 30_000 });
const podeAprovar = computed(() => gravacao.data.value?.operacoes['depara']?.pode ?? false);
const situacoes = useQuery({ queryKey: ['nir', 'situacoes'], queryFn: lerSituacoesNir });
const escolhas = ref<Record<number, string>>({});
const estados = computed(() => [
  { valor: '', rotulo: t('nir.escolha') },
  ...CODIGOS_ESTADO_NIR.map((e) => ({ valor: e, rotulo: t(`nir.estados.${e}`) })),
]);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function aprovar(situacao: number, padrao: string | null): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await aprovarSituacao(situacao, { estado: escolhas.value[situacao] || padrao }, novaChaveNir('aprovar'));
    await situacoes.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nir-sit-titulo" data-testid="tela-situacoes-nir">
    <h1 id="nir-sit-titulo">{{ t('nir.situacoes.titulo') }}</h1>
    <p>{{ t('nir.situacoes.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/fila">{{ t('nir.atalhos.fila') }}</RouterLink>
    </p>
    <ErroAdt v-if="situacoes.isError.value" :erro="situacoes.error.value" />
    <p v-else-if="!situacoes.data.value" role="status">{{ t('nir.carregando') }}</p>
    <template v-else>
      <p data-testid="situacoes-resumo">
        {{
          t('nir.situacoes.resumo', {
            comDestino: situacoes.data.value.comDestino,
            aConfirmar: situacoes.data.value.aConfirmar,
          })
        }}
      </p>
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('nir.situacoes.codigo') }}</th>
            <th scope="col">{{ t('nir.situacoes.situacao') }}</th>
            <th scope="col">{{ t('nir.situacoes.proposto') }}</th>
            <th scope="col">{{ t('nir.situacoes.vigente') }}</th>
            <th v-if="podeAprovar" scope="col">{{ t('nir.situacoes.aprovar') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in situacoes.data.value.itens"
            :key="s.situacao"
            :data-testid="`situacao-${s.situacao}`"
          >
            <td>{{ s.situacao }}</td>
            <th scope="row">{{ s.rotulo }}</th>
            <td>{{ s.proposto ? t(`nir.estados.${s.proposto}`) : t('nir.situacoes.semEstado') }}</td>
            <td>
              {{ s.estado ? t(`nir.estados.${s.estado}`) : t('nir.situacoes.semEstado') }}
              <strong v-if="s.aConfirmar"> {{ t('nir.fila.aConfirmar') }}</strong>
              <span v-if="s.aprovadoPor" class="secundario">
                · {{ t('nir.situacoes.aprovado', { por: s.aprovadoPor, em: horaCurta(s.aprovadoEm) }) }}</span
              >
            </td>
            <td v-if="podeAprovar">
              <SanteSelecao
                :model-value="escolhas[s.situacao] ?? s.estado ?? ''"
                :rotulo="t('nir.situacoes.vigente')"
                ocultar-rotulo
                :opcoes="estados"
                @update:model-value="(v: string) => (escolhas[s.situacao] = v)"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('nir.situacoes.aprovar')"
                :desabilitado="ocupado || !(escolhas[s.situacao] || s.estado)"
                :data-testid="`aprovar-${s.situacao}`"
                @acionar="aprovar(s.situacao, s.estado)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <ErroAdt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
