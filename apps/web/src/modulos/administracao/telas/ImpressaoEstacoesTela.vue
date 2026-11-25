<script setup lang="ts">
// Impressoras por estação (01-ADM L79): `/administracao/impressao/estacoes`. Uma tela só para dizer por onde cada
// impresso sai: a estação (a tela já abre na estação reconhecida pelo endereço) vê, por finalidade, a impressora que
// vai usar e de onde ela vem (preferência do usuário, estação, unidade ou estabelecimento); o vínculo da estação e o
// padrão do estabelecimento ou da unidade são gravados aqui, sem apagar o que havia. Só impressora ativa é oferecida
// e o botão só libera com tudo escolhido (conferência na hora).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  definirPadraoImpressora,
  lerCatalogoImpressao,
  vincularEstacaoImpressora,
} from '../api-impressao.js';

const { t } = useI18n({
  useScope: 'local',
  inheritLocale: true,
  messages: {
    'pt-BR': {
      titulo: 'Impressoras por estação',
      texto:
        'Por onde sai cada impresso. A estação usa a impressora vinculada a ela; sem vínculo, vale o padrão da unidade e depois o do estabelecimento. Quem imprime não escolhe impressora.',
      carregando: 'Carregando…',
      indisponivel: 'A impressão por estação não está disponível neste ambiente.',
      estacao: 'Estação de trabalho',
      escolha: 'Escolha',
      estaEstacao: '(esta estação)',
      resolucao: 'Impressora de cada finalidade nesta estação',
      finalidade: 'Finalidade',
      impressora: 'Impressora',
      origem: 'De onde vem',
      nenhuma: 'Nenhuma configurada',
      niveis: {
        usuario: 'Preferência do meu usuário',
        estacao: 'Vínculo da estação',
        unidade: 'Padrão da unidade',
        estabelecimento: 'Padrão do estabelecimento',
      },
      vincular: 'Vincular impressora à estação',
      soParaMim: 'Só para o meu usuário nesta estação',
      gravarVinculo: 'Gravar o vínculo',
      padrao: 'Padrão do estabelecimento e da unidade',
      unidade: 'Unidade',
      todas: 'Todo o estabelecimento',
      copias: 'Cópias',
      gravarPadrao: 'Gravar o padrão',
      gravado: 'Gravado.',
      escopo: 'Vale para',
    },
  },
});
const catalogo = useQuery({
  queryKey: ['impressao', 'catalogo'],
  queryFn: lerCatalogoImpressao,
  retry: false,
});
const podeEditar = computed(() => pode('documento.cadastro.editar'));
const estacao = ref('');
watch(
  () => catalogo.data.value?.estacaoAtual,
  (a) => {
    if (a && !estacao.value) estacao.value = String(a);
  },
  { immediate: true },
);
const c = computed(() => catalogo.data.value ?? null);
const nomeImpressora = (id: number) => c.value?.impressoras.find((i) => i.id === id)?.nome ?? String(id);
const ativa = (id: number) => c.value?.impressoras.find((i) => i.id === id)?.ativa ?? false;
/** A mesma ordem do servidor: usuário na estação, estação, unidade, estabelecimento (impressora inativa não conta). */
const resolucao = computed(() => {
  const x = c.value;
  if (!x) return [];
  const e = x.estacoes.find((y) => String(y.id) === estacao.value) ?? null;
  return x.finalidades.map((f) => {
    const vs = x.vinculos
      .filter((v) => e && v.estacao === e.id && v.finalidade === f.id && ativa(v.impressora))
      .sort((a, b) => Number(b.padrao) - Number(a.padrao));
    const ps = x.padroes.filter((p) => p.finalidade === f.id && p.ativo && ativa(p.impressora));
    const meu = vs.find((v) => v.usuario !== null && v.usuario === x.eu);
    const daEstacao = vs.find((v) => v.usuario === null);
    const daUnidade = e?.unidade ? ps.find((p) => p.unidade === e.unidade) : undefined;
    const geral = ps.find((p) => p.unidade === null);
    const r = meu
      ? { impressora: meu.impressora, nivel: 'usuario' }
      : daEstacao
        ? { impressora: daEstacao.impressora, nivel: 'estacao' }
        : daUnidade
          ? { impressora: daUnidade.impressora, nivel: 'unidade' }
          : geral
            ? { impressora: geral.impressora, nivel: 'estabelecimento' }
            : null;
    return { finalidade: f, resolvida: r };
  });
});
const opFinalidades = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(c.value?.finalidades ?? []).map((f) => ({ valor: String(f.id), rotulo: f.descricao })),
]);
const opImpressoras = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(c.value?.impressoras ?? [])
    .filter((i) => i.ativa)
    .map((i) => ({ valor: String(i.id), rotulo: i.nome })),
]);
const vinculo = ref({ finalidade: '', impressora: '', soParaMim: false });
const padrao = ref({ finalidade: '', impressora: '', unidade: '', copias: '1' });
const vinculoPronto = computed(
  () => !!estacao.value && !!vinculo.value.finalidade && !!vinculo.value.impressora,
);
const padraoPronto = computed(() => !!padrao.value.finalidade && !!padrao.value.impressora);
const erro = ref<string | null>(null);
const gravado = ref(false);
const ocupado = ref(false);
async function gravar(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  gravado.value = false;
  ocupado.value = true;
  try {
    await fn();
    gravado.value = true;
    await catalogo.refetch();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  } finally {
    ocupado.value = false;
  }
}
const gravarVinculo = () =>
  gravar(() =>
    vincularEstacaoImpressora({
      estacao: Number(estacao.value),
      finalidade: Number(vinculo.value.finalidade),
      impressora: Number(vinculo.value.impressora),
      ...(vinculo.value.soParaMim && c.value?.eu ? { usuario: c.value.eu } : {}),
    }),
  );
