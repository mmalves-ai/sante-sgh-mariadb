<script setup lang="ts">
// Portal do prestador credenciado, lado da operadora (M56, etapa 8, F7; item `Faturamento > Operadora própria > Portal
// do prestador credenciado`): as contas do portal (AcessosPortal, só a quem lê a rede: `operadora.prestador.ler`; o
// credenciamento edita com `.editar`) e os domínios do item (funções do portal e tipos de atendimento; CRUD genérico
// do grupo `operadora`). C2-074: a fila dos pedidos web do prestador, os avisos à rede e as regras de documento. A rota pede `operadora.dominio.ler` (todo perfil da operadora), como as demais do módulo.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import AcessosPortal from '../componentes/f7/AcessosPortal.vue';
import PedidosAvisosPortal from '../componentes/f7/PedidosAvisosPortal.vue';

const { t } = useI18n();
const ITEM = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.portal-do-prestador-credenciado';
const leContas = computed(() => podeNaSessao('operadora.prestador.ler'));
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-portal-titulo" data-testid="tela-operadora-portal">
    <h1 id="ope-portal-titulo">{{ t('operadoraAtendimento.portal.titulo') }}</h1>
    <AcessosPortal v-if="leContas" />
    <!-- C2-074: a fila dos pedidos web, os avisos à rede e os documentos exigidos (mesma permissão da rede). -->
    <PedidosAvisosPortal v-if="leContas" />
    <p v-else class="secundario" data-testid="portal-sem-contas">
      {{ t('operadoraAtendimento.portal.semContas') }}
    </p>
    <GrupoDominiosTela subitem="operadoraPortal" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="operadora-outras-tabelas">{{
        t('operadora.telas.ans.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
