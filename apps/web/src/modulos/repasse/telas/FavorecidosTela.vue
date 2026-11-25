<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Favorecidos do repasse e prestadores terceiros (F3.7, 06-FAT linha 46): `/repasse/favorecidos`. Visão por médico: a
// busca escolhe o médico e a tela mostra, de uma vez, o histórico dos favorecidos (vigentes primeiro), a soma das
// partes vigentes e o formulário de inclusão no mesmo lugar (tipo, favorecido pela busca, conta do credor do tipo,
// fonte pagadora ou todas, retenções pelo enquadramento do fornecedor, fim opcional;
// parte e início), com a soma conferida na hora. Incluir do mesmo tipo encerra o anterior no dia de antes (o servidor
// grava as duas coisas na mesma transação). Abaixo, os prestadores terceiros com a inclusão em linha (CPF/CNPJ e CNES
// conferidos ao digitar) e a inativação sem apagar. Na linha da empresa ou da cooperativa, o enquadramento tributário do
// fornecedor (o cadastro do contas a pagar) se grava ali mesmo, com a alíquota conferida ao digitar. As ações aparecem só com a permissão de manter cooperativas.
import { cnpjValido, cpfValido } from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import {
  type AlvoFavorecido,
  alterarPrestadorTerceiro,
  encerrarFavorecido,
  incluirContaPrestador,
  incluirEnquadramento,
  incluirFavorecido,
  incluirPrestadorTerceiro,
  lerAlvos,
  lerContas,
  lerContasPrestador,
  lerFavorecidos,
  lerPrestadoresTerceiros,
  lerTributos,
  type TipoFavorecido,
} from '../api-favorecidos.js';
import { data, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const podeEditar = computed(() => tem('repasse.cooperativa.editar'));
const hoje = computed(() => apoio.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

// ── Favorecidos do médico ──
const medico = ref('');
const registro = ref('');
const profissional = computed(() => Number(medico.value) || 0);
const favorecidos = useQuery({
  queryKey: computed(() => ['repasse', 'favorecidos', profissional.value]),
  queryFn: () => lerFavorecidos(profissional.value),
  enabled: computed(() => profissional.value > 0),
});
const vigenteEm = (f: { inicio: string; fim: string | null }, dia: string) =>
  f.inicio <= dia && (f.fim === null || f.fim >= dia);
const ordenados = computed(() =>
  [...(favorecidos.data.value ?? [])].sort(
    (a, b) =>
      Number(vigenteEm(b, hoje.value)) - Number(vigenteEm(a, hoje.value)) || b.inicio.localeCompare(a.inicio),
  ),
);
const form = reactive({
  tipo: 'proprio_profissional' as TipoFavorecido,
  alvo: 0,
  conta: '',
  percentual: 100,
  inicio: '',
  fim: '',
  fonte: 0,
});
// A conta de crédito é do credor do tipo escolhido (o servidor recusa a de outro credor): do médico no tipo próprio,
// do alvo nos demais (o fornecedor da empresa ou da cooperativa, o outro profissional).
const credorConta = computed(() =>
  form.tipo === 'proprio_profissional' ? profissional.value : Number(form.alvo) || 0,
);
const contas = useQuery({
  queryKey: computed(() => ['repasse', 'favorecidos-contas', form.tipo, credorConta.value]),
  queryFn: () => lerContas(form.tipo, credorConta.value),
  enabled: computed(() => credorConta.value > 0),
});
const termoFonte = ref('');
const fontes = ref<AlvoFavorecido[]>([]);
async function buscarFonte() {
  erro.value = null;
  try {
    fontes.value = await lerAlvos('fonte_pagadora', termoFonte.value.trim());
  } catch (e) {
    erro.value = e;
  }
}
const fimEncerrar = reactive<Record<number, string>>({});
watch(hoje, (h) => (form.inicio ||= h), { immediate: true });
watch(
  () => form.tipo,
  () => {
    form.alvo = 0;
    form.conta = '';
    alvos.value = [];
  },
);
watch(
  () => form.alvo,
  () => (form.conta = ''),
);
// A soma das partes que valerão no início escolhido, pela regra do domínio: soma só os da mesma fonte do novo (os da
// fonte escolhida, ou os gerais, que valem nas fontes sem favorecido próprio), já sem o anterior do mesmo tipo e
// fonte (que o novo encerra).
const fonteForm = computed(() => Number(form.fonte) || null);
const somaNoInicio = computed(() =>
  (favorecidos.data.value ?? [])
    .filter((f) => vigenteEm(f, form.inicio) && f.fontePagadora === fonteForm.value && f.tipo !== form.tipo)
    .reduce((s, f) => s + f.percentual, 0),
);
const somaComNovo = computed(() => somaNoInicio.value + Number(form.percentual || 0));
const formValido = computed(
  () =>
    profissional.value > 0 &&
    form.inicio !== '' &&
    (form.fim === '' || form.fim >= form.inicio) &&
    form.percentual > 0 &&
    somaComNovo.value <= 100 &&
    (form.tipo === 'proprio_profissional' || form.alvo > 0),
);
const termoAlvo = ref('');
const alvos = ref<AlvoFavorecido[]>([]);
async function buscarAlvo() {
  if (form.tipo === 'proprio_profissional') return;
  erro.value = null;
  try {
    alvos.value = await lerAlvos(form.tipo, termoAlvo.value.trim());
  } catch (e) {
    erro.value = e;
  }
}
async function incluir() {
  erro.value = null;
  mensagem.value = null;
  const alvo = form.tipo === 'proprio_profissional' ? null : form.alvo;
  try {
    const r = await incluirFavorecido({
      profissional: profissional.value,
      tipo: form.tipo,
      pessoaJuridica: form.tipo === 'pessoa_juridica' ? alvo : null,
      cooperativa: form.tipo === 'cooperativa' ? alvo : null,
      terceiroProfissional: form.tipo === 'terceiro_profissional' ? alvo : null,
      contaBancaria: Number(form.conta) || null,
      percentual: Number(form.percentual),
      inicio: form.inicio,
      fim: form.fim || null,
      fontePagadora: fonteForm.value,
    });
    mensagem.value = r.encerrados.length
      ? t('repasse.favorecidos.incluidoEncerrou')
      : t('repasse.favorecidos.incluido');
    await qc.invalidateQueries({ queryKey: ['repasse', 'favorecidos'] });
  } catch (e) {
    erro.value = e;
  }
}
async function encerrar(id: number, versao: number) {
  erro.value = null;
  mensagem.value = null;
  try {
    await encerrarFavorecido(id, versao, fimEncerrar[id] || hoje.value);
    mensagem.value = t('repasse.favorecidos.encerradoOk');
    await qc.invalidateQueries({ queryKey: ['repasse', 'favorecidos'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Enquadramento tributário do fornecedor (o mesmo cadastro do contas a pagar) ──
const enq = reactive({
  fornecedor: 0,
  nome: '',
  tributo: '',
  regime: 'simples_nacional',
  retem: true,
  aliquota: '',
  fundamento: '',
  inicio: '',
  fim: '',
});
const tributos = useQuery({
  queryKey: ['repasse', 'favorecidos-tributos'],
  queryFn: lerTributos,
  enabled: computed(() => enq.fornecedor > 0),
});
const aliquotaEnq = computed(() => (enq.aliquota === '' ? null : Number(enq.aliquota)));
const aliquotaValida = computed(
  () =>
    aliquotaEnq.value === null ||
    (Number.isFinite(aliquotaEnq.value) &&
      aliquotaEnq.value >= 0 &&
      aliquotaEnq.value <= 100 &&
      Math.round(aliquotaEnq.value * 10_000) === aliquotaEnq.value * 10_000),
);
const enqValido = computed(
  () => enq.fornecedor > 0 && !!enq.inicio && aliquotaValida.value && (!enq.fim || enq.fim >= enq.inicio),
);
function abrirEnquadramento(fornecedor: number, nome: string | null) {
  Object.assign(enq, {
    fornecedor,
    nome: nome ?? '',
    tributo: '',
    regime: 'simples_nacional',
    retem: true,
    aliquota: '',
    fundamento: '',
    inicio: hoje.value,
    fim: '',
  });
}
async function gravarEnquadramento() {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await incluirEnquadramento(enq.fornecedor, {
      tributo: Number(enq.tributo) || null,
      regime: enq.regime,
      retem: enq.retem,
      aliquotaIss: aliquotaEnq.value,
      fundamentoLegal: enq.fundamento.trim() || null,
      inicio: enq.inicio,
      fim: enq.fim || null,
    });
    mensagem.value = t(
      r.encerrados.length
        ? 'repasse.favorecidos.enquadramento.okEncerrou'
        : 'repasse.favorecidos.enquadramento.ok',
    );
    enq.fornecedor = 0;
    await qc.invalidateQueries({ queryKey: ['repasse', 'favorecidos'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Prestadores terceiros ──
const busca = ref('');
const buscaAplicada = ref('');
const prestadores = useQuery({
  queryKey: computed(() => ['repasse', 'prestadores-terceiros', buscaAplicada.value]),
  queryFn: () => lerPrestadoresTerceiros(buscaAplicada.value),
});
const novo = reactive({
  codigo: '',
  nome: '',
  tipoPessoa: 'juridica' as 'fisica' | 'juridica',
  documento: '',
  cnes: '',
  percentual: '' as string | number,
  base: 'cobrado' as 'cobrado' | 'recebido' | 'misto',
});
const digitos = (s: string) => s.replace(/\D/g, '');
// A conta de crédito do prestador (titular: o próprio prestador; o servidor grava o documento dele).
const contaPrest = reactive({ id: 0, nome: '', tipoChavePix: 'cnpj', chavePix: '' });
const contasPrest = useQuery({
  queryKey: computed(() => ['repasse', 'prestador-contas', contaPrest.id]),
  queryFn: () => lerContasPrestador(contaPrest.id),
  enabled: computed(() => contaPrest.id > 0),
});
async function incluirConta() {
  erro.value = null;
  mensagem.value = null;
  try {
    await incluirContaPrestador(contaPrest.id, {
      tipoChavePix: contaPrest.tipoChavePix,
      chavePix: contaPrest.chavePix.trim(),
    });
    mensagem.value = t('repasse.favorecidos.contaPrestador.ok');
    contaPrest.chavePix = '';
    await qc.invalidateQueries({ queryKey: ['repasse', 'prestador-contas'] });
  } catch (e) {
    erro.value = e;
  }
}
const docOk = computed(() =>
  novo.tipoPessoa === 'fisica' ? cpfValido(digitos(novo.documento)) : cnpjValido(digitos(novo.documento)),
);
const cnesOk = computed(() => novo.cnes === '' || /^\d{7}$/.test(novo.cnes));
const novoValido = computed(
  () => novo.codigo.trim() !== '' && novo.nome.trim().length >= 3 && docOk.value && cnesOk.value,
);
async function incluirPrestador() {
  erro.value = null;
  mensagem.value = null;
  try {
    await incluirPrestadorTerceiro({
      codigo: novo.codigo.trim(),
      nome: novo.nome.trim(),
      tipoPessoa: novo.tipoPessoa,
      cpf: novo.tipoPessoa === 'fisica' ? digitos(novo.documento) : null,
      cnpj: novo.tipoPessoa === 'juridica' ? digitos(novo.documento) : null,
      cnes: novo.cnes || null,
      percentualRepasse: novo.percentual === '' ? null : Number(novo.percentual),
      baseRepasse: novo.base,
    });
    mensagem.value = t('repasse.favorecidos.prestadorIncluido');
    Object.assign(novo, { codigo: '', nome: '', documento: '', cnes: '', percentual: '' });
    await qc.invalidateQueries({ queryKey: ['repasse', 'prestadores-terceiros'] });
  } catch (e) {
    erro.value = e;
  }
}
async function alternarAtivo(id: number, versao: number, ativo: boolean) {
  erro.value = null;
  try {
    await alterarPrestadorTerceiro(id, { versao, ativo });
    await qc.invalidateQueries({ queryKey: ['repasse', 'prestadores-terceiros'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="fv-titulo" data-testid="tela-rep-favorecidos">
    <h1 id="fv-titulo">{{ t('repasse.favorecidos.titulo') }}</h1>
    <p class="secundario">{{ t('repasse.favorecidos.resumo') }}</p>
    <div class="filtros acoes">
      <BuscaPrestador
        v-model="medico"
        v-model:registro="registro"
        :rotulo="t('repasse.favorecidos.medico')"
        testid="fv-medico"
      />
    </div>

    <template v-if="profissional">
      <h2>{{ t('repasse.favorecidos.doMedico') }}</h2>
      <table v-if="ordenados.length" class="tabela" data-testid="fv-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.favorecidos.tipo') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.alvo') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.fonte') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.parte') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.inicio') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.fim') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.retencoes') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="f in ordenados"
            :key="f.id"
            :class="{ secundario: !vigenteEm(f, hoje) }"
            :data-testid="`fv-linha-${f.id}`"
          >
            <td>{{ t(`repasse.favorecidos.tipos.${f.tipo}`) }}</td>
            <td>{{ f.alvoNome ?? f.profissionalNome }}</td>
            <td>{{ f.fontePagadoraNome ?? t('repasse.favorecidos.todasFontes') }}</td>
            <td>{{ f.percentual }}</td>
            <td>{{ data(f.inicio) }}</td>
            <td>{{ f.fim ? data(f.fim) : t('repasse.favorecidos.vigente') }}</td>
            <td :data-testid="`fv-retencoes-${f.id}`">
              {{ t(`repasse.favorecidos.fiscal.${f.retencoes.situacao}`) }}
              <template v-for="(r, i) in f.retencoes.vigentes" :key="i">
                · {{ t(`repasse.favorecidos.regimes.${r.regime}`, r.regime) }}
                {{ r.retem ? t('repasse.favorecidos.retem') : t('repasse.favorecidos.naoRetem') }}
                {{ r.aliquotaIss !== null ? `ISS ${r.aliquotaIss}%` : '' }}
              </template>
              <button
                v-if="podeEditar && f.fornecedor !== null"
                type="button"
                :data-testid="`fv-enquadrar-${f.id}`"
                @click="abrirEnquadramento(f.fornecedor, f.alvoNome)"
              >
                {{ t('repasse.favorecidos.enquadrar') }}
              </button>
            </td>
            <td>
              <input
                v-if="podeEditar && (f.fim === null || f.fim >= hoje)"
                v-model="fimEncerrar[f.id]"
                type="date"
                :min="f.inicio"
                :max="f.fim ?? undefined"
                :aria-label="t('repasse.favorecidos.dataEncerrar')"
                :data-testid="`fv-fim-encerrar-${f.id}`"
              />
              <button
                v-if="podeEditar && (f.fim === null || f.fim >= hoje)"
                type="button"
                :data-testid="`fv-encerrar-${f.id}`"
                @click="encerrar(f.id, f.versao)"
              >
                {{ t('repasse.favorecidos.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>

      <fieldset v-if="podeEditar && enq.fornecedor > 0" data-testid="fv-enquadramento">
        <legend>{{ t('repasse.favorecidos.enquadramento.titulo', { nome: enq.nome }) }}</legend>
        <p class="secundario">{{ t('repasse.favorecidos.enquadramento.resumo') }}</p>
        <div class="filtros acoes">
          <span class="campo">
            <SanteSelecao
              v-model="enq.tributo"
              :rotulo="t('repasse.favorecidos.enquadramento.tributo')"
              :opcoes="[
                { valor: '', rotulo: t('repasse.favorecidos.enquadramento.todos') },
                ...(tributos.data.value ?? []).map((x) => ({
                  valor: String(x.id),
                  rotulo: `${x.codigo} · ${x.descricao}`,
                })),
              ]"
              data-testid="fv-enq-tributo"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="enq.regime"
              :rotulo="t('repasse.favorecidos.enquadramento.regime')"
              :opcoes="
                (
                  [
                    'simples_nacional',
                    'mei',
                    'lucro_presumido',
                    'lucro_real',
                    'imune',
                    'isento',
                    'substituto_tributario',
                    'outro',
                  ] as const
                ).map((x) => ({ valor: x, rotulo: t(`repasse.favorecidos.regimes.${x}`) }))
              "
              data-testid="fv-enq-regime"
            />
          </span>
          <label class="campo">
            <input v-model="enq.retem" type="checkbox" data-testid="fv-enq-retem" />
            {{ t('repasse.favorecidos.enquadramento.retem') }}
          </label>
          <span class="campo">
            <label for="fv-enq-aliquota">{{ t('repasse.favorecidos.enquadramento.aliquota') }}</label>
            <input
              id="fv-enq-aliquota"
              v-model="enq.aliquota"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              :aria-invalid="!aliquotaValida"
              data-testid="fv-enq-aliquota"
            />
            <small v-if="!aliquotaValida" role="alert" data-testid="fv-enq-aliquota-erro">
              {{ t('repasse.favorecidos.enquadramento.aliquotaInvalida') }}
            </small>
          </span>
          <span class="campo">
            <label for="fv-enq-fundamento">{{ t('repasse.favorecidos.enquadramento.fundamento') }}</label>
            <input
              id="fv-enq-fundamento"
              v-model="enq.fundamento"
              maxlength="300"
              data-testid="fv-enq-fundamento"
            />
          </span>
          <span class="campo">
            <label for="fv-enq-inicio">{{ t('repasse.favorecidos.inicio') }}</label>
            <input id="fv-enq-inicio" v-model="enq.inicio" type="date" data-testid="fv-enq-inicio" />
          </span>
          <span class="campo">
            <label for="fv-enq-fim">{{ t('repasse.favorecidos.fimOpcional') }}</label>
            <input id="fv-enq-fim" v-model="enq.fim" type="date" :min="enq.inicio" data-testid="fv-enq-fim" />
          </span>
          <button
            type="button"
            :disabled="!enqValido"
            data-testid="fv-enq-gravar"
            @click="gravarEnquadramento"
          >
            {{ t('repasse.favorecidos.enquadramento.gravar') }}
          </button>
          <button type="button" data-testid="fv-enq-fechar" @click="enq.fornecedor = 0">
            {{ t('repasse.favorecidos.enquadramento.cancelar') }}
          </button>
        </div>
      </fieldset>

      <fieldset v-if="podeEditar" data-testid="fv-novo">
        <legend>{{ t('repasse.favorecidos.incluir') }}</legend>
        <div class="filtros acoes">
          <span class="campo">
            <SanteSelecao
              v-model="form.tipo"
              :rotulo="t('repasse.favorecidos.tipo')"
              :opcoes="[
                ...(
                  ['proprio_profissional', 'pessoa_juridica', 'cooperativa', 'terceiro_profissional'] as const
                ).map((x) => ({ valor: x, rotulo: t(`repasse.favorecidos.tipos.${x}`) })),
              ]"
              data-testid="fv-tipo"
            />
          </span>
          <template v-if="form.tipo !== 'proprio_profissional'">
            <span class="campo">
              <label for="fv-busca-alvo">{{ t('repasse.favorecidos.buscarAlvo') }}</label>
              <input
                id="fv-busca-alvo"
                v-model="termoAlvo"
                data-testid="fv-busca-alvo"
                @keyup.enter="buscarAlvo"
              />
            </span>
            <button type="button" data-testid="fv-buscar-alvo" @click="buscarAlvo">
              {{ t('repasse.buscar') }}
            </button>
            <span class="campo">
              <SanteSelecao
                v-model="form.alvo"
                :rotulo="t('repasse.favorecidos.alvo')"
                :opcoes="[
                  { valor: 0, rotulo: '—' },
                  ...alvos.map((a) => ({
                    valor: a.id,
                    rotulo: `${a.nome}${a.documento ? ` · ${a.documento}` : ''}`,
                  })),
                ]"
                data-testid="fv-alvo"
              />
            </span>
          </template>
          <span class="campo">
            <SanteSelecao
              v-model="form.conta"
              :rotulo="t('repasse.favorecidos.conta')"
              :opcoes="[
                { valor: '', rotulo: t('repasse.favorecidos.semConta') },
                ...(contas.data.value ?? []).map((c) => ({
                  valor: String(c.id),
                  rotulo: t('repasse.favorecidos.contaRotulo', {
                    rotulo: c.rotulo,
                    titular: c.titular,
                    final: c.documentoFinal,
                  }),
                })),
              ]"
              data-testid="fv-conta"
            />
          </span>
          <span class="campo">
            <label for="fv-parte">{{ t('repasse.favorecidos.parte') }}</label>
            <input
              id="fv-parte"
              v-model.number="form.percentual"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              data-testid="fv-parte"
            />
          </span>
          <span class="campo">
            <label for="fv-busca-fonte">{{ t('repasse.favorecidos.buscarFonte') }}</label>
            <input
              id="fv-busca-fonte"
              v-model="termoFonte"
              data-testid="fv-busca-fonte"
              @keyup.enter="buscarFonte"
            />
          </span>
          <button type="button" data-testid="fv-buscar-fonte" @click="buscarFonte">
            {{ t('repasse.buscar') }}
          </button>
          <span class="campo">
            <SanteSelecao
              v-model="form.fonte"
              :rotulo="t('repasse.favorecidos.fonte')"
              :opcoes="[
                { valor: 0, rotulo: t('repasse.favorecidos.todasFontes') },
                ...fontes.map((a) => ({ valor: a.id, rotulo: a.nome })),
              ]"
              data-testid="fv-fonte"
            />
          </span>
          <span class="campo">
            <label for="fv-inicio">{{ t('repasse.favorecidos.inicio') }}</label>
            <input id="fv-inicio" v-model="form.inicio" type="date" data-testid="fv-inicio" />
          </span>
          <span class="campo">
            <label for="fv-fim">{{ t('repasse.favorecidos.fimOpcional') }}</label>
            <input id="fv-fim" v-model="form.fim" type="date" :min="form.inicio" data-testid="fv-fim" />
          </span>
          <button type="button" :disabled="!formValido" data-testid="fv-incluir" @click="incluir">
            {{ t('repasse.favorecidos.incluir') }}
          </button>
        </div>
        <p :role="somaComNovo > 100 ? 'alert' : 'note'" data-testid="fv-soma">
          {{
            somaComNovo > 100
              ? t('repasse.favorecidos.somaPassa', { soma: somaComNovo.toFixed(2) })
              : t('repasse.favorecidos.somaVigente', { soma: somaComNovo.toFixed(2) })
          }}
        </p>
      </fieldset>
    </template>

    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="fv-mensagem" />

    <h2>{{ t('repasse.favorecidos.prestadores') }}</h2>
    <div class="filtros acoes">
      <span class="campo">
        <label for="pt-busca">{{ t('repasse.favorecidos.buscarPrestador') }}</label>
        <input id="pt-busca" v-model="busca" data-testid="pt-busca" @keyup.enter="buscaAplicada = busca" />
      </span>
      <button type="button" data-testid="pt-buscar" @click="buscaAplicada = busca">
        {{ t('repasse.buscar') }}
      </button>
    </div>
    <ErroFaturamento v-if="prestadores.error.value" :erro="prestadores.error.value" />
    <table v-if="prestadores.data.value?.length" class="tabela" data-testid="pt-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.favorecidos.codigo') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.nome') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.documento') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.cnes') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.percentual') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.base') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="p in prestadores.data.value"
          :key="p.id"
          :class="{ secundario: !p.ativo }"
          :data-testid="`pt-linha-${p.codigo}`"
        >
          <td>{{ p.codigo }}</td>
          <td>{{ p.nome }}</td>
          <td>{{ p.cnpj ?? p.cpf }}</td>
          <td>{{ p.cnes ?? '' }}</td>
          <td>{{ p.percentualRepasse ?? '' }}</td>
          <td>{{ t(`repasse.favorecidos.bases.${p.baseRepasse}`) }}</td>
          <td>
            <span v-if="!p.ativo && p.inativadoEm">{{
              t('repasse.favorecidos.inativo', { data: data(p.inativadoEm) })
            }}</span>
            <button
              v-if="podeEditar"
              type="button"
              :data-testid="`pt-ativo-${p.codigo}`"
              @click="alternarAtivo(p.id, p.versao, !p.ativo)"
            >
              {{ p.ativo ? t('repasse.favorecidos.inativar') : t('repasse.favorecidos.reativar') }}
            </button>
            <button
              v-if="podeEditar && p.ativo"
              type="button"
              :data-testid="`pt-conta-${p.codigo}`"
              @click="Object.assign(contaPrest, { id: p.id, nome: p.nome, chavePix: '' })"
            >
              {{ t('repasse.favorecidos.contaPrestador.abrir') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>

    <fieldset v-if="podeEditar && contaPrest.id > 0" data-testid="pt-conta">
      <legend>{{ t('repasse.favorecidos.contaPrestador.titulo', { nome: contaPrest.nome }) }}</legend>
      <ul v-if="contasPrest.data.value?.length" data-testid="pt-contas">
        <li v-for="cp in contasPrest.data.value" :key="cp.id">
          {{
            t('repasse.favorecidos.contaRotulo', {
              rotulo: cp.rotulo,
              titular: cp.titular,
              final: cp.documentoFinal,
            })
          }}
        </li>
      </ul>
      <p v-else>{{ t('repasse.favorecidos.contaPrestador.nenhuma') }}</p>
      <div class="filtros acoes">
        <span class="campo">
          <SanteSelecao
            v-model="contaPrest.tipoChavePix"
            :rotulo="t('repasse.favorecidos.contaPrestador.tipoPix')"
            :opcoes="
              (['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.favorecidos.contaPrestador.tiposPix.${x}`),
              }))
            "
            data-testid="pt-conta-tipo"
          />
        </span>
        <span class="campo">
          <label for="pt-conta-chave">{{ t('repasse.favorecidos.contaPrestador.chave') }}</label>
          <input
            id="pt-conta-chave"
            v-model="contaPrest.chavePix"
            maxlength="77"
            data-testid="pt-conta-chave"
          />
        </span>
        <button
          type="button"
          :disabled="!contaPrest.chavePix.trim()"
          data-testid="pt-conta-incluir"
          @click="incluirConta"
        >
          {{ t('repasse.favorecidos.contaPrestador.incluir') }}
        </button>
      </div>
    </fieldset>

    <fieldset v-if="podeEditar" data-testid="pt-novo">
      <legend>{{ t('repasse.favorecidos.incluirPrestador') }}</legend>
      <div class="filtros acoes">
        <span class="campo">
          <label for="pt-codigo">{{ t('repasse.favorecidos.codigo') }}</label>
          <input id="pt-codigo" v-model="novo.codigo" maxlength="30" data-testid="pt-codigo" />
        </span>
        <span class="campo">
          <label for="pt-nome">{{ t('repasse.favorecidos.nome') }}</label>
          <input id="pt-nome" v-model="novo.nome" maxlength="150" data-testid="pt-nome" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="novo.tipoPessoa"
            :rotulo="t('repasse.favorecidos.tipoPessoa')"
            :opcoes="[
              { valor: 'juridica' as const, rotulo: t('repasse.favorecidos.juridica') },
              { valor: 'fisica' as const, rotulo: t('repasse.favorecidos.fisica') },
            ]"
            data-testid="pt-pessoa"
          />
        </span>
        <span class="campo">
          <label for="pt-doc">{{ t('repasse.favorecidos.documento') }}</label>
          <input
            id="pt-doc"
            v-model="novo.documento"
            :aria-invalid="novo.documento !== '' && !docOk"
            data-testid="pt-documento"
          />
          <small v-if="novo.documento !== '' && !docOk" role="alert">{{
            t('repasse.favorecidos.documentoInvalido')
          }}</small>
        </span>
        <span class="campo">
          <label for="pt-cnes">{{ t('repasse.favorecidos.cnes') }}</label>
          <input
            id="pt-cnes"
            v-model="novo.cnes"
            maxlength="7"
            :aria-invalid="!cnesOk"
            data-testid="pt-cnes"
          />
          <small v-if="!cnesOk" role="alert">{{ t('repasse.favorecidos.cnesInvalido') }}</small>
        </span>
        <span class="campo">
          <label for="pt-perc">{{ t('repasse.favorecidos.percentual') }}</label>
          <input
            id="pt-perc"
            v-model="novo.percentual"
            type="number"
            min="0"
            max="100"
            step="0.01"
            data-testid="pt-percentual"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="novo.base"
            :rotulo="t('repasse.favorecidos.base')"
            :opcoes="[
              ...(['cobrado', 'recebido', 'misto'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.favorecidos.bases.${x}`),
              })),
            ]"
            data-testid="pt-base"
          />
        </span>
        <button type="button" :disabled="!novoValido" data-testid="pt-incluir" @click="incluirPrestador">
          {{ t('repasse.favorecidos.incluirPrestador') }}
        </button>
      </div>
    </fieldset>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
