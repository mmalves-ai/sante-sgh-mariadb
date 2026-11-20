<script setup lang="ts">
// Demonstração dos componentes sobre a casca (SOMENTE desenvolvimento; a rota não existe no build de
// produção). Serve à validação humana do M07: colar emoji, ler o cabeçalho de um paciente fictício,
// simular uma colisão, usar F2 e Ctrl+Enter. Todos os dados são sintéticos.
import { type ContextoPaciente, type Problema, urnProblema } from '@sgh/contratos';
import {
  SanteAvisoColisao,
  SanteBotao,
  SanteCabecalhoPaciente,
  SanteCampoTexto,
  SanteData,
  SanteHora,
  SantePassos,
  SanteTabela,
  type ConsultaTabela,
} from '@sgh/ui';
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { atalhos } from '../../casca/atalhos/atalhos.js';

const { t } = useI18n();
const observacao = ref('');
const data = ref<string | null>(null);
const hora = ref<string | null>('0830');
const passo = ref('1');
const colisao = ref<Problema | null>(null);
const aviso = ref('');

const paciente: ContextoPaciente = {
  identificacao: {
    nomeSocial: 'Nome Social Fictício',
    nomeCivil: 'Paciente Fictício Um',
    nascimento: '1980-05-17',
    idade: '46 anos',
    sexo: 'F',
    prontuario: '000123',
  },
  localizacao: {
    estabelecimento: 'Estabelecimento de teste',
    unidade: 'Unidade A',
    leito: '101-B',
    diasInternacao: 3,
    altaProvavel: null,
  },
  atendimento: { tipo: 'Internação', numero: '0001', convenio: 'Convênio de teste', medicoResponsavel: null },
  alergias: { situacao: 'nao-avaliadas' },
  alertas: [{ id: 'iso', texto: 'Isolamento de contato' }],
  homonimoNaUnidade: true,
  medidas: { peso: { valor: '70 kg', data: '2026-10-18' }, altura: null },
};

function simularColisao(): void {
  colisao.value = {
    type: urnProblema('conflito-de-versao'),
    status: 409,
    correlacao: 'demo-0000-0001',
    alteradoPor: 'legado',
    alteracoes: [
      {
        campo: 'observacao',
        rotulo: t('demonstracao.texto'),
        lido: observacao.value || null,
        atual: 'Texto alterado no outro sistema',
      },
    ],
  };
}
const LINHAS = Array.from({ length: 87 }, (_, i) => ({ id: i + 1, nome: `Item sintético ${i + 1}` }));
async function carregar(c: ConsultaTabela) {
  let l = LINHAS.filter((x) => x.nome.includes(c.filtro));
  if (c.ordem?.direcao === 'desc') l = [...l].reverse();
  return { itens: l.slice(c.pagina * c.tamanho, (c.pagina + 1) * c.tamanho), total: l.length };
}
const relogio = () => new Date().toTimeString().slice(0, 5);
const soltar = [
  atalhos.registrar('salvar-rascunho', () => (aviso.value = t('demonstracao.salvo', { hora: relogio() }))),
  atalhos.registrar('concluir', () => (aviso.value = t('demonstracao.concluido'))),
];
onBeforeUnmount(() => soltar.forEach((s) => s()));
</script>

<template>
  <section class="tela demo" aria-labelledby="demo-titulo">
    <h1 id="demo-titulo">{{ t('demonstracao.titulo') }}</h1>
    <p>{{ t('demonstracao.aviso') }}</p>
    <h2>{{ t('demonstracao.paciente') }}</h2>
    <SanteCabecalhoPaciente :paciente="paciente" />
    <SantePassos
      v-model="passo"
      :passos="[
        { valor: '1', rotulo: 'Dados' },
        { valor: '2', rotulo: 'Conferência' },
        { valor: '3', rotulo: 'Conclusão' },
      ]"
    />
    <form class="demo__form" @submit.prevent="simularColisao">
      <SanteCampoTexto
        id="demo-observacao"
        v-model="observacao"
        :rotulo="t('demonstracao.texto')"
        :max-bytes="60"
      />
      <SanteData v-model="data" :rotulo="t('demonstracao.data')" editavel />
      <SanteHora v-model="hora" :rotulo="t('demonstracao.hora')" editavel />
      <SanteBotao :rotulo="t('demonstracao.simularColisao')" tipo="submit" data-testid="simular-colisao" />
      <SanteBotao
        :rotulo="t('demonstracao.descartar')"
        variante="destrutivo"
        :confirmacao="t('demonstracao.descartarPergunta')"
        data-testid="descartar-observacao"
        @acionar="observacao = ''"
      />
    </form>
    <p role="status" data-testid="aviso-demo">{{ aviso }}</p>
    <SanteAvisoColisao
      v-if="colisao"
      :problema="colisao"
      @rever="colisao = null"
      @descartar="((observacao = ''), (colisao = null))"
    />
    <SanteTabela
      :rotulo="t('demonstracao.tabela')"
      chave="id"
      :tamanho-pagina="10"
      :colunas="[
        { campo: 'id', rotulo: 'Código', ordenavel: true },
        { campo: 'nome', rotulo: 'Nome' },
      ]"
      :carregar="carregar"
    />
  </section>
</template>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.demo__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 40rem;
}
</style>
