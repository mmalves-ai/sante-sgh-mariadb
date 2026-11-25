<script setup lang="ts">
// Encontro de contas (F8, 07-FIN linha 69): `/financeiro/tesouraria/encontro-contas`. O parceiro sai de uma lista que
// já traz só quem tem saldo a pagar e a receber ao mesmo tempo (mesmo CNPJ ou CPF), com os dois saldos no rótulo.
// Escolhido o parceiro, as parcelas em aberto dos dois lados aparecem já marcadas (menos as que estão noutro encontro
// pendente), e o compensado e o saldo líquido mudam na hora a cada marcação, com a frase de quem fica devendo a quem.
// Propor grava a proposta; aprovar e efetivar é de outra pessoa (o servidor confere a alçada do título a pagar e a
// segregação). O pendente se cancela e o efetivado se estorna, os dois com o motivo conferido enquanto se digita; a
// linha fica no histórico com o motivo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  cancelarEncontro,
  type EncontroContas,
  efetivarEncontro,
  estornarEncontro,
  lerEncontros,
  lerParceirosEncontro,
  lerParcelasDoParceiro,
  proporEncontro,
  resumoMarcacao,
} from '../api-encontro-contas.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const MOTIVO_MINIMO = 5;
const LADOS = ['pagar', 'receber'] as const;
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const OP = {
  propor: 'financeiro.proporEncontroContas',
  efetivar: 'financeiro.efetivarEncontroContas',
  cancelar: 'financeiro.cancelarEncontroContas',
  estornar: 'financeiro.estornarEncontroContas',
} as const;
const podeBaixar = (op: string) => pode(op, 'financeiro.tituloPagar.baixar');
const podeAprovar = (op: string) => pode(op, 'financeiro.tituloPagar.aprovar');

const parceiros = useQuery({
  queryKey: ['financeiro', 'encontro', 'parceiros'],
  queryFn: lerParceirosEncontro,
});
const encontros = useQuery({ queryKey: ['financeiro', 'encontro', 'lista'], queryFn: lerEncontros });
const parceiro = ref('');
const opcoesParceiros = computed(() => [
  { valor: '', rotulo: t('financeiro.encontro.escolhaParceiro') },
  ...(parceiros.data.value ?? []).map((p) => ({
    valor: String(p.id),
    rotulo: t('financeiro.encontro.parceiroRotulo', {
      nome: p.nome,
      pagar: reais(p.pagar),
      receber: reais(p.receber),
    }),
  })),
]);
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'encontro', 'parcelas', parceiro.value]),
  queryFn: () => lerParcelasDoParceiro(Number(parceiro.value)),
  enabled: computed(() => !!parceiro.value),
});

