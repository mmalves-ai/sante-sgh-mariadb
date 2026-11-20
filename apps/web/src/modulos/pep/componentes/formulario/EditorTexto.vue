<script setup lang="ts">
// Editor de texto do registro (ficha do M22, regra 9): RESTRITO ao que o texto formatado do formulário de origem
// sabe guardar — parágrafos, negrito, recuo e marcador de lista (o "•" como texto). Não há HTML: o texto é
// digitado em linhas (uma por parágrafo) e a formatação é por parágrafo (o da linha do cursor); a prévia mostra
// como fica. Validação CP1252 a cada digitação (o mesmo validador do servidor).
import { analisarCp1252, normalizarEntrada, type Paragrafo } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import TextoFormatado from '../TextoFormatado.vue';

const props = withDefaults(
  defineProps<{ rotulo: string; desabilitado?: boolean; obrigatorio?: boolean; maxBytes?: number }>(),
  { desabilitado: false, obrigatorio: false, maxBytes: 32_000 },
);
const paragrafos = defineModel<Paragrafo[]>({ required: true });
const { t } = useI18n();
const id = `editor-${useId()}`;
const area = ref<HTMLTextAreaElement | null>(null);
const MARCADOR = '• ';

const texto = computed(() => paragrafos.value.map((p) => p.trechos.map((x) => x.texto).join('')).join('\n'));
const analise = computed(() => analisarCp1252(texto.value));
const erro = computed(() =>
  analise.value.recusados.length > 0
    ? t('pep.reg.editor.foraCp1252', { c: analise.value.recusados[0]?.caractere ?? '' })
    : analise.value.bytes > props.maxBytes
      ? t('pep.reg.editor.longo', { max: props.maxBytes })
      : null,
);

function trechos(linha: string, negrito: boolean): Paragrafo['trechos'] {
  return linha === '' ? [] : [{ texto: linha, negrito, italico: false, sublinhado: false, cor: 0 }];
}

function digitar(e: Event): void {
  const novo = normalizarEntrada((e.target as HTMLTextAreaElement).value).split('\n');
  const antigos = paragrafos.value;
  paragrafos.value = novo.map((linha, i) => {
    const a = antigos[i];
    const negrito = a?.trechos[0]?.negrito ?? false;
    return { alinhamento: 'esquerda', recuo: a?.recuo ?? 0, trechos: trechos(linha, negrito) };
  });
}

/** Índice do parágrafo da linha do cursor. */
function linhaAtual(): number {
  const el = area.value;
  if (!el) return 0;
  return el.value.slice(0, el.selectionStart).split('\n').length - 1;
}

function alterar(fn: (p: Paragrafo) => Paragrafo): void {
  const i = linhaAtual();
  const lista = paragrafos.value.length
    ? [...paragrafos.value]
    : [{ alinhamento: 'esquerda' as const, recuo: 0, trechos: [] }];
  const p = lista[i];
  if (!p) return;
  lista[i] = fn(p);
  paragrafos.value = lista;
  area.value?.focus();
}

function negrito(): void {
  alterar((p) => {
    const ligado = !(p.trechos[0]?.negrito ?? false);
    return { ...p, trechos: p.trechos.map((x) => ({ ...x, negrito: ligado })) };
  });
}
function recuo(d: number): void {
  alterar((p) => ({ ...p, recuo: Math.max(0, Math.min(6, p.recuo + d)) }));
}
function lista(): void {
  alterar((p) => {
    const t0 = p.trechos.map((x) => x.texto).join('');
    const novo = t0.startsWith(MARCADOR) ? t0.slice(MARCADOR.length) : `${MARCADOR}${t0}`;
    return { ...p, trechos: trechos(novo, p.trechos[0]?.negrito ?? false) };
  });
}
function atalho(e: KeyboardEvent): void {
  if (e.ctrlKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    negrito();
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    recuo(1);
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    recuo(-1);
  }
}
const previa = computed(() => ({
  paragrafos: paragrafos.value,
  cores: [],
  ignorados: {},
  conteudoAtivoRemovido: 0,
}));
const temFormatacao = computed(() =>
  paragrafos.value.some((p) => p.recuo > 0 || p.trechos.some((x) => x.negrito)),
);
</script>

<template>
  <div class="editor" :data-testid="`editor-${rotulo}`">
    <label :for="id" class="editor__rotulo"
      >{{ rotulo }}<span v-if="obrigatorio" class="obrigatorio"> *</span></label
    >
    <div class="editor__barra" role="toolbar" :aria-label="t('pep.reg.editor.barra', { campo: rotulo })">
      <SanteBotao
        variante="texto"
        :rotulo="t('pep.reg.editor.negrito')"
        :desabilitado="desabilitado"
        @acionar="negrito"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('pep.reg.editor.lista')"
        :desabilitado="desabilitado"
        @acionar="lista"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('pep.reg.editor.recuoMais')"
        :desabilitado="desabilitado"
        @acionar="recuo(1)"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('pep.reg.editor.recuoMenos')"
        :desabilitado="desabilitado"
        @acionar="recuo(-1)"
      />
    </div>
    <textarea
      :id="id"
      ref="area"
      class="editor__area"
      :value="texto"
      :disabled="desabilitado"
      :aria-required="obrigatorio"
      :aria-invalid="erro !== null"
      :aria-describedby="`${id}-ajuda`"
      rows="4"
      @input="digitar"
      @keydown="atalho"
    />
    <p :id="`${id}-ajuda`" class="editor__ajuda" aria-live="polite">
      <span v-if="erro" class="editor__erro" data-testid="erro-cp1252">{{ erro }}</span>
      <span v-else>{{ t('pep.reg.editor.ajuda') }}</span>
    </p>
    <div v-if="temFormatacao" class="editor__previa" :aria-label="t('pep.reg.editor.previa')">
      <TextoFormatado :texto="previa" />
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.editor__rotulo {
  font-weight: 600;
}
.obrigatorio {
  color: var(--sgh-perigo);
}
.editor__barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.editor__area {
  font: inherit;
  width: 100%;
  min-height: 5rem;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  resize: vertical;
}
.editor__area:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 1px;
}
.editor__ajuda {
  margin: 0;
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
.editor__erro {
  color: var(--sgh-perigo);
}
.editor__previa {
  border-inline-start: 3px solid var(--sgh-borda);
  padding-inline-start: var(--sgh-espaco-2);
}
</style>