const gravarPadrao = () =>
  gravar(() =>
    definirPadraoImpressora({
      finalidade: Number(padrao.value.finalidade),
      impressora: Number(padrao.value.impressora),
      ...(padrao.value.unidade ? { unidade: Number(padrao.value.unidade) } : {}),
      copias: Number(padrao.value.copias),
    }),
  );
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="impressao-estacoes-titulo"
    data-testid="tela-impressao-estacoes"
  >
    <h1 id="impressao-estacoes-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <SanteAlerta
      v-if="catalogo.isError.value"
      variante="alerta"
      :texto="t('indisponivel')"
      data-testid="impressao-indisponivel"
    />
    <p v-else-if="!c" role="status">{{ t('carregando') }}</p>
    <template v-else>
      <SanteSelecao
        v-model="estacao"
        :rotulo="t('estacao')"
        :opcoes="[
          { valor: '', rotulo: t('escolha') },
          ...c.estacoes.map((e) => ({
            valor: String(e.id),
            rotulo: e.id === c?.estacaoAtual ? `${e.nome} ${t('estaEstacao')}` : e.nome,
          })),
        ]"
        data-testid="impressao-estacao"
      />
      <table class="tabela" data-testid="impressao-resolucao">
        <caption>
          {{
            t('resolucao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('finalidade') }}</th>
            <th scope="col">{{ t('impressora') }}</th>
            <th scope="col">{{ t('origem') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in resolucao"
            :key="r.finalidade.id"
            :data-testid="`impressao-finalidade-${r.finalidade.id}`"
          >
            <td>{{ r.finalidade.descricao }}</td>
            <td>{{ r.resolvida ? nomeImpressora(r.resolvida.impressora) : t('nenhuma') }}</td>
            <td>{{ r.resolvida ? t(`niveis.${r.resolvida.nivel}`) : '' }}</td>
          </tr>
        </tbody>
      </table>
      <template v-if="podeEditar">
        <section class="painel" aria-labelledby="impressao-vincular">
          <h2 id="impressao-vincular">{{ t('vincular') }}</h2>
          <div class="acoes">
            <SanteSelecao
              v-model="vinculo.finalidade"
              :rotulo="t('finalidade')"
              :opcoes="opFinalidades"
              data-testid="vinculo-finalidade"
            />
            <SanteSelecao
              v-model="vinculo.impressora"
              :rotulo="t('impressora')"
              :opcoes="opImpressoras"
              data-testid="vinculo-impressora"
            />
            <label>
              <input v-model="vinculo.soParaMim" type="checkbox" data-testid="vinculo-so-para-mim" />
              {{ t('soParaMim') }}
            </label>
            <SanteBotao
              :rotulo="t('gravarVinculo')"
              :desabilitado="ocupado || !vinculoPronto"
              data-testid="vinculo-gravar"
              @acionar="gravarVinculo"
            />
          </div>
        </section>
        <section class="painel" aria-labelledby="impressao-padrao">
          <h2 id="impressao-padrao">{{ t('padrao') }}</h2>
          <div class="acoes">
            <SanteSelecao
              v-model="padrao.finalidade"
              :rotulo="t('finalidade')"
              :opcoes="opFinalidades"
              data-testid="padrao-finalidade"
            />
            <SanteSelecao
              v-model="padrao.unidade"
              :rotulo="t('unidade')"
              :opcoes="[
                { valor: '', rotulo: t('todas') },
                ...c.unidades.map((u) => ({ valor: String(u.id), rotulo: u.nome })),
              ]"
              data-testid="padrao-unidade"
            />
            <SanteSelecao
              v-model="padrao.impressora"
              :rotulo="t('impressora')"
              :opcoes="opImpressoras"
              data-testid="padrao-impressora"
            />
            <SanteSelecao
              v-model="padrao.copias"
              :rotulo="t('copias')"
              :opcoes="[1, 2, 3, 4, 5].map((n) => ({ valor: String(n), rotulo: String(n) }))"
              data-testid="padrao-copias"
            />
            <SanteBotao
              :rotulo="t('gravarPadrao')"
              :desabilitado="ocupado || !padraoPronto"
              data-testid="padrao-gravar"
              @acionar="gravarPadrao"
            />
          </div>
        </section>
      </template>
      <table class="tabela" data-testid="impressao-padroes">
        <caption>
          {{
            t('padrao')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('finalidade') }}</th>
            <th scope="col">{{ t('escopo') }}</th>
            <th scope="col">{{ t('impressora') }}</th>
            <th scope="col">{{ t('copias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in c.padroes.filter((x) => x.ativo)" :key="p.id">
            <td>{{ c.finalidades.find((f) => f.id === p.finalidade)?.descricao ?? p.finalidade }}</td>
            <td>
              {{ p.unidade ? (c.unidades.find((u) => u.id === p.unidade)?.nome ?? p.unidade) : t('todas') }}
            </td>
            <td>{{ nomeImpressora(p.impressora) }}</td>
            <td>{{ p.copias }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="gravado" role="status" data-testid="impressao-gravado">{{ t('gravado') }}</p>
      <SanteAlerta v-if="erro" variante="alerta" :texto="erro" data-testid="impressao-erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
