<script setup lang="ts">
// Doenças crônicas referidas no cadastro do paciente (F7, 09-AREA linha 73): a condição de saúde que o cadastro
// nacional pede, declarada com data e informante e encerrada com data; nada é apagado. É declaração do cadastro, não
// diagnóstico (o diagnóstico fica na lista de problemas do prontuário). A tela confere na hora a doença já vigente e o
// nome de quem informou; o servidor confere tudo de novo (regra no domínio).
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type Demografia,
  declararCondicaoCronica,
  encerrarCondicaoCronica,
  type Vulnerabilidade,
} from '../api-demografia.js';
import { dataBr } from '../formato.js';

const props = defineProps<{ idPaciente: number; podeEditar: boolean; dados: Demografia }>();
const emit = defineEmits<{ alterado: [mensagem: string]; erro: [erro: unknown] }>();
const { t } = useI18n();

const INFORMANTES_COM_NOME = ['responsavel', 'familiar', 'outro'];
const vazia = () => ({ condicao: 0, declaradaEm: '', informanteTipo: 'paciente', informanteNome: '' });
const nova = ref(vazia());
const fins = ref<Record<number, string>>({});
const pedeNome = computed(() => INFORMANTES_COM_NOME.includes(nova.value.informanteTipo));
const pendencias = computed(() => {
  const r: string[] = [];
  if (props.dados.condicoesCronicas.some((v) => v.vigente && v.condicao.id === nova.value.condicao))
    r.push(t('demografia.cronica.jaVigente'));
  if (pedeNome.value && nova.value.informanteNome.trim().length < 3)
    r.push(t('demografia.cronica.faltaNome'));
  return r;
});
const podeDeclarar = computed(
  () => nova.value.condicao > 0 && nova.value.declaradaEm !== '' && pendencias.value.length === 0,
);

async function declarar(): Promise<void> {
  if (!podeDeclarar.value) return;
  try {
    await declararCondicaoCronica(props.idPaciente, {
      condicao: nova.value.condicao,
      declaradaEm: nova.value.declaradaEm,
      informanteTipo: nova.value.informanteTipo,
      informanteNome: pedeNome.value ? nova.value.informanteNome.trim() : null,
    });
    nova.value = vazia();
    emit('alterado', t('demografia.cronica.declarada'));
  } catch (e) {
    emit('erro', e);
  }
}

async function encerrar(v: Vulnerabilidade): Promise<void> {
  const fim = fins.value[v.id] ?? '';
  if (!fim) return;
  try {
    await encerrarCondicaoCronica(props.idPaciente, v.id, fim);
    emit('alterado', t('demografia.cronica.encerradaMsg'));
  } catch (e) {
    emit('erro', e);
  }
}
</script>

<template>
  <section aria-labelledby="sec-cronicas" data-testid="condicoes-cronicas-paciente">
    <h3 id="sec-cronicas">{{ t('demografia.cronica.titulo') }}</h3>
    <p class="ajuda">{{ t('demografia.cronica.ajuda') }}</p>
    <p v-if="dados.condicoesCronicas.length === 0">{{ t('demografia.cronica.nenhuma') }}</p>
    <table v-else data-testid="lista-condicoes-cronicas">
      <caption>
        {{
          t('demografia.cronica.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('demografia.cronica.condicao') }}</th>
          <th scope="col">{{ t('demografia.vulnerabilidade.declaradaEm') }}</th>
          <th scope="col">{{ t('demografia.vulnerabilidade.informante') }}</th>
          <th scope="col">{{ t('demografia.vulnerabilidade.situacao') }}</th>
          <th v-if="podeEditar" scope="col">{{ t('demografia.vulnerabilidade.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="v in dados.condicoesCronicas"
          :key="v.id"
          :data-situacao="v.vigente ? 'vigente' : 'encerrada'"
        >
          <td>{{ v.condicao.descricao }}</td>
          <td>{{ dataBr(v.declaradaEm) }}</td>
          <td>
            {{ t(`demografia.vulnerabilidade.informantes.${v.informanteTipo}`) }}
            <template v-if="v.informanteNome">({{ v.informanteNome }})</template>
          </td>
          <td>
            {{
              v.vigente
                ? t('demografia.vulnerabilidade.vigente')
                : `${t('demografia.vulnerabilidade.encerrada')} ${dataBr(v.fim)}`
            }}
          </td>
          <td v-if="podeEditar">
            <template v-if="v.vigente">
              <label
                >{{ t('demografia.vulnerabilidade.dataFim') }}
                <input v-model="fins[v.id]" type="date" :min="v.declaradaEm" :max="dados.hoje"
              /></label>
              <button type="button" :disabled="!fins[v.id]" @click="encerrar(v)">
                {{ t('demografia.vulnerabilidade.encerrar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <form
      v-if="podeEditar && dados.opcoes.condicoesCronicas.length > 0"
      class="bloco"
      data-testid="nova-condicao-cronica"
      @submit.prevent="declarar"
    >
      <SanteSelecao
        v-model="nova.condicao"
        :rotulo="t('demografia.cronica.condicao')"
        obrigatorio
        :opcoes="[
          { valor: 0, rotulo: t('demografia.naoInformado'), desabilitada: true },
          ...dados.opcoes.condicoesCronicas.map((o) => ({ valor: o.id, rotulo: o.descricao })),
        ]"
      />
      <label
        >{{ t('demografia.vulnerabilidade.declaradaEm') }}
        <input v-model="nova.declaradaEm" type="date" :max="dados.hoje" required
      /></label>
      <SanteSelecao
        v-model="nova.informanteTipo"
        :rotulo="t('demografia.vulnerabilidade.informante')"
        :opcoes="
          dados.opcoes.informantes.map((i) => ({
            valor: i,
            rotulo: t(`demografia.vulnerabilidade.informantes.${i}`),
          }))
        "
      />
      <label v-if="pedeNome"
        >{{ t('demografia.vulnerabilidade.informanteNome') }}
        <input v-model="nova.informanteNome" maxlength="150"
      /></label>
      <ul v-if="pendencias.length && nova.condicao" class="pendencias">
        <li v-for="p in pendencias" :key="p">{{ p }}</li>
      </ul>
      <button type="submit" :disabled="!podeDeclarar">{{ t('demografia.cronica.declarar') }}</button>
    </form>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.bloco {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin-top: var(--sgh-espaco-2);
}
.pendencias {
  flex-basis: 100%;
  color: var(--sgh-texto);
  margin: 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
