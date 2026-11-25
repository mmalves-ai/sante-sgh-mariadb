<script setup lang="ts">
// Beneficiários, planos e contratos (M56.2, fatia F1; item `Faturamento > Operadora própria > Beneficiários, planos e
// contratos`; `operadora.beneficiario.ler`): a operadora como empresa, os produtos e planos, os contratos, os
// beneficiários (titular, dependentes, carteirinha, segunda via, exclusão) e a elegibilidade. C1-071 (08-SGO L93): a aba
// "Responsáveis, setores e parâmetros" de cada operadora da instalação (o combo Operadora escolhe qual). Com a parte desligada
// (regra 1), a tela mostra a situação e o que falta para ligar; os domínios do item seguem embutidos (CRUD genérico).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerTelaBeneficiarios } from '../api-operadora.js';
import BeneficiariosOperadora from '../componentes/f1/BeneficiariosOperadora.vue';
import ContratosOperadora from '../componentes/f1/ContratosOperadora.vue';
import ElegibilidadeOperadora from '../componentes/f1/ElegibilidadeOperadora.vue';
import EmpresaOperadora from '../componentes/f1/EmpresaOperadora.vue';
import ProdutosOperadora from '../componentes/f1/ProdutosOperadora.vue';
import SituacaoOperadora from '../componentes/SituacaoOperadora.vue';
import AuditoresOperadora from '../componentes/AuditoresOperadora.vue';
import CadastroComplementarOperadora from '../componentes/f1/CadastroComplementarOperadora.vue';
import { pode } from '../../../casca/sessao/pode.js';

const ITEM = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.beneficiarios-planos-e-contratos';
const TODAS_AS_ABAS = [
  'beneficiarios',
  'contratos',
  'produtos',
  'empresa',
  'complementar',
  'elegibilidade',
  'auditores',
] as const;
type Aba = (typeof TODAS_AS_ABAS)[number];
// M56.5 (F4): os auditores designados são da diretoria da operadora (`operadora.auditor.designar`), que não vê as guias.
const ABAS = computed(() =>
  TODAS_AS_ABAS.filter((a) => a !== 'auditores' || pode('operadora.auditor.designar')),
);
const hoje = (() => {
  const x = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
})();

const { t } = useI18n();
const tela = useQuery({
  queryKey: ['operadora', 'beneficiarios', 'tela'],
  queryFn: () => lerTelaBeneficiarios(),
});
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
const aba = ref<Aba>('beneficiarios');
watch(
  () => d.value?.operadoras.length,
  (n) => {
    if (n === 0) aba.value = 'empresa';
  },
);
</script>

<template>
  <section
    class="tela-operadora"
    aria-labelledby="ope-benef-tela-titulo"
    data-testid="tela-operadora-beneficiarios"
  >
    <h1 id="ope-benef-tela-titulo">{{ t('operadora.telas.beneficiarios.titulo') }}</h1>
    <p>{{ t('operadora.telas.beneficiarios.texto') }}</p>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!d" role="status">{{ t('operadora.carregando') }}</p>
    <template v-else-if="!d.liberacao.ligada">
      <SanteAlerta
        :texto="d.liberacao.motivo ?? t('operadora.modulo.fatiaDesligada')"
        variante="info"
        data-testid="operadora-fatia-desligada"
      />
      <SituacaoOperadora />
    </template>
    <template v-else>
      <SanteAlerta :texto="t('operadora.modulo.empresaDistinta')" variante="info" />
      <SanteAlerta
        v-if="!d.acoes.editar"
        :texto="t('operadora.f1.soConsulta')"
        variante="info"
        data-testid="operadora-so-consulta"
      />
      <div v-if="opcoesOperadora.length > 1" class="campos">
        <SanteSelecao
          v-model="operadora"
          :rotulo="t('operadora.f1.operadoraAtiva')"
          :opcoes="opcoesOperadora"
          data-testid="operadora-ativa"
        />
      </div>
      <nav class="acoes" :aria-label="t('operadora.telas.beneficiarios.titulo')">
        <SanteBotao
          v-for="a in ABAS"
          :key="a"
          :rotulo="t(`operadora.f1.abas.${a}`)"
          :variante="aba === a ? 'primario' : 'texto'"
          :aria-pressed="aba === a"
          :data-testid="`aba-${a}`"
          @acionar="aba = a"
        />
      </nav>
      <EmpresaOperadora v-if="aba === 'empresa'" :tela="d" @mudou="tela.refetch()" />
      <template v-else-if="operadora === null">
        <SanteAlerta :texto="t('operadora.f1.semOperadora')" variante="info" />
      </template>
      <ProdutosOperadora
        v-else-if="aba === 'produtos'"
        :tela="d"
        :operadora="operadora"
        @mudou="tela.refetch()"
      />
      <ContratosOperadora
        v-else-if="aba === 'contratos'"
        :tela="d"
        :operadora="operadora"
        @mudou="tela.refetch()"
      />
      <BeneficiariosOperadora v-else-if="aba === 'beneficiarios'" :tela="d" :operadora="operadora" />
      <AuditoresOperadora
        v-else-if="aba === 'auditores'"
        :operadoras="
          d.operadoras.map((o) => ({
            id: o.id,
            nome: o.nomeFantasia ?? o.razaoSocial,
            registroAns: o.registroAns,
          }))
        "
        :hoje="hoje"
      />
      <CadastroComplementarOperadora
        v-else-if="aba === 'complementar'"
        :operadora="operadora"
        :pode-editar="d.acoes.editarEmpresa"
        :hoje="hoje"
      />
      <ElegibilidadeOperadora v-else />
    </template>

    <GrupoDominiosTela subitem="operadoraBeneficiarios" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="operadora-outras-tabelas">{{
        t('operadora.telas.ans.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
