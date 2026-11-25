<script setup lang="ts">
// Um campo do formulário no renderizador (ficha do M22, seção 7): o componente de cada tipo de pergunta do
// formulário de origem (texto formatado, data, hora, escolha, escolha com texto, lista marcada, texto,
// quantidade com unidade, grade, CID), em edição ou só leitura. O comportamento é o do formulário de origem: a
// regra só habilita e desabilita (o valor do campo desabilitado continua); o cálculo é PROPOSTO e o profissional
// confirma; o valor trazido do registro anterior fica marcado até ser confirmado. Recursivo nas seções.
import { FORMATO_HORA } from '@sgh/contratos';
import type { CampoRegistro, Paragrafo, RespostaRegistro, ValorResposta } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { computed, inject, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import TextoFormatado from '../TextoFormatado.vue';
import EditorTexto from './EditorTexto.vue';
import GradeRespostas from './GradeRespostas.vue';
import AbaAlergias from '../../telas/abas/AbaAlergias.vue';
import { CONTEXTO_ALERGIA_FORMULARIO } from './contexto-alergia.js';

type Valor = string | number | boolean | null;

const props = withDefaults(
  defineProps<{
    campo: CampoRegistro;
    respostas: Readonly<Record<number, RespostaRegistro>>;
    modo: 'edicao' | 'visualizacao' | 'impressao';
    desabilitados?: ReadonlySet<number>;
    calculados?: ReadonlyMap<number, Valor>;
    bloqueado?: boolean;
  }>(),
  { desabilitados: () => new Set<number>(), calculados: () => new Map<number, Valor>(), bloqueado: false },
);
/** D-ALE-2: na edição do registro, o componente de alergia grava a alergia na hora (paciente e atendimento). */
const contextoInjetado = inject(CONTEXTO_ALERGIA_FORMULARIO, null);
const contextoAlergia = computed(() => contextoInjetado?.value ?? null);
const emit = defineEmits<{
  atualizar: [vinculo: number, valor: ValorResposta | null];
  confirmar: [vinculo: number];
  historico: [vinculo: number];
}>();
const { t } = useI18n();
const id = `campo-${useId()}`;

const c = computed(() => props.campo);
const r = computed(() => props.respostas[c.value.vinculo]);
const v = computed(() => r.value?.valor);
const edicao = computed(() => props.modo === 'edicao' && !props.bloqueado && !c.value.ambiguo);
const desabilitado = computed(() => props.desabilitados.has(c.value.vinculo));
const calculado = computed(() => props.calculados.get(c.value.vinculo));

function atualizar(valor: ValorResposta | null): void {
  emit('atualizar', c.value.vinculo, valor);
}

// ── Valores por tipo ──────────────────────────────────────────────────────────────────────────────
function paragrafosDoValor(x: ValorResposta | undefined): Paragrafo[] {
  if (x?.tipo === 'formatado') return [...x.paragrafos];
  if (x?.tipo === 'texto')
    return [
      {
        alinhamento: 'esquerda',
        recuo: 0,
        trechos: x.texto
          ? [{ texto: x.texto, negrito: false, italico: false, sublinhado: false, cor: 0 }]
          : [],
      },
    ];
  return [];
}
const paragrafos = computed<Paragrafo[]>({
  get: () => paragrafosDoValor(v.value),
  set: (ps: Paragrafo[]) =>
    atualizar(
      ps.every((p) => p.trechos.every((x) => x.texto.trim() === ''))
        ? null
        : { tipo: 'formatado', paragrafos: ps },
    ),
});
const texto = computed<string>({
  get: () => (v.value?.tipo === 'texto' ? v.value.texto : ''),
  set: (s) => atualizar(s.trim() === '' ? null : { tipo: 'texto', texto: s }),
});
const data = computed<string | null>({
  get: () => (v.value?.tipo === 'data' ? v.value.data : null),
  set: (d) => atualizar(d ? { tipo: 'data', data: d } : null),
});
const hora = computed<string | null>({
  get: () => (v.value?.tipo === 'hora' ? v.value.hora : null),
  set: (h) => atualizar(h && FORMATO_HORA.test(h) ? { tipo: 'hora', hora: h } : null),
});
const escolha = computed<string>({
  get: () => (v.value?.tipo === 'escolha' ? String(v.value.indice) : ''),
  set: (s) => {
    if (s === '') return atualizar(null);
    const comp = v.value?.tipo === 'escolha' ? v.value.complemento : undefined;
    atualizar({ tipo: 'escolha', indice: Number(s), ...(comp ? { complemento: comp } : {}) });
  },
});
const complemento = computed<string>({
  get: () => (v.value?.tipo === 'escolha' ? (v.value.complemento ?? '') : ''),
  set: (s) => {
    if (v.value?.tipo !== 'escolha') return;
    atualizar({ tipo: 'escolha', indice: v.value.indice, ...(s.trim() ? { complemento: s } : {}) });
  },
});
const marcadas = computed(() => (v.value?.tipo === 'multipla' ? v.value.indices : []));
function marcar(indice: number, sim: boolean): void {
  const l = new Set(marcadas.value);
  if (sim) l.add(indice);
  else l.delete(indice);
  atualizar(l.size ? { tipo: 'multipla', indices: [...l].sort((a, b) => a - b) } : null);
}
const numeroTexto = computed(() =>
  v.value?.tipo === 'numero' ? String(v.value.valor).replace('.', ',') : '',
);
const erroNumero = computed(() => null as string | null);
function numero(s: string): void {
  const n = Number(s.trim().replace(',', '.'));
  if (s.trim() === '') atualizar(null);
  else if (Number.isFinite(n)) atualizar({ tipo: 'numero', valor: n });
}
const grade = computed<(string | null)[][]>({
  get: () => (v.value?.tipo === 'grade' ? v.value.linhas.map((l) => [...l]) : []),
  set: (ls) => atualizar(ls.length ? { tipo: 'grade', linhas: ls } : null),
});
const cid = computed<string>(() => (v.value?.tipo === 'cid' ? v.value.codigos.join(', ') : ''));
function digitarCid(s: string): void {
  const codigo = s.trim().toUpperCase();
  atualizar(codigo ? { tipo: 'cid', codigos: [codigo] } : null);
}

const opcoesTexto = computed(() => c.value.opcoes.map((o) => ({ valor: String(o.indice), rotulo: o.texto })));
const opcoesSelecao = computed(() => [
  { valor: '', rotulo: t('pep.reg.campo.semResposta') },
  ...opcoesTexto.value,
]);

/** O valor em texto (visualização e impressão). */
const exibido = computed(() => {
  const x = v.value;
  if (!x) return '';
  const rotulo = (i: number) =>
    c.value.opcoes.find((o) => o.indice === i)?.texto ?? t('pep.reg.campo.opcao', { n: i });
  switch (x.tipo) {
    case 'texto':
      return c.value.unidade ? `${x.texto} ${c.value.unidade}` : x.texto;
    case 'numero':
      return `${String(x.valor).replace('.', ',')}${c.value.unidade ? ` ${c.value.unidade}` : ''}`;
    case 'data':
      return x.data.split('-').reverse().join('/');
    case 'hora':
      return x.hora;
    case 'escolha':
      return `${rotulo(x.indice)}${x.complemento ? ` - ${x.complemento}` : ''}`;
    case 'multipla':
      return x.indices.map(rotulo).join('; ');
    case 'cid':
      return x.codigos.join(', ');
    default:
      return '';
  }
});
const formatado = computed(() =>
  v.value?.tipo === 'formatado'
    ? { paragrafos: v.value.paragrafos, cores: [], ignorados: {}, conteudoAtivoRemovido: 0 }
    : null,
);
const naoRespondida = computed(() => !v.value);
</script>

<template>
  <fieldset
    v-if="c.tipo === 'secao'"
    class="secao"
    :style="{ gridColumn: `span ${c.colunas}` }"
    :data-testid="`secao-${c.linkId}`"
  >
    <legend>{{ c.titulo }}</legend>
    <div class="grade-campos">
      <CampoRegistro
        v-for="f in c.itens"
        :key="`${f.vinculo}`"
        :campo="f"
        :respostas="respostas"
        :modo="modo"
        :desabilitados="desabilitados"
        :calculados="calculados"
        :bloqueado="bloqueado"
        @atualizar="(a, b) => emit('atualizar', a, b)"
        @confirmar="(a) => emit('confirmar', a)"
        @historico="(a) => emit('historico', a)"
      />
    </div>
  </fieldset>
  <div
    v-else-if="modo !== 'edicao' && naoRespondida && modo === 'impressao'"
    class="vazio-impressao"
    aria-hidden="true"
  />
  <div
    v-else
    class="campo"
    :class="{ desabilitado, autopreenchido: r?.autopreenchido && !r?.confirmado }"
    :style="{ gridColumn: `span ${c.colunas}` }"
    :data-testid="`campo-${c.linkId}`"
  >
    <!-- Só leitura (visualização, impressão, rascunho de outro profissional, pergunta a confirmar). -->
    <template v-if="!edicao">
      <div class="leitura">
        <span :id="`${id}-r`" class="rotulo">{{ c.titulo }}</span>
        <TextoFormatado v-if="formatado" :texto="formatado" :aria-labelledby="`${id}-r`" />
        <table v-else-if="v?.tipo === 'grade'" class="grade-leitura" :aria-labelledby="`${id}-r`">
          <thead>
            <tr>
              <th v-for="col in c.colunasGrade" :key="col.coluna" scope="col">{{ col.titulo }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in v.linhas" :key="i">
              <td v-for="(x, k) in l" :key="k">{{ x ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <span v-else class="valor" :aria-labelledby="`${id}-r`">{{
          exibido || (modo === 'edicao' ? '' : '—')
        }}</span>
        <span v-if="c.ambiguo && modo === 'edicao'" class="nota">{{ t('pep.reg.campo.ambiguo') }}</span>
        <span v-if="r?.autopreenchido" class="nota">{{ t('pep.reg.campo.trazido') }}</span>
      </div>
    </template>
    <fieldset v-else class="envoltorio" :disabled="desabilitado">
      <legend class="oculto">{{ c.titulo }}</legend>
      <EditorTexto
        v-if="c.tipo === 'texto-formatado'"
        v-model="paragrafos"
        :rotulo="c.titulo"
        :obrigatorio="c.obrigatorio"
        :desabilitado="desabilitado"
      />
      <SanteCampoTexto
        v-else-if="c.tipo === 'texto'"
        v-model="texto"
        :rotulo="c.unidade ? `${c.titulo} (${c.unidade})` : c.titulo"
        :max-bytes="c.tamanhoMaximo ?? 255"
        :obrigatorio="c.obrigatorio"
      />
      <div v-else-if="c.tipo === 'quantidade'" class="quantidade">
        <label :for="`${id}-n`">{{ c.titulo }}<span v-if="c.obrigatorio" class="obrigatorio"> *</span></label>
        <span class="quantidade__entrada">
          <input
            :id="`${id}-n`"
            :value="numeroTexto"
            inputmode="decimal"
            :disabled="desabilitado"
            :aria-required="c.obrigatorio"
            :aria-invalid="erroNumero !== null"
            @change="numero(($event.target as HTMLInputElement).value)"
          />
          <span v-if="c.unidade" class="unidade">{{ c.unidade }}</span>
        </span>
      </div>
      <SanteData v-else-if="c.tipo === 'data'" v-model="data" :rotulo="c.titulo" :editavel="!desabilitado" />
      <SanteHora v-else-if="c.tipo === 'hora'" v-model="hora" :rotulo="c.titulo" :editavel="!desabilitado" />
      <SanteOpcoes
        v-else-if="c.tipo === 'escolha' && c.opcoes.length <= 5"
        v-model="escolha"
        :legenda="c.titulo"
        :opcoes="opcoesTexto"
      />
      <SanteSelecao
        v-else-if="c.tipo === 'escolha'"
        v-model="escolha"
        :rotulo="c.titulo"
        :opcoes="opcoesSelecao"
        :desabilitado="desabilitado"
      />
      <div v-else-if="c.tipo === 'escolha-com-texto'" class="com-texto">
        <SanteSelecao
          v-model="escolha"
          :rotulo="c.titulo"
          :opcoes="opcoesSelecao"
          :desabilitado="desabilitado"
        />
        <SanteCampoTexto
          v-if="escolha !== ''"
          v-model="complemento"
          :rotulo="t('pep.reg.campo.complemento', { campo: c.titulo })"
          :max-bytes="2000"
          multilinha
        />
      </div>
      <fieldset v-else-if="c.tipo === 'multipla'" class="multipla">
        <legend>{{ c.titulo }}<span v-if="c.obrigatorio" class="obrigatorio"> *</span></legend>
        <label v-for="o in c.opcoes" :key="o.indice" class="multipla__opcao">
          <input
            type="checkbox"
            :checked="marcadas.includes(o.indice)"
            @change="marcar(o.indice, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ o.texto }}</span>
        </label>
      </fieldset>
      <GradeRespostas
        v-else-if="c.tipo === 'grade'"
        v-model="grade"
        :rotulo="c.titulo"
        :colunas="c.colunasGrade"
        :desabilitado="desabilitado"
      />
      <div v-else-if="c.tipo === 'cid'" class="quantidade">
        <label :for="`${id}-cid`">{{ c.titulo }}</label>
        <input
          :id="`${id}-cid`"
          :value="cid"
          :disabled="desabilitado"
          :placeholder="t('pep.reg.campo.cidExemplo')"
          maxlength="6"
          @change="digitarCid(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div
        v-else-if="c.tipo === 'alergias' && modo === 'edicao' && contextoAlergia?.atendimento"
        data-testid="formulario-alergias"
      >
        <AbaAlergias :paciente="contextoAlergia.paciente" :atendimento="contextoAlergia.atendimento" />
      </div>
      <p v-else class="nota">
        <strong>{{ c.titulo }}:</strong>
        {{ c.tipo === 'alergias' ? t('pep.reg.campo.alergias') : t('pep.reg.campo.naoGravado') }}
      </p>
      <!-- Ações do campo: valor trazido (confirmar), cálculo proposto (usar), histórico (copiar do último). -->
      <div class="acoes-campo">
        <template v-if="r?.autopreenchido && !r.confirmado">
          <span class="nota" role="status">{{ t('pep.reg.campo.trazidoConfirmar') }}</span>
          <SanteBotao
            variante="texto"
            :rotulo="t('pep.reg.campo.confirmar', { campo: c.titulo })"
            @acionar="emit('confirmar', c.vinculo)"
          />
        </template>
        <template v-if="calculado !== undefined && calculado !== null">
          <span class="nota" role="status">{{
            t('pep.reg.campo.proposto', { valor: String(calculado).replace('.', ',') })
          }}</span>
          <SanteBotao
            variante="texto"
            :rotulo="t('pep.reg.campo.usar', { campo: c.titulo })"
            @acionar="
              atualizar(
                typeof calculado === 'number'
                  ? { tipo: 'numero', valor: calculado }
                  : { tipo: 'texto', texto: String(calculado) },
              )
            "
          />
        </template>
        <SanteBotao
          v-if="c.manterHistorico >= 1 && c.tipo !== 'grade'"
          variante="texto"
          :rotulo="t('pep.reg.campo.historico', { campo: c.titulo })"
          @acionar="emit('historico', c.vinculo)"
        />
        <span v-if="desabilitado" class="nota">{{ t('pep.reg.campo.desabilitado') }}</span>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.secao {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-width: 0;
}
.secao > legend {
  font-weight: 700;
  padding: 0 var(--sgh-espaco-1);
}
.grade-campos {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--sgh-espaco-3);
}
.campo {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.campo.autopreenchido {
  border-inline-start: 4px solid var(--sgh-aviso);
  padding-inline-start: var(--sgh-espaco-2);
}
.campo.desabilitado {
  opacity: 0.75;
}
.leitura {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rotulo {
  font-weight: 600;
}
.valor {
  white-space: pre-wrap;
}
.nota {
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
.obrigatorio {
  color: var(--sgh-alerta);
}
.quantidade {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.quantidade label {
  font-weight: 600;
}
.quantidade input {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  max-width: 14rem;
}
.quantidade__entrada {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.multipla {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-4);
}
.multipla legend {
  font-weight: 600;
}
.multipla__opcao {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.envoltorio {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.acoes-campo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.grade-leitura {
  border-collapse: collapse;
}
.grade-leitura th,
.grade-leitura td {
  border: 1px solid var(--sgh-borda);
  padding: 2px 6px;
}
.com-texto {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
@media (max-width: 768px) {
  .campo,
  .secao {
    grid-column: span 12 !important;
  }
}
</style>
