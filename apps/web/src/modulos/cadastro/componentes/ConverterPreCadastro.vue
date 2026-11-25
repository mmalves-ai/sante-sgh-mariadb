<script setup lang="ts">
// 02-AGE 42: conversão do pré-cadastro ali mesmo (painel do dia e chegada no guichê), sem mandar a recepção à tela de
// pré-cadastros. Abre já com a prévia: com o paciente do mesmo CPF, um clique liga; sem ele, a busca mostra nome e
// nascimento, a escolha confere as divergências antes de ligar (divergente só com motivo) e quem é novo vai à ficha
// preenchida com o pré-cadastro. A gravação é a mesma operação da tela de pré-cadastros (cadastro.converterPreCadastro:
// as marcações passam ao paciente na mesma transação); nada é apagado.
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPacientes } from '../api-cadastro.js';
import { converterPreCadastro, type PreviaConversao, previaConversao } from '../api-vinculos.js';

const props = defineProps<{ preCadastro: number }>();
const emit = defineEmits<{ convertido: [r: { paciente: number; marcacoes: number }]; fechar: [] }>();
const { t } = useI18n();
type Achado = Awaited<ReturnType<typeof buscarPacientes>>['itens'][number];
const previa = ref<PreviaConversao | null>(null);
const erro = ref<unknown>(null);
const termo = ref('');
const achados = ref<Achado[] | null>(null);
const escolhido = ref<Achado | null>(null);
const motivo = ref('');
const gravando = ref(false);

async function carregar(paciente?: number): Promise<void> {
  erro.value = null;
  try {
    previa.value = await previaConversao(props.preCadastro, paciente);
  } catch (e) {
    erro.value = e;
  }
}
async function buscar(): Promise<void> {
  erro.value = null;
  try {
    achados.value = (await buscarPacientes(termo.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}
async function escolher(p: Achado): Promise<void> {
  escolhido.value = p;
  await carregar(p.id);
}
async function converter(paciente?: number): Promise<void> {
  erro.value = null;
  gravando.value = true;
  try {
    const r = await converterPreCadastro(props.preCadastro, paciente, motivo.value.trim() || undefined);
    emit('convertido', { paciente: r.paciente, marcacoes: r.marcacoes });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
void carregar();
</script>

<template>
  <section
    class="converter-pre"
    :aria-label="t('vinculos.pre.converterAqui')"
    :data-testid="`converter-pre-${preCadastro}`"
  >
    <h3>{{ t('vinculos.pre.converterAqui') }}</h3>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!previa && !erro" role="status">{{ t('vinculos.pre.carregandoPrevia') }}</p>
    <template v-else-if="previa?.acao === 'vincular'">
      <p>{{ t('vinculos.pre.jaCadastrado', { paciente: previa.paciente }) }}</p>
      <SanteBotao
        :rotulo="t('vinculos.pre.ligar')"
        :desabilitado="gravando"
        data-testid="converter-ligar"
        @acionar="converter()"
      />
    </template>
    <template v-else-if="previa">
      <p v-if="previa.mensagem" role="alert">{{ previa.mensagem }}</p>
      <p v-else>{{ t('vinculos.pre.semCpf') }}</p>
      <RouterLink
        :to="{ path: '/cadastros/pacientes/novo', query: { preCadastro: String(preCadastro) } }"
        data-testid="converter-cadastrar"
        >{{ t('vinculos.pre.cadastrar') }}</RouterLink
      >
      <form class="busca" data-testid="converter-busca" @submit.prevent="buscar">
        <label
          >{{ t('vinculos.pre.buscaPaciente') }}
          <input
            v-model="termo"
            name="termoPaciente"
            minlength="2"
            maxlength="60"
            required
            data-testid="converter-termo"
        /></label>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('vinculos.pre.buscarPaciente')" />
      </form>
      <ul v-if="achados" data-testid="converter-achados">
        <li v-for="p in achados" :key="p.id">
          {{ p.nome }} · {{ p.nascimento ?? '—' }} · {{ p.cpfMascarado ?? '—' }}
          <SanteBotao
            variante="texto"
            :rotulo="t('vinculos.pre.escolher')"
            :data-testid="`converter-escolher-${p.id}`"
            @acionar="escolher(p)"
          />
        </li>
        <li v-if="achados.length === 0">{{ t('vinculos.pre.nenhumPaciente') }}</li>
      </ul>
      <template v-if="escolhido">
        <p>
          {{ t('vinculos.pre.escolhido', { nome: escolhido.nome, nascimento: escolhido.nascimento ?? '—' }) }}
        </p>
        <p v-if="previa.divergencias.length" role="alert">
          {{ t('vinculos.pre.divergencias', { itens: previa.divergencias.join(', ') }) }}
        </p>
        <label v-if="previa.divergencias.length"
          >{{ t('vinculos.pre.motivoDivergencia') }}
          <input v-model="motivo" name="motivoDivergencia" maxlength="400" data-testid="converter-motivo"
        /></label>
        <SanteBotao
          :rotulo="t('vinculos.pre.ligarEscolhido')"
          :desabilitado="
            gravando ||
            previa.codigo === 'cpf-de-outro-paciente' ||
            (previa.divergencias.length > 0 && motivo.trim().length < 10)
          "
          data-testid="converter-ligar-escolhido"
          @acionar="converter(escolhido.id)"
        />
      </template>
    </template>
    <SanteBotao variante="texto" :rotulo="t('vinculos.pre.fecharConversao')" @acionar="emit('fechar')" />
  </section>
</template>

<style scoped>
.converter-pre {
  margin-block: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--sgh-borda);
  border-radius: 0.25rem;
}
.busca {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}
</style>
