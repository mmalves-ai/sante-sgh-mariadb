<script setup lang="ts">
// A análise de causa da notificação (M48, etapa 2; ficha, seção 7): o método (5 porquês, Ishikawa 6M ou Protocolo de
// Londres), a causa raiz com os fatores contribuintes, as lições e "concluir" (exige causa raiz e uma ação no plano, ou
// a justificativa; o servidor confere de novo). Grava com a versão lida; concluída, só leitura.
import {
  type AnaliseLida,
  CATEGORIAS_ISHIKAWA,
  type CategoriaIshikawa,
  FATORES_CONTRIBUINTES,
  type FatorContribuinte,
  METODOS_ANALISE,
  type MetodoAnalise,
} from '@sgh/contratos';
import { causaRaizProposta } from '@sgh/dominio-qualidade';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteMarcadores,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveQualidade } from '../api.js';
import { registrarAnalise } from '../api-seguranca.js';
import { RECUSAS_ANALISE } from '../i18n-seguranca.js';
import { dataHora } from '../regras-qualidade.js';
import { formularioDaAnalise, montarAnalise } from '../regras-seguranca.js';
import ErroQualidade from './ErroQualidade.vue';

const props = defineProps<{
  notificacao: number;
  analise: AnaliseLida | null;
  podeAnalisar: boolean;
  acoesAtivas: number;
}>();
const emit = defineEmits<{ gravada: [] }>();
const { t } = useI18n();

const form = reactive(formularioDaAnalise(props.analise));
watch(
  () => props.analise?.versao,
  () => Object.assign(form, formularioDaAnalise(props.analise)),
);
const concluida = computed(() => props.analise?.situacao === 'concluida');
const editavel = computed(() => props.podeAnalisar && !concluida.value);

const opMetodo = METODOS_ANALISE.map((m) => ({ valor: m.codigo as MetodoAnalise, rotulo: m.rotulo }));
const opCategoria = CATEGORIAS_ISHIKAWA.map((c) => ({
  valor: c.codigo as CategoriaIshikawa,
  rotulo: c.rotulo,
}));
const opFator = FATORES_CONTRIBUINTES.map((f) => ({
  valor: f.codigo as FatorContribuinte,
  rotulo: f.rotulo,
}));
const rotuloFator = (c: string) => FATORES_CONTRIBUINTES.find((f) => f.codigo === c)?.rotulo ?? c;
const rotuloCategoria = (c: string) => CATEGORIAS_ISHIKAWA.find((x) => x.codigo === c)?.rotulo ?? c;
const rotuloMetodo = (c: string) => METODOS_ANALISE.find((x) => x.codigo === c)?.rotulo ?? c;
const proposta = computed(() =>
  form.metodo === 'cincoPorques'
    ? causaRaizProposta({ metodo: 'cincoPorques', porques: form.porques.filter((p) => p.trim()) })
    : null,
);

const falta = ref<string | null>(null);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChaveQualidade('analise');
watch(form, () => {
  if (!gravando.value) chave = novaChaveQualidade('analise');
});

