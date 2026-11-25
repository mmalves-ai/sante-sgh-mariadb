<script setup lang="ts">
// Seção "Valores dos índices e portes" da tela do contrato (F3.7, 06-FAT linha 5): o valor do índice de cobrança (CH,
// UCO, filme), do porte de honorário e do porte anestésico por vigência, do acordo inteiro ou de uma tabela de
// honorários do acordo. Escolhido o que registrar, a linha do tempo daquele valor aparece junto do formulário (menos
// cliques: vê o vigente e grava a vigência nova no mesmo lugar). O formulário valida na hora pela mesma regra do
// domínio que a API usa (validarRegistroIndice), inclusive a data de início repetida, e só grava quando está válido.
// Nada se altera nem se apaga: cada mudança é uma vigência nova.
import { TIPOS_REGISTRO_INDICE, type TipoRegistroIndice, validarRegistroIndice } from '@sgh/dominio-preco';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerOpcoesIndices, registrarIndice } from '../api-indices.js';
import { mensagensIndices } from '../i18n-indices.js';

const props = defineProps<{ codigo: number; podeEditar: boolean }>();
const emit = defineEmits<{ gravado: [] }>();
// Textos próprios da seção (escopo local), sem mexer nas mensagens comuns da aplicação.
const { t } = useI18n({
  useScope: 'local',
  inheritLocale: true,
  messages: { 'pt-BR': { indicesContrato: mensagensIndices } },
});
const cliente = useQueryClient();
const hoje = new Date().toISOString().slice(0, 10);
const chaveConsulta = computed(() => ['convenio', 'indices', props.codigo]);

const consulta = useQuery({
  queryKey: chaveConsulta,
  queryFn: () => lerOpcoesIndices(props.codigo),
});

const tipo = ref<TipoRegistroIndice>('indice');
const tabela = ref<string>('');
const alvo = ref<string>('');
const opcoesTipo = TIPOS_REGISTRO_INDICE.map((v) => ({ valor: v, rotulo: t(`indicesContrato.tipos.${v}`) }));

const opcoesTabela = computed(() => {
  const tabelas = (consulta.data.value?.tabelas ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: t('indicesContrato.daTabela', {
      codigo: x.codigo,
      descricao: x.descricao,
      regime: t(`indicesContrato.regimes.${x.regime}`),
    }),
  }));
  // O porte anestésico é sempre de uma tabela; os outros valem também para o acordo inteiro.
  return tipo.value === 'porte-anestesico'
    ? [{ valor: '', rotulo: t('indicesContrato.escolha') }, ...tabelas]
    : [{ valor: '', rotulo: t('indicesContrato.doAcordo') }, ...tabelas];
});

const opcoesAlvo = computed(() => {
  const o = consulta.data.value;
  const vazio = { valor: '', rotulo: t('indicesContrato.escolha') };
  if (!o) return [vazio];
  if (tipo.value === 'indice')
    return [
      vazio,
      ...o.indices.map((i) => ({ valor: String(i.id), rotulo: `${i.codigo} — ${i.descricao}` })),
    ];
  if (tipo.value === 'porte')
    return [vazio, ...o.portes.map((p) => ({ valor: p.codigo, rotulo: `${p.codigo} — ${p.descricao}` }))];
  return [
    vazio,
    ...Array.from({ length: 9 }, (_, n) => ({
      valor: String(n),
      rotulo: t('indicesContrato.porteAnestesico', { n }),
    })),
  ];
});

// Trocar o tipo limpa o alvo (o código de um índice não vale como porte).
watch(tipo, () => {
  alvo.value = '';
});

// ── Linha do tempo do valor escolhido ─────────────────────────────────────────────────────────────────
const tabelaId = computed(() => (tabela.value === '' ? null : Number(tabela.value)));
const linhaDoTempo = computed(() => {
  const o = consulta.data.value;
  if (!o || alvo.value === '') return [];
  const ls = o.vigencias
    .filter((v) => v.tipo === tipo.value && v.chave === alvo.value && v.tabelaId === tabelaId.value)
    .slice()
    .sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0));
  const vigente = ls.find((v) => v.inicio <= hoje)?.inicio ?? null;
  return ls.map((v) => ({
    ...v,
    situacao: v.inicio > hoje ? 'futura' : v.inicio === vigente ? 'vigente' : 'anterior',
  }));
});
const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });

// ── Formulário com validação na hora ──────────────────────────────────────────────────────────────────
const f = reactive({ vigenciaInicio: '', valor: '', valorHorarioEspecial: '', motivoAlteracao: '' });
const numero = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));
const camposVisiveis = computed(() =>
  tipo.value === 'porte-anestesico'
    ? (['vigenciaInicio', 'valor', 'valorHorarioEspecial', 'motivoAlteracao'] as const)
    : (['vigenciaInicio', 'valor', 'motivoAlteracao'] as const),
);
const erros = computed<Record<string, string>>(() => {
  const e = validarRegistroIndice({
    tipo: tipo.value,
    vigenciaInicio: f.vigenciaInicio,
    valor: numero(f.valor),
    valorHorarioEspecial:
      tipo.value === 'porte-anestesico' && f.valorHorarioEspecial.trim() !== ''
        ? numero(f.valorHorarioEspecial)
        : null,
    vigenciasExistentes: linhaDoTempo.value.map((v) => v.inicio),
  });
  if (alvo.value === '') e['alvo'] = t('indicesContrato.obrigatorios.alvo');
  if (tipo.value === 'porte-anestesico' && tabela.value === '')
    e['tabela'] = t('indicesContrato.obrigatorios.tabela');
  return e;
});
const tocados = reactive(new Set<string>());
const tentou = ref(false);
const erroDe = (c: string) => (tocados.has(c) || tentou.value ? erros.value[c] : undefined);

