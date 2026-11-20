<script setup lang="ts">
// FHIR R4, RNDS e identificação de paciente (M34; ficha, seção 7 e regra 14): `/admin/integracoes/fhir`. Os perfis BR
// Core da versão fixada (cada recurso mapeado validado contra o recorte do pacote), o ambiente da RNDS (fora de
// produção, a homologação ou o simulador), o envio de vacina aplicada construído e desligado com os pré-requisitos, a
// identificação (CPF primeiro, CNS opcional; só contagens) e o recurso de teste (`integracao.fhir.enviar`). Abaixo, as
// tabelas da identificação (consulta).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { enviarTesteFhir, lerFhir } from '../api-integracoes.js';

const { t } = useI18n();
const podeEnviar = pode('integracao.fhir.enviar');
const fhir = useQuery({ queryKey: ['integracoes', 'fhir'], queryFn: () => lerFhir() });
const teste = ref<string | null>(null);
const erro = ref<unknown>(null);
async function testar(): Promise<void> {
  erro.value = null;
  try {
    const r = await enviarTesteFhir();
    teste.value = r.valido
      ? t('integracoes.fhir.testeOk', { a: t(`integracoes.fhir.ambientes.${r.ambiente}`), r: r.recibo })
      : t('integracoes.fhir.testeProblemas', { p: r.problemas.join('; ') });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fhir-titulo" data-testid="tela-fhir">
    <h1 id="fhir-titulo">{{ t('integracoes.fhir.titulo') }}</h1>
    <p>{{ t('integracoes.fhir.texto') }}</p>
    <MensagemErro v-if="fhir.isError.value" :erro="fhir.error.value" />
    <p v-else-if="!fhir.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-perfis">
        <caption>
          {{
            t('integracoes.fhir.versao', { v: fhir.data.value.versaoBrCore })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('integracoes.fhir.recurso') }}</th>
            <th scope="col">{{ t('integracoes.fhir.perfil') }}</th>
            <th scope="col">{{ t('integracoes.fhir.valido') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in fhir.data.value.perfis" :key="p.recurso">
            <td>{{ p.recurso }}</td>
            <td>{{ p.perfil }}</td>
            <td>{{ p.valido ? t('integracoes.fhir.sim') : t('integracoes.fhir.nao') }}</td>
          </tr>
        </tbody>
      </table>
      <section class="painel" aria-labelledby="rnds-titulo">
        <h2 id="rnds-titulo">
          {{
            t('integracoes.fhir.ambiente', {
              a: t(`integracoes.fhir.ambientes.${fhir.data.value.rnds.ambiente}`),
            })
          }}
        </h2>
        <p>
          {{ t('integracoes.fhir.vacina') }}:
          {{
            fhir.data.value.rnds.envioVacina.ligado
              ? t('integracoes.fhir.ligado')
              : t('integracoes.fhir.desligado')
          }}
        </p>
        <div v-if="fhir.data.value.rnds.envioVacina.motivo" role="note" data-testid="fhir-vacina-motivo">
          <SanteAlerta variante="info" :texto="fhir.data.value.rnds.envioVacina.motivo" />
        </div>
        <h3>{{ t('integracoes.fhir.prerequisitos') }}</h3>
        <ul>
          <li v-for="p in fhir.data.value.rnds.prerequisitos" :key="p.descricao">
            {{ p.descricao }} ({{ p.situacao }})
          </li>
        </ul>
        <h3>{{ t('integracoes.fhir.identificacao') }}</h3>
        <ul>
          <li>{{ t('integracoes.fhir.cpf', { n: fhir.data.value.identificacao.pacientesComCpf }) }}</li>
          <li>{{ t('integracoes.fhir.cns', { n: fhir.data.value.identificacao.pacientesComCns }) }}</li>
          <li>
            {{ t('integracoes.fhir.profCns', { n: fhir.data.value.identificacao.profissionaisComCns }) }}
          </li>
          <li>
            {{
              t('integracoes.fhir.cnes', {
                v: fhir.data.value.identificacao.estabelecimentoComCnes
                  ? t('integracoes.fhir.sim')
                  : t('integracoes.fhir.nao'),
              })
            }}
          </li>
        </ul>
        <SanteBotao
          v-if="podeEnviar"
          variante="secundario"
          :rotulo="t('integracoes.fhir.teste')"
          data-testid="fhir-teste"
          @acionar="testar"
        />
        <p v-if="teste" role="status" data-testid="fhir-teste-resultado">{{ teste }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
      </section>
      <details>
        <summary>{{ t('integracoes.fhir.tabelas') }}</summary>
        <GrupoDominiosTela subitem="integracaoFhir" embutida />
      </details>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
