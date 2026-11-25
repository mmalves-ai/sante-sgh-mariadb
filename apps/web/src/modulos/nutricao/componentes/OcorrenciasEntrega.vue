<script setup lang="ts">
// Ocorrências na entrega da refeição (F8, 04-HOT linha 143), dentro do mapa de dietas: a lista da refeição e do dia com
// as pendentes primeiro, o registro em um diálogo (paciente já escolhido quando vem da linha do mapa; a justificativa
// pedida na hora quando o tipo exige; o aviso de reposição quando o tipo gera nova bandeja) e a providência que resolve.
// Nada é apagado: a ocorrência resolvida fica com quem e quando.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  lerOcorrencias,
  lerTiposOcorrencia,
  registrarOcorrencia,
  resolverOcorrencia,
  type OcorrenciaRefeicao,
} from '../api-ocorrencia-refeicao.js';
import { novaChaveNutricao } from '../api-nutricao.js';
import ErroNutricao from './ErroNutricao.vue';
import { instanteCurto } from '../regras-nutricao.js';

const JUSTIFICATIVA_MINIMA = 10;
const PROVIDENCIA_MINIMA = 5;

const props = defineProps<{
  consulta: { unidade: string; refeicao: number; data: string };
  /** Os pacientes do mapa (internação e o rótulo com leito e nome). */
  pacientes: readonly { internacao: number; rotulo: string }[];
  /** O mapa da refeição já foi fechado (a bandeja existe). */
  fechado: boolean;
  podeRegistrar: boolean;
  podeResolver: boolean;
}>();

const { t } = useI18n();
const tipos = useQuery({
  queryKey: ['nutricao', 'ocorrencias-tipos'],
  queryFn: lerTiposOcorrencia,
  staleTime: 300_000,
  enabled: computed(() => props.fechado),
});
const lista = useQuery({
  queryKey: computed(() => ['nutricao', 'ocorrencias', props.consulta]),
  queryFn: () => lerOcorrencias(props.consulta.unidade, props.consulta.refeicao, props.consulta.data),
  enabled: computed(() => props.fechado),
  refetchInterval: 60_000,
});
const itens = computed(() => lista.data.value ?? []);
const pendentes = computed(() => itens.value.filter((o) => !o.resolvida).length);
const rotuloDe = (internacao: number | null) =>
  props.pacientes.find((p) => p.internacao === internacao)?.rotulo ?? String(internacao ?? '');

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const reposicao = ref(false);
const ocupado = ref(false);

// ── Registro ──
const dialogo = ref(false);
const internacao = ref<number | null>(null);
const tipo = ref<number | null>(null);
const descricao = ref('');
const ocorridoEm = ref('');
const opcoesPacientes = computed(() =>
  props.pacientes.map((p) => ({ valor: p.internacao, rotulo: p.rotulo })),
);
const opcoesTipos = computed(() =>
  (tipos.data.value ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
);
const tipoEscolhido = computed(() => (tipos.data.value ?? []).find((x) => x.id === tipo.value) ?? null);
const faltaJustificativa = computed(
  () => !!tipoEscolhido.value?.exigeJustificativa && descricao.value.trim().length < JUSTIFICATIVA_MINIMA,
);
const momentoInvalido = computed(
  () => ocorridoEm.value.trim() !== '' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ocorridoEm.value.trim()),
);
const podeGravar = computed(
  () =>
    internacao.value !== null &&
    tipo.value !== null &&
    !faltaJustificativa.value &&
    !momentoInvalido.value &&
    !ocupado.value,
);

/** Abre o registro; da linha do mapa, com o paciente já escolhido. */
function abrir(reg: number | null = null): void {
  internacao.value = reg;
  tipo.value = null;
  descricao.value = '';
  ocorridoEm.value = '';
  erro.value = null;
  dialogo.value = true;
}
defineExpose({ abrir });

