<script setup lang="ts">
// Descrição cirúrgica assinada e intercorrências do ato (04-CC linha 96; F3.4): `/cirurgia/descricao/:ato?`.
// Desenho próprio, numa tela só e por paciente:
//   - o ato com a equipe viva; só quem descreve (cirurgião ou auxiliar médico) vê o formulário, os demais leem;
//   - o texto padrão do cirurgião é oferecido e entra com um clique; o que falta para assinar aparece na hora (a mesma
//     regra do domínio que a API confere);
//   - salvar e assinar é um gesto só, com a senha (eletrônica com reautenticação); assinada, a descrição não muda: o
//     complemento entra como adendo com motivo e senha;
//   - a intercorrência mostra na hora se o tipo exige conduta e se abre a notificação de evento adverso (a grave, o
//     óbito e o tipo de evento adverso), aberta pela API na mesma gravação; o protocolo aparece na lista;
//   - ao lado, as descrições do mesmo paciente (visão por paciente).
import {
  FASES_INTERCORRENCIA,
  GRAVIDADES_INTERCORRENCIA,
  pendenciasDaDescricao,
  textoPendenciaDescricao,
} from '@sgh/dominio-cirurgia';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  type DescricaoCirurgica,
  incluirAdendoDescricao,
  lerDescricoesDoPaciente,
  lerTelaDescricao,
  registrarIntercorrencia,
  salvarDescricao,
} from '../api-descricao-cirurgica.js';
import { lerTextosParaDescricao } from '../api-textos-padrao.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const props = defineProps<{ ato: string }>();
const { t } = useI18n();
const router = useRouter();
const cliente = useQueryClient();

const atoId = computed(() => (/^\d+$/.test(props.ato) ? Number(props.ato) : null));
const atoDigitado = ref(props.ato);
const abrir = () => {
  if (/^\d+$/.test(atoDigitado.value.trim()))
    void router.push({ name: 'cirurgia.descricao', params: { ato: atoDigitado.value.trim() } });
};

const tela = useQuery({
  queryKey: computed(() => ['cirurgia', 'descricao', atoId.value]),
  queryFn: () => lerTelaDescricao(atoId.value!),
  enabled: computed(() => atoId.value !== null),
});
const dados = computed(() => tela.data.value ?? null);
const minha = computed<DescricaoCirurgica | null>(
  () => dados.value?.descricoes.find((d) => d.cirurgiao === dados.value?.eu.profissional) ?? null,
);
const editavel = computed(
  () => !!dados.value?.eu.descreve && (minha.value?.situacao ?? 'rascunho') === 'rascunho',
);

const paciente = useQuery({
  queryKey: computed(() => ['cirurgia', 'descricoes-paciente', dados.value?.ato.paciente ?? null]),
  queryFn: () => lerDescricoesDoPaciente(dados.value!.ato.paciente),
  enabled: computed(() => !!dados.value),
});
const textos = useQuery({
  queryKey: computed(() => ['cirurgia', 'textos-descricao', dados.value?.eu.profissional ?? null]),
  queryFn: () => lerTextosParaDescricao(null, dados.value!.eu.profissional),
  enabled: computed(() => !!dados.value?.eu.descreve),
});

