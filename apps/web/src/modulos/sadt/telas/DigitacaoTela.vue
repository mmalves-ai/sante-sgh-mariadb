<script setup lang="ts">
// Digitação e importação de resultados (ficha do M26, seção 7): `/sadt/resultados/digitacao`. Os exames recebidos a
// digitar do setor; ao abrir um, os elementos com a referência vigente no dia do exame (regra 5), a faixa crítica e o
// valor fora da referência destacados enquanto se digita (o servidor decide e confere de novo). Resultado liberado não
// muda aqui: só a retificação, na liberação. A importação de equipamento é do marco das interfaces (DP-17).
import { foraDaReferencia } from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerDigitacao, listarExamesSadt, novaChave, registrarResultado } from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import VariaveisSadt from '../componentes/VariaveisSadt.vue';
import { hojeLocal, usarSadt, valoresDasVariaveis, variaveisDigitadas } from '../usar-sadt.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const setor = ref('laboratorio');
const data = ref(hojeLocal());
const { pode, motivoSetor } = usarSadt(setor);
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'exames', 'aDigitar', setor.value, data.value]),
  queryFn: () => listarExamesSadt({ setor: setor.value, data: data.value, situacao: 'aDigitar' }),
});
const aberto = ref<number | null>(
  typeof rota.query['exame'] === 'string' ? Number(rota.query['exame']) : null,
);
const ficha = useQuery({
  queryKey: computed(() => ['sadt', 'digitacao', aberto.value]),
  queryFn: () => lerDigitacao(aberto.value as number),
  enabled: computed(() => aberto.value !== null),
});
const valores = ref<Record<number, string>>({});
const variaveis = ref<Record<number, string>>({});
const observacao = ref('');
watch(
  () => ficha.data.value,
  (f) => {
    valores.value = Object.fromEntries(
      (f?.elementos ?? []).map((e) => [
        e.codigo,
        e.valor?.numerico !== null && e.valor?.numerico !== undefined
          ? String(e.valor.numerico)
          : (e.valor?.alfa ?? ''),
      ]),
    );
    observacao.value = f?.observacoes[0] ?? '';
    variaveis.value = valoresDasVariaveis(f?.variaveis);
  },
);
const setores = computed(() =>
  (['laboratorio'] as const).map((s) => ({ valor: s, rotulo: t(`sadt.setores.${s}`) })),
);
const podeDigitar = computed(() => pode(setor.value, 'sadt.registrarResultado'));
const numero = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};
function marca(codigo: number): 'abaixo' | 'acima' | 'critico' | null {
  const e = ficha.data.value?.elementos.find((x) => x.codigo === codigo);
  const n = numero(valores.value[codigo] ?? '');
  if (!e || n === null) return null;
  if (
    e.critico &&
    ((e.critico.abaixoDe !== null && n < e.critico.abaixoDe) ||
      (e.critico.acimaDe !== null && n > e.critico.acimaDe))
  )
    return 'critico';
  return foraDaReferencia(n, { minimo: e.referencia.minimo, maximo: e.referencia.maximo });
}
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  const f = ficha.data.value;
  if (!f) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const elementos = f.elementos
      .filter((e) => !e.titulo && (valores.value[e.codigo] ?? '').trim() !== '')
      .map((e) => {
        const v = valores.value[e.codigo] ?? '';
        const n = e.numerico ? numero(v) : null;
        return { elemento: e.codigo, numerico: n, alfa: n === null ? v.trim() : null, absoluta: null };
      });
    const r = await registrarResultado(
      f.exame.id,
      {
        versao: f.exame.versao,
        elementos,
        observacoes: observacao.value.trim() ? [observacao.value.trim()] : [],
        variaveis: variaveisDigitadas(variaveis.value),
      },
      novaChave('digitar'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="digitacao-titulo" data-testid="tela-sadt-digitacao">
    <h1 id="digitacao-titulo">{{ t('sadt.digitacao.titulo') }}</h1>
    <p>{{ t('sadt.digitacao.texto') }}</p>
    <p class="secundario">{{ t('sadt.digitacao.importar') }}</p>
    <AvisoSadt :motivo="motivoSetor" />
    <div class="filtros">
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" />
      <span class="campo">
        <label for="digitacao-data">{{ t('sadt.data') }}</label>
        <input id="digitacao-data" v-model="data" type="date" />
      </span>
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
    <table v-else class="tabela" data-testid="tabela-digitacao">
      <caption>
        {{
          t('sadt.situacoes.aDigitar')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('sadt.paciente') }}</th>
          <th scope="col">{{ t('sadt.exame') }}</th>
          <th scope="col">{{ t('sadt.situacao') }}</th>
          <th scope="col">{{ t('sadt.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in lista.data.value.itens" :key="e.id">
          <td><PacienteSadt :paciente="e.paciente" /></td>
          <td>
            {{ e.exame.nome }}<strong v-if="e.urgente"> · {{ t('sadt.urgente') }}</strong>
          </td>
          <td>{{ e.estadoRotulo }}</td>
          <td>
            <SanteBotao
              variante="secundario"
              :rotulo="t('sadt.digitacao.abrir')"
              :data-testid="`digitacao-abrir-${e.id}`"
              @acionar="aberto = e.id"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <section
      v-if="ficha.data.value"
      class="painel"
      aria-labelledby="digitacao-ficha"
      data-testid="digitacao-ficha"
    >
      <h2 id="digitacao-ficha">{{ ficha.data.value.exame.exame.nome }}</h2>
      <p><PacienteSadt :paciente="ficha.data.value.exame.paciente" /></p>
      <SanteAlerta
        v-if="ficha.data.value.bloqueado"
        variante="aviso"
        :texto="t('sadt.digitacao.bloqueado')"
      />
      <SanteAlerta
        v-if="ficha.data.value.alertaDataInvalida"
        variante="aviso"
        :texto="t('sadt.digitacao.dataInvalida')"
      />
      <table class="tabela">
        <caption>
          {{
            t('sadt.digitacao.elemento')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.digitacao.elemento') }}</th>
            <th scope="col">{{ t('sadt.valor') }}</th>
            <th scope="col">{{ t('sadt.unidade') }}</th>
            <th scope="col">{{ t('sadt.digitacao.faixa') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in ficha.data.value.elementos" :key="e.codigo">
            <td>
              <label :for="`elemento-${e.codigo}`">{{ e.nome }}</label>
            </td>
            <td>
              <input
                v-if="!e.titulo"
                :id="`elemento-${e.codigo}`"
                v-model="valores[e.codigo]"
                :inputmode="e.numerico ? 'decimal' : 'text'"
                :disabled="ficha.data.value.bloqueado"
                :aria-describedby="`marca-${e.codigo}`"
                :data-testid="`digitacao-valor-${e.codigo}`"
              />
              <span :id="`marca-${e.codigo}`" class="secundario" :data-testid="`digitacao-marca-${e.codigo}`">
                <template v-if="marca(e.codigo) === 'critico'">
                  {{ t('sadt.digitacao.criticoAviso') }}</template
                >
                <template v-else-if="marca(e.codigo)"> {{ t('sadt.digitacao.fora') }}</template>
              </span>
            </td>
            <td>{{ e.unidade ?? '—' }}</td>
            <td>
              <template v-if="e.referencia.minimo !== null || e.referencia.maximo !== null">
                {{
                  t('sadt.digitacao.intervalo', {
                    de: e.referencia.minimo ?? '',
                    ate: e.referencia.maximo ?? '',
                  })
                }}
              </template>
              <template v-else>{{ e.referencia.texto ?? '—' }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <VariaveisSadt
        v-model="variaveis"
        :variaveis="ficha.data.value.variaveis"
        :bloqueado="ficha.data.value.bloqueado"
        prefixo="digitacao"
      />
      <span class="campo">
        <label for="digitacao-obs">{{ t('sadt.observacao') }}</label>
        <textarea id="digitacao-obs" v-model="observacao" rows="2" :disabled="ficha.data.value.bloqueado" />
      </span>
      <SanteBotao
        v-if="podeDigitar && !ficha.data.value.bloqueado"
        :rotulo="t('sadt.gravar')"
        :desabilitado="ocupado"
        data-testid="digitacao-gravar"
        @acionar="gravar"
      />
    </section>
    <p v-if="mensagem" role="status" data-testid="digitacao-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
