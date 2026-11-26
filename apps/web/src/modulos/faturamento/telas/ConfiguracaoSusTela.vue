<script setup lang="ts">
// Configuração do faturamento SUS (C1-051, 06-SUS linha 53) — `Faturamento > Faturamento SUS > Configuração`:
// a permissão por usuário e setor (quem digita e fatura a produção SUS de cada setor, além do cargo) e os parâmetros
// próprios de cada instrumento (CIHA, BPA, APAC e AIH), no lugar do texto solto nos parâmetros gerais. A mesma regra do
// servidor roda na hora (normalizarParametrosSus): cada erro aparece ao lado do campo antes de gravar. A permissão se
// encerra na própria linha, pela vigência (nada apagado); o parâmetro grava na versão vista.
import {
  type CamposParametroSus,
  FONTES_REMUNERACAO_CIHA,
  INSTRUMENTOS_PARAMETRO_SUS,
  type InstrumentoParametroSus,
  type PermissaoSetorSusLida,
  TIPOS_PERMISSAO_SETOR_SUS,
  type TipoPermissaoSetorSus,
} from '@sgh/contratos';
import { CAMPOS_DO_INSTRUMENTO_SUS, normalizarParametrosSus } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  encerrarPermissaoSetorSus,
  gravarParametrosSus,
  incluirPermissaoSetorSus,
  lerConfiguracaoSus,
} from '../api-sus-configuracao.js';

const { t } = useI18n();
const P = 'faturamentoSus.configuracao';
const cliente = useQueryClient();
const tela = useQuery({ queryKey: ['sus', 'configuracao'], queryFn: lerConfiguracaoSus });
const podeEditar = computed(() => tela.data.value?.podeEditar === true);
const recarregar = () => cliente.invalidateQueries({ queryKey: ['sus', 'configuracao'] });

