<script setup lang="ts">
// Cobrança e mensalidades (M56, etapa 3, F2; item `Faturamento > Operadora própria > Cobrança e mensalidades`;
// `operadora.cobranca.ler`): as cobranças com a ficha, o pagamento, o cancelamento e o estorno; a geração das
// mensalidades da competência; a coparticipação e a cobrança avulsa; o acordo; o reajuste anual; e a inadimplência com
// a notificação. Com a parte desligada (regra 1), a tela mostra o motivo e o que falta; os domínios do item seguem
// embutidos (tipos de cobrança e de e-mail da cobrança).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerTelaCobranca } from '../api-cobranca.js';
import AcordoOperadora from '../componentes/f2/AcordoOperadora.vue';
import CobrancasOperadora from '../componentes/f2/CobrancasOperadora.vue';
import InadimplenciaOperadora from '../componentes/f2/InadimplenciaOperadora.vue';
import LancamentosOperadora from '../componentes/f2/LancamentosOperadora.vue';
import MensalidadesOperadora from '../componentes/f2/MensalidadesOperadora.vue';
import ReajustesOperadora from '../componentes/f2/ReajustesOperadora.vue';
import SituacaoOperadora from '../componentes/SituacaoOperadora.vue';

const ITEM = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.cobranca-e-mensalidades';
const ABAS = ['cobrancas', 'mensalidades', 'lancamentos', 'acordo', 'reajustes', 'inadimplencia'] as const;
type Aba = (typeof ABAS)[number];

const { t } = useI18n();
const tela = useQuery({ queryKey: ['operadora', 'cobranca', 'tela'], queryFn: () => lerTelaCobranca() });
const d = computed(() => tela.data.value ?? null);
const operadora = ref<number | null>(null);
watch(
  d,
  (v) => {
    if (!v) return;
    if (operadora.value === null || !v.operadoras.some((o) => o.id === operadora.value))
      operadora.value = v.operadoras[0]?.id ?? null;
  },
  { immediate: true },
);
const opcoesOperadora = computed(() =>
  (d.value?.operadoras ?? []).map((o) => ({ valor: o.id, rotulo: `${o.razaoSocial} (${o.registroAns})` })),
);
const aba = ref<Aba>('cobrancas');
const visiveis = computed(() =>
  ABAS.filter((a) => d.value?.acoes.gerar || ['cobrancas', 'reajustes', 'inadimplencia'].includes(a)),
);
</script>

<template>
  <section
    class="tela-operadora"
    aria-labelledby="ope-cobranca-tela-titulo"
    data-testid="tela-operadora-cobranca"
  >
    <h1 id="ope-cobranca-tela-titulo">{{ t('operadoraCobranca.titulo') }}</h1>
    <p>{{ t('operadoraCobranca.texto') }}</p>
    <p>
      <RouterLink to="/operadora/contas" data-testid="link-contas-medicas">{{
        t('operadoraContas.atalho')
      }}</RouterLink>
    </p>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!d" role="status">{{ t('operadoraCobranca.carregando') }}</p>
    <template v-else-if="!d.liberacao.ligada">
      <SanteAlerta
        :texto="d.liberacao.motivo ?? t('operadoraCobranca.desligada')"
        variante="info"
        data-testid="operadora-fatia-desligada"
      />
      <SituacaoOperadora />
    </template>
    <template v-else>
      <SanteAlerta :texto="t('operadora.modulo.empresaDistinta')" variante="info" />
      <SanteAlerta
        v-if="!d.acoes.gerar"
        :texto="t('operadoraCobranca.soConsulta')"
        variante="info"
        data-testid="cobranca-so-consulta"
      />
      <SanteAlerta :texto="t('operadoraCobranca.baixaManual')" variante="info" />
      <div v-if="opcoesOperadora.length > 1" class="campos">
        <SanteSelecao
          v-model="operadora"
          :rotulo="t('operadoraCobranca.operadora')"
          :opcoes="opcoesOperadora"
          data-testid="cobranca-operadora"
        />
      </div>
      <SanteAlerta v-if="operadora === null" :texto="t('operadoraCobranca.semOperadora')" variante="aviso" />
      <template v-else>
        <nav class="acoes" :aria-label="t('operadoraCobranca.titulo')">
          <SanteBotao
            v-for="a in visiveis"
            :key="a"
            :rotulo="t(`operadoraCobranca.abas.${a}`)"
            :variante="aba === a ? 'primario' : 'texto'"
            :aria-pressed="aba === a"
            :data-testid="`aba-cobranca-${a}`"
            @acionar="aba = a"
          />
        </nav>
        <CobrancasOperadora
          v-if="aba === 'cobrancas'"
          :key="`c${operadora}`"
          :tela="d"
          :operadora="operadora"
        />
        <MensalidadesOperadora
          v-else-if="aba === 'mensalidades'"
          :key="`m${operadora}`"
          :tela="d"
          :operadora="operadora"
        />
        <LancamentosOperadora
          v-else-if="aba === 'lancamentos'"
          :key="`l${operadora}`"
          :tela="d"
          :operadora="operadora"
        />
        <AcordoOperadora
          v-else-if="aba === 'acordo'"
          :key="`a${operadora}`"
          :tela="d"
          :operadora="operadora"
        />
        <ReajustesOperadora
          v-else-if="aba === 'reajustes'"
          :key="`r${operadora}`"
          :tela="d"
          :operadora="operadora"
        />
        <InadimplenciaOperadora v-else :key="`i${operadora}`" :tela="d" :operadora="operadora" />
      </template>
    </template>

    <GrupoDominiosTela subitem="operadoraCobranca" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="operadora-outras-tabelas">{{
        t('operadora.telas.ans.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
