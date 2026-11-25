<script setup lang="ts">
// Destino do corpo após o óbito (C1-112, 09-AREA linha 74), em /internacao/obitos:
//   - à esquerda, o painel dos óbitos com o destino em aberto e o que falta em cada um (ou todos, com a marca);
//     `?paciente=` abre direto a visão do paciente;
//   - no óbito escolhido, a funerária e o cartório da declaração de óbito (num formulário só) e a guarda do corpo:
//     registrar a entrada no necrotério e, depois, liberar à família ou à funerária, registrar a retirada, encaminhar ao
//     serviço de verificação ou cancelar. O formulário confere na hora pela mesma regra do domínio que a API aplica;
//   - abaixo, as funerárias do estabelecimento (incluir, editar, tirar de uso e voltar; nada se apaga).
import {
  ACOES_LIBERACAO_CORPO,
  type AcaoLiberacaoCorpo,
  decidirAcaoLiberacao,
  validarFuneraria,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  abrirGuardaCorpo,
  acaoGuardaCorpo,
  alterarFuneraria,
  definirDestinoCorpo,
  type Funeraria,
  incluirFuneraria,
  lerApoioDestinoCorpo,
  lerFunerarias,
  lerObitoDoPaciente,
  lerObitosDestino,
  type ObitoDestino,
  usoFuneraria,
} from '../api-destino-corpo.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const k = 'adt.destinoCorpo';
const podeGuarda = computed(() => pode('internacao.alta.registrar'));
const podeDeclaracao = computed(() => pode('pep.declaracaoObito.emitir'));

const todos = ref(false);
const todasFunerarias = ref(false);
const pacienteRota = computed(() => (rota.query['paciente'] ? Number(rota.query['paciente']) : null));
const apoio = useQuery({ queryKey: ['adt', 'destino-corpo', 'apoio'], queryFn: lerApoioDestinoCorpo });
const obitos = useQuery({
  queryKey: computed(() => ['adt', 'destino-corpo', 'obitos', todos.value]),
  queryFn: () => lerObitosDestino(todos.value),
});
const doPaciente = useQuery({
  queryKey: computed(() => ['adt', 'destino-corpo', 'paciente', pacienteRota.value]),
  queryFn: () => lerObitoDoPaciente(pacienteRota.value!),
  enabled: computed(() => pacienteRota.value !== null),
});
const funerarias = useQuery({
  queryKey: computed(() => ['adt', 'destino-corpo', 'funerarias', todasFunerarias.value]),
  queryFn: () => lerFunerarias(todasFunerarias.value),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'destino-corpo'] });

const escolhido = ref<number | null>(null);
const atual = computed<ObitoDestino | null>(() => {
  const lista = obitos.data.value ?? [];
  const p = doPaciente.data.value;
  if (escolhido.value === null) return p ?? lista[0] ?? null;
  return (
    lista.find((o) => o.declaracao === escolhido.value) ?? (p?.declaracao === escolhido.value ? p : null)
  );
});

const erro = ref<unknown>(null);
const aviso = ref('');
const dataHora = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '');

// ── Destino na declaração ──
type Id = number | '';
const funeraria = ref<Id>('');
const cartorio = ref<Id>('');
watch(
  atual,
  (o) => {
    funeraria.value = o?.funeraria?.id ?? '';
    cartorio.value = o?.cartorio?.id ?? apoio.data.value?.cartorios.find((c) => c.padrao)?.id ?? '';
  },
  { immediate: true },
);
const opFunerarias = computed(() => [
  { valor: '' as Id, rotulo: t(`${k}.destino.nenhuma`) },
  ...(apoio.data.value?.funerarias ?? []).map((f) => ({ valor: f.id as Id, rotulo: f.nome })),
]);
const opCartorios = computed(() => [
  { valor: '' as Id, rotulo: t(`${k}.destino.nenhuma`) },
  ...(apoio.data.value?.cartorios ?? []).map((c) => ({ valor: c.id as Id, rotulo: c.descricao })),
]);
const plantao = computed(
  () => apoio.data.value?.funerarias.find((f) => f.id === funeraria.value)?.telefonePlantao ?? null,
);
const gravarDestino = useMutation({
  mutationFn: () =>
    definirDestinoCorpo(atual.value!.declaracao, {
      funeraria: funeraria.value === '' ? null : funeraria.value,
      cartorio: cartorio.value === '' ? null : cartorio.value,
      versao: atual.value!.versao,
    }),
  onSuccess: () => {
    aviso.value = t(`${k}.destino.gravado`);
    erro.value = null;
    void recarregar();
  },
  onError: (e) => (erro.value = e),
});

