<script setup lang="ts">
// W0-05 (revisão): o cartão de perfil das fichas da nutrição e das especialidades (o paciente na ficha EMTN e na
// oncologia; o catálogo nos protocolos), no padrão da ficha de Usuários e Acessos: as iniciais, o título (o h1 da tela),
// os identificadores, as pílulas da situação e as ações (Imprimir), que a impressão esconde.
import { computed } from 'vue';

const props = defineProps<{
  titulo: string;
  /** O id do h1 (a tela-mãe usa no aria-labelledby). */
  idTitulo: string;
  /** Os identificadores em texto (prontuário, nascimento, leito, admissão). */
  linhas?: readonly string[];
  /** As iniciais do avatar; sem elas, as do título. */
  iniciais?: string;
}>();
const avatar = computed(
  () =>
    props.iniciais ??
    props.titulo
      .split(/\s+/)
      .filter((p) => p.length > 2)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
);
</script>

<template>
  <header class="perfil">
    <span class="perfil__avatar" aria-hidden="true">{{ avatar }}</span>
    <div class="perfil__textos">
      <h1 :id="idTitulo" class="perfil__nome">{{ titulo }}</h1>
      <p v-for="l in linhas ?? []" :key="l" class="perfil__linha">{{ l }}</p>
      <div class="perfil__pilulas"><slot name="pilulas" /></div>
    </div>
    <div class="perfil__acoes nao-imprimir"><slot name="acoes" /></div>
  </header>
</template>

<style scoped>
.perfil {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--sgh-espaco-3);
  align-items: center;
  padding: var(--sgh-espaco-3) var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  border-top: 4px solid var(--sgh-primaria);
  margin-block: var(--sgh-espaco-2);
}
.perfil__avatar {
  display: inline-grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 700;
  font-size: 1.2rem;
}
.perfil__textos {
  display: grid;
  gap: var(--sgh-espaco-1);
  min-width: 0;
}
.perfil__nome {
  margin: 0;
  font-size: 1.4rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.perfil__linha {
  margin: 0;
  color: var(--sgh-texto-secundario);
  overflow-wrap: anywhere;
}
.perfil__pilulas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.perfil__pilulas:empty {
  display: none;
}
.perfil__acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
@media (max-width: 40rem) {
  .perfil {
    grid-template-columns: auto 1fr;
  }
  .perfil__acoes {
    grid-column: 1 / -1;
  }
}
@media print {
  .perfil {
    border-top-width: 1px;
  }
}
</style>
