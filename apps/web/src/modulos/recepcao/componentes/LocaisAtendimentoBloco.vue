<script setup lang="ts">
// 02-REC linha 33 (C2-005): os locais de atendimento de cada recepção e os encaminhamentos entre eles, com gravação.
// Um diálogo inclui e altera o local (o código chega sugerido pelo nome); outro marca, numa lista só, para onde o
// local encaminha (o guichê passa a oferecer esses destinos). A regra do domínio confere na hora: o botão de gravar só
// abre com o formulário válido. Nada é apagado: desativar pede o motivo e o local continua na lista, marcado.
import type { LocalDaEstrutura } from '@sgh/contratos';
import { codigoDeLocalSugerido, recusasDoLocal, recusasDosDestinos } from '@sgh/dominio-recepcao';
import { SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { alterarLocal, gravarDestinos, incluirLocal, lerLocais, situacaoLocal } from '../api-locais.js';

const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`recepcao.locais.${c}`, p);
const cliente = useQueryClient();
const dados = useQuery({ queryKey: ['recepcao', 'locais'], queryFn: lerLocais });
const pontos = computed(() => dados.data.value?.pontos ?? []);
const locais = computed(() => dados.data.value?.locais ?? []);
const daRecepcao = (ponto: number) => locais.value.filter((l) => l.pontoId === ponto);
const nomeDe = (id: number) => locais.value.find((l) => l.id === id)?.descricao ?? String(id);
const existentes = computed(() =>
  locais.value.map((l) => ({ id: l.id, codigo: l.codigo, descricao: l.descricao, ponto: l.pontoId })),
);

const podeEditar = computed(() => pode('recepcao.recepcao.editar'));
const podeInativar = computed(() => pode('recepcao.recepcao.inativar'));

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  gravando.value = true;
  mensagem.value = null;
  erro.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    forma.value = null;
    destinosDe.value = null;
    desativando.value = null;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
    await cliente.invalidateQueries({ queryKey: ['recepcao'] });
  }
}

// ── incluir e alterar o local ──────────────────────────────────────────────────────────────────────────
interface Forma {
  readonly ponto: { readonly id: number; readonly ativo: boolean; readonly descricao: string };
  readonly local: LocalDaEstrutura | null;
}
const forma = ref<Forma | null>(null);
const codigo = ref('');
const nome = ref('');
const canal = ref('');
const permite = ref(false);
const base = ref(false);
const reavaliacao = ref(false);
const tocouCodigo = ref(false);
const dialogo = computed({
  get: () => forma.value !== null,
  set: (v: boolean) => {
    if (!v) forma.value = null;
  },
});
function abrir(ponto: Forma['ponto'], l: LocalDaEstrutura | null): void {
  codigo.value = l?.codigo ?? '';
  nome.value = l?.descricao ?? '';
  canal.value = l?.canalAudio ?? '';
  permite.value = l?.permiteEncaminhamento ?? false;
  base.value = l?.baseTempoEspera ?? false;
  reavaliacao.value = l?.reavaliacaoMedica ?? false;
  tocouCodigo.value = l !== null;
  erro.value = null;
  forma.value = { ponto, local: l };
}
watch(nome, (n) => {
  if (!forma.value || forma.value.local || tocouCodigo.value) return;
  codigo.value = n.trim()
    ? codigoDeLocalSugerido(
        n,
        locais.value.map((l) => l.codigo),
      )
    : '';
});
const corpo = computed(() => ({
  codigo: codigo.value.trim(),
  descricao: nome.value.trim(),
  permiteEncaminhamento: permite.value,
  baseTempoEspera: base.value,
  reavaliacaoMedica: reavaliacao.value,
  canalAudio: canal.value.trim() || null,
}));
const recusa = computed<string | null>(() => {
  const f = forma.value;
  if (!f) return null;
  const r = recusasDoLocal(corpo.value, f.ponto, existentes.value, f.local?.id ?? null)[0];
  if (r) return r.mensagem;
  if (f.local && !permite.value && f.local.destinos.length > 0)
    return (
      recusasDosDestinos({ id: f.local.id, permiteEncaminhamento: false }, f.local.destinos, locais.value)[0]
        ?.mensagem ?? null
    );
  return null;
});
const recusaVisivel = computed(() => (nome.value.trim() !== '' ? recusa.value : null));
function gravar(): Promise<void> {
  const f = forma.value;
  if (!f || recusa.value !== null) return Promise.resolve();
  return executar(() =>
    f.local
      ? alterarLocal(f.local.id, { ...corpo.value, versao: f.local.versao })
      : incluirLocal(f.ponto.id, corpo.value),
  );
}

