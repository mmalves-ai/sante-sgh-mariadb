<script setup lang="ts">
// W0-08, parte 8 (mercado M2): o alerta de tecnovigilância ou recall com os equipamentos do parque diante dele. Os da
// faixa de série aparecem como afetados; os sem série cadastrada, "a conferir" (a pessoa confere na etiqueta e os
// inclui). "Gerar OS de ação de campo" abre uma OS de inspeção por equipamento ainda sem OS, pela versão vista. Alterar
// pela versão com motivo; encerrar com motivo; excluir só o registrado por engano (com OS ou queixa ligadas, o servidor
// recusa com quantos e quais e a tela oferece o encerramento). A OS e a queixa de cada equipamento aparecem com o link.
import {
  esquemaEncerrarAlertaEquipamento,
  esquemaExcluirAlertaEquipamento,
  type AlertaEquipamentoDetalhe,
  type PrioridadeOs,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  dependentesDaRecusa,
  encerrarAlerta,
  excluirAlerta,
  gerarAcaoDeCampo,
  lerAlerta,
} from '../api-manutencao.js';
import { dataBr, instanteBr, OPCOES, problemasDe } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';
import FormAlerta from './FormAlerta.vue';

const props = defineProps<{ id: number; podeEditar: boolean; ligada: boolean }>();
const emit = defineEmits<{ fechar: []; mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'alertas', 'detalhe', props.id]),
  queryFn: () => lerAlerta(props.id),
});
const a = computed<AlertaEquipamentoDetalhe | null>(() => consulta.data.value ?? null);
const aberto = computed(() => a.value?.situacao === 'aberto');
const pendentes = computed(() => (a.value?.afetados ?? []).filter((x) => x.os === null));
const conferidos = ref<number[]>([]);
const prioridade = ref<PrioridadeOs>('alta');

type Modo = 'alterar' | 'encerrar' | 'excluir';
const modo = ref<Modo | null>(null);
const motivo = ref('');
const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const dependentes = computed(() => dependentesDaRecusa(erro.value));
const mensagem = ref<string | null>(null);
const gravando = ref(false);

function escolher(m: Modo) {
  modo.value = modo.value === m ? null : m;
  motivo.value = '';
  problemas.value = {};
  erro.value = null;
}
async function recarregar(m: string) {
  mensagem.value = m;
  modo.value = null;
  conferidos.value = [];
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'alertas'] });
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'os'] });
  emit('mudou');
}

