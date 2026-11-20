<script setup lang="ts">
// Desfecho do PA (ficha do M20, seção 7): `/pa/desfecho/:reg`. Alta, encaminhamento, internação, transferência e
// óbito só pelo médico com conselho ativo (o vínculo é o da sessão; Lei 12.842/2013); a evasão e o encerramento
// administrativo também pela equipe. O tempo da chegada ao desfecho sai das marcas do novo.
import { DESFECHOS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { lerAtendimento, novaChave, registrarDesfechoPa } from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { gravacao, pode, motivoPa } = usarAtendimento();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});
// O ato médico pelo servidor (a permissão e o vínculo do próprio médico com conselho ativo).
const medico = computed(() => gravacao.data.value?.atoMedico.pode ?? false);
const desfechos = computed(() =>
  DESFECHOS.filter((d) => medico.value || !d.atoMedico).map((d) => ({
    valor: d.codigo as string,
    rotulo: d.rotulo,
  })),
);
const desfecho = ref('');
const destino = ref('');
const exigeDestino = computed(
  () => desfecho.value === 'transferencia' || desfecho.value === 'encaminhamento',
);
const podeRegistrar = computed(
  () => pode('pa:atendimento.encerrarAtendimento').value && !ficha.data.value?.desfecho,
);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function registrar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await registrarDesfechoPa(
      reg.value,
      { desfecho: desfecho.value, ...(destino.value.trim() ? { destino: destino.value } : {}) },
      novaChave('desfecho-pa'),
    );
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
    await roteador.push('/pa/quadro');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="desfecho-titulo" data-testid="tela-desfecho-pa">
    <h1 id="desfecho-titulo">{{ t('atendimento.desfecho.titulo') }}</h1>
    <p>{{ t('atendimento.desfecho.texto') }}</p>
    <AvisoAtendimento :motivo="motivoPa" />
    <ErroAtendimento v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <ResumoAtendimento :atendimento="ficha.data.value" />
      <ul v-if="ficha.data.value.etapas.length" class="secundario">
        <li v-for="e in ficha.data.value.etapas" :key="`${e.etapa}-${e.em}`">
          {{ t(`atendimento.etapas.${e.etapa}`) }} · {{ e.em.slice(11, 16) }}
        </li>
      </ul>
      <section v-if="podeRegistrar" class="painel" aria-labelledby="desfecho-form">
        <h2 id="desfecho-form">{{ t('atendimento.encerrar.desfecho') }}</h2>
        <SanteAlerta v-if="!medico" variante="info" :texto="t('atendimento.encerrar.atoMedico')" />
        <SanteOpcoes v-model="desfecho" :legenda="t('atendimento.encerrar.desfecho')" :opcoes="desfechos" />
        <SanteCampoTexto
          v-if="exigeDestino"
          v-model="destino"
          :rotulo="t('atendimento.encerrar.destino')"
          :max-bytes="60"
          obrigatorio
        />
        <SanteBotao
          :rotulo="t('atendimento.desfecho.registrar')"
          :desabilitado="!desfecho || (exigeDestino && !destino.trim()) || ocupado"
          data-testid="botao-desfecho-pa"
          @acionar="registrar"
        />
      </section>
      <p v-else-if="ficha.data.value.desfecho">
        {{ t('atendimento.encerrar.jaEncerrado', { desfecho: ficha.data.value.desfecho.rotulo }) }}
      </p>
      <ErroAtendimento v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