// O formulário da minha descrição (rascunho), recarregado quando a tela chega.
const vazioForm = () => ({
  descricaoTecnica: '',
  achadosTexto: '',
  riscoCirurgico: '',
  acidentes: '',
  orteseProtese: '',
  atoAnestesico: '',
  sangramento: '',
  envioAnatomopatologico: false,
  descricaoPecas: '',
  achados: {} as Record<number, { marcado: boolean; complemento: string }>,
});
const f = reactive(vazioForm());
watch(
  [minha, dados],
  ([d, tl]) => {
    Object.assign(f, vazioForm());
    for (const a of tl?.catalogos.achados ?? []) f.achados[a.id] = { marcado: false, complemento: '' };
    if (!d) return;
    Object.assign(f, {
      descricaoTecnica: d.descricaoTecnica ?? '',
      achadosTexto: d.achadosTexto ?? '',
      riscoCirurgico: d.riscoCirurgico ?? '',
      acidentes: d.acidentes ?? '',
      orteseProtese: d.orteseProtese ?? '',
      atoAnestesico: d.atoAnestesico ?? '',
      sangramento: d.sangramentoMl === null ? '' : String(d.sangramentoMl),
      envioAnatomopatologico: d.envioAnatomopatologico,
      descricaoPecas: d.descricaoPecas ?? '',
    });
    for (const a of d.achados) f.achados[a.achado] = { marcado: true, complemento: a.complemento ?? '' };
  },
  { immediate: true },
);
const achado = (id: number) => f.achados[id]!;
const nulo = (v: string) => (v.trim() ? v.trim() : null);
const sangramentoMl = computed(() => (f.sangramento.trim() === '' ? null : Number(f.sangramento)));
const achadosEscolhidos = computed(() =>
  Object.entries(f.achados)
    .filter(([, a]) => a.marcado)
    .map(([id, a]) => ({ achado: Number(id), complemento: nulo(a.complemento) })),
);
const conteudo = computed(() => ({
  descricaoTecnica: nulo(f.descricaoTecnica),
  envioAnatomopatologico: f.envioAnatomopatologico,
  descricaoPecas: nulo(f.descricaoPecas),
  sangramentoMl: sangramentoMl.value,
  achados: achadosEscolhidos.value,
}));
const pendRascunho = computed(() =>
  pendenciasDaDescricao(conteudo.value, false).map(textoPendenciaDescricao),
);
const pendAssinar = computed(() => pendenciasDaDescricao(conteudo.value, true).map(textoPendenciaDescricao));

const textoEscolhido = ref('');
const opcoesTexto = computed(() => [
  { valor: '', rotulo: t('cirurgia.descricao.semTextoPadrao') },
  ...(textos.data.value?.itens ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: String(x.id), rotulo: x.titulo })),
]);
const usarTexto = () => {
  const x = textos.data.value?.itens.find((i) => String(i.id) === textoEscolhido.value);
  if (!x) return;
  f.descricaoTecnica = x.textoDescricao;
  if (x.textoRisco && !f.riscoCirurgico.trim()) f.riscoCirurgico = x.textoRisco;
};

