<script setup lang="ts">
// Casca do portal do paciente (M50, etapa 1): fora da casca interna e da sessão interna. Carrega a sessão do portal
// (sem ela, volta à entrada), mostra de quem a sessão está vendo os dados e a troca de pessoa (só os titulares que o
// servidor devolve: o próprio e os representados com vínculo vigente), o menu do portal e o sair.
import type { SessaoContaPortal } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { escolherTitular, euPortalPaciente, sairPortalPaciente } from '../api-portal-paciente.js';

const props = defineProps<{ titulo: string }>();
const emit = defineEmits<{ sessao: [SessaoContaPortal]; trocou: [SessaoContaPortal] }>();
const { t } = useI18n();
const roteador = useRouter();
const sessao = ref<SessaoContaPortal | null>(null);
const pessoa = ref<string>('');

onMounted(async () => {
  try {
    sessao.value = await euPortalPaciente();
    pessoa.value = sessao.value.ativo.vinculo ?? '';
    emit('sessao', sessao.value);
  } catch {
    await roteador.replace({ name: 'portal.paciente', query: { expirou: '1' } });
  }
});

const opcoes = computed(() =>
  (sessao.value?.titulares ?? []).map((x) => ({
    valor: x.vinculo ?? '',
    rotulo: x.vinculo === null ? `${x.primeiroNome} (${t('portal.eu')})` : x.primeiroNome,
  })),
);

async function trocar(v: string): Promise<void> {
  pessoa.value = v;
  sessao.value = await escolherTitular(v === '' ? null : v);
  emit('trocou', sessao.value);
}

async function sair(): Promise<void> {
  await sairPortalPaciente().catch(() => undefined);
  await roteador.replace({ name: 'portal.paciente' });
}

const menu = [
  { nome: 'portal.paciente', chave: 'inicio' },
  { nome: 'portal.agendar', chave: 'agendar' },
  { nome: 'portal.teleconsultas', chave: 'teleconsulta' },
  { nome: 'portal.pagamentos', chave: 'pagamentos' },
  { nome: 'portal.documentos', chave: 'documentos' },
  { nome: 'portal.responsaveis', chave: 'responsaveis' },
  { nome: 'portal.privacidade', chave: 'privacidade' },
  { nome: 'portal.ouvidoria', chave: 'ouvidoria' },
  { nome: 'portal.copia', chave: 'copia' },
  { nome: 'portal.seguranca', chave: 'seguranca' },
] as const;
</script>

<template>
  <main class="portal-paciente" :aria-labelledby="'portal-' + props.titulo" data-testid="portal-casca">
    <header class="portal-topo">
      <p class="portal-marca">{{ t('portal.titulo') }}</p>
      <template v-if="sessao">
        <p data-testid="portal-ola">{{ t('portal.ola', { nome: sessao.primeiroNome }) }}</p>
        <SanteSelecao
          v-if="opcoes.length > 1"
          :model-value="pessoa"
          :rotulo="t('portal.trocarPessoa')"
          :opcoes="opcoes"
          data-testid="portal-pessoa"
          @update:model-value="trocar"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portal.sair')"
          data-testid="portal-sair"
          @acionar="sair"
        />
      </template>
    </header>
    <nav v-if="sessao" class="portal-menu" :aria-label="t('portal.titulo')">
      <RouterLink
        v-for="m in menu"
        :key="m.nome"
        :to="{ name: m.nome }"
        :data-testid="`portal-menu-${m.chave}`"
        >{{ t(`portal.menu.${m.chave}`) }}</RouterLink
      >
    </nav>
    <h1 :id="'portal-' + props.titulo">{{ props.titulo }}</h1>
    <p v-if="sessao && sessao.ativo.vinculo !== null" class="portal-vendo" data-testid="portal-vendo">
      {{ t('portal.vendoDe', { nome: sessao.ativo.primeiroNome }) }}
    </p>
    <slot v-if="sessao" :sessao="sessao" />
    <p v-else role="status">{{ t('portal.carregando') }}</p>
  </main>
</template>

<style src="./estilo-portal.css"></style>
