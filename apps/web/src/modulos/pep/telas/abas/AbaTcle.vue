<script setup lang="ts">
// Termos de consentimento (só do novo): emitir, marcar assinado e revogar com motivo (nova versão; nada se apaga).
// O valor herdado do atendimento só aparece, com a legenda "a confirmar".
import type { TclePep } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { emitirTcle, lerTcle, mudarTcle } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import SeletorAtendimento from '../../componentes/documentos/SeletorAtendimento.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'tcle', props.paciente]),
  queryFn: () => lerTcle(props.paciente),
});
const atendimento = ref<number | null>(null);
const tipoTermo = ref<number | null>(null);
const procedimento = ref('');
const opcoesTipo = computed<{ valor: number | null; rotulo: string }[]>(() => [
  { valor: null, rotulo: '-' },
  ...(dados.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const texto = ref('');
const motivo = ref('');
const erro = ref<unknown>(null);
async function atualizar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
}
async function emitir(): Promise<void> {
  erro.value = null;
  if (atendimento.value === null) return;
  try {
    await emitirTcle(props.paciente, {
      atendimento: atendimento.value,
      procedimento: procedimento.value.trim(),
      texto: texto.value.trim(),
      ...(tipoTermo.value !== null ? { tipo: tipoTermo.value } : {}),
    });
    procedimento.value = '';
    texto.value = '';
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
async function mudar(x: TclePep, situacao: 'assinado' | 'revogado'): Promise<void> {
  erro.value = null;
  try {
    await mudarTcle(props.paciente, x.id, situacao, situacao === 'revogado' ? motivo.value : undefined);
    motivo.value = '';
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="tcle-titulo" data-testid="aba-tcle-conteudo">
    <h2 id="tcle-titulo">{{ t('pep.doc.tcle.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="dados.data.value.herdado"
        variante="info"
        :texto="
          t('pep.doc.tcle.herdado', {
            valor: dados.data.value.herdado.valor ?? '-',
            legenda: dados.data.value.herdado.legenda,
          })
        "
      />
      <p v-if="dados.data.value.termos.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <ul class="lista">
        <li v-for="x in dados.data.value.termos" :key="x.id" class="cartao" :data-testid="`tcle-${x.id}`">
          <p>
            <strong>{{ x.procedimento }}</strong
            ><span v-if="x.tipo"> · {{ x.tipo }}</span> ·
            <span class="marcador">{{ t(`pep.doc.tcle.situacao.${x.situacao}`) }}</span>
          </p>
          <p>
            {{ dataHoraBr(x.em) }} · {{ x.usuario }}<span v-if="x.motivo"> · {{ x.motivo }}</span>
          </p>
          <div v-if="dados.data.value.emitir.pode && x.situacao !== 'revogado'" class="linha">
            <SanteBotao
              v-if="x.situacao === 'pendente'"
              variante="secundario"
              :rotulo="t('pep.doc.tcle.assinado')"
              @acionar="mudar(x, 'assinado')"
            />
            <label class="campo"
              ><span>{{ t('pep.doc.motivo') }}</span
              ><input v-model="motivo" maxlength="500"
            /></label>
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('pep.doc.tcle.revogar')"
              :confirmacao="t('pep.doc.tcle.revogarPergunta', { procedimento: x.procedimento })"
              @acionar="mudar(x, 'revogado')"
            />
          </div>
        </li>
      </ul>
      <AvisoConsulta :acao="dados.data.value.emitir" />
      <form v-if="dados.data.value.emitir.pode" class="form" @submit.prevent="emitir">
        <h3>{{ t('pep.doc.tcle.novo') }}</h3>
        <SeletorAtendimento v-model="atendimento" :atendimentos="dados.data.value.atendimentos" />
        <SanteSelecao
          v-model="tipoTermo"
          class="campo"
          :rotulo="t('pep.doc.tcle.tipo')"
          :opcoes="opcoesTipo"
        />
        <label
          ><span>{{ t('pep.doc.tcle.procedimento') }}</span
          ><input v-model="procedimento" maxlength="200" required
        /></label>
        <label
          ><span>{{ t('pep.doc.tcle.texto') }}</span
          ><textarea v-model="texto" rows="5" maxlength="4000" required />
        </label>
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.tcle.emitir')" />
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