const senha = ref('');
const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (fn: () => Promise<string>) => fn(),
  onSuccess: (m) => {
    erro.value = null;
    aviso.value = m;
    void cliente.invalidateQueries({ queryKey: ['cirurgia', 'descricao'] });
    void cliente.invalidateQueries({ queryKey: ['cirurgia', 'descricoes-paciente'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const gravarDescricao = (assinar: boolean) =>
  acao.mutate(async () => {
    const r = await salvarDescricao(atoId.value!, {
      versao: minha.value?.versao ?? null,
      assinar,
      ...(assinar ? { senha: senha.value } : {}),
      descricaoTecnica: conteudo.value.descricaoTecnica,
      achadosTexto: nulo(f.achadosTexto),
      riscoCirurgico: nulo(f.riscoCirurgico),
      acidentes: nulo(f.acidentes),
      orteseProtese: nulo(f.orteseProtese),
      atoAnestesico: nulo(f.atoAnestesico),
      sangramentoMl: sangramentoMl.value,
      envioAnatomopatologico: f.envioAnatomopatologico,
      descricaoPecas: f.envioAnatomopatologico ? conteudo.value.descricaoPecas : null,
      achados: achadosEscolhidos.value,
    });
    senha.value = '';
    return r.mensagem;
  });

const ad = reactive({ texto: '', motivo: '', senha: '' });
const incluirAdendo = () =>
  acao.mutate(async () => {
    const r = await incluirAdendoDescricao(minha.value!.id, {
      texto: ad.texto.trim(),
      motivo: ad.motivo.trim(),
      senha: ad.senha,
    });
    Object.assign(ad, { texto: '', motivo: '', senha: '' });
    return r.mensagem;
  });

const it = reactive({
  tipo: '',
  ocorridoEm: '',
  fase: 'intraoperatorio',
  gravidade: 'leve',
  descricao: '',
  conduta: '',
});
const tipoEscolhido = computed(
  () => dados.value?.catalogos.tipos.find((x) => String(x.id) === it.tipo) ?? null,
);
const abreNotificacao = computed(
  () => it.gravidade === 'grave' || it.gravidade === 'obito' || !!tipoEscolhido.value?.eventoAdverso,
);
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t('cirurgia.descricao.escolha') },
  ...(dados.value?.catalogos.tipos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
]);
const opcoesFase = computed(() =>
  FASES_INTERCORRENCIA.map((v) => ({ valor: v, rotulo: t(`cirurgia.descricao.fases.${v}`) })),
);
const opcoesGravidade = computed(() =>
  GRAVIDADES_INTERCORRENCIA.map((v) => ({ valor: v, rotulo: t(`cirurgia.descricao.gravidades.${v}`) })),
);
const faltaIntercorrencia = computed(
  () =>
    !tipoEscolhido.value ||
    !it.ocorridoEm ||
    (tipoEscolhido.value.exigeConduta && !it.conduta.trim()) ||
    ((it.gravidade === 'grave' || it.gravidade === 'obito') && !it.descricao.trim()),
);
watch(tipoEscolhido, (x) => {
  if (x?.gravidade && (GRAVIDADES_INTERCORRENCIA as readonly string[]).includes(x.gravidade))
    it.gravidade = x.gravidade;
});
const gravarIntercorrencia = () =>
  acao.mutate(async () => {
    const r = await registrarIntercorrencia(atoId.value!, {
      tipo: Number(it.tipo),
      ocorridoEm: it.ocorridoEm.replace('T', ' ').slice(0, 16),
      fase: it.fase,
      gravidade: it.gravidade,
      descricao: nulo(it.descricao),
      conduta: nulo(it.conduta),
    });
    Object.assign(it, { tipo: '', ocorridoEm: '', descricao: '', conduta: '', gravidade: 'leve' });
    const protocolo = r.resultado['protocoloNotificacao'];
    return typeof protocolo === 'string'
      ? t('cirurgia.descricao.notificacaoAberta', { protocolo })
      : r.mensagem;
  });

const situacao = (s: string) =>
  ['rascunho', 'assinada', 'retificada'].includes(s) ? t(`cirurgia.descricao.situacoes.${s}`) : s;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="descricao-titulo" data-testid="tela-descricao-cirurgica">
    <h1 id="descricao-titulo">{{ t('cirurgia.descricao.titulo') }}</h1>
    <p>{{ t('cirurgia.descricao.texto') }}</p>

    <form class="filtros" data-testid="descricao-abrir" @submit.prevent="abrir">
      <label
        >{{ t('cirurgia.descricao.ato') }}
        <input v-model="atoDigitado" inputmode="numeric" pattern="\d+" required data-testid="descricao-ato"
      /></label>
      <button type="submit" data-testid="descricao-abrir-botao">{{ t('cirurgia.descricao.abrir') }}</button>
    </form>

    <ErroCirurgia v-if="tela.isError.value" :erro="tela.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="descricao-aviso">{{ aviso }}</p>
    <p v-if="atoId !== null && !dados && !tela.isError.value" role="status">{{ t('cirurgia.carregando') }}</p>

    <template v-if="dados">
      <dl class="filtros" data-testid="descricao-ato-dados">
        <div>
          <dt>{{ t('cirurgia.descricao.paciente') }}</dt>
          <dd>{{ dados.ato.pacienteNome }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.descricao.sala') }}</dt>
          <dd>{{ dados.ato.sala }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.descricao.entrada') }}</dt>
          <dd>{{ dados.ato.entrada ?? '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.descricao.saida') }}</dt>
          <dd>{{ dados.ato.saida ?? '—' }}</dd>
        </div>
      </dl>
      <h2>{{ t('cirurgia.descricao.equipe') }}</h2>
      <ul data-testid="descricao-equipe">
        <li v-for="m in dados.equipe" :key="m.profissional">
          {{ m.nome }} ({{ m.funcao }}){{ m.descreve ? ` · ${t('cirurgia.descricao.descreve')}` : '' }}
        </li>
      </ul>
      <p v-if="!dados.eu.descreve" role="note" data-testid="descricao-so-leitura">
        {{ t('cirurgia.descricao.naoDescreve') }}
      </p>

      <form v-if="editavel" data-testid="descricao-form" @submit.prevent="gravarDescricao(false)">
        <h2>{{ t('cirurgia.descricao.minha') }}</h2>
        <div v-if="textos.data.value?.itens.length" class="filtros">
          <SanteSelecao
            v-model="textoEscolhido"
            :rotulo="t('cirurgia.descricao.textoPadrao')"
            :opcoes="opcoesTexto"
            data-testid="descricao-texto-padrao"
          />
          <button
            type="button"
            :disabled="!textoEscolhido"
            data-testid="descricao-usar-texto"
            @click="usarTexto"
          >
            {{ t('cirurgia.descricao.usarTexto') }}
          </button>
        </div>
        <label
          >{{ t('cirurgia.descricao.descricaoTecnica') }}
          <textarea
            v-model="f.descricaoTecnica"
            rows="8"
            maxlength="60000"
            data-testid="descricao-tecnica"
          ></textarea>
        </label>
        <fieldset v-if="dados.catalogos.achados.length" data-testid="descricao-achados">
          <legend>{{ t('cirurgia.descricao.achados') }}</legend>
          <div v-for="a in dados.catalogos.achados" :key="a.id">
            <label
              ><input
                v-model="achado(a.id).marcado"
                type="checkbox"
                :data-testid="`descricao-achado-${a.id}`"
              />
              {{ a.rotulo }}</label
            >
            <label v-if="achado(a.id).marcado"
              >{{ t('cirurgia.descricao.complemento') }}
              <input
                v-model="achado(a.id).complemento"
                maxlength="5000"
                :placeholder="a.textoSugerido ?? ''"
                :data-testid="`descricao-achado-complemento-${a.id}`"
            /></label>
          </div>
        </fieldset>
        <label
          >{{ t('cirurgia.descricao.achadosTexto') }}
          <textarea
            v-model="f.achadosTexto"
            rows="3"
            maxlength="20000"
            data-testid="descricao-achados-texto"
          ></textarea>
        </label>
        <label
          >{{ t('cirurgia.descricao.riscoCirurgico') }}
          <textarea
            v-model="f.riscoCirurgico"
            rows="2"
            maxlength="5000"
            data-testid="descricao-risco"
          ></textarea>
        </label>
        <label
          >{{ t('cirurgia.descricao.acidentes') }}
          <textarea
            v-model="f.acidentes"
            rows="2"
            maxlength="5000"
            data-testid="descricao-acidentes"
          ></textarea>
        </label>
        <label
          >{{ t('cirurgia.descricao.orteseProtese') }}
          <input v-model="f.orteseProtese" maxlength="5000" data-testid="descricao-ortese"
        /></label>
        <label
          >{{ t('cirurgia.descricao.atoAnestesico') }}
          <input v-model="f.atoAnestesico" maxlength="5000" data-testid="descricao-ato-anestesico"
        /></label>
        <label
          >{{ t('cirurgia.descricao.sangramento') }}
          <input
            v-model="f.sangramento"
            type="number"
            min="0"
            max="20000"
            step="1"
            data-testid="descricao-sangramento"
        /></label>
        <label
          ><input v-model="f.envioAnatomopatologico" type="checkbox" data-testid="descricao-envio-ap" />
          {{ t('cirurgia.descricao.envioAnatomo') }}</label
        >
        <label v-if="f.envioAnatomopatologico"
          >{{ t('cirurgia.descricao.pecas') }}
          <input v-model="f.descricaoPecas" maxlength="500" data-testid="descricao-pecas"
        /></label>
        <div v-if="pendAssinar.length" role="status" data-testid="descricao-pendencias">
          <p>{{ t('cirurgia.descricao.pendencias') }}</p>
          <ul>
            <li v-for="p in pendAssinar" :key="p">{{ p }}</li>
          </ul>
        </div>
        <button
          type="submit"
          :disabled="pendRascunho.length > 0 || acao.isPending.value"
          data-testid="descricao-salvar"
        >
          {{ t('cirurgia.descricao.salvarRascunho') }}
        </button>
        <label
          >{{ t('cirurgia.descricao.senha') }}
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="descricao-senha"
        /></label>
        <button
          type="button"
          :disabled="pendAssinar.length > 0 || !senha || acao.isPending.value"
          data-testid="descricao-assinar"
          @click="gravarDescricao(true)"
        >
          {{ t('cirurgia.descricao.assinar') }}
        </button>
      </form>

      <section
        v-for="d in dados.descricoes"
        :key="d.id"
        :data-testid="`descricao-lida-${d.id}`"
        :aria-label="`${t('cirurgia.descricao.titulo')} ${d.cirurgiaoNome}`"
      >
        <h2>{{ d.cirurgiaoNome }} · {{ situacao(d.situacao) }}</h2>
        <p v-if="d.assinadaEm">{{ t('cirurgia.descricao.assinadaEm', { quando: d.assinadaEm }) }}</p>
        <pre v-if="d.situacao !== 'rascunho' || d.cirurgiao !== dados.eu.profissional">{{
          d.descricaoTecnica
        }}</pre>
        <ul v-if="d.achados.length && d.situacao !== 'rascunho'">
          <li v-for="a in d.achados" :key="a.achado">
            {{ a.rotulo }}{{ a.complemento ? `: ${a.complemento}` : '' }}
          </li>
        </ul>
        <template v-if="d.adendos.length">
          <h3>{{ t('cirurgia.descricao.adendos') }}</h3>
          <ol :data-testid="`descricao-adendos-${d.id}`">
            <li v-for="x in d.adendos" :key="x.sequencia">
              {{ x.registradoEm }} · {{ x.motivo }}: {{ x.texto }}
            </li>
          </ol>
        </template>
        <form
          v-if="d.cirurgiao === dados.eu.profissional && d.situacao !== 'rascunho'"
          data-testid="descricao-adendo-form"
          @submit.prevent="incluirAdendo"
        >
          <h3>{{ t('cirurgia.descricao.adendo') }}</h3>
          <label
            >{{ t('cirurgia.descricao.adendoTexto') }}
            <textarea
              v-model="ad.texto"
              rows="3"
              maxlength="20000"
              required
              data-testid="adendo-texto"
            ></textarea>
          </label>
          <label
            >{{ t('cirurgia.descricao.adendoMotivo') }}
            <input v-model="ad.motivo" minlength="5" maxlength="500" required data-testid="adendo-motivo"
          /></label>
          <label
            >{{ t('cirurgia.descricao.adendoSenha') }}
            <input
              v-model="ad.senha"
              type="password"
              autocomplete="current-password"
              required
              data-testid="adendo-senha"
          /></label>
          <button
            type="submit"
            :disabled="!ad.texto.trim() || ad.motivo.trim().length < 5 || !ad.senha || acao.isPending.value"
            data-testid="adendo-incluir"
          >
            {{ t('cirurgia.descricao.incluirAdendo') }}
          </button>
        </form>
      </section>

      <h2>{{ t('cirurgia.descricao.intercorrencias') }}</h2>
      <p v-if="!dados.intercorrencias.length" data-testid="intercorrencias-nenhuma">
        {{ t('cirurgia.descricao.nenhumaIntercorrencia') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-intercorrencias">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.descricao.ocorridoEm') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.tipo') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.fase') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.gravidade') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.conduta') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.registradoPor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in dados.intercorrencias"
            :key="x.sequencia"
            :data-testid="`intercorrencia-${x.sequencia}`"
          >
            <td>{{ x.ocorridoEm }}</td>
            <td>
              {{ x.tipo }}
              <span v-if="x.notificacao" :data-testid="`intercorrencia-notificacao-${x.sequencia}`">
                · {{ t('cirurgia.descricao.notificacao', { protocolo: x.notificacao }) }}</span
              >
            </td>
            <td>{{ t(`cirurgia.descricao.fases.${x.fase}`) }}</td>
            <td>{{ t(`cirurgia.descricao.gravidades.${x.gravidade}`) }}</td>
            <td>{{ x.conduta ?? '—' }}</td>
            <td>{{ x.registradoPor }}</td>
          </tr>
        </tbody>
      </table>
      <form v-if="dados.eu.naEquipe" data-testid="intercorrencia-form" @submit.prevent="gravarIntercorrencia">
        <div class="filtros">
          <SanteSelecao
            v-model="it.tipo"
            :rotulo="t('cirurgia.descricao.tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="intercorrencia-tipo"
          />
          <label
            >{{ t('cirurgia.descricao.ocorridoEm') }}
            <input v-model="it.ocorridoEm" type="datetime-local" required data-testid="intercorrencia-quando"
          /></label>
          <SanteSelecao
            v-model="it.fase"
            :rotulo="t('cirurgia.descricao.fase')"
            :opcoes="opcoesFase"
            data-testid="intercorrencia-fase"
          />
          <SanteSelecao
            v-model="it.gravidade"
            :rotulo="t('cirurgia.descricao.gravidade')"
            :opcoes="opcoesGravidade"
            data-testid="intercorrencia-gravidade"
          />
        </div>
        <label
          >{{ t('cirurgia.descricao.descricao') }}
          <textarea
            v-model="it.descricao"
            rows="2"
            maxlength="5000"
            data-testid="intercorrencia-descricao"
          ></textarea>
        </label>
        <label
          >{{ t('cirurgia.descricao.conduta') }}
          <textarea
            v-model="it.conduta"
            rows="2"
            maxlength="5000"
            data-testid="intercorrencia-conduta"
          ></textarea>
        </label>
        <p v-if="tipoEscolhido?.exigeConduta" role="note">{{ t('cirurgia.descricao.exigeConduta') }}</p>
        <p v-if="abreNotificacao" role="note" data-testid="intercorrencia-abre-notificacao">
          {{ t('cirurgia.descricao.abreNotificacao') }}
        </p>
        <button
          type="submit"
          :disabled="faltaIntercorrencia || acao.isPending.value"
          data-testid="intercorrencia-registrar"
        >
          {{ t('cirurgia.descricao.registrarIntercorrencia') }}
        </button>
      </form>

      <h2>{{ t('cirurgia.descricao.doPaciente') }}</h2>
      <p v-if="paciente.data.value && !paciente.data.value.length">
        {{ t('cirurgia.descricao.nenhumaDoPaciente') }}
      </p>
      <table v-else-if="paciente.data.value" class="tabela" data-testid="descricoes-do-paciente">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.descricao.ato') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.entrada') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.situacao') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.adendos') }}</th>
            <th scope="col">{{ t('cirurgia.descricao.intercorrencias') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in paciente.data.value" :key="`${p.ato}-${p.cirurgiao}`">
            <td>{{ p.numero }}</td>
            <td>{{ p.inicio ?? '—' }}</td>
            <td>{{ p.cirurgiao }} · {{ situacao(p.situacao) }}</td>
            <td>{{ p.adendos }}</td>
            <td>{{ p.intercorrencias }}</td>
            <td>
              <RouterLink
                v-if="p.ato !== dados.ato.id"
                :to="{ name: 'cirurgia.descricao', params: { ato: String(p.ato) } }"
                >{{ t('cirurgia.descricao.abrirAto') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
