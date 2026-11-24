<script setup lang="ts">
// Auditoria da conta item a item (F3.7, 06-FAT linha 21): `/faturamento/contas/:id/auditoria-itens`.
// Uma tela por conta: abre a auditoria (interna ou da operadora, com a empresa externa), dá o parecer no próprio item
// (mantido, alterado, glosa interna com motivo, excluído) com o valor aceito calculado na hora pela regra do domínio,
// mostra o valor auditado previsto antes de concluir e aplica tudo na conta num clique. Auditorias anteriores ao lado.
import {
  avaliarParecerItem,
  cnpjValido,
  concluirAuditoria,
  type DecisaoItemAuditoria,
  DECISOES_ITEM_AUDITORIA,
  MODALIDADES_AUDITORIA,
} from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirAuditoria,
  cadastrarEmpresaAuditoria,
  cancelarAuditoriaConta,
  concluirAuditoriaConta,
  type ItemAuditado,
  lerAuditoriaItens,
  registrarParecer,
} from '../api-auditoria-tramite.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const conta = computed(() => Number(props.id));
const qc = useQueryClient();
const q = useQuery({
  queryKey: ['faturamento', 'auditoria-itens', conta],
  queryFn: () => lerAuditoriaItens(conta.value),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chave = () => crypto.randomUUID();
async function rodar(fn: () => Promise<unknown>) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = t('auditoriaTramite.feito');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'auditoria-itens'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Abrir ──
const abertura = reactive({
  modalidade: 'interna' as (typeof MODALIDADES_AUDITORIA)[number],
  empresaExternaId: null as number | null,
  bloqueiaConta: false,
});
const abrir = () =>
  rodar(() =>
    abrirAuditoria(
      conta.value,
      { ...abertura, empresaExternaId: abertura.modalidade === 'interna' ? null : abertura.empresaExternaId },
      chave(),
    ),
  );

// ── Parecer no item ──
const emParecer = ref<ItemAuditado | null>(null);
const parecer = reactive({
  decisao: 'mantido' as DecisaoItemAuditoria,
  quantidadeAceita: null as number | null,
  valorAceito: null as number | null,
  motivoGlosaId: null as number | null,
  justificativa: '',
});
function editar(i: ItemAuditado) {
  emParecer.value = i;
  Object.assign(parecer, {
    decisao: (i.parecer?.decisao ?? 'mantido') as DecisaoItemAuditoria,
    quantidadeAceita: i.parecer && i.parecer.decisao !== 'mantido' ? i.parecer.quantidadeAceita : null,
    valorAceito: null,
    motivoGlosaId: i.parecer?.motivoGlosaId ?? null,
    justificativa: i.parecer?.justificativa ?? '',
  });
}
const avaliado = computed(() =>
  emParecer.value
    ? avaliarParecerItem({
        quantidadeOriginal: emParecer.value.quantidade,
        valorOriginal: emParecer.value.valorTotal,
        ...parecer,
        justificativa: parecer.justificativa,
      })
    : null,
);
const errosParecer = computed(() => (avaliado.value && !avaliado.value.ok ? avaliado.value.erros : {}));
async function salvarParecer() {
  const a = q.data.value?.auditoria;
  if (!a || !emParecer.value) return;
  const ok = await rodar(() =>
    registrarParecer(
      a.id,
      { itemId: emParecer.value!.id, ...parecer, justificativa: parecer.justificativa || null },
      chave(),
    ),
  );
  if (ok) emParecer.value = null;
}

// ── Previsto e conclusão ──
const previsto = computed(() => {
  const d = q.data.value;
  if (!d?.auditoria) return null;
  return concluirAuditoria(
    d.auditoria.valorOriginal,
    d.itens
      .filter((i) => i.parecer)
      .map((i) => ({
        decisao: i.parecer!.decisao as DecisaoItemAuditoria,
        valorOriginal: i.valorTotal,
        valorAceito: i.parecer!.valorAceito,
        valorGlosa: i.parecer!.valorGlosa,
      })),
  );
});
const concluir = () => rodar(() => concluirAuditoriaConta(q.data.value!.auditoria!.id, chave()));
const motivoCancelamento = ref('');
const cancelar = () =>
  rodar(() => cancelarAuditoriaConta(q.data.value!.auditoria!.id, motivoCancelamento.value, chave()));

// ── Empresa externa ──
const empresa = reactive({ cnpj: '', razaoSocial: '', nome: '', codigo: '' });
const cnpjOk = computed(() => !empresa.cnpj || cnpjValido(empresa.cnpj));
const cadastrarEmpresa = () =>
  rodar(() => cadastrarEmpresaAuditoria({ ...empresa, codigo: empresa.codigo || null }, chave()));
</script>

<template>
  <section class="tela" data-testid="auditoria-itens">
    <p v-if="q.isLoading.value">{{ t('auditoriaTramite.carregando') }}</p>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <template v-if="q.data.value">
      <h1>{{ t('auditoriaTramite.auditoria.titulo', { numero: q.data.value.numero }) }}</h1>
      <p v-if="!q.data.value.editavel" class="secundario">{{ t('auditoriaTramite.auditoria.fechada') }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <p v-if="aviso" role="status">{{ aviso }}</p>

      <form v-if="!q.data.value.auditoria" class="filtros" data-testid="aud-abrir" @submit.prevent="abrir">
        <p class="secundario">{{ t('auditoriaTramite.auditoria.semAuditoria') }}</p>
        <label>
          {{ t('auditoriaTramite.auditoria.modalidade') }}
          <select v-model="abertura.modalidade" data-testid="aud-modalidade">
            <option v-for="m in MODALIDADES_AUDITORIA" :key="m" :value="m">
              {{ t(`auditoriaTramite.auditoria.modalidades.${m}`) }}
            </option>
          </select>
        </label>
        <label v-if="abertura.modalidade !== 'interna'">
          {{ t('auditoriaTramite.auditoria.empresa') }}
          <select v-model.number="abertura.empresaExternaId" data-testid="aud-empresa">
            <option v-for="e in q.data.value.empresas" :key="e.id" :value="e.id">{{ e.nome }}</option>
          </select>
        </label>
        <label>
          <input v-model="abertura.bloqueiaConta" type="checkbox" />
          {{ t('auditoriaTramite.auditoria.bloqueia') }}
        </label>
        <button type="submit" data-testid="aud-abrir-botao">
          {{ t('auditoriaTramite.auditoria.abrir') }}
        </button>
      </form>

      <template v-else>
        <p data-testid="aud-andamento">
          {{
            t('auditoriaTramite.auditoria.emAndamento', {
              modalidade: t(`auditoriaTramite.auditoria.modalidades.${q.data.value.auditoria.modalidade}`),
              auditor: q.data.value.auditoria.empresa ?? q.data.value.auditoria.auditor,
              valor: moeda(q.data.value.auditoria.valorOriginal),
            })
          }}
        </p>
        <table>
          <thead>
            <tr>
              <th>{{ t('auditoriaTramite.item') }}</th>
              <th>{{ t('auditoriaTramite.quantidade') }}</th>
              <th>{{ t('auditoriaTramite.valor') }}</th>
              <th>{{ t('auditoriaTramite.auditoria.parecer') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in q.data.value.itens" :key="i.id" :data-testid="`aud-item-${i.sequencia}`">
              <td>{{ i.codigo }} · {{ i.descricao }}</td>
              <td>{{ i.quantidade }}</td>
              <td>{{ moeda(i.valorTotal) }}</td>
              <td>
                <span v-if="i.parecer">
                  {{ t(`auditoriaTramite.auditoria.decisoes.${i.parecer.decisao}`) }}
                  <template v-if="i.parecer.decisao !== 'mantido'">
                    {{ '→' }} {{ i.parecer.quantidadeAceita }} {{ '·' }} {{ moeda(i.parecer.valorAceito) }}
                  </template>
                </span>
                <button
                  v-if="!['estornado', 'transferido'].includes(i.situacao)"
                  type="button"
                  :data-testid="`aud-parecer-${i.sequencia}`"
                  @click="editar(i)"
                >
                  {{ t('auditoriaTramite.auditoria.parecer') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <form v-if="emParecer" class="filtros" data-testid="aud-form-parecer" @submit.prevent="salvarParecer">
          <h2>{{ emParecer.codigo }} · {{ emParecer.descricao }}</h2>
          <fieldset>
            <label v-for="d in DECISOES_ITEM_AUDITORIA" :key="d">
              <input v-model="parecer.decisao" type="radio" :value="d" :data-testid="`aud-decisao-${d}`" />
              {{ t(`auditoriaTramite.auditoria.decisoes.${d}`) }}
            </label>
          </fieldset>
          <label v-if="parecer.decisao === 'alterado' || parecer.decisao === 'glosado'">
            {{ t('auditoriaTramite.auditoria.quantidadeAceita') }}
            <input
              v-model.number="parecer.quantidadeAceita"
              type="number"
              min="0"
              step="any"
              data-testid="aud-qtd"
            />
          </label>
          <label v-if="parecer.decisao === 'alterado' || parecer.decisao === 'glosado'">
            {{ t('auditoriaTramite.auditoria.valorAceito') }}
            <input
              v-model.number="parecer.valorAceito"
              type="number"
              min="0"
              step="0.01"
              data-testid="aud-valor"
            />
          </label>
          <label v-if="parecer.decisao === 'glosado'">
            {{ t('auditoriaTramite.motivo') }}
            <select v-model.number="parecer.motivoGlosaId" data-testid="aud-motivo">
              <option v-for="m in q.data.value.motivosGlosa" :key="m.id" :value="m.id">
                {{ m.codigo }} · {{ m.descricao }}
              </option>
            </select>
          </label>
          <label v-if="parecer.decisao !== 'mantido'">
            {{ t('auditoriaTramite.justificativa') }}
            <input v-model="parecer.justificativa" maxlength="2000" data-testid="aud-justificativa" />
          </label>
          <p v-if="avaliado?.ok" class="secundario" data-testid="aud-calculado">
            {{ avaliado.quantidadeAceita }} · {{ moeda(avaliado.valorAceito) }} ·
            {{ t('auditoriaTramite.auditoria.glosa') }} {{ moeda(avaliado.valorGlosa) }}
          </p>
          <p v-for="(m, k) in errosParecer" :key="k" role="alert">{{ m }}</p>
          <button type="submit" :disabled="!avaliado?.ok" data-testid="aud-salvar-parecer">
            {{ t('auditoriaTramite.auditoria.aplicar') }}
          </button>
          <button type="button" @click="emParecer = null">{{ t('auditoriaTramite.cancelar') }}</button>
        </form>

        <p v-if="previsto" data-testid="aud-previsto">
          {{
            t('auditoriaTramite.auditoria.previsto', {
              valor: moeda(previsto.valorAuditado),
              glosa: moeda(previsto.valorGlosaInterna),
            })
          }}
        </p>
        <button type="button" data-testid="aud-concluir" @click="concluir">
          {{ t('auditoriaTramite.auditoria.concluir') }}
        </button>
        <form class="filtros" @submit.prevent="cancelar">
          <label>
            {{ t('auditoriaTramite.auditoria.motivoCancelamento') }}
            <input v-model="motivoCancelamento" minlength="3" maxlength="500" required />
          </label>
          <button type="submit">{{ t('auditoriaTramite.cancelar') }}</button>
        </form>
      </template>

      <h2>{{ t('auditoriaTramite.auditoria.historico') }}</h2>
      <table v-if="q.data.value.historico.length">
        <tbody>
          <tr v-for="h in q.data.value.historico" :key="h.id">
            <td>{{ t(`auditoriaTramite.auditoria.modalidades.${h.modalidade}`) }}</td>
            <td>{{ h.empresa ?? h.auditor }}</td>
            <td>{{ h.situacao }}{{ h.resultado ? ` · ${h.resultado}` : '' }}</td>
            <td>
              {{ moeda(h.valorOriginal) }} {{ '→' }}
              {{ h.valorAuditado === null ? '—' : moeda(h.valorAuditado) }}
            </td>
            <td>{{ h.encerradaEm?.slice(0, 10) }}</td>
          </tr>
        </tbody>
      </table>

      <details>
        <summary>{{ t('auditoriaTramite.auditoria.empresas') }}</summary>
        <ul>
          <li v-for="e in q.data.value.empresas" :key="e.id">{{ e.nome }} · {{ e.cnpj }}</li>
        </ul>
        <form class="filtros" data-testid="aud-form-empresa" @submit.prevent="cadastrarEmpresa">
          <label>
            {{ t('auditoriaTramite.auditoria.cnpj') }}
            <input v-model="empresa.cnpj" required maxlength="18" />
          </label>
          <span v-if="!cnpjOk" role="alert">{{ t('auditoriaTramite.auditoria.cnpjInvalido') }}</span>
          <label>
            {{ t('auditoriaTramite.auditoria.razaoSocial') }}
            <input v-model="empresa.razaoSocial" required maxlength="250" />
          </label>
          <label>
            {{ t('auditoriaTramite.auditoria.nome') }}
            <input v-model="empresa.nome" required maxlength="150" />
          </label>
          <label>
            {{ t('auditoriaTramite.auditoria.codigo') }}
            <input v-model="empresa.codigo" maxlength="30" />
          </label>
          <button type="submit" :disabled="!cnpjOk">{{ t('auditoriaTramite.auditoria.novaEmpresa') }}</button>
        </form>
      </details>
    </template>
  </section>
</template>
