<script setup lang="ts">
// F3.9, 08-INTG L140: os perfis de prioridade enviados ao sistema de triagem (com o código que ele conhece e a ordem) e,
// por atendimento do pronto atendimento, as classificações recebidas: a vigente com o prazo do atendimento médico, as
// substituídas e as rejeitadas com o motivo (nada é apagado).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarPerfil, lerPerfis, recebidasDoAtendimento } from '../api-comunicacao.js';

const CONDICOES = [
  'gestante',
  'lactante',
  'idoso',
  'idoso_80',
  'deficiencia',
  'mobilidade_reduzida',
  'crianca_colo',
  'autismo',
  'obesidade',
  'outro',
];
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      perfis: 'Perfis de prioridade enviados à triagem',
      codigo: 'Código',
      descricao: 'Descrição',
      sistema: 'Sistema de triagem (código)',
      externo: 'Código no sistema de triagem',
      condicao: 'Condição',
      ordem: 'Ordem',
      gravar: 'Gravar perfil',
      atendimento: 'Atendimento (número interno)',
      recebidas: 'Classificações recebidas',
      prazo: 'Prazo do atendimento médico',
      nenhuma: 'Nenhuma classificação recebida para este atendimento.',
      gravado: 'Gravado.',
    },
  },
});
const cliente = useQueryClient();
const perfis = useQuery({ queryKey: ['integracoes', 'classificacao', 'perfis'], queryFn: lerPerfis });
const aviso = ref('');
const falha = ref('');
const f = reactive({
  codigo: '',
  descricao: '',
  sistemaCodigo: '',
  codigoExterno: '',
  condicaoPreferencial: '',
  ordemPrioridade: 0,
});
async function salvar() {
  aviso.value = '';
  falha.value = '';
  const atual = perfis.data.value?.itens.find((x) => x.codigo === f.codigo);
  try {
    await gravarPerfil({
      ...f,
      sistemaCodigo: f.sistemaCodigo || null,
      codigoExterno: f.codigoExterno || null,
      condicaoPreferencial: f.condicaoPreferencial || null,
      ...(atual ? { id: atual.id, versao: atual.versao } : {}),
    });
    aviso.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'classificacao'] });
  } catch (e) {
    falha.value = e instanceof Error ? e.message : String(e);
  }
}
const atendimento = ref<number | null>(null);
const recebidas = useQuery({
  queryKey: computed(() => ['integracoes', 'classificacao', 'atendimento', atendimento.value]),
  queryFn: () => recebidasDoAtendimento(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const data = (v: string) => new Date(v).toLocaleString('pt-BR');
</script>

<template>
  <section class="painel" data-testid="classificacao-externa-painel">
    <h2>{{ t('perfis') }}</h2>
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <p v-if="falha" role="alert">{{ falha }}</p>
    <table v-if="perfis.data.value" data-testid="classificacao-perfis">
      <tr v-for="x in perfis.data.value.itens" :key="x.id" :class="{ secundario: !x.ativo }">
        <td>{{ x.ordemPrioridade }}</td>
        <td>{{ x.codigo }}</td>
        <td>{{ x.descricao }}</td>
        <td>{{ x.sistemaCodigo ?? '' }} {{ x.codigoExterno ?? '' }}</td>
        <td>{{ x.condicaoPreferencial ?? '' }}</td>
      </tr>
    </table>
    <form data-testid="classificacao-perfil-novo" @submit.prevent="salvar">
      <label
        >{{ t('codigo') }} <input v-model="f.codigo" required maxlength="30" pattern="[A-Za-z0-9_-]+"
      /></label>
      <label>{{ t('descricao') }} <input v-model="f.descricao" required maxlength="150" /></label>
      <label>{{ t('sistema') }} <input v-model="f.sistemaCodigo" maxlength="40" /></label>
      <label
        >{{ t('externo') }} <input v-model="f.codigoExterno" maxlength="30" :disabled="!f.sistemaCodigo"
      /></label>
      <label
        >{{ t('condicao') }}
        <select v-model="f.condicaoPreferencial">
          <option value="" />
          <option v-for="c in CONDICOES" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label
        >{{ t('ordem') }} <input v-model.number="f.ordemPrioridade" type="number" min="0" max="999"
      /></label>
      <button type="submit">{{ t('gravar') }}</button>
    </form>

    <h2>{{ t('recebidas') }}</h2>
    <label
      >{{ t('atendimento') }}
      <input v-model.number="atendimento" type="number" min="1" data-testid="classificacao-atendimento"
    /></label>
    <p v-if="recebidas.data.value && !recebidas.data.value.itens.length">{{ t('nenhuma') }}</p>
    <table v-else-if="recebidas.data.value" data-testid="classificacao-recebidas">
      <tr
        v-for="x in recebidas.data.value.itens"
        :key="x.id"
        :class="{ secundario: x.situacao !== 'recebida' }"
      >
        <td>{{ data(x.classificadoEm) }}</td>
        <td>{{ x.sistema }}</td>
        <td>{{ x.codigoPrioridade }} {{ x.cor ?? '' }}</td>
        <td>{{ x.perfil ?? '' }}</td>
        <td>{{ x.situacao }}{{ x.motivoRejeicao ? `: ${x.motivoRejeicao}` : '' }}</td>
        <td>{{ x.prazoAtendimento ? `${t('prazo')}: ${data(x.prazoAtendimento)}` : '' }}</td>
      </tr>
    </table>
  </section>
</template>
