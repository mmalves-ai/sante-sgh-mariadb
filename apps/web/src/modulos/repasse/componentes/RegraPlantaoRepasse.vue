<script setup lang="ts">
// Regras de plantão do repasse (C2-100, 06-FAT linha 47), na tela de regras do repasse: a lista com o alcance, o valor
// e a vigência (encerrar, nunca apagar) e a inclusão com a conferência do domínio na hora (a mesma do servidor) e o
// exemplo calculado de um plantão de 12 h em dia útil, fim de semana e feriado, antes de gravar. Combos pelo
// SanteSelecao; o profissional pela busca do repasse.
import type { RegraPlantaoEntrada } from '@sgh/contratos';
import { conferirRegraPlantao, valorPelaRegraPlantao } from '@sgh/dominio-pessoas';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  encerrarRegraPlantao,
  incluirRegraPlantao,
  lerApoioPlantao,
  lerRegrasPlantao,
} from '../api-regra-plantao.js';
import { reais, usarRepasse } from '../usar-repasse.js';
import BuscaPrestador from './BuscaPrestador.vue';

const { t } = useI18n();
const qc = useQueryClient();
const { tem } = usarRepasse();
const k = (c: string) => t(`repasse.regraPlantao.${c}`);
const podeLer = computed(() => tem('pessoas.realizado.ler'));
const podeEditar = computed(() => tem('pessoas.realizado.lancar'));

const regras = useQuery({
  queryKey: ['repasse', 'regras-plantao'],
  queryFn: lerRegrasPlantao,
  enabled: podeLer,
});
const apoio = useQuery({
  queryKey: ['repasse', 'regras-plantao', 'apoio'],
  queryFn: lerApoioPlantao,
  enabled: podeLer,
});
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const setores = computed(() => [
  { valor: '', rotulo: k('todosSetores') },
  ...(apoio.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.rotulo })),
]);
const dias = computed(() => [
  { valor: '', rotulo: k('todosDias') },
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ valor: String(d), rotulo: k(`dias.d${d}`) })),
]);
const formas = computed(() =>
  (['por_plantao', 'por_hora'] as const).map((f) => ({ valor: f, rotulo: k(`formas.${f}`) })),
);

const f = reactive({
  descricao: '',
  setor: '',
  escala: '',
  medico: '',
  diaSemana: '',
  forma: 'por_plantao',
  horas: '12',
  valorPadrao: '',
  valorFimSemana: '',
  valorFeriado: '',
  percentualFeriado: '',
  fator: '',
  extraAntes: '',
  percentualExtraAntes: '',
  extraDepois: '',
  percentualExtraDepois: '',
  tolerancia: '15',
  inicio: '',
  fim: '',
});
watch(hoje, (h) => {
  if (!f.inicio) f.inicio = h;
});
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));
const id = (v: string) => (Number(v) > 0 ? Number(v) : null);

