<script setup lang="ts">
// W0-08, parte 8 (mercado M2): registrar o alerta de tecnovigilância ou recall à mão (a importação da Anvisa é
// parâmetro desligado) ou alterá-lo pela versão lida, com motivo. Depois da primeira OS de ação de campo, o critério
// (fabricante, modelo e faixa de série) trava e aparece só para leitura; o resto segue alterável. A tela confere pelo
// mesmo esquema do servidor.
import {
  esquemaAlterarAlertaEquipamento,
  esquemaRegistrarAlertaEquipamento,
  type AlertaEquipamento,
  type TipoAlertaEquipamento,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarAlerta, registrarAlerta } from '../api-manutencao.js';
import { problemasDe } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ alerta?: AlertaEquipamento | null; ligada: boolean }>();
const emit = defineEmits<{ gravado: [number, string]; cancelar: [] }>();
const { t } = useI18n();

const a = props.alerta ?? null;
const travado = computed(() => (a?.acoes ?? 0) > 0);
const r = ref({
  numero: a?.numero ?? '',
  tipo: (a?.tipo ?? 'alerta') as TipoAlertaEquipamento,
  titulo: a?.titulo ?? '',
  fabricante: a?.fabricante ?? '',
  modelo: a?.modelo ?? '',
  serieInicio: a?.serieInicio ?? '',
  serieFim: a?.serieFim ?? '',
  registroAnvisa: a?.registroAnvisa ?? '',
  publicadoEm: (a?.publicadoEm ?? null) as string | null,
  descricao: a?.descricao ?? '',
  acao: a?.acao ?? '',
});
const motivo = ref('');
const TIPOS: TipoAlertaEquipamento[] = ['alerta', 'recall'];
const opcoesTipo = computed(() =>
  TIPOS.map((x) => ({ valor: x, rotulo: t(`manutencao.alertas.tipos.${x}`) })),
);

const vazio = (v: string) => (v.trim() === '' ? null : v.trim());
function corpo() {
  const x = r.value;
  const b = {
    numero: x.numero.trim(),
    tipo: x.tipo,
    titulo: x.titulo.trim(),
    fabricante: x.fabricante.trim(),
    modelo: vazio(x.modelo),
    serieInicio: vazio(x.serieInicio),
    serieFim: vazio(x.serieFim),
    registroAnvisa: vazio(x.registroAnvisa),
    publicadoEm: x.publicadoEm,
    descricao: x.descricao.trim(),
    acao: x.acao.trim(),
  };
  return a ? { ...b, versao: a.versao, motivo: motivo.value.trim() } : b;
}

const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const gravando = ref(false);
async function enviar() {
  erro.value = null;
  const b = corpo();
  problemas.value = a
    ? problemasDe(esquemaAlterarAlertaEquipamento, { ...b, id: a.id })
    : problemasDe(esquemaRegistrarAlertaEquipamento, b);
  if (listaProblemas.value.length > 0) return;
  gravando.value = true;
  try {
    const x = a ? await alterarAlerta(a.id, b) : await registrarAlerta(b);
    emit('gravado', x.id, x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="bloco" data-testid="alerta-form" @submit.prevent="enviar">
    <div class="campos">
      <SanteCampoTexto
        v-model="r.numero"
        obrigatorio
        :rotulo="t('manutencao.alertas.campos.numero')"
        :max-bytes="40"
        data-testid="alerta-numero"
      />
      <SanteSelecao
        v-model="r.tipo"
        :rotulo="t('manutencao.alertas.campos.tipo')"
        :opcoes="opcoesTipo"
        data-testid="alerta-tipo"
      />
      <SanteCampoTexto
        v-model="r.titulo"
        obrigatorio
        :rotulo="t('manutencao.alertas.campos.titulo')"
        :max-bytes="120"
        data-testid="alerta-titulo"
      />
      <SanteCampoTexto
        v-model="r.registroAnvisa"
        :rotulo="t('manutencao.alertas.campos.registroAnvisa')"
        :max-bytes="11"
        data-testid="alerta-registro"
      />
      <SanteData
        v-model="r.publicadoEm"
        editavel
        :rotulo="t('manutencao.alertas.campos.publicadoEm')"
        data-testid="alerta-publicado"
      />
    </div>
    <p v-if="travado" class="secundario" data-testid="alerta-criterio-travado">
      {{ t('manutencao.alertas.criterioTravado') }}
      {{ r.fabricante }} / {{ r.modelo || t('manutencao.alertas.campos.todosModelos') }} /
      {{ r.serieInicio ? `${r.serieInicio} - ${r.serieFim}` : t('manutencao.alertas.campos.todasSeries') }}
    </p>
    <fieldset v-else class="bloco">
      <legend>{{ t('manutencao.alertas.campos.faixa') }}</legend>
      <div class="campos">
        <SanteCampoTexto
          v-model="r.fabricante"
          obrigatorio
          :rotulo="t('manutencao.alertas.campos.fabricante')"
          :max-bytes="60"
          data-testid="alerta-fabricante"
        />
        <SanteCampoTexto
          v-model="r.modelo"
          :rotulo="t('manutencao.alertas.campos.modelo')"
          :max-bytes="60"
          data-testid="alerta-modelo"
        />
        <SanteCampoTexto
          v-model="r.serieInicio"
          :rotulo="t('manutencao.alertas.campos.serieInicio')"
          :max-bytes="40"
          data-testid="alerta-serie-inicio"
        />
        <SanteCampoTexto
          v-model="r.serieFim"
          :rotulo="t('manutencao.alertas.campos.serieFim')"
          :max-bytes="40"
          data-testid="alerta-serie-fim"
        />
      </div>
      <p class="secundario">
        {{ t('manutencao.alertas.campos.modeloAjuda') }} {{ t('manutencao.alertas.campos.serieAjuda') }}
      </p>
    </fieldset>
    <SanteCampoTexto
      v-model="r.descricao"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.alertas.campos.descricao')"
      :max-bytes="2000"
      data-testid="alerta-descricao"
    />
    <SanteCampoTexto
      v-model="r.acao"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.alertas.campos.acao')"
      :max-bytes="2000"
      data-testid="alerta-acao"
    />
    <SanteCampoTexto
      v-if="a"
      v-model="motivo"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.motivo')"
      :max-bytes="400"
      data-testid="alerta-motivo"
    />
    <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="alerta-problemas">
      <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
    </ul>
    <ErroManutencao v-if="erro" :erro="erro" grupo="alerta" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t(a ? 'manutencao.alertas.gravarAlteracao' : 'manutencao.alertas.gravarRegistro')"
        :desabilitado="gravando || !ligada"
        data-testid="alerta-gravar"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('manutencao.cancelar')"
        data-testid="alerta-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
