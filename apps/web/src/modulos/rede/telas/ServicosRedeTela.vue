<script setup lang="ts">
// Serviços compartilhados da Rede (M57, etapa 3; ficha, seção 7; regra 11; DP-14) — dentro de `Relatórios e BI > BI
// consolidado da Rede`: o registro das oportunidades (catálogo, fornecedores, compras, laudos), sem compromisso de
// escopo, de todos os estabelecimentos da rede (cada registro no banco de quem registrou), com os filtros de área e
// situação (SanteSelecao), a busca no título ou na descrição, a paginação (até o teto: acima dele, o aviso de que só os
// mais recentes aparecem), "Registrar oportunidade", "Editar" (o detalhe com quem registrou e onde, e a edição de
// área, título, descrição, situação e envolvidos) e a mudança rápida de situação (só com `rede.servico.registrar`).
import {
  AREAS_SERVICO_COMPARTILHADO,
  type AreaServicoCompartilhado,
  type ServicoCompartilhado,
  SITUACOES_SERVICO_COMPARTILHADO,
  type SituacaoServicoCompartilhado,
  TETO_LISTA_SERVICOS_REDE,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr } from '../../cadastro/formato.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { alterarServicoRede, lerServicosRede } from '../api-bi-rede.js';
import RegistrarServicoRede from '../componentes/RegistrarServicoRede.vue';

const POR_PAGINA = 20;
const { t } = useI18n();
const cliente = useQueryClient();
const area = ref<AreaServicoCompartilhado | ''>('');
const situacao = ref<SituacaoServicoCompartilhado | ''>('');
const pagina = ref(1);
/** O texto digitado e o aplicado (a busca vai à API ao acionar "Buscar", não a cada letra). */
const textoBusca = ref('');
const busca = ref('');
function buscar(): void {
  busca.value = textoBusca.value.trim();
}
watch([area, situacao, busca], () => (pagina.value = 1));
const lista = useQuery({
  queryKey: computed(() => ['biRede', 'servicos', area.value, situacao.value, busca.value, pagina.value]),
  queryFn: () =>
    lerServicosRede({
      ...(area.value ? { area: area.value } : {}),
      ...(situacao.value ? { situacao: situacao.value } : {}),
      ...(busca.value ? { busca: busca.value } : {}),
      pagina: pagina.value,
      porPagina: POR_PAGINA,
    }),
});
const l = computed(() => lista.data.value);
const podeRegistrar = computed(() => pode('rede.servico.registrar'));
const nomes = computed(() =>
  Object.fromEntries((l.value?.estabelecimentos ?? []).map((e) => [e.codigo, e.nome])),
);
const opcoesArea = computed(() => [
  { valor: '' as const, rotulo: t('biRede.servicos.filtros.todas') },
  ...AREAS_SERVICO_COMPARTILHADO.map((v) => ({ valor: v, rotulo: t(`biRede.servicos.areas.${v}`) })),
]);
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t('biRede.servicos.filtros.todas') },
  ...SITUACOES_SERVICO_COMPARTILHADO.map((v) => ({ valor: v, rotulo: t(`biRede.servicos.situacoes.${v}`) })),
]);
const opcoesNova = computed(() =>
  SITUACOES_SERVICO_COMPARTILHADO.map((v) => ({ valor: v, rotulo: t(`biRede.servicos.situacoes.${v}`) })),
);