async function executar(fn: () => Promise<void>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await fn();
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const gravar = () =>
  executar(async () => {
    const r = await registrarOcorrencia(
      {
        ...props.consulta,
        internacao: internacao.value as number,
        tipo: tipo.value as number,
        descricao: descricao.value.trim() || null,
        ocorridoEm: ocorridoEm.value.trim() || null,
      },
      novaChaveNutricao('ocorrencia-refeicao'),
    );
    mensagem.value = r.mensagem;
    reposicao.value = r.reposicao;
    dialogo.value = false;
  });

// ── Resolução ──
const resolvendo = ref<OcorrenciaRefeicao | null>(null);
const dialogoResolver = computed({
  get: () => resolvendo.value !== null,
  set: (v: boolean) => {
    if (!v) resolvendo.value = null;
  },
});
const providencia = ref('');
const faltaProvidencia = computed(() => providencia.value.trim().length < PROVIDENCIA_MINIMA);
function abrirResolver(o: OcorrenciaRefeicao): void {
  providencia.value = '';
  erro.value = null;
  resolvendo.value = o;
}
const resolver = () =>
  executar(async () => {
    const o = resolvendo.value as OcorrenciaRefeicao;
    await resolverOcorrencia(
      o.id,
      { providencia: providencia.value.trim(), versao: o.versao },
      novaChaveNutricao('ocorrencia-resolver'),
    );
    mensagem.value = t('nutricao.ocorrencias.gravada');
    reposicao.value = false;
    resolvendo.value = null;
  });
</script>

<template>
  <section class="painel ocorrencias" aria-labelledby="ocorrencias-titulo" data-testid="ocorrencias-entrega">
    <h2 id="ocorrencias-titulo">
      {{ t('nutricao.ocorrencias.titulo') }}
      <span v-if="pendentes" class="pendentes" data-testid="ocorrencias-pendentes">
        · {{ t('nutricao.ocorrencias.pendentes', { n: pendentes }) }}</span
      >
    </h2>
    <p class="secundario">{{ t('nutricao.ocorrencias.texto') }}</p>
    <p v-if="!fechado" class="secundario" data-testid="ocorrencias-sem-mapa">
      {{ t('nutricao.ocorrencias.soComMapaFechado') }}
    </p>
    <template v-else>
      <SanteAlerta
        v-if="mensagem"
        :variante="reposicao ? 'aviso' : 'info'"
        :texto="mensagem"
        anunciar
        data-testid="ocorrencias-mensagem"
      />
      <ErroNutricao v-if="erro && !dialogo && !resolvendo" :erro="erro" />
      <ErroNutricao v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-if="podeRegistrar" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('nutricao.ocorrencias.registrar')"
          data-testid="ocorrencia-registrar"
          @acionar="abrir()"
        />
      </p>
      <p v-if="itens.length === 0 && !lista.isLoading.value">{{ t('nutricao.ocorrencias.nenhuma') }}</p>
      <table v-else-if="itens.length" class="tabela" data-testid="tabela-ocorrencias">
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.ocorrencias.quando') }}</th>
            <th scope="col">{{ t('nutricao.ocorrencias.paciente') }}</th>
            <th scope="col">{{ t('nutricao.ocorrencias.ocorrencia') }}</th>
            <th scope="col">{{ t('nutricao.ocorrencias.registradaPor') }}</th>
            <th scope="col">{{ t('nutricao.ocorrencias.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in itens"
            :key="o.id"
            :data-testid="`ocorrencia-${o.id}`"
            :class="{ aberta: !o.resolvida }"
          >
            <td>{{ instanteCurto(o.ocorridoEm) }}</td>
            <td>{{ rotuloDe(o.internacao) }}</td>
            <td>
              <strong>{{ o.tipoDescricao }}</strong>
              <span v-if="o.reposicao" class="reposicao"> · {{ t('nutricao.ocorrencias.reposicao') }}</span>
              <div class="secundario">{{ o.descricao }}</div>
            </td>
            <td>{{ o.registradaPor ?? '' }}</td>
            <td>
              <template v-if="o.resolvida">
                {{
                  t('nutricao.ocorrencias.resolvida', {
                    por: o.resolvidaPor ?? '',
                    em: instanteCurto(o.resolvidaEm),
                  })
                }}
                <div class="secundario">{{ o.providencia }}</div>
              </template>
              <template v-else>
                <span>{{ t('nutricao.ocorrencias.pendente') }}</span>
                <SanteBotao
                  v-if="podeResolver"
                  variante="texto"
                  :rotulo="t('nutricao.ocorrencias.resolver')"
                  :data-testid="`ocorrencia-resolver-${o.id}`"
                  @acionar="abrirResolver(o)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        internacao !== null
          ? t('nutricao.ocorrencias.registrarDe', { nome: rotuloDe(internacao) })
          : t('nutricao.ocorrencias.registrar')
      "
      largura="36rem"
    >
      <form class="formulario" data-testid="dialogo-ocorrencia" @submit.prevent="podeGravar && gravar()">
        <ErroNutricao v-if="erro" :erro="erro" />
        <p v-if="tipos.data.value && tipos.data.value.length === 0" role="status">
          {{ t('nutricao.ocorrencias.semTipos') }}
        </p>
        <SanteSelecao
          v-model="internacao"
          :rotulo="t('nutricao.ocorrencias.paciente')"
          :opcoes="opcoesPacientes"
          obrigatorio
          data-testid="ocorrencia-paciente"
        />
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('nutricao.ocorrencias.tipo')"
          :opcoes="opcoesTipos"
          obrigatorio
          data-testid="ocorrencia-tipo"
        />
        <SanteAlerta
          v-if="tipoEscolhido?.geraReposicao"
          variante="aviso"
          :texto="t('nutricao.ocorrencias.geraReposicao')"
          data-testid="ocorrencia-aviso-reposicao"
        />
        <SanteCampoTexto
          v-model="descricao"
          :rotulo="
            tipoEscolhido?.exigeJustificativa
              ? t('nutricao.ocorrencias.justificativa')
              : t('nutricao.ocorrencias.descricao')
          "
          :max-bytes="2000"
          :obrigatorio="!!tipoEscolhido?.exigeJustificativa"
          multilinha
          data-testid="ocorrencia-descricao"
        />
        <p v-if="faltaJustificativa" class="falta" role="status" data-testid="ocorrencia-falta-justificativa">
          {{ t('nutricao.ocorrencias.justificativaCurta', { min: JUSTIFICATIVA_MINIMA }) }}
        </p>
        <SanteCampoTexto
          v-model="ocorridoEm"
          :rotulo="t('nutricao.ocorrencias.ocorridoEm')"
          :max-bytes="16"
          data-testid="ocorrencia-quando"
        />
        <p v-if="momentoInvalido" class="falta" role="status">
          {{ t('nutricao.ocorrencias.ocorridoEmInvalido') }}
        </p>
        <p class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('nutricao.gravar')"
            :desabilitado="!podeGravar"
            data-testid="ocorrencia-gravar"
          />
        </p>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoResolver"
      :titulo="t('nutricao.ocorrencias.resolverTitulo')"
      largura="32rem"
    >
      <form
        v-if="resolvendo"
        class="formulario"
        data-testid="dialogo-resolver-ocorrencia"
        @submit.prevent="!faltaProvidencia && resolver()"
      >
        <ErroNutricao v-if="erro" :erro="erro" />
        <p>
          <strong>{{ resolvendo.tipoDescricao }}</strong> · {{ rotuloDe(resolvendo.internacao) }}
        </p>
        <p class="secundario">{{ resolvendo.descricao }}</p>
        <SanteCampoTexto
          v-model="providencia"
          :rotulo="t('nutricao.ocorrencias.providencia')"
          :max-bytes="2000"
          obrigatorio
          multilinha
          data-testid="ocorrencia-providencia"
        />
        <p v-if="faltaProvidencia && providencia.length > 0" class="falta" role="status">
          {{ t('nutricao.ocorrencias.providenciaCurta', { min: PROVIDENCIA_MINIMA }) }}
        </p>
        <p class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('nutricao.gravar')"
            :desabilitado="faltaProvidencia || ocupado"
            data-testid="ocorrencia-resolver-gravar"
          />
        </p>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.ocorrencias {
  margin-top: var(--sgh-espaco-4);
}
.pendentes,
.falta {
  color: var(--sgh-alerta);
}
.reposicao {
  color: var(--sgh-aviso);
  font-weight: 600;
}
tr.aberta td:first-child {
  border-inline-start: 4px solid var(--sgh-aviso);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-3);
}
</style>
