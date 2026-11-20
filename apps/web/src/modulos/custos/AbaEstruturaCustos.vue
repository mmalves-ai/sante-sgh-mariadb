<script setup lang="ts">
// Aba Estrutura (M54, etapa 4): os centros de custo com a classe (ou a sugestão do cadastro), a ordem, o critério e a
// unidade de mensuração; a contagem por classe com o total; as pendências que bloqueiam a apuração; a sequência do
// rateio; e a classificação de um centro (classe, ordem, critério com busca, unidade com busca, observação), gravada
// com a versão lida. Só com `custos.centro.editar` e a liberação (o apoio diz); o servidor confere de novo.
import {
  type ApoioCustos,
  type CentroCustoEstrutura,
  type ClasseCentroCusto,
  esquemaClassificarCentro,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { classificarCentro, lerEstruturaCustos } from './api-custos.js';
import { type FiltroClasse, filtrarCentros } from './comum-custos.js';
import ErroCustos from './ErroCustos.vue';

const props = defineProps<{ apoio: ApoioCustos }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['custos', 'centros'], queryFn: lerEstruturaCustos });
const dados = computed(() => lista.data.value ?? null);

const rotuloClasse = (c: ClasseCentroCusto) => props.apoio.classes.find((x) => x.valor === c)?.rotulo ?? c;
const rotuloCriterio = (c: string | null) =>
  c === null ? '' : (props.apoio.estatisticas.find((e) => e.codigo === c)?.rotulo ?? c);
const rotuloUnidade = (u: number | null) =>
  u === null ? '' : (props.apoio.unidades.find((x) => x.codigo === u)?.nome ?? String(u));
const porId = computed(() => new Map((dados.value?.centros ?? []).map((c) => [c.id, c])));
const nomeCentro = (id: number) => {
  const c = porId.value.get(id);
  return c ? `${c.codigo} ${c.nome}` : String(id);
};

const filtroClasse = ref<FiltroClasse>('todas');
const termo = ref('');
const opcoesFiltro = computed(() => [
  { valor: 'todas' as FiltroClasse, rotulo: t('custos.estrutura.todas') },
  ...props.apoio.classes.map((c) => ({ valor: c.valor as FiltroClasse, rotulo: c.rotulo })),
  { valor: 'semClasse' as FiltroClasse, rotulo: t('custos.estrutura.semClasse') },
]);
const visiveis = computed(() => filtrarCentros(dados.value?.centros ?? [], filtroClasse.value, termo.value));
const conta = computed(() => {
  const c = dados.value?.contagem;
  return c
    ? t('custos.estrutura.conta', {
        produtivo: c.produtivo,
        auxiliar: c.auxiliar,
        administrativo: c.administrativo,
        semClasse: c.semClasse,
        total: c.total,
      })
    : '';
});

// ── Classificação ───────────────────────────────────────────────────────────────────────────────────────────────
const editando = ref<CentroCustoEstrutura | null>(null);
const classe = ref<ClasseCentroCusto>('produtivo');
const ordem = ref('');
const criterio = ref<string | null>(null);
const unidade = ref<number | null>(null);
const observacao = ref('');
const erro = ref<unknown>(null);
const gravando = ref(false);
const mensagem = ref<string | null>(null);

const opcoesClasse = computed(() => props.apoio.classes.map((c) => ({ valor: c.valor, rotulo: c.rotulo })));
const opcoesCriterio = computed(() => [
  ...props.apoio.estatisticas.map((e) => ({
    valor: e.codigo as string | null,
    rotulo: `${e.rotulo} (${e.unidade})`,
  })),
]);
const opcoesUnidade = computed(() => [
  { valor: null as number | null, rotulo: t('custos.classificar.semUnidade') },
  ...props.apoio.unidades.map((u) => ({ valor: u.codigo as number | null, rotulo: `${u.codigo} ${u.nome}` })),
]);
const produtivo = computed(() => classe.value === 'produtivo');
const ordemNumero = computed(() =>
  /^\d{1,3}$/.test(ordem.value.trim()) ? Number(ordem.value.trim()) : null,
);
const entrada = computed(() =>
  esquemaClassificarCentro.safeParse({
    classe: classe.value,
    ordemRateio: produtivo.value ? null : ordemNumero.value,
    criterio: produtivo.value ? null : criterio.value,
    unidadeMensuracao: unidade.value,
    observacao: observacao.value.trim() || null,
    versao: editando.value?.classificacao?.versao ?? null,
  }),
);
const ordemInvalida = computed(
  () => !produtivo.value && ordem.value.trim() !== '' && ordemNumero.value === null,
);

