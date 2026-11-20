<script setup lang="ts">
// Contratos de manutenção (M55, etapa 1): a lista com a vigência e os equipamentos cobertos, e o registro
// (`manutencao.equipamento.editar`) com a empresa do cadastro de fornecedores (busca no servidor e SanteSelecao com
// busca), o número, o que cobre, a vigência, o prazo de atendimento do contrato, o valor mensal e os equipamentos.
// W0-08: em cada contrato, alterar pela versão, encerrar com motivo e excluir o registrado por engano (FormGerirContrato).
import { esquemaCoberturaContrato, type ApoioManutencao } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarEquipamentos, buscarFornecedores, gravarCobertura, lerCoberturas } from '../api-manutencao.js';
import {
  comTodos,
  corpoDaCobertura,
  dataBr,
  OPCOES,
  problemasDe,
  rascunhoCoberturaVazio,
  reais,
  ROTULOS,
} from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';
import FormGerirContrato from './FormGerirContrato.vue';

const props = defineProps<{ apoio: ApoioManutencao }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({
  queryKey: ['manutencao', 'coberturas', 'todas'],
  queryFn: () => lerCoberturas(null),
});

const novo = ref(false);
const gerindo = ref<{ id: number; modo: 'alterar' | 'encerrar' | 'excluir' } | null>(null);
async function gerido(m: string) {
  mensagem.value = m;
  gerindo.value = null;
  await cliente.invalidateQueries({ queryKey: ['manutencao'] });
}
const r = ref(rascunhoCoberturaVazio(props.apoio.hoje));
const termoFornecedor = ref('');
const buscado = ref<string | null>(null);
const fornecedores = useQuery({
  queryKey: computed(() => ['manutencao', 'fornecedores', buscado.value]),
  queryFn: () => buscarFornecedores(buscado.value ?? ''),
  enabled: computed(() => buscado.value !== null),
});
const opcoesFornecedor = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (fornecedores.data.value ?? []).map((f) => ({ valor: f.codigo, rotulo: `${f.nome} (${f.codigo})` })),
  ),
);
// Os equipamentos do contrato: a busca vai ao servidor com o termo (a primeira página traz só os mais recentes), e o
// nome de cada equipamento adicionado fica guardado na hora em que ele entra na lista.
const termoEquipamento = ref('');
const equipamentoBuscado = ref('');
const equipamentos = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'busca', equipamentoBuscado.value]),
  queryFn: () => buscarEquipamentos(equipamentoBuscado.value, null),
  enabled: computed(() => novo.value),
});
const nomesAdicionados = ref<Record<number, string>>({});
const rotuloEquipamento = (e: { codigo: string; nome: string }) => `${e.codigo} - ${e.nome}`;
const nomeEquipamento = (id: number) => {
  const e = (equipamentos.data.value ?? []).find((x) => x.id === id);
  return nomesAdicionados.value[id] ?? (e ? rotuloEquipamento(e) : String(id));
};
const paraAdicionar = ref<number | null>(null);
const opcoesEquipamento = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (equipamentos.data.value ?? [])
      .filter((e) => !r.value.equipamentos.includes(e.id))
      .map((e) => ({ valor: e.id, rotulo: rotuloEquipamento(e) })),
  ),
);
function adicionar() {
  const id = paraAdicionar.value;
  if (id !== null && !r.value.equipamentos.includes(id)) {
    const o = opcoesEquipamento.value.find((x) => x.valor === id);
    if (o) nomesAdicionados.value[id] = o.rotulo;
    r.value.equipamentos.push(id);
  }
  paraAdicionar.value = null;
}

