<script setup lang="ts">
// Diferença de acomodação cobrada do paciente (F3.4, 04-INT linha 81): `/internacao/diferenca-acomodacao`. Visão por
// paciente pelo número do atendimento: a acomodação atual, as diferenças com o que já foi cobrado na conta particular e,
// na mesma tela, a proposta (validada na hora pela regra do domínio), o aceite (quem aceita e a conta particular, já
// escolhida quando só há uma) e recusar, encerrar ou cancelar. O aceite e a decisão refazem a cobrança na hora.
import { validarDiferenca } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aceitarDiferenca,
  decidirDiferenca,
  lerDiferencas,
  registrarDiferenca,
} from '../api-diferenca-acomodacao.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const numero = ref('');
const aberto = ref('');
const dados = useQuery({
  queryKey: computed(() => ['adt', 'diferenca', aberto.value]),
  queryFn: () => lerDiferencas(aberto.value),
  enabled: computed(() => aberto.value.length > 0),
});
const opAcomodacoes = computed(() =>
  (dados.data.value?.acomodacoes ?? []).map((c) => ({ valor: c.id, rotulo: c.rotulo })),
);
const opItens = computed(() =>
  (dados.data.value?.itens ?? []).map((c) => ({ valor: c.id, rotulo: c.rotulo })),
);
const opContas = computed(() =>
  (dados.data.value?.contasParticulares ?? []).map((c) => ({ valor: c.id, rotulo: c.rotulo })),
);

const f = reactive({
  direito: null as number | null,
  utilizada: null as number | null,
  item: null as number | null,
  valorDiario: 0,
  inicio: '',
  fim: '',
});
// A acomodação utilizada começa pela atual do paciente e o início pelo dia de hoje (menos cliques).
watch(
  () => dados.data.value,
  (d) => {
    if (!d) return;
    if (f.utilizada === null) f.utilizada = d.acomodacaoAtual?.id ?? null;
    if (!f.inicio) f.inicio = d.hoje;
    if (conta.value === null && d.contasParticulares.length === 1) conta.value = d.contasParticulares[0]!.id;
  },
);
const problemas = computed(() => {
  if (f.direito === null || f.utilizada === null || !f.inicio) return [];
  const e = validarDiferenca({
    id: 0,
    direito: f.direito,
    utilizada: f.utilizada,
    item: f.item,
    valorDiario: Number(f.valorDiario),
    inicio: f.inicio,
    fim: f.fim || null,
    situacao: 'proposta',
    aceite: false,
  });
  return e ? [e] : [];
});

