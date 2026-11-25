<script setup lang="ts">
// Nota clínica em quatro partes (subjetivo, objetivo, avaliação e plano) codificada (03-PEP L98), numa tela só por
// paciente. O atendimento vem escolhido (o mais recente da unidade) e traz a configuração que vale para ele: as partes
// obrigatórias aparecem marcadas, o CID-10 da avaliação é pedido e a CIAP-2 só aparece quando a configuração a liga.
// O código é buscado ao lado da parte, de um clique cada; o código da CIAP-2 escolhido sugere os CID-10
// correspondentes. A mesma regra do servidor valida na hora e mostra o que falta para assinar; no pré-natal, a data
// provável do parto e a idade gestacional saem da data da última menstruação. "Assinar" guarda e assina num clique.
// Abaixo, as notas do paciente; o rascunho do autor volta à edição, e a nota assinada só fica sem efeito com
// justificativa (nada é apagado).
import {
  CONFIGURACAO_NOTA_SOAP_PADRAO,
  type CodigoNotaSoap,
  EDEMAS_NOTA_SOAP,
  gestacaoPelaDum,
  idadeGestacionalTexto,
  PARTES_SOAP,
  type ParteSoap,
  type TermoCodigoNota,
  TIPOS_NOTA_SOAP,
  type TipoNotaSoap,
  validarNotaSoap,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarTermosNota,
  gravarNotaSoap,
  lerCorrespondenciaCiap,
  lerNotasPaciente,
  type NotasPacienteTela,
  type TermoNotaTela,
} from '../api-nota-soap.js';
import { dataHoraBr } from '../formato.js';

type NotaTela = NotasPacienteTela['notas'][number];
interface CodigoTela {
  chave: number;
  parte: ParteSoap;
  ciap: TermoNotaTela | null;
  cid: TermoNotaTela | null;
  incluirListaProblemas: boolean;
}

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'nota-soap', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerNotasPaciente(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const avisos = ref('');
const podeEscrever = computed(() => pode('pep.evolucao.criar'));

// ------------------------------------------------------------------ a nota em edição
const atendimento = ref('');
const editando = ref<{ id: number; versao: number } | null>(null);
const nota = reactive({
  tipo: 'consulta' as TipoNotaSoap,
  subjetivo: '',
  objetivo: '',
  avaliacao: '',
  plano: '',
  criticidade: '',
  dataUltimaMenstruacao: '',
  edema: '',
});
const codigos = ref<CodigoTela[]>([]);
let proxima = 1;

watch(
  () => d.value?.atendimentos,
  (a) => {
    if (a && !a.some((x) => String(x.id) === atendimento.value))
      atendimento.value = a[0] ? String(a[0].id) : '';
  },
  { immediate: true },
);
const opcoesAtendimento = computed(() =>
  (d.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: `${a.numero}${a.entradaEm ? ` · ${dataHoraBr(a.entradaEm)}` : ''}`,
  })),
);
const config = computed(
  () =>
    d.value?.atendimentos.find((a) => String(a.id) === atendimento.value)?.configuracao ??
    CONFIGURACAO_NOTA_SOAP_PADRAO,
);
const exige = (p: ParteSoap) =>
  ({
    subjetivo: config.value.exigeSubjetivo,
    objetivo: config.value.exigeObjetivo,
    avaliacao: config.value.exigeAvaliacao,
    plano: config.value.exigePlano,
  })[p];
