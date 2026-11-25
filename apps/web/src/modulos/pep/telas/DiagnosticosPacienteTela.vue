<script setup lang="ts">
// Diagnósticos do paciente com a terminologia clínica (F8, 09-AREA linha 84), numa tela só por paciente: no topo o
// registro do diagnóstico do atendimento em curso (CID-10 buscada por código ou nome; ao escolher a CID, os conceitos
// clínicos equivalentes vêm primeiro e o principal já fica sugerido, o que poupa a segunda busca), e abaixo todos os
// diagnósticos do paciente, do mais recente ao mais antigo, com a troca ou a retirada do conceito na própria linha.
// Validação na hora: o botão só libera com a CID e a observação dentro do limite. Nada é apagado; a regra final
// (CID de categoria, conceito ativo, diagnóstico inativado) é do servidor e a recusa aparece como veio.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarCids,
  buscarConceitos,
  gravarDiagnostico,
  lerDiagnosticosPaciente,
  type DiagnosticoTela,
} from '../api-terminologia-clinica.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const atendimento = computed(() => {
  const n = Number(rota.query['atendimento']);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const chave = computed(() => ['pep', 'diagnosticos', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerDiagnosticosPaciente(id.value), staleTime: 0 });
const lista = computed(() => dados.data.value ?? []);
const erro = ref<unknown>(null);
const ok = ref('');
const MAXIMO = 2000;
const SEM = 'sem';
/** O texto da busca só segue para a API depois de 300 ms sem digitar. */
function adiado(fonte: () => string): Ref<string> {
  const r = ref(fonte());
  let espera: ReturnType<typeof setTimeout> | undefined;
  watch(fonte, (v) => {
    clearTimeout(espera);
    espera = setTimeout(() => (r.value = v), 300);
  });
  return r;
}
const podeGravar = computed(() => pode('pep.evolucao.criar'));

// Registro: CID buscada, conceito sugerido pela equivalência.
const nova = reactive({
  buscaCid: '',
  cid: '',
  buscaConceito: '',
  conceito: SEM,
  tipo: 'secundario',
  certeza: 'confirmado',
  escopo: 'atendimento',
  observacao: '',
});
const buscaCid = adiado(() => nova.buscaCid.trim());
const cids = useQuery({
  queryKey: computed(() => ['pep', 'cids', buscaCid.value]),
  queryFn: () => buscarCids(buscaCid.value),
  enabled: computed(() => buscaCid.value.length >= 2),
});
const opcoesCid = computed(() =>
  (cids.data.value ?? []).map((c) => ({ valor: String(c.id), rotulo: `${c.codigo} · ${c.descricao}` })),
);
watch(opcoesCid, (os) => {
  if (os.length === 1 && !nova.cid) nova.cid = os[0]!.valor;
});

const buscaConceito = adiado(() => nova.buscaConceito.trim());
const conceitos = useQuery({
  queryKey: computed(() => ['pep', 'conceitos', nova.cid, buscaConceito.value]),
  queryFn: () =>
    buscarConceitos({ texto: buscaConceito.value, ...(nova.cid ? { cid: Number(nova.cid) } : {}) }),
  enabled: computed(() => Boolean(nova.cid) || buscaConceito.value.length >= 2),
});
const rotuloConceito = (c: { codigo: string; descricao: string; equivalencia: string | null }) =>
  c.equivalencia
    ? `${c.descricao} (${c.codigo}; ${t(`pep.terminologia.equivalencias.${c.equivalencia}`)})`
    : `${c.descricao} (${c.codigo})`;
const opcoesConceito = computed(() => [
  { valor: SEM, rotulo: t('pep.terminologia.semConceito') },
  ...(conceitos.data.value ?? []).map((c) => ({ valor: String(c.id), rotulo: rotuloConceito(c) })),
]);
// A troca da CID refaz a sugestão: a equivalência principal (a primeira) vem marcada.
watch(
  () => nova.cid,
  () => {
    nova.conceito = SEM;
  },
);
watch(
  () => conceitos.data.value,
  (cs) => {
    const primeiro = cs?.[0];
    if (nova.conceito === SEM && primeiro?.equivalencia) nova.conceito = String(primeiro.id);
  },
);

const opcoesDe = (grupo: 'tipos' | 'certezas' | 'escopos', valores: readonly string[]) =>
  valores.map((v) => ({ valor: v, rotulo: t(`pep.terminologia.${grupo}.${v}`) }));