const registrando = ref(false);
const emEdicao = ref<ServicoCompartilhado | null>(null);
function abrirRegistro(): void {
  emEdicao.value = null;
  registrando.value = true;
}
function editar(x: ServicoCompartilhado): void {
  mensagem.value = null;
  erro.value = null;
  emEdicao.value = x;
  registrando.value = true;
}
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const novas = reactive<Record<string, SituacaoServicoCompartilhado>>({});
const chave = (x: ServicoCompartilhado) => `${x.estabelecimento}-${x.id}`;
function novaDe(x: ServicoCompartilhado): SituacaoServicoCompartilhado {
  return novas[chave(x)] ?? x.situacao;
}
async function reler(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['biRede', 'servicos'] });
}
async function registrado(): Promise<void> {
  mensagem.value = t('biRede.servicos.registrado');
  await reler();
}
async function alterado(mudou: boolean): Promise<void> {
  mensagem.value = mudou ? t('biRede.servicos.alterado') : t('biRede.servicos.semMudanca');
  emEdicao.value = null;
  await reler();
}
async function salvar(x: ServicoCompartilhado): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await alterarServicoRede(x.estabelecimento, x.id, { situacao: novaDe(x) });
    mensagem.value = r.mudou ? t('biRede.servicos.salvo') : t('biRede.servicos.semMudanca');
    delete novas[chave(x)];
    await reler();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="servicos-rede-titulo" data-testid="tela-servicos-rede">
    <h1 id="servicos-rede-titulo">{{ t('biRede.servicos.titulo') }}</h1>
    <p>{{ t('biRede.servicos.subtitulo') }}</p>
    <p>
      <RouterLink to="/relatorios/bi/rede">{{ t('biRede.servicos.voltar') }}</RouterLink>
    </p>
    <div class="barra">
      <form class="linha" role="search" data-testid="busca-servicos-rede" @submit.prevent="buscar">
        <SanteCampoTexto v-model="textoBusca" :rotulo="t('biRede.servicos.busca')" :max-bytes="60" />
        <SanteBotao :rotulo="t('biRede.servicos.buscar')" tipo="submit" variante="secundario" />
      </form>
      <SanteSelecao v-model="area" :rotulo="t('biRede.servicos.filtros.area')" :opcoes="opcoesArea" />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('biRede.servicos.filtros.situacao')"
        :opcoes="opcoesSituacao"
      />
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="t('biRede.servicos.registrar')"
        variante="secundario"
        data-testid="botao-registrar-servico-rede"
        @acionar="abrirRegistro"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-servicos-rede">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!l">{{ t('biRede.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="l.foraDoAr.length > 0"
        :texto="t('biRede.servicos.foraDoAr', { nomes: l.foraDoAr.map((c) => nomes[c] ?? c).join(', ') })"
        variante="aviso"
      />
      <SanteAlerta
        v-if="l.truncado"
        :texto="t('biRede.servicos.truncado', { teto: TETO_LISTA_SERVICOS_REDE })"
        variante="aviso"
        data-testid="servicos-rede-truncado"
      />
      <p v-if="l.itens.length === 0" data-testid="servicos-rede-vazio">{{ t('biRede.servicos.nenhuma') }}</p>
      <table v-else data-testid="tabela-servicos-rede">
        <caption>
          {{
            t('biRede.servicos.legenda', { total: l.total })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('biRede.servicos.colunas.titulo') }}</th>
            <th scope="col">{{ t('biRede.servicos.colunas.area') }}</th>
            <th scope="col">{{ t('biRede.servicos.colunas.envolvidos') }}</th>
            <th scope="col">{{ t('biRede.servicos.colunas.situacao') }}</th>
            <th scope="col">{{ t('biRede.servicos.colunas.registro') }}</th>
            <th v-if="podeRegistrar" scope="col">{{ t('biRede.servicos.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in l.itens" :key="chave(x)" :data-testid="`servico-rede-${chave(x)}`">
            <td>
              {{ x.titulo }}
              <span v-if="x.descricao" class="pequeno">{{ x.descricao }}</span>
            </td>
            <td>{{ t(`biRede.servicos.areas.${x.area}`) }}</td>
            <td>{{ x.estabelecimentos.map((c) => nomes[c] ?? c).join(', ') }}</td>
            <td>{{ t(`biRede.servicos.situacoes.${x.situacao}`) }}</td>
            <td class="pequeno">
              {{
                t('biRede.servicos.registradoPor', {
                  quem: x.registradoPor,
                  quando: carimboBr(x.registradoEm),
                  onde: nomes[x.estabelecimento] ?? x.estabelecimento,
                })
              }}
            </td>
            <td v-if="podeRegistrar">
              <div class="linha">
                <SanteSelecao
                  :model-value="novaDe(x)"
                  :rotulo="t('biRede.servicos.novaSituacao', { titulo: x.titulo })"
                  ocultar-rotulo
                  :opcoes="opcoesNova"
                  @update:model-value="(v: SituacaoServicoCompartilhado) => (novas[chave(x)] = v)"
                />
                <SanteBotao
                  :rotulo="t('biRede.servicos.salvar')"
                  variante="texto"
                  :data-testid="`salvar-servico-${chave(x)}`"
                  @acionar="salvar(x)"
                />
                <SanteBotao
                  :rotulo="t('biRede.servicos.colunas.editar')"
                  :aria-label="t('biRede.servicos.editar', { titulo: x.titulo })"
                  variante="texto"
                  :data-testid="`editar-servico-${chave(x)}`"
                  @acionar="editar(x)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <PaginacaoCadastro
        v-model="pagina"
        :total="l.total"
        :por-pagina="POR_PAGINA"
        :rotulo="t('biRede.servicos.titulo')"
      />
    </template>
    <RegistrarServicoRede
      v-model:visivel="registrando"
      :estabelecimentos="l?.estabelecimentos ?? []"
      :registro="emEdicao"
      @registrado="registrado"
      @alterado="alterado"
    />
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
caption {
  text-align: left;
  font-weight: 600;
}
.barra,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
</style>
