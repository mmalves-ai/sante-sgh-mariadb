<script setup lang="ts">
// Triagem nutricional (ficha do M45, regra 10): o NRS-2002 (triagem inicial e, com algum "sim", a final) ou o NUTRIC
// modificado na terapia intensiva. A tela mostra a prévia do NRS-2002; o total que vale é o que o servidor calcula com
// a idade do cadastro (regra 3).
// W0-05: com `retificar`, o mesmo formulário grava a nova versão da triagem pelo próprio autor, com o motivo obrigatório
// (5 a 500 letras; a versão anterior fica inativa e visível). O resultado vem como a correção (`corrigido`).
import {
  type ResultadoCorrecao,
  type TriagemNutricionalLida,
  ESTADOS_NUTRICIONAIS_NRS,
  GRAVIDADES_NRS,
  type InstrumentoTriagem,
  type ItemFilaNutricao,
  type ResultadoTriagem,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveNutricao, registrarTriagem, retificarTriagem } from '../api-nutricao.js';
import { precisaTriagemFinal, previaNrs } from '../regras-nutricao.js';
import ErroNutricao from './ErroNutricao.vue';

const props = defineProps<{
  internado: Pick<ItemFilaNutricao, 'internacao' | 'nome' | 'idade' | 'intensiva'> | null;
  /** W0-05: a triagem a retificar (nova versão com o motivo). */
  retificar?: TriagemNutricionalLida | null;
}>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ gravado: [r: ResultadoTriagem]; corrigido: [r: ResultadoCorrecao] }>();
const motivo = ref('');
const curto = computed(() => !!props.retificar && motivo.value.trim().length < 5);
const { t } = useI18n();

type SimNao = 'sim' | 'nao';
const simNao = computed(() => [
  { valor: 'sim' as const, rotulo: t('nutricao.sim') },
  { valor: 'nao' as const, rotulo: t('nutricao.nao') },
]);
const instrumento = ref<InstrumentoTriagem>('nrs2002');
const imc = ref<SimNao>('nao');
const perda = ref<SimNao>('nao');
const ingestao = ref<SimNao>('nao');
const grave = ref<SimNao>('nao');
const estado = ref<'0' | '1' | '2' | '3' | ''>('');
const gravidade = ref<'0' | '1' | '2' | '3' | ''>('');
const apache = ref<number | null>(null);
const sofa = ref<number | null>(null);
const comorbidades = ref<number | null>(0);
const diasAntes = ref<number | null>(0);
const peso = ref<number | null>(null);
const altura = ref<number | null>(null);
const conduta = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);

watch(
  () => [props.internado, props.retificar, visivel.value] as const,
  ([i]) => {
    instrumento.value = props.retificar?.instrumento ?? (i?.intensiva ? 'nutric' : 'nrs2002');
    motivo.value = '';
    conduta.value = props.retificar?.conduta ?? '';
    imc.value = perda.value = ingestao.value = grave.value = 'nao';
    estado.value = gravidade.value = '';
    apache.value = sofa.value = null;
    comorbidades.value = diasAntes.value = 0;
    peso.value = altura.value = null;
    if (!props.retificar) conduta.value = '';
    erro.value = null;
  },
  { immediate: true },
);

const inicial = computed(() => ({
  imcAbaixoDe20e5: imc.value === 'sim',
  perdaDePeso3Meses: perda.value === 'sim',
  ingestaoReduzidaSemana: ingestao.value === 'sim',
  gravementeDoente: grave.value === 'sim',
}));
const final = computed(() => precisaTriagemFinal(inicial.value));
const previa = computed(() =>
  previaNrs(
    inicial.value,
    estado.value === '' ? null : Number(estado.value),
    gravidade.value === '' ? null : Number(gravidade.value),
    props.internado?.idade ?? null,
  ),
);
const opcoesEstado = ESTADOS_NUTRICIONAIS_NRS.map((e) => ({
  valor: String(e.pontos) as '0',
  rotulo: `${e.pontos}: ${e.rotulo}`,
}));
const opcoesGravidade = GRAVIDADES_NRS.map((e) => ({
  valor: String(e.pontos) as '0',
  rotulo: `${e.pontos}: ${e.rotulo}`,
}));
const instrumentos = computed(() => [
  { valor: 'nrs2002' as const, rotulo: t('nutricao.instrumentos.nrs2002') },
  { valor: 'nutric' as const, rotulo: t('nutricao.instrumentos.nutric') },
]);