async function gerar() {
  const x = a.value;
  if (!x) return;
  erro.value = null;
  // Sem conferidos, vazio: o servidor pega todos os afetados pela faixa; com conferidos, a lista explícita.
  const equipamentos =
    conferidos.value.length === 0
      ? []
      : [
          ...pendentes.value.filter((p) => p.enquadramento === 'afetado').map((p) => p.equipamento),
          ...conferidos.value,
        ];
  gravando.value = true;
  try {
    const r = await gerarAcaoDeCampo(x.id, { versao: x.versao, equipamentos, prioridade: prioridade.value });
    await recarregar(r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

async function encerrarOuExcluir() {
  const x = a.value;
  const m = modo.value;
  if (!x || (m !== 'encerrar' && m !== 'excluir')) return;
  erro.value = null;
  const b = { versao: x.versao, motivo: motivo.value.trim() };
  problemas.value = problemasDe(
    m === 'encerrar' ? esquemaEncerrarAlertaEquipamento : esquemaExcluirAlertaEquipamento,
    { ...b, id: x.id },
  );
  if (listaProblemas.value.length > 0) return;
  gravando.value = true;
  try {
    const r = m === 'encerrar' ? await encerrarAlerta(x.id, b) : await excluirAlerta(x.id, b);
    if (m === 'excluir') {
      await cliente.invalidateQueries({ queryKey: ['manutencao', 'alertas'] });
      emit('mudou');
      emit('fechar');
      return;
    }
    await recarregar(r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const alterado = (...x: [number, string]) => recarregar(x[1]);
function encerrarEmVez() {
  erro.value = null;
  modo.value = 'encerrar';
}
</script>

<template>
  <section class="bloco" aria-labelledby="alerta-detalhe-titulo" data-testid="alerta-detalhe">
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" grupo="alerta" />
    <p v-else-if="!a" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <div class="acoes">
        <h2 id="alerta-detalhe-titulo">{{ t('manutencao.alertas.detalhe', { numero: a.numero }) }}</h2>
        <SanteBotao
          variante="texto"
          :rotulo="t('manutencao.fechar')"
          data-testid="alerta-detalhe-fechar"
          @acionar="emit('fechar')"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="alerta-mensagem">{{ mensagem }}</p>
      <dl class="ficha">
        <dt>{{ t('manutencao.alertas.campos.tipo') }}</dt>
        <dd>{{ t(`manutencao.alertas.tipos.${a.tipo}`) }}</dd>
        <dt>{{ t('manutencao.alertas.campos.titulo') }}</dt>
        <dd>{{ a.titulo }}</dd>
        <dt>{{ t('manutencao.alertas.campos.situacao') }}</dt>
        <dd data-testid="alerta-situacao">{{ t(`manutencao.alertas.situacoes.${a.situacao}`) }}</dd>
        <dt>{{ t('manutencao.alertas.campos.fabricante') }}</dt>
        <dd>{{ a.fabricante }}</dd>
        <dt>{{ t('manutencao.alertas.campos.modelo') }}</dt>
        <dd>{{ a.modelo ?? t('manutencao.alertas.campos.todosModelos') }}</dd>
        <dt>{{ t('manutencao.alertas.campos.faixa') }}</dt>
        <dd>
          {{
            a.serieInicio ? `${a.serieInicio} - ${a.serieFim}` : t('manutencao.alertas.campos.todasSeries')
          }}
        </dd>
        <template v-if="a.registroAnvisa">
          <dt>{{ t('manutencao.alertas.campos.registroAnvisa') }}</dt>
          <dd>{{ a.registroAnvisa }}</dd>
        </template>
        <template v-if="a.publicadoEm">
          <dt>{{ t('manutencao.alertas.campos.publicadoEm') }}</dt>
          <dd>{{ dataBr(a.publicadoEm) }}</dd>
        </template>
        <dt>{{ t('manutencao.alertas.campos.descricao') }}</dt>
        <dd>{{ a.descricao }}</dd>
        <dt>{{ t('manutencao.alertas.campos.acao') }}</dt>
        <dd>{{ a.acao }}</dd>
      </dl>
      <p v-if="a.situacao === 'encerrado'" class="secundario" data-testid="alerta-encerrado">
        {{
          t('manutencao.alertas.encerradoPor', {
            em: instanteBr(a.encerradoEm),
            por: a.encerradoPor ?? '',
            motivo: a.motivo ?? '',
          })
        }}
      </p>
      <p v-if="!a.importacaoAnvisa" class="secundario">{{ t('manutencao.alertas.importacaoDesligada') }}</p>

      <h3>{{ t('manutencao.alertas.afetados') }}</h3>
      <p v-if="a.afetados.length === 0" data-testid="alerta-sem-afetados">
        {{ t('manutencao.alertas.nenhumAfetado') }}
      </p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="alerta-afetados">
          <thead>
            <tr>
              <th scope="col">{{ t('manutencao.alertas.colunas.equipamento') }}</th>
              <th scope="col">{{ t('manutencao.alertas.colunas.serie') }}</th>
              <th scope="col">{{ t('manutencao.alertas.colunas.enquadramento') }}</th>
              <th scope="col">{{ t('manutencao.alertas.colunas.os') }}</th>
              <th scope="col">{{ t('manutencao.alertas.colunas.queixa') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in a.afetados" :key="x.equipamento" :data-testid="`alerta-afetado-${x.equipamento}`">
              <td>{{ x.codigo }} - {{ x.nome }}</td>
              <td>{{ x.numeroSerie ?? '' }}</td>
              <td>
                {{ t(`manutencao.alertas.enquadramento.${x.enquadramento}`) }}
                <label v-if="x.enquadramento === 'conferir' && x.os === null && aberto && podeEditar">
                  <input
                    v-model="conferidos"
                    type="checkbox"
                    :value="x.equipamento"
                    :data-testid="`alerta-conferido-${x.equipamento}`"
                  />
                  {{ t('manutencao.alertas.incluirConferido', { codigo: x.codigo }) }}
                </label>
              </td>
              <td>
                <RouterLink v-if="x.os" :to="`/manutencao/os?os=${x.os.id}`">{{ x.os.numero }}</RouterLink>
              </td>
              <td>
                <RouterLink v-if="x.queixa" :to="`/qualidade/nsp/tecnovigilancia/${x.queixa}`">{{
                  t('manutencao.alertas.queixa', { n: x.queixa })
                }}</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="podeEditar && aberto">
        <div class="campos">
          <SanteSelecao
            v-model="prioridade"
            :rotulo="t('manutencao.alertas.prioridade')"
            :opcoes="OPCOES.prioridade"
            data-testid="alerta-prioridade"
          />
        </div>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('manutencao.alertas.gerar')"
            :desabilitado="gravando || !ligada || pendentes.length === 0"
            data-testid="alerta-gerar"
            @acionar="gerar"
          />
          <SanteBotao
            :variante="modo === 'alterar' ? 'primario' : 'secundario'"
            :rotulo="t('manutencao.alertas.alterar')"
            :desabilitado="!ligada"
            data-testid="alerta-alterar"
            @acionar="escolher('alterar')"
          />
          <SanteBotao
            :variante="modo === 'encerrar' ? 'primario' : 'secundario'"
            :rotulo="t('manutencao.alertas.encerrar')"
            :desabilitado="!ligada"
            data-testid="alerta-encerrar"
            @acionar="escolher('encerrar')"
          />
          <SanteBotao
            :variante="modo === 'excluir' ? 'primario' : 'secundario'"
            :rotulo="t('manutencao.alertas.excluir')"
            :desabilitado="!ligada"
            data-testid="alerta-excluir"
            @acionar="escolher('excluir')"
          />
        </div>
      </template>
      <ErroManutencao v-if="erro && modo === null" :erro="erro" grupo="alerta" />

      <FormAlerta
        v-if="modo === 'alterar'"
        :key="a.versao"
        :alerta="a"
        :ligada="ligada"
        @gravado="alterado"
        @cancelar="modo = null"
      />
      <form
        v-else-if="modo"
        class="bloco"
        :data-testid="`alerta-form-${modo}`"
        @submit.prevent="encerrarOuExcluir"
      >
        <SanteCampoTexto
          v-model="motivo"
          multilinha
          obrigatorio
          :rotulo="t('manutencao.motivo')"
          :max-bytes="400"
          data-testid="alerta-gerir-motivo"
        />
        <ul
          v-if="listaProblemas.length > 0"
          class="vencido"
          role="alert"
          data-testid="alerta-gerir-problemas"
        >
          <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
        </ul>
        <ErroManutencao v-if="erro" :erro="erro" grupo="alerta" />
        <div v-if="dependentes.length > 0" class="bloco" data-testid="alerta-dependentes">
          <p>{{ t('manutencao.alertas.dependentes') }}</p>
          <ul>
            <li v-for="d in dependentes" :key="d.rotulo">{{ d.rotulo }}: {{ d.quantidade }}</li>
          </ul>
          <SanteBotao
            variante="secundario"
            :rotulo="t('manutencao.alertas.encerrarEmVez')"
            data-testid="alerta-encerrar-em-vez"
            @acionar="encerrarEmVez"
          />
        </div>
        <div class="acoes">
          <SanteBotao
            v-if="modo === 'excluir'"
            variante="destrutivo"
            :rotulo="t('manutencao.alertas.gravarExclusao')"
            :confirmacao="t('manutencao.alertas.confirmarExcluir', { numero: a.numero })"
            :desabilitado="gravando || !ligada"
            data-testid="alerta-gerir-gravar"
            @acionar="encerrarOuExcluir"
          />
          <SanteBotao
            v-else
            tipo="submit"
            :rotulo="t('manutencao.alertas.gravarEncerramento')"
            :desabilitado="gravando || !ligada"
            data-testid="alerta-gerir-gravar"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('manutencao.cancelar')"
            data-testid="alerta-gerir-cancelar"
            @acionar="modo = null"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
