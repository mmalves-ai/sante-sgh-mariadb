<script setup lang="ts">
// Digitação e importação de resultados (ficha do M26, seção 7): `/sadt/resultados/digitacao`. Os exames recebidos a
// digitar do setor; ao abrir um, os elementos com a referência vigente no dia do exame (regra 5), a faixa crítica e o
// valor fora da referência destacados enquanto se digita (o servidor decide e confere de novo). Resultado liberado não
// muda aqui: só a retificação, na liberação. A importação de equipamento é do marco das interfaces (DP-17).
// A gravação vai pelo exame pedido ao banco do cliente; o valor crítico abre o aviso na própria gravação e a tela diz.
import { calcularAnalitos, foraDaReferencia } from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { listarCondicoesDaAmostra } from '../api-autoliberacao.js';
import { digitarResultado } from '../api-resultado.js';
import { lerDigitacao, listarExamesSadt, novaChave } from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import CulturaPainel from '../componentes/CulturaPainel.vue';
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
// Cultura e antibiograma (05-SADT linha 12): aberta da ficha do exame (ou direto por ?cultura=1).
const culturaAberta = ref(rota.query['cultura'] === '1');
watch(aberto, (novo, antigo) => {
  if (antigo !== null && novo !== antigo) culturaAberta.value = false;
});
const valores = ref<Record<number, string>>({});
const variaveis = ref<Record<number, string>>({});
const observacao = ref('');
// Condição da amostra (05-SADT linha 11): o que a bancada viu (hemólise, lipemia) vai para a autoliberação. Sem
// cadastro para o exame (ou sem o banco do cliente), o campo não aparece.
const exameDoCatalogo = computed(() => ficha.data.value?.exame.exame.id ?? null);
const condicoes = useQuery({
  queryKey: computed(() => ['sadt', 'autoliberacao', 'amostra', exameDoCatalogo.value]),
  queryFn: () => listarCondicoesDaAmostra(exameDoCatalogo.value as number),
  enabled: computed(() => exameDoCatalogo.value !== null),
  retry: false,
});
const amostra = ref<number[]>([]);
watch(aberto, () => {
  amostra.value = [];
});
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
// Analitos calculados (05-SADT linha 3): a conta é refeita pela regra do domínio enquanto se digita (o servidor
// calcula de novo ao gravar). Sem conta possível, a tela diz o que falta em vez de mostrar zero.
const calculos = computed(() => {
  const f = ficha.data.value;
  const comFormula = (f?.elementos ?? []).filter((e) => e.calculo);
  if (!f || !comFormula.length) return new Map<number, { ok: boolean; valor?: number; motivo?: string }>();
  return calcularAnalitos({
    formulas: comFormula.map((e) => ({
      analito: e.codigo,
      expressao: e.calculo?.expressao ?? '',
      casas: e.calculo?.casas ?? null,
      variaveis: (e.calculo?.variaveis ?? []).map((v) => ({
        id: v.codigo,
        identificador: v.identificador,
        descricao: v.identificador,
        fonte: v.fonte,
        analito: v.analito,
        dadoPaciente: v.dadoPaciente,
      })),
    })),
    valores: new Map(f.elementos.map((e) => [e.codigo, numero(valores.value[e.codigo] ?? '')])),
    digitadas: Object.fromEntries(
      Object.entries(variaveis.value).map(([k, v]) => [Number(k), numero(v ?? '')]),
    ),
    paciente: { idade: f.idadePaciente ?? null },
  }) as Map<number, { ok: boolean; valor?: number; motivo?: string }>;
});
const valorCalculado = (codigo: number): number | null => {
  const c = calculos.value.get(codigo);
  return c?.ok && c.valor !== undefined ? c.valor : null;
};
const opcoesResposta = (rs: readonly { codigo: number; texto: string }[]) => [
  { valor: '', rotulo: t('sadt.digitacao.escolha') },
  ...rs.map((r) => ({ valor: r.texto, rotulo: r.texto })),
];
const textoEscolhido = ref<number | ''>('');
const opcoesTexto = computed(() => [
  { valor: '' as number | '', rotulo: t('sadt.digitacao.escolha') },
  ...(ficha.data.value?.textosPadrao ?? []).map((x) => ({
    valor: x.codigo as number | '',
    rotulo: x.mnemonico ? `${x.descricao} · ${x.mnemonico}` : x.descricao,
  })),
]);
/** O texto padrão escolhido entra na observação (sem repetir o que já está lá). */
function inserirTexto(codigo: number | '' | null): void {
  const x = ficha.data.value?.textosPadrao?.find((y) => y.codigo === codigo);
  if (x && !observacao.value.includes(x.texto))
    observacao.value = [observacao.value.trim(), x.texto].filter(Boolean).join(' ');
  textoEscolhido.value = '';
}
function marca(codigo: number): 'abaixo' | 'acima' | 'critico' | null {
  const e = ficha.data.value?.elementos.find((x) => x.codigo === codigo);
  const n = e?.calculo ? valorCalculado(codigo) : numero(valores.value[codigo] ?? '');
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
      .filter((e) => !e.titulo && !e.calculo && (valores.value[e.codigo] ?? '').trim() !== '')
      .map((e) => {
        const v = valores.value[e.codigo] ?? '';
        const n = e.numerico ? numero(v) : null;
        return { elemento: e.codigo, numerico: n, alfa: n === null ? v.trim() : null };
      });
    const r = await digitarResultado(
      f.exame,
      {
        elementos,
        observacao: observacao.value.trim(),
        variaveis: variaveisDigitadas(variaveis.value),
        interferentesAmostra: amostra.value,
      },
      novaChave('digitar'),
    );
    mensagem.value =
      r.mensagem ?? t(r.gravado?.critico ? 'sadt.digitacao.gravadoCritico' : 'sadt.digitacao.gravado');
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
              <output
                v-if="e.calculo"
                :id="`elemento-${e.codigo}`"
                :aria-describedby="`marca-${e.codigo}`"
                :data-testid="`digitacao-calculado-${e.codigo}`"
                :title="t('sadt.digitacao.calculado', { formula: e.calculo.expressao })"
              >
                {{ valorCalculado(e.codigo) ?? calculos.get(e.codigo)?.motivo ?? '—' }}
              </output>
              <input
                v-else-if="!e.titulo"
                :id="`elemento-${e.codigo}`"
                v-model="valores[e.codigo]"
                :inputmode="e.numerico ? 'decimal' : 'text'"
                :disabled="ficha.data.value.bloqueado"
                :aria-describedby="`marca-${e.codigo}`"
                :data-testid="`digitacao-valor-${e.codigo}`"
              />
              <SanteSelecao
                v-if="!e.calculo && !e.titulo && e.respostasPadrao.length && !ficha.data.value.bloqueado"
                :model-value="
                  e.respostasPadrao.some((r) => r.texto === valores[e.codigo])
                    ? (valores[e.codigo] ?? '')
                    : ''
                "
                :rotulo="`${t('sadt.digitacao.respostaPadrao')}: ${e.nome}`"
                ocultar-rotulo
                :opcoes="opcoesResposta(e.respostasPadrao)"
                :data-testid="`digitacao-resposta-${e.codigo}`"
                @update:model-value="(v: string | number | null) => (valores[e.codigo] = String(v ?? ''))"
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
      <SanteSelecao
        v-if="ficha.data.value.textosPadrao?.length && !ficha.data.value.bloqueado"
        :model-value="textoEscolhido"
        :rotulo="t('sadt.digitacao.textoPadrao')"
        :opcoes="opcoesTexto"
        data-testid="digitacao-texto-padrao"
        @update:model-value="inserirTexto"
      />
      <fieldset
        v-if="condicoes.data.value?.length && !ficha.data.value.bloqueado"
        class="campo"
        data-testid="digitacao-amostra"
      >
        <legend>{{ t('sadt.autoliberacao.amostra.rotulo') }}</legend>
        <p class="secundario">{{ t('sadt.autoliberacao.amostra.ajuda') }}</p>
        <label v-for="c in condicoes.data.value" :key="c.id">
          <input v-model="amostra" type="checkbox" :value="c.id" :data-testid="`digitacao-amostra-${c.id}`" />
          {{ c.substancia }}
        </label>
      </fieldset>
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
      <SanteBotao
        variante="secundario"
        :rotulo="
          culturaAberta ? t('sadt.microbiologia.cultura.fechar') : t('sadt.microbiologia.cultura.abrir')
        "
        data-testid="digitacao-cultura"
        @acionar="culturaAberta = !culturaAberta"
      />
      <CulturaPainel v-if="culturaAberta && aberto !== null" :exame="aberto" />
    </section>
    <p v-if="mensagem" role="status" data-testid="digitacao-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
