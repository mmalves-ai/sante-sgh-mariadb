<script setup lang="ts">
// W0-04: as sessões de observação de higiene das mãos da competência, inclusive as estornadas (visíveis como inativas
// e fora da adesão). Corrigir a sessão (instante, categoria, oportunidades e observação) gera nova versão com
// justificativa; estornar é crítica (motivo e senha). O histórico mostra as versões anteriores.
import {
  ACOES_HIGIENE_MAOS,
  CATEGORIAS_OBSERVADAS,
  type CategoriaObservada,
  type MomentoHigieneMaos,
  MOMENTOS_HIGIENE_MAOS,
  rotuloMomentoHigiene,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  corrigirObservacaoMaos,
  estornarObservacaoMaos,
  lerSessoesMaos,
  novaChaveCorrecao,
  type SessaoMaosTela,
} from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import { instanteLocal, type OportunidadeTela } from '../regras-ccih.js';
import ErroCcih from './ErroCcih.vue';

const props = defineProps<{ competencia: string; podeRegistrar: boolean }>();
const emit = defineEmits<{ alterado: [texto: string] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const cliente = useQueryClient();

const q = useQuery({
  queryKey: computed(() => ['ccih', 'maos', 'sessoes', props.competencia]),
  queryFn: () => lerSessoesMaos(props.competencia),
  enabled: computed(() => !!props.competencia),
});
const rotuloCategoria = (c: string) => CATEGORIAS_OBSERVADAS.find((x) => x.codigo === c)?.rotulo ?? c;
const opCategoria = CATEGORIAS_OBSERVADAS.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }));
const opMomento = MOMENTOS_HIGIENE_MAOS.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo }));
const opAcao = ACOES_HIGIENE_MAOS.map((a) => ({ valor: a.codigo as string, rotulo: a.rotulo }));

const visivel = ref(false);
const corrigindo = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
const f = reactive({
  data: null as string | null,
  hora: null as string | null,
  categoria: '',
  observacao: '',
  oportunidades: [] as OportunidadeTela[],
});
const valido = computed(
  () => !corrigindo.value || (!!instanteLocal(f.data, f.hora) && !!f.categoria && f.oportunidades.length > 0),
);

function corrigir(x: SessaoMaosTela): void {
  Object.assign(f, {
    data: x.observadoEm.slice(0, 10),
    hora: x.observadoEm.slice(11, 16),
    categoria: x.categoria,
    observacao: x.observacao ?? '',
    oportunidades: x.detalhe.map((o) => ({
      momento: o.momento as MomentoHigieneMaos,
      acao: o.acao as OportunidadeTela['acao'],
      luvas: o.luvas,
    })),
  });
  corrigindo.value = true;
  pedido.value = {
    titulo: T('maos.corrigirTitulo'),
    critica: false,
    confirmar: T('maos.confirmarCorrecao'),
    gravar: ({ justificativa, senha }) =>
      corrigirObservacaoMaos(
        x.id,
        {
          versao: x.versao,
          observadoEm: instanteLocal(f.data, f.hora) ?? '',
          categoria: f.categoria as CategoriaObservada,
          oportunidades: f.oportunidades.map((o) => ({ ...o })),
          observacao: f.observacao.trim() || null,
          justificativa,
          ...(senha ? { senha } : {}),
        },
        novaChaveCorrecao('maos'),
      ),
  };
  visivel.value = true;
}
function estornar(x: SessaoMaosTela): void {
  corrigindo.value = false;
  pedido.value = {
    titulo: T('maos.estornarTitulo'),
    texto: T('maos.estornarTexto'),
    critica: true,
    confirmar: T('maos.confirmarEstorno'),
    gravar: (m) => estornarObservacaoMaos(x.id, x.versao, m, novaChaveCorrecao('estorno-maos')),
  };
  visivel.value = true;
}
async function feito(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['ccih', 'maos'] });
  emit('alterado', corrigindo.value ? T('gravado') : T('estornado'));
}
</script>

<template>
  <section class="painel-ccih" data-testid="maos-sessoes">
    <h2>{{ T('maos.titulo') }}</h2>
    <p class="secundario">{{ T('maos.explicacao') }}</p>
    <ErroCcih v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('ccih.carregando') }}</p>
    <p v-else-if="!q.data.value.itens.length" data-testid="maos-sessoes-nenhuma">{{ T('maos.nenhuma') }}</p>
    <ul v-else class="lista-ccih" data-testid="lista-sessoes-maos">
      <li
        v-for="x in q.data.value.itens"
        :key="x.id"
        :class="{ secundario: !!x.estornadoEm }"
        :data-testid="`sessao-maos-${x.id}`"
      >
        <strong>{{ dataHora(x.observadoEm) }}</strong> · {{ rotuloCategoria(x.categoria) }}
        <span v-if="x.setor">· {{ x.setor }}</span> ·
        {{ T('maos.conformes', { c: x.conformes, o: x.oportunidades }) }}
        <template v-if="x.estornadoEm">
          <span class="selo" :data-testid="`sessao-inativa-${x.id}`">{{ T('inativo') }}</span>
          {{ T('estornada', { em: dataHora(x.estornadoEm), motivo: x.motivoEstorno ?? '' }) }}
        </template>
        <template v-else-if="podeRegistrar">
          <SanteBotao
            :rotulo="T('corrigir')"
            variante="texto"
            :data-testid="`corrigir-sessao-${x.id}`"
            @acionar="corrigir(x)"
          />
          <SanteBotao
            :rotulo="T('estornar')"
            variante="texto"
            :data-testid="`estornar-sessao-${x.id}`"
            @acionar="estornar(x)"
          />
        </template>
        <HistoricoVersoes registro="observacao-maos" :id="x.id" />
      </li>
    </ul>
    <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" :valido="valido" @feito="feito">
      <div v-if="corrigindo" class="campos-correcao" data-testid="correcao-sessao">
        <SanteData v-model="f.data" :rotulo="t('ccih.maos.observadoEm')" editavel />
        <SanteHora v-model="f.hora" :rotulo="t('ccih.maos.horaObservacao')" editavel />
        <SanteSelecao
          v-model="f.categoria"
          :rotulo="t('ccih.maos.categoria')"
          :opcoes="opCategoria"
          obrigatorio
          data-testid="correcao-sessao-categoria"
        />
        <fieldset v-for="(o, k) in f.oportunidades" :key="k" class="oportunidade">
          <legend>{{ T('maos.oportunidade', { n: k + 1 }) }} · {{ rotuloMomentoHigiene(o.momento) }}</legend>
          <SanteSelecao v-model="o.momento" :rotulo="T('maos.momento')" :opcoes="opMomento" />
          <SanteSelecao
            v-model="o.acao"
            :rotulo="T('maos.acao')"
            :opcoes="opAcao"
            :data-testid="`correcao-sessao-acao-${k}`"
          />
          <label class="marca"><input v-model="o.luvas" type="checkbox" /> {{ T('maos.luvas') }}</label>
        </fieldset>
        <SanteCampoTexto v-model="f.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
      </div>
    </DialogoCorrecao>
  </section>
</template>

<style scoped>
.campos-correcao {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.oportunidade {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
</style>