// ── destinos de encaminhamento ─────────────────────────────────────────────────────────────────────────
const destinosDe = ref<LocalDaEstrutura | null>(null);
const marcados = ref<number[]>([]);
const dialogoDestinos = computed({
  get: () => destinosDe.value !== null,
  set: (v: boolean) => {
    if (!v) destinosDe.value = null;
  },
});
function abrirDestinos(l: LocalDaEstrutura): void {
  marcados.value = [...l.destinos];
  erro.value = null;
  destinosDe.value = l;
}
/** Os destinos possíveis: os ativos e os desativados que já estão na lista. */
const possiveis = computed(() => {
  const o = destinosDe.value;
  if (!o) return [];
  return locais.value.filter((l) => l.id !== o.id && (l.ativo || o.destinos.includes(l.id)));
});
const recusaDestinos = computed(() => {
  const o = destinosDe.value;
  if (!o) return null;
  return recusasDosDestinos(o, marcados.value, locais.value, o.destinos)[0]?.mensagem ?? null;
});
function gravarDestinosDoLocal(): Promise<void> {
  const o = destinosDe.value;
  if (!o || recusaDestinos.value !== null) return Promise.resolve();
  return executar(() => gravarDestinos(o.id, { destinos: [...marcados.value], versao: o.versao }));
}

// ── desativar (com motivo) e reativar ──────────────────────────────────────────────────────────────────
const desativando = ref<LocalDaEstrutura | null>(null);
const motivo = ref('');
const motivoValido = computed(() => motivo.value.trim().length >= 5);
const dialogoDesativar = computed({
  get: () => desativando.value !== null,
  set: (v: boolean) => {
    if (!v) desativando.value = null;
  },
});
function pedirDesativar(l: LocalDaEstrutura): void {
  motivo.value = '';
  erro.value = null;
  desativando.value = l;
}
function desativar(): Promise<void> {
  const l = desativando.value;
  if (!l || !motivoValido.value) return Promise.resolve();
  return executar(() => situacaoLocal(l.id, { ativo: false, motivo: motivo.value.trim(), versao: l.versao }));
}
const reativar = (l: LocalDaEstrutura) =>
  executar(() => situacaoLocal(l.id, { ativo: true, motivo: null, versao: l.versao }));
</script>