const opcoesTipo = computed(() =>
  TIPOS_NOTA_SOAP.map((v) => ({ valor: v, rotulo: t(`pep.notaSoap.tipos.${v}`) })),
);
const opcoesEdema = computed(() => [
  { valor: '', rotulo: t('pep.notaSoap.nenhuma') },
  ...EDEMAS_NOTA_SOAP.map((v) => ({ valor: v, rotulo: v })),
]);
const opcoesCriticidade = computed(() => [
  { valor: '', rotulo: t('pep.notaSoap.nenhuma') },
  ...(['baixa', 'media', 'alta'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.notaSoap.criticidades.${v}`),
  })),
]);
const gestacao = computed(() =>
  nota.dataUltimaMenstruacao ? gestacaoPelaDum(nota.dataUltimaMenstruacao, new Date()) : null,
);

// ------------------------------------------------------------------ busca de códigos (ao lado da parte)
const parteBusca = ref<ParteSoap>('avaliacao');
const sistema = ref<'cid10' | 'ciap2'>('cid10');
const busca = ref('');
watch(
  () => config.value.usaCiap,
  (u) => {
    if (!u) sistema.value = 'cid10';
  },
);
const opcoesParte = computed(() =>
  PARTES_SOAP.map((p) => ({ valor: p, rotulo: t(`pep.notaSoap.partes.${p}`) })),
);
const opcoesSistema = computed(() =>
  (config.value.usaCiap ? (['cid10', 'ciap2'] as const) : (['cid10'] as const)).map((s) => ({
    valor: s,
    rotulo: t(`pep.notaSoap.sistemas.${s}`),
  })),
);
const termos = useQuery({
  queryKey: computed(() => ['pep', 'nota-soap', 'termos', sistema.value, busca.value.trim()]),
  queryFn: () => buscarTermosNota(sistema.value, busca.value.trim()),
  enabled: computed(() => busca.value.trim().length >= 2),
});
const ciapEscolhido = ref<TermoNotaTela | null>(null);
const sugeridos = useQuery({
  queryKey: computed(() => ['pep', 'nota-soap', 'corr', ciapEscolhido.value?.id ?? 0]),
  queryFn: () => lerCorrespondenciaCiap(ciapEscolhido.value!.id),
  enabled: computed(() => ciapEscolhido.value !== null),
});

function adicionar(termo: TermoNotaTela) {
  if (termo.sistema === 'ciap2') {
    codigos.value.push({
      chave: proxima++,
      parte: parteBusca.value,
      ciap: termo,
      cid: null,
      incluirListaProblemas: false,
    });
    ciapEscolhido.value = termo;
  } else {
    codigos.value.push({
      chave: proxima++,
      parte: parteBusca.value,
      ciap: null,
      cid: termo,
      incluirListaProblemas: parteBusca.value === 'avaliacao',
    });
  }
  busca.value = '';
}
/** O CID sugerido completa o último código da CIAP-2 ainda sem CID. */
function completarCid(cid: TermoNotaTela) {
  const alvo = [...codigos.value].reverse().find((c) => c.ciap?.id === ciapEscolhido.value?.id && !c.cid);
  if (alvo) {
    alvo.cid = cid;
    alvo.incluirListaProblemas = alvo.parte === 'avaliacao';
  }
  ciapEscolhido.value = null;
}
const remover = (k: number) => (codigos.value = codigos.value.filter((c) => c.chave !== k));
const rotuloCodigo = (c: CodigoTela) =>
  [c.ciap && `${c.ciap.codigo} ${c.ciap.descricao}`, c.cid && `${c.cid.codigo} ${c.cid.descricao}`]
    .filter(Boolean)
    .join(' → ');

// ------------------------------------------------------------------ validação na hora (a mesma regra do servidor)
const entrada = computed(() => ({
  tipo: nota.tipo,
  subjetivo: nota.subjetivo || null,
  objetivo: nota.objetivo || null,
  avaliacao: nota.avaliacao || null,
  plano: nota.plano || null,
  criticidade: nota.criticidade || null,
  dataUltimaMenstruacao: nota.dataUltimaMenstruacao || null,
  edema: nota.edema || null,
  codigos: codigos.value.map((c): CodigoNotaSoap => ({
    parte: c.parte,
    ciapId: c.ciap?.id ?? null,
    cidId: c.cid?.id ?? null,
    incluirListaProblemas: c.incluirListaProblemas,
  })),
}));
const termosEscolhidos = computed(() => {
  const m = new Map<number, TermoCodigoNota>();
  for (const c of codigos.value)
    for (const x of [c.ciap, c.cid])
      if (x) m.set(x.id, { id: x.id, sistema: x.sistema, codigo: x.codigo, ativo: true });
  return m;
});
const rascunho = computed(() =>
  validarNotaSoap(entrada.value, config.value, termosEscolhidos.value, 'rascunho', new Date()),
);
const assinatura = computed(() =>
  validarNotaSoap(entrada.value, config.value, termosEscolhidos.value, 'assinatura', new Date()),
);

function limpar() {
  editando.value = null;
  Object.assign(nota, {
    tipo: 'consulta',
    subjetivo: '',
    objetivo: '',
    avaliacao: '',
    plano: '',
    criticidade: '',
    dataUltimaMenstruacao: '',
    edema: '',
  });
  codigos.value = [];
}
function editar(n: NotaTela) {
  editando.value = { id: n.id, versao: n.versao };
  atendimento.value = String(n.atendimento);
  Object.assign(nota, {
    tipo: n.tipo as TipoNotaSoap,
    subjetivo: n.subjetivo ?? '',
    objetivo: n.objetivo ?? '',
    avaliacao: n.avaliacao ?? '',
    plano: n.plano ?? '',
    criticidade: n.criticidade ?? '',
    dataUltimaMenstruacao: n.dataUltimaMenstruacao ?? '',
    edema: n.edema ?? '',
  });
  codigos.value = n.codigos.map((c) => ({
    chave: proxima++,
    parte: c.parte,
    ciap: c.ciap,
    cid: c.cid,
    incluirListaProblemas: c.incluirListaProblemas,
  }));
}

const gravando = ref(false);
async function guardar(assinar: boolean) {
  erro.value = null;
  ok.value = '';
  avisos.value = '';
  gravando.value = true;
  try {
    const corpo = {
      ...entrada.value,
      codigos: entrada.value.codigos.map((c) => ({
        parte: c.parte,
        ciap: c.ciapId,
        cid: c.cidId,
        incluirListaProblemas: c.incluirListaProblemas,
      })),
    };
    const r = editando.value
      ? await gravarNotaSoap('alterar', { ...corpo, nota: editando.value.id, versao: editando.value.versao })
      : await gravarNotaSoap('', { ...corpo, atendimento: Number(atendimento.value) });
    avisos.value = r.resultado.avisos;
    if (assinar) await gravarNotaSoap('assinar', { nota: r.resultado.nota, versao: r.resultado.versao });
    ok.value = t(assinar ? 'pep.notaSoap.assinada' : 'pep.notaSoap.guardada');
    if (assinar) limpar();
    else editando.value = { id: r.resultado.nota, versao: r.resultado.versao };
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const anulando = ref<number | null>(null);
const justificativa = ref('');
async function semEfeito(n: NotaTela) {
  erro.value = null;
  ok.value = '';
  try {
    await gravarNotaSoap('sem-efeito', {
      nota: n.id,
      versao: n.versao,
      justificativa: justificativa.value.trim() || null,
    });
    ok.value = t('pep.notaSoap.anulada');
    anulando.value = null;
    justificativa.value = '';
    if (editando.value?.id === n.id) limpar();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="soap" data-testid="nota-soap-tela">
    <h1>{{ t('pep.notaSoap.titulo') }}</h1>
    <p class="soap__dica">{{ t('pep.notaSoap.intro') }}</p>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="nota-soap-ok" />
    <SanteAlerta v-if="avisos" variante="alerta" :texto="avisos" data-testid="nota-soap-avisos" />
    <p v-if="!d && !dados.error.value">{{ t('pep.carregando') }}</p>
    <template v-else-if="d">
      <p v-if="podeEscrever && !d.atendimentos.length" data-testid="nota-soap-sem-atendimento">
        {{ t('pep.notaSoap.semAtendimento') }}
      </p>
      <form
        v-if="podeEscrever && d.atendimentos.length"
        class="soap__form"
        data-testid="nota-soap-form"
        @submit.prevent
      >
        <div class="soap__linha">
          <SanteSelecao
            v-model="atendimento"
            :rotulo="t('pep.notaSoap.atendimento')"
            :opcoes="opcoesAtendimento"
            :desabilitado="editando !== null"
            data-testid="nota-soap-atendimento"
          />
          <SanteSelecao
            v-model="nota.tipo"
            :rotulo="t('pep.notaSoap.tipo')"
            :opcoes="opcoesTipo"
            data-testid="nota-soap-tipo"
          />
          <SanteSelecao
            v-model="nota.criticidade"
            :rotulo="t('pep.notaSoap.criticidade')"
            :opcoes="opcoesCriticidade"
            data-testid="nota-soap-criticidade"
          />
        </div>
        <div
          v-if="nota.tipo === 'pre_natal' || nota.dataUltimaMenstruacao"
          class="soap__linha"
          data-testid="nota-soap-gestacao"
        >
          <label>
            {{ t('pep.notaSoap.dum') }}
            <input v-model="nota.dataUltimaMenstruacao" type="date" data-testid="nota-soap-dum" />
          </label>
          <SanteSelecao
            v-model="nota.edema"
            :rotulo="t('pep.notaSoap.edema')"
            :opcoes="opcoesEdema"
            data-testid="nota-soap-edema"
          />
          <p v-if="gestacao && gestacao.idadeGestacionalDias >= 0" data-testid="nota-soap-ig">
            {{ t('pep.notaSoap.ig') }}: {{ idadeGestacionalTexto(gestacao.idadeGestacionalDias) }} ·
            {{ t('pep.notaSoap.dpp') }}: {{ gestacao.dataProvavelParto.split('-').reverse().join('/') }}
          </p>
        </div>

        <div class="soap__partes">
          <fieldset
            v-for="p in PARTES_SOAP"
            :key="p"
            class="soap__parte"
            :data-testid="`nota-soap-parte-${p}`"
          >
            <legend>
              {{ t(`pep.notaSoap.partes.${p}`) }}
              <span v-if="exige(p)" class="soap__obrigatoria">({{ t('pep.notaSoap.obrigatoria') }})</span>
            </legend>
            <label class="soap__rotulo-oculto" :for="`nota-soap-texto-${p}`">{{
              t(`pep.notaSoap.partes.${p}`)
            }}</label>
            <textarea
              :id="`nota-soap-texto-${p}`"
              v-model="nota[p]"
              rows="4"
              maxlength="20000"
              :placeholder="t(`pep.notaSoap.dicas.${p}`)"
              :data-testid="`nota-soap-texto-${p}`"
            />
            <ul class="soap__codigos">
              <li
                v-for="c in codigos.filter((x) => x.parte === p)"
                :key="c.chave"
                :data-testid="`nota-soap-codigo-${p}-${c.cid?.codigo ?? c.ciap?.codigo}`"
              >
                <span>{{ rotuloCodigo(c) }}</span>
                <label v-if="p === 'avaliacao'">
                  <input v-model="c.incluirListaProblemas" type="checkbox" />
                  {{ t('pep.notaSoap.listaProblemas') }}
                </label>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('pep.notaSoap.remover')"
                  @acionar="remover(c.chave)"
                />
              </li>
            </ul>
          </fieldset>
        </div>

        <fieldset class="soap__busca" data-testid="nota-soap-busca">
          <legend>{{ t('pep.notaSoap.adicionar') }}</legend>
          <div class="soap__linha">
            <SanteSelecao
              v-model="parteBusca"
              :rotulo="t('pep.notaSoap.codigos')"
              :opcoes="opcoesParte"
              data-testid="nota-soap-parte-busca"
            />
            <SanteSelecao
              v-model="sistema"
              :rotulo="t('pep.notaSoap.sistema')"
              :opcoes="opcoesSistema"
              data-testid="nota-soap-sistema"
            />
            <label>
              {{ t('pep.notaSoap.buscar') }}
              <input v-model="busca" type="search" maxlength="60" data-testid="nota-soap-buscar" />
            </label>
          </div>
          <ul
            v-if="termos.data.value?.length"
            class="soap__resultados"
            :aria-label="t('pep.notaSoap.resultado')"
          >
            <li v-for="r in termos.data.value" :key="r.id">
              <button
                type="button"
                class="soap__termo"
                :data-testid="`nota-soap-termo-${r.codigo}`"
                @click="adicionar(r)"
              >
                {{ r.codigo }} {{ r.descricao }}
              </button>
            </li>
          </ul>
          <div v-if="ciapEscolhido && sugeridos.data.value?.length" data-testid="nota-soap-sugeridos">
            <p>{{ t('pep.notaSoap.sugeridos') }} ({{ ciapEscolhido.codigo }})</p>
            <ul class="soap__resultados">
              <li v-for="r in sugeridos.data.value" :key="r.id">
                <button
                  type="button"
                  class="soap__termo"
                  :data-testid="`nota-soap-sugerido-${r.codigo}`"
                  @click="completarCid(r)"
                >
                  {{ r.codigo }} {{ r.descricao }}
                </button>
              </li>
            </ul>
          </div>
        </fieldset>

        <SanteAlerta
          v-if="rascunho.falhas.length"
          variante="alerta"
          :texto="rascunho.falhas.map((f) => f.mensagem).join(' ')"
          data-testid="nota-soap-falhas"
        />
        <SanteAlerta
          v-else-if="assinatura.falhas.length"
          variante="info"
          :texto="`${t('pep.notaSoap.pendencias')}: ${assinatura.falhas.map((f) => f.mensagem).join(' ')}`"
          data-testid="nota-soap-pendencias"
        />
        <div class="soap__acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.notaSoap.guardar')"
            :desabilitado="gravando || rascunho.falhas.length > 0"
            data-testid="nota-soap-guardar"
            @acionar="guardar(false)"
          />
          <SanteBotao
            :rotulo="t('pep.notaSoap.assinar')"
            :desabilitado="gravando || assinatura.falhas.length > 0"
            data-testid="nota-soap-assinar"
            @acionar="guardar(true)"
          />
          <SanteBotao
            v-if="editando"
            variante="secundario"
            :rotulo="t('pep.notaSoap.novaNota')"
            data-testid="nota-soap-nova"
            @acionar="limpar()"
          />
        </div>
      </form>

      <h2>{{ t('pep.notaSoap.historico') }}</h2>
      <p v-if="!d.notas.length" data-testid="nota-soap-sem-notas">{{ t('pep.notaSoap.semNotas') }}</p>
      <article
        v-for="n in d.notas"
        :key="n.id"
        class="soap__nota"
        :class="{ 'soap__nota--sem-efeito': n.situacao === 'sem_efeito' }"
        :data-testid="`nota-soap-registrada-${n.id}`"
      >
        <header>
          <strong>{{ t(`pep.notaSoap.tipos.${n.tipo}`) }}</strong>
          · {{ n.registradaEm ? dataHoraBr(n.registradaEm) : '' }} ·
          {{ t(`pep.notaSoap.situacoes.${n.situacao}`) }}
          <span v-if="n.autor"> · {{ t('pep.notaSoap.autor') }}: {{ n.autor }}</span>
        </header>
        <dl>
          <template v-for="p in PARTES_SOAP" :key="p">
            <template v-if="n[p] || n.codigos.some((c) => c.parte === p)">
              <dt>{{ t(`pep.notaSoap.partes.${p}`) }}</dt>
              <dd>
                {{ n[p] }}
                <span
                  v-for="c in n.codigos.filter((x) => x.parte === p)"
                  :key="c.sequencia"
                  class="soap__selo"
                >
                  {{ [c.ciap?.codigo, c.cid?.codigo].filter(Boolean).join(' → ') }}
                  <template v-if="c.problema"> ({{ t('pep.notaSoap.problema') }})</template>
                </span>
              </dd>
            </template>
          </template>
        </dl>
        <p v-if="n.idadeGestacionalDias !== null">
          {{ t('pep.notaSoap.ig') }}: {{ idadeGestacionalTexto(n.idadeGestacionalDias) }}
        </p>
        <div v-if="podeEscrever && n.situacao !== 'sem_efeito'" class="soap__acoes">
          <SanteBotao
            v-if="n.podeEditar"
            variante="secundario"
            :rotulo="t('pep.notaSoap.editar')"
            :data-testid="`nota-soap-editar-${n.id}`"
            @acionar="editar(n)"
          />
          <SanteBotao
            v-if="pode('pep.evolucao.suspender')"
            variante="secundario"
            :rotulo="t('pep.notaSoap.semEfeito')"
            :data-testid="`nota-soap-sem-efeito-${n.id}`"
            @acionar="anulando = n.id"
          />
        </div>
        <div v-if="anulando === n.id" class="soap__linha">
          <label>
            {{ t('pep.notaSoap.justificativa') }}
            <input
              v-model="justificativa"
              type="text"
              maxlength="1000"
              :data-testid="`nota-soap-justificativa-${n.id}`"
            />
          </label>
          <SanteBotao
            :rotulo="t('pep.notaSoap.confirmarSemEfeito')"
            :desabilitado="n.situacao === 'assinada' && justificativa.trim().length < 10"
            :data-testid="`nota-soap-confirmar-sem-efeito-${n.id}`"
            @acionar="semEfeito(n)"
          />
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.soap__dica {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.soap__form,
.soap__partes {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.soap__partes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}
.soap__linha,
.soap__acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.soap__parte,
.soap__busca,
.soap__nota {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.soap__parte textarea {
  width: 100%;
}
.soap__obrigatoria {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.soap__rotulo-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.soap__codigos,
.soap__resultados {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.soap__termo {
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  padding-inline: var(--sgh-espaco-2);
  text-align: start;
  cursor: pointer;
}
.soap__selo {
  border: 1px solid var(--sgh-borda-forte);
  padding-inline: var(--sgh-espaco-1);
  margin-inline-start: var(--sgh-espaco-1);
}
.soap__nota--sem-efeito {
  color: var(--sgh-texto-secundario);
  text-decoration: line-through;
}
</style>
