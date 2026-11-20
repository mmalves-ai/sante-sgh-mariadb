<script setup lang="ts">
// Atalho para os painéis de saúde (M09, ficha campo 7): os painéis vivem no Grafana do projeto
// (127.0.0.1:3330), provisionados por arquivo; a tela só aponta para eles. Endereço por parâmetro
// (VITE_GRAFANA_URL), padrão o Grafana local do Compose.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AbasSaude from '../../implantacao/componentes/AbasSaude.vue';

const props = defineProps<{ painel: 'banco' | 'sistema' }>();
const { t } = useI18n();
const base = (import.meta.env['VITE_GRAFANA_URL'] as string | undefined) ?? 'http://127.0.0.1:3330';
const paineis = computed(() =>
  props.painel === 'banco'
    ? [{ uid: 'sgh-banco', rotulo: t('config.saude.painelBanco') }]
    : [
        { uid: 'sgh-tecnico', rotulo: t('config.saude.painelTecnico') },
        { uid: 'sgh-jornadas', rotulo: t('config.saude.painelJornadas') },
      ],
);
</script>

<template>
  <section aria-labelledby="titulo-saude">
    <h1 id="titulo-saude">
      {{ props.painel === 'banco' ? t('config.saude.tituloBanco') : t('config.saude.tituloSistema') }}
    </h1>
    <!-- M60 (etapa 2): a conferência da instalação é a outra aba da saúde do sistema. -->
    <AbasSaude v-if="props.painel === 'sistema'" atual="paineis" />
    <p>{{ props.painel === 'banco' ? t('config.saude.textoBanco') : t('config.saude.textoSistema') }}</p>
    <ul>
      <li v-for="p in paineis" :key="p.uid">
        <a :href="`${base}/d/${p.uid}`" target="_blank" rel="noopener noreferrer">{{ p.rotulo }}</a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* WCAG 2.2 (2.5.8, axe target-size): os atalhos dos painéis, um por linha, com alvo de pelo menos 24 px. */
li > a {
  display: inline-block;
  min-block-size: 24px;
  padding-block: var(--sgh-espaco-1);
}
</style>
