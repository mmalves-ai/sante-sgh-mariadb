<script setup lang="ts">
// Efeito no estoque dos documentos do dia (ficha do M41, seção 7; regras 2 e 3): painel de acompanhamento da onda 3 na
// tela de saldos. Para os documentos de estoque gravados aqui no dia, o que o banco produziu (valor pelo custo médio,
// saldo do mês, lote, consumo e saldo no local), com o documento sem o efeito esperado em destaque; os documentos do
// dia por tipo e local (gravados aqui e nas demais estações); os horários de medicamento prescritos e dispensados por
// unidade; as requisições pendentes; quantos usuários do local ainda entram pelo módulo de estoque (só contagens); o
// último mês fechado. E a conferência de saldo e preço médio (campo 10): o chave-usuário informa o que a outra estação
// mostra e a tela compara com o lido agora. Tudo leitura: nada grava.
import type { ConferenciaNumericaOnda3, EfeitosDocumento } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { conferirNumerica, lerPainelOnda3, lerRetratoNumerico } from '../api-suprimentos.js';
import { numero, qtd, reais, usarSuprimentos } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const { t } = useI18n();
const { locais } = usarSuprimentos();
const dia = ref<string | null>(null);
const local = ref('');
const opcoesLocal = computed(() => [
  { valor: '', rotulo: t('suprimentos.onda3.todosLocais') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: `${l.codigo} · ${l.nome}` })),
]);
const filtro = computed(() => ({
  ...(dia.value ? { dia: dia.value } : {}),
  local: local.value ? Number(local.value) : null,
}));
const p = useQuery({
  queryKey: computed(() => ['suprimentos', 'onda3', filtro.value]),
  queryFn: () => lerPainelOnda3(filtro.value),
});
const diaLido = computed(() => p.data.value?.dia ?? '');
const nomeLocal = (c: number | null) =>
  c === null ? '—' : (locais.value.find((l) => l.codigo === c)?.nome ?? String(c));
const EFEITOS: (keyof EfeitosDocumento)[] = ['valorizado', 'saldoMensal', 'consumo', 'lote', 'saldoLocal'];
const selo = (v: boolean | null) =>
  v === null
    ? t('suprimentos.onda3.naoSeAplica')
    : v
      ? t('suprimentos.onda3.sim')
      : t('suprimentos.onda3.nao');
const mes = (m: { ano: number; mes: number }) => `${String(m.mes).padStart(2, '0')}/${m.ano}`;

