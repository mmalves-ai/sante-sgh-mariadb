<script setup lang="ts">
// Portal do médico externo, lado interno (M50, etapa 3; itens "Extrato de produção e repasse" e "Agenda cirúrgica do
// cirurgião externo" da árvore): `/portais/medico-externo`. As contas aprovadas do portal de resultados (filtro por nome
// ou número do conselho e pela situação do vínculo; 25 por página), o cadastro do corpo clínico ligado a cada uma (a
// sugestão pelo número e pela UF do conselho; a pessoa confere e decide; o aviso do número repetido em outro cadastro) e
// os pedidos de cirurgia aguardando o bloco, cada um com o detalhe e o mapa do dia. Sem o vínculo, o médico não vê
// extrato nem agenda.
import type { ContaMedicoExterno } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarProfissionaisCorpoClinico,
  contasMedicoExterno,
  desvincularMedicoExterno,
  vincularMedicoExterno,
} from '../api-portal-medico.js';
import ContaMedicoAtos from '../componentes/ContaMedicoAtos.vue';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const fTexto = ref('');
const fSituacao = ref('todas');
const filtro = ref({ q: '', situacao: 'todas', pagina: 1 });
const lista = useQuery({
  queryKey: computed(() => ['portal-medico', 'contas', filtro.value]),
  queryFn: () => contasMedicoExterno(filtro.value),
});
const situacoes = computed(() =>
  (['todas', 'ligadas', 'sem-vinculo', 'bloqueadas', 'encerradas'] as const).map((v) => ({
    valor: v,
    rotulo: t(`portalMedico.interno.situacoes.${v}`),
  })),
);
const paginas = computed(() =>
  lista.data.value ? Math.max(1, Math.ceil(lista.data.value.total / lista.data.value.porPagina)) : 1,
);
function filtrar(): void {
  filtro.value = { q: fTexto.value.trim(), situacao: fSituacao.value, pagina: 1 };
}
function irPara(pagina: number): void {
  filtro.value = { ...filtro.value, pagina };
}
const dataBr = (d: string) => d.split('-').reverse().join('/');
const podeVincular = computed(() => pode('portal.medicoExterno.vincular'));
const podeGerir = computed(() => pode('portal.medicoExterno.conta'));
async function aposAto(m: string): Promise<void> {
  erro.value = null;
  mensagem.value = m;
  await cliente.invalidateQueries({ queryKey: ['portal-medico', 'contas'] });
}
const escolhido = ref<Record<number, string>>({});
const termo = ref<Record<number, string>>({});
const achados = ref<Record<number, { id: number; nome: string }[]>>({});
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const endereco = computed(() => `${window.location.origin}/resultados`);
const quando = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');

