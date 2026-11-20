<script setup lang="ts">
// Casca do portal do prestador credenciado (M56, etapa 8, F7): fora da casca e da sessão interna. Sem a sessão do
// portal, o convite para entrar; com ela, o menu só com as funções liberadas (pedidos de autorização, consulta de
// protocolo), a hora em que a sessão expira e o sair. O servidor confere a sessão e as funções em cada pedido.
import { FUNCAO_PORTAL, type SessaoPortalPrestador } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { sairPortalPrestador, sessaoPortalPrestador } from '../api-portal-prestador.js';

const props = defineProps<{ titulo: string }>();
const emit = defineEmits<{ sessao: [SessaoPortalPrestador] }>();
const { t } = useI18n();
const roteador = useRouter();
const sessao = ref<SessaoPortalPrestador | null>(null);
const pronto = ref(false);

onMounted(async () => {
  sessao.value = await sessaoPortalPrestador().catch(() => null);
  pronto.value = true;
  if (sessao.value) emit('sessao', sessao.value);
});

async function sair(): Promise<void> {
  await sairPortalPrestador().catch(() => undefined);
  sessao.value = null;
  await roteador.replace({ name: 'portal.prestador.entrar' });
}

const menu = computed(() => {
  const f = sessao.value?.funcoes ?? [];
  return [
    ...(f.includes(FUNCAO_PORTAL.consultar) || f.includes(FUNCAO_PORTAL.solicitar)
      ? [
          { nome: 'portal.prestador.pedidos', chave: 'pedidos' },
          // W0-10 (M7): a elegibilidade é de quem pede ou consulta autorização.
          { nome: 'portal.prestador.elegibilidade', chave: 'elegibilidade' },
        ]
      : []),
    ...(f.includes(FUNCAO_PORTAL.protocolo)
      ? [{ nome: 'portal.prestador.protocolo', chave: 'protocolo' }]
      : []),
    // W0-10 (M8): os lotes de contas valem para qualquer conta ativa (D-W0-10-LOTE-PORTAL); o servidor confere.
    { nome: 'portal.prestador.contas', chave: 'contas' },
    // W0-10: a própria conta (senha e autenticador) vale para qualquer função liberada.
    { nome: 'portal.prestador.conta', chave: 'conta' },
  ];
});
const expira = computed(() => {
  const e = sessao.value?.expiraEm;
  if (!e) return '';
  const d = new Date(e);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});
</script>

<template>
  <main
    class="portal-prestador"
    aria-labelledby="portal-prestador-titulo"
    data-testid="portal-prestador-casca"
  >
    <header class="portal-prestador-topo">
      <p class="portal-prestador-marca">{{ t('portalPrestador.titulo') }}</p>
      <template v-if="sessao">
        <p data-testid="portal-prestador-ola">
          {{ t('portalPrestador.ola', { nome: sessao.nome, prestador: sessao.prestadorNome }) }}
        </p>
        <p class="secundario">{{ t('portalPrestador.expira', { hora: expira }) }}</p>
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalPrestador.sair')"
          data-testid="portal-prestador-sair"
          @acionar="sair"
        />
      </template>
    </header>
    <nav v-if="sessao" class="portal-prestador-menu" :aria-label="t('portalPrestador.titulo')">
      <RouterLink
        v-for="m in menu"
        :key="m.nome"
        :to="{ name: m.nome }"
        :data-testid="`portal-prestador-menu-${m.chave}`"
        >{{ t(`portalPrestador.menu.${m.chave}`) }}</RouterLink
      >
    </nav>
    <h1 id="portal-prestador-titulo">{{ props.titulo }}</h1>
    <slot v-if="sessao" :sessao="sessao" />
    <p v-else-if="!pronto" role="status">{{ t('portalPrestador.carregando') }}</p>
    <p v-else data-testid="portal-prestador-sem-sessao">
      {{ t('portalPrestador.semSessao') }}
      <RouterLink :to="{ name: 'portal.prestador.entrar' }">{{
        t('portalPrestador.entrar.titulo')
      }}</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.portal-prestador {
  margin: var(--sgh-espaco-4) auto;
  padding: var(--sgh-espaco-3);
  max-width: 72rem;
}
.portal-prestador-topo,
.portal-prestador-menu {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
.portal-prestador-menu a {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
}
.portal-prestador-marca {
  font-weight: 600;
  margin-right: auto;
}
.portal-prestador-menu {
  border-bottom: 1px solid var(--sgh-borda);
  padding-bottom: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-3);
}
.secundario {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
}
</style>