async function gravar(): Promise<void> {
  falta.value = null;
  erro.value = null;
  feito.value = null;
  const m = montarAnalise(form, props.notificacao, props.analise?.versao ?? 0);
  if (!m.ok) {
    falta.value = m.mensagem;
    return;
  }
  gravando.value = true;
  try {
    const r = await registrarAnalise(m.entrada, chave);
    feito.value = r.mensagem;
    emit('gravada');
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="analise" aria-labelledby="analise-editor-titulo" data-testid="editor-analise">
    <h2 id="analise-editor-titulo">{{ t('qualidade.analise.metodo') }}</h2>
    <p v-if="analise" class="secundario" data-testid="analise-registro">
      {{
        t('qualidade.analise.registrada', { por: analise.registradaPor, em: dataHora(analise.registradaEm) })
      }}
    </p>
    <SanteAlerta
      v-if="concluida && analise"
      variante="info"
      :texto="
        t('qualidade.analise.concluida', {
          em: dataHora(analise.concluidaEm),
          por: analise.concluidaPor ?? '-',
        })
      "
      data-testid="analise-concluida"
    />

    <!-- Só leitura: concluída ou sem a permissão de registrar. -->
    <div v-if="!editavel && analise" class="analise__leitura" data-testid="analise-leitura">
      <p>
        <strong>{{ rotuloMetodo(analise.metodo) }}</strong>
      </p>
      <ol v-if="analise.conteudo.metodo === 'cincoPorques'">
        <li v-for="(p, i) in analise.conteudo.porques" :key="i">{{ p }}</li>
      </ol>
      <ul v-else-if="analise.conteudo.metodo === 'ishikawa'">
        <li v-for="(c, i) in analise.conteudo.causas" :key="i">
          <strong>{{ rotuloCategoria(c.categoria) }}:</strong> {{ c.texto }}
        </li>
      </ul>
      <template v-else>
        <p>{{ analise.conteudo.cronologia }}</p>
        <ul>
          <li v-for="(p, i) in analise.conteudo.problemas" :key="i">
            {{ p.descricao }} ({{ p.fatores.map(rotuloFator).join(', ') }})
          </li>
        </ul>
      </template>
      <p>
        <strong>{{ t('qualidade.analise.causaRaiz') }}:</strong> {{ analise.causaRaiz ?? '-' }}
      </p>
      <p>
        <strong>{{ t('qualidade.analise.fatores') }}:</strong>
        {{ analise.fatores.map(rotuloFator).join(', ') || '-' }}
      </p>
      <p>
        <strong>{{ t('qualidade.analise.licoes') }}:</strong> {{ analise.licoes ?? '-' }}
      </p>
      <p v-if="analise.semAcaoJustificativa">
        <strong>{{ t('qualidade.analise.semAcao') }}:</strong> {{ analise.semAcaoJustificativa }}
      </p>
      <p v-if="!podeAnalisar && !concluida" class="secundario">{{ t('qualidade.analise.semPermissao') }}</p>
    </div>
    <p v-else-if="!editavel" class="secundario" data-testid="analise-sem-permissao">
      {{ t('qualidade.analise.semPermissao') }}
    </p>

    <form v-else class="analise__form" data-testid="form-analise" novalidate @submit.prevent="gravar">
      <SanteOpcoes
        v-model="form.metodo"
        :legenda="t('qualidade.analise.metodo')"
        :opcoes="opMetodo"
        nome="analise-metodo"
        data-testid="analise-metodo"
      />

      <fieldset v-if="form.metodo === 'cincoPorques'" class="analise__grupo" data-testid="analise-porques">
        <legend>{{ rotuloMetodo('cincoPorques') }}</legend>
        <div v-for="(_, i) in form.porques" :key="i" class="analise__linha">
          <SanteCampoTexto
            v-model="form.porques[i]!"
            :rotulo="i === 0 ? t('qualidade.analise.problema') : t('qualidade.analise.porque', { n: i })"
            :max-bytes="400"
            :data-testid="`analise-porque-${i}`"
          />
          <SanteBotao
            v-if="form.porques.length > 1"
            :rotulo="t('qualidade.analise.remover')"
            variante="texto"
            @acionar="form.porques.splice(i, 1)"
          />
        </div>
        <SanteBotao
          v-if="form.porques.length < 7"
          :rotulo="t('qualidade.analise.incluirPorque')"
          variante="secundario"
          data-testid="analise-mais-porque"
          @acionar="form.porques.push('')"
        />
      </fieldset>

      <fieldset v-else-if="form.metodo === 'ishikawa'" class="analise__grupo" data-testid="analise-ishikawa">
        <legend>{{ rotuloMetodo('ishikawa') }}</legend>
        <div v-for="(c, i) in form.causas" :key="i" class="analise__linha">
          <SanteSelecao
            v-model="c.categoria"
            :rotulo="t('qualidade.analise.categoria')"
            :opcoes="opCategoria"
            :data-testid="`analise-categoria-${i}`"
          />
          <SanteCampoTexto
            v-model="c.texto"
            :rotulo="t('qualidade.analise.causa')"
            :max-bytes="300"
            :data-testid="`analise-causa-${i}`"
          />
          <SanteBotao
            v-if="form.causas.length > 1"
            :rotulo="t('qualidade.analise.remover')"
            variante="texto"
            @acionar="form.causas.splice(i, 1)"
          />
        </div>
        <SanteBotao
          v-if="form.causas.length < 30"
          :rotulo="t('qualidade.analise.incluirCausa')"
          variante="secundario"
          @acionar="form.causas.push({ categoria: 'metodo', texto: '' })"
        />
      </fieldset>

      <fieldset v-else class="analise__grupo" data-testid="analise-londres">
        <legend>{{ rotuloMetodo('londres') }}</legend>
        <SanteCampoTexto
          v-model="form.cronologia"
          :rotulo="t('qualidade.analise.cronologia')"
          :max-bytes="1500"
          multilinha
          data-testid="analise-cronologia"
        />
        <div v-for="(p, i) in form.problemas" :key="i" class="analise__problema">
          <SanteCampoTexto
            v-model="p.descricao"
            :rotulo="t('qualidade.analise.problemaCuidado')"
            :max-bytes="400"
            :data-testid="`analise-problema-${i}`"
          />
          <SanteMarcadores
            v-model="p.fatores"
            :legenda="t('qualidade.analise.fatoresDoProblema')"
            :opcoes="opFator"
            :data-testid="`analise-problema-fatores-${i}`"
          />
          <SanteBotao
            v-if="form.problemas.length > 1"
            :rotulo="t('qualidade.analise.remover')"
            variante="texto"
            @acionar="form.problemas.splice(i, 1)"
          />
        </div>
        <SanteBotao
          v-if="form.problemas.length < 10"
          :rotulo="t('qualidade.analise.incluirProblema')"
          variante="secundario"
          @acionar="form.problemas.push({ descricao: '', fatores: [] })"
        />
      </fieldset>

      <SanteCampoTexto
        v-model="form.causaRaiz"
        :rotulo="t('qualidade.analise.causaRaiz')"
        :max-bytes="2000"
        multilinha
        data-testid="analise-causa-raiz"
      />
      <p v-if="proposta && !form.causaRaiz.trim()" class="secundario" data-testid="analise-proposta">
        {{ t('qualidade.analise.causaRaizAjuda') }} {{ proposta }}
      </p>
      <SanteMarcadores
        v-model="form.fatores"
        :legenda="t('qualidade.analise.fatores')"
        :opcoes="opFator"
        data-testid="analise-fatores"
      />
      <SanteCampoTexto
        v-model="form.licoes"
        :rotulo="t('qualidade.analise.licoes')"
        :max-bytes="2000"
        multilinha
        data-testid="analise-licoes"
      />
      <label
        ><input v-model="form.concluir" type="checkbox" data-testid="analise-concluir" />
        {{ t('qualidade.analise.concluirMarca') }}</label
      >
      <template v-if="form.concluir">
        <p class="secundario">{{ t('qualidade.analise.concluirAjuda') }}</p>
        <SanteCampoTexto
          v-if="acoesAtivas === 0"
          v-model="form.semAcaoJustificativa"
          :rotulo="t('qualidade.analise.semAcao')"
          :max-bytes="500"
          multilinha
          data-testid="analise-sem-acao"
        />
      </template>
      <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="analise-falta" />
      <ErroQualidade v-if="erro" :erro="erro" :recusas="RECUSAS_ANALISE" />
      <p v-if="feito" role="status" data-testid="analise-feito">{{ feito }}</p>
      <SanteBotao
        :rotulo="t('qualidade.analise.gravar')"
        variante="primario"
        tipo="submit"
        :desabilitado="gravando"
        data-testid="analise-gravar"
      />
    </form>
  </section>
</template>

<style scoped>
.analise,
.analise__form,
.analise__grupo,
.analise__problema {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.analise__grupo {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
}
.analise__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.analise__problema {
  border-inline-start: 4px solid var(--sgh-borda);
  padding-inline-start: var(--sgh-espaco-3);
}
.secundario {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  margin: 0;
}
</style>
