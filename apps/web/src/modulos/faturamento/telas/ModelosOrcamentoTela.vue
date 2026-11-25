<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Modelos de orçamento padrão (F3.7, 06-FAT linha 40): `/faturamento/modelos-orcamento`.
// Escolhe-se o modelo e a prévia já aparece montada (preço do modelo ou da tabela particular vigente, honorário pela
// função, administração e acréscimo); a linha sem preço pede o valor ali mesmo e o orçamento sai num clique para o
// paciente ou o interessado. O cadastro valida cada item enquanto se digita (regra do domínio, a mesma da API).
// Procedimento, item, acomodação, função e paciente são escolhidos por busca ou lista (nunca por id digitado), e a
// prévia é recalculada no servidor com o valor digitado para a linha sem preço (o total muda enquanto se digita).
import { TIPOS_ITEM_MODELO, validarModelo } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  cadastrarModelo,
  gerarOrcamento,
  inativarModelo,
  lerModelos,
  lerOpcoesModelo,
  lerPrevia,
} from '../api-particular.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t, te } = useI18n();
// Quem só lê (faturamento.orcamento.ler) consulta os modelos e a prévia; cadastrar e inativar pedem
// faturamento.regra.editar e emitir pede faturamento.orcamento.criar (o servidor confere de novo).
const { permissoes } = usarSessao();
const podeEditarModelo = computed(() => permissoes.value.has('faturamento.regra.editar'));
const podeEmitir = computed(() => permissoes.value.has('faturamento.orcamento.criar'));
const qc = useQueryClient();
const modelos = useQuery({ queryKey: ['faturamento', 'modelos-orcamento'], queryFn: lerModelos });
const opcoes = useQuery({
  queryKey: ['faturamento', 'modelos-orcamento', 'opcoes'],
  queryFn: () => lerOpcoesModelo(),
});
const escolhido = ref(0);
const precos = reactive<Record<string, number>>({});
/** Só os valores já digitados (número ≥ 0) vão para a prévia; a chave muda e a prévia é refeita. */
const precosDigitados = computed(() =>
  Object.fromEntries(Object.entries(precos).filter(([, v]) => typeof v === 'number' && v >= 0)),
);
const previa = useQuery({
  queryKey: ['faturamento', 'modelos-orcamento', 'previa', escolhido, precosDigitados],
  queryFn: () => lerPrevia(escolhido.value, precosDigitados.value),
  enabled: computed(() => escolhido.value > 0),
  placeholderData: (anterior) => anterior,
});
const tipo = (x: string) => (te(`particular.mo.tipos.${x}`) ? t(`particular.mo.tipos.${x}`) : x);
function orcar(id: number) {
  escolhido.value = id;
  for (const k of Object.keys(precos)) delete precos[k];
}
const erro = ref<unknown>(null);
const aviso = ref('');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chave = () => crypto.randomUUID();
async function rodar(
  fn: () => Promise<Record<string, unknown>>,
  feito: (r: Record<string, unknown>) => string,
) {
  erro.value = null;
  aviso.value = '';
  try {
    aviso.value = feito(await fn());
    await qc.invalidateQueries({ queryKey: ['faturamento', 'modelos-orcamento'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Gerar orçamento ──
const destino = reactive({ pacienteId: null as number | null, nomeInteressado: '' });
const termoPaciente = ref('');
const pacientes = ref<{ id: number; nome: string; prontuario: number }[]>([]);
async function procurarPaciente() {
  erro.value = null;
  try {
    const r = await buscarPacientes(termoPaciente.value.trim());
    pacientes.value = r.itens.map((p) => ({
      id: p.id,
      nome: p.nomeSocial || p.nome,
      prontuario: p.prontuario,
    }));
    destino.pacienteId = pacientes.value[0]?.id ?? null;
  } catch (e) {
    erro.value = e;
  }
}
// A linha que continua sem preço depois do valor digitado (a prévia do servidor já o considerou).
const faltaPreco = computed(() =>
  (previa.data.value?.semPreco ?? []).filter((s) => !((precos[String(s)] ?? -1) >= 0)),
);
const podeGerar = computed(
  () =>
    escolhido.value > 0 && (destino.pacienteId || destino.nomeInteressado.trim()) && !faltaPreco.value.length,
);
const gerar = () =>
  rodar(
    () =>
      gerarOrcamento(
        escolhido.value,
        {
          pacienteId: destino.pacienteId || null,
          nomeInteressado: destino.nomeInteressado.trim() || null,
          precos: { ...precosDigitados.value },
        },
        chave(),
      ),
    (r) => t('particular.mo.emitido', { numero: String(r['numero']), total: moeda(Number(r['total'])) }),
  );
const inativar = (id: number) => {
  const motivo = window.prompt(t('particular.mo.motivoInativar'));
  if (motivo?.trim())
    void rodar(
      () => inativarModelo(id, motivo, chave()),
      () => t('particular.mo.inativado'),
    ).then(() => (escolhido.value = 0));
};

// ── Cadastro ──
const novo = reactive({
  codigo: '',
  descricao: '',
  procedimentoId: 0,
  acomodacaoId: 0,
  quantidade: 1,
  valorFechado: null as number | null,
  administracao: null as number | null,
  acrescimo: null as number | null,
  validadeDias: 30 as number | null,
  itens: [] as {
    tipo: (typeof TIPOS_ITEM_MODELO)[number];
    itemId: number | null;
    funcaoId: number | null;
    profissionalId: number | null;
    quantidade: number;
    unitario: number | null;
    acrescimo: number | null;
  }[],
});
const errosNovo = computed(() => validarModelo(novo));
// Busca de procedimento e item pelo código ou pela descrição; os achados ficam para as listas do cadastro.
const termoItem = ref('');
const itensAchados = ref<{ id: number; codigo: string; descricao: string }[]>([]);
async function procurarItem() {
  erro.value = null;
  try {
    const r = await lerOpcoesModelo(termoItem.value.trim());
    const ja = new Set(itensAchados.value.map((i) => i.id));
    itensAchados.value = [...itensAchados.value, ...r.itens.filter((i) => !ja.has(i.id))];
  } catch (e) {
    erro.value = e;
  }
}
const addItem = () =>
  novo.itens.push({
    tipo: 'diaria',
    itemId: null,
    funcaoId: null,
    profissionalId: null,
    quantidade: 1,
    unitario: null,
    acrescimo: null,
  });
const cadastrar = () =>
  rodar(
    () => cadastrarModelo({ ...novo, itens: [...novo.itens] }, chave()),
    () => t('particular.mo.cadastrado'),
  ).then((ok) => ok && Object.assign(novo, { codigo: '', descricao: '', itens: [] }));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mo-titulo" data-testid="tela-modelos-orcamento">
    <h1 id="mo-titulo">{{ t('particular.mo.titulo') }}</h1>
    <ErroFaturamento v-if="modelos.error.value || erro" :erro="modelos.error.value ?? erro" />
    <p v-if="aviso" role="status" data-testid="mo-aviso">{{ aviso }}</p>
    <table v-if="modelos.data.value" class="tabela" data-testid="mo-lista">
      <thead>
        <tr>
          <th>{{ t('particular.mo.codigo') }}</th>
          <th>{{ t('particular.mo.modelo') }}</th>
          <th>{{ t('particular.mo.procedimento') }}</th>
          <th>{{ t('particular.mo.acomodacao') }}</th>
          <th>{{ t('particular.mo.itens') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in modelos.data.value" :key="m.id" :aria-selected="m.id === escolhido">
          <td>{{ m.codigo }}</td>
          <td>
            {{ m.descricao }}
            <span v-if="m.valorFechado" class="secundario">{{ t('particular.mo.pacote') }}</span>
          </td>
          <td>{{ m.procedimento }}</td>
          <td>{{ m.acomodacao }}</td>
          <td>{{ m.itens }}</td>
          <td>
            <button type="button" :data-testid="`mo-orcar-${m.codigo}`" @click="orcar(m.id)">
              {{ t('particular.mo.orcar') }}
            </button>
            <button
              v-if="podeEditarModelo"
              type="button"
              :data-testid="`mo-inativar-${m.codigo}`"
              @click="inativar(m.id)"
            >
              {{ t('particular.mo.inativar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="escolhido && previa.data.value">
      <h2>{{ t('particular.mo.previa') }}</h2>
      <table class="tabela" data-testid="mo-previa">
        <thead>
          <tr>
            <th></th>
            <th>{{ t('particular.mo.tipo') }}</th>
            <th>{{ t('particular.mo.quantidade') }}</th>
            <th>{{ t('particular.mo.unitario') }}</th>
            <th>{{ t('particular.mo.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in previa.data.value.linhas" :key="l.sequencia">
            <td>{{ l.sequencia }}</td>
            <td>{{ tipo(l.tipo) }}</td>
            <td>{{ l.quantidade }}</td>
            <td>
              <input
                v-if="
                  previa.data.value.semPreco.includes(l.sequencia) ||
                  precos[String(l.sequencia)] !== undefined
                "
                v-model.number="precos[String(l.sequencia)]"
                type="number"
                min="0"
                step="0.01"
                :data-testid="`mo-preco-${l.sequencia}`"
                :aria-label="t('particular.mo.valorLinha', { n: l.sequencia })"
              />
              <template v-else>{{ moeda(l.unitario) }}</template>
            </td>
            <td>{{ l.valorPacote !== null && l.total === 0 ? moeda(l.valorPacote) : moeda(l.total) }}</td>
          </tr>
        </tbody>
      </table>
      <p data-testid="mo-resumo">
        {{
          t('particular.mo.resumo', {
            bruto: moeda(previa.data.value.bruto),
            administracao: moeda(previa.data.value.administracao),
            acrescimo: moeda(previa.data.value.acrescimo),
            total: moeda(previa.data.value.total),
            dias: previa.data.value.validadeDias,
          })
        }}
      </p>
      <form v-if="podeEmitir" class="filtros" data-testid="mo-form-gerar" @submit.prevent="gerar">
        <label>
          {{ t('particular.mo.buscarPaciente') }}
          <input
            v-model="termoPaciente"
            data-testid="mo-termo-paciente"
            @keydown.enter.prevent="procurarPaciente"
          />
        </label>
        <button type="button" :disabled="termoPaciente.trim().length < 2" @click="procurarPaciente">
          {{ t('particular.mo.buscar') }}
        </button>
        <SanteSelecao
          v-if="pacientes.length"
          v-model="destino.pacienteId"
          :rotulo="t('particular.mo.paciente')"
          :opcoes="[
            { valor: null, rotulo: t('particular.mo.escolhaPaciente') },
            ...pacientes.map((p) => ({ valor: p.id, rotulo: `${p.nome} ${p.prontuario}` })),
          ]"
          data-testid="mo-paciente"
        />
        <label>
          {{ t('particular.mo.interessado') }}
          <input v-model="destino.nomeInteressado" maxlength="150" data-testid="mo-interessado" />
        </label>
        <p v-if="faltaPreco.length" class="secundario">
          {{ t('particular.mo.faltaPreco', { linhas: faltaPreco.join(', ') }) }}
        </p>
        <button type="submit" :disabled="!podeGerar" data-testid="mo-emitir">
          {{ t('particular.mo.emitir') }}
        </button>
      </form>
    </template>

    <p v-if="!podeEditarModelo" class="secundario" role="note" data-testid="mo-so-consulta">
      {{ t('particular.mo.soConsulta') }}
    </p>
    <h2 v-if="podeEditarModelo">{{ t('particular.mo.novo') }}</h2>
    <form v-if="podeEditarModelo" class="filtros" data-testid="mo-form-novo" @submit.prevent="cadastrar">
      <label>
        {{ t('particular.mo.codigo') }}
        <input v-model="novo.codigo" maxlength="30" />
      </label>
      <label>
        {{ t('particular.mo.descricao') }}
        <input v-model="novo.descricao" maxlength="150" />
      </label>
      <label>
        {{ t('particular.mo.buscarItem') }}
        <input v-model="termoItem" data-testid="mo-termo-item" @keydown.enter.prevent="procurarItem" />
      </label>
      <button type="button" :disabled="termoItem.trim().length < 2" @click="procurarItem">
        {{ t('particular.mo.buscar') }}
      </button>
      <SanteSelecao
        v-model="novo.procedimentoId"
        :rotulo="t('particular.mo.procedimento')"
        :opcoes="[
          { valor: 0, rotulo: t('particular.mo.escolha') },
          ...itensAchados.map((i) => ({ valor: i.id, rotulo: `${i.codigo} ${i.descricao}` })),
        ]"
        data-testid="mo-procedimento"
      />
      <SanteSelecao
        v-model="novo.acomodacaoId"
        :rotulo="t('particular.mo.acomodacao')"
        :opcoes="[
          { valor: 0, rotulo: t('particular.mo.escolha') },
          ...(opcoes.data.value?.acomodacoes ?? []).map((a) => ({ valor: a.id, rotulo: a.descricao })),
        ]"
        data-testid="mo-acomodacao"
      />
      <label>
        {{ t('particular.mo.valorFechado') }}
        <input v-model.number="novo.valorFechado" type="number" min="0" step="0.01" />
      </label>
      <label>
        {{ t('particular.mo.administracao') }}
        <input v-model.number="novo.administracao" type="number" min="0" max="100" />
      </label>
      <label>
        {{ t('particular.mo.acrescimo') }}
        <input v-model.number="novo.acrescimo" type="number" min="0" max="100" />
      </label>
      <label>
        {{ t('particular.mo.validade') }}
        <input v-model.number="novo.validadeDias" type="number" min="1" max="365" />
      </label>
      <fieldset v-for="(i, k) in novo.itens" :key="k">
        <legend>{{ t('particular.mo.item', { n: k + 1 }) }}</legend>
        <SanteSelecao
          v-model="i.tipo"
          :rotulo="t('particular.mo.tipo')"
          ocultar-rotulo
          :opcoes="[...TIPOS_ITEM_MODELO.map((x) => ({ valor: x, rotulo: tipo(x) }))]"
        />
        <SanteSelecao
          v-if="i.tipo === 'honorario'"
          v-model="i.funcaoId"
          :rotulo="t('particular.mo.funcao')"
          :opcoes="[
            { valor: null, rotulo: t('particular.mo.escolha') },
            ...(opcoes.data.value?.funcoes ?? []).map((f) => ({
              valor: f.id,
              rotulo: `${f.descricao} ${f.percentual ?? ''}`,
            })),
          ]"
        />
        <SanteSelecao
          v-else
          v-model="i.itemId"
          :rotulo="t('particular.mo.itemFaturavel')"
          :opcoes="[
            { valor: null, rotulo: t('particular.mo.escolha') },
            ...itensAchados.map((x) => ({ valor: x.id, rotulo: `${x.codigo} ${x.descricao}` })),
          ]"
        />
        <label>
          {{ t('particular.mo.quantidade') }}
          <input v-model.number="i.quantidade" type="number" min="0" step="0.0001" />
        </label>
        <label>
          {{ t('particular.mo.valorFixo') }}
          <input v-model.number="i.unitario" type="number" min="0" step="0.01" />
        </label>
        <button type="button" @click="novo.itens.splice(k, 1)">{{ t('particular.mo.remover') }}</button>
      </fieldset>
      <button type="button" @click="addItem">{{ t('particular.mo.adicionar') }}</button>
      <ul v-if="Object.keys(errosNovo).length" class="secundario" data-testid="mo-erros-novo">
        <li v-for="(m, c) in errosNovo" :key="c">{{ m }}</li>
      </ul>
      <button type="submit" :disabled="Object.keys(errosNovo).length > 0">
        {{ t('particular.mo.cadastrar') }}
      </button>
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