const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar() {
  erro.value = null;
  const corpo = corpoDaCobertura(r.value);
  problemas.value = problemasDe(esquemaCoberturaContrato, corpo);
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    mensagem.value = (await gravarCobertura(corpo)).mensagem;
    novo.value = false;
    r.value = rascunhoCoberturaVazio(props.apoio.hoje);
    await cliente.invalidateQueries({ queryKey: ['manutencao'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-manutencao" aria-labelledby="contratos-titulo" data-testid="contratos-manutencao">
    <h2 id="contratos-titulo">{{ t('manutencao.contratos.titulo') }}</h2>
    <p v-if="mensagem" role="status" data-testid="contratos-mensagem">{{ mensagem }}</p>
    <SanteBotao
      v-if="apoio.pode.editar && !novo"
      :rotulo="t('manutencao.contratos.novo')"
      :desabilitado="!apoio.gravacao.ligada"
      data-testid="contratos-novo"
      @acionar="novo = true"
    />
    <form v-if="novo" class="bloco" data-testid="contratos-form" @submit.prevent="gravar">
      <div class="campos">
        <SanteCampoTexto
          v-model="termoFornecedor"
          :rotulo="t('manutencao.contratos.buscarFornecedor')"
          :max-bytes="60"
          data-testid="contratos-termo"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('manutencao.buscar')"
          data-testid="contratos-buscar"
          @acionar="buscado = termoFornecedor.trim()"
        />
        <SanteSelecao
          v-model="r.fornecedor"
          class="largo"
          obrigatorio
          :rotulo="t('manutencao.contratos.campos.fornecedor')"
          :opcoes="opcoesFornecedor"
          busca
          data-testid="contratos-fornecedor"
        />
        <SanteCampoTexto
          v-model="r.numero"
          obrigatorio
          :rotulo="t('manutencao.contratos.campos.numero')"
          :max-bytes="30"
          data-testid="contratos-numero"
        />
        <SanteSelecao
          v-model="r.cobertura"
          :rotulo="t('manutencao.contratos.campos.cobertura')"
          :opcoes="OPCOES.cobertura"
          data-testid="contratos-cobertura"
        />
        <SanteData
          v-model="r.inicio"
          editavel
          :rotulo="t('manutencao.contratos.campos.inicio')"
          data-testid="contratos-inicio"
        />
        <SanteData
          v-model="r.fim"
          editavel
          :rotulo="t('manutencao.contratos.campos.fim')"
          data-testid="contratos-fim"
        />
        <SanteCampoTexto
          v-model="r.slaHoras"
          :rotulo="t('manutencao.contratos.campos.slaHoras')"
          :max-bytes="3"
          data-testid="contratos-sla"
        />
        <SanteCampoTexto
          v-model="r.valorMensal"
          :rotulo="t('manutencao.contratos.campos.valorMensal')"
          :max-bytes="16"
          data-testid="contratos-valor"
        />
      </div>
      <fieldset class="bloco">
        <legend>{{ t('manutencao.contratos.campos.equipamentos') }}</legend>
        <div class="campos">
          <SanteCampoTexto
            v-model="termoEquipamento"
            :rotulo="t('manutencao.os.filtro.buscarEquipamento')"
            :max-bytes="80"
            data-testid="contratos-termo-equipamento"
            @keydown.enter.prevent="equipamentoBuscado = termoEquipamento.trim()"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('manutencao.buscar')"
            data-testid="contratos-buscar-equipamento"
            @acionar="equipamentoBuscado = termoEquipamento.trim()"
          />
          <SanteSelecao
            v-model="paraAdicionar"
            :rotulo="t('manutencao.os.campos.equipamento')"
            :opcoes="opcoesEquipamento"
            busca
            data-testid="contratos-equipamento"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('manutencao.contratos.adicionarEquipamento')"
            data-testid="contratos-adicionar"
            @acionar="adicionar"
          />
        </div>
        <p v-if="r.equipamentos.length === 0" class="secundario">
          {{ t('manutencao.contratos.nenhumEquipamento') }}
        </p>
        <ul v-else class="historico" data-testid="contratos-equipamentos">
          <li v-for="(id, i) in r.equipamentos" :key="id">
            {{ nomeEquipamento(id) }}
            <SanteBotao
              variante="texto"
              :rotulo="t('manutencao.contratos.remover')"
              @acionar="r.equipamentos.splice(i, 1)"
            />
          </li>
        </ul>
      </fieldset>
      <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="contratos-problemas">
        <li v-for="p in listaProblemas" :key="p">{{ p }}</li>
      </ul>
      <ErroManutencao v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="t('manutencao.gravar')"
          :desabilitado="gravando"
          data-testid="contratos-gravar"
        />
        <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="novo = false" />
      </div>
    </form>

    <FormGerirContrato
      v-if="gerindo"
      :key="`${gerindo.id}-${gerindo.modo}`"
      :contrato="gerindo.id"
      :modo="gerindo.modo"
      :apoio="apoio"
      @gravado="gerido"
      @cancelar="gerindo = null"
    />

    <ErroManutencao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('manutencao.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0" data-testid="contratos-vazio">
      {{ t('manutencao.contratos.nenhum') }}
    </p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-contratos">
        <thead>
          <tr>
            <th scope="col">{{ t('manutencao.contratos.campos.numero') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.fornecedor') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.cobertura') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.inicio') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.slaHoras') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.valorMensal') }}</th>
            <th scope="col">{{ t('manutencao.contratos.campos.equipamentos') }}</th>
            <th v-if="apoio.pode.editar" scope="col">{{ t('manutencao.contratos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value" :key="c.id" :data-testid="`contrato-${c.id}`">
            <td>{{ c.numero }}</td>
            <td>{{ c.fornecedor.nome }}</td>
            <td>{{ ROTULOS.cobertura[c.cobertura] }}</td>
            <td :class="{ vencido: !c.vigente }">
              {{ t('manutencao.contratos.vigencia', { inicio: dataBr(c.inicio), fim: dataBr(c.fim) }) }}
              <template v-if="c.encerradaEm">
                ({{ t('manutencao.contratos.encerrado', { data: dataBr(c.encerradaEm) }) }})
              </template>
              <template v-else>
                ({{ c.vigente ? t('manutencao.contratos.vigente') : t('manutencao.contratos.vencido') }})
              </template>
            </td>
            <td>{{ c.slaHoras ?? '' }}</td>
            <td>{{ c.valorMensal === null ? '' : reais(c.valorMensal) }}</td>
            <td>{{ c.equipamentos.length }}</td>
            <td v-if="apoio.pode.editar" class="acoes">
              <template v-if="c.ativa">
                <SanteBotao
                  variante="texto"
                  :rotulo="t('manutencao.contratos.gestao.alterar')"
                  :desabilitado="!apoio.gravacao.ligada"
                  :data-testid="`contrato-alterar-${c.id}`"
                  @acionar="gerindo = { id: c.id, modo: 'alterar' }"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('manutencao.contratos.gestao.encerrar')"
                  :desabilitado="!apoio.gravacao.ligada"
                  :data-testid="`contrato-encerrar-${c.id}`"
                  @acionar="gerindo = { id: c.id, modo: 'encerrar' }"
                />
              </template>
              <SanteBotao
                variante="texto"
                :rotulo="t('manutencao.contratos.gestao.excluir')"
                :desabilitado="!apoio.gravacao.ligada"
                :data-testid="`contrato-excluir-${c.id}`"
                @acionar="gerindo = { id: c.id, modo: 'excluir' }"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
