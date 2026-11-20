<script setup lang="ts">
// O internado na tela de altas previstas (M44, etapa 2): a alta prevista vigente e o histórico das mudanças (cada uma
// com o autor e o motivo), as barreiras com o responsável e o prazo, e os formulários: a nova alta prevista (médico; a
// mudança pede o motivo), a barreira nova e resolver ou cancelar a aberta. O servidor confere tudo de novo.
// W0-07: retirar a alta prevista (versão nova, com o motivo), alterar a barreira aberta (descrição, responsável e
// prazo) e encerrá-la (resolvida ou cancelada), sempre com o motivo num diálogo; a barreira social vinda do serviço
// social se encerra aqui também e continua ligada à avaliação.
import { CODIGOS_TIPO_BARREIRA, type InternadoNir } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarBarreira,
  encerrarBarreira,
  novaChaveNir,
  registrarBarreira,
  registrarDpa,
  retirarDpa,
} from '../api-nir.js';
import { dataCurta, horaCurta } from '../regras-nir.js';
import { leitoTexto } from '../regras-tela.js';
import DialogoAlteracaoNir from './DialogoAlteracaoNir.vue';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{ internado: InternadoNir; pode: (acao: string) => boolean }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const i = computed(() => props.internado);
const data = ref<string | null>(null);
const motivoDpa = ref('');
const tipo = ref<string>('exame');
const descricao = ref('');
const responsavel = ref('');
const prazo = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const tipos = computed(() =>
  CODIGOS_TIPO_BARREIRA.map((x) => ({ valor: x, rotulo: t(`nir.altas.tipos.${x}`) })),
);
async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
    data.value = null;
    motivoDpa.value = '';
    descricao.value = '';
    responsavel.value = '';
    prazo.value = null;
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const gravarDpa = () =>
  fazer(() =>
    registrarDpa(
      {
        internacao: i.value.internacao,
        data: data.value,
        // A versão vista é a última (também a retirada): a próxima sucede a ela.
        anterior: ultimaDpa.value?.id ?? null,
        ...(motivoDpa.value.trim() ? { motivo: motivoDpa.value.trim() } : {}),
      },
      novaChaveNir('dpa'),
    ),
  );
const gravarBarreira = () =>
  fazer(() =>
    registrarBarreira(
      {
        internacao: i.value.internacao,
        tipo: tipo.value,
        descricao: descricao.value.trim(),
        responsavel: responsavel.value.trim(),
        prazo: prazo.value,
      },
      novaChaveNir('barreira'),
    ),
  );

// ── W0-07 ──
const ultimaDpa = computed(() => i.value.historicoDpa.at(-1) ?? null);
const dRetirar = ref(false);
const dAlterarB = ref(false);
const dEncerrarB = ref(false);
const refRetirar = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const refAlterarB = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const refEncerrarB = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const barreiraAlvo = ref<number | null>(null);
const bDescricao = ref('');
const bResponsavel = ref('');
const bPrazo = ref<string | null>(null);
const bResultado = ref<'resolvida' | 'cancelada'>('resolvida');
const resultados = computed(() => [
  { valor: 'resolvida' as const, rotulo: t('crudNir.resolvida') },
  { valor: 'cancelada' as const, rotulo: t('crudNir.cancelada') },
]);
function abrirAlterarB(b: { id: number; descricao: string; responsavel: string; prazo: string }): void {
  barreiraAlvo.value = b.id;
  bDescricao.value = b.descricao;
  bResponsavel.value = b.responsavel;
  bPrazo.value = b.prazo;
  dAlterarB.value = true;
}
function abrirEncerrarB(id: number): void {
  barreiraAlvo.value = id;
  bResultado.value = 'resolvida';
  dEncerrarB.value = true;
}
function retirar(d: { motivo: string }): void {
  const dpa = i.value.dpa;
  if (!dpa) return;
  void refRetirar.value?.executar(async () => {
    await retirarDpa(
      { internacao: i.value.internacao, anterior: dpa.id, motivo: d.motivo },
      novaChaveNir('retirar-dpa'),
    );
    emit('mudou');
  });
}
function alterarB(d: { motivo: string }): void {
  const id = barreiraAlvo.value;
  const b = i.value.barreiras.find((x) => x.id === id);
  if (!id || !b) return;
  void refAlterarB.value?.executar(async () => {
    await alterarBarreira(
      id,
      {
        ...(bDescricao.value.trim() !== b.descricao ? { descricao: bDescricao.value.trim() } : {}),
        ...(bResponsavel.value.trim() !== b.responsavel ? { responsavel: bResponsavel.value.trim() } : {}),
        ...(bPrazo.value && bPrazo.value !== b.prazo ? { prazo: bPrazo.value } : {}),
        motivo: d.motivo,
      },
      novaChaveNir('alterar-barreira'),
    );
    emit('mudou');
  });
}
function encerrarB(d: { motivo: string }): void {
  const id = barreiraAlvo.value;
  if (!id) return;
  void refEncerrarB.value?.executar(async () => {
    await encerrarBarreira(
      id,
      { resultado: bResultado.value, motivo: d.motivo },
      novaChaveNir('encerrar-barreira'),
    );
    emit('mudou');
  });
}
</script>

