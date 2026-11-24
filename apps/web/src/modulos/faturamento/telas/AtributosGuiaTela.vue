<script setup lang="ts">
// Campo adicional da operadora na guia (F3.7, 06-FAT linha 10). Duas rotas, um componente:
// - `/faturamento/fontes/:fonte/atributos-guia` (modo "fonte"): o faturamento cadastra os campos que a operadora exige
//   (texto, número, data, sim ou não, lista com opções e lista que depende de outra, como a fase dentro do tratamento),
//   com as opções no mesmo pedido. Campo e opção nunca se apagam: deixam de valer pelo "ativo".
// - `/faturamento/guias/:guia/atributos` (modo "guia"): os campos que valem para o tipo da guia aparecem prontos para
//   preencher; a lista dependente mostra só as opções da escolhida no pai; o tipo é conferido enquanto se digita e o
//   obrigatório que falta fica à vista (a guia só segue para o lote sem pendência).
import { validarDefinicaoAtributo, validarValoresAtributos } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AtributoGuia,
  gravarAtributoFonte,
  gravarAtributosGuia,
  lerAtributosFonte,
  lerAtributosGuia,
} from '../api-complementos.js';
import { novaChave } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const props = defineProps<{ fonte?: string; guia?: string }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      tituloFonte: 'Campos adicionais da operadora na guia',
      tituloGuia: 'Campos adicionais da guia {numero}',
      nenhum: 'Esta operadora não exige campos adicionais nesta guia.',
      faltam: 'Obrigatórios sem preenchimento: {campos}.',
      voltarConta: 'Voltar aos complementos da conta',
      camposOperadora: 'Campos adicionais da operadora',
      completa: 'Nenhum campo obrigatório pendente.',
      fechada: 'A guia já está em lote ou enviada: os campos não mudam mais.',
      escolha: 'Escolha…',
      sim: 'Sim',
      nao: 'Não',
      gravar: 'Gravar campos',
      gravado: 'Gravado.',
      novo: 'Novo campo',
      codigo: 'Código',
      rotulo: 'Rótulo',
      tipoDado: 'Tipo',
      tipoGuia: 'Tipo de guia (vazio: todas)',
      obrigatorio: 'Obrigatório',
      tamanho: 'Tamanho máximo',
      depende: 'Depende de',
      nenhumPai: 'Nenhum',
      opcoes: 'Opções: uma por linha, "código; descrição" ou "código; descrição; código da opção-pai"',
      incluir: 'Incluir campo',
      inativar: 'Desativar',
      ativar: 'Reativar',
      tipos: { texto: 'Texto', numero: 'Número', data: 'Data', booleano: 'Sim ou não', opcao: 'Lista' },
    },
  },
});
const qc = useQueryClient();
const modoGuia = computed(() => props.guia !== undefined);
const fonteId = computed(() => Number(props.fonte));
const guiaId = computed(() => Number(props.guia));
const qFonte = useQuery({
  queryKey: ['faturamento', 'atributos-fonte', fonteId],
  queryFn: () => lerAtributosFonte(fonteId.value),
  enabled: computed(() => !modoGuia.value),
});
const qGuia = useQuery({
  queryKey: ['faturamento', 'atributos-guia', guiaId],
  queryFn: () => lerAtributosGuia(guiaId.value),
  enabled: modoGuia,
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('atributos');
async function acao(f: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await f();
    mensagem.value = t('gravado');
    chave = novaChave('atributos');
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// ── Modo guia ────────────────────────────────────────────────────────
const resp = reactive<Record<number, { opcaoId: number | null; texto: string }>>({});
watch(
  () => qGuia.data.value,
  (d) => {
    if (!d) return;
    for (const c of d.campos) {
      const v = d.valores.find((x) => x.atributoId === c.id);
      resp[c.id] = { opcaoId: v?.opcaoId ?? null, texto: v?.texto ?? '' };
    }
  },
  { immediate: true },
);
const valores = computed(() =>
  (qGuia.data.value?.campos ?? []).map((c) => ({
    atributoId: c.id,
    opcaoId: resp[c.id]?.opcaoId ?? null,
    texto: c.tipoDado === 'opcao' ? null : (resp[c.id]?.texto ?? ''),
  })),
);
const conferencia = computed(() =>
  qGuia.data.value ? validarValoresAtributos(qGuia.data.value.campos, valores.value) : null,
);
/** Opções visíveis: ativas e, na lista dependente, só as filhas da opção escolhida no pai. */
const opcoesDe = (c: AtributoGuia) =>
  c.opcoes.filter(
    (o) =>
      (o.ativo || o.id === resp[c.id]?.opcaoId) &&
      (c.dependeDeId === null || o.opcaoPaiId === null || o.opcaoPaiId === resp[c.dependeDeId]?.opcaoId),
  );
const gravarGuia = () =>
  acao(() => gravarAtributosGuia(guiaId.value, conferencia.value?.normalizados ?? [], chave));

// ── Modo fonte ───────────────────────────────────────────────────────
const novo = reactive({
  codigo: '',
  rotulo: '',
  tipoDado: 'texto',
  tipoGuia: '',
  obrigatorio: false,
  tamanhoMaximo: '' as string | number,
  dependeDeId: '' as string | number,
  opcoes: '',
});
const listas = computed(() => (qFonte.data.value ?? []).filter((a) => a.tipoDado === 'opcao'));
const errosNovo = computed(() =>
  novo.codigo || novo.rotulo
    ? Object.values(
        validarDefinicaoAtributo(
          {
            id: null,
            codigo: novo.codigo,
            rotulo: novo.rotulo,
            tipoDado: novo.tipoDado,
            tipoGuia: novo.tipoGuia || null,
            tamanhoMaximo: novo.tamanhoMaximo === '' ? null : Number(novo.tamanhoMaximo),
            dependeDeId: novo.dependeDeId === '' ? null : Number(novo.dependeDeId),
          },
          qFonte.data.value ?? [],
        ),
      )
    : [],
);
function opcoesDoTexto() {
  const pai = listas.value.find((a) => a.id === Number(novo.dependeDeId));
  return novo.opcoes
    .split('\n')
    .map((l) => l.split(';').map((p) => p.trim()))
    .filter((p) => p[0])
    .map(([codigo, descricao, codPai], i) => ({
      codigo,
      descricao: descricao || codigo,
      ordem: i,
      opcaoPaiId: codPai ? (pai?.opcoes.find((o) => o.codigo === codPai)?.id ?? -1) : null,
    }));
}
const incluir = () =>
  acao(() =>
    gravarAtributoFonte(
      fonteId.value,
      {
        codigo: novo.codigo,
        rotulo: novo.rotulo,
        tipoDado: novo.tipoDado,
        tipoGuia: novo.tipoGuia || null,
        obrigatorio: novo.obrigatorio,
        tamanhoMaximo: novo.tamanhoMaximo === '' ? null : Number(novo.tamanhoMaximo),
        dependeDeId: novo.dependeDeId === '' ? null : Number(novo.dependeDeId),
        ordem: qFonte.data.value?.length ?? 0,
        opcoes: novo.tipoDado === 'opcao' ? opcoesDoTexto() : [],
      },
      chave,
    ),
  );
const alternar = (a: AtributoGuia) =>
  acao(() =>
    gravarAtributoFonte(
      fonteId.value,
      {
        id: a.id,
        versao: a.versao,
        codigo: a.codigo,
        rotulo: a.rotulo,
        tipoDado: a.tipoDado,
        tipoGuia: a.tipoGuia,
        obrigatorio: a.obrigatorio,
        tamanhoMaximo: a.tamanhoMaximo,
        dependeDeId: a.dependeDeId,
        ordem: a.ordem,
        ativo: !a.ativo,
      },
      chave,
    ),
  );
const TIPOS_GUIA = [
  'consulta',
  'sp_sadt',
  'solicitacao_internacao',
  'resumo_internacao',
  'honorario',
  'outras_despesas',
  'odontologia',
];
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ag-titulo" data-testid="tela-atributos-guia">
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <template v-if="modoGuia">
      <ErroFaturamento v-if="qGuia.error.value" :erro="qGuia.error.value" />
      <template v-else-if="qGuia.data.value">
        <h1 id="ag-titulo">{{ t('tituloGuia', { numero: qGuia.data.value.guia.numero }) }}</h1>
        <nav class="acoes">
          <RouterLink
            :to="`/faturamento/contas/${qGuia.data.value.guia.contaId}/complementos`"
            data-testid="ag-voltar-conta"
            >{{ t('voltarConta') }}</RouterLink
          >
          <RouterLink
            :to="`/faturamento/fontes/${qGuia.data.value.guia.fontePagadoraId}/atributos-guia`"
            data-testid="ag-campos-operadora"
            >{{ t('camposOperadora') }}</RouterLink
          >
        </nav>
        <p v-if="!qGuia.data.value.editavel" role="status">{{ t('fechada') }}</p>
        <p v-if="!qGuia.data.value.campos.length">{{ t('nenhum') }}</p>
        <form v-else class="formulario" data-testid="ag-guia" @submit.prevent="gravarGuia">
          <label v-for="c in qGuia.data.value.campos" :key="c.id">
            {{ c.rotulo }}<span v-if="c.obrigatorio" aria-hidden="true"> *</span>
            <select
              v-if="c.tipoDado === 'opcao' && resp[c.id]"
              v-model="resp[c.id]!.opcaoId"
              :disabled="!qGuia.data.value.editavel"
              :data-testid="`ag-campo-${c.codigo}`"
            >
              <option :value="null">{{ t('escolha') }}</option>
              <option v-for="o in opcoesDe(c)" :key="o.id" :value="o.id">{{ o.descricao }}</option>
            </select>
            <select
              v-else-if="c.tipoDado === 'booleano' && resp[c.id]"
              v-model="resp[c.id]!.texto"
              :disabled="!qGuia.data.value.editavel"
            >
              <option value="">{{ t('escolha') }}</option>
              <option value="sim">{{ t('sim') }}</option>
              <option value="nao">{{ t('nao') }}</option>
            </select>
            <input
              v-else-if="resp[c.id]"
              v-model="resp[c.id]!.texto"
              :type="c.tipoDado === 'data' ? 'date' : 'text'"
              :inputmode="c.tipoDado === 'numero' ? 'decimal' : undefined"
              :maxlength="c.tamanhoMaximo ?? 500"
              :disabled="!qGuia.data.value.editavel"
              :data-testid="`ag-campo-${c.codigo}`"
            />
            <small v-if="conferencia?.erros[`atributo.${c.id}`]" role="alert">
              {{ conferencia.erros[`atributo.${c.id}`] }}
            </small>
          </label>
          <p role="status" data-testid="ag-faltam">
            {{
              conferencia?.faltam.length
                ? t('faltam', { campos: conferencia.faltam.join(', ') })
                : t('completa')
            }}
          </p>
          <button
            v-if="qGuia.data.value.editavel"
            type="submit"
            :disabled="gravando || Object.keys(conferencia?.erros ?? {}).length > 0"
            data-testid="ag-gravar"
          >
            {{ t('gravar') }}
          </button>
        </form>
      </template>
    </template>

    <template v-else>
      <h1 id="ag-titulo">{{ t('tituloFonte') }}</h1>
      <ErroFaturamento v-if="qFonte.error.value" :erro="qFonte.error.value" />
      <table v-else-if="qFonte.data.value?.length" class="tabela" data-testid="ag-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('codigo') }}</th>
            <th scope="col">{{ t('rotulo') }}</th>
            <th scope="col">{{ t('tipoDado') }}</th>
            <th scope="col">{{ t('tipoGuia') }}</th>
            <th scope="col">{{ t('obrigatorio') }}</th>
            <th scope="col">{{ t('opcoes').split(':')[0] }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in qFonte.data.value" :key="a.id" :class="{ inativo: !a.ativo }">
            <td>{{ a.codigo }}</td>
            <td>{{ a.rotulo }}</td>
            <td>{{ t(`tipos.${a.tipoDado}`) }}</td>
            <td>{{ a.tipoGuia ?? '—' }}</td>
            <td>{{ a.obrigatorio ? t('sim') : t('nao') }}</td>
            <td>{{ a.opcoes.map((o) => o.descricao).join(', ') }}</td>
            <td>
              <button type="button" :disabled="gravando" @click="alternar(a)">
                {{ a.ativo ? t('inativar') : t('ativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="qFonte.data.value">{{ t('nenhum') }}</p>

      <form class="formulario" data-testid="ag-novo" @submit.prevent="incluir">
        <fieldset>
          <legend>{{ t('novo') }}</legend>
          <label
            >{{ t('codigo') }} <input v-model="novo.codigo" maxlength="30" required data-testid="ag-codigo"
          /></label>
          <label
            >{{ t('rotulo') }} <input v-model="novo.rotulo" maxlength="150" required data-testid="ag-rotulo"
          /></label>
          <label>
            {{ t('tipoDado') }}
            <select v-model="novo.tipoDado" data-testid="ag-tipo">
              <option v-for="tp in ['texto', 'numero', 'data', 'booleano', 'opcao']" :key="tp" :value="tp">
                {{ t(`tipos.${tp}`) }}
              </option>
            </select>
          </label>
          <label>
            {{ t('tipoGuia') }}
            <select v-model="novo.tipoGuia">
              <option value="">—</option>
              <option v-for="tg in TIPOS_GUIA" :key="tg" :value="tg">{{ tg }}</option>
            </select>
          </label>
          <label><input v-model="novo.obrigatorio" type="checkbox" /> {{ t('obrigatorio') }}</label>
          <label v-if="novo.tipoDado === 'texto'">
            {{ t('tamanho') }} <input v-model="novo.tamanhoMaximo" type="number" min="1" max="500" />
          </label>
          <template v-if="novo.tipoDado === 'opcao'">
            <label>
              {{ t('depende') }}
              <select v-model="novo.dependeDeId">
                <option value="">{{ t('nenhumPai') }}</option>
                <option v-for="l in listas" :key="l.id" :value="l.id">{{ l.rotulo }}</option>
              </select>
            </label>
            <label
              >{{ t('opcoes') }} <textarea v-model="novo.opcoes" rows="4" data-testid="ag-opcoes" />
            </label>
          </template>
          <ul v-if="errosNovo.length" class="erros" role="alert">
            <li v-for="e in errosNovo" :key="e">{{ e }}</li>
          </ul>
          <button type="submit" :disabled="gravando || errosNovo.length > 0" data-testid="ag-incluir">
            {{ t('incluir') }}
          </button>
        </fieldset>
      </form>
    </template>
  </section>
</template>
