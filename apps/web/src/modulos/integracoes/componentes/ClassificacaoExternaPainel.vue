<script setup lang="ts">
// F3.9, 08-INTG L140: os perfis de prioridade enviados ao sistema de triagem (com o código que ele conhece e a ordem) e,
// por atendimento do pronto atendimento, as classificações recebidas: a vigente com o prazo do atendimento médico, as
// substituídas e as rejeitadas com o motivo (nada é apagado). A vigente se aplica com um clique, na própria linha:
// vira a classificação interna do atendimento (e reclassifica a interna anterior, se houver).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aplicarRecebida,
  enviarPerfisTriagem,
  gravarPerfil,
  lerPerfis,
  recebidasDoAtendimento,
} from '../api-comunicacao.js';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';

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
      aplicar: 'Aplicar ao atendimento',
      aplicada: 'Classificação aplicada ao atendimento.',
      reclassificada: 'Classificação aplicada: a classificação interna anterior foi reclassificada.',
      envioSistema: 'Enviar ao sistema de triagem',
      enviar: 'Enviar perfis',
      enviado: 'Perfis na fila de saída ({n} perfis): o sistema de triagem recebe pelo canal HL7.',
      repetido:
        'Este mesmo pacote de perfis já está na fila de saída hoje (aguardando, a caminho ou entregue); nada novo entrou.',
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
const opcoesCondicao = computed(() => [
  { valor: '', rotulo: '—' },
  ...CONDICOES.map((c) => ({ valor: c as string, rotulo: c })),
]);
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
// O envio ativo: os sistemas de triagem vêm dos próprios perfis (sem digitar o código).
const sistemas = computed(() => [
  ...new Set((perfis.data.value?.itens ?? []).map((x) => x.sistemaCodigo).filter((x): x is string => !!x)),
]);
const sistemaEnvio = ref('');
const sistemaEscolhido = computed({
  get: () => sistemaEnvio.value || sistemas.value[0] || '',
  set: (v: string) => {
    sistemaEnvio.value = v;
  },
});
const opcoesSistema = computed(() => sistemas.value.map((s) => ({ valor: s, rotulo: s })));
const enviando = ref(false);
async function enviarPerfis() {
  aviso.value = '';
  falha.value = '';
  const s = sistemaEscolhido.value;
  if (!s) return;
  enviando.value = true;
  try {
    const r = await enviarPerfisTriagem(s);
    aviso.value = r.repetida ? t('repetido') : t('enviado', { n: r.perfis });
  } catch (e) {
    // A recusa de negócio traz o motivo da regra (ex.: o envio de hoje falhou; reprocessar na fila de mortos).
    const motivo = mensagemDoErro(e).motivo;
    falha.value = (e instanceof Error ? e.message : String(e)) + (motivo ? `: ${motivo}` : '');
  } finally {
    enviando.value = false;
  }
}
const atendimento = ref<number | null>(null);
const recebidas = useQuery({
  queryKey: computed(() => ['integracoes', 'classificacao', 'atendimento', atendimento.value]),
  queryFn: () => recebidasDoAtendimento(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const aplicando = ref<number | null>(null);
async function aplicar(id: number) {
  aviso.value = '';
  falha.value = '';
  aplicando.value = id;
  try {
    const r = await aplicarRecebida(id);
    aviso.value = r.reclassificou ? t('reclassificada') : t('aplicada');
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'classificacao', 'atendimento'] });
  } catch (e) {
    falha.value = e instanceof Error ? e.message : String(e);
  } finally {
    aplicando.value = null;
  }
}
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
    <form v-if="sistemas.length" data-testid="classificacao-envio" @submit.prevent="enviarPerfis">
      <SanteSelecao v-model="sistemaEscolhido" :rotulo="t('envioSistema')" :opcoes="opcoesSistema" />
      <button type="submit" data-testid="classificacao-enviar-perfis" :disabled="enviando">
        {{ t('enviar') }}
      </button>
    </form>
    <form data-testid="classificacao-perfil-novo" @submit.prevent="salvar">
      <label
        >{{ t('codigo') }} <input v-model="f.codigo" required maxlength="30" pattern="[A-Za-z0-9_-]+"
      /></label>
      <label>{{ t('descricao') }} <input v-model="f.descricao" required maxlength="150" /></label>
      <label>{{ t('sistema') }} <input v-model="f.sistemaCodigo" maxlength="40" /></label>
      <label
        >{{ t('externo') }} <input v-model="f.codigoExterno" maxlength="30" :disabled="!f.sistemaCodigo"
      /></label>
      <SanteSelecao v-model="f.condicaoPreferencial" :rotulo="t('condicao')" :opcoes="opcoesCondicao" />
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
        <td>
          <button
            v-if="x.situacao === 'recebida'"
            type="button"
            :disabled="aplicando !== null"
            :data-testid="`classificacao-aplicar-${x.id}`"
            @click="aplicar(x.id)"
          >
            {{ t('aplicar') }}
          </button>
        </td>
      </tr>
    </table>
  </section>
</template>
