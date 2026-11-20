<script setup lang="ts">
// Situação da operadora própria no estabelecimento da sessão (M56, regra 1; POL-3): a chave do módulo e a de cada parte,
// com o que falta para valer (desligada, pré-requisito pendente, aguardando o módulo). Só leitura: quem liga é o
// administrador, em Funcionalidades por estabelecimento.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerSituacaoOperadora } from '../api-operadora.js';

const { t } = useI18n();
const q = useQuery({ queryKey: ['operadora', 'situacao'], queryFn: () => lerSituacaoOperadora() });
const modulo = computed(() => q.data.value?.modulo ?? null);
const linhas = computed(() => (q.data.value ? [q.data.value.modulo, ...q.data.value.fatias] : []));
const prereq = (p: readonly { descricao: string; situacao: string }[]) =>
  p.length === 0
    ? t('operadora.situacao.nenhum')
    : p
        .map(
          (x) =>
            `${x.descricao} (${x.situacao === 'pendente' ? t('operadora.situacao.pendente') : x.situacao})`,
        )
        .join('; ');
</script>

<template>
  <section class="bloco" aria-labelledby="ope-situacao-titulo" data-testid="operadora-situacao">
    <h2 id="ope-situacao-titulo">{{ t('operadora.situacao.titulo') }}</h2>
    <MensagemErro v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!modulo" role="status">{{ t('operadora.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="modulo.situacao !== 'ligada'"
        :texto="t('operadora.modulo.desligado')"
        variante="info"
        data-testid="operadora-modulo-desligado"
      />
      <table class="tabela" data-testid="operadora-chaves">
        <thead>
          <tr>
            <th scope="col">{{ t('operadora.situacao.fatia') }}</th>
            <th scope="col">{{ t('operadora.situacao.chave') }}</th>
            <th scope="col">{{ t('operadora.situacao.prerequisitos') }}</th>
            <th scope="col">{{ t('operadora.situacao.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in linhas" :key="l.chave" :data-testid="`operadora-chave-${l.chave}`">
            <th scope="row">{{ l.titulo }}</th>
            <td :data-situacao="l.situacao">{{ t(`operadora.situacoesChave.${l.situacao}`) }}</td>
            <td>{{ prereq(l.prerequisitos) }}</td>
            <td>{{ l.motivo ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