async function gravar(): Promise<void> {
  if (!props.internado || curto.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const respostas =
      instrumento.value === 'nrs2002'
        ? {
            instrumento: 'nrs2002',
            ...inicial.value,
            estadoNutricional: final.value && estado.value !== '' ? Number(estado.value) : null,
            gravidade: final.value && gravidade.value !== '' ? Number(gravidade.value) : null,
          }
        : {
            instrumento: 'nutric',
            apache2: Number(apache.value ?? 0),
            sofa: Number(sofa.value ?? 0),
            comorbidades: Number(comorbidades.value ?? 0),
            diasInternadoAntesUti: Number(diasAntes.value ?? 0),
          };
    if (props.retificar) {
      const c = await retificarTriagem(
        props.retificar.id,
        {
          respostas,
          pesoKg: peso.value || null,
          alturaCm: altura.value || null,
          ...(conduta.value.trim() ? { conduta: conduta.value.trim() } : {}),
          motivo: motivo.value.trim(),
        },
        novaChaveNutricao('retificar-triagem'),
      );
      emit('corrigido', c);
      visivel.value = false;
      return;
    }
    const r = await registrarTriagem(
      {
        internacao: props.internado.internacao,
        respostas,
        pesoKg: peso.value || null,
        alturaCm: altura.value || null,
        ...(conduta.value.trim() ? { conduta: conduta.value.trim() } : {}),
      },
      novaChaveNutricao('triagem'),
    );
    emit('gravado', r);
    visivel.value = false;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="
      retificar
        ? t('nutricao.triagem.retificarTitulo', { nome: internado?.nome ?? '' })
        : t('nutricao.triagem.titulo', { nome: internado?.nome ?? '' })
    "
    largura="48rem"
  >
    <form class="formulario" data-testid="dialogo-triagem" @submit.prevent="gravar">
      <p v-if="retificar">{{ t('nutricao.triagem.retificarTexto') }}</p>
      <SanteOpcoes
        v-model="instrumento"
        :legenda="t('nutricao.triagem.instrumento')"
        :opcoes="instrumentos"
      />
      <template v-if="instrumento === 'nrs2002'">
        <h3>{{ t('nutricao.triagem.inicial') }}</h3>
        <SanteOpcoes v-model="imc" :legenda="t('nutricao.triagem.imc')" :opcoes="simNao" nome="nrs-imc" />
        <SanteOpcoes
          v-model="perda"
          :legenda="t('nutricao.triagem.perda')"
          :opcoes="simNao"
          nome="nrs-perda"
        />
        <SanteOpcoes
          v-model="ingestao"
          :legenda="t('nutricao.triagem.ingestao')"
          :opcoes="simNao"
          nome="nrs-ingestao"
        />
        <SanteOpcoes
          v-model="grave"
          :legenda="t('nutricao.triagem.grave')"
          :opcoes="simNao"
          nome="nrs-grave"
        />
        <template v-if="final">
          <h3>{{ t('nutricao.triagem.final') }}</h3>
          <SanteOpcoes
            v-model="estado"
            :legenda="t('nutricao.triagem.estado')"
            :opcoes="opcoesEstado"
            nome="nrs-estado"
          />
          <SanteOpcoes
            v-model="gravidade"
            :legenda="t('nutricao.triagem.gravidade')"
            :opcoes="opcoesGravidade"
            nome="nrs-gravidade"
          />
          <p role="status" data-testid="triagem-previa">
            {{
              previa === null
                ? t('nutricao.triagem.previaPendente')
                : t('nutricao.triagem.previa', { total: previa })
            }}
          </p>
        </template>
        <p v-else role="status">{{ t('nutricao.triagem.semFinal') }}</p>
      </template>
      <div v-else class="grade">
        <div class="campo">
          <label for="nutric-apache">{{ t('nutricao.triagem.apache') }}</label>
          <input id="nutric-apache" v-model.number="apache" type="number" min="0" max="71" required />
        </div>
        <div class="campo">
          <label for="nutric-sofa">{{ t('nutricao.triagem.sofa') }}</label>
          <input id="nutric-sofa" v-model.number="sofa" type="number" min="0" max="24" required />
        </div>
        <div class="campo">
          <label for="nutric-comorb">{{ t('nutricao.triagem.comorbidades') }}</label>
          <input id="nutric-comorb" v-model.number="comorbidades" type="number" min="0" max="20" />
        </div>
        <div class="campo">
          <label for="nutric-dias">{{ t('nutricao.triagem.diasAntesUti') }}</label>
          <input id="nutric-dias" v-model.number="diasAntes" type="number" min="0" max="365" />
        </div>
      </div>
      <div class="grade">
        <div class="campo">
          <label for="triagem-peso">{{ t('nutricao.triagem.peso') }}</label>
          <input id="triagem-peso" v-model.number="peso" type="number" min="1" max="400" step="0.1" />
        </div>
        <div class="campo">
          <label for="triagem-altura">{{ t('nutricao.triagem.altura') }}</label>
          <input id="triagem-altura" v-model.number="altura" type="number" min="30" max="250" />
        </div>
      </div>
      <SanteCampoTexto
        v-model="conduta"
        :rotulo="t('nutricao.triagem.conduta')"
        :max-bytes="500"
        multilinha
      />
      <div v-if="retificar" class="campo">
        <label for="triagem-motivo">{{ t('nutricao.triagem.motivoRetificacao') }}</label>
        <textarea
          id="triagem-motivo"
          v-model="motivo"
          rows="3"
          maxlength="500"
          required
          aria-describedby="triagem-motivo-ajuda"
          data-testid="triagem-motivo"
        />
        <small id="triagem-motivo-ajuda">{{ t('nutricao.correcao.motivoAjuda') }}</small>
      </div>
      <ErroNutricao v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="retificar ? t('nutricao.triagem.gravarRetificacao') : t('nutricao.triagem.gravar')"
          :desabilitado="ocupado || curto"
          data-testid="triagem-gravar"
        />
        <SanteBotao variante="texto" :rotulo="t('nutricao.cancelar')" @acionar="visivel = false" />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.formulario h3 {
  margin: var(--sgh-espaco-1) 0 0;
  font-size: 1rem;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.campo label {
  font-weight: 600;
}
.campo input,
.campo textarea {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
