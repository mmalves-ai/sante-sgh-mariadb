<script setup lang="ts">
// Casca do portal do médico externo (M50, etapa 3): fora da casca interna e da sessão interna, sobre a sessão do portal
// de resultados do M26. Sem a sessão de médico externo, o convite para entrar pelo portal; com ela, o menu (resultados
// dos pedidos dele, extrato, agenda cirúrgica) e o sair. O servidor confere a sessão em cada pedido.
import type { SessaoPortal } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { euPortal, sairPortal } from '../../sadt/api-portal.js';

const props = defineProps<{ titulo: string }>();
const emit = defineEmits<{ sessao: [SessaoPortal] }>();
const { t } = useI18n();
const roteador = useRouter();
const sessao = ref<SessaoPortal | null>(null);
const pronto = ref(false);

onMounted(async () => {
  sessao.value = await euPortal().catch(() => null);
  if (sessao.value && sessao.value.perfil !== 'medicoExterno') sessao.value = null;
  pronto.value = true;
  if (sessao.value) emit('sessao', sessao.value);
});

async function sair(): Promise<void> {
  await sairPortal().catch(() => undefined);
  await roteador.replace({ name: 'portal.resultados' });
}

const menu = [
  { nome: 'portal.resultados', chave: 'resultados' },
  { nome: 'portal.medico.extrato', chave: 'extrato' },
  { nome: 'portal.medico.agenda', chave: 'agenda' },
  { nome: 'portal.medico.pacientes', chave: 'pacientes' },
  { nome: 'portal.medico.criticos', chave: 'criticos' },
  { nome: 'portal.medico.assinaturas', chave: 'assinaturas' },
  { nome: 'portal.medico.conta', chave: 'conta' },
] as const;
</script>

<template>
  <main class="portal-medico" aria-labelledby="portal-medico-titulo" data-testid="portal-medico-casca">
    <header class="portal-medico-topo">
      <p class="portal-medico-marca">{{ t('portalMedico.titulo') }}</p>
      <template v-if="sessao">
        <p data-testid="portal-medico-ola">{{ t('portalMedico.ola', { nome: sessao.nome }) }}</p>
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.sair')"
          data-testid="portal-medico-sair"
          @acionar="sair"
        />
      </template>
    </header>
    <nav v-if="sessao" class="portal-medico-menu" :aria-label="t('portalMedico.titulo')">
      <RouterLink
        v-for="m in menu"
        :key="m.nome"
        :to="{ name: m.nome }"
        :data-testid="`portal-medico-menu-${m.chave}`"
        >{{ t(`portalMedico.menu.${m.chave}`) }}</RouterLink
      >
    </nav>
    <h1 id="portal-medico-titulo">{{ props.titulo }}</h1>
    <slot v-if="sessao" :sessao="sessao" />
    <p v-else-if="!pronto" role="status">{{ t('portalMedico.carregando') }}</p>
    <p v-else data-testid="portal-medico-sem-sessao">
      {{ t('portalMedico.semSessao') }}
      <RouterLink :to="{ name: 'portal.resultados' }">{{ t('portalMedico.entrar') }}</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.portal-medico {
  margin: var(--sgh-espaco-4) auto;
  padding: var(--sgh-espaco-3);
  max-width: 64rem;
}
.portal-medico-topo,
.portal-medico-menu {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
.portal-medico-marca {
  font-weight: 600;
  margin-right: auto;
}
.portal-medico-menu {
  border-bottom: 1px solid var(--sgh-borda);
  padding-bottom: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-3);
}
</style>
