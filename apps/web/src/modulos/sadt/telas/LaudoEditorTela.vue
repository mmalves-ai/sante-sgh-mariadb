<script setup lang="ts">
// Laudo de imagem, endoscopia e métodos gráficos (ficha do M26, seção 7; regra 8): `/sadt/laudos`. Os exames recebidos
// a laudar do setor; o editor parte do modelo de laudo do exame (o resultado padrão do cadastro) e o laudo é privativo
// de médico: o laudador é o médico da sessão (decidido no servidor). Assinar libera o laudo (a liberação do setor). O
// laudo estruturado (eco e demais métodos gráficos com fórmula) leva as variáveis do exame junto com o texto, e as
// grandezas do cadastro aparecem como referência das siglas.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  lerDigitacao,
  liberarResultado,
  listarExamesSadt,
  novaChave,
  registrarResultado,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import VariaveisSadt from '../componentes/VariaveisSadt.vue';
import { hojeLocal, usarSadt, valoresDasVariaveis, variaveisDigitadas } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const setor = ref('imagem');
const data = ref(hojeLocal());
const { gravacao, pode, motivoSetor } = usarSadt(setor);
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'exames', 'laudar', setor.value, data.value]),
  queryFn: () => listarExamesSadt({ setor: setor.value, data: data.value, situacao: 'recebidos' }),
});
const setores = computed(() =>
  (['imagem', 'metodosGraficos', 'endoscopia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.setores.${s}`),
  })),
);
const aLaudar = computed(() =>
  (lista.data.value?.itens ?? []).filter(
    (e) => e.estado !== 'liberado' && e.estado !== 'emitido' && e.estado !== 'visualizado',
  ),
);
const aberto = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['sadt', 'digitacao', aberto.value]),
  queryFn: () => lerDigitacao(aberto.value as number),
  enabled: computed(() => aberto.value !== null),
});
const texto = ref('');
const modelo = ref('');
const variaveis = ref<Record<number, string>>({});
watch(
  () => ficha.data.value,
  (f) => {
    texto.value = f?.laudo?.texto ?? '';
    modelo.value = '';
    variaveis.value = valoresDasVariaveis(f?.variaveis);
  },
);
watch(modelo, (m) => {
  const x = ficha.data.value?.modelos.find((y) => String(y.codigo) === m);
  if (x) texto.value = x.texto;
});
const modelos = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(ficha.data.value?.modelos ?? []).map((m) => ({ valor: String(m.codigo), rotulo: m.nome })),
]);
const medico = computed(() => gravacao.data.value?.habilitacao.laudarImagem === true);
const podeCriar = computed(() => pode(setor.value, 'sadt.registrarLaudo'));
const podeAssinar = computed(() => pode(setor.value, 'sadt.liberarExame'));
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const html = (s: string) =>
  `<p>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`;
async function salvar(assinar: boolean): Promise<void> {
  const f = ficha.data.value;
  if (!f) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarResultado(
      f.exame.id,
      {
        versao: f.exame.versao,
        laudo: { texto: texto.value, html: html(texto.value) },
        variaveis: variaveisDigitadas(variaveis.value),
      },
      novaChave('laudo'),
    );
    mensagem.value = r.mensagem;
    if (assinar) {
      await cliente.invalidateQueries({ queryKey: ['sadt', 'digitacao', f.exame.id] });
      const relido = await lerDigitacao(f.exame.id);
      const l = await liberarResultado(
        f.exame.id,
        { versao: relido.exame.versao, confirmarCritico: false },
        novaChave('assinar'),
      );
      mensagem.value = l.mensagem;
      aberto.value = null;
    }
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="editor-titulo" data-testid="tela-sadt-laudo-editor">
    <h1 id="editor-titulo">{{ t('sadt.laudos.editor') }}</h1>
    <p>{{ t('sadt.laudos.editorTexto') }}</p>
    <AvisoSadt :motivo="motivoSetor" />
    <p v-if="gravacao.data.value && !medico" role="status" data-testid="editor-privativo">
      {{ t('sadt.laudos.privativo') }}
    </p>
    <div class="filtros">
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" />
      <span class="campo">
        <label for="editor-data">{{ t('sadt.data') }}</label>
        <input id="editor-data" v-model="data" type="date" />
      </span>
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="aLaudar.length === 0">{{ t('sadt.nenhum') }}</p>
    <ul v-else>
      <li v-for="e in aLaudar" :key="e.id">
        <PacienteSadt :paciente="e.paciente" /> · {{ e.exame.nome }} · {{ e.estadoRotulo }}
        <SanteBotao
          variante="texto"
          :rotulo="t('sadt.digitacao.abrir')"
          :data-testid="`editor-abrir-${e.id}`"
          @acionar="aberto = e.id"
        />
      </li>
    </ul>
    <section v-if="ficha.data.value" class="painel" aria-labelledby="editor-exame" data-testid="editor-ficha">
      <h2 id="editor-exame">{{ ficha.data.value.exame.exame.nome }}</h2>
      <p><PacienteSadt :paciente="ficha.data.value.exame.paciente" /></p>
      <SanteAlerta
        v-if="ficha.data.value.bloqueado"
        variante="aviso"
        :texto="t('sadt.digitacao.bloqueado')"
      />
      <SanteSelecao
        v-if="modelos.length > 1"
        v-model="modelo"
        :rotulo="t('sadt.laudos.modelo')"
        :opcoes="modelos"
        data-testid="editor-modelo"
      />
      <span class="campo">
        <label for="editor-texto">{{ t('sadt.laudos.textoLaudo') }}</label>
        <textarea
          id="editor-texto"
          v-model="texto"
          rows="10"
          :disabled="ficha.data.value.bloqueado"
          data-testid="editor-texto"
        />
      </span>
      <VariaveisSadt
        v-model="variaveis"
        :variaveis="ficha.data.value.variaveis"
        :bloqueado="ficha.data.value.bloqueado"
        prefixo="editor"
      />
      <details v-if="ficha.data.value.grandezas.length" data-testid="editor-grandezas">
        <summary>{{ t('sadt.laudos.grandezas') }}</summary>
        <ul>
          <li v-for="g in ficha.data.value.grandezas" :key="g.codigo">{{ g.sigla }} · {{ g.nome }}</li>
        </ul>
      </details>
      <div v-if="medico && !ficha.data.value.bloqueado" class="acoes">
        <SanteBotao
          v-if="podeCriar"
          variante="secundario"
          :rotulo="t('sadt.laudos.salvar')"
          :desabilitado="ocupado || texto.trim().length < 5"
          data-testid="editor-salvar"
          @acionar="salvar(false)"
        />
        <SanteBotao
          v-if="podeCriar && podeAssinar"
          :rotulo="t('sadt.laudos.assinar')"
          :desabilitado="ocupado || texto.trim().length < 5"
          data-testid="editor-assinar"
          @acionar="salvar(true)"
        />
      </div>
    </section>
    <p v-if="mensagem" role="status" data-testid="editor-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
