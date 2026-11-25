<script setup lang="ts">
// Valor fixo mensal e mínimo garantido do médico (C2-100, 06-FAT linha 47), na tela de regras do repasse: escolhido o
// médico, as regras vigentes dele com o encerramento (nada apagado), a inclusão com a conferência do domínio na hora
// (mesma regra do servidor) e, numa apuração em aberto, o que vai ser lançado (o fixo uma vez por competência e o
// complemento do mínimo sobre a produção) com o botão de lançar. Combos pelo SanteSelecao.
import { validarMinimoGarantido, validarValorFixo } from '@sgh/dominio-repasse';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  encerrarRegraVariavel,
  incluirFixo,
  incluirMinimo,
  lancarVariavel,
  lerPainelVariavel,
  simularVariavel,
  type TipoRegraVariavel,
} from '../api-remuneracao-variavel.js';
import { reais, usarRepasse } from '../usar-repasse.js';
import BuscaPrestador from './BuscaPrestador.vue';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const k = (c: string) => t(`repasse.remuneracaoVariavel.${c}`);
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const podeEditar = computed(() => tem('repasse.regra.propor'));
const podeLancar = computed(() => tem('repasse.lancamento.criar'));

const medico = ref('');
const prof = computed(() => Number(medico.value) || 0);
const painel = useQuery({
  queryKey: computed(() => ['repasse', 'fixo-minimo', prof.value]),
  queryFn: () => lerPainelVariavel(prof.value),
  enabled: computed(() => prof.value > 0),
});
const eventos = computed(() =>
  (painel.data.value?.eventos ?? []).map((e) => ({ valor: String(e.id), rotulo: `${e.codigo} · ${e.nome}` })),
);
const apuracoes = computed(() =>
  (painel.data.value?.apuracoes ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: `${a.numero} · ${a.competencia.slice(0, 7)} · ${a.situacao}`,
  })),
);
const n = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/\./g, '').replace(',', '.')));

const fixo = reactive({ descricao: '', valor: '', dia: '', evento: '', inicio: '', fim: '' });
const minimo = reactive({ valor: '', evento: '', inicio: '', fim: '' });
watch(eventos, (lista) => {
  const primeiro = lista[0]?.valor ?? '';
  if (!fixo.evento) fixo.evento = primeiro;
  if (!minimo.evento) minimo.evento = primeiro;
});
watch(hoje, (h) => {
  if (!fixo.inicio) fixo.inicio = h;
  if (!minimo.inicio) minimo.inicio = h;
});