// ── Guarda do corpo ──
const guarda = reactive({ entrada: '', local: '' });
const abrir = useMutation({
  mutationFn: () =>
    abrirGuardaCorpo({
      declaracao: atual.value!.declaracao,
      entradaNecroterio: guarda.entrada ? new Date(guarda.entrada).toISOString() : null,
      localGuarda: guarda.local.trim() || null,
      observacao: null,
    }),
  onSuccess: () => {
    aviso.value = t(`${k}.guarda.gravado`);
    erro.value = null;
    void recarregar();
  },
  onError: (e) => (erro.value = e),
});
const acao = ref<AcaoLiberacaoCorpo>('liberar');
const f = reactive({
  funeraria: '' as Id,
  retiranteNome: '',
  retiranteCpf: '',
  retiranteDocumento: '',
  parentesco: '' as Id,
  documentosConferidos: false,
  declaracaoEntregue: false,
  pertencesEntregues: false,
  retiradaEm: '',
  motivo: '',
});
watch(atual, (o) => (f.funeraria = o?.guarda?.funeraria ?? o?.funeraria?.id ?? ''), { immediate: true });
const opAcoes = computed(() =>
  ACOES_LIBERACAO_CORPO.map((a) => ({ valor: a as string, rotulo: t(`${k}.guarda.acoes.${a}`) })),
);
const opParentescos = computed(() => [
  { valor: '' as Id, rotulo: t(`${k}.guarda.semParentesco`) },
  ...(apoio.data.value?.parentescos ?? []).map((p) => ({ valor: p.id as Id, rotulo: p.descricao })),
]);
// Validação na hora: a mesma regra que a API aplica.
const conferencia = computed(() => {
  const o = atual.value;
  if (!o?.guarda) return null;
  return decidirAcaoLiberacao(o.guarda.situacao, acao.value, {
    agora: new Date(),
    obitoEm: new Date(o.obitoEm),
    liberadoEm: o.guarda.liberadoEm ? new Date(o.guarda.liberadoEm) : null,
    declaracao: o.situacao,
    funeraria: f.funeraria === '' ? null : { ativo: true },
    retiranteNome: f.retiranteNome,
    retiranteCpf: f.retiranteCpf,
    retiranteDocumento: f.retiranteDocumento,
    documentosConferidos: f.documentosConferidos,
    declaracaoEntregue: f.declaracaoEntregue,
    retiradaEm: f.retiradaEm ? new Date(f.retiradaEm) : null,
    motivo: f.motivo,
  });
});
const problemasAcao = computed(() =>
  conferencia.value && !conferencia.value.ok ? conferencia.value.problemas : [],
);
const agir = useMutation({
  mutationFn: () =>
    acaoGuardaCorpo(atual.value!.guarda!.id, {
      acao: acao.value,
      versao: atual.value!.guarda!.versao,
      funeraria: f.funeraria === '' ? null : f.funeraria,
      retiranteNome: f.retiranteNome.trim() || null,
      retiranteCpf: f.retiranteCpf.trim() || null,
      retiranteDocumento: f.retiranteDocumento.trim() || null,
      parentesco: f.parentesco === '' ? null : f.parentesco,
      documentosConferidos: f.documentosConferidos,
      declaracaoEntregue: f.declaracaoEntregue,
      pertencesEntregues: f.pertencesEntregues,
      retiradaEm: f.retiradaEm ? new Date(f.retiradaEm).toISOString() : null,
      motivo: f.motivo.trim() || null,
    }),
  onSuccess: () => {
    aviso.value = t(`${k}.guarda.gravado`);
    erro.value = null;
    void recarregar();
  },
  onError: (e) => (erro.value = e),
});

// ── Funerárias ──
const vazio = () => ({
  id: 0,
  versao: 0,
  nome: '',
  telefone: '',
  telefonePlantao: '',
  email: '',
  documentosExigidos: '',
  observacao: '',
});
const ed = reactive(vazio());
const editar = (x: Funeraria) =>
  Object.assign(ed, {
    id: x.id,
    versao: x.versao,
    nome: x.nome,
    telefone: x.telefone ?? '',
    telefonePlantao: x.telefonePlantao ?? '',
    email: x.email ?? '',
    documentosExigidos: x.documentosExigidos ?? '',
    observacao: x.observacao ?? '',
  });
