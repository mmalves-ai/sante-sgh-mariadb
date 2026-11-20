<script setup lang="ts">
// SMS e WhatsApp (M34; ficha, seção 7 e regra 15a; DP-44 b): `/admin/integracoes/mensagens`. Toda comunicação com o
// paciente é pela Hal-AI (o endereço da API é parâmetro do estabelecimento; a credencial fica no cofre): o sistema não
// tem canal próprio, e o envio fica desligado até a base legal (DP-44 a). Abaixo, o CRUD genérico dos domínios das
// mensagens (tipos de erro, de agendamento e situações).
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerMensagens } from '../api-integracoes.js';

const { t } = useI18n();
/** O endereço é parâmetro do estabelecimento (D-AGIR-34): o link abre o parâmetro na tela de Parâmetros do sistema. */
const CHAVE_ENDERECO = 'integracao.halaiEndereco';
const estado = useQuery({ queryKey: ['integracoes', 'mensagens'], queryFn: () => lerMensagens() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mensagens-titulo" data-testid="tela-mensagens">
    <h1 id="mensagens-titulo">{{ t('integracoes.mensagens.titulo') }}</h1>
    <p>{{ t('integracoes.mensagens.texto') }}</p>
    <MensagemErro v-if="estado.isError.value" :erro="estado.error.value" />
    <p v-else-if="!estado.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <section v-else class="painel" data-testid="mensagens-estado">
      <p>
        {{
          t('integracoes.mensagens.endereco', {
            e: estado.data.value.enderecoApi ?? t('integracoes.mensagens.semEndereco'),
          })
        }}
      </p>
      <p v-if="!estado.data.value.enderecoApi">
        <RouterLink
          :to="{ name: 'config.parametro', params: { chave: CHAVE_ENDERECO } }"
          data-testid="mensagens-configurar-endereco"
          >{{ t('integracoes.mensagens.configurarEndereco') }}</RouterLink
        >
      </p>
      <p>
        {{
          t('integracoes.mensagens.token', {
            t: estado.data.value.tokenConfigurado
              ? t('integracoes.mensagens.configurado')
              : t('integracoes.mensagens.naoConfigurado'),
          })
        }}
      </p>
      <p>{{ t('integracoes.mensagens.canalProprio') }}</p>
      <div v-if="!estado.data.value.envioLigado" role="note">
        <SanteAlerta
          variante="info"
          :texto="`${t('integracoes.mensagens.envio')}: ${estado.data.value.motivo ?? ''}`"
        />
      </div>
    </section>
    <h2>{{ t('integracoes.mensagens.dominios') }}</h2>
    <GrupoDominiosTela subitem="integracaoMensagens" embutida />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
