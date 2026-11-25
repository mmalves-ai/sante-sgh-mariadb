<script setup lang="ts">
// Avisos clínicos dentro da central de avisos (F3.5, 05-SADT linha 10): o que o prontuário e o laboratório avisam à
// pessoa (resultado retificado depois de visto, laudo retificado, achado crítico), com a mensagem inteira, o link para
// os exames do paciente e a ciência num clique. Nunca interrompe a tarefa (higiene de alertas: só o risco grave
// interrompe); o selo do sino soma os novos.
import { SanteBotao } from '@sgh/ui';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { AvisoClinico } from './api-avisos-clinicos.js';

defineProps<{ avisos: readonly AvisoClinico[]; podeCiencia: boolean; ocupado: number | null }>();
const emit = defineEmits<{ ciente: [id: number]; abrir: [] }>();
const { t } = useI18n();
const quando = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
</script>

<template>
  <section
    v-if="avisos.length"
    class="clinicos"
    aria-labelledby="avisos-clinicos-titulo"
    data-testid="avisos-clinicos"
  >
    <h3 id="avisos-clinicos-titulo" class="clinicos__titulo">{{ t('trabalho.avisos.clinicos.titulo') }}</h3>
    <ul class="clinicos__lista">
      <li
        v-for="a in avisos"
        :key="a.id"
        :class="[`g-${a.gravidade}`, `e-${a.estado}`]"
        :data-testid="`aviso-clinico-${a.id}`"
      >
        <p class="clinicos__linha">
          <strong>{{ t(`trabalho.avisos.gravidades.${a.gravidade}`) }}</strong>
          <span class="secundario">
            · {{ t(`trabalho.avisos.clinicos.estados.${a.estado}`) }} · {{ quando(a.geradoEm) }}</span
          >
        </p>
        <p class="clinicos__texto">{{ a.titulo }}</p>
        <p class="clinicos__mensagem" :data-testid="`aviso-clinico-mensagem-${a.id}`">{{ a.mensagem }}</p>
        <div class="clinicos__acoes">
          <RouterLink
            v-if="a.link"
            :to="a.link"
            :data-testid="`aviso-clinico-abrir-${a.id}`"
            @click="emit('abrir')"
            >{{ t('trabalho.avisos.clinicos.verPaciente') }}</RouterLink
          >
          <SanteBotao
            v-if="podeCiencia && a.estado !== 'ciente'"
            variante="texto"
            :rotulo="t('trabalho.avisos.clinicos.ciente')"
            :desabilitado="ocupado === a.id"
            :data-testid="`aviso-clinico-ciente-${a.id}`"
            @acionar="emit('ciente', a.id)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.clinicos {
  margin-bottom: var(--sgh-espaco-2);
}
.clinicos__titulo {
  margin: 0 0 var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
}
.clinicos__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.clinicos__lista li {
  border-left: 4px solid var(--sgh-borda);
  padding-left: var(--sgh-espaco-2);
}
.clinicos__lista li.g-atencao {
  border-left-color: var(--sgh-borda-forte);
}
.clinicos__lista li.e-ciente {
  opacity: 0.8;
}
.clinicos__linha,
.clinicos__texto,
.clinicos__mensagem {
  margin: 0;
}
.clinicos__mensagem {
  font-size: var(--sgh-fonte-pequena);
}
.clinicos__acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
