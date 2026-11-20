<script setup lang="ts">
// Conflitos de sincronização (ficha do M25, seção 7 e regra 8): o ato que chegou depois de uma suspensão ou de uma
// checagem feita em outro terminal (neste ou no outro sistema) nunca sobrescreve; fica aqui, visível, até o enfermeiro
// resolver (descartar, registrar como anotação ou avisar a farmácia para a devolução da dose).
import { RESOLUCOES_CONFLITO, SITUACOES_CHECAGEM, type ConflitoSincronizacao } from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerConflitos, novaChave, resolverConflito } from '../api-enfermagem.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import { usarAvisosEnfermagem, usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const { pode } = usarEnfermagem();
const podeResolver = pode('conflito');
const abertos = ref(true);
const lista = useQuery({
  queryKey: computed(() => ['enfermagem', 'conflitos', abertos.value]),
  queryFn: () => lerConflitos(abertos.value),
});
usarAvisosEnfermagem(() => void lista.refetch());
const escolhido = ref<ConflitoSincronizacao | null>(null);
const aberto = ref(false);
const resolucao = ref<string>('descartado');
const observacao = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoes = computed(() =>
  Object.entries(RESOLUCOES_CONFLITO).map(([valor, rotulo]) => ({ valor, rotulo })),
);
function abrir(k: ConflitoSincronizacao): void {
  escolhido.value = k;
  observacao.value = '';
  erro.value = null;
  aberto.value = true;
}
async function resolver(): Promise<void> {
  if (!escolhido.value) return;
  erro.value = null;
  try {
    const r = await resolverConflito(
      escolhido.value.id,
      resolucao.value,
      observacao.value.trim(),
      novaChave('conflito'),
    );
    mensagem.value = r.mensagem;
    aberto.value = false;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
const sit = (c: string) => (SITUACOES_CHECAGEM as Record<string, string>)[c] ?? c;
const hora = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
</script>

<template>
  <section class="tela-enf" aria-labelledby="conf-titulo" data-testid="tela-conflitos">
    <h1 id="conf-titulo">{{ t('enfermagem.conflitos.titulo') }}</h1>
    <p>{{ t('enfermagem.conflitos.texto') }}</p>
    <label class="linha">
      <input v-model="abertos" type="checkbox" data-testid="conf-abertos" />
      {{ t('enfermagem.conflitos.abertos') }}
    </label>
    <p v-if="mensagem" role="status" data-testid="conf-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0" data-testid="conf-vazio">
      {{ t('enfermagem.conflitos.vazio') }}
    </p>
    <div v-else class="rolagem">
      <table class="grade">
        <thead>
          <tr>
            <th scope="col">{{ t('enfermagem.comum.paciente') }}</th>
            <th scope="col">{{ t('enfermagem.conflitos.tipo') }}</th>
            <th scope="col">{{ t('enfermagem.conflitos.tentado') }}</th>
            <th scope="col">{{ t('enfermagem.conflitos.quando') }}</th>
            <th scope="col">{{ t('enfermagem.conflitos.quem') }}</th>
            <th scope="col">{{ t('enfermagem.conflitos.resolucao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in lista.data.value" :key="k.id" :data-testid="`conflito-${k.id}`">
            <td>{{ k.pacienteNome ?? k.paciente }}</td>
            <td>{{ t(`enfermagem.conflitos.tipos.${k.tipo}`) }} ({{ sit(k.situacaoEncontrada) }})</td>
            <td>
              {{
                k.desfechoTentado === 'administrado'
                  ? t('enfermagem.checagem.administrado')
                  : t('enfermagem.checagem.naoAdministrado')
              }}
            </td>
            <td>{{ hora(k.horaReal) }}</td>
            <td>{{ k.usuario }}</td>
            <td>
              <span v-if="k.resolucao">
                {{ RESOLUCOES_CONFLITO[k.resolucao] }} ·
                {{
                  t('enfermagem.conflitos.resolvido', {
                    por: k.resolvidoPor ?? '',
                    quando: hora(k.resolvidoEm),
                  })
                }}
              </span>
              <SanteBotao
                v-else
                :rotulo="t('enfermagem.conflitos.resolver')"
                :desabilitado="!podeResolver"
                :data-testid="`conf-resolver-${k.id}`"
                @acionar="abrir(k)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <SanteDialogo v-model:visivel="aberto" :titulo="t('enfermagem.conflitos.resolver')">
      <div class="campo">
        <SanteSelecao
          v-model="resolucao"
          :rotulo="t('enfermagem.conflitos.resolucao')"
          :opcoes="opcoes"
          data-testid="conf-resolucao"
        />
        <label for="conf-obs">{{ t('enfermagem.comum.observacao') }}</label>
        <input id="conf-obs" v-model="observacao" maxlength="200" data-testid="conf-observacao" />
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.comum.confirmar')"
          :desabilitado="observacao.trim().length < 5"
          data-testid="conf-confirmar"
          @acionar="resolver"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