const corpo = computed<RegraPlantaoEntrada>(() => ({
  descricao: f.descricao.trim(),
  profissional: id(f.medico),
  escala: id(f.escala),
  setor: id(f.setor),
  especialidade: null,
  diaSemana: id(f.diaSemana),
  forma: f.forma === 'por_hora' ? 'por_hora' : 'por_plantao',
  horasPlantao: f.forma === 'por_hora' ? null : n(f.horas),
  valorPadrao: n(f.valorPadrao) ?? 0,
  valorFimSemana: n(f.valorFimSemana),
  valorFeriado: n(f.valorFeriado),
  percentualFeriado: n(f.percentualFeriado),
  fator: n(f.fator),
  valorHoraExtraAntes: n(f.extraAntes),
  percentualHoraExtraAntes: n(f.percentualExtraAntes),
  valorHoraExtraDepois: n(f.extraDepois),
  percentualHoraExtraDepois: n(f.percentualExtraDepois),
  toleranciaMinutos: n(f.tolerancia) ?? 0,
  inicio: f.inicio,
  fim: f.fim || null,
}));
// A conferência do domínio enquanto digita: o botão só grava o que o servidor aceitaria.
const problema = computed(() => {
  const c = corpo.value;
  const numeros = [
    c.valorPadrao,
    c.horasPlantao,
    c.valorFimSemana,
    c.valorFeriado,
    c.fator,
    c.toleranciaMinutos,
  ];
  if (numeros.some((x) => x !== null && Number.isNaN(x))) return k('valor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.inicio)) return k('inicio');
  return conferirRegraPlantao(c)?.mensagem ?? null;
});
// O exemplo calculado pela mesma regra do servidor: 12 h cumpridas numa quarta, num sábado e num feriado.
const exemplos = computed(() => {
  if (problema.value) return [];
  const regra = { ...corpo.value, id: 0, fim: null, inicio: '2000-01-01' };
  return (
    [
      ['util', '2031-06-04', new Set<string>()],
      ['fim_semana', '2031-06-07', new Set<string>()],
      ['feriado', '2031-06-04', new Set(['2031-06-04'])],
    ] as const
  ).map(([tipo, d, feriados]) => {
    const p = {
      profissional: regra.profissional,
      escala: regra.escala ?? 0,
      setor: regra.setor ?? 0,
      especialidade: null,
      previstoInicio: `${d}T07:00`,
      previstoFim: `${d}T19:00`,
      realInicio: `${d}T07:00`,
      realFim: `${d}T19:00`,
    };
    return { tipo, valor: valorPelaRegraPlantao(regra, p, feriados).valor };
  });
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function acao(fn: () => Promise<unknown>, texto: string) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await fn();
    mensagem.value = texto;
    await qc.invalidateQueries({ queryKey: ['repasse', 'regras-plantao'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function incluir() {
  if (problema.value) return;
  void acao(async () => {
    await incluirRegraPlantao(corpo.value);
    Object.assign(f, { descricao: '', valorPadrao: '', valorFimSemana: '', valorFeriado: '', fim: '' });
  }, k('incluida'));
}
const fimEncerrar = reactive<Record<number, string>>({});
function encerrar(regra: number) {
  void acao(() => encerrarRegraPlantao(regra, fimEncerrar[regra] || hoje.value), k('encerrada'));
}
const alcance = (r: {
  setorNome: string | null;
  escala: number | null;
  profissional: number | null;
  diaSemana: number | null;
}) =>
  [
    r.setorNome,
    r.escala !== null ? `${k('escala')} ${r.escala}` : null,
    r.profissional !== null ? `${k('medico')} ${r.profissional}` : null,
    r.diaSemana !== null ? k(`dias.d${r.diaSemana}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <section v-if="podeLer" class="painel" aria-labelledby="rp-titulo" data-testid="rp-regras-plantao">
    <h2 id="rp-titulo">{{ k('secao') }}</h2>
    <p>{{ k('explica') }}</p>
    <ErroFaturamento v-if="regras.error.value" :erro="regras.error.value" />
    <table v-if="regras.data.value?.itens.length" class="tabela" data-testid="rp-lista">
      <thead>
        <tr>
          <th scope="col">{{ k('descricao') }}</th>
          <th scope="col">{{ k('alcance') }}</th>
          <th scope="col">{{ k('valor') }}</th>
          <th scope="col">{{ k('vigencia') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value.itens" :key="r.id" :data-testid="`rp-regra-${r.id}`">
          <td>{{ r.descricao }}</td>
          <td>{{ alcance(r) }}</td>
          <td>
            {{ reais(r.valorPadrao) }} · {{ k(`formas.${r.forma}`) }}
            <small v-if="r.valorFimSemana !== null">
              · {{ k('exemplos.fim_semana') }} {{ reais(r.valorFimSemana) }}</small
            >
            <small v-if="r.valorFeriado !== null">
              · {{ k('exemplos.feriado') }} {{ reais(r.valorFeriado) }}</small
            >
          </td>
          <td>{{ `${r.inicio} – ${r.fim ?? k('semFim')}` }}</td>
          <td>
            <template v-if="podeEditar && (r.fim === null || r.fim > hoje)">
              <label class="visualmente-oculto" :for="`rp-fim-${r.id}`">{{ k('encerrarEm') }}</label>
              <input
                :id="`rp-fim-${r.id}`"
                v-model="fimEncerrar[r.id]"
                type="date"
                :data-testid="`rp-fim-${r.id}`"
              />
              <button
                type="button"
                :disabled="gravando"
                :data-testid="`rp-encerrar-${r.id}`"
                @click="encerrar(r.id)"
              >
                {{ k('encerrar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="regras.data.value" data-testid="rp-nenhuma">{{ k('nenhuma') }}</p>

    <form v-if="podeEditar" class="formulario" data-testid="rp-form" @submit.prevent="incluir">
      <span class="campo">
        <label for="rp-descricao">{{ k('descricao') }}</label>
        <input id="rp-descricao" v-model="f.descricao" maxlength="150" data-testid="rp-descricao" />
      </span>
      <span class="campo">
        <SanteSelecao v-model="f.setor" :rotulo="k('setor')" :opcoes="setores" data-testid="rp-setor" />
      </span>
      <span class="campo">
        <label for="rp-escala">{{ k('escala') }}</label>
        <input id="rp-escala" v-model="f.escala" inputmode="numeric" data-testid="rp-escala" />
      </span>
      <BuscaPrestador v-model="f.medico" :rotulo="k('medico')" testid="rp-medico" qualquer />
      <span class="campo">
        <SanteSelecao v-model="f.diaSemana" :rotulo="k('diaSemana')" :opcoes="dias" data-testid="rp-dia" />
      </span>
      <span class="campo">
        <SanteSelecao v-model="f.forma" :rotulo="k('forma')" :opcoes="formas" data-testid="rp-forma" />
      </span>
      <span v-if="f.forma === 'por_plantao'" class="campo">
        <label for="rp-horas">{{ k('horas') }}</label>
        <input id="rp-horas" v-model="f.horas" inputmode="decimal" data-testid="rp-horas" />
      </span>
      <span
        v-for="c in [
          'valorPadrao',
          'valorFimSemana',
          'valorFeriado',
          'percentualFeriado',
          'fator',
          'extraAntes',
          'percentualExtraAntes',
          'extraDepois',
          'percentualExtraDepois',
          'tolerancia',
        ] as const"
        :key="c"
        class="campo"
      >
        <label :for="`rp-${c}`">{{ k(c) }}</label>
        <input :id="`rp-${c}`" v-model="f[c]" inputmode="decimal" :data-testid="`rp-${c}`" />
      </span>
      <span class="campo">
        <label for="rp-inicio">{{ k('inicio') }}</label>
        <input id="rp-inicio" v-model="f.inicio" type="date" data-testid="rp-inicio" />
      </span>
      <span class="campo">
        <label for="rp-fim">{{ k('fim') }}</label>
        <input id="rp-fim" v-model="f.fim" type="date" data-testid="rp-fim" />
      </span>
      <p v-if="problema" role="status" data-testid="rp-problema">{{ problema }}</p>
      <div v-else-if="exemplos.length" data-testid="rp-exemplo">
        <strong>{{ k('exemplo') }}</strong>
        <ul>
          <li v-for="e in exemplos" :key="e.tipo" :data-testid="`rp-exemplo-${e.tipo}`">
            {{ k(`exemplos.${e.tipo}`) }}: {{ reais(e.valor) }}
          </li>
        </ul>
      </div>
      <button type="submit" :disabled="gravando || problema !== null" data-testid="rp-incluir">
        {{ k('incluir') }}
      </button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rp-mensagem" />
  </section>
</template>