function opcoes(c: ContaMedicoExterno) {
  const vistos = new Map<number, string>();
  for (const s of [...c.sugestoes, ...(achados.value[c.acesso] ?? [])]) vistos.set(s.id, s.nome);
  return [
    { valor: '', rotulo: t('portalMedico.pedido.escolha') },
    ...[...vistos].map(([id, nome]) => ({ valor: String(id), rotulo: nome })),
  ];
}
async function buscar(c: ContaMedicoExterno): Promise<void> {
  const q = (termo.value[c.acesso] ?? '').trim();
  achados.value = {
    ...achados.value,
    [c.acesso]: q.length >= 3 ? await buscarProfissionaisCorpoClinico(q) : [],
  };
}
async function rodar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'contas'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pmi-titulo" data-testid="tela-portal-medico-interno">
    <h1 id="pmi-titulo">{{ t('portalMedico.interno.titulo') }}</h1>
    <p>{{ t('portalMedico.interno.ajuda') }}</p>
    <p>
      {{ t('portalMedico.interno.endereco') }}: <code data-testid="pmi-endereco">{{ endereco }}</code>
    </p>
    <p class="acoes">
      <RouterLink to="/sadt/solicitantes/autocadastro">{{
        t('portalMedico.interno.autocadastro')
      }}</RouterLink>
      <RouterLink to="/cirurgia/mapa">{{ t('portalMedico.interno.mapa') }}</RouterLink>
    </p>
    <ErroPortalMedico v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
    <template v-else>
      <p v-if="!lista.data.value.liberado" role="note" data-testid="pmi-desligado">
        {{ t('portalMedico.interno.desligado') }}
      </p>
      <form class="filtros" role="search" data-testid="pmi-filtro" @submit.prevent="filtrar">
        <span class="campo">
          <label for="pmi-filtro-texto">{{ t('portalMedico.interno.filtro') }}</label>
          <input
            id="pmi-filtro-texto"
            v-model="fTexto"
            type="search"
            autocomplete="off"
            maxlength="60"
            data-testid="pmi-filtro-texto"
          />
        </span>
        <SanteSelecao
          v-model="fSituacao"
          :rotulo="t('portalMedico.interno.situacao')"
          :opcoes="situacoes"
          data-testid="pmi-filtro-situacao"
        />
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('portalMedico.interno.filtrar')" />
      </form>
      <p class="secundario" data-testid="pmi-total">
        {{
          t('portalMedico.interno.total', {
            n: lista.data.value.total,
            pagina: lista.data.value.pagina,
            paginas,
          })
        }}
      </p>
      <p v-if="lista.data.value.contas.length === 0">
        {{
          filtro.q || filtro.situacao !== 'todas'
            ? t('portalMedico.interno.nenhumaNoFiltro')
            : t('portalMedico.interno.nenhuma')
        }}
      </p>
      <div
        v-for="c in lista.data.value.contas"
        :key="c.acesso"
        class="painel"
        :data-testid="`pmi-conta-${c.numero}`"
      >
        <h2>{{ c.nome }}</h2>
        <p>{{ t('portalMedico.interno.conselho') }}: {{ c.conselho }} {{ c.numero }}/{{ c.uf }}</p>
        <ContaMedicoAtos :conta="c" :pode-gerir="podeGerir" @feito="aposAto" />
        <p
          v-if="c.codigosCompartilhados.length"
          role="note"
          class="alerta"
          :data-testid="`pmi-compartilhados-${c.numero}`"
        >
          {{ t('portalMedico.interno.compartilhados', { codigos: c.codigosCompartilhados.join(', ') }) }}
        </p>
        <p v-if="c.profissional" class="acoes" :data-testid="`pmi-ligado-${c.numero}`">
          {{ t('portalMedico.interno.profissional') }}: <strong>{{ c.profissional.nome }}</strong>
          <span v-if="c.vinculadoPor" class="secundario">
            ·
            {{
              t('portalMedico.interno.ligadoPor', { quem: c.vinculadoPor, quando: quando(c.vinculadoEm) })
            }}</span
          >
          <SanteBotao
            v-if="podeVincular"
            variante="destrutivo"
            :rotulo="t('portalMedico.interno.desligar')"
            :confirmacao="t('portalMedico.interno.desligarPergunta', { nome: c.nome })"
            :desabilitado="ocupado"
            :data-testid="`pmi-desligar-${c.numero}`"
            @acionar="rodar(() => desvincularMedicoExterno(c.acesso))"
          />
        </p>
        <template v-else>
          <p class="secundario">
            {{ t('portalMedico.interno.profissional') }}: {{ t('portalMedico.interno.semProfissional') }}
          </p>
          <div v-if="podeVincular" class="filtros">
            <SanteSelecao
              :model-value="escolhido[c.acesso] ?? ''"
              :rotulo="t('portalMedico.interno.sugestao')"
              :opcoes="opcoes(c)"
              :data-testid="`pmi-profissional-${c.numero}`"
              @update:model-value="(v: string) => (escolhido[c.acesso] = v)"
            />
            <SanteBotao
              :rotulo="t('portalMedico.interno.ligar')"
              :desabilitado="ocupado || !escolhido[c.acesso]"
              :data-testid="`pmi-ligar-${c.numero}`"
              @acionar="rodar(() => vincularMedicoExterno(c.acesso, Number(escolhido[c.acesso])))"
            />
          </div>
          <form v-if="podeVincular" class="filtros" role="search" @submit.prevent="buscar(c)">
            <span class="campo">
              <label :for="`pmi-termo-${c.acesso}`">{{ t('portalMedico.interno.buscar') }}</label>
              <input
                :id="`pmi-termo-${c.acesso}`"
                v-model="termo[c.acesso]"
                type="search"
                autocomplete="off"
                :data-testid="`pmi-termo-${c.numero}`"
              />
            </span>
            <SanteBotao tipo="submit" variante="secundario" :rotulo="t('portalMedico.interno.buscarBotao')" />
          </form>
        </template>
        <h3>
          {{ t('portalMedico.interno.pedidosAbertos') }}:
          <span :data-testid="`pmi-pedidos-${c.numero}`">{{ c.pedidosAbertos }}</span>
        </h3>
        <table v-if="c.pedidos.length" class="tabela" :data-testid="`pmi-lista-pedidos-${c.numero}`">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.interno.pedidoData') }}</th>
              <th scope="col">{{ t('portalMedico.interno.pedidoSala') }}</th>
              <th scope="col">{{ t('portalMedico.interno.pedidoProcedimento') }}</th>
              <th scope="col">{{ t('portalMedico.interno.pedidoPaciente') }}</th>
              <th scope="col">{{ t('portalMedico.interno.pedidoAcoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in c.pedidos" :key="p.id">
              <td>{{ dataBr(p.data) }} {{ p.hora }}</td>
              <td>{{ p.sala }}</td>
              <td>{{ p.procedimento }}</td>
              <td>{{ p.paciente }}</td>
              <td class="acoes">
                <RouterLink :to="`/cirurgia/solicitacoes/${p.id}`" :data-testid="`pmi-pedido-${p.id}`">{{
                  t('portalMedico.interno.pedidoAbrir')
                }}</RouterLink>
                <RouterLink :to="{ path: '/cirurgia/mapa', query: { inicio: p.data } }">{{
                  t('portalMedico.interno.pedidoMapa')
                }}</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="secundario">{{ t('portalMedico.interno.semPedidos') }}</p>
      </div>
      <p v-if="paginas > 1" class="acoes" data-testid="pmi-paginas">
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.interno.anterior')"
          :desabilitado="lista.data.value.pagina <= 1"
          @acionar="irPara(lista.data.value.pagina - 1)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.interno.proxima')"
          :desabilitado="lista.data.value.pagina >= paginas"
          @acionar="irPara(lista.data.value.pagina + 1)"
        />
      </p>
    </template>
    <p v-if="mensagem" role="status" data-testid="pmi-mensagem">{{ mensagem }}</p>
    <ErroPortalMedico v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