// ── Permissão por usuário e setor ──
const f = reactive({
  usuario: null as number | null,
  setor: null as number | null,
  tipo: 'digitacao_faturamento' as TipoPermissaoSetorSus,
  inicio: '',
  fim: '',
});
watch(
  () => tela.data.value?.hoje,
  (h) => {
    if (h && !f.inicio) f.inicio = h;
  },
  { immediate: true },
);
const opUsuarios = computed(() => [
  { valor: null, rotulo: t(`${P}.permissoes.usuario`) },
  ...(tela.data.value?.usuarios ?? []).map((u) => ({ valor: u.id, rotulo: `${u.nome} (${u.login})` })),
]);
const opSetores = computed(() => [
  { valor: null, rotulo: t(`${P}.permissoes.setor`) },
  ...(tela.data.value?.setores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const opTipos = computed(() =>
  TIPOS_PERMISSAO_SETOR_SUS.map((x) => ({ valor: x, rotulo: t(`${P}.permissoes.tipos.${x}`) })),
);
const problemas = computed(() => {
  const p: string[] = [];
  if (f.usuario === null) p.push(t(`${P}.permissoes.problemas.usuario`));
  if (f.setor === null) p.push(t(`${P}.permissoes.problemas.setor`));
  if (!f.inicio) p.push(t(`${P}.permissoes.problemas.inicio`));
  if (f.fim && f.inicio && f.fim < f.inicio) p.push(t(`${P}.permissoes.problemas.fim`));
  return p;
});
const incluir = useMutation({
  mutationFn: () =>
    incluirPermissaoSetorSus({
      usuario: f.usuario!,
      setor: f.setor!,
      tipo: f.tipo,
      vigenciaInicio: f.inicio,
      vigenciaFim: f.fim || null,
    }),
  onSuccess: async () => {
    f.usuario = null;
    f.setor = null;
    f.fim = '';
    await recarregar();
  },
});

const encerrando = ref<number | null>(null);
const fimEncerrar = ref('');
const encerrar = useMutation({
  mutationFn: (p: PermissaoSetorSusLida) =>
    encerrarPermissaoSetorSus(p.id, { vigenciaFim: fimEncerrar.value, versao: p.versao }),
  onSuccess: async () => {
    encerrando.value = null;
    await recarregar();
  },
});
function abrirEncerrar(p: PermissaoSetorSusLida) {
  encerrando.value = p.id;
  fimEncerrar.value = tela.data.value?.hoje ?? p.vigenciaInicio;
}

// ── Parâmetros por instrumento ──
const VAZIO: CamposParametroSus = {
  fontePadrao: null,
  orgaoOrigem: null,
  siglaOrigem: null,
  cnpjPrestador: null,
  orgaoDestino: null,
  indicadorDestino: null,
  uf: null,
  utiPorAcomodacao: null,
  diretorClinicoCns: null,
};
const rascunhos = reactive<Record<InstrumentoParametroSus, CamposParametroSus>>({
  ciha: { ...VAZIO },
  bpa: { ...VAZIO },
  apac: { ...VAZIO },
  aih: { ...VAZIO },
});
watch(
  () => tela.data.value?.parametros,
  (ps) => {
    for (const p of ps ?? []) rascunhos[p.instrumento] = { ...p.campos };
  },
  { immediate: true },
);
const lido = (i: InstrumentoParametroSus) => tela.data.value?.parametros.find((p) => p.instrumento === i);
const erros = computed(
  () =>
    Object.fromEntries(
      INSTRUMENTOS_PARAMETRO_SUS.map((i) => [
        i,
        Object.fromEntries(
          normalizarParametrosSus(i, rascunhos[i]).erros.map((e) => [
            e.campo,
            t(`${P}.parametros.regras.${e.regra}`),
          ]),
        ),
      ]),
    ) as Record<InstrumentoParametroSus, Partial<Record<keyof CamposParametroSus, string>>>,
);
const opFontes = computed(() => [
  { valor: null, rotulo: t(`${P}.parametros.nenhum`) },
  ...FONTES_REMUNERACAO_CIHA.map((x) => ({ valor: x, rotulo: x })),
]);
const opDestinos = computed(() => [
  { valor: null, rotulo: t(`${P}.parametros.nenhum`) },
  { valor: 'E', rotulo: t(`${P}.parametros.destinos.E`) },
  { valor: 'M', rotulo: t(`${P}.parametros.destinos.M`) },
]);
const gravadoEm = ref<InstrumentoParametroSus | null>(null);
const gravar = useMutation({
  mutationFn: (i: InstrumentoParametroSus) =>
    gravarParametrosSus(i, { campos: rascunhos[i], versao: lido(i)?.versao ?? null }),
  onSuccess: async (_r, i) => {
    gravadoEm.value = i;
    await recarregar();
  },
});
const camposTexto = (i: InstrumentoParametroSus) =>
  CAMPOS_DO_INSTRUMENTO_SUS[i].filter((c) => c !== 'fontePadrao' && c !== 'indicadorDestino');
const texto = (i: InstrumentoParametroSus, c: keyof CamposParametroSus) =>
  computed({
    get: () => (rascunhos[i][c] as string | null) ?? '',
    set: (v: string) => {
      (rascunhos[i] as Record<string, unknown>)[c] = v === '' ? null : v;
    },
  });
const modelos = Object.fromEntries(
  INSTRUMENTOS_PARAMETRO_SUS.map((i) => [i, Object.fromEntries(camposTexto(i).map((c) => [c, texto(i, c)]))]),
) as Record<InstrumentoParametroSus, Record<string, ReturnType<typeof texto>>>;
</script>

<template>
  <section class="tela" aria-labelledby="configuracao-sus-titulo" data-testid="tela-configuracao-sus">
    <h1 id="configuracao-sus-titulo">{{ t(`${P}.titulo`) }}</h1>
    <p class="ajuda">{{ t(`${P}.explicacao`) }}</p>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />

    <template v-else-if="tela.data.value">
      <h2>{{ t(`${P}.permissoes.titulo`) }}</h2>
      <form
        v-if="podeEditar"
        class="formulario"
        data-testid="permissao-sus-form"
        @submit.prevent="problemas.length === 0 && incluir.mutate()"
      >
        <SanteSelecao
          v-model="f.usuario"
          :rotulo="t(`${P}.permissoes.usuario`)"
          :opcoes="opUsuarios"
          data-testid="permissao-sus-usuario"
        />
        <SanteSelecao
          v-model="f.setor"
          :rotulo="t(`${P}.permissoes.setor`)"
          :opcoes="opSetores"
          data-testid="permissao-sus-setor"
        />
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t(`${P}.permissoes.tipo`)"
          :opcoes="opTipos"
          data-testid="permissao-sus-tipo"
        />
        <label
          >{{ t(`${P}.permissoes.inicio`) }}
          <input v-model="f.inicio" type="date" required data-testid="permissao-sus-inicio"
        /></label>
        <label
          >{{ t(`${P}.permissoes.fim`) }}
          <input v-model="f.fim" type="date" :min="f.inicio" data-testid="permissao-sus-fim"
        /></label>
        <ul v-if="problemas.length" class="problemas" data-testid="permissao-sus-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemas.length > 0 || incluir.isPending.value"
          data-testid="permissao-sus-incluir"
        >
          {{ t(`${P}.permissoes.incluir`) }}
        </button>
        <MensagemErro v-if="incluir.isError.value" :erro="incluir.error.value" />
      </form>
      <p v-else data-testid="configuracao-sus-so-consulta">{{ t(`${P}.permissoes.semPermissao`) }}</p>

      <p v-if="tela.data.value.permissoes.length === 0" data-testid="permissao-sus-vazio">
        {{ t(`${P}.permissoes.vazio`) }}
      </p>
      <table v-else data-testid="permissao-sus-lista">
        <thead>
          <tr>
            <th scope="col">{{ t(`${P}.permissoes.usuario`) }}</th>
            <th scope="col">{{ t(`${P}.permissoes.setor`) }}</th>
            <th scope="col">{{ t(`${P}.permissoes.tipo`) }}</th>
            <th scope="col">{{ t(`${P}.permissoes.inicio`) }}</th>
            <th scope="col">{{ t(`${P}.permissoes.situacao`) }}</th>
            <th v-if="podeEditar" scope="col">{{ t(`${P}.permissoes.acoes`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in tela.data.value.permissoes"
            :key="p.id"
            :data-testid="`permissao-sus-linha-${p.id}`"
          >
            <td>{{ p.usuario.nome }} ({{ p.usuario.login }})</td>
            <td>{{ p.setor.nome }}</td>
            <td>{{ t(`${P}.permissoes.tipos.${p.tipo}`) }}</td>
            <td>{{ p.vigenciaInicio }} — {{ p.vigenciaFim ?? t(`${P}.permissoes.abertaAte`) }}</td>
            <td :data-testid="`permissao-sus-situacao-${p.id}`">
              {{ p.vigente ? t(`${P}.permissoes.vigente`) : t(`${P}.permissoes.encerrada`) }}
            </td>
            <td v-if="podeEditar">
              <template v-if="encerrando === p.id">
                <input
                  v-model="fimEncerrar"
                  type="date"
                  :min="p.vigenciaInicio"
                  :max="p.vigenciaFim ?? undefined"
                  data-testid="permissao-sus-encerrar-fim"
                />
                <button
                  type="button"
                  :disabled="!fimEncerrar || fimEncerrar < p.vigenciaInicio || encerrar.isPending.value"
                  data-testid="permissao-sus-encerrar-confirmar"
                  @click="encerrar.mutate(p)"
                >
                  {{ t(`${P}.permissoes.confirmarEncerrar`) }}
                </button>
              </template>
              <button
                v-else-if="p.vigente"
                type="button"
                :data-testid="`permissao-sus-encerrar-${p.id}`"
                @click="abrirEncerrar(p)"
              >
                {{ t(`${P}.permissoes.encerrar`) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <MensagemErro v-if="encerrar.isError.value" :erro="encerrar.error.value" />

      <h2>{{ t(`${P}.parametros.titulo`) }}</h2>
      <form
        v-for="i in INSTRUMENTOS_PARAMETRO_SUS"
        :key="i"
        class="formulario"
        :data-testid="`parametros-sus-${i}`"
        @submit.prevent="Object.keys(erros[i]).length === 0 && gravar.mutate(i)"
      >
        <h3>{{ t(`${P}.parametros.instrumentos.${i}`) }}</h3>
        <p class="ajuda" :data-testid="`parametros-sus-${i}-origem`">
          {{
            lido(i)?.versao
              ? t(`${P}.parametros.alterado`, {
                  quem: lido(i)?.alteradoPor ?? '',
                  quando: lido(i)?.alteradoEm ?? '',
                })
              : t(`${P}.parametros.semCadastro`)
          }}
        </p>
        <SanteSelecao
          v-if="i === 'ciha'"
          v-model="rascunhos.ciha.fontePadrao"
          :rotulo="t(`${P}.parametros.campos.fontePadrao`)"
          :opcoes="opFontes"
          :desabilitado="!podeEditar"
          data-testid="parametros-sus-ciha-fontePadrao"
        />
        <SanteSelecao
          v-if="i === 'bpa'"
          v-model="rascunhos.bpa.indicadorDestino"
          :rotulo="t(`${P}.parametros.campos.indicadorDestino`)"
          :opcoes="opDestinos"
          :desabilitado="!podeEditar"
          data-testid="parametros-sus-bpa-indicadorDestino"
        />
        <label v-for="c in camposTexto(i)" :key="c">
          {{ t(`${P}.parametros.campos.${c}`) }}
          <input
            v-model="modelos[i][c]!.value"
            type="text"
            :disabled="!podeEditar"
            :aria-invalid="erros[i][c] ? 'true' : 'false'"
            :data-testid="`parametros-sus-${i}-${c}`"
          />
          <span v-if="erros[i][c]" class="erro-campo" :data-testid="`parametros-sus-${i}-${c}-erro`">{{
            erros[i][c]
          }}</span>
        </label>
        <button
          v-if="podeEditar"
          type="submit"
          :disabled="Object.keys(erros[i]).length > 0 || gravar.isPending.value"
          :data-testid="`parametros-sus-${i}-gravar`"
        >
          {{ t(`${P}.parametros.gravar`) }}
        </button>
        <p
          v-if="gravadoEm === i && gravar.isSuccess.value"
          role="status"
          :data-testid="`parametros-sus-${i}-gravado`"
        >
          {{ t(`${P}.parametros.gravado`) }}
        </p>
      </form>
      <MensagemErro v-if="gravar.isError.value" :erro="gravar.error.value" />
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.formulario h3,
.ajuda {
  flex-basis: 100%;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-alerta-texto);
}
.erro-campo {
  display: block;
  color: var(--sgh-alerta-texto);
}
</style>
