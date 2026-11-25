<script setup lang="ts">
// Transferência da conta inteira para outra fonte pagadora (F3.7, 06-FAT linha 14), na tela de movimentos da conta.
// Desenho próprio: a troca de convênio registrada na internação aparece como sugestão (um clique preenche fonte, plano
// e o dia; nada é disparado sozinho), a conta nova é aberta na hora na fonte escolhida, a prévia mostra a cobertura de
// cada item no destino antes de gravar, as outras contas abertas do paciente na mesma fonte vão junto num lote, e cada
// transferência pode ser estornada com motivo (nada se apaga). As regras são as do domínio, conferidas na hora.
import { avaliarCoberturaDestino, validarDestinoNovo, validarLote } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  estornarTransferencia,
  lerPainelTransferencia,
  transferirConta,
  transferirLote,
} from '../api-transferencia-conta.js';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{ contaId: number }>();
const { t } = useI18n();
const qc = useQueryClient();
const escolha = reactive({ fonte: 0, plano: 0, desde: '', motivo: '', aceitar: false, justificativa: '' });
const lote = ref<number[]>([]);
const erro = ref<unknown>(null);
const aviso = ref('');
const destino = computed(() =>
  escolha.fonte > 0
    ? { fontePagadoraId: escolha.fonte, planoId: escolha.plano || null, desde: escolha.desde || null }
    : null,
);
const q = useQuery({
  queryKey: ['faturamento', 'transferencia-painel', () => props.contaId, destino],
  queryFn: () => lerPainelTransferencia(props.contaId, destino.value),
});
const podeAjustar = computed(() => pode('faturamento.auditoria.ajustar'));
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const planosDaFonte = computed(() => (q.data.value?.planos ?? []).filter((p) => p.fonteId === escolha.fonte));
const errosDestino = computed(() => {
  const d = q.data.value;
  if (!d || !escolha.fonte) return {};
  const plano = d.planos.find((p) => p.id === escolha.plano);
  return validarDestinoNovo(
    { situacao: d.situacao, fontePagadora: d.fontePagadoraId, plano: d.planoId },
    {
      fontePagadora: escolha.fonte,
      plano: escolha.plano || null,
      fonteDoPlano: plano ? plano.fonteId : null,
      fonteAtiva: true,
      planoAtivo: true,
    },
  );
});
const cobertura = computed(() =>
  avaliarCoberturaDestino(q.data.value?.previa ?? [], escolha.aceitar, escolha.justificativa),
);
const errosLote = computed(() => validarLote([props.contaId, ...lote.value], escolha.motivo));
const pronto = computed(
  () =>
    podeAjustar.value &&
    escolha.fonte > 0 &&
    (q.data.value?.previa.length ?? 0) > 0 &&
    !Object.keys(errosDestino.value).length &&
    !Object.keys(cobertura.value.erros).length &&
    !Object.keys(errosLote.value).length,
);

function usarSugestao() {
  const s = q.data.value?.sugestao;
  if (!s) return;
  escolha.fonte = s.fontePagadora;
  escolha.plano = s.plano ?? 0;
  escolha.desde = s.desde;
}
function trocarFonte() {
  escolha.plano = 0;
  escolha.aceitar = false;
}