<template>
  <li class="cartao-nir" :data-testid="`internado-${i.internacao}`" :data-cor="i.cor">
    <p>
      <strong>{{ i.nome }}</strong> · {{ leitoTexto(i.leito) }} · {{ t('nir.altas.dias', { n: i.dias312 }) }}
      <template v-if="i.diasUti > 0"> · {{ t('nir.altas.diasUti', { n: i.diasUti }) }}</template>
    </p>
    <p>
      <span :class="`cor-${i.cor}`" :data-testid="`cor-${i.internacao}`">{{
        t(`nir.permanencia.cores.${i.cor}`)
      }}</span>
      · {{ i.motivoCor }} ·
      <span data-testid="dpa">{{
        i.dpa ? t('nir.altas.dpa', { data: dataCurta(i.dpa.data) }) : t('nir.altas.semDpa')
      }}</span>
      <SanteBotao
        v-if="i.dpa && pode('retirarDpa')"
        variante="texto"
        :rotulo="t('crudNir.retirarDpa')"
        :data-testid="`retirar-dpa-${i.internacao}`"
        @acionar="dRetirar = true"
      />
    </p>
    <details v-if="i.historicoDpa.length > 1" class="secundario">
      <summary>{{ t('nir.altas.historicoDpa') }}</summary>
      <ul class="lista-simples">
        <li v-for="d in i.historicoDpa" :key="d.id">
          <template v-if="d.retirada">{{ t('crudNir.dpaRetirada') }}</template>
          <template v-else>{{ dataCurta(d.data) }}</template> · {{ d.por }} · {{ horaCurta(d.em)
          }}<template v-if="d.motivo"> · {{ d.motivo }}</template>
        </li>
      </ul>
    </details>
    <h3>{{ t('nir.altas.barreiras') }}</h3>
    <p v-if="i.barreiras.filter((b) => b.situacao === 'aberta').length === 0" class="secundario">
      {{ t('nir.altas.nenhumaBarreira') }}
    </p>
    <ul class="lista-simples">
      <li v-for="b in i.barreiras" :key="b.id" :data-testid="`barreira-${b.id}`">
        {{
          t('nir.altas.barreira', {
            tipo: t(`nir.altas.tipos.${b.tipo}`),
            descricao: b.descricao,
            responsavel: b.responsavel,
            prazo: dataCurta(b.prazo),
          })
        }}
        · {{ t(`nir.altas.situacoes.${b.situacao}`) }}
        <strong v-if="b.vencida"> · {{ t('nir.altas.vencida') }}</strong>
        <template v-if="b.situacao === 'aberta'">
          <SanteBotao
            v-if="pode('alterarBarreira')"
            variante="texto"
            :rotulo="t('crudNir.alterar')"
            :data-testid="`alterar-barreira-${b.id}`"
            @acionar="abrirAlterarB(b)"
          />
          <SanteBotao
            v-if="pode('encerrarBarreira')"
            variante="secundario"
            :rotulo="t('crudNir.encerrar')"
            :data-testid="`encerrar-barreira-${b.id}`"
            @acionar="abrirEncerrarB(b.id)"
          />
        </template>
      </li>
    </ul>
    <details v-if="pode('dpa')" :data-testid="`form-dpa-${i.internacao}`">
      <summary>{{ t('nir.altas.novaDpa') }}</summary>
      <SanteData v-model="data" :rotulo="t('nir.altas.novaDpa')" editavel />
      <SanteCampoTexto
        v-if="ultimaDpa"
        v-model="motivoDpa"
        :rotulo="t('nir.altas.motivoDpa')"
        :max-bytes="200"
      />
      <SanteBotao
        :rotulo="t('nir.altas.gravarDpa')"
        :desabilitado="ocupado || !data || (!!ultimaDpa && motivoDpa.trim().length < 5)"
        :data-testid="`gravar-dpa-${i.internacao}`"
        @acionar="gravarDpa"
      />
    </details>
    <details v-if="pode('barreira')" :data-testid="`form-barreira-${i.internacao}`">
      <summary>{{ t('nir.altas.novaBarreira') }}</summary>
      <SanteSelecao v-model="tipo" :rotulo="t('nir.altas.tipo')" :opcoes="tipos" />
      <SanteCampoTexto v-model="descricao" :rotulo="t('nir.altas.descricao')" :max-bytes="300" />
      <SanteCampoTexto v-model="responsavel" :rotulo="t('nir.altas.responsavel')" :max-bytes="60" />
      <SanteData v-model="prazo" :rotulo="t('nir.altas.prazoBarreira')" editavel />
      <SanteBotao
        :rotulo="t('nir.altas.gravarBarreira')"
        :desabilitado="ocupado || descricao.trim().length < 5 || responsavel.trim().length < 3 || !prazo"
        :data-testid="`gravar-barreira-${i.internacao}`"
        @acionar="gravarBarreira"
      />
    </details>
    <ErroAdt v-if="erro" :erro="erro" />
    <DialogoAlteracaoNir
      ref="refRetirar"
      v-model:visivel="dRetirar"
      :titulo="t('crudNir.retirarDpaTitulo')"
      :texto="t('crudNir.retirarDpaTexto')"
      :rotulo-confirmar="t('crudNir.retirarDpa')"
      destrutivo
      :testid="`dialogo-retirar-dpa-${i.internacao}`"
      @confirmar="retirar"
    />
    <DialogoAlteracaoNir
      ref="refAlterarB"
      v-model:visivel="dAlterarB"
      :titulo="t('crudNir.alterarBarreiraTitulo')"
      :rotulo-confirmar="t('crudNir.alterar')"
      :incompleto="bDescricao.trim().length < 5 || bResponsavel.trim().length < 3 || !bPrazo"
      :testid="`dialogo-alterar-barreira-${i.internacao}`"
      @confirmar="alterarB"
    >
      <SanteCampoTexto v-model="bDescricao" :rotulo="t('nir.altas.descricao')" :max-bytes="300" />
      <SanteCampoTexto
        v-model="bResponsavel"
        :rotulo="t('nir.altas.responsavel')"
        :max-bytes="60"
        :data-testid="`alterar-barreira-responsavel-${i.internacao}`"
      />
      <SanteData v-model="bPrazo" :rotulo="t('nir.altas.prazoBarreira')" editavel />
    </DialogoAlteracaoNir>
    <DialogoAlteracaoNir
      ref="refEncerrarB"
      v-model:visivel="dEncerrarB"
      :titulo="t('crudNir.encerrarBarreiraTitulo')"
      :texto="t('crudNir.encerrarBarreiraTexto')"
      :rotulo-confirmar="t('crudNir.encerrar')"
      :testid="`dialogo-encerrar-barreira-${i.internacao}`"
      @confirmar="encerrarB"
    >
      <SanteSelecao v-model="bResultado" :rotulo="t('crudNir.resultado')" :opcoes="resultados" />
    </DialogoAlteracaoNir>
  </li>
</template>

<style scoped>
.cartao-nir {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-left-width: 6px;
  border-radius: 4px;
}
.cartao-nir[data-cor='verde'] {
  border-left-color: var(--sgh-sucesso);
}
.cartao-nir[data-cor='amarelo'] {
  border-left-color: var(--sgh-aviso);
}
.cartao-nir[data-cor='vermelho'] {
  border-left-color: var(--sgh-alerta);
}
/* Alvo de toque de ao menos 24 px (WCAG 2.2, 2.5.8). */
summary {
  min-height: 2rem;
  padding-block: var(--sgh-espaco-1);
  cursor: pointer;
}
</style>