// ── Conferência numérica ─────────────────────────────────────────────────────────────────────────────────
const r = useQuery({
  queryKey: computed(() => ['suprimentos', 'onda3', 'numerica', diaLido.value, filtro.value.local]),
  queryFn: () =>
    lerRetratoNumerico({ ...(diaLido.value ? { dia: diaLido.value } : {}), local: filtro.value.local }),
  enabled: computed(() => diaLido.value !== ''),
});
const informado = reactive<Record<string, { saldo: string; preco: string }>>({});
const k = (x: { item: number; local: number | null }) => `${x.item}-${x.local ?? 0}`;
watch(
  () => r.data.value?.lidos,
  (lidos) => {
    for (const x of lidos ?? []) informado[k(x)] ??= { saldo: '', preco: '' };
  },
  { immediate: true },
);
function copiar(): void {
  for (const x of r.data.value?.lidos ?? [])
    informado[k(x)] = { saldo: String(x.saldo), preco: String(x.precoMedio) };
}
const resultado = ref<ConferenciaNumericaOnda3 | null>(null);
const erroConf = ref<unknown>(null);
const preenchidos = computed(() =>
  (r.data.value?.lidos ?? []).filter((x) => informado[k(x)]?.saldo !== '' && informado[k(x)]?.preco !== ''),
);
async function conferir(): Promise<void> {
  erroConf.value = null;
  resultado.value = null;
  try {
    resultado.value = await conferirNumerica(
      diaLido.value,
      preenchidos.value.map((x) => ({
        item: x.item,
        local: x.local,
        saldo: numero(informado[k(x)]!.saldo),
        precoMedio: numero(informado[k(x)]!.preco),
      })),
    );
  } catch (e) {
    erroConf.value = e;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="onda3-titulo" data-testid="painel-efeito-estoque">
    <h2 id="onda3-titulo">{{ t('suprimentos.onda3.titulo') }}</h2>
    <p>{{ t('suprimentos.onda3.texto') }}</p>
    <div class="filtros">
      <SanteData v-model="dia" :rotulo="t('suprimentos.onda3.dia')" editavel data-testid="onda3-dia" />
      <SanteSelecao
        id="onda3-local"
        v-model="local"
        :rotulo="t('suprimentos.onda3.local')"
        :opcoes="opcoesLocal"
        busca
        data-testid="onda3-local"
      />
    </div>
    <ErroSuprimentos v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p v-if="p.data.value.ultimoMesFechado" class="secundario" data-testid="onda3-mes-fechado">
        {{ t('suprimentos.onda3.ultimoMesFechado', { m: mes(p.data.value.ultimoMesFechado) }) }}
      </p>
      <SanteAlerta
        :texto="
          p.data.value.comAlerta
            ? t('suprimentos.onda3.comAlerta', { n: p.data.value.comAlerta })
            : t('suprimentos.onda3.semAlerta')
        "
        :variante="p.data.value.comAlerta ? 'aviso' : 'info'"
        data-testid="onda3-resumo-alerta"
      />

      <table class="tabela" data-testid="onda3-documentos">
        <caption>
          {{
            t('suprimentos.onda3.documentosPorSistema')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.onda3.documento') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.total') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.gravadosAqui') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.demais') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in p.data.value.documentos"
            :key="`${d.tipo}-${d.local}`"
            :data-testid="`onda3-doc-${d.tipo}-${d.local ?? 0}`"
          >
            <td>{{ t(`suprimentos.onda3.tipos.${d.tipo}`) }}</td>
            <td>{{ nomeLocal(d.local) }}</td>
            <td>{{ d.total }}</td>
            <td>{{ d.novo }}</td>
            <td>{{ d.demais }}</td>
          </tr>
        </tbody>
      </table>

      <table class="tabela" data-testid="onda3-efeitos">
        <caption>
          {{
            t('suprimentos.onda3.efeitos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.onda3.documento') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.itens') }}</th>
            <th v-for="e in EFEITOS" :key="e" scope="col">{{ t(`suprimentos.onda3.efeito.${e}`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in p.data.value.efeitos"
            :key="`${x.tipo}-${x.chave.ano}-${x.chave.mes}-${x.chave.doc}`"
            :class="{ destaque: x.alertas.length > 0 }"
            :data-testid="`onda3-efeito-${x.tipo}-${x.chave.doc}`"
          >
            <td>
              {{ t(`suprimentos.onda3.tipos.${x.tipo}`) }} {{ x.chave.doc }}/{{
                String(x.chave.mes).padStart(2, '0')
              }}
              <ul v-if="x.alertas.length" class="alertas" data-testid="alertas">
                <li v-for="a in x.alertas" :key="a">
                  <strong>{{ t(`suprimentos.onda3.alertas.${a}`) }}</strong>
                </li>
              </ul>
            </td>
            <td>{{ nomeLocal(x.local) }}</td>
            <td>{{ x.itens }}</td>
            <td v-for="e in EFEITOS" :key="e" :data-testid="`efeito-${e}`">{{ selo(x.efeitos[e]) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="p.data.value.efeitos.length === 0" data-testid="onda3-sem-documentos">
        {{ t('suprimentos.onda3.nenhumDocumento') }}
      </p>
      <p v-if="p.data.value.cortada" role="status">{{ t('suprimentos.onda3.cortada') }}</p>

      <table class="tabela" data-testid="onda3-horarios">
        <caption>
          {{
            t('suprimentos.onda3.horarios')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.onda3.unidade') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.prescritos') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.dispensados') }}</th>
            <th scope="col">{{ t('suprimentos.onda3.dispensadosAqui') }}</th>
            <th scope="col">%</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in p.data.value.horarios" :key="h.unidade" :data-testid="`onda3-horario-${h.unidade}`">
            <td>{{ h.unidade }}</td>
            <td>{{ h.prescritos }}</td>
            <td>{{ h.dispensados }}</td>
            <td>{{ h.dispensadosNovo }}</td>
            <td>{{ h.percentual === null ? '—' : `${h.percentual}%` }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="p.data.value.horarios.length === 0">{{ t('suprimentos.onda3.nenhumHorario') }}</p>

      <div class="colunas">
        <table class="tabela" data-testid="onda3-requisicoes">
          <caption>
            {{
              t('suprimentos.onda3.requisicoes')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in p.data.value.requisicoes" :key="q.local">
              <td>{{ q.local }} · {{ q.localNome }}</td>
              <td>{{ q.pendentes }}</td>
            </tr>
          </tbody>
        </table>
        <table class="tabela" data-testid="onda3-uso">
          <caption>
            {{
              t('suprimentos.onda3.uso')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.usuariosDoLocal') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.conectados', { d: 14 }) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in p.data.value.uso" :key="u.local">
              <td>{{ u.local }} · {{ u.localNome }}</td>
              <td>{{ u.usuariosDoLocal }}</td>
              <td>{{ u.conectadosNaJanela }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="p.data.value.requisicoes.length === 0" class="secundario">
        {{ t('suprimentos.onda3.nenhumaRequisicao') }}
      </p>
    </template>

    <form class="painel" data-testid="onda3-numerica" @submit.prevent="conferir">
      <h3>{{ t('suprimentos.onda3.numerica.titulo') }}</h3>
      <p>{{ t('suprimentos.onda3.numerica.texto') }}</p>
      <ErroSuprimentos v-if="r.error.value" :erro="r.error.value" />
      <p v-else-if="r.data.value && r.data.value.lidos.length === 0">
        {{ t('suprimentos.onda3.numerica.semItens') }}
      </p>
      <template v-else-if="r.data.value">
        <table class="tabela">
          <caption>
            {{
              t('suprimentos.onda3.numerica.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.onda3.numerica.item') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.numerica.saldoAqui') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.numerica.precoAqui') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.numerica.saldoOutra') }}</th>
              <th scope="col">{{ t('suprimentos.onda3.numerica.precoOutra') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in r.data.value.lidos" :key="k(x)" :data-testid="`onda3-num-${k(x)}`">
              <td>{{ x.item }}</td>
              <td>{{ nomeLocal(x.local) }}</td>
              <td>{{ qtd(x.saldo) }}</td>
              <td>{{ reais(x.precoMedio) }}</td>
              <td>
                <label class="oculto" :for="`num-s-${k(x)}`">{{
                  t('suprimentos.onda3.numerica.saldoOutra')
                }}</label>
                <input
                  :id="`num-s-${k(x)}`"
                  v-model="informado[k(x)]!.saldo"
                  inputmode="decimal"
                  data-testid="num-saldo"
                />
              </td>
              <td>
                <label class="oculto" :for="`num-p-${k(x)}`">{{
                  t('suprimentos.onda3.numerica.precoOutra')
                }}</label>
                <input
                  :id="`num-p-${k(x)}`"
                  v-model="informado[k(x)]!.preco"
                  inputmode="decimal"
                  data-testid="num-preco"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('suprimentos.onda3.numerica.copiar')"
            data-testid="num-copiar"
            @acionar="copiar"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('suprimentos.onda3.numerica.conferir')"
            :desabilitado="preenchidos.length === 0"
            data-testid="num-conferir"
          />
        </div>
      </template>
      <ErroSuprimentos v-if="erroConf" :erro="erroConf" />
      <div v-if="resultado" role="status" data-testid="num-resultado">
        <p v-if="resultado.divergencias.length === 0">
          {{ t('suprimentos.onda3.numerica.semDivergencia', { n: resultado.conferidos }) }}
        </p>
        <template v-else>
          <SanteAlerta
            :texto="t('suprimentos.onda3.numerica.comDivergencia', { n: resultado.divergencias.length })"
            variante="aviso"
          />
          <ul>
            <li v-for="d in resultado.divergencias" :key="`${d.item}-${d.local}-${d.campo}`">
              {{
                t('suprimentos.onda3.numerica.diferenca', {
                  i: d.item,
                  l: nomeLocal(d.local),
                  c: t(`suprimentos.onda3.numerica.campo.${d.campo}`),
                  e: d.esperado,
                  v: d.lido,
                })
              }}
            </li>
          </ul>
        </template>
      </div>
    </form>
  </section>
</template>

<style scoped>
.destaque {
  outline: 2px solid currentColor;
  outline-offset: -2px;
  font-weight: 600;
}
.alertas {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
}
.colunas {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.acoes {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
