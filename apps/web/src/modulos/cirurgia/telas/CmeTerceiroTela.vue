<script setup lang="ts">
// Material de terceiro e consignado processado pela CME (F7, 04-CME linha 119; RDC 15/2012): cadastro do material com
// o dono e o roteiro, recebimento na CME, conferência peça a peça, envio ao reprocessamento (pacote por item, que
// segue o ciclo da CME), disponibilidade com os pacotes estéreis e devolução conferida. O servidor decide cada passo.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarDonos,
  cadastrarMaterial,
  conferir,
  devolver,
  disponibilizar,
  lerPainelTerceiros,
  receber,
  reprocessar,
  TIPOS_PROPRIETARIO,
  type TipoProprietario,
} from '../api-cme-terceiro.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['cirurgia', 'cme', 'terceiros'];
const painel = useQuery({ queryKey: CHAVE, queryFn: lerPainelTerceiros });
const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t('cirurgia.cmeTerceiro.gravado');
    void cliente.invalidateQueries({ queryKey: CHAVE });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

const vazio = computed(() => ({ valor: null, rotulo: t('cirurgia.cmeTerceiro.nenhum') }));
const situacao = (s: string) => t(`cirurgia.cmeTerceiro.situacoes.${s}`);
const opcTipos = computed(() =>
  TIPOS_PROPRIETARIO.map((x) => ({ valor: x, rotulo: t(`cirurgia.cmeTerceiro.tipos.${x}`) })),
);

// Busca remota dos donos (fornecedor ou profissional).
const termoDono = ref('');
const termoFornecedor = ref('');
const tipoBusca = (tp: TipoProprietario) => (tp === 'profissional' ? 'profissional' : 'fornecedor');
const novo = reactive({
  descricao: '',
  tipoProprietario: 'fornecedor' as TipoProprietario,
  dono: null as number | null,
  codigoBarras: '',
  quantidadePecas: null as number | null,
  validadeDias: null as number | null,
  expurgo: true,
  lavagem: true,
  desinfeccao: false,
  preparo: true,
  esterilizacao: true,
});
const precisaDono = computed(
  () => novo.tipoProprietario === 'fornecedor' || novo.tipoProprietario === 'profissional',
);
const donos = useQuery({
  queryKey: computed(() => [...CHAVE, 'donos', tipoBusca(novo.tipoProprietario), termoDono.value]),
  queryFn: () => buscarDonos(tipoBusca(novo.tipoProprietario), termoDono.value),
  enabled: precisaDono,
});
const fornecedores = useQuery({
  queryKey: computed(() => [...CHAVE, 'donos', 'fornecedor', termoFornecedor.value]),
  queryFn: () => buscarDonos('fornecedor', termoFornecedor.value),
});
watch(
  () => novo.tipoProprietario,
  () => (novo.dono = null),
);
const opcDonos = computed(() => [
  vazio.value,
  ...(donos.data.value ?? []).map((d) => ({ valor: d.id, rotulo: d.nome })),
]);
const opcFornecedores = computed(() => [
  vazio.value,
  ...(fornecedores.data.value ?? []).map((d) => ({ valor: d.id, rotulo: d.nome })),
]);
function cadastrar() {
  acao.mutate(() =>
    cadastrarMaterial({
      descricao: novo.descricao,
      tipoProprietario: novo.tipoProprietario,
      fornecedor: novo.tipoProprietario === 'fornecedor' ? novo.dono : null,
      profissional: novo.tipoProprietario === 'profissional' ? novo.dono : null,
      codigoBarras: novo.codigoBarras.trim() || null,
      quantidadePecas: novo.quantidadePecas,
      validadeDias: novo.validadeDias,
      expurgo: novo.expurgo,
      lavagem: novo.lavagem,
      desinfeccao: novo.desinfeccao,
      preparo: novo.preparo,
      esterilizacao: novo.esterilizacao,
    }),
  );
}

