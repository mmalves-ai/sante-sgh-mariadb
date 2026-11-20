<script setup lang="ts">
// Bloqueio clínico da visita (M50, etapa 5; regra 9; `hotelaria.visita.bloquearClinico`): a enfermagem ou o médico
// bloqueia ou limita a visita a um paciente por decisão clínica (repouso, procedimento, piora), com a justificativa,
// também para o acompanhante quando a condição exige, e revoga quando a condição acaba. A portaria vê só a mensagem
// genérica ("visita não liberada"); o motivo clínico nunca aparece lá.
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { bloquearClinico, lerBloqueiosClinicos, revogarClinico } from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const unidade = ref('');
const painel = useQuery({
  queryKey: computed(() => ['portaria', 'clinico', unidade.value]),
  queryFn: () => lerBloqueiosClinicos(unidade.value || null),
});
const p = computed(() => painel.data.value);
const pode = computed(() => p.value?.gravacao.operacoes['bloquearClinico']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const form = ref({
  internacao: null as number | null,
  abrangencia: 'todos' as 'todos' | 'limite',
  limite: '1',
  incluiAcompanhante: false,
  justificativa: '',
  fim: '',
});
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(p.value?.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
]);
const opcoesPaciente = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.internados ?? []).map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome}`,
  })),
]);
const opcoesAbrangencia = computed(() => [
  { valor: 'todos' as const, rotulo: t('portaria.abrangencias.todos') },
  { valor: 'limite' as const, rotulo: t('portaria.abrangencias.limite') },
]);
async function bloquear(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await bloquearClinico({
        internacao: form.value.internacao,
        motivo: 'clinico',
        abrangencia: form.value.abrangencia,
        limite: form.value.abrangencia === 'limite' ? Number(form.value.limite) : null,
        incluiAcompanhante: form.value.incluiAcompanhante,
        justificativa: form.value.justificativa,
        fim: form.value.fim || null,
      })
    ).mensagem;
    form.value.justificativa = '';
    await cliente.invalidateQueries({ queryKey: ['portaria', 'clinico'] });
  } catch (x) {
    erro.value = x;
  }
}
const revogando = ref<number | null>(null);
const motivo = ref('');
const dialogo = computed({
  get: () => revogando.value !== null,
  set: (v: boolean) => {
    if (!v) revogando.value = null;
  },
});
async function revogar(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await revogarClinico(revogando.value!, motivo.value)).mensagem;
    revogando.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['portaria', 'clinico'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="bc-titulo" data-testid="tela-bloqueio-clinico">
    <h1 id="bc-titulo">{{ t('portaria.clinico.titulo') }}</h1>
    <p>{{ t('portaria.clinico.subtitulo') }}</p>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        v-if="!p.gravacao.ligada"
        variante="info"
        :texto="p.gravacao.motivo ?? t('portaria.desligada')"
      />
      <p v-if="mensagem" role="status" data-testid="bc-mensagem">{{ mensagem }}</p>
      <ErroPortaria v-if="erro" :erro="erro" />
      <form class="cartao registro" @submit.prevent="bloquear">
        <div class="campos">
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('portaria.regras.unidade')"
            :opcoes="opcoesUnidade"
            data-testid="bc-unidade"
          />
          <SanteSelecao
            v-model="form.internacao"
            :rotulo="t('portaria.bloqueios.paciente')"
            :opcoes="opcoesPaciente"
            data-testid="bc-paciente"
          />
          <SanteSelecao
            v-model="form.abrangencia"
            :rotulo="t('portaria.bloqueios.abrangencia')"
            :opcoes="opcoesAbrangencia"
          />
          <span v-if="form.abrangencia === 'limite'" class="campo">
            <label for="bc-limite">{{ t('portaria.bloqueios.limite') }}</label>
            <input id="bc-limite" v-model="form.limite" type="number" min="1" max="10" />
          </span>
          <span class="campo">
            <label for="bc-fim">{{ t('portaria.bloqueios.fim') }}</label>
            <input id="bc-fim" v-model="form.fim" type="date" />
          </span>
        </div>
        <label class="barra">
          <input v-model="form.incluiAcompanhante" type="checkbox" />
          {{ t('portaria.bloqueios.incluiAcompanhante') }}
        </label>
        <span class="campo">
          <label for="bc-just">{{ t('portaria.bloqueios.justificativa') }}</label>
          <input id="bc-just" v-model="form.justificativa" maxlength="200" data-testid="bc-justificativa" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portaria.bloqueios.bloquear')"
          :desabilitado="!pode || form.internacao === null || form.justificativa.trim().length < 10"
          data-testid="bc-bloquear"
        />
      </form>
      <p v-if="p.bloqueios.length === 0">{{ t('portaria.bloqueios.nenhum') }}</p>
      <ul v-else class="lista" data-testid="bc-bloqueios">
        <li v-for="b in p.bloqueios" :key="b.id">
          {{ b.paciente }} · {{ b.unidade }} · {{ t(`portaria.abrangencias.${b.abrangencia}`) }}
          <span class="secundario"> · {{ b.justificativa }} · {{ hora(b.inicio) }}</span>
          <SanteBotao
            variante="texto"
            :rotulo="t('portaria.bloqueios.revogar')"
            :desabilitado="!pode"
            @acionar="revogando = b.id"
          />
        </li>
      </ul>
    </template>
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('portaria.bloqueios.revogar')">
      <div class="campo">
        <label for="bc-motivo">{{ t('portaria.bloqueios.motivoRevogacao') }}</label>
        <input id="bc-motivo" v-model="motivo" maxlength="200" />
        <SanteBotao
          :rotulo="t('portaria.confirmar')"
          :desabilitado="motivo.trim().length < 10"
          @acionar="revogar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
