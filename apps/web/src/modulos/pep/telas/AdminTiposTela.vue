<script setup lang="ts">
// Tipos de documento, fluxos de situação e avisos (ficha do M22, seção 7): os cadastros do PEP pelo CRUD genérico
// (M08). Esta tela é o índice do item da árvore (o mesmo índice do cadastro genérico, filtrado pelo grupo do PEP):
// cada cadastro abre a tela gerada da declaração, com as mesmas permissões e a trilha. Corretor: os 17 cadastros
// ainda não estão declarados (pendência do M22, D-CRUD-1): a tela diz isso, em vez de um índice vazio.
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela" aria-labelledby="adm-tipos-titulo" data-testid="tela-admin-tipos">
    <h1 id="adm-tipos-titulo">{{ t('pep.reg.admin.tipos.titulo') }}</h1>
    <p>{{ t('pep.reg.admin.tipos.texto') }}</p>
    <SanteAlerta variante="info" :texto="t('pep.reg.admin.tipos.pendente')" data-testid="tipos-pendentes" />
    <DominiosIndiceTela subitem="pepAdmin" embutido />
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 60rem;
}
</style>