// Marcação: começa com todas as parcelas livres dos dois lados (menos cliques); cada clique muda o resumo na hora.
const marcadasPagar = ref<Set<number>>(new Set());
const marcadasReceber = ref<Set<number>>(new Set());
watch(
  () => parcelas.data.value,
  (p) => {
    marcadasPagar.value = new Set((p?.pagar ?? []).filter((x) => !x.emOutroEncontro).map((x) => x.id));
    marcadasReceber.value = new Set((p?.receber ?? []).filter((x) => !x.emOutroEncontro).map((x) => x.id));
  },
  { immediate: true },
);
function alternar(lado: 'pagar' | 'receber', id: number) {
  const alvo = lado === 'pagar' ? marcadasPagar : marcadasReceber;
  const s = new Set(alvo.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  alvo.value = s;
}
const resumo = computed(() =>
  resumoMarcacao(
    (parcelas.data.value?.pagar ?? []).filter((p) => marcadasPagar.value.has(p.id)),
    (parcelas.data.value?.receber ?? []).filter((p) => marcadasReceber.value.has(p.id)),
  ),
);
const fraseSaldo = computed(() => {
  const s = resumo.value.saldoLiquido;
  if (s > 0) return t('financeiro.encontro.saldoAFavor', { valor: reais(s) });
  if (s < 0) return t('financeiro.encontro.saldoContra', { valor: reais(-s) });
  return t('financeiro.encontro.saldoZero');
});
const faltaLado = computed(() => marcadasPagar.value.size === 0 || marcadasReceber.value.size === 0);

const dataEncontro = ref('');
watch(
  () => apoio.data.value?.hoje,
  (hoje) => {
    if (hoje && !dataEncontro.value) dataEncontro.value = hoje;
  },
  { immediate: true },
);
const observacao = ref('');
const podePropor = computed(
  () =>
    !gravando.value && !!parceiro.value && !faltaLado.value && !!dataEncontro.value && podeBaixar(OP.propor),
);

// Gravação comum: mensagem do servidor, nova chave e releitura.
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('encontro');
async function acao(f: (c: string) => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('encontro');
    fechar();
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function propor() {
  if (!podePropor.value) return;
  const obs = observacao.value.trim();
  void acao((c) =>
    proporEncontro(
      {
        fornecedor: Number(parceiro.value),
        data: dataEncontro.value,
        parcelasPagar: [...marcadasPagar.value],
        parcelasReceber: [...marcadasReceber.value],
        ...(obs ? { observacao: obs } : {}),
      },
      c,
    ),
  ).then(() => {
    if (!erro.value) observacao.value = '';
  });
}

// Cancelar o pendente ou estornar o efetivado: o motivo é conferido enquanto se digita.
const aberta = ref<{ modo: 'cancelar' | 'estornar'; encontro: EncontroContas } | null>(null);
const motivoTexto = ref('');
function abrir(modo: 'cancelar' | 'estornar', e: EncontroContas) {
  aberta.value = { modo, encontro: e };
  motivoTexto.value = '';
}
function fechar() {
  aberta.value = null;
  motivoTexto.value = '';
}
const maximoMotivo = computed(() => (aberta.value?.modo === 'estornar' ? 280 : 500));
const faltamMotivo = computed(() => Math.max(0, MOTIVO_MINIMO - motivoTexto.value.trim().length));
function confirmar() {
  const a = aberta.value;
  if (!a || faltamMotivo.value > 0) return;
  const m = motivoTexto.value.trim();
  void acao((c) =>
    a.modo === 'cancelar' ? cancelarEncontro(a.encontro.id, m, c) : estornarEncontro(a.encontro.id, m, c),
  );
}
const pendente = (e: EncontroContas) => e.situacao === 'aguardando_aprovacao' || e.situacao === 'aprovado';
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ec-titulo" data-testid="tela-fin-encontro">
    <h1 id="ec-titulo">{{ t('financeiro.encontro.titulo') }}</h1>
    <p>{{ t('financeiro.encontro.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('tesouraria')" />
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <form
      class="formulario"
      :aria-label="t('financeiro.encontro.propor')"
      data-testid="ec-proposta"
      @submit.prevent="propor"
    >
      <ErroFaturamento v-if="parceiros.error.value" :erro="parceiros.error.value" />
      <p v-else-if="parceiros.data.value && !parceiros.data.value.length" data-testid="ec-sem-parceiro">
        {{ t('financeiro.encontro.semParceiro') }}
      </p>
      <span v-else class="campo">
        <SanteSelecao
          v-model="parceiro"
          :rotulo="t('financeiro.encontro.parceiro')"
          :opcoes="opcoesParceiros"
          data-testid="ec-parceiro"
        />
      </span>

      <template v-if="parceiro && parcelas.data.value">
        <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
        <div v-for="lado in LADOS" :key="lado" :data-testid="`ec-lado-${lado}`">
          <h2>
            {{ lado === 'pagar' ? t('financeiro.encontro.ladoPagar') : t('financeiro.encontro.ladoReceber') }}
          </h2>
          <table v-if="parcelas.data.value[lado].length" class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.encontro.marcar') }}</th>
                <th scope="col">{{ t('financeiro.encontro.titulo_') }}</th>
                <th scope="col">{{ t('financeiro.encontro.parcela') }}</th>
                <th scope="col">{{ t('financeiro.encontro.vencimento') }}</th>
                <th scope="col">{{ t('financeiro.encontro.saldo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in parcelas.data.value[lado]" :key="p.id" :data-testid="`ec-${lado}-${p.id}`">
                <td>
                  <input
                    type="checkbox"
                    :checked="(lado === 'pagar' ? marcadasPagar : marcadasReceber).has(p.id)"
                    :disabled="p.emOutroEncontro"
                    :aria-label="
                      t('financeiro.encontro.marcarParcela', { parcela: p.parcela, titulo: p.titulo })
                    "
                    :data-testid="`ec-marca-${lado}-${p.id}`"
                    @change="alternar(lado, p.id)"
                  />
                </td>
                <td>
                  {{ p.titulo }}<span v-if="p.documento"> · {{ p.documento }}</span>
                  <span v-if="p.emOutroEncontro"> · {{ t('financeiro.encontro.emOutro') }}</span>
                </td>
                <td>{{ p.parcela }}</td>
                <td>{{ data(p.vencimento) }}</td>
                <td>{{ reais(p.saldo) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else>{{ t('financeiro.encontro.semParcela') }}</p>
        </div>

        <p class="resumo" aria-live="polite" data-testid="ec-resumo">
          {{
            t('financeiro.encontro.totais', {
              pagar: reais(resumo.totalPagar),
              receber: reais(resumo.totalReceber),
              compensado: reais(resumo.compensado),
              saldo: reais(resumo.saldoLiquido),
            })
          }}
          <br />
          <span v-if="faltaLado" data-testid="ec-falta-lado">{{ t('financeiro.encontro.faltaLado') }}</span>
          <span v-else data-testid="ec-frase-saldo">{{ fraseSaldo }}</span>
        </p>
        <span class="campo">
          <label for="ec-data">{{ t('financeiro.encontro.data') }}</label>
          <input id="ec-data" v-model="dataEncontro" type="date" data-testid="ec-data" />
        </span>
        <span class="campo">
          <label for="ec-observacao">{{ t('financeiro.encontro.observacao') }}</label>
          <input id="ec-observacao" v-model="observacao" maxlength="500" data-testid="ec-observacao" />
        </span>
        <button
          type="submit"
          :disabled="!podePropor"
          :title="motivo(OP.propor) ?? undefined"
          data-testid="ec-propor"
        >
          {{ t('financeiro.encontro.propor') }}
        </button>
      </template>
    </form>

    <h2>{{ t('financeiro.encontro.encontros') }}</h2>
    <ErroFaturamento v-if="encontros.error.value" :erro="encontros.error.value" />
    <table v-else-if="encontros.data.value?.length" class="tabela" data-testid="ec-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.encontro.numero') }}</th>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.encontro.parceiro') }}</th>
          <th scope="col">{{ t('financeiro.encontro.totalPagar') }}</th>
          <th scope="col">{{ t('financeiro.encontro.totalReceber') }}</th>
          <th scope="col">{{ t('financeiro.encontro.compensado') }}</th>
          <th scope="col">{{ t('financeiro.encontro.saldoLiquido') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in encontros.data.value" :key="e.id" :data-testid="`ec-linha-${e.id}`">
          <td>{{ e.numero }}</td>
          <td>{{ data(e.data) }}</td>
          <td>{{ e.parceiro }}</td>
          <td>{{ reais(e.totalPagar) }}</td>
          <td>{{ reais(e.totalReceber) }}</td>
          <td>{{ reais(e.compensado) }}</td>
          <td>{{ reais(e.saldoLiquido) }}</td>
          <td :data-testid="`ec-situacao-${e.id}`">
            {{ t(`financeiro.encontro.situacoes.${e.situacao}`) }}
            <span v-if="e.motivo"> · {{ e.motivo }}</span>
          </td>
          <td>
            <template v-if="pendente(e)">
              <button
                type="button"
                :disabled="gravando || !podeAprovar(OP.efetivar)"
                :title="motivo(OP.efetivar) ?? undefined"
                :data-testid="`ec-efetivar-${e.id}`"
                @click="acao((k) => efetivarEncontro(e.id, k))"
              >
                {{ t('financeiro.encontro.efetivar') }}
              </button>
              <button
                type="button"
                :disabled="gravando || !podeBaixar(OP.cancelar)"
                :title="motivo(OP.cancelar) ?? undefined"
                :data-testid="`ec-cancelar-${e.id}`"
                @click="abrir('cancelar', e)"
              >
                {{ t('financeiro.encontro.cancelarEncontro') }}
              </button>
            </template>
            <button
              v-else-if="e.situacao === 'efetivado'"
              type="button"
              :disabled="gravando || !podeAprovar(OP.estornar)"
              :title="motivo(OP.estornar) ?? undefined"
              :data-testid="`ec-estornar-${e.id}`"
              @click="abrir('estornar', e)"
            >
              {{ t('financeiro.encontro.estornar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="encontros.data.value">{{ t('financeiro.nenhum') }}</p>

    <form v-if="aberta" class="formulario" data-testid="ec-acao" @submit.prevent="confirmar">
      <h2>
        {{
          t('financeiro.encontro.acaoCom', {
            acao:
              aberta.modo === 'cancelar'
                ? t('financeiro.encontro.cancelarEncontro')
                : t('financeiro.encontro.estornar'),
            numero: aberta.encontro.numero,
            parceiro: aberta.encontro.parceiro,
          })
        }}
      </h2>
      <span class="campo">
        <label for="ec-motivo">{{ t('financeiro.encontro.motivo') }}</label>
        <textarea
          id="ec-motivo"
          v-model="motivoTexto"
          :maxlength="maximoMotivo"
          :aria-invalid="faltamMotivo > 0"
          aria-describedby="ec-motivo-falta"
          data-testid="ec-motivo"
        ></textarea>
        <small v-if="faltamMotivo > 0" id="ec-motivo-falta">
          {{ t('financeiro.encontro.motivoFalta', { n: faltamMotivo }) }}
        </small>
      </span>
      <button type="submit" :disabled="gravando || faltamMotivo > 0" data-testid="ec-confirmar">
        {{
          aberta.modo === 'cancelar'
            ? t('financeiro.encontro.confirmarCancelar')
            : t('financeiro.encontro.confirmarEstornar')
        }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.cancelar') }}</button>
    </form>
  </section>
</template>