function abrir(c: CentroCustoEstrutura): void {
  editando.value = c;
  mensagem.value = null;
  erro.value = null;
  const k = c.classificacao;
  classe.value = k?.classe ?? c.sugestao ?? 'administrativo';
  ordem.value = k?.ordemRateio !== null && k?.ordemRateio !== undefined ? String(k.ordemRateio) : '';
  criterio.value = k?.criterio ?? null;
  unidade.value = k?.unidadeMensuracao ?? null;
  observacao.value = k?.observacao ?? '';
}

async function gravar(): Promise<void> {
  const c = editando.value;
  if (!c || !entrada.value.success) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await classificarCentro(c.id, entrada.value.data);
    const nome = `${c.codigo} ${c.nome}`;
    mensagem.value = r.mudou
      ? t('custos.classificar.gravado', { centro: nome })
      : t('custos.classificar.semMudanca', { centro: nome });
    editando.value = null;
    await cliente.invalidateQueries({ queryKey: ['custos', 'centros'] });
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="custos-estrutura-titulo" data-testid="custos-estrutura">
    <h2 id="custos-estrutura-titulo">{{ t('custos.estrutura.titulo') }}</h2>
    <ErroCustos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados" role="status">{{ t('custos.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="custos-gravado" />
      <p data-testid="custos-contagem">
        <strong>{{ t('custos.estrutura.contagem') }}:</strong> {{ conta }}
      </p>

      <section class="bloco" aria-labelledby="custos-pend-titulo" data-testid="custos-pendencias">
        <h3 id="custos-pend-titulo">{{ t('custos.estrutura.pendencias') }}</h3>
        <p v-if="dados.pendencias.length === 0" data-testid="custos-sem-pendencias">
          {{ t('custos.estrutura.semPendencias') }}
        </p>
        <ul v-else class="lista">
          <li v-for="p in dados.pendencias" :key="p.tipo" :data-testid="`custos-pendencia-${p.tipo}`">
            <span class="marca">{{
              p.bloqueia ? t('custos.estrutura.bloqueia') : t('custos.estrutura.naoBloqueia')
            }}</span>
            {{ p.mensagem }}
            <span v-if="p.centros.length" class="secundario">
              {{ t('custos.estrutura.centrosDaPendencia', { lista: p.centros.map(nomeCentro).join('; ') }) }}
            </span>
          </li>
        </ul>
      </section>

      <form
        v-if="editando"
        class="bloco"
        :aria-label="t('custos.classificar.titulo', { centro: `${editando.codigo} ${editando.nome}` })"
        data-testid="custos-classificar"
        @submit.prevent="gravar"
      >
        <h3>{{ t('custos.classificar.titulo', { centro: `${editando.codigo} ${editando.nome}` }) }}</h3>
        <div class="campos">
          <SanteSelecao
            v-model="classe"
            :rotulo="t('custos.classificar.classe')"
            :opcoes="opcoesClasse"
            obrigatorio
            data-testid="custos-classe"
          />
          <template v-if="!produtivo">
            <label class="campo-numero">
              <span>{{ t('custos.classificar.ordem') }}</span>
              <input
                v-model="ordem"
                inputmode="numeric"
                maxlength="3"
                required
                :aria-invalid="ordemInvalida"
                data-testid="custos-ordem"
              />
              <span v-if="ordemInvalida" class="secundario" role="alert">{{
                t('custos.classificar.ordemInvalida')
              }}</span>
            </label>
            <SanteSelecao
              v-model="criterio"
              :rotulo="t('custos.classificar.criterio')"
              :opcoes="opcoesCriterio"
              busca
              obrigatorio
              data-testid="custos-criterio"
            />
          </template>
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('custos.classificar.unidade')"
            :opcoes="opcoesUnidade"
            busca
            data-testid="custos-unidade"
          />
        </div>
        <p v-if="produtivo" class="secundario">{{ t('custos.classificar.produtivoAjuda') }}</p>
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('custos.classificar.observacao')"
          :max-bytes="400"
          data-testid="custos-observacao"
        />
        <ErroCustos v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('custos.classificar.cancelar')"
            variante="texto"
            @acionar="editando = null"
          />
          <SanteBotao
            :rotulo="t('custos.classificar.gravar')"
            tipo="submit"
            :desabilitado="!entrada.success || gravando"
            data-testid="custos-gravar-classificacao"
          />
        </div>
      </form>

      <div class="campos" data-testid="custos-filtros">
        <SanteSelecao
          v-model="filtroClasse"
          :rotulo="t('custos.estrutura.filtroClasse')"
          :opcoes="opcoesFiltro"
          data-testid="custos-filtro-classe"
        />
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('custos.estrutura.filtroTermo')"
          :max-bytes="60"
          data-testid="custos-filtro-termo"
        />
      </div>
      <p v-if="visiveis.length === 0" role="status" data-testid="custos-nenhum">
        {{ t('custos.estrutura.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="custos-centros">
        <thead>
          <tr>
            <th scope="col">{{ t('custos.estrutura.colunas.codigo') }}</th>
            <th scope="col">{{ t('custos.estrutura.colunas.nome') }}</th>
            <th scope="col">{{ t('custos.estrutura.colunas.classe') }}</th>
            <th scope="col">{{ t('custos.estrutura.colunas.ordem') }}</th>
            <th scope="col">{{ t('custos.estrutura.colunas.criterio') }}</th>
            <th scope="col">{{ t('custos.estrutura.colunas.unidade') }}</th>
            <th v-if="apoio.acoes.editar" scope="col">{{ t('custos.estrutura.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in visiveis" :key="c.id" :data-testid="`custos-centro-${c.codigo}`">
            <td class="numero">{{ c.codigo }}</td>
            <td>
              {{ c.nome }}
              <span v-if="c.sigla" class="secundario">({{ c.sigla }})</span>
              <span v-if="!c.ativo" class="marca">{{ t('custos.estrutura.inativo') }}</span>
            </td>
            <td>
              <template v-if="c.classificacao">{{ rotuloClasse(c.classificacao.classe) }}</template>
              <span v-else class="secundario" data-testid="custos-sugestao">{{
                c.sugestao
                  ? t('custos.estrutura.sugerida', { classe: rotuloClasse(c.sugestao) })
                  : t('custos.estrutura.semSugestao')
              }}</span>
            </td>
            <td class="numero">
              <template v-if="c.classificacao?.classe === 'produtivo'">
                <span class="secundario">{{ t('custos.estrutura.produtivoNaoRateia') }}</span>
              </template>
              <template v-else>{{ c.classificacao?.ordemRateio ?? '' }}</template>
            </td>
            <td>{{ rotuloCriterio(c.classificacao?.criterio ?? null) }}</td>
            <td>{{ rotuloUnidade(c.classificacao?.unidadeMensuracao ?? null) }}</td>
            <td v-if="apoio.acoes.editar">
              <SanteBotao
                :rotulo="
                  c.classificacao ? t('custos.estrutura.reclassificar') : t('custos.estrutura.classificar')
                "
                variante="secundario"
                :data-testid="`custos-classificar-${c.codigo}`"
                @acionar="abrir(c)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <section class="bloco" aria-labelledby="custos-seq-titulo" data-testid="custos-sequencia">
        <h3 id="custos-seq-titulo">{{ t('custos.estrutura.sequencia') }}</h3>
        <p class="secundario">{{ t('custos.estrutura.sequenciaAjuda') }}</p>
        <p v-if="dados.sequencia.length === 0">{{ t('custos.estrutura.semSequencia') }}</p>
        <ol v-else>
          <li v-for="s in dados.sequencia" :key="s.id">
            {{
              t('custos.estrutura.passo', {
                ordem: s.ordem,
                centro: nomeCentro(s.id),
                criterio: rotuloCriterio(s.criterio),
              })
            }}
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
