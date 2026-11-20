<script setup lang="ts">
// OIDs, tipos de certificado e formas de assinatura (M49, etapa 3; item `Administração > Assinatura digital > OIDs,
// tipos de certificado e formas de assinatura`; `documento.cadastro.ler` / `.editar`): o CRUD genérico do M08 dos sete
// cadastros (OIDs ICP-Brasil e tipos de OID, tipos de certificado; formas de assinatura SafeWeb e Vidaas, situações da
// autorização e tipos de atendimento dos provedores em nuvem) e, em consulta, as formas de assinatura ICP-Brasil (AD-RB e
// AD-RT). As gravações vão pela receita genérica (uma assinatura por declaração); as ações aparecem só com a permissão
// de cada cadastro e o servidor confere de novo.
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const { t } = useI18n();
</script>

<template>
  <section class="tela-assinatura" aria-labelledby="cad-assin-titulo" data-testid="tela-cadastros-assinatura">
    <h1 id="cad-assin-titulo">{{ t('assinatura.cadastros.titulo') }}</h1>
    <p>{{ t('assinatura.cadastros.subtitulo') }}</p>
    <p class="secundario">{{ t('assinatura.cadastros.ajuda') }}</p>
    <nav :aria-label="t('assinatura.cadastros.links')">
      <RouterLink to="/administracao/assinatura/politica" data-testid="cad-assin-politica">{{
        t('assinatura.cadastros.politica')
      }}</RouterLink>
      ·
      <RouterLink to="/administracao/assinatura/provedores" data-testid="cad-assin-provedores">{{
        t('assinatura.cadastros.provedores')
      }}</RouterLink>
    </nav>
    <GrupoDominiosTela subitem="assinaturaCadastros" embutida />
  </section>
</template>

<style scoped src="../estilo-assinatura.css"></style>