const responsavel = ref('');
const conta = ref<number | null>(null);
const fimEncerrar = ref('');

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<{ mensagem: string }>) => fn(),
  onSuccess: (r) => {
    erro.value = null;
    aviso.value = r.mensagem || t('adt.diferencaAcomodacao.salvo');
    responsavel.value = '';
    void cliente.invalidateQueries({ queryKey: ['adt', 'diferenca'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const propor = () =>
  acao.mutate(() =>
    registrarDiferenca({
      internacao: dados.data.value!.internacao,
      direito: f.direito!,
      utilizada: f.utilizada!,
      item: f.item,
      valorDiario: Number(f.valorDiario),
      inicio: f.inicio,
      fim: f.fim || null,
    }),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="diferenca-titulo" data-testid="tela-diferenca-acomodacao">
    <h1 id="diferenca-titulo">{{ t('adt.diferencaAcomodacao.titulo') }}</h1>
    <p>{{ t('adt.diferencaAcomodacao.texto') }}</p>
    <form class="filtros" data-testid="diferenca-busca" @submit.prevent="aberto = numero.trim()">
      <label
        >{{ t('adt.diferencaAcomodacao.atendimento') }}
        <input v-model="numero" maxlength="20" required data-testid="diferenca-atendimento"
      /></label>
      <button type="submit" data-testid="diferenca-abrir">{{ t('adt.diferencaAcomodacao.buscar') }}</button>
    </form>
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="diferenca-aviso">{{ aviso }}</p>
    <ErroAdt v-if="dados.isError.value" :erro="dados.error.value" />

    <template v-if="dados.data.value">
      <p data-testid="diferenca-internacao">
        {{ t('adt.diferencaAcomodacao.internacao', { situacao: dados.data.value.situacaoInternacao }) }} ·
        {{
          t('adt.diferencaAcomodacao.acomodacaoAtual', {
            acomodacao:
              dados.data.value.acomodacaoAtual?.rotulo ?? t('adt.diferencaAcomodacao.semAcomodacao'),
          })
        }}
      </p>

      <p v-if="dados.data.value.diferencas.length === 0">{{ t('adt.diferencaAcomodacao.vazio') }}</p>
      <table v-else data-testid="diferenca-lista">
        <thead>
          <tr>
            <th>{{ t('adt.diferencaAcomodacao.colunas.acomodacoes') }}</th>
            <th>{{ t('adt.diferencaAcomodacao.colunas.valor') }}</th>
            <th>{{ t('adt.diferencaAcomodacao.colunas.periodo') }}</th>
            <th>{{ t('adt.diferencaAcomodacao.colunas.situacao') }}</th>
            <th>{{ t('adt.diferencaAcomodacao.colunas.cobrado') }}</th>
            <th>{{ t('adt.diferencaAcomodacao.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in dados.data.value.diferencas" :key="d.id" :data-testid="`diferenca-${d.id}`">
            <td>{{ t('adt.diferencaAcomodacao.de', { de: d.direito.rotulo, para: d.utilizada.rotulo }) }}</td>
            <td>{{ moeda(d.valorDiario) }}</td>
            <td>
              {{
                t('adt.diferencaAcomodacao.periodo', {
                  inicio: d.inicio,
                  fim: d.fim ?? t('adt.diferencaAcomodacao.emAberto'),
                })
              }}
            </td>
            <td :data-testid="`diferenca-situacao-${d.id}`">
              {{ t(`adt.diferencaAcomodacao.situacoes.${d.situacao}`) }}
              <small v-if="d.aceiteEm">
                {{
                  t('adt.diferencaAcomodacao.aceiteDe', {
                    responsavel: d.responsavel ?? '',
                    quando: d.aceiteEm,
                    conta: d.conta ?? '',
                  })
                }}
              </small>
            </td>
            <td :data-testid="`diferenca-cobrado-${d.id}`">
              {{
                t('adt.diferencaAcomodacao.cobradoDias', {
                  dias: d.diasCobrados,
                  total: moeda(d.totalCobrado),
                })
              }}
            </td>
            <td>
              <form
                v-if="d.situacao === 'proposta'"
                class="filtros"
                :data-testid="`diferenca-aceite-${d.id}`"
                @submit.prevent="
                  acao.mutate(() =>
                    aceitarDiferenca({
                      diferenca: d.id,
                      versao: d.versao,
                      responsavel: responsavel.trim(),
                      conta: conta,
                    }),
                  )
                "
              >
                <label
                  >{{ t('adt.diferencaAcomodacao.responsavel') }}
                  <input
                    v-model="responsavel"
                    minlength="3"
                    maxlength="150"
                    required
                    data-testid="diferenca-responsavel"
                /></label>
                <SanteSelecao
                  v-if="opContas.length"
                  v-model="conta"
                  :rotulo="t('adt.diferencaAcomodacao.contaParticular')"
                  :opcoes="opContas"
                  data-testid="diferenca-conta"
                />
                <p v-else role="alert">{{ t('adt.diferencaAcomodacao.semConta') }}</p>
                <button
                  type="submit"
                  :disabled="responsavel.trim().length < 3 || conta === null || acao.isPending.value"
                  data-testid="diferenca-aceitar"
                >
                  {{ t('adt.diferencaAcomodacao.aceitar') }}
                </button>
                <button
                  type="button"
                  :disabled="acao.isPending.value"
                  data-testid="diferenca-recusar"
                  @click="
                    acao.mutate(() =>
                      decidirDiferenca({ diferenca: d.id, versao: d.versao, acao: 'recusar' }),
                    )
                  "
                >
                  {{ t('adt.diferencaAcomodacao.recusar') }}
                </button>
              </form>
              <div v-else-if="d.situacao === 'aceita'" class="filtros">
                <label
                  >{{ t('adt.diferencaAcomodacao.encerrarEm') }}
                  <input
                    v-model="fimEncerrar"
                    type="date"
                    :min="d.inicio"
                    data-testid="diferenca-fim-encerrar"
                /></label>
                <button
                  type="button"
                  :disabled="acao.isPending.value"
                  data-testid="diferenca-encerrar"
                  @click="
                    acao.mutate(() =>
                      decidirDiferenca({
                        diferenca: d.id,
                        versao: d.versao,
                        acao: 'encerrar',
                        fim: fimEncerrar || null,
                      }),
                    )
                  "
                >
                  {{ t('adt.diferencaAcomodacao.encerrar') }}
                </button>
              </div>
              <button
                v-if="d.situacao === 'proposta' || d.situacao === 'aceita'"
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`diferenca-cancelar-${d.id}`"
                @click="
                  acao.mutate(() => decidirDiferenca({ diferenca: d.id, versao: d.versao, acao: 'cancelar' }))
                "
              >
                {{ t('adt.diferencaAcomodacao.cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form class="filtros" data-testid="diferenca-proposta" @submit.prevent="propor">
        <h2>{{ t('adt.diferencaAcomodacao.nova') }}</h2>
        <SanteSelecao
          v-model="f.direito"
          :rotulo="t('adt.diferencaAcomodacao.direito')"
          :opcoes="opAcomodacoes"
          data-testid="diferenca-direito"
        />
        <SanteSelecao
          v-model="f.utilizada"
          :rotulo="t('adt.diferencaAcomodacao.utilizada')"
          :opcoes="opAcomodacoes"
          data-testid="diferenca-utilizada"
        />
        <SanteSelecao
          v-model="f.item"
          :rotulo="t('adt.diferencaAcomodacao.item')"
          :opcoes="opItens"
          data-testid="diferenca-item"
        />
        <label
          >{{ t('adt.diferencaAcomodacao.valorDiario') }}
          <input
            v-model.number="f.valorDiario"
            type="number"
            min="0"
            step="0.01"
            required
            data-testid="diferenca-valor"
        /></label>
        <label
          >{{ t('adt.diferencaAcomodacao.inicio') }}
          <input v-model="f.inicio" type="date" required data-testid="diferenca-inicio"
        /></label>
        <label
          >{{ t('adt.diferencaAcomodacao.fim') }}
          <input v-model="f.fim" type="date" :min="f.inicio" data-testid="diferenca-fim"
        /></label>
        <ul v-if="problemas.length" class="problemas" data-testid="diferenca-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="
            f.direito === null || f.utilizada === null || problemas.length > 0 || acao.isPending.value
          "
          data-testid="diferenca-propor"
        >
          {{ t('adt.diferencaAcomodacao.propor') }}
        </button>
      </form>
    </template>
  </section>
</template>