const limparFuneraria = () => Object.assign(ed, vazio());
const validacaoFuneraria = computed(() => validarFuneraria(ed));
const problemasFuneraria = computed(() =>
  ed.nome && !validacaoFuneraria.value.ok ? validacaoFuneraria.value.problemas : [],
);
const salvarFuneraria = useMutation({
  mutationFn: () => {
    const corpo = {
      nome: ed.nome,
      telefone: ed.telefone || null,
      telefonePlantao: ed.telefonePlantao || null,
      email: ed.email || null,
      documentosExigidos: ed.documentosExigidos || null,
      observacao: ed.observacao || null,
    };
    return ed.id ? alterarFuneraria(ed.id, { ...corpo, versao: ed.versao }) : incluirFuneraria(corpo);
  },
  onSuccess: () => {
    aviso.value = t(`${k}.funerarias.gravada`);
    erro.value = null;
    limparFuneraria();
    void recarregar();
  },
  onError: (e) => (erro.value = e),
});
const trocarUso = useMutation({
  mutationFn: (x: Funeraria) => usoFuneraria(x.id, { ativo: !x.ativo, versao: x.versao }),
  onSuccess: () => void recarregar(),
  onError: (e) => (erro.value = e),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="destino-corpo-titulo" data-testid="tela-destino-corpo">
    <h1 id="destino-corpo-titulo">{{ t(`${k}.titulo`) }}</h1>
    <p>{{ t(`${k}.texto`) }}</p>
    <ErroAdt v-if="apoio.isError.value" :erro="apoio.error.value" />
    <ErroAdt v-if="obitos.isError.value" :erro="obitos.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="destino-corpo-aviso">{{ aviso }}</p>
    <p v-if="!podeGuarda && !podeDeclaracao" role="note">{{ t(`${k}.somenteLeitura`) }}</p>

    <label class="marca"
      ><input v-model="todos" type="checkbox" data-testid="destino-corpo-todos" />
      {{ t(`${k}.todos`) }}</label
    >
    <table class="tabela" data-testid="tabela-obitos">
      <thead>
        <tr>
          <th>{{ t(`${k}.colunas.paciente`) }}</th>
          <th>{{ t(`${k}.colunas.obito`) }}</th>
          <th>{{ t(`${k}.colunas.declaracao`) }}</th>
          <th>{{ t(`${k}.colunas.destino`) }}</th>
          <th>{{ t(`${k}.colunas.pendencias`) }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!obitos.data.value?.length">
          <td colspan="6">{{ t(`${k}.nenhum`) }}</td>
        </tr>
        <tr
          v-for="o in obitos.data.value ?? []"
          :key="o.declaracao"
          :aria-current="atual?.declaracao === o.declaracao ? 'true' : undefined"
          :data-testid="`obito-${o.declaracao}`"
        >
          <td>{{ o.pacienteNome ?? o.paciente }}</td>
          <td>{{ dataHora(o.obitoEm) }}</td>
          <td>{{ o.numero ?? '' }} · {{ t(`${k}.situacoes.${o.situacao}`) }}</td>
          <td>{{ o.funeraria?.nome ?? '' }}</td>
          <td>
            {{
              o.pendencias.length
                ? o.pendencias.map((p) => t(`${k}.pendencias.${p}`)).join(', ')
                : t(`${k}.semPendencia`)
            }}
          </td>
          <td>
            <button
              type="button"
              :data-testid="`obito-abrir-${o.declaracao}`"
              @click="escolhido = o.declaracao"
            >
              {{ t(`${k}.abrir`) }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="atual">
      <h2>{{ t(`${k}.destino.titulo`) }} · {{ atual.pacienteNome ?? atual.paciente }}</h2>
      <p v-if="atual.situacao === 'cancelada'" role="note">{{ t(`${k}.destino.cancelada`) }}</p>
      <form
        v-else-if="podeDeclaracao"
        class="filtros"
        data-testid="destino-corpo-destino"
        @submit.prevent="gravarDestino.mutate()"
      >
        <SanteSelecao
          v-model="funeraria"
          :rotulo="t(`${k}.destino.funeraria`)"
          :opcoes="opFunerarias"
          data-testid="destino-corpo-funeraria"
        />
        <SanteSelecao
          v-model="cartorio"
          :rotulo="t(`${k}.destino.cartorio`)"
          :opcoes="opCartorios"
          data-testid="destino-corpo-cartorio"
        />
        <span v-if="plantao" data-testid="destino-corpo-plantao">{{
          t(`${k}.destino.plantao`, { telefone: plantao })
        }}</span>
        <button type="submit" :disabled="gravarDestino.isPending.value" data-testid="destino-corpo-gravar">
          {{ t(`${k}.destino.gravar`) }}
        </button>
      </form>
      <p v-else>
        {{ atual.funeraria?.nome ?? t(`${k}.destino.nenhuma`) }} ·
        {{ atual.cartorio?.descricao ?? t(`${k}.destino.nenhuma`) }}
      </p>

      <h2>{{ t(`${k}.guarda.titulo`) }}</h2>
      <template v-if="!atual.guarda || atual.guarda.situacao === 'cancelado'">
        <p v-if="atual.guarda" data-testid="destino-corpo-situacao">
          {{ t(`${k}.guarda.situacao`, { situacao: t(`${k}.guarda.situacoes.cancelado`) }) }}
        </p>
        <p v-else>{{ t(`${k}.guarda.semGuarda`) }}</p>
        <form
          v-if="podeGuarda"
          class="filtros"
          data-testid="destino-corpo-guarda"
          @submit.prevent="abrir.mutate()"
        >
          <label
            >{{ t(`${k}.guarda.entrada`) }}
            <input v-model="guarda.entrada" type="datetime-local" data-testid="destino-corpo-entrada"
          /></label>
          <label
            >{{ t(`${k}.guarda.local`) }}
            <input v-model="guarda.local" maxlength="60" data-testid="destino-corpo-local"
          /></label>
          <button type="submit" :disabled="abrir.isPending.value" data-testid="destino-corpo-abrir">
            {{ t(`${k}.guarda.abrir`) }}
          </button>
        </form>
      </template>
      <template v-else>
        <p data-testid="destino-corpo-situacao">
          {{ t(`${k}.guarda.situacao`, { situacao: t(`${k}.guarda.situacoes.${atual.guarda.situacao}`) }) }}
          <template v-if="atual.guarda.localGuarda"> · {{ atual.guarda.localGuarda }}</template>
          <template v-if="atual.guarda.retiranteNome"> · {{ atual.guarda.retiranteNome }}</template>
        </p>
        <form
          v-if="podeGuarda && ['em_guarda', 'liberado'].includes(atual.guarda.situacao)"
          class="filtros"
          data-testid="destino-corpo-acao"
          @submit.prevent="agir.mutate()"
        >
          <SanteSelecao
            v-model="acao"
            :rotulo="t(`${k}.guarda.acao`)"
            :opcoes="opAcoes"
            obrigatorio
            data-testid="destino-corpo-acao-tipo"
          />
          <template v-if="acao === 'liberar'">
            <SanteSelecao
              v-model="f.funeraria"
              :rotulo="t(`${k}.destino.funeraria`)"
              :opcoes="opFunerarias"
              data-testid="destino-corpo-acao-funeraria"
            />
            <label
              >{{ t(`${k}.guarda.retiranteNome`) }}
              <input v-model="f.retiranteNome" maxlength="150" data-testid="destino-corpo-retirante"
            /></label>
            <label
              >{{ t(`${k}.guarda.retiranteCpf`) }}
              <input
                v-model="f.retiranteCpf"
                maxlength="14"
                inputmode="numeric"
                data-testid="destino-corpo-cpf"
            /></label>
            <label
              >{{ t(`${k}.guarda.retiranteDocumento`) }}
              <input v-model="f.retiranteDocumento" maxlength="30" data-testid="destino-corpo-documento"
            /></label>
            <SanteSelecao
              v-model="f.parentesco"
              :rotulo="t(`${k}.guarda.parentesco`)"
              :opcoes="opParentescos"
              data-testid="destino-corpo-parentesco"
            />
            <label class="marca"
              ><input
                v-model="f.documentosConferidos"
                type="checkbox"
                data-testid="destino-corpo-conferidos"
              />
              {{ t(`${k}.guarda.documentosConferidos`) }}</label
            >
            <label class="marca"
              ><input v-model="f.declaracaoEntregue" type="checkbox" data-testid="destino-corpo-entregue" />
              {{ t(`${k}.guarda.declaracaoEntregue`) }}</label
            >
            <label class="marca"
              ><input v-model="f.pertencesEntregues" type="checkbox" data-testid="destino-corpo-pertences" />
              {{ t(`${k}.guarda.pertencesEntregues`) }}</label
            >
          </template>
          <label v-if="acao === 'retirar'"
            >{{ t(`${k}.guarda.retiradaEm`) }}
            <input v-model="f.retiradaEm" type="datetime-local" data-testid="destino-corpo-retirada"
          /></label>
          <label v-if="acao === 'cancelar'"
            >{{ t(`${k}.guarda.motivo`) }}
            <input v-model="f.motivo" maxlength="500" data-testid="destino-corpo-motivo"
          /></label>
          <ul v-if="problemasAcao.length" class="problemas" data-testid="destino-corpo-problemas">
            <li v-for="p in problemasAcao" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
          </ul>
          <button
            type="submit"
            :disabled="agir.isPending.value || problemasAcao.length > 0"
            data-testid="destino-corpo-confirmar"
          >
            {{ t(`${k}.guarda.confirmar`) }}
          </button>
        </form>
      </template>
    </template>

    <h2>{{ t(`${k}.funerarias.titulo`) }}</h2>
    <label class="marca"
      ><input v-model="todasFunerarias" type="checkbox" data-testid="funerarias-todas" />
      {{ t(`${k}.funerarias.todas`) }}</label
    >
    <table class="tabela" data-testid="tabela-funerarias">
      <tbody>
        <tr v-for="x in funerarias.data.value ?? []" :key="x.id" :data-testid="`funeraria-${x.id}`">
          <td>
            {{ x.nome }}<template v-if="!x.ativo"> ({{ t(`${k}.funerarias.foraDeUso`) }})</template>
          </td>
          <td>{{ x.telefonePlantao ?? x.telefone ?? '' }}</td>
          <td v-if="podeGuarda">
            <button type="button" :data-testid="`funeraria-editar-${x.id}`" @click="editar(x)">
              {{ t(`${k}.funerarias.editar`) }}
            </button>
            <button type="button" :data-testid="`funeraria-uso-${x.id}`" @click="trocarUso.mutate(x)">
              {{ x.ativo ? t(`${k}.funerarias.tirarDeUso`) : t(`${k}.funerarias.voltar`) }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <form
      v-if="podeGuarda"
      class="filtros"
      data-testid="funeraria-form"
      @submit.prevent="salvarFuneraria.mutate()"
    >
      <label
        >{{ t(`${k}.funerarias.nome`) }}
        <input v-model="ed.nome" maxlength="150" required data-testid="funeraria-nome"
      /></label>
      <label
        >{{ t(`${k}.funerarias.telefone`) }}
        <input v-model="ed.telefone" maxlength="20" inputmode="tel" data-testid="funeraria-telefone"
      /></label>
      <label
        >{{ t(`${k}.funerarias.telefonePlantao`) }}
        <input v-model="ed.telefonePlantao" maxlength="20" inputmode="tel" data-testid="funeraria-plantao"
      /></label>
      <label
        >{{ t(`${k}.funerarias.email`) }}
        <input v-model="ed.email" maxlength="254" type="email" data-testid="funeraria-email"
      /></label>
      <label
        >{{ t(`${k}.funerarias.documentosExigidos`) }}
        <input v-model="ed.documentosExigidos" maxlength="1000" data-testid="funeraria-documentos"
      /></label>
      <ul v-if="problemasFuneraria.length" class="problemas" data-testid="funeraria-problemas">
        <li v-for="p in problemasFuneraria" :key="p.campo">{{ p.mensagem }}</li>
      </ul>
      <button
        type="submit"
        :disabled="salvarFuneraria.isPending.value || !validacaoFuneraria.ok"
        data-testid="funeraria-salvar"
      >
        {{ ed.id ? t(`${k}.funerarias.salvar`) : t(`${k}.funerarias.incluir`) }}
      </button>
      <button v-if="ed.id" type="button" @click="limparFuneraria">{{ t(`${k}.funerarias.novo`) }}</button>
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