async function atualizar() {
  await qc.invalidateQueries({ queryKey: ['faturamento'] });
}
async function transferir() {
  if (!pronto.value) return;
  erro.value = null;
  aviso.value = '';
  const corpo = {
    destinoNovo: { fontePagadoraId: escolha.fonte, planoId: escolha.plano || null },
    desde: escolha.desde || null,
    motivo: escolha.motivo.trim(),
    aceitarSemCobertura: escolha.aceitar,
    justificativaCobertura: escolha.aceitar ? escolha.justificativa.trim() : null,
  };
  try {
    const r = lote.value.length
      ? await transferirLote(
          { ...corpo, contas: [props.contaId, ...lote.value].map((c) => ({ contaOrigemId: c })) },
          crypto.randomUUID(),
        )
      : await transferirConta(props.contaId, corpo, crypto.randomUUID());
    const numero = String(r['contaDestinoNumero'] ?? '');
    aviso.value = t('transferenciaConta.feito', { numero });
    Object.assign(escolha, { fonte: 0, plano: 0, desde: '', motivo: '', aceitar: false, justificativa: '' });
    lote.value = [];
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}

const estornando = ref<number | null>(null);
const motivoEstorno = ref('');
async function estornar(id: number, numero: string) {
  if (motivoEstorno.value.trim().length < 5) return;
  erro.value = null;
  try {
    await estornarTransferencia(id, motivoEstorno.value.trim(), crypto.randomUUID());
    aviso.value = t('transferenciaConta.estornoFeito', { numero });
    estornando.value = null;
    motivoEstorno.value = '';
    await atualizar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section aria-labelledby="tc-titulo" data-testid="transferencia-conta">
    <h2 id="tc-titulo">{{ t('transferenciaConta.titulo') }}</h2>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <template v-else-if="q.data.value">
      <ErroFaturamento v-if="erro" :erro="erro" />
      <p v-if="aviso" role="status" data-testid="tc-aviso">{{ aviso }}</p>

      <div v-if="q.data.value.sugestao && podeAjustar" role="note" data-testid="tc-sugestao">
        {{
          t('transferenciaConta.sugestao', {
            fonte: q.data.value.sugestao.fonte,
            desde: q.data.value.sugestao.desde.split('-').reverse().join('/'),
            n: q.data.value.sugestao.itens.length,
          })
        }}
        <button type="button" data-testid="tc-usar-sugestao" @click="usarSugestao">
          {{ t('transferenciaConta.usarSugestao') }}
        </button>
      </div>

      <form
        v-if="podeAjustar && q.data.value.editavel"
        class="filtros"
        data-testid="tc-form"
        @submit.prevent="transferir"
      >
        <p v-if="!q.data.value.transferiveis" class="secundario">
          {{ t('transferenciaConta.nadaATransferir') }}
        </p>
        <SanteSelecao
          v-model="escolha.fonte"
          :rotulo="t('transferenciaConta.fonte')"
          :opcoes="[
            { valor: 0, rotulo: t('transferenciaConta.escolhaFonte'), desabilitada: true },
            ...q.data.value.fontes.map((f) => ({ valor: f.id, rotulo: f.nome })),
          ]"
          obrigatorio
          data-testid="tc-fonte"
          @update:model-value="trocarFonte"
        />
        <SanteSelecao
          v-model="escolha.plano"
          :rotulo="t('transferenciaConta.plano')"
          :opcoes="[
            { valor: 0, rotulo: t('transferenciaConta.semPlano') },
            ...planosDaFonte.map((p) => ({ valor: p.id, rotulo: p.descricao })),
          ]"
          data-testid="tc-plano"
        />
        <p v-if="Object.keys(errosDestino).length" class="erro" data-testid="tc-erro-destino">
          {{ Object.values(errosDestino).join(' ') }}
        </p>
        <label>
          {{ t('transferenciaConta.desde') }}
          <input v-model="escolha.desde" type="date" data-testid="tc-desde" />
        </label>

        <fieldset v-if="q.data.value.outrasContas.some((c) => c.aberta && c.transferiveis)">
          <legend>{{ t('transferenciaConta.lote') }}</legend>
          <label
            v-for="c in q.data.value.outrasContas.filter((x) => x.aberta && x.transferiveis)"
            :key="c.id"
          >
            <input v-model="lote" type="checkbox" :value="c.id" :data-testid="`tc-lote-${c.id}`" />
            {{ t('transferenciaConta.contaLote', { numero: c.numero, n: c.transferiveis }) }}
          </label>
        </fieldset>

        <template v-if="escolha.fonte && q.data.value.previa.length">
          <h3>{{ t('transferenciaConta.previa') }}</h3>
          <ul data-testid="tc-previa">
            <li v-for="p in q.data.value.previa" :key="p.id" :data-testid="`tc-previa-${p.id}`">
              {{ moeda(p.valorOrigem) }} ·
              {{
                p.precoNoDestino && p.valorDestino !== null
                  ? t('transferenciaConta.coberto', { valor: moeda(p.valorDestino) })
                  : t('transferenciaConta.semCobertura')
              }}
            </li>
          </ul>
          <p role="status">
            {{
              t('transferenciaConta.resumoPrevia', {
                n: q.data.value.previa.length,
                s: cobertura.semCobertura.length,
              })
            }}
          </p>
          <template v-if="cobertura.semCobertura.length">
            <label>
              <input v-model="escolha.aceitar" type="checkbox" data-testid="tc-aceitar" />
              {{ t('transferenciaConta.aceitar') }}
            </label>
            <label v-if="escolha.aceitar">
              {{ t('transferenciaConta.justificativa') }}
              <input v-model="escolha.justificativa" maxlength="400" data-testid="tc-justificativa" />
            </label>
            <p v-if="Object.keys(cobertura.erros).length" class="erro" data-testid="tc-erro-cobertura">
              {{ Object.values(cobertura.erros).join(' ') }}
            </p>
          </template>
        </template>

        <label>
          {{ t('transferenciaConta.motivo') }}
          <input v-model="escolha.motivo" minlength="5" maxlength="500" required data-testid="tc-motivo" />
        </label>
        <button type="submit" :disabled="!pronto" data-testid="tc-transferir">
          {{
            lote.length
              ? t('transferenciaConta.transferirLote', { c: lote.length + 1 })
              : t('transferenciaConta.transferir', { n: q.data.value.previa.length })
          }}
        </button>
      </form>

      <template v-if="q.data.value.transferencias.length">
        <h3>{{ t('transferenciaConta.historico') }}</h3>
        <ul data-testid="tc-historico">
          <li v-for="x in q.data.value.transferencias" :key="x.id" :data-testid="`tc-transf-${x.id}`">
            {{
              t('transferenciaConta.linha', {
                numero: x.numero,
                em: x.em.slice(0, 16).replace('T', ' '),
                origem: x.origem,
                destino: x.destino,
                motivo: x.motivo,
              })
            }}
            <strong v-if="x.situacao === 'estornada'">
              · {{ t('transferenciaConta.estornada', { motivo: x.motivoEstorno ?? '' }) }}
            </strong>
            <template v-else-if="podeAjustar">
              <button
                v-if="estornando !== x.id"
                type="button"
                :data-testid="`tc-estornar-${x.id}`"
                @click="((estornando = x.id), (motivoEstorno = ''))"
              >
                {{ t('transferenciaConta.estornar') }}
              </button>
              <span v-else>
                <label>
                  {{ t('transferenciaConta.motivoEstorno', { numero: x.numero }) }}
                  <input
                    v-model="motivoEstorno"
                    minlength="5"
                    maxlength="500"
                    data-testid="tc-motivo-estorno"
                  />
                </label>
                <button
                  type="button"
                  :disabled="motivoEstorno.trim().length < 5"
                  data-testid="tc-confirmar-estorno"
                  @click="estornar(x.id, x.numero)"
                >
                  {{ t('transferenciaConta.confirmarEstorno') }}
                </button>
              </span>
            </template>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