// A conferência do domínio enquanto digita: o botão só grava o que o servidor aceitaria.
const problemasFixo = computed(() => {
  const dia = fixo.dia.trim() === '' ? null : Number(fixo.dia);
  const p = validarValorFixo({
    descricao: fixo.descricao,
    valorMensal: n(fixo.valor),
    diaPagamento: dia,
    inicio: fixo.inicio,
    fim: fixo.fim || null,
  }).map((x) => x.mensagem);
  if (!fixo.evento) p.push(k('evento'));
  return p;
});
const problemasMinimo = computed(() => {
  const p = validarMinimoGarantido({
    valorMinimo: n(minimo.valor),
    inicio: minimo.inicio,
    fim: minimo.fim || null,
  }).map((x) => x.mensagem);
  if (!minimo.evento) p.push(k('evento'));
  return p;
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
    await qc.invalidateQueries({ queryKey: ['repasse', 'fixo-minimo'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function gravarFixo() {
  if (problemasFixo.value.length) return;
  void acao(async () => {
    await incluirFixo({
      profissional: prof.value,
      descricao: fixo.descricao.trim(),
      valorMensal: n(fixo.valor),
      evento: Number(fixo.evento),
      diaPagamento: fixo.dia.trim() === '' ? null : Number(fixo.dia),
      inicio: fixo.inicio,
      fim: fixo.fim || null,
    });
    Object.assign(fixo, { descricao: '', valor: '', dia: '', fim: '' });
  }, k('gravado'));
}
function gravarMinimo() {
  if (problemasMinimo.value.length) return;
  void acao(async () => {
    await incluirMinimo({
      profissional: prof.value,
      valorMinimo: n(minimo.valor),
      evento: Number(minimo.evento),
      inicio: minimo.inicio,
      fim: minimo.fim || null,
    });
    Object.assign(minimo, { valor: '', fim: '' });
  }, k('gravado'));
}
const fimEncerrar = reactive<Record<string, string>>({});
function encerrar(tipo: TipoRegraVariavel, id: number, versao: number) {
  const fim = fimEncerrar[`${tipo}-${id}`] || hoje.value;
  void acao(() => encerrarRegraVariavel(tipo, id, versao, fim), k('encerrado'));
}

const apuracao = ref('');
const simulacao = useQuery({
  queryKey: computed(() => ['repasse', 'fixo-minimo', prof.value, 'sim', apuracao.value]),
  queryFn: () => simularVariavel(Number(apuracao.value), prof.value),
  enabled: computed(() => prof.value > 0 && Number(apuracao.value) > 0),
});
const doMedico = computed(() =>
  simulacao.data.value?.profissionais.find((p) => p.profissional === prof.value),
);
const itens = computed(() =>
  (doMedico.value?.itens ?? []).filter((i) => i.tipo === 'valor_fixo' || i.tipo === 'complemento_minimo'),
);
const aLancar = computed(() => itens.value.some((i) => !i.lancado));
async function lancar() {
  let r: { lancamentos: number; descontos: number } = { lancamentos: 0, descontos: 0 };
  await acao(async () => {
    r = await lancarVariavel(Number(apuracao.value), prof.value);
  }, '');
  if (!erro.value) mensagem.value = t('repasse.remuneracaoVariavel.apuracao.lancou', r);
}
</script>

<template>
  <section class="painel" aria-labelledby="rf-titulo" data-testid="rf-fixo-minimo">
    <h2 id="rf-titulo">{{ k('fixo.secao') }}</h2>
    <p>{{ k('fixo.resumoSecao') }}</p>
    <BuscaPrestador v-model="medico" :rotulo="k('medico')" testid="rf-medico" />
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <template v-if="prof > 0 && painel.data.value">
      <h3>{{ k('fixo.titulo') }}</h3>
      <p>{{ k('fixo.explica') }}</p>
      <table v-if="painel.data.value.fixos.length" class="tabela" data-testid="rf-fixos">
        <thead>
          <tr>
            <th scope="col">{{ k('fixo.descricao') }}</th>
            <th scope="col">{{ k('fixo.valor') }}</th>
            <th scope="col">{{ k('evento') }}</th>
            <th scope="col">{{ k('vigencia') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in painel.data.value.fixos" :key="f.id" :data-testid="`rf-fixo-${f.id}`">
            <td>
              {{ f.descricao }}<small v-if="!f.lancamentoAutomatico"> ({{ k('fixo.manual') }})</small>
            </td>
            <td>{{ reais(f.valorMensal) }}</td>
            <td>{{ f.eventoNome ?? '—' }}</td>
            <td>{{ `${f.inicio} – ${f.fim ?? k('semFim')}` }}</td>
            <td>
              <template v-if="podeEditar && (f.fim === null || f.fim > hoje)">
                <label class="visualmente-oculto" :for="`rf-fim-fixo-${f.id}`">{{ k('encerrarEm') }}</label>
                <input
                  :id="`rf-fim-fixo-${f.id}`"
                  v-model="fimEncerrar[`fixo-${f.id}`]"
                  type="date"
                  :data-testid="`rf-fim-fixo-${f.id}`"
                />
                <button
                  type="button"
                  :disabled="gravando"
                  :data-testid="`rf-encerrar-fixo-${f.id}`"
                  @click="encerrar('fixo', f.id, f.versao)"
                >
                  {{ k('encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>
      <form v-if="podeEditar" class="formulario" data-testid="rf-form-fixo" @submit.prevent="gravarFixo">
        <span class="campo">
          <label for="rf-fixo-desc">{{ k('fixo.descricao') }}</label>
          <input id="rf-fixo-desc" v-model="fixo.descricao" maxlength="150" data-testid="rf-fixo-descricao" />
        </span>
        <span class="campo">
          <label for="rf-fixo-valor">{{ k('fixo.valor') }}</label>
          <input id="rf-fixo-valor" v-model="fixo.valor" inputmode="decimal" data-testid="rf-fixo-valor" />
        </span>
        <span class="campo">
          <label for="rf-fixo-dia">{{ k('fixo.dia') }}</label>
          <input id="rf-fixo-dia" v-model="fixo.dia" inputmode="numeric" data-testid="rf-fixo-dia" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="fixo.evento"
            :rotulo="k('evento')"
            :opcoes="eventos"
            data-testid="rf-fixo-evento"
          />
        </span>
        <span class="campo">
          <label for="rf-fixo-inicio">{{ k('inicio') }}</label>
          <input id="rf-fixo-inicio" v-model="fixo.inicio" type="date" data-testid="rf-fixo-inicio" />
        </span>
        <span class="campo">
          <label for="rf-fixo-fim">{{ k('fimOpcional') }}</label>
          <input id="rf-fixo-fim" v-model="fixo.fim" type="date" data-testid="rf-fixo-fim" />
        </span>
        <ul v-if="problemasFixo.length" role="status" data-testid="rf-fixo-problemas">
          <li v-for="p in problemasFixo" :key="p">{{ p }}</li>
        </ul>
        <button type="submit" :disabled="gravando || problemasFixo.length > 0" data-testid="rf-fixo-incluir">
          {{ k('incluir') }}
        </button>
      </form>

      <h3>{{ k('minimo.titulo') }}</h3>
      <p>{{ k('minimo.explica') }}</p>
      <table v-if="painel.data.value.minimos.length" class="tabela" data-testid="rf-minimos">
        <thead>
          <tr>
            <th scope="col">{{ k('minimo.valor') }}</th>
            <th scope="col">{{ k('evento') }}</th>
            <th scope="col">{{ k('vigencia') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in painel.data.value.minimos" :key="m.id" :data-testid="`rf-minimo-${m.id}`">
            <td>{{ reais(m.valorMinimo) }}</td>
            <td>{{ m.eventoNome ?? '—' }}</td>
            <td>{{ `${m.inicio} – ${m.fim ?? k('semFim')}` }}</td>
            <td>
              <template v-if="podeEditar && (m.fim === null || m.fim > hoje)">
                <label class="visualmente-oculto" :for="`rf-fim-minimo-${m.id}`">{{ k('encerrarEm') }}</label>
                <input
                  :id="`rf-fim-minimo-${m.id}`"
                  v-model="fimEncerrar[`minimo-${m.id}`]"
                  type="date"
                  :data-testid="`rf-fim-minimo-${m.id}`"
                />
                <button
                  type="button"
                  :disabled="gravando"
                  :data-testid="`rf-encerrar-minimo-${m.id}`"
                  @click="encerrar('minimo', m.id, m.versao)"
                >
                  {{ k('encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>
      <form v-if="podeEditar" class="formulario" data-testid="rf-form-minimo" @submit.prevent="gravarMinimo">
        <span class="campo">
          <label for="rf-min-valor">{{ k('minimo.valor') }}</label>
          <input id="rf-min-valor" v-model="minimo.valor" inputmode="decimal" data-testid="rf-minimo-valor" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="minimo.evento"
            :rotulo="k('evento')"
            :opcoes="eventos"
            data-testid="rf-minimo-evento"
          />
        </span>
        <span class="campo">
          <label for="rf-min-inicio">{{ k('inicio') }}</label>
          <input id="rf-min-inicio" v-model="minimo.inicio" type="date" data-testid="rf-minimo-inicio" />
        </span>
        <span class="campo">
          <label for="rf-min-fim">{{ k('fimOpcional') }}</label>
          <input id="rf-min-fim" v-model="minimo.fim" type="date" data-testid="rf-minimo-fim" />
        </span>
        <ul v-if="problemasMinimo.length" role="status" data-testid="rf-minimo-problemas">
          <li v-for="p in problemasMinimo" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="gravando || problemasMinimo.length > 0"
          data-testid="rf-minimo-incluir"
        >
          {{ k('incluir') }}
        </button>
      </form>

      <h3>{{ k('apuracao.titulo') }}</h3>
      <span class="campo">
        <SanteSelecao
          v-if="apuracoes.length"
          v-model="apuracao"
          :rotulo="k('apuracao.escolher')"
          :opcoes="apuracoes"
          data-testid="rf-apuracao"
        />
        <small v-else role="status">{{ k('apuracao.nenhuma') }}</small>
      </span>
      <ErroFaturamento v-if="simulacao.error.value" :erro="simulacao.error.value" />
      <div v-if="doMedico" data-testid="rf-simulacao">
        <p>
          {{ k('apuracao.producao') }}:
          <strong data-testid="rf-producao">{{ reais(doMedico.producao) }}</strong>
        </p>
        <table v-if="itens.length" class="tabela">
          <tbody>
            <tr v-for="i in itens" :key="i.referente" :data-testid="`rf-item-${i.tipo}`">
              <th scope="row">{{ k(`apuracao.tipos.${i.tipo}`) }}</th>
              <td>{{ i.memoria }}</td>
              <td>{{ reais(i.valor) }}</td>
              <td>{{ i.lancado ? k('apuracao.lancado') : k('apuracao.aLancar') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('repasse.nenhum') }}</p>
        <ul v-if="doMedico.pendencias.length" role="status" data-testid="rf-pendencias">
          <li v-for="p in doMedico.pendencias" :key="p">{{ p }}</li>
        </ul>
        <button
          v-if="podeLancar"
          type="button"
          :disabled="gravando || !aLancar"
          data-testid="rf-lancar"
          @click="void lancar()"
        >
          {{ k('apuracao.lancar') }}
        </button>
      </div>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rf-mensagem" />
  </section>
</template>
