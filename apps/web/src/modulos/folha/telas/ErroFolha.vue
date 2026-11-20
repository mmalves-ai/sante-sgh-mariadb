<script setup lang="ts">
// Erro da tela da folha (M53.1): o código da recusa (retorno recusado, lote desatualizado ou substituído, arquivo fora do
// leiaute, chave do CPF ausente) vira o texto da tela; o resto segue o erro padrão da gestão de pessoas. M53.8: `base`
// (opcional) é a chave das recusas da tela, conferida antes das comuns (o mesmo código pode ter texto próprio).
import { VERSAO_LEIAUTE_FOLHA_INTERFACE } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../../pessoas/componentes/ErroPessoas.vue';
import { recusaDe } from '../comum-folha.js';

const props = defineProps<{ erro: unknown; base?: string }>();
const { t, te } = useI18n();
const texto = computed(() => {
  const r = recusaDe(props.erro);
  if (!r) return null;
  const campos = r.campos.join(', ');
  for (const base of [
    ...(props.base ? [props.base] : []),
    'folha.erro',
    'folha.interface.recusa',
    'folha.ferias.recusa',
    'folha.rescisao.recusa',
    'folha.esocial.recusa',
    'folha.integracao.recusa',
  ])
    if (te(`${base}.${r.codigo}`))
      return t(`${base}.${r.codigo}`, { versao: VERSAO_LEIAUTE_FOLHA_INTERFACE, campos });
  return null;
});
</script>

<template>
  <SanteAlerta v-if="texto" :texto="texto" variante="aviso" anunciar data-testid="recusa-folha" />
  <ErroPessoas v-else :erro="erro" />
</template>