<template>
  <section class="painel" aria-labelledby="locais-titulo" data-testid="locais-atendimento">
    <h2 id="locais-titulo">{{ k('titulo') }}</h2>
    <p class="secundario">{{ k('texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="mensagem-locais">{{ mensagem }}</p>
    <MensagemErro v-if="erro && !forma && !destinosDe && !desativando" :erro="erro" />
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <article v-for="p in pontos" :key="p.id" class="painel" :data-testid="`locais-${p.codigo}`">
      <h3>
        {{ p.descricao }}<template v-if="!p.ativo"> · {{ k('inativo') }}</template>
      </h3>
      <p v-if="daRecepcao(p.id).length === 0" class="secundario">{{ k('semLocal') }}</p>
      <ul v-else class="senhas-no-guiche">
        <li v-for="l in daRecepcao(p.id)" :key="l.id" :data-testid="`local-${l.codigo}`">
          <strong>{{ l.descricao }}</strong> <span class="secundario">· {{ l.codigo }}</span>
          <template v-if="!l.ativo"> · {{ k('inativo') }}</template>
          ·
          <span :data-testid="`destinos-${l.codigo}`">{{
            l.destinos.length
              ? k('encaminhaPara', { lista: l.destinos.map(nomeDe).join(', ') })
              : k('semDestino')
          }}</span>
          <template v-if="podeEditar">
            <SanteBotao
              variante="texto"
              :rotulo="k('alterar')"
              :aria-label="k('editar', { nome: l.descricao })"
              :data-testid="`alterar-local-${l.codigo}`"
              @acionar="abrir(p, l)"
            />
            <SanteBotao
              v-if="l.permiteEncaminhamento"
              variante="texto"
              :rotulo="k('destinos')"
              :aria-label="k('destinosDe', { nome: l.descricao })"
              :data-testid="`destinos-local-${l.codigo}`"
              @acionar="abrirDestinos(l)"
            />
          </template>
          <SanteBotao
            v-if="podeInativar && l.ativo"
            variante="texto"
            :rotulo="k('desativar')"
            :aria-label="k('desativarTitulo', { nome: l.descricao })"
            :data-testid="`desativar-local-${l.codigo}`"
            @acionar="pedirDesativar(l)"
          />
          <SanteBotao
            v-if="podeInativar && !l.ativo"
            variante="texto"
            :rotulo="k('reativar')"
            :aria-label="`${k('reativar')}: ${l.descricao}`"
            :data-testid="`reativar-local-${l.codigo}`"
            @acionar="reativar(l)"
          />
        </li>
      </ul>
      <SanteBotao
        v-if="podeEditar && p.ativo"
        variante="secundario"
        :rotulo="k('novo')"
        :aria-label="k('novoEm', { nome: p.descricao })"
        :data-testid="`novo-local-${p.codigo}`"
        @acionar="abrir(p, null)"
      />
    </article>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        forma?.local
          ? k('editar', { nome: forma.local.descricao })
          : k('novoEm', { nome: forma?.ponto.descricao })
      "
    >
      <div v-if="forma" class="formulario">
        <SanteCampoTexto v-model="nome" :rotulo="k('nome')" :max-bytes="150" obrigatorio />
        <SanteCampoTexto
          v-model="codigo"
          :rotulo="k('codigo')"
          :max-bytes="30"
          obrigatorio
          @update:model-value="tocouCodigo = true"
        />
        <SanteCampoTexto v-model="canal" :rotulo="k('canal')" :max-bytes="40" />
        <label
          ><input v-model="permite" type="checkbox" data-testid="local-permite" /> {{ k('permite') }}</label
        >
        <label><input v-model="base" type="checkbox" /> {{ k('base') }}</label>
        <label><input v-model="reavaliacao" type="checkbox" /> {{ k('reavaliacao') }}</label>
        <p v-if="recusaVisivel" role="alert" data-testid="recusa-local">{{ recusaVisivel }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="forma = null" />
        <SanteBotao
          :rotulo="k('gravar')"
          :desabilitado="gravando || recusa !== null"
          data-testid="gravar-local"
          @acionar="gravar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDestinos"
      :titulo="k('destinosDe', { nome: destinosDe?.descricao ?? '' })"
    >
      <fieldset v-if="destinosDe" class="formulario">
        <legend>{{ k('escolherDestinos') }}</legend>
        <label v-for="d in possiveis" :key="d.id">
          <input v-model="marcados" type="checkbox" :value="d.id" :data-testid="`destino-${d.codigo}`" />
          {{ d.descricao }}<template v-if="!d.ativo"> ({{ k('inativo') }})</template>
        </label>
        <p v-if="recusaDestinos" role="alert" data-testid="recusa-destinos">{{ recusaDestinos }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
      </fieldset>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="destinosDe = null" />
        <SanteBotao
          :rotulo="k('gravar')"
          :desabilitado="gravando || recusaDestinos !== null"
          data-testid="gravar-destinos"
          @acionar="gravarDestinosDoLocal"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDesativar"
      :titulo="k('desativarTitulo', { nome: desativando?.descricao ?? '' })"
    >
      <div class="formulario">
        <SanteCampoTexto v-model="motivo" :rotulo="k('motivo')" :max-bytes="200" obrigatorio />
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="k('cancelar')" @acionar="desativando = null" />
        <SanteBotao
          :rotulo="k('desativar')"
          :desabilitado="gravando || !motivoValido"
          data-testid="confirmar-desativar-local"
          @acionar="desativar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>