const opcoesTipo = computed(() =>
  opcoesDe('tipos', ['principal', 'secundario', 'admissao', 'alta', 'obito']),
);
const opcoesCerteza = computed(() => opcoesDe('certezas', ['suspeito', 'confirmado', 'descartado']));
const opcoesEscopo = computed(() => opcoesDe('escopos', ['atendimento', 'prontuario']));
const restam = computed(() => MAXIMO - nova.observacao.length);
const novaPronta = computed(() => Boolean(nova.cid) && restam.value >= 0 && atendimento.value !== null);

async function gravar(corpo: Record<string, unknown>, mensagem: string): Promise<boolean> {
  erro.value = null;
  ok.value = '';
  try {
    await gravarDiagnostico(corpo);
    ok.value = mensagem;
    await cliente.invalidateQueries({ queryKey: chave.value });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

async function registrar() {
  if (!novaPronta.value) return;
  const feito = await gravar(
    {
      acao: 'registrar',
      paciente: id.value,
      atendimento: atendimento.value,
      cid: Number(nova.cid),
      conceito: nova.conceito === SEM ? null : Number(nova.conceito),
      tipo: nova.tipo,
      certeza: nova.certeza,
      escopo: nova.escopo,
      observacao: nova.observacao.trim() || null,
    },
    t('pep.terminologia.gravado'),
  );
  if (feito) Object.assign(nova, { buscaCid: '', cid: '', buscaConceito: '', conceito: SEM, observacao: '' });
}

// Troca do conceito na linha: a mesma busca, sugerida pela CID do diagnóstico.
const trocando = ref<number | null>(null);
const troca = reactive({ busca: '', conceito: SEM });
const buscaTroca = adiado(() => troca.busca.trim());
const diagnosticoTrocado = computed(() => lista.value.find((d) => d.id === trocando.value) ?? null);
const conceitosTroca = useQuery({
  queryKey: computed(() => ['pep', 'conceitos', diagnosticoTrocado.value?.cid.id, buscaTroca.value]),
  queryFn: () =>
    buscarConceitos({
      texto: buscaTroca.value,
      ...(diagnosticoTrocado.value ? { cid: diagnosticoTrocado.value.cid.id } : {}),
    }),
  enabled: computed(() => diagnosticoTrocado.value !== null),
});
const opcoesTroca = computed(() => [
  { valor: SEM, rotulo: t('pep.terminologia.semConceito') },
  ...(conceitosTroca.data.value ?? []).map((c) => ({ valor: String(c.id), rotulo: rotuloConceito(c) })),
]);
function abrirTroca(d: DiagnosticoTela) {
  trocando.value = d.id;
  troca.busca = '';
  troca.conceito = d.conceito ? String(d.conceito.id) : SEM;
}
async function gravarTroca(d: DiagnosticoTela, conceito: number | null) {
  const feito = await gravar(
    { acao: 'conceito', diagnostico: d.id, versao: d.versao, conceito },
    t('pep.terminologia.conceitoTrocado'),
  );
  if (feito) trocando.value = null;
}
</script>

<template>
  <section class="diagnosticos" data-testid="diagnosticos-tela">
    <h1>{{ t('pep.terminologia.titulo') }}</h1>
    <p class="diagnosticos__meta">{{ t('pep.terminologia.texto') }}</p>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="diagnosticos-ok" />

    <template v-if="!dados.error.value">
      <h2>{{ t('pep.terminologia.novo') }}</h2>
      <p v-if="!podeGravar">{{ t('pep.terminologia.semPermissao') }}</p>
      <p v-else-if="atendimento === null" data-testid="diagnosticos-sem-atendimento">
        {{ t('pep.terminologia.semAtendimento') }}
      </p>
      <form v-else class="diagnosticos__novo" data-testid="diagnosticos-novo" @submit.prevent="registrar">
        <label>
          {{ t('pep.terminologia.buscarCid') }}
          <input v-model="nova.buscaCid" type="search" maxlength="100" data-testid="diagnosticos-busca-cid" />
        </label>
        <SanteSelecao
          v-model="nova.cid"
          :rotulo="t('pep.terminologia.cid')"
          :opcoes="opcoesCid"
          data-testid="diagnosticos-cid"
        />
        <small v-if="buscaCid.length >= 2 && cids.isSuccess.value && !opcoesCid.length">{{
          t('pep.terminologia.semCid')
        }}</small>
        <label>
          {{ t('pep.terminologia.buscarConceito') }}
          <input
            v-model="nova.buscaConceito"
            type="search"
            maxlength="100"
            data-testid="diagnosticos-busca-conceito"
          />
        </label>
        <SanteSelecao
          v-model="nova.conceito"
          :rotulo="t('pep.terminologia.conceito')"
          :opcoes="opcoesConceito"
          data-testid="diagnosticos-conceito"
        />
        <SanteSelecao
          v-model="nova.tipo"
          :rotulo="t('pep.terminologia.tipo')"
          :opcoes="opcoesTipo"
          data-testid="diagnosticos-tipo"
        />
        <SanteSelecao
          v-model="nova.certeza"
          :rotulo="t('pep.terminologia.certeza')"
          :opcoes="opcoesCerteza"
          data-testid="diagnosticos-certeza"
        />
        <SanteSelecao
          v-model="nova.escopo"
          :rotulo="t('pep.terminologia.escopo')"
          :opcoes="opcoesEscopo"
          data-testid="diagnosticos-escopo"
        />
        <label class="diagnosticos__texto">
          {{ t('pep.terminologia.observacao') }}
          <textarea
            v-model="nova.observacao"
            :maxlength="MAXIMO"
            rows="2"
            data-testid="diagnosticos-observacao"
          />
          <small>{{ t('pep.terminologia.restam', { n: restam }) }}</small>
        </label>
        <SanteBotao
          tipo="submit"
          :desabilitado="!novaPronta"
          :rotulo="t('pep.terminologia.registrar')"
          data-testid="diagnosticos-registrar"
        />
      </form>
    </template>

    <h2>{{ t('pep.terminologia.lista', { n: lista.length }) }}</h2>
    <p v-if="dados.isPending.value">{{ t('pep.carregando') }}</p>
    <p v-else-if="!lista.length && !dados.error.value" data-testid="diagnosticos-nenhum">
      {{ t('pep.terminologia.nenhum') }}
    </p>
    <article
      v-for="d in lista"
      :key="d.id"
      class="diagnosticos__item"
      :class="{ 'diagnosticos__item--fora': d.situacao !== 'ativo' }"
      :data-testid="`diagnostico-${d.id}`"
    >
      <p>
        <strong>{{ d.cid.codigo }} · {{ d.cid.descricao }}</strong>
        · {{ t(`pep.terminologia.tipos.${d.tipo}`) }} · {{ t(`pep.terminologia.certezas.${d.certeza}`) }} ·
        {{ t(`pep.terminologia.situacoes.${d.situacao}`) }}
      </p>
      <p :data-testid="`diagnostico-conceito-${d.id}`">
        {{ t('pep.terminologia.conceito') }}:
        {{
          d.conceito ? `${d.conceito.descricao} (${d.conceito.codigo})` : t('pep.terminologia.semConceito')
        }}
      </p>
      <p v-if="d.observacao" class="diagnosticos__corpo">{{ d.observacao }}</p>
      <p class="diagnosticos__meta">
        {{ t('pep.terminologia.atendimento', { n: d.atendimentoId }) }} ·
        {{
          t('pep.terminologia.por', {
            profissional: d.profissional ?? '-',
            quando: dataHoraBr(d.diagnosticadoEm),
          })
        }}
      </p>
      <div v-if="podeGravar && d.situacao !== 'inativado'" class="diagnosticos__passo">
        <template v-if="trocando === d.id">
          <label>
            {{ t('pep.terminologia.buscarConceito') }}
            <input v-model="troca.busca" type="search" maxlength="100" :data-testid="`troca-busca-${d.id}`" />
          </label>
          <SanteSelecao
            v-model="troca.conceito"
            :rotulo="t('pep.terminologia.conceito')"
            :opcoes="opcoesTroca"
            :data-testid="`troca-conceito-${d.id}`"
          />
          <SanteBotao
            :desabilitado="troca.conceito === SEM"
            :rotulo="t('pep.terminologia.gravarConceito')"
            :data-testid="`troca-gravar-${d.id}`"
            @acionar="gravarTroca(d, Number(troca.conceito))"
          />
        </template>
        <SanteBotao
          v-else
          variante="secundario"
          :rotulo="t('pep.terminologia.trocarConceito')"
          :data-testid="`trocar-conceito-${d.id}`"
          @acionar="abrirTroca(d)"
        />
        <SanteBotao
          v-if="d.conceito"
          variante="secundario"
          :rotulo="t('pep.terminologia.tirarConceito')"
          :data-testid="`tirar-conceito-${d.id}`"
          @acionar="gravarTroca(d, null)"
        />
      </div>
    </article>
  </section>
</template>

<style scoped>
.diagnosticos__novo,
.diagnosticos__passo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.diagnosticos__texto {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.diagnosticos__item {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.diagnosticos__item--fora {
  color: var(--sgh-texto-secundario);
}
.diagnosticos__corpo {
  white-space: pre-wrap;
}
.diagnosticos__meta {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
</style>