const entrada = computed<Record<string, unknown>>(() => {
  const base: Record<string, unknown> = {
    tabelaId: tabelaId.value,
    vigenciaInicio: f.vigenciaInicio,
    valor: numero(f.valor),
    motivoAlteracao: f.motivoAlteracao.trim() || null,
  };
  if (tipo.value === 'indice') return { ...base, indiceId: Number(alvo.value) };
  if (tipo.value === 'porte') return { ...base, porte: alvo.value };
  return {
    ...base,
    porte: alvo.value,
    valorHorarioEspecial: f.valorHorarioEspecial.trim() === '' ? null : numero(f.valorHorarioEspecial),
  };
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

async function registrar(): Promise<void> {
  tentou.value = true;
  erro.value = null;
  mensagem.value = null;
  if (Object.keys(erros.value).length) return;
  ocupado.value = true;
  try {
    await registrarIndice(props.codigo, tipo.value, entrada.value);
    mensagem.value = t('indicesContrato.registrada');
    tentou.value = false;
    tocados.clear();
    f.valor = '';
    f.valorHorarioEspecial = '';
    f.motivoAlteracao = '';
    await cliente.invalidateQueries({ queryKey: chaveConsulta.value });
    emit('gravado');
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="indices" aria-labelledby="indices-contrato-titulo" data-testid="indices-contrato">
    <h2 id="indices-contrato-titulo">{{ t('indicesContrato.titulo') }}</h2>
    <p>{{ t('indicesContrato.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <div class="escolha">
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('indicesContrato.tipo')"
        :opcoes="opcoesTipo"
        data-testid="indices-tipo"
      />
      <SanteSelecao
        v-model="tabela"
        :rotulo="t('indicesContrato.abrangencia')"
        :opcoes="opcoesTabela"
        :obrigatorio="tipo === 'porte-anestesico'"
        data-testid="indices-tabela"
      />
      <SanteSelecao
        v-model="alvo"
        :rotulo="t('indicesContrato.alvo')"
        :opcoes="opcoesAlvo"
        obrigatorio
        data-testid="indices-alvo"
      />
    </div>
    <p v-if="erroDe('tabela')" class="erro" role="alert" data-testid="indices-erro-tabela">
      {{ erroDe('tabela') }}
    </p>
    <p v-if="erroDe('alvo')" class="erro" role="alert" data-testid="indices-erro-alvo">
      {{ erroDe('alvo') }}
    </p>

    <template v-if="alvo !== ''">
      <p v-if="linhaDoTempo.length === 0" data-testid="indices-vazio">{{ t('indicesContrato.nenhuma') }}</p>
      <ol
        v-else
        class="linha-do-tempo"
        :aria-label="t('indicesContrato.linhaDoTempo')"
        data-testid="indices-linha-do-tempo"
      >
        <li v-for="v in linhaDoTempo" :key="v.inicio" :data-testid="`indices-vigencia-${v.inicio}`">
          <span>{{ v.inicio }}</span>
          <span>{{ fmt(v.valor) }}</span>
          <span v-if="v.valorHorarioEspecial !== null">
            {{ t('indicesContrato.horarioEspecial', { valor: fmt(v.valorHorarioEspecial) }) }}
          </span>
          <strong>{{ t(`indicesContrato.${v.situacao}`) }}</strong>
        </li>
      </ol>
    </template>

    <p v-if="!podeEditar" data-testid="indices-somente-consulta">
      {{ t('indicesContrato.somenteConsulta') }}
    </p>
    <form v-else class="formulario" data-testid="indices-form" novalidate @submit.prevent="registrar">
      <div v-for="c in camposVisiveis" :key="c" class="campo">
        <label :for="`indices-${c}`">{{ t(`indicesContrato.campos.${c}`) }}</label>
        <input
          :id="`indices-${c}`"
          v-model="f[c]"
          :type="c === 'vigenciaInicio' ? 'date' : c === 'motivoAlteracao' ? 'text' : 'number'"
          :step="c === 'vigenciaInicio' || c === 'motivoAlteracao' ? undefined : 'any'"
          :aria-invalid="!!erroDe(c)"
          :data-testid="`indices-campo-${c}`"
          @blur="tocados.add(c)"
        />
        <p v-if="erroDe(c)" class="erro" role="alert" :data-testid="`indices-erro-${c}`">{{ erroDe(c) }}</p>
      </div>
      <SanteBotao
        tipo="submit"
        :rotulo="t('indicesContrato.registrar')"
        :desabilitado="ocupado"
        data-testid="indices-registrar"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="indices-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.indices {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.escolha {
  display: grid;
  gap: var(--sgh-espaco-2);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.linha-do-tempo {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: 0;
}
.linha-do-tempo li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.erro {
  color: var(--sgh-alerta);
  margin: 0;
}
</style>