// Recebimento.
const rec = reactive({
  cme: null as number | null,
  fornecedor: null as number | null,
  agendamento: null as number | null,
  entregador: '',
  material: null as number | null,
  quantidade: 1,
  itens: [] as { material: number; quantidade: number }[],
});
const opcSetores = computed(() => [
  vazio.value,
  ...(painel.data.value?.setores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const opcAgendamentos = computed(() => [
  vazio.value,
  ...(painel.data.value?.agendamentos ?? []).map((a) => ({ valor: a.id, rotulo: a.numero })),
]);
const opcMateriais = computed(() => [
  vazio.value,
  ...(painel.data.value?.materiais ?? [])
    .filter((m) => m.ativo)
    .map((m) => ({ valor: m.id, rotulo: `${m.descricao}${m.dono ? ` · ${m.dono}` : ''}` })),
]);
const nomeMaterial = (id: number) =>
  painel.data.value?.materiais.find((m) => m.id === id)?.descricao ?? String(id);
function incluirItem() {
  if (rec.material === null || !(rec.quantidade > 0)) return;
  rec.itens.push({ material: rec.material, quantidade: rec.quantidade });
  rec.material = null;
  rec.quantidade = 1;
}
function registrarRecebimento() {
  acao.mutate(() =>
    receber({
      cme: rec.cme!,
      fornecedor: rec.fornecedor,
      agendamento: rec.agendamento,
      entregador: rec.entregador.trim() || null,
      observacao: null,
      itens: rec.itens,
    }),
  );
}

// Recebimento escolhido: conferência, reprocessamento, disponibilidade e devolução.
const escolhido = ref<number | null>(null);
const opcRecebimentos = computed(() => [
  vazio.value,
  ...(painel.data.value?.recebimentos ?? []).map((r) => ({
    valor: r.id,
    rotulo: `${r.numero} · ${r.fornecedor ?? r.cme} · ${situacao(r.situacao)}`,
  })),
]);
const atual = computed(() => painel.data.value?.recebimentos.find((r) => r.id === escolhido.value) ?? null);
const conf = ref<Record<number, { conferido: boolean; divergencia: string }>>({});
const dev = ref<Record<number, { utilizada: number; devolvida: number; conferido: boolean }>>({});
const recebedor = ref('');
watch(atual, (r) => {
  conf.value = Object.fromEntries(
    (r?.itens ?? []).map((i) => [
      i.sequencia,
      { conferido: i.conferidoRecebimento, divergencia: i.divergencia ?? '' },
    ]),
  );
  dev.value = Object.fromEntries(
    (r?.itens ?? []).map((i) => [i.sequencia, { utilizada: 0, devolvida: i.recebida, conferido: false }]),
  );
  recebedor.value = '';
});
function gravarConferencia() {
  const r = atual.value!;
  acao.mutate(() =>
    conferir(
      r.id,
      r.versao,
      r.itens.map((i) => ({
        sequencia: i.sequencia,
        conferido: conf.value[i.sequencia]!.conferido,
        divergencia: conf.value[i.sequencia]!.divergencia.trim() || null,
      })),
    ),
  );
}
function gravarDevolucao() {
  const r = atual.value!;
  acao.mutate(() =>
    devolver(
      r.id,
      r.versao,
      recebedor.value.trim() || null,
      r.itens.map((i) => ({ sequencia: i.sequencia, ...dev.value[i.sequencia]! })),
    ),
  );
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cme-terceiro-titulo" data-testid="tela-cme-terceiros">
    <h1 id="cme-terceiro-titulo">{{ t('cirurgia.cmeTerceiro.titulo') }}</h1>
    <p>{{ t('cirurgia.cmeTerceiro.texto') }}</p>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cme-terceiro-aviso">{{ aviso }}</p>

    <template v-if="painel.data.value">
      <h2>{{ t('cirurgia.cmeTerceiro.novoMaterial') }}</h2>
      <form data-testid="cme-terceiro-material" @submit.prevent="cadastrar">
        <label
          >{{ t('cirurgia.cmeTerceiro.descricao') }}
          <input v-model="novo.descricao" maxlength="150" required data-testid="cme-terceiro-descricao"
        /></label>
        <SanteSelecao
          v-model="novo.tipoProprietario"
          :rotulo="t('cirurgia.cmeTerceiro.tipoProprietario')"
          :opcoes="opcTipos"
          data-testid="cme-terceiro-tipo"
        />
        <SanteSelecao
          v-if="precisaDono"
          v-model="novo.dono"
          :rotulo="t(`cirurgia.cmeTerceiro.${tipoBusca(novo.tipoProprietario)}`)"
          :opcoes="opcDonos"
          :buscar="(q: string) => (termoDono = q)"
          data-testid="cme-terceiro-dono"
        />
        <label
          >{{ t('cirurgia.cmeTerceiro.codigoBarras') }}
          <input v-model="novo.codigoBarras" maxlength="100" data-testid="cme-terceiro-codigo"
        /></label>
        <label
          >{{ t('cirurgia.cmeTerceiro.quantidadePecas') }}
          <input v-model.number="novo.quantidadePecas" type="number" min="1" data-testid="cme-terceiro-pecas"
        /></label>
        <label
          >{{ t('cirurgia.cmeTerceiro.validadeDias') }}
          <input v-model.number="novo.validadeDias" type="number" min="1" data-testid="cme-terceiro-validade"
        /></label>
        <fieldset>
          <legend>{{ t('cirurgia.cmeTerceiro.roteiro') }}</legend>
          <label
            v-for="k in ['expurgo', 'lavagem', 'desinfeccao', 'preparo', 'esterilizacao'] as const"
            :key="k"
            ><input v-model="novo[k]" type="checkbox" :data-testid="`cme-terceiro-${k}`" />
            {{ t(`cirurgia.cmeTerceiro.${k}`) }}</label
          >
        </fieldset>
        <button type="submit" :disabled="!novo.descricao.trim()" data-testid="cme-terceiro-cadastrar">
          {{ t('cirurgia.cmeTerceiro.cadastrar') }}
        </button>
      </form>

      <h2>{{ t('cirurgia.cmeTerceiro.materiais') }}</h2>
      <p v-if="!painel.data.value.materiais.length">{{ t('cirurgia.cmeTerceiro.semMateriais') }}</p>
      <ul v-else data-testid="cme-terceiro-materiais">
        <li v-for="m in painel.data.value.materiais" :key="m.id">
          {{ m.descricao }} · {{ t(`cirurgia.cmeTerceiro.tipos.${m.tipoProprietario}`) }}
          {{ m.dono ? `· ${m.dono}` : '' }}
        </li>
      </ul>

      <h2>{{ t('cirurgia.cmeTerceiro.novoRecebimento') }}</h2>
      <form data-testid="cme-terceiro-recebimento" @submit.prevent="registrarRecebimento">
        <SanteSelecao
          v-model="rec.cme"
          :rotulo="t('cirurgia.cmeTerceiro.cme')"
          :opcoes="opcSetores"
          data-testid="cme-terceiro-cme"
        />
        <SanteSelecao
          v-model="rec.fornecedor"
          :rotulo="t('cirurgia.cmeTerceiro.fornecedor')"
          :opcoes="opcFornecedores"
          :buscar="(q: string) => (termoFornecedor = q)"
          data-testid="cme-terceiro-rec-fornecedor"
        />
        <SanteSelecao
          v-model="rec.agendamento"
          :rotulo="t('cirurgia.cmeTerceiro.cirurgia')"
          :opcoes="opcAgendamentos"
          data-testid="cme-terceiro-rec-cirurgia"
        />
        <label
          >{{ t('cirurgia.cmeTerceiro.entregador') }}
          <input v-model="rec.entregador" maxlength="150" data-testid="cme-terceiro-entregador"
        /></label>
        <SanteSelecao
          v-model="rec.material"
          :rotulo="t('cirurgia.cmeTerceiro.material')"
          :opcoes="opcMateriais"
          data-testid="cme-terceiro-rec-material"
        />
        <label
          >{{ t('cirurgia.cmeTerceiro.quantidade') }}
          <input
            v-model.number="rec.quantidade"
            type="number"
            min="1"
            data-testid="cme-terceiro-rec-quantidade"
        /></label>
        <button
          type="button"
          :disabled="rec.material === null"
          data-testid="cme-terceiro-incluir"
          @click="incluirItem"
        >
          {{ t('cirurgia.cmeTerceiro.incluirItem') }}
        </button>
        <ul v-if="rec.itens.length" data-testid="cme-terceiro-rec-itens">
          <li v-for="(i, n) in rec.itens" :key="n">{{ nomeMaterial(i.material) }} · {{ i.quantidade }}</li>
        </ul>
        <button
          type="submit"
          :disabled="rec.cme === null || !rec.itens.length"
          data-testid="cme-terceiro-receber"
        >
          {{ t('cirurgia.cmeTerceiro.receber') }}
        </button>
      </form>

      <h2>{{ t('cirurgia.cmeTerceiro.recebimentos') }}</h2>
      <p v-if="!painel.data.value.recebimentos.length">{{ t('cirurgia.cmeTerceiro.semRecebimentos') }}</p>
      <template v-else>
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('cirurgia.cmeTerceiro.recebimento')"
          :opcoes="opcRecebimentos"
          data-testid="cme-terceiro-escolha"
        />
        <p v-if="!atual">{{ t('cirurgia.cmeTerceiro.escolhaRecebimento') }}</p>
        <article v-else data-testid="cme-terceiro-atual">
          <p>
            {{ t('cirurgia.cmeTerceiro.numero') }} {{ atual.numero }} ·
            {{ t('cirurgia.cmeTerceiro.situacao') }}:
            <strong data-testid="cme-terceiro-situacao">{{ situacao(atual.situacao) }}</strong> ·
            {{ t('cirurgia.cmeTerceiro.recebidoEm') }}
            {{ atual.recebidoEm ?? t('cirurgia.cmeTerceiro.nenhum') }} ·
            {{ t('cirurgia.cmeTerceiro.entregador') }}:
            {{ atual.entregador ?? t('cirurgia.cmeTerceiro.nenhum') }}
          </p>
          <p v-if="atual.pacotes.length" data-testid="cme-terceiro-pacotes">
            {{ t('cirurgia.cmeTerceiro.pacotes') }}:
            <span v-for="p in atual.pacotes" :key="p.id">{{ p.etiqueta }} ({{ p.situacao }}) </span>
          </p>

          <form
            v-if="atual.situacao === 'recebido' || atual.situacao === 'divergente'"
            data-testid="cme-terceiro-conferencia"
            @submit.prevent="gravarConferencia"
          >
            <h3>{{ t('cirurgia.cmeTerceiro.conferencia') }}</h3>
            <div v-for="i in atual.itens" :key="i.sequencia">
              <span>{{ i.descricao }} · {{ i.recebida }}</span>
              <label
                ><input
                  v-model="conf[i.sequencia]!.conferido"
                  type="checkbox"
                  :data-testid="`cme-terceiro-conf-${i.sequencia}`"
                />
                {{ t('cirurgia.cmeTerceiro.conferido') }}</label
              >
              <label
                >{{ t('cirurgia.cmeTerceiro.divergencia') }}
                <input
                  v-model="conf[i.sequencia]!.divergencia"
                  maxlength="500"
                  :data-testid="`cme-terceiro-div-${i.sequencia}`"
              /></label>
            </div>
            <button type="submit" data-testid="cme-terceiro-conferir">
              {{ t('cirurgia.cmeTerceiro.conferir') }}
            </button>
          </form>

          <button
            v-if="atual.situacao === 'conferido'"
            type="button"
            data-testid="cme-terceiro-reprocessar"
            @click="acao.mutate(() => reprocessar(atual!.id, atual!.versao))"
          >
            {{ t('cirurgia.cmeTerceiro.reprocessar') }}
          </button>
          <button
            v-if="atual.situacao === 'em_reprocessamento'"
            type="button"
            data-testid="cme-terceiro-disponibilizar"
            @click="acao.mutate(() => disponibilizar(atual!.id, atual!.versao))"
          >
            {{ t('cirurgia.cmeTerceiro.disponibilizar') }}
          </button>

          <form
            v-if="['conferido', 'disponivel', 'divergente'].includes(atual.situacao)"
            data-testid="cme-terceiro-devolucao"
            @submit.prevent="gravarDevolucao"
          >
            <h3>{{ t('cirurgia.cmeTerceiro.devolucao') }}</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ t('cirurgia.cmeTerceiro.material') }}</th>
                  <th scope="col">{{ t('cirurgia.cmeTerceiro.recebida') }}</th>
                  <th scope="col">{{ t('cirurgia.cmeTerceiro.utilizada') }}</th>
                  <th scope="col">{{ t('cirurgia.cmeTerceiro.devolvida') }}</th>
                  <th scope="col">{{ t('cirurgia.cmeTerceiro.conferidoDevolucao') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in atual.itens" :key="i.sequencia">
                  <td>{{ i.descricao }}</td>
                  <td>{{ i.recebida }}</td>
                  <td>
                    <input
                      v-model.number="dev[i.sequencia]!.utilizada"
                      type="number"
                      min="0"
                      :aria-label="`${t('cirurgia.cmeTerceiro.utilizada')} ${i.descricao}`"
                      :data-testid="`cme-terceiro-usada-${i.sequencia}`"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="dev[i.sequencia]!.devolvida"
                      type="number"
                      min="0"
                      :aria-label="`${t('cirurgia.cmeTerceiro.devolvida')} ${i.descricao}`"
                      :data-testid="`cme-terceiro-devolvida-${i.sequencia}`"
                    />
                  </td>
                  <td>
                    <input
                      v-model="dev[i.sequencia]!.conferido"
                      type="checkbox"
                      :aria-label="`${t('cirurgia.cmeTerceiro.conferidoDevolucao')} ${i.descricao}`"
                      :data-testid="`cme-terceiro-dev-conf-${i.sequencia}`"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <label
              >{{ t('cirurgia.cmeTerceiro.recebedor') }}
              <input v-model="recebedor" maxlength="150" data-testid="cme-terceiro-recebedor"
            /></label>
            <button type="submit" :disabled="!recebedor.trim()" data-testid="cme-terceiro-devolver">
              {{ t('cirurgia.cmeTerceiro.devolver') }}
            </button>
          </form>
        </article>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
