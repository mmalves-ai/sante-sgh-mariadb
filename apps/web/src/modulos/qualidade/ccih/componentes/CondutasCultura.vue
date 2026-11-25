<script setup lang="ts">
// O cadastro das condutas da análise das culturas positivas (F7, 09-AREA linha 68): a lista com o efeito de cada conduta
// (abre a ficha de IRAS, indica a precaução, pede a resposta do prescritor) e o cadastro na mesma tela da fila, com o
// que falta na hora (o mesmo formato de código que a API aceita). A análise herda o efeito da conduta escolhida.
import { CLASSIFICACOES_CULTURA, type ClassificacaoCultura } from '@sgh/dominio-qualidade';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { novaChaveCcih } from '../api-ccih.js';
import { type CondutaDaCultura, gravarConduta } from '../api-culturas.js';
import ErroCcih from './ErroCcih.vue';

defineProps<{ condutas: readonly CondutaDaCultura[] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const podeCadastrar = pode('qualidade.iras.registrar');
const CODIGO = /^[a-z0-9_-]{2,30}$/;
const f = reactive({
  codigo: '',
  descricao: '',
  classificacao: '' as ClassificacaoCultura | '',
  abreCaso: false,
  indicaPrecaucao: false,
  exigeResposta: false,
});
const chave = ref(novaChaveCcih('conduta'));
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const opClassificacao = [
  { valor: '', rotulo: t('ccih.condutasCultura.todas') },
  ...CLASSIFICACOES_CULTURA.map((c) => ({
    valor: c as string,
    rotulo: t(`ccih.culturas.classificacoes.${c}`),
  })),
];
const falta = computed(() => {
  const r: string[] = [];
  if (!CODIGO.test(f.codigo.trim())) r.push(t('ccih.condutasCultura.faltas.codigo'));
  if (f.descricao.trim().length < 3) r.push(t('ccih.condutasCultura.faltas.descricao'));
  return r;
});
const efeitos = (c: CondutaDaCultura) =>
  [
    c.abreCaso ? t('ccih.condutasCultura.abreCaso') : null,
    c.indicaPrecaucao ? t('ccih.condutasCultura.indicaPrecaucao') : null,
    c.exigeResposta ? t('ccih.condutasCultura.exigeResposta') : null,
  ]
    .filter(Boolean)
    .join(' · ');
async function cadastrar(): Promise<void> {
  if (falta.value.length) return;
  erro.value = null;
  try {
    await gravarConduta(
      {
        codigo: f.codigo.trim(),
        descricao: f.descricao.trim(),
        classificacaoAplicavel: f.classificacao || null,
        abreCaso: f.abreCaso,
        indicaPrecaucao: f.indicaPrecaucao,
        exigeResposta: f.exigeResposta,
      },
      chave.value,
    );
    chave.value = novaChaveCcih('conduta');
    Object.assign(f, {
      codigo: '',
      descricao: '',
      classificacao: '',
      abreCaso: false,
      indicaPrecaucao: false,
      exigeResposta: false,
    });
    aviso.value = t('ccih.condutasCultura.gravada');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'culturas', 'condutas'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="ccih-condutas-titulo" data-testid="condutas-cultura">
    <h2 id="ccih-condutas-titulo">{{ t('ccih.condutasCultura.titulo') }}</h2>
    <p class="secundario">{{ t('ccih.condutasCultura.explicacao') }}</p>
    <p v-if="!condutas.length" data-testid="condutas-nenhuma">{{ t('ccih.condutasCultura.nenhuma') }}</p>
    <ul v-else class="lista-ccih">
      <li v-for="c in condutas" :key="c.id" :data-testid="`conduta-${c.codigo}`">
        <strong>{{ c.descricao }}</strong>
        <span class="secundario">{{ c.codigo }}</span>
        <span class="secundario">{{
          c.classificacaoAplicavel
            ? t(`ccih.culturas.classificacoes.${c.classificacaoAplicavel}`)
            : t('ccih.condutasCultura.todas')
        }}</span>
        <span v-if="efeitos(c)" class="selo">{{ efeitos(c) }}</span>
        <span v-if="!c.ativo" class="selo selo--grave">{{ t('ccih.condutasCultura.inativa') }}</span>
      </li>
    </ul>
    <div v-if="podeCadastrar" class="painel-ccih" data-testid="form-conduta">
      <div v-if="aviso" role="status" data-testid="conduta-aviso">{{ aviso }}</div>
      <ErroCcih v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteCampoTexto
          v-model="f.codigo"
          :rotulo="t('ccih.condutasCultura.codigo')"
          :max-bytes="30"
          obrigatorio
          data-testid="conduta-codigo"
        />
        <SanteCampoTexto
          v-model="f.descricao"
          :rotulo="t('ccih.condutasCultura.descricao')"
          :max-bytes="150"
          obrigatorio
          data-testid="conduta-descricao"
        />
        <SanteSelecao
          v-model="f.classificacao"
          :rotulo="t('ccih.condutasCultura.classificacao')"
          :opcoes="opClassificacao"
          data-testid="conduta-classificacao"
        />
      </div>
      <div class="linha-ccih">
        <label
          ><input v-model="f.abreCaso" type="checkbox" data-testid="conduta-abre-caso" />{{
            t('ccih.condutasCultura.abreCaso')
          }}</label
        >
        <label
          ><input v-model="f.indicaPrecaucao" type="checkbox" data-testid="conduta-precaucao" />{{
            t('ccih.condutasCultura.indicaPrecaucao')
          }}</label
        >
        <label
          ><input v-model="f.exigeResposta" type="checkbox" data-testid="conduta-resposta" />{{
            t('ccih.condutasCultura.exigeResposta')
          }}</label
        >
      </div>
      <p v-if="falta.length" class="secundario" data-testid="conduta-falta">{{ falta.join(' ') }}</p>
      <SanteBotao
        :rotulo="t('ccih.condutasCultura.cadastrar')"
        variante="primario"
        :desabilitado="falta.length > 0"
        data-testid="conduta-gravar"
        @acionar="cadastrar"
      />
    </div>
  </section>
</template>
